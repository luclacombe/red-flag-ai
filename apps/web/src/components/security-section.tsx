"use client";

import type { LucideIcon } from "lucide-react";
import { EyeOff, Fingerprint, Github, Globe, Lock, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollReveal } from "./scroll-reveal";

interface SecurityFeature {
  icon: LucideIcon;
  title: string;
  description: string;
  href?: string;
}

const features: SecurityFeature[] = [
  {
    icon: Lock,
    title: "AES-256 Encryption",
    description:
      "Every document is encrypted at rest with AES-256-GCM. Each document gets its own derived encryption key, so compromising one never compromises another.",
  },
  {
    icon: EyeOff,
    title: "Never Shared or Sold",
    description:
      "Your contracts are analyzed in real-time, never stored for AI training or shared with third parties.",
  },
  {
    icon: Github,
    title: "Open Source",
    description:
      "Our codebase is publicly available on GitHub. Inspect the code, verify our claims, and contribute.",
    href: "https://github.com/luclacombe/red-flag-ai",
  },
  {
    icon: Globe,
    title: "EU Data Center",
    description: "All data stored in EU-West-1 (Ireland). GDPR-compliant infrastructure by design.",
  },
  {
    icon: Fingerprint,
    title: "Anonymous Analysis",
    description: "IP addresses are one-way hashed. No tracking, no profiling, no reversibility.",
  },
  {
    icon: Trash2,
    title: "Auto-Delete in 30 Days",
    description:
      "Documents are automatically purged after 30 days. No indefinite storage, no forgotten files.",
  },
];

export function SecuritySection() {
  return (
    <section className="border-t border-white/5 px-4 py-16 md:py-20">
      <div className="mx-auto max-w-4xl">
        <ScrollReveal>
          <div className="text-center">
            <h2 className="font-heading text-xl font-semibold text-white md:text-2xl">
              Your documents are protected
            </h2>
            <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-slate-400 md:text-base">
              Security isn&apos;t an afterthought. Every layer of RedFlag AI is built to keep your
              sensitive contracts private.
            </p>
          </div>
        </ScrollReveal>

        <div className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {features.map((feature, i) => {
            const Icon = feature.icon;
            const card = (
              <div
                className={cn(
                  "group flex h-full flex-col rounded-xl border border-white/[0.08] bg-white/[0.03] p-6",
                  "transition-all duration-300 hover:border-white/[0.14] hover:bg-white/[0.05]",
                )}
              >
                <Icon
                  className={cn(
                    "size-8 transition-colors duration-300",
                    i === 0
                      ? "text-amber-500 group-hover:text-amber-400"
                      : "text-slate-400 group-hover:text-slate-300",
                  )}
                  strokeWidth={1.5}
                />
                <h3 className="mt-4 font-heading text-base font-semibold text-white">
                  {feature.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">{feature.description}</p>
              </div>
            );

            return (
              <ScrollReveal key={feature.title} delay={0.08 * i} className="h-full">
                {feature.href ? (
                  <a
                    href={feature.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block h-full"
                  >
                    {card}
                  </a>
                ) : (
                  card
                )}
              </ScrollReveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
