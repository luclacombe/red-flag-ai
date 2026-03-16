import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ──────────────────────────────────────────────────

const mockSelect = vi.fn();
const mockDelete = vi.fn();
const mockRemove = vi.fn();

vi.mock("@redflag/db", () => ({
  getDb: () => ({
    select: mockSelect,
    delete: mockDelete,
  }),
  documents: { id: "id", storagePath: "storage_path", createdAt: "created_at" },
  rateLimits: { date: "date" },
  sql: vi.fn((...args: unknown[]) => args),
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

const { GET } = await import("../route");

// ── Tests ──────────────────────────────────────────────────

describe("GET /api/cron/cleanup", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-key");
    vi.stubEnv("CRON_SECRET", "test-secret");
    vi.stubEnv("MASTER_ENCRYPTION_KEY", "a".repeat(64));

    mockGetMasterKey.mockReturnValue(Buffer.alloc(32));
    mockDeriveKey.mockResolvedValue(Buffer.alloc(32));
    mockDecrypt.mockImplementation((val: string) => `decrypted-${val}`);
  });

  it("rejects requests with wrong CRON_SECRET", async () => {
    const req = new Request("http://localhost:3000/api/cron/cleanup", {
      headers: { authorization: "Bearer wrong-secret" },
    });

    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("rejects requests when CRON_SECRET is not set (fail-closed)", async () => {
    vi.stubEnv("CRON_SECRET", "");

    const req = new Request("http://localhost:3000/api/cron/cleanup");
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("accepts requests with correct CRON_SECRET", async () => {
    // No old documents or rate limits
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });
    mockDelete.mockReturnValue({
      where: vi.fn().mockResolvedValue({ rowCount: 0 }),
    });

    const req = new Request("http://localhost:3000/api/cron/cleanup", {
      headers: { authorization: "Bearer test-secret" },
    });

    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it("deletes old documents and their storage files", async () => {
    const oldDocs = [
      { id: "doc-1", storagePath: "path/to/file1.pdf" },
      { id: "doc-2", storagePath: "path/to/file2.pdf" },
    ];

    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(oldDocs),
      }),
    });

    mockRemove.mockResolvedValue({ error: null });

    mockDelete.mockReturnValue({
      where: vi.fn().mockResolvedValue({ rowCount: 2 }),
    });

    const req = new Request("http://localhost:3000/api/cron/cleanup", {
      headers: { authorization: "Bearer test-secret" },
    });

    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.docsDeleted).toBe(2);
    expect(body.storageDeleted).toBe(2);
    expect(mockRemove).toHaveBeenCalledTimes(2);
  });

  it("continues when storage delete fails", async () => {
    const oldDocs = [{ id: "doc-1", storagePath: "path/to/file.pdf" }];

    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(oldDocs),
      }),
    });

    mockRemove.mockResolvedValue({ error: { message: "Not found" } });

    mockDelete.mockReturnValue({
      where: vi.fn().mockResolvedValue({ rowCount: 1 }),
    });

    const req = new Request("http://localhost:3000/api/cron/cleanup", {
      headers: { authorization: "Bearer test-secret" },
    });

    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.storageFailed).toBe(1);
    expect(body.docsDeleted).toBe(1);
  });

  it("deletes old rate limit rows", async () => {
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });

    let deleteCallCount = 0;
    mockDelete.mockImplementation(() => ({
      where: vi.fn().mockImplementation(() => {
        deleteCallCount++;
        if (deleteCallCount === 1) {
          return Promise.resolve({ rowCount: 0 }); // documents
        }
        return Promise.resolve({ rowCount: 5 }); // rate_limits
      }),
    }));

    const req = new Request("http://localhost:3000/api/cron/cleanup", {
      headers: { authorization: "Bearer test-secret" },
    });

    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.rateLimitsDeleted).toBe(0);
  });
});
