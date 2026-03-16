import { createCipheriv, createDecipheriv, createHmac, hkdf, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // GCM recommended IV size
const TAG_LENGTH = 16; // GCM auth tag length

/**
 * Read MASTER_ENCRYPTION_KEY from env.
 * Must be 64 hex characters (32 bytes).
 */
export function getMasterKey(): Buffer {
  const hex = process.env.MASTER_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      "MASTER_ENCRYPTION_KEY must be a 64-character hex string (32 bytes). Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    );
  }
  return Buffer.from(hex, "hex");
}

/**
 * Derive a per-document key using HKDF-SHA256.
 * @param masterKey - 32-byte master key
 * @param salt - Unique salt (e.g. documentId)
 * @param info - Context string (e.g. "document", "clause")
 * @returns 32-byte derived key
 */
export function deriveKey(masterKey: Buffer, salt: string, info: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    hkdf("sha256", masterKey, salt, info, 32, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(Buffer.from(derivedKey));
    });
  });
}

/**
 * Encrypt plaintext using AES-256-GCM.
 * @returns "iv.tag.ciphertext" (base64, dot-separated)
 */
export function encrypt(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${encrypted.toString("base64")}`;
}

/**
 * Decrypt AES-256-GCM ciphertext.
 * @param ciphertext - "iv.tag.ciphertext" (base64, dot-separated)
 * @returns Decrypted plaintext string
 */
export function decrypt(ciphertext: string, key: Buffer): string {
  const parts = ciphertext.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid ciphertext format: expected iv.tag.ciphertext");
  }
  const iv = Buffer.from(parts[0]!, "base64");
  const tag = Buffer.from(parts[1]!, "base64");
  const encrypted = Buffer.from(parts[2]!, "base64");

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted) + decipher.final("utf8");
}

/**
 * Encrypt a buffer using AES-256-GCM.
 * Returns: iv (12 bytes) + tag (16 bytes) + ciphertext
 */
export function encryptBuffer(buffer: Buffer, key: Buffer): Buffer {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]);
}

/**
 * Decrypt a buffer encrypted with encryptBuffer.
 * Input: iv (12 bytes) + tag (16 bytes) + ciphertext
 */
export function decryptBuffer(encrypted: Buffer, key: Buffer): Buffer {
  const iv = encrypted.subarray(0, IV_LENGTH);
  const tag = encrypted.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = encrypted.subarray(IV_LENGTH + TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * Hash an IP address with HMAC-SHA256.
 * Returns a 64-character hex string (resistant to rainbow tables).
 */
export function hashIp(ip: string, key: Buffer): string {
  return createHmac("sha256", key).update(ip).digest("hex");
}
