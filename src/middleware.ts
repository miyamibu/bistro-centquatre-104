import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { readStaffSessionStartedAt } from "@/lib/staff-session";

const AI_UA_HINTS = [/GPTBot/i, /ChatGPT/i, /OpenAI/i, /Claude/i, /Anthropic/i, /Perplexity/i];
const AGENT_ENTRY_PATH = "/agents";
const PROTECTED_WEB_PREFIXES = ["/admin", "/dashboard", "/staff"] as const;
const PROTECTED_API_PREFIXES = [
  "/api/admin",
  "/api/dashboard",
  // Add "/api/staff" here when staff-only APIs are introduced.
] as const;
const TOKEN_AUTH_API_PATHS = ["/api/admin/backups/reservations/export"] as const;

function matchesProtectedPrefix(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function isProtectedPath(pathname: string) {
  if (TOKEN_AUTH_API_PATHS.includes(pathname as (typeof TOKEN_AUTH_API_PATHS)[number])) {
    return false;
  }

  return (
    PROTECTED_WEB_PREFIXES.some((prefix) => matchesProtectedPrefix(pathname, prefix)) ||
    PROTECTED_API_PREFIXES.some((prefix) => matchesProtectedPrefix(pathname, prefix))
  );
}

function isLoginPath(pathname: string) {
  return pathname === "/admin/login" || pathname.startsWith("/admin/login/");
}

function isStaffEnrollmentPath(pathname: string) {
  return pathname === "/admin/password-reset" || pathname === "/admin/mfa/setup";
}

function copyResponseCookies(source: NextResponse, target: NextResponse) {
  for (const cookie of source.cookies.getAll()) {
    target.cookies.set(cookie);
  }
  return target;
}

function isStaffRole(value: unknown) {
  return value === "ADMIN" || value === "STAFF";
}

function authFailure(
  request: NextRequest,
  response: NextResponse,
  pathname: string,
  code: "UNAUTHORIZED" | "STAFF_ROLE_REQUIRED" | "MFA_REQUIRED" | "SESSION_EXPIRED",
) {
  if (pathname.startsWith("/api/")) {
    return copyResponseCookies(
      response,
      NextResponse.json(
        { error: code === "MFA_REQUIRED" ? "MFA認証が必要です" : "Unauthorized", code },
        { status: code === "UNAUTHORIZED" || code === "SESSION_EXPIRED" ? 401 : 403, headers: { "Cache-Control": "private, no-store" } },
      ),
    );
  }

  const loginUrl = new URL("/admin/login", request.url);
  loginUrl.searchParams.set("error", code.toLowerCase());
  loginUrl.searchParams.set("next", pathname);
  return copyResponseCookies(response, NextResponse.redirect(loginUrl));
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

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const supabaseResponse = NextResponse.next({ request });
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (isProtectedPath(pathname) && !isLoginPath(pathname)) {
    if (!supabaseUrl || !supabaseAnonKey) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json(
          { error: "認証設定が未完了です", code: "AUTH_NOT_CONFIGURED" },
          { status: 503, headers: { "Cache-Control": "no-store" } },
        );
      }
      return NextResponse.redirect(new URL("/admin/login?error=auth_not_configured", request.url));
    }

    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value, options } of cookiesToSet) {
            request.cookies.set(name, value);
            supabaseResponse.cookies.set(name, value, options);
          }
        },
      },
    });

    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      return authFailure(request, supabaseResponse, pathname, "UNAUTHORIZED");
    }

    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    const sessionStartedAt = sessionData.session
      ? readStaffSessionStartedAt(sessionData.session.access_token)
      : null;
    const maxAge = Number(process.env.STAFF_SESSION_MAX_AGE_SECONDS ?? 28800);
    if (
      sessionError ||
      !sessionData.session ||
      sessionStartedAt === null ||
      !Number.isInteger(maxAge) ||
      Math.floor(Date.now() / 1000) - sessionStartedAt > maxAge
    ) {
      await supabase.auth.signOut();
      return authFailure(request, supabaseResponse, pathname, "SESSION_EXPIRED");
    }

    if (!isStaffRole(userData.user.app_metadata?.role)) {
      return authFailure(request, supabaseResponse, pathname, "STAFF_ROLE_REQUIRED");
    }

    if (!isStaffEnrollmentPath(pathname)) {
      const { data: assurance, error: assuranceError } =
        await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (assuranceError || assurance.currentLevel !== "aal2") {
        return authFailure(request, supabaseResponse, pathname, "MFA_REQUIRED");
      }
    }
  }

  if (pathname === "/" && isAiHint(request)) {
    const url = request.nextUrl.clone();
    url.pathname = AGENT_ENTRY_PATH;
    url.searchParams.delete("ai");
    return NextResponse.redirect(url, 307);
  }

  const response = supabaseResponse;
  response.headers.append("Link", `</${AGENT_ENTRY_PATH.slice(1)}>; rel="alternate"; type="text/html"`);
  response.headers.append("Link", "</llms.txt>; rel=\"alternate\"; type=\"text/plain\"");
  response.headers.append("Link", "</api/agent>; rel=\"alternate\"; type=\"application/json\"");
  return response;
}

export const config = {
  // NOTE:
  // - Admin/Dashboard surface is protected by Supabase Auth here and by
  //   role + MFA checks in each server API.
  // - Cron endpoints remain protected inside each route by CRON_SECRET bearer auth.
  // - Staff hub uses the same individual staff session.
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
