import type { Metadata } from "next";
import "@/lib/css/liftkitvars.css";
import { Tangerine } from "next/font/google";
import { createPageMetadata } from "@/lib/seo";
import { formatJst } from "@/lib/dates";
import { getNextBookableReservationDate } from "@/lib/booking-rules";
import { ReserveForm } from "@/components/reserve-form";
import {
  isExplicitReservationDateUsable,
  sanitizeArrivalTime,
  sanitizeCourse,
  sanitizeDate,
  sanitizePartySize,
  sanitizeServicePeriod,
} from "@/lib/reservation-form-defaults";

const tangerine = Tangerine({
  subsets: ["latin"],
  weight: ["400", "700"],
  display: "swap",
});

const menuHeadingSize = { base: 24, md: 45 };

export const metadata: Metadata = createPageMetadata("/booking");

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function getFirstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ReservePage({ searchParams }: { searchParams?: SearchParams }) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const defaultDate = formatJst(getNextBookableReservationDate());
  const reservePageSpacing = { topMobile: 113, topDesktop: 150 }; // 上余白の微調整(px)
  const isAgentMode = getFirstParam(resolvedSearchParams.mode) === "agent";
  const requestedDate = getFirstParam(resolvedSearchParams.date);
  const hasValidExplicitDate = isExplicitReservationDateUsable(requestedDate);
  const initialDate = hasValidExplicitDate
    ? requestedDate
    : sanitizeDate(requestedDate, defaultDate);
  const initialServicePeriod = sanitizeServicePeriod(
    getFirstParam(resolvedSearchParams.servicePeriod),
    getFirstParam(resolvedSearchParams.course),
    getFirstParam(resolvedSearchParams.arrivalTime)
  );
  const initialPartySize = sanitizePartySize(getFirstParam(resolvedSearchParams.partySize));
  const initialCourse = sanitizeCourse(
    getFirstParam(resolvedSearchParams.course),
    initialServicePeriod
  );
  const initialArrivalTime = sanitizeArrivalTime(
    getFirstParam(resolvedSearchParams.arrivalTime),
    initialServicePeriod
  );
  return (
    <div
      className="space-y-6 pb-0 pt-[var(--reserve-top-mobile)] md:pb-6 md:pt-[var(--reserve-top-desktop)]"
      style={{
        "--reserve-top-mobile": `${reservePageSpacing.topMobile}px`,
        "--reserve-top-desktop": `${reservePageSpacing.topDesktop}px`,
      } as Record<string, string>}
    >
      <header className="-mt-[68px] text-center md:mt-0">
        <h1
          className={`menu-heading-title font-semibold text-[#2f1b0f] ${tangerine.className}`}
          style={
            {
              "--menu-heading-size": `${menuHeadingSize.base}px`,
              "--menu-heading-size-md": `${menuHeadingSize.md}px`,
            } as Record<string, string>
          }
      >
        RESERVA
      </h1>
      </header>
      <ReserveForm
        defaultDate={defaultDate}
        initialDate={initialDate}
        initialServicePeriod={initialServicePeriod}
        initialPartySize={String(initialPartySize)}
        initialCourse={initialCourse}
        initialArrivalTime={initialArrivalTime}
        autoSelectFirstBookableDate={!hasValidExplicitDate}
        afterAvailabilityNote={
          isAgentMode
            ? [
                "AI経由の事前入力です。必要に応じて内容を確認・調整して送信できます。",
                "氏名・電話番号などの個人情報は、URLクエリではなくこの画面かAPI本文で扱ってください。",
              ]
            : undefined
        }
      />
    </div>
  );
}

