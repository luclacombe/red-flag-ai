import { createServerClient, parseCookieHeader } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";

export interface TRPCContext {
  user: User | null;
}

export const createTRPCContext = async (opts?: { req?: Request }): Promise<TRPCContext> => {
  if (!opts?.req) {
    return { user: null };
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return { user: null };
  }

  const cookieHeader = opts.req.headers.get("cookie") ?? "";

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll: () =>
        parseCookieHeader(cookieHeader).map((c) => ({
          name: c.name,
          value: c.value ?? "",
        })),
      setAll: () => {
        // Response cookies are handled by the middleware, not tRPC context
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { user };
};

const t = initTRPC.context<TRPCContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;
export const createCallerFactory = t.createCallerFactory;

/** Procedure that requires an authenticated user. Throws UNAUTHORIZED if not logged in. */
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in to continue." });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});
