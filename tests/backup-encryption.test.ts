import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  BACKUP_ENCRYPTION_ALGORITHM,
  BACKUP_ENCRYPTION_FORMAT,
  decryptBackupPayload,
  encryptBackupPayload,
  getBackupEnvelopeMetadata,
  resolveBackupEncryptionConfig,
  resolveBackupEncryptionKey,
} from "../scripts/backup-encryption.mjs";

const encryptionKey = "backup-encryption-test-key-32-characters";

describe("reservation backup encryption", () => {
  it("round-trips a payload without embedding plaintext", () => {
    const payload = {
      schemaVersion: 2,
      reservation: {
        name: "暗号化テスト予約",
        phone: "000-0000-0000",
      },
    };

    const encrypted = encryptBackupPayload(payload, encryptionKey);
    const envelope = JSON.parse(encrypted) as Record<string, unknown>;

    expect(encrypted).not.toContain(payload.reservation.name);
    expect(envelope.format).toBe(BACKUP_ENCRYPTION_FORMAT);
    expect(envelope.algorithm).toBe(BACKUP_ENCRYPTION_ALGORITHM);
    expect(envelope.keyId).toBe("v1");
    expect(decryptBackupPayload(encrypted, encryptionKey)).toEqual(payload);
  });

  it("detects ciphertext tampering and a wrong key", () => {
    const encrypted = encryptBackupPayload({ reservations: [{ id: "reservation-1" }] }, encryptionKey);
    const envelope = JSON.parse(encrypted) as { ciphertext: string };
    const ciphertext = Buffer.from(envelope.ciphertext, "base64url");
    ciphertext[0] ^= 1;
    envelope.ciphertext = ciphertext.toString("base64url");

    expect(() => decryptBackupPayload(JSON.stringify(envelope), encryptionKey)).toThrow("改ざん検知");
    expect(() => decryptBackupPayload(encrypted, "wrong-backup-encryption-key-32-chars")).toThrow(
      "改ざん検知",
    );
  });

  it("resolves the key from the environment or stdin", async () => {
    await expect(
      resolveBackupEncryptionKey({ environment: { BACKUP_ENCRYPTION_KEY: encryptionKey } }),
    ).resolves.toBe(encryptionKey);

    await expect(
      resolveBackupEncryptionConfig({
        environment: {
          BACKUP_ENCRYPTION_KEYS_JSON: JSON.stringify({ old: "o".repeat(32), active: encryptionKey }),
          BACKUP_ENCRYPTION_ACTIVE_KEY_ID: "active",
        },
      }),
    ).resolves.toMatchObject({ keyId: "active", secret: encryptionKey });

    await expect(
      resolveBackupEncryptionKey({
        environment: {},
        readFromStdin: true,
        stdin: Readable.from([`${encryptionKey}\n`]),
      }),
    ).resolves.toBe(encryptionKey);
  });

  it("decrypts a rotated keyring by envelope keyId and keeps the key id in metadata", () => {
    const oldKey = "old-backup-encryption-key-32-characters";
    const encrypted = encryptBackupPayload({ reservations: [{ id: "old" }] }, oldKey, { keyId: "v1" });
    expect(getBackupEnvelopeMetadata(encrypted)).toMatchObject({ encryptionVersion: 2, keyId: "v1" });
    expect(
      decryptBackupPayload(encrypted, {
        keys: { v1: oldKey, v2: "new-backup-encryption-key-32-characters" },
      }),
    ).toEqual({ reservations: [{ id: "old" }] });
  });
});
