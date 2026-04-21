"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Noto_Serif_JP, Tangerine } from "next/font/google";
import {
  clearPendingOrderPaymentSetup,
  loadPendingOrderPaymentSetup,
  type PendingOrderPaymentSetup,
} from "@/lib/store-checkout-session";

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

type PaymentMethod = "BANK_TRANSFER" | "PAY_IN_STORE" | null;

function getStoreDateRange(): { minDate: string; maxDate: string } {
  const today = new Date();
  const minDate = new Date(today);
  minDate.setDate(minDate.getDate() + 14);

  const maxDate = new Date(today);
  maxDate.setDate(maxDate.getDate() + 30);

  return {
    minDate: minDate.toISOString().split("T")[0],
    maxDate: maxDate.toISOString().split("T")[0],
  };
}

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
  const idempotencyKeyRef = useRef<string | null>(null);
  const { minDate, maxDate } = useMemo(() => getStoreDateRange(), []);

  useEffect(() => {
    const setup = loadPendingOrderPaymentSetup(orderId);
    if (!setup) {
      setIsError(true);
      setMessage("本人確認用の注文情報が見つかりません。カートからやり直してください。");
      return;
    }
    setPendingSetup(setup);
    setPaymentMethod(setup.paymentMethod);
    setStoreVisitDate(setup.storeVisitDate ?? "");
  }, [orderId]);

  const handleConfirm = async () => {
    if (!pendingSetup) return;
    if (!paymentMethod) {
      setIsError(true);
      setMessage("支払い方法を選択してください。");
      return;
    }
    if (paymentMethod === "PAY_IN_STORE" && !storeVisitDate) {
      setIsError(true);
      setMessage("来店予定日を選択してください。");
      return;
    }

    setIsSubmitting(true);
    setIsError(false);
    setMessage(null);

    try {
      if (!idempotencyKeyRef.current) {
        idempotencyKeyRef.current =
          typeof globalThis.crypto?.randomUUID === "function"
            ? globalThis.crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      }

      const response = await fetch(`/api/orders/${pendingSetup.orderId}/actions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
          "Idempotency-Key": idempotencyKeyRef.current,
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
      });

      const json = await response.json();
      if (!response.ok) {
        throw new Error(json?.error ?? "本人確認と支払い方法の確定に失敗しました");
      }

      clearPendingOrderPaymentSetup();
      router.push(`/on-line-store/order-complete?method=${paymentMethod}`);
    } catch (error) {
      setIsError(true);
      setMessage(error instanceof Error ? error.message : "本人確認に失敗しました");
    } finally {
      setIsSubmitting(false);
    }
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

        <div className="rounded-3xl border border-[#cfa96d]/40 bg-white/90 p-6 shadow-[0_16px_48px_rgba(47,27,15,0.08)]">
          <div className={`${bodySerif.className} space-y-6 text-[#4a3121]`}>
            <div className="rounded-2xl bg-[#fff7e6] p-4 text-sm">
              <p className="font-semibold text-[#2f1b0f]">注文ID</p>
              <p className="mt-2 break-all">{pendingSetup?.orderId ?? orderId}</p>
            </div>

            <div className="space-y-4">
              <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-[#d7b98a] bg-[#fffaf1] px-4 py-3">
                <input
                  type="radio"
                  name="paymentMethod"
                  checked={paymentMethod === "BANK_TRANSFER"}
                  onChange={() => setPaymentMethod("BANK_TRANSFER")}
                />
                <span>銀行振込</span>
              </label>
              <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-[#d7b98a] bg-[#fffaf1] px-4 py-3">
                <input
                  type="radio"
                  name="paymentMethod"
                  checked={paymentMethod === "PAY_IN_STORE"}
                  onChange={() => setPaymentMethod("PAY_IN_STORE")}
                />
                <span>来店時支払い</span>
              </label>
            </div>

            {paymentMethod === "PAY_IN_STORE" ? (
              <div className="space-y-2">
                <label htmlFor="storeVisitDate" className="block text-sm font-semibold text-[#2f1b0f]">
                  来店予定日
                </label>
                <input
                  id="storeVisitDate"
                  type="date"
                  min={minDate}
                  max={maxDate}
                  value={storeVisitDate}
                  onChange={(event) => setStoreVisitDate(event.target.value)}
                  className="w-full rounded-2xl border border-[#cfa96d]/50 bg-white px-4 py-3 text-[#2f1b0f] focus:border-[#8a6233] focus:outline-none"
                />
                <p className="text-xs text-[#6b4b2d]">来店日は14日後から30日後の営業日を選択してください。</p>
              </div>
            ) : null}

            {message ? (
              <div
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
                disabled={isSubmitting || !pendingSetup}
                className="inline-flex items-center justify-center rounded-full bg-[#2f1b0f] px-6 py-3 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting ? "確定中..." : "本人確認して支払い方法を確定"}
              </button>
              <Link
                href="/on-line-store/cart"
                className="inline-flex items-center justify-center rounded-full border border-[#2f1b0f] px-6 py-3 text-sm font-semibold text-[#2f1b0f] transition hover:bg-white/70"
              >
                カートへ戻る
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function StorePayPage() {
  return (
    <Suspense fallback={<section className="mx-auto p-6">読み込み中...</section>}>
      <PayContent />
    </Suspense>
  );
}
