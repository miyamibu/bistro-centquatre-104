"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Noto_Serif_JP, Tangerine } from "next/font/google";
import { formatYen, getCartItems, type StoreCartItem, clearCart, removeFromCart } from "@/lib/store-cart";
import { savePendingOrderPaymentSetup } from "@/lib/store-checkout-session";

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

const prefectures = [
  "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県",
  "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県",
  "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県",
  "静岡県", "愛知県", "三重県", "滋賀県", "京都府", "大阪府", "兵庫県",
  "奈良県", "和歌山県", "鳥取県", "島根県", "岡山県", "広島県", "山口県",
  "徳島県", "香川県", "愛媛県", "高知県", "福岡県", "佐賀県", "長崎県",
  "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県",
];

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
        <p className={`${bodySerif.className} text-sm text-[#4a3121]`}>読み込み中...</p>
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
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState(false);
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

  const { minDate, maxDate } = useMemo(() => getStoreDateRange(), []);

  useEffect(() => {
    setItems(getCartItems());
  }, []);

  const total = useMemo(
    () => items.reduce((sum, item) => sum + item.price * item.quantity, 0),
    [items],
  );

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    orderIdempotencyKeyRef.current = null;
    setCustomerInfo((prev) => ({ ...prev, [name]: value }));
  };

  const validateForm = (): string | null => {
    if (!customerInfo.name.trim()) {
      return "お名前を入力してください";
    }
    if (!customerInfo.email.trim()) {
      return "メールアドレスを入力してください";
    }
    if (!customerInfo.phone.trim()) {
      return "電話番号を入力してください";
    }
    if (!customerInfo.zipCode.trim()) {
      return "郵便番号を入力してください";
    }
    if (!customerInfo.prefecture) {
      return "都道府県を選択してください";
    }
    if (!customerInfo.city.trim()) {
      return "市区町村を入力してください";
    }
    if (!customerInfo.address.trim()) {
      return "番地を入力してください";
    }
    if (!paymentMethod) {
      return "支払い方法を選択してください";
    }
    if (paymentMethod === "PAY_IN_STORE" && !storeVisitDate) {
      return "来店予定日を選択してください";
    }
    return null;
  };

  const handleSubmitOrder = async () => {
    const validationMessage = validateForm();
    if (validationMessage) {
      setSubmitError(true);
      setSubmitMessage(validationMessage);
      return;
    }

    setIsLoading(true);
    setSubmitError(false);
    setSubmitMessage(null);
    try {
      if (!orderIdempotencyKeyRef.current) {
        orderIdempotencyKeyRef.current =
          typeof globalThis.crypto?.randomUUID === "function"
            ? globalThis.crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      }

      const response = await fetch("/api/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
          "Idempotency-Key": orderIdempotencyKeyRef.current,
        },
        body: JSON.stringify({
          items,
          customerInfo,
          paymentMethod,
          total,
          storeVisitDate: paymentMethod === "PAY_IN_STORE" ? storeVisitDate : undefined,
        }),
      });

      if (response.ok) {
        const json = await response.json();
        if (!json?.paymentSetup?.orderId || !json?.paymentSetup?.humanToken) {
          throw new Error("本人確認ステップの初期化に失敗しました");
        }
        savePendingOrderPaymentSetup({
          orderId: String(json.paymentSetup.orderId),
          expectedVersion: Number(json.paymentSetup.expectedVersion ?? 0),
          humanToken: String(json.paymentSetup.humanToken),
          paymentMethod:
            json.paymentSetup.paymentMethod === "PAY_IN_STORE" ||
            json.paymentSetup.paymentMethod === "BANK_TRANSFER"
              ? json.paymentSetup.paymentMethod
              : null,
          storeVisitDate:
            typeof json.paymentSetup.storeVisitDate === "string"
              ? json.paymentSetup.storeVisitDate
              : null,
          holdExpiresAt: String(json.paymentSetup.holdExpiresAt ?? ""),
        });
        clearCart();
        router.push(`/on-line-store/pay?order_id=${encodeURIComponent(String(json.paymentSetup.orderId))}`);
      } else {
        const errorData = await response.json();
        setSubmitError(true);
        setSubmitMessage(`注文処理中にエラーが発生しました: ${errorData.error ?? "不明なエラー"}`);
      }
    } catch (error) {
      console.error("エラー:", error);
      setSubmitError(true);
      setSubmitMessage("注文処理中にエラーが発生しました");
    } finally {
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
                  className="flex items-center gap-4 rounded-lg border border-[#2f1b0f] bg-white p-6"
                >
                  <div className="relative h-20 w-20 flex-shrink-0 overflow-hidden rounded bg-white">
                    <Image src={item.image} alt={item.name} fill className="object-contain p-1" sizes="80px" />
                  </div>
                  <div className="flex-1">
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
                      setItems(getCartItems());
                    }}
                    className="rounded bg-red-200 px-4 py-2 text-red-800 transition hover:bg-red-300"
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

            <div className={`${bodySerif.className} rounded-lg border border-[#2f1b0f] bg-white p-8`}>
              <h2 className="mb-6 text-2xl font-semibold text-[#2f1b0f]">顧客情報</h2>

              <div className="mb-6 grid grid-cols-1 gap-6 md:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-semibold text-[#2f1b0f]">
                    お名前 <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="text"
                    name="name"
                    value={customerInfo.name}
                    onChange={handleInputChange}
                    placeholder="山田太郎"
                    className="w-full rounded border border-[#2f1b0f] px-4 py-2 text-[#2f1b0f]"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-semibold text-[#2f1b0f]">
                    メールアドレス <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="email"
                    name="email"
                    value={customerInfo.email}
                    onChange={handleInputChange}
                    placeholder="example@email.com"
                    className="w-full rounded border border-[#2f1b0f] px-4 py-2 text-[#2f1b0f]"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-semibold text-[#2f1b0f]">
                    電話番号 <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="tel"
                    name="phone"
                    value={customerInfo.phone}
                    onChange={handleInputChange}
                    placeholder="090-1234-5678"
                    className="w-full rounded border border-[#2f1b0f] px-4 py-2 text-[#2f1b0f]"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-semibold text-[#2f1b0f]">
                    郵便番号 <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="text"
                    name="zipCode"
                    value={customerInfo.zipCode}
                    onChange={handleInputChange}
                    placeholder="123-4567"
                    className="w-full rounded border border-[#2f1b0f] px-4 py-2 text-[#2f1b0f]"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-semibold text-[#2f1b0f]">
                    都道府県 <span className="text-red-600">*</span>
                  </label>
                  <select
                    name="prefecture"
                    value={customerInfo.prefecture}
                    onChange={handleInputChange}
                    className="w-full rounded border border-[#2f1b0f] px-4 py-2 text-[#2f1b0f]"
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
                  <label className="mb-2 block text-sm font-semibold text-[#2f1b0f]">
                    市区町村 <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="text"
                    name="city"
                    value={customerInfo.city}
                    onChange={handleInputChange}
                    placeholder="東京都渋谷区"
                    className="w-full rounded border border-[#2f1b0f] px-4 py-2 text-[#2f1b0f]"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-semibold text-[#2f1b0f]">
                    番地 <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="text"
                    name="address"
                    value={customerInfo.address}
                    onChange={handleInputChange}
                    placeholder="1-2-3"
                    className="w-full rounded border border-[#2f1b0f] px-4 py-2 text-[#2f1b0f]"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-semibold text-[#2f1b0f]">
                    建物名・部屋番号
                  </label>
                  <input
                    type="text"
                    name="building"
                    value={customerInfo.building}
                    onChange={handleInputChange}
                    placeholder="101号室"
                    className="w-full rounded border border-[#2f1b0f] px-4 py-2 text-[#2f1b0f]"
                  />
                </div>
              </div>

              <h2 className="mb-6 mt-8 text-2xl font-semibold text-[#2f1b0f]">支払い方法</h2>

              <div className="mb-8 space-y-4">
                <label className="flex cursor-pointer items-start rounded-lg border-2 border-[#2f1b0f] p-6 transition hover:bg-gray-50">
                  <input
                    type="radio"
                    name="payment"
                    value="BANK_TRANSFER"
                    checked={paymentMethod === "BANK_TRANSFER"}
                    onChange={(e) => {
                      orderIdempotencyKeyRef.current = null;
                      setPaymentMethod(e.target.value as PaymentMethod);
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
                    type="radio"
                    name="payment"
                    value="PAY_IN_STORE"
                    checked={paymentMethod === "PAY_IN_STORE"}
                    onChange={(e) => {
                      orderIdempotencyKeyRef.current = null;
                      setPaymentMethod(e.target.value as PaymentMethod);
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
              </div>

              {paymentMethod === "PAY_IN_STORE" && (
                <div className="mb-8 rounded-lg border border-[#2f1b0f] bg-[#f7ebd3] p-6">
                  <h3 className="mb-4 text-lg font-semibold text-[#2f1b0f]">来店予定日を選択</h3>
                  <p className="mb-4 text-sm text-[#4a3121]">
                    ※ 注文日から2週間〜30日の営業日（木〜日）のみ選択可能です。定休日は月〜水です。
                  </p>
                  <input
                    type="date"
                    value={storeVisitDate}
                    onChange={(e) => {
                      orderIdempotencyKeyRef.current = null;
                      setStoreVisitDate(e.target.value);
                    }}
                    min={minDate}
                    max={maxDate}
                    className="w-full rounded border border-[#2f1b0f] px-4 py-2 text-[#2f1b0f]"
                  />
                </div>
              )}

              {submitMessage && (
                <p className={`mb-4 text-sm ${submitError ? "text-red-700" : "text-green-700"}`}>
                  {submitMessage}
                </p>
              )}

              <div className="flex gap-4">
                <button
                  onClick={() => setIsCheckout(false)}
                  className="flex-1 rounded-full border-2 border-[#2f1b0f] bg-white py-4 font-semibold text-[#2f1b0f] transition hover:brightness-95"
                >
                  戻る
                </button>
                <button
                  onClick={handleSubmitOrder}
                  disabled={isLoading}
                  className="flex-1 rounded-full bg-[#2f1b0f] py-4 font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
                >
                  {isLoading ? "処理中..." : "注文する"}
                </button>
              </div>
            </div>
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
