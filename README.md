# RedFlag AI

AI-powered contract red-flag detector. Upload a PDF, DOCX, or TXT file and get clause-by-clause risk analysis with streaming results.

[![CI](https://github.com/luclacombe/red-flag-ai/actions/workflows/ci.yml/badge.svg)](https://github.com/luclacombe/red-flag-ai/actions/workflows/ci.yml)

**Live:** [red-flag-ai.com](https://red-flag-ai.com)

![RedFlag AI — analysis results](docs/screenshots/v3-db-render-top.png)

---

## How It Works

1. Upload a contract (PDF, DOCX, or TXT)
2. AI checks if it's actually a contract and rejects non-contracts immediately
3. Clauses are extracted and analyzed against a knowledge base of 150 curated predatory patterns (RAG via Voyage AI `voyage-law-2` embeddings + pgvector)
4. Results stream to the UI in real-time, with each clause scored red/yellow/green and explained with safer alternatives
5. Get a summary with an overall risk score, top concerns, and a sign/don't-sign recommendation

## Architecture

```mermaid
flowchart LR
    A[Upload Contract] --> B[Relevance Gate\nHaiku]
    B -->|Not a contract| C[Rejection]
    B -->|Contract| D[Smart Parse\nHeuristic + Haiku fallback]
    D --> E

    subgraph SA[Combined Analysis - Sonnet streaming]
        E[Risk + Rewrite + Summary\nin one call]
    end

    E -->|Stream clause by clause| F[UI]

    subgraph RAG[Knowledge Base]
        G[(pgvector\n150 patterns)] -->|Patterns in\nsystem prompt| E
        H[Voyage AI\nvoyage-law-2] -.->|Pre-computed\nembeddings| G
    end

    D -->|Bulk fetch\nby contract type| G
```

### Pipeline

| Step | Agent | Model | Purpose |
|------|-------|-------|---------|
| 1 | Relevance Gate | Haiku | Is this a contract? What type? What language? |
| 2 | Smart Parse | Heuristic (+ Haiku fallback) | Split document into individual clauses |
| 3 | Combined Analysis | Sonnet (streaming) | Score each clause, generate safer alternatives, produce summary. Single API call with `report_clause` + `report_summary` tools. |

Total API calls: 3-4 (gate + optional Haiku boundary detection + combined analysis + optional summary fallback).

### Knowledge Base (RAG)

The analysis is grounded by a curated knowledge base of 150 predatory contract patterns covering leases, NDAs, employment contracts, and service agreements. Each pattern includes a risk description, category, and safer alternative.

Patterns are embedded using [Voyage AI](https://www.voyageai.com/)'s `voyage-law-2` model (legal-domain-specific, 1024 dimensions) and stored in PostgreSQL via pgvector. At analysis time, all patterns for the detected contract type are bulk-fetched and injected into the system prompt, so Claude has domain-specific knowledge about what to flag.

The seed data ships with pre-computed embeddings — no Voyage API key needed for local development.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16, React 19, TypeScript strict, Tailwind CSS v4, shadcn/ui |
| API | tRPC v11 (end-to-end type safety, SSE subscriptions) |
| AI | Claude API (Anthropic SDK), multi-agent pipeline |
| Knowledge Base | 150 curated legal patterns, Voyage AI embeddings (voyage-law-2, 1024 dims), pgvector cosine similarity |
| Database | Supabase (PostgreSQL + pgvector + Storage) |
| ORM | Drizzle |
| Validation | Zod v4 at all boundaries |
| Deployment | Vercel (Node.js runtime, 300s timeout) |
| CI/CD | GitHub Actions (lint → type-check → test → build) |
| Linting | Biome |

## Project Structure

```
apps/web/              → Next.js App Router (UI + route handlers)
packages/api/          → tRPC v11 routers, procedures, context
packages/agents/       → Agent pipeline (gate, smart parse, combined analysis, summary fallback)
packages/db/           → Drizzle schema, migrations, vector search, embeddings
packages/shared/       → Zod schemas, types, constants, logger
```

Dependency direction: `web → api → agents → db → shared` (shared is the leaf).

## Local Setup

### Prerequisites

- [Node.js](https://nodejs.org/) 22+
- [pnpm](https://pnpm.io/) 10+
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (for local Supabase)
- [Supabase CLI](https://supabase.com/docs/guides/cli/getting-started) 2.x
- An [Anthropic API key](https://console.anthropic.com/)

### Quick Start

```bash
# 1. Clone and install
git clone https://github.com/luclacombe/red-flag-ai.git
cd red-flag-ai
pnpm install

# 2. Start local Supabase (Postgres + pgvector, Auth, Storage, Studio)
pnpm supabase:start

# 3. Reset database (applies migrations + seeds knowledge base with pre-computed embeddings)
pnpm supabase:reset

# 4. Configure environment
cp .env.example .env.local
# Edit .env.local — add your ANTHROPIC_API_KEY

# 5. Start dev server
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). Supabase Studio is at [http://127.0.0.1:54323](http://127.0.0.1:54323).

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase API URL (`http://127.0.0.1:54321` locally) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anon key (well-known local dev key in `.env.example`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service role key (well-known local dev key in `.env.example`) |
| `DATABASE_URL` | Yes | Postgres connection string |
| `NEXT_PUBLIC_APP_URL` | Yes | App URL (`http://localhost:3000` locally) |
| `MASTER_ENCRYPTION_KEY` | Yes | 32-byte hex key for AES-256-GCM at-rest encryption (dev key in `.env.example`) |
| `CRON_SECRET` | Yes | Bearer token for cron endpoint |
| `ANTHROPIC_API_KEY` | Yes | Claude API key for contract analysis |
| `VOYAGE_API_KEY` | No | Voyage AI API key (only needed if re-seeding knowledge base via `pnpm run seed`) |

### Available Commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start Next.js dev server |
| `pnpm build` | Build all packages + Next.js app |
| `pnpm turbo lint` | Biome lint across all packages |
| `pnpm turbo type-check` | TypeScript strict check across all packages |
| `pnpm turbo test` | Vitest across all packages |
| `pnpm turbo lint type-check test build` | Full quality gate |
| `pnpm supabase:start` | Start local Supabase |
| `pnpm supabase:stop` | Stop local Supabase |
| `pnpm supabase:reset` | Reset DB (re-apply migrations + seed) |
| `pnpm run seed` | Seed knowledge base via Voyage AI (needs `VOYAGE_API_KEY`) |

## Security

- **AES-256-GCM encryption at rest** — all document content and PII encrypted with per-document derived keys (HKDF-SHA256)
- **30-day auto-deletion** — documents and analysis data purged automatically via Vercel Cron
- **HMAC-SHA256 IP hashing** — rate limit identifiers are irreversibly hashed (GDPR-compliant)
- **Row Level Security** — Supabase RLS enforced on all tables
- **Private by default** — analyses require explicit share toggle; share links expire after 7 days
- **HTTP security headers** — CSP, HSTS, X-Frame-Options, Permissions-Policy
- **Prompt injection defense** — document text treated as untrusted input in all AI agent prompts

See [SECURITY.md](SECURITY.md) for the responsible disclosure policy.

## What I'd Improve With More Time

- **Jurisdiction-specific patterns.** The knowledge base is jurisdiction-agnostic. Add region-specific pattern sets (EU, US states, UK).
- **LLM observability.** Add tracing (e.g., Langfuse) for token usage, latency per agent, and prompt versioning.
- **Contract comparison.** Upload two versions of a contract, diff the clauses.
- **PDF viewer.** Render the original PDF in the side-by-side view instead of extracted text.

## Cost Note

Each full analysis costs approximately **$0.01 to $0.05** in Claude API calls, depending on document length. Voyage AI is only used for seeding the knowledge base (one-time cost), not per-analysis. Rate limiting controls spend: 2 analyses/day for anonymous users, 10/day for authenticated users.

## Legal Disclaimer

RedFlag AI is **not a substitute for professional legal advice**. It provides AI-generated analysis for informational purposes only. Always consult a qualified attorney before making legal decisions based on contract review. The developers are not responsible for any actions taken based on this tool's output.
