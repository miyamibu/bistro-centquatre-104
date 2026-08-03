import { describe, expect, it } from "vitest";
import { getMenuTabIdForKey } from "@/lib/menu-tabs";

describe("menu tab keyboard navigation", () => {
  it("moves across tabs and wraps at both ends", () => {
    expect(getMenuTabIdForKey("petite", "ArrowLeft")).toBe("cent-quatre");
    expect(getMenuTabIdForKey("cent-quatre", "ArrowRight")).toBe("petite");
  });

  it("moves to the first and last tab with Home and End", () => {
    expect(getMenuTabIdForKey("joie", "Home")).toBe("petite");
    expect(getMenuTabIdForKey("joie", "End")).toBe("cent-quatre");
  });

  it("ignores unrelated keys", () => {
    expect(getMenuTabIdForKey("joie", "Enter")).toBeNull();
  });
});
