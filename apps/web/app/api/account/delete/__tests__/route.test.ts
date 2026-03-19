import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────

const mockSelect = vi.fn();
const mockDelete = vi.fn();
const mockRemove = vi.fn();
const mockDeleteUser = vi.fn();

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
  sql: vi.fn((...args: unknown[]) => args),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    storage: {
      from: () => ({
        remove: mockRemove,
      }),
    },
    auth: {
      admin: {
        deleteUser: (...args: unknown[]) => mockDeleteUser(...args),
      },
    },
  }),
}));

const mockGetUser = vi.fn();
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getUser: mockGetUser },
  }),
}));

vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      getAll: () => [],
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

const { DELETE } = await import("../route");

// ── Tests ──────────────────────────────────────────────────────

describe("DELETE /api/account/delete", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-anon-key");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-key");

    mockGetMasterKey.mockReturnValue(Buffer.alloc(32));
    mockDeriveKey.mockResolvedValue(Buffer.alloc(32));
    mockDecrypt.mockImplementation((val: string) => `decrypted-${val}`);
  });

  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const res = await DELETE();
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("deletes all user documents + storage files + auth user on success", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-123" } },
    });

    const userDocs = [
      { id: "doc-1", storagePath: "encrypted-path-1" },
      { id: "doc-2", storagePath: "encrypted-path-2" },
    ];

    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(userDocs),
      }),
    });

    mockRemove.mockResolvedValue({ error: null });

    mockDelete.mockReturnValue({
      where: vi.fn().mockResolvedValue({ rowCount: 2 }),
    });

    mockDeleteUser.mockResolvedValue({ error: null });

    const res = await DELETE();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.docsDeleted).toBe(2);
    expect(body.storageDeleted).toBe(2);
    expect(mockRemove).toHaveBeenCalledTimes(2);
    expect(mockDeleteUser).toHaveBeenCalledWith("user-123");
  });

  it("returns { ok: true, docsDeleted, storageDeleted } counts", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-456" } },
    });

    const userDocs = [
      { id: "doc-a", storagePath: "path-a" },
      { id: "doc-b", storagePath: "path-b" },
      { id: "doc-c", storagePath: "path-c" },
    ];

    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(userDocs),
      }),
    });

    // Only 2 of 3 storage deletes succeed
    mockRemove
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: { message: "Not found" } })
      .mockResolvedValueOnce({ error: null });

    mockDelete.mockReturnValue({
      where: vi.fn().mockResolvedValue({ rowCount: 3 }),
    });

    mockDeleteUser.mockResolvedValue({ error: null });

    const res = await DELETE();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.docsDeleted).toBe(3);
    expect(body.storageDeleted).toBe(2);
  });

  it("handles storage deletion failures gracefully (continues)", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-789" } },
    });

    const userDocs = [
      { id: "doc-1", storagePath: "path-1" },
      { id: "doc-2", storagePath: "path-2" },
    ];

    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(userDocs),
      }),
    });

    // First storage delete throws, second succeeds
    mockDecrypt
      .mockImplementationOnce(() => {
        throw new Error("Decryption failed");
      })
      .mockImplementation((val: string) => `decrypted-${val}`);

    mockRemove.mockResolvedValue({ error: null });

    mockDelete.mockReturnValue({
      where: vi.fn().mockResolvedValue({ rowCount: 2 }),
    });

    mockDeleteUser.mockResolvedValue({ error: null });

    const res = await DELETE();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.docsDeleted).toBe(2);
    // Only 1 storage delete succeeded (first one threw on decrypt)
    expect(body.storageDeleted).toBe(1);
    expect(mockDeleteUser).toHaveBeenCalledWith("user-789");
  });

  it("handles empty document list (user with no uploads)", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-empty" } },
    });

    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });

    mockDeleteUser.mockResolvedValue({ error: null });

    const res = await DELETE();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.docsDeleted).toBe(0);
    expect(body.storageDeleted).toBe(0);
    expect(mockRemove).not.toHaveBeenCalled();
    // DB delete should NOT be called when there are no docs
    expect(mockDelete).not.toHaveBeenCalled();
    // Auth user should still be deleted
    expect(mockDeleteUser).toHaveBeenCalledWith("user-empty");
  });

  it("returns 500 when auth user deletion fails", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-fail" } },
    });

    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });

    mockDeleteUser.mockResolvedValue({
      error: { message: "Admin API error" },
    });

    const res = await DELETE();
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe("Failed to delete account");
  });
});
