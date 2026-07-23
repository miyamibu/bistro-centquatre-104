import "@/lib/css/liftkitvars.css";
import { Tangerine } from "next/font/google";
import {
  addJstMonths,
  formatJst,
  getJstMonthKey,
  jstDateFromString,
  startOfJstMonth,
} from "@/lib/dates";
import { getNextBookableReservationDate } from "@/lib/booking-rules";
import { ReserveForm } from "@/components/reserve-form";
import { getAvailability, getMonthlyAvailability } from "@/lib/availability";
import { prisma } from "@/lib/prisma";
import { ensureReservationSchemaReady } from "@/lib/reservation-compat";
import { RESERVATION_CONFIG } from "@/lib/reservation-config";
import {
  findFirstWebBookableDate,
  isExplicitReservationDateUsable,
  sanitizeArrivalTime,
  sanitizeCourse,
  sanitizeDate,
  sanitizePartySize,
  sanitizeServicePeriod,
  shouldSearchFutureAvailability,
} from "@/lib/reservation-form-defaults";

const tangerine = Tangerine({
  subsets: ["latin"],
  weight: ["400", "700"],
  display: "swap",
});

const menuHeadingSize = { base: 24, md: 45 };

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
  let initialDate = hasValidExplicitDate
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
  const initialCalendarMonth = startOfJstMonth(jstDateFromString(initialDate));

  let initialAvailability = null;
  let initialMonthlyAvailabilityByPeriod:
    | {
        LUNCH: Awaited<ReturnType<typeof getMonthlyAvailability>>;
        DINNER: Awaited<ReturnType<typeof getMonthlyAvailability>>;
      }
    | null = null;

  try {
    await ensureReservationSchemaReady(prisma);

    const [provisionalDailyAvailability, initialSelectedPeriodMonthly] = await Promise.all([
      getAvailability(
        {
          date: initialDate,
          servicePeriod: initialServicePeriod,
          partySize: initialPartySize,
        },
        prisma
      ),
      getMonthlyAvailability(
        {
          month: getJstMonthKey(initialCalendarMonth),
          servicePeriod: initialServicePeriod,
          partySize: initialPartySize,
        },
        prisma
      ),
    ]);

    let selectedCalendarMonth = initialCalendarMonth;
    let selectedMonthlyAvailability = initialSelectedPeriodMonthly;
    let confirmedInitialDate = !hasValidExplicitDate && shouldSearchFutureAvailability(initialPartySize)
      ? findFirstWebBookableDate(
          selectedMonthlyAvailability,
          initialDate
        )
      : null;

    for (
      let monthOffset = 1;
      !hasValidExplicitDate &&
      shouldSearchFutureAvailability(initialPartySize) &&
      confirmedInitialDate == null &&
      monthOffset <= RESERVATION_CONFIG.bookingWindowMonths;
      monthOffset += 1
    ) {
      const candidateMonth = addJstMonths(initialCalendarMonth, monthOffset);
      const candidateMonthlyAvailability = await getMonthlyAvailability(
        {
          month: getJstMonthKey(candidateMonth),
          servicePeriod: initialServicePeriod,
          partySize: initialPartySize,
        },
        prisma
      );
      const candidateDate = findFirstWebBookableDate(candidateMonthlyAvailability, initialDate);

      if (candidateDate) {
        confirmedInitialDate = candidateDate;
        selectedCalendarMonth = candidateMonth;
        selectedMonthlyAvailability = candidateMonthlyAvailability;
      }
    }

    const oppositeServicePeriod = initialServicePeriod === "LUNCH" ? "DINNER" : "LUNCH";
    const oppositeMonthlyAvailability = await getMonthlyAvailability(
      {
        month: getJstMonthKey(selectedCalendarMonth),
        servicePeriod: oppositeServicePeriod,
        partySize: initialPartySize,
      },
      prisma
    );
    initialMonthlyAvailabilityByPeriod =
      initialServicePeriod === "LUNCH"
        ? { LUNCH: selectedMonthlyAvailability, DINNER: oppositeMonthlyAvailability }
        : { LUNCH: oppositeMonthlyAvailability, DINNER: selectedMonthlyAvailability };

    if (confirmedInitialDate && confirmedInitialDate !== initialDate) {
      initialDate = confirmedInitialDate;
      initialAvailability =
        selectedMonthlyAvailability[confirmedInitialDate] ??
        provisionalDailyAvailability;
    } else {
      initialAvailability = provisionalDailyAvailability;
    }
  } catch {
    // Fall back to client-side loading when the initial server fetch is unavailable.
  }

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
        initialAvailability={initialAvailability}
        initialMonthlyAvailabilityByPeriod={initialMonthlyAvailabilityByPeriod ?? undefined}
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

