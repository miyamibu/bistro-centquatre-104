"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase-client";

type Enrollment = {
  factorId: string;
  qrCode: string;
  secret: string;
};

export default function AdminMfaSetupPage() {
  const router = useRouter();
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [verifyCode, setVerifyCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function prepare() {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      const role = userData.user?.app_metadata?.role;
      if (userError || !userData.user || (role !== "ADMIN" && role !== "STAFF")) {
        router.replace("/admin/login?error=staff_role_required");
        return;
      }
      const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors();
      if (factorsError) {
        if (!cancelled) setErrorMessage(factorsError.message);
        if (!cancelled) setLoading(false);
        return;
      }
      if (factors.totp.some((factor) => factor.status === "verified")) {
        router.replace("/admin/login?error=aal2_required&next=/admin/reservations");
        return;
      }
      if (!cancelled) setLoading(false);
    }
    prepare();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function beginEnrollment() {
    setSubmitting(true);
    setErrorMessage("");
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "Bistro Admin",
    });
    if (error) {
      setErrorMessage(error.message);
    } else {
      setEnrollment({
        factorId: data.id,
        qrCode: data.totp.qr_code,
        secret: data.totp.secret,
      });
    }
    setSubmitting(false);
  }

  async function handleVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!enrollment) return;
    setSubmitting(true);
    setErrorMessage("");
    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
      factorId: enrollment.factorId,
    });
    if (challengeError) {
      setSubmitting(false);
      setErrorMessage(challengeError.message);
      return;
    }
    const { error } = await supabase.auth.mfa.verify({
      factorId: enrollment.factorId,
      challengeId: challenge.id,
      code: verifyCode,
    });
    if (error) {
      setSubmitting(false);
      setErrorMessage(error.message);
      return;
    }
    router.replace("/admin/reservations");
    router.refresh();
  }

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-md items-center px-4 py-12">
      <section className="card w-full space-y-6 bg-[#fffdfa] p-6 md:p-8" aria-labelledby="mfa-setup-title">
        <div>
          <p className="text-sm text-[#7a5528]">bistro centquatre 104</p>
          <h1 id="mfa-setup-title" className="mt-2 text-2xl font-semibold text-[#2f1b0f]">
            TOTP MFA登録
          </h1>
          <p className="mt-3 text-sm leading-6 text-[#6b5644]">
            認証アプリでQRコードを読み取り、表示された6桁コードを入力してください。
          </p>
          <p className="mt-2 text-sm leading-6 text-[#6b5644]">
            管理画面を利用するにはTOTP登録と、ログインごとの6桁コード確認が必須です。
          </p>
        </div>
        {loading ? <p role="status">アカウントを確認しています...</p> : null}
        {!loading && !enrollment ? (
          <button
            type="button"
            disabled={submitting}
            onClick={beginEnrollment}
            className="min-h-11 w-full rounded-full bg-[#7a5528] px-4 py-2 font-semibold text-white disabled:opacity-60"
          >
            {submitting ? "準備中..." : "TOTP登録を開始"}
          </button>
        ) : null}
        {enrollment ? (
          <>
            {/* Supabase returns a data URL; CSP allows data: images for this enrollment QR. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={enrollment.qrCode}
              alt="Bistro管理者TOTP登録用QRコード"
              className="mx-auto size-56 rounded-md border border-[#d8c6ae] bg-white p-2"
            />
            <details className="rounded-md border border-[#d8c6ae] bg-white px-3 py-2 text-sm">
              <summary className="cursor-pointer font-semibold text-[#4a3121]">QRコードを読めない場合</summary>
              <p className="mt-2 break-all font-mono text-xs" aria-label="TOTP手動登録キー">
                {enrollment.secret}
              </p>
            </details>
            <form className="space-y-4" onSubmit={handleVerify}>
              <label className="block text-sm font-semibold text-[#4a3121]" htmlFor="mfa-setup-code">
                認証アプリの6桁コード
              </label>
              <input
                id="mfa-setup-code"
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
                disabled={submitting || verifyCode.length !== 6}
                className="min-h-11 w-full rounded-full bg-[#7a5528] px-4 py-2 font-semibold text-white disabled:opacity-60"
              >
                {submitting ? "確認中..." : "MFAを有効化"}
              </button>
            </form>
          </>
        ) : null}
        {errorMessage ? (
          <p role="alert" className="rounded-md bg-[#fff1f1] px-3 py-2 text-sm text-[#8f2a2a]">
            {errorMessage}
          </p>
        ) : null}
      </section>
    </main>
  );
}
