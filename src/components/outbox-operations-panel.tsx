"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Lane = "RESERVATION_EMAIL" | "ORDER_NOTIFICATION";

type StatusPayload = {
  warning: boolean;
  staleLanes: Lane[];
  backlog: {
    reservation: { count: number; oldestAt: string | null };
    order: { count: number; oldestAt: string | null };
  };
};

type DrainPayload = {
  ok: boolean;
  dryRun: boolean;
  lane: Lane;
  scanned: number;
  sent: number;
  failed: number;
  deadLetter: number;
  backlog: number;
};

export function OutboxOperationsPanel() {
  const [lane, setLane] = useState<Lane>("RESERVATION_EMAIL");
  const [limit, setLimit] = useState(10);
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [result, setResult] = useState<DrainPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const openButtonRef = useRef<HTMLButtonElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const loadStatus = useCallback(async () => {
    const response = await fetch("/api/admin/outbox/status", { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "状態取得に失敗しました");
    setStatus(body as StatusPayload);
  }, []);

  useEffect(() => {
    loadStatus().catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, [loadStatus]);

  useEffect(() => {
    if (!confirmOpen) return;
    cancelButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setConfirmOpen(false);
        openButtonRef.current?.focus();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), select:not([disabled]), input:not([disabled]), [href]',
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [confirmOpen]);

  async function drain(dryRun: boolean) {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/outbox/drain", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify({ lane, limit, dryRun, confirm: !dryRun }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Outbox再処理に失敗しました");
      setResult(body as DrainPayload);
      await loadStatus();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
      setConfirmOpen(false);
      openButtonRef.current?.focus();
    }
  }

  return (
    <div className="space-y-6">
      {status?.warning ? (
        <div role="alert" className="rounded-xl border border-amber-500 bg-amber-50 p-4 text-sm text-amber-950">
          GitHub schedulerの正常heartbeatが15分以上ありません。対象: {status.staleLanes.join(", ")}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <BacklogCard title="予約メール" value={status?.backlog.reservation.count} oldest={status?.backlog.reservation.oldestAt} />
        <BacklogCard title="注文通知" value={status?.backlog.order.count} oldest={status?.backlog.order.oldestAt} />
      </div>

      <div className="space-y-4 rounded-2xl border border-[#eadfce] bg-white p-4 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-2 text-sm font-medium">
            処理レーン
            <select value={lane} onChange={(event) => setLane(event.target.value as Lane)} className="min-h-11 rounded-md border px-3">
              <option value="RESERVATION_EMAIL">予約メール</option>
              <option value="ORDER_NOTIFICATION">注文通知</option>
            </select>
          </label>
          <label className="grid gap-2 text-sm font-medium">
            最大件数（1〜20）
            <input type="number" min={1} max={20} value={limit} onChange={(event) => setLimit(Math.max(1, Math.min(20, Number(event.target.value) || 1)))} className="min-h-11 rounded-md border px-3" />
          </label>
        </div>
        <div className="flex flex-wrap gap-3">
          <button type="button" disabled={loading} onClick={() => drain(true)} className="min-h-11 rounded-full border border-[#8a6233] px-5 font-semibold text-[#8a6233] disabled:opacity-50">
            dry-run
          </button>
          <button ref={openButtonRef} type="button" disabled={loading} onClick={() => setConfirmOpen(true)} className="min-h-11 rounded-full bg-[#7a5528] px-5 font-semibold text-white disabled:opacity-50">
            再処理を確認
          </button>
        </div>
        {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
        {result ? (
          <p role="status" className="text-sm text-[#4a3121]">
            {result.dryRun ? "dry-run" : "実行"}: scanned={result.scanned}, sent={result.sent}, failed={result.failed}, dead-letter={result.deadLetter}, backlog={result.backlog}
          </p>
        ) : null}
      </div>

      {confirmOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setConfirmOpen(false); }}>
          <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="outbox-confirm-title" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h2 id="outbox-confirm-title" className="text-xl font-semibold">Outbox再処理の確認</h2>
            <p className="mt-3 text-sm leading-6 text-[#6b5644]">{lane === "RESERVATION_EMAIL" ? "予約メール" : "注文通知"}を最大{limit}件処理します。claim lockと冪等キーにより二重送信を防ぎます。</p>
            <div className="mt-6 flex justify-end gap-3">
              <button ref={cancelButtonRef} type="button" onClick={() => { setConfirmOpen(false); openButtonRef.current?.focus(); }} className="min-h-11 rounded-full border px-5">戻る</button>
              <button type="button" disabled={loading} onClick={() => drain(false)} className="min-h-11 rounded-full bg-[#7a5528] px-5 font-semibold text-white disabled:opacity-50">実行する</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function BacklogCard({ title, value, oldest }: { title: string; value?: number; oldest?: string | null }) {
  return (
    <div className="rounded-xl border border-[#eadfce] bg-[#fffdfa] p-4">
      <p className="text-sm text-[#6b5644]">{title}</p>
      <p className="mt-1 text-2xl font-semibold">{value ?? "—"}件</p>
      <p className="mt-1 break-all text-xs text-[#6b5644]">最古: {oldest ?? "なし"}</p>
    </div>
  );
}
