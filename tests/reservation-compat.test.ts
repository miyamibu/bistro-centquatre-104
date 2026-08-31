import { describe, expect, it, vi } from "vitest";
import { ReservationStatus } from "@prisma/client";
import {
  ensureReservationSchemaReady,
  isReservationSchemaNotReadyError,
  updateReservationStatusCompat,
} from "@/lib/reservation-compat";

describe("reservation schema compatibility checks", () => {
  it("treats missing LINE reservation columns as schema-not-ready", async () => {
    let calls = 0;
    const client = {
      $queryRaw: async () => {
        calls += 1;
        throw new Error('Raw query failed. Code: `42703`. Message: `column "lineLinkedAt" does not exist`');
      },
    };

    await expect(ensureReservationSchemaReady(client as never)).rejects.toSatisfy((error) =>
      isReservationSchemaNotReadyError(error)
    );
    expect(calls).toBe(1);
  });

  it("treats missing LINE recovery columns as schema-not-ready", async () => {
    const client = {
      $queryRaw: async () => {
        throw new Error('Raw query failed. Code: `42703`. Message: `column "lineClaimTokenHash" does not exist`');
      },
    };

    await expect(ensureReservationSchemaReady(client as never)).rejects.toSatisfy((error) =>
      isReservationSchemaNotReadyError(error)
    );
  });

  it("updates reservation status with the previously read status as a CAS predicate", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const findUnique = vi.fn().mockResolvedValue({
      id: "res-1",
      status: ReservationStatus.DONE,
    });
    const client = { reservation: { updateMany, findUnique } };

    await expect(
      updateReservationStatusCompat(
        client as never,
        "res-1",
        ReservationStatus.CONFIRMED,
        ReservationStatus.DONE,
      ),
    ).resolves.toMatchObject({ id: "res-1", status: ReservationStatus.DONE });

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "res-1", status: ReservationStatus.CONFIRMED },
      data: { status: ReservationStatus.DONE },
    });
    expect(findUnique).toHaveBeenCalledWith({ where: { id: "res-1" } });
  });

  it("returns null when the CAS predicate no longer matches", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const findUnique = vi.fn();
    const client = { reservation: { updateMany, findUnique } };

    await expect(
      updateReservationStatusCompat(
        client as never,
        "res-1",
        ReservationStatus.CONFIRMED,
        ReservationStatus.DONE,
      ),
    ).resolves.toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });
});
