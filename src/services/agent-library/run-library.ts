/**
 * The library around one run: opened before the master writes anything,
 * settled when the run ends.
 */
import type { ChatMessage } from '../openrouter-service.ts';
import { anonymizeText } from '../agent-learning.ts';
import { libraryInMessage, librariesFromPackageJson, type ErrorCategory, type ErrorObservation } from './error-memory.ts';
import { openLibrarySession, type AgentLibraryStore, type ErrorSummarizer, type LibrarySession } from './store.ts';

export type RunLibrary = { store: AgentLibraryStore | null; session: LibrarySession | null; block: string };

const withTimeout = <T,>(promise: Promise<T>, ms: number, fallback: T) => Promise.race([promise, new Promise<T>(resolve => setTimeout(() => resolve(fallback), ms))]);

export async function openRunLibrary(input: {
  store: AgentLibraryStore | null;
  requestId: string;
  contributor: string;
  shareAllowed: boolean;
  task: string;
  files: Array<{ path: string; content?: string }>;
}): Promise<RunLibrary> {
  const session = openLibrarySession({
    requestId: input.requestId,
    contributor: input.contributor,
    shareAllowed: input.shareAllowed,
    projectLibraries: librariesFromPackageJson(input.files.find(file => file.path === 'package.json')?.content),
  });
  if (!input.store) return { store: null, session, block: '' };
  // The library must never slow a run down: a slow read is skipped.
  const retrieval = await withTimeout(input.store.retrieve(session, input.task).catch(() => null), 4_000, null);
  return { store: input.store, session, block: retrieval?.block || '' };
}

export function categoryForSource(source: string | undefined): ErrorCategory {
  const text = String(source || '').toLowerCase();
  if (/test|scenario|journey|browser|acceptance|qa/.test(text)) return 'test';
  if (/runtime|console|server|log|preview/.test(text)) return 'runtime';
  return 'build';
}

/** A message that corrects what Coden did before: "ça ne marche pas", "corrige", "tu as supprimé"… */
export function isUserCorrection(prompt: string): boolean {
  return /\b(ne (marche|fonctionne) (pas|plus)|ça (marche|fonctionne) pas|cass[ée]|corrige|répare|toujours (la même )?erreur|tu as (supprimé|effacé|oublié|cassé)|n'?(a|as) pas (marché|fonctionné)|doesn'?t work|is broken|still (broken|failing)|you (broke|deleted|removed))\b/i.test(prompt);
}

export async function settleRunLibrary(library: RunLibrary | null, input: {
  ok: boolean;
  cancelled: boolean;
  files: Array<{ path: string; content?: string }>;
  resolved: Array<{ message: string; source?: string; missingPackage?: string }>;
  prompt: string;
  summarize?: ErrorSummarizer;
}) {
  if (!library?.store || !library.session) return null;
  const session = library.session;
  const libraries = librariesFromPackageJson(input.files.find(file => file.path === 'package.json')?.content);
  if (Object.keys(libraries).length) session.projectLibraries = libraries;
  const seen = new Set<string>();
  for (const problem of input.resolved.slice(0, 10)) {
    const key = problem.message.slice(0, 200);
    if (seen.has(key)) continue;
    seen.add(key);
    session.errors.push({
      category: categoryForSource(problem.source),
      message: problem.message,
      library: problem.missingPackage || libraryInMessage(problem.message, session.projectLibraries),
      libraries: session.projectLibraries,
      source: problem.source,
    });
  }
  // The user had to ask for a correction and this run delivered it: a lesson, once restated generically.
  if (input.ok && isUserCorrection(input.prompt)) {
    session.errors.push({ category: 'user_correction', message: input.prompt.slice(0, 1_500), libraries: session.projectLibraries, source: 'user' });
  }
  return library.store.settle(session, { success: input.ok, cancelled: input.cancelled }, input.summarize);
}

/**
 * One cheap model call turning observed errors into generic rules. The
 * output is anonymised again by the store before anything is saved.
 */
export function createErrorSummarizer(chat: (modelId: string, messages: ChatMessage[]) => Promise<{ text: string }>, modelId: string): ErrorSummarizer {
  return async observations => {
    const items = observations.map((observation, index) => ({
      index,
      category: observation.category,
      library: observation.library || null,
      message: observation.category === 'user_correction' ? observation.message.slice(0, 1_500) : anonymizeText(observation.message, 400),
      fix_hint: observation.fix || null,
    }));
    const result = await chat(modelId, [
      {
        role: 'system',
        content: 'Tu transformes des erreurs rencontrées en développement web en règles génériques réutilisables par d’autres agents. Pour chaque élément, donne : cause (la cause technique), fix (la correction générique qui marche), rule (une règle claire du type « Avec X, ne pas faire A : cause B. Faire C à la place. »). Pour une correction demandée par l’utilisateur (category user_correction), ajoute message : une description technique et générique de l’erreur commise. Interdit : noms de personnes, d’entreprises ou de produits, textes métier, URLs, clés, données du projet. Réponds uniquement en JSON : {"items":[{"index":0,"message":"…","cause":"…","fix":"…","rule":"…"}]}. En français.',
      },
      { role: 'user', content: JSON.stringify(items) },
    ]);
    const text = String(result.text || '');
    const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
    const parsed = JSON.parse(json || '{}');
    const list = Array.isArray(parsed.items) ? parsed.items : [];
    return observations.map((_, index) => {
      const item = list.find((entry: any) => Number(entry?.index) === index) || {};
      return {
        message: typeof item.message === 'string' ? item.message : undefined,
        cause: typeof item.cause === 'string' ? item.cause : undefined,
        fix: typeof item.fix === 'string' ? item.fix : undefined,
        rule: typeof item.rule === 'string' ? item.rule : undefined,
      };
    });
  };
}
