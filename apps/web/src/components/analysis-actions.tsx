"use client";

import { Check, Download, Link2, Loader2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { trpc } from "@/trpc/react";
import { ConfirmDialog } from "./confirm-dialog";

interface AnalysisActionsProps {
  analysisId: string;
}

export function AnalysisActions({ analysisId }: AnalysisActionsProps) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [showDelete, setShowDelete] = useState(false);

  const deleteMutation = trpc.analysis.delete.useMutation({
    onSuccess: () => {
      router.push("/history");
    },
  });

  const handleShare = useCallback(async () => {
    const url = `${window.location.origin}/analysis/${analysisId}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers / insecure contexts
      const input = document.createElement("input");
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [analysisId]);

  return (
    <>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleShare}
          className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-200 transition-colors duration-150 hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-[#0B1120]"
        >
          {copied ? (
            <>
              <Check className="size-4 text-green-400" />
              <span className="text-green-400">Copied!</span>
            </>
          ) : (
            <>
              <Link2 className="size-4" />
              Share
            </>
          )}
        </button>
        <a
          href={`/api/report/${analysisId}`}
          download
          className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-200 transition-colors duration-150 hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-[#0B1120]"
        >
          <Download className="size-4" />
          Download PDF
        </a>
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
      </div>

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
    </>
  );
}
