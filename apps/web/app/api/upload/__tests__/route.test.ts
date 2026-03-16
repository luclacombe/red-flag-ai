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

const mockCheckRateLimit = vi.fn();
vi.mock("@redflag/api/rateLimit", () => ({
  checkRateLimit: mockCheckRateLimit,
}));

// Import after mocks
const { POST } = await import("../route");
const unpdf = await import("unpdf");

// ── Helpers ────────────────────────────────────────────────────

function makePdfFile(content: Uint8Array, name = "test.pdf", type = "application/pdf"): File {
  return new File([content.buffer as ArrayBuffer], name, { type });
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

// ── Tests ──────────────────────────────────────────────────────

describe("POST /api/upload", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-key");
    vi.resetAllMocks();
    // Default: not rate-limited
    mockCheckRateLimit.mockResolvedValue({ limited: false, resetAt: "2026-03-16T00:00:00.000Z" });
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
      expect(body.error).toContain("No PDF file provided");
    });

    it("rejects non-PDF MIME type", async () => {
      const file = new File(["hello"], "test.txt", { type: "text/plain" });
      const req = makeRequest(file);

      const res = await POST(req as never);
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toContain("Invalid file type");
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
});
