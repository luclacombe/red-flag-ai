import { z } from "zod";

// What Claude returns: verbatim clause text + document order position
export const ParsedClauseSchema = z.object({
  text: z.string().min(1),
  position: z.number().int().nonnegative(),
});

export type ParsedClause = z.infer<typeof ParsedClauseSchema>;

// Wrapper for Claude's JSON response
export const ParseClausesResponseSchema = z.object({
  clauses: z.array(ParsedClauseSchema),
});

// After orchestrator computes positions via indexOf
// Allows -1 sentinel when clause text not found in document
export const PositionedClauseSchema = ParsedClauseSchema.extend({
  startIndex: z.number().int().min(-1),
  endIndex: z.number().int().min(-1),
});

export type PositionedClause = z.infer<typeof PositionedClauseSchema>;
