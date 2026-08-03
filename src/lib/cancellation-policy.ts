import { env } from "@/lib/env";

export const SELF_SERVICE_CANCELLATION_POLICY_VERSION = "self-service-24h-free-no-auto-fee-v1";
export const SELF_SERVICE_CANCELLATION_CUTOFF_HOURS = 24;

export type CancellationPolicyDecision =
  | { allowed: true; cutoffAt: Date; visitAt: Date }
  | { allowed: false; code: "CANCELLATION_CUTOFF_PASSED" | "CANCELLATION_POLICY_UNAVAILABLE"; cutoffAt?: Date; visitAt?: Date };

function parseJstDateTime(date: string, arrivalTime: string | null | undefined) {
  if (
    !arrivalTime ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(arrivalTime)
  ) {
    return null;
  }
  const parsed = new Date(`${date}T${arrivalTime}:00+09:00`);
  if (Number.isNaN(parsed.getTime())) return null;

  const jstParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(parsed);
  const values = Object.fromEntries(jstParts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}` ===
    `${date}T${arrivalTime}`
    ? parsed
    : null;
}

export function evaluateSelfServiceCancellation(input: {
  date: string;
  arrivalTime: string | null | undefined;
  now?: Date;
}): CancellationPolicyDecision {
  const visitAt = parseJstDateTime(input.date, input.arrivalTime);
  if (!visitAt) return { allowed: false, code: "CANCELLATION_POLICY_UNAVAILABLE" };

  const cutoffAt = new Date(
    visitAt.getTime() - env.SELF_SERVICE_CANCELLATION_CUTOFF_HOURS * 60 * 60 * 1000,
  );
  const now = input.now ?? new Date();
  return now.getTime() < cutoffAt.getTime()
    ? { allowed: true, cutoffAt, visitAt }
    : { allowed: false, code: "CANCELLATION_CUTOFF_PASSED", cutoffAt, visitAt };
}
