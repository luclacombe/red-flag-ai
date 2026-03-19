"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BackgroundPaths } from "@/components/background-paths";
import { createClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);

    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    setSuccess(true);
    setLoading(false);

    // Redirect to dashboard after a short delay
    setTimeout(() => {
      router.push("/dashboard");
      router.refresh();
    }, 2000);
  }

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-[#0B1120] px-4">
      <BackgroundPaths variant="auth" />
      <Link
        href="/"
        className="relative z-10 mb-6 flex items-center gap-2 font-heading text-2xl font-bold text-white transition-colors hover:text-slate-200"
      >
        <img src="/logo.svg" alt="" className="size-6" />
        RedFlag AI
      </Link>
      <div className="relative z-10 w-full max-w-sm rounded-2xl border border-white/10 bg-white/5 p-8 shadow-2xl backdrop-blur-xl">
        {success ? (
          <>
            <h1 className="font-heading text-xl font-semibold text-white">Password updated</h1>
            <p className="mt-2 text-sm text-slate-300">
              Your password has been changed. Redirecting to your dashboard...
            </p>
          </>
        ) : (
          <>
            <h1 className="font-heading text-xl font-semibold text-white">Set new password</h1>
            <p className="mt-2 text-sm text-slate-400">Enter your new password below.</p>

            <form onSubmit={handleReset} className="mt-6 space-y-4">
              <div>
                <label htmlFor="password" className="block text-sm font-medium text-slate-300">
                  New password
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  className="mt-1 block w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-slate-500 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder="Minimum 8 characters"
                />
              </div>
              <div>
                <label
                  htmlFor="confirmPassword"
                  className="block text-sm font-medium text-slate-300"
                >
                  Confirm password
                </label>
                <input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  minLength={8}
                  className="mt-1 block w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-slate-500 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder="Re-enter your password"
                />
              </div>

              {error && (
                <p className="text-sm text-red-400" role="alert">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full cursor-pointer rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-semibold text-slate-900 transition-all hover:bg-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 focus:ring-offset-[#0B1120] disabled:opacity-50"
              >
                {loading ? "Updating..." : "Update password"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
