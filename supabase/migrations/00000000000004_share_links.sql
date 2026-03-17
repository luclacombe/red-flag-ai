-- Add sharing controls to analyses
ALTER TABLE "analyses" ADD COLUMN "is_public" boolean NOT NULL DEFAULT false;
ALTER TABLE "analyses" ADD COLUMN "share_expires_at" timestamptz;

-- Update RLS: only allow public SELECT on shared, non-expired analyses
-- (Defense-in-depth — primary access control is in tRPC procedures)
DROP POLICY IF EXISTS "analyses_select_public" ON "analyses";
CREATE POLICY "analyses_select_public" ON "analyses"
  FOR SELECT TO anon, authenticated
  USING (
    is_public = true
    AND (share_expires_at IS NULL OR share_expires_at > now())
  );

-- Owners can always SELECT their own analyses
CREATE POLICY "analyses_select_own" ON "analyses"
  FOR SELECT TO authenticated
  USING (
    document_id IN (SELECT id FROM documents WHERE user_id = auth.uid())
  );

-- Update clauses: only readable for shared analyses or owner's analyses
DROP POLICY IF EXISTS "clauses_select_public" ON "clauses";
CREATE POLICY "clauses_select_public" ON "clauses"
  FOR SELECT TO anon, authenticated
  USING (
    analysis_id IN (
      SELECT id FROM analyses
      WHERE is_public = true
      AND (share_expires_at IS NULL OR share_expires_at > now())
    )
  );

CREATE POLICY "clauses_select_own" ON "clauses"
  FOR SELECT TO authenticated
  USING (
    analysis_id IN (
      SELECT a.id FROM analyses a
      JOIN documents d ON d.id = a.document_id
      WHERE d.user_id = auth.uid()
    )
  );
