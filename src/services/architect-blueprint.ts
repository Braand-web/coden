import { buildProductionBlueprintPromptContext, inferProductionBlueprint } from './production-blueprints.ts';
import type { SeniorAgentDecisionLike, SeniorAgentFile, SeniorAgentImportLike, SeniorAgentProjectIndex } from './senior-agent-os.ts';

export type ArchitectArchetype =
  | 'saas_webapp'
  | 'marketing_site'
  | 'mobile_pwa'
  | 'api_backend'
  | 'internal_tool'
  | 'content_platform'
  | 'marketplace'
  | 'ecommerce'
  | 'booking'
  | 'crm'
  | 'ai_tool'
  | 'unknown';

export type ArchitectBlueprint = {
  version: 'coden-architect-blueprint-v1';
  archetype: ArchitectArchetype;
  user_goal: string;
  discovery: {
    likely_audience: string;
    product_stage: 'idea' | 'mvp' | 'existing_product' | 'imported_product' | 'unknown';
    missing_questions: string[];
    fast_track_allowed: boolean;
  };
  stack: {
    frontend: string;
    backend: string;
    database: string;
    auth: string;
    api: string;
    state: string;
    styling: string;
    deployment: string;
    testing: string;
  };
  blueprint_sections: string[];
  build_order: string[];
  quality_gates: string[];
  risk_register: string[];
  confirmation_policy: {
    max_questions_per_turn: number;
    ask_confirmation_before: string[];
    do_not_ask_when: string[];
  };
};

function clean(value: unknown, max = 520) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function has(text: string, re: RegExp) {
  return re.test(text);
}

function inferStage(prompt: string, files: SeniorAgentFile[], importContext?: SeniorAgentImportLike): ArchitectBlueprint['discovery']['product_stage'] {
  const text = prompt.toLowerCase();
  if (importContext?.source || files.length > 4 || has(text, /existing|existant|deja|already|repo|github|figma|capture|screenshot/)) return 'existing_product';
  if (has(text, /\bmvp\b|prototype|premiere version|first version|v1/)) return 'mvp';
  if (has(text, /idee|idea|concept|je veux|i want|build|create|cree|cr[eé]e/)) return 'idea';
  return 'unknown';
}

function inferAudience(prompt: string, archetype: ArchitectArchetype) {
  const text = prompt.toLowerCase();
  if (has(text, /admin|team|internal|interne|staff|operator/)) return 'internal operators and admins';
  if (has(text, /client|customer|buyer|seller|ecommerce|shop|marketplace/)) return 'customers, buyers, or sellers';
  if (has(text, /founder|startup|investor|pitch|deck/)) return 'founders, teams, and stakeholders';
  if (has(text, /restaurant|booking|reservation|local/)) return 'local customers on mobile';
  if (archetype === 'ai_tool') return 'users creating or automating work with AI';
  if (archetype === 'crm' || archetype === 'internal_tool') return 'business users who need speed and clarity';
  return 'end users and project owners';
}

export function inferArchitectArchetype(prompt: string, files: SeniorAgentFile[] = [], importContext?: SeniorAgentImportLike): ArchitectArchetype {
  const text = `${prompt} ${files.map(file => file.path).join(' ')} ${importContext?.source || ''}`.toLowerCase();
  const production = inferProductionBlueprint(text);
  if (production.type === 'marketplace') return 'marketplace';
  if (production.type === 'ecommerce') return 'ecommerce';
  if (production.type === 'booking') return 'booking';
  if (production.type === 'crm') return 'crm';
  if (production.type === 'internal_tool' || production.type === 'admin_dashboard') return 'internal_tool';
  if (production.type === 'blog_cms') return 'content_platform';
  if (production.type === 'ai_tool') return 'ai_tool';
  if (has(text, /landing|marketing|waitlist|seo|website|site vitrine|home page/)) return 'marketing_site';
  if (has(text, /mobile|pwa|ios|android|app store|bottom nav/)) return 'mobile_pwa';
  if (has(text, /api|backend|webhook|endpoint|server|hono|express/)) return 'api_backend';
  if (has(text, /cms|blog|content|article|publication/)) return 'content_platform';
  if (has(text, /saas|dashboard|workspace|subscription|settings|billing/)) return 'saas_webapp';
  return files.length ? 'saas_webapp' : 'unknown';
}

function stackFor(archetype: ArchitectArchetype): ArchitectBlueprint['stack'] {
  const base = {
    frontend: 'React + TypeScript + Vite by default; Next.js only when SSR/SEO routes are essential.',
    backend: 'Coden Cloud over Supabase for auth, database, storage, edge functions, and server-side secrets.',
    database: 'PostgreSQL with normalized tables, timestamps, owner_id or organization_id, indexes, RLS and policies.',
    auth: 'Supabase Auth/Coden Cloud Auth with session refresh, route guards, and role-aware access.',
    api: 'Typed server boundary with Zod validation; REST or server functions for external consumers and sensitive actions.',
    state: 'React state for local interactions, TanStack Query only when client-side server cache is needed.',
    styling: 'Tokenized design system, accessible components, responsive mobile-first CSS.',
    deployment: 'Vercel preview/live separation, immutable published versions, custom domain when configured.',
    testing: 'Runner checks: TypeScript/build, preview, mobile, interactions, security, RLS, and critical flows.',
  };
  if (archetype === 'marketing_site') {
    return {
      ...base,
      frontend: 'Astro/Next-style static architecture when possible; Coden may implement in React/Vite with semantic SEO when constrained by preview.',
      backend: 'No backend unless forms, CMS, auth, or personalization are requested.',
      database: 'No database unless content, leads, or accounts are requested.',
      auth: 'No auth unless gated content or admin editing is requested.',
      testing: 'Smoke tests for pages, forms, SEO metadata, responsive layout, and performance-sensitive UI.',
    };
  }
  if (archetype === 'api_backend') {
    return {
      ...base,
      frontend: 'Minimal admin/testing UI only if useful.',
      backend: 'Hono/TypeScript-style API architecture with strict middleware, validation, rate limits, and health checks.',
      api: 'REST with OpenAPI-shaped responses, consistent errors, pagination, filtering, and auth middleware.',
      testing: 'Integration tests for endpoints, auth, validation, rate limits, and database side effects.',
    };
  }
  if (archetype === 'mobile_pwa') {
    return {
      ...base,
      frontend: 'Touch-first PWA React architecture with compact screens, bottom navigation, offline-aware states, and mobile-safe controls.',
      testing: 'Mobile viewport, touch targets, navigation, offline/empty states, and no horizontal overflow.',
    };
  }
  return base;
}

function missingQuestionsFor(input: {
  archetype: ArchitectArchetype;
  prompt: string;
  decision?: SeniorAgentDecisionLike;
}) {
  const text = input.prompt.toLowerCase();
  if (input.decision?.intent === 'conversation' || input.decision?.intent === 'clarification_required') return [];
  const questions: string[] = [];
  if (!has(text, /for|pour|user|utilisateur|client|customer|team|admin|seller|buyer|audience/)) {
    questions.push('Who is the primary user and what do they need to accomplish first?');
  }
  if (['saas_webapp', 'crm', 'marketplace', 'ecommerce', 'booking', 'internal_tool', 'ai_tool'].includes(input.archetype)
    && !has(text, /auth|login|database|data|save|persist|supabase|stripe|billing|payment|crud|role|admin/)) {
    questions.push('Does this need real accounts/data now, or should Coden start with an honest interactive preview?');
  }
  if (input.archetype === 'marketing_site' && !has(text, /cta|lead|waitlist|contact|conversion|pricing/)) {
    questions.push('What is the main conversion action: signup, contact, waitlist, booking, or purchase?');
  }
  if (input.archetype === 'api_backend' && !has(text, /consumer|client|mobile|webhook|public|private|auth/)) {
    questions.push('Who consumes the API and what authentication method should protect it?');
  }
  return questions.slice(0, 3);
}

function buildOrderFor(archetype: ArchitectArchetype) {
  const common = [
    'Understand the user goal and classify the product archetype.',
    'Define the minimum useful architecture, data model, and interaction contract.',
    'Create or patch the smallest set of project files.',
    'Render a nonblank responsive preview.',
    'Run quality, security, and interaction checks.',
    'Auto-fix severe failures and retest before delivery.',
  ];
  if (archetype === 'marketing_site') {
    return [
      common[0],
      'Define message, conversion goal, SEO metadata, and page structure.',
      'Build responsive sections with accessible CTAs and forms.',
      common[3],
      'Check SEO, form feedback, mobile layout, and performance-sensitive UI.',
      common[5],
    ];
  }
  if (archetype === 'api_backend') {
    return [
      common[0],
      'Define resources, auth, validation schemas, error shape, and rate limits.',
      'Create routes, middleware, database schema, and smoke tests.',
      'Run endpoint and validation checks.',
      common[5],
    ];
  }
  return common;
}

function qualityGatesFor(archetype: ArchitectArchetype) {
  const gates = [
    'No blank preview or obvious JavaScript crash.',
    'Primary controls work or show honest unavailable feedback.',
    'No frontend secrets, service role keys, raw provider payloads, or path traversal.',
    'Responsive layout holds on mobile and desktop.',
    'Errors, loading, empty, success, disabled, and selected states exist where relevant.',
  ];
  if (['saas_webapp', 'crm', 'marketplace', 'ecommerce', 'booking', 'internal_tool', 'ai_tool', 'content_platform'].includes(archetype)) {
    gates.push('Private data tables require RLS, owner_id or organization_id, policies, and indexes.');
  }
  if (['marketplace', 'ecommerce', 'booking', 'saas_webapp'].includes(archetype)) {
    gates.push('Payments or billing are server-owned or clearly marked as preview-only until configured.');
  }
  if (archetype === 'marketing_site' || archetype === 'content_platform') {
    gates.push('SEO basics exist: title, description, semantic H1, Open Graph, and meaningful content structure.');
  }
  return gates;
}

function riskRegisterFor(archetype: ArchitectArchetype, projectIndex?: SeniorAgentProjectIndex) {
  const risks = [
    'Misclassified intent can cause unnecessary code generation.',
    'Generic UI can look polished while failing the user workflow.',
    'Claims of readiness are unsafe without real checks.',
  ];
  if (projectIndex?.critical_files?.length) risks.push('Existing critical files must be preserved and patched narrowly.');
  if (['saas_webapp', 'crm', 'marketplace', 'ecommerce', 'booking', 'internal_tool', 'ai_tool'].includes(archetype)) {
    risks.push('Auth, RLS, billing, and private data isolation must not be improvised in the frontend.');
  }
  if (archetype === 'marketing_site') risks.push('Marketing pages can become generic if the conversion action is vague.');
  if (archetype === 'api_backend') risks.push('APIs can ship unsafe if validation, auth, and rate limits are missing.');
  return risks.slice(0, 6);
}

export function compileArchitectBlueprint(input: {
  prompt: string;
  files?: SeniorAgentFile[];
  decision?: SeniorAgentDecisionLike;
  projectIndex?: SeniorAgentProjectIndex;
  importContext?: SeniorAgentImportLike;
}): ArchitectBlueprint {
  const files = input.files || [];
  const prompt = clean(input.prompt, 1200);
  const archetype = inferArchitectArchetype(prompt, files, input.importContext);
  const stage = inferStage(prompt, files, input.importContext);
  const stack = stackFor(archetype);
  return {
    version: 'coden-architect-blueprint-v1',
    archetype,
    user_goal: prompt,
    discovery: {
      likely_audience: inferAudience(prompt, archetype),
      product_stage: stage,
      missing_questions: missingQuestionsFor({ archetype, prompt, decision: input.decision }),
      fast_track_allowed: Boolean(input.decision?.intent === 'build' || input.decision?.intent === 'edit') && !/auth|billing|stripe|rls|delete|migration/i.test(prompt),
    },
    stack,
    blueprint_sections: [
      'Project overview',
      'Tech stack',
      'Directory structure',
      'Data model',
      'API design',
      'Frontend architecture',
      'Design system',
      'Auth and authorization',
      'Build order',
      'Environment setup',
      'Dependencies',
      'Deployment strategy',
      'Testing strategy',
      'Skills/playbooks',
      'Target project instructions',
      'Non-negotiable rules',
    ],
    build_order: buildOrderFor(archetype),
    quality_gates: qualityGatesFor(archetype),
    risk_register: riskRegisterFor(archetype, input.projectIndex),
    confirmation_policy: {
      max_questions_per_turn: 3,
      ask_confirmation_before: ['destructive database changes', 'billing/payment activation', 'external private APIs', 'large architecture replacement', 'publishing live'],
      do_not_ask_when: ['small clear UI edits', 'simple copy changes', 'conversation answers', 'safe preview-only defaults'],
    },
  };
}

export function architectPromptContext(blueprint: ArchitectBlueprint) {
  const productionBlueprint = inferProductionBlueprint(blueprint.user_goal);
  return [
    'Coden Architect Blueprint context:',
    JSON.stringify({
      version: blueprint.version,
      archetype: blueprint.archetype,
      user_goal: blueprint.user_goal,
      discovery: blueprint.discovery,
      stack: blueprint.stack,
      required_blueprint_sections: blueprint.blueprint_sections,
      build_order: blueprint.build_order,
      quality_gates: blueprint.quality_gates,
      risk_register: blueprint.risk_register,
      confirmation_policy: blueprint.confirmation_policy,
      operating_rule: 'Use this as internal architecture guidance. Show only a short user-facing plan when useful; do not dump the full blueprint unless the user asks.',
    }),
    buildProductionBlueprintPromptContext(productionBlueprint),
  ].join('\n');
}
