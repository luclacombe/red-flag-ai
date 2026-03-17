# @redflag/shared

Leaf package — all other packages import from here, this imports nothing internal.

## What's Here

- `src/schemas/` — Zod schemas for all data shapes crossing package boundaries
- `src/constants.ts` — Shared constants (MAX_PAGES, RATE_LIMIT_PER_DAY, VOYAGE_DIMENSIONS, MAX_FILE_SIZE_BYTES, MAX_TEXT_LENGTH, ACCEPTED_MIME_TYPES, DOCX_MIME, TXT_MIME, SUPPORTED_LANGUAGES, SHARE_LINK_EXPIRY_DAYS)
- `src/logger.ts` — Structured JSON logger (`logger.info/warn/error`). Uses `console.log` + `JSON.stringify` — Vercel captures natively.
- `src/crypto.ts` — Encryption utilities (AES-256-GCM, HKDF key derivation, HMAC IP hashing). `getMasterKey()` validates hex format via regex. `decryptBuffer()` validates minimum input length. `decrypt()` uses explicit UTF-8 encoding. **Exported via `@redflag/shared/crypto` subpath, NOT the main barrel** — `node:crypto` is incompatible with edge runtime.
- `src/index.ts` — Barrel export (Biome enforces alphabetical import ordering)

## Schemas

| Schema | File | Purpose |
|--------|------|---------|
| ClauseAnalysisSchema | `schemas/clause.ts` | Shape of a single analyzed clause |
| SummarySchema | `schemas/summary.ts` | Overall analysis summary with risk score |
| SSEEventSchema | `schemas/events.ts` | Discriminated union of all streamed event types (status, clause_positions, clause_analysis, summary, error) |
| ClausePositionsEventSchema | `schemas/events.ts` | Skeleton card + highlight event — `{ totalClauses, clauses: PositionedClause[] }`. Includes `startIndex`/`endIndex` for immediate gray highlighting. |
| DocumentTextEventSchema | `schemas/events.ts` | Document text + `fileType` (`"pdf" | "docx" | "txt"`) — enables side-by-side layout + viewer dispatch. |
| FileTypeSchema | `schemas/events.ts` | Zod enum for `fileType`: `"pdf" | "docx" | "txt"`. Exported as `FileType` type. |
| KnowledgePatternSchema | `schemas/knowledge.ts` | RAG knowledge base entry (no embedding field) |
| GateResultSchema | `schemas/gate.ts` | Relevance gate output |
| ParsedClauseSchema, PositionedClauseSchema | `schemas/parse.ts` | Parse agent output (text + position) and orchestrator-enriched version (with startIndex/endIndex) |
| RiskLevelSchema etc. | `schemas/enums.ts` | Shared enum types |
| ResponseLanguageSchema | `schemas/language.ts` | Zod enum of 15 supported response language codes |

## Rules

- `src/schemas/metrics.ts` — Pipeline observability types: `TokenUsage` (`{ inputTokens, outputTokens }`), `PipelineStep` union (`"gate" | "parse" | "combined_analysis" | "summary_fallback"`), `PIPELINE_STEPS` const array.
- Every new data shape that crosses a package boundary gets a Zod schema here
- Export both the schema and its inferred `type` from the barrel
- After modifying `index.ts`, run `npx biome check --write src/` to fix import ordering
- No runtime dependencies except `zod`
- Crypto module uses `node:crypto` only — zero npm dependencies
- Import crypto via `@redflag/shared/crypto`, not via the main barrel (edge runtime compat)
