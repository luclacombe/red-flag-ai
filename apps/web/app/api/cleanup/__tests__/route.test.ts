import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────

const mockSelect = vi.fn();
const mockDelete = vi.fn();
const mockRemove = vi.fn();

vi.mock("@redflag/db", () => ({
  getDb: () => ({
    select: mockSelect,
    delete: mockDelete,
  }),
  documents: {
    id: "id",
    userId: "user_id",
    storagePath: "storage_path",
  },
  analyses: {
    id: "id",
    documentId: "document_id",
  },
  eq: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    storage: {
      from: () => ({
        remove: mockRemove,
      }),
    },
  }),
}));

const mockDecrypt = vi.fn();
const mockDeriveKey = vi.fn();
const mockGetMasterKey = vi.fn();

vi.mock("@redflag/shared", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@redflag/shared/crypto", () => ({
  decrypt: (...args: unknown[]) => mockDecrypt(...args),
  deriveKey: (...args: unknown[]) => mockDeriveKey(...args),
  getMasterKey: () => mockGetMasterKey(),
}));

const { POST } = await import("../route");

// ── Helpers ────────────────────────────────────────────────────

function makeRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost:3000/api/cleanup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ── Tests ──────────────────────────────────────────────────────

describe("POST /api/cleanup", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-key");

    mockGetMasterKey.mockReturnValue(Buffer.alloc(32));
    mockDeriveKey.mockResolvedValue(Buffer.alloc(32));
    mockDecrypt.mockImplementation((val: string) => `decrypted-${val}`);
  });

  it("returns 400 when analysisId missing", async () => {
    const req = makeRequest({});

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain("Missing analysisId");
  });

  it("returns 400 when analysisId is not a string", async () => {
    const req = makeRequest({ analysisId: 123 });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain("Missing analysisId");
  });

  it("returns { ok: true } for non-existent analysis (no-op)", async () => {
    // Analysis lookup returns empty array
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });

    const req = makeRequest({ analysisId: "nonexistent-id" });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    // Should not try to look up documents or delete anything
    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it("returns { ok: true } for authenticated user's analysis (doesn't delete)", async () => {
    // First select: analysis lookup
    // Second select: document lookup (has userId, so not anonymous)
    let selectCallCount = 0;
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation(() => {
          selectCallCount++;
          if (selectCallCount === 1) {
            return Promise.resolve([{ documentId: "doc-123" }]);
          }
          // Document has a userId — not anonymous
          return Promise.resolve([
            { id: "doc-123", userId: "user-abc", storagePath: "encrypted-path" },
          ]);
        }),
      }),
    });

    const req = makeRequest({ analysisId: "analysis-456" });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    // Should NOT delete anything because document belongs to an authenticated user
    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it("deletes anonymous document + storage on valid request", async () => {
    let selectCallCount = 0;
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation(() => {
          selectCallCount++;
          if (selectCallCount === 1) {
            return Promise.resolve([{ documentId: "doc-anon" }]);
          }
          // Document has null userId — anonymous
          return Promise.resolve([
            { id: "doc-anon", userId: null, storagePath: "encrypted-anon-path" },
          ]);
        }),
      }),
    });

    mockRemove.mockResolvedValue({ error: null });

    mockDelete.mockReturnValue({
      where: vi.fn().mockResolvedValue({ rowCount: 1 }),
    });

    const req = makeRequest({ analysisId: "analysis-anon" });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(mockRemove).toHaveBeenCalledTimes(1);
    expect(mockDelete).toHaveBeenCalled();
  });

  it("handles storage deletion failures gracefully", async () => {
    let selectCallCount = 0;
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation(() => {
          selectCallCount++;
          if (selectCallCount === 1) {
            return Promise.resolve([{ documentId: "doc-fail" }]);
          }
          return Promise.resolve([{ id: "doc-fail", userId: null, storagePath: "encrypted-path" }]);
        }),
      }),
    });

    // Storage removal throws an error
    mockDecrypt.mockImplementation(() => {
      throw new Error("Decryption failed");
    });

    mockDelete.mockReturnValue({
      where: vi.fn().mockResolvedValue({ rowCount: 1 }),
    });

    const req = makeRequest({ analysisId: "analysis-fail" });
    const res = await POST(req);
    const body = await res.json();

    // Should still succeed — storage cleanup is best-effort
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    // Document should still be deleted from DB even if storage failed
    expect(mockDelete).toHaveBeenCalled();
  });

  it("returns { ok: true } when document not found for analysis", async () => {
    let selectCallCount = 0;
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation(() => {
          selectCallCount++;
          if (selectCallCount === 1) {
            return Promise.resolve([{ documentId: "doc-missing" }]);
          }
          // Document not found
          return Promise.resolve([]);
        }),
      }),
    });

    const req = makeRequest({ analysisId: "analysis-orphan" });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(mockDelete).not.toHaveBeenCalled();
  });
});
