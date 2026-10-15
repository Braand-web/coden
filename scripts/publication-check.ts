/** Read-only infrastructure check. Never creates resources or applies SQL. */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { publicationConfigurationChecks } from '../src/services/publication-v2/configuration.ts';

const env = process.env;
const platformOrigin = String(env.CODEN_PUBLIC_APP_URL || env.CODEN_PUBLIC_SITE_URL || env.PUBLIC_SITE_URL || env.APP_URL || '').replace(/\/+$/, '');
const rootDomain = String(env.CODEN_ROOT_DOMAIN || '');
const checks = publicationConfigurationChecks(env, { platformOrigin, rootDomain, requiresBuild: true });
const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL || '';
const key = env.SUPABASE_SERVICE_ROLE_KEY || '';
const databaseConfigured = /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url) && !!key;
checks.push({ id: 'publication_database', label: 'Base serveur Supabase', status: databaseConfigured ? 'pass' : 'fail', ...(!databaseConfigured ? { detail: 'Configurez SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sur le serveur.' } : {}) });
if (process.argv.includes('--remote') && !checks.some(c => c.status === 'fail')) {
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  for (const [table, fields] of [['project_publication_state', 'project_id,removal_pending'], ['publication_snapshots', 'id,verified,activated'], ['publication_aliases', 'host,active'], ['publication_invitations', 'project_id'], ['publication_handoffs', 'token_hash'], ['publication_visitor_sessions', 'token_hash'], ['publication_invitation_outbox', 'id,status'], ['agent_jobs', 'id,lease_token,resume_count'], ['agent_job_events', 'id,sequence']] as const) {
    const { error } = await client.from(table).select(fields).limit(0).abortSignal(AbortSignal.timeout(10_000));
    checks.push({ id: `schema_${table}`, label: `Schéma ${table}`, status: error ? 'fail' : 'pass', ...(error ? { detail: 'Le schéma ou les droits serveur ne correspondent pas aux migrations de publication.' } : {}) });
  }
  try {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/workers/subdomain`, { headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` }, redirect: 'error', signal: AbortSignal.timeout(10_000) });
    const body = await response.json() as any;
    const valid = response.ok && body.success === true && body.result?.subdomain === env.CLOUDFLARE_WORKERS_SUBDOMAIN;
    checks.push({ id: 'cloudflare_read_access', label: 'Accès compte Workers', status: valid ? 'pass' : 'fail', ...(!valid ? { detail: 'Le compte, le jeton ou le sous domaine Workers doit être corrigé.' } : {}) });
  } catch { checks.push({ id: 'cloudflare_read_access', label: 'Accès compte Workers', status: 'fail', detail: 'Impossible de vérifier le compte Workers.' }); }
}
console.log(JSON.stringify({ read_only: true, remote_requested: process.argv.includes('--remote'), checks }, null, 2));
if (checks.some(c => c.status === 'fail')) process.exitCode = 1;
