import { cn } from "@/lib/utils";

interface LegalDisclaimerProps {
  className?: string;
}

export function LegalDisclaimer({ className }: LegalDisclaimerProps) {
  return (
    <footer className={cn("border-t border-slate-200 bg-slate-100 px-4 py-6", className)}>
      <p className="mx-auto max-w-3xl text-center text-xs text-slate-500">
        RedFlag AI does not provide legal advice. Analysis results are AI-generated and may contain
        errors. Always consult a qualified legal professional before making decisions based on
        contract analysis. By using this service, you acknowledge that results are for informational
        purposes only.
      </p>
    </footer>
  );
}
