"use client";

import { BackgroundPaths } from "./background-paths";
import { SlidingWords } from "./sliding-words";

// Order chosen for maximum variety — alternates between short/long,
// avoids consecutive "contracts"/"agreements", keeps "NDAs" as a breather.
const CONTRACT_TYPES = [
  "lease agreements",
  "freelance contracts",
  "NDAs",
  "rental leases",
  "service agreements",
];

export function HeroSection() {
  function handleScrollToUpload() {
    document.getElementById("upload")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  return (
    <section className="relative flex min-h-[70vh] items-center justify-center px-4 py-20 md:py-28">
      <BackgroundPaths />

      {/* Bottom fade — blends hero into page seamlessly */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-[#0B1120] to-transparent" />

      <div className="relative z-10 mx-auto max-w-4xl text-center">
        <h1 className="font-heading text-4xl font-bold tracking-tight text-white md:text-6xl lg:text-7xl">
          <span className="leading-[1.08]">Find the red flags in your</span>
          <SlidingWords
            words={CONTRACT_TYPES}
            interval={2500}
            className="inline-block bg-gradient-to-r from-amber-400 to-amber-500 bg-clip-text text-transparent"
          />
        </h1>

        <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-slate-400 md:text-xl">
          Secure, AI-powered clause-by-clause analysis with risk scores and safer alternatives
        </p>

        <button
          type="button"
          onClick={handleScrollToUpload}
          className="mt-10 inline-flex cursor-pointer items-center gap-2 rounded-xl bg-amber-500 px-7 py-3.5 text-sm font-semibold text-slate-900 shadow-lg shadow-amber-500/20 transition-all duration-200 hover:-translate-y-0.5 hover:bg-amber-400 hover:shadow-xl hover:shadow-amber-500/30 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 focus:ring-offset-[#0B1120]"
        >
          Upload your contract
          <span aria-hidden="true">&#8595;</span>
        </button>
      </div>
    </section>
  );
}
