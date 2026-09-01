import type { CodenCloudRequirement } from './coden-cloud.ts';
import { hasCodenCloudRequirement } from './coden-cloud.ts';
import {
  getProductionBlueprintByType,
  inferProductionBlueprint,
  isPaymentBlueprint,
  isStorageBlueprint,
  type ProductionBlueprint,
  type ProductionBlueprintTable,
} from './production-blueprints.ts';
import { containsSecret } from './secret-redaction.ts';
import { manifestFile } from './generated-app-runtime.ts';

export type FullstackGeneratedFile = {
  path: string;
  content: string;
  language?: string;
  updated_at?: string;
};

export type FullstackKitInput = {
  files: FullstackGeneratedFile[];
  projectName: string;
  prompt: string;
  requirement: CodenCloudRequirement;
};

export type FullstackValidationCheck = {
  key: string;
  status: 'pass' | 'warn' | 'fail';
  severity: 'info' | 'low' | 'medium' | 'high';
  message: string;
  file?: string;
};

const FULLSTACK_MARKER = 'CODEN_FULLSTACK_READY';
const AI_STREAM_FUNCTION_PATH = 'supabase/functions/ai-stream/index.ts';
const AI_STREAM_CLIENT_PATH = 'src/lib/aiStream.ts';
const BACKEND_PLAN_PATH = 'coden/backend-plan.json';
const AUTH_GUARD_PATH = 'src/lib/authGuard.ts';
const PAYMENT_ACTIONS_PATH = 'src/lib/paymentActions.ts';
const STRIPE_WEBHOOK_FUNCTION_PATH = 'supabase/functions/stripe-webhook/index.ts';
const VERSIONED_MIGRATION_PATH = 'supabase/migrations/0001_coden_fullstack.sql';

// Locked together and exercised by test:fullstack-e2e. Generated fullstack
// projects must not depend on whichever versions happen to be latest when a
// user exports or publishes the app.
const TANSTACK_START_VERSION = '1.168.49';
const TANSTACK_ROUTER_VERSION = '1.170.32';
const TANSTACK_QUERY_VERSION = '5.102.2';
const CLOUDFLARE_VITE_PLUGIN_VERSION = '1.53.1';
const WRANGLER_VERSION = '4.125.0';
const VITE_VERSION = '7.3.6';
const VITE_REACT_VERSION = '5.2.0';

function normalizePath(value: string) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\/+/, '');
}

function inferLanguage(filePath: string) {
  const ext = normalizePath(filePath).split('.').pop()?.toLowerCase();
  if (ext === 'tsx' || ext === 'jsx') return 'tsx';
  if (ext === 'ts' || ext === 'js') return 'ts';
  if (ext === 'css') return 'css';
  if (ext === 'sql') return 'sql';
  if (ext === 'json') return 'json';
  if (ext === 'md') return 'markdown';
  return 'text';
}

function fileByPath(files: FullstackGeneratedFile[], filePath: string) {
  const target = normalizePath(filePath).toLowerCase();
  return files.find(file => normalizePath(file.path).toLowerCase() === target);
}

function blueprintFromBackendPlan(content: string): ProductionBlueprint | null {
  try {
    const parsed = JSON.parse(String(content || '{}'));
    const type = parsed?.blueprint?.type || parsed?.blueprint_type || parsed?.type;
    return getProductionBlueprintByType(type);
  } catch {
    return null;
  }
}

function hasSupabaseUsage(files: FullstackGeneratedFile[]) {
  return files.some(file => /supabase|@supabase\/supabase-js|Coden Cloud|codenCloud|auth\.|\.from\(/i.test(file.content || ''));
}

function hasStandaloneNodeBackend(files: FullstackGeneratedFile[]) {
  const packageFile = fileByPath(files, 'package.json');
  let pkg: any = {};
  try { pkg = JSON.parse(packageFile?.content || '{}'); } catch { pkg = {}; }
  const dependencies = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const hasServerFramework = Boolean(dependencies.express || dependencies.fastify || dependencies.hono || dependencies.koa);
  const hasServerEntry = files.some(file => /^(server\/(?:index|server|app)|api\/index|server)\.(?:ts|js|mts|mjs)$/i.test(normalizePath(file.path)));
  return hasServerFramework && hasServerEntry;
}

function explicitlyRequestsManagedCodenBackend(prompt: string) {
  return /\b(supabase|coden cloud|cloudflare(?: workers?)?|tanstack start|serverless|managed backend|backend manag[ée])\b/i.test(prompt || '');
}

function blueprintRequiresBackend(prompt: string) {
  const blueprint = inferProductionBlueprint(prompt);
  const backend = blueprint.backend;
  return Boolean(
    backend.requiresDatabase ||
    backend.requiresAuth ||
    backend.requiresStorage ||
    backend.requiresBilling
  );
}

export function shouldApplyCodenFullstackKit(input: {
  prompt: string;
  files: FullstackGeneratedFile[];
  requirement: CodenCloudRequirement;
}) {
  // A generated Express/Fastify/Hono server is already a real backend. Do not
  // replace it with the Coden Cloud/TanStack/Supabase template unless the user
  // explicitly requested that managed runtime. Mixing both runtimes creates
  // duplicate dependencies, incompatible scripts and a preview that can never
  // start honestly.
  if (
    hasStandaloneNodeBackend(input.files) &&
    !hasSupabaseUsage(input.files) &&
    !explicitlyRequestsManagedCodenBackend(input.prompt)
  ) {
    return false;
  }

  return Boolean(
    hasCodenCloudRequirement(input.requirement) ||
    hasSupabaseUsage(input.files) ||
    // Deterministic, blueprint-driven detection: any prompt the production
    // blueprint engine classifies as data-backed (the same engine that builds
    // the schema) reliably gets the fullstack kit, instead of relying solely on
    // a brittle keyword list that silently missed data-backed apps.
    blueprintRequiresBackend(input.prompt || '') ||
    /\b(fullstack|full stack|auth|login|signup|database|supabase|crud|storage|upload|dashboard admin|crm|marketplace|booking|reservation|orders?|products?|clients?|customers?|seller|buyer|checkout|stripe|subscription|cms|blog|internal tool|ai tool|e-?commerce)\b/i.test(input.prompt || '')
  );
}

function upsertFile(files: Map<string, FullstackGeneratedFile>, filePath: string, content: string, language = inferLanguage(filePath)) {
  const key = normalizePath(filePath);
  const existing = files.get(key);
  files.set(key, {
    path: key,
    content,
    language,
    updated_at: existing?.updated_at || new Date().toISOString(),
  });
}

function mergePackageJson(content: string) {
  let pkg: any = {};
  try {
    pkg = JSON.parse(content || '{}');
  } catch {
    pkg = {};
  }

  pkg.scripts = {
    dev: 'vite dev',
    build: 'vite build && tsc --noEmit',
    test: 'node --experimental-strip-types src/app.test.ts && node --experimental-strip-types src/fullstack.test.ts',
    lint: 'tsc --noEmit',
    preview: 'vite preview',
    deploy: 'npm run build && wrangler deploy',
    'cf-typegen': 'wrangler types',
    ...(pkg.scripts || {}),
  };
  // These scripts describe the locked runtime and therefore intentionally win
  // over model-provided Vite-only scripts.
  pkg.scripts.dev = 'vite dev';
  pkg.scripts.build = 'vite build && tsc --noEmit';
  pkg.scripts.preview = 'vite preview';
  pkg.scripts.deploy = 'npm run build && wrangler deploy';
  pkg.scripts['cf-typegen'] = 'wrangler types';
  if (!String(pkg.scripts.test || '').includes('src/fullstack.test.ts')) {
    pkg.scripts.test = `${String(pkg.scripts.test || 'node --experimental-strip-types src/app.test.ts').trim()} && node --experimental-strip-types src/fullstack.test.ts`;
  }

  pkg.dependencies = {
    ...(pkg.dependencies || {}),
    '@tanstack/react-start': TANSTACK_START_VERSION,
    '@tanstack/react-router': TANSTACK_ROUTER_VERSION,
    '@tanstack/react-query': TANSTACK_QUERY_VERSION,
    '@supabase/supabase-js': pkg.dependencies?.['@supabase/supabase-js'] || '2.106.0',
    zod: pkg.dependencies?.zod || '4.4.3',
  };
  pkg.devDependencies = {
    ...(pkg.devDependencies || {}),
    '@cloudflare/vite-plugin': CLOUDFLARE_VITE_PLUGIN_VERSION,
    '@vitejs/plugin-react': VITE_REACT_VERSION,
    vite: VITE_VERSION,
    wrangler: WRANGLER_VERSION,
    '@types/node': '22.20.1',
  };
  return JSON.stringify(pkg, null, 2);
}

function buildTanStackViteConfig() {
  return [
    "import { cloudflare } from '@cloudflare/vite-plugin';",
    "import { tanstackStart } from '@tanstack/react-start/plugin/vite';",
    "import react from '@vitejs/plugin-react';",
    "import { defineConfig } from 'vite';",
    '',
    'export default defineConfig({',
    '  plugins: [',
    "    cloudflare({ viteEnvironment: { name: 'ssr' } }),",
    '    tanstackStart(),',
    '    react(),',
    '  ],',
    '});',
    '',
  ].join('\n');
}

function buildTanStackTsconfig() {
  return `${JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      lib: ['DOM', 'DOM.Iterable', 'ES2022'],
      allowJs: false,
      skipLibCheck: true,
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
      strict: true,
      forceConsistentCasingInFileNames: true,
      module: 'ESNext',
      moduleResolution: 'Bundler',
      resolveJsonModule: true,
      isolatedModules: true,
      noEmit: true,
      jsx: 'react-jsx',
    },
    include: ['src'],
  }, null, 2)}\n`;
}

function buildTanStackRouter() {
  return [
    "import { QueryClient } from '@tanstack/react-query';",
    "import { createRouter } from '@tanstack/react-router';",
    "import { routeTree } from './routeTree.gen';",
    '',
    'export function getRouter() {',
    '  const queryClient = new QueryClient({',
    '    defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },',
    '  });',
    '  return createRouter({',
    '    routeTree,',
    '    context: { queryClient },',
    "    defaultPreload: 'intent',",
    '    scrollRestoration: true,',
    '  });',
    '}',
    '',
    'declare module \'@tanstack/react-router\' {',
    '  interface Register {',
    '    router: ReturnType<typeof getRouter>;',
    '  }',
    '}',
    '',
  ].join('\n');
}

/**
 * Coden intentionally emits this minimal route tree instead of relying on a
 * dev-time TanStack file-route generator. A generated app must be runnable in
 * a clean preview sandbox immediately after `npm install`; otherwise the
 * router import fails before Vite can show the application.
 */
function buildTanStackRouteTree() {
  return [
    '/* eslint-disable */',
    '// Generated by Coden. Keep this file in sync with src/routes/.',
    "import { Route as rootRoute } from './routes/__root';",
    "import { Route as indexRouteImport } from './routes/index';",
    '',
    'const indexRoute = indexRouteImport.update({',
    "  id: '/',",
    "  path: '/',",
    '  getParentRoute: () => rootRoute,',
    '} as any);',
    '',
    "declare module '@tanstack/react-router' {",
    '  interface FileRoutesByPath {',
    "    '/': {",
    "      id: '/';",
    "      path: '/';",
    "      fullPath: '/';",
    '      preLoaderRoute: typeof indexRouteImport;',
    '      parentRoute: typeof rootRoute;',
    '    };',
    '  }',
    '}',
    '',
    'export const routeTree = rootRoute.addChildren([indexRoute]);',
    '',
  ].join('\n');
}

function buildTanStackRootRoute(projectName: string) {
  return [
    "import type { QueryClient } from '@tanstack/react-query';",
    "import { QueryClientProvider } from '@tanstack/react-query';",
    "import { HeadContent, Outlet, Scripts, createRootRouteWithContext } from '@tanstack/react-router';",
    "import '../index.css';",
    '',
    'type RouterContext = { queryClient: QueryClient };',
    '',
    'export const Route = createRootRouteWithContext<RouterContext>()({',
    '  head: () => ({',
    `    meta: [{ title: ${JSON.stringify(projectName || 'Coden App')} }],`,
    '  }),',
    '  component: RootDocument,',
    '});',
    '',
    'function RootDocument() {',
    '  const { queryClient } = Route.useRouteContext();',
    '  return (',
    '    <html lang="fr">',
    '      <head><HeadContent /></head>',
    '      <body>',
    '        <QueryClientProvider client={queryClient}>',
    '          <Outlet />',
    '        </QueryClientProvider>',
    '        <Scripts />',
    '      </body>',
    '    </html>',
    '  );',
    '}',
    '',
  ].join('\n');
}

function buildTanStackIndexRoute() {
  return [
    "import { createFileRoute } from '@tanstack/react-router';",
    "import App from '../App';",
    '',
    "export const Route = createFileRoute('/')({ component: App });",
    '',
  ].join('\n');
}

function buildWranglerConfig(projectName: string) {
  const workerName = String(projectName || 'coden-app')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'coden-app';
  return [
    '{',
    '  "$schema": "node_modules/wrangler/config-schema.json",',
    `  "name": ${JSON.stringify(workerName)},`,
    '  "compatibility_date": "2026-08-24",',
    '  "compatibility_flags": ["nodejs_compat"],',
    '  "main": "@tanstack/react-start/server-entry"',
    '}',
    '',
  ].join('\n');
}

function buildCodenCloudClient() {
  return [
    "import { createClient, type SupabaseClient } from '@supabase/supabase-js';",
    '',
    'type CodenCloudRuntimeConfig = {',
    '  supabaseUrl?: string;',
    '  supabaseAnonKey?: string;',
    '};',
    '',
    'declare global {',
    '  interface Window {',
    '    __CODEN_CLOUD__?: CodenCloudRuntimeConfig;',
    '  }',
    '}',
    '',
    'const runtimeConfig = typeof window !== "undefined" ? window.__CODEN_CLOUD__ || {} : {};',
    'const supabaseUrl = import.meta.env.VITE_CODEN_CLOUD_SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL || runtimeConfig.supabaseUrl || "";',
    'const supabaseAnonKey = import.meta.env.VITE_CODEN_CLOUD_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || runtimeConfig.supabaseAnonKey || "";',
    '',
    'export const isCodenCloudConfigured = Boolean(supabaseUrl && supabaseAnonKey);',
    '',
    'export const codenCloud: SupabaseClient | null = isCodenCloudConfigured',
    '  ? createClient(supabaseUrl, supabaseAnonKey, {',
    '      auth: {',
    '        persistSession: true,',
    '        autoRefreshToken: true,',
    '        detectSessionInUrl: true,',
    '      },',
    '    })',
    '  : null;',
    '',
    'export class CodenCloudUnavailableError extends Error {',
    '  constructor() {',
    "    super('Coden Cloud is not configured for this preview yet. The real backend cannot be verified.');",
    "    this.name = 'CodenCloudUnavailableError';",
    '  }',
    '}',
    '',
    'export function getCodenCloudClient() {',
    '  if (!codenCloud) throw new CodenCloudUnavailableError();',
    '  return codenCloud;',
    '}',
    '',
    'export function getCodenCloudStatus() {',
    '  return {',
    '    ready: isCodenCloudConfigured,',
    "    message: isCodenCloudConfigured ? 'Coden Cloud is connected.' : 'Coden Cloud is not configured; backend actions are unavailable.',",
    '  };',
    '}',
    '',
  ].join('\n');
}

function buildAuthGuard(blueprint: ProductionBlueprint) {
  return [
    "import { getCodenCloudClient, isCodenCloudConfigured } from './codenCloud';",
    '',
    "export type AppRole = 'owner' | 'admin' | 'member' | 'viewer';",
    '',
    'export type AuthenticatedAppUser = {',
    '  id: string;',
    '  email?: string;',
    '  role: AppRole;',
    '};',
    '',
    'export class AuthRequiredError extends Error {',
    '  constructor() {',
    "    super('Sign in to continue.');",
    "    this.name = 'AuthRequiredError';",
    '  }',
    '}',
    '',
    'export class PermissionDeniedError extends Error {',
    '  constructor() {',
    "    super('You do not have permission to perform this action.');",
    "    this.name = 'PermissionDeniedError';",
    '  }',
    '}',
    '',
    "const ROLE_RANK: Record<AppRole, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };",
    '',
    'export async function getCurrentAppUser(): Promise<AuthenticatedAppUser | null> {',
    '  if (!isCodenCloudConfigured) return null;',
    '  const client = getCodenCloudClient();',
    '  const { data, error } = await client.auth.getUser();',
    '  if (error || !data.user) return null;',
    '  const role = (data.user.app_metadata?.role || data.user.user_metadata?.role || "member") as AppRole;',
    '  return { id: data.user.id, email: data.user.email || undefined, role: ROLE_RANK[role] >= 0 ? role : "member" };',
    '}',
    '',
    'export async function requireAppUser(minRole: AppRole = "member") {',
    '  const user = await getCurrentAppUser();',
    '  if (!user) throw new AuthRequiredError();',
    '  if (ROLE_RANK[user.role] < ROLE_RANK[minRole]) throw new PermissionDeniedError();',
    '  return user;',
    '}',
    '',
    'export async function canUseAppFeature(feature: string) {',
    '  const user = await getCurrentAppUser();',
    '  if (!user) return false;',
    '  if (/admin|billing|settings|delete|export/i.test(feature)) return ROLE_RANK[user.role] >= ROLE_RANK.admin;',
    '  return ROLE_RANK[user.role] >= ROLE_RANK.member;',
    '}',
    '',
    'export const generatedAuthContract = {',
    `  blueprint: ${JSON.stringify(blueprint.type)},`,
    '  protectedRoutes: true,',
    '  roleBasedAccess: true,',
    '  previewUserOnlyWhenCloudMissing: false,',
    '};',
    '',
  ].join('\n');
}

function buildPaymentActions(blueprint: ProductionBlueprint) {
  return [
    "import { requireAppUser } from './authGuard';",
    '',
    'export type CheckoutRequest = {',
    '  priceId: string;',
    '  quantity?: number;',
    '  successUrl?: string;',
    '  cancelUrl?: string;',
    '};',
    '',
    "const CHECKOUT_FUNCTION_PATH = '/functions/v1/create-checkout-session';",
    '',
    'export async function createCheckoutSession(input: CheckoutRequest) {',
    '  await requireAppUser("member");',
    '  if (!input.priceId) throw new Error("PRICE_REQUIRED");',
    '  const response = await fetch(CHECKOUT_FUNCTION_PATH, {',
    '    method: "POST",',
    '    headers: { "content-type": "application/json" },',
    '    body: JSON.stringify({',
    '      priceId: input.priceId,',
    '      quantity: Math.max(1, input.quantity || 1),',
    '      successUrl: input.successUrl || window.location.href,',
    '      cancelUrl: input.cancelUrl || window.location.href,',
    '    }),',
    '  });',
    '  if (!response.ok) throw new Error("CHECKOUT_UNAVAILABLE");',
    '  return response.json() as Promise<{ url: string; id: string }>;',
    '}',
    '',
    'export const generatedPaymentContract = {',
    `  blueprint: ${JSON.stringify(blueprint.type)},`,
    '  priceDecisionsServerSide: true,',
    '  webhookSignatureRequired: true,',
    '  frontendOnlyDemoCheckoutForbidden: true,',
    '};',
    '',
  ].join('\n');
}

function buildAppDataLayer(_requirement: CodenCloudRequirement) {
  return [
    "import { getCodenCloudClient, isCodenCloudConfigured } from './codenCloud';",
    '',
    'export type AppRecord = {',
    '  id: string;',
    '  title: string;',
    '  status: "todo" | "active" | "done";',
    '  payload?: Record<string, unknown>;',
    '  created_at?: string;',
    '};',
    '',
    'function requireCodenCloud() {',
    '  if (!isCodenCloudConfigured) throw new Error("CODEN_CLOUD_NOT_CONFIGURED");',
    '  return getCodenCloudClient();',
    '}',
    '',
    'export async function listRecords(): Promise<AppRecord[]> {',
    '  const client = requireCodenCloud();',
    "  const query = client.from('app_records').select('id,title,status,payload,created_at').order('created_at', { ascending: false });",
    "  const { data, error } = await query;",
    '  if (error) throw error;',
    '  return data || [];',
    '}',
    '',
    'export async function createRecord(title: string): Promise<AppRecord> {',
    '  const cleanTitle = title.trim();',
    "  if (!cleanTitle) throw new Error('Title is required.');",
    '  const client = requireCodenCloud();',
    "  const { data, error } = await client.from('app_records').insert({ title: cleanTitle, status: 'todo', payload: {} }).select('id,title,status,payload,created_at').single();",
    '  if (error) throw error;',
    '  return data;',
    '}',
    '',
    'export async function updateRecord(id: string, patch: Partial<Pick<AppRecord, "title" | "status" | "payload">>) {',
    '  const client = requireCodenCloud();',
    "  const { data, error } = await client.from('app_records').update(patch).eq('id', id).select('id,title,status,payload,created_at').single();",
    '  if (error) throw error;',
    '  return data;',
    '}',
    '',
    'export async function deleteRecord(id: string) {',
    '  const client = requireCodenCloud();',
    "  const { error } = await client.from('app_records').delete().eq('id', id);",
    '  if (error) throw error;',
    '}',
    '',
  ].join('\n');
}

function buildValidationLayer(blueprint: ProductionBlueprint) {
  const tableNames = blueprint.tables.map(table => table.name);
  return [
    "import { z } from 'zod';",
    '',
    'export const recordIdSchema = z.string().uuid();',
    'export const safeTitleSchema = z.string().trim().min(1).max(140);',
    'export const safeStatusSchema = z.enum(["todo", "active", "done", "draft", "published", "pending", "paid", "cancelled", "open", "closed"]);',
    'export const appRecordCreateSchema = z.object({',
    '  title: safeTitleSchema,',
    '  status: safeStatusSchema.optional(),',
    '  payload: z.record(z.string(), z.unknown()).optional(),',
    '});',
    '',
    'export const appRecordUpdateSchema = appRecordCreateSchema.partial().extend({',
    '  id: recordIdSchema,',
    '});',
    '',
    'export const uploadPolicySchema = z.object({',
    '  path: z.string().min(3).max(300).refine(value => !value.includes(".."), "Path traversal is not allowed."),',
    '  mime_type: z.string().regex(/^(image|video|application\\/pdf|text\\/plain)\\//).max(120),',
    '  size_bytes: z.number().int().min(0).max(20 * 1024 * 1024),',
    '});',
    '',
    'export const generatedBlueprint = {',
    `  type: ${JSON.stringify(blueprint.type)},`,
    `  tables: ${JSON.stringify(tableNames)},`,
    `  requiresAuth: ${JSON.stringify(blueprint.backend.requiresAuth)},`,
    `  requiresDatabase: ${JSON.stringify(blueprint.backend.requiresDatabase)},`,
    `  requiresBilling: ${JSON.stringify(blueprint.backend.requiresBilling)},`,
    '};',
    '',
  ].join('\n');
}

function buildEdgeSecurityHelpers(blueprint: ProductionBlueprint) {
  return [
    "import { z } from 'zod';",
    '',
    'type RateLimitBucket = { count: number; resetAt: number };',
    'const buckets = new Map<string, RateLimitBucket>();',
    '',
    'export function assertRateLimit(key: string, limit = 20, windowMs = 60_000) {',
    '  const now = Date.now();',
    '  const current = buckets.get(key);',
    '  if (!current || current.resetAt < now) {',
    '    buckets.set(key, { count: 1, resetAt: now + windowMs });',
    '    return;',
    '  }',
    '  current.count += 1;',
    '  if (current.count > limit) throw new Error("RATE_LIMITED");',
    '}',
    '',
    'export function getBearerToken(request: Request) {',
    '  const header = request.headers.get("authorization") || "";',
    '  const match = header.match(/^Bearer\\s+(.+)$/i);',
    '  if (!match) throw new Error("AUTH_REQUIRED");',
    '  return match[1];',
    '}',
    '',
    'export function assertWebhookSignature(request: Request, secret?: string) {',
    '  if (!secret) throw new Error("WEBHOOK_SECRET_NOT_CONFIGURED");',
    '  const signature = request.headers.get("stripe-signature") || request.headers.get("x-signature");',
    '  if (!signature) throw new Error("WEBHOOK_SIGNATURE_MISSING");',
    '  return signature;',
    '}',
    '',
    'export const actionSchema = z.object({',
    '  action: z.string().min(1).max(80),',
    '  payload: z.record(z.string(), z.unknown()).optional(),',
    '});',
    '',
    'export const securityContract = {',
    `  blueprint: ${JSON.stringify(blueprint.type)},`,
    '  noFrontendSecrets: true,',
    '  serverValidationRequired: true,',
    '  rateLimitRequired: true,',
    `  stripeWebhookRequired: ${JSON.stringify(isPaymentBlueprint(blueprint))},`,
    `  storagePolicyRequired: ${JSON.stringify(isStorageBlueprint(blueprint))},`,
    '};',
    '',
  ].join('\n');
}

function buildStripeWebhookFunction(blueprint: ProductionBlueprint) {
  return [
    "import { assertRateLimit, assertWebhookSignature } from '../_shared/security.ts';",
    '',
    'const corsHeaders = {',
    '  "access-control-allow-origin": "*",',
    '  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type, stripe-signature",',
    '  "access-control-allow-methods": "POST, OPTIONS",',
    '};',
    '',
    'Deno.serve(async (request) => {',
    '  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });',
    '  if (request.method !== "POST") {',
    '    return new Response(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }), { status: 405, headers: { ...corsHeaders, "content-type": "application/json" } });',
    '  }',
    '',
    '  try {',
    '    assertRateLimit(request.headers.get("x-forwarded-for") || "stripe-webhook", 120, 60_000);',
    '    const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");',
    '    const signature = assertWebhookSignature(request, webhookSecret);',
    '    const rawBody = await request.text();',
    '',
    '    // Production note: verify the raw payload with Stripe SDK or a Coden Cloud server primitive before mutating billing tables.',
    '    // This generated function intentionally refuses to trust client-side checkout state.',
    '    if (!signature || !rawBody) throw new Error("WEBHOOK_PAYLOAD_INVALID");',
    '',
    '    const event = JSON.parse(rawBody);',
    '    const type = String(event?.type || "unknown");',
    '    const allowed = ["checkout.session.completed", "customer.subscription.updated", "customer.subscription.deleted", "invoice.payment_succeeded", "invoice.payment_failed"];',
    '    if (!allowed.includes(type)) {',
    '      return new Response(JSON.stringify({ received: true, ignored: type }), { headers: { ...corsHeaders, "content-type": "application/json" } });',
    '    }',
    '',
    '    return new Response(JSON.stringify({ received: true, type }), { headers: { ...corsHeaders, "content-type": "application/json" } });',
    '  } catch (_error) {',
    '    return new Response(JSON.stringify({ error: "WEBHOOK_VERIFICATION_FAILED" }), { status: 400, headers: { ...corsHeaders, "content-type": "application/json" } });',
    '  }',
    '});',
    '',
    'export const generatedStripeWebhookContract = {',
    `  blueprint: ${JSON.stringify(blueprint.type)},`,
    '  requiresSignature: true,',
    '  mutatesBillingOnlyAfterServerVerification: true,',
    '};',
    '',
  ].join('\n');
}

function quoteSqlLiteral(value: string) {
  return String(value || '').replace(/'/g, "''");
}

function tablePolicySql(table: ProductionBlueprintTable) {
  const tableName = table.name;
  if (table.access === 'public_read_private_write') {
    return [
      `drop policy if exists "Public can read ${tableName}" on public.${tableName};`,
      `create policy "Public can read ${tableName}" on public.${tableName}`,
      '  for select to anon, authenticated using (true);',
      `drop policy if exists "Members can write ${tableName}" on public.${tableName};`,
      `create policy "Members can write ${tableName}" on public.${tableName}`,
      '  for all to authenticated',
      '  using (',
      '    exists (select 1 from public.app_organization_members m where m.organization_id = organization_id and m.user_id = auth.uid() and m.role in (\'owner\', \'admin\', \'member\'))',
      '  )',
      '  with check (',
      '    exists (select 1 from public.app_organization_members m where m.organization_id = organization_id and m.user_id = auth.uid() and m.role in (\'owner\', \'admin\', \'member\'))',
      '  );',
    ].join('\n');
  }
  if (table.access === 'owner') {
    return [
      `drop policy if exists "Users can read their ${tableName}" on public.${tableName};`,
      `create policy "Users can read their ${tableName}" on public.${tableName}`,
      '  for select to authenticated using (owner_id = auth.uid());',
      `drop policy if exists "Users can insert their ${tableName}" on public.${tableName};`,
      `create policy "Users can insert their ${tableName}" on public.${tableName}`,
      '  for insert to authenticated with check (owner_id = auth.uid());',
      `drop policy if exists "Users can update their ${tableName}" on public.${tableName};`,
      `create policy "Users can update their ${tableName}" on public.${tableName}`,
      '  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());',
      `drop policy if exists "Users can delete their ${tableName}" on public.${tableName};`,
      `create policy "Users can delete their ${tableName}" on public.${tableName}`,
      '  for delete to authenticated using (owner_id = auth.uid());',
    ].join('\n');
  }
  return [
    `drop policy if exists "Members can read ${tableName}" on public.${tableName};`,
    `create policy "Members can read ${tableName}" on public.${tableName}`,
    '  for select to authenticated using (',
    '    exists (select 1 from public.app_organization_members m where m.organization_id = organization_id and m.user_id = auth.uid())',
    '  );',
    `drop policy if exists "Members can insert ${tableName}" on public.${tableName};`,
    `create policy "Members can insert ${tableName}" on public.${tableName}`,
    '  for insert to authenticated with check (',
    '    exists (select 1 from public.app_organization_members m where m.organization_id = organization_id and m.user_id = auth.uid() and m.role in (\'owner\', \'admin\', \'member\'))',
    '  );',
    `drop policy if exists "Members can update ${tableName}" on public.${tableName};`,
    `create policy "Members can update ${tableName}" on public.${tableName}`,
    '  for update to authenticated',
    '  using (',
    '    exists (select 1 from public.app_organization_members m where m.organization_id = organization_id and m.user_id = auth.uid() and m.role in (\'owner\', \'admin\', \'member\'))',
    '  )',
    '  with check (',
    '    exists (select 1 from public.app_organization_members m where m.organization_id = organization_id and m.user_id = auth.uid() and m.role in (\'owner\', \'admin\', \'member\'))',
    '  );',
    `drop policy if exists "Members can delete ${tableName}" on public.${tableName};`,
    `create policy "Members can delete ${tableName}" on public.${tableName}`,
    '  for delete to authenticated using (',
    '    exists (select 1 from public.app_organization_members m where m.organization_id = organization_id and m.user_id = auth.uid() and m.role in (\'owner\', \'admin\'))',
    '  );',
  ].join('\n');
}

function buildBlueprintTableSql(table: ProductionBlueprintTable) {
  const baseColumns = [
    '  id uuid primary key default gen_random_uuid()',
    "  organization_id uuid references public.app_organizations(id) on delete cascade",
    '  owner_id uuid references auth.users(id) on delete set null',
    "  title text not null default 'Untitled'",
    "  status text not null default 'active'",
    "  metadata jsonb not null default '{}'::jsonb",
    '  created_at timestamptz not null default now()',
    '  updated_at timestamptz not null default now()',
  ];
  const extraColumns = table.columns
    .filter(column => !baseColumns.some(base => base.includes(column.split(/\s+/)[0] || '__never__')))
    .map(column => `  ${column}`);
  const columns = [...baseColumns, ...extraColumns].join(',\n');
  const indexes = table.indexes.map(index => `create index if not exists ${table.name}_${index}_idx on public.${table.name} (${index});`);
  return [
    '',
    `-- ${table.purpose.replace(/\s+/g, ' ')}`,
    `create table if not exists public.${table.name} (`,
    columns,
    ');',
    '',
    `alter table public.${table.name} enable row level security;`,
    `comment on table public.${table.name} is '${quoteSqlLiteral(table.purpose)}';`,
    ...indexes,
    tablePolicySql(table),
    `grant select, insert, update, delete on public.${table.name} to authenticated;`,
    table.access === 'public_read_private_write' ? `grant select on public.${table.name} to anon;` : '',
  ].filter(Boolean).join('\n');
}

function buildBlueprintSchema(blueprint: ProductionBlueprint) {
  const uniqueTables = new Map<string, ProductionBlueprintTable>();
  for (const table of blueprint.tables) uniqueTables.set(table.name, table);
  return [
    '',
    `-- Production blueprint: ${blueprint.label}`,
    'create table if not exists public.app_organizations (',
    '  id uuid primary key default gen_random_uuid(),',
    "  name text not null default 'Workspace',",
    "  slug text unique,",
    '  created_at timestamptz not null default now(),',
    '  updated_at timestamptz not null default now()',
    ');',
    '',
    'create table if not exists public.app_organization_members (',
    '  id uuid primary key default gen_random_uuid(),',
    '  organization_id uuid not null references public.app_organizations(id) on delete cascade,',
    '  user_id uuid not null references auth.users(id) on delete cascade,',
    "  role text not null default 'member' check (role in ('owner', 'admin', 'member', 'viewer')),",
    '  created_at timestamptz not null default now(),',
    '  unique (organization_id, user_id)',
    ');',
    '',
    'alter table public.app_organizations enable row level security;',
    'alter table public.app_organization_members enable row level security;',
    'create index if not exists app_organization_members_user_id_idx on public.app_organization_members (user_id);',
    'create index if not exists app_organization_members_organization_id_idx on public.app_organization_members (organization_id);',
    '',
    'drop policy if exists "Members can read organizations" on public.app_organizations;',
    'create policy "Members can read organizations" on public.app_organizations',
    '  for select to authenticated using (',
    '    exists (select 1 from public.app_organization_members m where m.organization_id = id and m.user_id = auth.uid())',
    '  );',
    'drop policy if exists "Users can create organizations" on public.app_organizations;',
    'create policy "Users can create organizations" on public.app_organizations',
    '  for insert to authenticated with check (true);',
    'drop policy if exists "Owners can update organizations" on public.app_organizations;',
    'create policy "Owners can update organizations" on public.app_organizations',
    '  for update to authenticated using (',
    '    exists (select 1 from public.app_organization_members m where m.organization_id = id and m.user_id = auth.uid() and m.role in (\'owner\', \'admin\'))',
    '  );',
    '',
    'drop policy if exists "Members can read organization members" on public.app_organization_members;',
    'create policy "Members can read organization members" on public.app_organization_members',
    '  for select to authenticated using (',
    '    user_id = auth.uid()',
    '  );',
    'drop policy if exists "Users can create their membership" on public.app_organization_members;',
    'create policy "Users can create their membership" on public.app_organization_members',
    '  for insert to authenticated with check (user_id = auth.uid());',
    'drop policy if exists "Users can update their membership" on public.app_organization_members;',
    'create policy "Users can update their membership" on public.app_organization_members',
    '  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());',
    '',
    'grant select, insert, update on public.app_organizations to authenticated;',
    'grant select, insert, update, delete on public.app_organization_members to authenticated;',
    ...Array.from(uniqueTables.values()).map(buildBlueprintTableSql),
  ].join('\n');
}

function buildSchema(requirement: CodenCloudRequirement, blueprint: ProductionBlueprint) {
  const storageBlock = requirement.needs_storage
    ? [
        '',
        '-- Optional file metadata table. Actual file binaries should live in Supabase Storage.',
        'create table if not exists public.app_assets (',
        '  id uuid primary key default gen_random_uuid(),',
        '  owner_id uuid references auth.users(id) on delete set null,',
        '  record_id uuid references public.app_records(id) on delete cascade,',
        '  bucket text not null default \'app-assets\',',
        '  path text not null,',
        '  mime_type text,',
        '  size_bytes bigint not null default 0,',
        '  created_at timestamptz not null default now()',
        ');',
        '',
        'alter table public.app_assets enable row level security;',
        '',
        'drop policy if exists "Users can read their assets" on public.app_assets;',
        'create policy "Users can read their assets" on public.app_assets',
        '  for select to authenticated using (owner_id = auth.uid());',
        'drop policy if exists "Users can insert their assets" on public.app_assets;',
        'create policy "Users can insert their assets" on public.app_assets',
        '  for insert to authenticated with check (owner_id = auth.uid());',
        'drop policy if exists "Users can update their assets" on public.app_assets;',
        'create policy "Users can update their assets" on public.app_assets',
        '  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());',
        'drop policy if exists "Users can delete their assets" on public.app_assets;',
        'create policy "Users can delete their assets" on public.app_assets',
        '  for delete to authenticated using (owner_id = auth.uid());',
        '',
        'grant select, insert, update, delete on public.app_assets to authenticated;',
        '',
        '-- Supabase Storage bucket and policies for generated app assets.',
        "insert into storage.buckets (id, name, public)",
        "values ('app-assets', 'app-assets', false)",
        'on conflict (id) do nothing;',
        '',
        'drop policy if exists "Users can read their storage assets" on storage.objects;',
        'create policy "Users can read their storage assets" on storage.objects',
        "  for select to authenticated using (bucket_id = 'app-assets' and owner = auth.uid());",
        'drop policy if exists "Users can upload their storage assets" on storage.objects;',
        'create policy "Users can upload their storage assets" on storage.objects',
        "  for insert to authenticated with check (bucket_id = 'app-assets' and owner = auth.uid());",
        'drop policy if exists "Users can update their storage assets" on storage.objects;',
        'create policy "Users can update their storage assets" on storage.objects',
        "  for update to authenticated using (bucket_id = 'app-assets' and owner = auth.uid()) with check (bucket_id = 'app-assets' and owner = auth.uid());",
        'drop policy if exists "Users can delete their storage assets" on storage.objects;',
        'create policy "Users can delete their storage assets" on storage.objects',
        "  for delete to authenticated using (bucket_id = 'app-assets' and owner = auth.uid());",
      ].join('\n')
    : '';

  return [
    `-- ${FULLSTACK_MARKER}`,
    '-- Managed backend contract generated by Coden.',
    '-- Apply this migration through Coden Cloud before enabling live persistence.',
    '-- Supabase note: new public tables may require explicit grants to be reachable through the Data API.',
    '',
    'create extension if not exists pgcrypto;',
    '',
    'create table if not exists public.app_profiles (',
    '  id uuid primary key references auth.users(id) on delete cascade,',
    '  display_name text,',
    '  avatar_url text,',
    '  created_at timestamptz not null default now(),',
    '  updated_at timestamptz not null default now()',
    ');',
    '',
    'create table if not exists public.app_records (',
    '  id uuid primary key default gen_random_uuid(),',
    '  owner_id uuid references auth.users(id) on delete cascade,',
    "  title text not null default 'Untitled record',",
    "  status text not null default 'todo' check (status in ('todo', 'active', 'done')),",
    "  payload jsonb not null default '{}'::jsonb,",
    '  created_at timestamptz not null default now(),',
    '  updated_at timestamptz not null default now()',
    ');',
    '',
    'alter table public.app_profiles enable row level security;',
    'alter table public.app_records enable row level security;',
    '',
    'drop policy if exists "Users can read their profile" on public.app_profiles;',
    'create policy "Users can read their profile" on public.app_profiles',
    '  for select to authenticated using (id = auth.uid());',
    'drop policy if exists "Users can insert their profile" on public.app_profiles;',
    'create policy "Users can insert their profile" on public.app_profiles',
    '  for insert to authenticated with check (id = auth.uid());',
    'drop policy if exists "Users can update their profile" on public.app_profiles;',
    'create policy "Users can update their profile" on public.app_profiles',
    '  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());',
    '',
    'drop policy if exists "Users can read their records" on public.app_records;',
    'create policy "Users can read their records" on public.app_records',
    '  for select to authenticated using (owner_id = auth.uid());',
    'drop policy if exists "Users can insert their records" on public.app_records;',
    'create policy "Users can insert their records" on public.app_records',
    '  for insert to authenticated with check (owner_id = auth.uid());',
    'drop policy if exists "Users can update their records" on public.app_records;',
    'create policy "Users can update their records" on public.app_records',
    '  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());',
    'drop policy if exists "Users can delete their records" on public.app_records;',
    'create policy "Users can delete their records" on public.app_records',
    '  for delete to authenticated using (owner_id = auth.uid());',
    '',
    'grant usage on schema public to anon, authenticated;',
    'grant select, insert, update, delete on public.app_profiles to authenticated;',
    'grant select, insert, update, delete on public.app_records to authenticated;',
    buildBlueprintSchema(blueprint),
    storageBlock,
    '',
  ].join('\n');
}

function buildFullstackReadme(requirement: CodenCloudRequirement, blueprint: ProductionBlueprint) {
  const parts = requirement.detected_from_prompt.length ? requirement.detected_from_prompt.join(', ') : 'database/auth readiness';
  const aiConnectorNotes = blueprint.type === 'ai_tool'
    ? [
        '- `src/lib/aiStream.ts`: browser-safe streaming client with AbortController support.',
        '- `supabase/functions/ai-stream/index.ts`: server-side SSE AI connector for provider calls and secrets.',
      ]
    : [];
  return [
    '# Coden Fullstack Notes',
    '',
    `This project includes a Coden Cloud fullstack kit for: ${parts}.`,
    `Production blueprint: ${blueprint.label} (${blueprint.type}).`,
    '',
    '## What is included',
    '',
    '- `src/lib/codenCloud.ts`: browser-safe Supabase client wrapper.',
    '- `src/lib/appData.ts`: CRUD data layer gated by the real Coden Cloud backend.',
    '- `src/lib/validation.ts`: Zod validation schemas for user input.',
    '- `supabase/functions/_shared/security.ts`: Edge Function security helpers for auth, rate limits and webhooks.',
    ...aiConnectorNotes,
    '- `supabase/schema.sql`: RLS-enabled schema with explicit Data API grants.',
    '- `src/fullstack.test.ts`: static safety check for generated backend integration.',
    '',
    '## Blueprint requirements',
    '',
    ...blueprint.pages.map(page => `- Page: ${page}`),
    ...blueprint.tables.map(table => `- Table: ${table.name} - ${table.purpose}`),
    '',
    '## Runtime behavior',
    '',
    'The preview reports backend-unavailable when Coden Cloud runtime config is missing; it never simulates private data.',
    'The runtime must connect Coden Cloud before writing or reading private app data.',
    'Live auth, database, storage, webhooks and secrets must be provisioned by Coden Cloud on the backend.',
    blueprint.type === 'ai_tool'
      ? 'AI streaming uses a server-side connector. Frontend files must call the Coden/Supabase function and must never initialize provider SDKs or read provider API keys.'
      : '',
    '',
    'Never place service role keys or provider secrets in frontend files.',
    '',
  ].join('\n');
}

function buildBackendPlan(input: FullstackKitInput, blueprint: ProductionBlueprint) {
  return JSON.stringify({
    marker: FULLSTACK_MARKER,
    project_name: input.projectName,
    blueprint: {
      type: blueprint.type,
      label: blueprint.label,
      pages: blueprint.pages,
      components: blueprint.components,
      workflows: blueprint.workflows,
      tests: blueprint.tests,
      risks: blueprint.risks,
      acceptance_criteria: blueprint.acceptanceCriteria,
    },
    backend: {
      provider: blueprint.backend.provider,
      features: blueprint.backend.features,
      requires_auth: blueprint.backend.requiresAuth,
      requires_database: blueprint.backend.requiresDatabase,
      requires_storage: blueprint.backend.requiresStorage,
      requires_billing: blueprint.backend.requiresBilling,
      mode: input.requirement.recommended_mode,
    },
    tables: blueprint.tables.map(table => ({
      name: table.name,
      purpose: table.purpose,
      access: table.access,
      indexes: table.indexes,
      sensitive: Boolean(table.sensitive),
    })),
    safety: {
      migrations_require_confirmation: true,
      privileged_keys_forbidden_in_client: true,
      rls_required_on_private_tables: true,
      webhook_signature_required: isPaymentBlueprint(blueprint),
      storage_policy_required: isStorageBlueprint(blueprint),
      local_storage_preview_only: true,
    },
    generated_at: new Date().toISOString(),
  }, null, 2);
}

function buildFullstackTest() {
  return [
    "import { readFileSync } from 'node:fs';",
    '',
    "const client = readFileSync(new URL('./lib/codenCloud.ts', import.meta.url), 'utf8');",
    "const data = readFileSync(new URL('./lib/appData.ts', import.meta.url), 'utf8');",
    "const validation = readFileSync(new URL('./lib/validation.ts', import.meta.url), 'utf8');",
    '',
    "if (!client.includes('createClient')) throw new Error('Coden Cloud client is missing createClient.');",
    "const forbidden = new RegExp(['service', 'role'].join('[_ -]?') + '|' + ['SUPABASE', 'SERVICE', 'ROLE'].join('_') + '|secret\\\\s+eyJ', 'i');",
    "if (forbidden.test(client + data + validation)) throw new Error('Frontend fullstack files must not contain backend-only credentials.');",
    "if (!/real backend cannot be verified|backend actions are unavailable/i.test(client)) throw new Error('Backend-unavailable messaging is missing.');",
    "if (!/requireCodenCloud|CODEN_CLOUD_NOT_CONFIGURED/.test(data)) throw new Error('Real backend gate is missing.');",
    "if (!/listRecords|createRecord|updateRecord|deleteRecord/.test(data)) throw new Error('CRUD helpers are incomplete.');",
    "if (!/zod|z\\.object/.test(validation)) throw new Error('Zod validation schemas are missing.');",
    '',
    "console.log('Generated fullstack smoke test passed.');",
    '',
  ].join('\n');
}

function buildAiStreamClient() {
  return [
    'export type AiStreamMessage = {',
    '  role: "user" | "assistant" | "system";',
    '  content: string;',
    '};',
    '',
    'export type AiStreamEvent =',
    '  | { type: "token"; text: string }',
    '  | { type: "status"; message: string }',
    '  | { type: "error"; message: string }',
    '  | { type: "thinking"; text: string }',
    '  | { type: "done"; totalTokens?: number };',
    '',
    'export type AiStreamState = "idle" | "connecting" | "streaming" | "error" | "done";',
    '',
    'export type AiStreamOptions = {',
    '  prompt?: string;',
    '  messages?: AiStreamMessage[];',
    '  accessToken?: string;',
    '  signal?: AbortSignal;',
    '  onEvent?: (event: AiStreamEvent) => void;',
    '  onToken?: (text: string) => void;',
    '  onStateChange?: (state: AiStreamState) => void;',
    '  maxRetries?: number;',
    '  retryDelayMs?: number;',
    '};',
    '',
    'export type AiStreamResult = {',
    '  text: string;',
    '  state: AiStreamState;',
    '  abort: () => void;',
    '  eventCount: number;',
    '};',
    '',
    "const DEFAULT_FUNCTION_PATH = '/functions/v1/ai-stream';",
    'const MAX_RETRIES = 3;',
    'const BASE_RETRY_DELAY_MS = 1000;',
    'const HEARTBEAT_TIMEOUT_MS = 30_000;',
    '',
    'function parseSseLine(line: string): AiStreamEvent | null {',
    '  if (!line.startsWith("data:")) return null;',
    '  const payload = line.slice(5).trim();',
    '  if (!payload || payload === "[DONE]") return { type: "done" };',
    '  try {',
    '    return JSON.parse(payload) as AiStreamEvent;',
    '  } catch {',
    '    return { type: "token", text: payload };',
    '  }',
    '}',
    '',
    'async function delay(ms: number) {',
    '  return new Promise<void>(resolve => setTimeout(resolve, ms));',
    '}',
    '',
    'export async function streamAiResponse(options: AiStreamOptions): Promise<AiStreamResult> {',
    '  const controller = new AbortController();',
    '  const abort = () => controller.abort();',
    '  if (options.signal) options.signal.addEventListener("abort", abort, { once: true });',
    '',
    '  const maxRetries = options.maxRetries ?? MAX_RETRIES;',
    '  const baseDelay = options.retryDelayMs ?? BASE_RETRY_DELAY_MS;',
    '  let accumulatedText = "";',
    '  let eventCount = 0;',
    '  let currentState: AiStreamState = "idle";',
    '  let lastEventId = "";',
    '',
    '  function setState(state: AiStreamState) {',
    '    currentState = state;',
    '    options.onStateChange?.(state);',
    '  }',
    '',
    '  for (let attempt = 0; attempt <= maxRetries; attempt++) {',
    '    try {',
    '      setState("connecting");',
    '      const headers: Record<string, string> = {',
    '        "content-type": "application/json",',
    '        "accept": "text/event-stream",',
    '      };',
    '      if (options.accessToken) headers.authorization = `Bearer ${options.accessToken}`;',
    '      if (lastEventId) headers["last-event-id"] = lastEventId;',
    '',
    '      const response = await fetch(DEFAULT_FUNCTION_PATH, {',
    '        method: "POST",',
    '        headers,',
    '        body: JSON.stringify({ prompt: options.prompt, messages: options.messages || [] }),',
    '        signal: controller.signal,',
    '      });',
    '',
    '      if (!response.ok || !response.body) {',
    '        if (attempt < maxRetries) {',
    '          await delay(baseDelay * Math.pow(2, attempt));',
    '          continue;',
    '        }',
    '        throw new Error("AI_STREAM_UNAVAILABLE");',
    '      }',
    '',
    '      setState("streaming");',
    '      const reader = response.body.getReader();',
    '      const decoder = new TextDecoder();',
    '      let buffer = "";',
    '      let lastEventTime = Date.now();',
    '',
    '      while (true) {',
    '        const { value, done } = await reader.read();',
    '        if (done) break;',
    '',
    '        if (Date.now() - lastEventTime > HEARTBEAT_TIMEOUT_MS) {',
    '          options.onEvent?.({ type: "error", message: "Connection stale, reconnecting..." });',
    '          break;',
    '        }',
    '',
    '        buffer += decoder.decode(value, { stream: true });',
    '        const lines = buffer.split("\\n");',
    '        buffer = lines.pop() || "";',
    '',
    '        for (const line of lines) {',
    '          const trimmed = line.trim();',
    '          if (trimmed.startsWith("id:")) {',
    '            lastEventId = trimmed.slice(3).trim();',
    '            continue;',
    '          }',
    '          const event = parseSseLine(trimmed);',
    '          if (!event) continue;',
    '          lastEventTime = Date.now();',
    '          eventCount++;',
    '          options.onEvent?.(event);',
    '          if (event.type === "token") {',
    '            accumulatedText += event.text;',
    '            options.onToken?.(event.text);',
    '          }',
    '          if (event.type === "done") {',
    '            setState("done");',
    '            return { text: accumulatedText, state: "done", abort, eventCount };',
    '          }',
    '        }',
    '      }',
    '',
    '      if (currentState === "done") break;',
    '      if (attempt < maxRetries) {',
    '        await delay(baseDelay * Math.pow(2, attempt));',
    '        continue;',
    '      }',
    '    } catch (error) {',
    '      if ((error as Error).name === "AbortError") {',
    '        setState("done");',
    '        return { text: accumulatedText, state: "done", abort, eventCount };',
    '      }',
    '      if (attempt < maxRetries) {',
    '        setState("error");',
    '        options.onEvent?.({ type: "error", message: `Retrying (${attempt + 1}/${maxRetries})...` });',
    '        await delay(baseDelay * Math.pow(2, attempt));',
    '        continue;',
    '      }',
    '      setState("error");',
    '      options.onEvent?.({ type: "error", message: (error as Error).message || "AI_STREAM_FAILED" });',
    '    }',
    '  }',
    '',
    '  if (currentState !== "done") setState("done");',
    '  options.onEvent?.({ type: "done" });',
    '  return { text: accumulatedText, state: currentState, abort, eventCount };',
    '}',
    '',
    'export function createAiStreamAbortController() {',
    '  return new AbortController();',
    '}',
    '',
  ].join('\n');
}

function buildAiStreamEdgeFunction() {
  return [
    "import { assertRateLimit, getBearerToken } from '../_shared/security.ts';",
    '',
    'const corsHeaders = {',
    '  "access-control-allow-origin": "*",',
    '  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type, last-event-id",',
    '  "access-control-allow-methods": "POST, OPTIONS",',
    '};',
    '',
    'const encoder = new TextEncoder();',
    'let globalEventId = 0;',
    '',
    'function sse(event: unknown, id?: number) {',
    '  const eventId = id ?? ++globalEventId;',
    '  return encoder.encode(`id: ${eventId}\\ndata: ${JSON.stringify(event)}\\n\\n`);',
    '}',
    '',
    'function heartbeat() {',
    '  return encoder.encode(": heartbeat\\n\\n");',
    '}',
    '',
    'type IncomingMessage = { role: "user" | "assistant" | "system"; content: string };',
    '',
    'type ProviderConfig = {',
    '  url: string;',
    '  apiKey: string;',
    '  model: string;',
    '  format: "openai" | "anthropic" | "gemini";',
    '  thinkingBudget?: number;',
    '};',
    '',
    'function detectProvider(): ProviderConfig | null {',
    '  const openaiKey = Deno.env.get("CODEN_AI_PROVIDER_API_KEY") || Deno.env.get("OPENAI_API_KEY");',
    '  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");',
    '  const geminiKey = Deno.env.get("GEMINI_API_KEY") || Deno.env.get("GOOGLE_AI_API_KEY");',
    '  const thinkingBudget = Number(Deno.env.get("CODEN_THINKING_BUDGET")) || 0;',
    '',
    '  if (anthropicKey) return {',
    '    url: Deno.env.get("ANTHROPIC_API_URL") || "https://api.anthropic.com/v1/messages",',
    '    apiKey: anthropicKey,',
    '    model: Deno.env.get("CODEN_AI_MODEL") || "anthropic/claude-sonnet-5",',
    '    format: "anthropic",',
    '    thinkingBudget,',
    '  };',
    '  if (geminiKey) return {',
    '    url: Deno.env.get("GEMINI_API_URL") || "https://generativelanguage.googleapis.com/v1beta/models",',
    '    apiKey: geminiKey,',
    '    model: Deno.env.get("CODEN_AI_MODEL") || "gemini-2.5-flash",',
    '    format: "gemini",',
    '    thinkingBudget,',
    '  };',
    '  if (openaiKey) return {',
    '    url: Deno.env.get("CODEN_AI_PROVIDER_URL") || "https://api.openai.com/v1/chat/completions",',
    '    apiKey: openaiKey,',
    '    model: Deno.env.get("CODEN_AI_MODEL") || "gpt-4o-mini",',
    '    format: "openai",',
    '    thinkingBudget,',
    '  };',
    '  return null;',
    '}',
    '',
    'function normalizeMessages(body: any): IncomingMessage[] {',
    '  const messages = Array.isArray(body?.messages) ? body.messages : [];',
    '  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";',
    '  const cleanMessages = messages',
    '    .filter((item: any) => ["user", "assistant", "system"].includes(item?.role) && typeof item?.content === "string")',
    '    .map((item: any) => ({ role: item.role, content: item.content.slice(0, 12000) }));',
    '  if (prompt) cleanMessages.push({ role: "user", content: prompt.slice(0, 12000) });',
    '  return cleanMessages.length ? cleanMessages : [{ role: "user", content: "Hello" }];',
    '}',
    '',
    'function buildProviderPayload(config: ProviderConfig, messages: IncomingMessage[]) {',
    '  if (config.format === "anthropic") {',
    '    const payload: Record<string, unknown> = {',
    '      model: config.model,',
    '      max_tokens: 4096,',
    '      messages: messages.filter(m => m.role !== "system"),',
    '      stream: true,',
    '    };',
    '    const systemMsg = messages.find(m => m.role === "system");',
    '    if (systemMsg) payload.system = systemMsg.content;',
    '    if (config.thinkingBudget && config.thinkingBudget > 0) {',
    '      payload.thinking = { type: "enabled", budget_tokens: config.thinkingBudget };',
    '      payload.temperature = 1;',
    '    }',
    '    return payload;',
    '  }',
    '  if (config.format === "gemini") {',
    '    return {',
    '      contents: messages.map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),',
    '      generationConfig: { maxOutputTokens: 4096 },',
    '    };',
    '  }',
    '  const payload: Record<string, unknown> = { model: config.model, messages, stream: true };',
    '  if (config.thinkingBudget && config.thinkingBudget > 0) {',
    '    payload.reasoning = { effort: "high" };',
    '  }',
    '  return payload;',
    '}',
    '',
    'function getProviderHeaders(config: ProviderConfig) {',
    '  if (config.format === "anthropic") {',
    '    return {',
    '      "x-api-key": config.apiKey,',
    '      "anthropic-version": "2023-06-01",',
    '      "content-type": "application/json",',
    '    };',
    '  }',
    '  return {',
    '    "authorization": `Bearer ${config.apiKey}`,',
    '    "content-type": "application/json",',
    '  };',
    '}',
    '',
    'function getProviderUrl(config: ProviderConfig) {',
    '  if (config.format === "gemini") {',
    '    return `${config.url}/${config.model}:streamGenerateContent?key=${config.apiKey}&alt=sse`;',
    '  }',
    '  return config.url;',
    '}',
    '',
    'function extractTokenFromChunk(json: any, format: string): { text: string; thinking?: string } {',
    '  if (format === "anthropic") {',
    '    if (json?.type === "content_block_delta") {',
    '      if (json.delta?.type === "thinking_delta") return { text: "", thinking: json.delta.thinking || "" };',
    '      return { text: json.delta?.text || "" };',
    '    }',
    '    return { text: "" };',
    '  }',
    '  if (format === "gemini") {',
    '    return { text: json?.candidates?.[0]?.content?.parts?.[0]?.text || "" };',
    '  }',
    '  const delta = json?.choices?.[0]?.delta;',
    '  return { text: delta?.content || delta?.text || json?.choices?.[0]?.text || "" };',
    '}',
    '',
    'Deno.serve(async (request) => {',
    '  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });',
    '  if (request.method !== "POST") {',
    '    return new Response(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }), { status: 405, headers: { ...corsHeaders, "content-type": "application/json" } });',
    '  }',
    '',
    '  const stream = new ReadableStream({',
    '    async start(controller) {',
    '      let heartbeatInterval: ReturnType<typeof setInterval> | null = null;',
    '      let tokenCount = 0;',
    '      try {',
    '        assertRateLimit(request.headers.get("x-forwarded-for") || "anonymous-ai-stream", 30, 60_000);',
    '        const provider = detectProvider();',
    '',
    '        if (!provider) {',
    '          controller.enqueue(sse({ type: "error", message: "AI provider key is not configured on the server." }));',
    '          controller.close();',
    '          return;',
    '        }',
    '',
    '        const body = await request.json().catch(() => ({}));',
    '        const messages = normalizeMessages(body);',
    '        controller.enqueue(sse({ type: "status", message: `Connecting to AI provider (${provider.format})...` }));',
    '',
    '        heartbeatInterval = setInterval(() => {',
    '          try { controller.enqueue(heartbeat()); } catch { /* stream closed */ }',
    '        }, 15_000);',
    '',
    '        const providerResponse = await fetch(getProviderUrl(provider), {',
    '          method: "POST",',
    '          headers: getProviderHeaders(provider),',
    '          body: JSON.stringify(buildProviderPayload(provider, messages)),',
    '        });',
    '',
    '        if (!providerResponse.ok || !providerResponse.body) {',
    '          controller.enqueue(sse({ type: "error", message: `AI provider error: ${providerResponse.status}` }));',
    '          controller.close();',
    '          return;',
    '        }',
    '',
    '        controller.enqueue(sse({ type: "status", message: "Streaming response..." }));',
    '        const reader = providerResponse.body.getReader();',
    '        const decoder = new TextDecoder();',
    '        let buffer = "";',
    '',
    '        while (true) {',
    '          const { value, done } = await reader.read();',
    '          if (done) break;',
    '          buffer += decoder.decode(value, { stream: true });',
    '          const lines = buffer.split("\\n");',
    '          buffer = lines.pop() || "";',
    '          for (const line of lines) {',
    '            const clean = line.trim();',
    '            if (!clean || clean.startsWith(":")) continue;',
    '            if (!clean.startsWith("data:")) continue;',
    '            const payload = clean.slice(5).trim();',
    '            if (!payload || payload === "[DONE]") continue;',
    '            try {',
    '              const json = JSON.parse(payload);',
    '              const { text, thinking } = extractTokenFromChunk(json, provider.format);',
    '              if (thinking) controller.enqueue(sse({ type: "thinking", text: thinking }));',
    '              if (text) {',
    '                tokenCount++;',
    '                controller.enqueue(sse({ type: "token", text }));',
    '              }',
    '            } catch {',
    '              if (payload.length > 0 && payload.length < 1000) {',
    '                controller.enqueue(sse({ type: "token", text: payload }));',
    '              }',
    '            }',
    '          }',
    '        }',
    '        controller.enqueue(sse({ type: "done", totalTokens: tokenCount }));',
    '      } catch (_error) {',
    '        controller.enqueue(sse({ type: "error", message: "AI stream failed safely." }));',
    '      } finally {',
    '        if (heartbeatInterval) clearInterval(heartbeatInterval);',
    '        controller.close();',
    '      }',
    '    },',
    '  });',
    '',
    '  return new Response(stream, {',
    '    headers: {',
    '      ...corsHeaders,',
    '      "content-type": "text/event-stream; charset=utf-8",',
    '      "cache-control": "no-cache, no-transform",',
    '      "connection": "keep-alive",',
    '      "x-accel-buffering": "no",',
    '    },',
    '  });',
    '});',
    '',
  ].join('\n');
}

function buildAiStreamTest() {
  return [
    "import { readFileSync } from 'node:fs';",
    '',
    "const client = readFileSync(new URL('./lib/aiStream.ts', import.meta.url), 'utf8');",
    "const forbidden = /VITE_(OPENAI|ANTHROPIC|GEMINI|GOOGLE|DEEPSEEK|FAL).*KEY|new\\s+OpenAI|Anthropic\\(|GoogleGenerativeAI/i;",
    "if (forbidden.test(client)) throw new Error('AI provider calls and provider keys must stay out of frontend files.');",
    "if (!/AbortController/.test(client)) throw new Error('AI stream client needs AbortController support.');",
    "if (!/\\/functions\\/v1\\/ai-stream/.test(client)) throw new Error('AI stream client must call the server connector.');",
    '',
    "console.log('Generated AI connector smoke test passed.');",
    '',
  ].join('\n');
}

export function applyCodenFullstackKit(input: FullstackKitInput): FullstackGeneratedFile[] {
  if (!shouldApplyCodenFullstackKit(input)) return input.files;
  const blueprint = inferProductionBlueprint(input.prompt);
  const byPath = new Map(input.files.map(file => [normalizePath(file.path), { ...file, path: normalizePath(file.path) }]));

  const packageFile = fileByPath(input.files, 'package.json');
  upsertFile(byPath, 'package.json', mergePackageJson(packageFile?.content || '{}'), 'json');
  // Normalize every data-backed generation to the same tested TanStack Start
  // runtime. The model remains responsible for the product UI in App.tsx;
  // Coden supplies only the framework, routing and deployment contract.
  upsertFile(byPath, 'vite.config.ts', buildTanStackViteConfig(), 'ts');
  upsertFile(byPath, 'tsconfig.json', buildTanStackTsconfig(), 'json');
  upsertFile(byPath, 'wrangler.jsonc', buildWranglerConfig(input.projectName), 'json');
  upsertFile(byPath, 'src/router.tsx', buildTanStackRouter(), 'tsx');
  upsertFile(byPath, 'src/routeTree.gen.ts', buildTanStackRouteTree(), 'ts');
  upsertFile(byPath, 'src/routes/__root.tsx', buildTanStackRootRoute(input.projectName), 'tsx');
  upsertFile(byPath, 'src/routes/index.tsx', buildTanStackIndexRoute(), 'tsx');
  upsertFile(byPath, 'src/vite-env.d.ts', '/// <reference types="vite/client" />\n', 'ts');
  upsertFile(byPath, 'src/lib/codenCloud.ts', buildCodenCloudClient(), 'ts');
  upsertFile(byPath, 'src/lib/appData.ts', buildAppDataLayer(input.requirement), 'ts');
  upsertFile(byPath, 'src/lib/validation.ts', buildValidationLayer(blueprint), 'ts');
  upsertFile(byPath, AUTH_GUARD_PATH, buildAuthGuard(blueprint), 'ts');
  upsertFile(byPath, 'supabase/functions/_shared/security.ts', buildEdgeSecurityHelpers(blueprint), 'ts');
  if (isPaymentBlueprint(blueprint)) {
    upsertFile(byPath, PAYMENT_ACTIONS_PATH, buildPaymentActions(blueprint), 'ts');
    upsertFile(byPath, STRIPE_WEBHOOK_FUNCTION_PATH, buildStripeWebhookFunction(blueprint), 'ts');
  }
  if (blueprint.type === 'ai_tool') {
    upsertFile(byPath, AI_STREAM_CLIENT_PATH, buildAiStreamClient(), 'ts');
    upsertFile(byPath, AI_STREAM_FUNCTION_PATH, buildAiStreamEdgeFunction(), 'ts');
    upsertFile(byPath, 'src/ai-stream.test.ts', buildAiStreamTest(), 'ts');
    const packageForAi = byPath.get('package.json');
    if (packageForAi && !/ai-stream\.test\.ts/i.test(packageForAi.content)) {
      try {
        const pkg = JSON.parse(packageForAi.content || '{}');
        const currentTest = String(pkg.scripts?.test || 'node --experimental-strip-types src/app.test.ts && node --experimental-strip-types src/fullstack.test.ts').trim();
        pkg.scripts = {
          ...(pkg.scripts || {}),
          test: `${currentTest} && node --experimental-strip-types src/ai-stream.test.ts`,
        };
        upsertFile(byPath, 'package.json', JSON.stringify(pkg, null, 2), 'json');
      } catch {
        // Keep the generated package unchanged if it was not parseable.
      }
    }
  }

  const existingSchema = fileByPath(input.files, 'supabase/schema.sql')?.content || '';
  const generatedSchema = buildSchema(input.requirement, blueprint);
  upsertFile(byPath, BACKEND_PLAN_PATH, buildBackendPlan(input, blueprint), 'json');
  upsertFile(byPath, VERSIONED_MIGRATION_PATH, generatedSchema, 'sql');
  upsertFile(
    byPath,
    'supabase/schema.sql',
    existingSchema.includes(FULLSTACK_MARKER)
      ? existingSchema
      : [existingSchema.trim(), generatedSchema].filter(Boolean).join('\n\n'),
    'sql',
  );
  upsertFile(byPath, 'FULLSTACK.md', buildFullstackReadme(input.requirement, blueprint), 'markdown');
  upsertFile(byPath, 'src/fullstack.test.ts', buildFullstackTest(), 'ts');
  const runtimeManifest = manifestFile({
    prompt: input.prompt,
    files: Array.from(byPath.values()),
    requirement: input.requirement,
  });
  upsertFile(byPath, runtimeManifest.path, runtimeManifest.content, 'json');

  return Array.from(byPath.values());
}

export function validateCodenFullstackFiles(files: FullstackGeneratedFile[], requirement: CodenCloudRequirement): FullstackValidationCheck[] {
  if (!hasCodenCloudRequirement(requirement) && !hasSupabaseUsage(files)) return [];
  const checks: FullstackValidationCheck[] = [];
  const runtimeManifest = fileByPath(files, 'coden/app-manifest.json');
  if (!runtimeManifest) {
    checks.push(fail('generated_runtime_manifest_present', 'Generated app must include coden/app-manifest.json.', 'coden/app-manifest.json'));
  } else {
    try {
      const parsed = JSON.parse(runtimeManifest.content || '{}');
      checks.push(
        parsed?.schemaVersion === 1 && parsed?.profile && parsed?.framework && parsed?.runtime
          ? pass('generated_runtime_manifest_valid', 'Generated app runtime manifest is valid.', runtimeManifest.path)
          : fail('generated_runtime_manifest_valid', 'Generated app runtime manifest is incomplete.', runtimeManifest.path),
      );
    } catch {
      checks.push(fail('generated_runtime_manifest_valid', 'Generated app runtime manifest is not valid JSON.', runtimeManifest.path));
    }
  }
  const client = fileByPath(files, 'src/lib/codenCloud.ts');
  const data = fileByPath(files, 'src/lib/appData.ts');
  const validation = fileByPath(files, 'src/lib/validation.ts');
  const authGuard = fileByPath(files, AUTH_GUARD_PATH);
  const backendPlan = fileByPath(files, BACKEND_PLAN_PATH);
  const versionedMigration = fileByPath(files, VERSIONED_MIGRATION_PATH);
  const paymentActions = fileByPath(files, PAYMENT_ACTIONS_PATH);
  const stripeWebhook = fileByPath(files, STRIPE_WEBHOOK_FUNCTION_PATH);
  const edgeSecurity = fileByPath(files, 'supabase/functions/_shared/security.ts');
  const aiStreamClient = fileByPath(files, AI_STREAM_CLIENT_PATH);
  const aiStreamFunction = fileByPath(files, AI_STREAM_FUNCTION_PATH);
  const schema = fileByPath(files, 'supabase/schema.sql');
  const packageFile = fileByPath(files, 'package.json');
  const routeTree = fileByPath(files, 'src/routeTree.gen.ts');
  const allSource = files.map(file => `${file.path}\n${file.content || ''}`).join('\n\n');
  const blueprint = blueprintFromBackendPlan(backendPlan?.content || '') || inferProductionBlueprint(allSource);
  const isAiToolProject = blueprint.type === 'ai_tool' || Boolean(aiStreamClient || aiStreamFunction);

  checks.push(client ? pass('fullstack_client_present', 'Generated app includes a browser-safe Coden Cloud client.', 'src/lib/codenCloud.ts') : fail('fullstack_client_present', 'Missing src/lib/codenCloud.ts browser-safe backend client.', 'src/lib/codenCloud.ts'));
  checks.push(data ? pass('fullstack_data_layer_present', 'Generated app includes a CRUD data layer.', 'src/lib/appData.ts') : fail('fullstack_data_layer_present', 'Missing src/lib/appData.ts CRUD data layer.', 'src/lib/appData.ts'));
  checks.push(validation ? pass('fullstack_validation_present', 'Generated app includes Zod validation schemas.', 'src/lib/validation.ts') : fail('fullstack_validation_present', 'Missing src/lib/validation.ts validation schemas.', 'src/lib/validation.ts'));
  checks.push(authGuard ? pass('fullstack_auth_guard_present', 'Generated app includes an auth and role guard helper.', AUTH_GUARD_PATH) : fail('fullstack_auth_guard_present', 'Missing auth and role guard helper.', AUTH_GUARD_PATH));
  checks.push(backendPlan ? pass('fullstack_backend_plan_present', 'Generated app includes a backend plan contract.', BACKEND_PLAN_PATH) : fail('fullstack_backend_plan_present', 'Missing backend plan contract.', BACKEND_PLAN_PATH));
  checks.push(versionedMigration ? pass('fullstack_versioned_migration_present', 'Generated app includes a versioned Supabase migration.', VERSIONED_MIGRATION_PATH) : fail('fullstack_versioned_migration_present', 'Missing versioned Supabase migration.', VERSIONED_MIGRATION_PATH));
  checks.push(edgeSecurity ? pass('fullstack_edge_security_present', 'Generated app includes Edge Function security helpers.', 'supabase/functions/_shared/security.ts') : fail('fullstack_edge_security_present', 'Missing Edge Function security helpers.', 'supabase/functions/_shared/security.ts'));
  checks.push(schema ? pass('fullstack_schema_present', 'Generated app includes a Supabase migration schema.', 'supabase/schema.sql') : fail('fullstack_schema_present', 'Missing supabase/schema.sql migration.', 'supabase/schema.sql'));
  checks.push(
    routeTree && /rootRoute\.addChildren\(\[indexRoute\]\)/.test(routeTree.content) && /routes\/index/.test(routeTree.content)
      ? pass('fullstack_route_tree_present', 'Generated app includes the deterministic TanStack route tree.', routeTree.path)
      : fail('fullstack_route_tree_present', 'Missing deterministic TanStack route tree required by src/router.tsx.', 'src/routeTree.gen.ts'),
  );

  if (schema) {
    checks.push(/enable row level security/i.test(schema.content) ? pass('fullstack_rls_enabled', 'Schema enables RLS.', schema.path) : fail('fullstack_rls_enabled', 'Schema must enable RLS for exposed tables.', schema.path));
    checks.push(/grant\s+(select|usage|insert|update|delete)/i.test(schema.content) ? pass('fullstack_data_api_grants', 'Schema includes explicit Data API grants.', schema.path) : fail('fullstack_data_api_grants', 'Schema must include explicit grants for Supabase Data API access.', schema.path));
    checks.push(/create policy/i.test(schema.content) ? pass('fullstack_rls_policies', 'Schema includes RLS policies.', schema.path) : fail('fullstack_rls_policies', 'Schema must include RLS policies.', schema.path));
    const createdTables = extractCreatedPublicTables(schema.content).filter(table => /^app_/.test(table));
    const tablesMissingRls = createdTables.filter(table => !new RegExp(`alter\\s+table\\s+public\\.${escapeRegExp(table)}\\s+enable\\s+row\\s+level\\s+security`, 'i').test(schema.content));
    const tablesMissingPolicies = createdTables.filter(table => !new RegExp(`create\\s+policy[\\s\\S]{0,220}\\s+on\\s+public\\.${escapeRegExp(table)}`, 'i').test(schema.content));
    checks.push(!tablesMissingRls.length ? pass('fullstack_all_private_tables_rls', 'Every generated app table enables RLS.', schema.path) : fail('fullstack_all_private_tables_rls', `Missing RLS on tables: ${tablesMissingRls.slice(0, 8).join(', ')}.`, schema.path));
    checks.push(!tablesMissingPolicies.length ? pass('fullstack_all_private_tables_policies', 'Every generated app table has at least one policy.', schema.path) : fail('fullstack_all_private_tables_policies', `Missing policies on tables: ${tablesMissingPolicies.slice(0, 8).join(', ')}.`, schema.path));
    checks.push(/owner_id|organization_id|org_id/i.test(schema.content) ? pass('fullstack_owner_or_org_scope', 'Schema includes owner or organization scoping.', schema.path) : fail('fullstack_owner_or_org_scope', 'Schema must include owner_id or organization_id for private data.', schema.path));
    if (blueprint.tables.some(table => table.sensitive)) {
      checks.push(/app_audit_logs|audit_logs/i.test(schema.content) ? pass('fullstack_audit_logs', 'Sensitive blueprint includes audit logs.', schema.path) : warn('fullstack_audit_logs', 'Sensitive apps should include audit logs.', schema.path));
    }
    if (blueprint.backend.requiresStorage || /app_assets|storage\.objects|storage\.buckets/i.test(schema.content)) {
      checks.push(/storage\.buckets/i.test(schema.content) && /storage\.objects/i.test(schema.content)
        ? pass('fullstack_storage_policies', 'Storage apps include bucket and object policies.', schema.path)
        : fail('fullstack_storage_policies', 'Storage apps need bucket and storage.objects policies.', schema.path));
    }
  }

  if (packageFile) {
    checks.push(/@supabase\/supabase-js/i.test(packageFile.content) ? pass('fullstack_supabase_dependency', 'package.json includes @supabase/supabase-js.', 'package.json') : fail('fullstack_supabase_dependency', 'package.json must include @supabase/supabase-js.', 'package.json'));
    checks.push(/"zod"\s*:/i.test(packageFile.content) ? pass('fullstack_zod_dependency', 'package.json includes Zod for validation.', 'package.json') : fail('fullstack_zod_dependency', 'package.json must include Zod for server/client validation.', 'package.json'));
    checks.push(/fullstack\.test\.ts/i.test(packageFile.content) ? pass('fullstack_test_script', 'package.json runs the fullstack smoke test.', 'package.json') : warn('fullstack_test_script', 'package.json should run src/fullstack.test.ts.', 'package.json'));
  }

  if (data) {
    checks.push(/requireCodenCloud|CODEN_CLOUD_NOT_CONFIGURED|isPreviewRuntime/i.test(data.content)
      ? pass('fullstack_no_fake_localstorage_prod', 'Generated data access requires the real Coden Cloud backend.', data.path)
      : fail('fullstack_no_fake_localstorage_prod', 'Generated data access must not silently simulate production persistence.', data.path));
  }

  if (validation) {
    checks.push(/z\.object|from 'zod'|from "zod"/i.test(validation.content) ? pass('fullstack_zod_validation', 'Validation layer uses Zod schemas.', validation.path) : fail('fullstack_zod_validation', 'Validation layer must use Zod schemas.', validation.path));
  }

  if (edgeSecurity) {
    checks.push(/assertRateLimit/i.test(edgeSecurity.content) ? pass('fullstack_rate_limit_helper', 'Edge security layer includes a rate limit helper.', edgeSecurity.path) : fail('fullstack_rate_limit_helper', 'Sensitive actions need rate limit helper.', edgeSecurity.path));
    checks.push(/assertWebhookSignature/i.test(edgeSecurity.content) ? pass('fullstack_webhook_signature_helper', 'Edge security layer includes webhook signature guard.', edgeSecurity.path) : warn('fullstack_webhook_signature_helper', 'Payment-capable apps should include webhook signature verification.', edgeSecurity.path));
  }

  if (isPaymentBlueprint(blueprint)) {
    checks.push(paymentActions
      ? pass('fullstack_payment_actions_present', 'Payment app includes a server-owned checkout action wrapper.', PAYMENT_ACTIONS_PATH)
      : fail('fullstack_payment_actions_present', 'Payment apps need a checkout action wrapper.', PAYMENT_ACTIONS_PATH));
    checks.push(stripeWebhook
      ? pass('fullstack_stripe_webhook_present', 'Payment app includes a Stripe webhook edge function.', STRIPE_WEBHOOK_FUNCTION_PATH)
      : fail('fullstack_stripe_webhook_present', 'Payment apps need a Stripe webhook edge function.', STRIPE_WEBHOOK_FUNCTION_PATH));
    checks.push(/assertWebhookSignature|STRIPE_WEBHOOK_SECRET|stripe-signature/i.test(stripeWebhook?.content || '')
      ? pass('fullstack_stripe_webhook_signature', 'Stripe webhook verifies server-side signature.', stripeWebhook?.path || STRIPE_WEBHOOK_FUNCTION_PATH)
      : fail('fullstack_stripe_webhook_signature', 'Stripe webhook must verify server-side signature.', STRIPE_WEBHOOK_FUNCTION_PATH));
  }

  if (isAiToolProject) {
    checks.push(aiStreamClient
      ? pass('fullstack_ai_stream_client_present', 'Generated AI app includes a browser-safe AI stream client.', AI_STREAM_CLIENT_PATH)
      : fail('fullstack_ai_stream_client_present', 'AI apps need src/lib/aiStream.ts to call the server connector.', AI_STREAM_CLIENT_PATH));
    checks.push(aiStreamFunction
      ? pass('fullstack_ai_stream_function_present', 'Generated AI app includes a server-side AI stream function.', AI_STREAM_FUNCTION_PATH)
      : fail('fullstack_ai_stream_function_present', 'AI apps need a server-side Supabase function for provider streaming.', AI_STREAM_FUNCTION_PATH));
    checks.push(/text\/event-stream|ReadableStream|Server-Sent/i.test(aiStreamFunction?.content || '')
      ? pass('fullstack_ai_stream_sse', 'AI connector streams with SSE or a ReadableStream.', aiStreamFunction?.path || AI_STREAM_FUNCTION_PATH)
      : fail('fullstack_ai_stream_sse', 'AI connector must stream responses with SSE or ReadableStream.', AI_STREAM_FUNCTION_PATH));
    checks.push(/Deno\.env\.get|process\.env/i.test(aiStreamFunction?.content || '')
      ? pass('fullstack_ai_secrets_server_side', 'AI provider key is read only in server-side function code.', aiStreamFunction?.path || AI_STREAM_FUNCTION_PATH)
      : fail('fullstack_ai_secrets_server_side', 'AI provider keys must be read in the server connector, not frontend files.', AI_STREAM_FUNCTION_PATH));
    checks.push(/AbortController|signal/i.test(aiStreamClient?.content || '')
      ? pass('fullstack_ai_stream_cancel', 'AI stream client supports cancellation.', aiStreamClient?.path || AI_STREAM_CLIENT_PATH)
      : warn('fullstack_ai_stream_cancel', 'AI stream client should support cancellation with AbortController.', AI_STREAM_CLIENT_PATH));
  }

  checks.push(!/service[_-]?role|SUPABASE_SERVICE_ROLE|sbp_[a-z0-9]|secret eyJ/i.test(allSource) && !containsSecret(allSource)
    ? pass('fullstack_no_frontend_secrets', 'No service role or provider secret found in generated fullstack files.')
    : fail('fullstack_no_frontend_secrets', 'Generated fullstack files must not contain service role keys or secrets.'));

  if (requirement.needs_auth) {
    checks.push(/auth:\s*\{|\.auth\b|getCodenCloudClient|requireAppUser/i.test(client?.content || allSource)
      ? pass('fullstack_auth_client_ready', 'Auth requests have an explicit Supabase client path.', client?.path || 'src/lib/codenCloud.ts')
      : fail('fullstack_auth_client_ready', 'Auth app needs an explicit Supabase client path.', 'src/lib/codenCloud.ts'));
  }

  return checks;
}

function extractCreatedPublicTables(sql: string) {
  const tables: string[] = [];
  const re = /create\s+table\s+if\s+not\s+exists\s+public\.([a-zA-Z0-9_]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(sql))) {
    if (match[1]) tables.push(match[1]);
  }
  return Array.from(new Set(tables));
}

function escapeRegExp(value: string) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function pass(key: string, message: string, file?: string): FullstackValidationCheck {
  return { key, status: 'pass', severity: 'info', message, file };
}

function warn(key: string, message: string, file?: string): FullstackValidationCheck {
  return { key, status: 'warn', severity: 'medium', message, file };
}

function fail(key: string, message: string, file?: string): FullstackValidationCheck {
  return { key, status: 'fail', severity: 'high', message, file };
}
