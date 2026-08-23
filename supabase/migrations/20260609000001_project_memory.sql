-- Project Memory & Architecture Decision Records
-- Enables Coden to persist architectural decisions, preferences, and known failure
-- modes between sessions so the AI doesn't repeat the same mistakes or override
-- previously confirmed technical choices.

CREATE TABLE IF NOT EXISTS public.project_memory (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  memory_type TEXT NOT NULL CHECK (memory_type IN ('adr', 'preference', 'blocker', 'pattern')),
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast per-project lookups ordered by recency
CREATE INDEX IF NOT EXISTS project_memory_project_id_created_at_idx
  ON public.project_memory (project_id, created_at DESC);

-- Index for filtering by memory type within a project
CREATE INDEX IF NOT EXISTS project_memory_project_type_idx
  ON public.project_memory (project_id, memory_type);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS project_memory_set_updated_at ON public.project_memory;
CREATE TRIGGER project_memory_set_updated_at
  BEFORE UPDATE ON public.project_memory
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS: the current product maps each personal workspace to its authenticated owner.
ALTER TABLE public.project_memory ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read memory for their own projects
CREATE POLICY "project_memory_select" ON public.project_memory
  FOR SELECT
  TO authenticated
  USING (
    project_id IN (
      SELECT id FROM public.projects WHERE owner_id = auth.uid()
    )
  );

-- Allow insert for project owners
CREATE POLICY "project_memory_insert" ON public.project_memory
  FOR INSERT
  TO authenticated
  WITH CHECK (
    project_id IN (
      SELECT id FROM public.projects WHERE owner_id = auth.uid()
    )
  );

-- Allow delete for project owners
CREATE POLICY "project_memory_delete" ON public.project_memory
  FOR DELETE
  TO authenticated
  USING (
    project_id IN (
      SELECT id FROM public.projects WHERE owner_id = auth.uid()
    )
  );

-- Service role bypass (used by the backend API)
CREATE POLICY "project_memory_service_role" ON public.project_memory
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Grant access to authenticated users and service role
GRANT SELECT, INSERT, DELETE ON public.project_memory TO authenticated;
GRANT ALL ON public.project_memory TO service_role;

COMMENT ON TABLE public.project_memory IS
  'Persists architectural decisions (ADRs), user preferences, and known failure modes per project. '
  'Used by the Coden AI agent to maintain context and consistency across generation sessions.';
