import { apiFetch } from '../lib/api';
import { getVerifiedSession, refreshVerifiedSession } from '../lib/supabase-browser';
import { deriveProjectName } from './project-naming';

export type CreateProjectFlowMode = 'auto' | 'build' | 'plan';
export type CreateProjectFlowSource = 'landing' | 'dashboard' | 'builder' | 'import' | 'modal' | 'template';
export type CreateProjectFlowStatus =
  | 'preparing'
  | 'opening_auth'
  | 'creating_project'
  | 'opening_builder'
  | 'failed';

export type CreateProjectFlowInput = {
  prompt?: string;
  mode?: CreateProjectFlowMode;
  importContext?: Record<string, unknown>;
  template?: string;
  theme?: string;
  model?: string;
  features?: string[];
  projectName?: string;
  source?: CreateProjectFlowSource;
  workshop?: string;
};

type ProjectCreateResponse = {
  success: boolean;
  project: {
    id: string;
    name?: string;
  };
};

const FLOW_STORAGE_KEY = 'coden-create-project-flow';

export function formatCreateProjectFlowStatus(
  status: CreateProjectFlowStatus,
  locale: 'fr' | 'en' = 'en',
) {
  const labels = {
    fr: {
      preparing: 'Préparation de votre espace…',
      opening_auth: 'Ouverture de la connexion sécurisée…',
      creating_project: 'Création du projet…',
      opening_builder: 'Ouverture du Builder…',
      failed: 'Le démarrage du projet a échoué.',
    },
    en: {
      preparing: 'Preparing your workspace…',
      opening_auth: 'Opening secure sign in…',
      creating_project: 'Creating the project…',
      opening_builder: 'Opening the Builder…',
      failed: 'The project could not be started.',
    },
  } as const;
  return labels[locale][status];
}

function normalizeMode(mode: unknown): CreateProjectFlowMode {
  return mode === 'plan' ? 'plan' : mode === 'build' ? 'build' : 'auto';
}

function cleanText(value: unknown) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function projectNameFromPrompt(prompt: string) {
  return deriveProjectName(prompt);
}

export function persistCreateProjectFlow(input: CreateProjectFlowInput) {
  const prompt = cleanText(input.prompt);
  const mode = normalizeMode(input.mode);
  const flow = {
    prompt,
    mode,
    importContext: input.importContext || null,
    template: input.template || 'custom',
    theme: input.theme || 'light',
    model: input.model || 'auto',
    features: Array.isArray(input.features) ? input.features : [],
    projectName: cleanText(input.projectName) || projectNameFromPrompt(prompt),
    source: input.source || 'landing',
    workshop: input.workshop || '',
    createdAt: Date.now(),
  };

  sessionStorage.setItem(FLOW_STORAGE_KEY, JSON.stringify(flow));
  if (prompt) sessionStorage.setItem('coden-initial-prompt', prompt);
  else sessionStorage.removeItem('coden-initial-prompt');
  sessionStorage.setItem('coden-requested-mode', mode);
  if (flow.importContext) sessionStorage.setItem('coden-import-context', JSON.stringify(flow.importContext));
  if (flow.workshop) localStorage.setItem('coden-active-workshop', flow.workshop);
  localStorage.removeItem('coden-initial-prompt');
}

export function readCreateProjectFlow(): CreateProjectFlowInput | null {
  try {
    const raw = sessionStorage.getItem(FLOW_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      prompt: cleanText(parsed.prompt),
      mode: normalizeMode(parsed.mode),
      importContext: parsed.importContext || undefined,
      template: parsed.template || 'custom',
      theme: parsed.theme || 'light',
      model: parsed.model || 'auto',
      features: Array.isArray(parsed.features) ? parsed.features : [],
      projectName: cleanText(parsed.projectName),
      source: parsed.source || 'landing',
      workshop: parsed.workshop || '',
    };
  } catch {
    return null;
  }
}

export function clearCreateProjectFlow() {
  sessionStorage.removeItem(FLOW_STORAGE_KEY);
}

export function builderUrlForProject(projectId?: string, input: CreateProjectFlowInput = {}) {
  const params = new URLSearchParams();
  if (projectId) params.set('project', projectId);
  else params.set('new', '1');
  params.set('run', 'initial');
  if (input.source) params.set('source', input.source);
  if (input.workshop) params.set('workshop', input.workshop);
  return `/builder.html?${params.toString()}`;
}

export function redirectToBuilder(projectId?: string, input: CreateProjectFlowInput = {}) {
  window.location.href = builderUrlForProject(projectId, input);
}

export async function startCreateProjectFlow(input: CreateProjectFlowInput, options: {
  createProject?: boolean;
  onStatus?: (status: CreateProjectFlowStatus) => void;
} = {}) {
  const flow: CreateProjectFlowInput = {
    ...input,
    prompt: cleanText(input.prompt),
    mode: normalizeMode(input.mode),
    source: input.source || 'landing',
  };
  persistCreateProjectFlow(flow);
  options.onStatus?.('preparing');

  try {
    const verified = await getVerifiedSession({ allowRefresh: true }) || await refreshVerifiedSession();
    if (!verified?.session?.access_token) {
      options.onStatus?.('opening_auth');
      const redirect = encodeURIComponent(builderUrlForProject(undefined, flow));
      window.location.href = `/auth.html?redirect=${redirect}`;
      return;
    }

    if (options.createProject !== false) {
      options.onStatus?.('creating_project');
      const prompt = flow.prompt || 'Create a polished responsive web application.';
      const response = await apiFetch<ProjectCreateResponse>('/api/projects', {
        method: 'POST',
        body: JSON.stringify({
          name: cleanText(flow.projectName) || projectNameFromPrompt(prompt),
          template: flow.template || 'custom',
          theme: flow.theme || 'light',
          model: flow.model || 'auto',
          prompt,
          features: flow.features || [],
          source: flow.source || 'landing',
        }),
      });
      if (!response?.success || !response.project?.id) {
        throw new Error('The project could not be verified after creation. Please try again.');
      }
      options.onStatus?.('opening_builder');
      redirectToBuilder(response.project.id, flow);
      return;
    }

    options.onStatus?.('opening_builder');
    redirectToBuilder(undefined, flow);
  } catch (error) {
    options.onStatus?.('failed');
    throw error;
  }
}
