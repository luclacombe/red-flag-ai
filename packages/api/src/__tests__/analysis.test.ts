import type { SSEEvent } from "@redflag/shared";
import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock DB
const mockSelect = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();
const mockInsert = vi.fn();

vi.mock("@redflag/db", () => ({
  getDb: () => ({
    select: mockSelect,
    update: mockUpdate,
    delete: mockDelete,
    insert: mockInsert,
  }),
  analyses: {
    id: "id",
    status: "status",
    updatedAt: "updated_at",
    documentId: "document_id",
    createdAt: "created_at",
    overallRiskScore: "overall_risk_score",
    recommendation: "recommendation",
  },
  clauses: { analysisId: "analysis_id", position: "position" },
  documents: {
    id: "id",
    userId: "user_id",
    filename: "filename",
    contractType: "contract_type",
    storagePath: "storage_path",
  },
  eq: vi.fn((_col: unknown, _val: unknown) => "eq-condition"),
  sql: Object.assign((strings: TemplateStringsArray, ..._values: unknown[]) => strings.join(""), {
    raw: (str: string) => str,
  }),
}));

// Mock Supabase SSR (imported by trpc.ts context)
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getUser: () => Promise.resolve({ data: { user: null } }) },
  }),
  parseCookieHeader: () => [],
}));

// Mock crypto
vi.mock("@redflag/shared/crypto", () => ({
  getMasterKey: () => Buffer.alloc(32),
  deriveKey: vi.fn().mockResolvedValue(Buffer.alloc(32)),
  decrypt: vi.fn((val: string) => val),
}));

// Mock Supabase JS (service role client for storage deletion)
const mockStorageRemove = vi.fn().mockResolvedValue({ error: null });
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    storage: {
      from: () => ({
        remove: mockStorageRemove,
      }),
    },
  }),
}));

// Mock rate limiter
const mockCheckRateLimit = vi
  .fn()
  .mockResolvedValue({ limited: false, resetAt: "2026-01-02T00:00:00.000Z" });
vi.mock("../rateLimit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

// Mock analyzeContract
const mockAnalyzeContract = vi.fn();
vi.mock("@redflag/agents", () => ({
  analyzeContract: (...args: unknown[]) => mockAnalyzeContract(...args),
}));

const { appRouter, createCallerFactory, createTRPCContext } = await import("../index");

async function createCaller(user: { id: string; email: string } | null = null) {
  const factory = createCallerFactory(appRouter);
  return factory({ user } as Awaited<ReturnType<typeof createTRPCContext>>);
}

describe("analysis.get", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null for non-existent analysis", async () => {
    mockSelect.mockReturnValue({
      from: () => ({
        where: () => Promise.resolve([]),
      }),
    });

    const caller = await createCaller();
    const result = await caller.analysis.get({
      analysisId: "00000000-0000-0000-0000-000000000000",
    });
    expect(result).toBeNull();
  });

  it("returns analysis with clauses", async () => {
    const analysis = {
      id: "550e8400-e29b-41d4-a716-446655440000",
      documentId: "doc-1",
      status: "complete",
      overallRiskScore: 45,
      topConcerns: null,
      summaryText: null,
    };
    const clauseRows = [
      {
        id: "c1",
        clauseText: "Clause 1",
        explanation: "OK",
        saferAlternative: null,
        position: 0,
        riskLevel: "green",
      },
    ];

    let callCount = 0;
    mockSelect.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return { from: () => ({ where: () => Promise.resolve([analysis]) }) };
      }
      return {
        from: () => ({
          where: () => ({
            orderBy: () => Promise.resolve(clauseRows),
          }),
        }),
      };
    });

    const caller = await createCaller();
    const result = await caller.analysis.get({
      analysisId: "550e8400-e29b-41d4-a716-446655440000",
    });

    expect(result).not.toBeNull();
    expect(result?.status).toBe("complete");
    expect(result?.clauses).toHaveLength(1);
  });
});

describe("analysis.stream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("yields error for non-existent analysis", async () => {
    mockSelect.mockReturnValue({
      from: () => ({ where: () => Promise.resolve([]) }),
    });

    const caller = await createCaller();
    const events: SSEEvent[] = [];
    const iterable = await caller.analysis.stream({
      analysisId: "00000000-0000-0000-0000-000000000000",
    });
    for await (const event of iterable) {
      events.push(event as SSEEvent);
    }

    expect(events[0]).toMatchObject({
      type: "error",
      message: "Analysis not found.",
    });
  });

  it("replays clauses and summary for completed analysis", async () => {
    const analysis = {
      id: "a1",
      status: "complete",
      documentId: "doc-1",
      overallRiskScore: 30,
      recommendation: "sign",
      topConcerns: JSON.stringify([]),
      summaryText: null,
      updatedAt: new Date(),
    };
    const clauseRows = [
      {
        clauseText: "Clause 1",
        startIndex: 0,
        endIndex: 8,
        position: 0,
        riskLevel: "green",
        explanation: "OK",
        saferAlternative: null,
        category: "general",
        matchedPatterns: [],
      },
    ];

    let callCount = 0;
    mockSelect.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return { from: () => ({ where: () => Promise.resolve([analysis]) }) };
      }
      return {
        from: () => ({
          where: () => ({
            orderBy: () => Promise.resolve(clauseRows),
          }),
        }),
      };
    });

    const caller = await createCaller();
    const events: SSEEvent[] = [];
    const iterable = await caller.analysis.stream({
      analysisId: "550e8400-e29b-41d4-a716-446655440000",
    });
    for await (const event of iterable) {
      events.push(event as SSEEvent);
    }

    expect(events[0]?.type).toBe("clause_positions");
    expect(events[1]?.type).toBe("clause_analysis");
    expect(events[2]?.type).toBe("summary");
    expect(events).toHaveLength(3);
  });

  it("yields error for failed analysis", async () => {
    const analysis = {
      id: "a1",
      status: "failed",
      errorMessage: "Parse agent failed",
      updatedAt: new Date(),
    };

    mockSelect.mockReturnValue({
      from: () => ({ where: () => Promise.resolve([analysis]) }),
    });

    const caller = await createCaller();
    const events: SSEEvent[] = [];
    const iterable = await caller.analysis.stream({
      analysisId: "550e8400-e29b-41d4-a716-446655440000",
    });
    for await (const event of iterable) {
      events.push(event as SSEEvent);
    }

    expect(events[0]).toMatchObject({
      type: "error",
      message: "Parse agent failed",
      recoverable: true,
    });
  });

  it("polls DB and replays results when processing analysis completes", async () => {
    vi.useFakeTimers();

    const analysis = {
      id: "a1",
      status: "processing",
      documentId: "doc-1",
      updatedAt: new Date(), // Just now — not stale
      parsedClauses: null,
    };
    const completedAnalysis = {
      id: "a1",
      status: "complete",
      documentId: "doc-1",
      updatedAt: new Date(),
      overallRiskScore: 30,
      recommendation: "sign",
      topConcerns: JSON.stringify([]),
      summaryText: null,
      parsedClauses: null,
    };
    const dbClause = {
      clauseText: "Clause 1.",
      startIndex: 0,
      endIndex: 9,
      position: 0,
      riskLevel: "green",
      explanation: "Standard.",
      saferAlternative: null,
      category: "general",
      matchedPatterns: [],
    };

    let callCount = 0;
    mockSelect.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // Initial status check → processing
        return { from: () => ({ where: () => Promise.resolve([analysis]) }) };
      }
      if (callCount === 2) {
        // Access check — anonymous document (userId null)
        return { from: () => ({ where: () => Promise.resolve([{ userId: null }]) }) };
      }
      if (callCount === 3) {
        // Document fetch for document_text emission
        return {
          from: () => ({
            where: () =>
              Promise.resolve([
                { id: "doc-1", extractedText: "text", fileType: "pdf", userId: null },
              ]),
          }),
        };
      }
      if (callCount === 4) {
        // Initial existing clauses check (empty)
        return { from: () => ({ where: () => ({ orderBy: () => Promise.resolve([]) }) }) };
      }
      if (callCount === 5) {
        // First poll → complete
        return { from: () => ({ where: () => Promise.resolve([completedAnalysis]) }) };
      }
      // Clause replay after completion
      return {
        from: () => ({
          where: () => ({
            orderBy: () => Promise.resolve([dbClause]),
          }),
        }),
      };
    });

    const caller = await createCaller();
    const events: SSEEvent[] = [];

    // Start consuming events (will block on 3s poll interval)
    const collectPromise = (async () => {
      const iterable = await caller.analysis.stream({
        analysisId: "550e8400-e29b-41d4-a716-446655440000",
      });
      for await (const event of iterable) {
        events.push(event as SSEEvent);
      }
    })();

    // Advance past the 3s poll interval
    await vi.advanceTimersByTimeAsync(4_000);
    await collectPromise;

    expect(events.some((e) => e.type === "status")).toBe(true);
    expect(events.some((e) => e.type === "clause_analysis")).toBe(true);
    expect(events.some((e) => e.type === "summary")).toBe(true);

    vi.useRealTimers();
  });

  it("runs pipeline for pending analysis after claiming", async () => {
    const analysis = {
      id: "a1",
      status: "pending",
      documentId: "doc-1",
      updatedAt: new Date(),
    };
    const document = {
      id: "doc-1",
      extractedText: "Contract text here.",
      contractType: "nda",
      language: "en",
    };

    let callCount = 0;
    mockSelect.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return { from: () => ({ where: () => Promise.resolve([analysis]) }) };
      }
      return { from: () => ({ where: () => Promise.resolve([document]) }) };
    });

    // claimAnalysis returns claimed row
    mockUpdate.mockReturnValue({
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve([analysis]),
        }),
      }),
    });

    // Mock pipeline events
    async function* fakeAnalyze(): AsyncGenerator<SSEEvent> {
      yield { type: "status", message: "Parsing..." };
      yield {
        type: "clause_analysis",
        data: {
          clauseText: "Clause 1",
          startIndex: 0,
          endIndex: 8,
          position: 0,
          riskLevel: "green" as const,
          explanation: "OK",
          saferAlternative: null,
          category: "general",
          matchedPatterns: [],
        },
      };
      yield {
        type: "summary",
        data: {
          overallRiskScore: 10,
          recommendation: "sign" as const,
          topConcerns: [],
          clauseBreakdown: { red: 0, yellow: 0, green: 1 },
          language: "en",
          contractType: "nda",
        },
      };
    }
    mockAnalyzeContract.mockReturnValue(fakeAnalyze());

    const caller = await createCaller();
    const events: SSEEvent[] = [];
    const iterable = await caller.analysis.stream({
      analysisId: "550e8400-e29b-41d4-a716-446655440000",
    });
    for await (const event of iterable) {
      events.push(event as SSEEvent);
    }

    expect(events.some((e) => e.type === "clause_analysis")).toBe(true);
    expect(events.some((e) => e.type === "summary")).toBe(true);
    expect(mockAnalyzeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        analysisId: "550e8400-e29b-41d4-a716-446655440000",
        documentId: "doc-1",
        text: "Contract text here.",
        contractType: "nda",
        language: "en",
      }),
    );
  });

  it("yields status when claim fails (already claimed)", async () => {
    const analysis = {
      id: "a1",
      status: "pending",
      updatedAt: new Date(),
    };

    mockSelect.mockReturnValue({
      from: () => ({ where: () => Promise.resolve([analysis]) }),
    });

    // claimAnalysis returns empty (already claimed by another consumer)
    mockUpdate.mockReturnValue({
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve([]),
        }),
      }),
    });

    const caller = await createCaller();
    const events: SSEEvent[] = [];
    const iterable = await caller.analysis.stream({
      analysisId: "550e8400-e29b-41d4-a716-446655440000",
    });
    for await (const event of iterable) {
      events.push(event as SSEEvent);
    }

    expect(
      events.some((e) => e.type === "status" && e.message === "Analysis already in progress."),
    ).toBe(true);
  });
});

describe("analysis.list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects unauthenticated users", async () => {
    const caller = await createCaller(null);
    await expect(caller.analysis.list({ limit: 20 })).rejects.toThrow(TRPCError);
    await expect(caller.analysis.list({ limit: 20 })).rejects.toThrow("Sign in to continue.");
  });

  it("returns user's analyses with decrypted filenames", async () => {
    const rows = [
      {
        analysisId: "a1",
        documentId: "doc-1",
        status: "complete",
        overallRiskScore: 45,
        recommendation: "caution",
        createdAt: new Date("2026-01-01"),
        filename: "contract.pdf",
        contractType: "nda",
      },
    ];

    mockSelect.mockReturnValue({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            orderBy: () => ({
              limit: () => Promise.resolve(rows),
            }),
          }),
        }),
      }),
    });

    const caller = await createCaller({ id: "user-1", email: "test@example.com" });
    const result = await caller.analysis.list({ limit: 20 });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.id).toBe("a1");
    expect(result.items[0]?.documentName).toBe("contract.pdf"); // decrypt mock returns input
    expect(result.items[0]?.recommendation).toBe("caution");
    expect(result.nextCursor).toBeUndefined();
  });

  it("returns empty list for user with no analyses", async () => {
    mockSelect.mockReturnValue({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            orderBy: () => ({
              limit: () => Promise.resolve([]),
            }),
          }),
        }),
      }),
    });

    const caller = await createCaller({ id: "user-2", email: "new@example.com" });
    const result = await caller.analysis.list({ limit: 20 });

    expect(result.items).toHaveLength(0);
    expect(result.nextCursor).toBeUndefined();
  });

  it("returns nextCursor when more results exist", async () => {
    // Return limit + 1 rows to indicate more
    const rows = Array.from({ length: 3 }, (_, i) => ({
      analysisId: `a${i}`,
      documentId: `doc-${i}`,
      status: "complete",
      overallRiskScore: 50,
      recommendation: "caution",
      createdAt: new Date(`2026-01-0${i + 1}`),
      filename: `file${i}.pdf`,
      contractType: "nda",
    }));

    mockSelect.mockReturnValue({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            orderBy: () => ({
              limit: () => Promise.resolve(rows),
            }),
          }),
        }),
      }),
    });

    const caller = await createCaller({ id: "user-1", email: "test@example.com" });
    const result = await caller.analysis.list({ limit: 2 });

    expect(result.items).toHaveLength(2);
    expect(result.nextCursor).toBe("a1");
  });
});

describe("analysis.delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects unauthenticated users", async () => {
    const caller = await createCaller(null);
    await expect(
      caller.analysis.delete({ analysisId: "550e8400-e29b-41d4-a716-446655440000" }),
    ).rejects.toThrow("Sign in to continue.");
  });

  it("rejects if analysis does not exist", async () => {
    mockSelect.mockReturnValue({
      from: () => ({
        where: () => Promise.resolve([]),
      }),
    });

    const caller = await createCaller({ id: "user-1", email: "test@example.com" });
    await expect(
      caller.analysis.delete({ analysisId: "550e8400-e29b-41d4-a716-446655440000" }),
    ).rejects.toThrow("Analysis not found.");
  });

  it("rejects if user does not own the analysis", async () => {
    let callCount = 0;
    mockSelect.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // analysis lookup
        return {
          from: () => ({
            where: () => Promise.resolve([{ documentId: "doc-1" }]),
          }),
        };
      }
      // document lookup — different owner
      return {
        from: () => ({
          where: () =>
            Promise.resolve([{ id: "doc-1", userId: "other-user", storagePath: "path/file.pdf" }]),
        }),
      };
    });

    const caller = await createCaller({ id: "user-1", email: "test@example.com" });
    await expect(
      caller.analysis.delete({ analysisId: "550e8400-e29b-41d4-a716-446655440000" }),
    ).rejects.toThrow("You do not own this analysis.");
  });

  it("deletes analysis, storage file, and document for owner", async () => {
    // Set env vars so storage deletion runs
    const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";

    let selectCount = 0;
    mockSelect.mockImplementation(() => {
      selectCount++;
      if (selectCount === 1) {
        return {
          from: () => ({
            where: () => Promise.resolve([{ documentId: "doc-1" }]),
          }),
        };
      }
      return {
        from: () => ({
          where: () =>
            Promise.resolve([
              { id: "doc-1", userId: "user-1", storagePath: "user-1/abc/file.pdf" },
            ]),
        }),
      };
    });

    mockDelete.mockReturnValue({
      where: () => Promise.resolve(),
    });

    const caller = await createCaller({ id: "user-1", email: "test@example.com" });
    const result = await caller.analysis.delete({
      analysisId: "550e8400-e29b-41d4-a716-446655440000",
    });

    expect(result).toEqual({ ok: true });
    expect(mockStorageRemove).toHaveBeenCalledWith(["user-1/abc/file.pdf"]);
    expect(mockDelete).toHaveBeenCalled();

    // Restore env vars
    process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  });
});

describe("analysis.toggleShare", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("enables sharing with 7-day expiry", async () => {
    let selectCount = 0;
    mockSelect.mockImplementation(() => {
      selectCount++;
      if (selectCount === 1) {
        // analysis lookup
        return {
          from: () => ({ where: () => Promise.resolve([{ documentId: "doc-1" }]) }),
        };
      }
      // document ownership check
      return {
        from: () => ({ where: () => Promise.resolve([{ userId: "user-1" }]) }),
      };
    });

    mockUpdate.mockReturnValue({
      set: () => ({ where: () => Promise.resolve() }),
    });

    const before = Date.now();
    const caller = await createCaller({ id: "user-1", email: "test@example.com" });
    const result = await caller.analysis.toggleShare({
      analysisId: "550e8400-e29b-41d4-a716-446655440000",
      enabled: true,
    });

    expect(result.isPublic).toBe(true);
    expect(result.shareExpiresAt).toBeInstanceOf(Date);
    // Verify expiry is ~7 days from now (within 5s tolerance)
    const expectedMs = 7 * 24 * 60 * 60 * 1000;
    const expiresAt = result.shareExpiresAt as Date;
    const diff = expiresAt.getTime() - before;
    expect(diff).toBeGreaterThanOrEqual(expectedMs - 5000);
    expect(diff).toBeLessThanOrEqual(expectedMs + 5000);
  });

  it("disables sharing and clears expiry", async () => {
    let selectCount = 0;
    mockSelect.mockImplementation(() => {
      selectCount++;
      if (selectCount === 1) {
        return {
          from: () => ({ where: () => Promise.resolve([{ documentId: "doc-1" }]) }),
        };
      }
      return {
        from: () => ({ where: () => Promise.resolve([{ userId: "user-1" }]) }),
      };
    });

    mockUpdate.mockReturnValue({
      set: () => ({ where: () => Promise.resolve() }),
    });

    const caller = await createCaller({ id: "user-1", email: "test@example.com" });
    const result = await caller.analysis.toggleShare({
      analysisId: "550e8400-e29b-41d4-a716-446655440000",
      enabled: false,
    });

    expect(result.isPublic).toBe(false);
    expect(result.shareExpiresAt).toBeNull();
  });

  it("rejects unauthenticated users", async () => {
    const caller = await createCaller(null);
    await expect(
      caller.analysis.toggleShare({
        analysisId: "550e8400-e29b-41d4-a716-446655440000",
        enabled: true,
      }),
    ).rejects.toThrow("Sign in to continue.");
  });

  it("rejects if document not owned by user", async () => {
    let selectCount = 0;
    mockSelect.mockImplementation(() => {
      selectCount++;
      if (selectCount === 1) {
        return {
          from: () => ({ where: () => Promise.resolve([{ documentId: "doc-1" }]) }),
        };
      }
      // Different owner
      return {
        from: () => ({ where: () => Promise.resolve([{ userId: "other-user" }]) }),
      };
    });

    const caller = await createCaller({ id: "user-1", email: "test@example.com" });
    await expect(
      caller.analysis.toggleShare({
        analysisId: "550e8400-e29b-41d4-a716-446655440000",
        enabled: true,
      }),
    ).rejects.toThrow("You do not own this analysis.");
  });
});

describe("analysis.rename", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renames successfully and returns ok", async () => {
    let selectCount = 0;
    mockSelect.mockImplementation(() => {
      selectCount++;
      if (selectCount === 1) {
        return {
          from: () => ({ where: () => Promise.resolve([{ documentId: "doc-1" }]) }),
        };
      }
      return {
        from: () => ({ where: () => Promise.resolve([{ id: "doc-1", userId: "user-1" }]) }),
      };
    });

    mockUpdate.mockReturnValue({
      set: () => ({ where: () => Promise.resolve() }),
    });

    const caller = await createCaller({ id: "user-1", email: "test@example.com" });
    const result = await caller.analysis.rename({
      analysisId: "550e8400-e29b-41d4-a716-446655440000",
      newName: "My Contract",
    });

    expect(result).toEqual({ ok: true });
    expect(mockUpdate).toHaveBeenCalled();
  });

  it("rejects unauthenticated users", async () => {
    const caller = await createCaller(null);
    await expect(
      caller.analysis.rename({
        analysisId: "550e8400-e29b-41d4-a716-446655440000",
        newName: "New Name",
      }),
    ).rejects.toThrow("Sign in to continue.");
  });

  it("rejects if analysis not found", async () => {
    mockSelect.mockReturnValue({
      from: () => ({ where: () => Promise.resolve([]) }),
    });

    const caller = await createCaller({ id: "user-1", email: "test@example.com" });
    await expect(
      caller.analysis.rename({
        analysisId: "550e8400-e29b-41d4-a716-446655440000",
        newName: "New Name",
      }),
    ).rejects.toThrow("Analysis not found.");
  });

  it("rejects if document not owned by user", async () => {
    let selectCount = 0;
    mockSelect.mockImplementation(() => {
      selectCount++;
      if (selectCount === 1) {
        return {
          from: () => ({ where: () => Promise.resolve([{ documentId: "doc-1" }]) }),
        };
      }
      return {
        from: () => ({ where: () => Promise.resolve([{ id: "doc-1", userId: "other-user" }]) }),
      };
    });

    const caller = await createCaller({ id: "user-1", email: "test@example.com" });
    await expect(
      caller.analysis.rename({
        analysisId: "550e8400-e29b-41d4-a716-446655440000",
        newName: "New Name",
      }),
    ).rejects.toThrow("You do not own this analysis.");
  });
});

describe("analysis.rerun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ limited: false, resetAt: "2026-01-02T00:00:00.000Z" });
  });

  it("creates new analysis for same document", async () => {
    let selectCount = 0;
    mockSelect.mockImplementation(() => {
      selectCount++;
      if (selectCount === 1) {
        return {
          from: () => ({
            where: () => Promise.resolve([{ documentId: "doc-1", responseLanguage: "en" }]),
          }),
        };
      }
      return {
        from: () => ({ where: () => Promise.resolve([{ id: "doc-1", userId: "user-1" }]) }),
      };
    });

    mockInsert.mockReturnValue({
      values: () => Promise.resolve(),
    });

    const caller = await createCaller({ id: "user-1", email: "test@example.com" });
    const result = await caller.analysis.rerun({
      analysisId: "550e8400-e29b-41d4-a716-446655440000",
    });

    expect(result.analysisId).toBeDefined();
    expect(typeof result.analysisId).toBe("string");
    expect(mockInsert).toHaveBeenCalled();
    expect(mockCheckRateLimit).toHaveBeenCalledWith("user-1", true);
  });

  it("respects responseLanguage override", async () => {
    let selectCount = 0;
    mockSelect.mockImplementation(() => {
      selectCount++;
      if (selectCount === 1) {
        return {
          from: () => ({
            where: () => Promise.resolve([{ documentId: "doc-1", responseLanguage: "en" }]),
          }),
        };
      }
      return {
        from: () => ({ where: () => Promise.resolve([{ id: "doc-1", userId: "user-1" }]) }),
      };
    });

    mockInsert.mockReturnValue({
      values: () => Promise.resolve(),
    });

    const caller = await createCaller({ id: "user-1", email: "test@example.com" });
    const result = await caller.analysis.rerun({
      analysisId: "550e8400-e29b-41d4-a716-446655440000",
      responseLanguage: "fr",
    });

    expect(result.analysisId).toBeDefined();
    expect(mockInsert).toHaveBeenCalled();
  });

  it("rejects unauthenticated users", async () => {
    const caller = await createCaller(null);
    await expect(
      caller.analysis.rerun({
        analysisId: "550e8400-e29b-41d4-a716-446655440000",
      }),
    ).rejects.toThrow("Sign in to continue.");
  });

  it("rejects if original analysis not found", async () => {
    mockSelect.mockReturnValue({
      from: () => ({ where: () => Promise.resolve([]) }),
    });

    const caller = await createCaller({ id: "user-1", email: "test@example.com" });
    await expect(
      caller.analysis.rerun({
        analysisId: "550e8400-e29b-41d4-a716-446655440000",
      }),
    ).rejects.toThrow("Analysis not found.");
  });

  it("rejects when rate limit reached", async () => {
    let selectCount = 0;
    mockSelect.mockImplementation(() => {
      selectCount++;
      if (selectCount === 1) {
        return {
          from: () => ({
            where: () => Promise.resolve([{ documentId: "doc-1", responseLanguage: "en" }]),
          }),
        };
      }
      return {
        from: () => ({ where: () => Promise.resolve([{ id: "doc-1", userId: "user-1" }]) }),
      };
    });

    mockCheckRateLimit.mockResolvedValue({ limited: true, resetAt: "2026-01-02T00:00:00.000Z" });

    const caller = await createCaller({ id: "user-1", email: "test@example.com" });
    await expect(
      caller.analysis.rerun({
        analysisId: "550e8400-e29b-41d4-a716-446655440000",
      }),
    ).rejects.toThrow("Daily analysis limit reached. Try again tomorrow.");
  });
});

describe("analysis.renew", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sets expiresAt to 30 days from now", async () => {
    let selectCount = 0;
    mockSelect.mockImplementation(() => {
      selectCount++;
      if (selectCount === 1) {
        return {
          from: () => ({ where: () => Promise.resolve([{ documentId: "doc-1" }]) }),
        };
      }
      return {
        from: () => ({ where: () => Promise.resolve([{ id: "doc-1", userId: "user-1" }]) }),
      };
    });

    mockUpdate.mockReturnValue({
      set: () => ({ where: () => Promise.resolve() }),
    });

    const before = Date.now();
    const caller = await createCaller({ id: "user-1", email: "test@example.com" });
    const result = await caller.analysis.renew({
      analysisId: "550e8400-e29b-41d4-a716-446655440000",
    });

    expect(result.ok).toBe(true);
    expect(result.expiresAt).toBeInstanceOf(Date);
    // Verify expiry is ~30 days from now (within 5s tolerance)
    const expectedMs = 30 * 24 * 60 * 60 * 1000;
    const diff = result.expiresAt.getTime() - before;
    expect(diff).toBeGreaterThanOrEqual(expectedMs - 5000);
    expect(diff).toBeLessThanOrEqual(expectedMs + 5000);
    expect(mockUpdate).toHaveBeenCalled();
  });

  it("rejects unauthenticated users", async () => {
    const caller = await createCaller(null);
    await expect(
      caller.analysis.renew({
        analysisId: "550e8400-e29b-41d4-a716-446655440000",
      }),
    ).rejects.toThrow("Sign in to continue.");
  });

  it("rejects if document not owned by user", async () => {
    let selectCount = 0;
    mockSelect.mockImplementation(() => {
      selectCount++;
      if (selectCount === 1) {
        return {
          from: () => ({ where: () => Promise.resolve([{ documentId: "doc-1" }]) }),
        };
      }
      return {
        from: () => ({ where: () => Promise.resolve([{ id: "doc-1", userId: "other-user" }]) }),
      };
    });

    const caller = await createCaller({ id: "user-1", email: "test@example.com" });
    await expect(
      caller.analysis.renew({
        analysisId: "550e8400-e29b-41d4-a716-446655440000",
      }),
    ).rejects.toThrow("You do not own this analysis.");
  });
});
