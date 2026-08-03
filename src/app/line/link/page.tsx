"use client";

import { useEffect, useRef, useState } from "react";
import { CONTACT_PHONE_DISPLAY, CONTACT_TEL_LINK } from "@/lib/contact";

type Step =
  | "init"
  | "liff_login"
  | "friendship"
  | "confirm"
  | "submitting"
  | "done"
  | "error";

interface LinkResult {
  immediateReminderSent?: boolean;
}

const LIFF_OPERATION_TIMEOUT_MS = 10_000;

function withLiffTimeout<T>(promise: Promise<T>, operation: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`${operation} timed out`));
    }, LIFF_OPERATION_TIMEOUT_MS);

    promise.then(
      (value) => {
        clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeoutId);
        reject(error);
      }
    );
  });
}

export default function LineLinkPage() {
  const [step, setStep] = useState<Step>("init");
  const isSubmitting = step === "submitting";
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [result, setResult] = useState<LinkResult | null>(null);

  // Token flow
  const [token, setToken] = useState<string | null>(null);
  const [phoneLast4Input, setPhoneLast4Input] = useState("");

  const idTokenRef = useRef<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get("t");
    if (!t) {
      setErrorMsg(
        "このLINE連携は予約発行tokenが必要です。予約完了画面の連携リンクから再度お試しください。"
      );
      setStep("error");
      return;
    }
    setToken(t);

    // NEXT_PUBLIC_LIFF_LINK_ID is the canonical link LIFF.
    // Fall back to deprecated NEXT_PUBLIC_LIFF_ID during migration.
    const liffId =
      typeof process !== "undefined"
        ? (process.env.NEXT_PUBLIC_LIFF_LINK_ID ?? process.env.NEXT_PUBLIC_LIFF_ID)
        : undefined;
    if (!liffId) {
      setErrorMsg("LINE連携機能の設定が不足しています。お電話にてお問い合わせください。");
      setStep("error");
      return;
    }

    initLiff(liffId).catch(() => {
      setErrorMsg("LINE連携の初期化に失敗しました。ブラウザを閉じて再度お試しください。");
      setStep("error");
    });
  }, []); // initLiff is intentionally called only once on mount

  async function initLiff(liffId: string) {
    const liffModule = await withLiffTimeout(
      import("@line/liff"),
      "LIFF SDK loading"
    );
    const liff = liffModule.default;
    await withLiffTimeout(liff.init({ liffId }), "LIFF initialization");

    if (!liff.isLoggedIn()) {
      setStep("liff_login");
      liff.login({ redirectUri: window.location.href });
      return;
    }

    // requestFriendship is a LIFF-browser feature. In Safari or another
    // external browser it can leave the page waiting on a subwindow forever.
    if (liff.isInClient() && typeof liff.requestFriendship === "function") {
      try {
        await withLiffTimeout(liff.requestFriendship(), "LINE friendship request");
      } catch {
        // context may not support this — continue
      }
    }

    const friendship = await withLiffTimeout(
      liff.getFriendship(),
      "LINE friendship check"
    );
    if (!friendship?.friendFlag) {
      setErrorMsg(
        "LINE公式アカウントの友だち追加が必要です。QRコードから友だち追加後に再度お試しください。"
      );
      setStep("friendship");
      return;
    }

    const idToken = liff.getIDToken();
    if (!idToken) {
      setErrorMsg("LINE認証情報を取得できませんでした。再度お試しください。");
      setStep("error");
      return;
    }
    idTokenRef.current = idToken;
    setStep("confirm");
  }

  async function handleSubmit() {
    const lineIdToken = idTokenRef.current;
    if (!lineIdToken) {
      setErrorMsg("LINE認証情報が見つかりません。ページを再読み込みしてください。");
      setStep("error");
      return;
    }

    setStep("submitting");
    setErrorMsg(null);

    try {
      const res = await fetch("/api/line/link-reservation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, phoneLast4: phoneLast4Input, lineIdToken }),
      });

      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setResult(data.lineNotification ?? {});
        setStep("done");
      } else {
        setErrorMsg(data.error ?? "予約情報を確認できませんでした。入力内容をご確認ください。");
        setStep("error");
      }
    } catch {
      setErrorMsg("通信エラーが発生しました。お電話にてお問い合わせください。");
      setStep("error");
    }
  }

  if (step === "liff_login") {
    return (
      <main className="px-4 py-12 text-center text-[#4a3121]">
        <p>LINEログイン画面に移動しています...</p>
      </main>
    );
  }

  if (step === "friendship") {
    return (
      <main className="px-4 py-12 space-y-4 max-w-md mx-auto text-[#4a3121]">
        <p className="text-sm leading-7">{errorMsg}</p>
        <p className="text-sm text-[#6b5644]">
          友だち追加後、このページを再度開いてください。
        </p>
        <p className="text-sm">
          お電話:{" "}
          <a className="underline" href={CONTACT_TEL_LINK}>
            {CONTACT_PHONE_DISPLAY}
          </a>
        </p>
      </main>
    );
  }

  if (step === "error") {
    return (
      <main className="px-4 py-12 space-y-4 max-w-md mx-auto text-[#4a3121]">
        <p className="text-sm leading-7 text-[#8f2a2a]">
          {errorMsg ?? "エラーが発生しました。"}
        </p>
        <p className="text-sm">
          お電話:{" "}
          <a className="underline" href={CONTACT_TEL_LINK}>
            {CONTACT_PHONE_DISPLAY}
          </a>
        </p>
      </main>
    );
  }

  if (step === "done") {
    return (
      <main className="px-4 py-12 space-y-4 max-w-md mx-auto text-[#4a3121]">
        <p className="text-lg font-semibold text-[#1a8a3f]">LINE前日通知を設定しました。</p>
        {result?.immediateReminderSent ? (
          <p className="text-sm text-[#4a3121]">
            ご予約が明日のため、確認メッセージを送信しました。
          </p>
        ) : null}
        <p className="text-sm text-[#6b5644]">
          ご予約前日にLINEでお知らせします。
        </p>
      </main>
    );
  }

  if (step === "confirm") {
    return (
      <main className="px-4 py-12 space-y-6 max-w-md mx-auto text-[#4a3121]">
        <h1 className="text-xl font-semibold">LINE前日通知の設定</h1>

        <div className="space-y-4">
          <p className="text-sm leading-7">
            ご予約の電話番号下4桁を入力して連携を確認してください。
          </p>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="phoneLast4">
              電話番号の下4桁
            </label>
            <input
              id="phoneLast4"
              type="text"
              inputMode="numeric"
              maxLength={4}
              value={phoneLast4Input}
              onChange={(e) => setPhoneLast4Input(e.target.value.replace(/\D/g, ""))}
              placeholder="例: 5678"
              className="block w-full rounded-md border border-black px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20"
            />
          </div>
        </div>

        {errorMsg ? (
          <p className="text-sm text-[#8f2a2a]">{errorMsg}</p>
        ) : null}

        <button
          type="button"
          onClick={handleSubmit}
          disabled={isSubmitting}
          className="w-full rounded-full bg-[#1ec55a] py-3 text-sm font-semibold text-white disabled:opacity-60"
        >
          {isSubmitting ? "送信中..." : "LINE通知を設定する"}
        </button>

        <p className="text-xs text-[#6b5644]">
          ご不明な点はお電話にて:{" "}
          <a className="underline" href={CONTACT_TEL_LINK}>
            {CONTACT_PHONE_DISPLAY}
          </a>
        </p>
      </main>
    );
  }

  // step === "init" — loading
  return (
    <main className="px-4 py-12 text-center text-[#6b5644]">
      <p role="status" aria-live="polite" className="text-sm">
        読み込み中...
      </p>
    </main>
  );
}
