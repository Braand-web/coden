/**
 * Coden's own learning layer.
 *
 * The models behind OpenRouter cannot be retrained from here. What can improve
 * is everything Coden hands them and how it chooses between them:
 *
 * - quality signals (runs, errors a round fixed, retries, feedback, reverts),
 *   stored as structured, content-free facts;
 * - a global knowledge base built from those facts, anonymised, shared with
 *   every user including the newest: normalised error signatures with the fix
 *   that worked, stacks that verified for a kind of application;
 * - a private memory per user (stack, language, style), read only for them;
 * - retrieval before each task, from both;
 * - the Auto router's choice nudged by measured success rates.
 *
 * Privacy is by construction, not only by filtering. Knowledge rows are built
 * from templates over normalised signals — never from a prompt, a file body,
 * a database row or a chat message — and every string that does pass (an
 * error message) goes through `anonymizeText` first. A pattern is only shown
 * to others once it has been seen from at least two contributors, so nothing
 * unique to one person can surface. Contributors are salted hashes, so a
 * person who opts out can be purged, retroactively, without the base ever
 * holding who they are.
 */
import { createHmac } from 'node:crypto';
import { redactSecrets } from './secret-redaction.ts';

// ─── Anonymisation ──────────────────────────────────────────────────────────

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const URL = /\bhttps?:\/\/[^\s'"`<>)]+/gi;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const PHONE = /\+?\d[\d\s().-]{7,}\d/g;
const LONG_HEX = /\b[0-9a-f]{24,}\b/gi;
const LONG_TOKEN = /\b[A-Za-z0-9_-]{32,}\b/g;
const PATH = /(?:[A-Za-z]:)?(?:[./~]|\b[\w@-]+\/)[\w@./-]*\/[\w@.-]+/g;

/**
 * Removes what could identify a person, a company or a secret from a short
 * technical string: keys and tokens, e-mails, URLs, UUIDs, IPs, phone numbers,
 * file paths (the extension is kept, it is the useful part) and quoted
 * literals other than package names.
 */
export function anonymizeText(value: unknown, maxLength = 300): string {
  let text = redactSecrets(String(value ?? ''), '<secret>');
  text = text
    .replace(JWT, '<token>')
    .replace(EMAIL, '<email>')
    .replace(URL, '<url>')
    .replace(UUID, '<id>')
    .replace(IPV4, '<ip>')
    .replace(LONG_HEX, '<hex>')
    .replace(LONG_TOKEN, '<token>')
    .replace(PATH, match => {
      const extension = match.match(/\.([a-z0-9]{1,6})$/i)?.[1];
      return extension ? `<file.${extension.toLowerCase()}>` : '<path>';
    })
    .replace(PHONE, '<n>')
    // Quoted literals: keep only what looks like a package or a code keyword.
    .replace(/(['"`«])([^'"`»\n]{1,80})(['"`»])/g, (_all, _open, inner: string) => (isPackageName(inner) || /^[a-z][a-zA-Z0-9_]{0,24}$/.test(inner) ? `'${inner}'` : "'<x>'"))
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

/** npm package names: lower-case, optionally scoped, no path segments beyond the scope. */
export function isPackageName(value: string): boolean {
  return /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]{0,60}$/.test(value);
}

/** Scopes whose packages are public, well-known libraries rather than someone's private code. */
const PUBLIC_SCOPES = new Set([
  '@supabase', '@radix-ui', '@tanstack', '@tailwindcss', '@vitejs', '@types', '@hookform', '@dnd-kit', '@headlessui',
  '@heroicons', '@emotion', '@mui', '@chakra-ui', '@reduxjs', '@stripe', '@clerk', '@auth', '@sentry', '@vercel',
  '@fontsource', '@react-three', '@testing-library', '@floating-ui', '@tiptap', '@uiw', '@nivo', '@visx', '@mantine',
  '@phosphor-icons', '@tabler', '@lexical', '@xyflow', '@react-pdf', '@hello-pangea', '@googlemaps', '@mapbox',
]);

export function isPublicPackage(name: string): boolean {
  if (!isPackageName(name)) return false;
  if (!name.startsWith('@')) return true;
  return PUBLIC_SCOPES.has(name.split('/')[0]);
}

// ─── Signatures ─────────────────────────────────────────────────────────────

/**
 * A stable key for "the same error": first line, anonymised, then line and
 * column numbers and remaining digits removed, lower-cased.
 */
export function errorSignature(message: string): string {
  const firstLine = String(message || '').split('\n').find(line => line.trim()) || '';
  return anonymizeText(firstLine, 400)
    .replace(/\(\d+,\d+\)|:\d+:\d+|\bline \d+\b|\bcolumn \d+\b/gi, '')
    .replace(/\b\d+\b/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .slice(0, 200);
}

/** A human description of how an error class is usually fixed, from the error alone. */
export function fixCategory(message: string, missingPackage?: string): string {
  const text = String(message || '');
  if (missingPackage && isPublicPackage(missingPackage)) return `installer le paquet « ${missingPackage} » avec install_package plutôt que réécrire l'import`;
  if (/failed to resolve import|cannot find module|module not found/i.test(text)) return 'vérifier le chemin relatif de l\'import (fichier renommé ou extension manquante) ou installer le paquet manquant';
  if (/is not exported|does not provide an export|has no exported member/i.test(text)) return 'aligner l\'import sur l\'export réel (export par défaut vs nommé)';
  if (/cannot find name|is not defined/i.test(text)) return 'importer ou déclarer l\'identifiant avant usage';
  if (/property .* does not exist on type|not assignable to/i.test(text)) return 'corriger le type ou l\'interface plutôt que caster en any';
  if (/unexpected token|expected .*but found|unterminated/i.test(text)) return 'corriger la syntaxe JSX/TS du fichier signalé (balise ou accolade non fermée)';
  if (/cannot read propert(y|ies) of (undefined|null)/i.test(text)) return 'protéger l\'accès avec une valeur par défaut ou un état de chargement';
  if (/hydration|each child in a list should have a unique "key"/i.test(text)) return 'donner une clé stable aux éléments de liste et un rendu identique serveur/client';
  if (/tailwind|postcss|unknown at rule/i.test(text)) return 'vérifier la configuration Tailwind/PostCSS du projet avant de modifier les classes';
  if (/supabase|jwt|row-level security|permission denied/i.test(text)) return 'vérifier les politiques RLS et utiliser le client Supabase du projet plutôt qu\'une clé en dur';
  return 'lire le fichier signalé, corriger la cause précise et relancer la vérification';
}

// ─── Knowledge rows ─────────────────────────────────────────────────────────

export type KnowledgeKind = 'error_fix' | 'stack_pattern' | 'routing';

export type KnowledgeRow = {
  contributor: string | null;
  kind: KnowledgeKind;
  task_type: string;
  signature: string;
  content: string;
  created_at?: string;
};

export type ResolvedProblem = { message: string; source?: string; missingPackage?: string; file?: string };

/** Knowledge rows for errors a round made disappear. */
export function errorFixKnowledge(problems: ResolvedProblem[], taskType: string, contributor: string): KnowledgeRow[] {
  const seen = new Set<string>();
  const rows: KnowledgeRow[] = [];
  for (const problem of problems.slice(0, 12)) {
    const signature = errorSignature(problem.message);
    if (signature.length < 8 || seen.has(signature)) continue;
    seen.add(signature);
    const extension = String(problem.file || '').match(/\.([a-z0-9]{1,6})$/i)?.[1]?.toLowerCase();
    const where = [problem.source, extension ? `fichier .${extension}` : ''].filter(Boolean).join(', ');
    rows.push({
      contributor,
      kind: 'error_fix',
      task_type: taskType,
      signature: `err:${signature}`,
      content: `Erreur « ${signature} »${where ? ` (${where})` : ''} → corrigée en : ${fixCategory(problem.message, problem.missingPackage)}.`.slice(0, 600),
    });
  }
  return rows;
}

/** The dependencies of a verified application, public packages only. */
export function stackFromPackageJson(content: string | undefined): string[] {
  try {
    const json = JSON.parse(String(content || '{}'));
    const names = Object.keys({ ...(json.dependencies || {}), ...(json.devDependencies || {}) });
    const skip = /^(react|react-dom|typescript|vite|@vitejs\/plugin-react|@types\/.+|eslint.*|prettier|postcss|autoprefixer)$/;
    return names.filter(name => isPublicPackage(name) && !skip.test(name)).sort().slice(0, 14);
  } catch {
    return [];
  }
}

export function stackPatternKnowledge(appKind: string, taskType: string, stack: string[], contributor: string): KnowledgeRow | null {
  const kind = String(appKind || 'application').replace(/[^a-z0-9_-]/gi, '').toLowerCase().slice(0, 40) || 'application';
  if (stack.length < 2) return null;
  return {
    contributor,
    kind: 'stack_pattern',
    task_type: taskType,
    signature: `stack:${kind}:${stack.join(',')}`.slice(0, 300),
    content: `Application de type ${kind} construite et vérifiée avec : ${stack.join(', ')}.`.slice(0, 600),
  };
}

// ─── Retrieval ──────────────────────────────────────────────────────────────

/** Patterns from a single contributor never reach anyone else. */
export const MIN_DISTINCT_CONTRIBUTORS = 2;

function terms(text: string): Set<string> {
  return new Set(String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9@/_-]+/).filter(term => term.length > 2));
}

export type RankedKnowledge = { signature: string; content: string; kind: KnowledgeKind; contributors: number; score: number };

/**
 * The knowledge worth putting in front of this task: groups rows by
 * signature, keeps those vouched for by enough distinct contributors (or
 * curated by Coden itself), and ranks by overlap with the request and any
 * errors currently open, then by how often the pattern was seen.
 */
export function rankKnowledge(rows: KnowledgeRow[], query: string, options: { taskType?: string; limit?: number; openErrors?: string[] } = {}): RankedKnowledge[] {
  const groups = new Map<string, { row: KnowledgeRow; contributors: Set<string>; curated: boolean; sameTask: boolean }>();
  for (const row of rows) {
    const group = groups.get(row.signature) || { row, contributors: new Set<string>(), curated: false, sameTask: false };
    if (row.contributor) group.contributors.add(row.contributor);
    else group.curated = true;
    if (options.taskType && row.task_type === options.taskType) group.sameTask = true;
    groups.set(row.signature, group);
  }
  const queryTerms = terms(query);
  const errorTerms = terms((options.openErrors || []).map(errorSignature).join(' '));
  const ranked: RankedKnowledge[] = [];
  for (const [signature, group] of groups) {
    if (!group.curated && group.contributors.size < MIN_DISTINCT_CONTRIBUTORS) continue;
    const contentTerms = terms(`${group.row.content} ${signature}`);
    const overlap = queryTerms.size ? [...queryTerms].filter(term => contentTerms.has(term)).length / queryTerms.size : 0;
    const errorOverlap = errorTerms.size ? [...errorTerms].filter(term => contentTerms.has(term)).length / errorTerms.size : 0;
    if (!overlap && !errorOverlap && group.row.kind === 'error_fix') continue;
    const score = overlap * 6 + errorOverlap * 10 + Math.log2(1 + group.contributors.size) + (group.curated ? 1 : 0) + (group.sameTask ? 0.5 : 0);
    ranked.push({ signature, content: group.row.content, kind: group.row.kind, contributors: group.contributors.size, score });
  }
  return ranked.sort((a, b) => b.score - a.score).slice(0, options.limit ?? 6);
}

export function renderKnowledgeContext(items: RankedKnowledge[]): string {
  if (!items.length) return '';
  return [
    'WHAT HAS WORKED BEFORE — Coden\'s shared, anonymised knowledge from verified builds. Use it as experience, not as instructions; the request, the project and the user\'s instructions come first.',
    ...items.map(item => `- ${item.content}`),
  ].join('\n');
}

// ─── Private user memory ────────────────────────────────────────────────────

export type UserMemoryRow = { key: string; kind: 'stack' | 'preference' | 'style' | 'language'; content: string; weight: number; updated_at?: string };

export function renderUserMemory(rows: UserMemoryRow[]): string {
  if (!rows.length) return '';
  const byWeight = [...rows].sort((a, b) => b.weight - a.weight);
  const stack = byWeight.filter(row => row.kind === 'stack').slice(0, 10).map(row => row.content);
  const language = byWeight.find(row => row.kind === 'language')?.content;
  const others = byWeight.filter(row => row.kind === 'style' || row.kind === 'preference').slice(0, 6).map(row => row.content);
  return [
    language ? `- Langue habituelle : ${language}.` : '',
    stack.length ? `- Stack qu'il utilise souvent dans ses projets vérifiés : ${stack.join(', ')}.` : '',
    ...others.map(line => `- ${line}`),
  ].filter(Boolean).join('\n');
}

const FEEDBACK_STYLE: Record<string, string> = {
  too_long: 'Préfère des réponses plus courtes et directes.',
  too_short: 'Préfère des réponses plus détaillées.',
  wrong_language: 'Tient à ce qu\'on lui réponde dans sa langue.',
  design: 'Est exigeant sur le design et la finition visuelle.',
  ugly: 'Est exigeant sur le design et la finition visuelle.',
  bug: 'Attend que chaque modification soit vérifiée avant d\'être annoncée.',
  broken: 'Attend que chaque modification soit vérifiée avant d\'être annoncée.',
  not_what_i_asked: 'Veut que sa demande soit suivie à la lettre ; demander plutôt que supposer quand c\'est ambigu.',
  wrong: 'Veut que sa demande soit suivie à la lettre ; demander plutôt que supposer quand c\'est ambigu.',
  slow: 'Est sensible à la vitesse : aller à l\'essentiel.',
};

export function styleMemoryFromFeedback(reasons: string[]): UserMemoryRow[] {
  return reasons
    .map(reason => String(reason).toLowerCase())
    .filter(reason => FEEDBACK_STYLE[reason])
    .map(reason => ({ key: `style:${reason}`, kind: 'style' as const, content: FEEDBACK_STYLE[reason], weight: 1 }));
}

// ─── Routing ────────────────────────────────────────────────────────────────

export type ModelStat = { task_type: string; model_id: string; runs: number; successes: number };

/** Fewer runs than this and a model's rate says nothing yet. */
export const MIN_RUNS_FOR_ROUTING = 8;
/** How much better a model must measure before Auto prefers it over its default. */
export const ROUTING_MARGIN = 0.12;

/** Success rate shrunk towards 70 % until there are enough runs to trust it. */
export function smoothedSuccessRate(stat: { runs: number; successes: number }): number {
  const prior = 0.7;
  const weight = 6;
  return (stat.successes + prior * weight) / (stat.runs + weight);
}

/**
 * Among models that all pass the plan, credit and capability gates, in the
 * selector's own order, returns the one measurement says to prefer — or the
 * default when the evidence is thin. Only the first few candidates compete,
 * so a cheap-first order is bent by evidence, never inverted.
 */
export function learnedPreference(eligible: string[], taskType: string, stats: ModelStat[]): { modelId: string; learned: boolean } | null {
  if (!eligible.length) return null;
  const byModel = new Map(stats.filter(stat => stat.task_type === taskType).map(stat => [stat.model_id, stat]));
  const baseline = eligible[0];
  const baseStat = byModel.get(baseline);
  if (!baseStat || baseStat.runs < MIN_RUNS_FOR_ROUTING) return { modelId: baseline, learned: false };
  const baseRate = smoothedSuccessRate(baseStat);
  let best = { modelId: baseline, rate: baseRate };
  for (const candidate of eligible.slice(1, 4)) {
    const stat = byModel.get(candidate);
    if (!stat || stat.runs < MIN_RUNS_FOR_ROUTING) continue;
    const rate = smoothedSuccessRate(stat);
    if (rate >= baseRate + ROUTING_MARGIN && rate > best.rate) best = { modelId: candidate, rate };
  }
  return { modelId: best.modelId, learned: best.modelId !== baseline };
}

let learnedStats: ModelStat[] = [];
/** Refreshed by the server from agent_model_success_stats(); read synchronously by the selector. */
export function setLearnedModelStats(stats: ModelStat[]) {
  learnedStats = stats.filter(stat => stat && stat.model_id && Number.isFinite(Number(stat.runs)))
    .map(stat => ({ task_type: String(stat.task_type), model_id: String(stat.model_id), runs: Number(stat.runs), successes: Number(stat.successes) }));
}
export function getLearnedModelStats(): ModelStat[] {
  return learnedStats;
}

// ─── Contributors ───────────────────────────────────────────────────────────

/** Salted, one-way: lets a person's contributions be found and purged, never read back to them. */
export function contributorHash(userId: string, salt: string): string {
  return createHmac('sha256', salt || 'coden-knowledge').update(String(userId)).digest('hex').slice(0, 32);
}

// ─── Curated knowledge ──────────────────────────────────────────────────────

/**
 * Written by Coden, not learned from anyone: the fixes every React/Vite app
 * needs sooner or later. They give a brand-new account the benefit of the
 * base from its first run.
 */
export const CURATED_KNOWLEDGE: KnowledgeRow[] = [
  { contributor: null, kind: 'error_fix', task_type: 'general', signature: 'err:failed to resolve import', content: 'Erreur « failed to resolve import » → vérifier le chemin relatif et l\'extension ; si c\'est un paquet npm, l\'installer avec install_package au lieu de réécrire l\'import.' },
  { contributor: null, kind: 'error_fix', task_type: 'general', signature: 'err:does not provide an export named', content: 'Erreur « does not provide an export named » → aligner l\'import sur l\'export réel : export par défaut importé sans accolades, export nommé avec.' },
  { contributor: null, kind: 'error_fix', task_type: 'general', signature: 'err:cannot read properties of undefined', content: 'Erreur « cannot read properties of undefined (reading \'map\') » → initialiser les listes à [] et afficher un état de chargement tant que les données ne sont pas arrivées.' },
  { contributor: null, kind: 'error_fix', task_type: 'general', signature: 'err:each child in a list should have a unique key', content: 'Avertissement « each child in a list should have a unique key » → utiliser un identifiant stable de l\'élément comme key, jamais l\'index quand la liste change.' },
  { contributor: null, kind: 'error_fix', task_type: 'general', signature: 'err:tailwind unknown at rule', content: 'Erreur Tailwind « unknown at rule @tailwind/@apply » → vérifier que postcss.config et tailwind.config existent et que le CSS global est importé une seule fois dans main.tsx.' },
  { contributor: null, kind: 'error_fix', task_type: 'general', signature: 'err:new row violates row-level security policy', content: 'Erreur Supabase « new row violates row-level security policy » → ajouter une politique RLS insert/update pour auth.uid() et renseigner user_id côté client, sans désactiver RLS.' },
  { contributor: null, kind: 'error_fix', task_type: 'general', signature: 'err:invalid hook call', content: 'Erreur « invalid hook call » → n\'appeler les hooks qu\'au premier niveau d\'un composant React, jamais dans une condition, une boucle ou une fonction utilitaire.' },
  { contributor: null, kind: 'error_fix', task_type: 'general', signature: 'err:jsx expressions must have one parent element', content: 'Erreur « JSX expressions must have one parent element » → envelopper les éléments frères dans un fragment <>…</>.' },
  { contributor: null, kind: 'error_fix', task_type: 'general', signature: 'err:is not assignable to type', content: 'Erreur TypeScript « is not assignable to type » → corriger l\'interface ou la donnée ; ne pas masquer l\'erreur avec as any.' },
  { contributor: null, kind: 'stack_pattern', task_type: 'code_generation', signature: 'stack:saas:curated', content: 'Tableau de bord SaaS vérifié avec : react-router-dom pour les écrans, @tanstack/react-query pour les données, recharts pour les graphiques, lucide-react pour les icônes.' },
  { contributor: null, kind: 'stack_pattern', task_type: 'code_generation', signature: 'stack:forms:curated', content: 'Formulaires fiables avec react-hook-form et zod pour la validation, messages d\'erreur sous chaque champ.' },
];
