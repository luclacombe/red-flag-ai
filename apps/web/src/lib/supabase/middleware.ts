import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

/** Routes that don't require authentication */
const PUBLIC_ROUTES = ["/", "/login", "/signup", "/privacy", "/terms"];
const PUBLIC_PREFIXES = ["/auth/", "/analysis/", "/api/"];

function isPublicRoute(pathname: string): boolean {
  if (PUBLIC_ROUTES.includes(pathname)) return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // CRITICAL: Do not add any code between createServerClient and getUser().
  // The session refresh must happen immediately.
  let user: import("@supabase/supabase-js").User | null = null;
  try {
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch {
    // Session refresh can fail for several reasons:
    // - AbortError: @supabase/ssr cookie locking when concurrent requests
    //   hit middleware (prefetches, parallel RSC). Safe to ignore.
    // - TypeError (fetch failed): Supabase unreachable (outage, project
    //   paused on free tier, network issues). Must not block page load.
    // In all cases, continue without auth state — public routes still work,
    // protected routes redirect to login as a safe fallback.
    return response;
  }

  if (!user && !isPublicRoute(request.nextUrl.pathname)) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  // Redirect authenticated users away from auth pages to dashboard
  const AUTH_PAGES = ["/login", "/signup"];
  if (user && AUTH_PAGES.includes(request.nextUrl.pathname)) {
    const dashboardUrl = new URL("/dashboard", request.url);
    return NextResponse.redirect(dashboardUrl);
  }

  return response;
}
