"use client";

import { Check, Download, Link2, Link2Off, Loader2, LogIn, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { trpc } from "@/trpc/react";
import { ConfirmDialog } from "./confirm-dialog";

interface AnalysisActionsProps {
  analysisId: string;
  isOwner: boolean;
  isPublic: boolean;
  shareExpiresAt: Date | null;
  isAuthenticated: boolean;
}

function formatExpiry(date: Date): string {
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function AnalysisActions({
  analysisId,
  isOwner,
  isPublic: initialIsPublic,
  shareExpiresAt: initialExpiresAt,
  isAuthenticated,
}: AnalysisActionsProps) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [isPublic, setIsPublic] = useState(initialIsPublic);
  const [shareExpiresAt, setShareExpiresAt] = useState(initialExpiresAt);

  const deleteMutation = trpc.analysis.delete.useMutation({
    onSuccess: () => {
      router.push("/dashboard");
    },
  });

  const toggleShareMutation = trpc.analysis.toggleShare.useMutation({
    onSuccess: (data) => {
      setIsPublic(data.isPublic);
      setShareExpiresAt(data.shareExpiresAt);
    },
  });

  const copyLink = useCallback(async () => {
    const url = `${window.location.origin}/analysis/${analysisId}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const input = document.createElement("input");
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [analysisId]);

  const handleShare = useCallback(async () => {
    if (!isOwner) {
      await copyLink();
      return;
    }

    if (isPublic) {
      await copyLink();
    } else {
      toggleShareMutation.mutate({ analysisId, enabled: true }, { onSuccess: () => copyLink() });
    }
  }, [analysisId, isOwner, isPublic, copyLink, toggleShareMutation]);

  const handleUnshare = useCallback(() => {
    toggleShareMutation.mutate({ analysisId, enabled: false });
  }, [analysisId, toggleShareMutation]);

  const isExpired = shareExpiresAt ? new Date(shareExpiresAt) < new Date() : false;
  const isActiveShare = isPublic && !isExpired;

  // Anonymous users: only Download PDF + CTA to create account
  if (!isAuthenticated) {
    return (
      <div className="flex items-center gap-2">
        <a
          href={`/api/report/${analysisId}`}
          download
          className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-200 transition-colors duration-150 hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-[#0B1120]"
        >
          <Download className="size-4" />
          Download PDF
        </a>
        <Link
          href="/login"
          className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-200 transition-colors duration-150 hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-[#0B1120]"
        >
          <LogIn className="size-4" />
          Sign in to share
        </Link>
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleShare}
          disabled={toggleShareMutation.isPending}
          className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-200 transition-colors duration-150 hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-[#0B1120] disabled:opacity-50"
        >
          {toggleShareMutation.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : copied ? (
            <>
              <Check className="size-4 text-green-400" />
              <span className="text-green-400">Copied!</span>
            </>
          ) : isActiveShare ? (
            <>
              <Link2 className="size-4 text-blue-400" />
              <span>
                Shared
                {shareExpiresAt && (
                  <span className="text-slate-400">
                    {" "}
                    · Expires {formatExpiry(new Date(shareExpiresAt))}
                  </span>
                )}
              </span>
            </>
          ) : (
            <>
              <Link2 className="size-4" />
              Share
            </>
          )}
        </button>

        {isOwner && isActiveShare && (
          <button
            type="button"
            onClick={handleUnshare}
            disabled={toggleShareMutation.isPending}
            title="Stop sharing"
            className="inline-flex cursor-pointer items-center rounded-lg border border-white/10 bg-white/5 p-2 text-sm text-slate-400 transition-colors duration-150 hover:bg-white/10 hover:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-[#0B1120] disabled:opacity-50"
          >
            <Link2Off className="size-4" />
          </button>
        )}

        <a
          href={`/api/report/${analysisId}`}
          download
          className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-200 transition-colors duration-150 hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-[#0B1120]"
        >
          <Download className="size-4" />
          Download PDF
        </a>

        {isOwner && (
          <button
            type="button"
            onClick={() => setShowDelete(true)}
            className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-200 transition-colors duration-150 hover:border-red-500/30 hover:bg-red-500/10 hover:text-red-300 focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-offset-[#0B1120]"
          >
            {deleteMutation.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Trash2 className="size-4" />
            )}
            Delete
          </button>
        )}
      </div>

      {isOwner && (
        <ConfirmDialog
          open={showDelete}
          onClose={() => setShowDelete(false)}
          onConfirm={() => deleteMutation.mutate({ analysisId })}
          title="Delete analysis"
          description="This will permanently delete this analysis and its associated document. This cannot be undone."
          confirmLabel="Delete"
          loading={deleteMutation.isPending}
          variant="destructive"
        />
      )}
    </>
  );
}
