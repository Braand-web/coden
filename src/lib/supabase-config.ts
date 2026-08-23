const UNCONFIGURED_SUPABASE_URL = 'https://coden-unconfigured.invalid';
const UNCONFIGURED_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_coden_unconfigured';

const configuredUrl = String(import.meta.env.VITE_SUPABASE_URL || '').trim();
const configuredPublishableKey = String(
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  '',
).trim();
export const SUPABASE_URL =
  configuredUrl || UNCONFIGURED_SUPABASE_URL;

export const SUPABASE_PUBLISHABLE_KEY =
  configuredPublishableKey || UNCONFIGURED_SUPABASE_PUBLISHABLE_KEY;

export const SUPABASE_BROWSER_CONFIG_STATUS = {
  hasUrl: Boolean(configuredUrl),
  hasPublishableKey: Boolean(configuredPublishableKey),
  usingDevFallback: false,
  projectRef: getSupabaseProjectRef(SUPABASE_URL),
};

export function hasSupabaseBrowserConfig(): boolean {
  return SUPABASE_BROWSER_CONFIG_STATUS.hasUrl && SUPABASE_BROWSER_CONFIG_STATUS.hasPublishableKey;
}

export function getSupabaseProjectRef(url: string): string {
  try {
    const host = new URL(url).hostname;
    return host.endsWith('.supabase.co') ? host.split('.')[0] : host;
  } catch {
    return 'invalid-url';
  }
}

if (!hasSupabaseBrowserConfig()) {
  console.warn('[coden:supabase_browser_config_missing]', {
    message: 'VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY/VITE_SUPABASE_ANON_KEY are required in production.',
    status: SUPABASE_BROWSER_CONFIG_STATUS,
  });
}
