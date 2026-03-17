"use client";

import type { RiskLevel } from "@redflag/shared";
import { AlertTriangle, CircleCheck, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

const riskConfig = {
  red: {
    label: "High Risk",
    icon: AlertTriangle,
    className: "bg-red-500/10 text-red-400 border-red-500/20",
  },
  yellow: {
    label: "Caution",
    icon: TriangleAlert,
    className: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  },
  green: {
    label: "Low Risk",
    icon: CircleCheck,
    className: "bg-green-500/10 text-green-400 border-green-500/20",
  },
} as const;

interface RiskBadgeProps {
  level: RiskLevel;
  className?: string;
}

export function RiskBadge({ level, className }: RiskBadgeProps) {
  const config = riskConfig[level];
  const Icon = config.icon;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold",
        config.className,
        className,
      )}
    >
      <Icon className="size-3.5" strokeWidth={2.5} />
      {config.label}
    </span>
  );
}
