import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import process from "node:process";

export const BACKUP_ENCRYPTION_FORMAT = "bistro-reservation-backup-aead";
export const BACKUP_ENCRYPTION_VERSION = 2;
export const LEGACY_BACKUP_ENCRYPTION_VERSION = 1;
export const BACKUP_ENCRYPTION_ALGORITHM = "aes-256-gcm";
export const DEFAULT_BACKUP_ENCRYPTION_KEY_ID = "v1";
const IV_BYTES = 12;
const MINIMUM_KEY_LENGTH = 32;

function deriveKey(secret) {
  const normalized = String(secret ?? "").trim();
  if (normalized.length < MINIMUM_KEY_LENGTH) {
    throw new Error(`BACKUP_ENCRYPTION_KEY は ${MINIMUM_KEY_LENGTH} 文字以上で指定してください`);
  }
  return createHash("sha256").update(normalized, "utf8").digest();
}

function associatedData(version) {
  return Buffer.from(
    `${BACKUP_ENCRYPTION_FORMAT}:${version}:${BACKUP_ENCRYPTION_ALGORITHM}`,
    "utf8",
  );
}

function encode(value) {
  return Buffer.from(value).toString("base64url");
}

function decode(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`暗号化バックアップの ${label} が不正です`);
  }
  try {
    const decoded = Buffer.from(value, "base64url");
    if (decoded.length === 0) throw new Error("empty");
    return decoded;
  } catch {
    throw new Error(`暗号化バックアップの ${label} が不正です`);
  }
}

function parseEnvelope(serialized) {
  let envelope;
  try {
    envelope = JSON.parse(String(serialized));
  } catch {
    throw new Error("暗号化バックアップの封筒がJSONではありません");
  }

  if (
    envelope?.format !== BACKUP_ENCRYPTION_FORMAT ||
    ![LEGACY_BACKUP_ENCRYPTION_VERSION, BACKUP_ENCRYPTION_VERSION].includes(
      envelope?.encryptionVersion,
    ) ||
    envelope?.algorithm !== BACKUP_ENCRYPTION_ALGORITHM
  ) {
    throw new Error("暗号化バックアップの形式またはバージョンが未対応です");
  }

  if (
    envelope.encryptionVersion === BACKUP_ENCRYPTION_VERSION &&
    (typeof envelope.keyId !== "string" || !/^[A-Za-z0-9._-]{1,64}$/.test(envelope.keyId))
  ) {
    throw new Error("暗号化バックアップの keyId が不正です");
  }

  return envelope;
}

function resolveDecryptSecret(secretOrKeyring, keyId) {
  if (typeof secretOrKeyring === "string") return secretOrKeyring;
  if (!secretOrKeyring || typeof secretOrKeyring !== "object") {
    throw new Error("バックアップ復号鍵が指定されていません");
  }

  const candidate = secretOrKeyring.keys?.[keyId];
  if (typeof candidate === "string") return candidate;
  if (typeof secretOrKeyring.secret === "string") return secretOrKeyring.secret;
  throw new Error(`バックアップ復号鍵が見つかりません: ${keyId}`);
}

export function encryptBackupText(plaintext, secret, options = {}) {
  const keyId = options.keyId ?? DEFAULT_BACKUP_ENCRYPTION_KEY_ID;
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(keyId)) {
    throw new Error("BACKUP_ENCRYPTION_KEY_ID は英数字、._-を1〜64文字で指定してください");
  }

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(BACKUP_ENCRYPTION_ALGORITHM, deriveKey(secret), iv);
  cipher.setAAD(associatedData(BACKUP_ENCRYPTION_VERSION));
  const encrypted = Buffer.concat([
    cipher.update(String(plaintext), "utf8"),
    cipher.final(),
  ]);
  const envelope = {
    format: BACKUP_ENCRYPTION_FORMAT,
    encryptionVersion: BACKUP_ENCRYPTION_VERSION,
    algorithm: BACKUP_ENCRYPTION_ALGORITHM,
    keyId,
    iv: encode(iv),
    authTag: encode(cipher.getAuthTag()),
    ciphertext: encode(encrypted),
  };
  return JSON.stringify(envelope);
}

export function decryptBackupText(serialized, secretOrKeyring) {
  const envelope = parseEnvelope(serialized);
  const version = envelope.encryptionVersion;
  const keyId = version === LEGACY_BACKUP_ENCRYPTION_VERSION
    ? DEFAULT_BACKUP_ENCRYPTION_KEY_ID
    : envelope.keyId;
  const iv = decode(envelope.iv, "iv");
  const authTag = decode(envelope.authTag, "authTag");
  const ciphertext = decode(envelope.ciphertext, "ciphertext");
  if (iv.length !== IV_BYTES || authTag.length !== 16) {
    throw new Error("暗号化バックアップの認証情報が不正です");
  }

  const decipher = createDecipheriv(
    BACKUP_ENCRYPTION_ALGORITHM,
    deriveKey(resolveDecryptSecret(secretOrKeyring, keyId)),
    iv,
  );
  decipher.setAAD(associatedData(version));
  decipher.setAuthTag(authTag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("暗号化バックアップの改ざん検知に失敗しました");
  }
}

export function encryptBackupPayload(payload, secret, options = {}) {
  return encryptBackupText(JSON.stringify(payload), secret, options);
}

export function decryptBackupPayload(serialized, secretOrKeyring) {
  const plaintext = decryptBackupText(serialized, secretOrKeyring);
  try {
    return JSON.parse(plaintext);
  } catch {
    throw new Error("復号したバックアップがJSONではありません");
  }
}

export function getBackupEnvelopeMetadata(serialized) {
  const envelope = parseEnvelope(serialized);
  return {
    format: envelope.format,
    encryptionVersion: envelope.encryptionVersion,
    algorithm: envelope.algorithm,
    keyId:
      envelope.encryptionVersion === LEGACY_BACKUP_ENCRYPTION_VERSION
        ? DEFAULT_BACKUP_ENCRYPTION_KEY_ID
        : envelope.keyId,
  };
}

async function readStdin(stdin) {
  const chunks = [];
  for await (const chunk of stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8").trim();
}

function parseKeyring(raw, activeKeyId) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("BACKUP_ENCRYPTION_KEYS_JSON が有効なJSONではありません");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("BACKUP_ENCRYPTION_KEYS_JSON は keyId と鍵のJSONオブジェクトで指定してください");
  }
  const keys = Object.fromEntries(
    Object.entries(parsed).filter(
      ([keyId, value]) =>
        /^[A-Za-z0-9._-]{1,64}$/.test(keyId) &&
        typeof value === "string" &&
        value.trim().length >= MINIMUM_KEY_LENGTH,
    ),
  );
  const selectedKeyId = activeKeyId?.trim() || DEFAULT_BACKUP_ENCRYPTION_KEY_ID;
  if (!keys[selectedKeyId]) {
    throw new Error(`BACKUP_ENCRYPTION_ACTIVE_KEY_ID が鍵輪番設定に存在しません: ${selectedKeyId}`);
  }
  return { keyId: selectedKeyId, secret: keys[selectedKeyId], keys };
}

export async function resolveBackupEncryptionConfig({
  environment = process.env,
  readFromStdin = false,
  stdin = process.stdin,
} = {}) {
  const keyringRaw = environment.BACKUP_ENCRYPTION_KEYS_JSON?.trim();
  if (keyringRaw) return parseKeyring(keyringRaw, environment.BACKUP_ENCRYPTION_ACTIVE_KEY_ID);

  const fromEnvironment = environment.BACKUP_ENCRYPTION_KEY?.trim();
  if (fromEnvironment) {
    const keyId = environment.BACKUP_ENCRYPTION_KEY_ID?.trim() || DEFAULT_BACKUP_ENCRYPTION_KEY_ID;
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(keyId)) {
      throw new Error("BACKUP_ENCRYPTION_KEY_ID が不正です");
    }
    return { keyId, secret: fromEnvironment, keys: { [keyId]: fromEnvironment } };
  }

  if (readFromStdin) {
    const fromStdin = await readStdin(stdin);
    if (fromStdin) {
      const keyId = environment.BACKUP_ENCRYPTION_KEY_ID?.trim() || DEFAULT_BACKUP_ENCRYPTION_KEY_ID;
      return { keyId, secret: fromStdin, keys: { [keyId]: fromStdin } };
    }
  }

  throw new Error(
    "ローカル保存には BACKUP_ENCRYPTION_KEY(S)_JSON または --encryption-key-stdin が必要です",
  );
}

export async function resolveBackupEncryptionKey(options = {}) {
  const config = await resolveBackupEncryptionConfig(options);
  return config.secret;
}
