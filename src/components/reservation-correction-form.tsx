"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function ReservationCorrectionForm({
  id,
  date,
  servicePeriod,
  partySize,
  arrivalTime,
  name,
  phone,
  note,
  updatedAt,
}: {
  id: string;
  date: string;
  servicePeriod: "LUNCH" | "DINNER";
  partySize: number;
  arrivalTime: string | null;
  name: string;
  phone: string;
  note: string | null;
  updatedAt: string;
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    date,
    servicePeriod,
    partySize: String(partySize),
    arrivalTime: arrivalTime ?? "",
    name,
    phone,
    note: note ?? "",
    reason: "",
  });
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/reservations/${id}/correction`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify({
          ...form,
          partySize: Number(form.partySize),
          arrivalTime: form.arrivalTime || null,
          note: form.note || null,
          expectedUpdatedAt: updatedAt,
        }),
      });
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        setError(data?.error ?? "予約訂正に失敗しました。");
        return;
      }
      setMessage("予約内容を訂正しました。変更履歴も記録されています。");
      router.refresh();
    } catch {
      setError("通信に失敗しました。再操作せず、再読み込みして状態を確認してください。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="card space-y-3 p-4">
      <h2 className="font-semibold">予約内容を訂正</h2>
      <p className="text-xs text-gray-600">訂正前後と理由が監査ログに保存されます。人数・日時変更は席数と重複を再確認します。</p>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="grid gap-1 text-sm">日付<input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} className="rounded border px-2 py-2" /></label>
        <label className="grid gap-1 text-sm">時間帯<select value={form.servicePeriod} onChange={(event) => setForm({ ...form, servicePeriod: event.target.value as "LUNCH" | "DINNER" })} className="rounded border px-2 py-2"><option value="LUNCH">ランチ</option><option value="DINNER">ディナー</option></select></label>
        <label className="grid gap-1 text-sm">人数<input type="number" min={1} max={12} value={form.partySize} onChange={(event) => setForm({ ...form, partySize: event.target.value })} className="rounded border px-2 py-2" /></label>
        <label className="grid gap-1 text-sm">来店目安<input type="time" value={form.arrivalTime} onChange={(event) => setForm({ ...form, arrivalTime: event.target.value })} className="rounded border px-2 py-2" /></label>
        <label className="grid gap-1 text-sm">氏名<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="rounded border px-2 py-2" /></label>
        <label className="grid gap-1 text-sm">電話<input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} className="rounded border px-2 py-2" /></label>
      </div>
      <label className="grid gap-1 text-sm">予約メモ<textarea value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} className="min-h-20 rounded border px-2 py-2" maxLength={2000} /></label>
      <label className="grid gap-1 text-sm">訂正理由（必須）<textarea value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} className="min-h-16 rounded border px-2 py-2" maxLength={500} required /></label>
      <Button type="submit" disabled={saving}>{saving ? "訂正中..." : "訂正を保存"}</Button>
      {message ? <p role="status" className="text-sm text-green-700">{message}</p> : null}
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
    </form>
  );
}
