import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────

const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockValues = vi.fn();
const mockSet = vi.fn();
const mockWhere = vi.fn();
const mockReturning = vi.fn();

vi.mock("@redflag/db", () => ({
  db: {
    insert: mockInsert,
    update: mockUpdate,
  },
  documents: { id: "documents.id" },
  analyses: { id: "analyses.id" },
  eq: vi.fn(),
  recordPipelineMetric: vi.fn(() => Promise.resolve()),
}));

const mockRelevanceGate = vi.fn();
vi.mock("@redflag/agents", () => ({
  relevanceGate: mockRelevanceGate,
}));

const mockUpload = vi.fn();
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    storage: {
      from: () => ({
        upload: mockUpload,
      }),
    },
  }),
}));

vi.mock("unpdf", () => ({
  getDocumentProxy: vi.fn(),
  extractText: vi.fn(),
}));

const mockExtractRawText = vi.fn();
vi.mock("mammoth", () => ({
  default: {
    extractRawText: mockExtractRawText,
  },
}));

const mockCheckRateLimit = vi.fn();
vi.mock("@redflag/api/rateLimit", () => ({
  checkRateLimit: mockCheckRateLimit,
}));

// Mock @supabase/ssr for auth user extraction in upload route
const mockGetUser = vi.fn();
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getUser: mockGetUser },
  }),
  parseCookieHeader: () => [],
}));

// Mock crypto utilities
vi.mock("@redflag/shared/crypto", () => ({
  getMasterKey: () => Buffer.alloc(32),
  deriveKey: vi.fn().mockResolvedValue(Buffer.alloc(32)),
  encrypt: vi.fn((plaintext: string) => `encrypted:${plaintext}`),
  encryptBuffer: vi.fn((buf: Buffer) => Buffer.concat([Buffer.from("ENC:"), buf])),
}));

// Import after mocks
const { POST } = await import("../route");
const unpdf = await import("unpdf");

// ── Helpers ────────────────────────────────────────────────────

function makePdfFile(content: Uint8Array, name = "test.pdf", type = "application/pdf"): File {
  return new File([content.buffer as ArrayBuffer], name, { type });
}

function makeDocxFile(content: Uint8Array, name = "test.docx"): File {
  return new File([content.buffer as ArrayBuffer], name, {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

function makeTxtFile(content: string, name = "test.txt"): File {
  return new File([content], name, { type: "text/plain" });
}

function makeRequest(file: File, responseLanguage?: string): Request {
  const formData = new FormData();
  formData.append("file", file);
  if (responseLanguage) formData.append("responseLanguage", responseLanguage);
  return new Request("http://localhost:3000/api/upload", {
    method: "POST",
    body: formData,
  });
}

/** Valid PDF magic bytes + some content */
function validPdfBytes(size = 100): Uint8Array {
  const bytes = new Uint8Array(size);
  // %PDF- magic bytes
  bytes[0] = 0x25; // %
  bytes[1] = 0x50; // P
  bytes[2] = 0x44; // D
  bytes[3] = 0x46; // F
  bytes[4] = 0x2d; // -
  return bytes;
}

/** Valid DOCX magic bytes (PK ZIP header) */
function validDocxBytes(size = 100): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes[0] = 0x50; // P
  bytes[1] = 0x4b; // K
  bytes[2] = 0x03;
  bytes[3] = 0x04;
  return bytes;
}

function setupDefaultMocks() {
  // unpdf mocks
  vi.mocked(unpdf.getDocumentProxy).mockResolvedValue({
    numPages: 5,
  } as ReturnType<typeof unpdf.getDocumentProxy> extends Promise<infer T> ? T : never);

  vi.mocked(unpdf.extractText).mockResolvedValue({
    text: "This is a residential lease agreement with sufficient text content for analysis.",
    totalPages: 5,
  });

  // Supabase upload
  mockUpload.mockResolvedValue({ error: null });

  // DB insert chain (documents)
  mockInsert.mockReturnValue({ values: mockValues });
  mockValues.mockReturnValue({ returning: mockReturning });
  mockReturning.mockResolvedValueOnce([{ id: "doc-123", filename: "test.pdf" }]);

  // DB update chain
  mockUpdate.mockReturnValue({ set: mockSet });
  mockSet.mockReturnValue({ where: mockWhere });
  mockWhere.mockResolvedValue(undefined);

  // DB insert chain (analyses) — second call
  mockReturning.mockResolvedValueOnce([
    { id: "analysis-456", documentId: "doc-123", status: "pending" },
  ]);
}

function setupDocxMocks() {
  mockExtractRawText.mockResolvedValue({
    value: "This is a residential lease agreement with sufficient text content for analysis.",
  });

  // Supabase upload
  mockUpload.mockResolvedValue({ error: null });

  // DB insert chain (documents)
  mockInsert.mockReturnValue({ values: mockValues });
  mockValues.mockReturnValue({ returning: mockReturning });
  mockReturning.mockResolvedValueOnce([{ id: "doc-123", filename: "test.docx" }]);

  // DB update chain
  mockUpdate.mockReturnValue({ set: mockSet });
  mockSet.mockReturnValue({ where: mockWhere });
  mockWhere.mockResolvedValue(undefined);

  // DB insert chain (analyses) — second call
  mockReturning.mockResolvedValueOnce([
    { id: "analysis-456", documentId: "doc-123", status: "pending" },
  ]);
}

function setupTxtMocks() {
  // Supabase upload
  mockUpload.mockResolvedValue({ error: null });

  // DB insert chain (documents)
  mockInsert.mockReturnValue({ values: mockValues });
  mockValues.mockReturnValue({ returning: mockReturning });
  mockReturning.mockResolvedValueOnce([{ id: "doc-123", filename: "test.txt" }]);

  // DB update chain
  mockUpdate.mockReturnValue({ set: mockSet });
  mockSet.mockReturnValue({ where: mockWhere });
  mockWhere.mockResolvedValue(undefined);

  // DB insert chain (analyses) — second call
  mockReturning.mockResolvedValueOnce([
    { id: "analysis-456", documentId: "doc-123", status: "pending" },
  ]);
}

// ── Tests ──────────────────────────────────────────────────────

describe("POST /api/upload", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-anon-key");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-key");
    vi.resetAllMocks();
    // Default: not rate-limited
    mockCheckRateLimit.mockResolvedValue({ limited: false, resetAt: "2026-03-16T00:00:00.000Z" });
    // Default: not authenticated
    mockGetUser.mockResolvedValue({ data: { user: null } });
  });

  describe("validation", () => {
    it("rejects when no file is provided", async () => {
      const formData = new FormData();
      const req = new Request("http://localhost:3000/api/upload", {
        method: "POST",
        body: formData,
      });

      const res = await POST(req as never);
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toContain("No file provided");
    });

    it("rejects unsupported MIME type", async () => {
      const file = new File(["hello"], "test.jpg", { type: "image/jpeg" });
      const req = makeRequest(file);

      const res = await POST(req as never);
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toContain("Invalid file type");
      expect(body.error).toContain("PDF, DOCX, or TXT");
    });

    it("rejects files without PDF magic bytes", async () => {
      const fakeBytes = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04]);
      const file = makePdfFile(fakeBytes);
      const req = makeRequest(file);

      const res = await POST(req as never);
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toContain("not a valid PDF");
    });

    it("rejects DOCX files without PK magic bytes", async () => {
      const fakeBytes = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
      const file = makeDocxFile(fakeBytes);
      const req = makeRequest(file);

      const res = await POST(req as never);
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toContain("not a valid DOCX");
    });

    it("rejects files exceeding 10MB", async () => {
      const bigBytes = validPdfBytes(11 * 1024 * 1024);
      const file = makePdfFile(bigBytes);
      const req = makeRequest(file);

      const res = await POST(req as never);
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toContain("File too large");
    });

    it("rejects PDFs exceeding 30 pages", async () => {
      const bytes = validPdfBytes();
      const file = makePdfFile(bytes);
      const req = makeRequest(file);

      vi.mocked(unpdf.getDocumentProxy).mockResolvedValue({
        numPages: 35,
      } as ReturnType<typeof unpdf.getDocumentProxy> extends Promise<infer T> ? T : never);
      vi.mocked(unpdf.extractText).mockResolvedValue({
        text: "Some text content here that is long enough",
        totalPages: 35,
      });

      const res = await POST(req as never);
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toContain("35 pages");
      expect(body.error).toContain("Maximum is 30");
    });

    it("rejects scanned PDFs with no text", async () => {
      const bytes = validPdfBytes();
      const file = makePdfFile(bytes);
      const req = makeRequest(file);

      vi.mocked(unpdf.getDocumentProxy).mockResolvedValue({
        numPages: 3,
      } as ReturnType<typeof unpdf.getDocumentProxy> extends Promise<infer T> ? T : never);
      vi.mocked(unpdf.extractText).mockResolvedValue({
        text: "",
        totalPages: 3,
      });

      const res = await POST(req as never);
      const body = await res.json();

      expect(res.status).toBe(422);
      expect(body.error).toContain("scanned image");
    });

    it("rejects documents with too little text", async () => {
      const bytes = validPdfBytes();
      const file = makePdfFile(bytes);
      const req = makeRequest(file);

      vi.mocked(unpdf.getDocumentProxy).mockResolvedValue({
        numPages: 1,
      } as ReturnType<typeof unpdf.getDocumentProxy> extends Promise<infer T> ? T : never);
      vi.mocked(unpdf.extractText).mockResolvedValue({
        text: "Short",
        totalPages: 1,
      });

      const res = await POST(req as never);
      const body = await res.json();

      expect(res.status).toBe(422);
      expect(body.error).toContain("enough text");
    });

    it("rejects DOCX exceeding character limit", async () => {
      const bytes = validDocxBytes();
      const file = makeDocxFile(bytes);
      const req = makeRequest(file);

      mockExtractRawText.mockResolvedValue({
        value: "a".repeat(100_000),
      });

      const res = await POST(req as never);
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toContain("too long");
      expect(body.error).toContain("90,000");
    });

    it("rejects TXT exceeding character limit", async () => {
      const longText = "a".repeat(100_000);
      const file = makeTxtFile(longText);
      const req = makeRequest(file);

      const res = await POST(req as never);
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toContain("too long");
      expect(body.error).toContain("90,000");
    });
  });

  describe("DOCX upload", () => {
    it("extracts text from DOCX and runs pipeline", async () => {
      const bytes = validDocxBytes();
      const file = makeDocxFile(bytes);
      const req = makeRequest(file);

      setupDocxMocks();
      mockRelevanceGate.mockResolvedValue({
        isContract: true,
        contractType: "residential_lease",
        language: "en",
        reason: "This is a lease agreement.",
      });

      const res = await POST(req as never);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.isContract).toBe(true);
      expect(body.analysisId).toBe("analysis-456");
      expect(mockExtractRawText).toHaveBeenCalled();
    });

    it("sets fileType to docx in document record", async () => {
      const bytes = validDocxBytes();
      const file = makeDocxFile(bytes);
      const req = makeRequest(file);

      setupDocxMocks();
      mockRelevanceGate.mockResolvedValue({
        isContract: true,
        contractType: "nda",
        language: "en",
        reason: "NDA.",
      });

      await POST(req as never);

      const insertCalls = mockValues.mock.calls;
      const docInsert = insertCalls[0]?.[0] as Record<string, unknown> | undefined;
      expect(docInsert?.fileType).toBe("docx");
    });
  });

  describe("TXT upload", () => {
    it("extracts text from TXT and runs pipeline", async () => {
      const text =
        "This is a residential lease agreement with sufficient text content for analysis.";
      const file = makeTxtFile(text);
      const req = makeRequest(file);

      setupTxtMocks();
      mockRelevanceGate.mockResolvedValue({
        isContract: true,
        contractType: "residential_lease",
        language: "en",
        reason: "This is a lease agreement.",
      });

      const res = await POST(req as never);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.isContract).toBe(true);
      expect(body.analysisId).toBe("analysis-456");
    });

    it("sets fileType to txt in document record", async () => {
      const text =
        "This is a residential lease agreement with sufficient text content for analysis.";
      const file = makeTxtFile(text);
      const req = makeRequest(file);

      setupTxtMocks();
      mockRelevanceGate.mockResolvedValue({
        isContract: true,
        contractType: "nda",
        language: "en",
        reason: "NDA.",
      });

      await POST(req as never);

      const insertCalls = mockValues.mock.calls;
      const docInsert = insertCalls[0]?.[0] as Record<string, unknown> | undefined;
      expect(docInsert?.fileType).toBe("txt");
    });
  });

  describe("gate integration", () => {
    it("returns isContract: false when gate rejects", async () => {
      const bytes = validPdfBytes();
      const file = makePdfFile(bytes);
      const req = makeRequest(file);

      setupDefaultMocks();
      mockRelevanceGate.mockResolvedValue({
        isContract: false,
        contractType: null,
        language: "en",
        reason: "This is a recipe, not a contract.",
      });

      const res = await POST(req as never);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.isContract).toBe(false);
      expect(body.reason).toContain("recipe");
    });

    it("returns analysisId when gate accepts", async () => {
      const bytes = validPdfBytes();
      const file = makePdfFile(bytes);
      const req = makeRequest(file);

      setupDefaultMocks();
      mockRelevanceGate.mockResolvedValue({
        isContract: true,
        contractType: "residential_lease",
        language: "en",
        reason: "This is a lease agreement.",
      });

      const res = await POST(req as never);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.isContract).toBe(true);
      expect(body.analysisId).toBe("analysis-456");
      expect(body.contractType).toBe("residential_lease");
      expect(body.language).toBe("en");
    });

    it("stores responseLanguage on analysis record", async () => {
      const bytes = validPdfBytes();
      const file = makePdfFile(bytes);
      const req = makeRequest(file, "fr");

      setupDefaultMocks();
      mockRelevanceGate.mockResolvedValue({
        isContract: true,
        contractType: "lease",
        language: "fr",
        reason: "This is a lease.",
      });

      const res = await POST(req as never);
      expect(res.status).toBe(200);

      // The second insert call (analysis record) should include responseLanguage
      const insertCalls = mockValues.mock.calls;
      const analysisInsert = insertCalls[1]?.[0] as Record<string, unknown> | undefined;
      expect(analysisInsert?.responseLanguage).toBe("fr");
    });

    it("defaults responseLanguage to en when not provided", async () => {
      const bytes = validPdfBytes();
      const file = makePdfFile(bytes);
      const req = makeRequest(file);

      setupDefaultMocks();
      mockRelevanceGate.mockResolvedValue({
        isContract: true,
        contractType: "nda",
        language: "en",
        reason: "This is an NDA.",
      });

      const res = await POST(req as never);
      expect(res.status).toBe(200);

      const insertCalls = mockValues.mock.calls;
      const analysisInsert = insertCalls[1]?.[0] as Record<string, unknown> | undefined;
      expect(analysisInsert?.responseLanguage).toBe("en");
    });

    it("returns 503 when gate throws", async () => {
      const bytes = validPdfBytes();
      const file = makePdfFile(bytes);
      const req = makeRequest(file);

      setupDefaultMocks();
      mockRelevanceGate.mockRejectedValue(new Error("Relevance gate failed after 2 attempts"));

      const res = await POST(req as never);
      const body = await res.json();

      expect(res.status).toBe(503);
      expect(body.error).toContain("temporarily unavailable");
    });
  });

  describe("rate limiting", () => {
    it("returns 429 when rate-limited", async () => {
      mockCheckRateLimit.mockResolvedValue({
        limited: true,
        resetAt: "2026-03-16T00:00:00.000Z",
      });

      const bytes = validPdfBytes();
      const file = makePdfFile(bytes);
      const req = makeRequest(file);

      const res = await POST(req as never);
      const body = await res.json();

      expect(res.status).toBe(429);
      expect(body.error).toContain("limit");
      expect(body.resetAt).toBe("2026-03-16T00:00:00.000Z");
    });

    it("continues processing when not rate-limited", async () => {
      const bytes = validPdfBytes();
      const file = makePdfFile(bytes);
      const req = makeRequest(file);

      setupDefaultMocks();
      mockRelevanceGate.mockResolvedValue({
        isContract: true,
        contractType: "nda",
        language: "en",
        reason: "This is an NDA.",
      });

      const res = await POST(req as never);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.isContract).toBe(true);
    });

    it("continues processing when rate limit check fails", async () => {
      mockCheckRateLimit.mockRejectedValue(new Error("DB connection failed"));

      const bytes = validPdfBytes();
      const file = makePdfFile(bytes);
      const req = makeRequest(file);

      setupDefaultMocks();
      mockRelevanceGate.mockResolvedValue({
        isContract: true,
        contractType: "lease",
        language: "en",
        reason: "Lease.",
      });

      const res = await POST(req as never);
      const body = await res.json();

      // Should not block user — graceful degradation
      expect(res.status).toBe(200);
      expect(body.isContract).toBe(true);
    });
  });

  describe("auth integration", () => {
    it("sets userId on document when authenticated", async () => {
      mockGetUser.mockResolvedValue({
        data: { user: { id: "user-abc-123" } },
      });

      const bytes = validPdfBytes();
      const file = makePdfFile(bytes);
      const req = makeRequest(file);

      setupDefaultMocks();
      mockRelevanceGate.mockResolvedValue({
        isContract: true,
        contractType: "nda",
        language: "en",
        reason: "NDA.",
      });

      const res = await POST(req as never);
      expect(res.status).toBe(200);

      const insertCalls = mockValues.mock.calls;
      const docInsert = insertCalls[0]?.[0] as Record<string, unknown> | undefined;
      expect(docInsert?.userId).toBe("user-abc-123");
    });

    it("sets userId to null when not authenticated", async () => {
      const bytes = validPdfBytes();
      const file = makePdfFile(bytes);
      const req = makeRequest(file);

      setupDefaultMocks();
      mockRelevanceGate.mockResolvedValue({
        isContract: true,
        contractType: "nda",
        language: "en",
        reason: "NDA.",
      });

      const res = await POST(req as never);
      expect(res.status).toBe(200);

      const insertCalls = mockValues.mock.calls;
      const docInsert = insertCalls[0]?.[0] as Record<string, unknown> | undefined;
      expect(docInsert?.userId).toBeNull();
    });

    it("uses userId for rate limiting when authenticated", async () => {
      mockGetUser.mockResolvedValue({
        data: { user: { id: "user-abc-123" } },
      });

      const bytes = validPdfBytes();
      const file = makePdfFile(bytes);
      const req = makeRequest(file);

      setupDefaultMocks();
      mockRelevanceGate.mockResolvedValue({
        isContract: true,
        contractType: "nda",
        language: "en",
        reason: "NDA.",
      });

      await POST(req as never);

      expect(mockCheckRateLimit).toHaveBeenCalledWith("user-abc-123", true);
    });

    it("uses IP for rate limiting when not authenticated", async () => {
      const bytes = validPdfBytes();
      const file = makePdfFile(bytes);
      const req = makeRequest(file);

      setupDefaultMocks();
      mockRelevanceGate.mockResolvedValue({
        isContract: true,
        contractType: "nda",
        language: "en",
        reason: "NDA.",
      });

      await POST(req as never);

      expect(mockCheckRateLimit).toHaveBeenCalledWith("unknown", false);
    });
  });
});
