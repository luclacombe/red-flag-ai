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
  logoUrl: string;
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
  brandTagline: {
    fontSize: 9,
    color: c.white,
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
    alignItems: "center",
    marginBottom: 14,
    gap: 6,
  },
  scoreContainer: {
    alignItems: "center",
  },
  scoreLabel: {
    fontSize: 10,
    color: c.white,
    fontWeight: 600,
    marginTop: 4,
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
    color: c.textSecondary,
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

/** Brand logo loaded from public URL — works locally and on Vercel */
function BrandLogo({ logoUrl }: { logoUrl: string }) {
  return <Image src={logoUrl} style={{ width: 22, height: 22, marginRight: 8 }} />;
}

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

/** Risk score dial — full circle, fill from top, matches analysis page style */
function RiskScoreDial({ score, recommendation }: { score: number; recommendation: string }) {
  const color = getRecColor(recommendation);
  const size = 64;
  const strokeWidth = 5;
  const radius = (size - strokeWidth) / 2;
  const cx = size / 2;
  const cy = size / 2;

  // Full 360° circle. Fill starts from top (270° in standard math coords).
  // Use 359.99 to avoid SVG arc rendering glitch at exactly 360°.
  const arcStart = 270;
  const trackEnd = arcStart + 359.99;
  const filledEnd = arcStart + (score / 100) * 359.99;

  const trackPath = describeArc(cx, cy, radius, arcStart, trackEnd);
  const filledPath = score > 0 ? describeArc(cx, cy, radius, arcStart, filledEnd) : "";

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Background track — full circle */}
        <Path d={trackPath} fill="none" stroke={c.borderMedium} strokeWidth={strokeWidth} />
        {/* Filled arc — separate path with rounded caps */}
        {filledPath && (
          <Path
            d={filledPath}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
          />
        )}
        {/* Score number — white, centered */}
        <Text
          x={cx}
          y={cy}
          textAnchor="middle"
          dominantBaseline="central"
          style={{
            fontSize: 18,
            fontFamily: "SpaceGrotesk",
            fontWeight: 700,
            fill: c.white,
          }}
        >
          {String(score)}
        </Text>
      </Svg>
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
            <BrandLogo logoUrl={data.logoUrl} />
            <Text style={s.brandName}>RedFlag AI</Text>
          </View>
          <Text style={s.brandTagline}>Contract Risk Analysis Report</Text>
        </View>

        {/* Summary card */}
        <View style={s.summaryCard}>
          <View style={s.summaryTop}>
            <Text style={s.scoreLabel}>Overall Risk Score</Text>
            <View style={s.scoreContainer}>
              <RiskScoreDial score={data.overallRiskScore} recommendation={data.recommendation} />
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
