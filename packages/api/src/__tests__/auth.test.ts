import { TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

// Mock DB (needed by analysis router)
vi.mock("@redflag/db", () => ({
  getDb: () => ({}),
  analyses: {},
  clauses: {},
  documents: {},
  eq: vi.fn(),
  sql: vi.fn(),
}));

vi.mock("@redflag/agents", () => ({
  analyzeContract: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getUser: () => Promise.resolve({ data: { user: null } }) },
  }),
  parseCookieHeader: () => [],
}));

const { createTRPCContext, protectedProcedure } = await import("../trpc");
const { createCallerFactory } = await import("../index");

describe("createTRPCContext", () => {
  it("returns user: null when no request is provided", async () => {
    const ctx = await createTRPCContext();
    expect(ctx.user).toBeNull();
  });

  it("returns user: null when env vars are missing", async () => {
    const req = new Request("http://localhost:3000/api/trpc/test");
    const ctx = await createTRPCContext({ req });
    expect(ctx.user).toBeNull();
  });
});

describe("protectedProcedure", () => {
  it("is exported and defined", () => {
    expect(protectedProcedure).toBeDefined();
  });

  it("rejects null user with UNAUTHORIZED", async () => {
    const { router } = await import("../trpc");
    const testRouter = router({
      protectedTest: protectedProcedure.query(() => "ok"),
    });
    const testFactory = createCallerFactory(testRouter);
    const testCaller = testFactory({ user: null });

    await expect(testCaller.protectedTest()).rejects.toThrow(TRPCError);
    await expect(testCaller.protectedTest()).rejects.toThrow("Sign in to continue.");
  });

  it("allows authenticated user through", async () => {
    const { router } = await import("../trpc");
    const testRouter = router({
      protectedTest: protectedProcedure.query(({ ctx }) => ctx.user.email),
    });
    const testFactory = createCallerFactory(testRouter);
    const testCaller = testFactory({
      user: { id: "user-1", email: "test@example.com" } as Awaited<
        ReturnType<typeof createTRPCContext>
      >["user"],
    });

    const result = await testCaller.protectedTest();
    expect(result).toBe("test@example.com");
  });
});
