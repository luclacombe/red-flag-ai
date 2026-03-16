import { appRouter, createTRPCContext } from "@redflag/api";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";

export const runtime = "nodejs";
export const maxDuration = 300;

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: () => createTRPCContext({ req }),
  });

export { handler as GET, handler as POST };
