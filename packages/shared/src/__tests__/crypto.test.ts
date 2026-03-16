import { beforeEach, describe, expect, it, vi } from "vitest";

// Set a valid test master key before importing crypto module
const TEST_KEY_HEX = "a".repeat(64);

vi.stubEnv("MASTER_ENCRYPTION_KEY", TEST_KEY_HEX);

const { decrypt, decryptBuffer, deriveKey, encrypt, encryptBuffer, getMasterKey, hashIp } =
  await import("../crypto");

describe("crypto utilities", () => {
  beforeEach(() => {
    vi.stubEnv("MASTER_ENCRYPTION_KEY", TEST_KEY_HEX);
  });

  describe("getMasterKey", () => {
    it("returns a 32-byte Buffer from 64-char hex env var", () => {
      const key = getMasterKey();
      expect(key).toBeInstanceOf(Buffer);
      expect(key.length).toBe(32);
    });

    it("throws when env var is missing", () => {
      vi.stubEnv("MASTER_ENCRYPTION_KEY", "");
      expect(() => getMasterKey()).toThrow("MASTER_ENCRYPTION_KEY");
    });

    it("throws when env var is wrong length", () => {
      vi.stubEnv("MASTER_ENCRYPTION_KEY", "abcdef");
      expect(() => getMasterKey()).toThrow("64-character hex string");
    });
  });

  describe("deriveKey", () => {
    it("returns a 32-byte Buffer", async () => {
      const masterKey = getMasterKey();
      const derived = await deriveKey(masterKey, "doc-123", "document");
      expect(derived).toBeInstanceOf(Buffer);
      expect(derived.length).toBe(32);
    });

    it("produces different keys for different salts", async () => {
      const masterKey = getMasterKey();
      const key1 = await deriveKey(masterKey, "doc-111", "document");
      const key2 = await deriveKey(masterKey, "doc-222", "document");
      expect(key1.equals(key2)).toBe(false);
    });

    it("produces different keys for different info strings", async () => {
      const masterKey = getMasterKey();
      const key1 = await deriveKey(masterKey, "doc-123", "document");
      const key2 = await deriveKey(masterKey, "doc-123", "clause");
      expect(key1.equals(key2)).toBe(false);
    });

    it("produces consistent output for same inputs", async () => {
      const masterKey = getMasterKey();
      const key1 = await deriveKey(masterKey, "doc-123", "document");
      const key2 = await deriveKey(masterKey, "doc-123", "document");
      expect(key1.equals(key2)).toBe(true);
    });
  });

  describe("encrypt / decrypt", () => {
    it("round-trips plaintext correctly", async () => {
      const masterKey = getMasterKey();
      const key = await deriveKey(masterKey, "doc-test", "document");
      const plaintext = "This is a confidential lease agreement.";

      const ciphertext = encrypt(plaintext, key);
      const decrypted = decrypt(ciphertext, key);

      expect(decrypted).toBe(plaintext);
    });

    it("produces format: iv.tag.ciphertext (base64 dot-separated)", async () => {
      const masterKey = getMasterKey();
      const key = await deriveKey(masterKey, "doc-test", "document");
      const ciphertext = encrypt("hello", key);

      const parts = ciphertext.split(".");
      expect(parts.length).toBe(3);
      // All parts should be valid base64
      for (const part of parts) {
        expect(() => Buffer.from(part, "base64")).not.toThrow();
      }
    });

    it("produces different ciphertext for same plaintext (random IV)", async () => {
      const masterKey = getMasterKey();
      const key = await deriveKey(masterKey, "doc-test", "document");
      const plaintext = "same text";

      const ct1 = encrypt(plaintext, key);
      const ct2 = encrypt(plaintext, key);

      expect(ct1).not.toBe(ct2);
      // But both decrypt to the same plaintext
      expect(decrypt(ct1, key)).toBe(plaintext);
      expect(decrypt(ct2, key)).toBe(plaintext);
    });

    it("throws on decryption with wrong key (GCM auth tag verification)", async () => {
      const masterKey = getMasterKey();
      const key1 = await deriveKey(masterKey, "doc-1", "document");
      const key2 = await deriveKey(masterKey, "doc-2", "document");

      const ciphertext = encrypt("secret data", key1);

      expect(() => decrypt(ciphertext, key2)).toThrow();
    });

    it("throws on invalid ciphertext format", async () => {
      const masterKey = getMasterKey();
      const key = await deriveKey(masterKey, "doc-test", "document");

      expect(() => decrypt("not.valid", key)).toThrow("Invalid ciphertext format");
      expect(() => decrypt("single-part", key)).toThrow("Invalid ciphertext format");
    });

    it("handles empty string", async () => {
      const masterKey = getMasterKey();
      const key = await deriveKey(masterKey, "doc-test", "document");

      const ciphertext = encrypt("", key);
      expect(decrypt(ciphertext, key)).toBe("");
    });

    it("handles unicode text", async () => {
      const masterKey = getMasterKey();
      const key = await deriveKey(masterKey, "doc-test", "document");
      const plaintext = "Contrat de bail résidentiel — 日本語テスト — العربية";

      const ciphertext = encrypt(plaintext, key);
      expect(decrypt(ciphertext, key)).toBe(plaintext);
    });

    it("handles large text", async () => {
      const masterKey = getMasterKey();
      const key = await deriveKey(masterKey, "doc-test", "document");
      const plaintext = "a".repeat(100_000);

      const ciphertext = encrypt(plaintext, key);
      expect(decrypt(ciphertext, key)).toBe(plaintext);
    });
  });

  describe("encryptBuffer / decryptBuffer", () => {
    it("round-trips a buffer correctly", async () => {
      const masterKey = getMasterKey();
      const key = await deriveKey(masterKey, "doc-test", "document");
      const original = Buffer.from("PDF file content here %PDF-1.4");

      const encrypted = encryptBuffer(original, key);
      const decrypted = decryptBuffer(encrypted, key);

      expect(decrypted.equals(original)).toBe(true);
    });

    it("produces different output than input", async () => {
      const masterKey = getMasterKey();
      const key = await deriveKey(masterKey, "doc-test", "document");
      const original = Buffer.from("some data");

      const encrypted = encryptBuffer(original, key);
      expect(encrypted.equals(original)).toBe(false);
    });

    it("throws on decryption with wrong key", async () => {
      const masterKey = getMasterKey();
      const key1 = await deriveKey(masterKey, "doc-1", "document");
      const key2 = await deriveKey(masterKey, "doc-2", "document");

      const encrypted = encryptBuffer(Buffer.from("secret"), key1);
      expect(() => decryptBuffer(encrypted, key2)).toThrow();
    });

    it("handles empty buffer", async () => {
      const masterKey = getMasterKey();
      const key = await deriveKey(masterKey, "doc-test", "document");
      const original = Buffer.alloc(0);

      const encrypted = encryptBuffer(original, key);
      const decrypted = decryptBuffer(encrypted, key);

      expect(decrypted.length).toBe(0);
    });

    it("handles binary data (non-UTF8)", async () => {
      const masterKey = getMasterKey();
      const key = await deriveKey(masterKey, "doc-test", "document");
      const original = Buffer.from([0x00, 0xff, 0x50, 0x4b, 0x03, 0x04, 0xfe, 0xdc]);

      const encrypted = encryptBuffer(original, key);
      const decrypted = decryptBuffer(encrypted, key);

      expect(decrypted.equals(original)).toBe(true);
    });
  });

  describe("hashIp", () => {
    it("produces a 64-character hex string", async () => {
      const masterKey = getMasterKey();
      const key = await deriveKey(masterKey, "rate-limit", "ip-hash");
      const hash = hashIp("192.168.1.1", key);

      expect(hash.length).toBe(64);
      expect(/^[0-9a-f]{64}$/.test(hash)).toBe(true);
    });

    it("produces consistent output for same IP + key", async () => {
      const masterKey = getMasterKey();
      const key = await deriveKey(masterKey, "rate-limit", "ip-hash");

      const hash1 = hashIp("10.0.0.1", key);
      const hash2 = hashIp("10.0.0.1", key);

      expect(hash1).toBe(hash2);
    });

    it("produces different output for different IPs", async () => {
      const masterKey = getMasterKey();
      const key = await deriveKey(masterKey, "rate-limit", "ip-hash");

      const hash1 = hashIp("10.0.0.1", key);
      const hash2 = hashIp("10.0.0.2", key);

      expect(hash1).not.toBe(hash2);
    });

    it("produces different output with different keys", async () => {
      const masterKey = getMasterKey();
      const key1 = await deriveKey(masterKey, "rate-limit-1", "ip-hash");
      const key2 = await deriveKey(masterKey, "rate-limit-2", "ip-hash");

      const hash1 = hashIp("10.0.0.1", key1);
      const hash2 = hashIp("10.0.0.1", key2);

      expect(hash1).not.toBe(hash2);
    });
  });
});
