import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────

const mockSelect = vi.fn();
const mockDownload = vi.fn();

vi.mock("@redflag/db", () => ({
  getDb: () => ({
    select: mockSelect,
  }),
  analyses: {
    id: "id",
    documentId: "document_id",
  },
  documents: {
    id: "id",
    userId: "user_id",
    storagePath: "storage_path",
    fileType: "file_type",
  },
  eq: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    storage: {
      from: () => ({
        download: (...args: unknown[]) => mockDownload(...args),
      }),
    },
  }),
}));

const mockGetUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () =>
    Promise.resolve({
      auth: { getUser: mockGetUser },
    }),
}));

const mockDecrypt = vi.fn();
const mockDecryptBuffer = vi.fn();
const mockDeriveKey = vi.fn();
const mockGetMasterKey = vi.fn();

vi.mock("@redflag/shared", () => ({
  DOCX_MIME: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  TXT_MIME: "text/plain",
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@redflag/shared/crypto", () => ({
  decrypt: (...args: unknown[]) => mockDecrypt(...args),
  decryptBuffer: (...args: unknown[]) => mockDecryptBuffer(...args),
  deriveKey: (...args: unknown[]) => mockDeriveKey(...args),
  getMasterKey: () => mockGetMasterKey(),
}));

const { GET } = await import("../route");

// ── Helpers ────────────────────────────────────────────────────

function makeRequest(): Request {
  return new Request("http://localhost:3000/api/document/analysis-123", {
    method: "GET",
  });
}

function makeParams(id = "analysis-123"): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

function makeBlobFromBuffer(buffer: Buffer): Blob {
  return new Blob([new Uint8Array(buffer)]);
}

// ── Tests ──────────────────────────────────────────────────────

describe("GET /api/document/[id]", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-anon-key");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-key");

    mockGetMasterKey.mockReturnValue(Buffer.alloc(32));
    mockDeriveKey.mockResolvedValue(Buffer.alloc(32));
    mockDecrypt.mockImplementation((val: string) => `decrypted-${val}`);
    mockDecryptBuffer.mockImplementation((buf: Buffer) => buf);
  });

  it("returns 403 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const res = await GET(makeRequest(), makeParams());
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 404 when analysis not found", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-123" } },
    });

    // Analysis lookup returns empty
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });

    const res = await GET(makeRequest(), makeParams());
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe("Analysis not found");
  });

  it("returns 404 when document not found", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-123" } },
    });

    let selectCallCount = 0;
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation(() => {
          selectCallCount++;
          if (selectCallCount === 1) {
            return Promise.resolve([{ id: "analysis-123", documentId: "doc-missing" }]);
          }
          // Document not found
          return Promise.resolve([]);
        }),
      }),
    });

    const res = await GET(makeRequest(), makeParams());
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe("Document not found");
  });

  it("returns 403 when user doesn't own document", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-123" } },
    });

    let selectCallCount = 0;
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation(() => {
          selectCallCount++;
          if (selectCallCount === 1) {
            return Promise.resolve([{ id: "analysis-123", documentId: "doc-456" }]);
          }
          // Document belongs to a different user
          return Promise.resolve([
            {
              id: "doc-456",
              userId: "other-user",
              storagePath: "encrypted-path",
              fileType: "pdf",
            },
          ]);
        }),
      }),
    });

    const res = await GET(makeRequest(), makeParams());
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe("Forbidden");
  });

  it("returns decrypted file binary with correct Content-Type for PDF", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-owner" } },
    });

    let selectCallCount = 0;
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation(() => {
          selectCallCount++;
          if (selectCallCount === 1) {
            return Promise.resolve([{ id: "analysis-123", documentId: "doc-pdf" }]);
          }
          return Promise.resolve([
            {
              id: "doc-pdf",
              userId: "user-owner",
              storagePath: "encrypted-storage-path",
              fileType: "pdf",
            },
          ]);
        }),
      }),
    });

    const fileContent = Buffer.from("%PDF-1.4 test content");
    mockDownload.mockResolvedValue({
      data: makeBlobFromBuffer(fileContent),
      error: null,
    });

    const decryptedContent = Buffer.from("decrypted PDF content");
    mockDecryptBuffer.mockReturnValue(decryptedContent);

    const res = await GET(makeRequest(), makeParams());

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=3600");

    const responseBytes = new Uint8Array(await res.arrayBuffer());
    expect(responseBytes).toEqual(new Uint8Array(decryptedContent));
  });

  it("returns decrypted file binary with correct Content-Type for DOCX", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-owner" } },
    });

    let selectCallCount = 0;
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation(() => {
          selectCallCount++;
          if (selectCallCount === 1) {
            return Promise.resolve([{ id: "analysis-123", documentId: "doc-docx" }]);
          }
          return Promise.resolve([
            {
              id: "doc-docx",
              userId: "user-owner",
              storagePath: "encrypted-storage-path",
              fileType: "docx",
            },
          ]);
        }),
      }),
    });

    const fileContent = Buffer.from("PK\x03\x04 docx content");
    mockDownload.mockResolvedValue({
      data: makeBlobFromBuffer(fileContent),
      error: null,
    });

    const decryptedContent = Buffer.from("decrypted DOCX content");
    mockDecryptBuffer.mockReturnValue(decryptedContent);

    const res = await GET(makeRequest(), makeParams());

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=3600");
  });

  it("sets Cache-Control: private header", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-owner" } },
    });

    let selectCallCount = 0;
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation(() => {
          selectCallCount++;
          if (selectCallCount === 1) {
            return Promise.resolve([{ id: "analysis-123", documentId: "doc-txt" }]);
          }
          return Promise.resolve([
            {
              id: "doc-txt",
              userId: "user-owner",
              storagePath: "encrypted-path",
              fileType: "txt",
            },
          ]);
        }),
      }),
    });

    const fileContent = Buffer.from("plain text content");
    mockDownload.mockResolvedValue({
      data: makeBlobFromBuffer(fileContent),
      error: null,
    });

    mockDecryptBuffer.mockReturnValue(Buffer.from("decrypted text"));

    const res = await GET(makeRequest(), makeParams());

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=3600");
    expect(res.headers.get("Content-Type")).toBe("text/plain");
  });

  it("returns 404 when storage download fails", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-owner" } },
    });

    let selectCallCount = 0;
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation(() => {
          selectCallCount++;
          if (selectCallCount === 1) {
            return Promise.resolve([{ id: "analysis-123", documentId: "doc-gone" }]);
          }
          return Promise.resolve([
            {
              id: "doc-gone",
              userId: "user-owner",
              storagePath: "encrypted-path",
              fileType: "pdf",
            },
          ]);
        }),
      }),
    });

    mockDownload.mockResolvedValue({
      data: null,
      error: { message: "Object not found" },
    });

    const res = await GET(makeRequest(), makeParams());
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe("File not found in storage");
  });
});
