import { FileText, ScanSearch, ShieldCheck } from "lucide-react";

const steps = [
  {
    number: 1,
    icon: FileText,
    title: "Upload your PDF",
    description:
      "Drop or select any contract — lease, NDA, freelance agreement, or employment contract.",
  },
  {
    number: 2,
    icon: ScanSearch,
    title: "AI scans each clause",
    description: "Every clause is analyzed against a knowledge base of known predatory patterns.",
  },
  {
    number: 3,
    icon: ShieldCheck,
    title: "Get results with rewrites",
    description:
      "Risk scores, plain-English explanations, and safer alternative language for flagged clauses.",
  },
] as const;

export function HowItWorks() {
  return (
    <section id="how-it-works" className="bg-white px-4 py-12 md:py-16">
      <div className="mx-auto max-w-3xl">
        <h2 className="text-center font-heading text-xl font-semibold text-slate-900 md:text-2xl">
          How it works
        </h2>

        <div className="mt-10 grid grid-cols-1 gap-10 md:grid-cols-3 md:gap-8">
          {steps.map((step) => {
            const Icon = step.icon;
            return (
              <div key={step.number} className="flex flex-col items-center text-center">
                <div className="flex size-12 items-center justify-center rounded-full bg-slate-100">
                  <Icon className="size-6 text-slate-700" strokeWidth={1.5} />
                </div>
                <span className="mt-4 text-xs font-semibold uppercase tracking-wide text-amber-600">
                  Step {step.number}
                </span>
                <h3 className="mt-2 font-heading text-base font-semibold text-slate-900">
                  {step.title}
                </h3>
                <p className="mt-1 text-sm leading-relaxed text-slate-500">{step.description}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
