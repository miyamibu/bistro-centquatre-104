"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { ReservationStatus } from "@prisma/client";
import { Button } from "@/components/ui/button";

export function StatusForm({
  id,
  current,
  isPrivateBlock = false,
}: {
  id: string;
  current: ReservationStatus;
  isPrivateBlock?: boolean;
}) {
  const router = useRouter();
  const selectId = useId();
  const [currentStatus, setCurrentStatus] = useState<ReservationStatus>(current);
  const [status, setStatus] = useState<ReservationStatus>(current);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const isTerminal =
    currentStatus === ReservationStatus.CANCELLED ||
    currentStatus === ReservationStatus.DONE ||
    currentStatus === ReservationStatus.NOSHOW;
  const allowedStatuses = isTerminal
    ? [currentStatus]
    : [
        ReservationStatus.CONFIRMED,
        ReservationStatus.CANCELLED,
        ReservationStatus.DONE,
        ReservationStatus.NOSHOW,
      ];

  async function submitStatus(nextStatus: ReservationStatus) {
    let operatorName: string | undefined;
    if (isPrivateBlock && nextStatus === ReservationStatus.CANCELLED) {
      const input = window.prompt("貸切解除の担当者名を入力してください");
      if (input == null) {
        setMessage("解除をキャンセルしました");
        return;
      }

      const trimmed = input.trim();
      if (!trimmed) {
        setMessage("担当者名は必須です");
        return;
      }

      operatorName = trimmed;
    }

    setLoading(true);
    setMessage(null);
    const previousStatus = currentStatus;
    setStatus(nextStatus);
    const res = await fetch(`/api/admin/reservations/${id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: JSON.stringify({ status: nextStatus, operatorName }),
    });
    if (res.ok) {
      setCurrentStatus(nextStatus);
      setMessage(`ステータスを ${nextStatus} に更新しました`);
      router.refresh();
    } else {
      const data = await res.json().catch(() => ({}));
      setStatus(previousStatus);
      setMessage(`更新に失敗しました: ${data.error ?? res.status}`);
    }
    setLoading(false);
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
        disabled={isTerminal || loading}
      >
        {allowedStatuses.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <Button type="submit" disabled={loading || isTerminal}>
        {loading ? "更新中..." : "更新"}
      </Button>
      {!isTerminal && (
        <div className="flex flex-wrap gap-2 text-sm">
          <Button
            type="button"
            variant="outline"
            disabled={loading}
            onClick={() => submitStatus(ReservationStatus.CANCELLED)}
          >
            キャンセルにする
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={loading}
            onClick={() => submitStatus(ReservationStatus.DONE)}
          >
            来店済みにする
          </Button>
        </div>
      )}
      {message && (
        <p role="status" aria-live="polite" className="text-sm text-gray-700">
          {message}
        </p>
      )}
    </form>
  );
}
