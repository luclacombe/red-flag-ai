"use client";

import type { User } from "@supabase/supabase-js";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

interface NavBarProps {
  /** Hide "How it works" link (e.g. on analysis page where the section doesn't exist) */
  hideHowItWorks?: boolean;
  className?: string;
}

export function NavBar({ hideHowItWorks = false, className }: NavBarProps) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();

    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <nav className={cn("w-full bg-slate-900 px-4 py-4 md:px-6", className)}>
      <div className="mx-auto flex max-w-5xl items-center justify-between">
        <Link
          href="/"
          className="font-heading text-lg font-semibold text-white transition-colors duration-150 hover:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 focus:ring-offset-slate-900"
        >
          RedFlag AI
        </Link>
        <div className="flex items-center gap-4">
          {!hideHowItWorks && (
            <a
              href="#how-it-works"
              className="text-sm font-medium text-slate-300 transition-colors duration-150 hover:text-white focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 focus:ring-offset-slate-900"
            >
              How it works
            </a>
          )}
          {!loading && (
            <>
              {user ? (
                <div className="flex items-center gap-3">
                  <span className="hidden text-sm text-slate-400 sm:inline">{user.email}</span>
                  <button
                    type="button"
                    onClick={handleSignOut}
                    className="rounded-md border border-slate-600 px-3 py-1.5 text-sm font-medium text-slate-300 transition-colors duration-150 hover:border-slate-500 hover:text-white focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 focus:ring-offset-slate-900"
                  >
                    Sign out
                  </button>
                </div>
              ) : (
                <Link
                  href="/login"
                  className="rounded-md border border-slate-600 px-3 py-1.5 text-sm font-medium text-slate-300 transition-colors duration-150 hover:border-slate-500 hover:text-white focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 focus:ring-offset-slate-900"
                >
                  Sign in
                </Link>
              )}
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
