-- Row Level Security policies
-- Note: The app uses Drizzle with the service role key (bypasses RLS) for all
-- pipeline writes. These policies secure direct Supabase client access.

-- ── Documents: owner-only CRUD ─────────────────────────────
ALTER TABLE "documents" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "documents_select_own" ON "documents"
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "documents_insert_own" ON "documents"
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "documents_update_own" ON "documents"
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "documents_delete_own" ON "documents"
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- ── Analyses: public SELECT (shared URLs), owner INSERT/UPDATE ──
ALTER TABLE "analyses" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "analyses_select_public" ON "analyses"
  FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY "analyses_insert_owner" ON "analyses"
  FOR INSERT TO authenticated
  WITH CHECK (
    document_id IN (SELECT id FROM documents WHERE user_id = auth.uid())
  );

CREATE POLICY "analyses_update_owner" ON "analyses"
  FOR UPDATE TO authenticated
  USING (
    document_id IN (SELECT id FROM documents WHERE user_id = auth.uid())
  );

-- ── Clauses: public SELECT, owner INSERT via analyses join ──
ALTER TABLE "clauses" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "clauses_select_public" ON "clauses"
  FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY "clauses_insert_owner" ON "clauses"
  FOR INSERT TO authenticated
  WITH CHECK (
    analysis_id IN (
      SELECT a.id FROM analyses a
      JOIN documents d ON d.id = a.document_id
      WHERE d.user_id = auth.uid()
    )
  );

-- ── Knowledge Patterns: public SELECT ───────────────────────
ALTER TABLE "knowledge_patterns" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "knowledge_patterns_select_public" ON "knowledge_patterns"
  FOR SELECT TO anon, authenticated
  USING (true);

-- ── Rate Limits: no direct client access ────────────────────
ALTER TABLE "rate_limits" ENABLE ROW LEVEL SECURITY;
-- No policies — only accessed via service role (Drizzle)

-- ── Storage: contracts bucket policies ──────────────────────
-- Users can upload to their own folder: {userId}/{uuid}/{filename}
-- Users can read files in their own folder

CREATE POLICY "contracts_upload_own" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'contracts'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "contracts_read_own" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'contracts'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "contracts_delete_own" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'contracts'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
