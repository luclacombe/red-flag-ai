import { analyses, clauses, documents, eq, getDb } from "@redflag/db";
import { ImageResponse } from "next/og";

export const runtime = "edge";

const recommendationLabels: Record<string, string> = {
  sign: "Safe to Sign",
  caution: "Proceed with Caution",
  do_not_sign: "Do Not Sign",
};

const defaultRecColors = { bg: "#fef3c7", text: "#92400e" };

const recommendationColors: Record<string, { bg: string; text: string }> = {
  sign: { bg: "#dcfce7", text: "#166534" },
  caution: defaultRecColors,
  do_not_sign: { bg: "#fee2e2", text: "#991b1b" },
};

function getScoreColor(score: number): string {
  if (score <= 33) return "#16a34a";
  if (score <= 66) return "#d97706";
  return "#dc2626";
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const db = getDb();

    const analysisRows = await db
      .select({
        overallRiskScore: analyses.overallRiskScore,
        recommendation: analyses.recommendation,
        status: analyses.status,
        documentId: analyses.documentId,
        isPublic: analyses.isPublic,
        shareExpiresAt: analyses.shareExpiresAt,
      })
      .from(analyses)
      .where(eq(analyses.id, id));

    const analysis = analysisRows[0];

    // Check if this analysis should show a detailed OG image
    let showDetailed = analysis?.status === "complete";
    if (showDetailed && analysis) {
      const docRows = await db
        .select({ userId: documents.userId })
        .from(documents)
        .where(eq(documents.id, analysis.documentId));
      const doc = docRows[0];
      const isAnonymous = doc?.userId == null;
      const isShared =
        analysis.isPublic && (!analysis.shareExpiresAt || analysis.shareExpiresAt > new Date());
      if (!isAnonymous && !isShared) {
        showDetailed = false;
      }
    }

    if (!showDetailed || !analysis) {
      return new ImageResponse(
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "#0f172a",
            color: "#f8fafc",
            fontFamily: "sans-serif",
          }}
        >
          <div style={{ fontSize: 48, fontWeight: 700 }}>RedFlag AI</div>
          <div style={{ fontSize: 24, color: "#94a3b8", marginTop: 12 }}>
            Contract Risk Analysis
          </div>
        </div>,
        { width: 1200, height: 630 },
      );
    }

    const docRows = await db
      .select({ contractType: documents.contractType })
      .from(documents)
      .where(eq(documents.id, analysis.documentId));

    const clauseRows = await db
      .select({ riskLevel: clauses.riskLevel })
      .from(clauses)
      .where(eq(clauses.analysisId, id));

    const doc = docRows[0];
    const contractType = doc?.contractType
      ? doc.contractType
          .split("_")
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(" ")
      : "Contract";

    const score = analysis.overallRiskScore ?? 0;
    const rec = analysis.recommendation ?? "caution";
    const recLabel = recommendationLabels[rec] ?? "Proceed with Caution";
    const recColors = recommendationColors[rec] ?? defaultRecColors;
    const scoreColor = getScoreColor(score);

    const red = clauseRows.filter((c) => c.riskLevel === "red").length;
    const yellow = clauseRows.filter((c) => c.riskLevel === "yellow").length;
    const green = clauseRows.filter((c) => c.riskLevel === "green").length;

    return new ImageResponse(
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          backgroundColor: "#0f172a",
          color: "#f8fafc",
          fontFamily: "sans-serif",
          padding: 60,
        }}
      >
        {/* Top: Brand */}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ fontSize: 32, fontWeight: 700, color: "#f59e0b" }}>RedFlag AI</div>
          <div style={{ fontSize: 20, color: "#64748b" }}>Contract Analysis</div>
        </div>

        {/* Middle: Score + Info */}
        <div
          style={{
            display: "flex",
            flex: 1,
            alignItems: "center",
            justifyContent: "space-between",
            gap: 60,
          }}
        >
          {/* Score circle */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 16,
            }}
          >
            <div
              style={{
                width: 180,
                height: 180,
                borderRadius: 90,
                border: `8px solid ${scoreColor}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexDirection: "column",
              }}
            >
              <div style={{ fontSize: 64, fontWeight: 700, color: scoreColor }}>{score}</div>
              <div style={{ fontSize: 16, color: "#94a3b8" }}>/100</div>
            </div>
            <div style={{ fontSize: 18, color: "#94a3b8" }}>Risk Score</div>
          </div>

          {/* Right: Details */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 20,
              flex: 1,
            }}
          >
            <div style={{ fontSize: 36, fontWeight: 700 }}>{contractType}</div>

            {/* Recommendation badge */}
            <div
              style={{
                display: "flex",
                fontSize: 22,
                fontWeight: 600,
                backgroundColor: recColors.bg,
                color: recColors.text,
                padding: "10px 24px",
                borderRadius: 24,
                alignSelf: "flex-start",
              }}
            >
              {recLabel}
            </div>

            {/* Clause breakdown */}
            <div style={{ display: "flex", gap: 24, fontSize: 20 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: 7,
                    backgroundColor: "#dc2626",
                  }}
                />
                <span style={{ color: "#cbd5e1" }}>{red} high risk</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: 7,
                    backgroundColor: "#d97706",
                  }}
                />
                <span style={{ color: "#cbd5e1" }}>{yellow} caution</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: 7,
                    backgroundColor: "#16a34a",
                  }}
                />
                <span style={{ color: "#cbd5e1" }}>{green} safe</span>
              </div>
            </div>
          </div>
        </div>
      </div>,
      { width: 1200, height: 630 },
    );
  } catch {
    return new ImageResponse(
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#0f172a",
          color: "#f8fafc",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ fontSize: 48, fontWeight: 700 }}>RedFlag AI</div>
        <div style={{ fontSize: 24, color: "#94a3b8", marginTop: 12 }}>Contract Risk Analysis</div>
      </div>,
      { width: 1200, height: 630 },
    );
  }
}
