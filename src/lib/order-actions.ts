import { createHash } from "crypto";
import { supabaseServer } from "@/lib/supabase-server";
import type { NormalizedOrderPaymentMethod } from "@/lib/validation";

const BANK_TRANSFER_TTL_HOURS = 24;
const HUMAN_CONFIRM_TTL_MINUTES = 15;

type ActorType = "user" | "admin" | "agent" | "cron" | "system";

interface IdempotencyRecord {
  id: string;
  request_hash: string;
  response_status: number | null;
  response_body: unknown;
}

export class OrderActionError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message?: string) {
    super(message ?? code);
    this.status = status;
    this.code = code;
  }
}

function createActionError(status: number, code: string, message?: string) {
  return new OrderActionError(status, code, message);
}

export function buildIdempotencyHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function hashHumanToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function normalizeOrderPaymentMethod(value: string | null | undefined): NormalizedOrderPaymentMethod | null {
  if (!value) return null;
  if (value === "BANK_TRANSFER" || value === "bank-transfer") return "BANK_TRANSFER";
  if (value === "PAY_IN_STORE" || value === "cash-store") return "PAY_IN_STORE";
  return null;
}

export function createDefaultHumanConfirmationWindow() {
  const confirmedAt = new Date();
  const confirmedExpiresAt = new Date(confirmedAt.getTime() + HUMAN_CONFIRM_TTL_MINUTES * 60 * 1000);
  return {
    confirmedAt: confirmedAt.toISOString(),
    confirmedExpiresAt: confirmedExpiresAt.toISOString(),
  };
}

export function createQuotedHoldExpiry() {
  const holdExpiresAt = new Date(Date.now() + HUMAN_CONFIRM_TTL_MINUTES * 60 * 1000);
  return holdExpiresAt.toISOString();
}

export function computePaymentExpiry(
  paymentMethod: NormalizedOrderPaymentMethod,
  storeVisitDate?: string | null
) {
  if (paymentMethod === "BANK_TRANSFER") {
    return new Date(Date.now() + BANK_TRANSFER_TTL_HOURS * 60 * 60 * 1000).toISOString();
  }

  if (!storeVisitDate) {
    throw createActionError(400, "STORE_VISIT_DATE_REQUIRED", "来店予定日を指定してください");
  }

  return new Date(`${storeVisitDate}T23:59:59+09:00`).toISOString();
}

async function getExistingIdempotencyRecord(
  scope: string,
  actorKey: string,
  idempotencyKey: string
) {
  const response = await supabaseServer
    .from("api_idempotency")
    .select("id, request_hash, response_status, response_body")
    .eq("scope", scope)
    .eq("actor_key", actorKey)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  const { error } = response;
  const data = (response.data ?? null) as IdempotencyRecord | null;

  if (error) {
    throw createActionError(500, "IDEMPOTENCY_LOOKUP_FAILED", "Idempotency lookup failed");
  }

  return data ?? null;
}

async function claimIdempotencyRecord(input: {
  scope: string;
  actorKey: string;
  idempotencyKey: string;
  requestHash: string;
}) {
  const existing = await getExistingIdempotencyRecord(
    input.scope,
    input.actorKey,
    input.idempotencyKey
  );

  if (existing) {
    if (existing.request_hash !== input.requestHash) {
      throw createActionError(409, "IDEMPOTENCY_CONFLICT", "同じキーで別の内容は送信できません");
    }

    if (existing.response_body != null && existing.response_status != null) {
      return { kind: "replay" as const, record: existing };
    }

    throw createActionError(409, "IDEMPOTENCY_IN_PROGRESS", "同じキーの処理が進行中です");
  }

  const response = await supabaseServer
    .from("api_idempotency")
    .insert([
      {
        scope: input.scope,
        actor_key: input.actorKey,
        idempotency_key: input.idempotencyKey,
        request_hash: input.requestHash,
      },
    ])
    .select("id, request_hash, response_status, response_body")
    .single();

  const { error } = response;
  const data = (response.data ?? null) as IdempotencyRecord | null;

  if (!error && data) {
    return { kind: "created" as const, record: data };
  }

  if (!error) {
    throw createActionError(500, "IDEMPOTENCY_CLAIM_FAILED", "Idempotency record was not returned");
  }

  if (error.code === "23505") {
    const raced = await getExistingIdempotencyRecord(
      input.scope,
      input.actorKey,
      input.idempotencyKey
    );

    if (!raced) {
      throw createActionError(500, "IDEMPOTENCY_RACE_FAILED");
    }

    if (raced.request_hash !== input.requestHash) {
      throw createActionError(409, "IDEMPOTENCY_CONFLICT", "同じキーで別の内容は送信できません");
    }

    if (raced.response_body != null && raced.response_status != null) {
      return { kind: "replay" as const, record: raced };
    }

    throw createActionError(409, "IDEMPOTENCY_IN_PROGRESS", "同じキーの処理が進行中です");
  }

  throw createActionError(500, "IDEMPOTENCY_CLAIM_FAILED", "Idempotency claim failed");
}

async function finalizeIdempotencyRecord(
  id: string,
  status: number,
  body: unknown,
  resourceId?: string | null
) {
  const { error } = await supabaseServer
    .from("api_idempotency")
    .update({
      response_status: status,
      response_body: body,
      resource_id: resourceId ?? null,
    })
    .eq("id", id);

  if (error) {
    throw createActionError(500, "IDEMPOTENCY_FINALIZE_FAILED", "Idempotency finalize failed");
  }
}

function mapRpcError(error: { message?: string } | null, fallbackCode: string): OrderActionError {
  const message = error?.message ?? fallbackCode;
  const upper = message.toUpperCase();

  const explicitCodes = [
    "ORDER_NOT_FOUND",
    "VERSION_CONFLICT",
    "INVALID_STATUS_TRANSITION",
    "HUMAN_CONFIRMATION_REQUIRED",
    "HUMAN_TOKEN_INVALID",
    "HUMAN_TOKEN_EXPIRED",
    "PAYMENT_REFERENCE_MISMATCH",
    "PAYMENT_AMOUNT_MISMATCH",
    "PAYMENT_METHOD_MISMATCH",
    "STORE_VISIT_DATE_REQUIRED",
    "STORE_VISIT_NOT_BUSINESS_DAY",
    "STORE_VISIT_OUT_OF_RANGE",
    "INVALID_PAYMENT_METHOD",
    "ALREADY_CANCELLED",
    "ALREADY_COMPLETED",
  ];

  const matched = explicitCodes.find((code) => upper.includes(code));
  if (matched) {
    const status =
      matched === "ORDER_NOT_FOUND"
        ? 404
        : matched.startsWith("HUMAN_")
          ? 403
          : matched === "STORE_VISIT_DATE_REQUIRED" ||
              matched === "STORE_VISIT_NOT_BUSINESS_DAY" ||
              matched === "STORE_VISIT_OUT_OF_RANGE" ||
              matched === "INVALID_PAYMENT_METHOD"
            ? 400
            : 409;
    return createActionError(status, matched, message);
  }

  return createActionError(500, fallbackCode, message);
}

async function executeRpc<TBody>(input: {
  rpcName: string;
  rpcArgs: Record<string, unknown>;
  fallbackCode: string;
}) {
  const { data, error } = await supabaseServer.rpc(input.rpcName, input.rpcArgs);
  if (error) {
    throw mapRpcError(error, input.fallbackCode);
  }

  if (!data || typeof data !== "object") {
    throw createActionError(500, input.fallbackCode, "Unexpected RPC response");
  }

  return data as TBody;
}

export async function runIdempotentMutation<TBody>(input: {
  scope: string;
  actorKey: string;
  idempotencyKey: string;
  requestHash: string;
  successStatus?: number;
  resourceId?: string | null;
  execute: () => Promise<TBody>;
}) {
  let claim;
  try {
    claim = await claimIdempotencyRecord({
      scope: input.scope,
      actorKey: input.actorKey,
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
    });
  } catch (error) {
    if (error instanceof OrderActionError) {
      return {
        status: error.status,
        body: {
          ok: false,
          error: error.message,
          code: error.code,
        } as TBody,
        replayed: false,
      };
    }

    throw error;
  }

  if (claim.kind === "replay") {
    return {
      status: claim.record.response_status ?? 200,
      body: claim.record.response_body as TBody,
      replayed: true,
    };
  }

  try {
    const body = await input.execute();
    let resourceId = input.resourceId ?? null;
    if (resourceId == null && typeof body === "object" && body !== null && "order" in body) {
      const orderId = (body as { order?: { id?: string } }).order?.id;
      resourceId = orderId ? String(orderId) : null;
    }
    await finalizeIdempotencyRecord(
      claim.record.id,
      input.successStatus ?? 200,
      body,
      resourceId
    );
    return {
      status: input.successStatus ?? 200,
      body,
      replayed: false,
    };
  } catch (error) {
    if (error instanceof OrderActionError) {
      const body = {
        ok: false,
        error: error.message,
        code: error.code,
      };
      await finalizeIdempotencyRecord(claim.record.id, error.status, body, input.resourceId ?? null);
      return {
        status: error.status,
        body: body as TBody,
        replayed: false,
      };
    }

    const { error: cleanupError } = await supabaseServer
      .from("api_idempotency")
      .delete()
      .eq("id", claim.record.id);

    if (cleanupError) {
      throw createActionError(500, "IDEMPOTENCY_CLEANUP_FAILED", "Idempotency cleanup failed");
    }

    throw error;
  }
}

export async function executeConfirmHumanAction(input: {
  orderId: string;
  expectedVersion: number;
  humanToken: string;
  actorId: string;
  requestId: string;
  idempotencyKey: string;
}) {
  return executeRpc<Record<string, unknown>>({
    rpcName: "confirm_order_human_action",
    rpcArgs: {
      p_order_id: input.orderId,
      p_expected_version: input.expectedVersion,
      p_token_hash: hashHumanToken(input.humanToken),
      p_actor_id: input.actorId,
      p_request_id: input.requestId,
      p_idempotency_key: input.idempotencyKey,
    },
    fallbackCode: "CONFIRM_HUMAN_FAILED",
  });
}

export async function executeSetPaymentMethodAction(input: {
  orderId: string;
  expectedVersion: number;
  paymentMethod: NormalizedOrderPaymentMethod;
  storeVisitDate?: string | null;
  humanToken?: string | null;
  actorType: ActorType;
  actorId: string | null;
  requestId: string;
  idempotencyKey: string;
}) {
  return executeRpc<Record<string, unknown>>({
    rpcName: "set_order_payment_method_action",
    rpcArgs: {
      p_order_id: input.orderId,
      p_expected_version: input.expectedVersion,
      p_payment_method: input.paymentMethod,
      p_store_visit_date: input.storeVisitDate ?? null,
      p_token_hash: input.humanToken ? hashHumanToken(input.humanToken) : null,
      p_expires_at: computePaymentExpiry(input.paymentMethod, input.storeVisitDate),
      p_actor_type: input.actorType,
      p_actor_id: input.actorId,
      p_request_id: input.requestId,
      p_idempotency_key: input.idempotencyKey,
    },
    fallbackCode: "SET_PAYMENT_METHOD_FAILED",
  });
}

export async function executeMarkPaidAction(input: {
  orderId: string;
  expectedVersion: number;
  paymentReference: string;
  receivedAmount: number;
  actorType: ActorType;
  actorId: string | null;
  requestId: string;
  idempotencyKey: string;
  adminNote?: string;
}) {
  return executeRpc<Record<string, unknown>>({
    rpcName: "mark_order_paid_action",
    rpcArgs: {
      p_order_id: input.orderId,
      p_expected_version: input.expectedVersion,
      p_payment_reference: input.paymentReference,
      p_received_amount: input.receivedAmount,
      p_actor_type: input.actorType,
      p_actor_id: input.actorId,
      p_request_id: input.requestId,
      p_idempotency_key: input.idempotencyKey,
      p_admin_note: input.adminNote ?? null,
    },
    fallbackCode: "MARK_PAID_FAILED",
  });
}

export async function executeMarkCollectedAction(input: {
  orderId: string;
  expectedVersion: number;
  receivedAmount: number;
  actorType: ActorType;
  actorId: string | null;
  requestId: string;
  idempotencyKey: string;
  adminNote?: string;
}) {
  return executeRpc<Record<string, unknown>>({
    rpcName: "mark_order_collected_action",
    rpcArgs: {
      p_order_id: input.orderId,
      p_expected_version: input.expectedVersion,
      p_received_amount: input.receivedAmount,
      p_actor_type: input.actorType,
      p_actor_id: input.actorId,
      p_request_id: input.requestId,
      p_idempotency_key: input.idempotencyKey,
      p_admin_note: input.adminNote ?? null,
    },
    fallbackCode: "MARK_COLLECTED_FAILED",
  });
}

export async function executeMarkShippedAction(input: {
  orderId: string;
  expectedVersion: number;
  actorType: ActorType;
  actorId: string | null;
  requestId: string;
  idempotencyKey: string;
  adminNote?: string;
}) {
  return executeRpc<Record<string, unknown>>({
    rpcName: "mark_order_shipped_action",
    rpcArgs: {
      p_order_id: input.orderId,
      p_expected_version: input.expectedVersion,
      p_actor_type: input.actorType,
      p_actor_id: input.actorId,
      p_request_id: input.requestId,
      p_idempotency_key: input.idempotencyKey,
      p_admin_note: input.adminNote ?? null,
    },
    fallbackCode: "MARK_SHIPPED_FAILED",
  });
}

export async function executeCancelOrderAction(input: {
  orderId: string;
  expectedVersion: number;
  reasonCode: string;
  actorType: ActorType;
  actorId: string | null;
  requestId: string;
  idempotencyKey: string;
  adminNote?: string;
}) {
  return executeRpc<Record<string, unknown>>({
    rpcName: "cancel_order_action",
    rpcArgs: {
      p_order_id: input.orderId,
      p_expected_version: input.expectedVersion,
      p_reason_code: input.reasonCode,
      p_actor_type: input.actorType,
      p_actor_id: input.actorId,
      p_request_id: input.requestId,
      p_idempotency_key: input.idempotencyKey,
      p_admin_note: input.adminNote ?? null,
    },
    fallbackCode: "CANCEL_ORDER_FAILED",
  });
}
