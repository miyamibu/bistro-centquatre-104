"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Noto_Serif_JP, Tangerine } from "next/font/google";
import {
  loadOrderCompletionReceipt,
  saveOrderCompletionReceipt,
  type OrderCompletionReceipt,
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

function OrderCompleteContent() {
  const searchParams = useSearchParams();
  const orderId = searchParams.get("order_id");
  const [receipt, setReceipt] = useState<OrderCompletionReceipt | null>(null);
  const [receiptState, setReceiptState] = useState<
    "loading" | "loaded" | "missing" | "error"
  >("loading");

  useEffect(() => {
    let cancelled = false;
    const receiptTokenFromHash =
      new URLSearchParams(window.location.hash.replace(/^#/, ""))
        .get("receipt_token")
        ?.trim() ?? "";
    const storedReceipt = (() => {
      try {
        return loadOrderCompletionReceipt(orderId);
      } catch {
        return null;
      }
    })();
    const receiptToken = receiptTokenFromHash || storedReceipt?.receiptToken || "";

    if (!orderId || !receiptToken) {
      setReceipt(null);
      setReceiptState("missing");
      return () => {
        cancelled = true;
      };
    }

    const controller = new AbortController();
    setReceipt(null);
    setReceiptState("loading");
    fetch(`/api/orders/${encodeURIComponent(orderId)}/receipt`, {
      cache: "no-store",
      headers: {
        "X-Order-Receipt-Token": receiptToken,
      },
      referrerPolicy: "no-referrer",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("ORDER_RECEIPT_LOOKUP_FAILED");
        const body = (await response.json()) as Partial<OrderCompletionReceipt>;
        if (
          body.orderId !== orderId ||
          (body.paymentMethod !== "BANK_TRANSFER" && body.paymentMethod !== "PAY_IN_STORE") ||
          (body.storeVisitDate !== null && typeof body.storeVisitDate !== "string") ||
          (body.notificationStatus !== "SENT" && body.notificationStatus !== "PENDING_RETRY")
        ) {
          throw new Error("ORDER_RECEIPT_RESPONSE_INVALID");
        }
        if (cancelled) return;
        const verifiedReceipt: OrderCompletionReceipt = {
          orderId,
          paymentMethod: body.paymentMethod,
          storeVisitDate: body.storeVisitDate ?? null,
          notificationStatus: body.notificationStatus,
          receiptToken,
        };
        const receiptPersisted = saveOrderCompletionReceipt(verifiedReceipt);
        if (receiptTokenFromHash && receiptPersisted) {
          window.history.replaceState(
            null,
            "",
            `${window.location.pathname}${window.location.search}`,
          );
        }
        setReceipt(verifiedReceipt);
        setReceiptState("loaded");
      })
      .catch((error: unknown) => {
        if (cancelled || (error instanceof DOMException && error.name === "AbortError")) return;
        setReceipt(null);
        setReceiptState("error");
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [orderId]);

  const messages = {
    BANK_TRANSFER: {
      title: "ご注文ありがとうございました",
      description:
        "メールで振込先口座情報をお送りいたします。ご入金確認後、商品を発送いたします。ご不明な点がございましたらお気軽にお問い合わせください。",
    },
    PAY_IN_STORE: {
      title: "ご注文ありがとうございました",
      description:
        "ご指定の来店予定日に合わせて商品をご用意してお待ちしております。ご不明な点がございましたらお気軽にお問い合わせください。",
    },
  };

  const normalizedMethod = receipt?.paymentMethod ?? null;
  const message = normalizedMethod
    ? receipt?.notificationStatus === "PENDING_RETRY"
      ? {
          title: "ご注文は確定しています",
          description: "確認メールは再送待ちです。重複注文は不要です。",
        }
      : messages[normalizedMethod]
    : null;

  return (
    <section
      className="relative w-screen bg-gradient-to-b from-[#f7ebd3] via-[#f1ddb5] to-[#e8c98f] px-4 flex items-center"
      style={{
        marginLeft: "calc(50% - 50vw)",
        marginRight: "calc(50% - 50vw)",
        minHeight: "100vh",
        paddingTop: "132px",
        paddingBottom: "140px",
      }}
    >
      <div className="mx-auto max-w-2xl w-full text-center">
        <header className="mb-12">
          <h1
            className={`font-semibold text-[#2f1b0f] ${headingFont.className}`}
            style={{ fontSize: "clamp(2rem, 4vw, 5rem)" }}
          >
            {receiptState === "loaded" && message
              ? message.title
              : receiptState === "loading"
                ? "ご注文完了情報を確認しています"
                : "ご注文完了情報を確認できません"}
          </h1>
        </header>

        <div className={`${bodySerif.className} mb-12 space-y-6`}>
          {receiptState === "loaded" && message && receipt ? (
            <>
              <p className="text-lg leading-relaxed text-[#4a3121]">{message.description}</p>

              <div className="rounded-lg border border-[#2f1b0f] bg-white/60 p-6 text-left">
                <dl className="space-y-3 text-sm text-[#4a3121]">
                  <div>
                    <dt className="font-semibold text-[#2f1b0f]">注文ID</dt>
                    <dd className="mt-1 break-all">{receipt.orderId}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-[#2f1b0f]">支払い方法</dt>
                    <dd className="mt-1">
                      {normalizedMethod === "BANK_TRANSFER" ? "銀行振込" : "来店時支払い"}
                    </dd>
                  </div>
                  {receipt.storeVisitDate ? (
                    <div>
                      <dt className="font-semibold text-[#2f1b0f]">来店予定日</dt>
                      <dd className="mt-1">{receipt.storeVisitDate}</dd>
                    </div>
                  ) : null}
                </dl>
                <p className="mt-5 text-sm text-[#4a3121]">
                  {receipt.notificationStatus === "PENDING_RETRY"
                    ? "ご注文は確定済みです。確認メールは再送待ちのため、重複注文は不要です。"
                    : normalizedMethod === "BANK_TRANSFER"
                    ? "ご注文確認メールをお送りしております。メール内の振込先情報をご確認ください。"
                    : "ご注文確認メールをお送りしております。来店予定日の変更がございましたらお気軽にご連絡ください。"}
                </p>
              </div>
            </>
          ) : (
            <div className="rounded-lg border border-[#cfa96d]/60 bg-white/60 p-6 text-left text-sm leading-7 text-[#4a3121]">
              {receiptState === "loading"
                ? "注文完了情報をサーバーへ照会しています..."
                : receiptState === "missing"
                  ? "注文完了情報の照会tokenが見つかりません。注文を再実行する必要はありません。確認メールまたは店舗へのお問い合わせで注文状況をご確認ください。"
                  : "注文完了情報を照会できませんでした。重複注文は不要です。確認メールまたは店舗へのお問い合わせで注文状況をご確認ください。"}
            </div>
          )}
        </div>

        <Link
          href="/on-line-store"
          className="inline-block py-4 px-8 bg-[#2f1b0f] text-white font-semibold rounded-full hover:brightness-110 transition"
        >
          商品一覧へ戻る
        </Link>
      </div>
    </section>
  );
}

export default function OrderCompletePage() {
  return (
    <Suspense
      fallback={
        <section
          className="relative w-screen bg-gradient-to-b from-[#f7ebd3] via-[#f1ddb5] to-[#e8c98f] px-4 flex items-center"
          style={{
            marginLeft: "calc(50% - 50vw)",
            marginRight: "calc(50% - 50vw)",
            minHeight: "100vh",
          }}
        >
          <div role="status" aria-live="polite" className="mx-auto">
            読み込み中...
          </div>
        </section>
      }
    >
      <OrderCompleteContent />
    </Suspense>
  );
}
