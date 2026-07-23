import { describe, expect, it } from "vitest";
import {
  reduceOrdersNeedRefresh,
  shouldRequireOrderRefresh,
  type OrdersNeedRefreshEvent,
} from "@/lib/order-action-state";

describe("order action refresh gate", () => {
  it.each([
    [200, false],
    [400, false],
    [401, false],
    [409, true],
    [500, true],
    [503, true],
  ])("maps HTTP status %s to the refresh gate", (status, expected) => {
    expect(shouldRequireOrderRefresh(status)).toBe(expected);
  });

  const refreshCases: Array<[OrdersNeedRefreshEvent, boolean, boolean]> = [
    [{ type: "transport-unknown" }, false, true],
    [{ type: "mutation-response", status: 409 }, false, true],
    [{ type: "mutation-response", status: 503 }, false, true],
    [{ type: "mutation-response", status: 401 }, false, false],
    [{ type: "mutation-response", status: 400 }, true, true],
    [{ type: "mutation-succeeded-refresh-failed" }, false, true],
    [{ type: "refresh-succeeded" }, true, false],
    [{ type: "refresh-failed" }, false, true],
  ];

  it.each(refreshCases)("reduces %j from %s to %s", (event, current, expected) => {
    expect(reduceOrdersNeedRefresh(current, event)).toBe(expected);
  });
});
