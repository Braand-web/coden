export type GeneratedAppProfile = 'tanstack-fullstack' | 'node-fullstack' | 'vite-static' | 'legacy-vite-fullstack';
export type GeneratedAppFramework = 'tanstack-start' | 'vite-react';
export type GeneratedAppRuntime = 'cloudflare-workers' | 'node-server' | 'static-assets';

export type GeneratedAppCapability = {
  ssr: boolean;
  auth: boolean;
  database: boolean;
  storage: boolean;
  realtime: boolean;
  payments: boolean;
  serverFunctions: boolean;
};

export type GeneratedAppRoute = {
  path: string;
  kind: 'public' | 'protected' | 'server' | 'unknown';
};

export type GeneratedAppEnvRequirement = {
  name: string;
  scope: 'public' | 'server';
  required: boolean;
  description: string;
};

export type GeneratedAppManifest = {
  schemaVersion: 1;
  profile: GeneratedAppProfile;
  framework: GeneratedAppFramework;
  runtime: GeneratedAppRuntime;
  backend: 'coden-cloud-supabase' | 'node-api' | 'none';
  buildCommand: string;
  devCommand: string;
  outputDirectory: string;
  routes: GeneratedAppRoute[];
  requiredPublicEnv: GeneratedAppEnvRequirement[];
  requiredServerEnv: GeneratedAppEnvRequirement[];
  capabilities: GeneratedAppCapability;
  acceptanceCriteria: string[];
  generatedAt: string;
};

const generatedAppManifestSchema = z.object({
  schemaVersion: z.literal(1),
  profile: z.enum(['tanstack-fullstack', 'node-fullstack', 'vite-static', 'legacy-vite-fullstack']),
  framework: z.enum(['tanstack-start', 'vite-react']),
  runtime: z.enum(['cloudflare-workers', 'node-server', 'static-assets']),
  backend: z.enum(['coden-cloud-supabase', 'node-api', 'none']),
  buildCommand: z.string().trim().min(1),
  devCommand: z.string().trim().min(1),
  outputDirectory: z.string().trim().min(1).refine(isProjectRelativePath, 'Output directory must stay inside the project.'),
  routes: z.array(z.object({
    path: z.string().startsWith('/'),
    kind: z.enum(['public', 'protected', 'server', 'unknown']),
  })).max(100),
  requiredPublicEnv: z.array(z.object({
    name: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
    scope: z.literal('public'),
    required: z.boolean(),
    description: z.string(),
  })).max(100),
  requiredServerEnv: z.array(z.object({
    name: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
    scope: z.literal('server'),
    required: z.boolean(),
    description: z.string(),
  })).max(100),
  capabilities: z.object({
    ssr: z.boolean(),
    auth: z.boolean(),
    database: z.boolean(),
    storage: z.boolean(),
    realtime: z.boolean(),
    payments: z.boolean(),
    serverFunctions: z.boolean(),
  }).strict(),
  acceptanceCriteria: z.array(z.string().trim().min(1)).min(1).max(100),
  generatedAt: z.string().datetime({ offset: true }),
}).strict();

function isProjectRelativePath(value: string) {
  const normalized = String(value || '').replace(/\\/g, '/');
  return !normalized.startsWith('/') && !normalized.split('/').includes('..');
}

export function parseGeneratedAppManifest(value: unknown): GeneratedAppManifest {
  return generatedAppManifestSchema.parse(value) as GeneratedAppManifest;
}

export type GeneratedRuntimeFile = {
  path: string;
  content: string;
};

type RuntimeRequirement = {
  needs_auth?: boolean;
  needs_database?: boolean;
  needs_storage?: boolean;
  needs_realtime?: boolean;
  needs_edge_functions?: boolean;
  needs_secrets?: boolean;
};

function normalizePath(value: string) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\/+/, '');
}

function fileContent(files: GeneratedRuntimeFile[], path: string) {
  const target = normalizePath(path).toLowerCase();
  return files.find(file => normalizePath(file.path).toLowerCase() === target)?.content || '';
}

function packageJson(files: GeneratedRuntimeFile[]) {
  try {
    return JSON.parse(fileContent(files, 'package.json') || '{}');
  } catch {
    return {};
  }
}

function packageHas(pkg: any, name: string) {
  return Boolean(pkg?.dependencies?.[name] || pkg?.devDependencies?.[name] || pkg?.peerDependencies?.[name]);
}

function contains(files: GeneratedRuntimeFile[], pattern: RegExp) {
  return files.some(file => pattern.test(String(file.content || '')));
}

function hasTanStackStart(files: GeneratedRuntimeFile[]) {
  const pkg = packageJson(files);
  return packageHas(pkg, '@tanstack/react-start') || contains(files, /@tanstack\/react-start|createServerFn|@tanstack\/react-start\/server-entry/i);
}

function hasTanStackRouter(files: GeneratedRuntimeFile[]) {
  const pkg = packageJson(files);
  return packageHas(pkg, '@tanstack/react-router') || contains(files, /@tanstack\/react-router|createFileRoute/i);
}

function hasTanStackQuery(files: GeneratedRuntimeFile[]) {
  const pkg = packageJson(files);
  return packageHas(pkg, '@tanstack/react-query') || contains(files, /@tanstack\/react-query|QueryClient|useQuery/i);
}

function hasServerEntry(files: GeneratedRuntimeFile[]) {
  return Boolean(fileContent(files, 'src/server.ts') || fileContent(files, 'server.ts') || contains(files, /createServerEntry|server-only|createServerFn/i));
}

function hasStandaloneNodeBackend(files: GeneratedRuntimeFile[]) {
  const pkg = packageJson(files);
  const hasServerDependency = ['express', 'fastify', 'hono', 'koa'].some(name => packageHas(pkg, name));
  const hasServerFile = files.some(file => /^(?:server\/(?:index|server|app)|api\/index|server)\.(?:ts|js|mts|mjs)$/i.test(normalizePath(file.path)));
  return hasServerDependency && hasServerFile;
}

function inferRoutes(files: GeneratedRuntimeFile[]): GeneratedAppRoute[] {
  const routes: GeneratedAppRoute[] = [];
  for (const file of files) {
    const path = normalizePath(file.path);
    const match = path.match(/(?:^|\/)routes\/(.+)\.(?:tsx|ts|jsx|js)$/i);
    if (!match) continue;
    const routeName = match[1].replace(/\/index$/i, '').replace(/__root$/i, '');
    const routePath = routeName ? `/${routeName.replace(/\./g, '/')}` : '/';
    routes.push({
      path: routePath,
      kind: /auth|login|signup|account|dashboard|settings/i.test(routeName) ? 'protected' : 'public',
    });
  }
  if (!routes.length && fileContent(files, 'index.html')) routes.push({ path: '/', kind: 'public' });
  return routes.slice(0, 100);
}

export function resolveGeneratedAppProfile(input: {
  prompt?: string;
  files: GeneratedRuntimeFile[];
  requirement?: RuntimeRequirement;
}): GeneratedAppProfile {
  const pkg = packageJson(input.files);
  const hasBackend = Boolean(
    input.requirement?.needs_auth ||
    input.requirement?.needs_database ||
    input.requirement?.needs_storage ||
    input.requirement?.needs_realtime ||
    input.requirement?.needs_edge_functions ||
    input.requirement?.needs_secrets ||
    packageHas(pkg, '@supabase/supabase-js') ||
    contains(input.files, /supabase|codenCloud|server function|server-only/i),
  );

  if (hasTanStackStart(input.files)) return 'tanstack-fullstack';
  if (hasStandaloneNodeBackend(input.files)) return 'node-fullstack';
  if (hasBackend) return 'legacy-vite-fullstack';
  return 'vite-static';
}

export function createGeneratedAppManifest(input: {
  prompt?: string;
  files: GeneratedRuntimeFile[];
  requirement?: RuntimeRequirement;
  now?: string;
}): GeneratedAppManifest {
  const pkg = packageJson(input.files);
  const profile = resolveGeneratedAppProfile(input);
  const tanstack = hasTanStackStart(input.files);
  const hasAuth = Boolean(input.requirement?.needs_auth || contains(input.files, /supabase\.auth|signIn|signUp|ProtectedRoute|authGuard|createServerFn.*auth/i));
  const hasDatabase = Boolean(input.requirement?.needs_database || packageHas(pkg, '@supabase/supabase-js') || contains(input.files, /\.from\(|schema\.sql|appData|supabase/i));
  const hasStorage = Boolean(input.requirement?.needs_storage || contains(input.files, /storage\.from|upload|bucket|storage\.objects/i));
  const hasRealtime = Boolean(input.requirement?.needs_realtime || contains(input.files, /channel\(|realtime|postgres_changes/i));
  const hasPayments = contains(input.files, /stripe|checkout|payment|subscription|invoice/i);
  const nodeFullstack = profile === 'node-fullstack';
  const hasServerFunctions = Boolean(nodeFullstack || input.requirement?.needs_edge_functions || input.requirement?.needs_secrets || hasServerEntry(input.files) || contains(input.files, /supabase\/functions|server function|createServerFn/i));
  const cloudflareFullstack = profile === 'tanstack-fullstack';
  const managedBackend = !nodeFullstack && (hasDatabase || hasAuth || hasStorage || hasRealtime || hasServerFunctions || hasPayments);

  return {
    schemaVersion: 1,
    profile,
    framework: tanstack ? 'tanstack-start' : 'vite-react',
    runtime: cloudflareFullstack ? 'cloudflare-workers' : nodeFullstack ? 'node-server' : 'static-assets',
    backend: nodeFullstack ? 'node-api' : managedBackend ? 'coden-cloud-supabase' : 'none',
    buildCommand: 'npm run build',
    devCommand: 'npm run dev',
    outputDirectory: 'dist',
    routes: inferRoutes(input.files),
    // Every managed backend is reached from the browser with the same public
    // Coden Cloud config, whether it is used for data, auth, storage, realtime,
    // payments or edge functions. Deriving this from `managedBackend` — the
    // same flag that selects the backend above — keeps the manifest internally
    // consistent: declaring `coden-cloud-supabase` without its public runtime
    // configuration is rejected by validateGeneratedAppManifest.
    requiredPublicEnv: managedBackend
      ? [
          { name: 'VITE_CODEN_CLOUD_SUPABASE_URL', scope: 'public', required: true, description: 'URL publique du backend Coden Cloud.' },
          { name: 'VITE_CODEN_CLOUD_SUPABASE_ANON_KEY', scope: 'public', required: true, description: 'Clé publishable du backend Coden Cloud.' },
        ]
      : [],
    requiredServerEnv: !nodeFullstack && (input.requirement?.needs_secrets || hasServerFunctions)
      ? [{ name: 'CODEN_SERVER_RUNTIME', scope: 'server', required: true, description: 'Configuration serveur injectée par le runtime Coden/Cloudflare.' }]
      : [],
    capabilities: {
      ssr: tanstack,
      auth: hasAuth,
      database: hasDatabase,
      storage: hasStorage,
      realtime: hasRealtime,
      payments: hasPayments,
      serverFunctions: hasServerFunctions,
    },
    acceptanceCriteria: [
      'Le build de production termine sans erreur.',
      'Les routes principales répondent après publication.',
      'Aucun secret serveur ne se trouve dans le bundle client.',
      ...(hasDatabase || hasAuth ? ['Les accès privés utilisent une session et des policies RLS vérifiables.'] : []),
      ...(tanstack ? ['Le rendu SSR/hydration ne produit aucune erreur de mismatch.'] : []),
      ...(nodeFullstack ? ['Le serveur Node démarre, son healthcheck répond et les appels /api du frontend atteignent le backend.'] : []),
    ],
    generatedAt: input.now || new Date().toISOString(),
  };
}

export function validateGeneratedAppManifest(manifest: GeneratedAppManifest): string[] {
  const parsed = generatedAppManifestSchema.safeParse(manifest);
  const errors: string[] = parsed.success
    ? []
    : parsed.error.issues.map(issue => `${issue.path.join('.') || 'manifest'}: ${issue.message}`);
  if (!parsed.success) return errors;
  if (manifest.schemaVersion !== 1) errors.push('Unsupported generated app manifest schema.');
  if (!manifest.profile || !manifest.framework || !manifest.runtime) errors.push('Runtime profile is incomplete.');
  if (!manifest.buildCommand || !manifest.outputDirectory) errors.push('Build contract is incomplete.');
  if (manifest.profile === 'tanstack-fullstack' && manifest.runtime !== 'cloudflare-workers') {
    errors.push('TanStack fullstack apps must target the Cloudflare Workers runtime.');
  }
  if (manifest.profile === 'node-fullstack' && (manifest.runtime !== 'node-server' || manifest.backend !== 'node-api')) {
    errors.push('Node fullstack apps must target the Node server runtime and declare a Node API backend.');
  }
  if (manifest.backend === 'coden-cloud-supabase' && !manifest.requiredPublicEnv.some(env => env.name.includes('SUPABASE'))) {
    errors.push('Backend applications must declare public runtime configuration.');
  }
  return errors;
}

export function manifestFile(input: Parameters<typeof createGeneratedAppManifest>[0]): GeneratedRuntimeFile {
  const manifest = createGeneratedAppManifest(input);
  const errors = validateGeneratedAppManifest(manifest);
  if (manifest.profile === 'tanstack-fullstack') {
    if (!hasTanStackRouter(input.files)) errors.push('TanStack fullstack apps must include TanStack Router.');
    if (!hasTanStackQuery(input.files)) errors.push('TanStack fullstack apps must include TanStack Query for server state.');
    if (!fileContent(input.files, 'wrangler.jsonc') && !fileContent(input.files, 'wrangler.toml')) {
      errors.push('TanStack fullstack apps must include a Cloudflare Wrangler configuration.');
    }
  }
  if (errors.length) throw new Error(`Invalid generated app manifest: ${errors.join(' ')}`);
  return {
    path: 'coden/app-manifest.json',
    content: `${JSON.stringify(manifest, null, 2)}\n`,
  };
}
import { z } from 'zod';
