import { HeroSection } from "@/components/hero-section";
import { HowItWorks } from "@/components/how-it-works";
import { LegalDisclaimer } from "@/components/legal-disclaimer";
import { NavBar } from "@/components/nav-bar";
import { ScrollReveal } from "@/components/scroll-reveal";
import { SecuritySection } from "@/components/security-section";
import { UploadZone } from "@/components/upload-zone";

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col bg-[#0B1120]">
      <NavBar />
      <HeroSection />

      {/* Upload section — same dark bg, no harsh transition */}
      <section id="upload" className="relative px-4 py-12 md:py-16">
        <ScrollReveal>
          <div className="mx-auto max-w-xl">
            <h2 className="text-center font-heading text-xl font-semibold text-white md:text-2xl">
              Analyze your contract
            </h2>
            <div className="mt-8">
              <UploadZone />
            </div>
          </div>
        </ScrollReveal>
      </section>

      <HowItWorks />
      <SecuritySection />

      <div className="mt-auto">
        <ScrollReveal>
          <LegalDisclaimer />
        </ScrollReveal>
      </div>
    </div>
  );
}
