import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ClausePositionsEventSchema,
  DocumentTextEventSchema,
  SSEEventSchema,
} from "../schemas/events";

// ---------------------------------------------------------------------------
// Crypto: use real implementation (no mocks)
// ---------------------------------------------------------------------------

const TEST_KEY_HEX = "a".repeat(64);
vi.stubEnv("MASTER_ENCRYPTION_KEY", TEST_KEY_HEX);

const { decrypt, deriveKey, encrypt, getMasterKey } = await import("../crypto");

// ---------------------------------------------------------------------------
// Crypto edge cases
// ---------------------------------------------------------------------------

describe("crypto edge cases", () => {
  beforeEach(() => {
    vi.stubEnv("MASTER_ENCRYPTION_KEY", TEST_KEY_HEX);
  });

  it("round-trips an empty string", async () => {
    const key = await deriveKey(getMasterKey(), "doc-empty", "document");

    const ciphertext = encrypt("", key);
    const decrypted = decrypt(ciphertext, key);

    expect(decrypted).toBe("");
  });

  it("round-trips a very long string (100 KB)", async () => {
    const key = await deriveKey(getMasterKey(), "doc-large", "document");
    const plaintext = "x".repeat(100 * 1024);

    const ciphertext = encrypt(plaintext, key);
    const decrypted = decrypt(ciphertext, key);

    expect(decrypted).toBe(plaintext);
    expect(decrypted.length).toBe(100 * 1024);
  });

  it("produces different ciphertexts for the same plaintext (random IV)", async () => {
    const key = await deriveKey(getMasterKey(), "doc-iv", "document");
    const plaintext = "identical content";

    const ct1 = encrypt(plaintext, key);
    const ct2 = encrypt(plaintext, key);

    // IVs differ, so ciphertexts differ
    expect(ct1).not.toBe(ct2);

    // Both decrypt back to the same plaintext
    expect(decrypt(ct1, key)).toBe(plaintext);
    expect(decrypt(ct2, key)).toBe(plaintext);
  });

  it("deriveKey is deterministic for the same inputs", async () => {
    const masterKey = getMasterKey();

    const key1 = await deriveKey(masterKey, "doc-deterministic", "document");
    const key2 = await deriveKey(masterKey, "doc-deterministic", "document");

    expect(key1.equals(key2)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SSE event schema validation edge cases
// ---------------------------------------------------------------------------

describe("SSE event schema edge cases", () => {
  describe("DocumentTextEventSchema", () => {
    it("accepts valid document_text event with pdf fileType", () => {
      const result = DocumentTextEventSchema.safeParse({
        type: "document_text",
        data: {
          text: "This is the full contract text...",
          fileType: "pdf",
        },
      });
      expect(result.success).toBe(true);
    });

    it("rejects invalid fileType (xlsx)", () => {
      const result = DocumentTextEventSchema.safeParse({
        type: "document_text",
        data: {
          text: "Some text",
          fileType: "xlsx",
        },
      });
      expect(result.success).toBe(false);
    });
  });

  describe("ClausePositionsEventSchema", () => {
    it("accepts valid positioned clauses with startIndex/endIndex", () => {
      const result = ClausePositionsEventSchema.safeParse({
        type: "clause_positions",
        data: {
          totalClauses: 2,
          clauses: [
            { text: "First clause text", position: 0, startIndex: 0, endIndex: 17 },
            { text: "Second clause text", position: 1, startIndex: 18, endIndex: 36 },
          ],
        },
      });
      expect(result.success).toBe(true);
    });

    it("accepts clauses with -1 sentinel for unfound positions", () => {
      const result = ClausePositionsEventSchema.safeParse({
        type: "clause_positions",
        data: {
          totalClauses: 1,
          clauses: [
            { text: "Clause not found in text", position: 0, startIndex: -1, endIndex: -1 },
          ],
        },
      });
      expect(result.success).toBe(true);
    });
  });

  describe("SSEEventSchema discriminated union", () => {
    it("correctly identifies an error event", () => {
      const result = SSEEventSchema.safeParse({
        type: "error",
        message: "Pipeline failed",
        recoverable: false,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe("error");
      }
    });

    it("rejects an event with unknown type", () => {
      const result = SSEEventSchema.safeParse({
        type: "unknown_event",
        data: {},
      });
      expect(result.success).toBe(false);
    });
  });
});
