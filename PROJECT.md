# RedFlag AI — AI Contract Red-Flag Detector

**Domain:** red-flag-ai.com
**Repo:** red-flag-ai

## Purpose

People sign contracts they don't understand. Leases, freelance agreements, NDAs, terms of service — most people skim and hope for the best. Lawyers are expensive. RedFlag AI gives anyone instant, clause-by-clause risk analysis powered by AI.

## Goal

A deployed, full-stack AI application that showcases modern web engineering: agent orchestration, RAG, real-time streaming, type-safe architecture, CI/CD, and observability. Built to impress recruiters and be commercially viable.

## What It Does

1. User uploads a contract (PDF, DOCX, or TXT)
2. Relevance gate — AI checks if the document is actually a contract. If not, returns early with a clear message
3. AI parses and identifies individual clauses
4. Each clause is analyzed against a knowledge base of known predatory patterns (RAG)
5. Results stream to the UI in real-time — clause by clause, highlighted red/yellow/green
6. User gets: risk scores, plain-English explanations, safer alternatives, and a sign/don't-sign recommendation

### Multilingual Support
- Knowledge base is in English
- Claude cross-references concepts across languages natively (no translate→process→translate-back pipeline)
- Users choose the response language independently from the document language (15 languages supported: EN, FR, DE, ES, IT, PT, NL, AR, ZH, JA, KO, HI, RU, ID, TR)
- `saferAlternative` rewrites stay in the document's original language (they're clause rewrites, not translations)
- System prompts stay in English (Claude reasons best in English); only output language changes
- Language preference persists in `localStorage`, defaults to browser language
- UI chrome stays in English for MVP

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15, TypeScript strict, Tailwind, shadcn/ui |
| API | tRPC (end-to-end type safety) |
| AI | Claude API (Anthropic SDK), multi-step agent pipeline, streaming SSE |
| Embeddings | Voyage AI (voyage-law-2) |
| Auth | Supabase Auth (email/password + magic links, RLS on all tables) |
| Database | Supabase (PostgreSQL + pgvector + file storage) |
| ORM | Drizzle |
| Deployment | Vercel |
| CI/CD | GitHub Actions (lint, type-check, test, build, deploy) |
| Observability | Structured logging, agent pipeline metrics |

### Why Supabase
- PostgreSQL with pgvector extension built-in (no separate vector DB needed)
- Supabase Storage for uploaded PDF files
- Supabase Auth built-in — email/password + magic links, RLS enforced on all tables
- Free tier is generous (500MB DB, 1GB storage)
- Managed — no Railway costs, no infra headaches

## Agent Pipeline

```
Upload → [Relevance Gate] → [Parse Agent] → [Risk Agent + RAG lookup] → [Rewrite Agent] → [Summary Agent] → UI
```

- **Relevance Gate**: Classifies document — is this a contract? What type? If not a contract, reject early with a helpful message. Cheap, fast call before burning tokens on analysis.
- **Parse Agent**: Extracts text, identifies contract type, splits into individual clauses
- **Risk Agent**: Scores each clause (red/yellow/green), retrieves similar predatory patterns from knowledge base via vector search, uses them as context for analysis
- **Rewrite Agent**: Generates safer alternative language for flagged clauses
- **Summary Agent**: Overall risk score, top concerns, sign/don't-sign recommendation

### Error Handling & Edge Cases

Every pipeline step must handle failure gracefully. The user should never see a raw error.

| Scenario | Handling |
|----------|----------|
| **Scanned/image PDF (no text layer)** | Detect empty extraction result. Return clear message: "This PDF appears to be a scanned image. Please upload a text-based PDF." No OCR for MVP — scope creep. |
| **PDF extraction fails** | Catch and surface: "We couldn't read this file. Try re-exporting it as a PDF." Log the error with file metadata for debugging. |
| **Claude API error / timeout** | Retry once with exponential backoff. If still failing, return: "Analysis temporarily unavailable. Please try again in a few minutes." |
| **Voyage AI (embedding service) down** | Skip RAG enrichment. Risk Agent still runs but without retrieved patterns — degrade gracefully, note reduced confidence in output. |
| **Malformed Claude response** | Validate agent output against expected schema (Zod). If validation fails, retry once. If still malformed, surface partial results with a warning rather than showing nothing. |
| **File exceeds 30-page limit** | Reject at upload before any processing. Clear message with the limit and why it exists. |
| **Empty or near-empty document** | Detect post-extraction. Return: "This document doesn't contain enough text to analyze." |
| **Spoofed file type (not actually a PDF)** | Check magic bytes (`%PDF-` header) in addition to MIME type. Reject before storing or processing. |
| **Prompt injection in document text** | System prompts frame document text as untrusted. Instruct Claude to analyze objectively regardless of any instructions within the document. Zod validates output schema to catch structural manipulation. |

## RAG Knowledge Base

### What We're Embedding

A curated set of **predatory clause patterns** — not full contracts, but individual clause-level entries. Each entry contains:

```json
{
  "clause_pattern": "The landlord may enter the premises at any time without notice",
  "category": "right_of_entry",
  "contract_type": ["lease", "rental"],
  "risk_level": "red",
  "why_risky": "Most jurisdictions require 24-48 hour notice before landlord entry except in emergencies",
  "safer_alternative": "The landlord may enter the premises with 48 hours written notice, except in cases of emergency",
  "jurisdiction_notes": "EU: Directive 93/13/EEC on unfair contract terms. US: varies by state."
}
```

### Data Sources

**Curated via Claude from public legal resources:**
- **EU Unfair Contract Terms Directive (93/13/EEC)** — the EU's official list of terms that may be regarded as unfair. Well-structured, covers most predatory patterns. Source: EUR-Lex (public)
- **UK Consumer Rights Act 2015, Schedule 2** — Grey list of unfair terms. Clear, categorized, English-language. Source: legislation.gov.uk (public)
- **US Restatement (Second) of Contracts** — common law principles on unconscionable terms. Source: legal textbooks / summaries
- **Nolo.com / LegalZoom knowledge bases** — plain-English explanations of common contract red flags. Freely available articles
- **r/legaladvice, r/Tenant common patterns** — real-world examples of predatory clauses people actually encounter

### Curation Pipeline
1. Claude reads the public legal sources above
2. Generates structured JSON entries matching our schema
3. Human review against the quality rubric (see below)
4. Seed script populates Supabase — script lives in repo as `scripts/seed-knowledge-base.ts`

### Quality Rubric

Every knowledge base entry must pass all four checks before being included:

1. **Grounded** — The risk described is based on real law, regulation, or well-documented predatory practice. No hypotheticals.
2. **Clear to a non-lawyer** — `why_risky` must be understandable by someone with zero legal background. If you need jargon, define it inline.
3. **Actionable alternative** — `safer_alternative` must be a real, usable clause replacement — not just "negotiate better terms."
4. **Correctly categorized** — `risk_level`, `category`, and `contract_type` must be accurate. A yellow flag shouldn't be red. A lease clause shouldn't be tagged as NDA.

Entries that fail any check get revised or cut. Quality over quantity — 80 solid patterns beat 200 noisy ones.

**Contract types to cover for MVP:**
| Type | Priority | Key risk areas |
|------|----------|---------------|
| Residential lease | High | Entry rights, deposit terms, termination, maintenance, rent increases, liability |
| Freelance/contractor agreement | High | IP ownership, payment terms, non-compete, termination, liability caps |
| NDA | Medium | Scope breadth, duration, carve-outs, remedies |
| Employment contract | Medium | Non-compete, IP assignment, termination, benefits, restrictive covenants |
| Terms of Service | Low | Data usage, arbitration clauses, liability waivers, auto-renewal |

**Target: 100-200 clause patterns for MVP** — enough for meaningful RAG retrieval, small enough to curate well.

### How RAG Works in the Pipeline

1. Parse Agent splits contract into clauses
2. Each clause is embedded using Voyage AI (voyage-law-2)
3. Vector similarity search against the knowledge base finds the top-k most similar predatory patterns
4. These patterns are injected as context into the Risk Agent's prompt
5. Risk Agent uses both the clause text AND the retrieved patterns to score and explain

This means the AI isn't just relying on its training data — it has specific, curated examples of what "bad" looks like for each clause type.

## Constraints

- **File size limit**: 30 pages max per document. Covers 95% of real use cases (leases: 5-15 pages, freelance contracts: 3-10, NDAs: 2-5). Beyond 30 pages, costs spike and analysis time degrades. Clear error message shown to user.
- **No OCR**: Scanned/image-only PDFs are out of scope for MVP. Text-based PDFs only.
- **Auth-aware rate limiting**: Anonymous users get 2 analyses/day (IP-based); authenticated users get 10/day. Supabase Auth implemented with email/password and magic links; RLS enforced on all tables.

## Data Privacy

- **Encryption at rest**: All sensitive user data (extracted text, filenames, clause text, explanations, safer alternatives, storage paths) is encrypted with AES-256-GCM before writing to the database. Per-document keys are derived from a master key via HKDF-SHA256. Uploaded files are encrypted before Supabase Storage upload. SSE streams send plaintext to the client — encryption protects data at rest only.
- **IP address hashing**: IP addresses are HMAC-SHA256 hashed before storage in the rate_limits table. Not reversible — GDPR-compliant.
- **30-day auto-deletion**: A daily Vercel Cron job deletes documents, analyses, and clauses older than 30 days. Storage files are deleted from Supabase Storage. Rate limit rows older than 7 days are also purged.
- **Supabase baseline**: Supabase provides AES-256 at-rest encryption by default. Application-level encryption adds defense-in-depth — even with dashboard access, user data is unreadable.

## MVP Scope

### Must Have
- [x] Project scaffold (Next.js 15, tRPC, Drizzle, Supabase, CI pipeline)
- [x] Supabase schema (documents, analyses, embeddings, auth skeleton)
- [x] PDF, DOCX, and TXT upload + text extraction (PDF: max 30 pages; DOCX/TXT: max 90,000 chars)
- [x] Document relevance gate (is this a contract? what type?)
- [x] Knowledge base curation (100-200 patterns passing quality rubric)
- [x] Seed script (`scripts/seed-knowledge-base.ts`)
- [x] RAG with pgvector (embed clauses, retrieve similar predatory patterns)
- [x] Multi-step agent pipeline (Parse → Risk + RAG → Rewrite → Summary)
- [x] Claude-powered clause analysis with streaming (SSE)
- [x] Red/yellow/green risk scoring per clause
- [x] Plain-English explanations
- [x] Safer alternative suggestions for flagged clauses
- [x] Summary with overall risk score and sign/don't-sign recommendation
- [x] Graceful error handling at every pipeline step (see Error Handling section)
- [x] Multilingual analysis (respond in document language)
- [x] Auth-aware rate limiting (2/day anonymous, 10/day authenticated)
- [x] Legal disclaimer (visible before and after analysis)
- [x] Basic test suite (clause extraction, agent pipeline with mocked LLM)
- [x] Deployed on Vercel with live URL
- [x] GitHub Actions CI (lint + type-check + test + build)
- [ ] Clean README with architecture diagram and demo GIF

### Nice to Have (post-MVP)
- [x] Supabase Auth login flow (email/password + magic links; 10 analyses/day when authenticated)
- [x] Contract type detection influencing which patterns to retrieve
- [x] DOCX + TXT support
- [ ] Contract comparison mode
- [ ] Agent observability dashboard (/admin)
- [x] Shareable analysis URLs with OG meta tags + dynamic OG images
- [x] PDF report export (downloadable via `/api/report/[id]`)
- [ ] Jurisdiction-specific knowledge bases
- [ ] Docker Compose for local dev

## What This Is NOT
- Not a legal advice tool (disclaimer required — prominent and unavoidable)
- Not a document editor
- Not a general-purpose chat-with-PDF app
- Not a multi-tenant SaaS (yet)
