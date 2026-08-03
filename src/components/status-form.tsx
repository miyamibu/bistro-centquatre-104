"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { ReservationStatus } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { getReservationStatusLabel } from "@/lib/reservation-labels";

const terminalStatuses = new Set<ReservationStatus>([
  ReservationStatus.CANCELLED,
  ReservationStatus.DONE,
  ReservationStatus.NOSHOW,
]);

type StatusMessage = {
  type: "success" | "error" | "info";
  text: string;
};

const STATUS_UPDATE_TIMEOUT_MS = 20_000;

export function StatusForm({
  id,
  current,
  isPrivateBlock = false,
  expectedDate,
  expectedServicePeriod,
  expectedReservationType,
}: {
  id: string;
  current: ReservationStatus;
  isPrivateBlock?: boolean;
  expectedDate?: string;
  expectedServicePeriod?: "LUNCH" | "DINNER";
  expectedReservationType?: "NORMAL" | "PRIVATE_BLOCK";
}) {
  const router = useRouter();
  const selectId = useId();
  const [currentStatus, setCurrentStatus] = useState<ReservationStatus>(current);
  const [status, setStatus] = useState<ReservationStatus>(current);
  const [message, setMessage] = useState<StatusMessage | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusUncertain, setStatusUncertain] = useState(false);
  const isTerminal = terminalStatuses.has(currentStatus);
  const allowedStatuses = isTerminal
    ? [currentStatus]
    : isPrivateBlock
    ? [ReservationStatus.CONFIRMED, ReservationStatus.CANCELLED]
    : [
        ReservationStatus.CONFIRMED,
        ReservationStatus.CANCELLED,
        ReservationStatus.DONE,
        ReservationStatus.NOSHOW,
      ];

  async function submitStatus(nextStatus: ReservationStatus) {
    if (
      isPrivateBlock &&
      nextStatus !== ReservationStatus.CONFIRMED &&
      nextStatus !== ReservationStatus.CANCELLED
    ) {
      setStatus(currentStatus);
      setMessage({ type: "error", text: "貸切はキャンセル以外の終端状態へ変更できません" });
      return;
    }

    if (!isTerminal && terminalStatuses.has(nextStatus)) {
      const confirmed = window.confirm(
        `この予約を「${getReservationStatusLabel(nextStatus)}」へ変更します。以後は通常の予約操作で復帰できません。よろしいですか？`,
      );
      if (!confirmed) {
        setStatus(currentStatus);
        setMessage({ type: "info", text: "ステータス変更をキャンセルしました" });
        return;
      }
    }

    let operatorName: string | undefined;
    if (isPrivateBlock && nextStatus === ReservationStatus.CANCELLED) {
      const input = window.prompt("貸切解除の担当者名を入力してください");
      if (input == null) {
        setStatus(currentStatus);
        setMessage({ type: "info", text: "解除をキャンセルしました" });
        return;
      }

      const trimmed = input.trim();
      if (!trimmed) {
        setStatus(currentStatus);
        setMessage({ type: "error", text: "担当者名は必須です" });
        return;
      }

      operatorName = trimmed;
    }

    setLoading(true);
    setMessage(null);
    const previousStatus = currentStatus;
    setStatus(nextStatus);
    let timeoutId: number | null = null;
    try {
      const controller = new AbortController();
      timeoutId = window.setTimeout(() => controller.abort(), STATUS_UPDATE_TIMEOUT_MS);
      const res = await fetch(`/api/admin/reservations/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify({
          status: nextStatus,
          operatorName,
          ...(isPrivateBlock && nextStatus === ReservationStatus.CANCELLED
            ? {
                expectedDate,
                expectedServicePeriod,
                expectedReservationType,
              }
            : {}),
        }),
        signal: controller.signal,
      });
      if (res.ok) {
        setCurrentStatus(nextStatus);
        setMessage({
          type: "success",
          text: `ステータスを「${getReservationStatusLabel(nextStatus)}」に更新しました`,
        });
        router.refresh();
      } else {
        const data = await res.json().catch(() => ({}));
        setStatus(previousStatus);
        setMessage({ type: "error", text: `更新に失敗しました: ${data.error ?? res.status}` });
      }
    } catch (error) {
      setStatus(previousStatus);
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

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await submitStatus(status);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <label htmlFor={selectId} className="text-sm text-gray-700">ステータス更新</label>
      <select
        id={selectId}
        className="w-full rounded border px-3 py-2"
        value={status}
        onChange={(e) => setStatus(e.target.value as ReservationStatus)}
        disabled={isTerminal || loading || statusUncertain}
      >
        {allowedStatuses.map((s) => (
          <option key={s} value={s}>
            {getReservationStatusLabel(s)}
          </option>
        ))}
      </select>
      <Button type="submit" disabled={loading || isTerminal || statusUncertain}>
        {loading ? "更新中..." : "更新"}
      </Button>
      {!isTerminal && (
        <div className="flex flex-wrap gap-2 text-sm">
          <Button
            type="button"
            variant="outline"
            disabled={loading || statusUncertain}
            onClick={() => submitStatus(ReservationStatus.CANCELLED)}
          >
            キャンセルにする
          </Button>
          {!isPrivateBlock ? (
            <Button
              type="button"
              variant="outline"
              disabled={loading || statusUncertain}
              onClick={() => submitStatus(ReservationStatus.DONE)}
            >
              来店済みにする
            </Button>
          ) : null}
        </div>
      )}
      {message && (
        <p
          role={message.type === "error" ? "alert" : "status"}
          aria-live={message.type === "error" ? "assertive" : "polite"}
          className={`text-sm ${
            message.type === "error"
              ? "text-red-700"
              : message.type === "success"
                ? "text-green-700"
                : "text-gray-700"
          }`}
        >
          {message.text}
        </p>
      )}
      {statusUncertain ? (
        <Button type="button" variant="outline" onClick={() => window.location.reload()}>
          再読み込みして状態を確認
        </Button>
      ) : null}
    </form>
  );
}
