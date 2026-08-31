import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { enforceScopedRateLimit } from "@/lib/reservation-rate-limit";
import { getClientIp, hashClientIp } from "@/lib/request-meta";

export const AVAILABILITY_RATE_LIMIT_WINDOW_SECONDS = 10 * 60;
export const AVAILABILITY_RATE_LIMIT_MAX = 120;

export async function enforceAvailabilityRateLimit(request: NextRequest): Promise<boolean> {
  return enforceScopedRateLimit(prisma, {
    keyHash: hashClientIp(getClientIp(request)),
    scope: "AVAILABILITY_READ",
    windowMs: AVAILABILITY_RATE_LIMIT_WINDOW_SECONDS * 1_000,
    limit: AVAILABILITY_RATE_LIMIT_MAX,
  });
}
