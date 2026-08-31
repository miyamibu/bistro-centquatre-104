"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase-client";

export default function AuthRecoveryPage() {
  const router = useRouter();
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let active = true;
    let completed = false;

    function continueToPasswordReset() {
      if (!active || completed) return;
      completed = true;
      router.replace("/admin/password-reset" as Parameters<typeof router.replace>[0]);
      router.refresh();
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") && session) {
        continueToPasswordReset();
      }
    });

    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active || completed) return;
      if (error) {
        setErrorMessage("回復セッションを確認できませんでした。新しい回復メールを発行してください。");
        return;
      }
      if (data.session) {
        continueToPasswordReset();
      }
    });

    const timeout = window.setTimeout(() => {
      if (active && !completed) {
        setErrorMessage("回復リンクを確認できませんでした。新しい回復メールを発行してください。");
      }
    }, 10_000);

    return () => {
      active = false;
      window.clearTimeout(timeout);
      subscription.unsubscribe();
    };
  }, [router]);

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
