import type { User } from "@supabase/supabase-js";
import { createSupabaseAuthServerClient } from "@/lib/supabase-auth-server";
import { env } from "@/lib/env";

export const STAFF_ROLES = ["ADMIN", "STAFF"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export type StaffAuth = {
  user: User;
  userId: string;
  email: string | null;
  role: StaffRole;
  aal: "aal2";
};

function getRole(user: User): StaffRole | null {
  const role = user.app_metadata?.role;
  return role === "ADMIN" || role === "STAFF" ? role : null;
}

export function hasStaffRole(role: StaffRole, required: StaffRole) {
  return required === "STAFF" || role === "ADMIN";
}

function readIssuedAt(accessToken: string) {
  try {
    const payload = accessToken.split(".")[1];
    if (!payload) return null;
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      iat?: unknown;
    };
    return typeof parsed.iat === "number" ? parsed.iat : null;
  } catch {
    return null;
  }
}

export async function getStaffAuth(requiredRole: StaffRole = "STAFF"): Promise<StaffAuth | null> {
  try {
    const supabase = await createSupabaseAuthServerClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return null;

    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !sessionData.session) return null;
    const issuedAt = readIssuedAt(sessionData.session.access_token);
    if (
      issuedAt === null ||
      Math.floor(Date.now() / 1000) - issuedAt > env.STAFF_SESSION_MAX_AGE_SECONDS
    ) {
      await supabase.auth.signOut();
      return null;
    }

    const role = getRole(data.user);
    if (!role || !hasStaffRole(role, requiredRole)) return null;

    const { data: assurance, error: assuranceError } =
      await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (assuranceError || assurance.currentLevel !== "aal2") return null;

    return {
      user: data.user,
      userId: data.user.id,
      email: data.user.email ?? null,
      role,
      aal: "aal2",
    };
  } catch {
    return null;
  }
}

export function getStaffRoleFromUser(user: User): StaffRole | null {
  return getRole(user);
}
