/**
 * Real brand logos for connectors, served from Coden's own domain.
 *
 * Composio sends a logo URL with each toolkit and that stays the first
 * choice. These are the fallback — and the only source when Composio is not
 * configured or its image host does not answer — so a card never shows two
 * letters where a brand belongs. The SVGs are Simple Icons (CC0, see
 * public/connector-logos/LICENSE.md) in each brand's own colour; the keys are
 * Composio toolkit slugs and the aliases Coden has used for the same service.
 */

const LOGO_FILES: Record<string, string> = {
  airtable: 'airtable', algolia: 'algolia', anthropic: 'anthropic', anthropic_administrator: 'anthropic', asana: 'asana', auth0: 'auth0',
  bigcommerce: 'bigcommerce', bigquery: 'googlebigquery', bitbucket: 'bitbucket', box: 'box', brevo: 'brevo', calendly: 'calendly',
  clerk: 'clerk', clickup: 'clickup', cloudflare: 'cloudflare', coinbase: 'coinbase', confluence: 'confluence', contentful: 'contentful',
  databricks: 'databricks', dev_to: 'devdotto', devto: 'devdotto', digitalocean: 'digitalocean', discord: 'discord', discordbot: 'discord',
  docker: 'docker', dockerhub: 'docker', dropbox: 'dropbox', elevenlabs: 'elevenlabs', facebook: 'facebook', figma: 'figma',
  firebase: 'firebase', gemini: 'googlegemini', ghost: 'ghost', github: 'github', gitlab: 'gitlab', gmail: 'gmail',
  'google-calendar': 'googlecalendar', 'google-drive': 'googledrive', 'google-sheets': 'googlesheets', google_analytics: 'googleanalytics',
  google_bigquery: 'googlebigquery', google_calendar: 'googlecalendar', google_docs: 'googledocs', google_drive: 'googledrive',
  google_maps: 'googlemaps', google_meet: 'googlemeet', google_sheets: 'googlesheets', googleanalytics: 'googleanalytics',
  googlebigquery: 'googlebigquery', googlecalendar: 'googlecalendar', googledocs: 'googledocs', googledrive: 'googledrive',
  googlegemini: 'googlegemini', googlemaps: 'googlemaps', googlemeet: 'googlemeet', googlesheets: 'googlesheets', gumroad: 'gumroad',
  hubspot: 'hubspot', hugging_face: 'huggingface', huggingface: 'huggingface', instagram: 'instagram', intercom: 'intercom', jira: 'jira',
  lemon_squeezy: 'lemonsqueezy', lemonsqueezy: 'lemonsqueezy', linear: 'linear', mailchimp: 'mailchimp', mailgun: 'mailgun', make: 'make',
  medium: 'medium', miro: 'miro', mixpanel: 'mixpanel', mongodb: 'mongodb', mysql: 'mysql', n8n: 'n8n', neon: 'neon', netlify: 'netlify',
  notion: 'notion', npm: 'npm', okta: 'okta', paddle: 'paddle', paypal: 'paypal', perplexity: 'perplexity', perplexityai: 'perplexity',
  pinterest: 'pinterest', planetscale: 'planetscale', postgres: 'postgresql', postgresql: 'postgresql', posthog: 'posthog',
  producthunt: 'producthunt', quickbooks: 'quickbooks', railway: 'railway', reddit: 'reddit', redis: 'redis', render: 'render',
  resend: 'resend', sanity: 'sanity', sendinblue: 'brevo', sentry: 'sentry', shopify: 'shopify', snowflake: 'snowflake',
  spotify: 'spotify', square: 'square', squarespace: 'squarespace', strapi: 'strapi', stripe: 'stripe', substack: 'substack',
  supabase: 'supabase', telegram: 'telegram', tiktok: 'tiktok', todoist: 'todoist', trello: 'trello', twitch: 'twitch', twitter: 'x',
  typeform: 'typeform', vercel: 'vercel', webflow: 'webflow', whatsapp: 'whatsapp', wise: 'wise', wix: 'wix', woocommerce: 'woocommerce',
  wordpress: 'wordpress', x: 'x', xero: 'xero', youtube: 'youtube', zapier: 'zapier', zendesk: 'zendesk', zoom: 'zoom',
};

/** The local logo for a toolkit slug, if Coden ships one. */
export function localConnectorLogo(slug: string): string {
  const key = String(slug || '').trim().toLowerCase();
  const file = LOGO_FILES[key] || LOGO_FILES[key.replace(/[-_]/g, '')];
  return file ? `/connector-logos/${file}.svg` : '';
}

/** Candidates in order: Composio's own logo, then Coden's copy. Empty when neither exists. */
export function connectorLogoCandidates(slug: string, remote?: string): string[] {
  const candidates = [/^https:\/\//.test(String(remote || '')) ? String(remote) : '', localConnectorLogo(slug)].filter(Boolean);
  return [...new Set(candidates)];
}
