/**
 * POST /api/line/customer-link
 *
 * Legacy phone-only LINE notification registration is intentionally disabled.
 * Reservation linking must use the one-time token issued with a reservation.
 */
import { NextRequest } from "next/server";
import { apiError } from "@/lib/api-security";
import { getRequestId } from "@/lib/logger";

export const dynamic = "force-dynamic";

const CUSTOMER_LINK_REQUIRES_TOKEN = "LINE_CUSTOMER_LINK_REQUIRES_RESERVATION_TOKEN";
const CUSTOMER_LINK_MESSAGE =
  "電話番号だけのLINE通知登録は利用できません。予約発行tokenを含むリンクから設定してください。";

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  return apiError(410, {
    error: CUSTOMER_LINK_MESSAGE,
    code: CUSTOMER_LINK_REQUIRES_TOKEN,
    requestId,
  });
}

export async function DELETE(request: NextRequest) {
  const requestId = getRequestId(request);
  return apiError(410, {
    error: CUSTOMER_LINK_MESSAGE,
    code: CUSTOMER_LINK_REQUIRES_TOKEN,
    requestId,
  });
}
