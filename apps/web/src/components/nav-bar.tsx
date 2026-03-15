import { cn } from "@/lib/utils";

interface NavBarProps {
  className?: string;
}

export function NavBar({ className }: NavBarProps) {
  return (
    <nav className={cn("w-full bg-slate-900 px-4 py-4 md:px-6", className)}>
      <div className="mx-auto flex max-w-5xl items-center justify-between">
        <span className="font-heading text-lg font-semibold text-white">RedFlag AI</span>
        <a
          href="#how-it-works"
          className="text-sm font-medium text-slate-300 transition-colors duration-150 hover:text-white"
        >
          How it works
        </a>
      </div>
    </nav>
  );
}
