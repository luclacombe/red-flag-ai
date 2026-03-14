import { analysisRouter } from "./routers/analysis";
import { healthRouter } from "./routers/health";
import { router } from "./trpc";

export const appRouter = router({
  analysis: analysisRouter,
  health: healthRouter,
});

export type AppRouter = typeof appRouter;
