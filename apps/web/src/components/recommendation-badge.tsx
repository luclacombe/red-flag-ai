import type { Recommendation } from "@redflag/shared";
import { cn } from "@/lib/utils";

const config: Record<Recommendation, { label: string; className: string }> = {
  sign: {
    label: "Safe to Sign",
    className: "bg-green-500/10 text-green-300 border-green-500/20",
  },
  caution: {
    label: "Proceed with Caution",
    className: "bg-amber-500/10 text-amber-300 border-amber-500/20",
  },
  do_not_sign: {
    label: "Do Not Sign",
    className: "bg-red-500/10 text-red-300 border-red-500/20",
  },
};

interface RecommendationBadgeProps {
  recommendation: Recommendation;
  className?: string;
}

export function RecommendationBadge({ recommendation, className }: RecommendationBadgeProps) {
  const { label, className: variantClass } = config[recommendation];

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-4 py-2 text-sm font-semibold",
        variantClass,
        className,
      )}
    >
      {label}
    </span>
  );
}
