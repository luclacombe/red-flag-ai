# @redflag/agents

Agent pipeline — pure async functions for each step of contract analysis.

## What's Here

- `src/client.ts` — Shared Anthropic client factory (`getAnthropicClient()`) + model ID constants (`MODELS.haiku`, `MODELS.sonnet`)
- `src/gate.ts` — Relevance gate agent (`relevanceGate(text)` → `GateResult`). Uses Haiku, retries once on failure.
- `src/prompts/gate.ts` — System prompt for gate classification + user message builder
- `src/__tests__/` — Unit tests for gate agent + PDF extraction
- `src/__tests__/fixtures/generate-pdf.ts` — Minimal valid PDF generator for tests (no deps)

## Pipeline

```
Upload → [Relevance Gate] → [Parse Agent] → [Risk Agent + RAG] → [Rewrite Agent] → [Summary Agent]
```

## Dependencies

- `@anthropic-ai/sdk` — Claude API client
- `@redflag/shared` — Zod schemas (`GateResultSchema`)
- `@redflag/db` — Database queries (used by future agents)
- `unpdf` (dev only) — PDF text extraction for tests

## Rules

- Agents are **pure async functions** — no classes, no state. Input → output.
- Every Claude response must be validated against a Zod schema from `@redflag/shared`
- Document text is **untrusted input** — system prompts must instruct Claude to analyze objectively
- RAG vector search is called from `@redflag/db`, not implemented here
- Claude models: Haiku for relevance gate, Sonnet for all other agents
- All source files must be under `src/` (TypeScript `rootDir` constraint)
