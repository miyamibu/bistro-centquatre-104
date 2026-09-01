import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import {
  apiError,
  ORDER_JSON_BODY_LIMIT_BYTES,
  readLimitedJson,
} from "@/lib/api-security";
import { createOrderSchema, zodFields } from "@/lib/validation";
import {
  buildIdempotencyHash,
  createQuotedHoldExpiry,
  executeAtomicOrderMutation,
  hashHumanToken,
  normalizeOrderPaymentMethod,
} from "@/lib/order-actions";
import { createOrderReceiptToken, hashOrderReceiptToken } from "@/lib/order-receipt";
import { buildOrderActorKey } from "@/lib/order-identity";
import { validatePayInStoreVisitDate } from "@/lib/order-rules";
import { getPublishedStoreProduct } from "@/lib/store-products";
import { getRequestId, logError, logInfo, logWarn } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { enforceScopedRateLimit } from "@/lib/reservation-rate-limit";
import { getClientIp, hashClientIp } from "@/lib/request-meta";

export const dynamic = "force-dynamic";

const ORDER_CREATE_RATE_LIMIT_SCOPE = "ORDER_CREATE";
const ORDER_CREATE_RATE_LIMIT_WINDOW_SECONDS = 10 * 60;
const ORDER_CREATE_RATE_LIMIT_MAX = 20;

function getIdempotencyKey(request: NextRequest) {
  return request.headers.get("idempotency-key")?.trim() ?? "";
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  const route = "/api/orders";

  const idempotencyKey = getIdempotencyKey(request);
  if (!idempotencyKey) {
    return apiError(400, {
      ok: false,
      error: "Idempotency-Key が必要です",
      code: "MISSING_IDEMPOTENCY_KEY",
      requestId,
    });
  }
  if (idempotencyKey.length > 256) {
    return apiError(400, {
      ok: false,
      error: "Idempotency-Key は256文字以内で指定してください",
      code: "IDEMPOTENCY_KEY_TOO_LONG",
      requestId,
    });
  }

  try {
    const json = await readLimitedJson(request, {
      requestId,
      maxBytes: ORDER_JSON_BODY_LIMIT_BYTES,
    });
    if (!json.ok) return json.response;

    const parsed = createOrderSchema.safeParse(json.body);
    if (!parsed.success) {
      return apiError(400, {
        ok: false,
        error: "入力内容が不正です",
        code: "VALIDATION_ERROR",
        fields: zodFields(parsed.error),
        requestId,
      });
    }

    try {
      const allowed = await enforceScopedRateLimit(prisma, {
        keyHash: hashClientIp(getClientIp(request)),
        scope: ORDER_CREATE_RATE_LIMIT_SCOPE,
        windowMs: ORDER_CREATE_RATE_LIMIT_WINDOW_SECONDS * 1_000,
        limit: ORDER_CREATE_RATE_LIMIT_MAX,
      });
      if (!allowed) {
        return apiError(
          429,
          {
            ok: false,
            error: "注文リクエストが集中しています。時間をおいて再試行してください。",
            code: "RATE_LIMITED",
            requestId,
          },
          {
            headers: {
              "Cache-Control": "private, no-store",
              "Retry-After": String(ORDER_CREATE_RATE_LIMIT_WINDOW_SECONDS),
            },
          },
        );
      }
    } catch (error) {
      logError("orders.rate_limit.failed", {
        requestId,
        route,
        errorCode: "RATE_LIMIT_CHECK_FAILED",
        context: { message: error instanceof Error ? error.message : String(error) },
      });
      return apiError(
        503,
        {
          ok: false,
          error: "注文受付を一時停止しています。時間をおいて再試行してください。",
          code: "RATE_LIMIT_CHECK_FAILED",
          requestId,
        },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }

    const input = parsed.data;
    const normalizedPaymentMethod = normalizeOrderPaymentMethod(input.paymentMethod);

    if (normalizedPaymentMethod === "PAY_IN_STORE") {
      const storeVisitValidation = validatePayInStoreVisitDate(input.storeVisitDate ?? null);
      if (!storeVisitValidation.ok) {
        return apiError(400, {
          ok: false,
          error: storeVisitValidation.error,
          code: storeVisitValidation.code,
          requestId,
          ...(storeVisitValidation.fields ? { fields: storeVisitValidation.fields } : {}),
        });
      }
    }

    const validatedItems = input.items.map((clientItem) => {
      const product = getPublishedStoreProduct(clientItem.id);
      if (!product) {
        throw new Error("INVALID_MENU_ITEM");
      }

      return {
        id: product.id,
        name: product.name,
        price: product.priceYen,
        image: product.image,
        quantity: clientItem.quantity,
      };
    });

    const calculatedTotal = validatedItems.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0,
    );

    if (calculatedTotal !== input.total) {
      logWarn("orders.total.mismatch", {
        requestId,
        route,
        errorCode: "ORDER_TOTAL_MISMATCH",
        context: {
          clientTotal: input.total,
          calculatedTotal,
          items: input.items,
        },
      });
      throw new Error("ORDER_TOTAL_MISMATCH");
    }

    const actorKey = buildOrderActorKey(input.customerInfo.email, input.customerInfo.phone);
    const requestHash = buildIdempotencyHash({
      items: input.items,
      customerInfo: input.customerInfo,
      paymentMethod: normalizedPaymentMethod,
      total: input.total,
      storeVisitDate: input.storeVisitDate ?? null,
    });

    const holdExpiresAt = createQuotedHoldExpiry();
    const humanToken = randomBytes(24).toString("base64url");
    const receiptToken = createOrderReceiptToken();
    const result = await executeAtomicOrderMutation({
      scope: "POST:/api/orders",
      actorKey,
      idempotencyKey,
      requestHash,
      operation: "CREATE_QUOTE",
      successStatus: 201,
      mutationArgs: {
        customerName: input.customerInfo.name,
        email: input.customerInfo.email,
        phone: input.customerInfo.phone,
        zipCode: input.customerInfo.zipCode,
        prefecture: input.customerInfo.prefecture,
        city: input.customerInfo.city,
        address: input.customerInfo.address,
        building: input.customerInfo.building ?? null,
        items: validatedItems,
        total: calculatedTotal,
        holdExpiresAt,
        humanTokenHash: hashHumanToken(humanToken),
        receiptTokenHash: hashOrderReceiptToken(receiptToken),
        actorId: actorKey,
        requestId,
        selectedPaymentMethod: normalizedPaymentMethod,
        selectedStoreVisitDate: input.storeVisitDate ?? null,
      },
      responseContext: {
        message: "Quote created successfully",
        humanToken,
        receiptToken,
        paymentMethod: normalizedPaymentMethod,
        storeVisitDate: input.storeVisitDate ?? null,
        requestId,
      },
    });

    const order = (result.body as { order?: Record<string, unknown> }).order ?? {};
    if (!result.replayed && result.status === 201) {
      logInfo("orders.create.success", {
        requestId,
        route,
        context: {
          orderId: order.id,
          paymentMethod: normalizedPaymentMethod,
          total: calculatedTotal,
        },
      });
    }

    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "INVALID_MENU_ITEM") {
      return apiError(400, {
        ok: false,
        error: "無効な商品が含まれています",
        code: "INVALID_MENU_ITEM",
        requestId,
      });
    }

    if (message === "ORDER_TOTAL_MISMATCH") {
      return apiError(400, {
        ok: false,
        error: "注文合計金額が正確ではありません",
        code: "ORDER_TOTAL_MISMATCH",
        requestId,
      });
    }

    if (message === "ORDER_QUOTE_CREATE_FAILED") {
      return apiError(500, {
        ok: false,
        error: "注文の保存に失敗しました",
        code: "ORDER_QUOTE_CREATE_FAILED",
        requestId,
      });
    }

    logError("orders.create.unexpected", {
      requestId,
      route,
      errorCode: "INTERNAL_SERVER_ERROR",
      context: { message },
    });
    return apiError(500, {
      ok: false,
      error: "Internal server error",
      code: "INTERNAL_SERVER_ERROR",
      requestId,
    });
  }
}
