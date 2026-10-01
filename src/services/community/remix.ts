/**
 * Remixing an app from the Community: what is copied, what never is.
 *
 * The copy starts from the *published snapshot* (the frozen files of the version that passed the checks), never from the
 * creator's draft. It carries code, design tokens and structure. It never carries secrets, environment variables, data,
 * uploaded files, the conversation, custom domains or connections (sign-in, database, e-mail, payments): the person
 * reconnects those to their own accounts, and the result is told which ones.
 */
export type RemixFile = { path: string; content: string };

const norm = (path: string) => String(path || '').replace(/\\/g, '/').replace(/^\.\/+/, '');

const EXCLUDED = [
  /(^|\/)\.env(\.|$)(?!.*(?:example|sample|template))/i, // real env files; examples stay
  /(^|\/)(?:node_modules|\.git|\.vercel|\.next|dist|build|coverage)\//,
  /(^|\/)supabase\/(?:\.temp|\.branches|seed\.sql)/i,
  /(^|\/)(?:public\/)?(?:uploads?|user-?content|attachments?)\//i,
  /(^|\/)\.coden\/(?:secrets|connections|conversation)/i,
  /(^|\/)(?:coden-(?:cloud|backend)|backend-env)\.json$/i,
  /\.(?:pem|key|p12|pfx|keystore)$/i,
];
const MAX_FILE_BYTES = 400_000;
const MAX_FILES = 600;

/** The files a remix starts from: no env, no uploads, no keys, nothing huge. */
export function selectRemixFiles(files: RemixFile[]): { files: RemixFile[]; dropped: string[] } {
  const kept: RemixFile[] = [];
  const dropped: string[] = [];
  for (const file of files) {
    const path = norm(file.path);
    if (!path || path.includes('..') || EXCLUDED.some(rule => rule.test(path)) || String(file.content || '').length > MAX_FILE_BYTES) { dropped.push(path); continue; }
    kept.push({ path, content: String(file.content || '') });
    if (kept.length >= MAX_FILES) break;
  }
  return { files: kept, dropped };
}

const SUPABASE_URL_LITERAL = /(['"`])https:\/\/[a-z0-9]{12,}\.supabase\.co\1/g;
const JWT_LITERAL = /(['"`])eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\1/g;
const STRIPE_PUBLIC_LITERAL = /(['"`])pk_(?:live|test)_[A-Za-z0-9]{12,}\1/g;
const SB_PUBLISHABLE_LITERAL = /(['"`])sb_publishable_[A-Za-z0-9_-]{12,}\1/g;

/**
 * The creator's own connections written straight into the code (their database address and public key, their Stripe
 * public key) are replaced by environment reads, so the copy can never talk to the creator's backend: it simply has
 * nothing to connect to until the person connects their own.
 */
export function neutralizeConnections(file: RemixFile): { file: RemixFile; changed: boolean } {
  if (!/\.(?:tsx?|jsx?|mjs|cjs|html|vue|svelte)$/i.test(file.path)) return { file, changed: false };
  const viteStyle = /\.(?:tsx?|jsx?|mjs|vue|svelte|html)$/i.test(file.path);
  const content = file.content
    .replace(SUPABASE_URL_LITERAL, viteStyle ? "(import.meta.env.VITE_SUPABASE_URL ?? '')" : "''")
    .replace(JWT_LITERAL, viteStyle ? "(import.meta.env.VITE_SUPABASE_ANON_KEY ?? '')" : "''")
    .replace(SB_PUBLISHABLE_LITERAL, viteStyle ? "(import.meta.env.VITE_SUPABASE_ANON_KEY ?? '')" : "''")
    .replace(STRIPE_PUBLIC_LITERAL, viteStyle ? "(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY ?? '')" : "''");
  return { file: content === file.content ? file : { ...file, content }, changed: content !== file.content };
}

export type Reconnect = { key: string; label: string; hint: string };

/** What the person must connect themselves, read from what the code actually uses. */
export function reconnectList(files: RemixFile[]): Reconnect[] {
  const source = files.filter(file => !/\.(?:md|lock)$/i.test(file.path)).map(file => file.content).join('\n');
  const list: Reconnect[] = [];
  if (/@supabase\/supabase-js|VITE_SUPABASE_|createClient\(|supabase\s*\./.test(source)) {
    list.push({ key: 'database', label: 'Base de données et comptes', hint: 'Connectez votre propre base : l’app ne contient aucune donnée de son créateur.' });
  }
  if (/\bsignIn(?:With\w+)?\(|\bsignUp\(|auth\.(?:getUser|onAuthStateChange)|\bsupabase\.auth\b/.test(source)) {
    list.push({ key: 'auth', label: 'Connexion des utilisateurs', hint: 'Configurez la connexion sur votre base.' });
  }
  if (/stripe|VITE_STRIPE_|loadStripe\(/i.test(source)) {
    list.push({ key: 'payments', label: 'Paiements', hint: 'Ajoutez votre propre compte de paiement.' });
  }
  if (/resend|sendgrid|smtp|mailgun|emailjs|\/api\/(?:send|contact|mail)/i.test(source)) {
    list.push({ key: 'email', label: 'Envoi d’e-mails', hint: 'Configurez votre propre service d’envoi.' });
  }
  if (/openai|anthropic|openrouter|\/api\/(?:chat|ai|generate)/i.test(source)) {
    list.push({ key: 'ai', label: 'Fonctions d’IA', hint: 'Ajoutez votre propre clé : celle du créateur n’est jamais copiée.' });
  }
  const envNames = [...new Set([...source.matchAll(/import\.meta\.env\.([A-Z][A-Z0-9_]+)/g)].map(match => match[1]))].filter(name => !['MODE', 'DEV', 'PROD', 'BASE_URL', 'SSR'].includes(name) && !/^VITE_(?:SUPABASE|STRIPE)/.test(name));
  if (envNames.length) list.push({ key: 'env', label: 'Variables d’environnement', hint: `À renseigner : ${envNames.slice(0, 6).join(', ')}.` });
  list.push({ key: 'domain', label: 'Domaine personnalisé', hint: 'Le domaine du créateur n’est pas copié : ajoutez le vôtre à la publication.' });
  return list;
}

export type Attribution = { listingId: string; title: string; creator: string };

/** The line that stays with the copy: where it came from, with a way back. */
export function attributionNote(attribution: Attribution): string {
  return `Remixé depuis « ${attribution.title.slice(0, 80)} » — ${attribution.creator}`;
}

/** What the new project remembers about its origin: shown in the builder, linked to the original. */
export function remixMetadata(attribution: Attribution) {
  return { remixed_from: { listing_id: attribution.listingId, title: attribution.title.slice(0, 120), creator: attribution.creator.slice(0, 80) } };
}
