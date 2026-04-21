"use client";

import { useState } from "react";
import { ReservationStatus } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";

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
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();

  async function cancel() {
    let operatorName: string | undefined;
    if (requireOperatorName) {
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
    const res = await fetch(`/api/admin/reservations/${id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: JSON.stringify({ status: ReservationStatus.CANCELLED, operatorName }),
    });
    if (res.ok) {
      setMessage(requireOperatorName ? "貸切を解除しました" : "キャンセル済みにしました");
      router.refresh();
    } else {
      const data = await res.json().catch(() => ({}));
      setMessage(`失敗: ${data.error ?? res.status}`);
    }
    setLoading(false);
  }

  return (
    <div className="flex flex-col gap-1">
      <Button
        variant="outline"
        size="sm"
        disabled={disabled || loading}
        onClick={cancel}
      >
        {loading ? "処理中..." : label ?? "キャンセル"}
      </Button>
      {message && <span className="text-xs text-gray-600">{message}</span>}
    </div>
  );
}
