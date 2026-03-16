import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ────────────────────────────────────────────────

const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockOrderBy = vi.fn();

vi.mock("@redflag/db", () => ({
  getDb: () => ({
    select: mockSelect,
  }),
  analyses: { id: "analyses.id" },
  documents: { id: "documents.id" },
  clauses: { analysisId: "clauses.analysis_id", position: "clauses.position" },
  eq: vi.fn(),
}));

vi.mock("@redflag/shared", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock("@redflag/shared/crypto", () => ({
  getMasterKey: () => Buffer.alloc(32),
  deriveKey: vi.fn().mockResolvedValue(Buffer.alloc(32)),
  decrypt: vi.fn((val: string) => val),
}));

const mockRenderReport = vi.fn();
vi.mock("../report-document", () => ({
  renderReport: (...args: unknown[]) => mockRenderReport(...args),
}));

// ── Import after mocks ──────────────────────────────────

const { GET } = await import("../route");

function makeRequest(id: string) {
  return new Request(`http://localhost:3000/api/report/${id}`);
}

describe("GET /api/report/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when analysis is not found", async () => {
    mockSelect.mockReturnValue({ from: mockFrom });
    mockFrom.mockReturnValue({ where: mockWhere });
    mockWhere.mockResolvedValue([]);

    const response = await GET(makeRequest("missing-id"), {
      params: Promise.resolve({ id: "missing-id" }),
    });

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toBe("Analysis not found");
  });

  it("returns 400 when analysis is not complete", async () => {
    mockSelect.mockReturnValue({ from: mockFrom });
    mockFrom.mockReturnValue({ where: mockWhere });
    mockWhere.mockResolvedValue([{ status: "processing", documentId: "doc-1" }]);

    const response = await GET(makeRequest("in-progress"), {
      params: Promise.resolve({ id: "in-progress" }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Analysis is not yet complete");
  });

  it("returns 404 when document is not found", async () => {
    let callCount = 0;
    mockSelect.mockReturnValue({ from: mockFrom });
    mockFrom.mockReturnValue({ where: mockWhere });
    mockWhere.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve([
          {
            status: "complete",
            documentId: "doc-1",
            overallRiskScore: 50,
            recommendation: "caution",
            topConcerns: [],
          },
        ]);
      }
      return Promise.resolve([]);
    });

    const response = await GET(makeRequest("no-doc"), {
      params: Promise.resolve({ id: "no-doc" }),
    });

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toBe("Document not found");
  });

  it("returns PDF with correct headers for a complete analysis", async () => {
    const analysisRow = {
      status: "complete",
      documentId: "doc-1",
      overallRiskScore: 65,
      recommendation: "caution",
      topConcerns: JSON.stringify(["Late fees are excessive"]),
    };

    const docRow = {
      id: "doc-1",
      contractType: "residential_lease",
      filename: "my-lease.pdf",
    };

    const clauseRows = [
      {
        position: 0,
        clauseText: "Clause 1",
        riskLevel: "red",
        explanation: "Risky",
        saferAlternative: "Better version",
        category: "fees",
      },
      {
        position: 1,
        clauseText: "Clause 2",
        riskLevel: "green",
        explanation: "Fine",
        saferAlternative: null,
        category: "terms",
      },
    ];

    let callCount = 0;
    mockSelect.mockReturnValue({ from: mockFrom });
    mockFrom.mockReturnValue({ where: mockWhere });
    mockWhere.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve([analysisRow]);
      if (callCount === 2) return Promise.resolve([docRow]);
      return { orderBy: mockOrderBy };
    });
    mockOrderBy.mockResolvedValue(clauseRows);

    const fakePdf = new ArrayBuffer(10);
    mockRenderReport.mockResolvedValue(fakePdf);

    const response = await GET(makeRequest("complete-id"), {
      params: Promise.resolve({ id: "complete-id" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Disposition")).toContain("redflag-report-my-lease.pdf");

    // Verify renderReport was called with the right data
    expect(mockRenderReport).toHaveBeenCalledOnce();
    const reportData = mockRenderReport.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(reportData.contractType).toBe("residential_lease");
    expect(reportData.filename).toBe("my-lease.pdf");
    expect(reportData.overallRiskScore).toBe(65);
    expect(reportData.clauses).toHaveLength(2);
    expect(reportData.breakdown).toEqual({ red: 1, yellow: 0, green: 1 });
  });

  it("returns 500 on unexpected error", async () => {
    mockSelect.mockImplementation(() => {
      throw new Error("DB exploded");
    });

    const response = await GET(makeRequest("error-id"), {
      params: Promise.resolve({ id: "error-id" }),
    });

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("Failed to generate report");
  });
});
