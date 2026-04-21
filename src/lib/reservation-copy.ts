import {
  RESERVATION_BUSINESS_HOURS_TEXT,
  RESERVATION_CLOSED_TEXT,
  RESERVATION_CUTOFF_TEXT,
  RESERVATION_WEB_HOURS_TEXT,
} from "@/lib/reservation-config";

export const RESERVATION_POLICY_LINES = [
  RESERVATION_BUSINESS_HOURS_TEXT,
  `定休日：${RESERVATION_CLOSED_TEXT}`,
  RESERVATION_WEB_HOURS_TEXT,
  RESERVATION_CUTOFF_TEXT,
] as const;

export const RESERVATION_FAQ_ITEMS = [
  {
    question: "定休日はいつですか？",
    answer: `定休日は${RESERVATION_CLOSED_TEXT}です。`,
  },
  {
    question: "営業時間を教えてください。",
    answer: RESERVATION_BUSINESS_HOURS_TEXT,
  },
  {
    question: "Web予約ができる時間帯を教えてください。",
    answer: RESERVATION_WEB_HOURS_TEXT,
  },
  {
    question: "Web予約の締切はいつですか？",
    answer: RESERVATION_CUTOFF_TEXT,
  },
  {
    question: "当日のWeb予約はできますか？",
    answer: "当日のWeb予約は承っておりません。お急ぎの方はお電話ください。",
  },
  {
    question: "キャンセル方法を教えてください。",
    answer: "キャンセルはお電話にてお願いいたします。",
  },
] as const;

export const RESERVATION_SYNC_COPY = {
  googleBusinessProfile: [
    RESERVATION_BUSINESS_HOURS_TEXT,
    `定休日：${RESERVATION_CLOSED_TEXT}`,
    RESERVATION_WEB_HOURS_TEXT,
    RESERVATION_CUTOFF_TEXT,
  ].join(" / "),
  instagramProfile: [
    `定休日 ${RESERVATION_CLOSED_TEXT}`,
    "ランチ 11:30-14:00",
    "ディナー 17:30-22:00",
    "Web予約 前日17:00まで",
  ].join(" | "),
} as const;
