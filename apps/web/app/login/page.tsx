"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { BackgroundPaths } from "@/components/background-paths";
import { createClient } from "@/lib/supabase/client";

type Mode = "signin" | "signup";

export default function AuthPage() {
  return (
    <Suspense>
      <AuthPageInner />
    </Suspense>
  );
}

function AuthPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialMode = searchParams.get("mode") === "signup" ? "signup" : "signin";

  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [signupSuccess, setSignupSuccess] = useState(false);

  function switchMode(newMode: Mode) {
    setError(null);
    setMode(newMode);
  }

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    // If email confirmations are disabled (local dev), the session is
    // immediately active: redirect to dashboard instead of showing "check email"
    if (data.session) {
      router.push("/dashboard");
      return;
    }

    setSignupSuccess(true);
    setLoading(false);
  }

  async function handleMagicLink() {
    setError(null);
    if (!email) {
      setError("Enter your email address first.");
      return;
    }
    setLoading(true);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    setMagicLinkSent(true);
    setLoading(false);
  }

  // Confirmation sub-states (magic link sent / signup success)
  if (magicLinkSent || signupSuccess) {
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
          <h1 className="font-heading text-xl font-semibold text-white">Check your email</h1>
          <p className="mt-2 text-sm text-slate-300">
            {magicLinkSent ? (
              <>
                We sent a magic link to <strong className="text-white">{email}</strong>. Click the
                link in the email to sign in.
              </>
            ) : (
              <>
                We sent a confirmation link to <strong className="text-white">{email}</strong>.
                Click it to activate your account.
              </>
            )}
          </p>
          <button
            type="button"
            onClick={() => {
              setMagicLinkSent(false);
              setSignupSuccess(false);
            }}
            className="mt-6 cursor-pointer text-sm font-medium text-blue-400 hover:text-blue-300"
          >
            Back to sign in
          </button>
        </div>
      </div>
    );
  }

  const isSignIn = mode === "signin";

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
        <h1 className="font-heading text-xl font-semibold text-white">
          {isSignIn ? "Sign in" : "Create account"}
        </h1>

        <form onSubmit={isSignIn ? handleSignIn : handleSignUp} className="mt-6 space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-slate-300">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="mt-1 block w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-slate-500 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-slate-300">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={isSignIn ? undefined : 6}
              className="mt-1 block w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-slate-500 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder={isSignIn ? "Your password" : "Minimum 6 characters"}
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
            {loading
              ? isSignIn
                ? "Signing in..."
                : "Creating account..."
              : isSignIn
                ? "Sign in"
                : "Create account"}
          </button>
        </form>

        {/* Magic link — sign in mode only */}
        {isSignIn && (
          <>
            <div className="my-5 flex items-center gap-3">
              <div className="h-px flex-1 bg-white/10" />
              <span className="text-xs text-slate-500">or</span>
              <div className="h-px flex-1 bg-white/10" />
            </div>

            <button
              type="button"
              onClick={handleMagicLink}
              disabled={loading}
              className="w-full cursor-pointer rounded-lg border border-white/10 px-4 py-2.5 text-sm font-medium text-slate-300 transition-all hover:border-white/20 hover:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#0B1120] disabled:opacity-50"
            >
              Sign in with magic link
            </button>
          </>
        )}

        <p className="mt-6 text-center text-sm text-slate-500">
          {isSignIn ? (
            <>
              Don&apos;t have an account?{" "}
              <button
                type="button"
                onClick={() => switchMode("signup")}
                className="cursor-pointer font-medium text-blue-400 hover:text-blue-300"
              >
                Create account
              </button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button
                type="button"
                onClick={() => switchMode("signin")}
                className="cursor-pointer font-medium text-blue-400 hover:text-blue-300"
              >
                Sign in
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
