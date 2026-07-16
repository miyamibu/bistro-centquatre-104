import { addDays } from "date-fns";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ReservationStatus, ReservationType } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  availabilityReasonToError,
  isArrivalTimeValid,
  isCoursePeriodConsistent,
} from "@/lib/availability";
import {
  buildPrivateBlockReservationInput,
  evaluatePrivateBlockSubmission,
} from "@/lib/private-block";
import {
  getNextBookableReservationDate,
  getPrivateBlockMarkerText,
  inferReservationServicePeriodFromArrivalTime,
} from "@/lib/booking-rules";
import { buildReservationAdvisoryLockKey } from "@/lib/reservation-lock";
import { evaluateReservationAvailability } from "@/lib/reservation-capacity";
import { formatJst, jstDateTimeFromString, todayJst } from "@/lib/dates";
import { sendReservationEmail } from "@/lib/email";

const scenarioDate = getNextBookableReservationDate(addDays(todayJst(), 7));
const scenarioDateKey = formatJst(scenarioDate);
const stableNow = jstDateTimeFromString(
  formatJst(addDays(scenarioDate, -2)),
  "12:00"
);

describe("reservation integration scenarios", () => {
  it("splits OK and PHONE_ONLY by party size within the same date and service period", () => {
    const existingReservations = [
      { partySize: 8, status: "CONFIRMED" as const, servicePeriod: "DINNER" as const },
      { partySize: 4, status: "CONFIRMED" as const, servicePeriod: "DINNER" as const },
    ];

    expect(
      evaluateReservationAvailability({
        date: scenarioDateKey,
        servicePeriod: "DINNER",
        partySize: 2,
        existingReservations,
        now: stableNow,
      })
    ).toEqual({
      reason: "OK",
      webBookable: true,
    });

    expect(
      evaluateReservationAvailability({
        date: scenarioDateKey,
        servicePeriod: "DINNER",
        partySize: 8,
        existingReservations,
        now: stableNow,
      })
    ).toEqual({
      reason: "PHONE_ONLY",
      webBookable: false,
    });
  });

  it("returns to OK when a conflicting reservation is cancelled", () => {
    expect(
      evaluateReservationAvailability({
        date: scenarioDateKey,
        servicePeriod: "LUNCH",
        partySize: 4,
        existingReservations: [
          { partySize: 8, status: "CONFIRMED", servicePeriod: "LUNCH" },
          { partySize: 4, status: "CONFIRMED", servicePeriod: "LUNCH" },
          { partySize: 2, status: "CONFIRMED", servicePeriod: "LUNCH" },
        ],
        now: stableNow,
      })
    ).toEqual({
      reason: "PHONE_ONLY",
      webBookable: false,
    });

    expect(
      evaluateReservationAvailability({
        date: scenarioDateKey,
        servicePeriod: "LUNCH",
        partySize: 4,
        existingReservations: [
          { partySize: 8, status: "CONFIRMED", servicePeriod: "LUNCH" },
          { partySize: 4, status: "CANCELLED", servicePeriod: "LUNCH" },
          { partySize: 2, status: "CANCELLED", servicePeriod: "LUNCH" },
        ],
        now: stableNow,
      })
    ).toEqual({
      reason: "OK",
      webBookable: true,
    });
  });

  it("uses different advisory lock keys per service period", () => {
    expect(buildReservationAdvisoryLockKey(scenarioDateKey, "LUNCH")).not.toBe(
      buildReservationAdvisoryLockKey(scenarioDateKey, "DINNER")
    );
  });

  it("rejects service period and arrival time mismatches", () => {
    expect(isArrivalTimeValid("18:00", "LUNCH")).toBe(false);
    expect(isCoursePeriodConsistent("ディナー: 席のみ", "LUNCH")).toBe(false);
  });

  it("renders lunch private block as 夜のみ on the calendar", () => {
    expect(getPrivateBlockMarkerText("PRIVATE_BLOCK", "OK")).toBe("夜のみ");
  });

  it("renders dinner private block as 昼のみ on the calendar", () => {
    expect(getPrivateBlockMarkerText("OK", "PRIVATE_BLOCK")).toBe("昼のみ");
  });

  it("renders all-day private block as 終日貸切 on the calendar", () => {
    expect(getPrivateBlockMarkerText("PRIVATE_BLOCK", "PRIVATE_BLOCK")).toBe("終日貸切");
  });

  it("infers private-block service period from arrival time", () => {
    expect(inferReservationServicePeriodFromArrivalTime("11:30")).toBe("LUNCH");
    expect(inferReservationServicePeriodFromArrivalTime("18:00")).toBe("DINNER");
    expect(inferReservationServicePeriodFromArrivalTime("23:59")).toBeNull();
  });

  it("builds private block reservations as PRIVATE_BLOCK entries", () => {
    expect(
      buildPrivateBlockReservationInput({
        date: "2026-04-20",
        servicePeriod: "LUNCH",
        note: "貸切設定テスト",
      })
    ).toMatchObject({
      date: "2026-04-20",
      servicePeriod: "LUNCH",
      reservationType: ReservationType.PRIVATE_BLOCK,
      partySize: 1,
      arrivalTime: null,
      name: "貸切",
      status: ReservationStatus.CONFIRMED,
    });
  });

  it("rejects private block setup when confirmed normal reservations exist", () => {
    expect(
      evaluatePrivateBlockSubmission([
        {
          reservationType: ReservationType.NORMAL,
          status: ReservationStatus.CONFIRMED,
        },
      ])
    ).toBe("CONFLICT");

    expect(availabilityReasonToError("PRIVATE_BLOCK").error).toBe(
      "この時間帯は貸切営業のため予約できません"
    );
  });

  it("treats repeated private block setup as no-op success", () => {
    expect(
      evaluatePrivateBlockSubmission([
        {
          reservationType: ReservationType.PRIVATE_BLOCK,
          status: ReservationStatus.CONFIRMED,
        },
      ])
    ).toBe("NO_OP");
  });

  it("blocks normal reservations when a private block exists", () => {
    expect(
      evaluateReservationAvailability({
        date: scenarioDateKey,
        servicePeriod: "LUNCH",
        partySize: 2,
        existingReservations: [
          {
            partySize: 1,
            status: "CONFIRMED",
            servicePeriod: "LUNCH",
            reservationType: "PRIVATE_BLOCK",
          },
        ],
        now: stableNow,
      })
    ).toEqual({
      reason: "PRIVATE_BLOCK",
      webBookable: false,
    });
  });

  it("skips reservation email sending for private block records", async () => {
    const result = await sendReservationEmail({
      reservation: {
        id: "private-block-test",
        date: scenarioDateKey,
        servicePeriod: "LUNCH",
        reservationType: ReservationType.PRIVATE_BLOCK,
        seatType: "MAIN",
        partySize: 1,
        arrivalTime: null,
        name: "貸切",
        phone: "-",
        note: "テスト",
        status: ReservationStatus.CONFIRMED,
        lineUserId: null,
        lineReminderSentAt: null,
        lineReminderStatus: null,
        lineReminderError: null,
        lineClaimTokenHash: null,
        lineClaimExpiresAt: null,
        lineConfirmationSentAt: null,
        lineLinkedAt: null,
        lineLinkSource: null,
        linePushStatus: null,
        linePushCheckedAt: null,
        createdAt: new Date("2026-04-01T00:00:00.000Z"),
        updatedAt: new Date("2026-04-01T00:00:00.000Z"),
      },
    });

    expect(result).toEqual({
      skipped: true,
      reason: "PRIVATE_BLOCK",
    });
  });

  it("keeps a migration failure guard for unbackfillable rows", () => {
    const migration = readFileSync(
      join(
        process.cwd(),
        "prisma",
        "migrations",
        "20260311130000_add_service_period_to_reservation",
        "migration.sql"
      ),
      "utf8"
    );

    expect(migration).toContain('WHERE "servicePeriod" IS NULL');
    expect(migration).toContain("backfill failed");
    expect(migration).toContain("RAISE EXCEPTION");
  });
});
