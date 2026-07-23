"use client";

export type StoreAttemptPhase = "submitting" | "uncertain";

export type OrderCreateAttempt = {
  idempotencyKey: string;
  phase: StoreAttemptPhase;
};

export type OrderPaymentAttempt = OrderCreateAttempt & {
  orderId: string;
};

export type AttemptLoadResult<T> =
  | { status: "missing" }
  | { status: "found"; attempt: T }
  | { status: "mismatch" }
  | { status: "invalid" }
  | { status: "storage-failed" };

const ORDER_CREATE_ATTEMPT_KEY = "bistro.order-create-attempt";
const ORDER_PAYMENT_ATTEMPT_KEY = "bistro.order-payment-attempt";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function isAttemptPhase(value: unknown): value is StoreAttemptPhase {
  return value === "submitting" || value === "uncertain";
}

function parseOrderCreateAttempt(raw: string): OrderCreateAttempt | null {
  try {
    const value = JSON.parse(raw) as unknown;
    if (
      !isRecord(value) ||
      typeof value.idempotencyKey !== "string" ||
      !value.idempotencyKey.trim() ||
      !isAttemptPhase(value.phase)
    ) {
      return null;
    }
    return { idempotencyKey: value.idempotencyKey, phase: value.phase };
  } catch {
    return null;
  }
}

function parseOrderPaymentAttempt(value: unknown): OrderPaymentAttempt | null {
  if (
    !isRecord(value) ||
    typeof value.orderId !== "string" ||
    !value.orderId.trim() ||
    typeof value.idempotencyKey !== "string" ||
    !value.idempotencyKey.trim() ||
    !isAttemptPhase(value.phase)
  ) {
    return null;
  }
  return {
    orderId: value.orderId,
    idempotencyKey: value.idempotencyKey,
    phase: value.phase,
  };
}

function parseOrderPaymentAttempts(raw: string): OrderPaymentAttempt[] | null {
  try {
    const value = JSON.parse(raw) as unknown;
    const legacyAttempt = parseOrderPaymentAttempt(value);
    if (legacyAttempt) return [legacyAttempt];
    if (!isRecord(value) || !Array.isArray(value.attempts)) return null;

    const attempts: OrderPaymentAttempt[] = [];
    const orderIds = new Set<string>();
    for (const item of value.attempts) {
      const attempt = parseOrderPaymentAttempt(item);
      if (!attempt || orderIds.has(attempt.orderId)) return null;
      attempts.push(attempt);
      orderIds.add(attempt.orderId);
    }
    return attempts;
  } catch {
    return null;
  }
}

function saveExact(key: string, value: unknown): boolean {
  if (typeof window === "undefined") return false;
  try {
    const serialized = JSON.stringify(value);
    window.sessionStorage.setItem(key, serialized);
    return window.sessionStorage.getItem(key) === serialized;
  } catch {
    return false;
  }
}

function clearExact(
  storageKey: string,
  matches: (raw: string) => boolean,
): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.sessionStorage.getItem(storageKey);
    if (!raw || !matches(raw)) return false;
    window.sessionStorage.removeItem(storageKey);
    return window.sessionStorage.getItem(storageKey) === null;
  } catch {
    return false;
  }
}

export function saveOrderCreateAttempt(attempt: OrderCreateAttempt): boolean {
  if (!attempt.idempotencyKey.trim() || !isAttemptPhase(attempt.phase)) return false;
  return saveExact(ORDER_CREATE_ATTEMPT_KEY, attempt);
}

export function loadOrderCreateAttempt(): AttemptLoadResult<OrderCreateAttempt> {
  if (typeof window === "undefined") return { status: "storage-failed" };
  try {
    const raw = window.sessionStorage.getItem(ORDER_CREATE_ATTEMPT_KEY);
    if (!raw) return { status: "missing" };
    const attempt = parseOrderCreateAttempt(raw);
    return attempt ? { status: "found", attempt } : { status: "invalid" };
  } catch {
    return { status: "storage-failed" };
  }
}

export function clearOrderCreateAttempt(expectedIdempotencyKey: string): boolean {
  if (!expectedIdempotencyKey.trim()) return false;
  return clearExact(ORDER_CREATE_ATTEMPT_KEY, (raw) => {
    const attempt = parseOrderCreateAttempt(raw);
    return attempt?.idempotencyKey === expectedIdempotencyKey;
  });
}

export function saveOrderPaymentAttempt(attempt: OrderPaymentAttempt): boolean {
  if (!attempt.orderId.trim() || !attempt.idempotencyKey.trim() || !isAttemptPhase(attempt.phase)) {
    return false;
  }
  if (typeof window === "undefined") return false;
  try {
    const raw = window.sessionStorage.getItem(ORDER_PAYMENT_ATTEMPT_KEY);
    const currentAttempts = raw ? parseOrderPaymentAttempts(raw) : [];
    if (!currentAttempts) return false;
    const nextAttempts = [
      ...currentAttempts.filter((current) => current.orderId !== attempt.orderId),
      attempt,
    ];
    return saveExact(ORDER_PAYMENT_ATTEMPT_KEY, { attempts: nextAttempts });
  } catch {
    return false;
  }
}

export function loadOrderPaymentAttempt(
  expectedOrderId: string,
): AttemptLoadResult<OrderPaymentAttempt> {
  if (typeof window === "undefined") return { status: "storage-failed" };
  try {
    const raw = window.sessionStorage.getItem(ORDER_PAYMENT_ATTEMPT_KEY);
    if (!raw) return { status: "missing" };
    const attempts = parseOrderPaymentAttempts(raw);
    if (!attempts) return { status: "invalid" };
    const attempt = attempts.find((current) => current.orderId === expectedOrderId);
    if (!expectedOrderId.trim() || !attempt) {
      return { status: "mismatch" };
    }
    return { status: "found", attempt };
  } catch {
    return { status: "storage-failed" };
  }
}

export function clearOrderPaymentAttempt(
  expectedOrderId: string,
  expectedIdempotencyKey: string,
): boolean {
  if (!expectedOrderId.trim() || !expectedIdempotencyKey.trim()) return false;
  if (typeof window === "undefined") return false;
  try {
    const raw = window.sessionStorage.getItem(ORDER_PAYMENT_ATTEMPT_KEY);
    if (!raw) return false;
    const attempts = parseOrderPaymentAttempts(raw);
    if (!attempts) return false;
    const expectedAttempt = attempts.find((attempt) => attempt.orderId === expectedOrderId);
    if (expectedAttempt?.idempotencyKey !== expectedIdempotencyKey) return false;

    const remainingAttempts = attempts.filter((attempt) => attempt.orderId !== expectedOrderId);
    if (remainingAttempts.length === 0) {
      window.sessionStorage.removeItem(ORDER_PAYMENT_ATTEMPT_KEY);
      return window.sessionStorage.getItem(ORDER_PAYMENT_ATTEMPT_KEY) === null;
    }

    const serialized = JSON.stringify({ attempts: remainingAttempts });
    window.sessionStorage.setItem(ORDER_PAYMENT_ATTEMPT_KEY, serialized);
    return window.sessionStorage.getItem(ORDER_PAYMENT_ATTEMPT_KEY) === serialized;
  } catch {
    return false;
  }
}
