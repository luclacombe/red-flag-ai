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
        "rounded-lg border border-slate-200 bg-white p-4 md:p-6",
        animate && "animate-[fade-slide-in_300ms_ease-out_both]",
        className,
      )}
    >
      {/* Header: Risk Score + Recommendation */}
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:gap-6">
        <RiskScore value={summary.overallRiskScore} />
        <div className="flex flex-col items-center gap-2 sm:items-start">
          <h2 className="font-heading text-lg font-semibold text-slate-900">Overall Risk Score</h2>
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
          <h3 className="font-heading text-sm font-semibold text-slate-900">
            {isAllGreen ? "Key Findings" : "Top Concerns"}
          </h3>
          <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-slate-700">
            {summary.topConcerns.map((concern) => (
              <li key={concern}>{concern}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Contract type + language */}
      {(summary.contractType || summary.language || responseLanguage) && (
        <div className="mt-6 flex flex-wrap gap-4 border-t border-slate-100 pt-4 text-xs text-slate-500">
          {summary.contractType && (
            <span>
              Contract type:{" "}
              <span className="font-medium text-slate-700">{summary.contractType}</span>
            </span>
          )}
          {summary.language && (
            <span>
              Document language:{" "}
              <span className="font-medium text-slate-700">
                {getLanguageName(summary.language)}
              </span>
            </span>
          )}
          {responseLanguage && responseLanguage !== summary.language && (
            <span>
              Explained in:{" "}
              <span className="font-medium text-slate-700">
                {getLanguageName(responseLanguage)}
              </span>
            </span>
          )}
        </div>
      )}

      {/* All green message */}
      {isAllGreen && (
        <p className="mt-4 text-center text-sm font-medium text-green-700">
          No significant risks found in this contract.
        </p>
      )}
    </div>
  );
}
