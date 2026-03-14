import { describe, expect, it } from "vitest";
import { appRouter, createCallerFactory, createTRPCContext } from "../index";

describe("health router", () => {
  it("returns status ok", async () => {
    const createCaller = createCallerFactory(appRouter);
    const caller = createCaller(await createTRPCContext());
    const result = await caller.health.check();
    expect(result).toEqual({ status: "ok" });
  });
});
