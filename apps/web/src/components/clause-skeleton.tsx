import { cn } from "@/lib/utils";

interface ClauseSkeletonProps {
  /** When true, shows a shimmer effect instead of just pulsing */
  analyzing?: boolean;
  className?: string;
}

export function ClauseSkeleton({ analyzing = false, className }: ClauseSkeletonProps) {
  return (
    <div
      className={cn(
        "rounded-xl border border-white/10 bg-white/5 p-4 backdrop-blur-sm md:p-5",
        analyzing && "ring-1 ring-blue-500/30",
        className,
      )}
    >
      <div className="flex items-start gap-4">
        {/* Left border placeholder */}
        <div className="w-1 shrink-0 self-stretch rounded-full bg-slate-600 skeleton-shimmer" />
        <div className="flex-1 space-y-3">
          {/* Category + badge row */}
          <div className="flex items-center gap-3">
            <div className="h-4 w-24 rounded bg-slate-700 skeleton-shimmer" />
            <div className="h-5 w-20 rounded-full bg-slate-700 skeleton-shimmer" />
          </div>
          {/* Text lines */}
          <div className="h-4 w-full rounded bg-slate-700 skeleton-shimmer" />
          <div className="h-4 w-5/6 rounded bg-slate-700 skeleton-shimmer" />
          {analyzing && <p className="text-shimmer text-xs font-medium">Analyzing clause...</p>}
        </div>
      </div>
    </div>
  );
}
