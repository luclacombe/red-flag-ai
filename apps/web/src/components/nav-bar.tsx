"use client";

import type { User } from "@supabase/supabase-js";
import { ChevronDown, LayoutDashboard, LogOut, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "./confirm-dialog";

interface NavBarProps {
  /** Hide "How it works" link (e.g. on analysis page where the section doesn't exist) */
  hideHowItWorks?: boolean;
  className?: string;
}

export function NavBar({ hideHowItWorks = false, className }: NavBarProps) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showDeleteAccount, setShowDeleteAccount] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  // Close menu on Escape
  useEffect(() => {
    if (!menuOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [menuOpen]);

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    setMenuOpen(false);
    router.push("/");
    router.refresh();
  }

  const handleDeleteAccount = useCallback(async () => {
    setDeletingAccount(true);
    try {
      const response = await fetch("/api/account/delete", { method: "DELETE" });
      if (!response.ok) throw new Error("Failed to delete account");

      const supabase = createClient();
      await supabase.auth.signOut();
      setShowDeleteAccount(false);
      setMenuOpen(false);
      router.push("/");
      router.refresh();
    } catch {
      // Keep dialog open on error
    } finally {
      setDeletingAccount(false);
    }
  }, [router]);

  return (
    <>
      <nav className={cn("w-full bg-transparent px-4 py-4 md:px-6", className)}>
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-2 font-heading text-lg font-semibold text-white transition-colors duration-150 hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
          >
            <img src="/logo.svg" alt="" className="size-5" />
            RedFlag AI
          </Link>
          <div className="flex items-center gap-4">
            {!hideHowItWorks && (
              <button
                type="button"
                onClick={() =>
                  document.getElementById("how-it-works")?.scrollIntoView({ behavior: "smooth" })
                }
                className="cursor-pointer text-sm font-medium text-slate-300 transition-colors duration-150 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
              >
                How it works
              </button>
            )}
            {!loading &&
              (user ? (
                <div ref={menuRef} className="relative">
                  <button
                    type="button"
                    onClick={() => setMenuOpen((prev) => !prev)}
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-600 px-3 py-1.5 text-sm font-medium text-slate-300 transition-colors duration-150 hover:border-slate-500 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
                    aria-expanded={menuOpen}
                    aria-haspopup="true"
                  >
                    <span className="hidden max-w-[160px] truncate sm:inline">{user.email}</span>
                    <span className="sm:hidden">Account</span>
                    <ChevronDown
                      className={cn(
                        "size-3.5 transition-transform duration-150",
                        menuOpen && "rotate-180",
                      )}
                    />
                  </button>

                  {menuOpen && (
                    <div className="absolute right-0 z-50 mt-2 w-56 origin-top-right overflow-hidden rounded-xl border border-white/10 bg-[#131B2E] shadow-2xl animate-[fade-slide-in_150ms_ease-out_both]">
                      <Link
                        href="/dashboard"
                        onClick={() => setMenuOpen(false)}
                        className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-slate-300 transition-colors duration-100 hover:bg-white/5 hover:text-white"
                      >
                        <LayoutDashboard className="size-4" />
                        Dashboard
                      </Link>
                      <div className="border-t border-white/5" />
                      <button
                        type="button"
                        onClick={handleSignOut}
                        className="flex w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-sm text-slate-300 transition-colors duration-100 hover:bg-white/5 hover:text-white"
                      >
                        <LogOut className="size-4" />
                        Sign out
                      </button>
                      <div className="border-t border-white/5" />
                      <button
                        type="button"
                        onClick={() => {
                          setMenuOpen(false);
                          setShowDeleteAccount(true);
                        }}
                        className="flex w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-sm text-red-400 transition-colors duration-100 hover:bg-red-500/10"
                      >
                        <Trash2 className="size-4" />
                        Delete account
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <Link
                  href="/login"
                  className="rounded-md border border-slate-600 px-3 py-1.5 text-sm font-medium text-slate-300 transition-colors duration-150 hover:border-slate-500 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
                >
                  Sign in
                </Link>
              ))}
          </div>
        </div>
      </nav>

      {/* Account deletion confirmation */}
      <ConfirmDialog
        open={showDeleteAccount}
        onClose={() => setShowDeleteAccount(false)}
        onConfirm={handleDeleteAccount}
        title="Delete account"
        description="This will permanently delete your account and all analyses. This cannot be undone."
        confirmLabel="Delete my account"
        loading={deletingAccount}
        variant="destructive"
      />
    </>
  );
}
