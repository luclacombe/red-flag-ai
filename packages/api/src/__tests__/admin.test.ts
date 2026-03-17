import { TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

// Mock DB
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockOrderBy = vi.fn();

vi.mock("@redflag/db", () => ({
  getDb: () => ({
    select: () => ({
      from: (table: unknown) => {
        mockFrom(table);
        return {
          where: (condition: unknown) => {
            mockWhere(condition);
            return {
              orderBy: (order: unknown) => {
                mockOrderBy(order);
                return Promise.resolve([]);
              },
            };
          },
        };
      },
    }),
  }),
  pipelineMetrics: { createdAt: "created_at" },
  gte: vi.fn(),
  desc: vi.fn(),
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

const { appRouter, createCallerFactory } = await import("../index");
const { createTRPCContext } = await import("../trpc");

describe("admin router", () => {
  it("rejects unauthenticated users", async () => {
    const createCaller = createCallerFactory(appRouter);
    const caller = createCaller(await createTRPCContext());

    await expect(caller.admin.dashboard({ period: "24h" })).rejects.toThrow(TRPCError);
    await expect(caller.admin.dashboard({ period: "24h" })).rejects.toThrow("Sign in to continue.");
  });

  it("rejects non-admin users", async () => {
    const createCaller = createCallerFactory(appRouter);
    const caller = createCaller({
      user: { id: "user-1", email: "regular@example.com" } as Awaited<
        ReturnType<typeof createTRPCContext>
      >["user"],
    });

    // No ADMIN_EMAIL set or email doesn't match
    await expect(caller.admin.dashboard({ period: "24h" })).rejects.toThrow(TRPCError);
    await expect(caller.admin.dashboard({ period: "24h" })).rejects.toThrow(
      "Admin access required.",
    );
  });

  it("allows admin user and returns correct shape", async () => {
    // Set admin email
    process.env.ADMIN_EMAIL = "admin@example.com";

    const createCaller = createCallerFactory(appRouter);
    const caller = createCaller({
      user: { id: "admin-1", email: "admin@example.com" } as Awaited<
        ReturnType<typeof createTRPCContext>
      >["user"],
    });

    const result = await caller.admin.dashboard({ period: "24h" });

    expect(result).toHaveProperty("stats");
    expect(result).toHaveProperty("recentAnalyses");
    expect(result).toHaveProperty("errors");
    expect(result.stats).toEqual({
      totalAnalyses: 0,
      successRate: 0,
      avgDurationMs: 0,
      estimatedCostUsd: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
    });
    expect(result.recentAnalyses).toEqual([]);
    expect(result.errors).toEqual([]);

    // Clean up
    delete process.env.ADMIN_EMAIL;
  });

  it("validates period input", async () => {
    process.env.ADMIN_EMAIL = "admin@example.com";

    const createCaller = createCallerFactory(appRouter);
    const caller = createCaller({
      user: { id: "admin-1", email: "admin@example.com" } as Awaited<
        ReturnType<typeof createTRPCContext>
      >["user"],
    });

    // @ts-expect-error — intentionally passing invalid input
    await expect(caller.admin.dashboard({ period: "1y" })).rejects.toThrow();

    delete process.env.ADMIN_EMAIL;
  });
});
