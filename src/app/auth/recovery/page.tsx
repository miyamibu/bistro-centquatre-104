"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase-client";

export default function AuthRecoveryPage() {
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let active = true;

    async function establishRecoverySession() {
      const fragment = new URLSearchParams(window.location.hash.slice(1));
      const accessToken = fragment.get("access_token");
      const refreshToken = fragment.get("refresh_token");
      const isRecovery = fragment.get("type") === "recovery";

      if (window.location.hash) {
        window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
      }

      const result =
        isRecovery && accessToken && refreshToken
          ? await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
          : await supabase.auth.getSession();

      if (!active) return;
      if (result.error || !result.data.session) {
        setErrorMessage("回復セッションを確認できませんでした。新しい回復メールを発行してください。");
        return;
      }

      window.location.replace("/admin/password-reset");
    }

    void establishRecoverySession().catch(() => {
      if (active) {
        setErrorMessage("回復リンクを確認できませんでした。新しい回復メールを発行してください。");
      }
    });

    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-md items-center px-4 py-12">
      <section className="card w-full space-y-4 bg-[#fffdfa] p-6 text-center md:p-8" aria-live="polite">
        <h1 className="text-2xl font-semibold text-[#2f1b0f]">回復リンクを確認しています</h1>
        {errorMessage ? (
          <p role="alert" className="rounded-md bg-[#fff1f1] px-3 py-2 text-sm text-[#8f2a2a]">
            {errorMessage}
          </p>
        ) : (
          <p role="status" className="text-sm text-[#6b5644]">
            パスワード設定画面へ移動します...
          </p>
        )}
      </section>
    </main>
  );
}
