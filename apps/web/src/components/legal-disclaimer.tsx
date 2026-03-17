import Link from "next/link";
import { cn } from "@/lib/utils";

interface LegalDisclaimerProps {
  className?: string;
}

export function LegalDisclaimer({ className }: LegalDisclaimerProps) {
  return (
    <footer className={cn("border-t border-white/5 px-4 py-6", className)}>
      <p className="mx-auto max-w-3xl text-center text-xs text-slate-500">
        RedFlag AI does not provide legal advice. Analysis results are AI-generated and may contain
        errors. Always consult a qualified legal professional before making decisions based on
        contract analysis. By using this service, you acknowledge that results are for informational
        purposes only.
      </p>
      <p className="mx-auto mt-2 max-w-3xl text-center text-xs text-slate-600">
        <Link
          href="/privacy"
          className="cursor-pointer underline transition-colors hover:text-slate-400"
        >
          Privacy Policy
        </Link>
        {" · "}
        <Link
          href="/terms"
          className="cursor-pointer underline transition-colors hover:text-slate-400"
        >
          Terms of Service
        </Link>
      </p>
    </footer>
  );
}
