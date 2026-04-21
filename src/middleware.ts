import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { isAuthorized, unauthorized } from "@/lib/basic-auth";

const AI_UA_HINTS = [/GPTBot/i, /ChatGPT/i, /OpenAI/i, /Claude/i, /Anthropic/i, /Perplexity/i];
const AGENT_ENTRY_PATH = "/agents";
const PROTECTED_WEB_PREFIXES = ["/admin", "/dashboard", "/staff"] as const;
const PROTECTED_API_PREFIXES = [
  "/api/admin",
  "/api/dashboard",
  // Add "/api/staff" here when staff-only APIs are introduced.
] as const;

function matchesProtectedPrefix(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function isProtectedPath(pathname: string) {
  return (
    PROTECTED_WEB_PREFIXES.some((prefix) => matchesProtectedPrefix(pathname, prefix)) ||
    PROTECTED_API_PREFIXES.some((prefix) => matchesProtectedPrefix(pathname, prefix))
  );
}

function isAiHint(request: NextRequest) {
  const accept = request.headers.get("accept") ?? "";
  const userAgent = request.headers.get("user-agent") ?? "";

  const acceptHint =
    accept.includes("text/markdown") ||
    accept.includes("text/plain") ||
    accept.includes("application/json");

  const explicitHint =
    request.headers.get("x-ai-agent") === "1" ||
    request.nextUrl.searchParams.get("ai") === "1";

  const uaHintEnabled = process.env.AI_UA_REDIRECT === "1";
  const uaHint = uaHintEnabled && AI_UA_HINTS.some((pattern) => pattern.test(userAgent));

  return explicitHint || acceptHint || uaHint;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isProtectedPath(pathname) && !isAuthorized(request)) {
    return unauthorized();
  }

  if (pathname === "/" && isAiHint(request)) {
    const url = request.nextUrl.clone();
    url.pathname = AGENT_ENTRY_PATH;
    url.searchParams.delete("ai");
    return NextResponse.redirect(url, 307);
  }

  const response = NextResponse.next();
  response.headers.append("Link", `</${AGENT_ENTRY_PATH.slice(1)}>; rel="alternate"; type="text/html"`);
  response.headers.append("Link", "</llms.txt>; rel=\"alternate\"; type=\"text/plain\"");
  response.headers.append("Link", "</api/agent>; rel=\"alternate\"; type=\"application/json\"");
  return response;
}

export const config = {
  // NOTE:
  // - Admin/Dashboard surface is protected by Basic auth here.
  // - Cron endpoints remain protected inside each route by CRON_SECRET bearer auth.
  // - Staff hub is protected with the same Basic auth until dedicated auth is introduced.
  // - Next 16 compatibility: if middleware file naming moves to proxy.ts,
  //   keep this matcher/auth logic unchanged and relocate with a file rename only.
  matcher: [
    "/",
    "/admin/:path*",
    "/dashboard/:path*",
    "/staff/:path*",
    "/api/admin/:path*",
    "/api/dashboard/:path*",
    // Add "/api/staff/:path*" when staff-only APIs are introduced.
  ],
};
