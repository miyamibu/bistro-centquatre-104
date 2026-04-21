import { NextRequest } from "next/server";
import { POST as remindPost } from "@/app/api/crons/remind/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return remindPost(request);
}

export async function POST(request: NextRequest) {
  return remindPost(request);
}

