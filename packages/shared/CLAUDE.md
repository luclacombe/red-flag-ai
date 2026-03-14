# @redflag/shared

Leaf package — all other packages import from here, this imports nothing internal.

## What's Here

- `src/schemas/` — Zod schemas for all data shapes crossing package boundaries
- `src/constants.ts` — Shared constants (MAX_PAGES, RATE_LIMIT_PER_DAY, VOYAGE_DIMENSIONS, MAX_FILE_SIZE_BYTES)
- `src/index.ts` — Barrel export (Biome enforces alphabetical import ordering)

## Schemas

| Schema | File | Purpose |
|--------|------|---------|
| ClauseAnalysisSchema | `schemas/clause.ts` | Shape of a single analyzed clause |
| SummarySchema | `schemas/summary.ts` | Overall analysis summary with risk score |
| SSEEventSchema | `schemas/events.ts` | Discriminated union of all streamed event types |
| KnowledgePatternSchema | `schemas/knowledge.ts` | RAG knowledge base entry (no embedding field) |
| GateResultSchema | `schemas/gate.ts` | Relevance gate output |
| RiskLevelSchema etc. | `schemas/enums.ts` | Shared enum types |

## Rules

- Every new data shape that crosses a package boundary gets a Zod schema here
- Export both the schema and its inferred `type` from the barrel
- After modifying `index.ts`, run `npx biome check --write src/` to fix import ordering
- No runtime dependencies except `zod`
