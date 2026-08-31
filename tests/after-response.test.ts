import { afterEach, describe, expect, it, vi } from "vitest";

const afterMock = vi.hoisted(() => vi.fn());
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: afterMock,
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe("post-response scheduling boundary", () => {
  it("always delegates to the request-lifecycle primitive", async () => {
    const task = vi.fn();
    const { scheduleAfterResponse } = await import("@/lib/after-response");
    scheduleAfterResponse(task);
    expect(afterMock).toHaveBeenCalledWith(task);
  });
});
