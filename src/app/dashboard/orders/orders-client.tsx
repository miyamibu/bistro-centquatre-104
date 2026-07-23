"use client";

import { useEffect, useRef, useState } from "react";
import { Noto_Serif_JP, Tangerine } from "next/font/google";
import { reduceOrdersNeedRefresh } from "@/lib/order-action-state";

const headingFont = Tangerine({
  subsets: ["latin"],
  weight: ["400", "700"],
  display: "swap",
});

const bodySerif = Noto_Serif_JP({
  subsets: ["latin"],
  weight: ["400", "600"],
});

interface Order {
  id: string;
  customer_name: string;
  email: string;
  phone: string;
  zip_code: string;
  prefecture: string;
  city: string;
  address: string;
  building: string | null;
  payment_method: "BANK_TRANSFER" | "PAY_IN_STORE" | "bank-transfer" | "cash-store" | null;
  items: OrderItem[];
  total: number;
  store_visit_date: string | null;
  status:
    | "QUOTED"
    | "PENDING_PAYMENT"
    | "PAID"
    | "SHIPPED"
    | "CANCELLED"
    | "unconfirmed"
    | "confirmed"
    | "shipped";
  version?: number;
  created_at: string;
}

interface OrderItem {
  name: string;
  quantity: number;
  price: number;
}

interface BankAccount {
  id: string;
  bank_name: string;
  branch_name: string;
  account_type: string;
  account_number: string;
  account_holder: string;
}

interface OrdersClientProps {
  initialOrders: Order[];
  initialOrdersError?: string | null;
  initialBankAccount: BankAccount | null;
  initialBankAccountError?: string | null;
}

type OrderMutationResult = "mutation_failed" | "mutation_succeeded_refresh_failed" | "confirmed";
const ORDER_ACTION_TIMEOUT_MS = 20_000;
const ORDER_LIST_TIMEOUT_MS = 20_000;

export function OrdersClient({
  initialOrders,
  initialOrdersError = null,
  initialBankAccount,
  initialBankAccountError = null,
}: OrdersClientProps) {
  const [orders, setOrders] = useState<Order[]>(initialOrders);
  const [ordersError, setOrdersError] = useState<string | null>(initialOrdersError);
  const [bankAccount, setBankAccount] = useState<BankAccount | null>(initialBankAccount);
  const [bankAccountError, setBankAccountError] = useState<string | null>(initialBankAccountError);
  const [showBankForm, setShowBankForm] = useState(false);
  const [editingBank, setEditingBank] = useState<BankAccount | null>(null);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [pendingOrderActionKey, setPendingOrderActionKey] = useState<string | null>(null);
  const [ordersNeedRefresh, setOrdersNeedRefresh] = useState(false);
  const [isRefreshingOrders, setIsRefreshingOrders] = useState(false);

  useEffect(() => {
    setFeedback(null);
  }, []);

  const ordersRequestIdRef = useRef(0);
  const bankAccountRequestIdRef = useRef(0);
  const pendingOrderActionRef = useRef<string | null>(null);
  const ordersRefreshButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!ordersNeedRefresh) return;
    window.requestAnimationFrame(() => ordersRefreshButtonRef.current?.focus());
  }, [ordersNeedRefresh]);

  const createIdempotencyKey = () => {
    if (typeof globalThis.crypto?.randomUUID === "function") {
      return globalThis.crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  };

  const loadOrders = async () => {
    const requestId = ordersRequestIdRef.current + 1;
    ordersRequestIdRef.current = requestId;
    let timeoutId: number | null = null;

    try {
      const controller = new AbortController();
      timeoutId = window.setTimeout(() => controller.abort(), ORDER_LIST_TIMEOUT_MS);
      const response = await fetch("/dashboard/api/orders", {
        method: "GET",
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error("Failed to fetch orders");
      }

      const data = await response.json();
      if (ordersRequestIdRef.current !== requestId) return false;
      setOrders(data || []);
      setOrdersError(null);
      setFeedback((current) =>
        current?.type === "error" && current.text === "注文一覧の読み込みに失敗しました"
          ? null
          : current
      );
      return true;
    } catch (error) {
      if (ordersRequestIdRef.current !== requestId) return false;
      console.error("Failed to load orders:", error);
      setOrdersError("注文一覧を取得できませんでした。時間をおいて再確認してください。");
      setFeedback({ type: "error", text: "注文一覧の読み込みに失敗しました" });
      return false;
    } finally {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      if (ordersRequestIdRef.current === requestId) {
        setIsRefreshingOrders(false);
      }
    }
  };

  const refreshOrders = async () => {
    setIsRefreshingOrders(true);
    const refreshed = await loadOrders();
    if (refreshed) {
      setOrdersNeedRefresh((current) =>
        reduceOrdersNeedRefresh(current, { type: "refresh-succeeded" }),
      );
      setFeedback({ type: "success", text: "注文一覧を再取得しました" });
    } else {
      setOrdersNeedRefresh((current) =>
        reduceOrdersNeedRefresh(current, { type: "refresh-failed" }),
      );
    }
  };

  const loadBankAccount = async () => {
    const requestId = bankAccountRequestIdRef.current + 1;
    bankAccountRequestIdRef.current = requestId;

    try {
      const response = await fetch("/dashboard/api/bank-account", {
        method: "GET",
      });

      if (!response.ok) {
        throw new Error("Failed to fetch bank account");
      }

      const data = await response.json();
      if (bankAccountRequestIdRef.current !== requestId) return;
      setBankAccount(data?.id ? data : null);
      setBankAccountError(null);
    } catch (error) {
      if (bankAccountRequestIdRef.current !== requestId) return;
      console.error("Failed to load bank account:", error);
      setBankAccountError("銀行情報を取得できませんでした。設定状態を確認できません。");
    }
  };

  const performOrderAction = async (
    order: Order,
    action: "MARK_PAID" | "MARK_COLLECTED" | "MARK_SHIPPED" | "CANCEL",
    payload: Record<string, unknown>
  ): Promise<OrderMutationResult> => {
    if (pendingOrderActionRef.current) {
      return "mutation_failed";
    }

    const actionKey = `${order.id}:${action}`;
    pendingOrderActionRef.current = actionKey;
    setPendingOrderActionKey(actionKey);
    setFeedback(null);
    let timeoutId: number | null = null;
    let receivedResponse = false;
    let responseStatus: number | null = null;

    try {
      const controller = new AbortController();
      timeoutId = window.setTimeout(() => controller.abort(), ORDER_ACTION_TIMEOUT_MS);
      const response = await fetch(`/api/orders/${order.id}/actions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
          "Idempotency-Key": createIdempotencyKey(),
        },
        body: JSON.stringify({
          action,
          expectedVersion: order.version ?? 0,
          payload,
        }),
        signal: controller.signal,
      });
      receivedResponse = true;
      responseStatus = response.status;

      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as { error?: unknown };
        const errorMessage =
          typeof errorData.error === "string"
            ? errorData.error
            : "ステータスの更新に失敗しました";
        throw new Error(errorMessage);
      }

      const refreshed = await loadOrders();
      if (!refreshed) {
        setOrdersNeedRefresh((current) =>
          reduceOrdersNeedRefresh(current, { type: "mutation-succeeded-refresh-failed" }),
        );
        setFeedback({
          type: "error",
          text: "更新は受理されましたが一覧の再取得に失敗しました。再読み込みして状態を確認してください。",
        });
        return "mutation_succeeded_refresh_failed";
      }

      setOrdersNeedRefresh((current) =>
        reduceOrdersNeedRefresh(current, { type: "refresh-succeeded" }),
      );
      return "confirmed";
    } catch (error) {
      console.error("Failed to update order status:", error);
      if (!receivedResponse) {
        setOrdersNeedRefresh((current) =>
          reduceOrdersNeedRefresh(current, { type: "transport-unknown" }),
        );
        setFeedback({
          type: "error",
          text:
            error instanceof DOMException && error.name === "AbortError"
              ? "通信がタイムアウトしました。サーバー側で処理された可能性があります。再送せず、注文一覧を再取得して状態を確認してください。"
              : "通信に失敗しました。サーバー側で処理された可能性があります。再送せず、注文一覧を再取得して状態を確認してください。",
        });
        return "mutation_failed";
      }
      if (responseStatus !== null) {
        setOrdersNeedRefresh((current) =>
          reduceOrdersNeedRefresh(current, {
            type: "mutation-response",
            status: responseStatus ?? 0,
          }),
        );
      }
      setFeedback({
        type: "error",
        text: error instanceof Error ? error.message : "ステータスの更新に失敗しました",
      });
      return "mutation_failed";
    } finally {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      if (pendingOrderActionRef.current === actionKey) {
        pendingOrderActionRef.current = null;
        setPendingOrderActionKey(null);
      }
    }
  };

  const saveBankAccount = async () => {
    if (
      !editingBank?.bank_name ||
      !editingBank?.branch_name ||
      !editingBank?.account_type ||
      !editingBank?.account_number ||
      !editingBank?.account_holder
    ) {
      setFeedback({ type: "error", text: "全ての項目を入力してください" });
      return;
    }

    try {
      const response = await fetch("/dashboard/api/bank-account", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify(editingBank),
      });

      if (!response.ok) {
        throw new Error("Failed to save bank account");
      }

      setShowBankForm(false);
      setEditingBank(null);
      await loadBankAccount();
      setFeedback({ type: "success", text: "銀行情報を保存しました" });
    } catch (error) {
      console.error("Failed to save bank account:", error);
      setFeedback({ type: "error", text: "銀行情報の保存に失敗しました" });
    }
  };

  const getStatusBadge = (status: string) => {
    const statuses: Record<string, { label: string; color: string }> = {
      QUOTED: { label: "見積中", color: "bg-gray-200" },
      PENDING_PAYMENT: { label: "支払い待ち", color: "bg-yellow-200" },
      PAID: { label: "入金済み", color: "bg-blue-200" },
      SHIPPED: { label: "発送済み", color: "bg-green-200" },
      CANCELLED: { label: "キャンセル", color: "bg-red-200" },
      unconfirmed: { label: "旧:未確認", color: "bg-gray-200" },
      confirmed: { label: "旧:確認済み", color: "bg-yellow-200" },
      shipped: { label: "旧:発送", color: "bg-green-200" },
    };
    const s = statuses[status] || statuses.unconfirmed;
    return <span className={`px-3 py-1 rounded-full text-sm font-semibold ${s.color}`}>{s.label}</span>;
  };

  const getPaymentMethodLabel = (paymentMethod: Order["payment_method"]) => {
    if (paymentMethod === "BANK_TRANSFER" || paymentMethod === "bank-transfer") {
      return "銀行振込";
    }
    if (paymentMethod === "PAY_IN_STORE" || paymentMethod === "cash-store") {
      return "来店時支払い";
    }
    return "未選択";
  };

  return (
    <section className="min-h-screen px-8 pb-8 pt-12">
      <div className="max-w-7xl mx-auto">
        <header className="mb-12">
          <h1
            className={`${headingFont.className} text-4xl font-bold text-[#2f1b0f] mb-4`}
          >
            注文管理ダッシュボード
          </h1>
          {feedback && (
            <p
              role={feedback.type === "error" ? "alert" : "status"}
              aria-live={feedback.type === "error" ? "assertive" : "polite"}
              className={`text-sm ${feedback.type === "error" ? "text-red-700" : "text-green-700"}`}
            >
              {feedback.text}
            </p>
          )}
          {ordersNeedRefresh ? (
            <button
              ref={ordersRefreshButtonRef}
              type="button"
              onClick={refreshOrders}
              disabled={isRefreshingOrders || pendingOrderActionKey !== null}
              aria-busy={isRefreshingOrders}
              className="mt-3 rounded border border-[#2f1b0f] px-4 py-2 text-sm font-semibold text-[#2f1b0f] transition hover:bg-white/60 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isRefreshingOrders ? "再取得中..." : "注文一覧を再取得"}
            </button>
          ) : null}
        </header>

        {/* 銀行情報セクション */}
        <div className={`${bodySerif.className} bg-white p-6 rounded-lg border border-gray-300 mb-12`}>
          <h2 className="text-2xl font-semibold text-[#2f1b0f] mb-4">銀行振込先情報</h2>

          {!showBankForm ? (
            <>
              {bankAccountError ? (
                <p role="alert" className="mb-4 rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                  {bankAccountError}
                </p>
              ) : bankAccount ? (
                <div className="bg-gray-50 p-4 rounded mb-4">
                  <p>
                    <strong>銀行:</strong> {bankAccount.bank_name}
                  </p>
                  <p>
                    <strong>支店:</strong> {bankAccount.branch_name}
                  </p>
                  <p>
                    <strong>口座種別:</strong> {bankAccount.account_type}
                  </p>
                  <p>
                    <strong>口座番号:</strong> {bankAccount.account_number}
                  </p>
                  <p>
                    <strong>口座名義:</strong> {bankAccount.account_holder}
                  </p>
                </div>
              ) : (
                <p className="text-gray-600 mb-4">銀行情報が未設定です</p>
              )}
              <button
                onClick={() => {
                  setEditingBank(
                    bankAccount || {
                      id: "",
                      bank_name: "",
                      branch_name: "",
                      account_type: "",
                      account_number: "",
                      account_holder: "",
                    }
                  );
                  setShowBankForm(true);
                }}
                className="px-4 py-2 bg-[#2f1b0f] text-white rounded hover:brightness-110 transition"
              >
                {bankAccount ? "編集" : "追加"}
              </button>
            </>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-[#2f1b0f] mb-1">
                  銀行名
                </label>
                <input
                  type="text"
                  value={editingBank?.bank_name || ""}
                  onChange={(e) =>
                    setEditingBank({
                      ...editingBank!,
                      bank_name: e.target.value,
                    })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-[#2f1b0f] mb-1">
                  支店名
                </label>
                <input
                  type="text"
                  value={editingBank?.branch_name || ""}
                  onChange={(e) =>
                    setEditingBank({
                      ...editingBank!,
                      branch_name: e.target.value,
                    })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-[#2f1b0f] mb-1">
                  口座種別
                </label>
                <select
                  value={editingBank?.account_type || ""}
                  onChange={(e) =>
                    setEditingBank({
                      ...editingBank!,
                      account_type: e.target.value,
                    })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded"
                >
                  <option value="">選択してください</option>
                  <option value="普通">普通</option>
                  <option value="当座">当座</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-[#2f1b0f] mb-1">
                  口座番号
                </label>
                <input
                  type="text"
                  value={editingBank?.account_number || ""}
                  onChange={(e) =>
                    setEditingBank({
                      ...editingBank!,
                      account_number: e.target.value,
                    })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-[#2f1b0f] mb-1">
                  口座名義
                </label>
                <input
                  type="text"
                  value={editingBank?.account_holder || ""}
                  onChange={(e) =>
                    setEditingBank({
                      ...editingBank!,
                      account_holder: e.target.value,
                    })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={saveBankAccount}
                  className="px-4 py-2 bg-green-600 text-white rounded hover:brightness-110 transition"
                >
                  保存
                </button>
                <button
                  onClick={() => {
                    setShowBankForm(false);
                    setEditingBank(null);
                  }}
                  className="px-4 py-2 bg-gray-400 text-white rounded hover:brightness-110 transition"
                >
                  キャンセル
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 注文一覧セクション */}
        <div className={`${bodySerif.className} bg-white p-6 rounded-lg border border-gray-300`}>
          <h2 className="text-2xl font-semibold text-[#2f1b0f] mb-4">注文一覧</h2>

          {ordersError ? (
            <p role="alert" className="rounded border border-amber-300 bg-amber-50 px-4 py-8 text-center text-sm text-amber-900">
              {ordersError}
            </p>
          ) : orders.length === 0 ? (
            <p className="text-gray-600 text-center py-8">注文はまだありません</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-gray-100 border-b-2 border-gray-300">
                    <th className="px-4 py-3 text-left font-semibold text-[#2f1b0f]">
                      注文日時
                    </th>
                    <th className="px-4 py-3 text-left font-semibold text-[#2f1b0f]">
                      顧客名
                    </th>
                    <th className="px-4 py-3 text-left font-semibold text-[#2f1b0f]">
                      支払い方法
                    </th>
                    <th className="px-4 py-3 text-left font-semibold text-[#2f1b0f]">
                      金額
                    </th>
                    <th className="px-4 py-3 text-left font-semibold text-[#2f1b0f]">
                      ステータス
                    </th>
                    <th className="px-4 py-3 text-left font-semibold text-[#2f1b0f]">
                      アクション
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order) => (
                    <tr key={order.id} className="border-b border-gray-200 hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm">
                        {new Date(order.created_at).toLocaleString("ja-JP")}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <div className="font-semibold text-[#2f1b0f]">{order.customer_name}</div>
                        <div className="text-xs text-gray-600">{order.email}</div>
                        <div className="text-xs text-gray-600">{order.phone}</div>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {getPaymentMethodLabel(order.payment_method)}
                        {(order.payment_method === "PAY_IN_STORE" || order.payment_method === "cash-store") && order.store_visit_date && (
                          <div className="text-xs text-gray-600 mt-1">
                            来店日: {order.store_visit_date}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm font-semibold">
                        ¥{order.total.toLocaleString("ja-JP")}
                      </td>
                      <td className="px-4 py-3">{getStatusBadge(order.status)}</td>
                      <td className="px-4 py-3 text-sm space-y-2">
                        <div>
                          {order.status === "PENDING_PAYMENT" &&
                            (order.payment_method === "BANK_TRANSFER" ||
                              order.payment_method === "bank-transfer") && (
                            <button
                              onClick={async () => {
                                const paymentReference = window.prompt("8桁の参照コードを入力してください");
                                if (!paymentReference) return;
                                const receivedAmountText = window.prompt(
                                  "入金額を入力してください",
                                  String(order.total)
                                );
                                if (!receivedAmountText) return;
                                const receivedAmount = Number(receivedAmountText);
                                if (!Number.isFinite(receivedAmount)) {
                                  setFeedback({ type: "error", text: "入金額が不正です" });
                                  return;
                                }
                                const updated = await performOrderAction(order, "MARK_PAID", {
                                  paymentReference,
                                  receivedAmount,
                                });
                                if (updated === "confirmed") {
                                  setFeedback({ type: "success", text: "入金済みに更新しました" });
                                }
                              }}
                              disabled={pendingOrderActionKey !== null || ordersNeedRefresh}
                              className="px-3 py-1 bg-yellow-500 text-white rounded text-xs hover:brightness-110 transition disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {pendingOrderActionKey === `${order.id}:MARK_PAID` ? "更新中..." : "入金確認"}
                            </button>
                          )}
                          {order.status === "PENDING_PAYMENT" &&
                            (order.payment_method === "PAY_IN_STORE" ||
                              order.payment_method === "cash-store") && (
                            <button
                              onClick={async () => {
                                const receivedAmountText = window.prompt(
                                  "受領額を入力してください",
                                  String(order.total)
                                );
                                if (!receivedAmountText) return;
                                const receivedAmount = Number(receivedAmountText);
                                if (!Number.isFinite(receivedAmount)) {
                                  setFeedback({ type: "error", text: "受領額が不正です" });
                                  return;
                                }
                                const updated = await performOrderAction(order, "MARK_COLLECTED", {
                                  receivedAmount,
                                });
                                if (updated === "confirmed") {
                                  setFeedback({ type: "success", text: "受領済みに更新しました" });
                                }
                              }}
                              disabled={pendingOrderActionKey !== null || ordersNeedRefresh}
                              className="px-3 py-1 bg-blue-500 text-white rounded text-xs hover:brightness-110 transition disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {pendingOrderActionKey === `${order.id}:MARK_COLLECTED` ? "更新中..." : "受領済み"}
                            </button>
                          )}
                          {order.status === "PAID" && (
                            <button
                              onClick={async () => {
                                const updated = await performOrderAction(order, "MARK_SHIPPED", {});
                                if (updated === "confirmed") {
                                  setFeedback({ type: "success", text: "発送済みに更新しました" });
                                }
                              }}
                              disabled={pendingOrderActionKey !== null || ordersNeedRefresh}
                              className="px-3 py-1 bg-green-600 text-white rounded text-xs hover:brightness-110 transition disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {pendingOrderActionKey === `${order.id}:MARK_SHIPPED` ? "更新中..." : "発送完了"}
                            </button>
                          )}
                          {(order.status === "QUOTED" || order.status === "PENDING_PAYMENT") && (
                            <button
                              onClick={async () => {
                                const reasonCode = window.prompt(
                                  "キャンセル理由コードを入力してください",
                                  "ADMIN_CANCELLED"
                                )?.trim();
                                if (!reasonCode) return;
                                if (!window.confirm("この注文をキャンセルします。続行しますか？")) return;

                                const updated = await performOrderAction(order, "CANCEL", {
                                  reasonCode,
                                  adminNote: "管理画面からキャンセル",
                                });
                                if (updated === "confirmed") {
                                  setFeedback({ type: "success", text: "注文をキャンセルしました" });
                                }
                              }}
                              disabled={pendingOrderActionKey !== null || ordersNeedRefresh}
                              className="px-3 py-1 bg-red-600 text-white rounded text-xs hover:brightness-110 transition disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {pendingOrderActionKey === `${order.id}:CANCEL` ? "更新中..." : "キャンセル"}
                            </button>
                          )}
                        </div>
                        <button
                          onClick={() => {
                            const details = `
顧客情報:
- 名前: ${order.customer_name}
- メール: ${order.email}
- 電話: ${order.phone}
- 住所: ${order.zip_code} ${order.prefecture}${order.city}${order.address}${order.building || ""}

商品:
${order.items.map((item) => `- ${item.name} × ${item.quantity}: ¥${(item.price * item.quantity).toLocaleString("ja-JP")}`).join("\n")}

合計: ¥${order.total.toLocaleString("ja-JP")}
`;
                            alert(details);
                          }}
                          className="block px-3 py-1 bg-gray-500 text-white rounded text-xs hover:brightness-110 transition"
                        >
                          詳細
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
