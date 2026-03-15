import { cn } from "@/lib/utils";

interface ClauseSkeletonProps {
  className?: string;
}

export function ClauseSkeleton({ className }: ClauseSkeletonProps) {
  return (
    <div className={cn("rounded-lg border border-slate-200 bg-white p-4 md:p-6", className)}>
      <div className="flex items-start gap-4">
        {/* Left border placeholder */}
        <div className="w-1 shrink-0 self-stretch animate-pulse rounded-full bg-slate-200" />
        <div className="flex-1 space-y-3">
          {/* Category + badge row */}
          <div className="flex items-center gap-3">
            <div className="h-4 w-24 animate-pulse rounded bg-slate-200" />
            <div className="h-5 w-20 animate-pulse rounded-full bg-slate-200" />
          </div>
          {/* Text lines */}
          <div className="h-4 w-full animate-pulse rounded bg-slate-200" />
          <div className="h-4 w-5/6 animate-pulse rounded bg-slate-200" />
          <div className="h-4 w-3/4 animate-pulse rounded bg-slate-200" />
        </div>
      </div>
    </div>
  );
}
