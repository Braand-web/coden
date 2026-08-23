import { apiFetch } from './lib/api';

type ConnectorCategory = 'Marketing' | 'Messaging' | 'Productivity' | 'Sales' | 'Google' | 'Data' | 'Developer';
type ConnectorStatus = 'enabled' | 'setup_required' | 'disabled';

type ConnectorDefinition = {
  id: string;
  name: string;
  description: string;
  category: ConnectorCategory;
  initials: string;
  color: string;
  builtIn?: boolean;
  docs?: string;
  capabilities: string[];
};

type ConnectorState = {
  service: string;
  status: ConnectorStatus;
  updated_at?: string;
};

type ConnectorApiResponse = {
  success: boolean;
  integrations?: ConnectorState[];
};

type OpenConnectorsOptions = {
  projectId?: string;
  initialConnector?: string;
};

const CONNECTOR_STORAGE_KEY = 'coden.connector.states.v1';
const CONNECTOR_REQUEST_KEY = 'coden.connector.requests.v1';

const CONNECTORS: ConnectorDefinition[] = [
  { id: 'coden-cloud', name: 'Coden Cloud', description: 'Built-in backend, database, auth and storage.', category: 'Developer', initials: 'HC', color: '#2f6df6', builtIn: true, capabilities: ['Database and authentication', 'Storage and realtime', 'Protected server functions'] },
  { id: 'coden-ai', name: 'Coden AI', description: 'Secure AI features for generated applications.', category: 'Developer', initials: 'AI', color: '#8b5cf6', builtIn: true, capabilities: ['Server-side AI connector', 'Streaming responses', 'Usage and secret protection'] },
  { id: 'firecrawl', name: 'Firecrawl', description: 'Web scraping, search and retrieval.', category: 'Developer', initials: 'F', color: '#ff5c28', capabilities: ['Scrape public pages', 'Search and extract content', 'Import web context'] },
  { id: 'elevenlabs', name: 'ElevenLabs', description: 'AI voice generation and text-to-speech.', category: 'Marketing', initials: 'II', color: '#111111', capabilities: ['Text-to-speech', 'Voice assets', 'Media workflow integration'] },
  { id: 'supabase', name: 'Supabase', description: 'Connect a dedicated Supabase project.', category: 'Developer', initials: 'S', color: '#3ecf8e', capabilities: ['Postgres database', 'Auth and storage', 'Edge functions and realtime'] },
  { id: 'stripe', name: 'Stripe', description: 'Payments, subscriptions and customer portal.', category: 'Sales', initials: 'S', color: '#635bff', capabilities: ['Checkout and subscriptions', 'Signed webhooks', 'Customer portal'] },
  { id: 'github', name: 'GitHub', description: 'Repository synchronization and version control.', category: 'Developer', initials: 'GH', color: '#24292f', capabilities: ['Repository import', 'Version synchronization', 'Code collaboration'] },
  { id: 'vercel', name: 'Vercel', description: 'Production deployments and live URL verification.', category: 'Developer', initials: 'V', color: '#111111', capabilities: ['Production deploy', 'Live URL verification', 'Deployment history'] },
  { id: 'slack', name: 'Slack', description: 'Send notifications and automate team workflows.', category: 'Messaging', initials: 'SL', color: '#4a154b', capabilities: ['Channel notifications', 'Workflow events', 'Team alerts'] },
  { id: 'gmail', name: 'Gmail', description: 'Send and organize email workflows.', category: 'Google', initials: 'G', color: '#ea4335', capabilities: ['Email actions', 'Notification workflows', 'Inbox automation'] },
  { id: 'google-calendar', name: 'Google Calendar', description: 'Create events and scheduling experiences.', category: 'Google', initials: '31', color: '#4285f4', capabilities: ['Calendar events', 'Availability workflows', 'Booking synchronization'] },
  { id: 'google-drive', name: 'Google Drive', description: 'Use files and folders from Google Drive.', category: 'Google', initials: 'GD', color: '#0f9d58', capabilities: ['File access', 'Document workflows', 'Asset import'] },
  { id: 'google-sheets', name: 'Google Sheets', description: 'Read and write spreadsheet data.', category: 'Google', initials: 'GS', color: '#188038', capabilities: ['Spreadsheet import', 'Row synchronization', 'Reporting workflows'] },
  { id: 'airtable', name: 'Airtable', description: 'Connect structured Airtable bases.', category: 'Productivity', initials: 'A', color: '#fcb400', capabilities: ['Base records', 'Workflow synchronization', 'Content operations'] },
  { id: 'notion', name: 'Notion', description: 'Use pages and databases as project context.', category: 'Productivity', initials: 'N', color: '#111111', capabilities: ['Page import', 'Database context', 'Knowledge workflows'] },
  { id: 'hubspot', name: 'HubSpot', description: 'CRM contacts, companies and sales workflows.', category: 'Sales', initials: 'H', color: '#ff7a59', capabilities: ['CRM contacts', 'Sales automation', 'Customer workflows'] },
  { id: 'shopify', name: 'Shopify', description: 'Products, orders and commerce workflows.', category: 'Sales', initials: 'S', color: '#7ab55c', capabilities: ['Product catalog', 'Order workflows', 'Storefront data'] },
  { id: 'telegram', name: 'Telegram', description: 'Bots, messages and notification workflows.', category: 'Messaging', initials: 'T', color: '#229ed9', capabilities: ['Bot messages', 'Notifications', 'Workflow commands'] },
  { id: 'discord', name: 'Discord', description: 'Community messages and bot actions.', category: 'Messaging', initials: 'D', color: '#5865f2', capabilities: ['Community notifications', 'Bot commands', 'Member workflows'] },
  { id: 'bigquery', name: 'BigQuery', description: 'Query and analyze warehouse data.', category: 'Data', initials: 'BQ', color: '#4285f4', capabilities: ['Warehouse queries', 'Analytics data', 'Reporting pipelines'] },
  { id: 'snowflake', name: 'Snowflake', description: 'Connect governed cloud data.', category: 'Data', initials: 'SF', color: '#29b5e8', capabilities: ['Cloud warehouse', 'Governed datasets', 'Analytics workflows'] },
  { id: 'databricks', name: 'Databricks', description: 'Use lakehouse data and AI workflows.', category: 'Data', initials: 'DB', color: '#ff3621', capabilities: ['Lakehouse data', 'Analytics workflows', 'Model operations'] },
  { id: 'twilio', name: 'Twilio', description: 'SMS, messaging and communication workflows.', category: 'Messaging', initials: 'TW', color: '#f22f46', capabilities: ['SMS notifications', 'Communication flows', 'Verification messages'] },
  { id: 'salesforce', name: 'Salesforce', description: 'CRM data and enterprise sales workflows.', category: 'Sales', initials: 'SF', color: '#00a1e0', capabilities: ['CRM records', 'Enterprise workflows', 'Sales automation'] },
];

const CATEGORY_ORDER: ConnectorCategory[] = ['Marketing', 'Messaging', 'Productivity', 'Sales', 'Google', 'Data', 'Developer'];
let styleInstalled = false;
let panelBound = false;
let activeProjectId = '';
let activeCategory = 'all';
let selectedConnectorId = '';
let connectorStates = new Map<string, ConnectorStatus>();

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function connectorGlyph(connector: ConnectorDefinition, compact = false) {
  return `<span class="connector-glyph${compact ? ' compact' : ''}" style="--connector-color:${escapeHtml(connector.color)}">${escapeHtml(connector.initials)}</span>`;
}

function connectorIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="7" cy="7" r="3"></circle><circle cx="17" cy="7" r="3"></circle><circle cx="7" cy="17" r="3"></circle><path d="M10 7h4"></path><path d="M7 10v4"></path><path d="M10 17h3a4 4 0 0 0 4-4v-3"></path></svg>';
}

function closeIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>';
}

function searchIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path></svg>';
}

function installStyle() {
  if (styleInstalled || typeof document === 'undefined') return;
  const style = document.createElement('style');
  style.id = 'coden-connectors-panel-style';
  style.textContent = `
    .connectors-overlay{position:fixed;inset:0;z-index:11000;display:grid;place-items:center;padding:20px;background:rgba(5,7,10,.66);backdrop-filter:blur(12px) saturate(.78);opacity:0;visibility:hidden;transition:opacity 180ms cubic-bezier(.22,1,.36,1),visibility 0s linear 180ms}
    .connectors-overlay.open{opacity:1;visibility:visible;transition:opacity 180ms cubic-bezier(.22,1,.36,1),visibility 0s}
    .connectors-panel{width:min(1180px,calc(100vw - 40px));height:min(760px,calc(100dvh - 40px));display:grid;grid-template-columns:minmax(210px,260px) minmax(0,1fr);overflow:hidden;border:1px solid var(--border-mid,var(--border,#333));border-radius:18px;background:var(--bg-surface,#171717);color:var(--text,#f7f7f5);box-shadow:0 34px 110px rgba(0,0,0,.54);transform:translateY(12px) scale(.988);transition:transform 220ms cubic-bezier(.22,1,.36,1)}
    .connectors-overlay.open .connectors-panel{transform:translateY(0) scale(1)}
    .connectors-sidebar{min-height:0;display:flex;flex-direction:column;gap:12px;padding:14px;border-right:1px solid var(--border-light,color-mix(in srgb,var(--text,#111) 9%,transparent));background:color-mix(in srgb,var(--bg,#111) 94%,transparent)}
    .connectors-search{height:42px;display:flex;align-items:center;gap:9px;padding:0 12px;border:1px solid var(--border,#333);border-radius:11px;background:var(--bg-input,#171717);color:var(--text-sub,#aaa)}
    .connectors-search:focus-within{border-color:var(--border-focus,#4f75ff)}
    .connectors-search svg{width:18px;height:18px;flex:none}
    .connectors-search input{width:100%;border:0;outline:0;background:transparent;color:var(--text,#fff);font:inherit;font-size:14px}
    .connectors-nav{min-height:0;flex:1;display:flex;flex-direction:column;gap:4px;overflow:auto;padding-right:2px}
    .connectors-nav-label{padding:10px 10px 5px;color:var(--text-sub,#999);font-size:11px;font-weight:720}
    .connectors-filter{width:100%;min-height:38px;display:flex;align-items:center;justify-content:space-between;gap:10px;border:0;border-radius:10px;padding:0 10px;background:transparent;color:var(--text-muted,#c9c9c6);font:inherit;font-size:13px;font-weight:650;text-align:left;cursor:pointer}
    .connectors-filter:hover,.connectors-filter.active{background:var(--bg-elevated,#292929);color:var(--text,#fff)}
    .connectors-filter span:last-child{color:var(--text-sub,#969696);font-size:12px;font-variant-numeric:tabular-nums}
    .connectors-sidebar-card{display:grid;gap:9px;padding:13px;border:1px solid var(--border,#333);border-radius:12px;background:var(--bg-input,#171717)}
    .connectors-sidebar-card svg{width:19px;height:19px}
    .connectors-sidebar-card strong{font-size:13px}
    .connectors-sidebar-card p{margin:0;color:var(--text-sub,#aaa);font-size:11px;line-height:1.45}
    .connectors-sidebar-card button,.connectors-secondary{height:36px;border:1px solid var(--border,#444);border-radius:10px;background:transparent;color:var(--text,#fff);font:inherit;font-size:12px;font-weight:760;cursor:pointer}
    .connectors-main{min-width:0;min-height:0;display:grid;grid-template-rows:auto minmax(0,1fr);background:var(--bg-surface,#1c1c1c)}
    .connectors-header{min-height:58px;display:flex;align-items:center;justify-content:space-between;padding:0 20px;border-bottom:1px solid var(--border-light,color-mix(in srgb,var(--text,#111) 9%,transparent))}
    .connectors-title{display:flex;align-items:center;gap:10px;font-size:16px;font-weight:780}.connectors-title svg{width:20px;height:20px}
    .connectors-close{width:38px;height:38px;display:grid;place-items:center;border:0;border-radius:10px;background:transparent;color:var(--text-sub,#aaa);cursor:pointer}.connectors-close:hover{background:var(--bg-elevated,#2a2a2a);color:var(--text,#fff)}.connectors-close svg{width:21px;height:21px}
    .connectors-body{position:relative;min-height:0;overflow:auto;scrollbar-width:thin}
    .connectors-intro{position:relative;min-height:280px;display:grid;place-items:center;overflow:hidden;border-bottom:1px solid var(--border-light,color-mix(in srgb,var(--text,#111) 7%,transparent))}
    .connectors-marquee{position:absolute;inset:0;display:grid;align-content:start;gap:10px;padding-top:8px;opacity:.5;mask-image:linear-gradient(to bottom,#000 0%,#000 55%,transparent 92%)}
    .connectors-track{display:flex;width:max-content;gap:10px;animation:connector-marquee 34s linear infinite;will-change:transform}.connectors-track.reverse{animation-direction:reverse;animation-duration:41s}.connectors-track.slow{animation-duration:48s}
    .connector-chip{height:34px;display:flex;align-items:center;gap:8px;padding:0 11px;border:1px solid color-mix(in srgb,var(--text,#111) 8%,transparent);border-radius:999px;background:rgba(25,25,25,.56);color:#e8e8e5;font-size:12px;font-weight:720;white-space:nowrap}
    .connectors-intro::after{content:"";position:absolute;inset:0;background:linear-gradient(to bottom,rgba(25,25,25,.12),rgba(25,25,25,.68) 52%,var(--bg-surface,#1c1c1c) 92%);pointer-events:none}
    .connectors-intro-copy{position:relative;z-index:2;width:min(620px,calc(100% - 36px));display:grid;justify-items:center;gap:12px;text-align:center;padding-top:54px}
    .connectors-intro-copy h2{margin:0;color:var(--text,#fff);font-size:clamp(24px,3vw,36px);line-height:1.04;letter-spacing:-.04em}
    .connectors-intro-copy p{max-width:570px;margin:0;color:var(--text-muted,#c6c6c1);font-size:13px;line-height:1.5}
    .connectors-intro-actions{display:flex;gap:9px}.connectors-intro-actions button,.connectors-intro-actions a{height:38px;display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--border,#444);border-radius:10px;padding:0 14px;background:var(--bg-input,#222);color:var(--text,#fff);font-size:12px;font-weight:760;text-decoration:none;cursor:pointer}
    .connectors-catalog{padding:26px 30px 38px}.connectors-catalog-head{display:flex;align-items:end;justify-content:space-between;gap:16px;margin-bottom:16px}.connectors-catalog-head h3{margin:0 0 4px;font-size:18px}.connectors-catalog-head p{margin:0;color:var(--text-sub,#aaa);font-size:12px}.connectors-count{color:var(--text-sub,#aaa);font-size:12px}
    .connectors-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
    .connector-card{min-width:0;display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:10px;border:1px solid var(--border,#393939);border-radius:12px;padding:10px;background:var(--bg-input,#202020);color:var(--text,#fff);text-align:left;cursor:pointer;transition:transform 150ms cubic-bezier(.22,1,.36,1),border-color 150ms,background 150ms}
    .connector-card:hover{transform:translateY(-1px);border-color:var(--border-focus,#566cff);background:var(--bg-elevated,#272727)}
    .connector-card-copy{min-width:0}.connector-card-copy strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px}.connector-card-copy span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:3px;color:var(--text-sub,#aaa);font-size:11px}
    .connector-glyph{width:40px;height:40px;display:grid;place-items:center;flex:none;border-radius:10px;background:var(--connector-color);color:#fff;font-size:11px;font-weight:900;letter-spacing:-.03em;box-shadow:0 0 0 1px color-mix(in srgb,var(--text,#111) 9%,transparent) inset}.connector-glyph.compact{width:25px;height:25px;border-radius:999px;font-size:8px}
    .connector-status{min-height:25px;display:inline-flex;align-items:center;border-radius:8px;padding:0 8px;background:var(--accent-dim,rgba(47,109,246,.14));color:var(--accent,#7ea5ff);font-size:10px;font-weight:820;white-space:nowrap}.connector-status.enabled{background:rgba(73,151,48,.22);color:#80cf67}.connector-status.setup_required{background:rgba(230,158,44,.18);color:#e8b657}
    .connectors-empty{grid-column:1/-1;padding:50px 20px;color:var(--text-sub,#aaa);text-align:center}
    .connector-detail{position:absolute;inset:0;z-index:5;display:grid;grid-template-rows:auto minmax(0,1fr);background:color-mix(in srgb,var(--bg-surface,#1c1c1c) 97%,transparent);backdrop-filter:blur(18px);transform:translateX(102%);transition:transform 220ms cubic-bezier(.22,1,.36,1)}.connector-detail.open{transform:translateX(0)}
    .connector-detail-head{min-height:68px;display:flex;align-items:center;gap:12px;padding:0 24px;border-bottom:1px solid var(--border-light,color-mix(in srgb,var(--text,#111) 8%,transparent))}.connector-detail-back{width:36px;height:36px;border:0;border-radius:9px;background:var(--bg-input,#222);color:var(--text,#fff);cursor:pointer}.connector-detail-head strong{font-size:15px}
    .connector-detail-body{overflow:auto;padding:34px 42px 54px}.connector-detail-hero{display:grid;grid-template-columns:auto minmax(0,1fr);gap:18px;align-items:center;padding-bottom:28px;border-bottom:1px solid var(--border-light,color-mix(in srgb,var(--text,#111) 8%,transparent))}.connector-detail-hero h2{margin:0 0 7px;font-size:28px;letter-spacing:-.04em}.connector-detail-hero p{margin:0;color:var(--text-sub,#aaa);font-size:13px;line-height:1.55}
    .connector-detail-section{padding:26px 0;border-bottom:1px solid var(--border-light,color-mix(in srgb,var(--text,#111) 8%,transparent))}.connector-detail-section h3{margin:0 0 14px;font-size:14px}.connector-capabilities{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.connector-capability{padding:12px;border-radius:10px;background:var(--bg-input,#222);color:var(--text-muted,#ccc);font-size:11px;line-height:1.45}
    .connector-detail-actions{display:flex;flex-wrap:wrap;gap:9px;margin-top:24px}.connector-primary{height:38px;border:0;border-radius:10px;padding:0 15px;background:var(--text,#fff);color:var(--bg,#111);font:inherit;font-size:12px;font-weight:820;cursor:pointer}.connector-primary:disabled{opacity:.55;cursor:wait}
    .connector-request-dialog{position:absolute;inset:0;z-index:8;display:none;place-items:center;padding:20px;background:rgba(0,0,0,.55);backdrop-filter:blur(10px)}.connector-request-dialog.open{display:grid}.connector-request-card{width:min(440px,100%);display:grid;gap:14px;padding:20px;border:1px solid var(--border,#444);border-radius:15px;background:var(--bg-surface,#1c1c1c);box-shadow:0 24px 80px rgba(0,0,0,.45)}.connector-request-card h3{margin:0;font-size:17px}.connector-request-card p{margin:0;color:var(--text-sub,#aaa);font-size:12px;line-height:1.5}.connector-request-card input{height:42px;border:1px solid var(--border,#444);border-radius:10px;padding:0 12px;background:var(--bg-input,#222);color:var(--text,#fff);font:inherit;outline:0}.connector-request-actions{display:flex;justify-content:flex-end;gap:8px}
    @keyframes connector-marquee{from{transform:translateX(0)}to{transform:translateX(-50%)}}
    @media(max-width:900px){.connectors-panel{grid-template-columns:1fr;grid-template-rows:auto minmax(0,1fr);width:calc(100vw - 16px);height:calc(100dvh - 16px);border-radius:15px}.connectors-sidebar{gap:8px;padding:10px;border-right:0;border-bottom:1px solid var(--border-light,color-mix(in srgb,var(--text,#111) 8%,transparent))}.connectors-nav{flex:none;flex-direction:row;overflow-x:auto}.connectors-nav-label,.connectors-sidebar-card{display:none}.connectors-filter{width:auto;min-width:max-content;min-height:36px}.connectors-grid{grid-template-columns:1fr}.connectors-intro{min-height:300px}.connectors-catalog{padding:24px 16px 40px}.connector-detail-body{padding:24px 18px 40px}.connector-capabilities{grid-template-columns:1fr}}
    @media(prefers-reduced-motion:reduce){.connectors-overlay,.connectors-panel,.connector-card,.connector-detail{transition:none!important}.connectors-track{animation:none!important}}
  `;
  document.head.appendChild(style);
  styleInstalled = true;
}

function readLocalStates() {
  try {
    const value = JSON.parse(localStorage.getItem(CONNECTOR_STORAGE_KEY) || '{}') as Record<string, ConnectorStatus>;
    return new Map(Object.entries(value));
  } catch {
    return new Map<string, ConnectorStatus>();
  }
}

function saveLocalStates() {
  try {
    localStorage.setItem(CONNECTOR_STORAGE_KEY, JSON.stringify(Object.fromEntries(connectorStates.entries())));
  } catch {
    // Local fallback must never block the connectors panel.
  }
}

function statusFor(connector: ConnectorDefinition): ConnectorStatus {
  return connectorStates.get(connector.id) || (connector.builtIn ? 'enabled' : 'disabled');
}

function statusLabel(status: ConnectorStatus) {
  if (status === 'enabled') return 'Enabled';
  if (status === 'setup_required') return 'Setup required';
  return 'Available';
}

function categoryCount(category: string) {
  if (category === 'enabled') return CONNECTORS.filter(item => statusFor(item) === 'enabled').length;
  if (category === 'all') return CONNECTORS.length;
  return CONNECTORS.filter(item => item.category === category).length;
}

function marqueeTrack(items: ConnectorDefinition[], className = '') {
  const doubled = [...items, ...items];
  return `<div class="connectors-track ${className}">${doubled.map(item => `<div class="connector-chip">${connectorGlyph(item, true)}<span>${escapeHtml(item.name)}</span></div>`).join('')}</div>`;
}

function panelMarkup() {
  return `
    <section class="connectors-panel" role="dialog" aria-modal="true" aria-label="Connectors">
      <aside class="connectors-sidebar">
        <label class="connectors-search">${searchIcon()}<input type="search" data-connectors-search placeholder="Search" autocomplete="off" aria-label="Search connectors"></label>
        <nav class="connectors-nav" aria-label="Connector categories">
          <button class="connectors-filter" type="button" data-connector-filter="enabled"><span>Enabled</span><span>${categoryCount('enabled')}</span></button>
          <button class="connectors-filter active" type="button" data-connector-filter="all"><span>All</span><span>${categoryCount('all')}</span></button>
          <div class="connectors-nav-label">Categories</div>
          ${CATEGORY_ORDER.map(category => `<button class="connectors-filter" type="button" data-connector-filter="${escapeHtml(category)}"><span>${escapeHtml(category)}</span><span>${categoryCount(category)}</span></button>`).join('')}
        </nav>
        <div class="connectors-sidebar-card">
          ${connectorIcon()}
          <strong>Missing a connector?</strong>
          <p>Request the next service you want Coden to support.</p>
          <button type="button" data-connectors-request>Request</button>
        </div>
        <button class="connectors-secondary" type="button" data-connectors-settings>Admin settings</button>
      </aside>
      <main class="connectors-main">
        <header class="connectors-header">
          <div class="connectors-title">${connectorIcon()}<span>Connectors</span></div>
          <button class="connectors-close" type="button" data-connectors-close aria-label="Close connectors">${closeIcon()}</button>
        </header>
        <div class="connectors-body">
          <section class="connectors-intro">
            <div class="connectors-marquee" aria-hidden="true">
              ${marqueeTrack(CONNECTORS.slice(0, 10))}
              ${marqueeTrack(CONNECTORS.slice(7, 18), 'reverse')}
              ${marqueeTrack(CONNECTORS.slice(14), 'slow')}
            </div>
            <div class="connectors-intro-copy">
              <h2>Build from what you already use</h2>
              <p>Connectors let Coden apps communicate with trusted external tools. Built-in services work immediately; protected services guide you through secure setup.</p>
              <div class="connectors-intro-actions">
                <a href="/documentation.html" target="_blank" rel="noopener">View docs &#8599;</a>
                <button type="button" data-connectors-got-it>Got it</button>
              </div>
            </div>
          </section>
          <section class="connectors-catalog">
            <div class="connectors-catalog-head">
              <div><h3>App connectors</h3><p>Add functionality to your apps without exposing credentials.</p></div>
              <span class="connectors-count" data-connectors-count></span>
            </div>
            <div class="connectors-grid" data-connectors-grid></div>
          </section>
          <section class="connector-detail" data-connector-detail aria-hidden="true"></section>
          <div class="connector-request-dialog" data-connector-request-dialog>
            <form class="connector-request-card" data-connector-request-form>
              <h3>Request a connector</h3>
              <p>Tell us which service would make your workflow more useful. The request is saved to this workspace.</p>
              <input name="connector" maxlength="80" required placeholder="Example: Linear, HubSpot, WhatsApp">
              <div class="connector-request-actions">
                <button class="connectors-secondary" type="button" data-connector-request-cancel>Cancel</button>
                <button class="connector-primary" type="submit">Send request</button>
              </div>
            </form>
          </div>
        </div>
      </main>
    </section>
  `;
}

function ensurePanel() {
  installStyle();
  let overlay = document.getElementById('coden-connectors-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'coden-connectors-overlay';
    overlay.className = 'connectors-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = panelMarkup();
    document.body.appendChild(overlay);
  }
  bindPanel();
  return overlay;
}

function filteredConnectors() {
  const search = (document.querySelector<HTMLInputElement>('[data-connectors-search]')?.value || '').trim().toLowerCase();
  return CONNECTORS.filter(item => {
    const matchesCategory = activeCategory === 'all'
      || (activeCategory === 'enabled' && statusFor(item) === 'enabled')
      || item.category === activeCategory;
    const matchesSearch = !search || `${item.name} ${item.description} ${item.category}`.toLowerCase().includes(search);
    return matchesCategory && matchesSearch;
  });
}

function renderFilters() {
  document.querySelectorAll<HTMLElement>('[data-connector-filter]').forEach(button => {
    const filter = button.dataset.connectorFilter || 'all';
    button.classList.toggle('active', filter === activeCategory);
    const count = button.querySelector('span:last-child');
    if (count) count.textContent = String(categoryCount(filter));
  });
}

function renderGrid() {
  const grid = document.querySelector<HTMLElement>('[data-connectors-grid]');
  const count = document.querySelector<HTMLElement>('[data-connectors-count]');
  if (!grid) return;
  const items = filteredConnectors();
  if (count) count.textContent = `${items.length} connector${items.length === 1 ? '' : 's'}`;
  grid.innerHTML = items.length ? items.map(item => {
    const status = statusFor(item);
    return `
      <button class="connector-card" type="button" data-connector-id="${escapeHtml(item.id)}">
        ${connectorGlyph(item)}
        <span class="connector-card-copy"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.description)}</span></span>
        <span class="connector-status ${status}">${escapeHtml(statusLabel(status))}</span>
      </button>
    `;
  }).join('') : '<div class="connectors-empty">No connector matches this search.</div>';
  renderFilters();
}

function renderDetail(connectorId: string) {
  const connector = CONNECTORS.find(item => item.id === connectorId);
  const detail = document.querySelector<HTMLElement>('[data-connector-detail]');
  if (!connector || !detail) return;
  selectedConnectorId = connector.id;
  const status = statusFor(connector);
  const primaryLabel = connector.builtIn
    ? (status === 'enabled' ? 'Disable connector' : 'Enable connector')
    : (status === 'setup_required' ? 'Open secure setup' : 'Prepare connection');
  detail.innerHTML = `
    <div class="connector-detail-head">
      <button class="connector-detail-back" type="button" data-connector-detail-back aria-label="Back">&#8592;</button>
      <strong>${escapeHtml(connector.name)}</strong>
      <span class="connector-status ${status}" style="margin-left:auto">${escapeHtml(statusLabel(status))}</span>
    </div>
    <div class="connector-detail-body">
      <div class="connector-detail-hero">${connectorGlyph(connector)}<div><h2>${escapeHtml(connector.name)}</h2><p>${escapeHtml(connector.description)}</p></div></div>
      <section class="connector-detail-section">
        <h3>What Coden can use</h3>
        <div class="connector-capabilities">${connector.capabilities.map(capability => `<div class="connector-capability">${escapeHtml(capability)}</div>`).join('')}</div>
      </section>
      <section class="connector-detail-section">
        <h3>${connector.builtIn ? 'Built-in connection' : 'Protected connection'}</h3>
        <p style="margin:0;color:var(--text-sub);font-size:12px;line-height:1.6;">${connector.builtIn
          ? 'This connector is managed by Coden and can be enabled without entering a secret.'
          : 'Coden will prepare this connector, then guide you to protected API settings. Credentials are never stored in the browser or shown in this panel.'}</p>
        <div class="connector-detail-actions">
          <button class="connector-primary" type="button" data-connector-primary="${escapeHtml(connector.id)}">${escapeHtml(primaryLabel)}</button>
          ${connector.docs ? `<a class="connectors-secondary" href="${escapeHtml(connector.docs)}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;padding:0 13px;text-decoration:none">Docs</a>` : ''}
          ${status !== 'disabled' ? `<button class="connectors-secondary" type="button" data-connector-disable="${escapeHtml(connector.id)}">Remove</button>` : ''}
        </div>
      </section>
    </div>
  `;
  detail.classList.add('open');
  detail.setAttribute('aria-hidden', 'false');
}

function closeDetail() {
  selectedConnectorId = '';
  const detail = document.querySelector<HTMLElement>('[data-connector-detail]');
  detail?.classList.remove('open');
  detail?.setAttribute('aria-hidden', 'true');
}

async function hydrateStates() {
  connectorStates = readLocalStates();
  if (!activeProjectId) {
    renderGrid();
    return;
  }
  try {
    const response = await apiFetch<ConnectorApiResponse>(`/api/projects/${encodeURIComponent(activeProjectId)}/integrations`);
    for (const item of response.integrations || []) {
      const connector = CONNECTORS.find(entry => entry.id === item.service);
      if (connector && ['enabled', 'setup_required', 'disabled'].includes(item.status)) {
        connectorStates.set(connector.id, item.status);
      }
    }
    saveLocalStates();
  } catch {
    // Keep the local fallback available when the backend is temporarily unavailable.
  }
  renderGrid();
}

async function persistConnector(connector: ConnectorDefinition, status: ConnectorStatus) {
  connectorStates.set(connector.id, status);
  saveLocalStates();
  renderGrid();
  renderDetail(connector.id);
  if (!activeProjectId) return;
  try {
    await apiFetch(`/api/projects/${encodeURIComponent(activeProjectId)}/integrations`, {
      method: 'PATCH',
      body: JSON.stringify({ service: connector.id, status }),
    });
  } catch {
    // The local state remains visible and can synchronize during the next project load.
  }
}

async function handlePrimary(connectorId: string, button: HTMLButtonElement) {
  const connector = CONNECTORS.find(item => item.id === connectorId);
  if (!connector) return;
  const status = statusFor(connector);
  if (!connector.builtIn && status === 'setup_required') {
    closeConnectorsPanel();
    document.dispatchEvent(new CustomEvent('coden:open-settings', { detail: { tab: 'api' } }));
    return;
  }
  button.disabled = true;
  await persistConnector(connector, connector.builtIn && status === 'enabled' ? 'disabled' : connector.builtIn ? 'enabled' : 'setup_required');
  button.disabled = false;
}

function saveConnectorRequest(value: string) {
  const clean = value.trim().slice(0, 80);
  if (!clean) return;
  try {
    const existing = JSON.parse(localStorage.getItem(CONNECTOR_REQUEST_KEY) || '[]') as string[];
    localStorage.setItem(CONNECTOR_REQUEST_KEY, JSON.stringify([...new Set([...existing, clean])].slice(-20)));
  } catch {
    // Request persistence is a progressive enhancement.
  }
}

function bindPanel() {
  if (panelBound) return;
  panelBound = true;
  document.addEventListener('click', event => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    if (target.closest('[data-connectors-close]') || target.id === 'coden-connectors-overlay') {
      closeConnectorsPanel();
      return;
    }
    const filter = target.closest<HTMLElement>('[data-connector-filter]');
    if (filter?.dataset.connectorFilter) {
      activeCategory = filter.dataset.connectorFilter;
      renderGrid();
      return;
    }
    const card = target.closest<HTMLElement>('[data-connector-id]');
    if (card?.dataset.connectorId) {
      renderDetail(card.dataset.connectorId);
      return;
    }
    if (target.closest('[data-connector-detail-back]')) {
      closeDetail();
      return;
    }
    const primary = target.closest<HTMLButtonElement>('[data-connector-primary]');
    if (primary?.dataset.connectorPrimary) {
      void handlePrimary(primary.dataset.connectorPrimary, primary);
      return;
    }
    const disable = target.closest<HTMLButtonElement>('[data-connector-disable]');
    if (disable?.dataset.connectorDisable) {
      const connector = CONNECTORS.find(item => item.id === disable.dataset.connectorDisable);
      if (connector) void persistConnector(connector, 'disabled');
      return;
    }
    if (target.closest('[data-connectors-got-it]')) {
      document.querySelector('.connectors-catalog')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (target.closest('[data-connectors-request]')) {
      document.querySelector<HTMLElement>('[data-connector-request-dialog]')?.classList.add('open');
      document.querySelector<HTMLInputElement>('[data-connector-request-form] input')?.focus();
      return;
    }
    if (target.closest('[data-connector-request-cancel]')) {
      document.querySelector<HTMLElement>('[data-connector-request-dialog]')?.classList.remove('open');
      return;
    }
    if (target.closest('[data-connectors-settings]')) {
      closeConnectorsPanel();
      document.dispatchEvent(new CustomEvent('coden:open-settings', { detail: { tab: 'api' } }));
    }
  });
  document.addEventListener('input', event => {
    const target = event.target as HTMLInputElement | null;
    if (!target?.matches('[data-connectors-search]')) return;
    renderGrid();
  });
  document.addEventListener('submit', event => {
    const form = (event.target as HTMLElement | null)?.closest<HTMLFormElement>('[data-connector-request-form]');
    if (!form) return;
    event.preventDefault();
    const input = form.elements.namedItem('connector') as HTMLInputElement | null;
    saveConnectorRequest(input?.value || '');
    form.reset();
    document.querySelector<HTMLElement>('[data-connector-request-dialog]')?.classList.remove('open');
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (selectedConnectorId) closeDetail();
    else closeConnectorsPanel();
  });
}

export function openConnectorsPanel(options: OpenConnectorsOptions = {}) {
  activeProjectId = String(options.projectId || '').trim();
  activeCategory = 'all';
  const overlay = ensurePanel();
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  const search = overlay.querySelector<HTMLInputElement>('[data-connectors-search]');
  if (search) search.value = '';
  closeDetail();
  renderGrid();
  void hydrateStates().then(() => {
    if (options.initialConnector) renderDetail(options.initialConnector);
  });
}

export function closeConnectorsPanel() {
  const overlay = document.getElementById('coden-connectors-overlay');
  overlay?.classList.remove('open');
  overlay?.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  closeDetail();
}
