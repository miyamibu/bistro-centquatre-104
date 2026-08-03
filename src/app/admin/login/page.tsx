"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase-client";

type LoginState = "idle" | "submitting" | "mfa" | "error";

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [verifyCode, setVerifyCode] = useState("");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [state, setState] = useState<LoginState>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const isSubmitting = state === "submitting";

  function nextPath() {
    const candidate = new URLSearchParams(window.location.search).get("next");
    return candidate && candidate.startsWith("/") && !candidate.startsWith("//")
      ? candidate
      : "/admin/reservations";
  }

  async function beginMfa() {
    const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors();
    if (factorsError) throw factorsError;
    const factor = factors.totp.find((item) => item.status === "verified");
    if (!factor) {
      throw new Error("MFA未登録です。管理者にTOTP登録を依頼してください。");
    }
    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
      factorId: factor.id,
    });
    if (challengeError) throw challengeError;
    setFactorId(factor.id);
    setChallengeId(challenge.id);
    setState("mfa");
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
      const { data: assurance, error: assuranceError } =
        await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (assuranceError) throw assuranceError;
      if (assurance.nextLevel === "aal2") {
        await beginMfa();
      } else {
        throw new Error("管理アカウントのMFAが必須です。");
      }
    } catch (error) {
      setState("error");
      setErrorMessage(error instanceof Error ? error.message : "ログインに失敗しました。");
    }
  }

  async function handleMfa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!factorId || !challengeId) return;
    setState("submitting");
    setErrorMessage("");
    try {
      const { error } = await supabase.auth.mfa.verify({
        factorId,
        challengeId,
        code: verifyCode.trim(),
      });
      if (error) throw error;
      router.replace(nextPath() as Parameters<typeof router.replace>[0]);
      router.refresh();
    } catch (error) {
      setState("error");
      setErrorMessage(error instanceof Error ? error.message : "認証コードを確認できませんでした。");
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
        {state === "mfa" ? (
          <form className="space-y-4" onSubmit={handleMfa}>
            <label className="block text-sm font-semibold text-[#4a3121]" htmlFor="mfa-code">
              認証アプリの6桁コード
            </label>
            <input
              id="mfa-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              value={verifyCode}
              onChange={(event) => setVerifyCode(event.target.value.replace(/\D/g, ""))}
              className="w-full rounded-md border border-[#d8c6ae] bg-white px-3 py-3 text-lg tracking-[0.35em]"
            />
            <button
              type="submit"
              disabled={isSubmitting}
              className="min-h-11 w-full rounded-full bg-[#7a5528] px-4 py-2 font-semibold text-white disabled:opacity-60"
            >
              {isSubmitting ? "確認中..." : "認証して続ける"}
            </button>
          </form>
        ) : (
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
          </form>
        )}
        {state === "error" ? (
          <p role="alert" className="rounded-md bg-[#fff1f1] px-3 py-2 text-sm text-[#8f2a2a]">
            {errorMessage}
          </p>
        ) : null}
      </section>
    </main>
  );
}
