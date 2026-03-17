import { cn } from "@/lib/utils";

interface BreakdownBarProps {
  red: number;
  yellow: number;
  green: number;
  className?: string;
}

export function BreakdownBar({ red, yellow, green, className }: BreakdownBarProps) {
  const total = red + yellow + green;
  if (total === 0) return null;

  const redPercent = (red / total) * 100;
  const yellowPercent = (yellow / total) * 100;
  const greenPercent = (green / total) * 100;

  return (
    <div className={cn("space-y-2", className)}>
      {/* Stacked bar */}
      <div className="flex h-3 overflow-hidden rounded-full bg-slate-800">
        {red > 0 && (
          <div
            className="bg-red-500 transition-all duration-500"
            style={{ width: `${redPercent}%` }}
          />
        )}
        {yellow > 0 && (
          <div
            className="bg-amber-500 transition-all duration-500"
            style={{ width: `${yellowPercent}%` }}
          />
        )}
        {green > 0 && (
          <div
            className="bg-green-500 transition-all duration-500"
            style={{ width: `${greenPercent}%` }}
          />
        )}
      </div>

      {/* Counts */}
      <div className="flex flex-wrap items-center gap-4 text-xs font-medium text-slate-400">
        {red > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-red-500" />
            {red} high risk
          </span>
        )}
        {yellow > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-amber-500" />
            {yellow} caution
          </span>
        )}
        {green > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-green-500" />
            {green} low risk
          </span>
        )}
      </div>
    </div>
  );
}
