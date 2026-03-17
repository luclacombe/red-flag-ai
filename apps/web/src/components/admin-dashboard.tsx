"use client";

import { useState } from "react";
import { trpc } from "@/trpc/react";

type Period = "24h" | "7d" | "30d";

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-4">
      <div className="text-sm text-gray-400">{label}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
    </div>
  );
}

function StepDuration({ steps, stepName }: { steps: StepMetric[]; stepName: string }) {
  const step = steps.find((s) => s.step === stepName);
  if (!step) return <td className="p-2 text-gray-600">—</td>;
  return (
    <td className={`p-2 ${step.success ? "text-gray-300" : "text-red-400"}`}>
      {(step.durationMs / 1000).toFixed(1)}s
    </td>
  );
}

interface StepMetric {
  step: string;
  durationMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  model: string | null;
  success: boolean;
  errorMessage: string | null;
}

export function AdminDashboard() {
  const [period, setPeriod] = useState<Period>("24h");
  const { data, isLoading, error } = trpc.admin.dashboard.useQuery({ period });

  return (
    <div className="min-h-screen bg-[#0B1120] p-6 text-gray-100">
      <h1 className="mb-6 text-2xl font-bold font-[family-name:var(--font-heading)]">
        Pipeline Observability
      </h1>

      {/* Period selector */}
      <div className="mb-6 flex gap-2">
        {(["24h", "7d", "30d"] as const).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPeriod(p)}
            className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
              period === p
                ? "bg-amber-500 text-black"
                : "bg-gray-800 text-gray-300 hover:bg-gray-700"
            }`}
          >
            {p}
          </button>
        ))}
      </div>

      {isLoading && <div className="text-gray-400">Loading metrics...</div>}
      {error && <div className="text-red-400">Error: {error.message}</div>}

      {data && (
        <>
          {/* Stats cards */}
          <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Total Analyses" value={data.stats.totalAnalyses} />
            <StatCard label="Success Rate" value={`${data.stats.successRate}%`} />
            <StatCard
              label="Avg Duration"
              value={`${(data.stats.avgDurationMs / 1000).toFixed(1)}s`}
            />
            <StatCard label="Est. Cost" value={`$${data.stats.estimatedCostUsd.toFixed(4)}`} />
          </div>
          <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <StatCard label="Input Tokens" value={data.stats.totalInputTokens.toLocaleString()} />
            <StatCard label="Output Tokens" value={data.stats.totalOutputTokens.toLocaleString()} />
          </div>

          {/* Recent analyses table */}
          <h2 className="mb-3 text-xl font-semibold">Recent Analyses</h2>
          {data.recentAnalyses.length === 0 ? (
            <p className="mb-8 text-gray-500">No analyses in this period.</p>
          ) : (
            <div className="mb-8 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-700 text-left text-gray-400">
                    <th className="p-2">Time</th>
                    <th className="p-2">Gate</th>
                    <th className="p-2">Parse</th>
                    <th className="p-2">Analysis</th>
                    <th className="p-2">Summary</th>
                    <th className="p-2">Total</th>
                    <th className="p-2">Tokens (in/out)</th>
                    <th className="p-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentAnalyses.map((a) => (
                    <tr
                      key={a.analysisId}
                      className="border-b border-gray-800 hover:bg-gray-900/30"
                    >
                      <td className="p-2 text-gray-400 whitespace-nowrap">
                        {new Date(a.createdAt).toLocaleString()}
                      </td>
                      <StepDuration steps={a.steps} stepName="gate" />
                      <StepDuration steps={a.steps} stepName="parse" />
                      <StepDuration steps={a.steps} stepName="combined_analysis" />
                      <StepDuration steps={a.steps} stepName="summary_fallback" />
                      <td className="p-2 font-medium">{(a.totalDurationMs / 1000).toFixed(1)}s</td>
                      <td className="p-2 text-gray-400 whitespace-nowrap">
                        {a.totalInputTokens.toLocaleString()} /{" "}
                        {a.totalOutputTokens.toLocaleString()}
                      </td>
                      <td className="p-2">
                        {a.allSuccess ? (
                          <span className="text-green-400">OK</span>
                        ) : (
                          <span className="text-red-400">Error</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Error log */}
          <h2 className="mb-3 text-xl font-semibold">Recent Errors</h2>
          {data.errors.length === 0 ? (
            <p className="text-gray-500">No errors in this period.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-700 text-left text-gray-400">
                    <th className="p-2">Time</th>
                    <th className="p-2">Step</th>
                    <th className="p-2">Duration</th>
                    <th className="p-2">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {data.errors.map((e) => (
                    <tr
                      key={`${e.analysisId ?? "no-id"}-${e.step}-${new Date(e.createdAt).getTime()}`}
                      className="border-b border-gray-800"
                    >
                      <td className="p-2 text-gray-400 whitespace-nowrap">
                        {new Date(e.createdAt).toLocaleString()}
                      </td>
                      <td className="p-2">
                        <span className="rounded bg-red-900/30 px-1.5 py-0.5 text-xs text-red-300">
                          {e.step}
                        </span>
                      </td>
                      <td className="p-2">{(e.durationMs / 1000).toFixed(1)}s</td>
                      <td className="max-w-md truncate p-2 text-red-400">
                        {e.errorMessage ?? "Unknown error"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
