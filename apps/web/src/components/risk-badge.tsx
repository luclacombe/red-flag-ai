"use client";

import type { RiskLevel } from "@redflag/shared";
import { AlertTriangle, CircleCheck, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

const riskConfig = {
  red: {
    label: "High Risk",
    icon: AlertTriangle,
    className: "bg-red-50 text-red-700 border-red-200",
  },
  yellow: {
    label: "Caution",
    icon: TriangleAlert,
    className: "bg-amber-50 text-amber-700 border-amber-200",
  },
  green: {
    label: "Low Risk",
    icon: CircleCheck,
    className: "bg-green-50 text-green-700 border-green-200",
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
