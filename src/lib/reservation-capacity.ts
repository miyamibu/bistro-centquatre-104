import {
  isBeforeOpeningReservationDate,
  isClosedReservationDate,
  isReservationCutoffPassed,
} from "@/lib/booking-rules";
import { isBeyondRange, isSameOrBeforeToday, jstDateFromString, nowJst } from "@/lib/dates";
import type { ReservationServicePeriodKey } from "@/lib/reservation-config";

export type SlotRequirement = 2 | 4 | 6 | 8 | "phone_only";

export type SlotCounts = {
  slot2: number;
  slot4: number;
  slot6: number;
  slot8: number;
  hasPhoneOnly: boolean;
};

export type AvailabilityReason =
  | "OK"
  | "PHONE_ONLY"
  | "PRIVATE_BLOCK"
  | "CLOSED"
  | "CUTOFF_PASSED"
  | "BEFORE_OPENING"
  | "SAME_DAY_BLOCKED"
  | "OUT_OF_RANGE"
  | "INVALID_DATE";

export type AvailabilityResult = {
  reason: AvailabilityReason;
  webBookable: boolean;
};

export type ReservationAvailabilityInput = {
  date: string;
  servicePeriod: ReservationServicePeriodKey;
  partySize: number;
  existingReservations: Array<{
    partySize: number;
    status: "CONFIRMED" | "CANCELLED" | "DONE" | "NOSHOW";
    servicePeriod: ReservationServicePeriodKey;
    reservationType?: "NORMAL" | "PRIVATE_BLOCK";
  }>;
  businessDayClosed?: boolean;
  now?: Date;
};

type Pattern = Omit<SlotCounts, "hasPhoneOnly">;

const EMPTY_SLOT_COUNTS: SlotCounts = {
  slot2: 0,
  slot4: 0,
  slot6: 0,
  slot8: 0,
  hasPhoneOnly: false,
};

const ALLOWED_PATTERNS: Pattern[] = [
  { slot8: 1, slot6: 0, slot4: 2, slot2: 0 },
  { slot8: 1, slot6: 0, slot4: 1, slot2: 1 },
  { slot8: 1, slot6: 0, slot4: 0, slot2: 2 },
  { slot8: 0, slot6: 2, slot4: 0, slot2: 1 },
  { slot8: 0, slot6: 2, slot4: 0, slot2: 0 },
  { slot8: 0, slot6: 1, slot4: 2, slot2: 1 },
  { slot8: 0, slot6: 1, slot4: 1, slot2: 2 },
  { slot8: 0, slot6: 0, slot4: 3, slot2: 1 },
  { slot8: 0, slot6: 0, slot4: 2, slot2: 4 },
];

function addSlotRequirement(counts: SlotCounts, requirement: SlotRequirement): SlotCounts {
  if (requirement === "phone_only") {
    return {
      ...counts,
      hasPhoneOnly: true,
    };
  }

  const next = { ...counts };

  if (requirement === 2) {
    next.slot2 += 1;
  } else if (requirement === 4) {
    next.slot4 += 1;
  } else if (requirement === 6) {
    next.slot6 += 1;
  } else if (requirement === 8) {
    next.slot8 += 1;
  }

  return next;
}

export function partySizeToSlotRequirement(partySize: number): SlotRequirement {
  if (partySize <= 0) {
    return "phone_only";
  }

  if (partySize <= 2) {
    return 2;
  }

  if (partySize <= 4) {
    return 4;
  }

  if (partySize <= 6) {
    return 6;
  }

  if (partySize <= 8) {
    return 8;
  }

  return "phone_only";
}

export function aggregateSlotCounts(
  reservations: Array<{
    partySize: number;
    status: "CONFIRMED" | "CANCELLED" | "DONE" | "NOSHOW";
    servicePeriod: ReservationServicePeriodKey;
    reservationType?: "NORMAL" | "PRIVATE_BLOCK";
  }>
): SlotCounts {
  return reservations.reduce<SlotCounts>((counts, reservation) => {
    if (reservation.status === "CANCELLED") {
      return counts;
    }

    if (reservation.reservationType === "PRIVATE_BLOCK") {
      return counts;
    }

    return addSlotRequirement(
      counts,
      partySizeToSlotRequirement(reservation.partySize)
    );
  }, EMPTY_SLOT_COUNTS);
}

export function fitsAllowedPattern(counts: SlotCounts): boolean {
  if (counts.hasPhoneOnly) {
    return false;
  }

  return ALLOWED_PATTERNS.some(
    (pattern) =>
      counts.slot2 <= pattern.slot2 &&
      counts.slot4 <= pattern.slot4 &&
      counts.slot6 <= pattern.slot6 &&
      counts.slot8 <= pattern.slot8
  );
}

export function evaluateReservationAvailability(
  input: ReservationAvailabilityInput
): AvailabilityResult {
  let parsedDate: Date;
  try {
    parsedDate = jstDateFromString(input.date);
  } catch {
    return {
      reason: "INVALID_DATE",
      webBookable: false,
    };
  }

  if (isBeforeOpeningReservationDate(parsedDate)) {
    return {
      reason: "BEFORE_OPENING",
      webBookable: false,
    };
  }

  if (isBeyondRange(parsedDate)) {
    return {
      reason: "OUT_OF_RANGE",
      webBookable: false,
    };
  }

  if (
    isClosedReservationDate(parsedDate, {
      businessDayClosed: input.businessDayClosed,
      servicePeriod: input.servicePeriod,
    })
  ) {
    return {
      reason: "CLOSED",
      webBookable: false,
    };
  }

  if (isSameOrBeforeToday(parsedDate)) {
    return {
      reason: "SAME_DAY_BLOCKED",
      webBookable: false,
    };
  }

  if (isReservationCutoffPassed(parsedDate, input.now ?? nowJst())) {
    return {
      reason: "CUTOFF_PASSED",
      webBookable: false,
    };
  }

  const hasPrivateBlock = input.existingReservations.some(
    (reservation) =>
      reservation.servicePeriod === input.servicePeriod &&
      reservation.status !== "CANCELLED" &&
      reservation.reservationType === "PRIVATE_BLOCK"
  );

  if (hasPrivateBlock) {
    return {
      reason: "PRIVATE_BLOCK",
      webBookable: false,
    };
  }

  const slotRequirement = partySizeToSlotRequirement(input.partySize);
  if (slotRequirement === "phone_only") {
    return {
      reason: "PHONE_ONLY",
      webBookable: false,
    };
  }

  const existingCounts = aggregateSlotCounts(
    input.existingReservations.filter(
      (reservation) =>
        reservation.servicePeriod === input.servicePeriod &&
        reservation.reservationType !== "PRIVATE_BLOCK"
    )
  );
  const combinedCounts = addSlotRequirement(existingCounts, slotRequirement);

  if (!fitsAllowedPattern(combinedCounts)) {
    return {
      reason: "PHONE_ONLY",
      webBookable: false,
    };
  }

  return {
    reason: "OK",
    webBookable: true,
  };
}
