import { Document, Page, renderToBuffer, StyleSheet, Text, View } from "@react-pdf/renderer";

// ── Types (exported for route handler) ───────────────────

export interface ClauseData {
  position: number;
  clauseText: string;
  riskLevel: string;
  explanation: string;
  saferAlternative: string | null;
  category: string;
}

export interface ReportData {
  contractType: string;
  filename: string;
  overallRiskScore: number;
  recommendation: string;
  topConcerns: string[];
  clauses: ClauseData[];
  generatedAt: string;
  breakdown: { red: number; yellow: number; green: number };
}

// ── Styles ───────────────────────────────────────────────

const colors = {
  red: "#dc2626",
  yellow: "#d97706",
  green: "#16a34a",
  slate50: "#f8fafc",
  slate100: "#f1f5f9",
  slate200: "#e2e8f0",
  slate500: "#64748b",
  slate700: "#334155",
  slate900: "#0f172a",
  white: "#ffffff",
};

const defaultBadgeColors = { bg: "#dcfce7", text: colors.green };

const riskBadgeColors: Record<string, { bg: string; text: string }> = {
  red: { bg: "#fee2e2", text: colors.red },
  yellow: { bg: "#fef3c7", text: colors.yellow },
  green: defaultBadgeColors,
};

const recommendationLabels: Record<string, string> = {
  sign: "Safe to Sign",
  caution: "Proceed with Caution",
  do_not_sign: "Do Not Sign",
};

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: colors.slate700,
    backgroundColor: colors.white,
  },
  // Header
  header: {
    marginBottom: 24,
    paddingBottom: 16,
    borderBottomWidth: 2,
    borderBottomColor: colors.slate200,
  },
  brandName: {
    fontSize: 20,
    fontFamily: "Helvetica-Bold",
    color: colors.slate900,
    marginBottom: 4,
  },
  brandTagline: {
    fontSize: 10,
    color: colors.slate500,
  },
  // Summary section
  summarySection: {
    marginBottom: 20,
    padding: 16,
    backgroundColor: colors.slate50,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.slate200,
  },
  summaryTitle: {
    fontSize: 14,
    fontFamily: "Helvetica-Bold",
    color: colors.slate900,
    marginBottom: 12,
  },
  summaryRow: {
    flexDirection: "row",
    marginBottom: 6,
  },
  summaryLabel: {
    width: 120,
    fontFamily: "Helvetica-Bold",
    color: colors.slate500,
    fontSize: 9,
    textTransform: "uppercase" as const,
  },
  summaryValue: {
    flex: 1,
    color: colors.slate900,
  },
  // Breakdown
  breakdownRow: {
    flexDirection: "row",
    gap: 16,
    marginTop: 8,
  },
  breakdownItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  breakdownDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  breakdownText: {
    fontSize: 9,
    color: colors.slate700,
  },
  // Top concerns
  concernsSection: {
    marginBottom: 20,
  },
  concernsTitle: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    color: colors.slate900,
    marginBottom: 8,
  },
  concernItem: {
    flexDirection: "row",
    marginBottom: 4,
    paddingLeft: 8,
  },
  concernBullet: {
    width: 12,
    color: colors.slate500,
  },
  concernText: {
    flex: 1,
    fontSize: 10,
  },
  // Clause
  clauseContainer: {
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.slate200,
    borderRadius: 4,
    borderLeftWidth: 3,
  },
  clauseHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 10,
    backgroundColor: colors.slate50,
    borderBottomWidth: 1,
    borderBottomColor: colors.slate200,
  },
  clauseCategory: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase" as const,
    color: colors.slate500,
    letterSpacing: 0.5,
  },
  riskBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase" as const,
  },
  clauseBody: {
    padding: 10,
  },
  clauseText: {
    fontSize: 9,
    fontFamily: "Courier",
    color: colors.slate700,
    lineHeight: 1.5,
    marginBottom: 8,
  },
  explanationLabel: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: colors.slate500,
    textTransform: "uppercase" as const,
    marginBottom: 4,
  },
  explanationText: {
    fontSize: 10,
    lineHeight: 1.5,
    color: colors.slate700,
  },
  saferAltContainer: {
    marginTop: 8,
    padding: 8,
    backgroundColor: "#f0fdf4",
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "#bbf7d0",
  },
  saferAltLabel: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: colors.green,
    textTransform: "uppercase" as const,
    marginBottom: 4,
  },
  saferAltText: {
    fontSize: 9,
    color: "#166534",
    lineHeight: 1.5,
  },
  // Footer
  footer: {
    position: "absolute",
    bottom: 30,
    left: 40,
    right: 40,
    borderTopWidth: 1,
    borderTopColor: colors.slate200,
    paddingTop: 8,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  footerText: {
    fontSize: 7,
    color: colors.slate500,
  },
  // Section header
  sectionHeader: {
    fontSize: 14,
    fontFamily: "Helvetica-Bold",
    color: colors.slate900,
    marginBottom: 12,
    marginTop: 4,
  },
});

// ── Components ───────────────────────────────────────────

function RiskBadge({ level }: { level: string }) {
  const badgeColors = riskBadgeColors[level] ?? defaultBadgeColors;
  const labels: Record<string, string> = {
    red: "High Risk",
    yellow: "Caution",
    green: "Safe",
  };
  return (
    <Text style={[styles.riskBadge, { backgroundColor: badgeColors.bg, color: badgeColors.text }]}>
      {labels[level] ?? level}
    </Text>
  );
}

function ClauseItem({ clause }: { clause: ClauseData }) {
  const borderColor =
    clause.riskLevel === "red"
      ? colors.red
      : clause.riskLevel === "yellow"
        ? colors.yellow
        : colors.green;
  const showSaferAlt = !!clause.saferAlternative && clause.riskLevel !== "green";

  return (
    <View style={[styles.clauseContainer, { borderLeftColor: borderColor }]} wrap={false}>
      <View style={styles.clauseHeader}>
        <Text style={styles.clauseCategory}>{clause.category}</Text>
        <RiskBadge level={clause.riskLevel} />
      </View>
      <View style={styles.clauseBody}>
        <Text style={styles.clauseText}>{clause.clauseText}</Text>
        <Text style={styles.explanationLabel}>Analysis</Text>
        <Text style={styles.explanationText}>{clause.explanation}</Text>
        {showSaferAlt && (
          <View style={styles.saferAltContainer}>
            <Text style={styles.saferAltLabel}>Safer Alternative</Text>
            <Text style={styles.saferAltText}>{clause.saferAlternative}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

// ── Main Document ────────────────────────────────────────

function ReportDocument({ data }: { data: ReportData }) {
  const recLabel = recommendationLabels[data.recommendation] ?? "Proceed with Caution";

  return (
    <Document
      title={`Contract Analysis Report — ${data.filename}`}
      author="RedFlag AI"
      subject="Contract Risk Analysis"
    >
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.brandName}>RedFlag AI</Text>
          <Text style={styles.brandTagline}>Contract Risk Analysis Report</Text>
        </View>

        {/* Summary */}
        <View style={styles.summarySection}>
          <Text style={styles.summaryTitle}>Summary</Text>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Document</Text>
            <Text style={styles.summaryValue}>{data.filename}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Contract Type</Text>
            <Text style={styles.summaryValue}>
              {data.contractType
                .split("_")
                .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                .join(" ")}
            </Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Risk Score</Text>
            <Text style={styles.summaryValue}>{data.overallRiskScore} / 100</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Recommendation</Text>
            <Text style={styles.summaryValue}>{recLabel}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Generated</Text>
            <Text style={styles.summaryValue}>{data.generatedAt}</Text>
          </View>
          {/* Breakdown */}
          <View style={styles.breakdownRow}>
            <View style={styles.breakdownItem}>
              <View style={[styles.breakdownDot, { backgroundColor: colors.red }]} />
              <Text style={styles.breakdownText}>{data.breakdown.red} high risk</Text>
            </View>
            <View style={styles.breakdownItem}>
              <View style={[styles.breakdownDot, { backgroundColor: colors.yellow }]} />
              <Text style={styles.breakdownText}>{data.breakdown.yellow} caution</Text>
            </View>
            <View style={styles.breakdownItem}>
              <View style={[styles.breakdownDot, { backgroundColor: colors.green }]} />
              <Text style={styles.breakdownText}>{data.breakdown.green} safe</Text>
            </View>
          </View>
        </View>

        {/* Top concerns */}
        {data.topConcerns.length > 0 && (
          <View style={styles.concernsSection}>
            <Text style={styles.concernsTitle}>Top Concerns</Text>
            {data.topConcerns.map((concern) => (
              <View key={concern} style={styles.concernItem}>
                <Text style={styles.concernBullet}>•</Text>
                <Text style={styles.concernText}>{concern}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Clauses */}
        <Text style={styles.sectionHeader}>
          Clause-by-Clause Analysis ({data.clauses.length} clauses)
        </Text>
        {data.clauses.map((clause) => (
          <ClauseItem key={clause.position} clause={clause} />
        ))}

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>
            Generated by RedFlag AI — This is not legal advice. Consult a qualified attorney.
          </Text>
          <Text
            style={styles.footerText}
            render={({ pageNumber, totalPages }) => `Page ${pageNumber} / ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  );
}

/** Renders the report to a PDF buffer. Encapsulates the type coercion needed by @react-pdf/renderer. */
export async function renderReport(data: ReportData): Promise<ArrayBuffer> {
  const buffer = await renderToBuffer(<ReportDocument data={data} />);
  // Copy into a plain ArrayBuffer to satisfy BodyInit type requirements
  const ab = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(ab).set(buffer);
  return ab;
}
