"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase-client";

export default function AdminPasswordResetPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password.length < 12) {
      setErrorMessage("パスワードは12文字以上にしてください。");
      return;
    }
    if (password !== confirmation) {
      setErrorMessage("確認用パスワードが一致しません。");
      return;
    }
    setSubmitting(true);
    setErrorMessage("");
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setSubmitting(false);
      setErrorMessage(error.message);
      return;
    }
    router.replace("/admin/login" as Parameters<typeof router.replace>[0]);
    router.refresh();
  }

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-md items-center px-4 py-12">
      <section className="card w-full space-y-6 bg-[#fffdfa] p-6 md:p-8" aria-labelledby="password-reset-title">
        <div>
          <p className="text-sm text-[#7a5528]">bistro centquatre 104</p>
          <h1 id="password-reset-title" className="mt-2 text-2xl font-semibold text-[#2f1b0f]">
            管理者パスワード設定
          </h1>
        </div>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <label className="block text-sm font-semibold text-[#4a3121]" htmlFor="new-password">
            新しいパスワード（12文字以上）
          </label>
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            minLength={12}
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded-md border border-[#d8c6ae] bg-white px-3 py-3"
          />
          <label className="block text-sm font-semibold text-[#4a3121]" htmlFor="confirm-password">
            新しいパスワード（確認）
          </label>
          <input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            minLength={12}
            required
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            className="w-full rounded-md border border-[#d8c6ae] bg-white px-3 py-3"
          />
          <button
            type="submit"
            disabled={submitting}
            className="min-h-11 w-full rounded-full bg-[#7a5528] px-4 py-2 font-semibold text-white disabled:opacity-60"
          >
            {submitting ? "設定中..." : "パスワードを設定してログインへ"}
          </button>
        </form>
        {errorMessage ? (
          <p role="alert" className="rounded-md bg-[#fff1f1] px-3 py-2 text-sm text-[#8f2a2a]">
            {errorMessage}
          </p>
        ) : null}
      </section>
    </main>
  );
}
