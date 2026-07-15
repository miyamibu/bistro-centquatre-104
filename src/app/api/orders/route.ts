import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { apiError, enforceWriteRequestSecurity } from "@/lib/api-security";
import { createOrderSchema, zodFields } from "@/lib/validation";
import {
  buildIdempotencyHash,
  createQuotedHoldExpiry,
  executeCreateOrderQuoteAction,
  hashHumanToken,
  normalizeOrderPaymentMethod,
  runIdempotentMutation,
} from "@/lib/order-actions";
import { validatePayInStoreVisitDate } from "@/lib/order-rules";
import { getPublishedStoreProduct } from "@/lib/store-products";
import { getRequestId, logError, logInfo, logWarn } from "@/lib/logger";

export const dynamic = "force-dynamic";

function getIdempotencyKey(request: NextRequest) {
  return request.headers.get("idempotency-key")?.trim() ?? "";
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  const route = "/api/orders";

  const securityError = enforceWriteRequestSecurity(request, { requestId });
  if (securityError) return securityError;

  const idempotencyKey = getIdempotencyKey(request);
  if (!idempotencyKey) {
    return apiError(400, {
      ok: false,
      error: "Idempotency-Key が必要です",
      code: "MISSING_IDEMPOTENCY_KEY",
      requestId,
    });
  }

  try {
    const body = await request.json().catch(() => null);
    const parsed = createOrderSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(400, {
        ok: false,
        error: "入力内容が不正です",
        code: "VALIDATION_ERROR",
        fields: zodFields(parsed.error),
        requestId,
      });
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

    const actorKey = `order-create:${input.customerInfo.email.toLowerCase()}:${input.customerInfo.phone}`;
    const requestHash = buildIdempotencyHash({
      items: input.items,
      customerInfo: input.customerInfo,
      paymentMethod: normalizedPaymentMethod,
      total: input.total,
      storeVisitDate: input.storeVisitDate ?? null,
    });

    const result = await runIdempotentMutation({
      scope: "POST:/api/orders",
      actorKey,
      idempotencyKey,
      requestHash,
      successStatus: 201,
      execute: async () => {
        const validatedItems = input.items.map((clientItem) => {
          const product = getPublishedStoreProduct(clientItem.id);
          if (!product) {
            throw new Error("INVALID_MENU_ITEM");
          }

          return {
            id: product.id,
            name: product.name,
            price: product.priceYen,
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

        const holdExpiresAt = createQuotedHoldExpiry();

        const humanToken = randomBytes(24).toString("base64url");
        const actionResult = await executeCreateOrderQuoteAction({
          customerInfo: input.customerInfo,
          items: validatedItems,
          total: calculatedTotal,
          holdExpiresAt,
          humanTokenHash: hashHumanToken(humanToken),
          actorId: actorKey,
          requestId,
          idempotencyKey,
          selectedPaymentMethod: normalizedPaymentMethod,
          selectedStoreVisitDate: input.storeVisitDate ?? null,
        });

        const order = (actionResult as { order?: Record<string, unknown> }).order ?? {};

        logInfo("orders.create.success", {
          requestId,
          route,
          context: {
            orderId: order.id,
            paymentMethod: normalizedPaymentMethod,
            total: calculatedTotal,
          },
        });

        return {
          ok: true,
          message: "Quote created successfully",
          order: {
            id: String(order.id),
            status: String(order.status),
            version: Number(order.version ?? 0),
            total: Number(order.total ?? calculatedTotal),
            holdExpiresAt,
          },
          paymentSetup: {
            orderId: String(order.id),
            expectedVersion: Number(order.version ?? 0),
            humanToken,
            paymentMethod: normalizedPaymentMethod,
            storeVisitDate: input.storeVisitDate ?? null,
            holdExpiresAt,
          },
          requestId,
        };
      },
    });

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
