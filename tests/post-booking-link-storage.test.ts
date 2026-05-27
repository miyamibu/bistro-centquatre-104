import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const VALID_TOKEN = "abcdefghijklmnopqrstuvwxyzABCDEFGH";
const KEY = "bistro:post-booking-link";

// Minimal in-memory sessionStorage mock for the tests.
function makeStorage(): Storage & { __dump: () => Record<string, string> } {
  const data = new Map<string, string>();
  const api: Storage = {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k: string) => (data.has(k) ? (data.get(k) as string) : null),
    key: (i: number) => Array.from(data.keys())[i] ?? null,
    removeItem: (k: string) => {
      data.delete(k);
    },
    setItem: (k: string, v: string) => {
      data.set(k, String(v));
    },
  };
  return Object.assign(api, { __dump: () => Object.fromEntries(data) });
}

function installWindow(storage: Storage | null) {
  vi.stubGlobal(
    "window",
    storage
      ? ({ sessionStorage: storage } as unknown as Window & typeof globalThis)
      : (undefined as unknown as Window & typeof globalThis)
  );
}

afterEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
});

describe("post-booking-link-storage", () => {
  let storage: ReturnType<typeof makeStorage>;

  beforeEach(() => {
    storage = makeStorage();
    installWindow(storage);
  });

  it("round-trip: store then restore returns the same record", async () => {
    const mod = await import("@/lib/post-booking-link-storage");
    const record = {
      reservationId: "res-1",
      claimToken: VALID_TOKEN,
      expiresAtMs: Date.now() + 60_000,
    };
    mod.storePostBookingLink(record);
    const restored = mod.restorePostBookingLink();
    expect(restored).toEqual(record);
  });

  it("uses the documented storage key", async () => {
    const mod = await import("@/lib/post-booking-link-storage");
    mod.storePostBookingLink({
      reservationId: "res-1",
      claimToken: VALID_TOKEN,
      expiresAtMs: Date.now() + 60_000,
    });
    const dump = storage.__dump();
    expect(Object.keys(dump)).toEqual([KEY]);
    expect(mod.POST_BOOKING_LINK_STORAGE_KEY).toBe(KEY);
  });

  it("expired record returns null AND clears the storage slot", async () => {
    const mod = await import("@/lib/post-booking-link-storage");
    mod.storePostBookingLink({
      reservationId: "res-1",
      claimToken: VALID_TOKEN,
      expiresAtMs: Date.now() - 1_000, // already past
    });
    const restored = mod.restorePostBookingLink();
    expect(restored).toBeNull();
    expect(storage.getItem(KEY)).toBeNull();
  });

  it("expiresAtMs exactly equal to now is treated as expired", async () => {
    const mod = await import("@/lib/post-booking-link-storage");
    const now = 1_700_000_000_000;
    mod.storePostBookingLink({
      reservationId: "res-1",
      claimToken: VALID_TOKEN,
      expiresAtMs: now,
    });
    expect(mod.restorePostBookingLink(now)).toBeNull();
    expect(storage.getItem(KEY)).toBeNull();
  });

  it("unparseable JSON returns null AND clears", async () => {
    storage.setItem(KEY, "not-json{");
    const mod = await import("@/lib/post-booking-link-storage");
    expect(mod.restorePostBookingLink()).toBeNull();
    expect(storage.getItem(KEY)).toBeNull();
  });

  it("missing fields are rejected and cleared", async () => {
    storage.setItem(KEY, JSON.stringify({ reservationId: "res-1" }));
    const mod = await import("@/lib/post-booking-link-storage");
    expect(mod.restorePostBookingLink()).toBeNull();
    expect(storage.getItem(KEY)).toBeNull();
  });

  it("claim token shorter than min length is rejected", async () => {
    storage.setItem(
      KEY,
      JSON.stringify({
        reservationId: "res-1",
        claimToken: "tooshort",
        expiresAtMs: Date.now() + 60_000,
      })
    );
    const mod = await import("@/lib/post-booking-link-storage");
    expect(mod.restorePostBookingLink()).toBeNull();
    expect(storage.getItem(KEY)).toBeNull();
  });

  it("storePostBookingLink rejects an invalid record (no write)", async () => {
    const mod = await import("@/lib/post-booking-link-storage");
    mod.storePostBookingLink({
      reservationId: "",
      claimToken: VALID_TOKEN,
      expiresAtMs: Date.now() + 60_000,
    });
    expect(storage.getItem(KEY)).toBeNull();
  });

  it("clearPostBookingLink is idempotent", async () => {
    const mod = await import("@/lib/post-booking-link-storage");
    mod.clearPostBookingLink(); // no-op when empty
    mod.storePostBookingLink({
      reservationId: "res-1",
      claimToken: VALID_TOKEN,
      expiresAtMs: Date.now() + 60_000,
    });
    mod.clearPostBookingLink();
    expect(storage.getItem(KEY)).toBeNull();
    mod.clearPostBookingLink(); // no-op again
    expect(storage.getItem(KEY)).toBeNull();
  });

  it("SSR safety: no window does not throw, restore returns null, store no-ops", async () => {
    installWindow(null);
    const mod = await import("@/lib/post-booking-link-storage");
    expect(() =>
      mod.storePostBookingLink({
        reservationId: "res-1",
        claimToken: VALID_TOKEN,
        expiresAtMs: Date.now() + 60_000,
      })
    ).not.toThrow();
    expect(mod.restorePostBookingLink()).toBeNull();
    expect(() => mod.clearPostBookingLink()).not.toThrow();
  });

  it("setItem throwing (e.g. quota) is swallowed without crashing", async () => {
    const throwing: Storage = {
      get length() {
        return 0;
      },
      clear: () => {},
      getItem: () => null,
      key: () => null,
      removeItem: () => {},
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    installWindow(throwing);
    const mod = await import("@/lib/post-booking-link-storage");
    expect(() =>
      mod.storePostBookingLink({
        reservationId: "res-1",
        claimToken: VALID_TOKEN,
        expiresAtMs: Date.now() + 60_000,
      })
    ).not.toThrow();
  });
});
