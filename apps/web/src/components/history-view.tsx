"use client";

import { SUPPORTED_LANGUAGES, type SupportedLanguageCode } from "@redflag/shared";
import {
  AlertTriangle,
  Calendar,
  Check,
  Clock,
  Download,
  FileText,
  Globe,
  Link2,
  Link2Off,
  Loader2,
  Pause,
  Pencil,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useStreamContext } from "@/context/stream-context";
import { cn } from "@/lib/utils";
import { trpc } from "@/trpc/react";
import { ConfirmDialog } from "./confirm-dialog";
import { LegalDisclaimer } from "./legal-disclaimer";
import { NavBar } from "./nav-bar";
import { UploadZone } from "./upload-zone";

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

const recommendationScoreColor: Record<string, string> = {
  sign: "text-green-400",
  caution: "text-amber-400",
  do_not_sign: "text-red-400",
};

function getScoreColor(recommendation: string | null): string {
  if (!recommendation) return "text-slate-400";
  return recommendationScoreColor[recommendation] ?? "text-amber-400";
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

function formatExpiry(date: Date): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
}

function daysUntilExpiry(documentCreatedAt: Date, expiresAt: Date | null): number {
  const deadline = expiresAt ?? new Date(documentCreatedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
  return Math.max(0, Math.ceil((deadline.getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
}

function daysUntilShareExpiry(shareExpiresAt: Date | null): number {
  if (!shareExpiresAt) return 0;
  return Math.max(0, Math.ceil((shareExpiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
}

/** Strip file extension from a document name */
function stripExtension(name: string): string {
  return name.replace(/\.[^.]+$/, "");
}

/** Compute display name for a rerun */
function rerunDisplayName(originalName: string, langCode?: string): string {
  const base = stripExtension(originalName);
  if (langCode) return `${base}_${langCode}`;
  const rerunMatch = base.match(/^(.+)_rerun(?:_(\d+))?$/);
  if (rerunMatch) {
    const num = rerunMatch[2] ? Number.parseInt(rerunMatch[2], 10) + 1 : 2;
    return `${rerunMatch[1]}_rerun_${num}`;
  }
  return `${base}_rerun`;
}

export function HistoryView() {
  const router = useRouter();
  const stream = useStreamContext();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [rerunMenu, setRerunMenu] = useState<{
    id: string;
    view: "main" | "languages";
  } | null>(null);
  const [downloadMenuId, setDownloadMenuId] = useState<string | null>(null);
  const [renewMenuId, setRenewMenuId] = useState<string | null>(null);
  // Universal per-item pending state: tracks which item ID has a given action in flight.
  // Prevents mutation.isPending from disabling buttons on ALL items.
  const [pendingItems, setPendingItems] = useState<Record<string, string | null>>({
    share: null,
    renew: null,
    rename: null,
  });
  const setPending = useCallback(
    (action: string, itemId: string | null) =>
      setPendingItems((prev) => ({ ...prev, [action]: itemId })),
    [],
  );
  const renameInputRef = useRef<HTMLInputElement>(null);
  const rerunMenuRef = useRef<HTMLDivElement>(null);
  const downloadMenuRef = useRef<HTMLDivElement>(null);
  const renewMenuRef = useRef<HTMLDivElement>(null);

  const [confirmAction, setConfirmAction] = useState<{
    title: string;
    description: string;
    onConfirm: () => void;
  } | null>(null);

  const utils = trpc.useUtils();
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
    trpc.analysis.list.useInfiniteQuery(
      { limit: 20 },
      {
        getNextPageParam: (lastPage) => lastPage.nextCursor,
      },
    );

  // Auto-refresh when there are processing items NOT covered by the active stream
  const hasNonStreamProcessing = data?.pages.some((p) =>
    p.items.some((i) => i.status === "processing" && i.id !== stream.analysisId),
  );
  useEffect(() => {
    if (!hasNonStreamProcessing) return;
    const interval = setInterval(() => utils.analysis.list.invalidate(), 2_000);
    return () => clearInterval(interval);
  }, [hasNonStreamProcessing, utils]);

  // Auto-invalidate list when the active stream completes
  const prevStreamDone = useRef(stream.streamDone);
  useEffect(() => {
    if (stream.streamDone && !prevStreamDone.current) {
      utils.analysis.list.invalidate();
    }
    prevStreamDone.current = stream.streamDone;
  }, [stream.streamDone, utils]);

  const deleteMutation = trpc.analysis.delete.useMutation({
    onSuccess: () => {
      utils.analysis.list.invalidate();
      setDeletingId(null);
      toast.success("Analysis deleted");
    },
    onError: () => toast.error("Failed to delete analysis"),
  });

  const renameMutation = trpc.analysis.rename.useMutation({
    onSuccess: () => {
      utils.analysis.list.invalidate();
      setRenamingId(null);
      setPending("rename", null);
      toast.success("Document renamed");
    },
    onError: () => {
      setPending("rename", null);
      toast.error("Failed to rename document");
    },
  });

  const shareMutation = trpc.analysis.toggleShare.useMutation({
    onSuccess: (data) => {
      utils.analysis.list.invalidate();
      setPending("share", null);
      if (data.isPublic) {
        toast.success("Share link created, copied to clipboard");
      } else {
        toast.success("Share link removed");
      }
    },
    onError: () => {
      setPending("share", null);
      toast.error("Failed to update share settings");
    },
  });

  const rerunMutation = trpc.analysis.rerun.useMutation({
    onSuccess: (data) => {
      toast.success("Re-analyzing contract...");
      router.push(`/analysis/${data.analysisId}`);
    },
    onError: (err) =>
      toast.error(
        err.data?.code === "TOO_MANY_REQUESTS"
          ? "Daily analysis limit reached"
          : "Failed to rerun analysis",
      ),
  });

  const renewMutation = trpc.analysis.renew.useMutation({
    onSuccess: () => {
      utils.analysis.list.invalidate();
      setPending("renew", null);
      toast.success("Document renewed for 30 more days");
    },
    onError: () => {
      setPending("renew", null);
      toast.error("Failed to renew document");
    },
  });

  // "Renew share link" reuses toggleShare with enabled=true to reset expiry
  const renewShareMutation = trpc.analysis.toggleShare.useMutation({
    onSuccess: () => {
      utils.analysis.list.invalidate();
      setPending("renew", null);
      toast.success("Share link renewed for 7 more days");
    },
    onError: () => {
      setPending("renew", null);
      toast.error("Failed to renew share link");
    },
  });

  const handleDelete = useCallback(
    (analysisId: string) => {
      deleteMutation.mutate({ analysisId });
    },
    [deleteMutation],
  );

  const handleRenameSubmit = useCallback(
    (analysisId: string, currentName: string) => {
      const trimmed = renameValue.trim();
      if (!trimmed || trimmed === currentName) {
        // No change or empty — just close the input, no mutation
        setRenamingId(null);
        return;
      }
      setPending("rename", analysisId);
      renameMutation.mutate({ analysisId, newName: trimmed });
    },
    [renameValue, renameMutation, setPending],
  );

  // Auto-focus rename input
  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  // Close dropdown menus on outside click
  useEffect(() => {
    if (!rerunMenu && !downloadMenuId && !renewMenuId) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rerunMenu && rerunMenuRef.current && !rerunMenuRef.current.contains(target)) {
        setRerunMenu(null);
      }
      if (downloadMenuId && downloadMenuRef.current && !downloadMenuRef.current.contains(target)) {
        setDownloadMenuId(null);
      }
      if (renewMenuId && renewMenuRef.current && !renewMenuRef.current.contains(target)) {
        setRenewMenuId(null);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [rerunMenu, downloadMenuId, renewMenuId]);

  const handleUploadSuccess = useCallback(
    (analysisId: string) => {
      utils.analysis.list.invalidate();
      toast.success("Contract uploaded, analysis starting");
      router.push(`/analysis/${analysisId}`);
    },
    [utils, router],
  );

  const items = data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="flex min-h-screen flex-col bg-[#0B1120]">
      <NavBar hideHowItWorks />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="font-heading text-2xl font-semibold text-white">Dashboard</h1>
        </div>

        {/* Loading state */}
        {isLoading && (
          <div className="flex min-h-[30vh] items-center justify-center">
            <Loader2 className="size-8 animate-spin text-slate-500" />
          </div>
        )}

        {/* Empty state — full upload zone */}
        {!isLoading && items.length === 0 && (
          <div className="mx-auto max-w-lg">
            <div className="mb-6 text-center">
              <h2 className="font-heading text-lg font-semibold text-white">No analyses yet</h2>
              <p className="mt-1 text-sm text-slate-400">
                Upload your first contract to get started.
              </p>
            </div>
            <UploadZone onUploadSuccess={handleUploadSuccess} />
          </div>
        )}

        {/* Analysis list */}
        {!isLoading && items.length > 0 && (
          <div className="space-y-3">
            {/* Compact upload zone */}
            <UploadZone onUploadSuccess={handleUploadSuccess} compact />

            {/* History section header */}
            <div className="flex items-center gap-3 pt-2">
              <div className="h-px flex-1 bg-white/10" />
              <span className="text-xs font-medium uppercase tracking-wider text-slate-500">
                Past analyses
              </span>
              <div className="h-px flex-1 bg-white/10" />
            </div>

            {items.map((item) => {
              const recConfig = item.recommendation
                ? recommendationConfig[item.recommendation]
                : null;
              const isComplete = item.status === "complete";
              const isFailed = item.status === "failed";
              const isProcessing = item.status === "processing";
              const isActiveStream = stream.analysisId === item.id && !stream.streamDone;
              const liveClauseCount = isActiveStream
                ? stream.streamClauses.length
                : item.analyzedClauseCount;
              const isStale =
                isProcessing &&
                !isActiveStream &&
                Date.now() - new Date(item.updatedAt).getTime() > 30_000;
              const hasActiveShare =
                item.isPublic &&
                (!item.shareExpiresAt || new Date(item.shareExpiresAt) > new Date());
              const isShareExpired =
                item.isPublic && item.shareExpiresAt && new Date(item.shareExpiresAt) <= new Date();
              const days = daysUntilExpiry(item.documentCreatedAt, item.documentExpiresAt ?? null);
              const shareDays = daysUntilShareExpiry(item.shareExpiresAt);
              const isRenaming = renamingId === item.id;

              return (
                <div
                  key={item.id}
                  className="rounded-xl border border-white/10 bg-white/5 transition-colors duration-150 hover:border-white/20 hover:bg-white/[0.07]"
                >
                  {/* Main clickable row */}
                  <Link href={`/analysis/${item.id}`} className="flex items-center gap-4 p-4">
                    {/* Risk score indicator */}
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5">
                      {isComplete && item.riskScore != null ? (
                        <span
                          className={cn(
                            "text-sm font-bold tabular-nums",
                            getScoreColor(item.recommendation ?? null),
                          )}
                        >
                          {item.riskScore}
                        </span>
                      ) : isFailed ? (
                        <AlertTriangle className="size-4 text-red-400" />
                      ) : isStale ? (
                        <Pause className="size-4 text-amber-400/70" />
                      ) : (
                        <Loader2 className="size-4 animate-spin text-slate-500" />
                      )}
                    </div>

                    {/* Details */}
                    <div className="min-w-0 flex-1">
                      {isRenaming ? (
                        // biome-ignore lint/a11y/useKeyWithClickEvents: handled by input
                        // biome-ignore lint/a11y/noStaticElementInteractions: prevents link navigation when renaming
                        <div
                          onClick={(e) => e.preventDefault()}
                          className="flex items-center gap-2"
                        >
                          <input
                            ref={renameInputRef}
                            type="text"
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                handleRenameSubmit(item.id, item.documentName);
                              }
                              if (e.key === "Escape") {
                                setRenamingId(null);
                              }
                            }}
                            onBlur={() => setRenamingId(null)}
                            className="w-full rounded border border-white/20 bg-white/10 px-2 py-1 text-sm text-white focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                          />
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              handleRenameSubmit(item.id, item.documentName);
                            }}
                            className="cursor-pointer rounded p-1 text-green-400 hover:bg-green-500/10"
                          >
                            <Check className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              setRenamingId(null);
                            }}
                            className="cursor-pointer rounded p-1 text-slate-400 hover:bg-white/10"
                          >
                            <X className="size-3.5" />
                          </button>
                        </div>
                      ) : (
                        <p className="truncate text-sm font-medium text-slate-200">
                          {item.documentName}
                        </p>
                      )}
                      {/* Metadata — type & date */}
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
                      {/* Status badges — share & expiry */}
                      {isComplete && (
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          {hasActiveShare && item.shareExpiresAt && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-[11px] text-green-400/80">
                              <Link2 className="size-2.5" />
                              Shared · expires {formatExpiry(new Date(item.shareExpiresAt))}
                            </span>
                          )}
                          {isShareExpired && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-slate-500">
                              <Link2Off className="size-2.5" />
                              Share expired
                            </span>
                          )}
                          <span
                            className={cn(
                              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]",
                              days <= 7
                                ? "bg-amber-500/10 text-amber-400/80"
                                : "bg-white/5 text-slate-500",
                            )}
                          >
                            <Clock className="size-2.5" />
                            {days <= 7 ? `Deletes in ${days}d` : `${days}d remaining`}
                          </span>
                        </div>
                      )}
                      {/* Processing progress */}
                      {isProcessing &&
                        (isStale ? (
                          <p className="mt-1 text-xs font-medium text-amber-400/80">
                            Analysis interrupted. Click to resume
                            {item.analyzedClauseCount > 0 &&
                              ` (${item.analyzedClauseCount} clauses done)`}
                          </p>
                        ) : (
                          <p className="text-shimmer mt-1 text-xs font-medium">
                            {liveClauseCount > 0
                              ? `Analyzing clauses: ${liveClauseCount} done`
                              : "Analyzing contract..."}
                          </p>
                        ))}
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

                  {/* Action row */}
                  {isComplete && (
                    <div className="relative flex flex-wrap items-center gap-1 border-t border-white/5 px-4 py-2">
                      <button
                        type="button"
                        onClick={() => {
                          setRenamingId(item.id);
                          setRenameValue(item.documentName);
                        }}
                        disabled={pendingItems.rename === item.id}
                        className="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-slate-500 transition-colors hover:bg-white/5 hover:text-slate-200 disabled:opacity-50"
                      >
                        <Pencil className="size-3" />
                        <span className="hidden sm:inline">Rename</span>
                      </button>

                      <div
                        ref={downloadMenuId === item.id ? downloadMenuRef : undefined}
                        className="relative"
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setDownloadMenuId(downloadMenuId === item.id ? null : item.id)
                          }
                          className="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-slate-500 transition-colors hover:bg-white/5 hover:text-slate-200"
                        >
                          <Download className="size-3" />
                          <span className="hidden sm:inline">Download</span>
                        </button>
                        {downloadMenuId === item.id && (
                          <div className="absolute left-0 top-full z-50 mt-1 w-44 overflow-hidden rounded-xl border border-white/10 bg-[#131B2E] shadow-2xl animate-[fade-slide-in_150ms_ease-out_both]">
                            <a
                              href={`/api/document/${item.id}`}
                              download
                              onClick={() => setDownloadMenuId(null)}
                              className="flex w-full items-center gap-2 px-3 py-2.5 text-xs text-slate-300 hover:bg-white/5 hover:text-white"
                            >
                              <FileText className="size-3.5" />
                              Original document
                            </a>
                            <a
                              href={`/api/report/${item.id}`}
                              download
                              onClick={() => setDownloadMenuId(null)}
                              className="flex w-full items-center gap-2 px-3 py-2.5 text-xs text-slate-300 hover:bg-white/5 hover:text-white"
                            >
                              <ShieldAlert className="size-3.5" />
                              Risk report (PDF)
                            </a>
                          </div>
                        )}
                      </div>

                      <div
                        ref={rerunMenu?.id === item.id ? rerunMenuRef : undefined}
                        className="relative"
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setRerunMenu(
                              rerunMenu?.id === item.id ? null : { id: item.id, view: "main" },
                            )
                          }
                          disabled={rerunMutation.isPending}
                          className="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-slate-500 transition-colors hover:bg-white/5 hover:text-slate-200 disabled:opacity-50"
                        >
                          <RotateCcw className="size-3" />
                          <span className="hidden sm:inline">Rerun</span>
                        </button>
                        {rerunMenu?.id === item.id && (
                          <div className="absolute left-0 top-full z-50 mt-1 w-52 overflow-hidden rounded-xl border border-white/10 bg-[#131B2E] shadow-2xl animate-[fade-slide-in_150ms_ease-out_both]">
                            {rerunMenu.view === "main" ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setRerunMenu(null);
                                    setConfirmAction({
                                      title: "Rerun analysis",
                                      description:
                                        "This will create a new analysis of the same document. The original analysis will be preserved.",
                                      onConfirm: () =>
                                        rerunMutation.mutate({
                                          analysisId: item.id,
                                          displayName: rerunDisplayName(item.documentName),
                                        }),
                                    });
                                  }}
                                  className="flex w-full cursor-pointer items-center gap-2 px-3 py-2.5 text-xs text-slate-300 hover:bg-white/5 hover:text-white"
                                >
                                  <RotateCcw className="size-3.5" />
                                  Same settings
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setRerunMenu({
                                      id: item.id,
                                      view: "languages",
                                    })
                                  }
                                  className="flex w-full cursor-pointer items-center gap-2 px-3 py-2.5 text-xs text-slate-300 hover:bg-white/5 hover:text-white"
                                >
                                  <Globe className="size-3.5" />
                                  Different language
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setRerunMenu({
                                      id: item.id,
                                      view: "main",
                                    })
                                  }
                                  className="flex w-full cursor-pointer items-center gap-2 border-b border-white/5 px-3 py-2 text-xs text-slate-400 hover:bg-white/5 hover:text-slate-200"
                                >
                                  &larr; Back
                                </button>
                                <div className="max-h-44 overflow-y-auto">
                                  {SUPPORTED_LANGUAGES.filter((l) => l.code !== "auto").map(
                                    (lang) => (
                                      <button
                                        key={lang.code}
                                        type="button"
                                        disabled={rerunMutation.isPending}
                                        onClick={() => {
                                          setRerunMenu(null);
                                          setConfirmAction({
                                            title: `Rerun in ${lang.name}`,
                                            description: `This will create a new analysis with explanations in ${lang.name}. The original analysis will be preserved.`,
                                            onConfirm: () =>
                                              rerunMutation.mutate({
                                                analysisId: item.id,
                                                responseLanguage:
                                                  lang.code as SupportedLanguageCode,
                                                displayName: rerunDisplayName(
                                                  item.documentName,
                                                  lang.code,
                                                ),
                                              }),
                                          });
                                        }}
                                        className="flex w-full cursor-pointer items-center px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5 hover:text-white disabled:opacity-50"
                                      >
                                        {lang.nativeName}
                                      </button>
                                    ),
                                  )}
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          const enabling = !hasActiveShare;
                          if (enabling) {
                            setPending("share", item.id);
                            shareMutation.mutate(
                              {
                                analysisId: item.id,
                                enabled: true,
                              },
                              {
                                onSuccess: () => {
                                  navigator.clipboard.writeText(
                                    `${window.location.origin}/analysis/${item.id}`,
                                  );
                                },
                              },
                            );
                          } else {
                            setConfirmAction({
                              title: "Stop sharing",
                              description:
                                "This will disable the share link. Anyone with the link will no longer be able to view this analysis.",
                              onConfirm: () => {
                                setPending("share", item.id);
                                shareMutation.mutate({
                                  analysisId: item.id,
                                  enabled: false,
                                });
                              },
                            });
                          }
                        }}
                        disabled={pendingItems.share === item.id}
                        className="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-slate-500 transition-colors hover:bg-white/5 hover:text-slate-200 disabled:opacity-50"
                      >
                        {hasActiveShare ? (
                          <>
                            <Link2Off className="size-3" />
                            <span className="hidden sm:inline">Unshare</span>
                          </>
                        ) : (
                          <>
                            <Link2 className="size-3" />
                            <span className="hidden sm:inline">Share</span>
                          </>
                        )}
                      </button>

                      {/* Renew dropdown */}
                      <div
                        ref={renewMenuId === item.id ? renewMenuRef : undefined}
                        className="relative"
                      >
                        <button
                          type="button"
                          onClick={() => setRenewMenuId(renewMenuId === item.id ? null : item.id)}
                          disabled={pendingItems.renew === item.id}
                          className={cn(
                            "inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition-colors disabled:opacity-50",
                            days <= 7
                              ? "text-amber-400/70 hover:bg-amber-500/10 hover:text-amber-300"
                              : "text-slate-500 hover:bg-white/5 hover:text-slate-200",
                          )}
                        >
                          <RefreshCw className="size-3" />
                          <span className="hidden sm:inline">Renew</span>
                        </button>
                        {renewMenuId === item.id && (
                          <div className="absolute right-0 top-full z-50 mt-1 w-52 overflow-hidden rounded-xl border border-white/10 bg-[#131B2E] shadow-2xl animate-[fade-slide-in_150ms_ease-out_both] sm:left-0 sm:right-auto">
                            <button
                              type="button"
                              onClick={() => {
                                setRenewMenuId(null);
                                setPending("renew", item.id);
                                renewMutation.mutate({
                                  analysisId: item.id,
                                });
                              }}
                              className="flex w-full cursor-pointer items-center gap-2 px-3 py-2.5 text-xs text-slate-300 hover:bg-white/5 hover:text-white"
                            >
                              <Calendar className="size-3.5" />
                              <span>
                                Extend document <span className="text-slate-500">(+30 days)</span>
                              </span>
                            </button>
                            {hasActiveShare && (
                              <button
                                type="button"
                                onClick={() => {
                                  setRenewMenuId(null);
                                  setPending("renew", item.id);
                                  renewShareMutation.mutate({
                                    analysisId: item.id,
                                    enabled: true,
                                  });
                                }}
                                className="flex w-full cursor-pointer items-center gap-2 px-3 py-2.5 text-xs text-slate-300 hover:bg-white/5 hover:text-white"
                              >
                                <Link2 className="size-3.5" />
                                <span>
                                  Extend share link{" "}
                                  <span className="text-slate-500">
                                    (+7 days, {shareDays}d left)
                                  </span>
                                </span>
                              </button>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Delete — pushed to right */}
                      <div className="ml-auto">
                        <button
                          type="button"
                          onClick={() => setDeletingId(item.id)}
                          className="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-slate-600 transition-colors hover:bg-red-500/10 hover:text-red-400"
                          aria-label={`Delete analysis for ${item.documentName}`}
                        >
                          <Trash2 className="size-3" />
                          <span className="hidden sm:inline">Delete</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Action row for processing/failed — delete (and resume hint for stale) */}
                  {!isComplete && (isFailed || isStale) && (
                    <div className="flex items-center border-t border-white/5 px-4 py-2">
                      <div className="ml-auto">
                        <button
                          type="button"
                          onClick={() => setDeletingId(item.id)}
                          className="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-slate-600 transition-colors hover:bg-red-500/10 hover:text-red-400"
                          aria-label={`Delete analysis for ${item.documentName}`}
                        >
                          <Trash2 className="size-3" />
                          <span className="hidden sm:inline">Delete</span>
                        </button>
                      </div>
                    </div>
                  )}
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

      {/* Generic confirmation dialog for rerun, unshare, etc. */}
      <ConfirmDialog
        open={confirmAction !== null}
        onClose={() => setConfirmAction(null)}
        onConfirm={() => {
          confirmAction?.onConfirm();
          setConfirmAction(null);
        }}
        title={confirmAction?.title ?? ""}
        description={confirmAction?.description ?? ""}
        confirmLabel="Confirm"
      />
    </div>
  );
}
