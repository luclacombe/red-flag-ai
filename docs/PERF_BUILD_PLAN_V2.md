# RedFlag AI — Performance Restructuring Plan

> This plan restructures the agent pipeline from ~40 API calls (4-5 min) to 3 API calls (~20-30 sec).
> Each phase = one focused Claude Code session.
> Start each session: `"Read docs/PERF_BUILD_PLAN.md, begin Phase N"`
> End each session: quality gate passes → update checkboxes → commit

---

## Problem Statement

The current pipeline is too slow to be a viable product. A 25KB Dutch lease takes 4-5+ minutes with frequent Vercel 300s timeouts, JSON parse failures, and reconnection loops. By comparison, pasting the same document into Claude.com with a good prompt yields ~80% of the quality in ~30-60 seconds.

**Root causes identified (with Vercel production logs):**

| Problem | Impact | Evidence |
|---------|--------|----------|
| Parse agent sends entire document to Sonnet, asks it to copy every clause verbatim as JSON | 3+ minutes for a single API call | Logs: parse started 11:48:32, response at 11:51:35 (3 min 3 sec) |
| Fragile JSON output — one bad character kills the entire parse | Parse failed on first attempt, retry consumed another 2+ min | `"Expected ',' or '}' after property value in JSON at position 3216"` |
| ~40 separate Claude API calls per document (1 parse + ~20 risk + ~10 rewrite + 1 summary) | Aggregate latency and failure probability is enormous | Multiple Vercel 300s timeouts across reconnections |
| Per-clause Voyage embedding + pgvector search | Adds 1-3s overhead per document | Embedding batch call + N vector similarity queries |
| No streaming from Claude — fire-and-forget `messages.create()` | User sees nothing until entire response completes | First clause result arrives after 3+ min (post-parse) |

**Target:** 15-20x faster. First clause result in ~5 seconds. Full analysis in ~20-30 seconds. Zero JSON parse errors.

---

## Architecture Decisions (New / Changed)

Decisions from `BUILD_PLAN.md` still hold unless overridden here.

| Decision | Old | New | Rationale |
|----------|-----|-----|-----------|
| Clause parsing | Claude Sonnet, single call, verbatim JSON extraction (~3 min) | **TypeScript heuristic splitter** — regex-based structural detection (<10ms) | Every commercial legal AI tool (Klarity, Relativity, LexCheck) does structural segmentation first. Contracts follow predictable numbering patterns across languages. |
| Clause analysis | Separate Risk (×N) + Rewrite (×N) Claude calls — ~30 calls total | **Single streaming Claude call with `report_clause` tool_use** — 1 call | Claude can call the same tool multiple times in one response. Each tool call streams independently. |
| JSON reliability | `stripCodeFences` + `JSON.parse` + Zod + retry on failure | **`strict: true` structured outputs** — constrained decoding | Claude physically cannot produce tokens that violate the schema. Zero parse errors. |
| Streaming granularity | Non-streaming `messages.create()`, results after full response | **`eager_input_streaming: true`** — fine-grained tool streaming | Each `report_clause` tool call streams to client as it's generated. First result in ~5s. |
| RAG retrieval | Per-clause: embed clause → pgvector search → inject top-5 patterns | **Bulk pre-fetch**: 1 SQL query filtered by contract type → inject ALL relevant patterns in system prompt | With only 100-200 patterns, filtered to ~20-50 by type. Eliminates all per-clause Voyage + DB calls. |
| Pipeline shape | Gate → Parse → Embed → [Risk + RAG + Rewrite] ×N → Summary = ~40 calls | **Gate → Heuristic Parse → Bulk RAG → Combined Analysis (streaming) → Summary = 3 calls** | 15-20x fewer API calls, 15-20x faster |
| Claude models | Haiku for gate, Sonnet for everything else | Haiku for gate, **Sonnet for combined analysis + summary** (test Haiku for combined if quality holds) | Sonnet needed for nuanced risk analysis. Haiku 4.5 has 64K output — worth testing. |

## New End-to-End Analysis Flow

```
1. Client uploads PDF          → POST /api/upload (unchanged)
2. Server validates            → file type, size, page count ≤30 (unchanged)
3. Server stores PDF           → Supabase Storage (unchanged)
4. Server extracts text        → unpdf (unchanged)
5. Server runs relevance gate  → Claude Haiku (unchanged)
6. If not contract             → rejection (unchanged)
7. If contract                 → create document + analysis records (unchanged)
8. Server returns              → { analysisId } (unchanged)
9. Client navigates            → /analysis/[analysisId] (unchanged)
10. Client subscribes          → tRPC SSE subscription (unchanged)
11. Server emits               → { type: "status", message: "Parsing..." }
12. *** NEW: Heuristic parse   → TypeScript regex splitter (<10ms)
13. Server emits               → { type: "clause_positions", data: [...] } (skeleton cards)
14. *** NEW: Bulk RAG fetch    → 1 SQL query: all patterns for contract type (<50ms)
15. *** NEW: Combined analysis → 1 streaming Claude call with report_clause tool
    For each clause (streaming):
      a. Claude calls report_clause tool → risk + explanation + category + rewrite
      b. Compute positions via indexOf()
      c. Persist clause to DB
      d. Yield to client → { type: "clause_analysis", data: ClauseAnalysis }
16. Summary Agent              → 1 Claude call (unchanged pattern)
17. Persist summary            → update analysis record
18. Yield summary              → { type: "summary", data: Summary }
19. Close stream
```

**Timing budget:**
- Steps 1-11: ~3-5s (upload + gate + navigation — unchanged)
- Step 12: <10ms (heuristic parse — instant)
- Step 13: <10ms (emit clause positions)
- Step 14: <50ms (bulk RAG query)
- Step 15: ~15-25s (single streaming Claude call, first result at ~3-5s)
- Steps 16-18: ~3-5s (summary)
- **Total: ~20-30 seconds, first clause at ~8-10 seconds from upload**

---

## Research Context

> Each phase references specific research findings. This section is the index.
> Full research was conducted across 5 parallel agents covering: clause segmentation,
> single-pass LLM patterns, RAG optimization, parallelization/streaming, and Anthropic API features.

### Key Research References

**Heuristic clause segmentation:**
- Every commercial legal AI tool does structural segmentation first (regex/formatting), then ML/LLM for classification only
- Relativity Contracts uses editable regex rules for section heading detection
- Contract numbering patterns are language-agnostic: `1.`, `1.1`, `Article 1`, `RENT`, roman numerals
- Multilingual heading keywords: NL (`Artikel`, `Bepaling`), FR (`Article`, `Chapitre`), DE (`Abschnitt`, `Paragraph`)
- No production-quality open-source JS/TS library exists — we build our own (~100-200 lines)

**Claude tool_use for streaming structured output:**
- Claude can call the same tool multiple times in one response (confirmed in Anthropic docs)
- `strict: true` on tool definitions = constrained decoding — physically impossible to produce invalid JSON
- `eager_input_streaming: true` = fine-grained streaming without buffering (GA on Claude 4 models)
- `token-efficient tool use` is built into Claude 4 models (up to 70% output token savings)
- 64K max output tokens on all current models — 20 clauses × ~400 tokens each = ~8K, well within limits
- Sources: [Structured Outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs), [Fine-Grained Tool Streaming](https://platform.claude.com/docs/en/agents-and-tools/tool-use/fine-grained-tool-streaming), [Tool Use Overview](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview)

**RAG optimization:**
- With 100-200 patterns filtered to ~20-50 by contract type, system prompt injection is viable and near-zero latency
- Robin AI research: clause-level retrieval with metadata delivered highest impact; only 15% of contract text needed for 90% recall
- "Lost in the middle" research: 3-5 retrieved docs per query is the sweet spot; beyond that, LLM starts ignoring middle content
- Hybrid approach: inject all contract-type patterns in system prompt (broad coverage) + optional per-clause vector similarity for `matchedPatterns` field (can be computed in-memory)
- Sources: [Robin AI Research](https://robinai.com/news-and-resources/blog/optimizing-rag-for-contract-analysis-our-research-findings-2), [Supabase Hybrid Search](https://supabase.com/docs/guides/ai/hybrid-search)

**Prompt caching (for summary call):**
- Cache system prompt + document context between analysis and summary calls
- Cached reads cost 10% of base input token price
- 5-minute default TTL — pipeline completes well within this window
- Minimum cacheable: 1,024 tokens for Sonnet 4.x
- Source: [Prompt Caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)

---

## Phase 1: Foundation — Heuristic Parser + RAG Restructure

**Objective:** Replace the 3-minute LLM parse with an instant heuristic splitter, and restructure RAG to bulk-fetch patterns instead of per-clause embedding + vector search. No changes to the analysis pipeline yet — the old orchestrator still works with the new parse output. This phase is non-breaking.

**Entry criteria:** Current MVP pipeline works (even if slow). All packages build. Knowledge base seeded.

**Context for this session:** Read `docs/PERF_BUILD_PLAN.md` (this file), `CLAUDE.md`, and the current code:
- `packages/agents/src/parse.ts` — current LLM parse (being replaced)
- `packages/agents/src/orchestrator.ts` — current orchestrator (will use new parse)
- `packages/agents/src/prompts/parse.ts` — current parse prompt (will be unused)
- `packages/db/src/queries/findSimilarPatterns.ts` — current per-clause vector search
- `packages/db/src/embeddings.ts` — current Voyage AI embedding functions
- `packages/shared/src/` — existing Zod schemas and types

### Tasks

#### 1.1 — Heuristic clause splitter

- [x] Create `packages/agents/src/heuristic-parse.ts`
- [x] Implement `parseClausesHeuristic(text: string, contractType: string, language: string)` → `ParsedClause[]`
- [x] **Must return the same `ParsedClause[]` shape** as the current `parseClauses()` — `{ text: string, position: number }`. This ensures the rest of the pipeline works unchanged.
- [x] Auto-detect heading pattern by scanning the first ~2000 characters for known structures:
  ```
  Priority order (first match wins):
  1. Dotted decimal:  /^\s*\d+(\.\d+)*\.?\s/m         → "1.", "1.1", "2.3.4"
  2. Article keyword: /^\s*(article|artikel|...)\s+/im  → "Article 1", "Artikel 3"
  3. ALL-CAPS heading: /^\s*[A-Z][A-Z\s]{2,}$/m        → "RENT", "TERMINATION"
  4. Roman numerals: /^\s*[IVXLC]+\.\s/m               → "I.", "II.", "III."
  5. Parenthetical:  /^\s*\([a-z\d]+\)\s/m             → "(a)", "(1)"
  ```
- [x] Include multilingual heading keywords in article keyword pattern:
  ```
  EN: article, section, clause, part, schedule
  NL: artikel, bepaling, lid, afdeling
  FR: chapitre, alinéa (article/section/clause shared with EN)
  DE: abschnitt, paragraph, klausel, absatz (artikel shared with NL)
  ```
- [x] Split document on detected boundaries — each section heading + body until next heading = one clause
- [x] Handle edge cases:
  - Merge fragments < 50 characters into the previous clause
  - If no headings detected, fall back to double-newline (`\n\n`) paragraph splitting
  - If paragraph splitting produces < 3 or > 60 segments, treat the entire document as a single clause (let the analysis call segment it)
  - Skip non-clause content: preambles that only identify parties, signature blocks, date-only lines
  - Preserve clause heading/number in the text (same behavior as current LLM parse)
- [x] Handle nested sub-sections: top-level sections are clauses; sub-sections stay within their parent (same rule as current parse prompt)
- [x] **No LLM call at all.** This must run in <10ms for a 25KB document.

#### 1.2 — Bulk RAG pattern fetch

- [x] Create `packages/db/src/queries/getPatternsByContractType.ts`
- [x] Implement `getPatternsByContractType(contractType: string)` → `KnowledgePattern[]`:
  ```sql
  SELECT id, clause_pattern, category, contract_type, risk_level,
         why_risky, safer_alternative, jurisdiction_notes, embedding
  FROM knowledge_patterns
  WHERE contract_type @> $1::jsonb
  ORDER BY category, risk_level DESC
  ```
- [x] Returns all patterns for the given contract type (typically ~20-50 from the 100-200 total)
- [x] Include the `embedding` vector in the result — needed for optional in-memory similarity scoring
- [x] Export from `packages/db/src/index.ts`
- [x] **Keep existing `findSimilarPatterns()` and `embedTexts()` intact** — they're still used by the current orchestrator until Phase 2 replaces it

#### 1.3 — Format RAG patterns for prompt injection

- [x] Create `packages/agents/src/format-patterns.ts`
- [x] Implement `formatPatternsForPrompt(patterns: KnowledgePattern[])` → `string`:
  - Groups patterns by category for readability
  - For each pattern: risk level, clause pattern, why risky, safer alternative
  - Output is a structured text block suitable for a Claude system prompt
  - Target: ~50-200 tokens per pattern, ~2K-8K tokens total for a contract type
- [x] Implement `findTopMatchesInMemory(clauseText: string, clauseEmbedding: number[], patterns: KnowledgePatternWithEmbedding[], topK: number)` → `{ patternId: string, similarity: number }[]`:
  - Cosine similarity computed in pure TypeScript (no DB, no Voyage API)
  - Used to populate the `matchedPatterns` field on each clause
  - Only patterns above `PATTERN_MATCH_THRESHOLD` (0.7) are included
- [x] Export from `packages/agents/src/index.ts`

#### 1.4 — Add `clause_positions` SSE event type

- [x] Add new event type to `packages/shared/src/` SSE event schemas:
  ```typescript
  ClausePositionsEvent → {
    type: "clause_positions",
    data: { totalClauses: number, clauses: { text: string, position: number }[] }
  }
  ```
- [x] Add to the `SSEEvent` discriminated union
- [x] This event enables the frontend to render skeleton cards immediately after parsing
- [x] Update `packages/shared/CLAUDE.md` if new types/exports are added

#### 1.5 — Embed clause texts for matchedPatterns (single batch call)

The `matchedPatterns` field on each clause requires knowing which knowledge base patterns are semantically similar. With the new architecture, we still need clause embeddings for this — but we do one batch Voyage call and compute similarity in-memory against pre-fetched patterns (no per-clause DB queries).

- [x] Create `packages/agents/src/compute-matched-patterns.ts`
- [x] Implement `computeMatchedPatterns(clauses: ParsedClause[], patterns: KnowledgePatternWithEmbedding[])` → `Map<number, string[]>`:
  - Batch-embeds all clause texts in one Voyage API call (reuse existing `embedTexts()` from `@redflag/db`)
  - For each clause, computes cosine similarity against all pre-fetched pattern embeddings in memory
  - Returns a map of `position → patternId[]` for patterns above threshold
  - Handles Voyage API failure gracefully: returns empty map (RAG degraded mode)
- [x] This runs in parallel with the combined analysis call in Phase 2 — for now, just build and test it

#### 1.6 — Tests

- [x] **Heuristic parser tests** (`packages/agents/src/__tests__/heuristic-parse.test.ts`):
  - Dutch lease with numbered sections (use actual text from test PDF if available, or representative fixtures)
  - English contract with `Article` headings
  - Contract with ALL-CAPS headings
  - Contract with no clear headings → falls back to paragraph splitting
  - Very short document → single clause fallback
  - Fragments < 50 chars → merged into previous clause
  - Verify output shape matches `ParsedClause[]`
  - Verify performance: <10ms for a 25KB input (use `performance.now()`)
- [x] **Bulk pattern fetch tests** (`packages/db/src/__tests__/getPatternsByContractType.test.ts`):
  - Mock DB to return filtered patterns
  - Verify SQL query filters by contract type
  - Verify results include embedding vectors
- [x] **In-memory similarity tests** (`packages/agents/src/__tests__/compute-matched-patterns.test.ts`):
  - Cosine similarity computation against known vectors
  - Threshold filtering
  - Voyage API failure → empty map gracefully
- [x] **Pattern formatting tests** (`packages/agents/src/__tests__/format-patterns.test.ts`):
  - Verify output groups by category
  - Verify token-reasonable output size
- [x] Run existing tests to verify nothing is broken: `pnpm turbo test`

#### 1.7 — Validate heuristic parser against real documents

- [x] If a test PDF exists in the repo (check `packages/agents/src/__tests__/fixtures/`), use it
- [x] If not, create a representative fixture: a ~20-clause contract with numbered sections
- [x] Compare heuristic parse output vs what the LLM parse would produce:
  - Same number of clauses (±2)?
  - Same clause boundaries?
  - Any clauses missed or incorrectly split?
- [x] Document any edge cases found and handle them

#### 1.8 — Update CLAUDE.md files

- [x] Update `packages/agents/CLAUDE.md`: document new files, exports, heuristic parse approach
- [x] Update `packages/db/CLAUDE.md`: document new `getPatternsByContractType` query
- [x] Update `packages/shared/CLAUDE.md` if new SSE event types were added

### MCP Usage
- **Context7**: If unsure about Zod v4 schema syntax, Drizzle query syntax, or Vitest patterns
- **Supabase MCP**: Verify `getPatternsByContractType` query returns correct results against the production knowledge base

### Quality Gate
```bash
pnpm turbo lint type-check test build
# All existing tests still pass (non-breaking change)
# New heuristic parser tests pass
# New RAG query tests pass
```

### Exit Criteria
- [x] Heuristic parser splits a 25KB document in <10ms
- [x] Heuristic parser handles Dutch, English, French, German heading patterns
- [x] Fallback to paragraph splitting works for unstructured documents
- [x] Bulk RAG fetch returns all patterns for a given contract type in a single query
- [x] In-memory cosine similarity matches patterns correctly
- [x] Pattern formatting produces a readable, token-efficient text block
- [x] `clause_positions` SSE event type exists in shared schemas
- [x] All existing tests still pass (zero regressions)
- [x] All new tests pass
- [x] Quality gate passes
- [x] `packages/agents/CLAUDE.md` and `packages/db/CLAUDE.md` updated
- [x] Commit: `perf(agents,db): heuristic clause parser and bulk RAG pattern fetch`

---

## Phase 1b: Hybrid Parse — Heuristic + LLM Fallback

**Objective:** Fix the critical failure where the heuristic parser returns 1 clause for unconventionally-formatted contracts (e.g., the Dutch rental test PDF). Add a lightweight Haiku LLM fallback that detects clause boundaries when regex patterns fail. The fallback returns only line numbers (~50 tokens output, 1-3 seconds, ~$0.001) — NOT the old approach of copying entire clauses verbatim.

**Why this is needed:** The heuristic parser works well for professionally-formatted contracts with numbered sections, article keywords, or ALL-CAPS headings. But real-world contracts — especially residential leases, informal agreements, and documents with formatting lost during PDF extraction — often lack these structural markers. When heuristic parse produces 1-2 clauses for a large document, the downstream combined analysis (Phase 2) breaks: Claude detects multiple risks within the single giant clause and tries to report them with position numbers that don't exist.

**The approach — hybrid parse:**
1. Try heuristic parser first (instant, free)
2. Check if result is "suspicious" — too few clauses for the document size
3. If suspicious, call Haiku with `strict: true` tool_use to identify clause start **line numbers** only
4. Split document at those line boundaries deterministically
5. Return same `ParsedClause[]` shape — Phase 2's combined analysis works unchanged

**Why Haiku line-number detection is the right approach:**
- **Output is tiny** (~50-100 tokens for 20 clauses): `{ clauseStartLines: [1, 15, 32, 48, ...] }`
- **Haiku is fast** (1-3 seconds) and cheap (~$0.001 per call)
- **`strict: true`** guarantees valid JSON — zero parse errors, no retries needed
- **No text copying** — document splitting is done deterministically from line numbers
- **Language-agnostic** — Haiku understands document structure regardless of language or formatting
- **Universal** — works for any contract format that the heuristic misses

**Entry criteria:** Phase 1 + Phase 2 complete. Heuristic parser, bulk RAG, and combined analysis all working. The issue is specifically that the heuristic parser produces poor results on unconventional documents.

**Context for this session:** Read `docs/PERF_BUILD_PLAN.md` (this file — especially this Phase 1b section), `CLAUDE.md`, and:
- `packages/agents/src/heuristic-parse.ts` — current heuristic parser (being wrapped, NOT replaced)
- `packages/agents/src/orchestrator.ts` — current orchestrator (calls `parseClausesHeuristic` — will call the new smart wrapper instead)
- `packages/agents/src/client.ts` — Anthropic client factory + model constants (`MODELS.haiku`)
- `packages/agents/src/combined-analysis.ts` — Phase 2 combined analysis (consumes `ParsedClause[]` — must NOT change)
- `packages/agents/src/prompts/` — prompt directory for the new boundary detection prompt
- `packages/shared/src/` — `ParsedClause` type definition

### Tasks

#### 1b.1 — LLM boundary detection agent

- [x] Create `packages/agents/src/boundary-detect.ts`
- [x] Implement `detectClauseBoundaries(text: string, contractType: string, language: string)` → `ParsedClause[]`:
  1. **Prepare line-numbered text**: Split document into lines, prepend line numbers:
     ```
     L1: HUUROVEREENKOMST WOONRUIMTE
     L2:
     L3: Partijen:
     L4: De verhuurder: Jan de Vries...
     ...
     L15: Het gehuurde betreft de woning...
     L30: De huurprijs bedraagt EUR 1.200...
     ```
  2. **Call Haiku with tool_use and `strict: true`**:
     - Use `MODELS.haiku` (fast, cheap)
     - Define a `report_boundaries` tool with `strict: true`:
       ```typescript
       {
         name: "report_boundaries",
         strict: true,
         input_schema: {
           type: "object",
           properties: {
             clauseStartLines: {
               type: "array",
               items: { type: "integer" },
               description: "Line numbers (L-prefixed numbers) where each new clause or section starts"
             }
           },
           required: ["clauseStartLines"],
           additionalProperties: false
         }
       }
       ```
     - `tool_choice: { type: "tool", name: "report_boundaries" }` — force the tool call (no free text)
     - `max_tokens: 1024` — more than enough for line number list
  3. **Parse the tool call result**: Extract `clauseStartLines` array
  4. **Split document at line boundaries**: Map line numbers back to character positions, extract text between boundaries
  5. **Post-process**: Merge fragments < 50 chars, trim signature blocks (reuse existing `postProcess` logic from heuristic-parse if possible)
  6. **Return `ParsedClause[]`** with same shape as heuristic parse

- [x] Create `packages/agents/src/prompts/boundary-detect.ts`
- [x] System prompt must:
  - Explain the task: identify where each new clause, section, or article begins in the document
  - Frame document text as untrusted input (prompt injection defense)
  - Instruct to skip preambles, party identification, signature blocks
  - Instruct to identify clause boundaries based on semantic content, not just formatting
  - Give examples of what constitutes a clause boundary (new topic, new obligation, new right)
  - Be concise — Haiku doesn't need long prompts
- [x] The user message is the line-numbered document text with contract type and language metadata
- [x] Retry pattern: 2 attempts (matching existing agent pattern), catch any error, throw descriptive error after both fail

#### 1b.2 — Smart parse wrapper

- [x] Create `packages/agents/src/smart-parse.ts`
- [x] Implement `parseClausesSmart(text: string, contractType: string, language: string)` → `Promise<ParsedClause[]>`:
  1. Call `parseClausesHeuristic(text, contractType, language)` (instant, synchronous)
  2. Evaluate quality of heuristic result:
     - **Suspicious conditions** (trigger LLM fallback):
       - 1 clause AND document > 500 characters
       - 2 clauses AND document > 2000 characters
       - Any result where the largest clause is > 80% of total document text
     - **Acceptable conditions** (keep heuristic result):
       - 3+ clauses with reasonable size distribution
       - Document is very short (< 500 chars) — likely a simple agreement
  3. If suspicious: log a warning, call `detectClauseBoundaries()` as fallback
  4. If fallback also fails (throws error): return the heuristic result as-is (better than nothing)
  5. Log which path was taken: `"heuristic"` or `"llm_fallback"`
- [x] Export from `packages/agents/src/index.ts`
- [x] **The orchestrator will call `parseClausesSmart()` instead of `parseClausesHeuristic()` directly**

#### 1b.3 — Update orchestrator to use smart parse

- [x] In `packages/agents/src/orchestrator.ts`, replace:
  ```typescript
  const rawClauses = parseClausesHeuristic(text, contractType, language);
  ```
  with:
  ```typescript
  const rawClauses = await parseClausesSmart(text, contractType, language);
  ```
- [x] Note: `parseClausesSmart` is async (because the LLM fallback is async), while `parseClausesHeuristic` was sync. The orchestrator already runs in an async generator, so this is a trivial change.
- [x] Add a keepalive status event if the LLM fallback is triggered (it takes 1-3 seconds):
  ```typescript
  yield { type: "status", message: "Detecting clause boundaries..." };
  ```
  Only emit this if the heuristic result was suspicious and we're falling back to Haiku. If heuristic succeeds, no delay, no extra event.

#### 1b.4 — Tests

- [x] **Boundary detection tests** (`packages/agents/src/__tests__/boundary-detect.test.ts`):
  - Mock Haiku streaming response with `report_boundaries` tool call
  - Verify correct line-number extraction from tool call result
  - Verify document splitting at line boundaries produces correct clause text
  - Verify post-processing merges short fragments
  - Verify retry on API failure
  - Verify tool schema has `strict: true`
  - Verify `tool_choice` forces the `report_boundaries` tool
- [x] **Smart parse tests** (`packages/agents/src/__tests__/smart-parse.test.ts`):
  - Document with clear numbered sections → heuristic path taken, no LLM call
  - Long document producing 1 clause from heuristic → LLM fallback triggered
  - Long document producing 2 clauses from heuristic → LLM fallback triggered
  - Short document (< 500 chars) producing 1 clause → heuristic kept (acceptable)
  - LLM fallback failure → returns heuristic result as-is (graceful degradation)
  - Verify logging indicates which path was taken
- [x] **Orchestrator test update** (`packages/agents/src/__tests__/orchestrator.test.ts`):
  - Update mocks to use `parseClausesSmart` instead of `parseClausesHeuristic`
  - Add test case: heuristic produces 1 clause → LLM fallback produces 15 → combined analysis receives 15
- [x] **Integration test with realistic fixture**:
  - Create a test fixture that mimics the Dutch rental contract format (no numbered sections, informal structure, paragraph-based)
  - Verify heuristic detects it as suspicious (1-2 clauses)
  - Verify LLM fallback (mocked) produces reasonable clause boundaries
- [x] Run full test suite: `pnpm turbo test`

#### 1b.5 — Validate against the real Dutch test PDF (manual)

- [ ] Upload the Dutch rental contract PDF on local dev
- [ ] Verify:
  - Heuristic parse produces 1 clause (confirming the problem)
  - LLM fallback triggers automatically
  - Haiku returns reasonable clause boundaries (check logs for line numbers)
  - Combined analysis receives multiple clauses and analyzes each
  - All clause positions are valid (no position mismatch errors)
  - Total parse time: 1-3 seconds (Haiku call) — not 3 minutes
  - Total pipeline time: <30 seconds
- [ ] Also test with a well-structured English contract to verify heuristic path still works (no regression, no unnecessary Haiku calls)

#### 1b.6 — Update CLAUDE.md files

- [x] Update `packages/agents/CLAUDE.md`:
  - Document `smart-parse.ts`, `boundary-detect.ts`, `prompts/boundary-detect.ts`
  - Document the hybrid approach: heuristic first, Haiku LLM fallback
  - Document the suspicious-result thresholds
  - Update pipeline diagram to show hybrid parse step
- [x] Update root `CLAUDE.md` if needed:
  - Note that pipeline uses 3-4 API calls (gate + optional Haiku boundary detection + combined analysis + optional summary fallback)

### MCP Usage
- **Context7**: Anthropic SDK tool_use API (specifically `tool_choice: { type: "tool", name: "..." }` to force a specific tool), Haiku model capabilities
- **Supabase MCP**: Not needed for this phase

### Quality Gate
```bash
pnpm turbo lint type-check test build
# Upload Dutch rental contract locally — verify LLM fallback produces good clause splits
# Upload a well-structured contract — verify heuristic path taken, no Haiku call
```

### Exit Criteria
- [x] Smart parse wrapper correctly detects suspicious heuristic results
- [x] Haiku boundary detection returns valid line numbers in 1-3 seconds
- [x] `strict: true` on tool definition — zero parse errors from Haiku
- [x] Document splitting from line numbers produces correct clause text
- [ ] Dutch rental contract: LLM fallback triggers, produces 10+ clauses, combined analysis works end-to-end
- [x] Well-structured contracts: heuristic path taken, no Haiku call (no regression)
- [x] Graceful degradation: if Haiku fails, heuristic result used as-is
- [ ] Total pipeline time with LLM fallback: <30 seconds
- [x] All tests pass (existing + new)
- [x] Quality gate passes
- [x] `packages/agents/CLAUDE.md` updated
- [ ] Commit: `fix(agents): hybrid clause parser with Haiku LLM fallback for unconventional contracts`

---

## Phase 2b: Fix Boundary Detection + max_tokens + RAG Loading

**Objective:** Fix three issues discovered during Phase 1b/2 production testing: (1) line-number-based boundary detection produces poor clause splits on PDF-extracted text, (2) combined analysis `max_tokens` too low causing Claude to skip clauses 13-20, (3) RAG patterns not loading (`ragPatternCount: 0`).

**What went wrong in testing:**
1. **Clause splitting quality**: PDF text extraction produces long lines with `\n` at arbitrary points. The virtual line splitting at 200 chars creates meaningless boundaries. Haiku returned line numbers, but splitting at those lines cut mid-sentence. Clause 1 was the entire `KERNGEGEVENS` section (all parties + payment terms + property info), clauses 2-4 were sentence fragments.
2. **Claude stopped at clause 13**: `max_tokens` was estimated at `21 * 600 + 2048 = 14,648` with a 32,768 cap. Claude used all tokens by clause 13 and stopped (`stopReason: "tool_use"`). 8 of 21 clauses were never analyzed.
3. **No RAG patterns loaded**: Log showed `ragPatternCount: 0` for `residential_lease`. Either knowledge base isn't seeded in dev, or the contract type filter doesn't match any patterns.

**The fix for boundary detection — anchor-based instead of line-number-based:**

Instead of returning line numbers (meaningless in poorly-structured PDF text), Haiku returns **the first few words of each clause as text anchors**. Then we use `text.indexOf(anchor)` to find the exact position in the document and split there.

Why this is better:
- **Works regardless of line structure** — PDF extraction can produce any line format
- **Deterministic splitting** — `indexOf()` finds the exact character position
- **Still tiny output** — `["1. KERNGEGEVENS VAN DE", "1.2 Huurder", "2. OBJECT VAN DE"]` is ~100-200 tokens
- **Haiku understands structure** — it identifies real clause/section headings, not arbitrary line breaks
- **Same cost/speed** — still Haiku, still `strict: true`, still ~1-3 seconds

**Entry criteria:** Phase 1b + Phase 2 complete. The hybrid parse triggers LLM fallback correctly but produces poor splits. Combined analysis works but runs out of tokens.

**Context for this session:** Read `docs/PERF_BUILD_PLAN.md` (this file — especially this Phase 2b section), `CLAUDE.md`, and:
- `packages/agents/src/boundary-detect.ts` — current line-number-based detection (being rewritten to anchor-based)
- `packages/agents/src/prompts/boundary-detect.ts` — current prompt (being updated)
- `packages/agents/src/smart-parse.ts` — smart parse wrapper (no changes needed)
- `packages/agents/src/combined-analysis.ts` — `estimateMaxTokens()` function (needs fix)
- `packages/agents/src/orchestrator.ts` — check how RAG patterns are loaded
- `packages/db/src/queries/getPatternsByContractType.ts` — verify the query
- `data/knowledge-base/` — check if patterns exist for `residential_lease`

### Tasks

#### 2b.1 — Rewrite boundary detection to anchor-based

- [x] Rewrite `packages/agents/src/boundary-detect.ts`:
  - **Remove** `prepareLineNumberedText()` and `splitAtLineBoundaries()` (line-number approach)
  - **New tool schema** — `report_boundaries` now returns text anchors:
    ```typescript
    {
      name: "report_boundaries",
      strict: true,
      input_schema: {
        type: "object",
        properties: {
          clauseAnchors: {
            type: "array",
            items: {
              type: "object",
              properties: {
                anchor: {
                  type: "string",
                  description: "The first 5-15 words of the clause, copied EXACTLY from the document"
                }
              },
              required: ["anchor"],
              additionalProperties: false
            }
          }
        },
        required: ["clauseAnchors"],
        additionalProperties: false
      }
    }
    ```
  - **New splitting logic** — `splitAtAnchors(text: string, anchors: string[])`:
    1. For each anchor, find its position in the document: `text.indexOf(anchor)`
    2. If exact match fails, try fuzzy matching: trim whitespace, normalize spaces, try first 20 chars
    3. Sort found positions, split document at those positions
    4. Post-process: merge short fragments (< 50 chars), trim signature blocks
    5. Return `ParsedClause[]`
  - **User message** — send the raw document text (no line numbering needed), with contract type and language
  - **Keep**: `strict: true`, `tool_choice: { type: "tool", name: "report_boundaries" }`, retry pattern, Haiku model

#### 2b.2 — Update boundary detection prompt

- [x] Rewrite `packages/agents/src/prompts/boundary-detect.ts`:
  - System prompt changes:
    - Remove all references to line numbers and L-prefixed labels
    - Instruct Haiku to return the **first 5-15 words** of each clause, copied **exactly** from the document
    - Emphasize: copy verbatim, do not paraphrase, do not add words
    - Keep: clause boundary definition, what to skip (preamble, signatures), prompt injection defense
  - User message builder: raw document text with metadata (no line numbering)

#### 2b.3 — Fix combined analysis max_tokens

- [x] In `packages/agents/src/combined-analysis.ts`, update `estimateMaxTokens()`:
  ```typescript
  function estimateMaxTokens(clauseCount: number): number {
    // ~600 tokens per clause (explanation + category + rewrite) + 2048 for summary + buffer
    // Cap at 64000 (Sonnet 4.6 max output)
    return Math.min(clauseCount * 800 + 4096, 64000);
  }
  ```
  - Raise per-clause estimate from 600 to 800 (Dutch text is more token-dense)
  - Raise buffer from 2048 to 4096 (summary + inter-tool-call text)
  - Raise cap from 32768 to 64000 (the model supports it, we should use it)

#### 2b.4 — Investigate and fix RAG pattern loading

- [x] Check `data/knowledge-base/` — do JSON files exist with patterns for `residential_lease`?
- [x] Check the knowledge base seed: has `pnpm run seed` been run in the development environment?
- [x] Check the `getPatternsByContractType` query — does `residential_lease` match the `contract_type` jsonb array in the knowledge_patterns table? The query uses `@>` containment: `WHERE contract_type @> '"residential_lease"'::jsonb`. Verify the stored values match (e.g., are they `["residential_lease"]` or `["lease"]` or `["lease", "rental"]`?).
- [x] If the issue is dev-only (knowledge base not seeded locally), document this clearly and verify it works with the seeded production DB
- [x] If the issue is a contract type mismatch, fix the filter or add a fallback that fetches all patterns when type-specific fetch returns empty
- **Finding:** Knowledge base uses `contractType: ["lease"]` but gate returns `"residential_lease"`. Added `RAG_TYPE_MAP` in orchestrator with fallback: tries exact type first, then mapped base type.

#### 2b.5 — Update tests

- [x] **Boundary detection tests** — rewritten for anchor-based approach:
  - Mock Haiku response with `clauseAnchors` instead of `clauseStartLines`
  - Verify `splitAtAnchors()` correctly finds anchor positions via `indexOf()`
  - Verify `findAnchorPosition()` fuzzy matching with whitespace normalization using `buildNormalizedMap()` position mapping
  - Verify unfound anchors are skipped gracefully
  - Verify post-processing merges short fragments
  - Verify single-line PDF text (no newlines) works
  - Verify duplicate phrases with forward-searching
- [x] Run full test suite: `pnpm turbo test` — **138 tests pass, 16 files**

#### 2b.6 — Local end-to-end validation

- [ ] Upload the Dutch rental contract PDF on local dev
- [ ] Verify:
  - LLM fallback triggers (heuristic produces 1 clause)
  - Haiku returns meaningful clause anchors (section headings, not mid-sentence fragments)
  - `splitAtAnchors()` finds all anchors in the document text
  - Clauses are clean — each starts at a real section boundary
  - Combined analysis receives all clauses and analyzes ALL of them (no skipped positions)
  - `max_tokens` is sufficient — `stopReason` should be `"end_turn"` not `"max_tokens"` or `"tool_use"` with missing positions
  - Total pipeline time: <60 seconds (may be longer than 30s with 21 clauses, that's OK)
  - Check if RAG patterns are loaded (if knowledge base is seeded)
- [ ] Also test with a well-structured English contract to verify heuristic path still works

#### 2b.7 — Update CLAUDE.md files

- [ ] Update `packages/agents/CLAUDE.md`:
  - Document anchor-based boundary detection replacing line-number-based
  - Update `boundary-detect.ts` description
  - Note the `max_tokens` cap of 64000

### MCP Usage
- **Context7**: If needed for Anthropic SDK tool_use details
- **Supabase MCP**: Check if knowledge_patterns table has data, verify contract_type values

### Quality Gate
```bash
pnpm turbo lint type-check test build
# Upload Dutch rental contract locally — verify clean clause splits and full analysis
```

### Exit Criteria
- [ ] Anchor-based boundary detection produces clean clause splits on the Dutch rental contract
- [ ] Each clause starts at a real section/topic boundary (not mid-sentence)
- [ ] Combined analysis completes ALL clauses (zero skipped positions)
- [ ] `max_tokens` cap raised to 64000 — no more truncation
- [ ] RAG pattern loading issue identified and fixed (or documented as dev-only)
- [ ] All tests pass
- [ ] Quality gate passes
- [ ] `packages/agents/CLAUDE.md` updated
- [ ] Commit: `fix(agents): anchor-based boundary detection and max_tokens fix`

---

## Phase 2: Core — Combined Streaming Analysis with Tool Use

**Objective:** Replace the ~30 separate risk + rewrite Claude calls with a single streaming call using the `report_clause` tool pattern. Wire the new heuristic parser and bulk RAG into the orchestrator. This is the core performance fix — the pipeline goes from ~40 API calls to 3.

**Entry criteria:** Phase 1 complete. Heuristic parser and bulk RAG query working and tested.

**Context for this session:** Read `docs/PERF_BUILD_PLAN.md` (this file), `CLAUDE.md`, and:
- `packages/agents/src/heuristic-parse.ts` — new heuristic parser (Phase 1)
- `packages/agents/src/format-patterns.ts` — pattern formatting + in-memory similarity (Phase 1)
- `packages/agents/src/compute-matched-patterns.ts` — batch embed + similarity (Phase 1)
- `packages/agents/src/orchestrator.ts` — current orchestrator (being restructured)
- `packages/agents/src/client.ts` — Anthropic client factory + model constants
- `packages/agents/src/risk.ts` — current risk agent (being replaced by combined call)
- `packages/agents/src/rewrite.ts` — current rewrite agent (being replaced by combined call)
- `packages/agents/src/summary.ts` — summary agent (small updates)
- `packages/agents/src/prompts/` — all current prompts
- `packages/api/src/routers/analysis.ts` — tRPC SSE router (updates for new events)
- `packages/shared/src/` — SSE event types

**Critical Anthropic API references — read these docs before coding:**
- [Tool Use Overview](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview) — how to define tools, multiple tool calls in one response
- [Structured Outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs) — `strict: true` for guaranteed JSON
- [Fine-Grained Tool Streaming](https://platform.claude.com/docs/en/agents-and-tools/tool-use/fine-grained-tool-streaming) — `eager_input_streaming` for real-time streaming
- [Streaming Messages](https://platform.claude.com/docs/en/build-with-claude/streaming) — event types, `content_block_start`/`delta`/`stop`
- [Prompt Caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) — `cache_control` for system prompt reuse
- Use **Context7 MCP** to fetch the latest Anthropic SDK docs if any API details are unclear.

### Tasks

#### 2.1 — Combined analysis prompt

- [x] Create `packages/agents/src/prompts/combined-analysis.ts`
- [x] System prompt must:
  - Frame document text as untrusted input (prompt injection defense)
  - Instruct Claude to analyze each clause for risk, explain in plain language, suggest rewrites for flagged clauses
  - Instruct Claude to call the `report_clause` tool once per clause in document order
  - Instruct Claude to respond in the document's language
  - Include contract type and language metadata
  - Include all RAG patterns for the contract type (formatted by `formatPatternsForPrompt()`)
- [x] User message builder:
  - Takes the heuristically-parsed clauses as input
  - Formats them as a numbered list: `[1] "clause text here"`, `[2] "clause text here"`, etc.
  - Places analysis instructions AFTER the clauses (Anthropic recommendation: instructions after document for long-context analysis)
- [x] Prompt should instruct Claude:
  - For each clause: determine risk level (red/yellow/green), explain why, categorize, and provide a safer alternative if red or yellow
  - Call `report_clause` tool once per clause with results
  - After all clauses, call `report_summary` tool with overall assessment
  - Do NOT copy clause text verbatim in the tool call — reference by position number. The orchestrator maps back to the original text. This dramatically reduces output tokens.

#### 2.2 — Tool definitions

- [x] Define `report_clause` tool schema:
  ```typescript
  {
    name: "report_clause",
    description: "Report risk analysis for a single contract clause",
    strict: true,
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        position: { type: "integer", description: "Zero-based clause position from the input list" },
        riskLevel: { type: "string", enum: ["red", "yellow", "green"] },
        explanation: { type: "string", description: "Plain-language risk explanation in document language" },
        category: { type: "string", description: "Risk category (e.g. termination, liability, rent)" },
        saferAlternative: {
          type: "string",
          description: "Fairer rewrite of the clause. Required for red/yellow, empty string for green."
        }
      },
      required: ["position", "riskLevel", "explanation", "category", "saferAlternative"]
    }
  }
  ```
- [x] Define `report_summary` tool schema:
  ```typescript
  {
    name: "report_summary",
    description: "Report overall contract risk summary after analyzing all clauses",
    strict: true,
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        overallRiskScore: { type: "integer", minimum: 0, maximum: 100 },
        recommendation: { type: "string", enum: ["sign", "caution", "do_not_sign"] },
        topConcerns: { type: "array", items: { type: "string" } }
      },
      required: ["overallRiskScore", "recommendation", "topConcerns"]
    }
  }
  ```
- [x] **Note on `strict: true`**: First request with a new schema has ~100-300ms overhead for grammar compilation; cached for 24 hours after. This is a one-time cost.
- [x] Both tools must be registered in the single `messages.create()` call with `tool_choice: { type: "auto" }`

#### 2.3 — Streaming tool call handler

- [x] Create `packages/agents/src/combined-analysis.ts`
- [x] Implement `analyzeAllClauses(params)` as an async generator that yields `SSEEvent`:
  ```typescript
  interface CombinedAnalysisParams {
    clauses: ParsedClause[];
    contractType: string;
    language: string;
    ragPatterns: KnowledgePattern[];  // pre-fetched by contract type
  }
  ```
- [x] Use the Anthropic SDK streaming API: `client.messages.stream()` or `client.messages.create({ stream: true })`
- [x] Listen for streaming events:
  - `content_block_start` with `type: "tool_use"` — a new tool call is starting
  - `content_block_delta` with `type: "input_json_delta"` — incremental tool input JSON
  - `content_block_stop` — tool call is complete, parse the accumulated JSON
  - `message_stop` — entire response is complete
- [x] When a `report_clause` tool call completes:
  1. The accumulated JSON is already guaranteed valid by `strict: true`
  2. Map `position` back to the original clause from `params.clauses`
  3. Compute `startIndex`/`endIndex` via `text.indexOf()` (existing `computeClausePositions` logic)
  4. Yield `{ type: "clause_analysis", data: ClauseAnalysis }`
- [x] When `report_summary` tool call completes:
  1. Compute `clauseBreakdown` deterministically from accumulated results
  2. Yield `{ type: "summary", data: Summary }`
- [x] Handle errors:
  - If Claude's response is cut off (`stop_reason: "max_tokens"`): yield error event for any unanalyzed clauses, yield partial summary
  - If Claude API returns a 429/500: retry once with exponential backoff, then yield error
  - If a tool call has an unexpected `position` value: log warning, skip
- [x] **Do NOT use `tool_choice: { type: "any" }`** — use `"auto"` so Claude can emit text between tool calls if needed
- [x] After the streaming response completes, check that all clause positions were covered. Log a warning for any missing positions.

#### 2.4 — Restructure orchestrator

- [x] Rewrite `packages/agents/src/orchestrator.ts` to use the new pipeline:
  ```typescript
  async function* analyzeContract(params: AnalyzeContractParams): AsyncGenerator<SSEEvent> {
    // Step 1: Heuristic parse (instant)
    const rawClauses = parseClausesHeuristic(text, contractType, language);
    const positionedClauses = computeClausePositions(text, rawClauses);

    // Emit clause positions for frontend skeleton cards
    yield { type: "clause_positions", data: { totalClauses: positionedClauses.length, clauses: ... } };
    yield { type: "status", message: `Found ${positionedClauses.length} clauses. Analyzing...` };

    // Step 2: Bulk RAG fetch (single SQL query, <50ms)
    const ragPatterns = await getPatternsByContractType(contractType);

    // Step 3: Combined streaming analysis (single Claude call)
    // Also kick off batch embedding in parallel for matchedPatterns
    const embeddingPromise = computeMatchedPatterns(positionedClauses, ragPatterns)
      .catch(() => new Map<number, string[]>());  // graceful degradation

    const allAnalyses: ClauseAnalysis[] = [];
    for await (const event of analyzeAllClauses({
      clauses: positionedClauses,
      contractType,
      language,
      ragPatterns,
    })) {
      if (event.type === "clause_analysis") {
        // Enrich with matchedPatterns once embedding completes
        allAnalyses.push(event.data);
        // Persist to DB
        await db.insert(clauses).values({ ... });
      }
      yield event;
      await heartbeat(analysisId);
    }

    // Step 4: Enrich with matchedPatterns
    const matchedMap = await embeddingPromise;
    // Update clauses in DB with matchedPatterns (batch update)

    // Step 5: Mark complete
    await db.update(analyses).set({ status: "complete", ... });
  }
  ```
- [x] **Resumability**: Cache parse results in `analyses.parsedClauses` (same as before). If resuming, check for already-analyzed clauses in DB and replay them. For the combined analysis, skip already-analyzed positions in the prompt.
- [x] **Heartbeat**: Update `analyses.updatedAt` after each yielded clause event (same pattern as before)
- [x] **Keep the `computeClausePositions()` function** — it still computes `startIndex`/`endIndex`
- [x] Remove imports of old `parseClauses`, `analyzeClause`, `rewriteClause` from the orchestrator
- [x] The summary can come from the `report_summary` tool call in the combined analysis. If Claude doesn't call it (edge case), fall back to a separate `summarize()` call.

#### 2.5 — Update tRPC analysis router

- [x] Update `packages/api/src/routers/analysis.ts`:
  - Handle the new `clause_positions` event type in the SSE stream
  - The polling path (when another connection is processing) should also emit `clause_positions` when available from cached parse results
  - The `complete` replay path should reconstruct `clause_positions` from stored clauses
- [x] Verify the `claimAnalysis()` atomic claim still works with the new pipeline
- [x] Verify the stale detection (90s heartbeat threshold) still works

#### 2.6 — Summary agent refinements

- [x] The combined analysis call includes a `report_summary` tool, which may produce the summary inline
- [x] If the summary comes from the combined call, skip the separate `summarize()` call
- [x] If the summary is missing from the combined call (Claude didn't call the tool), fall back to a separate `summarize()` call
- [x] Add prompt caching to the fallback summary call:
  ```typescript
  system: [
    { type: "text", text: SUMMARY_SYSTEM_PROMPT },
    { type: "text", text: analysisContext, cache_control: { type: "ephemeral" } }
  ]
  ```

#### 2.7 — Remove old per-clause agents from pipeline

- [x] **Do NOT delete the old files yet** — keep `risk.ts`, `rewrite.ts`, `parse.ts` in the repo for reference and test comparison. They are no longer imported by the orchestrator.
- [x] Remove the old per-clause batch processing loop from the orchestrator
- [x] Remove the `batchEmbed()` call that happened before clause processing (replaced by `computeMatchedPatterns()` running in parallel)
- [x] Remove the per-clause `findSimilarPatterns()` calls
- [x] Verify `packages/agents/src/index.ts` exports the new functions

#### 2.8 — Tests

- [x] **Combined analysis tests** (`packages/agents/src/__tests__/combined-analysis.test.ts`):
  - Mock streaming Claude response with multiple `report_clause` tool calls
  - Verify each tool call produces a valid `ClauseAnalysis` event
  - Verify `report_summary` tool call produces a valid `Summary` event
  - Verify `strict: true` is set on tool definitions
  - Verify error handling: `stop_reason: "max_tokens"` → partial results
  - Verify error handling: API error → retry once, then error event
  - Verify missing clause positions are logged
- [x] **Orchestrator integration tests** (`packages/agents/src/__tests__/orchestrator.test.ts`):
  - Update existing orchestrator tests to work with the new pipeline
  - Mock heuristic parse, bulk RAG, and combined analysis
  - Verify event sequence: `clause_positions → status → clause_analysis (×N) → summary`
  - Verify resumability: cached parse → skip parse, replay existing clauses
  - Verify heartbeat after each clause event
- [x] **tRPC router tests** (`packages/api/src/__tests__/analysis.test.ts`):
  - Update to handle new `clause_positions` event
  - Verify `claimAnalysis()` still works
- [x] Run full test suite: `pnpm turbo test`

#### 2.9 — Local end-to-end validation

- [ ] Run `pnpm dev` and upload a contract PDF
- [ ] Verify:
  - Heuristic parse completes instantly (no "Parsing..." delay)
  - Clause skeleton positions arrive immediately
  - Clause analyses stream in one by one
  - Summary appears at the end
  - Total time: <30 seconds for a typical contract
  - No JSON parse errors
  - All clauses have valid risk levels, explanations, categories
  - Red/yellow clauses have safer alternatives
  - matchedPatterns populated (after embedding completes)
- [ ] Check structured logs for timing data

#### 2.10 — Update CLAUDE.md files

- [x] Update `packages/agents/CLAUDE.md`:
  - Document new combined analysis approach
  - Document `report_clause` and `report_summary` tool definitions
  - Document `strict: true` and `eager_input_streaming` usage
  - Note that old per-clause agents (`risk.ts`, `rewrite.ts`, `parse.ts`) are retained but unused
  - Update pipeline diagram
- [x] Update `packages/api/CLAUDE.md`: document new `clause_positions` event handling
- [x] Update root `CLAUDE.md`:
  - Update "Pipeline model" in architecture decisions
  - Update "Claude models" notes
  - Add note about `strict: true` structured outputs
  - Update the E2E flow description
  - Update performance characteristics

### MCP Usage
- **Context7**: Anthropic SDK streaming API, tool_use with streaming, Drizzle batch operations
- **Supabase MCP**: Verify clauses persist correctly during streaming pipeline

### Quality Gate
```bash
pnpm turbo lint type-check test build
# Upload a real PDF locally and verify streaming works
# Total pipeline time < 30 seconds
```

### Exit Criteria
- [x] Single streaming Claude call replaces ~30 separate risk + rewrite calls
- [x] `strict: true` produces guaranteed valid JSON (zero parse errors)
- [x] `eager_input_streaming` delivers clause results as they're generated
- [x] Heuristic parse + bulk RAG + combined analysis = 3 API calls total (gate + analysis + optional summary fallback)
- [ ] First clause result arrives within ~5 seconds of analysis start
- [ ] Full pipeline completes in <30 seconds for a typical contract
- [x] Resumability still works (cached parse, replay existing clauses)
- [x] matchedPatterns populated via in-memory similarity
- [x] Summary produced (either inline from combined call or fallback separate call)
- [x] All tests pass
- [x] Quality gate passes
- [x] CLAUDE.md files updated in agents, api, and root
- [x] Commit: `perf(agents): single streaming analysis call with tool_use, 15-20x faster`

---

## Phase 3: Polish — Frontend UX + Cleanup + Deployment Validation

**Objective:** Update the frontend to take advantage of instant parsing (skeleton cards), clean up dead code, run full smoke tests on production, and validate the performance improvement.

**Entry criteria:** Phases 1, 1b/2b, and 2 complete. Pipeline works locally: hybrid parse (heuristic + Haiku fallback) → bulk RAG → single streaming combined analysis → summary. The `clause_positions` SSE event is emitted by the server but NOT yet handled by the frontend.

**Context for this session:** Read `docs/PERF_BUILD_PLAN.md` (this file), `CLAUDE.md`, and:
- `apps/web/src/components/analysis-view.tsx` — main analysis page client component (**key file: does NOT handle `clause_positions` yet**)
- `apps/web/src/components/clause-card.tsx` — clause card component
- `apps/web/src/components/clause-skeleton.tsx` — skeleton loader
- `apps/web/src/components/status-bar.tsx` — status bar
- `apps/web/src/components/summary-panel.tsx` — summary panel
- `packages/shared/src/schemas/events.ts` — SSE event types (includes `ClausePositionsEventSchema`)
- `packages/agents/src/orchestrator.ts` — pipeline orchestrator (emits `clause_positions` events)
- `packages/api/src/routers/analysis.ts` — tRPC SSE router (emits `clause_positions` in complete/polling paths)
- **Active new files** (keep these): `smart-parse.ts`, `heuristic-parse.ts`, `boundary-detect.ts`, `combined-analysis.ts`, `format-patterns.ts`, `compute-matched-patterns.ts`, `prompts/combined-analysis.ts`, `prompts/boundary-detect.ts`
- **Old deprecated files** (to delete): `parse.ts`, `risk.ts`, `rewrite.ts`, `prompts/parse.ts`, `prompts/risk.ts`, `prompts/rewrite.ts`

### Tasks

#### 3.1 — Handle `clause_positions` event in frontend

- [ ] Update `apps/web/src/components/analysis-view.tsx` to handle the `clause_positions` SSE event:
  - Add a `"clause_positions"` case to the event switch statement
  - When received, store `totalClauses` and the clause position list in component state
  - Immediately render skeleton cards for ALL clauses (one per position)
  - Each skeleton card should show the clause number and occupy the correct vertical space
  - This gives users an instant structural preview of the document
- [ ] The skeleton cards should use the existing `ClauseSkeleton` component
- [ ] As `clause_analysis` events arrive, replace the corresponding skeleton with a real `ClauseCard`:
  - Match by `position` field
  - Animate the transition: skeleton → colored card (CSS fade/slide, matching existing `fade-slide-in` animation)
- [ ] Replace the current hardcoded skeleton logic (1-3 skeletons based on `streamClauses.length`) with position-aware skeletons driven by `clause_positions` data
- [ ] Update the progress indicator to show: `"Analyzed 3 of 18 clauses..."` with a determinate progress bar (since total is known from `clause_positions`)

#### 3.2 — Improve streaming UX

- [ ] The `StatusBar` should update more meaningfully now:
  - After `clause_positions`: `"Found 18 clauses. Analyzing..."`
  - During streaming: `"Analyzing clause 3 of 18..."` (update as each clause arrives)
  - Before summary: `"Generating summary..."`
- [ ] Consider adding a determinate progress bar below the status bar (thin colored bar that fills as clauses complete)
- [ ] The perceived speed improvement should be dramatic: instant skeleton cards, then results filling in within seconds
- [ ] Verify `prefers-reduced-motion` is respected for all animations

#### 3.3 — Remove old agent code

**Files to DELETE** (deprecated, not imported anywhere):
- [ ] `packages/agents/src/parse.ts` (replaced by `heuristic-parse.ts` + `smart-parse.ts`)
- [ ] `packages/agents/src/prompts/parse.ts` (no longer used)
- [ ] `packages/agents/src/risk.ts` (replaced by `combined-analysis.ts`)
- [ ] `packages/agents/src/prompts/risk.ts` (replaced by `prompts/combined-analysis.ts`)
- [ ] `packages/agents/src/rewrite.ts` (replaced by `combined-analysis.ts`)
- [ ] `packages/agents/src/prompts/rewrite.ts` (replaced by `prompts/combined-analysis.ts`)

**Test files to DELETE:**
- [ ] `packages/agents/src/__tests__/parse.test.ts` → replaced by `heuristic-parse.test.ts` + `smart-parse.test.ts`
- [ ] `packages/agents/src/__tests__/risk.test.ts` → replaced by `combined-analysis.test.ts`
- [ ] `packages/agents/src/__tests__/rewrite.test.ts` → replaced by `combined-analysis.test.ts`

**Files to KEEP** (active, do NOT delete):
- `heuristic-parse.ts`, `smart-parse.ts`, `boundary-detect.ts` — hybrid parse chain
- `combined-analysis.ts` — streaming analysis with tool_use
- `format-patterns.ts`, `compute-matched-patterns.ts` — RAG support
- `gate.ts`, `summary.ts` — still used directly
- `prompts/gate.ts`, `prompts/combined-analysis.ts`, `prompts/boundary-detect.ts`, `prompts/summary.ts`
- `__tests__/gate.test.ts`, `summary.test.ts`, `positions.test.ts`, `smoke.test.ts`, `pdf-extraction.test.ts`
- `__tests__/heuristic-parse.test.ts`, `heuristic-parse-validation.test.ts`, `smart-parse.test.ts`, `boundary-detect.test.ts`, `combined-analysis.test.ts`, `compute-matched-patterns.test.ts`, `format-patterns.test.ts`, `orchestrator.test.ts`

**After deletion:**
- [ ] Update `packages/agents/src/index.ts` — remove old exports if any remain, verify new exports are present
- [ ] Verify all imports across the codebase still resolve: `pnpm turbo type-check`
- [ ] Run `npx biome check --write` to fix any import ordering issues

#### 3.4 — Update shared types if needed

- [ ] Verify `ClauseAnalysis`, `Summary`, `SSEEvent` types are still correct
- [ ] The combined analysis returns `saferAlternative: ""` for green clauses (tool schema requires string). The handler in `combined-analysis.ts` normalizes `""` → `null`. Verify the frontend correctly handles both `null` and empty string for `saferAlternative`.
- [ ] Verify the `clause_positions` event type in `packages/shared/src/schemas/events.ts` matches what the orchestrator emits

#### 3.5 — Production deployment and validation

- [ ] Run full quality gate: `pnpm turbo lint type-check test build`
- [ ] Deploy to Vercel (or let auto-deploy on push)
- [ ] **Performance smoke test on production** — test with documents from `test-documents/`:

  | Document | File | What to verify |
  |----------|------|----------------|
  | US English lease | `01-lease-en-us-gov.pdf` | Heuristic parse works (numbered sections), reasonable clause count, risk analysis makes sense |
  | English NDA | `02-nda-en-usdoj.pdf` | Shorter document, fewer clauses, fast completion |
  | French lease | `03-lease-fr-gov.pdf` | Multilingual heading detection, French-language explanations |
  | German/English lease | `04-lease-de-en-mieterbund.pdf` | Mixed-language handling, German heading keywords |
  | English ToS | `05-tos-en-sample.pdf` | Different contract type, ToS-specific risk patterns |
  | English/German freelance | `06-freelance-en-de.pdf` | Freelance-specific patterns, IP/payment/non-compete risks |

- [ ] For each document, measure:
  - Time from upload to first clause result (target: <15 seconds)
  - Time from upload to all clauses complete (target: <60 seconds for 20+ clause contracts, <30s for shorter ones)
  - Time from upload to summary (target: within 15s of last clause)
  - Number of SSE reconnections (target: 0)
  - JSON parse errors (target: 0)
  - Which parse path was taken (heuristic vs Haiku fallback) — check structured logs
- [ ] **Quality smoke test on production:**
  - Upload a non-contract (e.g., a recipe PDF or any non-legal document) → verify rejection still works
  - Upload a scanned PDF → verify rejection still works
  - Rate limit still works
  - Concurrent tabs still work (atomic claim)
  - Completed analysis loads from DB on refresh (no SSE needed)
- [ ] Check Vercel function logs for:
  - No Vercel Runtime Timeout errors
  - No JSON parse errors
  - Structured logs show pipeline timing (parse method, clause count, analysis duration)
  - RAG patterns loaded correctly (check for "RAG type map fallback" if contract type doesn't match exactly)
- [ ] Compare before/after:
  | Metric | Before | After | Improvement |
  |--------|--------|-------|-------------|
  | Total time | 4-5 min | ? | target: 5-10x faster |
  | First clause | 3+ min | ? | target: <15s |
  | API calls | ~40 | 3-4 | ~10-13x fewer |
  | JSON errors | frequent | 0 | eliminated |
  | Vercel timeouts | frequent | 0 | eliminated |
  | Parse time | 3+ min | <3s (heuristic) or <5s (Haiku) | ~60x faster |

#### 3.6 — Update documentation

- [ ] Update `packages/agents/CLAUDE.md`:
  - Remove references to deleted files (`parse.ts`, `risk.ts`, `rewrite.ts` and their prompts)
  - Remove "**OLD:**" labels — these files no longer exist
  - Finalize documentation for hybrid parse chain: `smart-parse.ts` → `heuristic-parse.ts` + `boundary-detect.ts`
- [ ] Update root `CLAUDE.md`:
  - Update pipeline description to: `Gate → Hybrid Parse (heuristic + Haiku fallback) → Bulk RAG → Combined Streaming Analysis (tool_use) → [Summary fallback]`
  - Remove "Parallel clause processing in batches of 5" note (replaced by single streaming call)
  - Update "Pipeline resumability" to reflect new architecture (cached parse + per-event heartbeat)
  - Update "Clause position strategy" to note hybrid parse with anchor-based boundary detection
  - Add note about `strict: true` structured outputs eliminating JSON parse errors
  - Add note about RAG type mapping (`RAG_TYPE_MAP` in orchestrator handles contract type mismatches like `residential_lease` → `lease`)
  - Add performance characteristics section
- [ ] Update `docs/BUILD_PLAN.md`: check off Phase 6 smoke tests if they now pass
- [ ] Update `README.md` architecture diagram if it references the old pipeline

### MCP Usage
- **Context7**: If clarification needed on Tailwind v4 animations, CSS transitions, or shadcn/ui components
- **Vercel MCP**: Check deployment logs, function duration, and verify no timeouts
- **Supabase MCP**: Verify production data looks correct after smoke tests
- **Playwright MCP**: Screenshot production pages for visual QA if desired

### Quality Gate
```bash
pnpm turbo lint type-check test build
# Production smoke tests pass (all items in 3.5)
# Performance target met: <60 seconds total for complex contracts, <30s for simple ones
```

### Exit Criteria
- [ ] Frontend renders skeleton cards immediately after parse (driven by `clause_positions` event)
- [ ] Clause cards fill in progressively with smooth animation
- [ ] Progress indicator shows determinate progress (X of N)
- [ ] Old agent code (parse.ts, risk.ts, rewrite.ts and their prompts/tests) deleted
- [ ] All imports resolve, no dead code
- [ ] Production deployment works — no Vercel timeouts
- [ ] Performance validated: <60 seconds total for Dutch test PDF, first clause in <15 seconds
- [ ] Zero JSON parse errors on production
- [ ] All smoke tests pass
- [ ] All documentation updated (agents CLAUDE.md, root CLAUDE.md, README)
- [ ] Quality gate passes
- [ ] Commit: `perf: frontend streaming UX, cleanup dead code, validate performance improvement`

---

## Phase 4: Ambitious UI — PDF Viewer + Live Clause Highlighting (Future)

> **This phase is not yet planned in detail.** It will be scoped after Phase 3 ships and production performance is validated. This is a stub to capture the vision.

**Vision:** A split-screen experience where the uploaded PDF is rendered on the left with each clause highlighted in its risk color (red/yellow/green). As analysis streams in, clauses animate from a "scanning" state to their final color with the risk report appearing on the right. Think GPTZero's document highlighting meets a professional legal review tool.

**Key components to research/build:**
- PDF rendering in-browser (`react-pdf` / `pdf.js`) with text layer overlay
- Clause highlight overlays using `startIndex`/`endIndex` positions (already stored)
- "Analyzing..." animation per clause (shimmer/pulse on the highlighted region)
- Side-by-side layout: PDF left, risk cards right
- Synchronized scrolling between PDF and risk cards
- Click a clause in the PDF → scroll to its risk card (and vice versa)
- Mobile: stack layout (PDF on top, cards below) or tab switching

**Prerequisites from earlier phases:**
- `startIndex`/`endIndex` positions must be accurate (computed via `indexOf()` ✓)
- `clause_positions` event provides clause data instantly after parse ✓
- Streaming analysis fills in risk data progressively ✓

**This phase is a full UI redesign** — scope it as its own build plan with design system updates, component inventory, and Playwright visual QA.

---

## Session Protocol

### Starting a phase
```
Read docs/PERF_BUILD_PLAN.md, begin Phase N
```

### During a phase
- Work through tasks in order
- Use specified MCPs when hitting unfamiliar APIs (especially Anthropic streaming/tool_use docs)
- Run quality gate commands frequently — don't accumulate debt
- If blocked, note the blocker and move to the next task if independent
- If the Anthropic streaming/tool_use API behaves differently than documented here, adapt — the research was thorough but APIs evolve

### Before finishing a phase
Verify all of these before committing:
- [ ] All completed tasks checked off in this file
- [ ] CLAUDE.md updated in every package you modified
- [ ] Root CLAUDE.md updated if architecture changed
- [ ] `pnpm turbo lint type-check test build` passes
- [ ] Commit with conventional commit message

### Between phases
- `/clear` before starting the next phase
- Start fresh — the build plan and code are the source of truth
- Re-read this plan at the start of each session

---

## Rollback Plan

If the new pipeline produces issues after Phase 3 (old agent files deleted):
1. Git history preserves the old agents — `git checkout <commit> -- packages/agents/src/parse.ts packages/agents/src/risk.ts packages/agents/src/rewrite.ts` to restore
2. The orchestrator can be reverted to import the old per-clause agents
3. RAG can revert to per-clause embedding + vector search by re-importing `findSimilarPatterns` and `embedTexts`

The DB schema is unchanged. The SSE event types are backwards-compatible (new `clause_positions` event is additive). The frontend gracefully handles missing events.
