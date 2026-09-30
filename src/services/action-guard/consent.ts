/**
 * Did the person authorise this precise action?
 *
 * The only evidence is what they wrote. A sentence like « déploie » authorises
 * deploying; « fais-moi une boutique » does not authorise sending an e-mail,
 * dropping a table or putting anything online, however the agent describes
 * its own plan. What the agent says it wants to do is never consent.
 *
 * The patterns cover the plain phrasings people use, in French and English.
 * They are the fast path: an explicit instruction lets an action through
 * without waiting for a model. Anything less clear is left to the judge, or
 * to a question.
 */
import type { ActionCategory, ToolAction } from './action-types.ts';

const CONSENT: Partial<Record<ActionCategory, RegExp>> = {
  deploy: /(?:\b(?:mets?|mettre|met|passe[rz]?|publie[rz]?|publish|deploy|d[ée]ploie[rz]?|d[ée]ployer|lance[rz]?|go live|ship)\b[^.\n]{0,40}\b(?:en ligne|en prod(?:uction)?|online|live|prod(?:uction)?|le site|mon site|l['’]app(?:lication)?|the site|the app|it)\b|\b(?:d[ée]ploie|d[ée]ployer|publie|publier|deploy|publish)\b|\bmise? en (?:ligne|production)\b|\bgo live\b)/i,
  email: /\b(?:envoie[rz]?|envoyer|send|écris|write|adresse[rz]?)\b[^.\n]{0,60}\b(?:e-?mails?|mails?|courriel|message|newsletter|invitation)\b|\b(?:e-?mail|mail)\b[^.\n]{0,30}\b(?:de test|test|d['’]essai)\b/i,
  sms: /\b(?:envoie[rz]?|envoyer|send)\b[^.\n]{0,60}\b(?:sms|texto|text message|whatsapp)\b/i,
  payment: /\b(?:pay(?:e|er|ez)?|paie[rz]?|charge[rz]?|factur(?:e|er|ez)|rembours(?:e|er|ez)|refund|bill|debit|d[ée]bite[rz]?|encaisse[rz]?|checkout)\b/i,
  // A destructive verb needs its object (« supprime la table », « drop the database »): a bare verb inside a sentence about something else is not an instruction.
  database: /\b(?:supprime[rz]?|supprimer|efface[rz]?|effacer|vide[rz]?|vider|drop|delete|truncate|remove)\b[^.\n]{0,40}\b(?:tables?|bases?|databases?|donn[ée]es|data|colonnes?|columns?|lignes?|rows?|enregistrements?|records?|utilisateurs?|users?|comptes?)\b|\b(?:migre[rz]?|migrer|migrate|migration|cr[ée]e[rz]? (?:la|une|les) table|create (?:the |a )?table|ajoute[rz]? (?:la|une) colonne|add (?:a |the )?column|run (?:this |the )?sql|ex[ée]cute[rz]? (?:cette|la) requ[êe]te)\b/i,
  secrets: /\b(?:variables? d['’]environnement|env(?:ironment)? vars?|secrets?|cl[ée]s? api|api keys?|ajoute[rz]? (?:la|ma|cette) cl[ée]|add (?:the|my|this) key)\b/i,
  permissions: /\b(?:invite[rz]?|inviter|ajoute[rz]? (?:un )?(?:membre|collaborateur)|add (?:a )?(?:member|collaborator)|donne[rz]? (?:l['’])?acc[èe]s|grant access|change[rz]? (?:les )?(?:droits|permissions|r[ôo]les?))\b/i,
  third_party: /\b(?:envoie|poste|publie|cr[ée]e|ajoute|met(?:s)? à jour|supprime|send|post|create|add|update|delete)\b[^.\n]{0,60}\b(?:github|notion|slack|stripe|airtable|supabase|sheets?|calendar|agenda|trello|linear|jira|hubspot|discord)\b/i,
  mass_delete: /\b(?:supprime[rz]?|efface[rz]?|nettoie[rz]?|delete|remove|clean(?: up)?|wipe)\b[^.\n]{0,40}\b(?:tous|toutes|tout|all|every|everything|les fichiers|the files|le dossier|the folder|le projet|the project)\b/i,
  ui_action: /\b(?:clique|cliquer|click|appuie|press|teste|test|essaie|try)\b[^.\n]{0,60}\b(?:supprimer|delete|payer|pay|envoyer|send|d[ée]connexion|log ?out|publier|publish|commander|order|reset|r[ée]initialiser)\b/i,
};

/** An address, a phone number or a hostname an action is aimed at, from its parameters. */
export function actionTargets(action: ToolAction): string[] {
  const found = new Set<string>();
  const walk = (value: unknown, depth = 0) => {
    if (depth > 4 || value == null) return;
    if (typeof value === 'string') {
      for (const match of value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []) found.add(match.toLowerCase());
      for (const match of value.match(/\+?\d[\d .-]{7,}\d/g) || []) found.add(match.replace(/[^\d+]/g, ''));
      return;
    }
    if (Array.isArray(value)) { value.forEach(item => walk(item, depth + 1)); return; }
    if (typeof value === 'object') Object.values(value as Record<string, unknown>).forEach(item => walk(item, depth + 1));
  };
  walk(action.args);
  return [...found];
}

/** Words that turn a verb into a request to build something rather than to do it. */
const FEATURE_FRAMING = /\b(?:ajoute[rz]?|ajouter|cr[ée]e[rz]?|cr[ée]er|permet(?:s|tre)?|fais|faire|construis|construire|impl[ée]mente[rz]?|d[ée]veloppe[rz]?|pr[ée]vois|add|adds|create|allow|allows|let|lets|enable|implement|build|make|develop|bouton|button|formulaire|form|option|fonction(?:nalit[ée])?|feature|page|menu|lien|link|cas o[uù]|when|quand|si|if)\b/i;

/** The tables and columns a database action touches, lowercased, from its SQL or its parameters. */
export function databaseTargets(action: ToolAction): string[] {
  const found = new Set<string>();
  const text = JSON.stringify(action.args);
  for (const match of text.matchAll(/\b(?:table|from|into|update|truncate|alter\s+table|column)\s+(?:if\s+(?:not\s+)?exists\s+)?["`]?([a-z_][a-z0-9_]{2,})["`]?/gi)) {
    const name = match[1].toLowerCase();
    if (!['the', 'set', 'select', 'where', 'values', 'public', 'if'].includes(name)) found.add(name);
  }
  for (const key of ['table', 'table_name', 'tableName', 'column', 'name']) {
    const value = (action.args as any)?.[key] ?? (action.args as any)?.arguments?.[key];
    if (typeof value === 'string' && /^[a-z_][a-z0-9_]{2,}$/i.test(value)) found.add(value.toLowerCase());
  }
  return [...found];
}

/** The message with file names and quoted strings blanked: « utilise le fichier drop-table.csv » asks for no deletion. */
export function withoutNames(message: string): string {
  return String(message || '')
    .replace(/[^\s"'«»“”]+\.(?:csv|json|xlsx?|pdf|png|jpe?g|gif|webp|svg|txt|md|zip|docx?|pptx?|html?|tsx?|jsx?|sql|env)\b/gi, '_')
    .replace(/«[^»]*»|“[^”]*”|"[^"]*"/g, '_');
}

export type ConsentResult = { explicit: boolean; excerpt?: string; missingTarget?: string };

/**
 * Explicit consent for this category in the person's messages.
 * `onlyLast` asks for it in the latest message — what a project rule like « demande-moi toujours » requires.
 */
export function findConsent(category: ActionCategory, action: ToolAction, userMessages: readonly string[], options: { onlyLast?: boolean } = {}): ConsentResult {
  const pattern = CONSENT[category];
  if (!pattern) return { explicit: false };
  const messages = options.onlyLast ? userMessages.slice(-1) : userMessages;
  // File names and quoted text are things the person pointed at, not things they asked for; and a
  // feature they want built ("ajoute un bouton pour supprimer un compte") is not an instruction to do it now.
  const match = messages.map(message => {
    const text = withoutNames(message);
    const found = pattern.exec(text);
    if (!found) return null;
    const sentenceStart = Math.max(text.lastIndexOf('.', found.index), text.lastIndexOf('\n', found.index), text.lastIndexOf('!', found.index), text.lastIndexOf('?', found.index)) + 1;
    return FEATURE_FRAMING.test(text.slice(sentenceStart, found.index)) ? null : found;
  }).find(Boolean);
  if (!match) return { explicit: false };
  // A destructive change to the data must name what it destroys: the tables and columns in the action have to be the ones the person spoke of.
  if (category === 'database') {
    const said = messages.join('\n').toLowerCase();
    const missing = databaseTargets(action).find(target => !said.includes(target));
    if (missing) return { explicit: false, excerpt: match[0].slice(0, 80), missingTarget: missing };
  }
  // A message, an SMS or a payment goes to someone: the person has to have named who.
  if (category === 'email' || category === 'sms') {
    const targets = actionTargets(action);
    const said = messages.join('\n').toLowerCase().replace(/[^\da-z@.+]/g, '');
    const missing = targets.find(target => !said.includes(target.replace(/[^\da-z@.+]/g, '')));
    if (missing) return { explicit: false, excerpt: match[0].slice(0, 80), missingTarget: missing };
  }
  return { explicit: true, excerpt: match[0].replace(/\s+/g, ' ').slice(0, 80) };
}

/** Categories whose consent a rule like « toujours me demander avant de … » or « jamais la production sans me demander » takes over. */
export function alwaysAskCategories(rules: readonly string[]): Set<ActionCategory> {
  const asked = new Set<ActionCategory>();
  for (const rule of rules) {
    const text = String(rule || '').toLowerCase();
    const gate = /(?:jamais|never|toujours (?:me )?demand|always ask|sans (?:me )?(?:demander|pr[ée]venir)|without (?:asking|telling)|ne (?:touche|modifie|d[ée]ploie|supprime)[a-z]* pas|do not (?:touch|deploy|change|delete)|don['’]t (?:touch|deploy|change|delete))/.test(text);
    if (!gate) continue;
    if (/production|\bprod\b|en ligne|live/.test(text)) { asked.add('deploy'); asked.add('database'); asked.add('payment'); }
    if (/d[ée]ploi|deploy|mise? en (?:ligne|prod)|publi/.test(text)) asked.add('deploy');
    if (/e-?mail|mail|sms|message/.test(text)) { asked.add('email'); asked.add('sms'); }
    if (/supprim|delete|efface|drop|base de donn|database|migration/.test(text)) { asked.add('database'); asked.add('mass_delete'); }
    if (/paie|pay|factur|stripe|rembours/.test(text)) asked.add('payment');
    if (/install|paquet|package|d[ée]pendance|dependency/.test(text)) asked.add('install');
    if (/secret|\bcl[ée]s?\b|variable|\benv(?:ironment)?\b/.test(text)) asked.add('secrets');
    if (/service|int[ée]gration|github|notion|slack/.test(text)) asked.add('third_party');
  }
  return asked;
}
