import { cn } from "@/lib/utils";

interface StatusBarProps {
  message: string;
  className?: string;
}

export function StatusBar({ message, className }: StatusBarProps) {
  return (
    <div
      className={cn("w-full border-b border-blue-500/20 bg-blue-500/10 px-4 py-2.5", className)}
      role="status"
      aria-live="polite"
    >
      <div className="mx-auto flex max-w-3xl items-center justify-center gap-2">
        <span className="size-2 shrink-0 animate-pulse rounded-full bg-blue-400" />
        <p className="text-sm font-medium text-blue-400">{message}</p>
      </div>
    </div>
  );
}
