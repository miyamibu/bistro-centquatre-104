import { afterEach, describe, expect, it, vi } from "vitest";
import { logError, logInfo } from "@/lib/logger";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("logger redaction", () => {
  it("redacts sensitive context fields recursively", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});

    logInfo("test.event", {
      requestId: "req-1",
      context: {
        reservationId: "res-1",
        phone: "090-0000-0000",
        nested: {
          lineUserId: "U" + "0".repeat(32),
          token: "secret-token",
          safe: "visible",
        },
      },
    });

    const payload = JSON.parse(String(spy.mock.calls[0][0])) as {
      context: {
        reservationId: string;
        phone: string;
        nested: { lineUserId: string; token: string; safe: string };
      };
    };

    expect(payload.context.reservationId).toBe("res-1");
    expect(payload.context.phone).toBe("[REDACTED]");
    expect(payload.context.nested.lineUserId).toBe("[REDACTED]");
    expect(payload.context.nested.token).toBe("[REDACTED]");
    expect(payload.context.nested.safe).toBe("visible");
  });

  it("handles Error objects and circular context safely", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const circular: Record<string, unknown> = { safe: "visible" };
    circular.self = circular;

    logError("test.error", {
      errorCode: "TEST_ERROR",
      context: {
        error: new Error("boom"),
        circular,
        authorization: "Bearer secret",
      },
    });

    const payload = JSON.parse(String(spy.mock.calls[0][0])) as {
      context: {
        error: { name: string; message: string };
        circular: { self: string };
        authorization: string;
      };
    };

    expect(payload.context.error).toMatchObject({ name: "Error", message: "boom" });
    expect(payload.context.circular.self).toBe("[CIRCULAR]");
    expect(payload.context.authorization).toBe("[REDACTED]");
  });

  it("redacts secrets embedded in plain strings and Error.message", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error(
      "failed for Bearer sk_test_secret and postgresql://user:pass@example.com/app with customer@example.com 090-1234-5678"
    );

    logError("test.error.message", {
      errorCode: "TEST_ERROR",
      context: {
        message:
          "callback https://example.com/callback?token=raw-token&ok=1 Authorization: Bearer abc.def",
        error,
      },
    });

    const output = String(spy.mock.calls[0][0]);
    expect(output).not.toContain("sk_test_secret");
    expect(output).not.toContain("user:pass");
    expect(output).not.toContain("customer@example.com");
    expect(output).not.toContain("090-1234-5678");
    expect(output).not.toContain("raw-token");
    expect(output).toContain("Bearer [REDACTED]");
    expect(output).toContain("[REDACTED_URL]");
    expect(output).toContain("[REDACTED_EMAIL]");
    expect(output).toContain("[REDACTED_PHONE]");
  });

  it("suppresses Error.message in production logs while preserving allowlisted metadata", () => {
    vi.stubEnv("NODE_ENV", "production");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("secret should not appear") as Error & {
      code: string;
      status: number;
      retryable: boolean;
    };
    error.code = "PROVIDER_TIMEOUT";
    error.status = 503;
    error.retryable = true;

    logError("test.production.error", {
      errorCode: "TEST_ERROR",
      context: { error },
    });

    const payload = JSON.parse(String(spy.mock.calls[0][0])) as {
      context: {
        error: { name: string; message?: string; code: string; status: number; retryable: boolean };
      };
    };
    expect(payload.context.error).toMatchObject({
      name: "Error",
      code: "PROVIDER_TIMEOUT",
      status: 503,
      retryable: true,
    });
    expect(payload.context.error).not.toHaveProperty("message");
  });
});
