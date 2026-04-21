import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/basic-auth";
import { sendOrderConfirmationEmail } from "@/lib/email";
import { apiError, enforceWriteRequestSecurity } from "@/lib/api-security";
import { validatePayInStoreVisitDate } from "@/lib/order-rules";
import { archiveOrderHistoryByOrderId } from "@/lib/order-history";
import { supabaseServer } from "@/lib/supabase-server";
import {
  cancelOrderPayloadSchema,
  confirmHumanPayloadSchema,
  markCollectedPayloadSchema,
  markPaidPayloadSchema,
  markShippedPayloadSchema,
  orderActionRequestSchema,
  setPaymentMethodPayloadSchema,
  zodFields,
} from "@/lib/validation";
import {
  buildIdempotencyHash,
  OrderActionError,
  executeCancelOrderAction,
  executeConfirmHumanAction,
  executeMarkCollectedAction,
  executeMarkPaidAction,
  executeMarkShippedAction,
  executeSetPaymentMethodAction,
  runIdempotentMutation,
} from "@/lib/order-actions";
import { getRequestId, logError } from "@/lib/logger";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function getIdempotencyKey(request: NextRequest) {
  return request.headers.get("idempotency-key")?.trim() ?? "";
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const requestId = getRequestId(request);
  const { id } = await params;

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

  const body = await request.json().catch(() => null);
  const parsed = orderActionRequestSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, {
      ok: false,
      error: "入力内容が不正です",
      code: "VALIDATION_ERROR",
      fields: zodFields(parsed.error),
      requestId,
    });
  }

  const { action, expectedVersion, payload } = parsed.data;

  try {
    switch (action) {
      case "CONFIRM_HUMAN": {
        const payloadResult = confirmHumanPayloadSchema.safeParse(payload);
        if (!payloadResult.success) {
          return apiError(400, {
            ok: false,
            error: "入力内容が不正です",
            code: "VALIDATION_ERROR",
            fields: zodFields(payloadResult.error),
            requestId,
          });
        }

        const actorKey = `user:${id}`;
        const result = await runIdempotentMutation({
          scope: "POST:/api/orders/{id}/actions:CONFIRM_HUMAN",
          actorKey,
          idempotencyKey,
          requestHash: buildIdempotencyHash({
            action,
            orderId: id,
            expectedVersion,
            payload: payloadResult.data,
          }),
          execute: () =>
            executeConfirmHumanAction({
              orderId: id,
              expectedVersion,
              humanToken: payloadResult.data.humanToken,
              actorId: actorKey,
              requestId,
              idempotencyKey,
            }),
        });

        return NextResponse.json(result.body, { status: result.status });
      }

      case "SET_PAYMENT_METHOD": {
        const payloadResult = setPaymentMethodPayloadSchema.safeParse(payload);
        if (!payloadResult.success) {
          return apiError(400, {
            ok: false,
            error: "入力内容が不正です",
            code: "VALIDATION_ERROR",
            fields: zodFields(payloadResult.error),
            requestId,
          });
        }

        if (payloadResult.data.paymentMethod === "PAY_IN_STORE") {
          const storeVisitValidation = validatePayInStoreVisitDate(
            payloadResult.data.storeVisitDate ?? null
          );
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

        const actorKey = `user:${id}`;
        const result = await runIdempotentMutation({
          scope: "POST:/api/orders/{id}/actions:SET_PAYMENT_METHOD",
          actorKey,
          idempotencyKey,
          requestHash: buildIdempotencyHash({
            action,
            orderId: id,
            expectedVersion,
            payload: payloadResult.data,
          }),
          execute: async () => {
            const actionResult = await executeSetPaymentMethodAction({
              orderId: id,
              expectedVersion,
              paymentMethod: payloadResult.data.paymentMethod,
              storeVisitDate: payloadResult.data.storeVisitDate ?? null,
              humanToken: payloadResult.data.humanToken,
              actorType: "user",
              actorId: actorKey,
              requestId,
              idempotencyKey,
            });

            const { data: orderRow, error: orderError } = await supabaseServer
              .from("orders")
              .select(
                "id, customer_name, email, phone, zip_code, prefecture, city, address, building, items, total, payment_method, store_visit_date"
              )
              .eq("id", id)
              .maybeSingle();

            if (orderError || !orderRow) {
              logError("orders.actions.set_payment_method.fetch_email_context_failed", {
                requestId,
                route: "/api/orders/[id]/actions",
                errorCode: "ORDER_EMAIL_CONTEXT_FETCH_FAILED",
                context: { orderId: id, message: orderError?.message ?? "Order not found" },
              });

              throw new OrderActionError(
                502,
                "ORDER_EMAIL_CONTEXT_FETCH_FAILED",
                "注文確認メール送信の準備に失敗しました"
              );
            }

            const emailItems = Array.isArray(orderRow.items)
              ? orderRow.items
                  .filter(
                    (item): item is { id?: string; name: string; price: number; quantity: number } =>
                      typeof item === "object" &&
                      item !== null &&
                      typeof (item as { name?: unknown }).name === "string" &&
                      typeof (item as { price?: unknown }).price === "number" &&
                      typeof (item as { quantity?: unknown }).quantity === "number"
                  )
                  .map((item) => ({
                    id: item.id ?? "",
                    name: item.name,
                    price: item.price,
                    quantity: item.quantity,
                  }))
              : [];

            let bankAccount:
              | {
                  bank_name: string;
                  branch_name: string;
                  account_type: string;
                  account_number: string;
                  account_holder: string;
                }
              | undefined;

            if (orderRow.payment_method === "BANK_TRANSFER") {
              const { data } = await supabaseServer.from("bank_account").select("*").limit(1);
              bankAccount =
                (data?.[0] as
                  | {
                      bank_name: string;
                      branch_name: string;
                      account_type: string;
                      account_number: string;
                      account_holder: string;
                    }
                  | undefined) ?? undefined;
            }

            const emailResult = await sendOrderConfirmationEmail(
              {
                name: String(orderRow.customer_name),
                email: String(orderRow.email),
                phone: String(orderRow.phone),
                zipCode: String(orderRow.zip_code),
                prefecture: String(orderRow.prefecture),
                city: String(orderRow.city),
                address: String(orderRow.address),
                building: typeof orderRow.building === "string" ? orderRow.building : "",
              },
              emailItems,
              Number(orderRow.total ?? 0),
              orderRow.payment_method === "PAY_IN_STORE" ? "PAY_IN_STORE" : "BANK_TRANSFER",
              typeof orderRow.store_visit_date === "string" ? orderRow.store_visit_date : undefined,
              bankAccount
            );

            if (!emailResult.sent) {
              logError("orders.actions.set_payment_method.email_failed", {
                requestId,
                route: "/api/orders/[id]/actions",
                errorCode: emailResult.reason,
                context: {
                  orderId: id,
                  target: emailResult.target,
                },
              });

              throw new OrderActionError(
                502,
                "ORDER_NOTIFICATION_FAILED",
                "注文確認メールの送信に失敗しました"
              );
            }

            return {
              ...(actionResult as Record<string, unknown>),
              notification: {
                sent: true,
                provider: emailResult.provider,
                adminSent: emailResult.adminSent,
              },
            };
          },
        });

        return NextResponse.json(result.body, { status: result.status });
      }

      case "MARK_PAID":
      case "MARK_COLLECTED":
      case "MARK_SHIPPED":
      case "CANCEL": {
        if (!isAuthorized(request)) {
          return apiError(401, {
            ok: false,
            error: "Unauthorized",
            code: "UNAUTHORIZED",
            requestId,
          });
        }

        const actorKey = "admin";

        if (action === "MARK_PAID") {
          const payloadResult = markPaidPayloadSchema.safeParse(payload);
          if (!payloadResult.success) {
            return apiError(400, {
              ok: false,
              error: "入力内容が不正です",
              code: "VALIDATION_ERROR",
              fields: zodFields(payloadResult.error),
              requestId,
            });
          }

          const result = await runIdempotentMutation({
            scope: "POST:/api/orders/{id}/actions:MARK_PAID",
            actorKey,
            idempotencyKey,
            requestHash: buildIdempotencyHash({
              action,
              orderId: id,
              expectedVersion,
              payload: payloadResult.data,
            }),
            execute: () =>
              executeMarkPaidAction({
                orderId: id,
                expectedVersion,
                paymentReference: payloadResult.data.paymentReference,
                receivedAmount: payloadResult.data.receivedAmount,
                actorType: "admin",
                actorId: actorKey,
                requestId,
                idempotencyKey,
                adminNote: payloadResult.data.adminNote,
              }),
          });

          return NextResponse.json(result.body, { status: result.status });
        }

        if (action === "MARK_COLLECTED") {
          const payloadResult = markCollectedPayloadSchema.safeParse(payload);
          if (!payloadResult.success) {
            return apiError(400, {
              ok: false,
              error: "入力内容が不正です",
              code: "VALIDATION_ERROR",
              fields: zodFields(payloadResult.error),
              requestId,
            });
          }

          const result = await runIdempotentMutation({
            scope: "POST:/api/orders/{id}/actions:MARK_COLLECTED",
            actorKey,
            idempotencyKey,
            requestHash: buildIdempotencyHash({
              action,
              orderId: id,
              expectedVersion,
              payload: payloadResult.data,
            }),
            execute: () =>
              executeMarkCollectedAction({
                orderId: id,
                expectedVersion,
                receivedAmount: payloadResult.data.receivedAmount,
                actorType: "admin",
                actorId: actorKey,
                requestId,
                idempotencyKey,
                adminNote: payloadResult.data.adminNote,
              }),
          });

          return NextResponse.json(result.body, { status: result.status });
        }

        if (action === "MARK_SHIPPED") {
          const payloadResult = markShippedPayloadSchema.safeParse(payload);
          if (!payloadResult.success) {
            return apiError(400, {
              ok: false,
              error: "入力内容が不正です",
              code: "VALIDATION_ERROR",
              fields: zodFields(payloadResult.error),
              requestId,
            });
          }

          const result = await runIdempotentMutation({
            scope: "POST:/api/orders/{id}/actions:MARK_SHIPPED",
            actorKey,
            idempotencyKey,
            requestHash: buildIdempotencyHash({
              action,
              orderId: id,
              expectedVersion,
              payload: payloadResult.data,
            }),
            execute: async () => {
              const actionResult = await executeMarkShippedAction({
                orderId: id,
                expectedVersion,
                actorType: "admin",
                actorId: actorKey,
                requestId,
                idempotencyKey,
                adminNote: payloadResult.data.adminNote,
              });

              await archiveOrderHistoryByOrderId({
                orderId: id,
                source: "admin",
                requestId,
              });

              return actionResult;
            },
          });

          return NextResponse.json(result.body, { status: result.status });
        }

        const payloadResult = cancelOrderPayloadSchema.safeParse(payload);
        if (!payloadResult.success) {
          return apiError(400, {
            ok: false,
            error: "入力内容が不正です",
            code: "VALIDATION_ERROR",
            fields: zodFields(payloadResult.error),
            requestId,
          });
        }

        const result = await runIdempotentMutation({
          scope: "POST:/api/orders/{id}/actions:CANCEL",
          actorKey,
          idempotencyKey,
          requestHash: buildIdempotencyHash({
            action,
            orderId: id,
            expectedVersion,
            payload: payloadResult.data,
          }),
          execute: async () => {
            const actionResult = await executeCancelOrderAction({
              orderId: id,
              expectedVersion,
              reasonCode: payloadResult.data.reasonCode,
              actorType: "admin",
              actorId: actorKey,
              requestId,
              idempotencyKey,
              adminNote: payloadResult.data.adminNote,
            });

            await archiveOrderHistoryByOrderId({
              orderId: id,
              source: "admin",
              requestId,
            });

            return actionResult;
          },
        });

        return NextResponse.json(result.body, { status: result.status });
      }

      default:
        return apiError(400, {
          ok: false,
          error: "未対応のアクションです",
          code: "INVALID_ACTION",
          requestId,
        });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError("orders.actions.unexpected", {
      requestId,
      route: "/api/orders/[id]/actions",
      errorCode: "INTERNAL_SERVER_ERROR",
      context: {
        orderId: id,
        action,
        message,
      },
    });

    return apiError(500, {
      ok: false,
      error: "Internal server error",
      code: "INTERNAL_SERVER_ERROR",
      requestId,
    });
  }
}
