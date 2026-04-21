import { afterEach, describe, expect, it, vi } from "vitest";

async function loadCryptoModule(envOverrides: Record<string, string | undefined>) {
  vi.resetModules();
  vi.doMock("@/lib/env", () => ({
    env: {
      BANK_ACCOUNT_HISTORY_ENCRYPTION_KEY: undefined,
      ...envOverrides,
    },
  }));

  return import("@/lib/bank-account-history-crypto");
}

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("Bank account history key separation", () => {
  it("requires dedicated BANK_ACCOUNT_HISTORY_ENCRYPTION_KEY even if other secrets exist", async () => {
    const { getBankHistoryKey } = await loadCryptoModule({
      BANK_ACCOUNT_HISTORY_ENCRYPTION_KEY: undefined,
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
      ADMIN_BASIC_PASS: "admin-pass",
      CRON_SECRET: "cron-secret",
    });

    expect(() => getBankHistoryKey()).toThrowError(
      "BANK_ACCOUNT_HISTORY_ENCRYPTION_KEY_MISSING"
    );
  });

  it("encrypts history fields with dedicated key material", async () => {
    const { getBankHistoryKey, encryptBankHistoryValue } = await loadCryptoModule({
      BANK_ACCOUNT_HISTORY_ENCRYPTION_KEY: "dedicated-history-key",
    });

    const key = getBankHistoryKey();
    const encrypted = encryptBankHistoryValue("1234567890");

    expect(key).toHaveLength(32);
    expect(encrypted.ciphertext).toMatch(/^\\x[0-9a-f]+$/);
    expect(encrypted.nonce).toMatch(/^\\x[0-9a-f]+$/);
    expect(encrypted.authTag).toMatch(/^\\x[0-9a-f]+$/);
  });
});
