"use client";

import { CheckCircle2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type StepId = "connecting" | "gate" | "extracting" | "parsing" | "analyzing";

interface Step {
  id: StepId;
  label: string;
}

const STEPS: Step[] = [
  { id: "connecting", label: "Connecting to analysis engine" },
  { id: "gate", label: "Checking document relevance" },
  { id: "extracting", label: "Extracting document text" },
  { id: "parsing", label: "Identifying clause boundaries" },
  { id: "analyzing", label: "Analyzing clauses" },
];

interface ProcessingStepsProps {
  currentStep: StepId;
  clauseCount?: number;
  className?: string;
}

export function ProcessingSteps({ currentStep, clauseCount, className }: ProcessingStepsProps) {
  const currentIdx = STEPS.findIndex((s) => s.id === currentStep);

  return (
    <div
      className={cn(
        "mx-auto max-w-md rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-sm",
        className,
      )}
    >
      <div className="space-y-3">
        {STEPS.map((step, idx) => {
          const isDone = idx < currentIdx;
          const isActive = idx === currentIdx;
          const isPending = idx > currentIdx;

          // Don't show "analyzing" step until we're there
          if (step.id === "analyzing" && isPending) return null;

          let label = step.label;
          if (step.id === "analyzing" && clauseCount) {
            label = `Analyzing ${clauseCount} clauses`;
          }

          return (
            <div
              key={step.id}
              className={cn(
                "flex items-center gap-3 transition-opacity duration-300",
                isPending && "opacity-0",
                isActive && "animate-[fade-slide-in_300ms_ease-out_both]",
                isDone && "opacity-70",
              )}
              style={isActive ? { animationDelay: `${idx * 200}ms` } : undefined}
            >
              {isDone && <CheckCircle2 className="size-5 shrink-0 text-green-400" />}
              {isActive && <Loader2 className="size-5 shrink-0 animate-spin text-amber-400" />}
              {isPending && (
                <div className="size-5 shrink-0 rounded-full border border-slate-600" />
              )}

              <span
                className={cn(
                  "text-sm font-medium",
                  isDone && "text-slate-400",
                  isActive && "text-shimmer",
                  isPending && "text-slate-600",
                )}
              >
                {label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
