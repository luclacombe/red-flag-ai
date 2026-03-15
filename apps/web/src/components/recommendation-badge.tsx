import type { Recommendation } from "@redflag/shared";
import { cn } from "@/lib/utils";

const config: Record<Recommendation, { label: string; className: string }> = {
  sign: {
    label: "Safe to Sign",
    className: "bg-green-100 text-green-800 border-green-300",
  },
  caution: {
    label: "Proceed with Caution",
    className: "bg-amber-100 text-amber-800 border-amber-300",
  },
  do_not_sign: {
    label: "Do Not Sign",
    className: "bg-red-100 text-red-800 border-red-300",
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
