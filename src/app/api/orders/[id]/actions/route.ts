import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getStaffAuth } from "@/lib/staff-auth";
import {
  apiError,
  ORDER_JSON_BODY_LIMIT_BYTES,
  readLimitedJson,
} from "@/lib/api-security";
import { validatePayInStoreVisitDate } from "@/lib/order-rules";
import { processOrderConfirmationOutboxForOrder } from "@/lib/order-notification-outbox";
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
  executeAtomicTerminalOrderAction,
  executeConfirmHumanAction,
  executeMarkCollectedAction,
  executeMarkPaidAction,
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

  const json = await readLimitedJson(request, {
    requestId,
    maxBytes: ORDER_JSON_BODY_LIMIT_BYTES,
  });
  if (!json.ok) return json.response;

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

  const parsed = orderActionRequestSchema.safeParse(json.body);
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

            const notificationResult = await processOrderConfirmationOutboxForOrder({
              orderId: id,
              requestId,
            });
            if (!notificationResult.sent) {
              logError("orders.actions.set_payment_method.notification_failed", {
                requestId,
                route: "/api/orders/[id]/actions",
                errorCode: String(notificationResult.reason),
                context: {
                  orderId: id,
                  processed: notificationResult.processed,
                },
              });
              return {
                ...(actionResult as Record<string, unknown>),
                notification: {
                  sent: false,
                  status: "PENDING_RETRY",
                  durableState: notificationResult.durableState,
                },
              };
            }

            return {
              ...(actionResult as Record<string, unknown>),
              notification: {
                sent: true,
                status: "SENT",
                durableState: notificationResult.durableState,
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
        const staffAuth = await getStaffAuth();
        if (!staffAuth) {
          return apiError(401, {
            ok: false,
            error: "Unauthorized",
            code: "UNAUTHORIZED",
            requestId,
          });
        }

        const actorKey = `staff:${staffAuth.userId}`;

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

          const result = await executeAtomicTerminalOrderAction({
            scope: "POST:/api/orders/{id}/actions:MARK_SHIPPED",
            actorKey,
            requestHash: buildIdempotencyHash({
              action,
              orderId: id,
              expectedVersion,
              payload: payloadResult.data,
            }),
            orderId: id,
            expectedVersion,
            action: "MARK_SHIPPED",
            actorType: "admin",
            actorId: actorKey,
            requestId,
            idempotencyKey,
            adminNote: payloadResult.data.adminNote,
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

        const result = await executeAtomicTerminalOrderAction({
          scope: "POST:/api/orders/{id}/actions:CANCEL",
          actorKey,
          requestHash: buildIdempotencyHash({
            action,
            orderId: id,
            expectedVersion,
            payload: payloadResult.data,
          }),
          orderId: id,
          expectedVersion,
          action: "CANCEL",
          reasonCode: payloadResult.data.reasonCode,
          actorType: "admin",
          actorId: actorKey,
          requestId,
          idempotencyKey,
          adminNote: payloadResult.data.adminNote,
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
