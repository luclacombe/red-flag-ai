import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ────────────────────────────────────────────────

const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();

vi.mock("@/components/analysis-view", () => ({
  AnalysisView: () => null,
}));

vi.mock("@redflag/db", () => ({
  getDb: () => ({
    select: mockSelect,
  }),
  analyses: {
    id: "analyses.id",
    status: "analyses.status",
    overallRiskScore: "analyses.overall_risk_score",
    recommendation: "analyses.recommendation",
    documentId: "analyses.document_id",
    isPublic: "analyses.is_public",
    shareExpiresAt: "analyses.share_expires_at",
  },
  documents: {
    id: "documents.id",
    userId: "documents.user_id",
    contractType: "documents.contract_type",
    filename: "documents.filename",
  },
  clauses: {
    analysisId: "clauses.analysis_id",
    riskLevel: "clauses.risk_level",
  },
  eq: vi.fn(),
}));

// ── Import after mocks ──────────────────────────────────

const { generateMetadata } = await import("../page");

describe("generateMetadata", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = "https://test.example.com";
  });

  it("returns default metadata when analysis is not found", async () => {
    mockSelect.mockReturnValue({ from: mockFrom });
    mockFrom.mockReturnValue({ where: mockWhere });
    mockWhere.mockResolvedValue([]);

    const result = await generateMetadata({
      params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000001" }),
    });

    expect(result.title).toBe("Contract Analysis — RedFlag AI");
    expect(result.description).toBe("AI-powered clause-by-clause contract risk analysis.");
  });

  it("returns default metadata when analysis is not complete", async () => {
    mockSelect.mockReturnValue({ from: mockFrom });
    mockFrom.mockReturnValue({ where: mockWhere });
    mockWhere.mockResolvedValue([
      {
        status: "processing",
        overallRiskScore: null,
        recommendation: null,
        documentId: "doc-1",
      },
    ]);

    const result = await generateMetadata({
      params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000001" }),
    });

    expect(result.title).toBe("Contract Analysis — RedFlag AI");
  });

  it("returns dynamic metadata for a complete analysis", async () => {
    // First call: analyses (with share fields)
    const analysisCall = [
      {
        status: "complete",
        overallRiskScore: 72,
        recommendation: "do_not_sign",
        documentId: "doc-1",
        isPublic: false,
        shareExpiresAt: null,
      },
    ];

    // Second call: owner check (anonymous upload — userId null)
    const ownerCall = [{ userId: null }];

    // Third call: documents
    const docCall = [{ contractType: "residential_lease", filename: "lease.pdf" }];

    // Fourth call: clauses
    const clauseCall = [
      { riskLevel: "red" },
      { riskLevel: "red" },
      { riskLevel: "yellow" },
      { riskLevel: "green" },
      { riskLevel: "green" },
    ];

    let callCount = 0;
    mockSelect.mockReturnValue({ from: mockFrom });
    mockFrom.mockReturnValue({ where: mockWhere });
    mockWhere.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve(analysisCall);
      if (callCount === 2) return Promise.resolve(ownerCall);
      if (callCount === 3) return Promise.resolve(docCall);
      return Promise.resolve(clauseCall);
    });

    const result = await generateMetadata({
      params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000001" }),
    });

    expect(result.title).toBe("Residential Lease Analysis — RedFlag AI");
    expect(result.description).toContain("Do Not Sign");
    expect(result.description).toContain("72/100");
    expect(result.description).toContain("2 high risk");
    expect(result.description).toContain("1 caution");
    expect(result.description).toContain("2 safe");

    const og = result.openGraph;
    expect(og).toBeDefined();
    expect(og?.url).toBe("https://test.example.com/analysis/00000000-0000-0000-0000-000000000001");
  });

  it("returns default metadata when DB throws", async () => {
    mockSelect.mockImplementation(() => {
      throw new Error("DB connection failed");
    });

    const result = await generateMetadata({
      params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000001" }),
    });

    expect(result.title).toBe("Contract Analysis — RedFlag AI");
  });
});
