"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { supabase } from "@/lib/supabase-client";

export function StaffLogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function logout() {
    setPending(true);
    await supabase.auth.signOut();
    router.replace("/admin/login" as Route);
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={logout}
      disabled={pending}
      className="min-h-11 rounded-full border border-[#8f2a2a] px-4 py-2 text-sm font-semibold text-[#8f2a2a] disabled:opacity-60"
    >
      {pending ? "ログアウト中..." : "ログアウト"}
    </button>
  );
}
