import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { KnowledgePatternSchema } from "@redflag/shared";
import { describe, expect, it } from "vitest";

const DATA_DIR = join(import.meta.dirname, "..", "..", "..", "..", "data", "knowledge-base");

describe("knowledge base validation", () => {
  const files = readdirSync(DATA_DIR).filter((f) => f.endsWith(".json"));

  it("has JSON files for all 5 contract types", () => {
    const expected = ["employment.json", "freelance.json", "lease.json", "nda.json", "tos.json"];
    expect(files.sort()).toEqual(expected);
  });

  for (const file of files) {
    describe(file, () => {
      const raw = JSON.parse(readFileSync(join(DATA_DIR, file), "utf-8")) as unknown[];

      it("is a non-empty array", () => {
        expect(Array.isArray(raw)).toBe(true);
        expect(raw.length).toBeGreaterThan(0);
      });

      it("every entry passes KnowledgePatternSchema validation", () => {
        for (let i = 0; i < raw.length; i++) {
          const result = KnowledgePatternSchema.safeParse(raw[i]);
          if (!result.success) {
            const errors = result.error.issues
              .map((iss) => `${iss.path.join(".")}: ${iss.message}`)
              .join(", ");
            throw new Error(`${file}[${i}] validation failed: ${errors}`);
          }
        }
      });

      it("all IDs are unique", () => {
        const ids = raw.map((entry) => (entry as Record<string, unknown>).id as string);
        const unique = new Set(ids);
        expect(unique.size).toBe(ids.length);
      });

      it("all risk levels are red or yellow", () => {
        for (const entry of raw) {
          const riskLevel = (entry as Record<string, unknown>).riskLevel as string;
          expect(["red", "yellow"]).toContain(riskLevel);
        }
      });
    });
  }

  it("has no duplicate IDs across all files", () => {
    const allIds = new Set<string>();
    for (const file of files) {
      const entries = JSON.parse(readFileSync(join(DATA_DIR, file), "utf-8")) as Array<{
        id: string;
      }>;
      for (const entry of entries) {
        expect(allIds.has(entry.id)).toBe(false);
        allIds.add(entry.id);
      }
    }
  });

  it("has at least 100 total patterns", () => {
    let total = 0;
    for (const file of files) {
      const entries = JSON.parse(readFileSync(join(DATA_DIR, file), "utf-8")) as unknown[];
      total += entries.length;
    }
    expect(total).toBeGreaterThanOrEqual(100);
  });

  describe("invalid entries are rejected", () => {
    it("rejects entry missing required field", () => {
      const result = KnowledgePatternSchema.safeParse({
        id: "a1b2c3d4-1001-4a00-b000-000000000001",
        clausePattern: "Some clause",
        // missing category
        contractType: ["lease"],
        riskLevel: "red",
        whyRisky: "Because it is risky",
        saferAlternative: "A safer version",
        jurisdictionNotes: "Some law",
      });
      expect(result.success).toBe(false);
    });

    it("rejects entry with invalid risk level", () => {
      const result = KnowledgePatternSchema.safeParse({
        id: "a1b2c3d4-1001-4a00-b000-000000000001",
        clausePattern: "Some clause",
        category: "test",
        contractType: ["lease"],
        riskLevel: "green", // invalid for knowledge patterns
        whyRisky: "Because it is risky",
        saferAlternative: "A safer version",
        jurisdictionNotes: "Some law",
      });
      expect(result.success).toBe(false);
    });

    it("rejects entry with invalid UUID", () => {
      const result = KnowledgePatternSchema.safeParse({
        id: "not-a-uuid",
        clausePattern: "Some clause",
        category: "test",
        contractType: ["lease"],
        riskLevel: "red",
        whyRisky: "Because it is risky",
        saferAlternative: "A safer version",
        jurisdictionNotes: "Some law",
      });
      expect(result.success).toBe(false);
    });

    it("rejects entry with non-array contractType", () => {
      const result = KnowledgePatternSchema.safeParse({
        id: "a1b2c3d4-1001-4a00-b000-000000000001",
        clausePattern: "Some clause",
        category: "test",
        contractType: "lease", // should be array
        riskLevel: "red",
        whyRisky: "Because it is risky",
        saferAlternative: "A safer version",
        jurisdictionNotes: "Some law",
      });
      expect(result.success).toBe(false);
    });
  });
});
