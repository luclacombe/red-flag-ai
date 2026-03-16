import { analyses, clauses, documents, eq, getDb } from "@redflag/db";
import type { Metadata } from "next";
import { AnalysisView } from "@/components/analysis-view";

const recommendationLabels: Record<string, string> = {
  sign: "Safe to Sign",
  caution: "Proceed with Caution",
  do_not_sign: "Do Not Sign",
};

function formatContractType(type: string): string {
  return type
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;

  try {
    const db = getDb();

    const analysisRows = await db
      .select({
        status: analyses.status,
        overallRiskScore: analyses.overallRiskScore,
        recommendation: analyses.recommendation,
        documentId: analyses.documentId,
      })
      .from(analyses)
      .where(eq(analyses.id, id));

    const analysis = analysisRows[0];

    if (!analysis || analysis.status !== "complete") {
      return {
        title: "Contract Analysis — RedFlag AI",
        description: "AI-powered clause-by-clause contract risk analysis.",
      };
    }

    const docRows = await db
      .select({ contractType: documents.contractType, filename: documents.filename })
      .from(documents)
      .where(eq(documents.id, analysis.documentId));

    const doc = docRows[0];

    const clauseRows = await db
      .select({ riskLevel: clauses.riskLevel })
      .from(clauses)
      .where(eq(clauses.analysisId, id));

    const red = clauseRows.filter((c) => c.riskLevel === "red").length;
    const yellow = clauseRows.filter((c) => c.riskLevel === "yellow").length;
    const green = clauseRows.filter((c) => c.riskLevel === "green").length;

    const contractLabel = doc?.contractType ? formatContractType(doc.contractType) : "Contract";
    const recLabel =
      recommendationLabels[analysis.recommendation ?? "caution"] ?? "Proceed with Caution";
    const score = analysis.overallRiskScore ?? 0;

    const title = `${contractLabel} Analysis — RedFlag AI`;
    const description = `${recLabel} · Risk score: ${score}/100 · ${red} high risk, ${yellow} caution, ${green} safe clauses`;

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://redflag-ai.vercel.app";
    const pageUrl = `${appUrl}/analysis/${id}`;
    const ogImageUrl = `${appUrl}/api/og/${id}`;

    return {
      title,
      description,
      openGraph: {
        title,
        description,
        url: pageUrl,
        siteName: "RedFlag AI",
        images: [{ url: ogImageUrl, width: 1200, height: 630, alt: title }],
        type: "website",
      },
      twitter: {
        card: "summary_large_image",
        title,
        description,
        images: [ogImageUrl],
      },
    };
  } catch {
    return {
      title: "Contract Analysis — RedFlag AI",
      description: "AI-powered clause-by-clause contract risk analysis.",
    };
  }
}

export default async function AnalysisPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AnalysisView id={id} />;
}
