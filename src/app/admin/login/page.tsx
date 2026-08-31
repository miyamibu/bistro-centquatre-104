"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase-client";

type LoginState = "idle" | "submitting" | "recovery-sent" | "error";

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [state, setState] = useState<LoginState>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const isSubmitting = state === "submitting";

  function nextPath() {
    const candidate = new URLSearchParams(window.location.search).get("next");
    return candidate && candidate.startsWith("/") && !candidate.startsWith("//")
      ? candidate
      : "/admin/reservations";
  }

  async function sendPasswordRecovery() {
    const normalizedEmail = email.trim();
    if (!normalizedEmail) {
      setState("error");
      setErrorMessage("メールアドレスを入力してください。");
      return;
    }
    setState("submitting");
    setErrorMessage("");
    const callbackUrl = new URL("/auth/recovery", window.location.origin);
    const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
      redirectTo: callbackUrl.toString(),
    });
    if (error) {
      setState("error");
      setErrorMessage(error.message);
      return;
    }
    setState("recovery-sent");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("submitting");
    setErrorMessage("");
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) throw error;
      router.replace(nextPath() as Parameters<typeof router.replace>[0]);
      router.refresh();
    } catch (error) {
      setState("error");
      setErrorMessage(error instanceof Error ? error.message : "ログインに失敗しました。");
    }
  }

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-md items-center px-4 py-12">
      <section className="card w-full space-y-6 bg-[#fffdfa] p-6 md:p-8" aria-labelledby="admin-login-title">
        <div>
          <p className="text-sm text-[#7a5528]">bistro centquatre 104</p>
          <h1 id="admin-login-title" className="mt-2 text-2xl font-semibold text-[#2f1b0f]">
            管理画面ログイン
          </h1>
        </div>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <label className="block text-sm font-semibold text-[#4a3121]" htmlFor="admin-email">
            メールアドレス
          </label>
          <input
            id="admin-email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="w-full rounded-md border border-[#d8c6ae] bg-white px-3 py-3"
          />
          <label className="block text-sm font-semibold text-[#4a3121]" htmlFor="admin-password">
            パスワード
          </label>
          <input
            id="admin-password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded-md border border-[#d8c6ae] bg-white px-3 py-3"
          />
          <button
            type="submit"
            disabled={isSubmitting}
            className="min-h-11 w-full rounded-full bg-[#7a5528] px-4 py-2 font-semibold text-white disabled:opacity-60"
          >
            {isSubmitting ? "確認中..." : "ログイン"}
          </button>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={sendPasswordRecovery}
            className="min-h-11 w-full rounded-full border border-[#7a5528] bg-white px-4 py-2 font-semibold text-[#7a5528] disabled:opacity-60"
          >
            パスワードを設定・再設定
          </button>
        </form>
        {state === "recovery-sent" ? (
          <p role="status" className="rounded-md bg-[#f4efe8] px-3 py-2 text-sm text-[#4a3121]">
            パスワード設定メールを送信しました。メール内のリンクから続けてください。
          </p>
        ) : null}
        {state === "error" ? (
          <p role="alert" className="rounded-md bg-[#fff1f1] px-3 py-2 text-sm text-[#8f2a2a]">
            {errorMessage}
          </p>
        ) : null}
      </section>
    </main>
  );
}
