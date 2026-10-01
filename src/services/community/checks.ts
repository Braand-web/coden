/**
 * The automatic checks an app passes before it is listed. Everything here is pure: the page is rendered and fetched
 * elsewhere (`pipeline.ts`), and its facts are passed in, so each rule can be tested on its own.
 *
 * A check never blocks the app's *publication* — only its listing. Each returns an outcome:
 *   pass   — nothing to say
 *   warn   — listed, but not featured (low quality, login-only…) or noted for the owner
 *   fail   — not listed, the owner can fix it (« à corriger »)
 *   block  — not listed, and refused (security or moderation); the owner is told why and may contest
 */
import { containsSecret } from '../secret-redaction.ts';
import { isStarterEntryUntouched, STARTERS } from '../sandbox/starters.ts';

export type CheckOutcome = 'pass' | 'warn' | 'fail' | 'block';
export type CheckKey = 'technical' | 'security' | 'moderation' | 'privacy' | 'quality' | 'duplicate' | 'abuse';
export type CheckResult = {
  key: CheckKey;
  outcome: CheckOutcome;
  /** Stable machine code, kept in the decision journal. */
  code: string;
  /** A sentence the owner can read and act on. */
  reason: string;
  /** What to do about it, when there is something to do. */
  remedy?: string;
  data?: Record<string, unknown>;
};

export type SourceFile = { path: string; content: string };

const norm = (path: string) => String(path || '').replace(/\\/g, '/').replace(/^\.\/+/, '').toLowerCase();

// ── 2. Security ───────────────────────────────────────────────────────────────────────────────────────────────────

/** Files that never reach the browser: the server side of the app, its migrations, its examples. */
function reachesBrowser(path: string): boolean {
  const p = norm(path);
  if (/^(supabase\/(functions|migrations)|functions|server|api|scripts|tests?|\.github)\//.test(p)) return false;
  if (/(^|\/)\.env(\.|$)/.test(p) && /example|sample|template/.test(p)) return false;
  if (/\.(md|sql|lock|png|jpe?g|webp|gif|svg|ico|woff2?|ttf|map)$/.test(p) || /package-lock\.json$/.test(p)) return false;
  return true;
}

const EXTRA_SECRETS: Array<{ kind: string; re: RegExp }> = [
  { kind: 'Clé Anthropic', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { kind: 'Clé OpenRouter', re: /\bsk-or-v1-[A-Za-z0-9]{20,}/ },
  { kind: 'Clé OpenAI', re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/ },
  { kind: 'Clé AWS', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { kind: 'Clé Resend', re: /\bre_[A-Za-z0-9]{24,}/ },
  { kind: 'Clé SendGrid', re: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/ },
  { kind: 'Clé privée', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  { kind: 'Clé Stripe secrète', re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/ },
  { kind: 'Clé Supabase secrète', re: /\bsb_secret_[A-Za-z0-9_-]{16,}/ },
];

export type SecretFinding = { file: string; kind: string };

/**
 * A secret is a value that would let someone act as the owner. Public keys are not secrets and must not be confused with
 * them: the Supabase anon key, a Stripe `pk_…`, a `sb_publishable_…`, a Google Maps key are meant for the browser.
 * `containsSecret` already tells a service-role JWT from an anon one by decoding its role. Values are never returned.
 */
export function scanSecrets(files: SourceFile[]): SecretFinding[] {
  const found: SecretFinding[] = [];
  for (const file of files) {
    if (!reachesBrowser(file.path)) continue;
    const text = String(file.content || '');
    if (!text) continue;
    let kind = '';
    for (const rule of EXTRA_SECRETS) if (rule.re.test(text)) { kind = rule.kind; break; }
    if (!kind && containsSecret(text)) kind = 'Clé ou jeton privé';
    if (!kind && /service[_-]?role/i.test(text) && /\b(?:createClient|supabase)\b/i.test(text) && /service[_-]?role[^\n]{0,40}['"`][A-Za-z0-9._-]{20,}/i.test(text)) kind = 'Clé service_role';
    if (kind) found.push({ file: norm(file.path), kind });
  }
  return found;
}

const SUSPICIOUS_CODE: Array<{ code: string; re: RegExp; label: string }> = [
  { code: 'obfuscated_eval', re: /\beval\s*\(\s*(?:atob|unescape|String\.fromCharCode)\b/i, label: 'du code masqué exécuté à la volée' },
  { code: 'document_write_decoded', re: /document\.write\s*\(\s*(?:unescape|atob|decodeURIComponent)\b/i, label: 'du contenu masqué injecté dans la page' },
  { code: 'crypto_miner', re: /\b(?:coinhive|cryptonight|coin-?imp|minero\.cc|webminepool)\b/i, label: 'un mineur de cryptomonnaie' },
  { code: 'meta_refresh_external', re: /<meta[^>]+http-equiv=["']?refresh["']?[^>]+url=\s*https?:\/\/(?!localhost)/i, label: 'une redirection automatique vers un autre site' },
  { code: 'hidden_iframe', re: /<iframe[^>]+(?:width|height)=["']?[01](?:px)?["']?[^>]*src=["']?https?:\/\//i, label: 'un cadre invisible chargeant un autre site' },
  { code: 'top_redirect', re: /(?:window\.top|top|parent)\.location(?:\.href)?\s*=\s*["'`]https?:\/\//i, label: 'une redirection de la fenêtre parente' },
];

export type SuspiciousFinding = { file: string; code: string; label: string };

export function scanSuspiciousCode(files: SourceFile[]): SuspiciousFinding[] {
  const found: SuspiciousFinding[] = [];
  for (const file of files) {
    if (!reachesBrowser(file.path)) continue;
    const text = String(file.content || '');
    for (const rule of SUSPICIOUS_CODE) if (rule.re.test(text)) found.push({ file: norm(file.path), code: rule.code, label: rule.label });
  }
  return found;
}

export function securityCheck(files: SourceFile[]): CheckResult {
  const secrets = scanSecrets(files);
  if (secrets.length) {
    return {
      key: 'security', outcome: 'block', code: 'secret_in_browser_code',
      reason: `Une clé privée semble livrée au navigateur (${[...new Set(secrets.map(item => item.kind))].join(', ')}). Elle serait visible de tous les visiteurs.`,
      remedy: 'Retirez la clé du code de l’app, révoquez-la chez son fournisseur, puis republiez : Coden l’avait déjà bloquée de la Communauté.',
      data: { files: secrets.map(item => item.file).slice(0, 8), kinds: [...new Set(secrets.map(item => item.kind))] },
    };
  }
  const suspicious = scanSuspiciousCode(files);
  if (suspicious.length) {
    return {
      key: 'security', outcome: 'block', code: 'suspicious_code',
      reason: `Le code contient ${[...new Set(suspicious.map(item => item.label))].join(', ')}.`,
      remedy: 'Retirez ce code, puis republiez.',
      data: { files: suspicious.map(item => item.file).slice(0, 8), codes: [...new Set(suspicious.map(item => item.code))] },
    };
  }
  return { key: 'security', outcome: 'pass', code: 'security_ok', reason: 'Aucune clé privée ni code suspect dans ce que reçoit le navigateur.' };
}

// ── 3. Moderation (cheap filter first) ───────────────────────────────────────────────────────────────────────────

export type ModerationVerdict = 'clear' | 'doubt' | 'block';
export type ModerationResult = { verdict: ModerationVerdict; categories: string[]; terms: string[] };

// Terms that are unambiguous on their own. Short on purpose: this is the cheap first pass, a model looks at the doubtful rest.
const BLOCK_TERMS: Array<{ category: string; re: RegExp }> = [
  { category: 'adult', re: /\b(porn\w*|xxx|hentai|escort girls?|nudes?|sexe? en direct|camgirls?|onlyfans leak\w*)\b/i },
  { category: 'scam', re: /\b(double(?:z|r)? (?:vos|your) (?:bitcoins?|btc|argent|money)|crypto giveaway|gagnez? \d+ ?(?:€|euros?|\$) par jour|send (?:me )?\d+ ?btc|get rich quick|carte bancaire gratuite|free credit cards?)\b/i },
  { category: 'illegal', re: /\b(acheter (?:de la )?(?:drogue|cocaïne|cocaine|h[ée]ro[ïi]ne)|buy (?:cocaine|heroin|meth)|faux (?:papiers|passeports?)|fake (?:id|passport)s?|carding|cvv dumps?)\b/i },
  { category: 'hate', re: /\b(white power|heil hitler|mort aux (?:juifs|arabes|noirs)|death to (?:jews|arabs|blacks))\b/i },
];
const DOUBT_TERMS: Array<{ category: string; re: RegExp }> = [
  { category: 'adult', re: /\b(sexy|adult content|18\+|contenu pour adultes|nsfw|lingerie|strip\w*)\b/i },
  { category: 'scam', re: /\b(investissement garanti|guaranteed returns?|revenu passif garanti|crypto|forex|trading signals?|loterie|lottery|gagner de l'argent)\b/i },
  { category: 'illegal', re: /\b(hack(?:er|ing)? (?:un|a|any) (?:compte|account)|crack(?:ed)? software|torrents?|iptv gratuit|streaming illégal)\b/i },
  { category: 'hate', re: /\b(race supérieure|superior race|nazi|suprémaciste|supremacist)\b/i },
];

export function moderateText(text: string): ModerationResult {
  const value = String(text || '').slice(0, 20_000);
  const blocked = BLOCK_TERMS.filter(rule => rule.re.test(value));
  if (blocked.length) return { verdict: 'block', categories: [...new Set(blocked.map(rule => rule.category))], terms: blocked.map(rule => (value.match(rule.re) || [''])[0].toLowerCase()).slice(0, 5) };
  const doubtful = DOUBT_TERMS.filter(rule => rule.re.test(value));
  if (doubtful.length) return { verdict: 'doubt', categories: [...new Set(doubtful.map(rule => rule.category))], terms: doubtful.map(rule => (value.match(rule.re) || [''])[0].toLowerCase()).slice(0, 5) };
  return { verdict: 'clear', categories: [], terms: [] };
}

// Brands people are phished through. A page *about* them (a clone of the login page) is the problem, not a mention.
const BRANDS = ['paypal', 'apple', 'google', 'gmail', 'microsoft', 'outlook', 'facebook', 'instagram', 'whatsapp', 'netflix', 'amazon', 'binance', 'coinbase', 'orange money', 'mtn', 'wave', 'moov', 'visa', 'mastercard', 'société générale', 'bnp', 'crédit agricole', 'la poste', 'impots', 'ameli', 'chronopost', 'dhl', 'coden'];
const NEUTRAL_FRAMING = /\b(clone|inspired|inspir[ée]|template|mod[èe]le|d[ée]mo|demo|ui kit|redesign|concept|maquette|exercice|tutorial|tutoriel)\b/i;

export type ImpersonationInput = { title?: string; description?: string; visibleText?: string; hasPasswordField?: boolean };

/** A login page that wears a known brand's name is a phishing page until proven otherwise. */
export function detectImpersonation(input: ImpersonationInput): { verdict: ModerationVerdict; brand: string | null } {
  const head = `${input.title || ''} ${input.description || ''}`.toLowerCase();
  const text = `${head} ${String(input.visibleText || '').slice(0, 3000).toLowerCase()}`;
  const brand = BRANDS.find(name => new RegExp(`(^|[^a-zà-ÿ])${name.replace(/\s+/g, '\\s+')}([^a-zà-ÿ]|$)`, 'i').test(text)) || null;
  if (!brand) return { verdict: 'clear', brand: null };
  const loginWords = /\b(connexion|se connecter|log ?in|sign ?in|mot de passe|password|identifiant|v[ée]rifi\w+ (?:votre|your) (?:compte|account)|account (?:suspended|locked)|compte (?:suspendu|bloqu[ée]))\b/i.test(text);
  const inHead = new RegExp(`(^|[^a-zà-ÿ])${brand.replace(/\s+/g, '\\s+')}([^a-zà-ÿ]|$)`, 'i').test(head);
  if (input.hasPasswordField && loginWords && !NEUTRAL_FRAMING.test(head)) return { verdict: 'block', brand };
  if ((input.hasPasswordField || loginWords) && inHead && !NEUTRAL_FRAMING.test(head)) return { verdict: 'doubt', brand };
  return { verdict: 'clear', brand };
}

// ── 4. Privacy ────────────────────────────────────────────────────────────────────────────────────────────────────

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// 8 to 15 digits with the usual separators, optionally prefixed by + or 00: international, French and Cameroonian forms.
const PHONE_RE = /(?<![\w.])(?:\+|00)?\d(?:[\s.\-()]?\d){7,14}(?!\w|\.\d)/g;
const PLACEHOLDER_EMAIL = /@(?:example|test|domain|email|votresite|monsite|yourdomain|company)\.|^(?:john|jane|test|demo|contact|hello|info|you|user|name)@/i;

export type PersonalData = { emails: string[]; phones: string[] };

export function findPersonalData(text: string): PersonalData {
  const value = String(text || '');
  const emails = [...new Set((value.match(EMAIL_RE) || []).filter(email => !PLACEHOLDER_EMAIL.test(email)))];
  const phones = [...new Set((value.match(PHONE_RE) || []).map(item => item.trim()).filter(item => {
    const digits = item.replace(/\D/g, '');
    // A year range, a price, a plain long number: not a phone. Phones are 8–15 digits and either start with + / 0 or are grouped.
    return digits.length >= 8 && digits.length <= 15 && (/^[+0]/.test(item) || /[\s.\-()]/.test(item)) && !/^(?:19|20)\d{2}[\s.\-]/.test(item);
  }))];
  return { emails, phones };
}

export function privacyCheck(input: { title: string; description: string }): CheckResult {
  const found = findPersonalData(`${input.title}\n${input.description}`);
  if (found.emails.length || found.phones.length) {
    return {
      key: 'privacy', outcome: 'fail', code: 'personal_data_in_text',
      reason: 'Le titre ou la description contient une adresse e-mail ou un numéro de téléphone, qui serait visible de tous.',
      remedy: 'Retirez-le du titre et de la description, puis enregistrez.',
      data: { emails: found.emails.length, phones: found.phones.length },
    };
  }
  return { key: 'privacy', outcome: 'pass', code: 'privacy_ok', reason: 'Aucune donnée personnelle dans le titre ni la description.' };
}

// ── 1 + 5. What the rendered page tells us ───────────────────────────────────────────────────────────────────────

export type PageSignals = {
  /** The public address answered with a page. */
  reachable: boolean;
  status?: number;
  /** Visible text length, images, canvases once the page rendered. */
  textLength: number;
  imageCount?: number;
  canvasCount?: number;
  consoleErrors?: string[];
  pageErrors?: string[];
  hasPasswordField?: boolean;
  /** The only thing on the page is a sign-in form. */
  loginOnly?: boolean;
  visibleText?: string;
  title?: string;
  lang?: string;
  hasViewportMeta?: boolean;
  hasMetaDescription?: boolean;
  h1Count?: number;
  imagesWithoutAlt?: number;
  landmarkCount?: number;
  sectionCount?: number;
  cssVariableCount?: number;
  mediaQueryCount?: number;
  horizontalOverflowAtMobile?: boolean;
  fontFamilyCount?: number;
};

export function technicalCheck(signals: PageSignals): CheckResult {
  if (!signals.reachable) {
    return { key: 'technical', outcome: 'fail', code: 'unreachable', reason: 'L’adresse publique de l’app ne répond pas.', remedy: 'Vérifiez que l’app est bien en ligne, puis republiez.' };
  }
  const empty = signals.textLength < 20 && !(signals.imageCount || 0) && !(signals.canvasCount || 0);
  if (empty) {
    return { key: 'technical', outcome: 'fail', code: 'empty_render', reason: 'La page s’affiche vide.', remedy: 'Ouvrez l’app publiée : si elle est blanche, demandez à Coden de corriger l’erreur, puis republiez.' };
  }
  const blocking = [...(signals.pageErrors || []), ...(signals.consoleErrors || [])].filter(message => !/favicon|ResizeObserver|net::ERR_BLOCKED|Failed to load resource.*(?:analytics|fonts)/i.test(message));
  if ((signals.pageErrors || []).length) {
    return { key: 'technical', outcome: 'fail', code: 'page_error', reason: 'Une erreur bloque l’affichage de la page.', remedy: 'Demandez à Coden de corriger l’erreur affichée dans la console, puis republiez.', data: { sample: blocking.slice(0, 2).map(message => message.slice(0, 160)) } };
  }
  return { key: 'technical', outcome: 'pass', code: 'technical_ok', reason: 'L’app répond et s’affiche.', data: { consoleErrors: blocking.length } };
}

/**
 * A 0–100 score on Coden's own design grid: does it render richly, is it accessible, does it use a system (tokens,
 * responsive rules) rather than ad-hoc styling, is the content more than a placeholder. It orders the Community and
 * decides what may be featured; it never hides an app by itself.
 */
export function qualityScore(signals: PageSignals): number {
  let score = 0;
  // Render (30)
  if (signals.reachable) score += 8;
  if (signals.textLength >= 80) score += 8; else if (signals.textLength >= 30) score += 4;
  if ((signals.sectionCount || 0) >= 3) score += 6; else if ((signals.sectionCount || 0) >= 2) score += 3;
  const errors = (signals.pageErrors || []).length * 3 + (signals.consoleErrors || []).length;
  score += Math.max(0, 8 - errors * 2);
  // Accessibility basics (25)
  if (signals.lang) score += 4;
  if (signals.hasViewportMeta) score += 4;
  if ((signals.h1Count || 0) === 1) score += 5; else if ((signals.h1Count || 0) > 1) score += 2;
  if ((signals.landmarkCount || 0) >= 2) score += 5; else if ((signals.landmarkCount || 0) === 1) score += 2;
  if (signals.hasMetaDescription) score += 3;
  score += (signals.imageCount || 0) === 0 ? 4 : Math.round(4 * (1 - Math.min(1, (signals.imagesWithoutAlt || 0) / (signals.imageCount || 1))));
  // Design system (25)
  if ((signals.cssVariableCount || 0) >= 8) score += 10; else if ((signals.cssVariableCount || 0) >= 3) score += 5;
  if ((signals.mediaQueryCount || 0) >= 2) score += 7; else if ((signals.mediaQueryCount || 0) === 1) score += 3;
  const fonts = signals.fontFamilyCount || 0;
  if (fonts >= 1 && fonts <= 3) score += 4; else if (fonts > 3) score += 1;
  if (signals.horizontalOverflowAtMobile === false) score += 4;
  // Content (20)
  if (signals.textLength >= 400) score += 10; else if (signals.textLength >= 150) score += 6;
  if ((signals.imageCount || 0) + (signals.canvasCount || 0) >= 1) score += 5;
  if (signals.title && signals.title.trim().length >= 3 && !/^(?:vite|react|document|untitled|coden)\b/i.test(signals.title.trim())) score += 5;
  return Math.max(0, Math.min(100, score));
}

export const FEATURE_MIN_SCORE = 70;
export const LIST_MIN_SCORE = 0;

export function qualityCheck(signals: PageSignals, files: SourceFile[]): CheckResult {
  const score = qualityScore(signals);
  const starterUntouched = Object.values(STARTERS).some(starter => isStarterEntryUntouched(files, starter));
  if (starterUntouched) {
    return { key: 'quality', outcome: 'fail', code: 'unmodified_template', reason: 'L’app est encore le modèle de départ, sans contenu à elle.', remedy: 'Décrivez votre app à Coden pour la construire, puis republiez.', data: { score } };
  }
  if (signals.loginOnly) {
    return { key: 'quality', outcome: 'warn', code: 'login_only', reason: 'La page publique n’est qu’un écran de connexion : elle sera visible mais jamais mise en avant.', data: { score, featurable: false } };
  }
  if (score < 35) {
    return { key: 'quality', outcome: 'warn', code: 'low_quality', reason: 'La qualité est faible : l’app sera visible mais jamais mise en avant.', remedy: 'Demandez à Coden d’améliorer la mise en page, les titres et le contenu.', data: { score, featurable: false } };
  }
  return { key: 'quality', outcome: 'pass', code: 'quality_ok', reason: `Qualité ${score}/100.`, data: { score, featurable: score >= FEATURE_MIN_SCORE } };
}

// ── 5b. Near-duplicates ──────────────────────────────────────────────────────────────────────────────────────────

function fnv64(token: string): bigint {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < token.length; index += 1) {
    hash ^= BigInt(token.charCodeAt(index));
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash;
}

/** A 64-bit simhash of the app's own words: two apps that say the same things land a few bits apart. Hex, 16 chars. */
export function contentFingerprint(files: SourceFile[], visibleText = ''): string {
  const own = files.filter(file => /^src\/.+\.(?:tsx?|jsx?|html|css)$/i.test(norm(file.path)) || /(^|\/)index\.html$/i.test(norm(file.path)))
    .filter(file => !/(^|\/)(?:main|index)\.(?:tsx?|jsx?)$/i.test(norm(file.path)) || file.content.length > 400);
  const text = `${visibleText}\n${own.map(file => file.content).join('\n')}`.toLowerCase().replace(/[^a-zà-ÿ0-9]+/g, ' ');
  const words = text.split(' ').filter(word => word.length > 2).slice(0, 6000);
  if (words.length < 12) return '';
  const weights = new Array<number>(64).fill(0);
  for (let index = 0; index < words.length - 1; index += 1) {
    const hash = fnv64(`${words[index]} ${words[index + 1]}`);
    for (let bit = 0; bit < 64; bit += 1) weights[bit] += (hash >> BigInt(bit)) & 1n ? 1 : -1;
  }
  let fingerprint = 0n;
  for (let bit = 0; bit < 64; bit += 1) if (weights[bit] > 0) fingerprint |= 1n << BigInt(bit);
  return fingerprint.toString(16).padStart(16, '0');
}

export function hammingDistance(a: string, b: string): number {
  if (!a || !b || a.length !== 16 || b.length !== 16) return 64;
  let diff = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let count = 0;
  while (diff) { count += Number(diff & 1n); diff >>= 1n; }
  return count;
}

export const DUPLICATE_MAX_DISTANCE = 4;

export function duplicateCheck(fingerprint: string, others: Array<{ id: string; title: string; fingerprint: string }>): CheckResult {
  if (!fingerprint) return { key: 'duplicate', outcome: 'pass', code: 'duplicate_skipped', reason: 'Pas assez de contenu pour comparer.' };
  const twin = others.find(other => other.fingerprint && hammingDistance(fingerprint, other.fingerprint) <= DUPLICATE_MAX_DISTANCE);
  if (twin) {
    return { key: 'duplicate', outcome: 'fail', code: 'near_duplicate', reason: `Cette app est quasi identique à une app déjà présente dans la Communauté (« ${twin.title.slice(0, 60)} »).`, remedy: 'Personnalisez davantage le contenu et le design, puis republiez.', data: { duplicateOf: twin.id } };
  }
  return { key: 'duplicate', outcome: 'pass', code: 'duplicate_ok', reason: 'Contenu original.' };
}

// ── The verdict ──────────────────────────────────────────────────────────────────────────────────────────────────

export type ListingState = 'online' | 'needs_fix' | 'refused';
export type Severity = 'minor' | 'major' | 'critical';
export type Verdict = {
  state: ListingState;
  severity: Severity | null;
  code: string;
  reason: string;
  remedy?: string;
  featurable: boolean;
  qualityScore: number | null;
  results: CheckResult[];
};

/**
 * One verdict from all the results: the worst outcome decides. `block` → refused (critical), `fail` → to fix (minor, or
 * major for a technical failure that left the page unusable). A warning keeps the app online but takes it out of the
 * featured places.
 */
export function decideVerdict(results: CheckResult[]): Verdict {
  const block = results.find(result => result.outcome === 'block');
  const fail = results.find(result => result.outcome === 'fail');
  const warn = results.filter(result => result.outcome === 'warn');
  const quality = results.find(result => result.key === 'quality');
  const score = typeof quality?.data?.score === 'number' ? Number(quality.data.score) : null;
  const featurable = !block && !fail && !warn.some(result => result.data?.featurable === false) && (score === null || score >= FEATURE_MIN_SCORE);
  if (block) return { state: 'refused', severity: 'critical', code: block.code, reason: block.reason, remedy: block.remedy, featurable: false, qualityScore: score, results };
  if (fail) {
    const major = fail.key === 'technical' || fail.key === 'security';
    return { state: 'needs_fix', severity: major ? 'major' : 'minor', code: fail.code, reason: fail.reason, remedy: fail.remedy, featurable: false, qualityScore: score, results };
  }
  return { state: 'online', severity: null, code: warn[0]?.code || 'checks_passed', reason: warn[0]?.reason || 'Toutes les vérifications sont passées.', featurable, qualityScore: score, results };
}

/**
 * A republication: which version do visitors see while the new one is being judged, and after?
 *  - the new one passes → it replaces the old one;
 *  - it fails minor or major → the last validated version stays, the owner is told what to fix;
 *  - it fails critical (secret, malicious, moderation) → the listing comes down: the new version is the one the creator
 *    published, and what is live there is the problem.
 */
export function republicationOutcome(verdict: Verdict, hasValidatedVersion: boolean): 'replace' | 'keep_previous' | 'remove' {
  if (verdict.state === 'online') return 'replace';
  if (verdict.severity === 'critical') return 'remove';
  return hasValidatedVersion ? 'keep_previous' : 'remove';
}
