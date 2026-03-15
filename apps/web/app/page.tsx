import { HeroSection } from "@/components/hero-section";
import { HowItWorks } from "@/components/how-it-works";
import { LegalDisclaimer } from "@/components/legal-disclaimer";
import { NavBar } from "@/components/nav-bar";
import { UploadZone } from "@/components/upload-zone";

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col">
      <NavBar />
      <HeroSection />

      {/* Upload section */}
      <section id="upload" className="bg-slate-50 px-4 py-12 md:py-16">
        <div className="mx-auto max-w-xl">
          <h2 className="text-center font-heading text-xl font-semibold text-slate-900 md:text-2xl">
            Analyze your contract
          </h2>
          <div className="mt-8">
            <UploadZone />
          </div>
        </div>
      </section>

      <HowItWorks />

      <div className="mt-auto">
        <LegalDisclaimer />
      </div>
    </div>
  );
}
