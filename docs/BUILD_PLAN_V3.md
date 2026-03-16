# RedFlag AI — V3 Build Plan (Post-MVP Features)

> This plan adds production features to the working MVP: multilingual responses, multi-format support, auth, data privacy, UI overhaul, analysis history, local dev, and observability.
> Each phase = one focused Claude Code session (Opus 4.6, 1M context).
> Start each session: `"Read docs/BUILD_PLAN_V3.md, begin Phase N"`
> End each session: quality gate passes → update checkboxes → commit

---

## Execution Order & Dependencies

```
Phase 1: Response Language Selection     (no deps)
Phase 2: DOCX + TXT Support             (no deps)
Phase 3: Shareable URLs + PDF Export     (no deps)
Phase 4: Supabase Auth                   (no deps — but Phase 5 builds on it)
Phase 5: Data Privacy Layer              (requires Phase 4)
Phase 6: UI Overhaul                     (requires Phases 1-5 — starts with planning conversation)
Phase 7: Analysis History                (requires Phase 4 + Phase 6)
Phase 8: Local Dev Setup                 (no deps — can run anytime)
Phase 9: Agent Observability Dashboard   (no deps — can run anytime)
```

Phases 1-3 are independent and can run in any order.
Phase 4 must complete before Phase 5.
Phases 1-5 must complete before Phase 6.
Phase 8 and 9 can run at any point.

---

## MCP Servers Available

Claude Code sessions have access to these MCP servers. Use them as specified:

| MCP | When to Use | Key Tools |
|-----|-------------|-----------|
| **Context7** | Look up library APIs (tRPC v11, Drizzle, Supabase SSR, Anthropic SDK, Tailwind v4, shadcn/ui). Use BEFORE guessing any API that may have changed. | `resolve-library-id` → `query-docs` |
| **Supabase** | Apply migrations directly, verify data/schema, run SQL, check extensions, manage branches. Prefer over raw SQL CLI. | `apply_migration`, `execute_sql`, `list_tables`, `list_extensions` |
| **Vercel** | Check deployments, read build/runtime logs, debug streaming issues. Use after deploying. | `get_deployment_build_logs`, `get_runtime_logs`, `deploy_to_vercel` |
| **Playwright** | Visual QA after UI changes. Screenshot at 375px (mobile) and 1280px (desktop). Navigate, interact, verify. | `browser_navigate`, `browser_take_screenshot`, `browser_resize` |
| **21st.dev Magic** | Generate polished UI components from natural language during UI phases. | `21st_magic_component_builder`, `21st_magic_component_refiner` |

---

## Quality Gate

Every phase ends with:

```bash
pnpm turbo lint type-check test build
```

Must pass before committing. No exceptions.

---

## Phase 1: Response Language Selection

**Objective:** Users choose what language Claude writes explanations in, independent of the document language. A French contract can be explained in English, or vice versa.

**Session instructions:** Read this phase. Implement sequentially. Use Context7 for Anthropic SDK docs if needed. Run quality gate. Tick boxes. Commit.

**Key decisions (pre-made from research):**
- Keep system prompt in English (Claude reasons best in English). Only the output language changes.
- `saferAlternative` rewrites stay in the document's original language — NOT the response language.
- No full i18n library (no next-intl). This is just an AI output language param.
- Default to user's browser language (`navigator.language`). Store preference in `localStorage`.
- Support 15 languages (Tier 1-2 quality from Anthropic benchmarks): English, French, German, Spanish, Italian, Portuguese, Dutch, Arabic, Chinese, Japanese, Korean, Hindi, Russian, Indonesian, Turkish.

### Tasks

#### 1.1 — Shared schemas + constants
- [x] Add `SUPPORTED_LANGUAGES` constant array in `packages/shared/src/constants.ts` — each entry: `{ code: string, name: string, nativeName: string }` for the 15 languages
- [x] Add `ResponseLanguageSchema` (Zod enum of language codes) in `packages/shared/src/schemas/`
- [x] Export from barrel file

#### 1.2 — Database migration
- [x] Add `response_language` column to `analyses` table: `text("response_language").notNull().default("en")`
- [x] Generate Drizzle migration: `pnpm drizzle-kit generate`
- [x] Apply migration via Supabase MCP `apply_migration` tool or push with `drizzle-kit push`

#### 1.3 — Agent prompts
- [x] Modify `buildCombinedSystemPrompt()` in `packages/agents/src/prompts/combined-analysis.ts`:
  - Accept `responseLanguage` as a separate param from `language` (document language)
  - Update the language instruction block:
    ```
    ## Language
    The contract is written in ${documentLanguage}. Analyze the original text directly — do not translate it.
    Write ALL explanations, category labels, top concerns, and recommendations in ${responseLanguage}.
    Write saferAlternative rewrites in the SAME language as the original clause text (${documentLanguage}), NOT in ${responseLanguage}.
    ```
- [x] Update `buildSummaryUserMessage()` in `packages/agents/src/prompts/summary.ts` — same pattern
- [x] Update orchestrator `AnalyzeContractParams` interface to accept `responseLanguage: string`
- [x] Thread `responseLanguage` through `runPipeline()` → `runCombinedAnalysis()` → prompt builder

#### 1.4 — API layer
- [x] Add `responseLanguage` to the `analysis.stream` subscription input schema (optional, defaults to `"en"`)
- [x] Thread it through to the orchestrator call
- [x] Store `responseLanguage` on the analysis record when creating/claiming
- [x] Add `responseLanguage` field to the `analysis.get` query response

#### 1.5 — Upload route
- [x] Accept optional `responseLanguage` field in the upload POST body
- [x] Pass it through to the analysis record creation
- [x] Default to `"en"` if not provided

#### 1.6 — Frontend
- [x] Create `LanguageSelector` component (~30 lines):
  - Styled `<select>` or shadcn Select with globe icon
  - Display native language names (e.g., "Français", "Deutsch")
  - No flag icons (political sensitivity)
  - Default to `navigator.language.split('-')[0]` mapped to supported codes, fall back to `"en"`
  - Persist selection to `localStorage`
- [x] Add `LanguageSelector` to the upload zone area (below or beside the file drop)
- [x] Pass selected language through the upload POST request
- [x] Show both detected document language AND response language in `SummaryPanel`

#### 1.7 — Tests
- [x] Unit test: prompt builder outputs correct language instructions for non-English responseLanguage
- [x] Unit test: `SUPPORTED_LANGUAGES` constant has all 15 entries with valid codes
- [x] Unit test: upload route accepts and stores responseLanguage
- [x] Update existing orchestrator/combined-analysis tests to pass `responseLanguage`

#### 1.8 — Documentation
- [x] Update CLAUDE.md: add `responseLanguage` to architecture notes, mention the 15-language list
- [x] Update PROJECT.md multilingual section to reflect the new response language feature

### Exit Criteria
- [x] Quality gate passes: `pnpm turbo lint type-check test build`
- [x] Can upload a PDF and select "Français" — explanations come back in French, saferAlternative stays in document language
- [x] Language preference persists across page reloads (localStorage)
- [x] Documentation updated

---

## Phase 2: DOCX + TXT Support

**Objective:** Accept .docx and .txt files in addition to PDF. The rest of the pipeline (gate, parse, analysis) is identical — only text extraction differs.

**Session instructions:** Read this phase. Implement sequentially. Use Context7 to look up `mammoth` if needed. Run quality gate. Tick boxes. Commit.

**Key decisions (pre-made from research):**
- DOCX: Use `mammoth` library — mature, lightweight, pure JS (works on Vercel serverless). Extract raw text only (no HTML).
- TXT: Read as UTF-8 string directly. No library needed.
- DOCX magic bytes: First 4 bytes are `PK\x03\x04` (ZIP format). MIME: `application/vnd.openxmlformats-officedocument.wordprocessingml.document`.
- TXT MIME: `text/plain`. No magic bytes check needed.
- Page count limit: Keep 30-page limit for PDF. For DOCX/TXT, use character count equivalent (~3000 chars/page → 90,000 char limit).

### Tasks

#### 2.1 — Install mammoth
- [x] `pnpm add mammoth --filter @redflag/web` (used in the upload route handler)
- [x] Verify it's pure JS (no native bindings) — it is, but confirm for Vercel compatibility

#### 2.2 — Shared constants
- [x] Add to `packages/shared/src/constants.ts`:
  - `ACCEPTED_MIME_TYPES`: `['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain']`
  - `MAX_TEXT_LENGTH = 90_000` (character limit for DOCX/TXT, equivalent to ~30 pages)
  - `DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'`
  - `TXT_MIME = 'text/plain'`
- [x] Export from barrel

#### 2.3 — Upload route refactor
- [x] Refactor `apps/web/app/api/upload/route.ts` to support three file types:
  - **PDF path (existing):** MIME check → magic bytes (`%PDF-`) → unpdf extraction → page count check
  - **DOCX path (new):** MIME check → magic bytes (`PK\x03\x04`) → `mammoth.extractRawText()` → character count check
  - **TXT path (new):** MIME check → `Buffer.toString('utf-8')` → character count check
- [x] Unify post-extraction: empty text check (≥50 chars), then gate → store → analyze (same as PDF)
- [x] Update Storage path: keep `contracts/` bucket, use original file extension in storage path
- [x] Update error messages: "Upload a PDF, DOCX, or TXT file" instead of "Upload a PDF"

#### 2.4 — Frontend upload zone
- [x] Update `UploadZone` component `accept` attribute: `.pdf,.docx,.txt`
- [x] Update file type validation in the client-side check
- [x] Update drag-and-drop messaging and icons to reflect multi-format support
- [x] Update error messages for invalid file types

#### 2.5 — Document schema
- [x] Add `fileType` column to `documents` table: `text("file_type").notNull().default("pdf")`
- [x] Generate + apply Drizzle migration
- [x] Set `fileType` in the upload route based on detected MIME

#### 2.6 — Tests
- [x] Unit test: DOCX upload extracts text correctly (mock mammoth)
- [x] Unit test: TXT upload reads UTF-8 text
- [x] Unit test: DOCX magic bytes validation (PK header)
- [x] Unit test: Character count limit enforced for DOCX/TXT
- [x] Unit test: Rejects unsupported file types with clear error
- [x] Update existing upload tests to cover new file types

#### 2.7 — Documentation
- [x] Update CLAUDE.md: add mammoth dependency, DOCX/TXT support notes
- [x] Update PROJECT.md: "User uploads a contract (PDF, DOCX, or TXT)"

### Exit Criteria
- [x] Quality gate passes: `pnpm turbo lint type-check test build`
- [ ] Can upload a .docx file → full analysis pipeline runs successfully
- [ ] Can upload a .txt file → full analysis pipeline runs successfully
- [x] Invalid file types rejected with clear error message
- [x] Documentation updated

---

## Phase 3: Shareable URLs + PDF Export

**Objective:** Users can share analysis results via URL and download a PDF report. This is the primary growth mechanic — shared links bring new users.

**Session instructions:** Read this phase. Implement sequentially. Use Context7 for `@react-pdf/renderer` docs. Run quality gate. Tick boxes. Commit.

**Key decisions (pre-made from research):**
- Analysis pages (`/analysis/[id]`) already work by ID. Make them publicly accessible (no auth required to view).
- Add Open Graph meta tags for rich link previews (Twitter/LinkedIn/Slack).
- PDF export: Use `@react-pdf/renderer` — pure JS, works on Vercel serverless, no puppeteer/Chrome needed.
- Add a share button (copy URL) + download PDF button to the analysis page.

### Tasks

#### 3.1 — Public analysis pages
- [x] Ensure `/analysis/[id]` pages work without authentication (they already do in MVP — verify this continues to work after Phase 4 adds auth)
- [x] Add dynamic Open Graph meta tags to `apps/web/app/analysis/[id]/page.tsx`:
  - `og:title`: "Contract Analysis — RedFlag AI"
  - `og:description`: Dynamic — "{contractType} analysis: {riskScore}/100 risk score — {recommendation}"
  - `og:image`: Generate a simple OG image (static template with risk score overlay, or use Vercel OG)
  - `og:url`: The analysis page URL
- [x] Create a server component that fetches analysis data for metadata generation (Next.js `generateMetadata`)

#### 3.2 — Share functionality
- [x] Add "Share" button to the analysis page header (after analysis completes)
- [x] On click: copy URL to clipboard, show brief toast/confirmation "Link copied!"
- [x] Use `navigator.clipboard.writeText()` — no library needed

#### 3.3 — PDF report generation
- [x] Install `@react-pdf/renderer`: `pnpm add @react-pdf/renderer --filter @redflag/web`
- [x] Create `apps/web/app/api/report/[id]/route.ts` — a GET route handler that:
  1. Fetches analysis + clauses from DB
  2. Renders a PDF using `@react-pdf/renderer`'s `renderToBuffer()`
  3. Returns the buffer with `Content-Type: application/pdf` and `Content-Disposition: attachment`
- [x] Design the PDF report layout:
  - Header: "RedFlag AI — Contract Analysis Report"
  - Summary section: risk score, recommendation, contract type, language, date
  - Clause list: each clause with risk badge (colored text, since PDF doesn't support HTML), explanation, safer alternative
  - Footer: legal disclaimer, "Generated by RedFlag AI"
- [x] Add "Download PDF" button to the analysis page (next to Share button)
- [x] Link to `/api/report/[id]` — triggers browser download

#### 3.4 — OG Image generation (optional, skip if time-constrained)
- [x] Use Vercel OG (`@vercel/og`) or a static template image
- [x] Generate dynamic OG image showing: risk score gauge + recommendation badge
- [x] Route: `apps/web/app/api/og/[id]/route.ts`

#### 3.5 — Tests
- [x] Unit test: `generateMetadata` returns correct OG tags for a given analysis
- [x] Unit test: PDF report route returns valid PDF buffer with correct headers
- [x] Unit test: Share URL copy (if testable — may be integration-only)

#### 3.6 — Documentation
- [x] Update CLAUDE.md: add `@react-pdf/renderer` dependency, OG image route, report route
- [x] Update PROJECT.md: add sharing/export to feature list

### Exit Criteria
- [x] Quality gate passes: `pnpm turbo lint type-check test build`
- [x] Analysis page has rich link previews when shared (test with OpenGraph debugger)
- [x] "Share" button copies URL to clipboard
- [x] "Download PDF" button downloads a formatted report
- [x] Documentation updated

---

## Phase 4: Supabase Auth

**Objective:** Add email/password + magic link authentication. Protect user data with Row Level Security. Gate analysis count by auth status (anonymous: 2/day, authenticated: 10/day).

**Session instructions:** Read this phase carefully — auth touches every layer. Use Context7 to look up `@supabase/ssr` (NOT `@supabase/auth-helpers-nextjs` — that's deprecated). Use Supabase MCP to apply RLS policies. Implement top-to-bottom. Run quality gate. Tick boxes. Commit.

**Key decisions (pre-made from research):**
- Use `@supabase/ssr` (replaces deprecated `@supabase/auth-helpers-nextjs`)
- Email/password + magic links (both enabled by default in Supabase). Google OAuth as stretch.
- Middleware refreshes session on every request via `getUser()` call
- Pipeline writes use Drizzle (direct Postgres connection, bypasses RLS). RLS protects the Supabase client/Storage layer.
- `protectedProcedure` in tRPC for auth-gated endpoints. `publicProcedure` for viewing shared analyses.
- Shared analysis pages (`/analysis/[id]`) remain publicly viewable — no auth required to VIEW, only to CREATE.
- New env var: `NEXT_PUBLIC_SUPABASE_ANON_KEY` (the anon/publishable key, safe for client)

### Tasks

#### 4.1 — Install @supabase/ssr
- [x] `pnpm add @supabase/ssr --filter @redflag/web`
- [x] Add `NEXT_PUBLIC_SUPABASE_ANON_KEY` to `.env.example` and Vercel env vars (via Vercel MCP or dashboard)

#### 4.2 — Supabase client utilities
- [x] Create `apps/web/src/lib/supabase/client.ts` — browser client using `createBrowserClient()` from `@supabase/ssr`
- [x] Create `apps/web/src/lib/supabase/server.ts` — server client using `createServerClient()` with cookie getAll/setAll from `next/headers`
- [x] Create `apps/web/src/lib/supabase/middleware.ts` — session refresh logic:
  - Creates Supabase server client with request/response cookie bridge
  - Calls `supabase.auth.getUser()` to refresh token
  - Redirects unauthenticated users to `/login` (except for public routes: `/`, `/login`, `/auth/*`, `/analysis/*`, `/api/*`)
  - **Critical:** No code between `createServerClient()` and `getUser()` — the refresh must happen immediately

#### 4.3 — Next.js middleware
- [x] Create `apps/web/middleware.ts` (project root of apps/web):
  - Import and call `updateSession()` from the supabase middleware utility
  - Matcher excludes static assets, images, favicon
  - **Note:** Analysis pages (`/analysis/*`) and API routes (`/api/*`) are NOT gated — they must remain accessible for shared links and SSE subscriptions

#### 4.4 — Auth pages
- [x] Create `apps/web/app/login/page.tsx`:
  - Email + password form
  - "Sign in with magic link" option
  - "Create account" link → `/signup`
  - Redirect to `/` on success
  - Styled to match existing design (dark hero section aesthetic)
- [x] Create `apps/web/app/signup/page.tsx`:
  - Email + password registration form
  - "Already have an account?" link → `/login`
  - Redirect to `/` on success with confirmation message
- [x] Create `apps/web/app/auth/callback/route.ts`:
  - Exchange auth code for session (required for magic links + OAuth)
  - Redirect to `next` param or `/`
- [x] Create `apps/web/app/auth/confirm/route.ts`:
  - Handle email confirmation redirect from Supabase
  - Exchange token hash for session

#### 4.5 — tRPC context integration
- [x] Update `packages/api/src/trpc.ts` to extract user from request cookies:
  - Parse cookies from request headers via `@supabase/ssr` `parseCookieHeader`
  - Create Supabase server client
  - Call `getUser()` to get authenticated user (or null)
  - Return `{ user: User | null }` in context
- [x] Add `protectedProcedure` that throws `UNAUTHORIZED` if `!ctx.user`
- [x] Keep `publicProcedure` for unauthenticated access (viewing shared analyses)
- [x] `analysis.get` remains public (shared analysis pages)
- [x] `analysis.stream` checks auth for new analyses but allows replaying completed ones without auth

#### 4.6 — Upload route auth
- [x] Update `apps/web/app/api/upload/route.ts`:
  - Create Supabase server client from request cookies
  - Call `getUser()` — if authenticated, set `userId` on document record
  - If not authenticated, continue with anonymous flow (IP-based rate limiting, nullable userId)
  - Authenticated users get higher rate limit (10/day vs 2/day)
- [x] Update Storage path to include user ID: `{userId}/{uuid}/{filename}` for auth users, `anonymous/{uuid}/{filename}` for anon

#### 4.7 — Rate limit upgrade
- [x] Update `packages/api/src/rateLimit.ts`:
  - Accept optional `isAuthenticated` param
  - If user is authenticated, rate limit by userId with 10/day limit
  - If anonymous, keep existing IP-based 2/day limit
  - Reuses existing `rate_limits` table (ipAddress column stores userId for auth users)

#### 4.8 — NavBar auth state
- [x] Update `NavBar` component to show auth state:
  - Unauthenticated: "Sign In" button → `/login`
  - Authenticated: user email + "Sign Out" button
  - Sign out calls `supabase.auth.signOut()` and redirects to `/`

#### 4.9 — Row Level Security
- [x] Apply RLS policies via Supabase MCP `execute_sql`:

  **Documents table:**
  ```sql
  ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
  -- Authenticated users see own documents
  CREATE POLICY "Users view own documents" ON documents FOR SELECT TO authenticated
    USING ((select auth.uid()) = user_id);
  -- Anonymous documents (user_id IS NULL) are not visible via Supabase client
  -- (but Drizzle bypasses RLS, so pipeline still works)
  CREATE POLICY "Users insert own documents" ON documents FOR INSERT TO authenticated
    WITH CHECK ((select auth.uid()) = user_id);
  CREATE POLICY "Users delete own documents" ON documents FOR DELETE TO authenticated
    USING ((select auth.uid()) = user_id);
  ```

  **Analyses table:**
  ```sql
  ALTER TABLE analyses ENABLE ROW LEVEL SECURITY;
  -- Public read for shared analysis pages
  CREATE POLICY "Anyone can view analyses" ON analyses FOR SELECT TO authenticated, anon
    USING (true);
  CREATE POLICY "Insert via documents ownership" ON analyses FOR INSERT TO authenticated
    WITH CHECK (document_id IN (SELECT id FROM documents WHERE user_id = (select auth.uid())));
  CREATE POLICY "Update via documents ownership" ON analyses FOR UPDATE TO authenticated
    USING (document_id IN (SELECT id FROM documents WHERE user_id = (select auth.uid())));
  ```

  **Clauses table:**
  ```sql
  ALTER TABLE clauses ENABLE ROW LEVEL SECURITY;
  -- Public read for shared analysis pages
  CREATE POLICY "Anyone can view clauses" ON clauses FOR SELECT TO authenticated, anon
    USING (true);
  ```

  **Knowledge patterns:**
  ```sql
  ALTER TABLE knowledge_patterns ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "Public read" ON knowledge_patterns FOR SELECT TO authenticated, anon
    USING (true);
  ```

  **Storage bucket:**
  ```sql
  CREATE POLICY "Users upload to own folder" ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'contracts' AND (storage.foldername(name))[1] = (select auth.uid())::text);
  CREATE POLICY "Users read own files" ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'contracts' AND (storage.foldername(name))[1] = (select auth.uid())::text);
  ```

- [x] Add index on `documents.user_id`: `CREATE INDEX documents_user_id_idx ON documents(user_id);`
- [x] Verify with Supabase MCP `execute_sql`: `SELECT tablename, policyname FROM pg_policies;`

#### 4.10 — Tests
- [x] Unit test: tRPC `protectedProcedure` rejects null user
- [x] Unit test: upload route sets userId when authenticated
- [x] Unit test: rate limit uses userId for auth users, IP for anon
- [ ] Unit test: auth callback exchanges code for session
- [x] Update all existing tests that mock tRPC context to include `user: null`

#### 4.11 — Documentation
- [x] Update CLAUDE.md: add `@supabase/ssr` dep, middleware pattern, auth file structure, RLS notes, protectedProcedure
- [ ] Update PROJECT.md: mark auth as complete, update constraints section
- [x] Update `.env.example` with `NEXT_PUBLIC_SUPABASE_ANON_KEY`

### Exit Criteria
- [x] Quality gate passes: `pnpm turbo lint type-check test build`
- [ ] Can create account with email/password → redirects to home → NavBar shows user
- [ ] Can sign in with magic link → email received (check Supabase dashboard or Mailpit if local)
- [ ] Authenticated user can upload → analysis is linked to their account
- [ ] Anonymous user can still upload (2/day limit), authenticated gets 10/day
- [ ] Shared analysis pages (`/analysis/[id]`) work without auth
- [x] RLS policies active — verify with Supabase MCP `execute_sql`
- [x] Documentation updated

---

## Phase 5: Data Privacy Layer

**Objective:** Encrypt sensitive user data at rest. Hash IP addresses. Implement auto-deletion. Admin cannot read user contracts from Supabase dashboard.

**Session instructions:** Read this phase carefully. The encryption layer touches the data access path for uploads, pipeline writes, and reads. Use Context7 for Node.js `crypto` module docs if needed. Test encryption/decryption round-trips thoroughly. Run quality gate. Tick boxes. Commit.

**Key decisions (pre-made from research):**
- **Application-level encryption** using Node.js `crypto` (AES-256-GCM). NOT pgcrypto — keys never touch the DB.
- **HKDF key derivation** from a single master key env var. Per-document keys derived using document ID as salt.
- **HMAC-SHA256** for IP address hashing (GDPR-compliant — resistant to rainbow tables unlike plain SHA-256).
- **30-day auto-deletion** via Vercel Cron job.
- Supabase's built-in AES-256 at-rest encryption provides the baseline. This phase adds defense-in-depth.
- Encrypted fields stored as text (`iv.tag.ciphertext` base64 format). Column types unchanged.

**What gets encrypted:**

| Field | Table | Encrypted? |
|-------|-------|-----------|
| `extractedText` | documents | Yes |
| `filename` | documents | Yes |
| `storagePath` | documents | Yes (so attacker can't find the file) |
| `clauseText` | clauses | Yes |
| `explanation` | clauses | Yes |
| `saferAlternative` | clauses | Yes |
| `summaryText` | analyses | Yes |
| `topConcerns` | analyses | Yes |
| `parsedClauses` | analyses | Yes |
| `errorMessage` | analyses | No (doesn't contain user data) |
| `ipAddress` | rate_limits | HMAC-hashed (not encrypted) |
| Uploaded PDF/DOCX/TXT | Storage | Yes (encrypted before upload) |

**What stays plaintext** (needed for queries/indexes): `id`, `userId`, `status`, `riskLevel`, `category`, `position`, `startIndex`, `endIndex`, `overallRiskScore`, `recommendation`, `pageCount`, `language`, `contractType`, `createdAt`, `updatedAt`.

### Tasks

#### 5.1 — Encryption utilities
- [ ] Create `packages/shared/src/crypto.ts`:
  - `getMasterKey()`: reads `MASTER_ENCRYPTION_KEY` env var (64-char hex → 32 bytes)
  - `deriveKey(masterKey, salt, info)`: HKDF-SHA256, returns 32-byte Buffer
  - `encrypt(plaintext, key)`: AES-256-GCM, returns `"iv.tag.ciphertext"` (base64 dot-separated)
  - `decrypt(ciphertext, key)`: Parses format, returns plaintext string
  - `encryptBuffer(buffer, key)`: For file encryption, returns encrypted Buffer with prepended IV + tag
  - `decryptBuffer(encrypted, key)`: Reverse of encryptBuffer
  - `hashIp(ip, key)`: HMAC-SHA256, returns hex string
  - All functions use `node:crypto` — zero dependencies
- [ ] Add `MASTER_ENCRYPTION_KEY` to `.env.example` with generation command: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- [ ] Export from `@redflag/shared` barrel

#### 5.2 — Database schema changes
- [ ] Add `keyVersion` column to `documents` table: `integer("key_version").notNull().default(1)` (for future key rotation)
- [ ] Change `parsedClauses` column type from `jsonb` to `text` in analyses (encrypted JSON is stored as text)
- [ ] Generate + apply Drizzle migration
- [ ] **Note:** No column type changes needed for other fields — encrypted text (base64) fits in `text` columns

#### 5.3 — Encrypt at write: upload route
- [ ] In `apps/web/app/api/upload/route.ts`:
  - After text extraction, derive document key: `deriveKey(masterKey, documentId, "document")`
  - Encrypt the file buffer before Supabase Storage upload
  - Encrypt `extractedText` and `filename` before inserting into documents table
  - Encrypt `storagePath` before storing (decrypt it when you need to delete the file later)
  - Keep plaintext `extractedText` in memory for the gate agent (don't re-read from DB)

#### 5.4 — Encrypt at write: pipeline
- [ ] In `packages/agents/src/orchestrator.ts` (or wherever clauses are persisted):
  - Encrypt `clauseText`, `explanation`, `saferAlternative` before DB insert
  - Encrypt `parsedClauses` (serialize to JSON string first, then encrypt) before updating analyses
  - Encrypt `summaryText` and `topConcerns` (JSON string) before updating analyses
  - **Important:** The SSE stream sends plaintext to the client — encryption is only for at-rest storage

#### 5.5 — Decrypt at read: API layer
- [ ] In the `analysis.get` query (packages/api/src/routers/analysis.ts):
  - After fetching from DB, decrypt all encrypted fields before returning to client
  - Derive the key using the document's ID
- [ ] In the `analysis.stream` subscription replay path (when replaying from DB on reconnect):
  - Decrypt clause fields before yielding to SSE stream
- [ ] Create a helper: `decryptClause(clause, key)` and `decryptAnalysis(analysis, key)` to keep it DRY

#### 5.6 — HMAC IP addresses
- [ ] Update `packages/api/src/rateLimit.ts`:
  - Hash IP with `hashIp(ip, deriveKey(masterKey, "rate-limit", "ip-hash"))` before any DB operation
  - Rate limit lookups use the hashed IP
  - Existing raw IPs in the table: run a one-time migration to hash them, or just truncate the table (it's ephemeral data)

#### 5.7 — Auto-deletion (Vercel Cron)
- [ ] Create `apps/web/app/api/cron/cleanup/route.ts`:
  - GET handler (Vercel Cron sends GET)
  - Verify `CRON_SECRET` header (Vercel sets this for cron endpoints)
  - Query documents older than 30 days
  - For each: decrypt `storagePath`, delete from Supabase Storage, then delete document (CASCADE handles analyses + clauses)
  - Also delete `rate_limits` rows older than 7 days
  - Log counts for observability
- [ ] Add to `vercel.json`:
  ```json
  { "crons": [{ "path": "/api/cron/cleanup", "schedule": "0 2 * * *" }] }
  ```
- [ ] Add `CRON_SECRET` to `.env.example`

#### 5.8 — Tests
- [ ] Unit test: `encrypt` → `decrypt` round-trip preserves plaintext
- [ ] Unit test: `encryptBuffer` → `decryptBuffer` round-trip for files
- [ ] Unit test: Different document IDs produce different derived keys
- [ ] Unit test: `hashIp` produces consistent output for same IP + key
- [ ] Unit test: `hashIp` produces different output for different IPs
- [ ] Unit test: Decryption with wrong key throws (GCM auth tag verification)
- [ ] Unit test: Cron cleanup deletes old documents and rate limits
- [ ] Integration test: Upload → pipeline → get analysis round-trip works with encryption
- [ ] Update existing tests to handle encrypted fields (mock the crypto utilities)

#### 5.9 — Documentation
- [ ] Update CLAUDE.md: add encryption architecture, key derivation strategy, encrypted fields list, cron job
- [ ] Update PROJECT.md: add data privacy section (30-day retention, encryption at rest, IP hashing)
- [ ] Add `MASTER_ENCRYPTION_KEY` and `CRON_SECRET` to env vars table in CLAUDE.md

### Exit Criteria
- [ ] Quality gate passes: `pnpm turbo lint type-check test build`
- [ ] Upload a document → check Supabase dashboard → extracted text, clause text, explanations are all encrypted gibberish (not readable)
- [ ] IP addresses in rate_limits are 64-char hex hashes, not raw IPs
- [ ] Analysis page still renders correctly (decryption works on the API read path)
- [ ] Cron endpoint responds correctly when called manually
- [ ] Documentation updated

---

## Phase 6: UI Overhaul

**Objective:** Complete visual redesign of the application. This phase is unique — it starts with a planning conversation before any code is written.

**Session instructions:** This phase is DIFFERENT from others. Do NOT start coding immediately.

### Step 1: Enter plan mode and have a conversation with the user

- [ ] **Enter plan mode** at the start of this session
- [ ] Review the current UI by using Playwright MCP to screenshot every page/state:
  - Home page (desktop 1280px + mobile 375px)
  - Upload zone in each state (idle, drag-over, uploading, processing, error)
  - Analysis page during streaming (skeleton cards, partial results)
  - Analysis page when complete (full results with summary)
  - Login page, signup page
- [ ] Present the screenshots to the user and discuss:
  - What they like / want to keep
  - What they want to change
  - Visual references or design inspiration they have
  - Brand direction (colors, typography, tone)
  - Specific components that need redesign vs. new components needed
- [ ] Use 21st.dev Magic MCP for component inspiration based on the discussion
- [ ] Write a detailed UI design spec based on the conversation (save as `docs/UI_SPEC.md`)
- [ ] Get user approval on the spec before proceeding
- [ ] **Exit plan mode** and begin implementation

### Step 2: Implement the redesign

- [ ] Implement the approved design spec
- [ ] Use 21st.dev Magic for component generation where appropriate
- [ ] After each major component change, use Playwright to screenshot and verify
- [ ] Test at both 375px and 1280px breakpoints
- [ ] Ensure all existing functionality still works (streaming, upload, auth, sharing, PDF export, language selector)

### Step 3: Polish and QA

- [ ] Full Playwright visual QA pass: every page, every state, both breakpoints
- [ ] Verify animations respect `prefers-reduced-motion`
- [ ] Check color contrast for accessibility (WCAG AA minimum)
- [ ] Test the complete user flow: land → upload → stream → results → share → download PDF

### Exit Criteria
- [ ] Quality gate passes: `pnpm turbo lint type-check test build`
- [ ] UI spec document exists at `docs/UI_SPEC.md`
- [ ] All pages screenshot-verified at mobile and desktop widths
- [ ] User approves the final visual result
- [ ] Documentation updated

---

## Phase 7: Analysis History

**Objective:** Authenticated users see a list of their past analyses. This makes the app feel like a persistent tool, not a one-shot demo.

**Session instructions:** Read this phase. This builds on Phase 4 (auth) and Phase 6 (UI). Use the design language established in Phase 6. Run quality gate. Tick boxes. Commit.

### Tasks

#### 7.1 — API endpoint
- [ ] Add `analysis.list` query to the analysis router (protectedProcedure):
  - Input: optional pagination params (`cursor`, `limit` default 20)
  - Fetches analyses joined with documents for the authenticated user
  - Returns: `{ items: Array<{ id, documentName, contractType, riskScore, recommendation, status, createdAt }>, nextCursor }`
  - Ordered by `createdAt` DESC
  - **Decrypt** document filename before returning (encrypted in Phase 5)

#### 7.2 — History page
- [ ] Create `apps/web/app/history/page.tsx`:
  - Server component shell, client component for data fetching
  - Uses `analysis.list` tRPC query with infinite scroll or "Load more" button
  - Each item: document name, contract type badge, risk score, recommendation badge, date, "View" link
  - Empty state: "No analyses yet. Upload your first contract."
  - Loading state: skeleton cards
- [ ] Gate behind auth — redirect to `/login` if not authenticated (middleware already handles this if `/history` is not in the public routes list)

#### 7.3 — Delete functionality
- [ ] Add `analysis.delete` mutation to the analysis router (protectedProcedure):
  - Input: `{ analysisId: string }`
  - Verify ownership (document.userId matches ctx.user.id)
  - Decrypt storagePath → delete from Supabase Storage
  - Delete document record (CASCADE deletes analyses + clauses)
- [ ] Add delete button to each history item (with confirmation dialog)
- [ ] Add "Delete" button to the analysis page itself

#### 7.4 — NavBar update
- [ ] Add "History" link to NavBar (only visible when authenticated)
- [ ] Link to `/history`

#### 7.5 — Tests
- [ ] Unit test: `analysis.list` returns only the authenticated user's analyses
- [ ] Unit test: `analysis.delete` rejects if user doesn't own the analysis
- [ ] Unit test: `analysis.delete` cascades correctly (document → analyses → clauses + storage)

#### 7.6 — Documentation
- [ ] Update CLAUDE.md: add history route, analysis.list/delete procedures
- [ ] Update PROJECT.md: add analysis history to feature list

### Exit Criteria
- [ ] Quality gate passes: `pnpm turbo lint type-check test build`
- [ ] Authenticated user sees past analyses on `/history`
- [ ] Can delete an analysis (document + storage file removed)
- [ ] Empty state renders correctly for new users
- [ ] History page matches Phase 6 design language
- [ ] Documentation updated

---

## Phase 8: Local Dev Setup

**Objective:** One-command local development using `supabase start`. Contributors can clone and run without a Supabase cloud account.

**Session instructions:** Read this phase. Use Supabase MCP `search_docs` for CLI references if needed. Test the full local flow end-to-end. Run quality gate. Tick boxes. Commit.

**Key decisions (pre-made from research):**
- Use `supabase start` (the official CLI), NOT a custom `docker-compose.yml`. The CLI manages Docker internally.
- pgvector is pre-installed in the Supabase local Docker image. Just needs `CREATE EXTENSION` in a migration.
- Seed data needs Voyage AI API for embeddings — provide two paths: (A) run `pnpm run seed` with API key, or (B) use a pre-computed SQL dump.
- Local Supabase URLs: API on port 54321, Postgres on port 54322, Studio on port 54323.

### Tasks

#### 8.1 — Supabase CLI init
- [ ] Run `supabase init` in the project root (creates `supabase/config.toml`)
- [ ] Configure `config.toml`:
  - Set project name to `red-flag-ai`
  - Configure auth settings (enable email provider, disable phone)
  - Configure storage bucket `contracts` (10MB limit, PDF + DOCX + TXT MIME types)

#### 8.2 — Migrate Drizzle migrations to Supabase format
- [ ] Create `supabase/migrations/` directory
- [ ] Create `00000000000000_enable_extensions.sql`: `CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;`
- [ ] Convert existing Drizzle SQL migrations into numbered Supabase migration files
- [ ] Include RLS policies from Phase 4 in the appropriate migration
- [ ] Verify: `supabase start` → `supabase db reset` applies all migrations cleanly

#### 8.3 — Seed data
- [ ] Create `supabase/seed.sql` with pre-computed knowledge patterns including embeddings:
  - Export current production patterns: `SELECT * FROM knowledge_patterns` → format as INSERT statements
  - Include the embeddings as array literals
  - This enables fully offline local dev (no Voyage API key needed for seed)
- [ ] Keep existing `pnpm run seed` as the "live" seeding option (calls Voyage API)

#### 8.4 — Environment configuration
- [ ] Create `.env.development` with local Supabase URLs:
  ```
  NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
  NEXT_PUBLIC_SUPABASE_ANON_KEY=<from supabase start output>
  SUPABASE_SERVICE_ROLE_KEY=<from supabase start output>
  DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
  NEXT_PUBLIC_APP_URL=http://localhost:3000
  ```
- [ ] Update `packages/db/src/client.ts` to handle local connection (no `{ prepare: false }` needed locally, but harmless to keep)

#### 8.5 — Developer scripts
- [ ] Add to root `package.json` scripts:
  - `"supabase:start": "supabase start"`
  - `"supabase:stop": "supabase stop"`
  - `"supabase:reset": "supabase db reset"`
  - `"setup": "supabase start && pnpm install && echo 'Copy .env.development to .env.local and add your API keys'"` — one-command setup
- [ ] Verify full flow: `supabase start` → `pnpm dev` → upload PDF → analysis completes

#### 8.6 — README
- [ ] Write (or update) `README.md` with:
  - Quick start: prerequisites (Node 22, pnpm, Docker, Supabase CLI) → `pnpm run setup` → add API keys → `pnpm dev`
  - Architecture overview (brief — link to CLAUDE.md for details)
  - Environment variables table with descriptions
  - Available commands
  - Contributing guidelines
  - Tech stack badges

#### 8.7 — .gitignore update
- [ ] Ensure `supabase/.temp/` is in `.gitignore` (Supabase CLI temp files)
- [ ] Ensure `.env.local`, `.env.development.local` are gitignored

#### 8.8 — Tests
- [ ] Verify: `supabase start` → `supabase db reset` → all migrations apply → seed data present
- [ ] Verify: `pnpm dev` connects to local Supabase successfully
- [ ] Verify: full upload → analysis flow works against local Supabase

### Exit Criteria
- [ ] Quality gate passes: `pnpm turbo lint type-check test build`
- [ ] Fresh clone → `supabase start` → `pnpm install` → `pnpm dev` → working app
- [ ] Knowledge base seeded (via seed.sql or pnpm run seed)
- [ ] README has clear setup instructions
- [ ] Documentation updated

---

## Phase 9: Agent Observability Dashboard

**Objective:** Admin page showing pipeline health metrics — timing, token usage, error rates, contract type distribution. Internal tool, does not need to be polished.

**Session instructions:** Read this phase. This is an admin-only feature. Functionality over aesthetics. Use Supabase MCP to query data. Run quality gate. Tick boxes. Commit.

### Tasks

#### 9.1 — Pipeline metrics table
- [ ] Create Drizzle migration for `pipeline_metrics` table:
  ```
  id: uuid PK
  analysisId: uuid FK → analyses
  step: text (gate, parse, combined_analysis, summary_fallback)
  durationMs: integer
  inputTokens: integer
  outputTokens: integer
  model: text (haiku, sonnet)
  success: boolean
  errorMessage: text (nullable)
  createdAt: timestamp
  ```
- [ ] Apply migration

#### 9.2 — Instrument the pipeline
- [ ] Update orchestrator to record timing + token usage for each step:
  - Gate agent: duration, tokens, success
  - Smart parse: duration, tokens (if Haiku fallback used), heuristic-only flag
  - Combined analysis: duration, total tokens, clause count
  - Summary fallback (if triggered): duration, tokens
- [ ] Insert metrics into `pipeline_metrics` after each step completes
- [ ] Use `response.usage` from the Anthropic SDK for token counts

#### 9.3 — Admin API
- [ ] Create `admin` tRPC router with protectedProcedure (plus admin check — hardcode your email for MVP):
  - `admin.metrics`: Aggregated stats over time period (last 24h, 7d, 30d)
    - Total analyses, success rate, avg duration by step
    - Total tokens used (input + output), estimated cost
    - Contract type distribution
    - Error breakdown by step
  - `admin.recentAnalyses`: Last 50 analyses with per-step timing
  - `admin.errors`: Recent errors with stack traces

#### 9.4 — Admin page
- [ ] Create `apps/web/app/admin/page.tsx`:
  - Gate behind admin email check (redirect non-admins)
  - Stats cards: total analyses, success rate, avg total duration, estimated cost
  - Table: recent analyses with step-by-step timing breakdown
  - Error log: recent failures with step + error message
  - Simple Tailwind table/card layout — no charting library needed
- [ ] No link in NavBar — accessed by direct URL only (`/admin`)

#### 9.5 — Tests
- [ ] Unit test: pipeline metrics are recorded correctly
- [ ] Unit test: admin router rejects non-admin users
- [ ] Unit test: metrics aggregation query returns correct shape

#### 9.6 — Documentation
- [ ] Update CLAUDE.md: add `pipeline_metrics` table, admin router, observability notes

### Exit Criteria
- [ ] Quality gate passes: `pnpm turbo lint type-check test build`
- [ ] `/admin` shows pipeline metrics for recent analyses
- [ ] Non-admin users are redirected away from `/admin`
- [ ] Token usage and timing visible per analysis step
- [ ] Documentation updated

---

## Appendix A: New Environment Variables (All Phases)

| Variable | Phase | Required | Description |
|----------|-------|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 4 | Yes | Supabase publishable/anon key (safe for client) |
| `MASTER_ENCRYPTION_KEY` | 5 | Yes | 32 random bytes, hex-encoded (64 chars). Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `CRON_SECRET` | 5 | Yes (prod) | Vercel Cron secret for auto-deletion endpoint |
| `ADMIN_EMAIL` | 9 | No | Email address for admin dashboard access |

## Appendix B: New Dependencies (All Phases)

| Package | Phase | Where | Why |
|---------|-------|-------|-----|
| `@supabase/ssr` | 4 | apps/web | Auth session management (replaces deprecated auth-helpers) |
| `mammoth` | 2 | apps/web | DOCX text extraction |
| `@react-pdf/renderer` | 3 | apps/web | PDF report generation |

## Appendix C: Database Migrations (All Phases)

| Phase | Migration | Changes |
|-------|-----------|---------|
| 1 | Add response_language | `analyses.response_language` text NOT NULL DEFAULT 'en' |
| 2 | Add file_type | `documents.file_type` text NOT NULL DEFAULT 'pdf' |
| 5 | Add key_version, change parsedClauses | `documents.key_version` integer NOT NULL DEFAULT 1, `analyses.parsed_clauses` text (from jsonb) |
| 9 | Create pipeline_metrics | New table for observability |
