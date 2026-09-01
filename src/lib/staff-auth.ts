import type { User } from "@supabase/supabase-js";
import { createSupabaseAuthServerClient } from "@/lib/supabase-auth-server";
import { env } from "@/lib/env";
import { readStaffSessionStartedAt } from "@/lib/staff-session";

export const STAFF_ROLES = ["ADMIN", "STAFF"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export type StaffAuth = {
  user: User;
  userId: string;
  email: string | null;
  role: StaffRole;
};

function getRole(user: User): StaffRole | null {
  const role = user.app_metadata?.role;
  return role === "ADMIN" || role === "STAFF" ? role : null;
}

export function hasStaffRole(role: StaffRole, required: StaffRole) {
  return required === "STAFF" || role === "ADMIN";
}

export async function getStaffAuth(requiredRole: StaffRole = "STAFF"): Promise<StaffAuth | null> {
  try {
    const supabase = await createSupabaseAuthServerClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return null;

    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !sessionData.session) return null;
    const sessionStartedAt = readStaffSessionStartedAt(sessionData.session.access_token);
    if (
      sessionStartedAt === null ||
      Math.floor(Date.now() / 1000) - sessionStartedAt > env.STAFF_SESSION_MAX_AGE_SECONDS
    ) {
      await supabase.auth.signOut();
      return null;
    }

    const { data: assurance, error: assuranceError } =
      await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (assuranceError || assurance.currentLevel !== "aal2") return null;

    const role = getRole(data.user);
    if (!role || !hasStaffRole(role, requiredRole)) return null;

    return {
      user: data.user,
      userId: data.user.id,
      email: data.user.email ?? null,
      role,
    };
  } catch {
    return null;
  }
}

export function getStaffRoleFromUser(user: User): StaffRole | null {
  return getRole(user);
}
