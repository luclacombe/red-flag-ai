"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  loading?: boolean;
  variant?: "destructive" | "default";
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  loading = false,
  variant = "default",
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  // Close on backdrop click
  const handleBackdropClick = (e: React.MouseEvent<HTMLDialogElement>) => {
    if (e.target === dialogRef.current && !loading) {
      onClose();
    }
  };

  // Close on Escape
  const handleCancel = (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!loading) onClose();
  };

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: dialog handles keyboard via onCancel (Escape)
    <dialog
      ref={dialogRef}
      onCancel={handleCancel}
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 m-auto w-[calc(100vw-2rem)] max-w-md rounded-xl border border-white/10 bg-[#131B2E] p-0 text-white shadow-2xl backdrop:bg-black/60 open:animate-[fade-slide-in_200ms_ease-out_both]"
    >
      <div className="p-6">
        <h2 className="font-heading text-lg font-semibold">{title}</h2>
        <p className="mt-2 text-sm text-slate-400">{description}</p>
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="cursor-pointer rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-300 transition-colors duration-150 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={cn(
              "inline-flex cursor-pointer items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50",
              variant === "destructive"
                ? "bg-red-600 text-white hover:bg-red-500 focus:ring-red-500"
                : "bg-amber-500 text-slate-900 hover:bg-amber-400 focus:ring-amber-500",
              "focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-[#131B2E]",
            )}
          >
            {loading && <Loader2 className="size-4 animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
