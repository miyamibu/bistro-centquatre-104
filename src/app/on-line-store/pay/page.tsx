"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Noto_Serif_JP, Tangerine } from "next/font/google";
import {
  clearPendingOrderPaymentSetup,
  loadPendingOrderPaymentSetup,
  restoreAndClearPendingOrderCart,
  saveOrderCompletionReceipt,
  type PendingOrderPaymentSetup,
} from "@/lib/store-checkout-session";
import { formatYen } from "@/lib/store-cart";
import {
  getStoreVisitDateRange,
  validatePayInStoreVisitDate,
} from "@/lib/order-rules";
import { CONTACT_PHONE_DISPLAY, CONTACT_TEL_LINK } from "@/lib/contact";
import {
  canRestorePendingOrderCart,
  classifyPaymentFailure,
  isPendingOrderSetupExpired,
} from "@/lib/store-payment-state";
import {
  clearOrderPaymentAttempt,
  loadOrderPaymentAttempt,
  saveOrderPaymentAttempt,
} from "@/lib/store-attempt-session";

const headingFont = Tangerine({
  subsets: ["latin"],
  weight: ["400", "700"],
  display: "swap",
});

const bodySerif = Noto_Serif_JP({
  subsets: ["latin"],
  weight: ["400", "600"],
});

const pageSpacing = { top: 132, bottom: 140 };
const PAYMENT_CONFIRM_TIMEOUT_MS = 20_000;

type PaymentMethod = "BANK_TRANSFER" | "PAY_IN_STORE" | null;

function PayContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const orderId = searchParams.get("order_id") ?? "";
  const [pendingSetup, setPendingSetup] = useState<PendingOrderPaymentSetup | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(null);
  const [storeVisitDate, setStoreVisitDate] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirmationUncertain, setConfirmationUncertain] = useState(false);
  const [successNavigation, setSuccessNavigation] = useState(false);
  const [storeVisitDateTouched, setStoreVisitDateTouched] = useState(false);
  const [restoreBlocked, setRestoreBlocked] = useState(false);
  const idempotencyKeyRef = useRef<string | null>(null);
  const [storeVisitDateRange, setStoreVisitDateRange] = useState(() => getStoreVisitDateRange());
  const { minDate, maxDate } = storeVisitDateRange;
  const paymentPhase = successNavigation
    ? "success-navigation"
    : confirmationUncertain
      ? "uncertain"
      : isSubmitting
        ? "submitting"
        : "stable";
  const canRestoreCart = canRestorePendingOrderCart({
    requestedOrderId: orderId,
    pendingOrderId: pendingSetup?.orderId,
    phase: paymentPhase,
  });
  const paymentControlsLocked =
    isSubmitting || confirmationUncertain || successNavigation || restoreBlocked;
  const orderItems = pendingSetup?.cartItems ?? [];
  const calculatedCartTotal = orderItems.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0,
  );
  const quotedTotal = pendingSetup?.quotedTotal ?? 0;
  const isSetupReady = Boolean(
    pendingSetup && orderItems.length > 0 && calculatedCartTotal === quotedTotal,
  );
  const storeVisitDateValidation =
    paymentMethod === "PAY_IN_STORE" ? validatePayInStoreVisitDate(storeVisitDate) : null;
  const storeVisitDateError =
    storeVisitDateTouched && storeVisitDateValidation && !storeVisitDateValidation.ok
      ? storeVisitDateValidation.error
      : null;
  const clientClockSuggestsExpiry = Boolean(
    pendingSetup && isPendingOrderSetupExpired(pendingSetup.holdExpiresAt, Date.now()),
  );

  const lockPaymentAsUncertain = (
    setup: PendingOrderPaymentSetup,
    idempotencyKey: string | null,
    uncertainMessage: string,
  ) => {
    if (idempotencyKey) {
      saveOrderPaymentAttempt({
        orderId: setup.orderId,
        idempotencyKey,
        phase: "uncertain",
      });
    }
    setConfirmationUncertain(true);
    setIsError(true);
    setMessage(uncertainMessage);
  };

  const handleRestoreResult = (
    result: ReturnType<typeof restoreAndClearPendingOrderCart>,
    restoredMessage: string,
    missingMessage: string,
  ) => {
    setIsError(true);
    if (result === "restored" || result === "already-restored") {
      setPendingSetup(null);
      setMessage(restoredMessage);
      return;
    }
    if (result === "conflict") {
      setRestoreBlocked(true);
      setMessage(
        "現在のカートには別の商品があります。内容を上書きせず、復元用の注文内容を保持しました。店舗へご確認ください。",
      );
      return;
    }
    if (result === "storage-failed") {
      setRestoreBlocked(true);
      setMessage(
        "カート内容を安全に保存・確認できなかったため、復元用の注文内容を保持しました。この画面から移動せず、店舗へご確認ください。",
      );
      return;
    }
    setPendingSetup(null);
    setMessage(missingMessage);
  };

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setStoreVisitDateRange(getStoreVisitDateRange());
    }, 60_000);

    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    const setup = loadPendingOrderPaymentSetup(orderId);
    if (!setup) {
      setPendingSetup(null);
      setIsError(true);
      setMessage("本人確認用の注文情報が見つかりません。カートからやり直してください。");
      return;
    }

    setPendingSetup(setup);
    setPaymentMethod(setup.paymentMethod);
    setStoreVisitDate(setup.storeVisitDate ?? "");
    const attemptResult = loadOrderPaymentAttempt(orderId);
    if (attemptResult.status === "found") {
      idempotencyKeyRef.current = attemptResult.attempt.idempotencyKey;
      saveOrderPaymentAttempt({
        orderId,
        idempotencyKey: attemptResult.attempt.idempotencyKey,
        phase: "uncertain",
      });
      setConfirmationUncertain(true);
      setIsError(true);
      setMessage(
        "前回の支払い方法確定結果を確認できません。サーバー側で処理された可能性があるため、再送せず店舗へ注文状況をご確認ください。",
      );
    } else if (attemptResult.status === "invalid" || attemptResult.status === "storage-failed") {
      setConfirmationUncertain(true);
      setIsError(true);
      setMessage(
        "支払い方法確定の安全確認情報を読み取れません。重複処理を防ぐため再送せず、店舗へ注文状況をご確認ください。",
      );
    }
  }, [orderId]);

  const handleConfirm = async () => {
    if (!pendingSetup) return;
    if (pendingSetup.orderId !== orderId || paymentControlsLocked) return;
    if (!isSetupReady) {
      setIsError(true);
      setMessage("注文内容を確認できないため、確定できません。カートへ戻ってください。");
      return;
    }
    if (!paymentMethod) {
      setIsError(true);
      setMessage("支払い方法を選択してください。");
      return;
    }
    if (paymentMethod === "PAY_IN_STORE") {
      setStoreVisitDateTouched(true);
      const validation = validatePayInStoreVisitDate(storeVisitDate);
      if (!validation.ok) {
        setIsError(true);
        setMessage(validation.error);
        return;
      }
    }

    setIsError(false);
    setMessage(null);
    let timeoutId: number | null = null;
    let responseStatus: number | null = null;

    try {
      if (!idempotencyKeyRef.current) {
        idempotencyKeyRef.current =
          typeof globalThis.crypto?.randomUUID === "function"
            ? globalThis.crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      }
      const idempotencyKey = idempotencyKeyRef.current;
      if (!idempotencyKey) {
        throw new Error("支払い方法確定キーを作成できません");
      }
      if (
        !saveOrderPaymentAttempt({
          orderId: pendingSetup.orderId,
          idempotencyKey,
          phase: "submitting",
        })
      ) {
        lockPaymentAsUncertain(
          pendingSetup,
          idempotencyKey,
          "支払い方法確定の送信準備を安全に保存できませんでした。重複処理を防ぐため再送せず、店舗へご確認ください。",
        );
        return;
      }

      setIsSubmitting(true);

      const controller = new AbortController();
      timeoutId = window.setTimeout(() => controller.abort(), PAYMENT_CONFIRM_TIMEOUT_MS);
      const response = await fetch(`/api/orders/${pendingSetup.orderId}/actions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          action: "SET_PAYMENT_METHOD",
          expectedVersion: pendingSetup.expectedVersion,
          payload: {
            paymentMethod,
            storeVisitDate: paymentMethod === "PAY_IN_STORE" ? storeVisitDate : undefined,
            humanToken: pendingSetup.humanToken,
          },
        }),
        signal: controller.signal,
      });
      responseStatus = response.status;

      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        const code = typeof json?.code === "string" ? json.code : "";
        const failureClassification = classifyPaymentFailure(response.status, code);
        if (failureClassification === "expired") {
          if (!clearOrderPaymentAttempt(pendingSetup.orderId, idempotencyKey)) {
            lockPaymentAsUncertain(
              pendingSetup,
              idempotencyKey,
              "注文の期限切れは確認できましたが、安全確認情報を解除できません。再送せず店舗へご確認ください。",
            );
            return;
          }
          idempotencyKeyRef.current = null;
          handleRestoreResult(
            restoreAndClearPendingOrderCart(orderId),
            "注文を続けられないため、カートの内容を復元しました。もう一度お試しください。",
            "注文を続けられません。カートからもう一度お試しください。",
          );
          return;
        }
        if (failureClassification === "uncertain") {
          lockPaymentAsUncertain(
            pendingSetup,
            idempotencyKey,
            "支払い方法確定の状態を確認できません。サーバー側で処理された可能性があります。注文番号を控え、再送せず店舗へ注文状況をご確認ください。",
          );
          return;
        }
        if (!clearOrderPaymentAttempt(pendingSetup.orderId, idempotencyKey)) {
          lockPaymentAsUncertain(
            pendingSetup,
            idempotencyKey,
            "支払い方法確定の安全確認情報を解除できません。重複処理を防ぐため再送せず、店舗へご確認ください。",
          );
          return;
        }
        idempotencyKeyRef.current = null;
        throw new Error(json?.error ?? "本人確認と支払い方法の確定に失敗しました");
      }

      const confirmedOrderId = typeof json?.order?.id === "string" ? json.order.id : "";
      if (confirmedOrderId !== pendingSetup.orderId) {
        throw new Error("注文番号を確認できないため、完了画面へ進めません");
      }

      const notificationStatus = json?.notification?.status;
      if (notificationStatus !== "SENT" && notificationStatus !== "PENDING_RETRY") {
        throw new Error("注文確定結果を確認できないため、完了画面へ進めません");
      }
      // The server-backed receipt is authoritative; browser storage is only a convenience.
      saveOrderCompletionReceipt({
        orderId: confirmedOrderId,
        paymentMethod,
        storeVisitDate: paymentMethod === "PAY_IN_STORE" ? storeVisitDate : null,
        notificationStatus,
        receiptToken: pendingSetup.receiptToken,
      });
      const pendingSetupCleared = clearPendingOrderPaymentSetup(confirmedOrderId);
      if (pendingSetupCleared) {
        clearOrderPaymentAttempt(confirmedOrderId, idempotencyKey);
      }
      idempotencyKeyRef.current = null;
      setSuccessNavigation(true);
      router.push(
        `/on-line-store/order-complete?order_id=${encodeURIComponent(confirmedOrderId)}#receipt_token=${encodeURIComponent(pendingSetup.receiptToken)}`
      );
    } catch (error) {
      setIsError(true);
      const isRetryableHttpError =
        responseStatus !== null &&
        responseStatus >= 400 &&
        responseStatus < 500 &&
        responseStatus !== 409;
      if (!isRetryableHttpError) {
        lockPaymentAsUncertain(
          pendingSetup,
          idempotencyKeyRef.current,
          error instanceof DOMException && error.name === "AbortError"
            ? "通信がタイムアウトしました。サーバー側で処理された可能性があります。注文番号を控え、再送せず店舗へ注文状況をご確認ください。"
            : "通信または注文確定結果の確認に失敗しました。サーバー側で処理された可能性があります。注文番号を控え、再送せず店舗へ注文状況をご確認ください。",
        );
      } else {
        setMessage(error instanceof Error ? error.message : "本人確認に失敗しました");
      }
    } finally {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      setIsSubmitting(false);
    }
  };

  const handleReturnToCart = () => {
    if (!canRestoreCart || pendingSetup?.orderId !== orderId) return;
    const result = restoreAndClearPendingOrderCart(orderId);
    if (result === "restored" || result === "already-restored") {
      router.push("/on-line-store/cart");
      return;
    }
    handleRestoreResult(
      result,
      "カートの内容を復元しました。",
      "復元用の注文内容が見つかりません。カートからもう一度お試しください。",
    );
  };

  return (
    <section
      className="relative w-screen bg-gradient-to-b from-[#f7ebd3] via-[#f1ddb5] to-[#e8c98f] px-4"
      style={{
        marginLeft: "calc(50% - 50vw)",
        marginRight: "calc(50% - 50vw)",
        minHeight: "100dvh",
        paddingTop: `${pageSpacing.top}px`,
        paddingBottom: `${pageSpacing.bottom}px`,
      }}
    >
      <div className="mx-auto max-w-3xl">
        <header className="mb-10 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#8a6233]">
            Final Human Step
          </p>
          <h1
            className={`font-semibold text-[#2f1b0f] ${headingFont.className}`}
            style={{ fontSize: "clamp(2rem, 4vw, 5rem)" }}
          >
            お支払い方法の確定
          </h1>
          <p className={`${bodySerif.className} mx-auto mt-4 max-w-2xl text-sm leading-7 text-[#4a3121]`}>
            最後にご本人が内容を確認し、支払い方法を確定してください。この操作で本人確認トークンも同時に消費されます。
          </p>
        </header>

        <div
          aria-busy={isSubmitting}
          className="rounded-3xl border border-[#cfa96d]/40 bg-white/90 p-6 shadow-[0_16px_48px_rgba(47,27,15,0.08)]"
        >
          <div className={`${bodySerif.className} space-y-6 text-[#4a3121]`}>
            <p className="sr-only" role="status" aria-live="polite">
              {isSubmitting
                ? "支払い方法を確定しています"
                : successNavigation
                  ? "注文完了画面へ移動しています"
                  : ""}
            </p>
            <div className="rounded-2xl bg-[#fff7e6] p-4 text-sm">
              <p className="font-semibold text-[#2f1b0f]">注文ID</p>
              <p className="mt-2 break-all">{pendingSetup?.orderId ?? orderId}</p>
            </div>

            {orderItems.length > 0 ? (
              <section
                aria-labelledby="pay-order-summary-title"
                className="rounded-2xl border border-[#d7b98a] bg-white p-4"
              >
                <h2 id="pay-order-summary-title" className="font-semibold text-[#2f1b0f]">
                  ご注文内容
                </h2>
                <ul className="mt-3 divide-y divide-[#d7b98a]/50">
                  {orderItems.map((item) => (
                    <li
                      key={item.id}
                      className="flex items-start justify-between gap-4 py-3 text-sm"
                    >
                      <span>
                        {item.name} × {item.quantity}
                      </span>
                      <span className="shrink-0 font-semibold text-[#2f1b0f]">
                        {formatYen(item.price * item.quantity)}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="mt-3 flex items-center justify-between border-t border-[#2f1b0f]/20 pt-4">
                  <span className="font-semibold text-[#2f1b0f]">合計</span>
                  <strong className="text-lg text-[#2f1b0f]">{formatYen(quotedTotal)}</strong>
                </div>
              </section>
            ) : null}

            {clientClockSuggestsExpiry ? (
              <p className="rounded-2xl border border-[#cfa96d] bg-[#fff7e6] px-4 py-3 text-sm font-semibold text-[#6b4b2d]">
                端末時刻では確認期限を過ぎている可能性があります。確定時にサーバーで最新状態を確認します。
              </p>
            ) : null}

            <fieldset className="space-y-4">
              <legend className="sr-only">支払い方法</legend>
              <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-[#d7b98a] bg-[#fffaf1] px-4 py-3">
                <input
                  id="pay-bank-transfer"
                  type="radio"
                  name="paymentMethod"
                  required
                  checked={paymentMethod === "BANK_TRANSFER"}
                  disabled={paymentControlsLocked}
                  onChange={() => {
                    idempotencyKeyRef.current = null;
                    setPaymentMethod("BANK_TRANSFER");
                    setStoreVisitDateTouched(false);
                    setMessage(null);
                    setIsError(false);
                  }}
                  className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2f1b0f] focus-visible:ring-offset-2 focus-visible:ring-offset-[#fffaf1]"
                />
                <span>銀行振込</span>
              </label>
              <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-[#d7b98a] bg-[#fffaf1] px-4 py-3">
                <input
                  id="pay-in-store"
                  type="radio"
                  name="paymentMethod"
                  checked={paymentMethod === "PAY_IN_STORE"}
                  disabled={paymentControlsLocked}
                  onChange={() => {
                    idempotencyKeyRef.current = null;
                    setPaymentMethod("PAY_IN_STORE");
                    setStoreVisitDateTouched(false);
                    setMessage(null);
                    setIsError(false);
                  }}
                  className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2f1b0f] focus-visible:ring-offset-2 focus-visible:ring-offset-[#fffaf1]"
                />
                <span>来店時支払い</span>
              </label>
            </fieldset>

            {paymentMethod === "PAY_IN_STORE" ? (
              <div className="space-y-2">
                <label htmlFor="pay-store-visit-date" className="block text-sm font-semibold text-[#2f1b0f]">
                  来店予定日
                </label>
                <input
                  id="pay-store-visit-date"
                  type="date"
                  min={minDate}
                  max={maxDate}
                  required
                  disabled={paymentControlsLocked}
                  value={storeVisitDate}
                  onChange={(event) => {
                    idempotencyKeyRef.current = null;
                    setStoreVisitDate(event.target.value);
                    setMessage(null);
                    setIsError(false);
                  }}
                  onBlur={() => setStoreVisitDateTouched(true)}
                  aria-invalid={storeVisitDateError ? true : undefined}
                  aria-describedby={
                    storeVisitDateError
                      ? "pay-store-visit-date-help pay-store-visit-date-error"
                      : "pay-store-visit-date-help"
                  }
                  className="w-full rounded-2xl border border-[#cfa96d]/50 bg-white px-4 py-3 text-[#2f1b0f] focus:border-[#8a6233] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2f1b0f] focus-visible:ring-offset-2"
                />
                <p id="pay-store-visit-date-help" className="text-xs text-[#6b4b2d]">来店日は14日後から30日後の営業日を選択してください。</p>
                {storeVisitDateError ? (
                  <p id="pay-store-visit-date-error" role="alert" className="text-sm font-semibold text-[#842029]">
                    {storeVisitDateError}
                  </p>
                ) : null}
              </div>
            ) : null}

            {message ? (
              <div
                role={isError ? "alert" : "status"}
                aria-live={isError ? "assertive" : "polite"}
                className={`rounded-2xl px-4 py-3 text-sm ${
                  isError ? "bg-[#f8d7da] text-[#842029]" : "bg-[#e9f7ef] text-[#14532d]"
                }`}
              >
                {message}
              </div>
            ) : null}

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={handleConfirm}
                disabled={
                  isSubmitting ||
                  confirmationUncertain ||
                  successNavigation ||
                  !isSetupReady ||
                  !paymentMethod ||
                  restoreBlocked
                }
                className="inline-flex items-center justify-center rounded-full bg-[#2f1b0f] px-6 py-3 text-sm font-semibold text-white transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2f1b0f] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting ? "確定中..." : "本人確認して支払い方法を確定"}
              </button>
              {confirmationUncertain ? (
                <p className="basis-full text-sm font-semibold leading-6 text-[#842029]">
                  注文番号「{pendingSetup?.orderId ?? orderId}」を控え、再送せず店舗へご確認ください：
                  <a className="ml-1 rounded-sm underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2f1b0f] focus-visible:ring-offset-2" href={CONTACT_TEL_LINK}>
                    {CONTACT_PHONE_DISPLAY}
                  </a>
                  <Link className="ml-3 rounded-sm underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2f1b0f] focus-visible:ring-offset-2" href="/">
                    ホームへ戻る
                  </Link>
                </p>
              ) : null}
              {canRestoreCart && pendingSetup?.orderId === orderId ? (
                <Link
                  href="/on-line-store/cart"
                  onClick={(event) => {
                    event.preventDefault();
                    handleReturnToCart();
                  }}
                  className="inline-flex items-center justify-center rounded-full border border-[#2f1b0f] px-6 py-3 text-sm font-semibold text-[#2f1b0f] transition hover:bg-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2f1b0f] focus-visible:ring-offset-2"
                >
                  カートへ戻る（内容を復元）
                </Link>
              ) : !pendingSetup || pendingSetup.orderId !== orderId ? (
                <Link
                  href="/on-line-store/cart"
                  className="inline-flex items-center justify-center rounded-full border border-[#2f1b0f] px-6 py-3 text-sm font-semibold text-[#2f1b0f] transition hover:bg-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2f1b0f] focus-visible:ring-offset-2"
                >
                  カートへ戻る
                </Link>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function StorePayPage() {
  return (
    <Suspense
      fallback={
        <section role="status" aria-live="polite" className="mx-auto p-6">
          読み込み中...
        </section>
      }
    >
      <PayContent />
    </Suspense>
  );
}
