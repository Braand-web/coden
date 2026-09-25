/**
 * The library of reusable sub-agents and skills: pure rules.
 *
 * What an agent or a skill is, how two of them are told apart or recognised
 * as the same, how they are ranked, when one is switched off, and how it is
 * cleaned before anything reaches the shared library. Persistence is in
 * `store.ts`; nothing here touches the network.
 */
import { redactSecrets } from '../secret-redaction.ts';
import { cosineSimilarity, type EmbeddingVector } from '../embeddings.ts';

export type ModelTier = 'fast' | 'balanced' | 'reasoning' | 'design';

export type AgentDefinition = {
  role: string;
  systemPrompt: string;
  /** Sandbox tools this agent may use (read tools are always allowed). */
  tools: string[];
  modelTier: ModelTier;
  /** Where this kind of agent usually works, e.g. "src/components/". */
  scopeHint?: string;
};

export type SkillExample = { title: string; language: string; code: string };

export type SkillDefinition = {
  whenToUse: string;
  instructions: string;
  examples: SkillExample[];
  dependencies: string[];
};

export type LibraryKind = 'agent' | 'skill';
export type LibraryStatus = 'candidate' | 'active' | 'disabled' | 'archived';

export type LibraryItem = {
  id: string;
  kind: LibraryKind;
  slug: string;
  name: string;
  description: string;
  version: number;
  status: LibraryStatus;
  is_latest: boolean;
  parent_id: string | null;
  definition: AgentDefinition | SkillDefinition;
  tags: string[];
  embedding: EmbeddingVector | null;
  uses: number;
  successes: number;
  failures: number;
  contributors: string[];
  created_by: 'agent' | 'admin' | 'curated';
  disabled_reason: string | null;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
};

export const LIMITS = {
  name: 80,
  description: 400,
  systemPrompt: 6_000,
  instructions: 12_000,
  exampleCode: 4_000,
  examples: 4,
  dependencies: 20,
  tools: 12,
};

/* ------------------------------------------------------------------------ */
/* Cleaning: nothing of a user, a project or a secret reaches the library   */
/* ------------------------------------------------------------------------ */

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const LONG_HEX = /\b[0-9a-f]{32,}\b/gi;
const LONG_TOKEN = /\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{36,}\b/g;
const SUPABASE_REF = /\b[a-z0-9]{20}\.supabase\.(co|in)\b/gi;
const URL = /\bhttps?:\/\/[^\s'"`<>)]+/gi;
const PHONE = /(?<![\w.])\+\d[\d\s().-]{7,}\d/g;
/* Documentation and public CDNs stay: they are the point of a skill. */
const PUBLIC_HOSTS = /^(?:[\w-]+\.)*(?:npmjs\.com|github\.com|supabase\.com|stripe\.com|react\.dev|vitejs\.dev|vite\.dev|tailwindcss\.com|developer\.mozilla\.org|nodejs\.org|typescriptlang\.org|reactrouter\.com|tanstack\.com|nextjs\.org|vercel\.com|cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com|openrouter\.ai|composio\.dev|resend\.com|lucide\.dev|radix-ui\.com|ui\.shadcn\.com|example\.com|localhost)$/i;

/**
 * Removes what could identify someone or unlock something: keys and tokens,
 * e-mails, phone numbers, IPs, UUIDs, Supabase project references and links
 * to anything but public documentation. Code keeps its shape.
 */
export function sanitizeForLibrary(value: unknown, maxLength: number): string {
  let text = redactSecrets(String(value ?? ''), '<SECRET>');
  text = text
    .replace(JWT, '<TOKEN>')
    .replace(EMAIL, 'user@example.com')
    .replace(SUPABASE_REF, '<project>.supabase.co')
    .replace(URL, match => {
      try { return PUBLIC_HOSTS.test(new globalThis.URL(match).hostname) ? match : 'https://example.com'; } catch { return 'https://example.com'; }
    })
    .replace(UUID, '00000000-0000-0000-0000-000000000000')
    .replace(IPV4, match => (match === '127.0.0.1' || match === '0.0.0.0' ? match : '203.0.113.1'))
    .replace(LONG_HEX, '<HEX>')
    .replace(LONG_TOKEN, '<TOKEN>')
    .replace(PHONE, '+000 00 00 00 00');
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

const clean = (value: unknown, max: number) => sanitizeForLibrary(String(value ?? '').trim(), max);

export function slugify(name: string): string {
  return String(name || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'item';
}

const TIERS: ModelTier[] = ['fast', 'balanced', 'reasoning', 'design'];

export function normalizeAgentDefinition(input: Partial<AgentDefinition> & { role?: unknown }, allowedTools: readonly string[]): AgentDefinition {
  const tools = Array.isArray(input.tools) ? input.tools.map(String).filter(tool => allowedTools.includes(tool)).slice(0, LIMITS.tools) : [];
  return {
    role: clean(input.role, LIMITS.name),
    systemPrompt: clean(input.systemPrompt, LIMITS.systemPrompt),
    tools: [...new Set(tools)],
    modelTier: TIERS.includes(input.modelTier as ModelTier) ? input.modelTier as ModelTier : 'balanced',
    ...(input.scopeHint ? { scopeHint: clean(input.scopeHint, 200) } : {}),
  };
}

export function normalizeSkillDefinition(input: Omit<Partial<SkillDefinition>, 'examples'> & { examples?: Array<Partial<SkillExample>> } & Record<string, unknown>): SkillDefinition {
  const examples = Array.isArray(input.examples) ? input.examples : [];
  return {
    whenToUse: clean(input.whenToUse, LIMITS.description),
    instructions: clean(input.instructions, LIMITS.instructions),
    examples: examples.slice(0, LIMITS.examples).map((example: any) => ({
      title: clean(example?.title, 120),
      language: clean(example?.language || 'ts', 20).toLowerCase(),
      code: clean(example?.code, LIMITS.exampleCode),
    })).filter(example => example.code),
    dependencies: (Array.isArray(input.dependencies) ? input.dependencies : [])
      .map(dependency => String(dependency).trim())
      .filter(dependency => /^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*(?:@[\w.^~<>=*-]+)?$/i.test(dependency))
      .slice(0, LIMITS.dependencies),
  };
}

/** Why a definition is not fit for the shared library, or null. */
export function libraryRejection(kind: LibraryKind, name: string, definition: AgentDefinition | SkillDefinition): string | null {
  if (name.trim().length < 3) return 'Le nom est trop court.';
  if (kind === 'agent') {
    const agent = definition as AgentDefinition;
    if (agent.systemPrompt.length < 80) return 'Le prompt système est trop court pour être réutilisable.';
  } else {
    const skill = definition as SkillDefinition;
    if (skill.instructions.length < 120) return 'Les instructions sont trop courtes pour être réutilisables.';
    if (!skill.whenToUse) return 'Il manque « quand l’utiliser ».';
  }
  const text = JSON.stringify(definition);
  if ((text.match(/<SECRET>|<TOKEN>/g) || []).length > 3) return 'La définition contenait des secrets : elle doit rester générique.';
  return null;
}

/* ------------------------------------------------------------------------ */
/* Quality                                                                   */
/* ------------------------------------------------------------------------ */

/** Laplace-smoothed: a new item starts at 50 %, not at 0 or 100. */
export function successRate(item: Pick<LibraryItem, 'successes' | 'uses'>): number {
  return (item.successes + 1) / (Math.max(item.uses, item.successes) + 2);
}

export const AUTO_DISABLE = { minUses: 6, maxRate: 0.35 };

export function shouldAutoDisable(item: Pick<LibraryItem, 'successes' | 'uses' | 'created_by'>): boolean {
  return item.created_by !== 'admin' && item.uses >= AUTO_DISABLE.minUses && successRate(item) < AUTO_DISABLE.maxRate;
}

export function embeddingText(item: { name: string; description: string; definition: AgentDefinition | SkillDefinition; tags?: string[] }): string {
  const definition = item.definition as any;
  return [item.name, item.description, definition.role, definition.whenToUse, (definition.dependencies || []).join(' '), (item.tags || []).join(' '), String(definition.instructions || definition.systemPrompt || '').slice(0, 600)].filter(Boolean).join('\n');
}

export type RankedItem = { item: LibraryItem; similarity: number; score: number };

/** Active, latest versions only; similarity weighted by measured success. */
export function rankLibrary(items: LibraryItem[], query: EmbeddingVector, options: { kind: LibraryKind; limit: number; minSimilarity?: number }): RankedItem[] {
  const floor = options.minSimilarity ?? 0.2;
  return items
    .filter(item => item.kind === options.kind && item.status === 'active' && item.is_latest && item.embedding?.length)
    .map(item => {
      const similarity = cosineSimilarity(query, item.embedding!);
      return { item, similarity, score: similarity * (0.6 + 0.4 * successRate(item)) };
    })
    .filter(entry => entry.similarity >= floor)
    .sort((a, b) => b.score - a.score)
    .slice(0, options.limit);
}

export const DUPLICATE_SIMILARITY = 0.88;

/** An existing item this candidate repeats: same slug, or the same meaning. */
export function findEquivalent(items: LibraryItem[], candidate: { kind: LibraryKind; slug: string; embedding: EmbeddingVector | null }): LibraryItem | null {
  const latest = items.filter(item => item.kind === candidate.kind && item.is_latest && item.status !== 'archived');
  const bySlug = latest.find(item => item.slug === candidate.slug);
  if (bySlug) return bySlug;
  if (!candidate.embedding) return null;
  let best: LibraryItem | null = null;
  let bestSimilarity = DUPLICATE_SIMILARITY;
  for (const item of latest) {
    if (!item.embedding?.length) continue;
    const similarity = cosineSimilarity(candidate.embedding, item.embedding);
    if (similarity >= bestSimilarity) { best = item; bestSimilarity = similarity; }
  }
  return best;
}

/* ------------------------------------------------------------------------ */
/* For the model                                                             */
/* ------------------------------------------------------------------------ */

const percent = (value: number) => `${Math.round(value * 100)} %`;

export function renderSkills(skills: Array<{ item: LibraryItem; pitfalls?: string[] }>): string {
  if (!skills.length) return '';
  return [
    '## Skills de la bibliothèque Coden adaptés à cette tâche',
    'Méthodes éprouvées sur d’autres projets. Suis-les quand elles s’appliquent ; adapte-les au projet, ne les copie pas aveuglément.',
    ...skills.map(({ item, pitfalls }) => {
      const skill = item.definition as SkillDefinition;
      return [
        `### ${item.name} (v${item.version}, réussite ${percent(successRate(item))}, id ${item.id})`,
        `Quand l’utiliser : ${skill.whenToUse}`,
        skill.dependencies.length ? `Dépendances : ${skill.dependencies.join(', ')}` : '',
        skill.instructions,
        ...skill.examples.map(example => `Exemple — ${example.title} :\n\`\`\`${example.language}\n${example.code}\n\`\`\``),
        pitfalls?.length ? `Pièges connus :\n${pitfalls.map(line => `- ${line}`).join('\n')}` : '',
      ].filter(Boolean).join('\n');
    }),
  ].join('\n\n');
}

export function renderAgents(agents: LibraryItem[]): string {
  if (!agents.length) return '';
  return [
    '## Sous-agents déjà disponibles dans la bibliothèque',
    'Pour déléguer, réutilise-les par leur id (library_agent_id) plutôt que d’en écrire un nouveau.',
    ...agents.map(item => {
      const agent = item.definition as AgentDefinition;
      return `- ${item.name} — id ${item.id} — ${item.description} (modèle : ${agent.modelTier}, réussite ${percent(successRate(item))}${agent.scopeHint ? `, périmètre habituel : ${agent.scopeHint}` : ''})`;
    }),
  ].join('\n');
}
