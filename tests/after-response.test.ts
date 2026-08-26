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
  it("delegates to Next after outside direct Vitest route invocation", async () => {
    const previous = process.env.VITEST;
    process.env.VITEST = "false";
    try {
      const task = vi.fn();
      const { scheduleAfterResponse } = await import("@/lib/after-response");
      scheduleAfterResponse(task);
      expect(afterMock).toHaveBeenCalledWith(task);
    } finally {
      process.env.VITEST = previous;
    }
  });
});
