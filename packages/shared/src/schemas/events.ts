import { z } from "zod";
import { ClauseAnalysisSchema } from "./clause";
import { PositionedClauseSchema } from "./parse";
import { SummarySchema } from "./summary";

export const StatusEventSchema = z.object({
  type: z.literal("status"),
  message: z.string(),
});

export const ClausePositionsEventSchema = z.object({
  type: z.literal("clause_positions"),
  data: z.object({
    totalClauses: z.number().int().nonnegative(),
    clauses: z.array(PositionedClauseSchema),
  }),
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

export const FileTypeSchema = z.enum(["pdf", "docx", "txt"]);
export type FileType = z.infer<typeof FileTypeSchema>;

export const DocumentTextEventSchema = z.object({
  type: z.literal("document_text"),
  data: z.object({
    text: z.string(),
    fileType: FileTypeSchema,
  }),
});

export const ClauseAnalyzingEventSchema = z.object({
  type: z.literal("clause_analyzing"),
  data: z.object({
    position: z.number().int().nonnegative(),
  }),
});

export const SSEEventSchema = z.discriminatedUnion("type", [
  StatusEventSchema,
  ClausePositionsEventSchema,
  DocumentTextEventSchema,
  ClauseAnalyzingEventSchema,
  ClauseEventSchema,
  SummaryEventSchema,
  ErrorEventSchema,
]);

export type StatusEvent = z.infer<typeof StatusEventSchema>;
export type ClausePositionsEvent = z.infer<typeof ClausePositionsEventSchema>;
export type DocumentTextEvent = z.infer<typeof DocumentTextEventSchema>;
export type ClauseAnalyzingEvent = z.infer<typeof ClauseAnalyzingEventSchema>;
export type ClauseEvent = z.infer<typeof ClauseEventSchema>;
export type SummaryEvent = z.infer<typeof SummaryEventSchema>;
export type ErrorEvent = z.infer<typeof ErrorEventSchema>;
export type SSEEvent = z.infer<typeof SSEEventSchema>;
