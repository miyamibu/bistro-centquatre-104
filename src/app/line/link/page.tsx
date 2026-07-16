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
  enabled?: boolean;
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

  // Lookup flow (no token)
  const [lookupDate, setLookupDate] = useState("");
  const [lookupPhone, setLookupPhone] = useState("");
  const [lookupName, setLookupName] = useState("");
  const [forceLookup, setForceLookup] = useState(false);
  const [customerMode, setCustomerMode] = useState(false);
  const [customerPhone, setCustomerPhone] = useState("");

  const liffIdRef = useRef<string | null>(null);
  const idTokenRef = useRef<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get("t");
    const mode = params.get("mode");
    setToken(t);
    setCustomerMode(mode === "customer");

    // NEXT_PUBLIC_LIFF_LINK_ID is the canonical link LIFF.
    // Fall back to deprecated NEXT_PUBLIC_LIFF_ID during migration.
    const liffId =
      typeof process !== "undefined"
        ? (process.env.NEXT_PUBLIC_LIFF_LINK_ID ?? process.env.NEXT_PUBLIC_LIFF_ID)
        : undefined;
    liffIdRef.current = liffId ?? null;

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
      let body: Record<string, string>;
      const isLookup = forceLookup || !token;
      const endpoint = customerMode
        ? "/api/line/customer-link"
        : "/api/line/link-reservation";
      if (customerMode) {
        body = { phone: customerPhone, lineIdToken };
      } else if (!isLookup) {
        body = { token: token!, phoneLast4: phoneLast4Input, lineIdToken };
      } else {
        body = {
          date: lookupDate,
          phone: lookupPhone,
          nameFragment: lookupName,
          lineIdToken,
        };
      }

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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

  async function handleRevoke() {
    const lineIdToken = idTokenRef.current;
    if (!lineIdToken) {
      setErrorMsg("LINE認証情報が見つかりません。ページを再読み込みしてください。");
      setStep("error");
      return;
    }

    setStep("submitting");
    setErrorMsg(null);

    try {
      const res = await fetch("/api/line/customer-link", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: customerPhone, lineIdToken }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setResult(data.lineNotification ?? {});
        setStep("done");
      } else {
        setErrorMsg(data.error ?? "LINE通知登録を解除できませんでした。入力内容をご確認ください。");
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
    const showLookupFallback = token && !forceLookup;
    return (
      <main className="px-4 py-12 space-y-4 max-w-md mx-auto text-[#4a3121]">
        <p className="text-sm leading-7 text-[#8f2a2a]">
          {errorMsg ?? "エラーが発生しました。"}
        </p>
        {showLookupFallback && (
          <div className="rounded-md border border-[#c9a882] bg-[#fdf6ec] p-4 space-y-3">
            <p className="text-sm leading-6 text-[#6b5644]">
              リンクの有効期限が切れている可能性があります。
              予約日・電話番号・お名前で連携できます。
            </p>
            <button
              type="button"
              onClick={() => {
                setForceLookup(true);
                setErrorMsg(null);
                setStep("confirm");
              }}
              className="w-full rounded-full border border-[#1ec55a] py-2 text-sm font-semibold text-[#1a8a3f]"
            >
              予約情報で連携する
            </button>
          </div>
        )}
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
        <p className="text-lg font-semibold text-[#1a8a3f]">
          {customerMode
            ? result?.enabled === false
              ? "LINE通知登録を解除しました。"
              : "LINE通知登録が完了しました。"
            : "LINE前日通知を設定しました。"}
        </p>
        {result?.immediateReminderSent ? (
          <p className="text-sm text-[#4a3121]">
            ご予約が明日のため、確認メッセージを送信しました。
          </p>
        ) : null}
        <p className="text-sm text-[#6b5644]">
          {customerMode
            ? result?.enabled === false
              ? "今後、この電話番号による通常予約の自動LINE通知は設定されません。"
              : "今後、登録した電話番号で通常予約をした場合は前日にLINEでお知らせします。"
            : "ご予約前日にLINEでお知らせします。"}
        </p>
      </main>
    );
  }

  if (step === "confirm") {
    const isLookup = forceLookup || !token;
    return (
      <main className="px-4 py-12 space-y-6 max-w-md mx-auto text-[#4a3121]">
        <h1 className="text-xl font-semibold">
          {customerMode ? "LINE通知登録" : "LINE前日通知の設定"}
        </h1>

        {customerMode ? (
          <div className="space-y-4">
            <p className="text-sm leading-7">
              予約時に入力する電話番号を登録してください。電話番号そのものは保存せず、照合用のハッシュだけを保存します。今後180日間、その電話番号で通常予約をした場合に、このLINEアカウントへ前日通知を設定します。家族や代理予約など共有の電話番号を使う場合、その予約通知もこのLINEに届くことがあります。
            </p>
            <p className="text-xs leading-6 text-[#6b5644]">
              登録後も、この画面で同じ電話番号を入力して解除できます。
            </p>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="customerPhone">
                電話番号
              </label>
              <input
                id="customerPhone"
                type="tel"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                placeholder="090-1234-5678"
                className="block w-full rounded-md border border-black px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20"
              />
            </div>
          </div>
        ) : !isLookup ? (
          // Token flow: confirm with phone last 4.
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
        ) : (
          // Lookup flow: date + phone + name fragment.
          <div className="space-y-4">
            <p className="text-sm leading-7">
              ご予約情報を入力してLINE通知を設定してください。
            </p>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="date">
                ご予約日 (例: 2026-06-15)
              </label>
              <input
                id="date"
                type="date"
                value={lookupDate}
                onChange={(e) => setLookupDate(e.target.value)}
                className="block w-full rounded-md border border-black px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="phone">
                電話番号
              </label>
              <input
                id="phone"
                type="tel"
                value={lookupPhone}
                onChange={(e) => setLookupPhone(e.target.value)}
                placeholder="090-1234-5678"
                className="block w-full rounded-md border border-black px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="name">
                お名前（一部）
              </label>
              <input
                id="name"
                type="text"
                value={lookupName}
                onChange={(e) => setLookupName(e.target.value)}
                placeholder="例: 田中"
                className="block w-full rounded-md border border-black px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20"
              />
            </div>
          </div>
        )}

        {errorMsg ? (
          <p className="text-sm text-[#8f2a2a]">{errorMsg}</p>
        ) : null}

        <button
          type="button"
          onClick={handleSubmit}
          disabled={isSubmitting}
          className="w-full rounded-full bg-[#1ec55a] py-3 text-sm font-semibold text-white disabled:opacity-60"
        >
          {isSubmitting
            ? "送信中..."
            : customerMode
              ? "同意してLINE通知登録する"
              : "LINE通知を設定する"}
        </button>

        {customerMode ? (
          <button
            type="button"
            onClick={handleRevoke}
            disabled={isSubmitting}
            className="w-full rounded-full border border-[#8f2a2a] py-3 text-sm font-semibold text-[#8f2a2a] disabled:opacity-60"
          >
            LINE通知登録を解除する
          </button>
        ) : null}

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
      <p className="text-sm">読み込み中...</p>
    </main>
  );
}
