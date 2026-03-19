"use client";

import { FileText, ScanSearch, ShieldCheck } from "lucide-react";
import { ScrollReveal } from "./scroll-reveal";

const steps = [
  {
    number: 1,
    icon: FileText,
    title: "Upload your contract",
    description:
      "Drop any contract: lease, NDA, or freelance agreement. Your file is protected the moment it arrives.",
  },
  {
    number: 2,
    icon: ScanSearch,
    title: "AI scans each clause",
    description:
      "Every clause is analyzed against known predatory patterns. Nothing is stored for training.",
  },
  {
    number: 3,
    icon: ShieldCheck,
    title: "Get results with rewrites",
    description:
      "Risk scores, plain-language explanations, and safer alternatives. All results encrypted and auto-deleted after 30 days.",
  },
] as const;

export function HowItWorks() {
  return (
    <section id="how-it-works" className="border-t border-white/5 px-4 py-16 md:py-20">
      <div className="mx-auto max-w-3xl">
        <ScrollReveal>
          <h2 className="text-center font-heading text-xl font-semibold text-white md:text-2xl">
            How it works
          </h2>
        </ScrollReveal>

        <div className="mt-12 grid grid-cols-1 gap-10 md:grid-cols-3 md:gap-8">
          {steps.map((step, i) => {
            const Icon = step.icon;
            return (
              <ScrollReveal key={step.number} delay={0.1 * i}>
                <div className="flex flex-col items-center text-center">
                  <div className="flex size-12 items-center justify-center rounded-full border border-slate-700 bg-slate-800/50">
                    <Icon className="size-5 text-slate-300" strokeWidth={1.5} />
                  </div>
                  <span className="mt-4 text-xs font-semibold uppercase tracking-wide text-amber-500">
                    Step {step.number}
                  </span>
                  <h3 className="mt-2 font-heading text-base font-semibold text-white">
                    {step.title}
                  </h3>
                  <p className="mt-1 text-sm leading-relaxed text-slate-400">{step.description}</p>
                </div>
              </ScrollReveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
