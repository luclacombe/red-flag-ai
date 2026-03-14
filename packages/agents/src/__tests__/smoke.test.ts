import { describe, expect, it } from "vitest";

describe("agents package", () => {
  it("can import from @redflag/shared", async () => {
    const { MAX_PAGES } = await import("@redflag/shared");
    expect(MAX_PAGES).toBe(30);
  });
});
