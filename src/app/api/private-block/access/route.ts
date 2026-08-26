import { NextRequest, NextResponse } from "next/server";
import { apiError, readLimitedJson } from "@/lib/api-security";
import { getRequestId, logError } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import {
  hasPrivateBlockAccessCode,
  PRIVATE_BLOCK_ACCESS_DENIED_CODE,
  PRIVATE_BLOCK_ACCESS_MISSING_CODE,
  verifyPrivateBlockAccessCode,
} from "@/lib/private-block-access";
import { enforceScopedRateLimit } from "@/lib/reservation-rate-limit";
import { getClientIp, hashClientIp } from "@/lib/request-meta";

export const dynamic = "force-dynamic";

const ACCESS_RATE_LIMIT_SCOPE = "PRIVATE_BLOCK_ACCESS";
const ACCESS_RATE_LIMIT_WINDOW_SECONDS = 10 * 60;
const ACCESS_RATE_LIMIT_MAX = 10;

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  const json = await readLimitedJson(request, { requestId, maxBytes: 4 * 1024 });
  if (!json.ok) return json.response;

  if (!hasPrivateBlockAccessCode()) {
    return apiError(503, {
      error: "貸切設定は現在利用できません",
      code: PRIVATE_BLOCK_ACCESS_MISSING_CODE,
      requestId,
    });
  }

  try {
    const allowed = await enforceScopedRateLimit(prisma, {
      keyHash: hashClientIp(getClientIp(request)),
      scope: ACCESS_RATE_LIMIT_SCOPE,
      windowMs: ACCESS_RATE_LIMIT_WINDOW_SECONDS * 1_000,
      limit: ACCESS_RATE_LIMIT_MAX,
    });
    if (!allowed) {
      return apiError(
        429,
        {
          error: "試行回数が上限に達しました。時間をおいて再試行してください。",
          code: "RATE_LIMITED",
          requestId,
        },
        {
          headers: {
            "Cache-Control": "private, no-store",
            "Retry-After": String(ACCESS_RATE_LIMIT_WINDOW_SECONDS),
          },
        },
      );
    }
  } catch (error) {
    logError("private_block.access.rate_limit_failed", {
      requestId,
      route: "/api/private-block/access",
      errorCode: "RATE_LIMIT_CHECK_FAILED",
      context: { message: error instanceof Error ? error.message : String(error) },
    });
    return apiError(
      503,
      {
        error: "貸切設定の確認を一時停止しています。時間をおいて再試行してください。",
        code: "RATE_LIMIT_CHECK_FAILED",
        requestId,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const body = json.body;
  const accessCode =
    typeof body === "object" &&
    body !== null &&
    "accessCode" in body &&
    typeof body.accessCode === "string"
      ? body.accessCode
      : null;

  if (!verifyPrivateBlockAccessCode(accessCode)) {
    return apiError(401, {
      error: "管理用パスコードが正しくありません",
      code: PRIVATE_BLOCK_ACCESS_DENIED_CODE,
      requestId,
    });
  }

  return NextResponse.json(
    { ok: true, requestId },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}
