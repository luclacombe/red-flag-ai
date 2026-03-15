import { logger, type ParsedClause } from "@redflag/shared";
import { getAnthropicClient, MODELS } from "./client";
import {
  BOUNDARY_DETECT_SYSTEM_PROMPT,
  buildBoundaryDetectUserMessage,
} from "./prompts/boundary-detect";

/** Minimum clause length — shorter fragments get merged into the previous clause */
const MIN_CLAUSE_LENGTH = 50;

/** Minimum anchor length to attempt matching — shorter anchors are too ambiguous */
const MIN_ANCHOR_LENGTH = 15;

/** Tool definition for boundary detection — strict: true guarantees valid JSON */
const REPORT_BOUNDARIES_TOOL = {
  name: "report_boundaries" as const,
  description:
    "Report the first few words of each clause or section in the document, copied verbatim",
  strict: true,
  input_schema: {
    type: "object" as const,
    properties: {
      clauseAnchors: {
        type: "array" as const,
        items: {
          type: "object" as const,
          properties: {
            anchor: {
              type: "string" as const,
              description: "The first 5-15 words of the clause, copied EXACTLY from the document",
            },
          },
          required: ["anchor"] as string[],
          additionalProperties: false as const,
        },
        description: "List of clause start anchors in document order",
      },
    },
    required: ["clauseAnchors"] as string[],
    additionalProperties: false as const,
  },
};

/**
 * Normalize whitespace for fuzzy anchor matching.
 * Collapses all runs of whitespace (spaces, tabs, newlines) to a single space, then trims.
 */
function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Build a normalized version of text with a position map back to the original.
 * Collapses all whitespace runs to single spaces and tracks where each
 * normalized character came from in the original text.
 *
 * @returns { normalized: string, posMap: number[] } where posMap[i] is the
 *          original text index that produced normalized[i]
 */
function buildNormalizedMap(text: string): { normalized: string; posMap: number[] } {
  const chars: string[] = [];
  const posMap: number[] = [];
  let inWhitespace = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (/\s/.test(ch)) {
      if (!inWhitespace && chars.length > 0) {
        chars.push(" ");
        posMap.push(i);
      }
      inWhitespace = true;
    } else {
      chars.push(ch);
      posMap.push(i);
      inWhitespace = false;
    }
  }

  return { normalized: chars.join(""), posMap };
}

/**
 * Find the position of an anchor in the document text.
 * Tries exact match first, then normalized whitespace match.
 *
 * @param text - Full document text
 * @param anchor - Anchor string to find
 * @param searchFrom - Start searching from this position (forward-only)
 * @returns Character index in the original text, or -1 if not found
 */
export function findAnchorPosition(text: string, anchor: string, searchFrom: number): number {
  // 1. Exact match
  const exactIdx = text.indexOf(anchor, searchFrom);
  if (exactIdx !== -1) return exactIdx;

  // 2. Normalized whitespace match with position mapping
  const normalizedAnchor = normalizeWhitespace(anchor);
  if (normalizedAnchor.length < MIN_ANCHOR_LENGTH) return -1;

  const slice = text.slice(searchFrom);
  const { normalized, posMap } = buildNormalizedMap(slice);
  const normIdx = normalized.indexOf(normalizedAnchor);
  if (normIdx !== -1) {
    // Map back to original text position via the position map
    const originalOffset = posMap[normIdx];
    if (originalOffset != null) return searchFrom + originalOffset;
  }

  // 3. Prefix match — try first 30 normalized chars if full anchor wasn't found
  if (normalizedAnchor.length > 30) {
    const prefix = normalizedAnchor.slice(0, 30);
    const prefixIdx = normalized.indexOf(prefix);
    if (prefixIdx !== -1) {
      const originalOffset = posMap[prefixIdx];
      if (originalOffset != null) return searchFrom + originalOffset;
    }
  }

  return -1;
}

/**
 * Split document into clauses at positions found by anchor matching.
 *
 * @param text - Full document text
 * @param anchors - Anchor strings (first few words of each clause)
 * @returns ParsedClause[] with text and zero-based positions
 */
export function splitAtAnchors(text: string, anchors: string[]): ParsedClause[] {
  if (anchors.length === 0) return [];

  // Find positions for each anchor (forward-searching to handle duplicates)
  const positions: number[] = [];
  let searchFrom = 0;

  for (const anchor of anchors) {
    if (anchor.length < MIN_ANCHOR_LENGTH) {
      logger.warn("Anchor too short, skipping", { anchor, minLength: MIN_ANCHOR_LENGTH });
      continue;
    }

    const pos = findAnchorPosition(text, anchor, searchFrom);
    if (pos === -1) {
      logger.warn("Anchor not found in document, skipping", {
        anchor: anchor.slice(0, 50),
        searchFrom,
      });
      continue;
    }

    positions.push(pos);
    searchFrom = pos + 1; // Move past this position for forward-searching
  }

  if (positions.length === 0) return [];

  // Sort positions (should already be in order, but safety first)
  positions.sort((a, b) => a - b);

  // Split document at found positions
  const rawClauses: string[] = [];
  for (let i = 0; i < positions.length; i++) {
    const start = positions[i]!;
    const end = positions[i + 1] ?? text.length;
    const clauseText = text.slice(start, end).trim();
    if (clauseText.length > 0) {
      rawClauses.push(clauseText);
    }
  }

  return postProcess(rawClauses.map((t, i) => ({ text: t, position: i })));
}

/**
 * Detect if a clause is just a section heading with no substantive content.
 * These should be merged into the next clause (the heading's body), not kept standalone.
 *
 * A clause is a heading if:
 * - It's shorter than HEADING_MERGE_THRESHOLD characters, AND
 * - It doesn't contain a full sentence (no period followed by a word)
 */
const HEADING_MERGE_THRESHOLD = 120;

function isHeadingOnly(text: string): boolean {
  if (text.length >= HEADING_MERGE_THRESHOLD) return false;
  // A heading has no sentence-ending punctuation (periods, etc.) in the body.
  // If the text contains a period/question mark/exclamation followed by anything
  // (even end of string), it's substantive content — not just a heading.
  const hasPunctuation = /[.!?]/.test(text);
  return !hasPunctuation;
}

/**
 * Post-process clauses:
 * 1. Merge heading-only clauses into the NEXT clause (prepend heading to body)
 * 2. Merge short fragments (< MIN_CLAUSE_LENGTH) into the previous clause
 * 3. Re-number positions sequentially (zero-based)
 */
function postProcess(clauses: ParsedClause[]): ParsedClause[] {
  if (clauses.length === 0) return [];

  // Pass 1: merge heading-only clauses into the next clause
  const withoutHeadings: ParsedClause[] = [];
  let pendingHeading: string | null = null;

  for (const clause of clauses) {
    if (isHeadingOnly(clause.text) && withoutHeadings.length < clauses.length - 1) {
      // This is a heading — save it to prepend to the next clause
      pendingHeading = pendingHeading ? `${pendingHeading}\n\n${clause.text}` : clause.text;
    } else {
      const text = pendingHeading ? `${pendingHeading}\n\n${clause.text}` : clause.text;
      withoutHeadings.push({ text, position: clause.position });
      pendingHeading = null;
    }
  }
  // If there's a trailing heading with no next clause, append to last
  if (pendingHeading && withoutHeadings.length > 0) {
    const last = withoutHeadings[withoutHeadings.length - 1]!;
    withoutHeadings[withoutHeadings.length - 1] = {
      text: `${last.text}\n\n${pendingHeading}`,
      position: last.position,
    };
  }

  // Pass 2: merge remaining short fragments into previous clause
  const first = withoutHeadings[0];
  if (!first) return [];

  const merged: ParsedClause[] = [first];

  for (let i = 1; i < withoutHeadings.length; i++) {
    const clause = withoutHeadings[i];
    if (!clause) continue;
    if (clause.text.length < MIN_CLAUSE_LENGTH) {
      const prev = merged[merged.length - 1];
      if (prev) {
        merged[merged.length - 1] = {
          text: `${prev.text}\n\n${clause.text}`,
          position: prev.position,
        };
      }
    } else {
      merged.push(clause);
    }
  }

  return merged.map((clause, i) => ({ text: clause.text, position: i }));
}

/**
 * LLM-based clause boundary detection using Haiku.
 *
 * Sends the raw document text to Haiku. Haiku returns the first ~10 words
 * of each clause, copied verbatim. We find each anchor via indexOf() and split there.
 *
 * Works regardless of PDF line structure — no dependency on \n positions.
 *
 * @throws Error if both attempts fail
 */
export async function detectClauseBoundaries(
  text: string,
  contractType: string,
  language: string,
): Promise<ParsedClause[]> {
  const client = getAnthropicClient();

  logger.info("Boundary detection starting", { textLen: text.length, contractType });
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if (attempt > 0) logger.info("Boundary detection retry", { attempt: attempt + 1 });

      const response = await client.messages.create({
        model: MODELS.haiku,
        max_tokens: 2048,
        system: BOUNDARY_DETECT_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: buildBoundaryDetectUserMessage(text, contractType, language),
          },
        ],
        tools: [REPORT_BOUNDARIES_TOOL],
        tool_choice: { type: "tool", name: "report_boundaries" },
      });

      // Extract tool call result
      const toolBlock = response.content.find((block) => block.type === "tool_use");
      if (!toolBlock || toolBlock.type !== "tool_use") {
        throw new Error("No tool_use block in boundary detection response");
      }

      const input = toolBlock.input as { clauseAnchors: { anchor: string }[] };
      if (!Array.isArray(input.clauseAnchors)) {
        throw new Error("Invalid clauseAnchors in boundary detection response");
      }

      const anchors = input.clauseAnchors.map((a) => a.anchor);

      logger.info("Boundary detection result", {
        anchorCount: anchors.length,
        anchors: anchors.map((a) => a.slice(0, 40)),
      });

      const clauses = splitAtAnchors(text, anchors);

      if (clauses.length === 0) {
        throw new Error("Boundary detection produced zero clauses after splitting");
      }

      return clauses;
    } catch (error) {
      logger.error("Boundary detection attempt failed", {
        step: "boundary_detect",
        attempt: attempt + 1,
        error: error instanceof Error ? error.message : String(error),
        retried: attempt === 0,
      });
      lastError = error;
      if (attempt === 0) continue;
    }
  }

  const message = lastError instanceof Error ? lastError.message : "Unknown error";
  throw new Error(`Boundary detection failed after 2 attempts: ${message}`);
}
