-- Cleanup stale/duplicate RLS policies and fix performance issues
-- Addresses Supabase advisor findings: duplicate permissive policies,
-- auth.uid() re-evaluation per row, missing RLS on pipeline_metrics

-- ── Drop stale policies (leftover from manual edits or partial migrations) ──
DROP POLICY IF EXISTS "Anyone can view analyses" ON "analyses";
DROP POLICY IF EXISTS "Anyone can view clauses" ON "clauses";
DROP POLICY IF EXISTS "Insert via documents ownership" ON "analyses";
DROP POLICY IF EXISTS "Update via documents ownership" ON "analyses";

-- ── Fix auth.uid() performance: wrap in (SELECT ...) for InitPlan optimization ──
-- analyses_select_own
DROP POLICY IF EXISTS "analyses_select_own" ON "analyses";
CREATE POLICY "analyses_select_own" ON "analyses"
  FOR SELECT TO authenticated
  USING (
    document_id IN (SELECT id FROM documents WHERE user_id = (SELECT auth.uid()))
  );

-- analyses_insert_owner
DROP POLICY IF EXISTS "analyses_insert_owner" ON "analyses";
CREATE POLICY "analyses_insert_owner" ON "analyses"
  FOR INSERT TO authenticated
  WITH CHECK (
    document_id IN (SELECT id FROM documents WHERE user_id = (SELECT auth.uid()))
  );

-- analyses_update_owner
DROP POLICY IF EXISTS "analyses_update_owner" ON "analyses";
CREATE POLICY "analyses_update_owner" ON "analyses"
  FOR UPDATE TO authenticated
  USING (
    document_id IN (SELECT id FROM documents WHERE user_id = (SELECT auth.uid()))
  );

-- clauses_select_own
DROP POLICY IF EXISTS "clauses_select_own" ON "clauses";
CREATE POLICY "clauses_select_own" ON "clauses"
  FOR SELECT TO authenticated
  USING (
    analysis_id IN (
      SELECT a.id FROM analyses a
      JOIN documents d ON d.id = a.document_id
      WHERE d.user_id = (SELECT auth.uid())
    )
  );

-- clauses_insert_owner
DROP POLICY IF EXISTS "clauses_insert_owner" ON "clauses";
CREATE POLICY "clauses_insert_owner" ON "clauses"
  FOR INSERT TO authenticated
  WITH CHECK (
    analysis_id IN (
      SELECT a.id FROM analyses a
      JOIN documents d ON d.id = a.document_id
      WHERE d.user_id = (SELECT auth.uid())
    )
  );

-- documents policies: fix auth.uid() wrapping
DROP POLICY IF EXISTS "documents_select_own" ON "documents";
CREATE POLICY "documents_select_own" ON "documents"
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "documents_insert_own" ON "documents";
CREATE POLICY "documents_insert_own" ON "documents"
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "documents_update_own" ON "documents";
CREATE POLICY "documents_update_own" ON "documents"
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "documents_delete_own" ON "documents";
DROP POLICY IF EXISTS "Users delete own documents" ON "documents";
DROP POLICY IF EXISTS "Users insert own documents" ON "documents";
DROP POLICY IF EXISTS "Users view own documents" ON "documents";
CREATE POLICY "documents_delete_own" ON "documents"
  FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- ── Enable RLS on rate_limits (was missing) ──
-- No policies needed: only accessed via service role key (Drizzle)
-- RLS enabled = deny all via PostgREST (defense-in-depth)
ALTER TABLE "rate_limits" ENABLE ROW LEVEL SECURITY;

-- ── pipeline_metrics: add read policy for admin ──
-- Already has RLS enabled but no policies. Admin reads via service role anyway,
-- but add a restrictive policy so the advisor warning clears.
CREATE POLICY "pipeline_metrics_deny_all" ON "pipeline_metrics"
  FOR SELECT TO anon, authenticated
  USING (false);
