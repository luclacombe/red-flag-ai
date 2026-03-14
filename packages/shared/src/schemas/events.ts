import { z } from "zod";
import { ClauseAnalysisSchema } from "./clause.js";
import { SummarySchema } from "./summary.js";

export const StatusEventSchema = z.object({
  type: z.literal("status"),
  message: z.string(),
});

export const ClauseEventSchema = z.object({
  type: z.literal("clause_analysis"),
  data: ClauseAnalysisSchema,
});

export const SummaryEventSchema = z.object({
  type: z.literal("summary"),
  data: SummarySchema,
});

export const ErrorEventSchema = z.object({
  type: z.literal("error"),
  message: z.string(),
  recoverable: z.boolean(),
});

export const SSEEventSchema = z.discriminatedUnion("type", [
  StatusEventSchema,
  ClauseEventSchema,
  SummaryEventSchema,
  ErrorEventSchema,
]);

export type StatusEvent = z.infer<typeof StatusEventSchema>;
export type ClauseEvent = z.infer<typeof ClauseEventSchema>;
export type SummaryEvent = z.infer<typeof SummaryEventSchema>;
export type ErrorEvent = z.infer<typeof ErrorEventSchema>;
export type SSEEvent = z.infer<typeof SSEEventSchema>;
