import { describe, expect, it } from "vitest";
import { SUPPORTED_LANGUAGES } from "../constants";
import { ResponseLanguageSchema } from "../schemas/language";

describe("SUPPORTED_LANGUAGES", () => {
  it("has 16 entries (15 languages + auto)", () => {
    expect(SUPPORTED_LANGUAGES).toHaveLength(16);
  });

  it("each entry has code, name, and nativeName", () => {
    for (const lang of SUPPORTED_LANGUAGES) {
      expect(lang.code).toMatch(/^([a-z]{2}|auto)$/);
      expect(lang.name.length).toBeGreaterThan(0);
      expect(lang.nativeName.length).toBeGreaterThan(0);
    }
  });

  it("includes the required tier-1 languages", () => {
    const codes = SUPPORTED_LANGUAGES.map((l) => l.code);
    for (const code of [
      "en",
      "fr",
      "de",
      "es",
      "it",
      "pt",
      "nl",
      "ar",
      "zh",
      "ja",
      "ko",
      "hi",
      "ru",
      "id",
      "tr",
    ]) {
      expect(codes).toContain(code);
    }
  });

  it("has unique language codes", () => {
    const codes = SUPPORTED_LANGUAGES.map((l) => l.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe("ResponseLanguageSchema", () => {
  it("accepts valid language codes", () => {
    expect(ResponseLanguageSchema.parse("auto")).toBe("auto");
    expect(ResponseLanguageSchema.parse("en")).toBe("en");
    expect(ResponseLanguageSchema.parse("fr")).toBe("fr");
    expect(ResponseLanguageSchema.parse("zh")).toBe("zh");
  });

  it("rejects invalid language codes", () => {
    expect(() => ResponseLanguageSchema.parse("xx")).toThrow();
    expect(() => ResponseLanguageSchema.parse("")).toThrow();
    expect(() => ResponseLanguageSchema.parse("english")).toThrow();
  });
});
