"use client";

import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface ErrorStateProps {
  message: string;
  onRetry?: () => void;
  className?: string;
}

export function ErrorState({ message, onRetry, className }: ErrorStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-4 rounded-lg border border-red-500/20 bg-red-500/10 p-6 text-center",
        className,
      )}
    >
      <AlertCircle className="size-10 text-red-500" />
      <p className="text-sm font-medium text-red-400">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="cursor-pointer rounded-lg border border-white/10 bg-white/5 px-6 py-2.5 text-sm font-semibold text-slate-200 transition-colors duration-150 hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-1 focus:ring-offset-[#0B1120]"
        >
          Try again
        </button>
      )}
    </div>
  );
}
