export type CodenImportSource = 'figma' | 'github' | 'image' | 'url';

export type CodenImportMode =
  | 'convert_to_app'
  | 'import_repo'
  | 'recreate_interface'
  | 'clone_my_site'
  | 'rebuild_as_app'
  | 'use_as_inspiration'
  | 'research_site';

export type CodenImportStatus = 'ready' | 'needs_connection' | 'needs_file' | 'invalid';

export type CodenImportContext = {
  source: CodenImportSource;
  mode: CodenImportMode;
  status: CodenImportStatus;
  title: string;
  message: string;
  prompt: string;
  source_url?: string;
  file_name?: string;
  mime_type?: string;
  capabilities: string[];
  limitations: string[];
  required_connection?: string;
};

export type CodenImportInput = {
  source?: unknown;
  mode?: unknown;
  url?: unknown;
  fileName?: unknown;
  mimeType?: unknown;
  hasAttachment?: boolean;
};

export type CodenImportOptions = {
  figmaConfigured?: boolean;
  githubConfigured?: boolean;
};

const IMPORT_SOURCE_LABELS: Record<CodenImportSource, string> = {
  figma: 'Figma',
  github: 'GitHub',
  image: 'Image',
  url: 'Website URL',
};

function cleanText(value: unknown, max = 500) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function normalizeImportSource(value: unknown): CodenImportSource | null {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'figma') return 'figma';
  if (raw === 'github' || raw === 'repo') return 'github';
  if (raw === 'image' || raw === 'screenshot') return 'image';
  if (raw === 'url' || raw === 'website' || raw === 'web') return 'url';
  return null;
}

export function normalizeImportMode(value: unknown, source: CodenImportSource): CodenImportMode {
  const raw = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (source === 'github') return 'import_repo';
  if (source === 'figma') return 'convert_to_app';
  if (source === 'image') return 'recreate_interface';
  if (raw === 'clone_my_site' || raw === 'clone') return 'clone_my_site';
  if (raw === 'use_as_inspiration' || raw === 'inspiration') return 'use_as_inspiration';
  if (raw === 'research_site' || raw === 'research') return 'research_site';
  return 'rebuild_as_app';
}

function normalizeUrl(value: unknown) {
  const raw = cleanText(value, 900);
  if (!raw) return '';
  try {
    const url = new URL(raw.startsWith('http://') || raw.startsWith('https://') ? raw : `https://${raw}`);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    url.hash = '';
    return url.toString();
  } catch {
    return '';
  }
}

function isLikelyFigmaUrl(url: string) {
  return /^https:\/\/(?:www\.)?figma\.com\/(?:file|design|proto)\//i.test(url);
}

function isLikelyGithubRepoUrl(url: string) {
  return /^https:\/\/(?:www\.)?github\.com\/[^/\s]+\/[^/\s]+/i.test(url);
}

function sourceNeedsUrl(source: CodenImportSource) {
  return source === 'figma' || source === 'github' || source === 'url';
}

function sourceIntro(source: CodenImportSource, status: CodenImportStatus) {
  if (source === 'figma') {
    return status === 'ready'
      ? 'J’ai importé ta maquette Figma. Je vais maintenant la convertir en app responsive avec composants propres.'
      : 'J’ai préparé l’import Figma. Connecte Figma ou ajoute une capture si tu veux que Coden lise les frames directement.';
  }
  if (source === 'github') {
    return status === 'ready'
      ? 'J’ai préparé l’import GitHub. Je vais lire la structure, détecter le framework, lancer les checks et ouvrir une preview.'
      : 'J’ai préparé l’import GitHub. Connecte GitHub si le repo est privé, sinon colle un repo public valide.';
  }
  if (source === 'image') {
    return status === 'ready'
      ? 'J’ai analysé l’image. Je vais recréer une version propre, responsive et modifiable.'
      : 'Ajoute une image ou une capture d’écran pour que Coden puisse recréer l’interface.';
  }
  return status === 'ready'
    ? 'J’ai préparé l’import du site. Je vais m’en servir comme référence contrôlée pour créer une app originale et utilisable.'
    : 'Colle une URL valide pour que Coden puisse préparer l’import du site.';
}

function figmaPrompt(url: string, status: CodenImportStatus) {
  return [
    'Import source: Figma.',
    url ? `Figma link: ${url}` : 'Figma link: not provided.',
    'Goal: transform the Figma mockup into a real, responsive, editable web app.',
    'Do not merely copy a static visual. Convert frames into product screens, components, design tokens, and usable interactions.',
    'Read or infer colors, fonts, spacing, hierarchy, repeated components, breakpoints, and layout relationships.',
    'Add missing hover/focus/active states, responsive behavior, functional buttons, forms, navigation, and honest empty/loading/error/success states without inventing user-facing data.',
    'Add auth, database, or backend only when the product flow truly requires it.',
    status === 'needs_connection'
      ? 'Figma API is not connected in this environment. Ask for Figma connection or screenshots if direct frame access is required, and do not pretend frames were fetched.'
      : 'If frame data is available, use it as source of truth; otherwise infer carefully and state the assumption.',
  ].join('\n');
}

function githubPrompt(url: string, status: CodenImportStatus) {
  return [
    'Import source: GitHub repository.',
    url ? `Repository URL: ${url}` : 'Repository URL: not provided.',
    'Goal: import an existing codebase, understand it, run checks, preview it, then let the user iterate through chat.',
    'First detect framework, package manager, scripts, pages, routes, key components, environment requirements, and likely preview entrypoint.',
    'Show a concise public summary only when it is based on real inspection: framework, build status, pages found, key components, and blocking errors.',
    'Preserve the existing architecture. Do not rewrite the app unless the user explicitly requests a rebuild.',
    'Install dependencies and run build/lint/test only through the approved runner. Fix errors with targeted patches.',
    status === 'needs_connection'
      ? 'GitHub connection is needed for private repos. For public repos, proceed only if the platform can fetch the source safely.'
      : 'If the repository is accessible, treat existing files as source of truth.',
  ].join('\n');
}

function imagePrompt(fileName: string, mimeType: string, status: CodenImportStatus) {
  return [
    'Import source: uploaded image or screenshot.',
    fileName ? `Image file: ${fileName}${mimeType ? ` (${mimeType})` : ''}.` : 'Image file: not provided.',
    'Goal: recreate the interface as a clean, responsive, editable React app.',
    'Analyze layout, sections, visual hierarchy, colors, typography style, spacing, components, controls, and likely user flow.',
    'Do not create a pixel-only copy. Turn the static image into a working product surface with responsive layout, accessible controls, hover/focus states, and useful interactions.',
    'If exact visual details are unavailable, infer a coherent implementation and mention the assumption briefly.',
    status === 'needs_file'
      ? 'No image is attached yet. Ask the user to upload a screenshot before claiming analysis.'
      : 'Use the attached image context as the reference for the first version.',
  ].join('\n');
}

function urlPrompt(url: string, mode: CodenImportMode, status: CodenImportStatus) {
  const modeLine = mode === 'clone_my_site'
    ? 'Mode: clone my own site into an editable app.'
    : mode === 'use_as_inspiration'
      ? 'Mode: use the site as inspiration without copying protected assets, brand, or proprietary identity.'
      : mode === 'research_site'
        ? 'Mode: research the site and summarize actionable product/design/SEO insights without building unless asked.'
        : 'Mode: rebuild the site as a modern, responsive app.';
  return [
    'Import source: website URL.',
    url ? `Website URL: ${url}` : 'Website URL: not provided.',
    modeLine,
    'Extract structure, navigation, content hierarchy, sections, design tokens, SEO signals, and interaction patterns when the site is accessible.',
    'Create an original, usable implementation. Do not copy competitor logos, proprietary assets, brand identity, private content, or copyrighted media.',
    'Add responsive behavior, working controls, form feedback, navigation, loading/empty/error states, and accessibility.',
    status === 'invalid'
      ? 'URL is invalid. Ask for a valid URL before proceeding.'
      : 'If live crawling is unavailable, use the URL as a reference target and ask for a screenshot or details when necessary.',
  ].join('\n');
}

export function buildImportContext(input: CodenImportInput, options: CodenImportOptions = {}): CodenImportContext | null {
  const source = normalizeImportSource(input.source);
  if (!source) return null;
  const mode = normalizeImportMode(input.mode, source);
  const sourceUrl = sourceNeedsUrl(source) ? normalizeUrl(input.url) : '';
  const fileName = cleanText(input.fileName, 180);
  const mimeType = cleanText(input.mimeType, 120);
  let status: CodenImportStatus = 'ready';
  const limitations: string[] = [];
  let requiredConnection = '';

  if (sourceNeedsUrl(source) && !sourceUrl) {
    status = 'invalid';
    limitations.push('A valid URL is required before Coden can start this import.');
  }
  if (source === 'figma' && sourceUrl && !isLikelyFigmaUrl(sourceUrl)) {
    status = 'invalid';
    limitations.push('The Figma link must be a figma.com file, design, or proto URL.');
  }
  if (source === 'github' && sourceUrl && !isLikelyGithubRepoUrl(sourceUrl)) {
    status = 'invalid';
    limitations.push('The GitHub link must point to a repository.');
  }
  if (source === 'figma' && status === 'ready' && !options.figmaConfigured) {
    status = 'needs_connection';
    requiredConnection = 'figma';
    limitations.push('Figma API access is not configured yet; screenshots can still be used as a fallback.');
  }
  if (source === 'github' && status === 'ready' && !options.githubConfigured) {
    limitations.push('Private repositories require a GitHub connection. Public repositories may still be imported when server access is available.');
  }
  if (source === 'image' && !input.hasAttachment && !fileName) {
    status = 'needs_file';
    limitations.push('Upload a screenshot or design image to continue.');
  }

  const capabilitiesBySource: Record<CodenImportSource, string[]> = {
    figma: ['frames_to_screens', 'design_tokens', 'components', 'responsive_app', 'missing_interactions'],
    github: ['repo_structure', 'framework_detection', 'dependency_checks', 'preview', 'chat_iteration'],
    image: ['layout_detection', 'visual_recreation', 'responsive_app', 'editable_components', 'interaction_completion'],
    url: ['site_structure', 'seo_context', 'design_reference', 'safe_rebuild', 'responsive_app'],
  };

  const prompt = source === 'figma'
    ? figmaPrompt(sourceUrl, status)
    : source === 'github'
      ? githubPrompt(sourceUrl, status)
      : source === 'image'
        ? imagePrompt(fileName, mimeType, status)
        : urlPrompt(sourceUrl, mode, status);

  return {
    source,
    mode,
    status,
    title: `Import from ${IMPORT_SOURCE_LABELS[source]}`,
    message: sourceIntro(source, status),
    prompt,
    source_url: sourceUrl || undefined,
    file_name: fileName || undefined,
    mime_type: mimeType || undefined,
    capabilities: capabilitiesBySource[source],
    limitations,
    required_connection: requiredConnection || undefined,
  };
}

export function importContextInstruction(context: unknown) {
  const raw = context && typeof context === 'object' ? context as Partial<CodenImportContext> : null;
  const source = normalizeImportSource(raw?.source);
  if (!raw || !source) return '';
  const rebuilt = buildImportContext({
    source,
    mode: raw.mode,
    url: raw.source_url,
    fileName: raw.file_name,
    mimeType: raw.mime_type,
    hasAttachment: Boolean(raw.file_name || raw.status === 'ready'),
  }, { figmaConfigured: raw.status === 'ready', githubConfigured: true });
  const contextToUse = rebuilt || raw as CodenImportContext;
  return [
    'Coden import context:',
    `- Source: ${source}.`,
    `- Mode: ${contextToUse.mode || normalizeImportMode(raw.mode, source)}.`,
    `- Status: ${contextToUse.status || 'ready'}.`,
    contextToUse.source_url ? `- Source URL: ${contextToUse.source_url}.` : '',
    contextToUse.file_name ? `- Uploaded file: ${contextToUse.file_name}.` : '',
    contextToUse.message ? `- User-facing import message: ${contextToUse.message}` : '',
    contextToUse.prompt ? `\nImport instructions:\n${contextToUse.prompt}` : '',
    'Important: an import is not a static copy job. Convert the source into a responsive, editable, accessible product with real interactions and honest states.',
  ].filter(Boolean).join('\n');
}

export function applyImportContextToPrompt(prompt: string, importContext: unknown) {
  const instruction = importContextInstruction(importContext);
  return instruction ? `${instruction}\n\nUser request:\n${prompt}` : prompt;
}

export function publicImportContext(context: CodenImportContext | null) {
  if (!context) return null;
  return {
    source: context.source,
    mode: context.mode,
    status: context.status,
    title: context.title,
    message: context.message,
    source_url: context.source_url,
    file_name: context.file_name,
    capabilities: context.capabilities,
    limitations: context.limitations,
    required_connection: context.required_connection,
  };
}
