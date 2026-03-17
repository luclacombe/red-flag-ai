"use client";

import { AlertTriangle, Calendar, FileText, Loader2, Trash2, Upload } from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";
import { cn } from "@/lib/utils";
import { trpc } from "@/trpc/react";
import { ConfirmDialog } from "./confirm-dialog";
import { LegalDisclaimer } from "./legal-disclaimer";
import { NavBar } from "./nav-bar";

const recommendationConfig: Record<string, { label: string; className: string }> = {
  sign: {
    label: "Safe to Sign",
    className: "bg-green-500/10 text-green-300 border-green-500/20",
  },
  caution: {
    label: "Proceed with Caution",
    className: "bg-amber-500/10 text-amber-300 border-amber-500/20",
  },
  do_not_sign: {
    label: "Do Not Sign",
    className: "bg-red-500/10 text-red-300 border-red-500/20",
  },
};

function getScoreColor(score: number): string {
  if (score <= 33) return "text-green-400";
  if (score <= 66) return "text-amber-400";
  return "text-red-400";
}

function formatContractType(type: string): string {
  return type
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export function HistoryView() {
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const utils = trpc.useUtils();
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
    trpc.analysis.list.useInfiniteQuery(
      { limit: 20 },
      {
        getNextPageParam: (lastPage) => lastPage.nextCursor,
      },
    );

  const deleteMutation = trpc.analysis.delete.useMutation({
    onSuccess: () => {
      utils.analysis.list.invalidate();
      setDeletingId(null);
    },
  });

  const handleDelete = useCallback(
    (analysisId: string) => {
      deleteMutation.mutate({ analysisId });
    },
    [deleteMutation],
  );

  const items = data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="flex min-h-screen flex-col bg-[#0B1120]">
      <NavBar hideHowItWorks />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="font-heading text-2xl font-semibold text-white">Analysis History</h1>
        </div>

        {/* Loading skeleton */}
        {isLoading && (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: skeleton items
                key={i}
                className="animate-pulse rounded-xl border border-white/10 bg-white/5 p-4"
              >
                <div className="flex items-center gap-4">
                  <div className="size-10 rounded-lg bg-slate-700" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-48 rounded bg-slate-700" />
                    <div className="h-3 w-32 rounded bg-slate-700" />
                  </div>
                  <div className="h-6 w-20 rounded-full bg-slate-700" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {!isLoading && items.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-white/10 bg-white/[0.02] px-6 py-16 text-center">
            <div className="mb-4 rounded-full bg-white/5 p-4">
              <FileText className="size-8 text-slate-500" />
            </div>
            <h2 className="font-heading text-lg font-semibold text-white">No analyses yet</h2>
            <p className="mt-1 max-w-sm text-sm text-slate-400">
              Upload your first contract to get started with AI-powered clause-by-clause risk
              analysis.
            </p>
            <Link
              href="/"
              className="mt-6 inline-flex items-center gap-2 rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-semibold text-slate-900 transition-colors duration-150 hover:bg-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 focus:ring-offset-[#0B1120]"
            >
              <Upload className="size-4" />
              Upload a contract
            </Link>
          </div>
        )}

        {/* Analysis list */}
        {!isLoading && items.length > 0 && (
          <div className="space-y-3">
            {items.map((item) => {
              const recConfig = item.recommendation
                ? recommendationConfig[item.recommendation]
                : null;
              const isComplete = item.status === "complete";
              const isFailed = item.status === "failed";

              return (
                <div
                  key={item.id}
                  className="group relative rounded-xl border border-white/10 bg-white/5 transition-colors duration-150 hover:border-white/20 hover:bg-white/[0.07]"
                >
                  <Link href={`/analysis/${item.id}`} className="flex items-center gap-4 p-4">
                    {/* Risk score indicator */}
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5">
                      {isComplete && item.riskScore != null ? (
                        <span
                          className={cn(
                            "text-sm font-bold tabular-nums",
                            getScoreColor(item.riskScore),
                          )}
                        >
                          {item.riskScore}
                        </span>
                      ) : isFailed ? (
                        <AlertTriangle className="size-4 text-red-400" />
                      ) : (
                        <Loader2 className="size-4 animate-spin text-slate-500" />
                      )}
                    </div>

                    {/* Details */}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-200">
                        {item.documentName}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        {item.contractType && (
                          <span className="rounded bg-white/5 px-1.5 py-0.5 text-slate-400">
                            {formatContractType(item.contractType)}
                          </span>
                        )}
                        <span className="inline-flex items-center gap-1">
                          <Calendar className="size-3" />
                          {formatDate(item.createdAt)}
                        </span>
                      </div>
                    </div>

                    {/* Recommendation badge */}
                    {isComplete && recConfig && (
                      <span
                        className={cn(
                          "hidden shrink-0 rounded-full border px-3 py-1 text-xs font-semibold sm:inline-flex",
                          recConfig.className,
                        )}
                      >
                        {recConfig.label}
                      </span>
                    )}
                    {isFailed && (
                      <span className="hidden shrink-0 rounded-full border border-red-500/20 bg-red-500/10 px-3 py-1 text-xs font-semibold text-red-300 sm:inline-flex">
                        Failed
                      </span>
                    )}
                  </Link>

                  {/* Delete button */}
                  <button
                    type="button"
                    onClick={() => setDeletingId(item.id)}
                    className="absolute right-3 top-3 cursor-pointer rounded-md p-1.5 text-slate-600 opacity-0 transition-all duration-150 hover:bg-red-500/10 hover:text-red-400 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-red-400 group-hover:opacity-100"
                    aria-label={`Delete analysis for ${item.documentName}`}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              );
            })}

            {/* Load more */}
            {hasNextPage && (
              <div className="flex justify-center pt-2">
                <button
                  type="button"
                  onClick={() => fetchNextPage()}
                  disabled={isFetchingNextPage}
                  className="cursor-pointer rounded-lg border border-white/10 bg-white/5 px-5 py-2 text-sm font-medium text-slate-300 transition-colors duration-150 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isFetchingNextPage ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="size-4 animate-spin" />
                      Loading...
                    </span>
                  ) : (
                    "Load more"
                  )}
                </button>
              </div>
            )}
          </div>
        )}
      </main>
      <LegalDisclaimer />

      {/* Delete confirmation dialog */}
      <ConfirmDialog
        open={deletingId !== null}
        onClose={() => setDeletingId(null)}
        onConfirm={() => {
          if (deletingId) handleDelete(deletingId);
        }}
        title="Delete analysis"
        description="This will permanently delete this analysis and its associated document. This cannot be undone."
        confirmLabel="Delete"
        loading={deleteMutation.isPending}
        variant="destructive"
      />
    </div>
  );
}
