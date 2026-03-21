import {
  Document,
  Font,
  Image,
  Page,
  Path,
  renderToBuffer,
  StyleSheet,
  Svg,
  Text,
  View,
} from "@react-pdf/renderer";

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

// ── Fonts ────────────────────────────────────────────────

Font.register({
  family: "SpaceGrotesk",
  fonts: [
    {
      src: "https://fonts.gstatic.com/s/spacegrotesk/v22/V8mQoQDjQSkFtoMM3T6r8E7mF71Q-gOoraIAEj42Vksj.ttf",
      fontWeight: 600,
    },
    {
      src: "https://fonts.gstatic.com/s/spacegrotesk/v22/V8mQoQDjQSkFtoMM3T6r8E7mF71Q-gOoraIAEj4PVksj.ttf",
      fontWeight: 700,
    },
  ],
});

Font.register({
  family: "DMSans",
  fonts: [
    {
      src: "https://fonts.gstatic.com/s/dmsans/v17/rP2tp2ywxg089UriI5-g4vlH9VoD8CmcqZG40F9JadbnoEwAopxhTg.ttf",
      fontWeight: 400,
    },
    {
      src: "https://fonts.gstatic.com/s/dmsans/v17/rP2tp2ywxg089UriI5-g4vlH9VoD8CmcqZG40F9JadbnoEwAkJxhTg.ttf",
      fontWeight: 500,
    },
    {
      src: "https://fonts.gstatic.com/s/dmsans/v17/rP2tp2ywxg089UriI5-g4vlH9VoD8CmcqZG40F9JadbnoEwAfJthTg.ttf",
      fontWeight: 600,
    },
  ],
});

// Disable hyphenation for cleaner text flow
Font.registerHyphenationCallback((word) => [word]);

// ── Colors ───────────────────────────────────────────────

const c = {
  // Page & surfaces
  pageBg: "#0B1120",
  surface: "#131B2E",
  elevated: "#161F33",

  // Text
  textPrimary: "#e2e8f0",
  textSecondary: "#94a3b8",
  textMuted: "#64748b",

  // Risk
  red: "#dc2626",
  yellow: "#d97706",
  green: "#16a34a",

  // Pre-computed risk tints on #0B1120 (≈15% blend)
  redTint: "#200F14",
  yellowTint: "#1C1710",
  greenTint: "#0D1A15",

  // Accents
  amber: "#f59e0b",

  // Borders
  borderSubtle: "#1E2740",
  borderMedium: "#283350",

  // Safer alternative
  greenAltBg: "#0D1F16",
  greenAltBorder: "#14332A",
  greenAltText: "#86efac",

  // Badge backgrounds (semi-transparent equivalents on surface)
  redBadgeBg: "#2A1318",
  yellowBadgeBg: "#2A2010",
  greenBadgeBg: "#0F2318",

  white: "#ffffff",
};

const riskColors: Record<string, string> = {
  red: c.red,
  yellow: c.yellow,
  green: c.green,
};

const riskTints: Record<string, string> = {
  red: c.redTint,
  yellow: c.yellowTint,
  green: c.greenTint,
};

const badgeBgs: Record<string, string> = {
  red: c.redBadgeBg,
  yellow: c.yellowBadgeBg,
  green: c.greenBadgeBg,
};

const badgeLabels: Record<string, string> = {
  red: "HIGH RISK",
  yellow: "CAUTION",
  green: "LOW RISK",
};

const recommendationLabels: Record<string, string> = {
  sign: "Safe to Sign",
  caution: "Proceed with Caution",
  do_not_sign: "Do Not Sign",
};

const defaultRecColors = { bg: c.yellowBadgeBg, text: c.yellow };

const recommendationColors: Record<string, { bg: string; text: string }> = {
  sign: { bg: c.greenBadgeBg, text: c.green },
  caution: defaultRecColors,
  do_not_sign: { bg: c.redBadgeBg, text: c.red },
};

// ── Styles ───────────────────────────────────────────────

const s = StyleSheet.create({
  page: {
    padding: 40,
    paddingBottom: 60,
    fontFamily: "DMSans",
    fontSize: 10,
    color: c.textPrimary,
    backgroundColor: c.pageBg,
  },

  // ── Header ──
  header: {
    marginBottom: 24,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: c.borderSubtle,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  brandName: {
    fontSize: 18,
    fontFamily: "SpaceGrotesk",
    fontWeight: 700,
    color: c.white,
  },
  brandLogo: {
    width: 22,
    height: 22,
    marginRight: 8,
  },
  brandTagline: {
    fontSize: 9,
    color: c.textMuted,
  },

  // ── Summary card ──
  summaryCard: {
    marginBottom: 20,
    padding: 16,
    backgroundColor: c.surface,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: c.borderSubtle,
  },
  summaryTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
  },
  scoreContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  scoreLabel: {
    fontSize: 8,
    color: c.textMuted,
    textTransform: "uppercase" as const,
    letterSpacing: 0.5,
  },
  recBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    fontSize: 9,
    fontWeight: 600,
  },
  summaryGrid: {
    gap: 5,
    marginBottom: 12,
  },
  summaryRow: {
    flexDirection: "row",
  },
  summaryLabel: {
    width: 85,
    fontSize: 8,
    fontWeight: 600,
    color: c.textMuted,
    textTransform: "uppercase" as const,
    letterSpacing: 0.3,
  },
  summaryValue: {
    flex: 1,
    fontSize: 9,
    color: c.textPrimary,
  },

  // ── Breakdown bar ──
  breakdownContainer: {
    marginTop: 4,
  },
  breakdownBar: {
    flexDirection: "row",
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
    marginBottom: 6,
  },
  breakdownLegend: {
    flexDirection: "row",
    gap: 14,
  },
  breakdownItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  breakdownDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  breakdownText: {
    fontSize: 8,
    color: c.textSecondary,
  },

  // ── Top concerns ──
  concernsSection: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 12,
    fontFamily: "SpaceGrotesk",
    fontWeight: 600,
    color: c.textPrimary,
    marginBottom: 10,
  },
  concernItem: {
    flexDirection: "row",
    marginBottom: 5,
    paddingLeft: 4,
  },
  concernNumber: {
    width: 16,
    fontSize: 8,
    fontWeight: 600,
    color: c.amber,
  },
  concernText: {
    flex: 1,
    fontSize: 9,
    lineHeight: 1.5,
    color: c.textSecondary,
  },

  // ── Clause block ──
  clauseBlock: {
    marginBottom: 10,
    borderRadius: 6,
    borderLeftWidth: 4,
    overflow: "hidden",
  },
  clauseTextSection: {
    padding: 10,
    paddingBottom: 6,
  },
  clauseText: {
    fontSize: 9,
    lineHeight: 1.6,
    color: c.textPrimary,
  },
  // Analysis inset (elevated)
  analysisInset: {
    marginHorizontal: 8,
    marginBottom: 8,
    padding: 10,
    borderRadius: 5,
    backgroundColor: c.elevated,
    borderWidth: 1,
    borderColor: c.borderSubtle,
  },
  analysisHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  categoryLabel: {
    fontSize: 7,
    fontWeight: 600,
    textTransform: "uppercase" as const,
    letterSpacing: 0.5,
    color: c.textMuted,
  },
  riskBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: 8,
    fontSize: 7,
    fontWeight: 600,
    letterSpacing: 0.3,
  },
  explanationText: {
    fontSize: 9,
    lineHeight: 1.6,
    color: c.textSecondary,
  },
  saferAltBox: {
    marginTop: 8,
    padding: 8,
    borderRadius: 4,
    backgroundColor: c.greenAltBg,
    borderWidth: 1,
    borderColor: c.greenAltBorder,
  },
  saferAltLabel: {
    fontSize: 7,
    fontWeight: 600,
    color: c.green,
    textTransform: "uppercase" as const,
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  saferAltText: {
    fontSize: 8.5,
    lineHeight: 1.5,
    color: c.greenAltText,
  },

  // ── Footer ──
  footer: {
    position: "absolute",
    bottom: 24,
    left: 40,
    right: 40,
    borderTopWidth: 1,
    borderTopColor: c.borderSubtle,
    paddingTop: 8,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  footerText: {
    fontSize: 7,
    color: c.textMuted,
  },
  footerBrand: {
    fontSize: 7,
    color: c.white,
    fontWeight: 600,
  },
});

// ── Components ───────────────────────────────────────────

// Logo embedded as base64 PNG — no filesystem dependency, works on Vercel serverless
const LOGO_DATA_URI =
  "data:image/png;base64,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";

const recColorMap: Record<string, string> = {
  sign: c.green,
  caution: c.yellow,
  do_not_sign: c.red,
};

function getRecColor(recommendation: string): string {
  return recColorMap[recommendation] ?? c.yellow;
}

/** Generate SVG arc path from startAngle to endAngle (degrees) */
function describeArc(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const startRad = (startDeg * Math.PI) / 180;
  const endRad = (endDeg * Math.PI) / 180;
  const x1 = cx + r * Math.cos(startRad);
  const y1 = cy + r * Math.sin(startRad);
  const x2 = cx + r * Math.cos(endRad);
  const y2 = cy + r * Math.sin(endRad);
  const largeArc = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`;
}

/** Risk score dial with proportional arc fill using SVG Path arcs */
function RiskScoreDial({ score, recommendation }: { score: number; recommendation: string }) {
  const color = getRecColor(recommendation);
  const size = 64;
  const strokeWidth = 5;
  const radius = (size - strokeWidth) / 2;
  const cx = size / 2;
  const cy = size / 2;

  // 270-degree arc starting from bottom-left (135 deg) to bottom-right (45 deg / 405 deg)
  const arcStart = 135;
  const arcTotal = 270;
  const arcEnd = arcStart + arcTotal;
  const filledEnd = arcStart + (score / 100) * arcTotal;

  const trackPath = describeArc(cx, cy, radius, arcStart, arcEnd);
  const filledPath = score > 0 ? describeArc(cx, cy, radius, arcStart, filledEnd) : "";

  return (
    <View style={{ width: size, height: size, alignItems: "center" }}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Background track */}
        <Path
          d={trackPath}
          fill="none"
          stroke={c.borderMedium}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />
        {/* Filled arc */}
        {filledPath && (
          <Path
            d={filledPath}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
          />
        )}
      </Svg>
      {/* Score number — negative margin overlaps the SVG, alignItems centers horizontally */}
      <Text
        style={{
          marginTop: -38,
          fontSize: 18,
          fontFamily: "SpaceGrotesk",
          fontWeight: 700,
          color,
        }}
      >
        {score}
      </Text>
    </View>
  );
}

function RiskBadge({ level }: { level: string }) {
  const bg = badgeBgs[level] ?? badgeBgs.green;
  const color = riskColors[level] ?? c.green;
  const label = badgeLabels[level] ?? "LOW RISK";
  return <Text style={[s.riskBadge, { backgroundColor: bg, color }]}>{label}</Text>;
}

function BreakdownBar({ breakdown }: { breakdown: ReportData["breakdown"] }) {
  const total = breakdown.red + breakdown.yellow + breakdown.green;
  if (total === 0) return null;

  return (
    <View style={s.breakdownContainer}>
      <View style={s.breakdownBar}>
        {breakdown.red > 0 && (
          <View
            style={{
              flex: breakdown.red,
              backgroundColor: c.red,
            }}
          />
        )}
        {breakdown.yellow > 0 && (
          <View
            style={{
              flex: breakdown.yellow,
              backgroundColor: c.yellow,
            }}
          />
        )}
        {breakdown.green > 0 && (
          <View
            style={{
              flex: breakdown.green,
              backgroundColor: c.green,
            }}
          />
        )}
      </View>
      <View style={s.breakdownLegend}>
        <View style={s.breakdownItem}>
          <View style={[s.breakdownDot, { backgroundColor: c.red }]} />
          <Text style={s.breakdownText}>{breakdown.red} high risk</Text>
        </View>
        <View style={s.breakdownItem}>
          <View style={[s.breakdownDot, { backgroundColor: c.yellow }]} />
          <Text style={s.breakdownText}>{breakdown.yellow} caution</Text>
        </View>
        <View style={s.breakdownItem}>
          <View style={[s.breakdownDot, { backgroundColor: c.green }]} />
          <Text style={s.breakdownText}>{breakdown.green} safe</Text>
        </View>
      </View>
    </View>
  );
}

function ClauseBlock({ clause }: { clause: ClauseData }) {
  const borderColor = riskColors[clause.riskLevel] ?? c.green;
  const tintBg = riskTints[clause.riskLevel] ?? c.greenTint;
  const showSaferAlt = !!clause.saferAlternative && clause.riskLevel !== "green";

  return (
    <View
      style={[s.clauseBlock, { borderLeftColor: borderColor, backgroundColor: tintBg }]}
      wrap={false}
    >
      {/* Clause text from document */}
      <View style={s.clauseTextSection}>
        <Text style={s.clauseText}>{clause.clauseText}</Text>
      </View>

      {/* Elevated analysis inset */}
      <View style={s.analysisInset}>
        <View style={s.analysisHeader}>
          <Text style={s.categoryLabel}>{clause.category.replace(/_/g, " ")}</Text>
          <RiskBadge level={clause.riskLevel} />
        </View>
        <Text style={s.explanationText}>{clause.explanation}</Text>
        {showSaferAlt && (
          <View style={s.saferAltBox}>
            <Text style={s.saferAltLabel}>Safer Alternative</Text>
            <Text style={s.saferAltText}>{clause.saferAlternative}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

// ── Main Document ────────────────────────────────────────

function ReportDocument({ data }: { data: ReportData }) {
  const recLabel = recommendationLabels[data.recommendation] ?? "Proceed with Caution";
  const recColors = recommendationColors[data.recommendation] ?? defaultRecColors;

  return (
    <Document
      title={`Contract Analysis Report | ${data.filename}`}
      author="RedFlag AI"
      subject="Contract Risk Analysis"
    >
      <Page size="A4" style={s.page}>
        {/* Header */}
        <View style={s.header}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Image src={LOGO_DATA_URI} style={s.brandLogo} />
            <Text style={s.brandName}>RedFlag AI</Text>
          </View>
          <Text style={s.brandTagline}>Contract Risk Analysis Report</Text>
        </View>

        {/* Summary card */}
        <View style={s.summaryCard}>
          <View style={s.summaryTop}>
            <View style={s.scoreContainer}>
              <RiskScoreDial score={data.overallRiskScore} recommendation={data.recommendation} />
              <Text style={s.scoreLabel}>Risk Score</Text>
            </View>
            <Text style={[s.recBadge, { backgroundColor: recColors.bg, color: recColors.text }]}>
              {recLabel}
            </Text>
          </View>

          <View style={s.summaryGrid}>
            <View style={s.summaryRow}>
              <Text style={s.summaryLabel}>Document</Text>
              <Text style={s.summaryValue}>{data.filename}</Text>
            </View>
            <View style={s.summaryRow}>
              <Text style={s.summaryLabel}>Type</Text>
              <Text style={s.summaryValue}>
                {data.contractType
                  .split("_")
                  .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                  .join(" ")}
              </Text>
            </View>
            <View style={s.summaryRow}>
              <Text style={s.summaryLabel}>Generated</Text>
              <Text style={s.summaryValue}>{data.generatedAt}</Text>
            </View>
          </View>

          <BreakdownBar breakdown={data.breakdown} />
        </View>

        {/* Top concerns */}
        {data.topConcerns.length > 0 && (
          <View style={s.concernsSection}>
            <Text style={s.sectionTitle}>Top Concerns</Text>
            {data.topConcerns.map((concern, idx) => (
              <View key={concern} style={s.concernItem}>
                <Text style={s.concernNumber}>{idx + 1}.</Text>
                <Text style={s.concernText}>{concern}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Clause analysis */}
        <Text style={s.sectionTitle}>
          Clause-by-Clause Analysis ({data.clauses.length} clauses)
        </Text>
        {data.clauses.map((clause) => (
          <ClauseBlock key={clause.position} clause={clause} />
        ))}

        {/* Footer */}
        <View style={s.footer} fixed>
          <Text style={s.footerText}>
            Generated by <Text style={s.footerBrand}>RedFlag AI</Text> · This is not legal advice.
            Consult a qualified attorney.
          </Text>
          <Text
            style={s.footerText}
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
