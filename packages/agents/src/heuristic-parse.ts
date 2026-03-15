import { logger, type ParsedClause } from "@redflag/shared";

/** Minimum clause length — shorter fragments get merged into the previous clause */
const MIN_CLAUSE_LENGTH = 50;

/** If paragraph splitting produces outside this range, treat as single clause */
const MIN_PARAGRAPHS = 3;
const MAX_PARAGRAPHS = 60;

/** Characters to scan for heading pattern detection */
const DETECTION_WINDOW = 2000;

/** Clauses with median length below this are likely not real headings (e.g., party IDs) */
const MIN_MEDIAN_CLAUSE_LENGTH = 60;

/** Max length for an ALL-CAPS line to be considered a heading */
const MAX_ALLCAPS_LENGTH = 60;

/**
 * Minimum top-level matches for dotted decimal pattern.
 * Contracts with numbered parties (1. Name, 2. Name) in the preamble
 * produce exactly 2 top-level matches — requiring 3+ filters these out.
 */
const MIN_DOTTED_DECIMAL_MATCHES = 3;

/**
 * Multilingual heading keywords (case-insensitive).
 * EN: article, section, clause, part, schedule
 * NL: artikel, bepaling, lid, afdeling
 * FR: chapitre, alinéa
 * DE: abschnitt, paragraph, klausel, absatz
 */
const ARTICLE_KEYWORDS =
  "article|section|clause|part|schedule|artikel|bepaling|lid|afdeling|chapitre|alinéa|abschnitt|paragraph|klausel|absatz";

/** Signature block indicators — multiline: finds signature lines within text */
const SIGNATURE_REGEX =
  /^\s*(in witness whereof|signed\s+by|signatures?:|handtekening|ondertekening|getekend|aldus opgemaakt|fait\s+à|unterschrift|for and on behalf)/im;

/**
 * Heuristic clause splitter — replaces the 3-minute LLM-based parse agent.
 * Runs in <10ms for a 25KB document.
 *
 * Returns the same `ParsedClause[]` shape as the old `parseClauses()`:
 * `{ text: string, position: number }`.
 */
export function parseClausesHeuristic(
  text: string,
  _contractType: string,
  _language: string,
): ParsedClause[] {
  const start = performance.now();

  // Try each pattern in priority order (first valid match wins)
  const clauses =
    splitByDottedDecimal(text) ??
    splitByArticleKeywords(text) ??
    splitByAllCapsHeadings(text) ??
    splitByRomanNumerals(text) ??
    splitByParenthetical(text) ??
    splitByParagraphs(text);

  const elapsed = performance.now() - start;
  logger.info("Heuristic parse complete", {
    clauseCount: clauses.length,
    elapsedMs: Math.round(elapsed * 100) / 100,
    textLength: text.length,
  });

  return clauses;
}

// ── Pattern 1: Dotted Decimal (1., 1.1, 2.3.4) ──────────────────

function splitByDottedDecimal(text: string): ParsedClause[] | null {
  const sample = text.slice(0, DETECTION_WINDOW);
  // Quick check: "N." style headings in sample (number + mandatory dot + space)
  if (!/^\s*\d+\.\s/m.test(sample)) return null;

  // Match top-level headings: "1.", "2.", "3." (number + dot + whitespace).
  // The mandatory dot prevents false positives like "123 Main Street".
  // Sub-sections (1.1, 2.1) are NOT matched — they stay within their parent.
  const regex = /^\s*(\d+)\.\s/gm;
  const indices: number[] = [];
  for (const match of text.matchAll(regex)) {
    indices.push(match.index);
  }

  // Require 3+ to avoid party-number false positives (1. Name, 2. Name)
  if (indices.length < MIN_DOTTED_DECIMAL_MATCHES) return null;

  const result = buildClauses(text, indices);

  // Validate: if clauses are too small, these are likely not real headings
  if (!hasReasonableClauseSizes(result)) return null;

  return result;
}

// ── Pattern 2: Article Keywords ──────────────────────────────────

function splitByArticleKeywords(text: string): ParsedClause[] | null {
  const sample = text.slice(0, DETECTION_WINDOW);
  const testRegex = new RegExp(`^\\s*(?:${ARTICLE_KEYWORDS})\\s+(?:\\d+|[IVXLC]+)`, "im");
  if (!testRegex.test(sample)) return null;

  const fullRegex = new RegExp(`^\\s*(?:${ARTICLE_KEYWORDS})\\s+(?:\\d+|[IVXLC]+)`, "gim");
  const indices: number[] = [];
  for (const match of text.matchAll(fullRegex)) {
    indices.push(match.index);
  }

  if (indices.length < 2) return null;
  return buildClauses(text, indices);
}

// ── Pattern 3: ALL-CAPS Headings ─────────────────────────────────

function splitByAllCapsHeadings(text: string): ParsedClause[] | null {
  const sample = text.slice(0, DETECTION_WINDOW);
  if (!/^[A-Z][A-Z\s\d.,-]{2,}$/m.test(sample)) return null;

  const regex = /^[A-Z][A-Z\s\d.,-]{2,}$/gm;
  const indices: number[] = [];
  for (const match of text.matchAll(regex)) {
    if (match[0].trim().length <= MAX_ALLCAPS_LENGTH) {
      indices.push(match.index);
    }
  }

  if (indices.length < 2) return null;
  return buildClauses(text, indices);
}

// ── Pattern 4: Roman Numerals ────────────────────────────────────

function splitByRomanNumerals(text: string): ParsedClause[] | null {
  const sample = text.slice(0, DETECTION_WINDOW);
  if (!/^\s*[IVXLC]+\.\s/m.test(sample)) return null;

  const regex = /^\s*[IVXLC]+\.\s/gm;
  const indices: number[] = [];
  for (const match of text.matchAll(regex)) {
    indices.push(match.index);
  }

  if (indices.length < 2) return null;
  return buildClauses(text, indices);
}

// ── Pattern 5: Parenthetical ─────────────────────────────────────

function splitByParenthetical(text: string): ParsedClause[] | null {
  const sample = text.slice(0, DETECTION_WINDOW);
  if (!/^\s*\([a-z\d]+\)\s/m.test(sample)) return null;

  const regex = /^\s*\([a-z\d]+\)\s/gm;
  const indices: number[] = [];
  for (const match of text.matchAll(regex)) {
    indices.push(match.index);
  }

  if (indices.length < 2) return null;
  return buildClauses(text, indices);
}

// ── Fallback: Paragraph Splitting ────────────────────────────────

function splitByParagraphs(text: string): ParsedClause[] {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (paragraphs.length < MIN_PARAGRAPHS || paragraphs.length > MAX_PARAGRAPHS) {
    return [{ text: text.trim(), position: 0 }];
  }

  return postProcess(paragraphs.map((p, i) => ({ text: p, position: i })));
}

// ── Shared Helpers ───────────────────────────────────────────────

/**
 * Build ParsedClause[] from heading start indices.
 * Always skips content before the first heading (preamble/title).
 * Removes signature blocks from the end.
 */
function buildClauses(text: string, headingIndices: number[]): ParsedClause[] {
  const rawClauses: string[] = [];

  // Skip content before first heading — when headings are detected,
  // pre-heading content is preamble/title, not a substantive clause
  for (let i = 0; i < headingIndices.length; i++) {
    const start = headingIndices[i] ?? 0;
    const end = headingIndices[i + 1] ?? text.length;
    const clauseText = text.slice(start, end).trim();
    if (clauseText.length > 0) {
      rawClauses.push(clauseText);
    }
  }

  // Trim signature content from the end of the last clause
  if (rawClauses.length > 0) {
    const lastIdx = rawClauses.length - 1;
    const lastClause = rawClauses[lastIdx];
    if (lastClause) {
      // Search for a signature indicator on its own line within the last clause
      const sigMatch = SIGNATURE_REGEX.exec(lastClause);
      if (sigMatch?.index != null && sigMatch.index > 0) {
        const trimmed = lastClause.slice(0, sigMatch.index).trim();
        if (trimmed.length > 0) {
          rawClauses[lastIdx] = trimmed;
        }
      } else if (sigMatch?.index === 0) {
        // Entire last clause is a signature block — remove it
        rawClauses.pop();
      }
    }
  }

  return postProcess(rawClauses.map((t, i) => ({ text: t, position: i })));
}

/**
 * Check that the median clause length is reasonable.
 * Filters out false-positive headings (e.g., numbered parties in a preamble).
 */
function hasReasonableClauseSizes(clauses: ParsedClause[]): boolean {
  if (clauses.length === 0) return false;
  const lengths = clauses.map((c) => c.text.length).sort((a, b) => a - b);
  const median = lengths[Math.floor(lengths.length / 2)];
  return median != null && median >= MIN_MEDIAN_CLAUSE_LENGTH;
}

/**
 * Post-process clauses:
 * - Merge fragments shorter than MIN_CLAUSE_LENGTH into previous clause
 * - Re-number positions sequentially (zero-based)
 */
function postProcess(clauses: ParsedClause[]): ParsedClause[] {
  const first = clauses[0];
  if (!first) return [];

  const merged: ParsedClause[] = [first];

  for (let i = 1; i < clauses.length; i++) {
    const clause = clauses[i];
    if (!clause) continue;
    if (clause.text.length < MIN_CLAUSE_LENGTH) {
      // Merge into previous clause
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

  // Re-number positions sequentially
  return merged.map((clause, i) => ({ text: clause.text, position: i }));
}
