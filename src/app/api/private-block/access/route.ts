import { NextRequest, NextResponse } from "next/server";
import { apiError, readLimitedJson } from "@/lib/api-security";
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
  const json = await readLimitedJson(request, { requestId, maxBytes: 4 * 1024 });
  if (!json.ok) return json.response;

  if (!hasPrivateBlockAccessCode()) {
    return apiError(503, {
      error: "貸切設定は現在利用できません",
      code: PRIVATE_BLOCK_ACCESS_MISSING_CODE,
      requestId,
    });
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
