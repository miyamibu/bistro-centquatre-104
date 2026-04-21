import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { supabaseServer } from "@/lib/supabase-server";
import { apiError, enforceWriteRequestSecurity } from "@/lib/api-security";
import { createOrderSchema, zodFields } from "@/lib/validation";
import {
  buildIdempotencyHash,
  createQuotedHoldExpiry,
  hashHumanToken,
  normalizeOrderPaymentMethod,
  runIdempotentMutation,
} from "@/lib/order-actions";
import { validatePayInStoreVisitDate } from "@/lib/order-rules";
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
        const menuItems = await prisma.menuItem.findMany({
          where: {
            id: { in: input.items.map((item) => item.id) },
            isPublished: true,
          },
        });

        if (menuItems.length !== input.items.length) {
          throw new Error("INVALID_MENU_ITEM");
        }

        const calculatedTotal = input.items.reduce((sum, clientItem) => {
          const menuItem = menuItems.find((m) => m.id === clientItem.id);
          if (!menuItem) {
            throw new Error(`Menu item not found: ${clientItem.id}`);
          }
          return sum + menuItem.price * clientItem.quantity;
        }, 0);

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

        const validatedItems = input.items.map((clientItem) => {
          const menuItem = menuItems.find((m) => m.id === clientItem.id)!;
          return {
            id: menuItem.id,
            name: menuItem.title,
            price: menuItem.price,
            quantity: clientItem.quantity,
          };
        });

        const holdExpiresAt = createQuotedHoldExpiry();

        const { data: insertedOrder, error: insertError } = await supabaseServer
          .from("orders")
          .insert([
            {
              customer_name: input.customerInfo.name,
              email: input.customerInfo.email,
              phone: input.customerInfo.phone,
              zip_code: input.customerInfo.zipCode,
              prefecture: input.customerInfo.prefecture,
              city: input.customerInfo.city,
              address: input.customerInfo.address,
              building: input.customerInfo.building || null,
              payment_method: null,
              payment_reference: null,
              items: validatedItems,
              total: calculatedTotal,
              store_visit_date: null,
              hold_expires_at: holdExpiresAt,
              expires_at: null,
              human_confirmed_at: null,
              human_confirmed_expires_at: null,
              human_confirmed_by: null,
              paid_at: null,
              shipped_at: null,
              canceled_at: null,
              cancel_reason: null,
              version: 0,
              status: "QUOTED",
            },
          ])
          .select()
          .single();

        if (insertError || !insertedOrder) {
          logError("orders.create.db.failed", {
            requestId,
            route,
            errorCode: "ORDER_DB_INSERT_FAILED",
            context: { message: insertError?.message ?? "No order returned" },
          });
          throw new Error("ORDER_DB_INSERT_FAILED");
        }

        const humanToken = randomBytes(24).toString("base64url");

        const { error: tokenError } = await supabaseServer.from("human_tokens").insert([
          {
            order_id: insertedOrder.id,
            token_hash: hashHumanToken(humanToken),
            expires_at: holdExpiresAt,
          },
        ]);

        if (tokenError) {
          await supabaseServer.from("orders").delete().eq("id", insertedOrder.id);
          logError("orders.create.human_token.failed", {
            requestId,
            route,
            errorCode: "ORDER_HUMAN_TOKEN_CREATE_FAILED",
            context: { orderId: insertedOrder.id, message: tokenError.message },
          });
          throw new Error("ORDER_HUMAN_TOKEN_CREATE_FAILED");
        }

        const { error: actionError } = await supabaseServer.from("order_actions").insert([
          {
            order_id: insertedOrder.id,
            action_type: "QUOTE_CREATED",
            actor_type: "user",
            actor_id: actorKey,
            request_id: requestId,
            idempotency_key: idempotencyKey,
            from_status: null,
            to_status: "QUOTED",
            version_before: null,
            version_after: 0,
            payment_method_before: null,
            payment_method_after: null,
            payment_reference: null,
            amount_snapshot: calculatedTotal,
            metadata: {
              selectedPaymentMethod: normalizedPaymentMethod,
              selectedStoreVisitDate: input.storeVisitDate ?? null,
            },
          },
        ]);

        if (actionError) {
          await supabaseServer.from("orders").delete().eq("id", insertedOrder.id);
          logError("orders.create.quote_action.failed", {
            requestId,
            route,
            errorCode: "ORDER_QUOTE_ACTION_CREATE_FAILED",
            context: { orderId: insertedOrder.id, message: actionError.message },
          });
          throw new Error("ORDER_QUOTE_ACTION_CREATE_FAILED");
        }

        logInfo("orders.create.success", {
          requestId,
          route,
          context: {
            orderId: insertedOrder.id,
            paymentMethod: normalizedPaymentMethod,
            total: calculatedTotal,
          },
        });

        return {
          ok: true,
          message: "Quote created successfully",
          order: {
            id: insertedOrder.id,
            status: insertedOrder.status,
            version: insertedOrder.version,
            total: insertedOrder.total,
            holdExpiresAt,
          },
          paymentSetup: {
            orderId: String(insertedOrder.id),
            expectedVersion: Number(insertedOrder.version ?? 0),
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

    if (message === "ORDER_DB_INSERT_FAILED") {
      return apiError(500, {
        ok: false,
        error: "注文の保存に失敗しました",
        code: "ORDER_DB_INSERT_FAILED",
        requestId,
      });
    }

    if (message === "ORDER_HUMAN_TOKEN_CREATE_FAILED") {
      return apiError(500, {
        ok: false,
        error: "本人確認トークンの作成に失敗しました",
        code: "ORDER_HUMAN_TOKEN_CREATE_FAILED",
        requestId,
      });
    }

    if (message === "ORDER_QUOTE_ACTION_CREATE_FAILED") {
      return apiError(500, {
        ok: false,
        error: "注文監査ログの作成に失敗しました",
        code: "ORDER_QUOTE_ACTION_CREATE_FAILED",
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
