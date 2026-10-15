-- Opt-in durable queue (queue_version=2). No provider call is retried after an
-- expired lease: a crash may have occurred after the provider accepted it.
BEGIN;

ALTER TABLE public.agent_jobs
  ADD COLUMN queue_version integer NOT NULL DEFAULT 1,
  ADD COLUMN idempotency_key text,
  ADD COLUMN lease_token uuid,
  ADD COLUMN lease_owner text,
  ADD COLUMN lease_expires_at timestamptz,
  ADD COLUMN reconciliation_required boolean NOT NULL DEFAULT false,
  ADD COLUMN resume_count integer NOT NULL DEFAULT 0,
  ADD COLUMN last_resumed_at timestamptz,
  ADD COLUMN event_sequence bigint NOT NULL DEFAULT 0,
  ADD CONSTRAINT agent_jobs_resume_count_check CHECK (resume_count BETWEEN 0 AND 3),
  ADD CONSTRAINT agent_jobs_durable_settings_check CHECK (
    queue_version IN (1, 2) AND (queue_version = 1 OR (
      attempts >= 0 AND max_attempts BETWEEN 1 AND 100
      AND (type <> 'publish' OR max_attempts = 1)
      AND (idempotency_key IS NULL OR (length(btrim(idempotency_key)) > 0 AND length(idempotency_key) <= 200))
      AND ((status = 'processing' AND lease_token IS NOT NULL AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
        OR (status <> 'processing' AND lease_token IS NULL AND lease_owner IS NULL AND lease_expires_at IS NULL))
    ))
  );

-- Publication V2 creates the immutable snapshot and agent_job in one transaction
-- using only the original queue columns. Promote that unmistakable payload at
-- INSERT time: no later activation call or new-column dependency is required.
CREATE FUNCTION public.prepare_durable_publication_job()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NEW.type = 'publish' AND NEW.payload ->> 'publication_snapshot_id' IS NOT NULL THEN
    NEW.queue_version := 2;
    NEW.max_attempts := 1;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER agent_jobs_prepare_publication BEFORE INSERT ON public.agent_jobs
  FOR EACH ROW EXECUTE FUNCTION public.prepare_durable_publication_job();

CREATE UNIQUE INDEX agent_jobs_durable_idempotency_idx
  ON public.agent_jobs (organization_id, project_id, user_id, type, idempotency_key)
  WHERE queue_version = 2 AND idempotency_key IS NOT NULL;

-- Uncertain publications keep the project blocked until explicit provider
-- reconciliation, even though their queue status is terminal ('failed').
CREATE UNIQUE INDEX agent_jobs_one_active_publish_per_project_idx
  ON public.agent_jobs (project_id)
  WHERE queue_version = 2 AND type = 'publish'
    AND (status IN ('pending', 'processing') OR reconciliation_required);

CREATE INDEX agent_jobs_durable_claim_idx ON public.agent_jobs (
  (CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END), created_at, id
) WHERE queue_version = 2 AND status = 'pending';
CREATE INDEX agent_jobs_durable_lease_idx ON public.agent_jobs (lease_expires_at)
  WHERE queue_version = 2 AND status = 'processing';

ALTER TABLE public.agent_job_events ADD COLUMN sequence bigint,
  ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
WITH numbered AS (
  SELECT id, row_number() OVER (PARTITION BY job_id ORDER BY created_at, id) AS sequence
  FROM public.agent_job_events
)
UPDATE public.agent_job_events AS e SET sequence = n.sequence FROM numbered AS n WHERE e.id = n.id;
UPDATE public.agent_jobs AS j SET event_sequence = counts.sequence
FROM (SELECT job_id, max(sequence) AS sequence FROM public.agent_job_events GROUP BY job_id) AS counts
WHERE j.id = counts.job_id;
ALTER TABLE public.agent_job_events ALTER COLUMN sequence SET NOT NULL;
CREATE UNIQUE INDEX agent_job_events_job_sequence_idx ON public.agent_job_events (job_id, sequence);

-- A parent-row lock serializes per-job event allocation. Unlike a global
-- sequence, this cannot commit event N+1 before N for the same job.
CREATE FUNCTION public.assign_agent_job_event_sequence()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  UPDATE public.agent_jobs SET event_sequence = event_sequence + 1
  WHERE id = NEW.job_id RETURNING event_sequence INTO NEW.sequence;
  IF NOT FOUND THEN RAISE EXCEPTION 'Job not found' USING ERRCODE = '23503'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER agent_job_events_sequence BEFORE INSERT ON public.agent_job_events
  FOR EACH ROW EXECUTE FUNCTION public.assign_agent_job_event_sequence();

CREATE FUNCTION public.guard_durable_agent_job_update()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF OLD.queue_version = 2 THEN
    IF NEW.queue_version <> 2 THEN
      RAISE EXCEPTION 'Cannot downgrade a durable job' USING ERRCODE = '23514';
    END IF;
    IF OLD.type = 'publish' AND OLD.status = 'processing' AND NEW.status = 'cancelled' THEN
      RAISE EXCEPTION 'Cannot cancel a processing publication' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER agent_jobs_durable_guard BEFORE UPDATE ON public.agent_jobs
  FOR EACH ROW EXECUTE FUNCTION public.guard_durable_agent_job_update();

-- Existing authenticated reads remain owner-scoped. Cancellation must not grant
-- arbitrary UPDATE rights over payload, lease, attempts, or ownership columns.
REVOKE UPDATE ON public.agent_jobs FROM authenticated;
GRANT UPDATE (status, completed_at) ON public.agent_jobs TO authenticated;
DROP POLICY agent_jobs_update_cancel ON public.agent_jobs;
CREATE POLICY agent_jobs_update_cancel ON public.agent_jobs FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()) AND (queue_version = 1 OR status = 'pending' OR type <> 'publish'))
  WITH CHECK (user_id = (SELECT auth.uid()) AND status = 'cancelled');

CREATE FUNCTION public.enqueue_agent_job(
  p_id text, p_type text, p_project_id uuid, p_user_id uuid, p_organization_id uuid,
  p_payload jsonb, p_priority text DEFAULT 'normal', p_max_attempts integer DEFAULT 3,
  p_idempotency_key text DEFAULT NULL
)
RETURNS SETOF public.agent_jobs LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_job public.agent_jobs;
BEGIN
  INSERT INTO public.agent_jobs (
    id, type, project_id, user_id, organization_id, payload, priority, max_attempts,
    queue_version, idempotency_key
  ) VALUES (
    p_id, p_type, p_project_id, p_user_id, p_organization_id, p_payload, p_priority,
    CASE WHEN p_type = 'publish' THEN 1 ELSE p_max_attempts END, 2, p_idempotency_key
  ) ON CONFLICT DO NOTHING RETURNING * INTO v_job;
  IF FOUND THEN
    INSERT INTO public.agent_job_events (job_id, step, message) VALUES (v_job.id, 'queued', 'Job queued.');
    RETURN QUERY SELECT * FROM public.agent_jobs WHERE id = v_job.id;
    RETURN;
  END IF;
  -- ON CONFLICT waits for a concurrent insertion before reading its committed row.
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_job FROM public.agent_jobs
    WHERE queue_version = 2 AND organization_id = p_organization_id AND project_id = p_project_id
      AND user_id = p_user_id AND type = p_type AND idempotency_key = p_idempotency_key;
    IF FOUND THEN
      IF v_job.payload IS DISTINCT FROM p_payload THEN
        RAISE EXCEPTION 'Idempotency key was used for a different request' USING ERRCODE = '22023';
      END IF;
      RETURN NEXT v_job;
      RETURN;
    END IF;
  END IF;
  RAISE EXCEPTION 'An active or unreconciled publication already exists' USING ERRCODE = '23505';
END;
$$;

CREATE FUNCTION public.claim_agent_jobs(p_worker_id text, p_limit integer DEFAULT 1,
  p_lease_seconds integer DEFAULT 60, p_types text[] DEFAULT ARRAY[]::text[])
RETURNS SETOF public.agent_jobs LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_job public.agent_jobs; v_now timestamptz := clock_timestamp();
BEGIN
  IF p_worker_id IS NULL OR length(btrim(p_worker_id)) = 0 OR p_limit NOT BETWEEN 1 AND 100
    OR p_lease_seconds NOT BETWEEN 10 AND 300 THEN
    RAISE EXCEPTION 'Invalid claim parameters' USING ERRCODE = '22023';
  END IF;
  FOR v_job IN
    WITH candidates AS (
      SELECT id FROM public.agent_jobs
      WHERE queue_version = 2 AND status = 'pending' AND NOT reconciliation_required
        AND expires_at > v_now AND attempts < max_attempts AND type = ANY(p_types)
      ORDER BY CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
        created_at, id
      LIMIT p_limit FOR UPDATE SKIP LOCKED
    )
    UPDATE public.agent_jobs AS j SET status = 'processing', attempts = j.attempts + 1,
      started_at = v_now, completed_at = NULL, error = NULL, lease_token = gen_random_uuid(),
      lease_owner = p_worker_id, lease_expires_at = v_now + make_interval(secs => p_lease_seconds)
    FROM candidates AS c WHERE j.id = c.id RETURNING j.*
  LOOP
    INSERT INTO public.agent_job_events (job_id, step, message) VALUES (v_job.id, 'processing', 'Job claimed.');
    RETURN QUERY SELECT * FROM public.agent_jobs WHERE id = v_job.id;
  END LOOP;
END;
$$;

CREATE FUNCTION public.renew_agent_job_lease(p_job_id text, p_lease_token uuid, p_lease_seconds integer DEFAULT 60)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_job public.agent_jobs;
BEGIN
  IF p_lease_seconds NOT BETWEEN 10 AND 300 THEN
    RAISE EXCEPTION 'Invalid lease duration' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_job FROM public.agent_jobs WHERE id = p_job_id AND queue_version = 2 AND status = 'processing'
    AND lease_token = p_lease_token FOR UPDATE;
  -- Check time after acquiring the lock, not before potentially waiting for it.
  IF NOT FOUND OR v_job.lease_expires_at <= clock_timestamp() THEN RETURN false; END IF;
  UPDATE public.agent_jobs SET lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds)
  WHERE id = p_job_id;
  RETURN true;
END;
$$;

CREATE FUNCTION public.authorize_agent_job_lease(p_job_id text, p_lease_token uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_job public.agent_jobs;
BEGIN
  SELECT * INTO v_job FROM public.agent_jobs WHERE id = p_job_id AND queue_version = 2
    AND status = 'processing' AND NOT reconciliation_required AND lease_token = p_lease_token FOR UPDATE;
  -- Evaluate time after acquiring the lock; never revive an expired lease.
  RETURN FOUND AND v_job.lease_expires_at > clock_timestamp();
END;
$$;

CREATE FUNCTION public.append_agent_job_event(p_job_id text, p_lease_token uuid, p_step text, p_message text)
RETURNS SETOF public.agent_job_events LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_job public.agent_jobs;
BEGIN
  SELECT * INTO v_job FROM public.agent_jobs WHERE id = p_job_id AND queue_version = 2 AND status = 'processing'
    AND lease_token = p_lease_token FOR UPDATE;
  IF NOT FOUND OR v_job.lease_expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'Job lease lost' USING ERRCODE = '55000';
  END IF;
  IF p_step IS NULL OR length(p_step) NOT BETWEEN 1 AND 200 OR p_message IS NULL OR length(p_message) > 4000 THEN
    RAISE EXCEPTION 'Invalid progress event' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY INSERT INTO public.agent_job_events (job_id, step, message)
    VALUES (p_job_id, p_step, p_message) RETURNING *;
END;
$$;

CREATE FUNCTION public.finish_agent_job(p_job_id text, p_lease_token uuid, p_outcome text,
  p_result jsonb DEFAULT NULL, p_error text DEFAULT NULL, p_retry boolean DEFAULT false,
  p_reconciliation_required boolean DEFAULT false)
RETURNS SETOF public.agent_jobs LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_job public.agent_jobs; v_status text; v_reconcile boolean;
BEGIN
  IF p_outcome IS NULL OR p_outcome NOT IN ('completed', 'failed') THEN
    RAISE EXCEPTION 'Invalid job outcome' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_job FROM public.agent_jobs WHERE id = p_job_id AND queue_version = 2 AND status = 'processing'
    AND lease_token = p_lease_token FOR UPDATE;
  IF NOT FOUND OR v_job.lease_expires_at <= clock_timestamp() THEN RETURN; END IF;
  v_reconcile := coalesce(p_reconciliation_required, false) OR (v_job.type = 'publish' AND p_outcome = 'failed');
  v_status := CASE WHEN p_outcome = 'failed' AND coalesce(p_retry, false) AND NOT v_reconcile
    AND v_job.type <> 'publish' AND v_job.attempts < v_job.max_attempts AND v_job.expires_at > clock_timestamp()
    THEN 'pending' ELSE p_outcome END;
  UPDATE public.agent_jobs SET status = v_status, result = CASE WHEN p_outcome = 'completed' THEN p_result ELSE NULL END,
    error = left(p_error, 500), completed_at = CASE WHEN v_status = 'pending' THEN NULL ELSE clock_timestamp() END,
    reconciliation_required = v_reconcile, lease_token = NULL, lease_owner = NULL, lease_expires_at = NULL
  WHERE id = p_job_id;
  INSERT INTO public.agent_job_events (job_id, step, message)
    VALUES (p_job_id, CASE WHEN v_status = 'pending' THEN 'retry_pending' ELSE v_status END,
      CASE WHEN v_reconcile THEN 'Publication outcome uncertain; provider reconciliation required.'
        WHEN v_status = 'completed' THEN 'Job completed.' ELSE 'Job failed.' END);
  RETURN QUERY SELECT * FROM public.agent_jobs WHERE id = p_job_id;
END;
$$;

CREATE FUNCTION public.reconcile_expired_agent_jobs()
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_job public.agent_jobs; v_count integer := 0; v_uncertain boolean;
BEGIN
  FOR v_job IN SELECT * FROM public.agent_jobs WHERE queue_version = 2 AND (
    (status = 'processing' AND lease_expires_at <= clock_timestamp()) OR
    (status = 'pending' AND (expires_at <= clock_timestamp() OR attempts >= max_attempts))
  ) ORDER BY id LIMIT 100 FOR UPDATE SKIP LOCKED
  LOOP
    v_uncertain := v_job.status = 'processing';
    UPDATE public.agent_jobs SET status = 'failed', completed_at = clock_timestamp(),
      error = CASE WHEN v_uncertain THEN 'JOB_LEASE_EXPIRED: outcome uncertain; reconciliation required.'
        ELSE 'JOB_EXPIRED_OR_ATTEMPTS_EXHAUSTED' END,
      reconciliation_required = v_uncertain, lease_token = NULL, lease_owner = NULL, lease_expires_at = NULL
    WHERE id = v_job.id;
    INSERT INTO public.agent_job_events (job_id, step, message) VALUES (v_job.id,
      CASE WHEN v_uncertain THEN 'reconciliation_required' ELSE 'failed' END,
      CASE WHEN v_uncertain THEN 'Lease expired. No automatic retry; reconcile external effects.' ELSE 'Job expired before execution.' END);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

CREATE FUNCTION public.cancel_agent_job(p_job_id text, p_user_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  -- A running provider request cannot reliably be cancelled. Only pending durable
  -- jobs are cancellable; status+owner predicates make claim/cancel races atomic.
  UPDATE public.agent_jobs SET status = 'cancelled', completed_at = clock_timestamp()
  WHERE id = p_job_id AND user_id = p_user_id
    AND ((queue_version = 2 AND status = 'pending') OR (queue_version = 1 AND status IN ('pending', 'processing')));
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO public.agent_job_events (job_id, step, message) VALUES (p_job_id, 'cancelled', 'Job cancelled before execution.');
  RETURN true;
END;
$$;

-- Explicit recovery of the SAME immutable publication, not an automatic provider
-- retry. The HTTP caller must check current project/candidate authorization; the
-- handler must reconcile provider checkpoints before making new provider calls.
CREATE FUNCTION public.resume_publish_job(p_job_id text, p_user_id uuid)
RETURNS SETOF public.agent_jobs LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_job public.agent_jobs; v_now timestamptz;
BEGIN
  SELECT * INTO v_job FROM public.agent_jobs
  WHERE id = p_job_id AND user_id = p_user_id AND queue_version = 2 AND type = 'publish'
    AND status = 'failed' AND reconciliation_required AND resume_count < 3
    AND lease_token IS NULL AND lease_owner IS NULL AND lease_expires_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  v_now := clock_timestamp();
  -- No new job, snapshot, idempotency key or provider request is created here.
  -- The project uniqueness entry remains held throughout this atomic transition.
  UPDATE public.agent_jobs SET status = 'pending', reconciliation_required = false,
    resume_count = v_job.resume_count + 1, last_resumed_at = v_now,
    attempts = 0, max_attempts = 1, started_at = NULL, completed_at = NULL,
    result = NULL, error = NULL, expires_at = v_now + interval '30 minutes'
  WHERE id = p_job_id;
  INSERT INTO public.agent_job_events (job_id, step, message, metadata) VALUES (
    p_job_id, 'resume_requested',
    format('Explicit publication resume requested (%s/3); reconcile provider state before deployment.', v_job.resume_count + 1),
    jsonb_build_object('resume_count', v_job.resume_count + 1, 'requested_by', p_user_id,
      'previous_attempts', v_job.attempts, 'previous_error', v_job.error,
      'previous_result', v_job.result, 'previous_started_at', v_job.started_at,
      'previous_completed_at', v_job.completed_at, 'previous_expires_at', v_job.expires_at)
  );
  RETURN QUERY SELECT * FROM public.agent_jobs WHERE id = p_job_id;
END;
$$;

-- Retain durable jobs, events and idempotency tombstones for reconciliation.
-- A separate, explicitly designed retention policy must precede their deletion.
CREATE OR REPLACE FUNCTION public.cleanup_expired_jobs()
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  DELETE FROM public.agent_jobs WHERE queue_version = 1 AND NOT reconciliation_required
    AND NOT (type = 'publish' AND payload ->> 'publication_snapshot_id' IS NOT NULL) AND (
    (status IN ('completed', 'cancelled', 'failed') AND completed_at < now() - interval '2 hours')
    OR (expires_at < now() AND status IN ('pending', 'processing'))
  );
END;
$$;

-- No browser/authenticated caller may mint claims, forge progress, or finalize a
-- job. These RPCs run with the service client's existing privileges, not definer.
REVOKE ALL ON FUNCTION public.assign_agent_job_event_sequence() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_durable_agent_job_update() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prepare_durable_publication_job() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_agent_job(text,text,uuid,uuid,uuid,jsonb,text,integer,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_agent_jobs(text,integer,integer,text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.renew_agent_job_lease(text,uuid,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.authorize_agent_job_lease(text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.append_agent_job_event(text,uuid,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_agent_job(text,uuid,text,jsonb,text,boolean,boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_expired_agent_jobs() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cancel_agent_job(text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.resume_publish_job(text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cleanup_expired_jobs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assign_agent_job_event_sequence(), public.guard_durable_agent_job_update(), public.prepare_durable_publication_job(),
  public.enqueue_agent_job(text,text,uuid,uuid,uuid,jsonb,text,integer,text),
  public.claim_agent_jobs(text,integer,integer,text[]), public.renew_agent_job_lease(text,uuid,integer),
  public.authorize_agent_job_lease(text,uuid), public.resume_publish_job(text,uuid),
  public.append_agent_job_event(text,uuid,text,text), public.finish_agent_job(text,uuid,text,jsonb,text,boolean,boolean),
  public.reconcile_expired_agent_jobs(), public.cancel_agent_job(text,uuid), public.cleanup_expired_jobs() TO service_role;

COMMIT;
