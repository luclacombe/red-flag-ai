import { cn } from "@/lib/utils";

interface StatusBarProps {
  message: string;
  className?: string;
}

export function StatusBar({ message, className }: StatusBarProps) {
  return (
    <div
      className={cn("w-full border-b border-blue-200 bg-blue-50 px-4 py-2.5", className)}
      role="status"
      aria-live="polite"
    >
      <div className="mx-auto flex max-w-3xl items-center gap-2">
        {/* Pulsing dot fallback for prefers-reduced-motion */}
        <span className="hidden size-2 shrink-0 rounded-full bg-blue-600 motion-reduce:inline-block motion-reduce:animate-pulse" />
        <p className="text-shimmer text-sm font-medium">{message}</p>
      </div>
    </div>
  );
}
