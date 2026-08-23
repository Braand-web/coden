-- Agent Job Queue — persistent async job execution table
-- Enables long-running generations (>30s) to survive Railway request timeouts.
-- Jobs are picked up by the in-process worker and results polled via SSE.

CREATE TABLE IF NOT EXISTS public.agent_jobs (
  id                TEXT PRIMARY KEY,
  type              TEXT NOT NULL CHECK (type IN ('generate', 'auto_fix', 'security_scan', 'publish', 'media_gen', 'research')),
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  priority          TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('critical', 'high', 'normal', 'low')),
  project_id        UUID NOT NULL,
  user_id           UUID NOT NULL,
  organization_id   UUID NOT NULL,
  payload           JSONB NOT NULL DEFAULT '{}'::JSONB,
  result            JSONB,
  error             TEXT,
  attempts          INTEGER NOT NULL DEFAULT 0,
  max_attempts      INTEGER NOT NULL DEFAULT 3,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at        TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  expires_at        TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 minutes')
);

-- Indexes for efficient queue polling
CREATE INDEX IF NOT EXISTS agent_jobs_status_priority_idx
  ON public.agent_jobs (status, priority DESC, created_at ASC)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS agent_jobs_project_id_idx
  ON public.agent_jobs (project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS agent_jobs_user_id_idx
  ON public.agent_jobs (user_id, status, created_at DESC);

-- Cleanup index for expired jobs
CREATE INDEX IF NOT EXISTS agent_jobs_expires_at_idx
  ON public.agent_jobs (expires_at)
  WHERE status IN ('pending', 'processing');

-- Job progress events for SSE polling
CREATE TABLE IF NOT EXISTS public.agent_job_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id      TEXT NOT NULL REFERENCES public.agent_jobs(id) ON DELETE CASCADE,
  step        TEXT NOT NULL,
  message     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS agent_job_events_job_id_idx
  ON public.agent_job_events (job_id, created_at ASC);

-- RLS
ALTER TABLE public.agent_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_job_events ENABLE ROW LEVEL SECURITY;

-- Users can read their own jobs
CREATE POLICY "agent_jobs_select" ON public.agent_jobs
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR organization_id = auth.uid());

-- Users can cancel their own jobs
CREATE POLICY "agent_jobs_update_cancel" ON public.agent_jobs
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (status = 'cancelled');

-- Service role has full access (worker process)
CREATE POLICY "agent_jobs_service_role" ON public.agent_jobs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "agent_job_events_select" ON public.agent_job_events
  FOR SELECT TO authenticated
  USING (
    job_id IN (
      SELECT id FROM public.agent_jobs
      WHERE user_id = auth.uid() OR organization_id = auth.uid()
    )
  );

CREATE POLICY "agent_job_events_service_role" ON public.agent_job_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Grants
GRANT SELECT, UPDATE ON public.agent_jobs TO authenticated;
GRANT ALL ON public.agent_jobs TO service_role;
GRANT SELECT ON public.agent_job_events TO authenticated;
GRANT ALL ON public.agent_job_events TO service_role;

-- Auto-cleanup function: delete expired/completed jobs older than 2 hours
CREATE OR REPLACE FUNCTION public.cleanup_expired_jobs()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  DELETE FROM public.agent_jobs
  WHERE (status IN ('completed', 'cancelled', 'failed') AND completed_at < NOW() - INTERVAL '2 hours')
     OR (expires_at < NOW() AND status IN ('pending', 'processing'));
END;
$$;

COMMENT ON TABLE public.agent_jobs IS
  'Persistent async job queue for long-running Coden agent tasks. '
  'Worker polls this table every 2s and executes pending jobs in-process.';
