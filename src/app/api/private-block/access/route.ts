import { NextRequest, NextResponse } from "next/server";
import { apiError, enforceWriteRequestSecurity } from "@/lib/api-security";
import { getRequestId } from "@/lib/logger";
import {
  hasPrivateBlockAccessCode,
  PRIVATE_BLOCK_ACCESS_DENIED_CODE,
  PRIVATE_BLOCK_ACCESS_MISSING_CODE,
  verifyPrivateBlockAccessCode,
} from "@/lib/private-block-access";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  const securityError = enforceWriteRequestSecurity(request, { requestId });
  if (securityError) return securityError;

  if (!hasPrivateBlockAccessCode()) {
    return apiError(503, {
      error: "貸切設定は現在利用できません",
      code: PRIVATE_BLOCK_ACCESS_MISSING_CODE,
      requestId,
    });
  }

  const body = await request.json().catch(() => null);
  const accessCode = typeof body?.accessCode === "string" ? body.accessCode : null;

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
