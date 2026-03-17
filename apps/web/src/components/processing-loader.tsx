import { cn } from "@/lib/utils";

interface ProcessingLoaderProps {
  text?: string;
  className?: string;
}

export function ProcessingLoader({
  text = "Checking document...",
  className,
}: ProcessingLoaderProps) {
  return (
    <div className={cn("inline-flex items-center gap-2", className)}>
      <div className="flex items-center space-x-1">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="size-2 animate-[bounce-dots_1.4s_ease-in-out_infinite] rounded-full bg-amber-500"
            style={{ animationDelay: `${i * 160}ms` }}
          />
        ))}
      </div>
      <span className="text-sm font-medium text-slate-400">{text}</span>
    </div>
  );
}
