-- ============================================================
-- Coden publications table: tracks Cloudflare Pages deployments
-- Copy-paste into Supabase SQL editor and run once.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.publications (
  project_id              uuid PRIMARY KEY,
  slug                    text NOT NULL UNIQUE,
  cf_pages_project        text NOT NULL,
  default_url             text,                -- https://<project>.pages.dev
  coden_subdomain         text,                -- <slug>.coden.fun
  custom_domain           text,                -- user domain, e.g. app.client.com
  custom_domain_status    text,                -- pending | active | failed
  last_deployment_id      text,
  status                  text DEFAULT 'pending', -- pending | building | ready | failed
  published_at            timestamptz DEFAULT now(),
  updated_at              timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_publications_slug ON public.publications(slug);
CREATE INDEX IF NOT EXISTS idx_publications_custom_domain ON public.publications(custom_domain);

-- Grants (required by PostgREST — RLS alone is not enough)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.publications TO authenticated;
GRANT ALL ON public.publications TO service_role;

-- RLS: only the project owner can see/modify their publication row.
ALTER TABLE public.publications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "publications_owner_select" ON public.publications;
CREATE POLICY "publications_owner_select"
  ON public.publications
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = publications.project_id
        AND (p.owner_id = auth.uid() OR p.organization_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "publications_owner_write" ON public.publications;
CREATE POLICY "publications_owner_write"
  ON public.publications
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = publications.project_id
        AND (p.owner_id = auth.uid() OR p.organization_id = auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = publications.project_id
        AND (p.owner_id = auth.uid() OR p.organization_id = auth.uid())
    )
  );

-- updated_at auto-touch trigger
CREATE OR REPLACE FUNCTION public.touch_publications_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_publications_touch ON public.publications;
CREATE TRIGGER trg_publications_touch
  BEFORE UPDATE ON public.publications
  FOR EACH ROW EXECUTE FUNCTION public.touch_publications_updated_at();