"use client";

import { BackgroundPaths } from "./background-paths";
import { TextShimmer } from "./text-shimmer";

export function HeroSection() {
  return (
    <section className="relative flex min-h-[60vh] items-center justify-center overflow-hidden bg-slate-900 px-4 py-16 md:py-24">
      <BackgroundPaths />

      <div className="relative z-10 mx-auto max-w-3xl text-center">
        <h1 className="font-heading text-4xl font-bold leading-[1.1] text-white md:text-5xl">
          Find the risks in your contract before you sign
        </h1>

        <div className="mt-6">
          <TextShimmer className="text-lg md:text-xl" duration={3}>
            AI-powered clause-by-clause analysis with risk scores and safer alternatives
          </TextShimmer>
        </div>

        <a
          href="#upload"
          className="mt-8 inline-flex cursor-pointer items-center rounded-lg bg-amber-500 px-6 py-3 text-sm font-semibold text-slate-900 transition-colors duration-150 hover:bg-amber-600"
        >
          Upload your contract
          <span className="ml-2" aria-hidden="true">
            &#8595;
          </span>
        </a>
      </div>
    </section>
  );
}
