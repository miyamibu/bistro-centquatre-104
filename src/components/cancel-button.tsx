"use client";

import { useState } from "react";
import { ReservationStatus } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";

type CancelMessage = {
  type: "success" | "error" | "info";
  text: string;
};

const CANCELLATION_TIMEOUT_MS = 20_000;

export default function CancelButton({
  id,
  disabled,
  label,
  requireOperatorName,
}: {
  id: string;
  disabled?: boolean;
  label?: string;
  requireOperatorName?: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<CancelMessage | null>(null);
  const [statusUncertain, setStatusUncertain] = useState(false);
  const router = useRouter();

  async function cancel() {
    if (!requireOperatorName && !window.confirm("この予約をキャンセル済みに変更します。よろしいですか？")) {
      setMessage({ type: "info", text: "キャンセル操作を取り消しました" });
      return;
    }

    let operatorName: string | undefined;
    if (requireOperatorName) {
      const input = window.prompt("貸切解除の担当者名を入力してください");
      if (input == null) {
        setMessage({ type: "info", text: "解除をキャンセルしました" });
        return;
      }

      const trimmed = input.trim();
      if (!trimmed) {
        setMessage({ type: "error", text: "担当者名は必須です" });
        return;
      }

      operatorName = trimmed;
    }

    setLoading(true);
    setMessage(null);
    let timeoutId: number | null = null;
    try {
      const controller = new AbortController();
      timeoutId = window.setTimeout(() => controller.abort(), CANCELLATION_TIMEOUT_MS);
      const res = await fetch(`/api/admin/reservations/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify({ status: ReservationStatus.CANCELLED, operatorName }),
        signal: controller.signal,
      });
      if (res.ok) {
        setMessage({
          type: "success",
          text: requireOperatorName ? "貸切を解除しました" : "キャンセル済みにしました",
        });
        router.refresh();
      } else {
        const data = await res.json().catch(() => ({}));
        setMessage({ type: "error", text: `失敗: ${data.error ?? res.status}` });
      }
    } catch (error) {
      setStatusUncertain(true);
      setMessage({
        type: "error",
        text:
          error instanceof DOMException && error.name === "AbortError"
            ? "通信がタイムアウトしました。サーバー側で処理された可能性があります。再操作せず、再読み込みして状態を確認してください。"
            : "通信に失敗しました。サーバー側で処理された可能性があります。再操作せず、再読み込みして状態を確認してください。",
      });
    } finally {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <Button
        variant="outline"
        size="sm"
        disabled={disabled || loading || statusUncertain}
        onClick={cancel}
      >
        {loading ? "処理中..." : label ?? "キャンセル"}
      </Button>
      {message && (
        <span
          role={message.type === "error" ? "alert" : "status"}
          aria-live={message.type === "error" ? "assertive" : "polite"}
          className={`text-xs ${
            message.type === "error"
              ? "text-red-700"
              : message.type === "success"
                ? "text-green-700"
                : "text-gray-600"
          }`}
        >
          {message.text}
        </span>
      )}
      {statusUncertain ? (
        <Button type="button" variant="outline" size="sm" onClick={() => window.location.reload()}>
          再読み込みして状態を確認
        </Button>
      ) : null}
    </div>
  );
}
