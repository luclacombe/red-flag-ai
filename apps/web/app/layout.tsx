import type { Metadata } from "next";
import { cn } from "@/lib/utils";
import { TRPCProvider } from "@/trpc/react";
import { dmSans, spaceGrotesk } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "RedFlag AI — Contract Risk Detector",
  description:
    "AI-powered clause-by-clause contract risk analysis. Upload a PDF, get instant risk scores, plain-English explanations, and safer alternatives.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn(spaceGrotesk.variable, dmSans.variable)}>
      <body className="min-h-screen font-body antialiased">
        <TRPCProvider>{children}</TRPCProvider>
      </body>
    </html>
  );
}
