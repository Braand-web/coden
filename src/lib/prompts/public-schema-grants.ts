export const CODEN_PUBLIC_SCHEMA_GRANTS_VERSION = 'coden-public-schema-grants-v1';

export const CODEN_PUBLIC_SCHEMA_GRANTS_PROMPT = [
  `Public schema grants contract version: ${CODEN_PUBLIC_SCHEMA_GRANTS_VERSION}.`,
  'Every CREATE TABLE in the public schema MUST be followed, in the SAME migration, by explicit GRANT statements.',
  'Supabase Data API (PostgREST) does NOT grant default privileges on public to anon, authenticated, or service_role. Without GRANTs the app returns permission errors even when RLS policies exist; RLS alone is not enough.',
  'Required migration order (non-negotiable):',
  '  1. CREATE TABLE public.<name>(...)',
  '  2. GRANT ... ON public.<name> TO <roles>',
  '  3. ALTER TABLE public.<name> ENABLE ROW LEVEL SECURITY',
  '  4. CREATE POLICY ...',
  'Default block for a user-facing table:',
  '  GRANT SELECT, INSERT, UPDATE, DELETE ON public.<table> TO authenticated;',
  '  GRANT ALL ON public.<table> TO service_role;',
  '  -- Add GRANT SELECT ON public.<table> TO anon; ONLY if a policy allows anon reads.',
  'Tune grants to match policies: drop the anon grant when every policy scopes to auth.uid(); widen anon only for fully public read tables; always include service_role for tables accessed by edge functions or admin code.',
  'Before submitting any migration, re-read the SQL and confirm every new public table has a matching GRANT block. A missing GRANT is a broken migration.',
].join('\n');
