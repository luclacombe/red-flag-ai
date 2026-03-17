import { desc, getDb, gte, pipelineMetrics } from "@redflag/db";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";

/** Cost per million tokens (USD) — approximate Anthropic pricing */
const COST_PER_MILLION: Record<string, { input: number; output: number }> = {
  haiku: { input: 0.8, output: 4 },
  sonnet: { input: 3, output: 15 },
};

const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail || ctx.user.email !== adminEmail) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required." });
  }
  return next({ ctx });
});

const PeriodInput = z.object({
  period: z.enum(["24h", "7d", "30d"]),
});

function periodToDate(period: "24h" | "7d" | "30d"): Date {
  const days = { "24h": 1, "7d": 7, "30d": 30 }[period];
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function estimateCost(model: string | null, inputTokens: number, outputTokens: number): number {
  const rates = COST_PER_MILLION[model ?? "sonnet"] ?? COST_PER_MILLION.sonnet!;
  return (inputTokens / 1_000_000) * rates.input + (outputTokens / 1_000_000) * rates.output;
}

export interface StepMetric {
  step: string;
  durationMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  model: string | null;
  success: boolean;
  errorMessage: string | null;
}

export const adminRouter = router({
  dashboard: adminProcedure.input(PeriodInput).query(async ({ input }) => {
    const db = getDb();
    const since = periodToDate(input.period);

    const allMetrics = await db
      .select()
      .from(pipelineMetrics)
      .where(gte(pipelineMetrics.createdAt, since))
      .orderBy(desc(pipelineMetrics.createdAt));

    // Group by analysisId
    const byAnalysis = new Map<string, (typeof allMetrics)[number][]>();
    for (const metric of allMetrics) {
      if (!metric.analysisId) continue;
      const group = byAnalysis.get(metric.analysisId);
      if (group) {
        group.push(metric);
      } else {
        byAnalysis.set(metric.analysisId, [metric]);
      }
    }

    // Compute stats
    const totalAnalyses = byAnalysis.size;
    const successfulAnalyses = [...byAnalysis.values()].filter((metrics) =>
      metrics.every((m) => m.success),
    ).length;
    const successRate =
      totalAnalyses > 0 ? Math.round((successfulAnalyses / totalAnalyses) * 100) : 0;

    const totalDurations = [...byAnalysis.values()].map((metrics) =>
      metrics.reduce((sum, m) => sum + m.durationMs, 0),
    );
    const avgDurationMs =
      totalDurations.length > 0
        ? Math.round(totalDurations.reduce((a, b) => a + b, 0) / totalDurations.length)
        : 0;

    const totalInputTokens = allMetrics.reduce((sum, m) => sum + (m.inputTokens ?? 0), 0);
    const totalOutputTokens = allMetrics.reduce((sum, m) => sum + (m.outputTokens ?? 0), 0);

    let estimatedCostUsd = 0;
    for (const m of allMetrics) {
      estimatedCostUsd += estimateCost(m.model, m.inputTokens ?? 0, m.outputTokens ?? 0);
    }

    // Recent analyses (last 50)
    const recentAnalyses = [...byAnalysis.entries()].slice(0, 50).map(([analysisId, metrics]) => {
      const sorted = [...metrics].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      const steps: StepMetric[] = sorted.map((m) => ({
        step: m.step,
        durationMs: m.durationMs,
        inputTokens: m.inputTokens,
        outputTokens: m.outputTokens,
        model: m.model,
        success: m.success,
        errorMessage: m.errorMessage,
      }));
      const totalDurationMs = metrics.reduce((sum, m) => sum + m.durationMs, 0);
      const totalIn = metrics.reduce((sum, m) => sum + (m.inputTokens ?? 0), 0);
      const totalOut = metrics.reduce((sum, m) => sum + (m.outputTokens ?? 0), 0);
      const allSuccess = metrics.every((m) => m.success);

      return {
        analysisId,
        createdAt: sorted[0]!.createdAt,
        totalDurationMs,
        steps,
        totalInputTokens: totalIn,
        totalOutputTokens: totalOut,
        allSuccess,
      };
    });

    // Recent errors
    const errors = allMetrics
      .filter((m) => !m.success)
      .slice(0, 50)
      .map((m) => ({
        analysisId: m.analysisId,
        step: m.step,
        errorMessage: m.errorMessage,
        durationMs: m.durationMs,
        createdAt: m.createdAt,
      }));

    return {
      stats: {
        totalAnalyses,
        successRate,
        avgDurationMs,
        estimatedCostUsd: Math.round(estimatedCostUsd * 10000) / 10000,
        totalInputTokens,
        totalOutputTokens,
      },
      recentAnalyses,
      errors,
    };
  }),
});
