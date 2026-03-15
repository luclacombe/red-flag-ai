import Link from "next/link";
import { cn } from "@/lib/utils";

interface NavBarProps {
  /** Hide "How it works" link (e.g. on analysis page where the section doesn't exist) */
  hideHowItWorks?: boolean;
  className?: string;
}

export function NavBar({ hideHowItWorks = false, className }: NavBarProps) {
  return (
    <nav className={cn("w-full bg-slate-900 px-4 py-4 md:px-6", className)}>
      <div className="mx-auto flex max-w-5xl items-center justify-between">
        <Link
          href="/"
          className="font-heading text-lg font-semibold text-white transition-colors duration-150 hover:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 focus:ring-offset-slate-900"
        >
          RedFlag AI
        </Link>
        {!hideHowItWorks && (
          <a
            href="#how-it-works"
            className="text-sm font-medium text-slate-300 transition-colors duration-150 hover:text-white focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 focus:ring-offset-slate-900"
          >
            How it works
          </a>
        )}
      </div>
    </nav>
  );
}
