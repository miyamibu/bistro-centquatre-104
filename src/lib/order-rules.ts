import { addDays } from "date-fns";
import { formatJst, isBusinessDay, jstDateFromString, todayJst } from "@/lib/dates";

export const STORE_VISIT_MIN_DAYS = 14;
export const STORE_VISIT_MAX_DAYS = 30;

type StoreVisitValidationResult =
  | { ok: true }
  | {
      ok: false;
      code: string;
      error: string;
      fields?: Record<string, string>;
    };

export function validatePayInStoreVisitDate(storeVisitDateInput: string | null | undefined): StoreVisitValidationResult {
  if (!storeVisitDateInput) {
    return {
      ok: false,
      code: "STORE_VISIT_DATE_REQUIRED",
      error: "来店予定日を指定してください",
    };
  }

  let storeVisitDate: Date;
  try {
    storeVisitDate = jstDateFromString(storeVisitDateInput);
  } catch {
    return {
      ok: false,
      code: "INVALID_STORE_VISIT_DATE",
      error: "来店日の形式が不正です",
    };
  }

  if (!isBusinessDay(storeVisitDate)) {
    return {
      ok: false,
      code: "STORE_VISIT_NOT_BUSINESS_DAY",
      error: "来店日は営業日（木〜日）を選択してください",
    };
  }

  const today = todayJst();
  const minDate = addDays(today, STORE_VISIT_MIN_DAYS);
  const maxDate = addDays(today, STORE_VISIT_MAX_DAYS);
  if (storeVisitDate < minDate || storeVisitDate > maxDate) {
    return {
      ok: false,
      code: "STORE_VISIT_OUT_OF_RANGE",
      error: "来店日は注文日から14日後〜30日後の範囲で選択してください",
      fields: {
        storeVisitDate: `${formatJst(minDate)} - ${formatJst(maxDate)}`,
      },
    };
  }

  return { ok: true };
}
