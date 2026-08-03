"use client";

import { useEffect, useRef, useState } from "react";
import { CONTACT_PHONE_DISPLAY, CONTACT_TEL_LINK } from "@/lib/contact";

type ReservationStatus = "CONFIRMED" | "CANCELLED" | "DONE" | "NOSHOW";

type ManagedReservation = {
  id: string;
  date: string;
  servicePeriod: "LUNCH" | "DINNER";
  partySize: number;
  arrivalTime: string | null;
  name: string;
  note: string | null;
  status: ReservationStatus;
};

type ManagementResponse = {
  reservation?: ManagedReservation;
  alreadyCancelled?: boolean;
  customerEmailQueued?: boolean;
  error?: string;
  code?: string;
};

type ViewState =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "error"; message: string }
  | { kind: "ready"; reservation: ManagedReservation; notice?: string };

function getTokenFromHash() {
  if (typeof window === "undefined") return null;
  const value = window.location.hash.replace(/^#/, "");
  return new URLSearchParams(value).get("token");
}

function getStatusLabel(status: ReservationStatus) {
  switch (status) {
    case "CONFIRMED":
      return "予約確定";
    case "CANCELLED":
      return "キャンセル済み";
    case "DONE":
      return "来店済み";
    case "NOSHOW":
      return "無断キャンセル";
  }
}

async function fetchManagement(token: string, action: "lookup" | "cancel" | "resend") {
  const response = await fetch("/api/reservations/manage", {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
    },
    body: JSON.stringify({ token, action }),
  });
  const body = (await response.json().catch(() => ({}))) as ManagementResponse;
  if (!response.ok || !body.reservation) {
    const error = new Error(body.error ?? "予約管理リンクを確認できませんでした。");
    (error as Error & { code?: string }).code = body.code;
    throw error;
  }
  return body;
}

export function ReservationManageClient() {
  const tokenRef = useRef<string | null>(null);
  const [state, setState] = useState<ViewState>({ kind: "loading" });
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);

  useEffect(() => {
    let active = true;
    const token = getTokenFromHash();
    tokenRef.current = token;

    if (!token) {
      setState({ kind: "missing" });
      return () => {
        active = false;
      };
    }

    setState({ kind: "loading" });
    fetchManagement(token, "lookup")
      .then((body) => {
        if (!active || !body.reservation) return;
        setState({
          kind: "ready",
          reservation: body.reservation,
          ...(body.alreadyCancelled ? { notice: "この予約はすでにキャンセル済みです。" } : {}),
        });
      })
      .catch(() => {
        if (active) {
          setState({
            kind: "error",
            message: "予約管理リンクが無効か、期限切れです。お電話でご確認ください。",
          });
        }
      });

    return () => {
      active = false;
    };
  }, []);

  async function cancelReservation() {
    const token = tokenRef.current;
    if (!token || state.kind !== "ready" || state.reservation.status !== "CONFIRMED") {
      return;
    }

    if (!window.confirm("この予約をキャンセルしますか？")) return;

    setSubmitting(true);
    try {
      const body = await fetchManagement(token, "cancel");
      if (body.reservation) {
        setState({
          kind: "ready",
          reservation: body.reservation,
          notice: body.alreadyCancelled
            ? "この予約はすでにキャンセル済みです。"
            : "予約をキャンセルしました。",
        });
      }
    } catch (error) {
      const code = error instanceof Error ? (error as Error & { code?: string }).code : undefined;
      setState({
        kind: "ready",
        reservation: state.reservation,
        notice:
          code === "RESERVATION_NOT_CANCELLABLE"
            ? "来店済み、または無断キャンセルの予約はWebから変更できません。お電話でご確認ください。"
            : code === "CANCELLATION_CUTOFF_PASSED"
              ? "Webキャンセルの受付期限を過ぎています。変更・キャンセルはお電話でご相談ください。"
              : code === "CANCELLATION_POLICY_UNAVAILABLE"
                ? "キャンセル期限を判定できません。お電話でご相談ください。"
                : "予約の状態が変わったため、キャンセルできませんでした。ページを再読み込みしてご確認ください。",
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function resendConfirmation() {
    const token = tokenRef.current;
    if (!token || state.kind !== "ready" || state.reservation.status !== "CONFIRMED") {
      return;
    }

    setResending(true);
    try {
      const body = await fetchManagement(token, "resend");
      if (body.reservation) {
        setState({
          kind: "ready",
          reservation: body.reservation,
          notice: "予約確認メールの再送を受け付けました。数分待っても届かない場合は迷惑メールをご確認ください。",
        });
      }
    } catch (error) {
      const code = error instanceof Error ? (error as Error & { code?: string }).code : undefined;
      setState({
        kind: "ready",
        reservation: state.reservation,
        notice:
          code === "CUSTOMER_CONTACT_NOT_CONFIGURED"
            ? "この予約にはメールアドレスが登録されていません。お電話でご確認ください。"
            : "確認メールを再送できませんでした。時間をおいて再度お試しください。",
      });
    } finally {
      setResending(false);
    }
  }

  if (state.kind === "loading") {
    return (
      <div role="status" aria-live="polite" className="card bg-[#fffdfa] p-6 text-sm text-[#6b5644]">
        予約内容を確認しています...
      </div>
    );
  }

  if (state.kind === "missing") {
    return (
      <ManagementFallback message="予約完了画面の管理リンクから開いてください。" />
    );
  }

  if (state.kind === "error") {
    return <ManagementFallback message={state.message} />;
  }

  const { reservation } = state;
  const servicePeriodLabel = reservation.servicePeriod === "LUNCH" ? "ランチ" : "ディナー";

  return (
    <div className="space-y-4">
      <div
        role="status"
        aria-live="polite"
        className="card space-y-4 border-[#cfa96d]/35 bg-[#fffdfa] p-6 text-[#4a3121] md:p-8"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold text-[#2f1b0f]">予約内容</h2>
          <span className="rounded-full border border-[#cfa96d]/50 px-3 py-1 text-sm font-semibold">
            {getStatusLabel(reservation.status)}
          </span>
        </div>
        {state.notice ? <p className="rounded-md bg-[#fff7e6] px-3 py-2 text-sm">{state.notice}</p> : null}
        <dl className="grid gap-3 text-sm leading-6 sm:grid-cols-2">
          <div>
            <dt className="text-[#6b5644]">予約番号</dt>
            <dd className="break-all font-semibold text-[#2f1b0f]">{reservation.id}</dd>
          </div>
          <div>
            <dt className="text-[#6b5644]">お名前</dt>
            <dd className="font-semibold text-[#2f1b0f]">{reservation.name}</dd>
          </div>
          <div>
            <dt className="text-[#6b5644]">ご来店日</dt>
            <dd>{reservation.date}</dd>
          </div>
          <div>
            <dt className="text-[#6b5644]">時間帯</dt>
            <dd>{servicePeriodLabel}</dd>
          </div>
          <div>
            <dt className="text-[#6b5644]">来店時間</dt>
            <dd>{reservation.arrivalTime ?? "店舗へお問い合わせください"}</dd>
          </div>
          <div>
            <dt className="text-[#6b5644]">人数</dt>
            <dd>{reservation.partySize}名</dd>
          </div>
        </dl>
        {reservation.status === "CONFIRMED" ? (
          <div className="space-y-2 border-t border-[#eadfce] pt-4">
            <p className="text-sm leading-6 text-[#6b5644]">
              Webからの無料キャンセルはご来店時刻の24時間前までです。期限後の変更・キャンセルはお電話でご相談ください。現在、キャンセル料の設定・自動請求はありません。
            </p>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={cancelReservation}
                disabled={submitting || resending}
                className="inline-flex min-h-11 items-center justify-center rounded-full border border-[#8f2a2a] px-5 py-2 text-sm font-semibold text-[#8f2a2a] transition hover:bg-[#fff1f1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8f2a2a]/30 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? "キャンセル処理中..." : "この予約をキャンセルする"}
              </button>
              <button
                type="button"
                onClick={resendConfirmation}
                disabled={submitting || resending}
                className="inline-flex min-h-11 items-center justify-center rounded-full border border-[#7a5528] px-5 py-2 text-sm font-semibold text-[#7a5528] transition hover:bg-[#fff7e6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7a5528]/30 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {resending ? "再送受付中..." : "確認メールを再送する"}
              </button>
            </div>
          </div>
        ) : reservation.status === "CANCELLED" ? (
          <p className="border-t border-[#eadfce] pt-4 text-sm text-[#6b5644]">
            この予約はキャンセル済みです。再予約は予約ページからお申し込みください。
          </p>
        ) : (
          <p className="border-t border-[#eadfce] pt-4 text-sm text-[#6b5644]">
            この予約はWebから変更できません。ご不明な点はお電話ください。
          </p>
        )}
      </div>
      <p className="text-sm leading-7 text-[#6b5644]">
        管理リンクを他の方と共有しないでください。リンクが利用できない場合は、予約番号をお手元に
        <a className="ml-1 underline underline-offset-2" href={CONTACT_TEL_LINK}>
          {CONTACT_PHONE_DISPLAY}
        </a>
        までお電話ください。
      </p>
    </div>
  );
}

function ManagementFallback({ message }: { message: string }) {
  return (
    <div className="card space-y-4 border-[#cfa96d]/35 bg-[#fffdfa] p-6 text-sm leading-7 text-[#4a3121] md:p-8">
      <p role="alert" className="text-[#8f2a2a]">
        {message}
      </p>
      <p>
        管理リンクが見つからない場合は、予約完了時の予約番号をお手元に
        <a className="ml-1 underline underline-offset-2" href={CONTACT_TEL_LINK}>
          {CONTACT_PHONE_DISPLAY}
        </a>
        までお電話ください。
      </p>
    </div>
  );
}
