"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Noto_Serif_JP, Tangerine } from "next/font/google";
import {
  clearCart,
  formatYen,
  getCartItems,
  removeFromCart,
  restoreCartItems,
  type StoreCartItem,
} from "@/lib/store-cart";
import {
  loadPendingOrderPaymentSetup,
  parseServerConfirmedCartItems,
  savePendingOrderPaymentSetup,
} from "@/lib/store-checkout-session";
import { getPublishedStoreProduct } from "@/lib/store-products";
import {
  getStoreVisitDateRange,
  getPayInStoreVisitDateLiveError,
} from "@/lib/order-rules";
import { CONTACT_PHONE_DISPLAY, CONTACT_TEL_LINK } from "@/lib/contact";
import { validateStoreCheckout } from "@/lib/store-checkout-validation";
import {
  clearOrderCreateAttempt,
  loadOrderCreateAttempt,
  saveOrderCreateAttempt,
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
const menuHeadingSize = { base: 32, md: 60 };
const ORDER_CREATE_TIMEOUT_MS = 20_000;

type PaymentMethod = "BANK_TRANSFER" | "PAY_IN_STORE" | null;

interface CustomerInfo {
  name: string;
  email: string;
  phone: string;
  zipCode: string;
  prefecture: string;
  city: string;
  address: string;
  building: string;
}

const prefectures = [
  "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県",
  "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県",
  "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県",
  "静岡県", "愛知県", "三重県", "滋賀県", "京都府", "大阪府", "兵庫県",
  "奈良県", "和歌山県", "鳥取県", "島根県", "岡山県", "広島県", "山口県",
  "徳島県", "香川県", "愛媛県", "高知県", "福岡県", "佐賀県", "長崎県",
  "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県",
];

function normalizeCartItems(rawItems: StoreCartItem[]): StoreCartItem[] {
  return rawItems.flatMap((item) => {
    const product = getPublishedStoreProduct(item.id);
    if (!product || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99) {
      return [];
    }

    return [
      {
        id: product.id,
        name: product.name,
        price: product.priceYen,
        image: product.image,
        quantity: item.quantity,
      },
    ];
  });
}

const orderFieldLabels: Record<string, string> = {
  "customerInfo.name": "お名前",
  "customerInfo.email": "メールアドレス",
  "customerInfo.phone": "電話番号",
  "customerInfo.zipCode": "郵便番号",
  "customerInfo.prefecture": "都道府県",
  "customerInfo.city": "市区町村",
  "customerInfo.address": "番地",
  "customerInfo.building": "建物名・部屋番号",
  paymentMethod: "支払い方法",
  storeVisitDate: "来店予定日",
  items: "商品",
  total: "合計金額",
  root: "注文内容",
};

const checkoutFieldOrder = [
  "customerInfo.name",
  "customerInfo.email",
  "customerInfo.phone",
  "customerInfo.zipCode",
  "customerInfo.prefecture",
  "customerInfo.city",
  "customerInfo.address",
  "customerInfo.building",
  "paymentMethod",
  "storeVisitDate",
] as const;

const checkoutFieldIds: Record<string, string> = {
  "customerInfo.name": "customer-name",
  "customerInfo.email": "customer-email",
  "customerInfo.phone": "customer-phone",
  "customerInfo.zipCode": "customer-zip-code",
  "customerInfo.prefecture": "customer-prefecture",
  "customerInfo.city": "customer-city",
  "customerInfo.address": "customer-address",
  "customerInfo.building": "customer-building",
  paymentMethod: "payment-bank-transfer",
  storeVisitDate: "store-visit-date",
};

function parseFieldErrors(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};

  return Object.entries(value).reduce<Record<string, string>>((errors, [key, message]) => {
    if (typeof message === "string" && message.trim()) {
      errors[key] = message;
    }
    return errors;
  }, {});
}

function StoreCartFallback() {
  return (
    <section
      className="relative w-screen bg-gradient-to-b from-[#f7ebd3] via-[#f1ddb5] to-[#e8c98f] px-4"
      style={{
        marginLeft: "calc(50% - 50vw)",
        marginRight: "calc(50% - 50vw)",
        paddingTop: `${pageSpacing.top}px`,
        paddingBottom: `${pageSpacing.bottom}px`,
      }}
    >
      <div className="mx-auto max-w-4xl">
        <p role="status" aria-live="polite" className={`${bodySerif.className} text-sm text-[#4a3121]`}>
          読み込み中...
        </p>
      </div>
    </section>
  );
}

function StoreCartContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isAgentMode = searchParams.get("mode") === "agent";
  const [items, setItems] = useState<StoreCartItem[]>([]);
  const [isCheckout, setIsCheckout] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(null);
  const [storeVisitDate, setStoreVisitDate] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [orderSubmissionUncertain, setOrderSubmissionUncertain] = useState(false);
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo>({
    name: "",
    email: "",
    phone: "",
    zipCode: "",
    prefecture: "",
    city: "",
    address: "",
    building: "",
  });
  const orderIdempotencyKeyRef = useRef<string | null>(null);
  const storeVisitDateRef = useRef<HTMLInputElement>(null);

  const [storeVisitDateRange, setStoreVisitDateRange] = useState(() => getStoreVisitDateRange());
  const { minDate, maxDate } = storeVisitDateRange;
  const checkoutLocked = isLoading || orderSubmissionUncertain;

  const lockOrderCreationAsUncertain = (idempotencyKey: string | null, message: string) => {
    if (idempotencyKey) {
      saveOrderCreateAttempt({ idempotencyKey, phase: "uncertain" });
    }
    setOrderSubmissionUncertain(true);
    setSubmitError(true);
    setSubmitMessage(message);
  };

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setStoreVisitDateRange(getStoreVisitDateRange());
    }, 60_000);

    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    const normalizedItems = normalizeCartItems(getCartItems());
    setItems(normalizedItems);
    restoreCartItems(normalizedItems);
  }, []);

  useEffect(() => {
    const attemptResult = loadOrderCreateAttempt();
    if (attemptResult.status === "missing") return;

    setIsCheckout(true);
    if (attemptResult.status === "found") {
      orderIdempotencyKeyRef.current = attemptResult.attempt.idempotencyKey;
      saveOrderCreateAttempt({
        idempotencyKey: attemptResult.attempt.idempotencyKey,
        phase: "uncertain",
      });
    }
    setOrderSubmissionUncertain(true);
    setSubmitError(true);
    setSubmitMessage(
      "前回の注文処理結果を確認できません。注文が作成されている可能性があるため、再送せず店舗へ注文状況をご確認ください。",
    );
  }, []);

  const total = useMemo(
    () => items.reduce((sum, item) => sum + item.price * item.quantity, 0),
    [items],
  );
  const storeVisitDateError =
    paymentMethod === "PAY_IN_STORE"
      ? getPayInStoreVisitDateLiveError(storeVisitDate, storeVisitDateRange)
      : null;

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    orderIdempotencyKeyRef.current = null;
    setSubmitMessage(null);
    setSubmitError(false);
    setCustomerInfo((prev) => ({ ...prev, [name]: value }));
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next[name];
      delete next[`customerInfo.${name}`];
      return next;
    });
  };

  const focusFirstInvalid = (errors: Record<string, string>) => {
    const firstInvalidField = checkoutFieldOrder.find((field) => errors[field]);
    if (!firstInvalidField) return;

    window.requestAnimationFrame(() => {
      const element = document.getElementById(checkoutFieldIds[firstInvalidField]);
      if (!(element instanceof HTMLElement)) return;
      element.focus({ preventScroll: true });
      element.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  const getFieldError = (field: string) =>
    fieldErrors[field] ??
    (field.startsWith("customerInfo.") ? fieldErrors[field.slice("customerInfo.".length)] : undefined);

  const validateForm = (): Record<string, string> => {
    return validateStoreCheckout({ customerInfo, paymentMethod, storeVisitDate });
  };

  const handleSubmitOrder = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const validationErrors = validateForm();
    if (Object.keys(validationErrors).length > 0) {
      const firstMessage = checkoutFieldOrder
        .map((field) => validationErrors[field])
        .find((message): message is string => Boolean(message));
      setFieldErrors(validationErrors);
      setSubmitError(true);
      setSubmitMessage(firstMessage ?? "入力内容を確認してください");
      focusFirstInvalid(validationErrors);
      return;
    }

    setSubmitError(false);
    setSubmitMessage(null);
    setFieldErrors({});
    let timeoutId: number | null = null;
    let responseStatus: number | null = null;
    try {
      if (!orderIdempotencyKeyRef.current) {
        orderIdempotencyKeyRef.current =
          typeof globalThis.crypto?.randomUUID === "function"
            ? globalThis.crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      }
      const idempotencyKey = orderIdempotencyKeyRef.current;
      if (!saveOrderCreateAttempt({ idempotencyKey, phase: "submitting" })) {
        lockOrderCreationAsUncertain(
          idempotencyKey,
          "注文の送信準備を安全に保存できませんでした。重複注文を防ぐため再送せず、店舗へご確認ください。",
        );
        return;
      }

      setIsLoading(true);

      const controller = new AbortController();
      timeoutId = window.setTimeout(() => {
        controller.abort();
      }, ORDER_CREATE_TIMEOUT_MS);

      const response = await fetch("/api/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          items,
          customerInfo,
          paymentMethod,
          total,
          storeVisitDate: paymentMethod === "PAY_IN_STORE" ? storeVisitDate : undefined,
        }),
        signal: controller.signal,
      });
      responseStatus = response.status;
      if (response.ok) {
        const json = await response.json();
        const serverItems = parseServerConfirmedCartItems(json?.order?.items);
        const serverTotal = json?.order?.total;
        const calculatedServerTotal = serverItems?.reduce(
          (sum, item) => sum + item.price * item.quantity,
          0,
        );
        if (
          !json?.paymentSetup?.orderId ||
          !json?.paymentSetup?.humanToken ||
          typeof json?.paymentSetup?.receiptToken !== "string" ||
          json.paymentSetup.receiptToken.length < 1 ||
          json.paymentSetup.receiptToken.length > 256 ||
          !serverItems ||
          !Number.isSafeInteger(serverTotal) ||
          serverTotal <= 0 ||
          calculatedServerTotal !== serverTotal
        ) {
          throw new Error("サーバー確定の注文内容を確認できません。注文を確定せず、カートへ戻ってください。");
        }
        savePendingOrderPaymentSetup({
          orderId: String(json.paymentSetup.orderId),
          expectedVersion: Number(json.paymentSetup.expectedVersion ?? 0),
          humanToken: String(json.paymentSetup.humanToken),
          receiptToken: json.paymentSetup.receiptToken,
          paymentMethod: json.paymentSetup.paymentMethod,
          storeVisitDate:
            typeof json.paymentSetup.storeVisitDate === "string"
              ? json.paymentSetup.storeVisitDate
              : null,
          holdExpiresAt: String(json.paymentSetup.holdExpiresAt ?? ""),
          cartItems: serverItems,
          quotedTotal: serverTotal,
        });
        if (!loadPendingOrderPaymentSetup(String(json.paymentSetup.orderId))) {
          throw new Error("サーバー確定の注文情報を検証できません");
        }
        if (!clearCart()) {
          throw new Error("カート内容を安全に消去できません");
        }
        if (!clearOrderCreateAttempt(idempotencyKey)) {
          throw new Error("注文処理の安全確認情報を解除できません");
        }
        orderIdempotencyKeyRef.current = null;
        router.push(`/on-line-store/pay?order_id=${encodeURIComponent(String(json.paymentSetup.orderId))}`);
      } else {
        if (response.status === 409 || response.status >= 500) {
          lockOrderCreationAsUncertain(
            idempotencyKey,
            "注文処理の状態を確認できません。サーバー側で注文が処理された可能性があります。再送せず、店舗へ注文状況をご確認ください。",
          );
          return;
        }

        const errorData = (await response.json().catch(() => ({}))) as {
          error?: unknown;
          fields?: unknown;
        };
        const parsedFieldErrors = parseFieldErrors(errorData.fields);
        if (!clearOrderCreateAttempt(idempotencyKey)) {
          lockOrderCreationAsUncertain(
            idempotencyKey,
            "注文処理の安全確認情報を解除できません。重複注文を防ぐため再送せず、店舗へご確認ください。",
          );
          return;
        }
        orderIdempotencyKeyRef.current = null;
        setFieldErrors(parsedFieldErrors);
        focusFirstInvalid(parsedFieldErrors);
        setSubmitError(true);
        const errorMessage = typeof errorData.error === "string" ? errorData.error : "不明なエラー";
        setSubmitMessage(`注文処理中にエラーが発生しました: ${errorMessage}`);
      }
    } catch (error) {
      console.error("エラー:", error);
      setSubmitError(true);
      const isRetryableHttpError =
        responseStatus !== null &&
        responseStatus >= 400 &&
        responseStatus < 500 &&
        responseStatus !== 409;
      if (!isRetryableHttpError) {
        lockOrderCreationAsUncertain(
          orderIdempotencyKeyRef.current,
          error instanceof DOMException && error.name === "AbortError"
            ? "通信がタイムアウトしました。サーバー側で注文が処理された可能性があります。再送せず、店舗へ注文状況をご確認ください。"
            : "通信または注文結果の確認に失敗しました。サーバー側で注文が処理された可能性があります。再送せず、店舗へ注文状況をご確認ください。",
        );
      } else {
        setSubmitMessage(
          error instanceof Error ? error.message : "注文処理中にエラーが発生しました",
        );
      }
    } finally {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      setIsLoading(false);
    }
  };

  if (items.length === 0 && !isCheckout) {
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
        <div className="mx-auto max-w-[76rem]">
          <header className="mb-12 text-center">
            <h1
              className={`font-semibold text-[#2f1b0f] ${headingFont.className}`}
              style={{ fontSize: `min(${menuHeadingSize.base}px, max(2rem, 4vw))` }}
            >
              Cart
            </h1>
          </header>

          {isAgentMode ? (
            <div className={`${bodySerif.className} mx-auto mb-8 w-full max-w-[40rem] rounded-2xl border border-[#cfa96d]/40 bg-white/90 px-6 py-5 text-left text-[#4a3121] shadow-[0_16px_48px_rgba(47,27,15,0.08)]`}>
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#8a6233]">
                Warm Handoff
              </p>
              <p className="mt-3 text-sm leading-7">
                AIが購入直前まで案内しました。現在カートは空です。商品ページで数量を確認し、
                ご本人がカート追加と最終注文を行ってください。
              </p>
            </div>
          ) : null}

          <div className={`${bodySerif.className} mx-auto w-full max-w-[40rem] space-y-4 text-center`}>
            <p className="text-xl font-semibold text-[#2f1b0f]">カートは空です</p>
            <p className="text-sm text-[#4a3121]">商品ページで「カートに入れる」を押すとここに表示されます。</p>
            <Link
              href="/on-line-store"
              className="inline-flex items-center justify-center rounded-full border border-[#2f1b0f] px-6 py-2 text-sm text-[#2f1b0f] transition hover:bg-[#f6f1e7]"
            >
              オンラインストアへ戻る
            </Link>
          </div>
        </div>
      </section>
    );
  }

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
      <div className="mx-auto max-w-4xl">
        {isAgentMode ? (
          <div className={`${bodySerif.className} mb-8 rounded-2xl border border-[#cfa96d]/40 bg-white/90 px-6 py-5 text-left text-[#4a3121] shadow-[0_16px_48px_rgba(47,27,15,0.08)]`}>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#8a6233]">
              Warm Handoff
            </p>
            <p className="mt-3 text-sm leading-7">
              AIが商品選定まで案内しました。内容を確認し、この画面でお客様ご自身が連絡先入力、
              支払い方法の選択、最終注文を行ってください。
            </p>
          </div>
        ) : null}

        {!isCheckout ? (
          <>
            <header className="mb-12 text-center">
              <h1
                className={`font-semibold text-[#2f1b0f] ${headingFont.className}`}
                style={{ fontSize: `min(${menuHeadingSize.base}px, max(2rem, 4vw))` }}
              >
                Cart
              </h1>
            </header>

            <div className={`${bodySerif.className} mb-12 space-y-6`}>
              {items.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-col items-stretch gap-4 rounded-lg border border-[#2f1b0f] bg-white p-4 sm:flex-row sm:items-center sm:p-6"
                >
                  <div className="relative mx-auto h-20 w-20 flex-shrink-0 overflow-hidden rounded bg-white sm:mx-0">
                    <Image src={item.image} alt={item.name} fill className="object-contain p-1" sizes="80px" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-lg font-semibold text-[#2f1b0f]">{item.name}</h3>
                    <p className="mt-2 text-[#4a3121]">
                      {formatYen(item.price)} × {item.quantity}
                    </p>
                    <p className="mt-2 font-semibold text-[#2f1b0f]">
                      小計: {formatYen(item.price * item.quantity)}
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      removeFromCart(item.id);
                      const nextItems = normalizeCartItems(getCartItems());
                      setItems(nextItems);
                      restoreCartItems(nextItems);
                    }}
                    className="min-h-11 min-w-11 self-end rounded bg-red-200 px-4 py-2 text-red-800 transition hover:bg-red-300 sm:self-center"
                  >
                    削除
                  </button>
                </div>
              ))}
            </div>

            <div className={`${bodySerif.className} mb-12 text-right`}>
              <p className="text-2xl font-semibold text-[#2f1b0f]">
                合計: {formatYen(total)}
              </p>
            </div>

            <div className="mb-12 flex gap-4">
              <Link
                href="/on-line-store"
                className="flex-1 rounded-full border-2 border-[#2f1b0f] bg-white py-4 text-center font-semibold text-[#2f1b0f] transition hover:brightness-95"
              >
                買い物を続ける
              </Link>
              <button
                onClick={() => setIsCheckout(true)}
                className="flex-1 rounded-full bg-[#2f1b0f] py-4 font-semibold text-white transition hover:brightness-110"
              >
                チェックアウト
              </button>
            </div>
          </>
        ) : (
          <>
            <header className="mb-12 text-center">
              <h1
                className={`font-semibold text-[#2f1b0f] ${headingFont.className}`}
                style={{ fontSize: `min(${menuHeadingSize.base}px, max(2rem, 4vw))` }}
              >
                Order
              </h1>
            </header>

            <form
              onSubmit={handleSubmitOrder}
              noValidate
              aria-busy={isLoading}
              className={`${bodySerif.className} rounded-lg border border-[#2f1b0f] bg-white p-8`}
            >
              <h2 className="mb-6 text-2xl font-semibold text-[#2f1b0f]">顧客情報</h2>

              {Object.keys(fieldErrors).length > 0 && (
                <div
                  role="region"
                  aria-label="入力内容のエラー"
                  className="mb-6 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800"
                >
                  <p className="font-semibold">入力内容を確認してください</p>
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    {Object.entries(fieldErrors).map(([field, message]) => (
                      <li key={field}>
                        <span className="font-semibold">{orderFieldLabels[field] ?? field}</span>：{message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="mb-6 grid grid-cols-1 gap-6 md:grid-cols-2">
                <div>
                  {getFieldError("customerInfo.name") ? (
                    <p id="customer-name-error" className="mb-2 text-sm font-semibold text-red-700">
                      {getFieldError("customerInfo.name")}
                    </p>
                  ) : null}
                  <label htmlFor="customer-name" className="mb-2 block text-sm font-semibold text-[#2f1b0f]">
                    お名前 <span className="text-red-600">*</span>
                  </label>
                  <input
                    id="customer-name"
                    type="text"
                    name="name"
                    value={customerInfo.name}
                    onChange={handleInputChange}
                    disabled={checkoutLocked}
                    required
                    aria-invalid={getFieldError("customerInfo.name") ? true : undefined}
                    aria-describedby={getFieldError("customerInfo.name") ? "customer-name-error" : undefined}
                    placeholder="山田太郎"
                    className="min-h-11 w-full rounded border border-[#2f1b0f] px-4 py-2 text-[#2f1b0f]"
                  />
                </div>

                <div>
                  {getFieldError("customerInfo.email") ? (
                    <p id="customer-email-error" className="mb-2 text-sm font-semibold text-red-700">
                      {getFieldError("customerInfo.email")}
                    </p>
                  ) : null}
                  <label htmlFor="customer-email" className="mb-2 block text-sm font-semibold text-[#2f1b0f]">
                    メールアドレス <span className="text-red-600">*</span>
                  </label>
                  <input
                    id="customer-email"
                    type="email"
                    name="email"
                    value={customerInfo.email}
                    onChange={handleInputChange}
                    disabled={checkoutLocked}
                    required
                    aria-invalid={getFieldError("customerInfo.email") ? true : undefined}
                    aria-describedby={getFieldError("customerInfo.email") ? "customer-email-error" : undefined}
                    placeholder="example@email.com"
                    className="min-h-11 w-full rounded border border-[#2f1b0f] px-4 py-2 text-[#2f1b0f]"
                  />
                </div>

                <div>
                  {getFieldError("customerInfo.phone") ? (
                    <p id="customer-phone-error" className="mb-2 text-sm font-semibold text-red-700">
                      {getFieldError("customerInfo.phone")}
                    </p>
                  ) : null}
                  <label htmlFor="customer-phone" className="mb-2 block text-sm font-semibold text-[#2f1b0f]">
                    電話番号 <span className="text-red-600">*</span>
                  </label>
                  <input
                    id="customer-phone"
                    type="tel"
                    name="phone"
                    value={customerInfo.phone}
                    onChange={handleInputChange}
                    disabled={checkoutLocked}
                    required
                    aria-invalid={getFieldError("customerInfo.phone") ? true : undefined}
                    aria-describedby={getFieldError("customerInfo.phone") ? "customer-phone-error" : undefined}
                    placeholder="090-1234-5678"
                    className="min-h-11 w-full rounded border border-[#2f1b0f] px-4 py-2 text-[#2f1b0f]"
                  />
                </div>

                <div>
                  {getFieldError("customerInfo.zipCode") ? (
                    <p id="customer-zip-code-error" className="mb-2 text-sm font-semibold text-red-700">
                      {getFieldError("customerInfo.zipCode")}
                    </p>
                  ) : null}
                  <label htmlFor="customer-zip-code" className="mb-2 block text-sm font-semibold text-[#2f1b0f]">
                    郵便番号 <span className="text-red-600">*</span>
                  </label>
                  <input
                    id="customer-zip-code"
                    type="text"
                    name="zipCode"
                    value={customerInfo.zipCode}
                    onChange={handleInputChange}
                    disabled={checkoutLocked}
                    required
                    aria-invalid={getFieldError("customerInfo.zipCode") ? true : undefined}
                    aria-describedby={getFieldError("customerInfo.zipCode") ? "customer-zip-code-error" : undefined}
                    placeholder="123-4567"
                    className="min-h-11 w-full rounded border border-[#2f1b0f] px-4 py-2 text-[#2f1b0f]"
                  />
                </div>

                <div>
                  {getFieldError("customerInfo.prefecture") ? (
                    <p id="customer-prefecture-error" className="mb-2 text-sm font-semibold text-red-700">
                      {getFieldError("customerInfo.prefecture")}
                    </p>
                  ) : null}
                  <label htmlFor="customer-prefecture" className="mb-2 block text-sm font-semibold text-[#2f1b0f]">
                    都道府県 <span className="text-red-600">*</span>
                  </label>
                  <select
                    id="customer-prefecture"
                    name="prefecture"
                    value={customerInfo.prefecture}
                    onChange={handleInputChange}
                    disabled={checkoutLocked}
                    required
                    aria-invalid={getFieldError("customerInfo.prefecture") ? true : undefined}
                    aria-describedby={getFieldError("customerInfo.prefecture") ? "customer-prefecture-error" : undefined}
                    className="min-h-11 w-full rounded border border-[#2f1b0f] px-4 py-2 text-[#2f1b0f]"
                  >
                    <option value="">選択してください</option>
                    {prefectures.map((pref) => (
                      <option key={pref} value={pref}>
                        {pref}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  {getFieldError("customerInfo.city") ? (
                    <p id="customer-city-error" className="mb-2 text-sm font-semibold text-red-700">
                      {getFieldError("customerInfo.city")}
                    </p>
                  ) : null}
                  <label htmlFor="customer-city" className="mb-2 block text-sm font-semibold text-[#2f1b0f]">
                    市区町村 <span className="text-red-600">*</span>
                  </label>
                  <input
                    id="customer-city"
                    type="text"
                    name="city"
                    value={customerInfo.city}
                    onChange={handleInputChange}
                    disabled={checkoutLocked}
                    required
                    aria-invalid={getFieldError("customerInfo.city") ? true : undefined}
                    aria-describedby={getFieldError("customerInfo.city") ? "customer-city-error" : undefined}
                    placeholder="東京都渋谷区"
                    className="min-h-11 w-full rounded border border-[#2f1b0f] px-4 py-2 text-[#2f1b0f]"
                  />
                </div>

                <div>
                  {getFieldError("customerInfo.address") ? (
                    <p id="customer-address-error" className="mb-2 text-sm font-semibold text-red-700">
                      {getFieldError("customerInfo.address")}
                    </p>
                  ) : null}
                  <label htmlFor="customer-address" className="mb-2 block text-sm font-semibold text-[#2f1b0f]">
                    番地 <span className="text-red-600">*</span>
                  </label>
                  <input
                    id="customer-address"
                    type="text"
                    name="address"
                    value={customerInfo.address}
                    onChange={handleInputChange}
                    disabled={checkoutLocked}
                    required
                    aria-invalid={getFieldError("customerInfo.address") ? true : undefined}
                    aria-describedby={getFieldError("customerInfo.address") ? "customer-address-error" : undefined}
                    placeholder="1-2-3"
                    className="min-h-11 w-full rounded border border-[#2f1b0f] px-4 py-2 text-[#2f1b0f]"
                  />
                </div>

                <div>
                  {getFieldError("customerInfo.building") ? (
                    <p id="customer-building-error" className="mb-2 text-sm font-semibold text-red-700">
                      {getFieldError("customerInfo.building")}
                    </p>
                  ) : null}
                  <label htmlFor="customer-building" className="mb-2 block text-sm font-semibold text-[#2f1b0f]">
                    建物名・部屋番号
                  </label>
                  <input
                    id="customer-building"
                    type="text"
                    name="building"
                    value={customerInfo.building}
                    onChange={handleInputChange}
                    disabled={checkoutLocked}
                    aria-invalid={getFieldError("customerInfo.building") ? true : undefined}
                    aria-describedby={getFieldError("customerInfo.building") ? "customer-building-error" : undefined}
                    placeholder="101号室"
                    className="min-h-11 w-full rounded border border-[#2f1b0f] px-4 py-2 text-[#2f1b0f]"
                  />
                </div>
              </div>

              <fieldset
                className="mb-8 space-y-4"
                aria-describedby={getFieldError("paymentMethod") ? "payment-method-error" : undefined}
              >
                <legend className="mb-6 mt-8 text-2xl font-semibold text-[#2f1b0f]">支払い方法</legend>
                <label className="flex cursor-pointer items-start rounded-lg border-2 border-[#2f1b0f] p-6 transition hover:bg-gray-50">
                  <input
                    id="payment-bank-transfer"
                    type="radio"
                    name="payment"
                    value="BANK_TRANSFER"
                    required
                    checked={paymentMethod === "BANK_TRANSFER"}
                    disabled={checkoutLocked}
                    onChange={(e) => {
                      orderIdempotencyKeyRef.current = null;
                      setPaymentMethod(e.target.value as PaymentMethod);
                      setSubmitMessage(null);
                      setSubmitError(false);
                      setFieldErrors((prev) => {
                        const next = { ...prev };
                        delete next.paymentMethod;
                        delete next.storeVisitDate;
                        return next;
                      });
                    }}
                    className="mt-1 h-5 w-5 flex-shrink-0"
                  />
                  <div className="ml-4 flex-1">
                    <p className="text-lg font-semibold text-[#2f1b0f]">銀行振込</p>
                    <p className="mt-2 text-sm text-[#4a3121]">
                      注文後にメールで振込先口座情報をお知らせします。ご入金確認後に商品を発送いたします。
                    </p>
                  </div>
                </label>

                <label className="flex cursor-pointer items-start rounded-lg border-2 border-[#2f1b0f] p-6 transition hover:bg-gray-50">
                  <input
                    id="payment-pay-in-store"
                    type="radio"
                    name="payment"
                    value="PAY_IN_STORE"
                    checked={paymentMethod === "PAY_IN_STORE"}
                    disabled={checkoutLocked}
                    onChange={(e) => {
                      orderIdempotencyKeyRef.current = null;
                      setPaymentMethod(e.target.value as PaymentMethod);
                      setSubmitMessage(null);
                      setSubmitError(false);
                      setFieldErrors((prev) => {
                        const next = { ...prev };
                        delete next.paymentMethod;
                        return next;
                      });
                    }}
                    className="mt-1 h-5 w-5 flex-shrink-0"
                  />
                  <div className="ml-4 flex-1">
                    <p className="text-lg font-semibold text-[#2f1b0f]">来店時にお支払い（現金）</p>
                    <p className="mt-2 text-sm text-[#4a3121]">
                      ご来店時に現金でお支払いください。商品はご来店予定日に合わせて用意いたします。
                    </p>
                  </div>
                </label>
                {getFieldError("paymentMethod") ? (
                  <p id="payment-method-error" className="text-sm font-semibold text-red-700">
                    {getFieldError("paymentMethod")}
                  </p>
                ) : null}
              </fieldset>

              {paymentMethod === "PAY_IN_STORE" && (
                <div className="mb-8 rounded-lg border border-[#2f1b0f] bg-[#f7ebd3] p-6">
                  <h3 className="mb-4 text-lg font-semibold text-[#2f1b0f]">
                    <label htmlFor="store-visit-date">来店予定日を選択</label>
                  </h3>
                  <p id="store-visit-date-help" className="mb-4 text-sm text-[#4a3121]">
                    ※ 注文日から2週間〜30日の営業日（木〜日）のみ選択可能です。定休日は月〜水です。
                  </p>
                  <input
                    id="store-visit-date"
                    type="date"
                    ref={storeVisitDateRef}
                    disabled={checkoutLocked}
                    value={storeVisitDate}
                    onChange={(e) => {
                      orderIdempotencyKeyRef.current = null;
                      setStoreVisitDate(e.target.value);
                      setSubmitMessage(null);
                      setSubmitError(false);
                      setFieldErrors((prev) => {
                        const next = { ...prev };
                        delete next.storeVisitDate;
                        return next;
                      });
                    }}
                    min={minDate}
                    max={maxDate}
                    required
                    aria-invalid={getFieldError("storeVisitDate") || storeVisitDateError ? true : undefined}
                    aria-describedby={
                      getFieldError("storeVisitDate") || storeVisitDateError
                        ? "store-visit-date-help store-visit-date-error"
                        : "store-visit-date-help"
                    }
                    className="min-h-11 w-full rounded border border-[#2f1b0f] px-4 py-2 text-[#2f1b0f]"
                  />
                  {getFieldError("storeVisitDate") || storeVisitDateError ? (
                    <p
                      id="store-visit-date-error"
                      className="mt-2 text-sm font-semibold text-red-700"
                    >
                      {getFieldError("storeVisitDate") ?? storeVisitDateError}
                    </p>
                  ) : null}
                </div>
              )}

              {submitMessage && (
                <p
                  role={submitError ? "alert" : "status"}
                  aria-live={submitError ? "assertive" : "polite"}
                  className={`mb-4 text-sm ${submitError ? "text-red-700" : "text-green-700"}`}
                >
                  {submitMessage}
                </p>
              )}

              <div className="flex gap-4">
                <button
                  type="button"
                  onClick={() => setIsCheckout(false)}
                  disabled={isLoading || orderSubmissionUncertain}
                  className="flex-1 rounded-full border-2 border-[#2f1b0f] bg-white py-4 font-semibold text-[#2f1b0f] transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:brightness-100"
                >
                  戻る
                </button>
                <button
                  type="submit"
                  disabled={
                    isLoading ||
                    orderSubmissionUncertain
                  }
                  className="flex-1 rounded-full bg-[#2f1b0f] py-4 font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
                >
                  {isLoading ? "処理中..." : "注文する"}
                </button>
              </div>
              {orderSubmissionUncertain ? (
                <p className="mt-4 text-sm font-semibold leading-6 text-[#842029]">
                  注文が作成されている可能性があります。再送せず、店舗へ注文状況をご確認ください：
                  <a className="ml-1 underline underline-offset-4" href={CONTACT_TEL_LINK}>
                    {CONTACT_PHONE_DISPLAY}
                  </a>
                </p>
              ) : null}
            </form>
          </>
        )}
      </div>
    </section>
  );
}

export default function StoreCartPage() {
  return (
    <Suspense fallback={<StoreCartFallback />}>
      <StoreCartContent />
    </Suspense>
  );
}
