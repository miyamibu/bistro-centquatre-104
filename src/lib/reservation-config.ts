export const RESERVATION_CONFIG = {
  timezone: "Asia/Tokyo",
  openingDate: "2026-04-03",
  closedWeekdays: [1, 2, 3] as const,
  closedWeekdayLabels: ["月曜日", "火曜日", "水曜日"] as const,
  closedDates: [] as const,
  closedServicePeriods: [] as const,
  specialOpenDates: [] as string[],
  bookingWindowMonths: 3,
  bookingCutoff: {
    daysBefore: 1,
    time: "17:00",
  },
  maxPartySize: 12,
  servicePeriods: {
    LUNCH: {
      label: "ランチ",
      businessHours: {
        start: "11:30",
        end: "14:00",
      },
      reservationHours: {
        start: "11:30",
        end: "12:30",
      },
      slotMinutes: 30,
    },
    DINNER: {
      label: "ディナー",
      businessHours: {
        start: "17:30",
        end: "22:00",
      },
      reservationHours: {
        start: "17:30",
        end: "19:30",
      },
      lastOrderTime: "21:00",
      slotMinutes: 30,
    },
  },
  courseOptions: [
    {
      servicePeriod: "LUNCH",
      label: "プティラ　Petite La course",
      value: "ランチ: プティラ　Petite La course",
    },
    {
      servicePeriod: "LUNCH",
      label: "席のみ",
      value: "ランチ: 席のみ",
    },
    {
      servicePeriod: "DINNER",
      label: "ジョワ　Joie course",
      value: "ディナー: ジョワ　Joie course",
    },
    {
      servicePeriod: "DINNER",
      label: "サンキャトル　Cent Quatre course",
      value: "ディナー: サンキャトル　Cent Quatre course",
    },
    {
      servicePeriod: "DINNER",
      label: "席のみ",
      value: "ディナー: 席のみ",
    },
  ] as const,
  phoneGuidance:
    "Web予約の受付は前日17:00までです。お急ぎの方はお電話ください。",
} as const;

export type ReservationServicePeriodKey =
  keyof typeof RESERVATION_CONFIG.servicePeriods;

export type ReservationCourseOption =
  (typeof RESERVATION_CONFIG.courseOptions)[number];

export function getReservationCoursesForServicePeriod(
  servicePeriod: ReservationServicePeriodKey
) {
  return RESERVATION_CONFIG.courseOptions.filter(
    (option) => option.servicePeriod === servicePeriod
  );
}

export const RESERVATION_CLOSED_TEXT =
  RESERVATION_CONFIG.closedWeekdayLabels.join("・");

export const RESERVATION_BUSINESS_HOURS = [
  { label: "ランチ", time: "11:30-14:00" },
  { label: "ディナー", time: "17:30-22:00（L.O. 21:00）" },
] as const;

export const RESERVATION_WEB_HOURS = [
  { label: "ランチ", time: "11:30-12:30" },
  { label: "ディナー", time: "17:30-19:30" },
] as const;

export const RESERVATION_BUSINESS_HOURS_TEXT =
  `営業時間：${RESERVATION_BUSINESS_HOURS.map((slot) => `${slot.label} ${slot.time}`).join(" / ")}`;

export const RESERVATION_WEB_HOURS_TEXT =
  `Web予約可能時間：${RESERVATION_WEB_HOURS.map((slot) => `${slot.label} ${slot.time}`).join(" / ")}`;

export const RESERVATION_CUTOFF_TEXT =
  RESERVATION_CONFIG.phoneGuidance;
