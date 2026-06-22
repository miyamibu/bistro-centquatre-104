import { describe, expect, it } from "vitest";
import {
  ensureReservationSchemaReady,
  isReservationSchemaNotReadyError,
} from "@/lib/reservation-compat";

describe("reservation schema compatibility checks", () => {
  it("treats missing LINE reservation columns as schema-not-ready", async () => {
    let calls = 0;
    const client = {
      $queryRaw: async () => {
        calls += 1;
        if (calls === 4) {
          throw new Error('Raw query failed. Code: `42703`. Message: `column "lineLinkedAt" does not exist`');
        }
        return [];
      },
    };

    await expect(ensureReservationSchemaReady(client as never)).rejects.toSatisfy((error) =>
      isReservationSchemaNotReadyError(error)
    );
  });
});
