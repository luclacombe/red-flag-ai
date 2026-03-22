import { SUPPORTED_LANGUAGES, type Summary } from "@redflag/shared";
import { cn } from "@/lib/utils";
import { BreakdownBar } from "./breakdown-bar";
import { RecommendationBadge } from "./recommendation-badge";
import { RiskScore } from "./risk-score";

interface SummaryPanelProps {
  summary: Summary;
  responseLanguage?: string;
  animate?: boolean;
  className?: string;
}

function getLanguageName(code: string): string {
  return SUPPORTED_LANGUAGES.find((l) => l.code === code)?.name ?? code;
}

export function SummaryPanel({
  summary,
  responseLanguage,
  animate = false,
  className,
}: SummaryPanelProps) {
  const isAllGreen = summary.clauseBreakdown.red === 0 && summary.clauseBreakdown.yellow === 0;

  return (
    <div
      className={cn(
        "rounded-lg border border-white/10 bg-white/5 p-4 md:p-6",
        animate && "animate-[fade-slide-in_300ms_ease-out_both]",
        className,
      )}
    >
      {/* Header: Risk Score + Recommendation
           Mobile (col): badge → dial → label
           Desktop (row): dial | label + badge */}
      <div className="flex flex-col items-center gap-3 sm:flex-row sm:gap-6">
        <h2 className="order-1 font-heading text-lg font-semibold text-white sm:hidden">
          Overall Risk Score
        </h2>
        <RiskScore
          value={summary.overallRiskScore}
          recommendation={summary.recommendation}
          className="order-2 sm:order-none"
        />
        <div className="order-3 sm:hidden">
          <RecommendationBadge recommendation={summary.recommendation} />
        </div>
        <div className="order-3 hidden flex-col items-start gap-2 sm:flex">
          <h2 className="font-heading text-lg font-semibold text-white">Overall Risk Score</h2>
          <RecommendationBadge recommendation={summary.recommendation} />
        </div>
      </div>

      {/* Breakdown bar */}
      <div className="mt-6">
        <BreakdownBar
          red={summary.clauseBreakdown.red}
          yellow={summary.clauseBreakdown.yellow}
          green={summary.clauseBreakdown.green}
        />
      </div>

      {/* Top concerns */}
      {summary.topConcerns.length > 0 && (
        <div className="mt-6">
          <h3 className="font-heading text-sm font-semibold text-white">
            {isAllGreen ? "Key Findings" : "Top Concerns"}
          </h3>
          <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-slate-300">
            {summary.topConcerns.map((concern) => (
              <li key={concern}>{concern}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Contract type + language */}
      {(summary.contractType || summary.language || responseLanguage) && (
        <div className="mt-6 flex flex-wrap gap-4 border-t border-white/10 pt-4 text-xs text-slate-400">
          {summary.contractType && (
            <span>
              Contract type:{" "}
              <span className="font-medium text-slate-200">{summary.contractType}</span>
            </span>
          )}
          {summary.language && (
            <span>
              Document language:{" "}
              <span className="font-medium text-slate-200">
                {getLanguageName(summary.language)}
              </span>
            </span>
          )}
          {responseLanguage && responseLanguage !== summary.language && (
            <span>
              Explained in:{" "}
              <span className="font-medium text-slate-200">
                {getLanguageName(responseLanguage)}
              </span>
            </span>
          )}
        </div>
      )}

      {/* All green message */}
      {isAllGreen && (
        <p className="mt-4 text-center text-sm font-medium text-green-400">
          No significant risks found in this contract.
        </p>
      )}
    </div>
  );
}
