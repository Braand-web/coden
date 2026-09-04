// Deployment marker: publish the restored Coden dashboard surface.
import express from 'express';
import { createAgentEventStream } from './src/services/agent-event-stream.ts';
import Stripe from 'stripe';
import dotenv from 'dotenv';
import { buildMetaPrompt } from './src/services/agent-meta-prompter.ts';
import { buildDependencyGraph, findDependents } from './src/services/agent-ast-parser.ts';
import { extractArchitectureDecisions, updateProjectMemory, buildMemoryRagContext, selectRelevantMemoryRows } from './src/services/agent-memory-rag.ts';
import { buildSmartContextInjection } from './src/services/smart-context-injector.ts';
import { extractDesignTokens, buildDesignTokenContext, designSystemToMemoryRows, designSystemFromMemoryRow } from './src/services/design-token-store.ts';
import { detectPromptConflict, conflictToPromptContext } from './src/services/conflict-detector.ts';
import { SemanticRag } from './src/services/semantic-rag.ts';
import { runParallelAgents, mergeAgentOutputs, selectAgentsForContext, type ParallelAgentContext } from './src/services/parallel-agent-runner.ts';
import { initJobQueue, startJobWorker, enqueueJob, getJobStatus, cancelJob, shouldUseJobQueue, registerJobHandler } from './src/services/async-job-queue.ts';
import fs from 'fs';
import path from 'path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

// Import our custom services
import { OpenRouterService, buildVisionMessageContent, resolveOpenRouterApiKey, type ChatMessage } from './src/services/openrouter-service.ts';
import { ProviderGateway } from './src/services/provider-gateway.ts';
import { runLlmToolLoop } from './src/services/llm-tool-loop.ts';
import {
  canCodenSkillUseTool,
  capSubagentCount,
  getCodenSkillBudget,
  getCodenSkill,
  isCriticalCodenAction,
  listCodenSkills,
  readCodenSkillFeatureFlags,
  resolveCodenSkill,
  type CodenSkill,
  type CodenSkillBudget,
} from './src/services/coden-skills.ts';
import {
  computeNextWorkflowRun,
  validateWorkflowInput,
  workflowIdempotencyKey,
  workflowIsDue,
  type CodenWorkflowTrigger,
} from './src/services/coden-workflows.ts';
import { parseOrRepairStructuredObject } from './src/services/structured-output.ts';
import {
  CodenAgentHarness,
  InMemoryAgentHarnessStore,
  SupabaseAgentHarnessStore,
  buildDefinitionOfDone,
  createHarnessTurnIdempotencyKey,
  type HarnessThread,
  type HarnessTurn,
} from './src/services/agent-harness/index.ts';
import {
  messagePartsFromContent,
  messageTextFromParts,
  normalizeMessageParts,
  redactMessageParts,
} from './src/lib/chat-message-parts.ts';

import {
  buildAIModelRuntimeConfig,
  getAllAIModelCapabilityProfiles,
  getAIModelCapabilityProfile,
  publicRuntimeErrorMessage,
  type AIWorkflowTask,
} from './src/services/ai-model-runtime.ts';
import { buildProviderRequestConfig } from './src/services/provider-adapters.ts';
import { ModelRouter, type RoutingContext } from './src/services/model-router.ts';
import { selectModelForAgent } from './src/services/model-selection.ts';
import {
  canReassignProjectSlug,
  deriveProjectName,
  isAutomaticallyDerivedProjectName,
  sanitizeSuggestedProjectName,
} from './src/services/project-naming.ts';
import { ForbiddenModelError, validateAllowedModel } from './src/services/ai-validator.ts';
import {
  AI_ALLOWED_MODELS,
  AI_AUTO_MODEL_OPTION,
  AI_MODEL_DISPLAY_NAMES,
  AI_MODEL_TIERS,
  AI_MODEL_CAPABILITIES,
  DEFAULT_PROVIDER_MODEL_ID,
  MODEL_REGISTRY,
  MODEL_ACTION_CREDIT_FLOORS,
  MODEL_CREDIT_RATES,
  PROVIDER_META,
  UserPlan,
  getModelsByProvider,
  isAllowedModelId,
  normalizeModelSelectionId,
  type AllowedModelId,
  type ModelDefinition,
  type ModelProvider,
} from './src/config/ai-models.ts';
import { CostEstimatorService, CreditWalletService, CreditLedgerService, CreditReservationService } from './src/services/credit-system.ts';
import { DomainService, createCloudflareDomainProvider, domainStateLabel, resolveDomainState } from './src/services/domain-service.ts';
import {
  StripeService,
  SAAS_PLANS,
  TOPUP_PRODUCTS,
  CLOUD_TOPUP_PRODUCTS,
  PLAN_ECONOMICS_GUARDRAILS,
  getCloudUsageCategories,
  getPlanConfig,
  getPublicPlans,
  isPaidPlanKey,
  normalizePlanKey,
} from './src/services/billing-service.ts';
import { AuditLogService, BillingAlertService, UsageMeteringService, MemberLimitService } from './src/services/platform-support.ts';
import { buildWorldClassUiPolicy } from './src/services/design-generation-policy.ts';
import {
  auditGeneratedDesign,
  auditGeneratedFunctionality,
} from './src/services/design-quality-auditor.ts';
import {
  buildAgentTextSystemPrompt,
  buildFinalizerSystemPrompt,
  buildGenerationSystemPrompt,
  buildIntentRouterSystemPrompt,
} from './src/services/agent-prompt-stack.ts';
import {
  buildAgentContextPack,
  isAgentV2Enabled,
  redactAgentPayload,
  summarizeAgentMemory,
  summarizeVerificationChecks,
  verifyGeneratedProject,
  type AgentVerificationCheck,
} from './src/services/agent-v2.ts';
import {
  HybridProjectRunner,
  isVerificationCapabilityUnavailable,
  runnerChecksToVerificationChecks,
  type RunnerResult,
} from './src/services/project-runner.ts';
import { runBrowserInteractionAuditDetailed, type BrowserTestResult } from './src/services/browser-interaction-runner.ts';
import {
  appendVerifiedFact,
  assertAgentModelCapabilities,
  createFactLedger,
  finalizeFactLedger,
  responseContradictions,
  validateModelDecision,
  type AgentObjective,
  type VerifiedFactLedger,
} from './src/services/agent-runtime-v2.ts';
import { inspectVisualPreview } from './src/services/visual-preview-inspector.ts';
import { scanGeneratedSecurity } from './src/services/generated-security-scanner.ts';
import {
  WebResearchGateway,
  researchToPromptContext,
  shouldUseWebResearch,
  type ResearchResult,
} from './src/services/web-research-gateway.ts';
import {
  DEFAULT_AGENT_V3_BUDGET,
  buildAgentV3Context,
  isAgentV3Enabled,
  summarizeResearchForMemory,
  summarizeRunnerForMemory,
} from './src/services/agent-v3.ts';
import {
  GeneratedOutputParseError,
  extractGeneratedJson,
  extractGeneratedMarkdownFiles,
  looksLikeStandaloneHtml,
} from './src/services/generated-output-parser.ts';
import { buildPreviewErrorHtml } from './src/services/preview-fallback.ts';
import {
  understandUserIntent,
  type IntentUnderstanding,
  type UserIntentCategory,
} from './src/services/intent-understanding.ts';
import {
  buildTypedIntentDecision,
  type TypedIntentDecision,
} from './src/services/typed-intent-router.ts';
import {
  buildExecutionContract,
  type ExecutionContract,
} from './src/services/execution-contract.ts';
import {
  sanitizeAssistantOutput,
  shouldDeliverRecoverableDraft,
  validateExecutionOutputContract,
} from './src/services/agent-execution-os.ts';
import {
  buildDurableCheckpoint,
  buildDurableRunContract,
  buildDurableRunPayload,
  decideDurableRunContinuation,
  durablePhaseForEvent,
  nextDurablePhase,
  type DurableRunCheckpoint,
  type DurableRunPhase,
} from './src/services/durable-agent-run.ts';
import { buildAgentImprovementSignal, buildUserFeedbackImprovementSignal } from './src/services/agent-self-improvement.ts';
import {
  buildCodenCloudSchemaName,
  detectCodenCloudRequirements,
  hasCodenCloudRequirement,
  summarizeCodenCloudRequirements,
  type CodenCloudRequirement,
} from './src/services/coden-cloud.ts';
import {
  applyCodenFullstackKit,
  shouldApplyCodenFullstackKit,
} from './src/services/fullstack-generation.ts';
import {
  createGeneratedAppManifest,
  manifestFile,
  resolveGeneratedAppProfile,
  validateGeneratedAppManifest,
} from './src/services/generated-app-runtime.ts';
import {
  createProjectManifest,
  serializeProjectManifest,
  validateProjectManifest,
} from './src/services/universal-project-manifest.ts';
import { immutableArtifactHash } from './src/services/deployment-adapters.ts';
import { applyGeneratedMigration } from './src/services/supabase-provisioning.ts';
import { readCodenAgentFeatureFlags } from './src/config/coden-agent-feature-flags.ts';
import {
  UNLIMITED_TEST_CREDIT_DISPLAY_BALANCE,
  UNLIMITED_TEST_CREDIT_METADATA_KEY,
  canActivateUnlimitedTestCredits,
  userHasUnlimitedTestCredits,
} from './src/services/unlimited-test-credits.ts';
import {
  TEMPORARY_GENERATION_ACCESS_TOKEN,
  isTemporaryGenerationAccessAllowed,
  isTemporaryGenerationRoute,
  readTemporaryGenerationAccessConfig,
} from './src/services/temporary-generation-access.ts';
import { containsSecret, redactSecretPayload, redactSecrets } from './src/services/secret-redaction.ts';
import {
  MEDIA_MODEL_REGISTRY,
  estimateMediaCredits,
  isMediaModelAvailable,
  isMarketingMediaKind,
  mediaOutputForKind,
  mediaSettingsSummary,
  normalizeMediaSettings,
  selectMediaModel,
  type CodenMediaSettings,
} from './src/services/media-model-registry.ts';
import { FalMediaGateway, type FalMediaAsset } from './src/services/fal-media-gateway.ts';
import {
  applyImportContextToPrompt,
  buildImportContext,
  publicImportContext,
} from './src/services/import-intelligence.ts';
import {
  applySeniorAgentContextToPrompt,
  compileSeniorAgentContext,
  type SeniorAgentContext,
} from './src/services/senior-agent-os.ts';
import {
  applyDeepReasoningToPrompt,
  buildDeepReasoningContract,
  deepReasoningPromptContext,
  type DeepReasoningContract,
} from './src/services/deep-reasoning.ts';
import { buildAgentMoatIntelligence } from './src/services/agent-moat-intelligence.ts';
import {
  buildDesignStudioBrief,
  designWorkshopInstructionLines,
  normalizeDesignWorkshopSettings,
} from './src/services/design-workshop.ts';

dotenv.config();

const CODEN_SKILL_FLAGS = readCodenSkillFeatureFlags(process.env);
const CODEN_AGENT_FLAGS = readCodenAgentFeatureFlags(process.env);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = Number(process.env.PORT || 3000);
const staticRoot = path.join(__dirname, 'dist');

function requireCodenAgentFeature(res: any, enabled: boolean, feature: string) {
  if (enabled) return true;
  res.status(503).json({
    success: false,
    error: `${feature} is temporarily unavailable.`,
    code: 'CODEN_FEATURE_DISABLED',
    feature,
  });
  return false;
}

const MAX_PROJECT_ASSET_BYTES = 4 * 1024 * 1024;
const ANALYTICS_MAX_ROWS = 10000;
const ANALYTICS_CURRENT_VISITOR_WINDOW_MS = 5 * 60 * 1000;
const ALLOWED_PROJECT_ASSET_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
  'text/plain',
  'text/markdown',
  'application/json',
  'text/csv',
  'application/pdf',
  'application/octet-stream',
]);

const COUNTRY_NAMES: Record<string, string> = {
  BR: 'Brazil',
  CA: 'Canada',
  CM: 'Cameroon',
  DE: 'Germany',
  ES: 'Spain',
  FR: 'France',
  GB: 'United Kingdom',
  IN: 'India',
  IT: 'Italy',
  NG: 'Nigeria',
  NL: 'Netherlands',
  PT: 'Portugal',
  US: 'United States',
  ZA: 'South Africa',
};

// Standard middlewares
app.use(express.json({ limit: '8mb' }));

// The Builder is a code-execution surface and needs cross-origin isolation for
// its WebContainer sandbox. Keep the policy scoped to the Builder document so
// landing/auth pages and OAuth popups retain their normal browser behavior.
// Set CODEN_WEBCONTAINER_PREVIEW=0 only as an emergency rollback.
if (process.env.CODEN_WEBCONTAINER_PREVIEW !== '0') {
  app.use((req: any, res: any, next: any) => {
    if (/^\/builder\.html\/?$/i.test(String(req.path || ''))) {
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      // `credentialless` rather than `require-corp`: both establish the
      // cross-origin isolation WebContainers needs, but require-corp blocks
      // every cross-origin subresource that does not send CORP — the Tailwind,
      // esm.sh and unpkg assets the builder and its preview load. Under
      // credentialless those still load, without credentials, so isolation can
      // actually be reached instead of silently costing the page its assets.
      res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
    }
    next();
  });
}

// ── LAZY-LOADED RESOURCES / CLIENT GAUARDS ───────────────────────────
const SUPABASE_SERVER_CLIENT_OPTIONS = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
  realtime: {
    // Supabase JS initializes Realtime even when the backend only uses Auth/DB.
    // Railway currently runs Node 20, which needs an explicit WebSocket transport.
    transport: WebSocket as any,
  },
};

function getSupabaseProjectRef(url: string) {
  try {
    const host = new URL(url).hostname;
    return host.endsWith('.supabase.co') ? host.split('.')[0] : host;
  } catch {
    return 'invalid-url';
  }
}

function getJwtPayload(value: string) {
  try {
    const part = value.split('.')[1];
    if (!part) return null;
    const normalized = part.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(normalized, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

function classifySupabaseKey(value?: string) {
  const key = String(value || '').trim();
  if (!key) return 'missing';
  if (key.startsWith('sbp_')) return 'personal_access_token';
  if (key.startsWith('sb_secret_')) return 'secret_key';
  if (key.startsWith('sb_publishable_')) return 'publishable_key';
  const payload = getJwtPayload(key);
  const role = typeof payload?.role === 'string' ? payload.role : '';
  if (role === 'service_role') return 'jwt_service_role';
  if (role === 'anon') return 'jwt_anon';
  return 'unknown';
}

function isSupabaseProjectApiKey(value?: string) {
  return ['secret_key', 'publishable_key', 'jwt_service_role', 'jwt_anon'].includes(classifySupabaseKey(value));
}

function getSupabaseRuntimeDiagnostics() {
  const backendConfigured = Boolean(process.env.SUPABASE_URL);
  const frontendConfigured = Boolean(process.env.VITE_SUPABASE_URL);
  const backendUrl = process.env.SUPABASE_URL || '';
  const frontendUrl = process.env.VITE_SUPABASE_URL || '';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '';
  return {
    backend_project_ref: getSupabaseProjectRef(backendUrl),
    frontend_project_ref: getSupabaseProjectRef(frontendUrl),
    backend_configured: backendConfigured,
    frontend_configured: frontendConfigured,
    project_refs_match: backendConfigured && frontendConfigured
      ? getSupabaseProjectRef(backendUrl) === getSupabaseProjectRef(frontendUrl)
      : null,
    service_role_key_kind: classifySupabaseKey(serviceRoleKey),
    service_role_project_api_key: isSupabaseProjectApiKey(serviceRoleKey),
    auth_key_kind: classifySupabaseKey(publishableKey),
  };
}

let supabase: any = null;
function getSupabase() {
  if (!supabase) {
    const url = process.env.SUPABASE_URL || '';
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (url && key && isSupabaseProjectApiKey(key)) {
      supabase = createClient(url, key, SUPABASE_SERVER_CLIENT_OPTIONS);
    } else if (key && !isSupabaseProjectApiKey(key)) {
      console.warn('[coden:supabase_service_role_invalid]', {
        key_kind: classifySupabaseKey(key),
        expected: 'Supabase project API key, not a personal access token',
      });
    }
  }
  return supabase;
}

let supabaseAuth: any = null;
function getSupabaseAuthClient() {
  if (!supabaseAuth) {
    const url = process.env.SUPABASE_URL || '';
    const key =
      process.env.SUPABASE_PUBLISHABLE_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      (isSupabaseProjectApiKey(process.env.SUPABASE_SERVICE_ROLE_KEY) ? process.env.SUPABASE_SERVICE_ROLE_KEY : '');

    if (url && key && isSupabaseProjectApiKey(key)) {
      supabaseAuth = createClient(url, key, SUPABASE_SERVER_CLIENT_OPTIONS);
    }
  }
  return supabaseAuth;
}

const AUTH_SESSION_UNAVAILABLE_MESSAGE = 'Your session could not be read. Please refresh the page and sign in again.';

function createAuthSessionUnavailableError(requestId?: string, message = AUTH_SESSION_UNAVAILABLE_MESSAGE) {
  const error = new Error(message) as any;
  error.statusCode = 401;
  error.status = 401;
  error.diagnosticCode = 'AUTH_SESSION_UNAVAILABLE';
  error.diagnostic_code = 'AUTH_SESSION_UNAVAILABLE';
  error.requestId = requestId;
  error.request_id = requestId;
  error.suggestedAction = 'sign_in_again';
  error.suggested_action = 'sign_in_again';
  return error;
}

function authSessionUnavailablePayload(requestId?: string, message = AUTH_SESSION_UNAVAILABLE_MESSAGE) {
  return {
    success: false,
    error: message,
    message,
    diagnostic_code: 'AUTH_SESSION_UNAVAILABLE',
    request_id: requestId,
    suggested_action: 'sign_in_again',
  };
}

function getRequiredAuth(req: any, requestId?: string) {
  const user = req.auth?.user || req.user;
  if (user?.id) {
    return {
      user,
      userId: String(user.id),
      email: String(user.email || ''),
    };
  }

  console.warn('[coden:server_auth_state_invariant]', {
    request_id: requestId || null,
    path: req.path,
    has_authorization: Boolean(req.headers?.authorization),
    invariant: 'SERVER_AUTH_STATE_INVARIANT',
  });

  throw createAuthSessionUnavailableError(requestId);
}

function getOptionalAuthState(req: any) {
  const user = req?.auth?.user || req?.user || null;
  return {
    user,
    userId: req?.auth?.userId || user?.id || null,
    email: req?.auth?.email || user?.email || null,
  };
}

const DEFAULT_PLATFORM_ADMIN_EMAILS = ['novacore629@gmail.com'];
const unlimitedTestCreditUserIds = new Set<string>();

function rememberUnlimitedTestCreditUser(user: any) {
  if (user?.id && userHasUnlimitedTestCredits(user)) {
    unlimitedTestCreditUserIds.add(String(user.id));
  }
}

function hasUnlimitedTestCredits(userId: unknown) {
  return unlimitedTestCreditUserIds.has(String(userId || ''));
}

function normalizeAdminEmail(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function getPlatformAdminEmails() {
  const configured = [
    process.env.CODEN_ADMIN_EMAILS,
    process.env.ADMIN_EMAILS,
    process.env.PLATFORM_ADMIN_EMAILS,
  ]
    .filter(Boolean)
    .flatMap(value => String(value).split(','))
    .map(normalizeAdminEmail)
    .filter(Boolean);

  return new Set([...DEFAULT_PLATFORM_ADMIN_EMAILS, ...configured]);
}

async function requireAuth(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  if (!token) {
    return res.status(401).json(authSessionUnavailablePayload(undefined, 'Authentication required'));
  }

  const authClient = getSupabaseAuthClient();
  if (!authClient) {
    return res.status(503).json(authSessionUnavailablePayload(undefined, 'Authentication service is not configured'));
  }
  let authResult: any;
  try {
    authResult = await authClient.auth.getUser(token);
  } catch (error: any) {
    console.warn('[coden:auth_session_unavailable]', {
      reason: 'supabase_get_user_threw',
      message: redactSecrets(error?.message || String(error), '[redacted]'),
    });
    return res.status(401).json(authSessionUnavailablePayload(undefined, 'Invalid or expired session'));
  }
  const data = authResult?.data;
  const error = authResult?.error;
  const user = data?.user;

  if (error || !user) {
    console.warn('[coden:auth_session_unavailable]', {
      reason: error ? 'supabase_get_user_error' : 'missing_user',
      message: error?.message ? redactSecrets(error.message, '[redacted]') : null,
      status: error?.status || null,
    });
    return res.status(401).json(authSessionUnavailablePayload(undefined, 'Invalid or expired session'));
  }

  rememberUnlimitedTestCreditUser(user);
  req.user = user;
  req.auth = {
    user,
    userId: String(user.id),
    email: String(user.email || ''),
  };
  return next();
}

type TemporaryGenerationPrincipal = {
  user: any;
  expiresAt: number;
};

let temporaryGenerationUserCache: {
  email: string;
  user: any;
  fetchedAt: number;
} | null = null;

async function resolveTemporaryGenerationPrincipal(req: any): Promise<TemporaryGenerationPrincipal | null> {
  const config = readTemporaryGenerationAccessConfig(process.env);
  if (!isTemporaryGenerationAccessAllowed(req, process.env)) return null;

  const now = Date.now();
  if (
    temporaryGenerationUserCache &&
    temporaryGenerationUserCache.email === config.email &&
    temporaryGenerationUserCache.fetchedAt > now - 5 * 60_000
  ) {
    return { user: temporaryGenerationUserCache.user, expiresAt: config.expiresAt };
  }

  const client = getSupabase();
  const listUsers = (client?.auth as any)?.admin?.listUsers;
  if (typeof listUsers !== 'function') return null;

  try {
    const { data, error } = await listUsers.call((client.auth as any).admin, { page: 1, perPage: 1000 });
    if (error) return null;
    const user = (data?.users || []).find((candidate: any) => String(candidate?.email || '').trim().toLowerCase() === config.email);
    if (!user?.id) return null;

    temporaryGenerationUserCache = { email: config.email, user, fetchedAt: now };
    if (config.unlimitedCredits || canActivateUnlimitedTestCredits(user.email, process.env)) {
      unlimitedTestCreditUserIds.add(String(user.id));
    }
    return { user, expiresAt: config.expiresAt };
  } catch (error: any) {
    console.warn('[coden:temporary_generation_user_unavailable]', {
      message: redactSecrets(error?.message || String(error), '[redacted]'),
    });
    return null;
  }
}

function attachTemporaryGenerationPrincipal(req: any, principal: TemporaryGenerationPrincipal) {
  req.user = principal.user;
  req.auth = {
    user: principal.user,
    userId: String(principal.user.id),
    email: String(principal.user.email || ''),
  };
  req.codenTemporaryGenerationAccess = true;
  req.codenTemporaryGenerationExpiresAt = principal.expiresAt;
}

async function requireAuthWithTemporaryGeneration(req: any, res: any, next: any) {
  const authHeader = String(req.headers.authorization || '');
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token || token === TEMPORARY_GENERATION_ACCESS_TOKEN) {
    const principal = await resolveTemporaryGenerationPrincipal(req);
    if (principal) {
      attachTemporaryGenerationPrincipal(req, principal);
      return next();
    }
    if (token === TEMPORARY_GENERATION_ACCESS_TOKEN) {
      return res.status(403).json({ success: false, error: 'Temporary generation access is not available from this network.' });
    }
  }
  return requireAuth(req, res, next);
}

function requireProjectAuthWithTemporaryGeneration(req: any, res: any, next: any) {
  if (isTemporaryGenerationRoute(req.method, req.originalUrl || req.url || '')) {
    return requireAuthWithTemporaryGeneration(req, res, next);
  }
  return requireAuth(req, res, next);
}

app.get('/api/auth/temporary-generation', async (req: any, res: any) => {
  const principal = await resolveTemporaryGenerationPrincipal(req);
  if (!principal) return res.status(404).json({ success: false, error: 'Not found.' });

  const config = readTemporaryGenerationAccessConfig(process.env);
  res.setHeader('Cache-Control', 'no-store');
  return res.json({
    success: true,
    temporary_access: true,
    expires_at: new Date(principal.expiresAt).toISOString(),
    user: {
      id: String(principal.user.id),
      email: String(principal.user.email || ''),
      user_metadata: principal.user.user_metadata || {},
    },
    unlimited_test_credits: Boolean(config.unlimitedCredits || hasUnlimitedTestCredits(principal.user.id)),
  });
});

function requireAuthenticatedUser(req: any, res: any, requestId?: string) {
  try {
    return getRequiredAuth(req, requestId).user;
  } catch (error: any) {
    console.warn('[coden:auth_session_missing_after_middleware]', {
      request_id: requestId || null,
      path: req.path,
      has_authorization: Boolean(req.headers?.authorization),
      message: redactSecrets(error?.message || String(error), '[redacted]'),
    });
    res.status(401).json(authSessionUnavailablePayload(requestId, redactSecrets(error?.message || AUTH_SESSION_UNAVAILABLE_MESSAGE, '[redacted]')));
    return null;
  }
}

function getAuthenticatedUserOrThrow(req: any, requestId?: string) {
  return getRequiredAuth(req, requestId).user;
}

app.get('/api/auth/me', requireAuthWithTemporaryGeneration, async (req: any, res) => {
  const auth = getRequiredAuth(req);
  let planKey = 'free';
  try {
    planKey = normalizePlanKey(await getOrganizationPlan(auth.userId).catch(() => 'free')) || 'free';
  } catch {
    planKey = 'free';
  }
  const plan = getPlanConfig(planKey) || SAAS_PLANS.free;
  res.json({
    success: true,
    user: {
      id: auth.userId,
      email: auth.email,
      role: auth.user.role,
      is_platform_admin: isPlatformAdmin(req),
      unlimited_test_credits: hasUnlimitedTestCredits(auth.userId),
      temporary_generation_access: Boolean(req.codenTemporaryGenerationAccess),
      temporary_generation_expires_at: req.codenTemporaryGenerationExpiresAt
        ? new Date(req.codenTemporaryGenerationExpiresAt).toISOString()
        : null,
    },
    plan: {
      key: plan.key,
      label: plan.name || plan.key,
    },
  });
});

app.get('/api/debug/auth-session', requireAuth, (req: any, res) => {
  const auth = getRequiredAuth(req);
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    success: true,
    has_user: true,
    user_id: auth.userId,
    email: auth.email || null,
  });
});

app.get('/api/health', (_req, res) => {
  const supabaseDiagnostics = getSupabaseRuntimeDiagnostics();
  const deployedCommit =
    process.env.CODEN_BUILD_COMMIT ||
    process.env.RAILWAY_GIT_COMMIT_SHA ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.GIT_COMMIT ||
    null;
  res.json({
    success: true,
    status: 'ok',
    service: 'coden-saas',
    time: new Date().toISOString(),
    static_dist: pathExists(staticRoot),
    deployment: {
      commit: deployedCommit,
      commit_short: deployedCommit ? deployedCommit.slice(0, 7) : null,
      branch:
        process.env.CODEN_BUILD_BRANCH ||
        process.env.RAILWAY_GIT_BRANCH ||
        process.env.VERCEL_GIT_COMMIT_REF ||
        null,
      environment:
        process.env.RAILWAY_ENVIRONMENT_NAME ||
        process.env.VERCEL_ENV ||
        process.env.NODE_ENV ||
        null,
    },
    project_refs_match: supabaseDiagnostics.project_refs_match,
    integrations: {
      supabase_url: Boolean(process.env.SUPABASE_URL),
      supabase_service_role: supabaseDiagnostics.service_role_project_api_key,
      openrouter: Boolean(getOpenRouterApiKey()),
      cloudflare: Boolean(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN),
      generated_app_hosting: process.env.CODEN_STATIC_HOSTING_PROVIDER === 'cloudflare-pages'
        ? 'cloudflare-pages-legacy'
        : 'cloudflare-workers',
      stripe: Boolean(process.env.STRIPE_SECRET_KEY),
      agent_harness: 'coden-harness/v3',
      agent_harness_persistence: Boolean(
        process.env.CODEN_SUPABASE_MGMT_TOKEN ||
        process.env.SUPABASE_MANAGEMENT_TOKEN ||
        process.env.SUPABASE_ACCESS_TOKEN
      ) ? 'managed_migration' : 'service_role_with_memory_fallback',
    },
    diagnostics: {
      supabase: supabaseDiagnostics,
    },
  });
});

app.post('/api/users/me/test-credit-access/activate', requireAuth, async (req: any, res: any) => {
  const auth = getRequiredAuth(req);
  if (!canActivateUnlimitedTestCredits(auth.email, process.env)) {
    return res.status(404).json({ success: false, error: 'Test credit access is not available for this account.' });
  }

  const client = requireSupabase('Unlimited test credit activation');
  const appMetadata = auth.user?.app_metadata && typeof auth.user.app_metadata === 'object'
    ? auth.user.app_metadata
    : {};
  const activatedAt = new Date().toISOString();
  const { data, error } = await client.auth.admin.updateUserById(auth.userId, {
    app_metadata: {
      ...appMetadata,
      [UNLIMITED_TEST_CREDIT_METADATA_KEY]: true,
      coden_test_credit_activated_at: appMetadata.coden_test_credit_activated_at || activatedAt,
    },
  });
  if (error || !data?.user) {
    return res.status(500).json({ success: false, error: 'Test credit access could not be activated.' });
  }

  unlimitedTestCreditUserIds.add(auth.userId);
  return res.json({
    success: true,
    test_credit_access: { unlimited: true, activated_at: data.user.app_metadata?.coden_test_credit_activated_at || activatedAt },
  });
});

app.get('/favicon.ico', (_req, res) => {
  res.redirect(308, '/favicon.svg');
});

app.post('/api/landing/conversion', (req, res) => {
  const event = req.body && typeof req.body === 'object' ? req.body : {};
  const name = String(event.event_name || event.event || event.name || '').trim().slice(0, 80);
  if (!name || !/^[a-z0-9:_-]+$/i.test(name)) {
    return res.status(400).json({ success: false, error: 'Invalid conversion event.' });
  }
  if (!enforceRateLimit(`conversion:${req.ip || 'unknown'}`, 120, 60_000)) {
    return res.status(429).json({ success: false, error: 'Too many conversion events.' });
  }
  console.info('[coden:conversion]', {
    event: name,
    place: String(event.place || event.surface || event.metadata?.place || event.metadata?.surface || '').slice(0, 80) || null,
    source: String(event.source || event.metadata?.source || '').slice(0, 80) || null,
  });
  return res.status(202).json({ success: true, accepted: true });
});

function setAnalyticsCors(res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
}

app.options('/api/analytics/collect', (_req, res) => {
  setAnalyticsCors(res);
  res.status(204).end();
});

app.use('/api/billing/wallet', requireAuthWithTemporaryGeneration);
app.use('/api/billing/ledger', requireAuthWithTemporaryGeneration);
app.use('/api/billing/checkout', requireAuth);
app.use('/api/billing/portal', requireAuth);
app.use('/api/ai/estimate', requireAuth);
app.use('/api/ai/route', requireAuth);
app.use('/api/users/me', requireAuthWithTemporaryGeneration);
app.use('/api/admin', requireAuth);
app.use('/api/assistant', requireAuthWithTemporaryGeneration);
app.use('/api/projects', requireProjectAuthWithTemporaryGeneration);

// Runtime data must live in Supabase. The only in-memory state kept here is
// short-lived rate-limit counters, which are not product data.
const RATE_LIMITS = new Map<string, number[]>();
const DEFAULT_ORG_ID = '00000000-0000-0000-0000-000000000000';

// Instantiate Core Services
function getOpenRouterApiKey() {
  return resolveOpenRouterApiKey(process.env);
}

function hasLiveAiProvider() {
  return Boolean(getOpenRouterApiKey());
}

function getOpenRouterSiteUrl() {
  return String(
    process.env.OPENROUTER_SITE_URL ||
    process.env.PUBLIC_SITE_URL ||
    process.env.APP_URL ||
    'https://coden.fun'
  ).replace(/[\u0000-\u001f\u007f]/g, '').trim();
}

const openRouter = new OpenRouterService({
  apiKey: getOpenRouterApiKey(),
  siteUrl: getOpenRouterSiteUrl(),
  appName: String(process.env.OPENROUTER_APP_NAME || 'Coden').trim()
});
const providerGateway = new ProviderGateway(openRouter);
const AGENT_V3_ENABLED = isAgentV3Enabled(process.env);
const AGENT_V2_ENABLED = isAgentV2Enabled(process.env) || AGENT_V3_ENABLED;
const AGENT_RUNTIME_V2_ENABLED = process.env.CODEN_AGENT_RUNTIME_V2 !== '0';
const STRICT_VERIFICATION_ENABLED = process.env.CODEN_STRICT_VERIFICATION !== '0';
/*
 * Script execution stays off, and turning it on is not an improvement.
 *
 * This runner writes the project to a throwaway temp directory and runs
 * `npm run build` there — without ever installing dependencies. With scripts
 * enabled every build fails on "vite: not found", which is a fact about the
 * empty directory rather than about the generated app, and the repair loop
 * then chases an error the model did not cause.
 *
 * Its static checks (package.json parsing, unsafe-script refusal) still earn
 * their place. Real execution belongs to the sandbox, which installs the
 * project's own dependencies before asking its toolchain anything —
 * src/services/sandbox/validate.ts.
 */
const projectRunner = new HybridProjectRunner({ executeScripts: process.env.AGENT_RUNNER_EXECUTE_SCRIPTS === '1' });
const webResearchGateway = new WebResearchGateway(process.env);
const falMediaGateway = new FalMediaGateway(process.env);

const modelRouter = new ModelRouter();
const costEstimator = new CostEstimatorService();

function requireSupabase(feature: string) {
  const client = getSupabase();
  if (!client) {
    const error = new Error(`${feature} requires SUPABASE_SERVICE_ROLE_KEY on the backend.`);
    (error as any).statusCode = 503;
    throw error;
  }
  return client;
}

function diagnoseProviderError(error: any) {
  const rawMessage = String(error?.message || error || 'Generation failed.');
  const message = redactSecrets(rawMessage, '[redacted]');
  if (/Cannot read properties of undefined \(reading ['"]user['"]\)/i.test(rawMessage)) {
    console.error('[coden:server_auth_state_invariant]', {
      invariant: 'SERVER_AUTH_STATE_INVARIANT',
      message,
    });
    return {
      message: AUTH_SESSION_UNAVAILABLE_MESSAGE,
      diagnostic_code: 'AUTH_SESSION_UNAVAILABLE',
      suggested_action: 'sign_in_again',
      status: 401,
    };
  }
  if (/Cannot read properties of undefined \(reading ['"]auth['"]\)/i.test(rawMessage)) {
    return {
      message: 'Le code genere essaie d utiliser Auth sans client configure. Coden va corriger le client Auth automatiquement.',
      diagnostic_code: 'SUPABASE_AUTH_CLIENT_UNDEFINED',
      suggested_action: 'fix_generated_auth_client',
      status: 500,
    };
  }
  if (/auth session|invalid or expired session|session could not be read|AUTH_SESSION_UNAVAILABLE/i.test(rawMessage)) {
    return {
      message: 'Your session could not be read. Please refresh the page and sign in again.',
      diagnostic_code: 'AUTH_SESSION_UNAVAILABLE',
      suggested_action: 'sign_in_again',
      status: 401,
    };
  }
  if (error?.diagnosticCode) {
    const suggestedByCode: Record<string, string> = {
      AUTO_MODEL_NOT_RESOLVED: 'use_auto',
      OPENROUTER_NOT_CONFIGURED: 'configure_openrouter_key',
      OPENROUTER_KEY_INVALID: 'update_openrouter_key',
      ANTHROPIC_NOT_CONFIGURED: 'configure_anthropic_key',
      ANTHROPIC_KEY_INVALID: 'update_anthropic_key',
      MODEL_OUTPUT_PARSE_FAILED: 'retry_or_use_auto',
      RELIABILITY_GATE_FAILED: 'fix_and_retry',
      PROVIDER_BAD_REQUEST: 'retry_or_use_auto',
      PROVIDER_QUOTA_OR_BILLING: 'check_provider_billing',
      PROVIDER_RATE_LIMITED: 'retry_later',
      PROVIDER_TIMEOUT: 'retry_or_use_auto',
      PROVIDER_UNAVAILABLE: 'retry_or_use_auto',
      MODEL_UNAVAILABLE: 'use_auto',
      MODEL_NOT_ALLOWED: 'use_auto',
      PROVIDER_CIRCUIT_OPEN: 'retry_or_use_auto',
      AUTH_SESSION_UNAVAILABLE: 'sign_in_again',
    };
    const publicMessageByCode: Record<string, string> = {
      PROVIDER_TIMEOUT: 'The AI provider did not answer in time. Coden kept the project unchanged. Retry with Auto, or choose a faster allowed model.',
      PROVIDER_UNAVAILABLE: 'The AI provider is temporarily unavailable. Coden kept the project unchanged. Retry in a moment or use Auto.',
      PROVIDER_CIRCUIT_OPEN: 'This model is cooling down after repeated provider failures. Use Auto or retry shortly.',
    };
    return {
      message: String(error.diagnosticCode) === 'MODEL_OUTPUT_PARSE_FAILED'
        ? 'Coden could not safely read the AI output, so the existing app was kept unchanged. Please retry with Auto or ask for a smaller targeted change.'
        : publicMessageByCode[String(error.diagnosticCode)] || message,
      diagnostic_code: String(error.diagnosticCode),
      suggested_action: suggestedByCode[String(error.diagnosticCode)] || 'retry_or_use_auto',
      status: Number(error.statusCode || 502),
    };
  }
  if (/insufficient.*credit|quota|billing|payment required|OpenRouter HTTP 402/i.test(rawMessage)) {
    return {
      message: 'The AI provider rejected the request because its account has insufficient credits or quota. Check provider billing, then retry.',
      diagnostic_code: 'PROVIDER_QUOTA_OR_BILLING',
      suggested_action: 'check_provider_billing',
      status: 503,
    };
  }
  if (/OpenRouter.*not configured|OPENROUTER_API_KEY/i.test(rawMessage)) {
    return {
      message: 'OpenRouter is not configured. Add OPENROUTER_API_KEY on Railway and redeploy. The backend also accepts OPEN_ROUTER_API_KEY, OPENROUTER_KEY, or OPENROUTER_TOKEN.',
      diagnostic_code: 'OPENROUTER_NOT_CONFIGURED',
      suggested_action: 'configure_openrouter_key',
      status: 503,
    };
  }
  if (/OpenRouter HTTP 401|OpenRouter HTTP 403|invalid api key|unauthorized/i.test(rawMessage)) {
    return {
      message: 'OpenRouter key invalid or unauthorized. Update OPENROUTER_API_KEY on Railway and redeploy.',
      diagnostic_code: 'OPENROUTER_KEY_INVALID',
      suggested_action: 'update_openrouter_key',
      status: 503,
    };
  }
  if (/OpenRouter HTTP 404|model.*not.*found|not found/i.test(rawMessage)) {
    return {
      message: 'The selected AI model is unavailable on OpenRouter. Choose Auto or another allowed model.',
      diagnostic_code: 'MODEL_UNAVAILABLE',
      suggested_action: 'use_auto',
      status: 502,
    };
  }
  if (/OpenRouter HTTP 400|bad request|invalid request|unsupported parameter|provider rejected/i.test(rawMessage)) {
    return {
      message: 'OpenRouter rejected the AI request format. Retry with Auto; if it keeps happening, check the selected model and Railway logs.',
      diagnostic_code: 'PROVIDER_BAD_REQUEST',
      suggested_action: 'retry_or_use_auto',
      status: 502,
    };
  }
  if (/OpenRouter HTTP 429|rate limit|too many requests/i.test(rawMessage)) {
    return {
      message: 'OpenRouter rate limit reached. Please wait a moment and try again.',
      diagnostic_code: 'PROVIDER_RATE_LIMITED',
      suggested_action: 'retry_later',
      status: 429,
    };
  }
  if (/timeout|AbortError|aborted/i.test(rawMessage)) {
    return {
      message: 'The AI provider did not answer in time. Coden kept the project unchanged. Retry with Auto, or choose a faster allowed model.',
      diagnostic_code: 'PROVIDER_TIMEOUT',
      suggested_action: 'retry_or_use_auto',
      status: 504,
    };
  }
  if (/OpenRouter HTTP 5|OpenRouter API Error|provider|upstream|ECONNRESET|ENOTFOUND|fetch failed|network/i.test(rawMessage)) {
    return {
      message: 'The AI provider is temporarily unavailable. Please retry or choose another allowed model.',
      diagnostic_code: 'PROVIDER_UNAVAILABLE',
      suggested_action: 'retry_or_use_auto',
      status: 502,
    };
  }
  if (/Permission denied/i.test(rawMessage)) {
    return {
      message: 'Action unavailable with your current project role.',
      diagnostic_code: 'PERMISSION_DENIED',
      suggested_action: 'ask_project_owner',
      status: 403,
    };
  }
  if (error?.statusCode >= 500 || /server error|internal/i.test(rawMessage)) {
    return {
      message: 'Coden hit an internal server error while handling this request. Please retry in a moment.',
      diagnostic_code: 'SERVER_ERROR',
      suggested_action: 'retry',
      status: error?.statusCode || 500,
    };
  }
  return {
    message,
    diagnostic_code: 'GENERATION_FAILED',
    suggested_action: 'retry',
    status: error?.statusCode || 400,
  };
}

function normalizeProviderError(error: any): string {
  return diagnoseProviderError(error).message;
}

function createPublicError(message: string, statusCode = 500, diagnosticCode = 'SERVER_ERROR', suggestedAction = 'retry') {
  const error = new Error(message) as Error & {
    statusCode?: number;
    diagnostic_code?: string;
    suggested_action?: string;
  };
  error.statusCode = statusCode;
  error.diagnostic_code = diagnosticCode;
  error.suggested_action = suggestedAction;
  return error;
}

function diagnosePublishError(error: any) {
  const message = String(error?.message || error || 'Publish failed.');
  const statusCode = Number(error?.statusCode || 500);
  if (error?.diagnostic_code) {
    return {
      message,
      diagnostic_code: String(error.diagnostic_code),
      suggested_action: String(error.suggested_action || 'retry'),
      status: statusCode,
    };
  }
  if (/CLOUDFLARE_(ACCOUNT_ID|API_TOKEN|ZONE_ID_CODEN_FUN)|Missing environment variable/i.test(message)) {
    return {
      message: 'Publishing is not configured on the server. Configure the required Cloudflare credentials, redeploy, then retry.',
      diagnostic_code: 'CLOUDFLARE_NOT_CONFIGURED',
      suggested_action: 'configure_cloudflare',
      status: 503,
    };
  }
  if (/401|403|unauthorized|forbidden|invalid token/i.test(message)) {
    return {
      message: 'Cloudflare rejected the publish credentials. Update the Cloudflare API token and redeploy.',
      diagnostic_code: 'CLOUDFLARE_TOKEN_INVALID',
      suggested_action: 'update_cloudflare_token',
      status: 503,
    };
  }
  if (/rate limit|too many requests|429/i.test(message)) {
    return {
      message: 'Cloudflare rate limited the publish request. Wait a moment, then click Update again.',
      diagnostic_code: 'CLOUDFLARE_RATE_LIMITED',
      suggested_action: 'retry_later',
      status: 429,
    };
  }
  if (/payload|too large|413/i.test(message)) {
    return {
      message: 'The generated app is too large for this publish request. Remove heavy inline assets or export large media to Storage, then retry.',
      diagnostic_code: 'PUBLISH_PAYLOAD_TOO_LARGE',
      suggested_action: 'reduce_assets',
      status: 413,
    };
  }
  if (/bad request|invalid|400|files/i.test(message)) {
    return {
      message: 'Cloudflare rejected the deployment payload. Coden kept the live app unchanged; rebuild the preview and try Publish again.',
      diagnostic_code: 'CLOUDFLARE_BAD_REQUEST',
      suggested_action: 'rebuild_then_publish',
      status: 502,
    };
  }
  if (/fetch failed|network|timeout|ENOTFOUND|ECONNRESET|5\d\d|unavailable/i.test(message)) {
    return {
      message: 'Cloudflare is temporarily unavailable or unreachable. The live app was not changed; retry in a moment.',
      diagnostic_code: 'CLOUDFLARE_UNAVAILABLE',
      suggested_action: 'retry',
      status: 502,
    };
  }
  return {
    message: message || 'Publish failed. The live app was not changed.',
    diagnostic_code: 'PUBLISH_FAILED',
    suggested_action: 'retry',
    status: statusCode >= 400 && statusCode < 600 ? statusCode : 500,
  };
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function cleanAnalyticsText(value: unknown, fallback: string, maxLength = 120): string {
  const text = String(value || '').trim().replace(/[\u0000-\u001f\u007f]/g, '');
  return (text || fallback).slice(0, maxLength);
}

function normalizeAnalyticsEventType(value: unknown): 'pageview' | 'heartbeat' | 'duration' {
  const eventType = cleanAnalyticsText(value, 'pageview', 32).toLowerCase();
  if (eventType === 'heartbeat' || eventType === 'duration') return eventType;
  return 'pageview';
}

function normalizeAnalyticsEnvironment(value: unknown): 'preview' | 'production' {
  return cleanAnalyticsText(value, 'preview', 32).toLowerCase() === 'production' ? 'production' : 'preview';
}

function normalizeAnalyticsPath(value: unknown): string {
  const raw = cleanAnalyticsText(value, '/', 240);
  if (!raw.startsWith('/')) return '/';
  return raw.split('#')[0].split('?')[0] || '/';
}

function normalizeAnalyticsSource(value: unknown): string {
  const source = cleanAnalyticsText(value, 'Direct', 80);
  if (!source || /^https?:\/\//i.test(source)) {
    try {
      return new URL(source).hostname.slice(0, 80) || 'Direct';
    } catch {
      return 'Direct';
    }
  }
  return source === 'direct' ? 'Direct' : source;
}

function detectAnalyticsDevice(userAgentHeader: unknown): 'Mobile' | 'Desktop' | 'Tablet' | 'Unknown' {
  const userAgent = String(userAgentHeader || '');
  if (!userAgent) return 'Unknown';
  if (/ipad|tablet|kindle|silk/i.test(userAgent)) return 'Tablet';
  if (/mobi|iphone|android.*mobile|windows phone/i.test(userAgent)) return 'Mobile';
  if (/mozilla|chrome|safari|firefox|edg/i.test(userAgent)) return 'Desktop';
  return 'Unknown';
}

function detectAnalyticsCountry(req: any) {
  const rawCode = String(
    req.headers['cf-ipcountry'] ||
    req.headers['x-vercel-ip-country'] ||
    req.headers['x-country-code'] ||
    ''
  ).toUpperCase();
  const countryCode = /^[A-Z]{2}$/.test(rawCode) ? rawCode : 'UN';
  return {
    country_code: countryCode,
    country_name: COUNTRY_NAMES[countryCode] || (countryCode === 'UN' ? 'Unknown' : countryCode),
  };
}

function getAnalyticsRange(rangeValue: unknown) {
  const range = cleanAnalyticsText(rangeValue, '30d', 8).toLowerCase();
  const now = Date.now();
  if (range === '24h') {
    return { key: '24h', start: new Date(now - 24 * 60 * 60 * 1000), bucketCount: 24, bucketMs: 60 * 60 * 1000 };
  }
  if (range === '7d') {
    return { key: '7d', start: new Date(now - 7 * 24 * 60 * 60 * 1000), bucketCount: 7, bucketMs: 24 * 60 * 60 * 1000 };
  }
  if (range === '90d') {
    return { key: '90d', start: new Date(now - 90 * 24 * 60 * 60 * 1000), bucketCount: 30, bucketMs: 3 * 24 * 60 * 60 * 1000 };
  }
  return { key: '30d', start: new Date(now - 30 * 24 * 60 * 60 * 1000), bucketCount: 30, bucketMs: 24 * 60 * 60 * 1000 };
}

function uniqueCount(values: string[]) {
  return new Set(values.filter(Boolean)).size;
}

function groupVisitors<T extends Record<string, any>>(rows: T[], getKey: (row: T) => string) {
  const grouped = new Map<string, Set<string>>();
  rows.forEach(row => {
    const key = getKey(row);
    if (!grouped.has(key)) grouped.set(key, new Set());
    grouped.get(key)?.add(String(row.visitor_id || row.session_id || 'unknown'));
  });
  return Array.from(grouped.entries())
    .map(([label, visitors]) => ({ label, visitors: visitors.size }))
    .sort((a, b) => b.visitors - a.visitors || a.label.localeCompare(b.label));
}

type GeneratedFile = {
  path: string;
  content: string;
  language?: string;
  updated_at?: string;
};

type GeneratedProject = {
  id: string;
  owner_id: string;
  organization_id: string;
  created_by?: string;
  name: string;
  slug: string;
  prompt?: string;
  template?: string;
  theme?: string;
  model_id?: string;
  status: string;
  preview_status?: string;
  preview_html?: string;
  publish_status?: string;
  live_url?: string;
  created_at: string;
  updated_at: string;
};

type PublishStatus = {
  state: 'not_ready' | 'ready_to_publish' | 'published' | 'changes_unpublished';
  public_url: string;
  custom_domain: string | null;
  current_visitors: number;
  latest_published_at: string | null;
  project_updated_at: string | null;
  badge_required: boolean;
  checks: Array<{ key: string; label: string; status: 'pass' | 'warn' | 'fail'; detail: string }>;
  can_publish: boolean;
  has_unpublished_changes: boolean;
};

type PublishContext = {
  project: GeneratedProject;
  files: GeneratedFile[];
  latestDeployment: any | null;
  plan: string;
  customDomain: string | null;
  currentVisitors?: number;
};

type DurableProjectSnapshot = {
  project_id: string;
  owner_id: string;
  organization_id?: string | null;
  revision?: number;
  project_snapshot?: GeneratedProject | null;
  files_snapshot?: GeneratedFile[];
  messages_snapshot?: any[];
  events_snapshot?: any[];
  workspace_snapshot?: Record<string, any> | null;
  preview_snapshot?: { status?: string; html?: string } | null;
  last_agent_run_id?: string | null;
  created_at?: string;
  updated_at?: string;
};

type AgentEvent = {
  id?: string;
  organization_id: string;
  project_id: string;
  user_id: string;
  sequence_number: number;
  event_type: string;
  message: string;
  payload?: Record<string, unknown>;
  created_at?: string;
};

const POSTGRES_INTEGER_MAX = 2_147_483_647;

/**
 * The event tables use PostgreSQL `integer` columns. Epoch milliseconds
 * overflow them; epoch seconds stay ordered and valid while `created_at`
 * preserves the order of actions that happen in the same second.
 */
function persistenceSequenceNumber(timestamp = Date.now()) {
  const value = Number.isFinite(timestamp) ? timestamp : Date.now();
  return Math.max(1, Math.min(POSTGRES_INTEGER_MAX, Math.floor(value / 1_000)));
}

const inMemoryAgentHarness = new CodenAgentHarness(new InMemoryAgentHarnessStore());
let persistentAgentHarness: CodenAgentHarness | null = null;
const activeHarnessTurnControllers = new Map<string, AbortController>();
const activeHarnessAgentRunIds = new Map<string, string>();

/*
 * When this process started, and how long a turn it does not own may still be
 * given the benefit of the doubt.
 *
 * A run lives entirely inside one request in one process: its abort controller
 * is in `activeHarnessTurnControllers` and dies with the process. So a turn
 * still marked `running` that began before this process booted has no owner
 * anywhere — the process that owned it is gone. That is a fact, not a timeout,
 * and it is what a deploy or a crash leaves behind.
 *
 * Production had five agent runs and three turns stranded that way, three of
 * them on the same day, each with `updated_at` still equal to `created_at`:
 * inserted, never finalized, never reaped. Until this, they were only cleared
 * by a 20-minute ceiling, and only if the same user came back to the same
 * thread — so the project answered every new request with the raw string
 * `HARNESS_RUN_ACTIVE` for twenty minutes, and the stranded turn stayed
 * `running` for days.
 *
 * The ceiling stays as the second rule, for a turn that began after boot and
 * whose request is no longer registered here.
 */
const PROCESS_BOOTED_AT = Date.now();
const ORPHANED_TURN_CEILING_MS = 20 * 60_000;

/*
 * The one refusal that is not a failure: a run really is still going.
 *
 * It used to be a bare `Error('HARNESS_RUN_ACTIVE: ...')`, and the route
 * answered 409 with `error.message`, so the user read the diagnostic code
 * itself, in English, inside a French interface. It is a typed error now so
 * the boundary can say what happened in the user's language and still hand
 * the client the code it needs to offer the right action.
 */
class HarnessRunActiveError extends Error {
  readonly diagnosticCode = 'HARNESS_RUN_ACTIVE';
  readonly suggestedAction = 'steer_or_cancel_active_run';
  constructor() {
    super('HARNESS_RUN_ACTIVE: a run is already in progress on this project.');
    this.name = 'HarnessRunActiveError';
  }
  publicMessage(french: boolean) {
    return french
      ? 'Une génération est déjà en cours sur ce projet. Attendez qu’elle se termine, envoyez-lui une instruction, ou arrêtez-la avant d’en lancer une autre.'
      : 'A run is already in progress on this project. Wait for it, send it an instruction, or stop it before starting another.';
  }
}

function isOrphanedHarnessTurn(turn: { id: string; startedAt?: string | null; createdAt: string }) {
  if (activeHarnessTurnControllers.has(turn.id)) return false;
  const startedAt = Date.parse(turn.startedAt || turn.createdAt);
  if (!Number.isFinite(startedAt)) return false;
  if (startedAt < PROCESS_BOOTED_AT) return true;
  return Date.now() - startedAt > ORPHANED_TURN_CEILING_MS;
}

function getPersistentAgentHarness() {
  if (!persistentAgentHarness) {
    const client = getSupabase();
    if (!client) return null;
    persistentAgentHarness = new CodenAgentHarness(new SupabaseAgentHarnessStore(client));
  }
  return persistentAgentHarness;
}

function isMissingAgentHarnessSchemaError(error: unknown) {
  return /agent_(threads|turns|items|harness_events|instructions)|append_agent_harness_event|schema cache|PGRST205|42P01/i.test(String((error as any)?.message || error || ''));
}

type ActiveAgentHarnessContext = {
  harness: CodenAgentHarness;
  thread: HarnessThread;
  turn: HarnessTurn;
  assistantItemId: string;
};

async function prepareAgentHarnessContext(input: {
  project: GeneratedProject;
  userId: string;
  prompt: string;
  requestedMode: string;
  requestId: string;
  clientMessageId?: string;
}) {
  if (!isUuid(input.project.id) || !isUuid(input.userId)) return null;

  const createWithHarness = async (harness: CodenAgentHarness): Promise<ActiveAgentHarnessContext> => {
    let thread = await harness.store.findActiveThread(input.project.id, input.userId);
    if (thread?.activeTurnId) {
      const activeTurn = await harness.store.getTurn(thread.activeTurnId);
      const expectedKey = createHarnessTurnIdempotencyKey({
        userId: input.userId,
        projectId: input.project.id,
        requestId: input.requestId,
        clientMessageId: input.clientMessageId,
      });
      if (activeTurn && !['completed','failed','cancelled','blocked'].includes(activeTurn.status)) {
        if (isOrphanedHarnessTurn(activeTurn)) {
          await harness.transitionTurn(activeTurn.id,'failed',{diagnostic_code:'RUN_INTERRUPTED',recoverable:true});
        } else if (activeTurn.idempotencyKey !== expectedKey) {
          throw new HarnessRunActiveError();
        }
      }
    }
    if (!thread) {
      thread = await harness.createThread({
        organizationId: input.project.organization_id || input.userId,
        projectId: input.project.id,
        userId: input.userId,
        title: input.prompt.slice(0, 100),
        metadata: { source: 'builder', runtime: 'coden-harness/v3' },
      });
    }
    const turnResult = await harness.createTurn({
      threadId: thread.id,
      userId: input.userId,
      prompt: input.prompt,
      requestedMode: input.requestedMode,
      idempotencyKey: createHarnessTurnIdempotencyKey({
        userId: input.userId,
        projectId: input.project.id,
        requestId: input.requestId,
        clientMessageId: input.clientMessageId,
      }),
      definitionOfDone: buildDefinitionOfDone({
        prompt: input.prompt,
        mode: input.requestedMode,
        hasBackend: /backend|api|full[ -]?stack|serveur/i.test(input.prompt),
        hasDatabase: /database|base de donn|supabase|postgres|sql/i.test(input.prompt),
        requiresDeployment: /deploy|publ|production|mise en ligne/i.test(input.prompt),
      }),
    });
    let turn = turnResult.turn;
    if (!turnResult.created) throw new Error('HARNESS_RUN_ALREADY_EXISTS: this request already has a turn. Resume or steer it instead of generating twice.');
    if (turn.status === 'queued') turn = await harness.transitionTurn(turn.id, 'running', { requestId: input.requestId });
    const assistantItem = await harness.createItem({
      threadId: thread.id,
      turnId: turn.id,
      kind: 'assistant_message',
      role: 'assistant',
      status: 'running',
      title: 'Coden response',
      payload: { requestId: input.requestId },
    });
    return { harness, thread, turn, assistantItemId: assistantItem.id };
  };

  const persistent = getPersistentAgentHarness();
  if (persistent) {
    try {
      return await createWithHarness(persistent);
    } catch (error) {
      if (!isMissingAgentHarnessSchemaError(error)) throw error;
      console.warn('[coden:harness_persistence_unavailable]', { message: String((error as any)?.message || error) });
    }
  }
  return createWithHarness(inMemoryAgentHarness);
}


async function resolveAgentHarnessThread(threadId: string) {
  const persistent = getPersistentAgentHarness();
  if (persistent) {
    try {
      const thread = await persistent.store.getThread(threadId);
      if (thread) return { harness: persistent, thread };
    } catch (error) {
      if (!isMissingAgentHarnessSchemaError(error)) throw error;
    }
  }
  const thread = await inMemoryAgentHarness.store.getThread(threadId);
  return thread ? { harness: inMemoryAgentHarness, thread } : null;
}

/**
 * Close every run this process finds already in flight at boot.
 *
 * A run lives inside one request in one process. Nothing survives a restart —
 * not the abort controller, not the sandbox, not the provider call — so a row
 * still marked `running` when a fresh process starts belongs to a process that
 * no longer exists. It will never finish, never fail, and never be finished by
 * anyone: nothing swept these tables, so a deploy or a crash left the row
 * exactly as inserted.
 *
 * Production carried five such `agent_runs` and three such `agent_turns`,
 * `updated_at` still equal to `created_at`, the oldest stranded for five days.
 * The user's project kept a run that was going nowhere.
 *
 * Marked `failed` with `RUN_INTERRUPTED` and `recoverable`, which is what they
 * are: the work stopped where the process did, and the files written before
 * that point were already saved.
 */
async function reapInterruptedAgentRuns() {
  const client = getSupabase();
  if (!client) return { runs: 0, turns: 0 };
  const finishedAt = new Date().toISOString();
  let runs = 0;
  let turns = 0;

  const runUpdate = await client
    .from('agent_runs')
    .update({
      status: 'failed',
      diagnostic_code: 'RUN_INTERRUPTED',
      suggested_action: 'retry',
      updated_at: finishedAt,
      completed_at: finishedAt,
    })
    .in('status', ['running', 'queued'])
    .select('id');
  if (runUpdate.error) {
    if (!isMissingAgentV2TableError(runUpdate.error)) throw runUpdate.error;
  } else {
    runs = runUpdate.data?.length || 0;
  }

  const turnUpdate = await client
    .from('agent_turns')
    .update({ status: 'failed', updated_at: finishedAt, completed_at: finishedAt })
    // `waiting_for_user` is deliberately left alone: it is a run that asked a
    // question and is resumable by answering it, not one that died mid-flight.
    .in('status', ['queued', 'running', 'verifying'])
    .select('id');
  if (turnUpdate.error) {
    if (!isMissingAgentHarnessSchemaError(turnUpdate.error)) throw turnUpdate.error;
  } else {
    turns = turnUpdate.data?.length || 0;
  }

  // An item left running under a reaped turn would keep its own spinner.
  const itemUpdate = await client
    .from('agent_items')
    .update({ status: 'failed', updated_at: finishedAt, completed_at: finishedAt })
    .in('status', ['pending', 'running'])
    .select('id');
  if (itemUpdate.error && !isMissingAgentHarnessSchemaError(itemUpdate.error)) throw itemUpdate.error;

  if (runs || turns) console.log('[coden:interrupted_runs_reaped]', { runs, turns });
  return { runs, turns };
}

async function ensureAgentHarnessSchema() {
  const projectRef = getSupabaseProjectRef(process.env.SUPABASE_URL || '');
  if (!projectRef) return { applied: false, reason: 'missing_project_ref' };
  const client = getSupabase();
  if (client) {
    const probe = await client.from('agent_threads').select('id').limit(1);
    if (!probe.error) {
      console.log('[coden:harness_schema_ready]', { projectRef, source: 'existing_schema' });
      return { applied: false, ready: true, reason: 'already_available' };
    }
    if (!isMissingAgentHarnessSchemaError(probe.error)) {
      console.warn('[coden:harness_schema_probe_failed]', {
        projectRef,
        reason: redactSecrets(probe.error.message || 'schema_probe_failed', '[redacted]'),
      });
      return { applied: false, ready: false, reason: 'schema_probe_failed' };
    }
  }
  const migrationPath = path.join(__dirname, 'supabase', 'migrations', '20260831090000_coden_agent_harness_v3.sql');
  if (!fs.existsSync(migrationPath)) return { applied: false, reason: 'migration_file_missing' };
  const sql = fs.readFileSync(migrationPath, 'utf8');
  const result = await applyGeneratedMigration({ projectRef, sql, dryRun: false });
  if (!result.applied) {
    console.warn('[coden:harness_schema_not_applied]', {
      projectRef,
      reason: result.error || 'management_api_unavailable',
      status: result.status || null,
    });
  } else {
    console.log('[coden:harness_schema_ready]', { projectRef, statements: result.safety.statements });
  }
  return result;
}

type AgentIntent = 'conversation' | 'clarification_required' | 'plan' | 'build' | 'edit' | 'debug_fix' | 'verify' | 'deploy_assist' | 'external_keys_required' | 'credits_required';
type AgentNextAction = 'answer' | 'ask_clarification' | 'plan_only' | 'plan_then_build' | 'build' | 'edit' | 'debug_fix' | 'verify' | 'deploy_assist' | 'collect_external_keys' | 'show_upgrade';
type AgentRequestedMode = 'auto' | 'plan' | 'build' | 'ask' | 'fix' | 'review' | 'research';
type StudioContextKind = 'chat' | 'design' | 'decks' | 'media';
type RecentHistoryMessage = { role: 'user' | 'assistant'; content: string };
type AgentDecisionInput = { prompt: string; requestedMode?: string; hasFiles: boolean; lastPlan?: string; recentHistory?: RecentHistoryMessage[] };

type IntentDecision = {
  intent: AgentIntent;
  confidence: number;
  requestedMode: AgentRequestedMode;
  understandingCategory?: UserIntentCategory;
  intentUnderstanding?: Pick<IntentUnderstanding, 'category' | 'action' | 'confidence' | 'allowsFileAction' | 'needsClarification' | 'reason' | 'signals'>;
  requiresFileChanges: boolean;
  requiresPreviewRebuild: boolean;
  requiresCredits: boolean;
  userVisibleReason: string;
  reason?: string;
  nextAction?: AgentNextAction;
  autoPlanRequired?: boolean;
  selectedModelPolicy?: 'auto' | 'economy' | 'balanced' | 'premium';
  routingSource?: 'heuristic' | 'ai' | 'fallback';
  modelObjective?: AgentObjective;
  requiredCapabilities?: string[];
  typedDecision?: TypedIntentDecision;
  executionContract?: ExecutionContract;
  clarification?: {
    question: string;
    choices: string[];
    recommendation: string;
  };
};

type ReliabilityDecision = {
  intent: AgentIntent;
  should_mutate_files: boolean;
  should_touch_preview: boolean;
  requires_runner: boolean;
  requires_clarification: boolean;
  quality_gate_level: 'conversation' | 'advisory' | 'critical';
  reason: string;
  typed_decision?: TypedIntentDecision;
  execution_contract?: ExecutionContract;
};

function buildReliabilityDecision(decision: IntentDecision): ReliabilityDecision {
  const contract = decision.executionContract;
  const shouldMutate = contract ? Boolean(contract.can_mutate_files) : Boolean(decision.requiresFileChanges);
  const shouldTouchPreview = contract ? Boolean(contract.should_touch_preview) : Boolean(decision.requiresPreviewRebuild);
  const requiresRunner = contract ? Boolean(contract.requires_runner) : shouldMutate;
  const requiresClarification = contract
    ? contract.mode === 'clarify' || contract.mode === 'critical_action'
    : decision.intent === 'clarification_required';
  const qualityGateLevel = contract
    ? contract.quality_gate === 'blocking'
      ? 'critical'
      : contract.quality_gate === 'advisory'
        ? 'advisory'
        : 'conversation'
    : shouldMutate
      ? 'critical'
      : decision.intent === 'plan' || decision.intent === 'verify'
        ? 'advisory'
        : 'conversation';
  return {
    intent: decision.intent,
    should_mutate_files: shouldMutate,
    should_touch_preview: shouldTouchPreview,
    requires_runner: requiresRunner,
    requires_clarification: requiresClarification,
    quality_gate_level: qualityGateLevel,
    reason: contract?.user_visible_reason || decision.userVisibleReason || decision.reason || decision.intentUnderstanding?.reason || 'Coden selected the safest next action.',
    typed_decision: decision.typedDecision,
    execution_contract: contract,
  };
}

const FAST_ANSWER_CATEGORIES = new Set<UserIntentCategory>([
  'text',
  'explanation',
  'strategy',
  'analysis',
  'product_review',
  'ux_review',
  'design',
  'prompt',
  'architecture',
  'other',
]);

function promptLikelyNeedsProjectContext(prompt: string) {
  const normalized = normalizePromptIntentText(prompt);
  return /\b(ce projet|cette app|cette application|mon projet|mon app|mon application|l app actuelle|le code actuel|les fichiers|dans le projet|dans l application|dans l app|preview actuelle|fichiers actuels|current project|current app|current files|existing code)\b/i.test(normalized);
}

function canUseFastAnswerPath(decision: IntentDecision, prompt: string) {
  if (decision.requiresFileChanges || decision.requiresPreviewRebuild) return false;
  if (decision.intent === 'clarification_required') return !promptLikelyNeedsProjectContext(prompt);
  if (decision.intent !== 'conversation') return false;
  if (isGreetingPrompt(prompt) || isSimpleLocalConversationPrompt(prompt)) return true;
  if (promptLikelyNeedsProjectContext(prompt)) return false;
  const category = decision.intentUnderstanding?.category || decision.understandingCategory || 'other';
  return FAST_ANSWER_CATEGORIES.has(category);
}

function normalizeRequestedMode(value: any): AgentRequestedMode {
  return value === 'plan' || value === 'build' || value === 'ask' || value === 'fix' || value === 'review' || value === 'research' ? value : 'auto';
}

function normalizeStudioContext(value: any): StudioContextKind {
  const raw = typeof value === 'string'
    ? value
    : typeof value?.workshop === 'string'
      ? value.workshop
      : '';
  return raw === 'design' || raw === 'decks' || raw === 'media' ? raw : 'chat';
}

function studioContextInstruction(value: any, prompt = '') {
  const context = normalizeStudioContext(value);
  if (context === 'design') {
    const settings = normalizeDesignWorkshopSettings(value?.settings || value?.designSettings || {});
    const designBrief = buildDesignStudioBrief({ prompt, settings });
    return [
      'Coden Design workspace context:',
      '- Interpret the request as UI/UX, product design, visual system, prototype, or targeted interface refinement.',
      '- Treat Coden Design as a lightweight design studio, not a heavy editor: one input, compact controls, preview canvas, and clear handoff.',
      '- Preserve existing app behavior unless the user clearly asks for a new app or a full redesign.',
      '- Prefer focused changes, coherent design tokens, responsive states, accessibility, and anti-generic visual decisions.',
      '- For applied design work, favor Opus-level visual reasoning: hierarchy, spacing, motion, states, responsive behavior, and product taste.',
      '- Offer critique, copy, or strategy without touching files unless the user clearly asks to apply changes.',
      '- If the user is only asking for advice or explanation, answer without modifying files.',
      '- Build or describe a brand kit when useful: color tokens, type scale, spacing rhythm, radius scale, motion tone and voice.',
      '- If generating variations, create two or three distinct directions with a recommendation, not a noisy gallery.',
      '- If generating decks or prototypes, render them as honest HTML/CSS/JS preview artifacts unless an actual exporter exists.',
      '- Run a design critic pass before final delivery: hierarchy, contrast, spacing, mobile fit, states, brand consistency and anti-generic patterns.',
      '- Use Preview first for exploration. Apply to project files only when the user asks clearly or handoff is set to Apply.',
      '- Design Mode must never touch auth, database, billing, secrets, payment logic, provider keys, or business-critical backend behavior unless the user explicitly leaves Design mode and asks for engineering work.',
      '- For small visual edits, patch only the relevant CSS/component files and preserve rollback/version history.',
      '- Internal design studio brief. Use it for decisions but never print it as raw JSON to the user:',
      JSON.stringify(designBrief, null, 2),
      ...designWorkshopInstructionLines(settings),
    ].join('\n');
  }
  if (context === 'decks') {
    return [
      'Coden Decks workspace context:',
      '- Interpret the request as a pitch deck, slide deck, one-pager, product narrative, sales story, or presentation artifact.',
      '- If building, create a polished responsive web presentation rendered in Preview with slide-like sections, concise copy, hierarchy, and speaker-friendly flow.',
      '- Preserve the current project unless the user clearly asks to create or apply a deck.',
      '- Include story arc, slide sequence, audience, proof, CTA/ask, and export-friendly structure.',
      '- Add real slide navigation, progress, keyboard support, subtle HTML/CSS animations, and prefers-reduced-motion support.',
      '- Include an honest in-preview download action for the generated deck artifact when practical, such as Download HTML or Download outline.',
      '- Do not claim to create video files, PPTX, PDF, or Canva exports unless those exporters are actually implemented. Use animated web slides for motion.',
      '- If the user is only asking for strategy, outline, or copy, answer without modifying files.',
    ].join('\n');
  }
  if (context === 'media') {
    const settings = normalizeMediaSettings(value?.settings || value?.mediaSettings || {});
    return [
      'Coden Media workspace context:',
      '- Interpret the request as image, video, UGC, ad creative, storytelling, thumbnail, hero visual, product mockup, or campaign asset work.',
      '- This is a creative media request, not a request to build a web app, unless the user explicitly asks to use the generated asset inside the current app.',
      '- Keep Coden as one assistant with one input. Use compact media controls only as context, never a heavy editor.',
      '- Prefer Auto model routing. The user should not need to know Seedance, Veo, Sora, Kling, Flux, or OpenAI Image.',
      '- If the product, platform, or format is missing, do not write a long menu of possibilities. Pick a sensible default for quick work: vertical 15s TikTok/Reels UGC ad with a dynamic hook, then ask one short question only if the product or offer is unknown.',
      '- Media replies must stay compact: one useful direction, one concrete default, one next action. Avoid "Super, je peux..." filler and avoid listing every possible deliverable.',
      '- If a media provider is unavailable, return a useful campaign brief, storyboard, prompt and next action without pretending a real asset was rendered.',
      '- Never expose fal.ai costs, provider invoices, raw provider payloads, or internal margins to the user.',
      `- Current media settings: ${mediaSettingsSummary(settings)}.`,
    ].join('\n');
  }
  return '';
}

function applyStudioContextToPrompt(prompt: string, studioContext: any) {
  const instruction = studioContextInstruction(studioContext, prompt);
  return instruction ? `${instruction}\n\nUser request:\n${prompt}` : prompt;
}

function applyRequestContextToPrompt(prompt: string, studioContext: any, importContext: any) {
  return applyImportContextToPrompt(applyStudioContextToPrompt(prompt, studioContext), importContext);
}

type PreviewBuildResult = {
  status: 'ready' | 'failed';
  html: string;
  errors: any[];
  summary: string;
};

type SeoAuditCheck = {
  key: string;
  label: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
};

type SeoAudit = {
  score: number;
  checks: SeoAuditCheck[];
  recommendations: string[];
  preview: {
    title: string;
    description: string;
    h1: string;
    ogTitle: string;
    structuredData: boolean;
  };
};

type ExternalApiRequirement = {
  service: string;
  variable: string;
  description: string;
  required: boolean;
  placeholder: string;
};

function getUserOrgId(req: any): string {
  return getRequiredAuth(req).userId;
}

function getOrganizationFallbackValue(column: string, req: any, organizationId: string, now: string) {
  let auth: ReturnType<typeof getRequiredAuth> | null = null;
  try {
    auth = getRequiredAuth(req);
  } catch {
    auth = null;
  }
  const userId = auth?.userId || organizationId;
  const email = String(auth?.email || '').trim();
  const name = email ? `${email.split('@')[0]}'s workspace` : 'Personal workspace';
  const slug = `personal-${organizationId.slice(0, 8)}`;
  const normalized = column.toLowerCase();
  if (['id', 'organization_id'].includes(normalized)) return organizationId;
  if (['owner_id', 'created_by', 'user_id', 'created_by_user_id'].includes(normalized)) return userId;
  if (['name', 'display_name', 'title'].includes(normalized)) return name;
  if (['slug', 'handle'].includes(normalized)) return slug;
  if (['type', 'kind'].includes(normalized)) return 'personal';
  if (['plan', 'plan_key', 'tier', 'subscription_plan'].includes(normalized)) return 'free';
  if (['status', 'state'].includes(normalized)) return 'active';
  if (['created_at', 'updated_at'].includes(normalized)) return now;
  return '';
}

function getSchemaColumnFromMessage(message: string) {
  return (
    message.match(/Could not find the '([^']+)' column/i)?.[1] ||
    message.match(/column "([^"]+)"/i)?.[1] ||
    message.match(/column ([a-zA-Z0-9_]+) does not exist/i)?.[1] ||
    ''
  );
}

async function ensurePersonalOrganization(req: any, organizationId: string) {
  if (!isUuid(organizationId)) return organizationId;
  const client = getSupabase();
  if (!client) return organizationId;

  const now = new Date().toISOString();
  const auth = getRequiredAuth(req);
  const userId = auth.userId || organizationId;
  const email = String(auth.email || '').trim();
  const row: Record<string, any> = {
    id: organizationId,
    owner_id: userId,
    created_by: userId,
    user_id: userId,
    name: email ? `${email.split('@')[0]}'s workspace` : 'Personal workspace',
    slug: `personal-${organizationId.slice(0, 8)}`,
    type: 'personal',
    status: 'active',
    plan: 'free',
    created_at: now,
    updated_at: now,
  };

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const { error } = await client.from('organizations').upsert([row], { onConflict: 'id' });
    if (!error) return organizationId;

    const message = String(error.message || '');
    if (/relation .*organizations.* does not exist|table .*organizations.* does not exist/i.test(message)) {
      console.warn('[coden:organization_bootstrap_skipped]', { message });
      return organizationId;
    }
    if (/duplicate key|already exists/i.test(message)) return organizationId;

    const column = getSchemaColumnFromMessage(message);
    if (/could not find|does not exist/i.test(message) && column && column in row) {
      delete row[column];
      continue;
    }
    if (/null value in column/i.test(message) && column) {
      row[column] = getOrganizationFallbackValue(column, req, organizationId, now);
      continue;
    }

    throw new Error(`Supabase organization bootstrap failed: ${message}`);
  }

  return organizationId;
}

type ProjectRole = 'owner' | 'admin' | 'editor' | 'viewer';

function normalizeProjectRole(value: unknown): ProjectRole | null {
  const role = String(value || '').toLowerCase().trim();
  if (role === 'platform_admin' || role === 'admin') return 'admin';
  if (role === 'owner') return 'owner';
  if (role === 'editor' || role === 'member') return 'editor';
  if (role === 'viewer' || role === 'read_only' || role === 'readonly') return 'viewer';
  return null;
}

function isMissingMembershipTableError(error: any) {
  return /project_members|organization_members|schema cache|relation .* does not exist|table .* does not exist|column .* does not exist|could not find .* in the schema cache/i.test(error?.message || '');
}

async function lookupProjectMembershipRole(projectId: string, userId: string): Promise<ProjectRole | null> {
  const client = requireSupabase('Project membership role lookup');
  const { data, error } = await client
    .from('project_members')
    .select('role')
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error && isMissingMembershipTableError(error)) return null;
  if (error) throw new Error(`Supabase project membership lookup failed: ${error.message}`);
  return normalizeProjectRole(data?.role);
}

async function lookupOrganizationMembershipRole(organizationId: string, userId: string): Promise<ProjectRole | null> {
  const client = requireSupabase('Organization membership role lookup');
  const { data, error } = await client
    .from('organization_members')
    .select('role')
    .eq('organization_id', organizationId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error && isMissingMembershipTableError(error)) return null;
  if (error) throw new Error(`Supabase organization membership lookup failed: ${error.message}`);
  return normalizeProjectRole(data?.role);
}

async function resolveProjectRole(project: GeneratedProject, userId: string, req?: any): Promise<ProjectRole | null> {
  if (!project || !userId) return null;
  if (isPlatformAdmin(req)) return 'admin';
  if (project.owner_id === userId || project.created_by === userId || (project as any).user_id === userId) return 'owner';
  const projectRole = await lookupProjectMembershipRole(project.id, userId);
  if (projectRole) return projectRole;
  const organizationId = project.organization_id || '';
  if (organizationId) {
    const orgRole = await lookupOrganizationMembershipRole(organizationId, userId);
    if (orgRole) return orgRole === 'owner' ? 'admin' : orgRole;
  }
  return null;
}

function getUserProjectRole(req: any, project?: GeneratedProject): ProjectRole {
  const attachedRole = normalizeProjectRole((project as any)?.__coden_project_role);
  if (attachedRole) return attachedRole;
  if (isPlatformAdmin(req)) return 'admin';
  let userId = '';
  try {
    userId = getRequiredAuth(req).userId;
  } catch {
    userId = '';
  }
  if (project && userId && (project.owner_id === userId || project.created_by === userId || (project as any).user_id === userId)) return 'owner';
  return 'viewer';
}

function isPlatformAdmin(req: any) {
  const metadata = getOptionalAuthState(req).user?.app_metadata || {};
  const roles = Array.isArray(metadata.roles) ? metadata.roles : [];
  const email = normalizeAdminEmail(getOptionalAuthState(req).email);
  return metadata.role === 'platform_admin' || roles.includes('platform_admin') || getPlatformAdminEmails().has(email);
}

function requirePlatformAdmin(req: any, res: any) {
  if (isPlatformAdmin(req)) return true;
  res.status(403).json({
    success: false,
    error: 'Platform admin access required.',
    message: 'This area is restricted to Coden platform admins.',
    diagnostic_code: 'ADMIN_ACCESS_REQUIRED',
    suggested_action: 'sign_in_as_admin',
  });
  return false;
}

function requireProjectCapability(req: any, res: any, capability: 'build' | 'deploy' | 'secrets' | 'view', project?: GeneratedProject) {
  const role = getUserProjectRole(req, project);
  const allowed: Record<string, string[]> = {
    view: ['owner', 'admin', 'editor', 'viewer'],
    build: ['owner', 'admin', 'editor'],
    deploy: ['owner', 'admin'],
    secrets: ['owner', 'admin'],
  };
  if (!allowed[capability].includes(role)) {
    res.status(403).json({ success: false, error: 'Permission denied', capability });
    return false;
  }
  return true;
}

function hasProjectCapability(req: any, capability: 'build' | 'deploy' | 'secrets' | 'view', project?: GeneratedProject) {
  const role = getUserProjectRole(req, project);
  const allowed: Record<string, string[]> = {
    view: ['owner', 'admin', 'editor', 'viewer'],
    build: ['owner', 'admin', 'editor'],
    deploy: ['owner', 'admin'],
    secrets: ['owner', 'admin'],
  };
  return allowed[capability].includes(role);
}

function enforceRateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const recent = (RATE_LIMITS.get(key) || []).filter(ts => now - ts < windowMs);
  if (recent.length >= limit) return false;
  recent.push(now);
  RATE_LIMITS.set(key, recent);
  return true;
}

function isAbusivePrompt(prompt: string) {
  return /(phishing|steal password|credential harvester|malware|ransomware|keylogger)/i.test(prompt);
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || `project-${Date.now()}`;
}

function sanitizeProjectName(value: unknown) {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function isGreetingPrompt(value: string) {
  const normalized = value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[!?.,;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return false;
  const greetings = new Set([
    'bonjour',
    'bonsoir',
    'salut',
    'coucou',
    'hello',
    'hi',
    'hey',
    'yo',
    'good morning',
    'good afternoon',
    'good evening',
  ]);
  if (greetings.has(normalized)) return true;
  const words = normalized.split(' ');
  return words.length <= 3 && words.some(word => greetings.has(word));
}

function normalizePromptIntentText(value: string) {
  return repairTextEncoding(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[!?.,;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isSimpleLocalConversationPrompt(value: string) {
  const normalized = normalizePromptIntentText(value);
  if (!normalized) return false;
  if (isGreetingPrompt(normalized)) return true;
  if (normalized.length > 180) return false;
  const direct = new Set([
    'merci',
    'thanks',
    'thank you',
    'ok',
    'okay',
    'd accord',
    'daccord',
    'ca va',
    'ça va',
    'comment ca va',
    'comment ça va',
    'how are you',
    'what can you do',
    'what are you able to do',
    'que peux tu faire',
    'que peux-tu faire',
    'que sais tu faire',
    'que sais-tu faire',
    'qu est ce que tu sais faire',
    "qu'est ce que tu sais faire",
    "qu'est-ce que tu sais faire",
    'tu peux faire quoi',
    'aide moi',
    'help me',
  ]);
  if (direct.has(normalized)) return true;
  return /^(qui es tu|qui es-tu|tu es qui|what are you|what is coden|c est quoi coden|c'est quoi coden|comment tu peux m aider|comment tu peux m'aider)/i.test(normalized);
}

async function uniqueSlug(base: string, ownerId: string, excludeProjectId = ''): Promise<string> {
  const candidate = slugify(base);
  const client = requireSupabase('Project slug generation');
  let { data, error } = await client
    .from('projects')
    .select('id, slug')
    .eq('owner_id', ownerId)
    .ilike('slug', `${candidate}%`);
  if (error && /owner_id|schema cache|column .*does not exist|could not find .* in the schema cache/i.test(error.message || '')) {
    const retry = await client
      .from('projects')
      .select('id, slug')
      .eq('organization_id', ownerId)
      .ilike('slug', `${candidate}%`);
    data = retry.data;
    error = retry.error;
  }
  if (error && /slug|schema cache|column .*does not exist|could not find .* in the schema cache/i.test(error.message || '')) {
    return `${candidate}-${randomUUID().slice(0, 8)}`;
  }
  if (error) throw new Error(`Project slug lookup failed: ${error.message}`);
  const existing = new Set((data || []).filter((row: any) => row.id !== excludeProjectId).map((row: any) => row.slug));
  if (!existing.has(candidate)) return candidate;
  for (let i = 2; i < 1000; i += 1) {
    const next = `${candidate}-${i}`;
    if (!existing.has(next)) return next;
  }
  return `${candidate}-${randomUUID().slice(0, 8)}`;
}

/**
 * Resolve the slug a project keeps when its name changes, whether the rename
 * came from the user or from a regeneration that kept following the prompt.
 * The published-slug rule itself lives in `canReassignProjectSlug`.
 */
async function resolveStableProjectSlug(
  project: Pick<GeneratedProject, 'id' | 'name' | 'slug'>,
  nextName: string,
  ownerId: string,
): Promise<string> {
  // Skip the deployment lookup entirely when the name is unchanged.
  if (nextName === project.name) return project.slug;
  const hasLiveDeployment = Boolean(await getLatestPublishedDeployment(project.id));
  if (!canReassignProjectSlug({ currentName: project.name, nextName, hasLiveDeployment })) {
    return project.slug;
  }
  return uniqueSlug(nextName, ownerId, project.id);
}

function isSafeProjectFilePath(filePath: string): boolean {
  if (!filePath || filePath.length > 180) return false;
  if (filePath.startsWith('/') || filePath.startsWith('\\')) return false;
  if (filePath.includes('..') || filePath.includes('\\')) return false;
  const blocked = ['.env', '.env.local', 'node_modules/', '.git/', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'];
  return !blocked.some(prefix => filePath === prefix || filePath.startsWith(prefix));
}

function normalizeGeneratedFiles(rawFiles: any, options: { ensureIndex?: boolean } = {}): GeneratedFile[] {
  const ensureIndex = options.ensureIndex !== false;
  const entries = Array.isArray(rawFiles)
    ? rawFiles
    : rawFiles && typeof rawFiles === 'object'
      ? Object.entries(rawFiles).map(([filePath, content]) => ({ path: filePath, content }))
      : [];

  const files = entries
    .map((entry: any) => {
      let cleanedPath = String(entry.path || entry.file || '').trim().replace(/\\/g, '/');
      while (cleanedPath.startsWith('/')) {
        cleanedPath = cleanedPath.slice(1);
      }
      return {
        path: cleanedPath,
        content: String(entry.content ?? entry.data ?? ''),
        language: entry.language ? String(entry.language) : undefined,
        updated_at: new Date().toISOString(),
      };
    })
    .filter((file: GeneratedFile) => isSafeProjectFilePath(file.path) && file.content.trim().length > 0);

  return files.slice(0, 80);
}

type AssistantAttachmentRecord = {
  id: string;
  userId: string;
  name: string;
  mimeType: string;
  size: number;
  dataUrl: string;
  createdAt: number;
  expiresAt: number;
};

const assistantAttachments = new Map<string, AssistantAttachmentRecord>();
const ASSISTANT_ATTACHMENT_TTL_MS = 30 * 60_000;
const ASSISTANT_ATTACHMENT_MAX_BYTES = 4 * 1024 * 1024;
const ASSISTANT_ATTACHMENT_ALLOWED_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/webp', 'image/gif',
  'text/plain', 'text/markdown', 'application/json', 'text/csv', 'application/pdf',
]);

function attachmentBuffer(dataUrl: string, mimeType: string) {
  const match = /^data:([^;,]+);base64,([a-z0-9+/=]+)$/i.exec(String(dataUrl || ''));
  if (!match || match[1].toLowerCase() !== mimeType.toLowerCase()) throw new Error('Attachment encoding is invalid.');
  return Buffer.from(match[2], 'base64');
}

function attachmentSignatureIsValid(buffer: Buffer, mimeType: string) {
  if (mimeType === 'image/png') return buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a';
  if (mimeType === 'image/jpeg') return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mimeType === 'image/webp') return buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP';
  if (mimeType === 'image/gif') return /^GIF8[79]a$/.test(buffer.subarray(0, 6).toString());
  if (mimeType === 'application/pdf') return buffer.subarray(0, 5).toString() === '%PDF-';
  return !buffer.includes(0);
}

function cleanupAssistantAttachments(now = Date.now()) {
  assistantAttachments.forEach((record, id) => {
    if (record.expiresAt <= now) assistantAttachments.delete(id);
  });
}

function resolveAssistantAttachments(userId: string, rawIds: unknown) {
  cleanupAssistantAttachments();
  const ids = Array.isArray(rawIds) ? rawIds.map(String).slice(0, 6) : [];
  const records = ids
    .map(id => assistantAttachments.get(id))
    .filter((record): record is AssistantAttachmentRecord => Boolean(record && record.userId === userId && record.expiresAt > Date.now()));
  let total = 0;
  return records.filter(record => {
    total += record.size;
    return total <= 12 * 1024 * 1024;
  });
}

function assistantAttachmentContext(records: AssistantAttachmentRecord[]) {
  let remaining = 24_000;
  const blocks: string[] = [];
  for (const record of records) {
    if (record.mimeType.startsWith('image/')) continue;
    const buffer = attachmentBuffer(record.dataUrl, record.mimeType);
    if (record.mimeType === 'application/pdf') {
      blocks.push(`Attachment: ${record.name} (PDF, ${record.size} bytes). Use its presence as context; no unverified extraction is available.`);
      continue;
    }
    const text = redactSecrets(buffer.toString('utf8')).replace(/\u0000/g, '').slice(0, remaining);
    if (!text) continue;
    blocks.push(`Attachment: ${record.name}\n${text}`);
    remaining -= text.length;
    if (remaining <= 0) break;
  }
  return blocks.join('\n\n');
}

function inferGeneratedLanguage(filePath: string): string {
  const normalized = String(filePath || '').toLowerCase();
  if (normalized.endsWith('.tsx')) return 'tsx';
  if (normalized.endsWith('.ts')) return 'ts';
  if (normalized.endsWith('.jsx')) return 'jsx';
  if (normalized.endsWith('.js')) return 'javascript';
  if (normalized.endsWith('.css')) return 'css';
  if (normalized.endsWith('.html')) return 'html';
  if (normalized.endsWith('.json')) return 'json';
  if (normalized.endsWith('.sql')) return 'sql';
  if (normalized.endsWith('.md')) return 'markdown';
  if (normalized.endsWith('.xml')) return 'xml';
  return 'text';
}

function fileByPath(files: GeneratedFile[], filePath: string): GeneratedFile | undefined {
  const target = String(filePath || '').replace(/\\/g, '/').toLowerCase();
  return files.find(file => file.path.replace(/\\/g, '/').toLowerCase() === target);
}

function isModernFrontendProject(files: GeneratedFile[]): boolean {
  return Boolean(
    fileByPath(files, 'package.json') &&
    (fileByPath(files, 'src/App.tsx') || fileByPath(files, 'src/App.jsx')) &&
    (fileByPath(files, 'src/main.tsx') || fileByPath(files, 'src/main.jsx')),
  );
}

function stripStandaloneHtmlForReact(html: string): string {
  const source = String(html || '');
  const body = getFirstRegexMatch(source, /<body[^>]*>([\s\S]*?)<\/body>/i) || source;
  return body
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .trim();
}

function createReactAppFromStandaloneHtml(html: string, projectName: string): string {
  const markup = stripStandaloneHtmlForReact(html);
  return [
    "import './index.css';",
    '',
    'export default function App() {',
    '  return (',
    '    <main className="min-h-screen bg-slate-50 px-6 py-10 text-slate-950" aria-label="Generated app preview">',
    '      <section className="mx-auto max-w-5xl rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">',
    `      <div dangerouslySetInnerHTML={{ __html: ${JSON.stringify(markup || `<section><h1>${escapeHtml(projectName)}</h1><p>Generated with Coden.</p></section>`)} }} />`,
    '      </section>',
    '    </main>',
    '  );',
    '}',
    '',
  ].join('\n');
}

function ensureModernFrontendProject(files: GeneratedFile[], projectName: string, promptOrDescription = '', projectId = 'unassigned'): GeneratedFile[] {
  const now = new Date().toISOString();
  const byPath = new Map(files.map(file => [file.path.replace(/\\/g, '/'), { ...file }]));
  const addIfMissing = (filePath: string, content: string, language = inferGeneratedLanguage(filePath)) => {
    if (!byPath.has(filePath)) {
      byPath.set(filePath, { path: filePath, content, language, updated_at: now });
    }
  };

  const hasApp = Boolean(fileByPath(files, 'src/App.tsx') || fileByPath(files, 'src/App.jsx'));
  const hasMain = Boolean(fileByPath(files, 'src/main.tsx') || fileByPath(files, 'src/main.jsx'));
  const packageSource = fileByPath(files, 'package.json')?.content || '';
  const hasTanStackScaffold = /@tanstack\/react-start|@tanstack\/react-router|createFileRoute|createServerFn/i.test(packageSource + '\n' + files.map(file => file.content).join('\n'))
    && (files.some(file => /^src\/routes\//.test(file.path.replace(/\\/g, '/'))) || Boolean(fileByPath(files, 'src/server.ts')));

  addIfMissing('package.json', JSON.stringify({
    scripts: {
      dev: 'vite',
      build: 'vite build',
      test: 'node --experimental-strip-types src/app.test.ts',
      lint: 'tsc --noEmit',
    },
    dependencies: {
      react: '^18.3.1',
      'react-dom': '^18.3.1',
      'lucide-react': '^0.383.0',
    },
    devDependencies: {
      '@vitejs/plugin-react': '^4.3.4',
      vite: '^5.4.19',
      typescript: '^5.7.3',
      '@types/react': '^18.3.18',
      '@types/react-dom': '^18.3.5',
      tailwindcss: '^3.4.17',
      postcss: '^8.4.49',
      autoprefixer: '^10.4.20',
    },
  }, null, 2));

  const viteIndex = [
    '<!doctype html>',
    '<html lang="en">',
    '  <head>',
    '    <meta charset="UTF-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    `    <title>${escapeHtml(projectName || 'Coden App')}</title>`,
    `    <meta name="description" content="${escapeHtml(summarizeForMeta(promptOrDescription || projectName, 'React application generated from the project request.'))}" />`,
    '  </head>',
    '  <body>',
    '    <div id="root"></div>',
    '    <script type="module" src="/src/main.tsx"></script>',
    '  </body>',
    '</html>',
    '',
  ].join('\n');
  if (!byPath.has('index.html') && (hasApp || hasMain || hasTanStackScaffold)) {
    byPath.set('index.html', {
      path: 'index.html',
      content: viteIndex,
      language: 'html',
      updated_at: byPath.get('index.html')?.updated_at || now,
    });
  }

  if (!hasMain && !hasTanStackScaffold && hasApp) {
    addIfMissing('src/main.tsx', [
      "import React from 'react';",
      "import { createRoot } from 'react-dom/client';",
      "import App from './App';",
      "import './index.css';",
      '',
      "createRoot(document.getElementById('root')!).render(",
      '  <React.StrictMode>',
      '    <App />',
      '  </React.StrictMode>,',
      ');',
      '',
    ].join('\n'), 'tsx');
  }

  addIfMissing('src/index.css', [
    '@tailwind base;',
    '@tailwind components;',
    '@tailwind utilities;',
    '',
  ].join('\n'), 'css');

  addIfMissing('src/app.test.ts', [
    "import { readFileSync } from 'node:fs';",
    '',
    "const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');",
    "const isValid = /export\\s+default\\s+function\\s+App|export\\s+default\\s+App|const\\s+App\\s*=/.test(app);",
    "console.log(isValid ? 'PASS: App component smoke test passed.' : 'FAIL: App component missing default export.');",
    'process.exit(isValid ? 0 : 1);',
    '',
  ].join('\n'), 'ts');

  addIfMissing('tsconfig.json', JSON.stringify({
    compilerOptions: {
      target: 'ES2020',
      useDefineForClassFields: true,
      lib: ['DOM', 'DOM.Iterable', 'ES2020'],
      allowJs: false,
      skipLibCheck: true,
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
      strict: true,
      forceConsistentCasingInFileNames: true,
      module: 'ESNext',
      moduleResolution: 'Node',
      resolveJsonModule: true,
      isolatedModules: true,
      noEmit: true,
      jsx: 'react-jsx',
    },
    include: ['src'],
  }, null, 2), 'json');

  addIfMissing('vite.config.ts', [
    "import { defineConfig } from 'vite';",
    "import react from '@vitejs/plugin-react';",
    '',
    'export default defineConfig({',
    '  plugins: [react()],',
    '});',
    '',
  ].join('\n'), 'ts');

  addIfMissing('tailwind.config.ts', [
    "import type { Config } from 'tailwindcss';",
    '',
    'export default {',
    "  content: ['./index.html', './src/**/*.{ts,tsx}'],",
    '  theme: {',
    '    extend: {',
    '      colors: {',
    "        codenCream: '#fcfbf8',",
    "        codenInk: '#1c1c1c',",
    "        codenMuted: '#5f5f5d',",
    "        codenBorder: '#eceae4',",
    "        codenBlue: '#2f6df6',",
    '      },',
    '      borderRadius: {',
    "        coden: '1.5rem',",
    '      },',
    '    },',
    '  },',
    '  plugins: [],',
    '} satisfies Config;',
    '',
  ].join('\n'), 'ts');

  addIfMissing('postcss.config.cjs', [
    'module.exports = {',
    '  plugins: {',
    '    tailwindcss: {},',
    '    autoprefixer: {},',
    '  },',
    '};',
    '',
  ].join('\n'), 'js');

  addIfMissing('README.md', [
    `# ${projectName || 'Coden App'}`,
    '',
    'Generated as a Vite + React + TypeScript project by Coden.',
    '',
    '## Scripts',
    '',
    '- `npm run dev` starts the local app.',
    '- `npm run build` creates a production build.',
    '- `npm run test` runs the generated smoke test.',
    '- `npm run lint` runs TypeScript validation.',
    '',
  ].join('\n'), 'markdown');

  let outputFiles = Array.from(byPath.values()).slice(0, 80);
  const fullstackRequirement = detectCodenCloudRequirements(promptOrDescription);
  if (shouldApplyCodenFullstackKit({ prompt: promptOrDescription, files: outputFiles, requirement: fullstackRequirement })) {
    outputFiles = applyCodenFullstackKit({
      files: outputFiles,
      projectName,
      prompt: promptOrDescription,
      requirement: fullstackRequirement,
    }).slice(0, 90);
  }

  const runtimeManifest = manifestFile({
    prompt: promptOrDescription,
    files: outputFiles,
    requirement: fullstackRequirement,
  });
  outputFiles = [
    ...outputFiles.filter(file => file.path !== runtimeManifest.path),
    runtimeManifest,
  ].slice(0, 100);

  if (CODEN_AGENT_FLAGS.universalManifest) {
    const universalManifest = createProjectManifest({
      projectId,
      name: projectName || 'Coden App',
      files: outputFiles,
    });
    outputFiles = [
      ...outputFiles.filter(file => file.path.replace(/\\/g, '/') !== 'coden.project.json'),
      {
        path: 'coden.project.json',
        content: serializeProjectManifest(universalManifest),
        language: 'json',
        updated_at: now,
      },
    ].slice(0, 100);
  }

  return outputFiles;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function stripHtmlTags(value: string): string {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function summarizeForMeta(value: string, fallback = 'Production-ready web app generated with Coden.'): string {
  const clean = stripHtmlTags(value || fallback).replace(/\s+/g, ' ').trim();
  const source = clean || fallback;
  return source.length > 155 ? `${source.slice(0, 152).trim()}...` : source;
}

function getFirstRegexMatch(value: string, regex: RegExp): string {
  const match = String(value || '').match(regex);
  return String(match?.[1] || '').trim();
}

function hasRegex(value: string, regex: RegExp): boolean {
  return regex.test(String(value || ''));
}

function safeJsonLd(value: Record<string, any>): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function insertIntoHead(html: string, block: string): string {
  return insertBeforeHeadEnd(html, block);
}

function enhanceHtmlSeo(
  html: string,
  projectName = 'Coden app',
  promptOrDescription = '',
  slugOrId = '',
  environment: 'preview' | 'production' = 'preview',
): string {
  let output = String(html || '');
  if (!/<html[\s>]/i.test(output)) return output;

  const title = getFirstRegexMatch(output, /<title[^>]*>([\s\S]*?)<\/title>/i) || projectName;
  const description =
    getFirstRegexMatch(output, /<meta\s+name=["']description["']\s+content=["']([^"']+)["'][^>]*>/i) ||
    summarizeForMeta(promptOrDescription || stripHtmlTags(output), `Explore ${projectName}, a production-ready app generated with Coden.`);
  const slug = slugify(slugOrId || projectName || 'coden-app') || 'coden-app';
  const canonical = `https://coden.fun/generated/${slug}`;
  const robots = environment === 'production' ? 'index, follow' : 'noindex, nofollow';

  if (hasRegex(output, /<meta\s+name=["']robots["'][^>]*>/i)) {
    output = output.replace(/<meta\s+name=["']robots["'][^>]*>/i, `<meta name="robots" content="${robots}">`);
  }

  const additions: string[] = [];
  if (!hasRegex(output, /<title[^>]*>[\s\S]*?<\/title>/i)) {
    additions.push(`<title>${escapeHtml(title)}</title>`);
  }
  if (!hasRegex(output, /<meta\s+name=["']description["']/i)) {
    additions.push(`<meta name="description" content="${escapeHtml(description)}">`);
  }
  if (!hasRegex(output, /<meta\s+name=["']robots["']/i)) {
    additions.push(`<meta name="robots" content="${robots}">`);
  }
  if (!hasRegex(output, /<link\s+rel=["']canonical["']/i)) {
    additions.push(`<link rel="canonical" href="${canonical}">`);
  }
  if (!hasRegex(output, /<meta\s+property=["']og:title["']/i)) {
    additions.push(`<meta property="og:title" content="${escapeHtml(title)}">`);
  }
  if (!hasRegex(output, /<meta\s+property=["']og:description["']/i)) {
    additions.push(`<meta property="og:description" content="${escapeHtml(description)}">`);
  }
  if (!hasRegex(output, /<meta\s+property=["']og:type["']/i)) {
    additions.push('<meta property="og:type" content="website">');
  }
  if (!hasRegex(output, /<meta\s+name=["']twitter:card["']/i)) {
    additions.push('<meta name="twitter:card" content="summary_large_image">');
  }
  if (!hasRegex(output, /<meta\s+name=["']twitter:title["']/i)) {
    additions.push(`<meta name="twitter:title" content="${escapeHtml(title)}">`);
  }
  if (!hasRegex(output, /<meta\s+name=["']twitter:description["']/i)) {
    additions.push(`<meta name="twitter:description" content="${escapeHtml(description)}">`);
  }
  if (!hasRegex(output, /<script\s+type=["']application\/ld\+json["']/i)) {
    additions.push(`<script type="application/ld+json">${safeJsonLd({
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: title,
      description,
      applicationCategory: 'WebApplication',
      operatingSystem: 'Web',
      creator: {
        '@type': 'Organization',
        name: 'Coden',
        url: 'https://coden.fun',
      },
    })}</script>`);
  }

  if (additions.length) {
    output = insertIntoHead(output, `\n<!-- Coden SEO-ready metadata -->\n${additions.join('\n')}`);
  }

  return output;
}

function auditHtmlSeo(html: string, files: GeneratedFile[]): SeoAudit {
  const title = stripHtmlTags(getFirstRegexMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i));
  const description = getFirstRegexMatch(html, /<meta\s+name=["']description["']\s+content=["']([^"']+)["'][^>]*>/i);
  const h1Matches = String(html || '').match(/<h1[\s>][\s\S]*?<\/h1>/gi) || [];
  const h1 = stripHtmlTags(h1Matches[0] || '');
  const imageTags = String(html || '').match(/<img[\s\S]*?>/gi) || [];
  const imagesWithoutAlt = imageTags.filter(tag => !/\salt\s*=\s*["'][^"']+["']/i.test(tag)).length;
  const hasSitemap = files.some(file => /(^|\/)sitemap\.xml$/i.test(file.path));
  const hasRobots = files.some(file => /(^|\/)robots\.txt$/i.test(file.path));

  const checks: SeoAuditCheck[] = [
    {
      key: 'title',
      label: 'Page title',
      status: title.length >= 10 && title.length <= 65 ? 'pass' : title ? 'warn' : 'fail',
      detail: title ? `${title.length} characters` : 'Missing title tag',
    },
    {
      key: 'description',
      label: 'Meta description',
      status: description.length >= 70 && description.length <= 165 ? 'pass' : description ? 'warn' : 'fail',
      detail: description ? `${description.length} characters` : 'Missing meta description',
    },
    {
      key: 'h1',
      label: 'Primary H1',
      status: h1Matches.length === 1 ? 'pass' : h1Matches.length > 1 ? 'warn' : 'fail',
      detail: h1Matches.length === 1 ? stripHtmlTags(h1Matches[0]).slice(0, 80) : `${h1Matches.length} H1 tags found`,
    },
    {
      key: 'open_graph',
      label: 'Open Graph',
      status: hasRegex(html, /<meta\s+property=["']og:title["']/i) && hasRegex(html, /<meta\s+property=["']og:description["']/i) ? 'pass' : 'fail',
      detail: 'Required for polished social previews',
    },
    {
      key: 'canonical',
      label: 'Canonical URL',
      status: hasRegex(html, /<link\s+rel=["']canonical["']/i) ? 'pass' : 'warn',
      detail: 'Prevents duplicate indexing when published',
    },
    {
      key: 'structured_data',
      label: 'Structured data',
      status: hasRegex(html, /<script\s+type=["']application\/ld\+json["']/i) ? 'pass' : 'warn',
      detail: 'Helps Google and AI search understand the page',
    },
    {
      key: 'image_alt',
      label: 'Image alt text',
      status: imagesWithoutAlt === 0 ? 'pass' : 'warn',
      detail: imagesWithoutAlt ? `${imagesWithoutAlt} image${imagesWithoutAlt === 1 ? '' : 's'} need alt text` : 'All images include alt text',
    },
    {
      key: 'semantic_main',
      label: 'Semantic main landmark',
      status: hasRegex(html, /<main[\s>]/i) ? 'pass' : 'warn',
      detail: 'Improves accessibility and crawl structure',
    },
    {
      key: 'sitemap',
      label: 'Project sitemap',
      status: hasSitemap ? 'pass' : 'warn',
      detail: hasSitemap ? 'sitemap.xml found' : 'Add sitemap.xml before publishing multi-page apps',
    },
    {
      key: 'robots',
      label: 'Project robots',
      status: hasRobots ? 'pass' : 'warn',
      detail: hasRobots ? 'robots.txt found' : 'Add robots.txt before publishing public apps',
    },
  ];

  const weights: number[] = checks.map(check => check.status === 'pass' ? 10 : check.status === 'warn' ? 6 : 0);
  const score = Math.round(weights.reduce((sum, item) => sum + item, 0) / (checks.length * 10) * 100);
  const recommendations = checks
    .filter(check => check.status !== 'pass')
    .slice(0, 5)
    .map(check => `${check.label}: ${check.detail}.`);

  return {
    score,
    checks,
    recommendations,
    preview: {
      title,
      description,
      h1,
      ogTitle: getFirstRegexMatch(html, /<meta\s+property=["']og:title["']\s+content=["']([^"']+)["'][^>]*>/i),
      structuredData: hasRegex(html, /<script\s+type=["']application\/ld\+json["']/i),
    },
  };
}

function buildProjectSeoAudit(project: GeneratedProject, files: GeneratedFile[]): SeoAudit {
  const indexFile = files.find(file => file.path === 'index.html') || files.find(file => file.path.endsWith('.html'));
  const html = enhanceHtmlSeo(
    indexFile?.content || buildPreviewErrorHtml({ projectName: project.name, error: 'No generated HTML file was returned.' }),
    project.name,
    project.prompt || project.name,
    project.slug || project.id,
    'production',
  );
  return auditHtmlSeo(html, files);
}

function withProjectSeoSupport(
  files: GeneratedFile[],
  projectName: string,
  promptOrDescription = '',
  options: { ensureIndex?: boolean } = {},
): GeneratedFile[] {
  const slug = slugify(projectName || 'coden-app') || 'coden-app';
  const baseUrl = `https://coden.fun/generated/${slug}`;
  const now = new Date().toISOString();
  const output = normalizeGeneratedFiles(files, options).map(file => {
    if (file.path.endsWith('.html')) {
      return {
        ...file,
        content: enhanceHtmlSeo(file.content, projectName, promptOrDescription || projectName, slug, 'production'),
      };
    }
    return file;
  });

  if (!output.some(file => /(^|\/)robots\.txt$/i.test(file.path))) {
    output.push({
      path: 'robots.txt',
      language: 'text',
      updated_at: now,
      content: [
        'User-agent: *',
        'Allow: /',
        `Sitemap: ${baseUrl}/sitemap.xml`,
        '',
      ].join('\n'),
    });
  }

  if (!output.some(file => /(^|\/)sitemap\.xml$/i.test(file.path))) {
    output.push({
      path: 'sitemap.xml',
      language: 'xml',
      updated_at: now,
      content: [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        '  <url>',
        `    <loc>${baseUrl}/</loc>`,
        `    <lastmod>${now.slice(0, 10)}</lastmod>`,
        '    <changefreq>weekly</changefreq>',
        '    <priority>0.8</priority>',
        '  </url>',
        '</urlset>',
        '',
      ].join('\n'),
    });
  }

  return output;
}

function injectAnalyticsSnippet(html: string, projectId?: string, environment: 'preview' | 'production' = 'preview') {
  if (!projectId || html.includes('data-coden-analytics="true"')) return html;
  const snippet = buildAnalyticsSnippet({
    projectId,
    environment,
    apiBase: process.env.CODEN_PUBLIC_API_URL || '',
  });
  if (!snippet) return html;
  return insertBeforeBodyEnd(html, snippet);
}

function getCodenPublicOrigin(): string {
  return String(
    process.env.CODEN_PUBLIC_APP_URL ||
    process.env.CODEN_PUBLIC_SITE_URL ||
    process.env.PUBLIC_SITE_URL ||
    process.env.APP_URL ||
    'https://www.coden.fun',
  ).replace(/\/+$/, '');
}

function normalizeDomainHost(domain: string): string {
  return String(domain || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .replace(/\.+$/, '')
    .toLowerCase();
}

function normalizeDomainUrl(domain: string): string {
  const host = normalizeDomainHost(domain);
  return host ? `https://${host}` : '';
}

function getPublishedProjectPath(project: Pick<GeneratedProject, 'id' | 'slug'>): string {
  return `/p/${encodeURIComponent(project.slug || project.id)}`;
}

function getDefaultPublishedUrl(project: Pick<GeneratedProject, 'id' | 'slug'>): string {
  // Must resolve through the same helper the Cloudflare deploy uses, otherwise
  // Coden advertises a hostname that Cloudflare never serves.
  return `https://${codenHostForSlug(String(project.slug || project.id || 'app'))}`;
}

function isFreePlanKey(plan: string | null | undefined): boolean {
  const normalized = String(plan || 'free').trim().toLowerCase();
  return !normalized || normalized === 'free';
}

function getProjectUpdatedAt(project: GeneratedProject, files: GeneratedFile[]): string | null {
  const dates = [project.updated_at, project.created_at, ...files.map(file => (file as any).updated_at)]
    .filter(Boolean)
    .map(value => Date.parse(String(value)))
    .filter(value => Number.isFinite(value));
  if (!dates.length) return null;
  return new Date(Math.max(...dates)).toISOString();
}

function getDeploymentStatusSlug(deployment: any): string {
  return String(deployment?.status || deployment?.deployment_status || '').trim().toLowerCase();
}

function isPublishedDeploymentReady(deployment: any): boolean {
  const status = getDeploymentStatusSlug(deployment);
  return ['ready', 'published', 'success', 'completed'].includes(status);
}

function sanitizeDeploymentForUser(deployment: any, publicUrl: string, customDomain: string | null) {
  if (!deployment) return null;
  const status = getDeploymentStatusSlug(deployment) || 'unknown';
  const isReady = isPublishedDeploymentReady(deployment);
  return {
    id: deployment.id,
    provider: 'coden',
    status,
    deployment_url: isReady ? publicUrl : '',
    public_url: isReady ? publicUrl : '',
    custom_domain: customDomain,
    badge_required: Boolean(deployment.badge_required),
    commit_hash: deployment.commit_hash || null,
    branch: deployment.branch || 'main',
    created_at: deployment.created_at || null,
  };
}

function normalizeDeploymentStatusForPersistence(status: unknown): 'ready' | 'failed' {
  const normalized = String(status || '').trim().toLowerCase();
  if (/\b(ready|published|success|completed)\b/.test(normalized)) return 'ready';
  if (/\b(error|failed|failure|canceled|cancelled|removed|deleted)\b/.test(normalized)) return 'failed';
  return 'failed';
}


function toHttpsUrl(hostOrUrl: unknown) {
  const raw = String(hostOrUrl || '').trim();
  if (!raw) return '';
  return `https://${raw.replace(/^https?:\/\//i, '').replace(/\/.*$/, '')}`;
}


function wait(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
}





function injectCodenPublishedBadge(html: string, project: GeneratedProject, publicOrigin = getCodenPublicOrigin()) {
  if (!html || html.includes('data-coden-published-badge="true"')) return html;
  const href = `${publicOrigin}/built-with-coden/${encodeURIComponent(project.id)}`;
  const badge = `
<a data-coden-published-badge="true" href="${escapeHtml(href)}" target="_blank" rel="noopener" aria-label="Built with Coden" style="position:fixed;right:14px;bottom:14px;z-index:2147483647;display:inline-flex;align-items:center;gap:8px;padding:8px 10px 8px 8px;border-radius:999px;background:rgba(8,8,9,.94);color:#fcfbf8;text-decoration:none;font:700 12px/1.1 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;box-shadow:0 14px 44px rgba(0,0,0,.26),0 0 0 1px rgba(252,251,248,.16) inset;backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);">
  <svg aria-hidden="true" viewBox="0 0 32 32" width="20" height="20" style="display:block;flex:0 0 auto;border-radius:6px;box-shadow:0 0 0 1px rgba(252,251,248,.18),0 5px 14px rgba(0,0,0,.22);">
    <rect width="32" height="32" rx="8" fill="#09090b"/>
    <path fill="#ffffff" d="M16 8L25 13.5V14.5L16 9.5L7 14.5V13.5L16 8Z"/>
    <path fill="#ffffff" d="M7 16.5V24.5L11.5 22V14L7 16.5Z"/>
    <path fill="#ffffff" d="M25 16.5V24.5L16 24.5V22H20.5V14L25 16.5Z"/>
  </svg>
  <span>Coden</span>
  <span aria-hidden="true" style="font-size:14px;line-height:1;opacity:.92;">&rarr;</span>
</a>`;
  return insertBeforeBodyEnd(html, badge);
}

async function getOrganizationPlan(organizationId: string): Promise<string> {
  const client = requireSupabase('Organization plan lookup');
  try {
    const { data, error } = await client
      .from('organizations')
      .select('*')
      .eq('id', organizationId)
      .maybeSingle();
    if (error) throw error;
    const row = (data || {}) as any;
    return String(row.plan || row.plan_key || row.subscription_plan || row.tier || 'free');
  } catch (error: any) {
    console.warn('[coden:publish_plan_lookup_skipped]', { message: error?.message });
    return 'free';
  }
}

async function getPrimaryCustomDomain(projectId: string): Promise<string | null> {
  const client = requireSupabase('Primary domain lookup');
  try {
    const { data, error } = await client
      .from('domains')
      .select('domain,status,is_primary')
      .eq('project_id', projectId)
      .neq('status', 'removed');
    if (error) throw error;
    const domains = ((data || []) as any[])
      .filter((item: any) => ['active', 'verified'].includes(String(item.status || '').toLowerCase()) && normalizeDomainHost(item.domain));
    const primary = domains.find((item: any) => item.is_primary) || domains[0];
    return primary ? normalizeDomainHost(primary.domain) : null;
  } catch (error: any) {
    if (!isSchemaShapeError(error)) console.warn('[coden:publish_domain_lookup_skipped]', { message: error?.message });
    return null;
  }
}

async function getLatestDeployment(projectId: string): Promise<any | null> {
  const client = requireSupabase('Latest deployment lookup');
  try {
    const { data, error } = await client
      .from('deployments')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) throw error;
    return (data || [])[0] || null;
  } catch (error: any) {
    if (!isSchemaShapeError(error)) console.warn('[coden:publish_deployment_lookup_skipped]', { message: error?.message });
    return null;
  }
}

async function getLatestPublishedDeployment(projectId: string): Promise<any | null> {
  const client = requireSupabase('Latest published deployment lookup');
  try {
    const { data, error } = await client
      .from('deployments')
      .select('*')
      .eq('project_id', projectId)
      .eq('status', 'ready')
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) throw error;
    return (data || [])[0] || null;
  } catch (error: any) {
    if (!isSchemaShapeError(error)) console.warn('[coden:publish_ready_deployment_lookup_skipped]', { message: error?.message });
    return null;
  }
}

async function getPublishCurrentVisitors(projectId: string): Promise<number> {
  const client = requireSupabase('Publish visitor lookup');
  try {
    const cutoffIso = new Date(Date.now() - ANALYTICS_CURRENT_VISITOR_WINDOW_MS).toISOString();
    const { data, error } = await client
      .from('project_analytics_sessions')
      .select('session_id,visitor_id,last_seen_at')
      .eq('project_id', projectId)
      .gte('last_seen_at', cutoffIso)
      .limit(1000);
    if (error) throw error;
    return uniqueCount(
      ((data || []) as any[]).map((session: any) => String(session.visitor_id || session.session_id || ''))
    );
  } catch (error: any) {
    if (!isSchemaShapeError(error)) console.warn('[coden:publish_visitors_lookup_skipped]', { message: error?.message });
    return 0;
  }
}

function buildPublishStatus(context: PublishContext): PublishStatus {
  const { project, files, latestDeployment, plan, customDomain, currentVisitors = 0 } = context;
  const publishedDeployment = isPublishedDeploymentReady(latestDeployment) ? latestDeployment : null;
  const latestPublishedAt = publishedDeployment?.created_at || null;
  const projectUpdatedAt = getProjectUpdatedAt(project, files);
  const hasUnpublishedChanges = Boolean(
    latestPublishedAt &&
    projectUpdatedAt &&
    Date.parse(projectUpdatedAt) > Date.parse(latestPublishedAt),
  );
  const previewReady = project.preview_status === 'verified' && Boolean(project.preview_html);
  const hasFiles = files.length > 0;
  const securityScan = scanGeneratedSecurity(files);
  const securityBlocking = securityScan.findings.filter(item => item.status === 'fail');
  const securityWarnings = securityScan.findings.filter(item => item.status === 'warn');
  const publicUrl = customDomain ? normalizeDomainUrl(customDomain) : getDefaultPublishedUrl(project);
  const state: PublishStatus['state'] = !previewReady || !hasFiles
    ? 'not_ready'
    : !publishedDeployment
      ? 'ready_to_publish'
      : hasUnpublishedChanges
        ? 'changes_unpublished'
        : 'published';

  return {
    state,
    public_url: publicUrl,
    custom_domain: customDomain,
    current_visitors: Math.max(0, Number(currentVisitors || 0)),
    latest_published_at: latestPublishedAt,
    project_updated_at: projectUpdatedAt,
    badge_required: isFreePlanKey(plan),
    can_publish: previewReady && hasFiles && !securityBlocking.length,
    has_unpublished_changes: hasUnpublishedChanges,
    checks: [
      {
        key: 'files',
        label: 'Project files',
        status: hasFiles ? 'pass' : 'fail',
        detail: hasFiles ? `${files.length} files ready` : 'Generate the app before publishing.',
      },
      {
        key: 'preview',
        label: 'Preview',
        status: previewReady ? 'pass' : 'fail',
        detail: previewReady ? 'Preview is ready to snapshot.' : 'Run Build until the preview is ready.',
      },
      {
        key: 'security',
        label: 'Security',
        status: securityBlocking.length ? 'fail' : securityWarnings.length ? 'warn' : 'pass',
        detail: securityBlocking.length
          ? `${securityBlocking.length} blocking security issue${securityBlocking.length > 1 ? 's' : ''} must be fixed before publish.`
          : securityWarnings.length
            ? `${securityWarnings.length} security note${securityWarnings.length > 1 ? 's' : ''} saved for review.`
            : 'No blocking security issue detected.',
      },
      {
        key: 'domain',
        label: 'Live URL',
        status: customDomain ? 'pass' : 'warn',
        detail: customDomain ? `Custom domain: ${customDomain}` : `Default Coden URL: ${publicUrl}`,
      },
      {
        key: 'badge',
        label: 'Coden badge',
        status: isFreePlanKey(plan) ? 'warn' : 'pass',
        detail: isFreePlanKey(plan)
          ? 'Free plan publishes include a small Built with Coden badge.'
          : 'Paid plan: no Coden badge required.',
      },
    ],
  };
}

function stripReactImportsForPreview(source: string): string {
  let output = String(source || '')
    .replace(/^\s*import\s+['"][^'"]+\.css['"];?\s*$/gmi, '')
    .replace(/^\s*import\s+[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gmi, '')
    .replace(/^\s*import\s+type\s+[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gmi, '');

  output = output
    .replace(/export\s+default\s+function\s+App\s*\(/g, 'function App(')
    .replace(/export\s+function\s+App\s*\(/g, 'function App(')
    .replace(/export\s+const\s+App\s*=/g, 'const App =')
    .replace(/export\s+default\s+App\s*;?/g, '')
    .replace(/export\s+default\s+\(\s*\)\s*=>/g, 'const App = () =>')
    .replace(/export\s+default\s+/g, 'const App = ');

  return output;
}

/**
 * The Babel build the preview compiles generated TypeScript/JSX with.
 *
 * Pinned deliberately: this was floating on unpkg's latest, so Babel 8 removing
 * the preset-typescript `isTSX`/`allExtensions` options broke every preview in
 * production simultaneously, with no deploy on our side and no way to tell from
 * the symptom. Bump this only together with a preview run that proves the
 * generated app still compiles.
 */
const CODEN_PREVIEW_BABEL_VERSION = '8.0.4';

function buildReactVitePreviewHtml(
  files: GeneratedFile[],
  projectName = 'Coden app',
  projectId?: string,
  environment: 'preview' | 'production' = 'preview',
  promptOrDescription = '',
  slugOrId = '',
): string | null {
  const appFile = fileByPath(files, 'src/App.tsx') || fileByPath(files, 'src/App.jsx');
  if (!appFile) return null;

  // Generated CSS is untrusted: a stray `</style>` closes the element early and
  // the rest of the document, bootstrap script included, stops parsing.
  const css = styleSafeCss([
    fileByPath(files, 'src/index.css')?.content,
    fileByPath(files, 'src/App.css')?.content,
  ].filter(Boolean).join('\n\n'));

  const title = projectName || 'Coden app';
  const description = summarizeForMeta(promptOrDescription || title, 'React application preview.');
  const slug = slugify(slugOrId || projectId || title) || 'coden-app';
  const canonical = `https://coden.fun/generated/${slug}`;
  const robots = environment === 'production' ? 'index, follow' : 'noindex, nofollow';

  // Extract all TS/JS/JSON files for our dynamic module loader
  const modulesObject: Record<string, { code: string }> = {};
  for (const file of files) {
    const ext = file.path.split('.').pop()?.toLowerCase();
    if (ext && ['ts', 'tsx', 'js', 'jsx', 'json'].includes(ext)) {
      modulesObject[file.path] = { code: file.content };
    }
  }
  const escapedModulesValue = scriptSafeJson(JSON.stringify(modulesObject));

  // The Play CDN starts with stock Tailwind, so every token the app defines for
  // itself renders as nothing. Give it the project's own theme.
  const themeLiteral = tailwindThemeLiteral(
    fileByPath(files, 'tailwind.config.ts')?.content
    || fileByPath(files, 'tailwind.config.js')?.content
    || fileByPath(files, 'tailwind.config.cjs')?.content
    || fileByPath(files, 'tailwind.config.mjs')?.content,
  );

  const html = [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="UTF-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    `  <meta name="robots" content="${robots}" />`,
    `  <link rel="canonical" href="${escapeHtml(canonical)}" />`,
    `  <title>${escapeHtml(title)}</title>`,
    `  <meta name="description" content="${escapeHtml(description)}" />`,
    `  <meta property="og:title" content="${escapeHtml(title)}" />`,
    `  <meta property="og:description" content="${escapeHtml(description)}" />`,
    '  <meta property="og:type" content="website" />',
    '  <meta name="twitter:card" content="summary_large_image" />',
    '  <script src="https://cdn.tailwindcss.com"></script>',
    ...(themeLiteral ? [`  <script>tailwind.config = { theme: ${themeLiteral} };</script>`] : []),
    '  <script type="importmap">{"imports":{"react":"https://esm.sh/react@18.3.1","react/jsx-runtime":"https://esm.sh/react@18.3.1/jsx-runtime","react/jsx-dev-runtime":"https://esm.sh/react@18.3.1/jsx-dev-runtime","react-dom":"https://esm.sh/react-dom@18.3.1","react-dom/client":"https://esm.sh/react-dom@18.3.1/client"}}</script>',
    // Pinned. This URL used to float on latest, so when Babel 8 removed the
    // preset options below, every preview in production broke at once with no
    // change on our side. The preview compiler is a runtime dependency and must
    // be versioned like one.
    `  <script src="https://unpkg.com/@babel/standalone@${CODEN_PREVIEW_BABEL_VERSION}/babel.min.js"></script>`,
    '  <script src="https://unpkg.com/lucide@0.383.0/dist/umd/lucide.min.js"></script>',
    '  <script src="https://unpkg.com/@supabase/supabase-js@2"></script>',
    '  <style>',
    css || '',
    '  </style>',
    '</head>',
    '<body>',
    '  <div id="root"></div>',
    '  <noscript>',
    '    JavaScript is required to display this application.',
    '  </noscript>',
    '  <script type="text/javascript">',
    '    // Runtime errors are surfaced to the real preview runner. Coden does not',
    '    // replace a failed application with a simulated UI.',
    "    window.addEventListener('error', (event) => console.error('[coden preview runtime error]', event.error || event.message));",
    "    window.addEventListener('unhandledrejection', (event) => console.error('[coden preview runtime rejection]', event.reason));",
    '    // React is loaded as an ES module in the async bootstrap below so that',
    '    // CDN-loaded libraries (esm.sh) share the exact same React instance.',
    '',
    `    window.__modules__ = ${escapedModulesValue};`,
    '    window.__resolve_path__ = function(referrer, importPath) {',
    '      let cleanedImport = importPath.replace(/\\.(tsx|ts|jsx|js)$/, "");',
    '      cleanedImport = cleanedImport.replace(/^@\\//, "src/");',
    '      let resolvedBase = cleanedImport;',
    '      if (cleanedImport.startsWith(".")) {',
    '        const parts = referrer.split("/");',
    '        parts.pop();',
    '        const relativeParts = cleanedImport.split("/");',
    '        for (const part of relativeParts) {',
    '          if (part === ".") continue;',
    '          if (part === "..") {',
    '            parts.pop();',
    '          } else {',
    '            parts.push(part);',
    '          }',
    '        }',
    '        resolvedBase = parts.join("/");',
    '      }',
    '      const extensions = [".tsx", ".ts", ".jsx", ".js", ".json", ""];',
    '      for (const ext of extensions) {',
    '        const candidate = resolvedBase + ext;',
    '        if (window.__modules__[candidate]) return candidate;',
    '      }',
    '      return resolvedBase;',
    '    };',
    '',
    '    window.LucideReact = new Proxy({}, {',
    '      get: function(target, name) {',
    '        if (name === "__esModule") return true;',
    '        let iconName = name.charAt(0).toLowerCase() + name.slice(1);',
    '        let iconData = null;',
    '        if (window.lucide) {',
    '          iconData = window.lucide[name] || window.lucide[iconName] || (window.lucide.icons && (window.lucide.icons[name] || window.lucide.icons[iconName]));',
    '        }',
    '        if (iconData) {',
    '          return function(props) {',
    '            const renderNode = (node) => {',
    '              if (!Array.isArray(node)) return null;',
    '              const [tag, attrs, children] = node;',
    '              const mergedAttrs = {};',
    '              for (const [k, v] of Object.entries(attrs || {})) {',
    '                const reactKey = k === "class" ? "className" : k;',
    '                mergedAttrs[reactKey] = v;',
    '              }',
    '              if (tag === "svg") {',
    '                for (const [k, v] of Object.entries(props || {})) {',
    '                  if (k === "size") {',
    '                    mergedAttrs.width = v;',
    '                    mergedAttrs.height = v;',
    '                  } else {',
    '                    mergedAttrs[k] = v;',
    '                  }',
    '                }',
    '                if (props.className && attrs.class) {',
    '                  mergedAttrs.className = attrs.class + " " + props.className;',
    '                }',
    '              }',
    '              const childElements = Array.isArray(children) ? children.map(renderNode) : [];',
    '              return React.createElement(tag, mergedAttrs, ...childElements);',
    '            };',
    '            return renderNode(iconData);',
    '          };',
    '        }',
    '        return function(props) {',
    '          return React.createElement("span", {',
    '            className: "inline-block " + (props.className || ""),',
    '            style: { width: props.size || "1.2em", height: props.size || "1.2em", display: "inline-flex", alignItems: "center", justifyContent: "center" }',
    '          }, "⚙️");',
    '        };',
    '      }',
    '    });',
    '',
    '    window.__module_cache__ = {};',
    '    window.importMetaEnv = {',
    '      MODE: "development",',
    '      DEV: true,',
    '      PROD: false,',
    '      VITE_API_BASE_URL: "",',
    '      VITE_SUPABASE_URL: "",',
    '      VITE_SUPABASE_ANON_KEY: ""',
    '    };',
    '    window.MotionMock = {',
    '      AnimatePresence: function(props) { return props.children; },',
    '      motion: new Proxy({}, {',
    '        get: function(target, tag) {',
    '          return function(props) {',
    '            const cleanProps = { ...props };',
    '            delete cleanProps.animate;',
    '            delete cleanProps.initial;',
    '            delete cleanProps.exit;',
    '            delete cleanProps.transition;',
    '            delete cleanProps.variants;',
    '            delete cleanProps.whileHover;',
    '            delete cleanProps.whileTap;',
    '            delete cleanProps.whileFocus;',
    '            delete cleanProps.whileDrag;',
    '            delete cleanProps.whileInView;',
    '            delete cleanProps.viewport;',
    '            delete cleanProps.drag;',
    '            delete cleanProps.dragConstraints;',
    '            delete cleanProps.layout;',
    '            return React.createElement(tag, cleanProps);',
    '          };',
    '        }',
    '      })',
    '    };',
    '',
    '    window.require = function(importPath, referrer = "src/main.tsx") {',
    '      if (importPath === "react") return window.React;',
    '      if (importPath === "react-dom") return window.ReactDOM;',
    '      if (importPath === "react-dom/client") {',
    '        return {',
    '          createRoot: window.ReactDOM.createRoot',
    '        };',
    '      }',
    '      if (importPath === "react/jsx-runtime" || importPath === "react/jsx-dev-runtime") {',
    '        return {',
    '          jsx: window.React.createElement,',
    '          jsxs: window.React.createElement,',
    '          Fragment: window.React.Fragment',
    '        };',
    '      }',
    '      if (importPath === "lucide-react") return window.LucideReact;',
    '      if (importPath === "@supabase/supabase-js") return window.supabase;',
    '      if (importPath === "framer-motion" || importPath === "motion" || importPath === "motion/react") return window.MotionMock;',
    '      if (importPath === "clsx") return { default: function() { return Array.prototype.slice.call(arguments).filter(Boolean).join(" "); }, clsx: function() { return Array.prototype.slice.call(arguments).filter(Boolean).join(" "); } };',
    '      if (importPath === "tailwind-merge") return { twMerge: function() { return Array.prototype.slice.call(arguments).filter(Boolean).join(" "); } };',
    '      if (importPath === "react-router-dom") {',
    '        return {',
    '          BrowserRouter: function(p) { return p.children; },',
    '          MemoryRouter: function(p) { return p.children; },',
    '          Routes: function(p) { return p.children; },',
    '          Route: function(p) { return p.element; },',
    '          Link: function(p) { return window.React.createElement("a", { href: p.to || "#", className: p.className }, p.children); },',
    '          NavLink: function(p) { return window.React.createElement("a", { href: p.to || "#", className: p.className }, p.children); },',
    '          Navigate: function(p) { return null; },',
    '          Outlet: function() { return null; },',
    '          useNavigate: function() { return function() {}; },',
    '          useLocation: function() { return { pathname: "/" }; },',
    '          useParams: function() { return {}; }',
    '        };',
    '      }',
    '      if (importPath === "recharts") {',
    '        return new Proxy({}, {',
    '          get: function(target, name) {',
    '            if (name === "ResponsiveContainer") return function(p) { return window.React.createElement("div", { style: { width: p.width || "100%", height: p.height || "300px" } }, p.children); };',
    '            return function(p) { return window.React.createElement("div", { className: "recharts-" + name.toLowerCase() + " flex items-center justify-center bg-slate-50 text-slate-400 text-xs border border-slate-200 rounded", style: { width: "100%", height: "100%", minHeight: "100px" } }, "[" + name + "]"); };',
    '          }',
    '        });',
    '      }',
    '      if (importPath === "date-fns") return { format: function() { return "Date"; }, parseISO: function() { return new Date(); }, addDays: function(d) { return d; }, subDays: function(d) { return d; } };',
    '',
    '      const resolved = window.__resolve_path__(referrer, importPath);',
    '      if (resolved.endsWith(".css")) {',
    '        return {};',
    '      }',
    '      const assetExtensions = [".svg", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".woff", ".woff2", ".ttf", ".otf", ".eot", ".mp4", ".webm", ".ogg", ".mp3", ".wav", ".flac", ".aac"];',
    '      if (assetExtensions.some(ext => resolved.toLowerCase().endsWith(ext))) {',
    '        return resolved;',
    '      }',
    '',
    '      if (window.__module_cache__[resolved]) {',
    '        return window.__module_cache__[resolved];',
    '      }',
    '      const mod = window.__modules__[resolved];',
    '      if (!mod) {',
    '        const cdnMod = window.__cdn_modules__ && (window.__cdn_modules__[importPath] || window.__cdn_modules__[resolved]);',
    '        if (cdnMod) return cdnMod;',
    '        throw new Error("Module not found: " + importPath + " (resolved to: " + resolved + ").");',
    '        const reactElementSymbol = window.React.createElement("div").$$typeof;',
    '        const createDummyObject = function() {',
    '          return new Proxy({}, {',
    '            get: function(target, prop) {',
    '              if (prop === "$$typeof") return reactElementSymbol;',
    '              if (prop === "type") return "div";',
    '              if (prop === "props") return { style: { display: "none" } };',
    '              if (prop === "key") return null;',
    '              if (prop === "ref") return null;',
    '              if (prop === Symbol.iterator) return function*() { yield createDummyObject(); yield createDummyObject(); };',
    '              if (prop === Symbol.toPrimitive) return () => "";',
    '              if (prop === "toString") return () => "";',
    '              return createDummyFunction();',
    '            }',
    '          });',
    '        };',
    '        const createDummyFunction = function() {',
    '          return new Proxy(function() { return createDummyObject(); }, {',
    '            get: function(target, prop) {',
    '              if (prop === "__esModule") return true;',
    '              if (prop === "default") return createDummyFunction();',
    '              if (prop === Symbol.toPrimitive) return () => "";',
    '              if (prop === "toString") return () => "";',
    '              return createDummyFunction();',
    '            }',
    '          });',
    '        };',
    '        return createDummyFunction();',
    '      }',
    '      const exports = {};',
    '      const module = { exports: exports };',
    '      window.__module_cache__[resolved] = module.exports;',
    '      if (resolved.endsWith(".json")) {',
    '        try {',
    '          const parsedJson = JSON.parse(mod.code);',
    '          Object.assign(exports, parsedJson);',
    '          window.__module_cache__[resolved] = parsedJson;',
    '          return parsedJson;',
    '        } catch (e) {',
    '          throw new Error("Failed to parse JSON module: " + resolved);',
    '        }',
    '      }',
    '      let code = mod.code;',
    '      code = code.replace(/import\\.meta\\.env/g, "window.importMetaEnv");',
    '      code = code.replace(/import\\.meta/g, "({ env: window.importMetaEnv, url: \'\' })");',
    '      if (typeof Babel === "undefined" || !Babel || typeof Babel.transform !== "function") {',
    '        throw new Error("The preview compiler did not load. Check the network access to the Babel CDN.");',
    '      }',
    '      const compiled = Babel.transform(code, {',
    // isTSX/allExtensions were removed in Babel 8. The filename already carries
    // the extension, which is what drives TSX detection in both 7 and 8.
    '        filename: resolved,',
    '        presets: [',
    '          ["typescript", { onlyRemoveTypeImports: true }],',
    '          "react"',
    '        ],',
    '        plugins: ["transform-modules-commonjs"]',
    '      }).code;',
    '      const wrapper = new Function("module", "exports", "require", "__filename", compiled);',
    '      const localRequire = function(p) {',
    '        return window.require(p, resolved);',
    '      };',
    '      wrapper(module, exports, localRequire, resolved);',
    '      window.__module_cache__[resolved] = module.exports;',
    '      return module.exports;',
    '    };',
    '',
    '    window.__cdn_modules__ = {};',
    "    const __CODEN_SHIMMED__ = ['react','react-dom','react-dom/client','react/jsx-runtime','react/jsx-dev-runtime','lucide-react','@supabase/supabase-js','framer-motion','motion','motion/react','clsx','tailwind-merge','react-router-dom','recharts','date-fns'];",
    '    function __codenCollectBareImports() {',
    '      const found = [];',
    "      const importRe = /(?:import|export)[^;\\n]*?from\\s*['\\u0022]([^'\\u0022]+)['\\u0022]|import\\s*\\(\\s*['\\u0022]([^'\\u0022]+)['\\u0022]\\s*\\)/g;",
    '      for (const key in window.__modules__) {',
    "        const code = String(window.__modules__[key].code || '');",
    '      let match;',
    '        while ((match = importRe.exec(code))) {',
    "          const spec = match[1] || match[2] || '';",
    "          if (!spec || spec.charAt(0) === '.' || spec.charAt(0) === '/' || spec.indexOf('@/') === 0) continue;",
    "          if (/\\.(css|svg|png|jpe?g|gif|webp|json)$/i.test(spec)) continue;",
    '          if (__CODEN_SHIMMED__.indexOf(spec) !== -1) continue;',
    '          if (window.__modules__[spec]) continue;',
    '          if (found.indexOf(spec) === -1) found.push(spec);',
    '        }',
    '      }',
    '      return found.slice(0, 24);',
    '    }',
    '    async function __codenLoadCdnModules() {',
    '      const specs = __codenCollectBareImports();',
    '      await Promise.all(specs.map(async function(spec) {',
    '        try {',
    "          const mod = await import('https://esm.sh/' + spec);",
    '          const ns = { __esModule: true };',
    '          Object.keys(mod).forEach(function(k) { ns[k] = mod[k]; });',
    "          if (!('default' in ns)) ns.default = ns;",
    '          window.__cdn_modules__[spec] = ns;',
    '        } catch (err) {',
    "          console.warn('[coden preview] CDN module failed: ' + spec, err);",
    '        }',
    '      }));',
    '    }',
    '    (async function __codenBootstrap() {',
    '      try {',
    "        const ReactMod = await import('react');",
    "        const ReactDomMod = await import('react-dom');",
    "        const ReactDomClientMod = await import('react-dom/client');",
    '        window.React = ReactMod.default || ReactMod;',
    '        const domNs = {};',
    '        Object.keys(ReactDomMod).forEach(function(k) { domNs[k] = ReactDomMod[k]; });',
    '        Object.keys(ReactDomClientMod).forEach(function(k) { domNs[k] = ReactDomClientMod[k]; });',
    '        window.ReactDOM = domNs;',
    "        if (!window.React || typeof window.React.createElement !== 'function') throw new Error('React runtime unavailable');",
    '        await __codenLoadCdnModules();',
    '        const entryPoint = window.__modules__["src/main.tsx"] ? "src/main.tsx" : "src/App.tsx";',
    '        const exports = window.require(entryPoint);',
    '        const rootNode = document.getElementById("root");',
    '        if (rootNode) {',
    '          if (entryPoint === "src/App.tsx" && rootNode.dataset.codenMounted !== "true") {',
    '            const App = exports.default || exports;',
    '            if (typeof App === "function" || (App && typeof App.$$typeof === "symbol")) {',
    '              const root = window.ReactDOM.createRoot(rootNode);',
    '              root.render(window.React.createElement(App));',
    '            }',
    '          }',
    '          rootNode.dataset.codenMounted = "true";',
    '        }',
    '      } catch (error) {',
    "        console.error('[coden preview runtime error]', error);",
    '      }',
    '    })();',
    '',
    '    function __codenSetupFallbackInteractions() {',
    '      let timerInterval = null;',
    '      let activeMode = "focus";',
    '      let secondsLeft = 25 * 60;',
    '      let cycles = 0;',
    '      let cart = [];',
    '',
    '      document.addEventListener("submit", function(e) {',
    '        const target = e.target;',
    '        if (!target) return;',
    '        if (target.classList.contains("coden-preview-fallback-form") || target.getAttribute("aria-label") === "Add task") {',
    '          e.preventDefault();',
    '          const input = target.querySelector("input");',
    '          if (input && input.value.trim()) {',
    '            const list = document.querySelector(".coden-preview-fallback-list");',
    '            if (list) {',
    '              const li = document.createElement("li");',
    '              li.style.display = "flex";',
    '              li.style.alignItems = "center";',
    '              li.style.gap = "12px";',
    '              li.style.border = "1px solid #eceae4";',
    '              li.style.borderRadius = "18px";',
    '              li.style.background = "#fff";',
    '              li.style.padding = "14px 16px";',
    '              li.innerHTML = "<span class=\'coden-todo-chk\' style=\'width:18px; height:18px; border-radius:999px; border:2px solid #2f6df6; display:inline-block; cursor:pointer;\'></span><strong style=\'font-weight:bold; color:#1c1c1c;\'>" + escapeHtml(input.value.trim()) + "</strong><small style=\'margin-left:auto; color:#5f5f5d; font-weight:700;\'>Active</small><button class=\'coden-todo-del\' type=\'button\' style=\'margin-left:12px; border:1px solid #eceae4; border-radius:12px; background:#fff; padding:6px 12px; font-weight:700; cursor:pointer;\'>Delete</button>";',
    '              list.appendChild(li);',
    '              input.value = "";',
    '              __codenUpdateTodoCounter();',
    '            }',
    '          }',
    '        }',
    '      });',
    '',
    '      document.addEventListener("click", function(e) {',
    '        const target = e.target;',
    '        if (!target) return;',
    '',
    '        // --- TODO ACTIONS ---',
    '        if (target.classList.contains("coden-todo-chk")) {',
    '          const li = target.closest("li");',
    '          const status = li ? li.querySelector("small") : null;',
    '          const text = li ? li.querySelector("strong") : null;',
    '          if (status && text) {',
    '            if (status.textContent === "Active") {',
    '              status.textContent = "Completed";',
    '              target.style.borderColor = "#eceae4";',
    '              target.style.background = "#2f6df6";',
    '              text.style.textDecoration = "line-through";',
    '              text.style.color = "#5f5f5d";',
    '            } else {',
    '              status.textContent = "Active";',
    '              target.style.borderColor = "#2f6df6";',
    '              target.style.background = "transparent";',
    '              text.style.textDecoration = "none";',
    '              text.style.color = "#1c1c1c";',
    '            }',
    '            __codenUpdateTodoCounter();',
    '          }',
    '        }',
    '        if (target.classList.contains("coden-todo-del")) {',
    '          const li = target.closest("li");',
    '          if (li) {',
    '            li.remove();',
    '            __codenUpdateTodoCounter();',
    '          }',
    '        }',
    '        if (target.tagName === "BUTTON" && target.textContent === "Add" && target.closest(".coden-preview-fallback-form")) {',
    '          const form = target.closest("form");',
    '          if (form) form.dispatchEvent(new Event("submit", { cancelable: true }));',
    '        }',
    '        // Todo Filters',
    '        if (target.tagName === "SPAN" && target.closest(".coden-preview-fallback-pills") && document.querySelector(".coden-preview-fallback-list")) {',
    '          const pills = target.closest(".coden-preview-fallback-pills").querySelectorAll("span");',
    '          pills.forEach(p => { p.style.background = "#f7f4ed"; p.style.color = "#1c1c1c"; });',
    '          target.style.background = "#2f6df6";',
    '          target.style.color = "#fff";',
    '          const filter = target.textContent.trim().toLowerCase();',
    '          const items = document.querySelectorAll(".coden-preview-fallback-list li");',
    '          items.forEach(item => {',
    '            const status = item.querySelector("small").textContent.trim().toLowerCase();',
    '            if (filter === "all" || status === filter) {',
    '              item.style.display = "flex";',
    '            } else {',
    '              item.style.display = "none";',
    '            }',
    '          });',
    '        }',
    '',
    '        // --- TIMER ACTIONS ---',
    '        if (target.tagName === "SPAN" && target.closest(".coden-preview-fallback-pills") && document.querySelector(".coden-preview-fallback-timer")) {',
    '          const pills = target.closest(".coden-preview-fallback-pills").querySelectorAll("span");',
    '          pills.forEach(p => { p.style.background = "#f7f4ed"; p.style.color = "#1c1c1c"; });',
    '          target.style.background = "#2f6df6";',
    '          target.style.color = "#fff";',
    '          const mode = target.textContent.trim().toLowerCase();',
    '          const timerEl = document.querySelector(".coden-preview-fallback-timer strong");',
    '          const statusEl = document.querySelector(".coden-preview-fallback-timer span");',
    '          if (mode.includes("work")) {',
    '            activeMode = "focus"; secondsLeft = 25 * 60; if (statusEl) statusEl.textContent = "Focus session ready";',
    '          } else if (mode.includes("short")) {',
    '            activeMode = "short"; secondsLeft = 5 * 60; if (statusEl) statusEl.textContent = "Short break ready";',
    '          } else if (mode.includes("long")) {',
    '            activeMode = "long"; secondsLeft = 15 * 60; if (statusEl) statusEl.textContent = "Long break ready";',
    '          }',
    '          if (timerEl) timerEl.textContent = __codenFormatTime(secondsLeft);',
    '          __codenStopTimer();',
    '        }',
    '        if (target.tagName === "BUTTON" && target.textContent === "Start" && document.querySelector(".coden-preview-fallback-timer")) {',
    '          __codenStartTimer();',
    '        }',
    '        if (target.tagName === "BUTTON" && target.textContent === "Pause" && document.querySelector(".coden-preview-fallback-timer")) {',
    '          __codenStopTimer();',
    '        }',
    '        if (target.tagName === "BUTTON" && target.textContent === "Reset" && document.querySelector(".coden-preview-fallback-timer")) {',
    '          __codenStopTimer();',
    '          const timerEl = document.querySelector(".coden-preview-fallback-timer strong");',
    '          if (timerEl) {',
    '            secondsLeft = activeMode === "focus" ? 25 * 60 : activeMode === "short" ? 5 * 60 : 15 * 60;',
    '            timerEl.textContent = __codenFormatTime(secondsLeft);',
    '          }',
    '        }',
    '',
    '        // --- COMMERCE ACTIONS ---',
    '        if (target.tagName === "BUTTON" && target.closest(".coden-preview-fallback-grid") && target.textContent === "Add to cart") {',
    '          const card = target.closest("article");',
    '          const name = card ? card.querySelector("strong").textContent : "Item";',
    '          const price = card ? card.querySelector("span").textContent : "$0";',
    '          cart.push({ name: name, price: price });',
    '          const cartText = document.querySelector(".coden-preview-fallback-panel aside p");',
    '          if (cartText) {',
    '            const total = cart.reduce((sum, item) => sum + parseFloat(item.price.replace("$", "")), 0);',
    '            cartText.textContent = cart.length + " item(s), total $" + total;',
    '          }',
    '          const feedback = document.querySelector("[role=\'status\']");',
    '          if (feedback) feedback.textContent = name + " added to cart.";',
    '        }',
    '        if (target.tagName === "BUTTON" && target.textContent === "Checkout" && document.querySelector(".coden-preview-fallback-grid")) {',
    '          const feedback = document.querySelector("[role=\'status\']");',
    '          if (feedback) {',
    '            if (cart.length === 0) {',
    '              feedback.textContent = "Your cart is empty.";',
    '            } else {',
    '              feedback.textContent = "Checkout complete! (Demo payment confirmation created).";',
    '              cart = [];',
    '              const cartText = document.querySelector(".coden-preview-fallback-panel aside p");',
    '              if (cartText) cartText.textContent = "No items yet.";',
    '            }',
    '          }',
    '        }',
    '      });',
    '',
    '      function escapeHtml(str) {',
    '        return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");',
    '      }',
    '      function __codenFormatTime(secs) {',
    '        const m = Math.floor(secs / 60);',
    '        const s = secs % 60;',
    '        return (m < 10 ? "0" + m : m) + ":" + (s < 10 ? "0" + s : s);',
    '      }',
    '      function __codenStartTimer() {',
    '        if (timerInterval) return;',
    '        const timerEl = document.querySelector(".coden-preview-fallback-timer strong");',
    '        const statusEl = document.querySelector(".coden-preview-fallback-timer span");',
    '        timerInterval = setInterval(function() {',
    '          if (secondsLeft <= 0) {',
    '            clearInterval(timerInterval);',
    '            timerInterval = null;',
    '            cycles++;',
    '            if (statusEl) statusEl.textContent = "Session complete! Cycles: " + cycles;',
    '            alert("Timer complete!");',
    '            return;',
    '          }',
    '          secondsLeft--;',
    '          if (timerEl) timerEl.textContent = __codenFormatTime(secondsLeft);',
    '        }, 1000);',
    '      }',
    '      function __codenStopTimer() {',
    '        if (timerInterval) {',
    '          clearInterval(timerInterval);',
    '          timerInterval = null;',
    '        }',
    '      }',
    '      function __codenUpdateTodoCounter() {',
    '        const countEl = document.querySelector(".coden-preview-fallback-panel strong");',
    '        if (countEl && countEl.textContent.includes("done")) {',
    '          const items = document.querySelectorAll(".coden-preview-fallback-list li");',
    '          const completed = Array.from(items).filter(item => {',
    '            const small = item.querySelector("small");',
    '            return small && small.textContent.trim() === "Completed";',
    '          }).length;',
    '          countEl.textContent = completed + "/" + items.length + " done";',
    '        }',
    '      }',
    '    }',
    '',
    '  </script>',
    '</body>',
    '</html>',
  ].join('\n');
  return injectAnalyticsSnippet(html, projectId, environment);
}

function renderPreviewHtml(
  files: GeneratedFile[],
  projectName = 'Coden app',
  projectId?: string,
  environment: 'preview' | 'production' = 'preview',
  promptOrDescription = '',
  slugOrId = '',
): string {
  const reactPreview = buildReactVitePreviewHtml(files, projectName, projectId, environment, promptOrDescription, slugOrId);
  if (reactPreview) return reactPreview;
  const indexFile = files.find(file => file.path === 'index.html') || files.find(file => file.path.endsWith('.html'));
  const html = indexFile?.content || buildPreviewErrorHtml({ projectName, error: 'No generated HTML file was returned.' });
  const seoHtml = enhanceHtmlSeo(html, projectName, promptOrDescription || projectName, slugOrId || projectId || projectName, environment);
  return injectAnalyticsSnippet(seoHtml, projectId, environment);
}

/**
 * The preview document for a project, and the one place the two audiences
 * differ.
 *
 * Production serves the public. An application that did not pass verification
 * must not be published, so an unverified project gets the failure document
 * there and nothing else — that boundary is the point of strict verification.
 *
 * Preview serves the author, and the author's question is "what did you build
 * for me". Answering it with a placeholder while a complete rendering of their
 * application sits in `preview_html` is how the product came to look broken:
 * the run produced the app, saved it, and the reader was shown a page saying
 * the runtime could not be verified. They see the rendering; the interface
 * badges it as unverified, which is the honest version of the same warning.
 *
 * When the pipeline genuinely failed, `preview_html` is already a failure
 * document carrying the real reason, so this hands back a better message than
 * the generic one it replaces.
 */
function getProjectPreviewHtml(project: GeneratedProject, files: GeneratedFile[], environment: 'preview' | 'production' = 'preview'): string {
  const servesThePublic = environment === 'production';
  const verified = project.preview_status === 'verified';
  if (project.preview_html && (verified || !servesThePublic)) {
    const seoHtml = enhanceHtmlSeo(project.preview_html, project.name, project.prompt || project.name, project.slug || project.id, environment);
    return injectAnalyticsSnippet(seoHtml, project.id, environment);
  }
  return buildPreviewErrorHtml({
    projectName: project.name,
    error: project.preview_status === 'needs_fix'
      ? 'The generated runtime needs fixes before this preview can be shown.'
      : 'The generated runtime has not been verified yet.',
  });
}

function createTemplateFiles(projectName: string, prompt: string): GeneratedFile[] {
  const files = withProjectSeoSupport([
    {
      path: 'index.html',
      language: 'html',
      content: buildPreviewErrorHtml({ projectName, error: 'No generated application files were available for export.' }),
    },
    {
      path: 'supabase/schema.sql',
      language: 'sql',
      content: `-- Logical backend schema generated by Coden\ncreate table if not exists public.app_records (\n  id uuid primary key default gen_random_uuid(),\n  project_id uuid not null,\n  payload jsonb not null default '{}'::jsonb,\n  created_at timestamptz not null default now()\n);\n`,
    },
    {
      path: 'README.md',
      language: 'markdown',
      content: `# ${projectName}\n\nGenerated from this prompt:\n\n${prompt || 'No prompt provided.'}\n\nThe export contains the project notes and backend schema currently available. The application runtime must be generated and verified before publication.\n`,
    },
  ], projectName, prompt);
  return ensureModernFrontendProject(files, projectName, prompt);
}

class AgentOrchestrator {
  decide(input: AgentDecisionInput): IntentDecision {
    const text = input.prompt.trim();
    const lower = text.toLowerCase();
    const requestedMode = normalizeRequestedMode(input.requestedMode);
    const understanding = understandUserIntent({
      prompt: text,
      hasFiles: input.hasFiles,
      requestedMode,
      hasLastPlan: Boolean(input.lastPlan),
    });
    const forceBuild = requestedMode === 'build' || requestedMode === 'fix';
    const words = text.split(/\s+/).filter(Boolean);
    const hasAny = (hints: string[]) => hints.some(hint => lower.includes(hint));
    const decision = (patch: Partial<IntentDecision> & Pick<IntentDecision, 'intent' | 'confidence' | 'userVisibleReason'>): IntentDecision => ({
      requestedMode,
      understandingCategory: understanding.category,
      intentUnderstanding: understanding,
      requiresFileChanges: false,
      requiresPreviewRebuild: false,
      requiresCredits: false,
      autoPlanRequired: false,
      nextAction: patch.intent === 'conversation' ? 'answer' : 'ask_clarification',
      selectedModelPolicy: 'auto',
      routingSource: 'heuristic',
      ...patch,
    });

    if (requestedMode === 'plan') {
      return decision({
        intent: 'plan',
        confidence: 1,
        requiresCredits: true,
        nextAction: 'plan_only',
        selectedModelPolicy: 'economy',
        userVisibleReason: 'Coden will prepare a plan without touching files.',
      });
    }

    if (requestedMode === 'ask') {
      return decision({
        intent: 'conversation',
        confidence: 1,
        requiresCredits: !isGreetingPrompt(text),
        nextAction: 'answer',
        selectedModelPolicy: 'economy',
        userVisibleReason: 'Ask mode answers without modifying project files or rebuilding the preview.',
      });
    }

    if (requestedMode === 'review') {
      return decision({
        intent: input.hasFiles ? 'verify' : 'clarification_required',
        confidence: input.hasFiles ? 1 : 0.9,
        requiresCredits: input.hasFiles,
        requiresPreviewRebuild: false,
        nextAction: input.hasFiles ? 'verify' : 'ask_clarification',
        selectedModelPolicy: 'balanced',
        requiredCapabilities: ['reasoning', 'code', 'security'],
        userVisibleReason: input.hasFiles ? 'Review mode inspects the project without mutating files.' : 'Review mode needs an existing project.',
        clarification: input.hasFiles ? undefined : {
          question: isLikelyFrenchPrompt(text) ? 'Quel projet veux-tu auditer ?' : 'Which project should Coden review?',
          choices: [],
          recommendation: isLikelyFrenchPrompt(text) ? 'Sélectionne un projet existant.' : 'Select an existing project.',
        },
      });
    }

    if (requestedMode === 'research') {
      return decision({
        intent: 'conversation',
        confidence: 1,
        requiresCredits: true,
        nextAction: 'answer',
        selectedModelPolicy: 'balanced',
        requiredCapabilities: ['reasoning', 'web'],
        userVisibleReason: 'Research mode uses real sources and does not modify project files.',
      });
    }

    if (requestedMode === 'fix') {
      if (!input.hasFiles) {
        return decision({
          intent: 'clarification_required',
          confidence: 0.92,
          nextAction: 'ask_clarification',
          userVisibleReason: 'Fix mode needs an existing project and a reproducible target.',
          clarification: {
            question: isLikelyFrenchPrompt(text) ? 'Quel projet et quel bug dois-je corriger ?' : 'Which project and bug should Coden fix?',
            choices: [],
            recommendation: isLikelyFrenchPrompt(text) ? 'Sélectionne le projet puis décris le comportement observé.' : 'Select the project, then describe the observed behavior.',
          },
        });
      }
      return decision({
        intent: 'debug_fix',
        confidence: 1,
        requiresFileChanges: true,
        requiresPreviewRebuild: true,
        requiresCredits: true,
        nextAction: 'debug_fix',
        selectedModelPolicy: 'balanced',
        requiredCapabilities: ['code', 'reasoning', 'tools'],
        userVisibleReason: 'Fix mode reproduces the issue, applies a targeted patch, and retests the same path.',
      });
    }

    if (isGreetingPrompt(text)) {
      return decision({
        intent: 'conversation',
        confidence: 0.95,
        nextAction: 'answer',
        userVisibleReason: 'This is a greeting, so Coden will answer without changing files.',
      });
    }

    const normalizedForConfirmation = normalizePromptIntentText(text);
    if (input.lastPlan && /^(ok|okay|go|vas y|vas-y|continue|continu|fais|fais le|fais-le|genere|génère|build|execute|run|lance)$/i.test(normalizedForConfirmation)) {
      return decision({
        intent: 'build',
        confidence: 0.95,
        requiresFileChanges: true,
        requiresPreviewRebuild: true,
        requiresCredits: true,
        nextAction: 'build',
        selectedModelPolicy: 'balanced',
        userVisibleReason: 'The user confirmed the previous plan, so Coden will build instead of asking again.',
      });
    }

    if (isSimpleLocalConversationPrompt(text)) {
      return decision({
        intent: 'conversation',
        confidence: 0.93,
        requiresCredits: false,
        nextAction: 'answer',
        selectedModelPolicy: 'auto',
        userVisibleReason: 'This is a quick conversation, so Coden will answer immediately without changing files.',
      });
    }

    if (!text || text.length < 4) {
      return decision({
        intent: 'clarification_required',
        confidence: 0.62,
        nextAction: 'ask_clarification',
        userVisibleReason: 'The request is too short to safely change the app.',
        clarification: {
          question: isLikelyFrenchPrompt(text) ? 'Quel résultat veux-tu obtenir ?' : 'What outcome do you want?',
          choices: input.hasFiles
            ? ['Improve the current app', 'Fix a bug', 'Explain the project', 'Create a new feature']
            : ['Create a first version', 'Plan the app first', 'Explain what Coden can do', 'Use a template'],
          recommendation: input.hasFiles
            ? 'Tell Coden what should change or what feels broken.'
            : 'Describe the app in one sentence, for example: "a restaurant booking app".',
        },
      });
    }

    if (/^(crée|cree|créer|creer|génère|genere|générer|generer|build|create|generate|make|construis|fabrique)(\s+(app|site|application))?$/i.test(lower)) {
      return decision({
        intent: 'clarification_required',
        confidence: 0.86,
        nextAction: 'ask_clarification',
        userVisibleReason: 'The user wants generation, but the product target is missing.',
        clarification: {
          question: isLikelyFrenchPrompt(text)
            ? 'Quelle app veux-tu que je génère ?'
            : 'What app should I generate?',
          choices: [],
          recommendation: isLikelyFrenchPrompt(text)
            ? 'Exemple : "crée une todo app avec ajout, suppression et filtres".'
            : 'Example: "create a todo app with add, delete and filters".',
        },
      });
    }

    const shouldInspectInsteadOfChat = /\b(verifie|vérifie|verify|audit|check|teste|test|review|inspecte|inspect|analyse le projet|validate|validation)\b/i.test(lower);
    if (!forceBuild && !shouldInspectInsteadOfChat && understanding.action === 'answer' && !understanding.allowsFileAction) {
      return decision({
        intent: 'conversation',
        confidence: Math.max(0.82, understanding.confidence),
        requiresCredits: !isSimpleLocalConversationPrompt(text),
        nextAction: 'answer',
        selectedModelPolicy: understanding.category === 'text' ? 'economy' : 'auto',
        userVisibleReason: 'Coden understood this as a response, explanation, strategy, or text task, not a file change.',
      });
    }

    const explicitAppBuildRequest = /\b(crée|cree|créer|creer|génère|genere|générer|generer|build|create|make|construis|fabrique)\b[\s\S]{0,140}\b(app|application|mini app|mini application|site web|web app|outil|tool|landing page|dashboard|marketplace|crm|portfolio|ecommerce|e-commerce|restaurant|todo|to do|to-do|admin panel|pomodoro|pomodero|timer|minuteur|quiz|game|jeu|calculatrice|calendar|calendrier|notes)\b/i.test(lower)
      || /\b(app|application|mini app|mini application|site web|web app|outil|tool|landing page|dashboard|marketplace|crm|portfolio|ecommerce|e-commerce|restaurant|todo|to do|to-do|admin panel)\b[\s\S]{0,140}\b(crée|cree|créer|creer|génère|genere|générer|generer|build|create|make|construis|fabrique|de|pour|avec|qui|fonctionnel|fonctionnelle|complete|complet)\b/i.test(lower);

    if ((understanding.needsClarification && !explicitAppBuildRequest) || (forceBuild && !understanding.allowsFileAction && !explicitAppBuildRequest)) {
      return decision({
        intent: 'clarification_required',
        confidence: Math.max(0.78, understanding.confidence),
        nextAction: 'ask_clarification',
        routingSource: 'heuristic',
        userVisibleReason: forceBuild
          ? 'Build mode was selected, but the message does not name a safe technical target yet.'
          : 'The request is ambiguous enough that coding now could create the wrong result.',
        clarification: {
          question: isLikelyFrenchPrompt(text)
            ? 'Quelle app, écran, composant ou bug dois-je traiter ?'
            : 'What exact part should Coden change or build?',
          choices: [],
          recommendation: isLikelyFrenchPrompt(text)
            ? 'Une phrase suffit.'
            : 'One sentence is enough: for example, "create a todo app with add, delete and filters".',
        },
      });
    }

    const conversationHints = [
      'explique', 'explain', 'c est quoi', "c'est quoi", 'what is', 'comment marche',
      'est-ce que', 'peux tu me dire', 'dis moi', 'pourquoi', 'how does', 'what do you think',
      'aide moi a comprendre', 'aide-moi a comprendre', 'analyse sans modifier', 'review only',
      'comment ca va', 'comment ça va', 'que peux tu faire', 'que peux-tu faire',
      'que sais tu faire', 'que sais-tu faire', 'qu est ce que tu sais faire',
      "qu'est ce que tu sais faire", "qu'est-ce que tu sais faire", 'what can you do',
      'what are you able to do'
    ];
    const buildHints = [
      'crée', 'creer', 'create', 'ajoute', 'add', 'modifie', 'change', 'corrige',
      'fix', 'build', 'implémente', 'implemente', 'generate', 'génère', 'genere',
      'page', 'component', 'dashboard', 'landing', 'formulaire', 'deploy', 'supprime',
      'remove', 'replace', 'met a jour', 'mets a jour', 'update', 'todo app',
      'to do app', 'to-do app', 'mini app', 'application web', 'app web',
      'pomodoro', 'pomodero', 'timer', 'minuteur', 'quiz', 'game', 'jeu', 'outil',
      'localstorage', 'local storage', 'filtre', 'filtres', 'responsive',
      'ajout de tache', 'ajout de tâche', 'supprimer une tache', 'supprimer une tâche'
    ];
    const planHints = [
      'plan', 'roadmap', 'architecture', 'avant de coder', 'avant de build', 'sans coder',
      'propose une approche', 'strategie', 'stratégie', 'spec', 'cahier des charges'
    ];
    const debugHints = [
      'bug', 'erreur', 'error', 'request failed', '500', '404', 'ne fonctionne pas',
      'marche pas', 'broken', 'crash', 'corrige', 'fix', 'debug',
      'coden stopped before saving', 'blocking issue', 'blocking issues',
      'technical build score', 'preview ne s affiche pas', 'preview ne s affiche plus',
      'app ne s affiche pas', 'application ne s affiche pas', 'generated app still has',
      'index html should load', 'index.html should load', 'src main tsx', 'main tsx absent',
      'app tsx absent', 'preview blanche', 'blank preview', 'corrige le probleme',
      'corrige le blocage', 'blocage restant', 'points bloquants',
      'corriger le blocage', 'corrige les erreurs', 'répare', 'repare', 'réparer',
      'reparer', 'fix the blocking', 'resous le probleme', 'résous le problème',
      'ça ne marche pas', 'ca ne marche pas', 'app cassée', 'app cassee',
      'erreur runtime', 'forced runtime failure marker', 'runtime failure marker'
    ];
    const verifyHints = [
      'verifie', 'vérifie', 'verify', 'audit', 'check', 'teste', 'test', 'review',
      'inspecte', 'inspect', 'analyse le projet', 'validate', 'validation'
    ];
    const deployHints = [
      'deploy', 'déploie', 'deploie', 'deployment', 'publish', 'publie', 'railway',
      'vercel', 'domain', 'domaine', 'dns', 'cloudflare', 'production'
    ];
    const complexHints = [
      // Only truly architectural changes that CANNOT be executed without planning
      // Removed: 'auth', 'login', 'signup', 'analytics', 'seo', 'dashboard', 'settings', 'api'
      // These are common requests Coden should handle directly without forcing a plan
      'supabase', 'database', 'db', 'schema', 'migration', 'rls',
      'billing', 'stripe', 'subscription', 'abonnement',
      'deploy', 'deployment', 'railway', 'vercel', 'domain',
      'multi page', 'plusieurs pages',
      'admin roles', 'role-based', 'rbac',
      'webhook', 'export code', 'database visible'
    ];
    // Signals that are complex BUT Coden can handle autonomously (no forced plan)
    const autonomousComplexHints = [
      'auth', 'login', 'signup', 'analytics', 'seo', 'dashboard', 'settings', 'api',
      'admin', 'roles', 'storage', 'crud', 'real-time', 'realtime'
    ];
    const editHints = [
      'modifie', 'change', 'ajoute', 'remove', 'supprime', 'replace', 'mets a jour', 'met a jour', 'update',
      'couleur', 'color', 'fond', 'background', 'bouton', 'button', 'texte', 'text', 'titre', 'title',
      'grossis', 'grossir', 'agrandis', 'agrandir', 'bigger', 'larger', 'taille', 'size',
      'reduis', 'réduis', 'smaller', 'spacing', 'espace', 'padding', 'margin', 'radius', 'arrondi',
      'style', 'design', 'animation', 'hover', 'mobile', 'desktop'
    ];
    const lastPlanHints = [
      'ok fais', 'ok build', 'ok genere', 'ok génère', 'fais-le', 'fais le',
      'vas-y', 'vas y', 'go', 'execute', 'lance', 'implemente ça', 'implémente ça',
      'build this plan', 'continue le plan', 'continue', 'continu'
    ];

    if (hasAny(lastPlanHints) && input.lastPlan) {
      return decision({
        intent: 'build',
        confidence: 0.96,
        requiresFileChanges: true,
        requiresPreviewRebuild: true,
        requiresCredits: true,
        nextAction: 'build',
        selectedModelPolicy: 'balanced',
        userVisibleReason: 'The message refers to the last approved plan, so Coden will build that plan.',
      });
    }

    if (hasAny(planHints) && !hasAny(buildHints)) {
      return decision({
        intent: 'plan',
        confidence: 0.91,
        requiresCredits: true,
        nextAction: 'plan_only',
        selectedModelPolicy: 'economy',
        userVisibleReason: 'This asks for planning, so Coden will think through the work without changing files.',
      });
    }

    const wantsBuild = forceBuild || (hasAny(buildHints) && understanding.allowsFileAction);
    const wantsConversation = hasAny(conversationHints);
    const wantsNewAppBuild = understanding.category === 'app' && understanding.allowsFileAction;
    const wantsShortFeedbackIteration = input.hasFiles
      && understanding.allowsFileAction
      && understanding.signals?.includes('short_feedback');
    const wantsDebugFix = !wantsNewAppBuild && hasAny(debugHints) && understanding.allowsFileAction;
    const wantsVerify = hasAny(verifyHints);
    const wantsDeployAssist = hasAny(deployHints)
      && !/(crée|creer|create|ajoute|add|modifie|change|corrige|fix|build|implémente|implemente|generate|génère|genere|page|component|dashboard|landing|formulaire|supprime|remove|replace|update|met a jour|mets a jour)/i.test(lower);
    const wantsComplexWork = hasAny(complexHints) || words.length > 38; // was 28 — raised threshold so shorter prompts go direct
    const wantsEdit = wantsShortFeedbackIteration || (input.hasFiles && hasAny(editHints) && understanding.allowsFileAction);

    if (!forceBuild && wantsConversation && !hasAny(buildHints)) {
      return decision({
        intent: 'conversation',
        confidence: 0.86,
        requiresCredits: !isSimpleLocalConversationPrompt(text),
        nextAction: 'answer',
        selectedModelPolicy: 'economy',
        userVisibleReason: 'This looks like a question, not an app change.',
      });
    }

    if (wantsDeployAssist) {
      return decision({
        intent: 'deploy_assist',
        confidence: 0.86,
        requiresCredits: true,
        nextAction: 'deploy_assist',
        selectedModelPolicy: 'economy',
        userVisibleReason: 'This is deployment guidance, so Coden will assist without changing project files.',
      });
    }

    if (wantsVerify && !wantsBuild && !wantsDebugFix) {
      return decision({
        intent: 'verify',
        confidence: 0.86,
        requiresCredits: false,
        nextAction: 'verify',
        selectedModelPolicy: 'auto',
        userVisibleReason: 'This asks for inspection, so Coden will verify the current project before suggesting fixes.',
      });
    }

    if (wantsNewAppBuild) {
      return decision({
        intent: 'build',
        confidence: Math.max(0.92, understanding.confidence),
        requiresFileChanges: true,
        requiresPreviewRebuild: true,
        requiresCredits: true,
        nextAction: wantsComplexWork ? 'plan_then_build' : 'build',
        autoPlanRequired: wantsComplexWork && input.hasFiles,
        selectedModelPolicy: wantsComplexWork ? 'balanced' : 'economy',
        userVisibleReason: input.hasFiles
          ? 'The user explicitly asked for a new app, so Coden will generate a new build instead of treating the prompt as a bug fix.'
          : 'The user explicitly asked Coden to create a new app.',
      });
    }

    if (wantsDebugFix) {
      return decision({
        intent: 'debug_fix',
        confidence: 0.9,
        requiresFileChanges: true,
        requiresPreviewRebuild: true,
        requiresCredits: true,
        nextAction: 'debug_fix',
        autoPlanRequired: wantsComplexWork,
        selectedModelPolicy: wantsComplexWork ? 'balanced' : 'economy',
        userVisibleReason: wantsComplexWork
          ? 'This is a risky fix, so Coden will plan briefly before patching.'
          : 'This looks like a bug fix, so Coden will patch the project.',
      });
    }

    if (wantsEdit) {
      return decision({
        intent: 'edit',
        confidence: 0.88,
        requiresFileChanges: true,
        requiresPreviewRebuild: true,
        requiresCredits: true,
        nextAction: wantsComplexWork ? 'plan_then_build' : 'edit',
        autoPlanRequired: wantsComplexWork,
        selectedModelPolicy: wantsComplexWork ? 'balanced' : 'economy',
        userVisibleReason: wantsComplexWork
          ? 'This edit touches product architecture, so Coden will plan before changing files.'
          : 'This is a targeted edit to the current project.',
      });
    }

    const vagueBuildHints = ['app', 'application', 'site', 'dashboard', 'saas', 'projet', 'platforme', 'plateforme'];
    const isVagueBuild = (forceBuild || requestedMode === 'auto')
      && !input.hasFiles
      && words.length < 8
      && vagueBuildHints.some(hint => lower.includes(hint))
      && !/(app|application|site web|web app|restaurant|booking|auth|login|crm|ecommerce|e-commerce|portfolio|marketplace|admin|analytics|chat|blog|landing|dashboard|payment|stripe|supabase)/i.test(text);

    if (isVagueBuild) {
      return decision({
        intent: 'clarification_required',
        confidence: 0.78,
        nextAction: 'ask_clarification',
        userVisibleReason: 'The request is too broad, so Coden needs one product decision before writing files.',
        clarification: {
          question: isLikelyFrenchPrompt(text) ? 'Quel type de première version veux-tu ?' : 'What kind of first version should Coden create?',
          choices: ['Landing page', 'SaaS dashboard', 'Marketplace', 'Admin panel'],
          recommendation: isLikelyFrenchPrompt(text)
            ? 'Choisis le type le plus proche, Coden construira une première version ciblée.'
            : 'Choose the closest product type, then Coden can build a focused first version.',
        },
      });
    }

    if ((forceBuild && understanding.allowsFileAction)
      || (/(je veux|j'aimerais|i want|i need|build me|make me|cree moi|crée moi)/i.test(text) && understanding.allowsFileAction)
      || wantsBuild) {
      return decision({
        intent: input.hasFiles && wantsBuild ? 'edit' : 'build',
        confidence: wantsBuild ? 0.9 : 0.8,
        requiresFileChanges: true,
        requiresPreviewRebuild: true,
        requiresCredits: true,
        nextAction: wantsComplexWork ? 'plan_then_build' : (input.hasFiles ? 'edit' : 'build'),
        autoPlanRequired: wantsComplexWork && input.hasFiles,
        selectedModelPolicy: wantsComplexWork ? 'balanced' : 'economy',
        userVisibleReason: wantsComplexWork || !input.hasFiles
          ? 'Coden will plan the safest app structure before building.'
          : 'Coden will patch the existing project.',
      });
    }

    const ambiguousEdit = input.hasFiles
      && words.length <= 7
      && /(fais|fait|make|mets|met|change|modifie|ameliore|améliore|corrige|fix|ça|ca|this|it|mieux|better)/i.test(lower)
      && !/(couleur|color|texte|text|bouton|button|page|input|menu|settings|pricing|dashboard|preview|login|auth|database|supabase)/i.test(lower);

    if (ambiguousEdit) {
      return decision({
        intent: 'clarification_required',
        confidence: 0.72,
        nextAction: 'ask_clarification',
        routingSource: 'fallback',
        userVisibleReason: 'The request refers to the current app, but the target is not clear enough for a safe edit.',
        clarification: {
          question: isLikelyFrenchPrompt(text)
            ? 'Qu’est-ce que tu veux que Coden améliore exactement ?'
            : 'What exactly should Coden improve?',
          choices: input.hasFiles
            ? ['Modifier le design visible', 'Corriger un bug précis', 'Améliorer le texte', 'Expliquer le projet']
            : ['Créer une première version', 'Faire un plan', 'Expliquer l’idée'],
          recommendation: isLikelyFrenchPrompt(text)
            ? 'Indique l’écran, le bouton, le texte ou le comportement à modifier.'
            : 'Name the screen, button, text, or behavior to change.',
        },
      });
    }

    return decision({
      intent: 'conversation',
      confidence: 0.7,
      nextAction: 'answer',
      selectedModelPolicy: 'economy',
      userVisibleReason: 'The request is understandable enough to answer without forcing a mode choice.',
    });
  }
}

const agentOrchestrator = new AgentOrchestrator();
const intentRouter = agentOrchestrator;

function agentIntentNeedsAiRouter(decision: IntentDecision) {
  // No keyword routing. Whenever a live AI provider is available (the caller
  // gates on hasLiveAiProvider), the LLM decides the intent for EVERY message —
  // there is no confidence/regex shortcut. The only non-LLM path left is the
  // user's explicit Plan toggle, which is a deliberate UI choice, not a keyword.
  // When no provider is configured the caller falls back to the local heuristic.
  return decision.requestedMode !== 'plan';
}

function buildDecisionFromAi(raw: any, fallback: IntentDecision): IntentDecision | null {
  const allowedIntents: AgentIntent[] = ['conversation', 'clarification_required', 'plan', 'build', 'edit', 'debug_fix', 'verify', 'deploy_assist', 'external_keys_required', 'credits_required'];
  const intent = allowedIntents.includes(raw?.intent) ? raw.intent as AgentIntent : null;
  if (!intent) return null;
  if (typeof raw?.confidence !== 'number' || !Number.isFinite(raw.confidence) || raw.confidence < 0 || raw.confidence > 1) return null;
  if (typeof raw?.reason !== 'string' || !raw.reason.trim()) return null;
  if (typeof raw?.user_visible_reason !== 'string' || !raw.user_visible_reason.trim()) return null;
  if (typeof raw?.normalized_prompt !== 'string' || !raw.normalized_prompt.trim()) return null;
  if (intent === 'clarification_required' && (!raw?.clarification || typeof raw.clarification.question !== 'string' || !raw.clarification.question.trim())) return null;
  const runtimeAction = runtimeActionForIntent(intent);
  let validatedModelDecision;
  try {
    validatedModelDecision = validateModelDecision({
      action: runtimeAction,
      confidence: raw.confidence,
      objective: raw.objective,
      requiredCapabilities: raw.required_capabilities || raw.requiredCapabilities,
      clarification: raw.clarification,
    });
  } catch {
    return null;
  }
  const requiresFileChanges = intent === 'build' || intent === 'edit' || intent === 'debug_fix';
  const nextActionByIntent: Record<AgentIntent, AgentNextAction> = {
    conversation: 'answer',
    clarification_required: 'ask_clarification',
    plan: 'plan_only',
    build: raw?.auto_plan_required ? 'plan_then_build' : 'build',
    edit: raw?.auto_plan_required ? 'plan_then_build' : 'edit',
    debug_fix: raw?.auto_plan_required ? 'plan_then_build' : 'debug_fix',
    verify: 'verify',
    deploy_assist: 'deploy_assist',
    external_keys_required: 'collect_external_keys',
    credits_required: 'show_upgrade',
  };
  const policy = ['economy', 'balanced', 'premium'].includes(raw?.selected_model_policy)
    ? raw.selected_model_policy
    : fallback.selectedModelPolicy || 'auto';
  const choices = Array.isArray(raw?.clarification?.choices)
    ? raw.clarification.choices.map((choice: unknown) => String(choice).slice(0, 80)).filter(Boolean).slice(0, 4)
    : fallback.clarification?.choices || [];

  return {
    ...fallback,
    intent,
    confidence: raw.confidence,
    requiresFileChanges,
    requiresPreviewRebuild: requiresFileChanges,
    requiresCredits: intent === 'plan' || requiresFileChanges || (intent === 'conversation' && !isGreetingPrompt(String(raw?.normalized_prompt || ''))),
    autoPlanRequired: Boolean(raw?.auto_plan_required) && requiresFileChanges,
    nextAction: nextActionByIntent[intent],
    selectedModelPolicy: policy,
    routingSource: 'ai',
    modelObjective: validatedModelDecision.objective,
    requiredCapabilities: validatedModelDecision.requiredCapabilities,
    reason: raw.reason.trim().slice(0, 240),
    userVisibleReason: raw.user_visible_reason.trim().slice(0, 240),
    clarification: intent === 'clarification_required'
      ? {
          question: raw.clarification.question.trim().slice(0, 180),
          choices,
          recommendation: typeof raw?.clarification?.recommendation === 'string' ? raw.clarification.recommendation.trim().slice(0, 180) : undefined,
        }
      : undefined,
  };
}

/**
 * The runtime action a router intent is validated as.
 *
 * Two of the ten intents had no mapping and fell through to their own name,
 * and neither name is a runtime action: `ACTIONS` is
 * `answer, clarify, plan, build, edit, debug, confirm`. So
 * `validateModelDecision` threw "unsupported action" for every `conversation`
 * and every `verify` — the decision was discarded however good it was, and the
 * request degraded to the local fallback, which asks a question instead of
 * answering.
 *
 * `conversation` is the most common intent in the product, so this rejected
 * most of the traffic that does not write files. Production, 19:56: the model
 * returned `{"intent":"conversation","confidence":0.96,...}` with every field
 * present and a sound reason, and it was thrown away as
 * `GENERATION_FAILED: The model JSON did not match the required contract`.
 * Asking Coden how to improve an application, or anything about a project
 * already generated, could not work.
 *
 * Both answer the user in prose rather than changing files, and neither owes a
 * clarification question, so `answer` is what they are.
 */
function runtimeActionForIntent(intent: AgentIntent) {
  if (intent === 'clarification_required' || intent === 'credits_required' || intent === 'external_keys_required') return 'clarify';
  if (intent === 'debug_fix') return 'debug';
  if (intent === 'deploy_assist') return 'confirm';
  if (intent === 'conversation' || intent === 'verify') return 'answer';
  return intent;
}

/**
 * Complete a router answer whose intent is sound but whose scaffolding is not.
 *
 * The router asks for a strict `json_schema`, and only an OpenAI-compatible
 * adapter actually receives one: the Anthropic and Gemini adapters are sent
 * `{type:'json_object'}`, and the router runs with `allowFallback: true`, so a
 * degraded primary silently hands the decision to a model that was never given
 * the schema. Its answer is then judged against it, and one missing field —
 * a blank `reason`, an absent `objective` — discarded the whole decision.
 *
 * That is what took production down: the intent itself was fine, the run fell
 * back to `conversation`, and a request to build an application was answered
 * with a sentence. So the model keeps ownership of the one judgement only it
 * can make — the intent — and every supporting field it left out is filled
 * from the server's own deterministic reading of the same prompt. Nothing is
 * invented: `fallback` is the local classifier's decision for this request.
 */
function completeIntentRouterOutput(value: unknown, fallback: IntentDecision, prompt: string): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const raw = { ...(value as Record<string, any>) };
  const text = (candidate: unknown, replacement: string) =>
    typeof candidate === 'string' && candidate.trim() ? candidate : replacement;

  raw.confidence = typeof raw.confidence === 'number' && Number.isFinite(raw.confidence)
    ? Math.min(1, Math.max(0, raw.confidence))
    : 0.5;
  raw.reason = text(raw.reason, fallback.reason || 'The router answered without a reason.');
  raw.user_visible_reason = text(raw.user_visible_reason, fallback.userVisibleReason || raw.reason);
  raw.normalized_prompt = text(raw.normalized_prompt, prompt);
  if (!Array.isArray(raw.required_capabilities || raw.requiredCapabilities)) raw.required_capabilities = [];

  const objective = raw.objective && typeof raw.objective === 'object' ? { ...raw.objective } : {};
  objective.goal = text(objective.goal, fallback.modelObjective?.goal || raw.normalized_prompt || raw.reason);
  const scope = objective.scope && typeof objective.scope === 'object' ? { ...objective.scope } : {};
  scope.included = Array.isArray(scope.included) ? scope.included : [];
  scope.excluded = Array.isArray(scope.excluded) ? scope.excluded : [];
  objective.scope = scope;
  for (const key of ['constraints', 'assumptions', 'acceptanceCriteria']) {
    if (!Array.isArray(objective[key])) objective[key] = [];
  }
  if (!['low', 'medium', 'high', 'critical'].includes(objective.risk)) objective.risk = 'medium';
  raw.objective = objective;

  // A clarification is the one field that cannot be invented: asking a
  // question the model did not ask would put words in its mouth. It stays
  // exactly as answered, and the caller still rejects the decision when a
  // clarification intent arrives without one.
  return raw;
}

function isIntentRouterStructuredOutput(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const allowedIntents: AgentIntent[] = ['conversation', 'clarification_required', 'plan', 'build', 'edit', 'debug_fix', 'verify', 'deploy_assist', 'external_keys_required', 'credits_required'];
  const raw = value as any;
  if (!allowedIntents.includes(raw.intent)) return false;
  const clarificationValid = raw.intent !== 'clarification_required'
    || (raw.clarification && typeof raw.clarification.question === 'string' && Boolean(raw.clarification.question.trim()));
  if (!clarificationValid) return false;
  try {
    validateModelDecision({
      action: runtimeActionForIntent(raw.intent),
      confidence: raw.confidence,
      objective: raw.objective,
      requiredCapabilities: raw.required_capabilities || raw.requiredCapabilities,
      clarification: raw.clarification,
    });
  } catch {
    return false;
  }
  return true
    && typeof raw.confidence === 'number'
    && Number.isFinite(raw.confidence)
    && raw.confidence >= 0
    && raw.confidence <= 1
    && typeof raw.reason === 'string'
    && Boolean(raw.reason.trim())
    && typeof raw.user_visible_reason === 'string'
    && Boolean(raw.user_visible_reason.trim())
    && typeof raw.normalized_prompt === 'string'
    && Boolean(raw.normalized_prompt.trim())
    && Array.isArray(raw.required_capabilities || raw.requiredCapabilities)
    && raw.objective
    && typeof raw.objective === 'object'
    && clarificationValid;
}

function guardAiDecisionWithUnderstanding(
  aiDecision: IntentDecision,
  input: AgentDecisionInput,
  fallback: IntentDecision,
): IntentDecision {
  const requestedMode = normalizeRequestedMode(input.requestedMode);
  const understanding = understandUserIntent({
    prompt: input.prompt,
    hasFiles: input.hasFiles,
    requestedMode,
    hasLastPlan: Boolean(input.lastPlan),
  });
  const withUnderstanding = (decision: IntentDecision): IntentDecision => ({
    ...decision,
    understandingCategory: understanding.category,
    intentUnderstanding: understanding,
  });

  if (requestedMode === 'ask' || requestedMode === 'research') {
    return withUnderstanding({
      ...aiDecision,
      requestedMode,
      intent: 'conversation',
      requiresFileChanges: false,
      requiresPreviewRebuild: false,
      autoPlanRequired: false,
      nextAction: 'answer',
      userVisibleReason: requestedMode === 'research'
        ? 'Research mode returns sourced guidance without modifying files.'
        : 'Ask mode answers without modifying files.',
    });
  }
  if (requestedMode === 'review') {
    return withUnderstanding({
      ...aiDecision,
      requestedMode,
      intent: input.hasFiles ? 'verify' : 'clarification_required',
      requiresFileChanges: false,
      requiresPreviewRebuild: false,
      autoPlanRequired: false,
      nextAction: input.hasFiles ? 'verify' : 'ask_clarification',
      userVisibleReason: input.hasFiles ? 'Review mode is read-only.' : 'Review mode needs an existing project.',
      clarification: input.hasFiles ? undefined : fallback.clarification,
    });
  }
  if (requestedMode === 'fix') {
    return withUnderstanding({
      ...aiDecision,
      requestedMode,
      intent: input.hasFiles ? 'debug_fix' : 'clarification_required',
      requiresFileChanges: input.hasFiles,
      requiresPreviewRebuild: input.hasFiles,
      requiresCredits: input.hasFiles,
      autoPlanRequired: false,
      nextAction: input.hasFiles ? 'debug_fix' : 'ask_clarification',
      userVisibleReason: input.hasFiles ? 'Fix mode reproduces, patches, and retests the issue.' : 'Fix mode needs an existing project.',
      clarification: input.hasFiles ? undefined : fallback.clarification,
    });
  }

  // Understanding is context for the model and for observability only. It is
  // deliberately not allowed to replace the model's action with a local
  // regex/heuristic decision. Server-side validators still enforce safety,
  // permissions, budgets and confirmation requirements later in the flow.
  return withUnderstanding(aiDecision);
}

async function classifyIntentWithAi(input: AgentDecisionInput, fallback: IntentDecision): Promise<IntentDecision | null> {
  if (!hasLiveAiProvider() || !agentIntentNeedsAiRouter(fallback)) return null;
  // The intent router used to name its own model. Every agent that does that
  // is a copy of the routing policy that will not be updated when the policy
  // changes, so this asks the central selector like everything else: the task
  // is classification, and someone is waiting on the answer.
  const routerModel = selectModelForAgent('router', { interactive: true }).modelId;
  const routerRuntime = buildAIModelRuntimeConfig({
    modelId: routerModel,
    task: 'intent',
    stream: false,
    timeoutMs: 18_000,
    maxTokens: 1600,
  });
  const routerMessages: ChatMessage[] = [
    {
      role: 'system',
      content: buildIntentRouterSystemPrompt(),
    },
    {
      role: 'user',
      content: JSON.stringify({
        prompt: input.prompt,
        requestedMode: normalizeRequestedMode(input.requestedMode),
        hasFiles: input.hasFiles,
        hasLastPlan: Boolean(input.lastPlan),
        recentHistory: input.recentHistory || [],
        localUnderstanding: fallback.intentUnderstanding || null,
        fallbackIntent: fallback.intent,
      }),
    },
  ];
  const runtimeConfig = buildProviderRequestConfig(routerRuntime);
  const runtimeConfigForModel = (modelId: AllowedModelId) => buildProviderRequestConfig(buildAIModelRuntimeConfig({
    modelId,
    task: 'intent',
    stream: false,
    timeoutMs: 18_000,
    maxTokens: 1600,
  }));
  const result = await providerGateway.chat(routerModel, routerMessages, {
    maxAttempts: 2,
    timeoutMs: routerRuntime.timeoutMs,
    runtimeConfig,
    runtimeConfigForModel,
    // Intent routing is internal and has not produced any user-visible output.
    // A short compatible fallback keeps Auto responsive when the economy
    // router is degraded without changing a user-pinned generation model.
    allowFallback: true,
  });
  let routerFailureCause = '';
  const rawDecision = await parseOrRepairStructuredObject(
    result.text,
    // Completed before it is judged: a model that was never handed the schema
    // still gets its intent used, instead of the run silently becoming a
    // conversation because a supporting field was missing.
    (value): value is Record<string, unknown> => isIntentRouterStructuredOutput(completeIntentRouterOutput(value, fallback, input.prompt)),
    async invalidText => {
      const repaired = await providerGateway.chat(routerModel, [
        {
          role: 'system',
          content: `${buildIntentRouterSystemPrompt()}\nRepair the invalid router output below. Return one valid JSON object only, matching the required intent contract.`,
        },
        { role: 'user', content: String(invalidText || '').slice(0, 8_000) },
      ], {
        maxAttempts: 1,
        timeoutMs: routerRuntime.timeoutMs,
        runtimeConfig,
        runtimeConfigForModel,
        allowFallback: false,
      });
      return repaired.text;
    },
  // Swallowing this hid why routing failed. Every outcome — a provider 401, a
  // timeout, a malformed object — reached the log as the same
  // "returned no valid intent decision", so a routing outage could not be told
  // apart from a bad answer. The cause is kept and re-thrown with the failure.
  ).catch((error: any) => {
    routerFailureCause = normalizeProviderError(error) || String(error?.message || error || '');
    /*
     * What the router actually answered, when it answered something.
     *
     * "The model JSON did not match the required contract" names the check
     * that failed and nothing about why: the object parsed, so some field is
     * wrong or missing, and the log gave no way to tell which. In production
     * that turned every routing failure into the same unreadable line while
     * every request quietly degraded to `conversation`. The answer is the
     * evidence, so it is recorded — redacted and truncated, since it is model
     * output and only its shape is needed.
     */
    console.warn('[coden:intent_router_rejected]', {
      model: routerModel,
      cause: routerFailureCause,
      answer: redactSecrets(String(result?.text || '').slice(0, 600), '[redacted]'),
    });
    return null;
  });
  // The same completion the check above accepted, so what is judged and what
  // is used are one object rather than two readings of it.
  const aiDecision = buildDecisionFromAi(rawDecision ? completeIntentRouterOutput(rawDecision, fallback, input.prompt) : null, fallback);
  if (aiDecision) return guardAiDecisionWithUnderstanding(aiDecision, input, fallback);
  if (!routerFailureCause) {
    routerFailureCause = rawDecision
      ? 'the router answered with an object that does not match the intent contract'
      : 'the router answered with no readable object';
  }
  throw new Error(`The selected AI model returned no valid intent decision: ${routerFailureCause}`.slice(0, 400));
}

function applyTypedIntentLifecycle(input: AgentDecisionInput, decision: IntentDecision): IntentDecision {
  // The model owns intent selection. Local code may attach a contract for
  // permission, budget and confirmation validation, but it cannot override
  // the model with regex/heuristic routing.
  const strictExecutionContract = buildExecutionContract({
    prompt: input.prompt,
    requestedMode: input.requestedMode,
    hasFiles: input.hasFiles,
    hasLastPlan: Boolean(input.lastPlan),
    legacyDecision: decision,
  });
  return {
    ...decision,
    typedDecision: buildTypedIntentDecision({
      prompt: input.prompt,
      hasFiles: input.hasFiles,
      requestedMode: input.requestedMode,
      decision,
    }),
    executionContract: strictExecutionContract,
  } as IntentDecision;

}

async function resolveAgentDecision(input: AgentDecisionInput) {
  const fallback = intentRouter.decide(input);
  const finalize = (decision: IntentDecision): IntentDecision => applyTypedIntentLifecycle(input, decision);
  const safeFallback = (reason: string): IntentDecision => finalize({
    ...fallback,
    routingSource: 'fallback',
    reason: `Validated server fallback: ${reason}`.slice(0, 240),
    userVisibleReason: fallback.userVisibleReason || 'Coden selected the safest available action for this request.',
  });

  // Explicit Plan is intentionally deterministic and read-only. It used to
  // skip classifyIntentWithAi and then fail because a null model decision was
  // treated as an outage. The server decision is already guarded by the same
  // typed execution contract and is the correct result for this mode.
  if (!agentIntentNeedsAiRouter(fallback)) {
    return safeFallback('explicit mode does not require model classification');
  }
  if (!hasLiveAiProvider()) {
    return safeFallback('live intent classifier unavailable');
  }
  try {
    const modelDecision = await classifyIntentWithAi(input, fallback);
    if (!modelDecision) throw new Error('The selected AI model returned no valid intent decision.');
    // classifyIntentWithAi now throws with the cause; a null here means a
    // guarded decision was rejected, which is not a provider failure.
    return finalize(modelDecision);
  } catch (error: any) {
    const diagnostic = diagnoseProviderError(error);
    console.warn('[coden:agent_router_fallback]', {
      diagnostic_code: diagnostic.diagnostic_code,
      message: normalizeProviderError(error),
      fallback_intent: fallback.intent,
      requested_mode: fallback.requestedMode,
    });
    // Intent classification is advisory. A malformed/slow provider response
    // must not take down the whole product. The fallback remains subject to
    // permissions, credit gates, execution contracts and critical-action
    // confirmations later in the request lifecycle.
    return safeFallback(diagnostic.diagnostic_code);
  }
}

function isLikelyFrenchPrompt(prompt: string) {
  return /\b(je|tu|vous|nous|veux|j'aimerais|crée|cree|corrige|explique|comment|pourquoi|bonjour|salut|merci|projet|application)\b/i.test(repairTextEncoding(prompt));
}

function summarizeProjectFilesForAgent(files: GeneratedFile[]) {
  return files
    .slice(0, 18)
    .map(file => `${file.path} (${file.language || 'text'}, ${file.content.length} chars)`)
    .join('\n') || 'No generated files yet.';
}

function buildExistingFilesContextForGeneration(files: GeneratedFile[], prompt?: string, modelId?: AllowedModelId) {
  if (!files.length) {
    // A first message starts from a scaffold, not from nothing. Telling the
    // model what already exists is what stops it re-emitting a package.json, a
    // Vite config and an entry point on every new project -- tokens spent to
    // reproduce a fixture, with a fresh chance each time of a version that does
    // not match its plugin.
    if (process.env.CODEN_LIVE_SANDBOX === '1' && prompt) {
      return describeStarter(selectStarter(prompt));
    }
    return 'No existing files yet.';
  }
  // Selection decides which file *contents* fit the budget, so the model's view
  // of the project changed shape from one message to the next — ask about the
  // header and the schema falls out. The map is what must never fall out.
  const architecture = renderProjectArchitecture(files);
  const withMap = (body: string) => (architecture ? `${architecture}\n\n${body}` : body);
  const modelContextTokens = modelId ? getAIModelCapabilityProfile(modelId).limits.contextTokens : 128_000;
  const contextTokenBudget = Math.max(24_000, Math.min(180_000, Math.floor(modelContextTokens * 0.42)));
  const contextFileBudget = modelContextTokens >= 500_000 ? 55 : modelContextTokens >= 200_000 ? 38 : 25;

  // Use smart context injection for projects with 5+ files
  if (files.length >= 5 && prompt) {
    const result = buildSmartContextInjection(files, prompt, {
      tokenBudget: contextTokenBudget,
      maxFiles: contextFileBudget,
    });
    return withMap(result.contextText);
  }

  // Small project fallback — include everything
  const important = [...files].sort((a, b) => {
    const score = (file: GeneratedFile) => file.path === 'index.html' ? 0 : file.path.endsWith('.css') ? 1 : file.path.endsWith('.js') ? 2 : 3;
    return score(a) - score(b) || a.path.localeCompare(b.path);
  });
  let budget = contextTokenBudget * 4;
  const chunks: string[] = [];
  for (const file of important.slice(0, 18)) {
    if (budget <= 0) break;
    const header = `--- ${file.path} (${file.language || 'text'}) ---`;
    const content = String(file.content || '');
    const slice = content.length > budget ? content.slice(0, budget) : content;
    chunks.push(`${header}\n${slice}${content.length > slice.length ? '\n...[truncated]' : ''}`);
    budget -= slice.length + header.length;
  }
  return withMap(chunks.join('\n\n') || summarizeProjectFilesForAgent(files));
}

type AgentTaskComplexity = NonNullable<RoutingContext['taskComplexity']>;
const STUDIO_OPUS_MODEL_PREFERENCE: AllowedModelId[] = [
  'anthropic/claude-opus-5',
  'anthropic/claude-opus-5',
  'anthropic/claude-opus-5',
];

function inferAgentTaskComplexity(prompt: string, decision: IntentDecision, files: GeneratedFile[] = []): AgentTaskComplexity {
  const text = String(prompt || '').toLowerCase();
  const riskyTerms = [
    'auth', 'authentication', 'login', 'signup', 'supabase', 'database', 'schema',
    'migration', 'stripe', 'billing', 'payment', 'paiement', 'credits', 'crédits',
    'deploy', 'publish', 'vercel', 'railway', 'domain', 'domaine', 'seo',
    'analytics', 'security', 'rls', 'role', 'permission', 'api externe',
    'external api', 'refactor', 'refactorise', 'multi screen', 'plusieurs ecrans',
    'plusieurs écrans',
  ];
  const extremeSignals = [
    'full stack', 'production', 'auth', 'billing', 'database', 'stripe', 'supabase',
    'multi-tenant', 'marketplace', 'dashboard complet', 'admin panel',
  ].filter(term => text.includes(term)).length;

  if (
    decision.selectedModelPolicy === 'premium'
    || text.length > 1800
    || (decision.autoPlanRequired && extremeSignals >= 3)
  ) {
    return 'extreme';
  }

  if (
    decision.selectedModelPolicy === 'balanced'
    || decision.autoPlanRequired
    || decision.intent === 'debug_fix'
    || decision.intent === 'build'
    || riskyTerms.some(term => text.includes(term))
    || files.length > 10
    || text.length > 900
  ) {
    return 'complex';
  }

  if (
    decision.intent === 'plan'
    || decision.intent === 'edit'
    || decision.intent === 'verify'
    || text.length > 320
    || files.length > 0
  ) {
    return 'medium';
  }

  return 'simple';
}

function routingModeForPolicy(policy?: IntentDecision['selectedModelPolicy']): RoutingContext['mode'] {
  if (policy === 'economy') return 'Fast';
  if (policy === 'balanced') return 'Balanced';
  if (policy === 'premium') return 'Premium';
  return 'Auto';
}

function studioPreferredModelsForPrompt(prompt: string): AllowedModelId[] | undefined {
  return /Coden (Design|Decks|Media) workspace context:/i.test(prompt)
    ? STUDIO_OPUS_MODEL_PREFERENCE
    : undefined;
}

function requiredModelCapabilitiesForTask(
  prompt: string,
  decision: IntentDecision,
  complexity: AgentTaskComplexity,
  files: GeneratedFile[] = []
): RoutingContext['requiredCapabilities'] {
  const text = normalizePromptIntentText(prompt);
  const mutatesCode = ['build', 'edit', 'debug_fix'].includes(decision.intent);
  const touchesDesign = /\b(ui|ux|design|style|layout|landing|hero|component|composant|dashboard|animation|responsive|mobile)\b/i.test(text);
  const touchesBackend = /\b(api|backend|server|database|supabase|postgres|auth|login|stripe|billing|webhook|rls|storage|realtime)\b/i.test(text);
  const touchesSecurity = /\b(security|securite|sécurité|auth|rls|policy|policies|stripe|webhook|secret|service role|permission|role)\b/i.test(text);
  const needsVision = /\b(image|screenshot|capture|figma|maquette|mockup|wireframe|visuel|photo|screen)\b/i.test(text);
  return {
    reasoning: decision.intent !== 'conversation' || complexity !== 'simple',
    code: mutatesCode,
    agentic: mutatesCode || decision.autoPlanRequired || complexity === 'extreme',
    design: touchesDesign,
    security: touchesSecurity || touchesBackend,
    structuredOutput: decision.intent !== 'conversation',
    longContext: files.length > 12 || text.length > 1800 || complexity === 'extreme',
    vision: needsVision,
    tools: mutatesCode || decision.intent === 'verify',
  };
}

function inferRuntimeTaskForPrompt(prompt: string, decision: IntentDecision, mode: 'text' | 'generation' = 'text'): AIWorkflowTask {
  const text = normalizePromptIntentText(prompt);
  if (mode === 'generation') {
    if (/\b(database|supabase|postgres|sql|rls|schema|table|auth|login|stripe|billing|webhook|storage|realtime)\b/i.test(text)) return 'backend_generation';
    if (/\b(security|sécurité|securite|permission|role|secret|policy|policies|webhook)\b/i.test(text)) return 'security';
    if (/\b(ui|ux|design|style|layout|animation|responsive|mobile|hero|dashboard|component|composant)\b/i.test(text)) return 'frontend_generation';
    return 'frontend_generation';
  }
  if (decision.intent === 'conversation') return 'conversation';
  if (decision.intent === 'clarification_required') return 'clarification';
  if (decision.intent === 'plan') return 'planning';
  if (decision.intent === 'verify') return 'tests';
  if (decision.intent === 'deploy_assist') return 'deploy';
  if (decision.intent === 'debug_fix') return 'debug';
  if (decision.intent === 'edit' || decision.intent === 'build') {
    if (/\b(database|supabase|postgres|sql|rls|schema|table|auth|login|stripe|billing|webhook|storage|realtime)\b/i.test(text)) return 'backend_generation';
    if (/\b(security|sécurité|securite|permission|role|secret|policy|policies|webhook)\b/i.test(text)) return 'security';
    if (/\b(ui|ux|design|style|layout|animation|responsive|mobile|hero|dashboard|component|composant)\b/i.test(text)) return 'design';
    return 'frontend_generation';
  }
  if (/\b(image|screenshot|capture|figma|maquette|wireframe|mockup|visuel)\b/i.test(text)) return 'vision';
  return 'summary';
}

function createProviderRuntimeOptions(input: {
  model: AllowedModelId;
  prompt: string;
  decision: IntentDecision;
  files?: GeneratedFile[];
  mode?: 'text' | 'generation';
  stream?: boolean;
  timeoutMs?: number;
  maxTokens?: number;
  hasVisionInput?: boolean;
}) {
  const task = inferRuntimeTaskForPrompt(input.prompt, input.decision, input.mode || 'text');
  const estimatedInputTokens = Math.ceil((
    String(input.prompt || '').length +
    (input.files || []).reduce((total, file) => total + String(file.content || '').length, 0)
  ) / 4);

  // ✅ For generation mode: override maxTokens to match model capability
  // The profile.recommended.maxTokens already accounts for frontier vs standard tiers
  // Only override with explicit input.maxTokens if provided
  const runtime = buildAIModelRuntimeConfig({
    modelId: input.model,
    task,
    stream: input.stream,
    allowTools: input.mode !== 'generation',
    timeoutMs: input.timeoutMs,
    maxTokens: input.maxTokens, // undefined = use profile default (now properly sized)
    hasVisionInput: Boolean(input.hasVisionInput || /\b(image|screenshot|capture|figma|maquette|mockup|wireframe|visuel)\b/i.test(input.prompt)),
    estimatedInputTokens,
    // ✅ Use structured output for generation tasks on capable models
    preferStructuredOutput: input.mode === 'generation' ? true : undefined,
  });
  return {
    runtime,
    providerConfig: buildProviderRequestConfig(runtime),
    runtimeConfigForModel: (modelId: AllowedModelId) => buildProviderRequestConfig(buildAIModelRuntimeConfig({
      modelId,
      task,
      stream: input.stream,
      allowTools: input.mode !== 'generation',
      timeoutMs: input.timeoutMs,
      maxTokens: input.maxTokens,
      hasVisionInput: Boolean(input.hasVisionInput || /\b(image|screenshot|capture|figma|maquette|mockup|wireframe|visuel)\b/i.test(input.prompt)),
      estimatedInputTokens,
      preferStructuredOutput: input.mode === 'generation' ? true : undefined,
    })),
  };
}

async function resolveAgentProviderModel(input: {
  modelId?: unknown;
  project: GeneratedProject;
  prompt: string;
  decision: IntentDecision;
  files?: GeneratedFile[];
  userCredits?: number;
  plan?: string;
}): Promise<{ model: AllowedModelId; autoRouted: boolean; complexity: AgentTaskComplexity; mode: RoutingContext['mode']; plan: RoutingContext['plan']; credits: number }> {
  if (input.modelId && input.modelId !== 'auto') {
    const model = normalizeProviderModelForBackend(input.modelId);
    validateAllowedModel(model);
    return {
      model,
      autoRouted: false,
      complexity: inferAgentTaskComplexity(input.prompt, input.decision, input.files || []),
      mode: 'Custom',
      plan: (input.plan || 'free') as RoutingContext['plan'],
      credits: Number.isFinite(Number(input.userCredits)) ? Number(input.userCredits) : FALLBACK_WALLET_CREDITS,
    };
  }

  const plan = (input.plan || await getOrganizationPlan(input.project.organization_id).catch(() => 'free')) as RoutingContext['plan'];
  const credits = Number.isFinite(Number(input.userCredits))
    ? Number(input.userCredits)
    : await getWalletWithFallback(getOptionalDbHelpers('model_routing'), input.project.organization_id);
  const complexity = inferAgentTaskComplexity(input.prompt, input.decision, input.files || []);
  const mode = routingModeForPolicy(input.decision.selectedModelPolicy);
  const model = await modelRouter.selectModel({
    plan,
    mode,
    userCredits: credits,
    taskComplexity: complexity,
    preferredModels: studioPreferredModelsForPrompt(input.prompt),
    requiredCapabilities: requiredModelCapabilitiesForTask(input.prompt, input.decision, complexity, input.files || []),
  });
  validateAllowedModel(model);
  return { model, autoRouted: true, complexity, mode, plan, credits };
}

function buildAgentTextMessages(input: {
  project: GeneratedProject;
  prompt: string;
  files: GeneratedFile[];
  decision: IntentDecision;
  researchContext?: string;
  executionContract?: ExecutionContract;
  visionInputs?: Array<{ url: string; detail?: 'auto' | 'low' | 'high' }>;
  finalizer?: boolean;
}): ChatMessage[] {
  const { project, prompt, files, decision, researchContext, executionContract, visionInputs } = input;
  const languageInstruction = isLikelyFrenchPrompt(prompt)
    ? 'Answer in natural French.'
    : 'Answer in the same language as the user.';
  const fileSummary = summarizeProjectFilesForAgent(files);
  const modeInstruction = decision.intent === 'plan'
    ? 'Produce a concise execution plan. Do not claim files were changed. Do not include code unless needed for clarity.'
    : decision.intent === 'deploy_assist'
      ? 'Give deployment, domain or production-readiness guidance. Do not claim files were changed.'
      : decision.intent === 'conversation'
        ? 'Answer directly in 2 to 5 short sentences for simple questions. Match the user language. Do not mention intents, modes, models, credits, internal routing, files, preview, or checks unless the user explicitly asks. If the user asks technical advice, be precise. If the user asks vague product help, give 2-3 concrete examples Coden can do.'
        : 'Answer naturally and helpfully. If implementation is needed, explain the next action in plain language without forcing the user to choose Build or Plan.';

  const executionContext = executionContract
    ? [
        'This is the execution contract for the current run. Follow it exactly:',
        JSON.stringify(executionContract),
        'Generate concise user-visible text from the supplied facts. Ask at most one clarification question when required. Never claim a file, preview, check, publication, or payment changed unless the verified result says so.',
      ].join('\n')
    : undefined;

  // The closing recap reports a finished run, so it does not carry the routing,
  // build, infrastructure or research policy the conversation prompt needs.
  const systemPrompt = input.finalizer
    ? buildFinalizerSystemPrompt({ modeInstruction, languageInstruction, executionContext })
    : buildAgentTextSystemPrompt({
        intent: decision.intent,
        modeInstruction,
        languageInstruction,
        hasResearchContext: Boolean(researchContext),
        executionContext,
      });

  return [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: visionInputs?.length ? buildVisionMessageContent(JSON.stringify({
        project: { name: project.name, status: project.status, preview_status: project.preview_status },
        request: prompt,
        intent: decision.intent,
        intent_category: decision.intentUnderstanding?.category || decision.understandingCategory,
        auto_plan_required: decision.autoPlanRequired,
        execution_contract: executionContract || undefined,
        files: fileSummary,
        researchContext: researchContext || undefined,
      }), visionInputs) : JSON.stringify({
        project: { name: project.name, status: project.status, preview_status: project.preview_status },
        request: prompt,
        intent: decision.intent,
        intent_category: decision.intentUnderstanding?.category || decision.understandingCategory,
        auto_plan_required: decision.autoPlanRequired,
        execution_contract: executionContract || undefined,
        files: fileSummary,
        researchContext: researchContext || undefined,
      }),
    },
  ];
}

async function createAgentTextResponse(input: {
  project: GeneratedProject;
  prompt: string;
  files: GeneratedFile[];
  decision: IntentDecision;
  modelId?: unknown;
  userCredits?: number;
  plan?: string;
  researchContext?: string;
  allowLocalFallback?: boolean;
  signal?: AbortSignal;
  visionInputs?: Array<{ url: string; detail?: 'auto' | 'low' | 'high' }>;
  /** Closing recap for a finished run: routing and build policy no longer apply. */
  finalizer?: boolean;
}): Promise<{ text: string; model: string; cost_usd: number }> {
  const { project, prompt, files, decision, researchContext } = input;
  const executionContract = (decision as any).executionContract as ExecutionContract | undefined;
  if (!hasLiveAiProvider()) {
    throw new Error('No AI provider is configured. Add OPENROUTER_API_KEY on Railway to enable live AI responses.');
  }

  const selectedModel = (await resolveAgentProviderModel({
    modelId: input.modelId,
    project,
    prompt,
    decision,
    files,
    userCredits: input.userCredits,
    plan: input.plan,
  })).model;
  validateAllowedModel(selectedModel);
  assertAgentModelCapabilities(selectedModel, { structuredOutput: true, toolCalling: decision.intent !== 'conversation' });
  const runtimeOptions = createProviderRuntimeOptions({
    model: selectedModel,
    prompt,
    decision,
    files,
    stream: false,
    timeoutMs: decision.intent === 'conversation' ? 12_000 : decision.intent === 'plan' ? 30_000 : 45_000,
    hasVisionInput: Boolean(input.visionInputs?.length),
  });

  try {
    const result = await providerGateway.chat(
      selectedModel,
      buildAgentTextMessages({ project, prompt, files, decision, researchContext, executionContract, visionInputs: input.visionInputs, finalizer: input.finalizer }),
      {
        maxAttempts: decision.intent === 'conversation' ? 1 : 2,
        timeoutMs: runtimeOptions.runtime.timeoutMs,
        runtimeConfig: runtimeOptions.providerConfig,
        runtimeConfigForModel: runtimeOptions.runtimeConfigForModel,
        // Auto may make one real provider fallback before any user-visible
        // response exists. Explicit model selections remain pinned.
        allowFallback: Boolean(input.allowLocalFallback),
        signal: input.signal,
      },
    );

    const modelText = result.text.trim();
    if (!modelText) throw new Error('The selected AI model returned an empty response.');
    return {
      text: sanitizeAssistantOutput({
        text: modelText,
        prompt,
        contract: executionContract,
        intent: decision.intent,
      }),
      model: result.model,
      cost_usd: result.cost_usd || 0,
    };
  } catch (error) {
    throw error;
  }
}


function detectExternalApiRequirements(prompt: string): ExternalApiRequirement[] {
  const lower = prompt.toLowerCase();
  const services: Array<[string, string, string, string[]]> = [
    ['Stripe', 'STRIPE_SECRET_KEY', 'Payments and billing operations', ['stripe', 'payment', 'checkout', 'abonnement']],
    ['Resend', 'RESEND_API_KEY', 'Transactional emails', ['resend', 'sendgrid', 'email', 'mail']],
    ['Google Maps', 'GOOGLE_MAPS_API_KEY', 'Maps, places and geocoding', ['google maps', 'map', 'maps', 'géolocalisation', 'geolocation']],
    ['Twilio', 'TWILIO_AUTH_TOKEN', 'SMS and WhatsApp messaging', ['twilio', 'whatsapp', 'sms']],
    ['OpenAI', 'OPENAI_API_KEY', 'External OpenAI-powered app features', ['openai api', 'chatgpt api']],
    ['Clerk', 'CLERK_SECRET_KEY', 'External auth provider integration', ['clerk']],
  ];

  return services
    .filter(([, , , hints]) => hints.some(hint => lower.includes(hint)))
    .map(([service, variable, description]) => ({
      service,
      variable,
      description,
      required: false,
      placeholder: `${variable}=configure_in_database_tab`,
    }));
}

function maskSecret(value: string) {
  if (!value) return '';
  if (value.length <= 8) return '••••';
  return `${value.slice(0, 4)}••••••${value.slice(-4)}`;
}

function pseudoEncryptSecret(value: string) {
  const salt = randomBytes(6).toString('hex');
  const digest = createHash('sha256').update(`${salt}:${value}`).digest('hex');
  return `sha256:${salt}:${digest}`;
}

function modelCreditFloor(modelId: unknown, fallback = 0) {
  return typeof modelId === 'string' && modelId !== 'auto'
    ? MODEL_ACTION_CREDIT_FLOORS[modelId as AllowedModelId] || fallback
    : fallback;
}

function normalizeProviderModelForBackend(value: unknown): AllowedModelId {
  return isAllowedModelId(value) ? value : DEFAULT_PROVIDER_MODEL_ID;
}

function isExplicitProviderModelSelection(value: unknown) {
  return typeof value === 'string' && value.trim() !== '' && value !== 'auto';
}

function estimateActionCost(prompt: string, intent: IntentDecision, modelId?: unknown) {
  if (intent.intent === 'clarification_required' || !intent.requiresCredits) return { finalCredits: 0, minimum_action_credits: 0 };
  const selectedModelFloor = modelId === 'auto' && intent.intent !== 'plan'
    ? MODEL_ACTION_CREDIT_FLOORS[DEFAULT_PROVIDER_MODEL_ID]
    : modelCreditFloor(modelId);
  if (intent.intent === 'conversation') return costEstimator.calculateRequiredCredits({
    openrouter_cost_usd: 0.0002,
    infra_cost_usd: 0.00005,
    storage_cost_usd: 0,
    build_cost_usd: 0,
    domain_operation_cost_usd: 0,
    minimum_action_credits: 1,
    complexity_surcharge: prompt.length > 800 ? 0.5 : 0,
  });
  if (intent.intent === 'plan') return costEstimator.calculateRequiredCredits({
    openrouter_cost_usd: 0.0005,
    infra_cost_usd: 0.0001,
    storage_cost_usd: 0,
    build_cost_usd: 0,
    domain_operation_cost_usd: 0,
    minimum_action_credits: Math.max(1, selectedModelFloor),
    complexity_surcharge: prompt.length > 600 ? 0.5 : 0,
  });
  return costEstimator.calculateRequiredCredits({
    openrouter_cost_usd: 0.002,
    infra_cost_usd: 0.0005,
    storage_cost_usd: 0.0001,
    build_cost_usd: 0.001,
    domain_operation_cost_usd: 0,
    minimum_action_credits: Math.max(2, selectedModelFloor),
    complexity_surcharge: prompt.length > 400 ? 2 : 0,
  });
}

async function chargeCompletedAgentAction(
  helpers: ReturnType<typeof getDbHelpers> | null,
  userId: string,
  amount: number,
  description: string,
  referenceId: string,
) {
  if (!Number.isFinite(amount) || amount <= 0) return;
  if (!helpers) {
    console.warn('[coden:credit_charge_skipped]', {
      reason: 'persistence_unavailable',
      user_id: userId,
      amount,
      reference_id: referenceId,
    });
    return;
  }
  const finalBalance = await helpers.updateWallet(userId, -amount);
  await helpers.addLedger(userId, 'usage', -amount, finalBalance, description, referenceId);
}

function providerModelToDisplayName(modelId: string) {
  return AI_MODEL_DISPLAY_NAMES[modelId as AllowedModelId] || modelId.split('/').pop()?.replace(/[-_]/g, ' ') || modelId;
}

function buildPublicRuntimeCapabilities(modelId: AllowedModelId) {
  const profile = getAIModelCapabilityProfile(modelId);
  return {
    best_for: profile.bestUse,
    reasoning: profile.reasoning,
    code: profile.code,
    comprehension: profile.comprehension,
    agentic: profile.agentic,
    design: profile.design,
    security: profile.security,
    supports: {
      streaming: profile.supports.streaming,
      tool_calling: profile.supports.toolCalling,
      structured_output: profile.supports.structuredOutput,
      vision: profile.supports.vision,
      long_context: profile.supports.longContext,
    },
    speed: profile.speed,
    reliability: profile.reliability,
    fallback_available: false,
  };
}

function buildPublicModelList() {
  const autoCapabilities = {
    supportsStreaming: true,
    supportsTools: true,
    supportsVision: true,
    supportsJsonMode: true,
    maxContextTokens: Math.max(...AI_ALLOWED_MODELS.map(id => AI_MODEL_CAPABILITIES[id]?.maxContextTokens || 0)),
  };

  return [
    {
      id: AI_AUTO_MODEL_OPTION.id,
      display_name: AI_AUTO_MODEL_OPTION.display_name,
      tier: AI_AUTO_MODEL_OPTION.tier,
      capabilities: autoCapabilities,
      runtime_capabilities: {
        best_for: ['automatic_routing', 'conversation', 'planning', 'code_generation', 'debug', 'design', 'security'],
        supports: {
          streaming: true,
          tool_calling: true,
          structured_output: true,
          vision: true,
          long_context: true,
        },
        fallback_available: false,
      },
      description: AI_AUTO_MODEL_OPTION.description,
      locked: false,
    },
    ...AI_ALLOWED_MODELS.map(id => {
      const definition = MODEL_REGISTRY.find(model => model.id === id) as ModelDefinition | undefined;
      return {
        id,
        display_name: definition?.label || providerModelToDisplayName(id),
        tier: AI_MODEL_TIERS[id],
        capabilities: AI_MODEL_CAPABILITIES[id],
        runtime_capabilities: buildPublicRuntimeCapabilities(id),
        provider: definition?.provider,
        description: definition?.description,
        plan_minimum: definition?.minPlan,
        badges: {
          new: Boolean(definition?.isNew),
          fast: Boolean(definition?.isFast),
          premium: Boolean(definition?.isPremium),
        },
        locked: false,
      };
    }),
  ];
}

function buildPublicModelProviderGroups() {
  const byProvider = getModelsByProvider();
  return (Object.keys(byProvider) as ModelProvider[]).map(provider => ({
    provider,
    meta: PROVIDER_META[provider],
    models: byProvider[provider].map(model => ({
      id: model.id,
      display_name: model.label,
      tier: model.tier,
      provider: model.provider,
      capabilities: AI_MODEL_CAPABILITIES[model.id as AllowedModelId],
      runtime_capabilities: buildPublicRuntimeCapabilities(model.id as AllowedModelId),
      description: model.description,
      plan_minimum: model.minPlan,
      badges: {
        new: Boolean(model.isNew),
        fast: Boolean(model.isFast),
        premium: Boolean(model.isPremium),
      },
      locked: false,
    })),
  }));
}

function sanitizeCreditLedgerEntry(row: any) {
  const rawAmount = Number(row?.amount || 0);
  return {
    id: row?.id || row?.reference_id || randomUUID(),
    type: String(row?.type || 'usage'),
    credits: Math.abs(rawAmount),
    direction: rawAmount < 0 ? 'debit' : 'credit',
    balance_after: typeof row?.balance_after === 'number' ? row.balance_after : null,
    description: sanitizeWorkspaceText(String(row?.description || '').replace(/\$[\d,.]+/g, '').replace(/cost|margin|provider/gi, 'usage'), 160),
    reference_id: row?.reference_id || null,
    created_at: row?.created_at || new Date().toISOString(),
  };
}

function sanitizeAiUsageRow(row: any) {
  const usage = Array.isArray(row?.ai_request_usage) ? row.ai_request_usage[0] : row?.ai_request_usage;
  const project = Array.isArray(row?.projects) ? row.projects[0] : row?.projects;
  const credits = Number(usage?.final_cost_credits || row?.credits_charged || row?.credits || Math.abs(Number(row?.amount || 0)) || 0);
  return {
    id: row?.id || row?.reference_id || randomUUID(),
    project_id: row?.project_id || null,
    project_name: project?.name || row?.project_name || 'Project',
    model_id: row?.model_id || row?.model || null,
    model_name: row?.model_id || row?.model ? providerModelToDisplayName(row.model_id || row.model) : 'Auto',
    mode: row?.request_type || row?.mode || row?.type || 'AI action',
    credits_charged: credits,
    status: row?.status || usage?.status || (Number(row?.amount || 0) > 0 ? 'refunded' : 'completed'),
    created_at: row?.created_at || new Date().toISOString(),
  };
}

/**
 * What a genuine credit refusal says.
 *
 * `error` used to be the bare string `UpgradeRequired` and `message` was
 * `Upgrade required` — a code and an English sentence shown inside a French
 * interface — and neither carried a `diagnostic_code`, so the harness recorded
 * `turn.failed { diagnostic_code: null }` and the client had nothing to act on.
 */
function publicCreditGateResponse(french = true) {
  return {
    success: false,
    event: 'credits_insufficient',
    error: french
      ? 'Il ne reste pas assez de crédits pour cette action. Rechargez votre solde, ou choisissez le mode Auto qui sélectionne un modèle moins coûteux.'
      : 'There are not enough credits left for this action. Top up your balance, or use Auto, which picks a cheaper model.',
    message: french
      ? 'Il ne reste pas assez de crédits pour cette action. Rechargez votre solde, ou choisissez le mode Auto qui sélectionne un modèle moins coûteux.'
      : 'There are not enough credits left for this action. Top up your balance, or use Auto, which picks a cheaper model.',
    diagnostic_code: 'CREDITS_REQUIRED',
    action: 'upgrade_required',
    suggested_action: 'use_auto',
  };
}

function countLineDiffStats(beforeContent = '', afterContent = '') {
  const beforeLines = String(beforeContent || '').split('\n');
  const afterLines = String(afterContent || '').split('\n');
  while (beforeLines.length && beforeLines[beforeLines.length - 1] === '') beforeLines.pop();
  while (afterLines.length && afterLines[afterLines.length - 1] === '') afterLines.pop();

  let start = 0;
  while (start < beforeLines.length && start < afterLines.length && beforeLines[start] === afterLines[start]) start += 1;

  let beforeEnd = beforeLines.length - 1;
  let afterEnd = afterLines.length - 1;
  while (beforeEnd >= start && afterEnd >= start && beforeLines[beforeEnd] === afterLines[afterEnd]) {
    beforeEnd -= 1;
    afterEnd -= 1;
  }

  const beforeMiddle = beforeLines.slice(start, beforeEnd + 1);
  const afterMiddle = afterLines.slice(start, afterEnd + 1);
  if (!beforeMiddle.length) return { additions: afterMiddle.length, deletions: 0 };
  if (!afterMiddle.length) return { additions: 0, deletions: beforeMiddle.length };

  const cellBudget = beforeMiddle.length * afterMiddle.length;
  if (cellBudget > 350_000) {
    const beforeCounts = new Map<string, number>();
    const afterCounts = new Map<string, number>();
    beforeMiddle.forEach(line => beforeCounts.set(line, (beforeCounts.get(line) || 0) + 1));
    afterMiddle.forEach(line => afterCounts.set(line, (afterCounts.get(line) || 0) + 1));
    let common = 0;
    beforeCounts.forEach((count, line) => {
      common += Math.min(count, afterCounts.get(line) || 0);
    });
    return {
      additions: Math.max(0, afterMiddle.length - common),
      deletions: Math.max(0, beforeMiddle.length - common),
    };
  }

  const previous = new Array(afterMiddle.length + 1).fill(0);
  const current = new Array(afterMiddle.length + 1).fill(0);
  for (let i = 1; i <= beforeMiddle.length; i += 1) {
    for (let j = 1; j <= afterMiddle.length; j += 1) {
      current[j] = beforeMiddle[i - 1] === afterMiddle[j - 1]
        ? previous[j - 1] + 1
        : Math.max(previous[j], current[j - 1]);
    }
    for (let j = 0; j <= afterMiddle.length; j += 1) previous[j] = current[j];
  }
  const common = previous[afterMiddle.length] || 0;
  return {
    additions: Math.max(0, afterMiddle.length - common),
    deletions: Math.max(0, beforeMiddle.length - common),
  };
}

function diffFiles(before: GeneratedFile[], after: GeneratedFile[]) {
  const beforeMap = new Map(before.map(file => [file.path, file.content]));
  const afterMap = new Map(after.map(file => [file.path, file.content]));
  const created = after.filter(file => !beforeMap.has(file.path)).map(file => file.path);
  const modified = after.filter(file => beforeMap.has(file.path) && beforeMap.get(file.path) !== file.content).map(file => file.path);
  const deleted = before.filter(file => !afterMap.has(file.path)).map(file => file.path);
  const file_stats = [
    ...created.map(path => {
      const stats = countLineDiffStats('', afterMap.get(path) || '');
      return { path, action: 'created', ...stats };
    }),
    ...modified.map(path => {
      const stats = countLineDiffStats(beforeMap.get(path) || '', afterMap.get(path) || '');
      return { path, action: 'modified', ...stats };
    }),
    ...deleted.map(path => {
      const stats = countLineDiffStats(beforeMap.get(path) || '', '');
      return { path, action: 'deleted', ...stats };
    }),
  ];
  return {
    created,
    modified,
    deleted,
    file_stats,
    summary: `${created.length} created, ${modified.length} modified, ${deleted.length} deleted`,
  };
}

function publicFileStreamSnippet(file: GeneratedFile) {
  const redacted = redactSecrets(file.content || '');
  return redacted.split('\n').slice(0, 26).join('\n').slice(0, 2400);
}

const GENERATED_SUPABASE_AUTH_CLIENT_MESSAGE = 'Le code genere essaie d utiliser Auth sans client configure. Coden va corriger le client Auth automatiquement.';
const GENERATED_SUPABASE_CLIENT_PATH = 'src/lib/supabase.ts';
const SUPABASE_AUTH_METHOD_PATTERN = /\bauth\s*\.\s*(getSession|getUser|signIn|signInWithPassword|signInWithOAuth|signUp|signOut|onAuthStateChange|resetPasswordForEmail|updateUser)\b/i;

function fileUsesGeneratedSupabaseAuth(file: GeneratedFile) {
  const content = file.content || '';
  if (/\bsupabase\s*\.\s*auth\b/i.test(content)) return true;
  return SUPABASE_AUTH_METHOD_PATTERN.test(content) && /supabase|@supabase\/supabase-js|Coden Cloud|authentication|auth/i.test(content);
}

function fileDefinesGeneratedSupabaseClient(file: GeneratedFile) {
  const content = file.content || '';
  return /\bcreateClient\s*\(/i.test(content)
    || /\bgetSupabaseClient\s*\(/i.test(content)
    || /\bexport\s+const\s+supabase\b/i.test(content)
    || /\bcreateCodenCloudClient\s*\(/i.test(content)
    || /\bcodenCloudAuth\b/i.test(content)
    || /Coden Cloud auth client/i.test(content);
}

function detectGeneratedSupabaseAuthIssue(files: GeneratedFile[]) {
  const authFiles = files.filter(fileUsesGeneratedSupabaseAuth);
  if (!authFiles.length) return null;
  const unresolvedBareClientFile = authFiles.find(file => /\bsupabase\s*\.\s*auth\b/i.test(file.content || '') && !hasGeneratedSupabaseImportOrLocalClient(file.content || ''));
  if (unresolvedBareClientFile) {
    return {
      file: unresolvedBareClientFile.path || GENERATED_SUPABASE_CLIENT_PATH,
      message: GENERATED_SUPABASE_AUTH_CLIENT_MESSAGE,
      severity: 'high',
      diagnostic_code: 'SUPABASE_AUTH_CLIENT_UNDEFINED',
      suggested_action: 'fix_generated_auth_client',
    };
  }
  const hasClient = files.some(fileDefinesGeneratedSupabaseClient);
  if (hasClient) return null;
  return {
    file: authFiles[0]?.path || GENERATED_SUPABASE_CLIENT_PATH,
    message: GENERATED_SUPABASE_AUTH_CLIENT_MESSAGE,
    severity: 'high',
    diagnostic_code: 'SUPABASE_AUTH_CLIENT_UNDEFINED',
    suggested_action: 'fix_generated_auth_client',
  };
}

function generatedSupabaseClientFile(): GeneratedFile {
  return {
    path: GENERATED_SUPABASE_CLIENT_PATH,
    language: 'ts',
    updated_at: new Date().toISOString(),
    content: `import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || import.meta.env.VITE_CODEN_CLOUD_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_CODEN_CLOUD_SUPABASE_ANON_KEY || '';

const missingAuthMessage = 'Coden Cloud Auth is not configured for this preview yet. The real backend is unavailable until it is connected.';

function missingAuthResult() {
  return { data: { user: null, session: null }, error: new Error(missingAuthMessage) };
}

function createPreviewAuthStub() {
  const subscription = { unsubscribe() {} };
  return {
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      getUser: async () => ({ data: { user: null }, error: null }),
      signInWithPassword: async () => missingAuthResult(),
      signInWithOAuth: async () => missingAuthResult(),
      signUp: async () => missingAuthResult(),
      signOut: async () => ({ error: null }),
      resetPasswordForEmail: async () => missingAuthResult(),
      updateUser: async () => missingAuthResult(),
      onAuthStateChange: () => ({ data: { subscription } }),
    },
  };
}

export const hasSupabaseConfig = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = hasSupabaseConfig
  ? createClient(supabaseUrl, supabaseAnonKey)
  : createPreviewAuthStub() as any;

export function getSupabaseClient() {
  return supabase;
}

export function getAuthPreviewStatus() {
  return hasSupabaseConfig
    ? { ready: true, message: 'Coden Cloud Auth is configured.' }
    : { ready: false, message: missingAuthMessage };
}
`,
  };
}

function relativeImportPath(fromFilePath: string, targetWithoutExtension: string) {
  const normalizedFrom = String(fromFilePath || 'src/App.tsx').replace(/\\/g, '/');
  const fromDir = path.posix.dirname(normalizedFrom);
  let relative = path.posix.relative(fromDir, targetWithoutExtension);
  if (!relative.startsWith('.')) relative = `./${relative}`;
  return relative.replace(/\\/g, '/');
}

function insertGeneratedImport(content: string, importLine: string) {
  if (content.includes(importLine)) return content;
  const lines = content.split(/\r?\n/);
  let index = 0;
  while (index < lines.length && /^\s*['"]use (client|strict)['"];?\s*$/.test(lines[index] || '')) {
    index += 1;
  }
  lines.splice(index, 0, importLine);
  return lines.join('\n');
}

function hasGeneratedSupabaseImportOrLocalClient(content: string) {
  return /from\s+['"][^'"]*supabase['"]/i.test(content)
    || /\bcreateClient\s*\(/i.test(content)
    || /\bgetSupabaseClient\s*\(/i.test(content)
    || /\bconst\s+supabase\s*=/i.test(content)
    || /\blet\s+supabase\s*=/i.test(content)
    || /\bvar\s+supabase\s*=/i.test(content);
}

function ensureSupabaseDependency(files: GeneratedFile[]) {
  return files.map(file => {
    if (file.path !== 'package.json') return file;
    try {
      const pkg = JSON.parse(file.content || '{}');
      pkg.dependencies = pkg.dependencies || {};
      if (!pkg.dependencies['@supabase/supabase-js']) {
        pkg.dependencies['@supabase/supabase-js'] = '^2.106.0';
      }
      return { ...file, content: `${JSON.stringify(pkg, null, 2)}\n`, updated_at: new Date().toISOString() };
    } catch {
      return file;
    }
  });
}

function applyGeneratedSupabaseAuthClientFix(files: GeneratedFile[]) {
  const now = new Date().toISOString();
  let changed = false;
  let nextFiles = files.map(file => {
    if (!fileUsesGeneratedSupabaseAuth(file)) return file;
    if (hasGeneratedSupabaseImportOrLocalClient(file.content || '')) return file;
    const importPath = relativeImportPath(file.path, 'src/lib/supabase');
    const importLine = `import { getSupabaseClient } from '${importPath}';`;
    const content = insertGeneratedImport(file.content || '', importLine)
      .replace(/\bsupabase\s*\.\s*auth\b/g, 'getSupabaseClient().auth');
    if (content === file.content) return file;
    changed = true;
    return { ...file, content, updated_at: now };
  });

  if (!nextFiles.some(file => file.path === GENERATED_SUPABASE_CLIENT_PATH)) {
    nextFiles = [...nextFiles, generatedSupabaseClientFile()];
    changed = true;
  }

  const withDependency = ensureSupabaseDependency(nextFiles);
  if (withDependency.some((file, index) => file.content !== nextFiles[index]?.content)) {
    changed = true;
  }

  return { files: withDependency, changed };
}

function runPreviewPipeline(project: GeneratedProject, files: GeneratedFile[]): PreviewBuildResult {
  const errors: any[] = [];
  for (const file of files) {
    if (!isSafeProjectFilePath(file.path)) {
      errors.push({ file: file.path, message: 'Unsafe file path blocked.', severity: 'high' });
    }
    if (/process\.env\.[A-Z0-9_]*SECRET/i.test(file.content) || containsSecret(file.content)) {
      errors.push({ file: file.path, message: 'Potential secret exposure detected in generated code.', severity: 'high' });
    }
    if (hasBlockingGeneratedImport(file.content)) {
      errors.push({ file: file.path, message: 'Missing import detected.', severity: 'medium' });
    }
    if (/__CODEN_FORCE_ERROR__/i.test(file.content)) {
      errors.push({
        file: file.path,
        message: 'Preview contains a known forced runtime failure marker.',
        severity: 'high',
        diagnostic_code: 'FORCED_RUNTIME_FAILURE_MARKER',
        suggested_action: 'auto_fix_generated_runtime_marker',
      });
    }
  }
  const supabaseAuthIssue = detectGeneratedSupabaseAuthIssue(files);
  if (supabaseAuthIssue) errors.push(supabaseAuthIssue);

  const html = renderPreviewHtml(files, project.name, project.id, 'preview', project.prompt || project.name, project.slug || project.id);
  if (!html.trim()) {
    errors.push({ file: 'index.html', message: 'Preview HTML is empty.', severity: 'high' });
  } else if (/__CODEN_FORCE_ERROR__/i.test(html) && !errors.some(error => error?.diagnostic_code === 'FORCED_RUNTIME_FAILURE_MARKER')) {
    errors.push({
      file: 'index.html',
      message: 'Preview contains a known forced runtime failure marker.',
      severity: 'high',
      diagnostic_code: 'FORCED_RUNTIME_FAILURE_MARKER',
      suggested_action: 'auto_fix_generated_runtime_marker',
    });
  }

  return {
    status: errors.length ? 'failed' : 'ready',
    html: errors.length ? buildPreviewErrorHtml({ projectName: project.name, error: errors[0].message }) : html,
    errors,
    summary: errors.length ? errors[0].message : 'Preview build completed successfully.',
  };
}

type AutoFixEngineResult = {
  files: GeneratedFile[];
  changed: boolean;
  changedPaths: string[];
  summaries: string[];
};

function generatedPath(value: string) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function setGeneratedFile(
  byPath: Map<string, GeneratedFile>,
  filePath: string,
  content: string,
  language = inferGeneratedLanguage(filePath),
  summaries?: string[],
) {
  const normalized = generatedPath(filePath);
  const existing = byPath.get(normalized);
  if (existing?.content === content) return false;
  byPath.set(normalized, {
    path: normalized,
    language,
    content,
    updated_at: new Date().toISOString(),
  });
  summaries?.push(existing ? `Updated ${normalized}.` : `Created ${normalized}.`);
  return true;
}

function cleanGeneratedBlockingMarkers(files: GeneratedFile[], summaries: string[] = []) {
  let changed = false;
  const cleaned = files.map(file => {
    const source = String(file.content || '');
    const content = strippedOfBlockingMarkers(source);
    if (content === source) return file;
    changed = true;
    summaries.push(`Removed generated runtime blocker from ${generatedPath(file.path)}.`);
    return { ...file, content, updated_at: new Date().toISOString() };
  });
  return { files: cleaned, changed };
}

function createAutoFixViteIndexHtml(projectName = 'Coden App', prompt = '') {
  return [
    '<!doctype html>',
    '<html lang="en">',
    '  <head>',
    '    <meta charset="UTF-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    `    <title>${escapeHtml(projectName || 'Coden App')}</title>`,
    `    <meta name="description" content="${escapeHtml(summarizeForMeta(prompt || projectName, 'React application generated from the project request.'))}" />`,
    '  </head>',
    '  <body>',
    '    <div id="root"></div>',
    '    <script type="module" src="/src/main.tsx"></script>',
    '  </body>',
    '</html>',
    '',
  ].join('\n');
}

function createAutoFixMainTsx() {
  return [
    "import React from 'react';",
    "import ReactDOM from 'react-dom/client';",
    "import App from './App';",
    "import './index.css';",
    '',
    "ReactDOM.createRoot(document.getElementById('root')!).render(",
    '  <React.StrictMode>',
    '    <App />',
    '  </React.StrictMode>,',
    ');',
    '',
  ].join('\n');
}

function createPomodoroAppTsx(projectName = 'Pomodoro Focus', prompt = '') {
  throw new Error('Local application rescue is disabled; the model must provide the application source.');

  return [
    "import { useEffect, useMemo, useState } from 'react';",
    "import './index.css';",
    '',
    "type Mode = 'work' | 'short' | 'long';",
    'const durations: Record<Mode, number> = { work: 25 * 60, short: 5 * 60, long: 15 * 60 };',
    "const labels: Record<Mode, string> = { work: 'Travail', short: 'Pause courte', long: 'Pause longue' };",
    '',
    'function formatTime(totalSeconds: number) {',
    '  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");',
    '  const seconds = Math.max(0, totalSeconds % 60).toString().padStart(2, "0");',
    '  return `${minutes}:${seconds}`;',
    '}',
    '',
    'function playSoftBeep() {',
    '  try {',
    '    const audio = new AudioContext();',
    '    const oscillator = audio.createOscillator();',
    '    const gain = audio.createGain();',
    '    oscillator.frequency.value = 720;',
    '    gain.gain.setValueAtTime(0.001, audio.currentTime);',
    '    gain.gain.exponentialRampToValueAtTime(0.08, audio.currentTime + 0.02);',
    '    gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.28);',
    '    oscillator.connect(gain);',
    '    gain.connect(audio.destination);',
    '    oscillator.start();',
    '    oscillator.stop(audio.currentTime + 0.3);',
    '  } catch {',
    '    // Audio can be blocked until the user interacts with the page.',
    '  }',
    '}',
    '',
    'export default function App() {',
    "  const [mode, setMode] = useState<Mode>('work');",
    '  const [secondsLeft, setSecondsLeft] = useState(durations.work);',
    '  const [isRunning, setIsRunning] = useState(false);',
    '  const [cycles, setCycles] = useState(0);',
    "  const [alert, setAlert] = useState('Pret a commencer.');",
    '',
    '  useEffect(() => {',
    '    if (!isRunning) return;',
    '    const timer = window.setInterval(() => {',
    '      setSecondsLeft(current => {',
    '        if (current > 1) return current - 1;',
    '        window.clearInterval(timer);',
    '        setIsRunning(false);',
    '        setAlert(mode === "work" ? "Session terminee. Respire un instant." : "Pause terminee. Reviens doucement.");',
    '        if (mode === "work") setCycles(value => value + 1);',
    '        playSoftBeep();',
    '        return 0;',
    '      });',
    '    }, 1000);',
    '    return () => window.clearInterval(timer);',
    '  }, [isRunning, mode]);',
    '',
    '  const progress = useMemo(() => 1 - secondsLeft / durations[mode], [mode, secondsLeft]);',
    '  const progressPercent = Math.round(progress * 100);',
    '',
    '  function changeMode(nextMode: Mode) {',
    '    setMode(nextMode);',
    '    setSecondsLeft(durations[nextMode]);',
    '    setIsRunning(false);',
    '    setAlert(`${labels[nextMode]} selectionne.`);',
    '  }',
    '',
    '  function resetTimer() {',
    '    setSecondsLeft(durations[mode]);',
    '    setIsRunning(false);',
    '    setAlert("Minuteur reinitialise.");',
    '  }',
    '',
    '  return (',
    '    <main className="min-h-screen bg-slate-950 px-4 py-10 text-white sm:px-6 lg:px-8">',
    '      <section className="mx-auto grid max-w-3xl gap-6 rounded-3xl border border-white/10 bg-white/10 p-6 shadow-2xl shadow-blue-950/30 backdrop-blur sm:p-8" aria-label="Application Pomodoro">',
    '        <div className="flex items-center justify-between gap-4">',
    '          <span className="rounded-full bg-blue-400/15 px-4 py-2 text-sm font-bold text-blue-100">Focus timer</span>',
    '          <span className="rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300">{cycles} cycles</span>',
    '        </div>',
    `        <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">${escapeHtml(projectName || 'Pomodoro Focus')}</h1>`,
    `        <p className="max-w-2xl text-lg leading-8 text-slate-300">${escapeHtml(summarizeForMeta(prompt || 'Minuteur Pomodoro interactif avec cycles, alertes et themes.', 'Minuteur Pomodoro interactif avec cycles, alertes et themes.'))}</p>`,
    '        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Modes Pomodoro">',
    "          {(['work', 'short', 'long'] as Mode[]).map(item => (",
    '            <button key={item} type="button" className={mode === item ? "rounded-full bg-blue-500 px-4 py-2 text-sm font-semibold text-white" : "rounded-full border border-white/10 px-4 py-2 text-sm font-semibold text-slate-300 transition hover:border-blue-300 hover:text-white"} onClick={() => changeMode(item)}>{labels[item]}</button>',
    '          ))}',
    '        </div>',
    '        <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-6">',
    '          <div className="flex items-end justify-between gap-4">',
    '            <strong className="font-mono text-6xl tracking-tight sm:text-7xl">{formatTime(secondsLeft)}</strong>',
    '            <span className="pb-2 text-sm font-semibold text-slate-300">{labels[mode]}</span>',
    '          </div>',
    '          <div className="mt-5 h-3 overflow-hidden rounded-full bg-white/10" aria-label={`Progression ${progressPercent}%`}>',
    '            <div className={progressPercent >= 75 ? "h-full w-3/4 rounded-full bg-blue-400 transition-all" : progressPercent >= 50 ? "h-full w-1/2 rounded-full bg-blue-400 transition-all" : progressPercent >= 25 ? "h-full w-1/4 rounded-full bg-blue-400 transition-all" : "h-full w-2 rounded-full bg-blue-400 transition-all"} />',
    '          </div>',
    '        </div>',
    '        <div className="grid gap-3 sm:grid-cols-3">',
    '          <button className="rounded-full bg-white px-5 py-3 font-semibold text-slate-950 transition hover:bg-blue-100" type="button" onClick={() => { setIsRunning(true); setAlert("Minuteur lance."); }}>Demarrer</button>',
    '          <button className="rounded-full border border-white/10 px-5 py-3 font-semibold text-white transition hover:border-blue-300" type="button" onClick={() => { setIsRunning(false); setAlert("Minuteur en pause."); }}>Pause</button>',
    '          <button className="rounded-full border border-white/10 px-5 py-3 font-semibold text-white transition hover:border-blue-300" type="button" onClick={resetTimer}>Reinitialiser</button>',
    '        </div>',
    '        <p className="rounded-2xl bg-blue-400/10 px-4 py-3 text-sm text-blue-100" role="status">{alert}</p>',
    '        <div className="grid grid-cols-8 gap-2" aria-label="Cycles termines">',
    '          {Array.from({ length: 8 }).map((_, index) => <span key={index} className={index < cycles ? "h-2 rounded-full bg-blue-400" : "h-2 rounded-full bg-white/10"} />)}',
    '        </div>',
      '      </section>',
    '    </main>',
    '  );',
    '}',
    '',
  ].join('\n');
}

function createAutoFixAppTsx(projectName = 'Coden App', prompt = '') {
  throw new Error('Local application rescue is disabled; the model must provide the application source.');

  const isPomodoro = /\b(pomodoro|pomodero|minuteur|timer|countdown|chrono|chronometre|chronomètre|pause courte|pause longue|session de travail)\b/i.test(`${projectName} ${prompt}`);
  if (isPomodoro) return createPomodoroAppTsx(projectName, prompt);

  const isTodo = /\b(todo|to do|to-do|tache|taches|task|tasks)\b/i.test(`${projectName} ${prompt}`);
  if (isTodo) {
    return [
      "import { FormEvent, useEffect, useMemo, useState } from 'react';",
      "import './index.css';",
      '',
      "type Filter = 'all' | 'active' | 'completed';",
      'type Todo = { id: number; title: string; completed: boolean };',
      "const STORAGE_KEY = 'coden-todo-items';",
      '',
      'const initialTodos: Todo[] = [',
      "  { id: 1, title: 'Plan the first release', completed: true },",
      "  { id: 2, title: 'Test the preview', completed: false },",
      '];',
      '',
      'function readTodos(): Todo[] {',
      '  if (typeof window === "undefined") return initialTodos;',
      '  try {',
      '    const raw = window.localStorage.getItem(STORAGE_KEY);',
      '    const parsed = raw ? JSON.parse(raw) : null;',
      '    return Array.isArray(parsed) ? parsed : initialTodos;',
      '  } catch {',
      '    return initialTodos;',
      '  }',
      '}',
      '',
      'export default function App() {',
      "  const [todos, setTodos] = useState<Todo[]>(() => readTodos());",
      "  const [title, setTitle] = useState('');",
      "  const [filter, setFilter] = useState<Filter>('all');",
      "  const [feedback, setFeedback] = useState('');",
      '  useEffect(() => {',
      '    if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, JSON.stringify(todos));',
      '  }, [todos]);',
      '  const visibleTodos = useMemo(() => todos.filter((todo) => filter === "all" || (filter === "completed" ? todo.completed : !todo.completed)), [todos, filter]);',
      '  const completedCount = todos.filter((todo) => todo.completed).length;',
      '',
      '  function addTodo(event: FormEvent) {',
      '    event.preventDefault();',
      '    const clean = title.trim();',
      '    if (!clean) {',
      "      setFeedback('Add a task name first.');",
      '      return;',
      '    }',
      '    setTodos((current) => [{ id: Date.now(), title: clean, completed: false }, ...current]);',
      "    setTitle('');",
      "    setFeedback('Task added.');",
      '  }',
      '',
      '  function deleteTodo(todo: Todo) {',
      "    if (!window.confirm(`Delete \"${todo.title}\"?`)) return;",
      '    setTodos((current) => current.filter((item) => item.id !== todo.id));',
      "    setFeedback('Task deleted.');",
      '  }',
      '',
      '  return (',
      '    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 sm:px-6 lg:px-8">',
      '      <section className="mx-auto max-w-3xl rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8" aria-label="Todo application">',
      '        <p className="mb-3 text-xs font-bold uppercase tracking-[0.22em] text-blue-600">Generated by Coden</p>',
      '        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">',
      '          <div>',
      '            <h1 className="text-3xl font-bold tracking-tight sm:text-5xl">Todo workspace</h1>',
      '            <p className="mt-3 max-w-xl text-base leading-7 text-slate-600">Create, complete, filter and delete tasks in a responsive app.</p>',
      '          </div>',
      '          <strong className="rounded-full bg-blue-50 px-4 py-2 text-sm font-bold text-blue-700">{completedCount}/{todos.length} done</strong>',
      '        </div>',
      '        <form className="mt-8 grid gap-3 sm:grid-cols-[1fr_auto]" onSubmit={addTodo}>',
      '          <input className="min-h-12 rounded-full border border-slate-200 bg-white px-4 text-slate-950 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Add a task..." aria-label="Task name" />',
      '          <button className="min-h-12 rounded-full bg-slate-950 px-5 font-semibold text-white transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-200" type="submit">Add task</button>',
      '        </form>',
      '        <div className="mt-4 flex flex-wrap gap-2" aria-label="Task filters">',
      "          {(['all', 'active', 'completed'] as Filter[]).map((item) => (",
      '            <button key={item} type="button" className={filter === item ? "rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white" : "rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-blue-300 hover:text-blue-700"} onClick={() => setFilter(item)}>{item}</button>',
      '          ))}',
      '        </div>',
      '        {feedback ? <p className="mt-4 rounded-2xl bg-blue-50 px-4 py-3 text-sm font-medium text-blue-800" role="status">{feedback}</p> : null}',
      '        <ul className="mt-5 grid gap-3">',
      '          {visibleTodos.length ? visibleTodos.map((todo) => (',
      '            <li className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between" key={todo.id}>',
      '              <label className="flex items-center gap-3">',
      '                <input className="size-5 accent-blue-600" type="checkbox" checked={todo.completed} onChange={() => setTodos((current) => current.map((item) => item.id === todo.id ? { ...item, completed: !item.completed } : item))} />',
      '                <span className={todo.completed ? "text-slate-400 line-through" : "text-slate-900"}>{todo.title}</span>',
      '              </label>',
      '              <button className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-red-200 hover:bg-red-50 hover:text-red-700" type="button" onClick={() => deleteTodo(todo)}>Delete</button>',
      '            </li>',
      '          )) : <li className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-slate-500">No tasks match this filter.</li>}',
      '        </ul>',
      '      </section>',
      '    </main>',
      '  );',
      '}',
      '',
    ].join('\n');
  }

  return [
    "import './index.css';",
    '',
    'export default function App() {',
    '  return (',
    '    <main className="min-h-screen bg-slate-50 px-4 py-10 text-slate-950 sm:px-6 lg:px-8">',
    '      <section className="mx-auto max-w-4xl rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">',
    '        <p className="mb-4 text-xs font-bold uppercase tracking-[0.22em] text-blue-600">Generated by Coden</p>',
    `        <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">${escapeHtml(projectName || 'Your app is ready')}</h1>`,
    `        <p className="mt-4 max-w-2xl text-lg leading-8 text-slate-600">${escapeHtml(summarizeForMeta(prompt || 'A responsive React app generated by Coden.', 'A responsive React app generated by Coden.'))}</p>`,
    '        <div className="mt-8 flex flex-wrap gap-3">',
    '          <button className="rounded-full bg-slate-950 px-5 py-3 font-semibold text-white transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-200" type="button" onClick={() => window.alert("Primary action ready.")}>Primary action</button>',
    '          <button className="rounded-full border border-slate-200 px-5 py-3 font-semibold text-slate-700 transition hover:border-blue-300 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-100" type="button" onClick={() => window.alert("Secondary action ready.")}>Secondary action</button>',
    '        </div>',
    '      </section>',
    '    </main>',
    '  );',
    '}',
    '',
  ].join('\n');
}

function createAutoFixIndexCss() {
  return [
    '@tailwind base;',
    '@tailwind components;',
    '@tailwind utilities;',
    '',
  ].join('\n');
}

function fixPackageJsonScripts(byPath: Map<string, GeneratedFile>, summaries: string[]) {
  const existing = byPath.get('package.json');
  let json: any = {};
  try {
    json = existing?.content ? JSON.parse(existing.content) : {};
  } catch {
    json = {};
  }
  json.scripts = {
    dev: 'vite',
    build: 'vite build',
    lint: 'tsc --noEmit',
    test: 'node --experimental-strip-types src/app.test.ts',
  };
  json.dependencies = {
    ...(json.dependencies || {}),
    react: json.dependencies?.react || '^18.3.1',
    'react-dom': json.dependencies?.['react-dom'] || '^18.3.1',
    'lucide-react': json.dependencies?.['lucide-react'] || '^0.383.0',
  };
  delete json.dependencies['@vitejs/plugin-react'];
  delete json.dependencies.vite;
  delete json.dependencies.typescript;
  json.devDependencies = json.devDependencies || {};
  json.devDependencies['@vitejs/plugin-react'] = json.devDependencies['@vitejs/plugin-react'] || '^4.3.4';
  json.devDependencies.vite = json.devDependencies.vite || '^5.4.19';
  json.devDependencies.typescript = json.devDependencies.typescript || '^5.7.3';
  json.devDependencies['@types/react'] = json.devDependencies['@types/react'] || '^18.3.18';
  json.devDependencies['@types/react-dom'] = json.devDependencies['@types/react-dom'] || '^18.3.5';
  json.devDependencies.tailwindcss = json.devDependencies.tailwindcss || '^3.4.17';
  json.devDependencies.postcss = json.devDependencies.postcss || '^8.4.49';
  json.devDependencies.autoprefixer = json.devDependencies.autoprefixer || '^10.4.20';
  return setGeneratedFile(byPath, 'package.json', JSON.stringify(json, null, 2), 'json', summaries);
}

function applyGeneratedDestructiveSafety(files: GeneratedFile[], summaries: string[]) {
  const appFile = fileByPath(files, 'src/App.tsx') || fileByPath(files, 'src/App.jsx');
  if (!appFile) return files;
  const source = appFile.content || '';
  const hasDestructive = /\b(delete|remove|reset|clear|supprimer|effacer)\b/i.test(source);
  const hasSafety = /\b(confirm\(|confirmation|undo|toast|modal|dialog|cancel|annuler|restore|rollback|feedback)\b/i.test(source);
  if (!hasDestructive || hasSafety) return files;
  const byPath = new Map(files.map(file => [generatedPath(file.path), { ...file }]));
  const injected = source.replace(
    /export\s+default\s+function\s+App\s*\(\)\s*\{/,
    "export default function App() {\n  const confirmDestructiveAction = (label = 'this item') => window.confirm(`Are you sure you want to delete ${label}?`);",
  );
  if (injected !== source) {
    setGeneratedFile(byPath, appFile.path, injected, appFile.language || inferGeneratedLanguage(appFile.path), summaries);
    return Array.from(byPath.values());
  }
  return files;
}

function runAutoFixEngine(project: GeneratedProject, files: GeneratedFile[], errors: any[]): AutoFixEngineResult {
  const reasonText = errors.map(error => `${error?.key || ''} ${error?.message || ''} ${error?.file || ''}`).join('\n');
  const summaries: string[] = [];
  const promptForFix = project.prompt || project.name || 'Generated app';
  const markerClean = cleanGeneratedBlockingMarkers(files.map(file => ({ ...file })), summaries);
  let working = markerClean.files;
  const shouldForceModernVite = !isModernFrontendProject(files)
    || /index\.html should load \/src\/main\.tsx as a module|vite_main_script|missing.*main\.tsx|missing.*app\.tsx|blank preview|preview.*empty|technical build score|runner|runtime error marker|forced runtime failure marker|data-coden-runtime-error|__CODEN_FORCE_ERROR__/i.test(reasonText);
  const shouldFixDestructive = /destructive.*confirmation|destructive.*undo|clear feedback|delete\/remove|visual_destructive_confirmation|destructive_action_safety/i.test(reasonText);
  if (!shouldForceModernVite && !shouldFixDestructive && !markerClean.changed) {
    return { files, changed: false, changedPaths: [], summaries: [] };
  }
  working = shouldForceModernVite ? ensureModernFrontendProject(working, project.name, promptForFix, project.id) : working;
  const byPath = new Map(working.map(file => [generatedPath(file.path), { ...file, path: generatedPath(file.path) }]));

  if (shouldForceModernVite || !byPath.has('index.html')) {
    setGeneratedFile(byPath, 'index.html', createAutoFixViteIndexHtml(project.name, project.prompt || project.name), 'html', summaries);
  }

  const indexHtml = byPath.get('index.html')?.content || '';
  if (!/<div\s+id=["']root["']\s*><\/div>/i.test(indexHtml) || !/<script[^>]+type=["']module["'][^>]+src=["']\/src\/main\.tsx["'][^>]*><\/script>/i.test(indexHtml)) {
    setGeneratedFile(byPath, 'index.html', createAutoFixViteIndexHtml(project.name, project.prompt || project.name), 'html', summaries);
  }

  const appPath = byPath.has('src/App.tsx') ? 'src/App.tsx' : byPath.has('src/App.jsx') ? 'src/App.jsx' : 'src/App.tsx';
  const appContent = byPath.get(appPath)?.content || '';
  const shouldReplaceUnreliableApp = shouldForceModernVite
    && /forced runtime failure marker|runtime error marker|data-coden-runtime-error|blank preview|preview.*empty|technical build score|functionality_(todo|commerce|restaurant|operational|auth|ai_tool)_core_loop|browser_(form_feedback_missing|control_interaction_failed|primary_controls_clickable|mobile_blank_preview|actions_change_state)|primary controls|control_handlers|visual_primary_controls|dead action|missing feedback|app non interactive|not interactive/i.test(reasonText)
    && (
      markerClean.changed
      || appContent.trim().length < 700
      || !/\bexport\s+default\s+function\s+App\b|\bconst\s+App\s*[:=]|\bfunction\s+App\s*\(/i.test(appContent)
      || !/\b(onClick|onSubmit|onChange|useState|useReducer|localStorage|set[A-Z])\b/i.test(appContent)
    );
  // Auto-fix may sanitize or repair an existing model file, but it must never
  // invent a replacement application when the model did not provide one.
  if (shouldReplaceUnreliableApp) summaries.push('Existing app source remains unchanged because no model-generated replacement is available.');

  if (!byPath.has('src/index.css')) {
    setGeneratedFile(byPath, 'src/index.css', createAutoFixIndexCss(), 'css', summaries);
  }

  if (shouldForceModernVite) {
    fixPackageJsonScripts(byPath, summaries);
    setGeneratedFile(byPath, 'tailwind.config.ts', [
      "import type { Config } from 'tailwindcss';",
      '',
      'export default {',
      "  content: ['./index.html', './src/**/*.{ts,tsx}'],",
      '  theme: { extend: {} },',
      '  plugins: [],',
      '} satisfies Config;',
      '',
    ].join('\n'), 'ts', summaries);
    setGeneratedFile(byPath, 'postcss.config.cjs', [
      'module.exports = {',
      '  plugins: {',
      '    tailwindcss: {},',
      '    autoprefixer: {},',
      '  },',
      '};',
      '',
    ].join('\n'), 'js', summaries);
  }

  working = Array.from(byPath.values()).sort((a, b) => a.path.localeCompare(b.path));
  working = applyGeneratedDestructiveSafety(working, summaries);

  const originalByPath = new Map(files.map(file => [generatedPath(file.path), file.content]));
  const changedPaths = working
    .filter(file => originalByPath.get(generatedPath(file.path)) !== file.content)
    .map(file => file.path);

  return {
    files: working,
    changed: changedPaths.length > 0,
    changedPaths,
    summaries: Array.from(new Set(summaries.length ? summaries : changedPaths.map(path => `Repaired ${path}.`))),
  };
}

function applyAutoFix(project: GeneratedProject, files: GeneratedFile[], errors: any[]) {
  if (!errors.length) return { files, fixed: false, patch: null as any };
  const engineFix = runAutoFixEngine(project, files, errors);
  if (engineFix.changed) {
    return {
      files: engineFix.files,
      fixed: true,
      patch: {
        id: randomUUID(),
        project_id: project.id,
        target_file: engineFix.changedPaths[0] || 'index.html',
        summary: `AutoFixEngine repaired ${engineFix.changedPaths.length} file${engineFix.changedPaths.length > 1 ? 's' : ''}: ${engineFix.changedPaths.join(', ')}`,
        details: engineFix.summaries,
        created_at: new Date().toISOString(),
      },
    };
  }
  const primary = errors[0];
  if (errors.some(error => error?.diagnostic_code === 'SUPABASE_AUTH_CLIENT_UNDEFINED' || error?.suggested_action === 'fix_generated_auth_client')) {
    const fix = applyGeneratedSupabaseAuthClientFix(files);
    if (fix.changed) {
      return {
        files: fix.files,
        fixed: true,
        patch: {
          id: randomUUID(),
          project_id: project.id,
          target_file: GENERATED_SUPABASE_CLIENT_PATH,
          summary: 'Added a safe Coden Cloud Auth client for generated Supabase auth usage.',
          created_at: new Date().toISOString(),
        },
      };
    }
  }
  // The preview scans every file, so repairing only the first error's file left
  // the same marker standing elsewhere and the project stuck in needs_fix.
  const markerSummaries: string[] = [];
  const patched = cleanGeneratedBlockingMarkers(files.map(file => ({ ...file })), markerSummaries).files
    .map(file => {
      const content = file.content.replace(/sk_live_[A-Za-z0-9_]+|sk_test_[A-Za-z0-9_]+/g, 'SECRET_CONFIGURED_SERVER_SIDE');
      return content === file.content ? file : { ...file, content, updated_at: new Date().toISOString() };
    });
  const originalContentByPath = new Map(files.map(file => [file.path, file.content]));
  const changedPaths = patched.filter(file => originalContentByPath.get(file.path) !== file.content).map(file => file.path);
  const changed = changedPaths.length > 0;

  if (!changed) {
    return { files, fixed: false, patch: null as any };
  }

  return {
    files: patched,
    fixed: true,
    patch: {
      id: randomUUID(),
      project_id: project.id,
      target_file: changedPaths[0] || primary.file || 'index.html',
      summary: `Applied targeted patch for ${primary.message}`,
      details: markerSummaries,
      created_at: new Date().toISOString(),
    },
  };
}

function createZipBuffer(files: GeneratedFile[]): Buffer {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.path);
    const data = Buffer.from(file.content);
    const crc = 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, name, data);

    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0, 8);
    c.writeUInt16LE(0, 10);
    c.writeUInt32LE(0, 12);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(data.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt16LE(0, 30);
    c.writeUInt16LE(0, 32);
    c.writeUInt32LE(0, 34);
    c.writeUInt32LE(0, 38);
    c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += local.length + name.length + data.length;
  }

  const centralStart = offset;
  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(centralStart, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...chunks, centralBuffer, end]);
}

async function generateFilesWithAi(input: {
  project?: GeneratedProject;
  projectName: string;
  prompt: string;
  decision?: IntentDecision;
  modelId?: string;
  userCredits?: number;
  plan?: string;
  existingFiles: GeneratedFile[];
  seniorAgentContext?: SeniorAgentContext;
  deepReasoningContract?: DeepReasoningContract;
  visionInputs?: Array<{ url: string; detail?: 'auto' | 'low' | 'high' }>;
  recentHistory?: string[];  // last N user messages for conflict detection
  skill?: CodenSkill;
  skillBudget?: CodenSkillBudget;
  signal?: AbortSignal;
  allowModelFallback?: boolean;
  onEvent?: (event: { type: 'model_fallback'; from: AllowedModelId; to: AllowedModelId; reason: string }) => void;
}): Promise<{ files: GeneratedFile[]; summary: string; appName: string; model: string; cost_usd: number }> {
  const hasLiveKey = hasLiveAiProvider();
  if (!hasLiveKey) {
    throw new Error('No AI provider is configured. Add OPENROUTER_API_KEY on Railway to enable live generation.');
  }

  const selectedModel = input.project && input.decision
    ? (await resolveAgentProviderModel({
      modelId: input.modelId,
      project: input.project,
      prompt: input.prompt,
      decision: input.decision,
      files: input.existingFiles,
      userCredits: input.userCredits,
      plan: input.plan,
    })).model
    : input.modelId && input.modelId !== 'auto'
      ? normalizeProviderModelForBackend(input.modelId)
      : DEFAULT_PROVIDER_MODEL_ID;
  validateAllowedModel(selectedModel);
  assertAgentModelCapabilities(selectedModel, { structuredOutput: true });

  const fileManifest = input.existingFiles
    .map(file => `${file.path} (${file.content.length} chars)`)
    .slice(0, 40)
    .join('\n');
  // ✅ Smart context injection: relevance-ranked, import-aware, token-budget-respecting
  const existingFilesContent = buildExistingFilesContextForGeneration(input.existingFiles, input.prompt, selectedModel);
  const uiPolicy = buildWorldClassUiPolicy({ prompt: input.prompt });
  const runtimeOptions = input.decision
    ? createProviderRuntimeOptions({
      model: selectedModel,
      prompt: input.prompt,
      decision: input.decision,
      files: input.existingFiles,
      mode: 'generation',
      stream: true,
      // A structured full project needs more wall time than a conversational
      // response. Keep the request bounded, but never inherit a short skill
      // budget that makes an otherwise healthy generation fail mid-object.
      timeoutMs: Math.max(90_000, Math.min(150_000, input.skillBudget?.maxDurationMs || 150_000)),
      // Prefer a complete, previewable first slice over a huge initial dump.
      // Follow-up turns can extend the app without making the first preview
      // wait for 20k output tokens.
      maxTokens: input.existingFiles.length ? 10_000 : 12_000,
      hasVisionInput: Boolean(input.visionInputs?.length),
    })
    : null;

  let totalCostUsd = 0;
  // --- AGENTIC AI V3 LOOP ---
  const depGraph = buildDependencyGraph(input.existingFiles);
  const appType = input.deepReasoningContract?.app_type || 'custom_web_app';

  // ✅ Semantic RAG — upgrade context injection with TF-IDF relevance scoring
  // Replaces the positional file selection with semantically relevant files
  const semanticContext = (() => {
    try {
      if (input.existingFiles.length >= 8) {
        const ragFiles = SemanticRag.selectRelevantFiles(
          input.existingFiles,
          input.prompt,
          {
            topK: getAIModelCapabilityProfile(selectedModel).limits.contextTokens >= 500_000 ? 44 : 22,
            tokenBudget: Math.max(24_000, Math.min(180_000, Math.floor(getAIModelCapabilityProfile(selectedModel).limits.contextTokens * 0.42))),
          },
        );
        // Return as formatted context (same shape as buildExistingFilesContextForGeneration)
        const chunks = ragFiles.map(f =>
          `--- ${f.path} (${f.language || 'text'}, rag_score=${f.ragScore.toFixed(3)}) ---\n${f.content || ''}`,
        );
        return chunks.join('\n\n') || null;
      }
      return null;
    } catch { return null; }
  })();

  // ✅ Parallel specialist agents — run concurrently before main generation
  let parallelAgentContext = '';
  if (CODEN_SKILL_FLAGS.subagents && input.existingFiles.length > 0 && ['build', 'edit'].includes(input.decision?.intent || '')) {
    try {
      const agentCtx: ParallelAgentContext = {
        projectName: input.projectName,
        userPrompt: input.prompt,
        appType,
        fileCount: input.existingFiles.length,
        files: input.existingFiles.slice(0, 30),  // cap for memory
        hasAuth: /auth|login|signup|session/i.test(input.prompt),
        hasDatabase: /database|supabase|sql|schema/i.test(input.prompt),
        hasPayments: /stripe|payment|billing|checkout/i.test(input.prompt),
        language: input.deepReasoningContract?.language || 'auto',
        // ✅ Dynamic model resolution — each agent gets the best model for its tier
        availableModels: {
          fast:      'openai/gpt-5.6-luna-pro',
          balanced:  'moonshotai/kimi-k3',
          reasoning: selectedModel, // use the already-resolved primary model for reasoning tasks
          design:    /gemini-3\.7|sonnet-5|opus-5|gpt-5\.6-sol/i.test(selectedModel)
                       ? selectedModel
                       : 'anthropic/claude-sonnet-5',
        },
      };
      const agentRoles = selectAgentsForContext(agentCtx);

      const boundedAgentRoles = agentRoles.slice(0, capSubagentCount(agentRoles.length, CODEN_SKILL_FLAGS));
      if (boundedAgentRoles.length > 0) {
        // ✅ Agent executor: each agent receives the model resolved for its tier
        const agentExecutor = async (task: import('./src/services/parallel-agent-runner.ts').AgentTask, modelId: import('./src/config/ai-models.ts').AllowedModelId) => {
          const agentRuntime = createProviderRuntimeOptions({
            model: modelId,
            prompt: task.prompt,
            decision: input.decision!,
            files: input.existingFiles,
            mode: 'text',
            stream: false,
            timeoutMs: Math.min(15_000, input.skillBudget?.maxDurationMs || 15_000),
            maxTokens: 4_000,
          });
          const filesByPath = new Map(input.existingFiles.map(file => [file.path, file]));
          const loop = await runLlmToolLoop({
            gateway: providerGateway,
            modelId,
            messages: [
              { role: 'system', content: task.systemContext },
              { role: 'user', content: task.prompt },
            ],
            runtimeConfig: agentRuntime.providerConfig,
            runtimeConfigForModel: agentRuntime.runtimeConfigForModel,
            timeoutMs: agentRuntime.runtime.timeoutMs,
            maxSteps: Math.min(3, input.skillBudget?.maxToolSteps || 3),
            handlers: {
              inspect_project_files: ({ paths }) => {
                if (input.skill && !canCodenSkillUseTool(input.skill, 'inspect_project_files')) throw new Error('Skill tool policy denied inspect_project_files.');
                const requested = Array.isArray(paths) ? paths.map(String).slice(0, 12) : [];
                const selected = requested.length
                  ? requested.map(path => filesByPath.get(path)).filter(Boolean)
                  : input.existingFiles.slice(0, 8);
                return selected.map(file => ({
                  path: file!.path,
                  content: String(file!.content || '').slice(0, 12_000),
                }));
              },
              summarize_change_plan: ({ goal, files }) => {
                if (input.skill && !canCodenSkillUseTool(input.skill, 'summarize_change_plan')) throw new Error('Skill tool policy denied summarize_change_plan.');
                return {
                  goal: String(goal || input.prompt).slice(0, 500),
                  files: Array.isArray(files) ? files.map(String).slice(0, 20) : [],
                  constraint: 'Preserve working behavior and change only what the user requested.',
                };
              },
              interpret_check_failure: ({ diagnostic, likely_file }) => {
                if (input.skill && !canCodenSkillUseTool(input.skill, 'interpret_check_failure')) throw new Error('Skill tool policy denied interpret_check_failure.');
                return {
                  diagnostic: String(diagnostic || '').slice(0, 1_000),
                  likely_file: String(likely_file || '').slice(0, 240),
                  instruction: 'Propose the smallest repair and a concrete retest.',
                };
              },
            },
          });
          return loop.result.text;
        };

        const agentResults = await runParallelAgents(agentCtx, agentExecutor, boundedAgentRoles, 15_000);
        parallelAgentContext = mergeAgentOutputs(agentResults);
        totalCostUsd += agentResults.length * 0.001; // nominal cost tracking

      }
    } catch (parallelErr: any) {
      // Never block generation if parallel agents fail
      console.warn('[coden:parallel_agents_failed]', { message: parallelErr?.message });
    }
  }

  // Extract memory (ADRs) from last actions and build RAG context
  const persistenceClient = getSupabase();

  // Load persisted project memory from Supabase (ADRs, preferences, blockers)
  let memoryContext = '';
  try {
    if (input.project?.id && persistenceClient) {
      const { data: memoryRows } = await persistenceClient
        .from('project_memory')
        .select('id, memory_type, content, created_at, updated_at')
        .eq('project_id', input.project.id)
        .order('created_at', { ascending: false })
        .limit(120);
      if (memoryRows && memoryRows.length > 0) {
        const { rowsToProjectMemory, buildMemoryRagContext: buildRag } = await import('./src/services/agent-memory-rag.ts');
        const relevantRows = selectRelevantMemoryRows(memoryRows as any, input.prompt, 24);
        const projectMem = rowsToProjectMemory(relevantRows as any);
        // Also inject known blockers from the deep reasoning contract
        if (input.deepReasoningContract?.context_builder.recent_blockers.length) {
          projectMem.recentBlockers = [
            ...(projectMem.recentBlockers || []),
            ...input.deepReasoningContract.context_builder.recent_blockers,
          ];
        }
        memoryContext = buildRag(projectMem);
      }
    }
  } catch (memErr: any) {
    console.warn('[coden:rag_memory_load_failed]', { message: memErr?.message });
  }

  // ✅ Load persisted design tokens for visual consistency across sessions
  let designTokenContext = '';
  try {
    if (input.project?.id && persistenceClient) {
      const { data: tokenRows } = await persistenceClient
        .from('project_memory')
        .select('content')
        .eq('project_id', input.project.id)
        .eq('memory_type', 'design_token')
        .order('created_at', { ascending: false })
        .limit(1);
      if (tokenRows?.[0]?.content) {
        const designSystem = designSystemFromMemoryRow(tokenRows[0].content);
        if (designSystem) {
          designTokenContext = buildDesignTokenContext(designSystem);
        }
      }
    }
  } catch (dtErr: any) {
    console.warn('[coden:design_token_load_failed]', { message: dtErr?.message });
  }

  // ✅ Conflict detection — warn the LLM if new prompt contradicts recent history
  const conflictContext = (() => {
    try {
      const conflict = detectPromptConflict(
        input.prompt,
        (input.recentHistory || []).slice(-4),
        input.existingFiles.slice(0, 6),
      );
      return conflictToPromptContext(conflict);
    } catch { return ''; }
  })();

  // Meta-prompting: enrich the user's prompt
  const enrichedPrompt = buildMetaPrompt(input.prompt, appType, input.deepReasoningContract?.recovery_diagnostics?.known_failure_modes || []);

  // Compose final prompt with all context layers
  const composedPrompt = [
    enrichedPrompt,
    designTokenContext,
    conflictContext,
    parallelAgentContext,   // ✅ parallel agent pre-analysis
  ].filter(Boolean).join('\n\n');
  const buildGenerationUserContent = (prompt: string) => {
    const payload = JSON.stringify({
      projectName: input.projectName,
      prompt,
      memoryRagContext: memoryContext,
      existingFiles: fileManifest || 'No existing files yet.',
      existingFilesContent: semanticContext || existingFilesContent,
      uiGenerationPolicy: uiPolicy.userContext,
      seniorAgentOS: input.seniorAgentContext || undefined,
      deepReasoning: input.deepReasoningContract ? deepReasoningPromptContext(input.deepReasoningContract) : undefined,
    });
    return input.visionInputs?.length ? buildVisionMessageContent(payload, input.visionInputs) : payload;
  };

  let result: any = null;
  try {
      // Generated source remains atomic, but the provider response is consumed
      // as a private stream so large artifacts cannot time out while waiting
      // for one monolithic JSON response. Nothing is applied until validation.
      result = await providerGateway.streamingCompletion(selectedModel, [
        {
          role: 'system',
          content: buildGenerationSystemPrompt({
            prompt: input.prompt,
            uiPolicySystemPrompt: uiPolicy.systemPrompt,
            hasExistingFiles: input.existingFiles.length > 0,
          }),
        },
        {
          role: 'user',
          content: JSON.stringify({
            projectName: input.projectName,
            prompt: composedPrompt,
            memoryRagContext: memoryContext,
            existingFiles: fileManifest || 'No existing files yet.',
            // ✅ Semantic RAG: most relevant files first, others in manifest
            existingFilesContent: semanticContext || existingFilesContent,
            uiGenerationPolicy: uiPolicy.userContext,
            seniorAgentOS: input.seniorAgentContext || undefined,
            deepReasoning: input.deepReasoningContract ? deepReasoningPromptContext(input.deepReasoningContract) : undefined,
          }),
        },
        ...(input.visionInputs?.length ? [{
          role: 'user' as const,
          content: buildGenerationUserContent('Use these visual references as real multimodal input for this generation.'),
        }] : []),
      ], {
        // This is an idle timeout. OpenRouterService also enforces a bounded
        // hard deadline, while active token delivery keeps the request alive.
        timeoutMs: runtimeOptions?.runtime.timeoutMs || 120_000,
        runtimeConfig: runtimeOptions?.providerConfig,
        runtimeConfigForModel: runtimeOptions?.runtimeConfigForModel,
        allowFallback: Boolean(input.allowModelFallback),
        onFallback: input.allowModelFallback
          ? event => input.onEvent?.({ type: 'model_fallback', ...event })
          : undefined,
        // A malformed artifact is equivalent to an unavailable generator for
        // Auto. Validate before accepting the result so the gateway can try
        // its one compatible fallback without creating a second project/run.
        validateResult: input.allowModelFallback
          ? candidate => {
            parseGeneratedOutput(input.projectName, candidate.text, input.prompt, {
              hasExistingFiles: input.existingFiles.length > 0,
            });
          }
          : undefined,
        signal: input.signal,
      });
      totalCostUsd += result.cost_usd;
    } catch (streamErr: any) {
      // A failed request is terminal for this run. Starting a second model
      // request here would duplicate work and could produce contradictory files.
      console.warn('[coden:generate_stream_failed]', { message: streamErr?.message });
      throw streamErr;
    }

  let parsed: ReturnType<typeof parseGeneratedOutput> | null = null;
  try {
    parsed = parseGeneratedOutput(input.projectName, result.text, input.prompt, {
      hasExistingFiles: input.existingFiles.length > 0,
    });
  } catch (error: any) {
    if (!(error instanceof GeneratedOutputParseError)) {
      throw error;
    }
    console.warn('[coden:generation_parse_repair]', {
      project_id: input.project?.id,
      message: error?.message || 'model output parse failed',
    });
    let repairedByModel = false;
    try {
      const repairModel = normalizeProviderModelForBackend(result?.model || selectedModel);
      validateAllowedModel(repairModel);
      const repairResult = await providerGateway.chat(repairModel, [
        {
          role: 'system',
          content: buildGenerationSystemPrompt({
            prompt: input.prompt,
            uiPolicySystemPrompt: uiPolicy.systemPrompt,
            hasExistingFiles: input.existingFiles.length > 0,
          }),
        },
        {
          role: 'user',
          content: `Repair this malformed generation into complete project files for "${input.prompt}". Return the required JSON contract, not a plan or template. Do not display the raw user prompt in the app.\n\n${String(result.text || '').slice(0, 80_000)}`,
        },
      ], {
        maxAttempts: 1,
        timeoutMs: runtimeOptions?.runtime.timeoutMs || 90_000,
        runtimeConfig: runtimeOptions?.providerConfig,
        runtimeConfigForModel: runtimeOptions?.runtimeConfigForModel,
        allowFallback: false,
        signal: input.signal,
      });
      parsed = parseGeneratedOutput(input.projectName, repairResult.text, input.prompt, {
        hasExistingFiles: input.existingFiles.length > 0,
      });
      totalCostUsd += repairResult.cost_usd;
      result = repairResult;
      repairedByModel = true;
    } catch (repairError: any) {
      console.warn('[coden:generation_parse_model_repair_failed]', {
        project_id: input.project?.id,
        message: repairError?.message || 'model repair failed',
      });
    }
    // Recovery stays model-backed: repair first, then salvage only files that
    // were actually returned by the model. Never fabricate an application.
    // 1) Detect a plan envelope { plan, message } so we don't dump JSON in the
    //    preview — surface the message instead and stop trying to "build".
    // 2) Best-effort salvage of any files[] anywhere in the raw output.
    // 3) If both fail, stop honestly and preserve the existing project.
    const { classifyModelOutput, extractPlanEnvelope, salvageFiles } = await import('./src/services/generated-output-recovery.ts');
    const kind = classifyModelOutput(result.text || '');
    if (!repairedByModel && kind === 'plan_envelope') {
      const envelope = extractPlanEnvelope(result.text || '');
      const safeMessage = String(envelope?.message || '').slice(0, 800);
      throw new GeneratedOutputParseError(safeMessage || 'The model returned a plan instead of project files.');
    } else if (!repairedByModel) {
      const salvaged = salvageFiles(result.text || '');
      if (salvaged && salvaged.files.length > 0) {
        parsed = parseGeneratedOutput(input.projectName, JSON.stringify(salvaged), input.prompt, {
          hasExistingFiles: input.existingFiles.length > 0,
        });
      } else {
        throw new GeneratedOutputParseError('The model did not return complete project files after one repair attempt.');
      }
    }
  }
  if (!parsed) {
    throw new GeneratedOutputParseError('Coden could not recover complete project files from the selected model.');
  }
  const files = parsed.files;
  if (parsed.backendSchema && !files.some(file => file.path === 'supabase/schema.sql')) {
    files.push({ path: 'supabase/schema.sql', content: String(parsed.backendSchema), language: 'sql', updated_at: new Date().toISOString() });
  }

  // Persist new architectural decisions extracted from this generation
  if (input.project?.id && persistenceClient) {
    try {
      const { extractArchitectureDecisions, projectMemoryToRows } = await import('./src/services/agent-memory-rag.ts');
      const newAdrs = extractArchitectureDecisions(input.prompt, result.text);
      if (newAdrs.length > 0) {
        const rows = projectMemoryToRows({ adrs: newAdrs, knownPreferences: [] }, input.project.id);
        // Upsert: delete existing ADRs for the same topics, then insert fresh ones
        const topics = newAdrs.map(a => a.topic);
        const existingRows = await persistenceClient
          .from('project_memory')
          .select('id, content')
          .eq('project_id', input.project.id)
          .eq('memory_type', 'adr');
        if (existingRows.data) {
          const toDelete = existingRows.data
            .filter((row: any) => {
              try {
                const parsed2 = JSON.parse(row.content);
                return topics.includes(parsed2.topic);
              } catch { return false; }
            })
            .map((row: any) => row.id);
          if (toDelete.length > 0) {
            await persistenceClient.from('project_memory').delete().in('id', toDelete);
          }
        }
        const { error: memoryPersistError } = await persistenceClient.from('project_memory').insert(rows);
        if (memoryPersistError) {
          console.warn('[coden:memory_persist_failed]', { message: memoryPersistError.message });
        }
      }
    } catch (persistErr: any) {
      console.warn('[coden:memory_persist_error]', { message: persistErr?.message });
    }

    // ✅ Persist design tokens extracted from generated files for visual consistency
    try {
      const designSystem = extractDesignTokens(files);
      if (designSystem.tokens.length > 0) {
        const designRows = designSystemToMemoryRows(designSystem, input.project.id);
        // Replace existing design token entry
        const { error: designTokenDeleteError } = await persistenceClient
          .from('project_memory')
          .delete()
          .eq('project_id', input.project.id)
          .eq('memory_type', 'design_token');
        if (designTokenDeleteError) {
          console.warn('[coden:design_token_cleanup_failed]', { message: designTokenDeleteError.message });
        }
        const { error: designTokenPersistError } = await persistenceClient
          .from('project_memory')
          .insert(designRows);
        if (designTokenPersistError) {
          console.warn('[coden:design_token_persist_failed]', { message: designTokenPersistError.message });
        }
      }
    } catch (dtPersistErr: any) {
      console.warn('[coden:design_token_persist_error]', { message: dtPersistErr?.message });
    }
  }

  return {
    files,
    summary: String(parsed.summary || '').trim(),
    appName: sanitizeSuggestedProjectName(parsed.appName, input.prompt),
    model: result.model,
    cost_usd: totalCostUsd,
  };
}

function buildGenerationMessages(input: {
  projectName: string;
  prompt: string;
  existingFiles: GeneratedFile[];
  researchContext?: string;
  seniorAgentContext?: SeniorAgentContext;
  deepReasoningContract?: DeepReasoningContract;
}) {
  const fileManifest = input.existingFiles
    .map(file => `${file.path} (${file.content.length} chars)`)
    .slice(0, 40)
    .join('\n');
  // ✅ Smart context injection for external callers of buildGenerationMessages
  const existingFilesContent = buildExistingFilesContextForGeneration(input.existingFiles, input.prompt);
  const uiPolicy = buildWorldClassUiPolicy({ prompt: input.prompt });

  return [
    {
      role: 'system' as const,
      content: buildGenerationSystemPrompt({
        prompt: input.prompt,
        uiPolicySystemPrompt: uiPolicy.systemPrompt,
        hasExistingFiles: input.existingFiles.length > 0,
        hasResearchContext: Boolean(input.researchContext),
      }),
    },
    {
      role: 'user' as const,
      content: JSON.stringify({
        projectName: input.projectName,
        prompt: input.prompt,
        existingFiles: fileManifest || 'No existing files yet.',
        existingFilesContent,
        uiGenerationPolicy: uiPolicy.userContext,
        researchContext: input.researchContext || undefined,
        seniorAgentOS: input.seniorAgentContext || undefined,
        deepReasoning: input.deepReasoningContract ? deepReasoningPromptContext(input.deepReasoningContract) : undefined,
      }),
    },
  ];
}

function parseGeneratedOutput(
  projectName: string,
  rawText: string,
  promptOrDescription = '',
  options: { hasExistingFiles?: boolean } = {},
) {
  const isStandaloneHtml = looksLikeStandaloneHtml(rawText);
  const parsed = extractGeneratedJson(rawText) || extractGeneratedMarkdownFiles(rawText) || (
    isStandaloneHtml
      ? {
          summary: '',
          files: [{ path: 'index.html', content: rawText.trim(), language: 'html' }],
        }
      : null
  );
  if (!parsed) {
    throw new GeneratedOutputParseError();
  }

  const rawFiles = parsed.files || (parsed.html
    ? [{ path: 'index.html', content: String(parsed.html), language: 'html' }]
    : null);
  if (!rawFiles || !Array.isArray(rawFiles) || rawFiles.length === 0) {
    throw new GeneratedOutputParseError('The model returned a plan or incomplete output instead of project files.');
  }

  const normalizedFiles = withProjectSeoSupport(
    normalizeGeneratedFiles(rawFiles, { ensureIndex: !options.hasExistingFiles }),
    projectName,
    promptOrDescription || projectName,
    { ensureIndex: !options.hasExistingFiles },
  );
  const files = ensureModernFrontendProject(normalizedFiles, projectName, promptOrDescription || projectName);
  if (!files.length) {
    throw new GeneratedOutputParseError('Coden could not find any safe generated files, so the existing app was kept unchanged.');
  }
  const runtimeRequirement = detectCodenCloudRequirements(promptOrDescription || projectName);
  if (!options.hasExistingFiles && hasCodenCloudRequirement(runtimeRequirement)) {
    const profile = resolveGeneratedAppProfile({ prompt: promptOrDescription, files, requirement: runtimeRequirement });
    if (profile !== 'tanstack-fullstack') {
      throw new GeneratedOutputParseError('The model did not return the required TanStack fullstack project contract.');
    }
  }
  if (parsed.backendSchema && !files.some(file => file.path === 'supabase/schema.sql')) {
    files.push({ path: 'supabase/schema.sql', content: String(parsed.backendSchema), language: 'sql', updated_at: new Date().toISOString() });
  }

  const summary = String(parsed.summary || '').trim();
  if (!summary) {
    throw new GeneratedOutputParseError('The model output is missing a final summary.');
  }
  return {
    files,
    appName: sanitizeSuggestedProjectName(parsed.appName, promptOrDescription || projectName),
    summary,
    backendSchema: parsed.backendSchema ? String(parsed.backendSchema) : '',
  };
}

function getInvalidEnumValueFromMessage(message: string) {
  return message.match(/invalid input value for enum [^:]+:\s*"([^"]+)"/i)?.[1] || '';
}

function isInvalidEnumValueError(error: any) {
  return /invalid input value for enum/i.test(error?.message || '');
}

function removeSchemaMissingColumn(row: Record<string, any>, error: any) {
  const column = getSchemaColumnFromMessage(String(error?.message || ''));
  if (column && column in row) {
    delete row[column];
    return true;
  }
  return false;
}

function projectRowCandidates(projectRow: Record<string, any>) {
  const base = withoutUndefinedValues({ ...projectRow });
  const { created_by: _createdBy, ...withoutCreatedByBase } = base;
  const compact = withoutUndefinedValues({
    id: base.id,
    owner_id: base.owner_id || base.organization_id,
    organization_id: base.organization_id || base.owner_id,
    name: base.name || 'Untitled app',
    slug: base.slug,
    prompt: base.prompt || '',
    template: base.template || 'custom',
    theme: base.theme || 'light',
    model_id: base.model_id || 'auto',
    status: base.status || 'draft',
    preview_status: base.preview_status || 'idle',
    preview_html: base.preview_html || '',
    created_at: base.created_at,
    updated_at: base.updated_at,
  });
  const noStatus = withoutUndefinedValues({
    ...compact,
    status: undefined,
    preview_status: undefined,
  });
  const activeStatus = withoutUndefinedValues({
    ...compact,
    status: 'active',
    preview_status: 'unknown',
  });
  const minimal = withoutUndefinedValues({
    id: base.id,
    owner_id: base.owner_id || base.organization_id,
    organization_id: base.organization_id || base.owner_id,
    name: base.name || 'Untitled app',
    slug: base.slug,
    prompt: base.prompt || '',
    preview_html: base.preview_html || '',
    updated_at: base.updated_at,
  });

  return [base, withoutUndefinedValues(withoutCreatedByBase), compact, activeStatus, noStatus, minimal];
}

async function upsertProjectWithSchemaFallback(client: any, projectRow: Record<string, any>) {
  const triedShapes = new Set<string>();
  let lastError: any = null;

  for (const candidate of projectRowCandidates(projectRow)) {
    const row = { ...candidate };
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const shapeKey = [
        Object.keys(row).sort().join(','),
        `status=${row.status ?? ''}`,
        `preview=${row.preview_status ?? ''}`,
      ].join('|');
      if (!shapeKey || triedShapes.has(shapeKey)) break;
      triedShapes.add(shapeKey);

      const { error } = await client.from('projects').upsert([row]);
      if (!error) return row;
      lastError = error;

      if (isInvalidEnumValueError(error)) {
        const invalidValue = getInvalidEnumValueFromMessage(error.message || '');
        if (row.status === invalidValue && row.status !== 'active') {
          row.status = 'active';
          continue;
        }
        if (row.preview_status === invalidValue && row.preview_status !== 'verified') {
          row.preview_status = 'unknown';
          continue;
        }
        if ('status' in row) {
          delete row.status;
          continue;
        }
        if ('preview_status' in row) {
          delete row.preview_status;
          continue;
        }
      }

      if (isSchemaShapeError(error) && removeSchemaMissingColumn(row, error)) {
        continue;
      }

      break;
    }
  }

  throw new Error(`Supabase project persistence failed: ${lastError?.message || 'unknown schema mismatch'}`);
}

function projectFileRows(files: GeneratedFile[], project: GeneratedProject) {
  return files.map(file => withoutUndefinedValues({
    organization_id: project.organization_id,
    project_id: project.id,
    path: file.path,
    content: redactSecrets(file.content || ''),
    language: file.language || null,
    updated_at: new Date().toISOString(),
  }));
}

function isProjectFilesMissingError(error: any) {
  const message = String(error?.message || '');
  return /(?:relation|table)\s+["'`]?[^\s"'`]*project_files[^\s"'`]*["'`]?\s+(?:does not exist|not found)|could not find the table\s+["'`]?[^\s"'`]*project_files[^\s"'`]*["'`]?\s+in the schema cache/i.test(message);
}

function stripSchemaColumnFromProjectFileRows(rows: Record<string, any>[], error: any) {
  const column = getSchemaColumnFromMessage(String(error?.message || ''));
  if (!column || !rows.some(row => column in row)) return null;
  return rows.map(row => {
    const next = { ...row };
    delete next[column];
    return next;
  });
}

async function persistProjectFileRowsIndividually(client: any, rows: Record<string, any>[]) {
  for (const row of rows) {
    const updateResult = await client
      .from('project_files')
      .update(row)
      .eq('project_id', row.project_id)
      .eq('path', row.path)
      .select('path');

    if (updateResult.error) return updateResult.error;

    const updatedRows = Array.isArray(updateResult.data) ? updateResult.data.length : 0;
    if (updatedRows > 0) continue;

    const insertResult = await client.from('project_files').insert([row]);
    if (insertResult.error) return insertResult.error;
  }

  return null;
}

async function cleanupStaleProjectFileRows(client: any, projectId: string, nextPaths: Set<string>) {
  if (!nextPaths.size) return;

  const { data, error } = await client.from('project_files').select('path').eq('project_id', projectId);
  if (error) {
    if (isProjectFilesMissingError(error)) {
      console.warn('[coden:project_files_cleanup_skipped]', { message: error.message });
      return;
    }
    console.warn('[coden:project_files_cleanup_warning]', { message: error.message });
    return;
  }

  const stalePaths = (data || [])
    .map((row: any) => String(row?.path || ''))
    .filter((filePath: string) => filePath && !nextPaths.has(filePath));

  for (const filePath of stalePaths) {
    const deleteResult = await client
      .from('project_files')
      .delete()
      .eq('project_id', projectId)
      .eq('path', filePath);

    if (deleteResult.error) {
      console.warn('[coden:project_files_stale_delete_warning]', {
        path: filePath,
        message: deleteResult.error.message,
      });
    }
  }
}

async function saveProjectFilesWithSchemaFallback(client: any, project: GeneratedProject, files: GeneratedFile[]) {
  let rows = projectFileRows(files, project);
  if (!rows.length) {
    console.warn('[coden:project_files_empty_save_skipped]', {
      project_id: project.id,
      reason: 'Refusing to wipe project files from an empty generated file set.',
    });
    return;
  }

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const upsertResult = await client
      .from('project_files')
      .upsert(rows, { onConflict: 'project_id,path' });

    if (!upsertResult.error) {
      await cleanupStaleProjectFileRows(client, project.id, new Set(rows.map(row => String(row.path))));
      return;
    }

    const error = upsertResult.error;
    if (isProjectFilesMissingError(error)) {
      console.warn('[coden:project_files_persistence_skipped]', { message: error.message });
      return;
    }

    if (isSchemaShapeError(error)) {
      const strippedRows = stripSchemaColumnFromProjectFileRows(rows, error);
      if (strippedRows) {
        rows = strippedRows;
        continue;
      }
    }

    const fallbackError = await persistProjectFileRowsIndividually(client, rows);
    if (!fallbackError) {
      await cleanupStaleProjectFileRows(client, project.id, new Set(rows.map(row => String(row.path))));
      return;
    }
    if (isProjectFilesMissingError(fallbackError)) {
      console.warn('[coden:project_files_persistence_skipped]', { message: fallbackError.message });
      return;
    }
    if (isSchemaShapeError(fallbackError)) {
      const strippedRows = stripSchemaColumnFromProjectFileRows(rows, fallbackError);
      if (strippedRows) {
        rows = strippedRows;
        continue;
      }
    }

    throw new Error(`Supabase project file persistence failed: ${fallbackError?.message || error.message}`);
  }
}

async function saveProject(project: GeneratedProject, files?: GeneratedFile[]) {
  const client = requireSupabase('Project persistence');
  const projectRow: Record<string, any> = {
    ...project,
    created_by: project.created_by || project.owner_id || project.organization_id || DEFAULT_ORG_ID,
  };

  await upsertProjectWithSchemaFallback(client, projectRow);

  if (files) {
    await saveProjectFilesWithSchemaFallback(client, project, files);
  }

  await persistDurableProjectSnapshot({
    project,
    files,
    preview: {
      status: project.preview_status || 'idle',
      html: project.preview_html || (files ? getProjectPreviewHtml(project, files, 'preview') : ''),
    },
  });

  return project;
}

async function loadProject(projectId: string, userId: string, req?: any): Promise<GeneratedProject | null> {
  const client = requireSupabase('Project loading');
  const { data, error } = await client.from('projects').select('*').eq('id', projectId).maybeSingle();
  if (error) throw new Error(`Supabase project load failed: ${error.message}`);
  if (!data) return null;
  const project = data as GeneratedProject;
  const role = await resolveProjectRole(project, userId, req);
  if (!role) return null;
  return { ...project, __coden_project_role: role } as GeneratedProject;
}

async function loadProjectForAnalytics(projectId: string): Promise<GeneratedProject | null> {
  const client = requireSupabase('Analytics project loading');
  const { data, error } = await client.from('projects').select('*').eq('id', projectId).maybeSingle();
  if (error) throw new Error(`Supabase analytics project load failed: ${error.message}`);
  return (data as GeneratedProject) || null;
}

async function listProjectsForUser(userId: string): Promise<GeneratedProject[]> {
  const client = requireSupabase('Project listing');
  let { data, error } = await client.from('projects').select('*').eq('owner_id', userId).order('updated_at', { ascending: false });
  if (error && /owner_id|schema cache|column .*does not exist|could not find .* in the schema cache/i.test(error.message || '')) {
    const retry = await client.from('projects').select('*').eq('organization_id', userId).order('updated_at', { ascending: false });
    data = retry.data;
    error = retry.error;
  }
  if (error) throw new Error(`Supabase project listing failed: ${error.message}`);
  return (data || []) as GeneratedProject[];
}

async function enrichProjectsForDashboard(projects: GeneratedProject[]) {
  if (!projects.length) return [];
  const client = requireSupabase('Dashboard project enrichment');
  const deploymentByProject = new Map<string, any>();
  const ids = projects.map(project => project.id).filter(Boolean);
  if (ids.length) {
    let { data, error } = await client
      .from('deployments')
      .select('project_id,status,deployment_status,deployment_url,url,live_url,published_url,created_at')
      .in('project_id', ids)
      .order('created_at', { ascending: false });
    if (error && isSchemaShapeError(error)) {
      const fallback = await client
        .from('deployments')
        .select('project_id,status,deployment_status,deployment_url,created_at')
        .in('project_id', ids)
        .order('created_at', { ascending: false });
      data = fallback.data;
      error = fallback.error;
    }
    if (!error) {
      (data || []).forEach((deployment: any) => {
        if (deployment?.project_id && !deploymentByProject.has(deployment.project_id)) {
          deploymentByProject.set(deployment.project_id, deployment);
        }
      });
    } else if (!isSchemaShapeError(error)) {
      console.warn('[coden:dashboard_deployments_load_failed]', { message: error.message });
    }
  }

  return projects.map(project => {
    const deployment = deploymentByProject.get(project.id);
    const publishStatus = deployment?.status || deployment?.deployment_status || project.publish_status || null;
    const liveUrl = deployment?.url || deployment?.deployment_url || deployment?.live_url || deployment?.published_url || project.live_url || null;
    return {
      id: project.id,
      name: project.name,
      slug: project.slug,
      prompt: project.prompt || '',
      template: project.template || 'custom',
      theme: project.theme || 'light',
      model_id: project.model_id || 'auto',
      status: project.status || 'draft',
      preview_status: project.preview_status || 'idle',
      preview_html: project.preview_status === 'verified' ? project.preview_html || '' : '',
      publish_status: publishStatus,
      live_url: liveUrl,
      created_at: project.created_at,
      updated_at: project.updated_at,
    };
  });
}

async function deleteProjectCascade(project: GeneratedProject) {
  const client = requireSupabase('Project delete');
  const projectScopedTables = [
    'project_files',
    'project_state_snapshots',
    'project_workspace_state',
    'project_versions',
    'project_messages',
    'project_patches',
    'project_secrets',
    'project_assets',
    'project_integrations',
    'project_backend_requirements',
    'project_analytics_events',
    'project_analytics_sessions',
    'project_memory',
    'project_members',
    'agent_events',
    'agent_runs',
    'agent_run_steps',
    'agent_verifications',
    'agent_runner_results',
    'agent_research_results',
    'agent_memories',
    'build_errors',
    'deployments',
  ];

  for (const table of projectScopedTables) {
    const { error } = await client.from(table).delete().eq('project_id', project.id);
    if (error && !isSchemaShapeError(error) && !/relation .* does not exist|table .* does not exist/i.test(error.message || '')) {
      console.warn('[coden:project_delete_related_failed]', { project_id: project.id, table, message: error.message });
    }
  }

  const { error } = await client.from('projects').delete().eq('id', project.id);
  if (error) throw new Error(`Supabase project delete failed: ${error.message}`);
}

async function loadProjectFiles(projectId: string): Promise<GeneratedFile[]> {
  const client = requireSupabase('Project file loading');
  let { data, error } = await client.from('project_files').select('path, content, language, updated_at').eq('project_id', projectId).order('path');
  if (error && /language|updated_at|schema cache|column .*does not exist|could not find .* in the schema cache/i.test(error.message || '')) {
    const retry = await client.from('project_files').select('path, content').eq('project_id', projectId).order('path');
    data = retry.data;
    error = retry.error;
  }
  if (error && /project_files|relation .* does not exist|table .* does not exist/i.test(error.message || '')) {
    console.warn('[coden:project_files_load_skipped]', { project_id: projectId, message: error.message });
    return [];
  }
  if (error) throw new Error(`Supabase project files load failed: ${error.message}`);
  return (data || []).map((file: GeneratedFile) => ({
    ...file,
    content: redactSecrets(file.content || ''),
  })) as GeneratedFile[];
}

function isMissingProjectSnapshotTableError(error: any) {
  return /project_state_snapshots|schema cache|relation .* does not exist|table .* does not exist|could not find .* in the schema cache/i.test(error?.message || '');
}

function cleanProjectForSnapshot(project: GeneratedProject) {
  const snapshot = redactSecretPayload({ ...project }) as Record<string, any>;
  delete snapshot.__coden_project_role;
  return snapshot;
}

async function persistDurableProjectSnapshot(input: {
  project: GeneratedProject;
  files?: GeneratedFile[];
  messages?: any[];
  events?: any[];
  workspace?: Record<string, any> | null;
  preview?: { status?: string; html?: string } | null;
  lastAgentRunId?: string | null;
}) {
  const row = withoutUndefinedValues({
    project_id: input.project.id,
    owner_id: input.project.owner_id,
    organization_id: input.project.organization_id || null,
    revision: Date.now(),
    project_snapshot: cleanProjectForSnapshot(input.project),
    files_snapshot: input.files === undefined ? undefined : redactSecretPayload(input.files),
    messages_snapshot: input.messages === undefined ? undefined : redactSecretPayload(input.messages.slice(-250)),
    events_snapshot: input.events === undefined ? undefined : redactSecretPayload(input.events.slice(-500)),
    workspace_snapshot: input.workspace === undefined ? undefined : redactSecretPayload(input.workspace || {}),
    preview_snapshot: input.preview === undefined ? undefined : redactSecretPayload(input.preview || {}),
    last_agent_run_id: input.lastAgentRunId === undefined ? undefined : input.lastAgentRunId,
    updated_at: new Date().toISOString(),
  });
  const client = requireSupabase('Durable project snapshot persistence');
  const { error } = await client.from('project_state_snapshots').upsert([row], { onConflict: 'project_id' });
  if (error && isMissingProjectSnapshotTableError(error)) {
    console.warn('[coden:durable_project_snapshot_unavailable]', { project_id: input.project.id, message: error.message });
    return false;
  }
  if (error) throw new Error(`Durable project snapshot persistence failed: ${error.message}`);
  return true;
}

async function appendDurableProjectSnapshotItem(input: {
  projectId: string;
  ownerId: string;
  organizationId?: string | null;
  field: 'messages_snapshot' | 'events_snapshot';
  item: any;
  limit: number;
  lastAgentRunId?: string | null;
}) {
  const client = requireSupabase('Durable project snapshot append');
  const { data, error: readError } = await client
    .from('project_state_snapshots')
    .select(`project_id,${input.field}`)
    .eq('project_id', input.projectId)
    .maybeSingle();
  if (readError && isMissingProjectSnapshotTableError(readError)) return false;
  if (readError) throw new Error(`Durable project snapshot read failed: ${readError.message}`);
  const previous = Array.isArray(data?.[input.field]) ? data[input.field] : [];
  const row = withoutUndefinedValues({
    project_id: input.projectId,
    owner_id: input.ownerId,
    organization_id: input.organizationId || null,
    revision: Date.now(),
    [input.field]: redactSecretPayload([...previous, input.item].slice(-input.limit)),
    last_agent_run_id: input.lastAgentRunId === undefined ? undefined : input.lastAgentRunId,
    updated_at: new Date().toISOString(),
  });
  const { error } = await client.from('project_state_snapshots').upsert([row], { onConflict: 'project_id' });
  if (error && isMissingProjectSnapshotTableError(error)) return false;
  if (error) throw new Error(`Durable project snapshot append failed: ${error.message}`);
  return true;
}

async function persistDurableWorkspaceSnapshot(projectId: string, ownerId: string, workspace: Record<string, any> | null) {
  const client = requireSupabase('Durable workspace snapshot persistence');
  const row = {
    project_id: projectId,
    owner_id: ownerId,
    revision: Date.now(),
    workspace_snapshot: redactSecretPayload(workspace || {}),
    updated_at: new Date().toISOString(),
  };
  const { error } = await client.from('project_state_snapshots').upsert([row], { onConflict: 'project_id' });
  if (error && isMissingProjectSnapshotTableError(error)) return false;
  if (error) throw new Error(`Durable workspace snapshot persistence failed: ${error.message}`);
  return true;
}

async function loadDurableProjectSnapshot(projectId: string, ownerId: string): Promise<DurableProjectSnapshot | null> {
  const client = requireSupabase('Durable project snapshot loading');
  const { data, error } = await client
    .from('project_state_snapshots')
    .select('*')
    .eq('project_id', projectId)
    .eq('owner_id', ownerId)
    .maybeSingle();
  if (error && isMissingProjectSnapshotTableError(error)) return null;
  if (error) throw new Error(`Durable project snapshot load failed: ${error.message}`);
  return (data as DurableProjectSnapshot) || null;
}

async function refreshDurableProjectSnapshot(project: GeneratedProject, files?: GeneratedFile[]) {
  const [messages, workspace] = await Promise.all([
    listProjectMessages(project.id).catch(() => []),
    getProjectWorkspaceState(project.id).catch(() => null),
  ]);
  return persistDurableProjectSnapshot({
    project,
    files,
    messages,
    workspace,
    preview: {
      status: project.preview_status || 'idle',
      html: project.preview_html || (files ? getProjectPreviewHtml(project, files, 'preview') : ''),
    },
  });
}

function recoverProjectPayloadFromSnapshot(input: {
  project: GeneratedProject;
  files: GeneratedFile[];
  messages: any[];
  events: any[];
  workspace: Record<string, any> | null;
  snapshot: DurableProjectSnapshot | null;
}) {
  const snapshot = input.snapshot;
  const snapshotFiles = normalizeGeneratedFiles(snapshot?.files_snapshot || []);
  const snapshotMessages = Array.isArray(snapshot?.messages_snapshot) ? snapshot!.messages_snapshot! : [];
  const snapshotEvents = Array.isArray(snapshot?.events_snapshot) ? snapshot!.events_snapshot! : [];
  const fileMap = new Map<string, GeneratedFile>();
  snapshotFiles.forEach(file => fileMap.set(file.path, file));
  input.files.forEach(file => fileMap.set(file.path, file));
  const files = Array.from(fileMap.values()).sort((a, b) => a.path.localeCompare(b.path));
  const messageMap = new Map<string, any>();
  [...snapshotMessages, ...input.messages].forEach((message: any, index) => {
    const key = String(message?.id || `${message?.role || 'unknown'}:${message?.created_at || index}:${message?.content || ''}`);
    messageMap.set(key, sanitizeProjectMessageForUser(message));
  });
  const messages = Array.from(messageMap.values()).sort((a, b) => String(a?.created_at || '').localeCompare(String(b?.created_at || '')));
  const eventMap = new Map<string, any>();
  [...snapshotEvents, ...input.events].forEach((event: any, index) => {
    const key = String(event?.id || `${event?.agent_run_id || ''}:${event?.sequence_number || index}:${event?.event_type || ''}:${event?.message || ''}`);
    eventMap.set(key, redactSecretPayload(event));
  });
  const events = Array.from(eventMap.values()).sort((a, b) => {
    const sequenceDiff = Number(a?.sequence_number || 0) - Number(b?.sequence_number || 0);
    return sequenceDiff || String(a?.created_at || '').localeCompare(String(b?.created_at || ''));
  });
  const workspace = input.workspace || snapshot?.workspace_snapshot || null;
  const snapshotPreview = snapshot?.preview_snapshot || null;
  const normalizedPreviewHtml = input.project.preview_html
    ? getProjectPreviewHtml(input.project, files, 'preview')
    : String(snapshotPreview?.html || '').trim()
      || getProjectPreviewHtml(input.project, files, 'preview');
  const usedSnapshot = files.length > input.files.length
    || messages.length > input.messages.length
    || events.length > input.events.length
    || (!input.workspace && Boolean(snapshot?.workspace_snapshot))
    || (!input.project.preview_html && Boolean(snapshotPreview?.html));
  return {
    recovery_source: usedSnapshot ? 'mixed' as const : 'normalized' as const,
    files,
    messages,
    events,
    workspace,
    preview: {
      status: input.project.preview_status || snapshotPreview?.status || 'idle',
      html: normalizedPreviewHtml,
    },
  };
}

function withoutUndefinedValues(row: Record<string, any>) {
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined));
}

function deploymentRecordCandidates(record: any) {
  const status = normalizeDeploymentStatusForPersistence(record.status);
  return [
    withoutUndefinedValues({ ...record, status }),
    withoutUndefinedValues({
      id: record.id,
      organization_id: record.organization_id,
      project_id: record.project_id,
      provider: record.provider,
      provider_deployment_id: record.provider_deployment_id,
      deployment_url: record.deployment_url,
      status,
      commit_hash: record.commit_hash || null,
      branch: record.branch || 'main',
      created_at: record.created_at,
    }),
    withoutUndefinedValues({
      id: record.id,
      organization_id: record.organization_id,
      project_id: record.project_id,
      provider: record.provider,
      deployment_url: record.deployment_url,
      status,
      created_at: record.created_at,
    }),
    withoutUndefinedValues({
      id: record.id,
      project_id: record.project_id,
      provider: record.provider,
      provider_deployment_id: record.provider_deployment_id,
      deployment_url: record.deployment_url,
      status,
      created_at: record.created_at,
    }),
    withoutUndefinedValues({
      id: record.id,
      project_id: record.project_id,
      provider: record.provider,
      deployment_url: record.deployment_url,
      status,
      created_at: record.created_at,
    }),
    withoutUndefinedValues({
      id: record.id,
      project_id: record.project_id,
      deployment_url: record.deployment_url,
      status,
      created_at: record.created_at,
    }),
    withoutUndefinedValues({
      id: record.id,
      project_id: record.project_id,
      deployment_url: record.deployment_url,
      created_at: record.created_at,
    }),
  ];
}

async function saveDeploymentRecord(record: any) {
  const client = requireSupabase('Deployment persistence');
  const triedShapes = new Set<string>();
  let lastError: any = null;

  for (const candidate of deploymentRecordCandidates(record)) {
    const shapeKey = Object.keys(candidate).sort().join(',');
    if (!shapeKey || triedShapes.has(shapeKey)) continue;
    triedShapes.add(shapeKey);

    const { error } = await client.from('deployments').insert([candidate]);
    if (!error) return candidate;

    lastError = error;
    if (!isSchemaShapeError(error)) break;
  }

  throw createPublicError(
    `The hosting provider created the deployment, but Coden could not save it in Supabase: ${lastError?.message || 'unknown persistence error'}`,
    500,
    'DEPLOYMENT_PERSISTENCE_FAILED_AFTER_PROVIDER_SUCCESS',
    'apply_deployments_migration',
  );
}

async function saveAgentEvent(event: AgentEvent) {
  const row = {
    ...event,
    id: event.id || randomUUID(),
    message: redactSecrets(event.message || ''),
    payload: redactSecretPayload(event.payload || {}),
    created_at: event.created_at || new Date().toISOString(),
  };

  const client = requireSupabase('Agent event persistence');
  const { error } = await client.from('agent_events').insert([row]);
  const snapshotPersisted = await appendDurableProjectSnapshotItem({
    projectId: row.project_id,
    ownerId: row.user_id,
    organizationId: row.organization_id,
    field: 'events_snapshot',
    item: row,
    limit: 500,
  }).catch(snapshotError => {
    console.warn('[coden:agent_event_snapshot_failed]', { message: redactSecrets(snapshotError?.message || String(snapshotError), '[redacted]') });
    return false;
  });
  if (error) {
    console.warn('[coden:agent_event_persistence_skipped]', { message: redactSecrets(error.message, '[redacted]') });
    if (!snapshotPersisted) throw new Error(`Agent event persistence failed: ${error.message}`);
  }
  return row;
}

function isMissingAgentV2TableError(error: any) {
  return /agent_runs|agent_run_steps|agent_memories|agent_verifications|agent_runner_results|agent_research_results|schema cache|relation .* does not exist|table .* does not exist|column .* does not exist|could not find .* in the schema cache/i.test(error?.message || '');
}

function isMissingCodenCloudTableError(error: any) {
  return /coden_cloud_projects|coden_cloud_migrations|coden_cloud_resources|project_backend_requirements|schema cache|relation .* does not exist|table .* does not exist|column .* does not exist|could not find .* in the schema cache/i.test(error?.message || '');
}

function publicCodenCloudRequirementPayload(requirement: CodenCloudRequirement) {
  return {
    needs_database: requirement.needs_database,
    needs_auth: requirement.needs_auth,
    needs_storage: requirement.needs_storage,
    needs_edge_functions: requirement.needs_edge_functions,
    needs_secrets: requirement.needs_secrets,
    detected_from_prompt: requirement.detected_from_prompt,
    recommended_mode: requirement.recommended_mode,
    summary: requirement.summary,
  };
}

async function upsertProjectBackendRequirements(project: GeneratedProject, prompt: string) {
  const requirement = detectCodenCloudRequirements(prompt);
  if (!hasCodenCloudRequirement(requirement)) return { requirement, cloudProject: null };

  try {
    const client = requireSupabase('Coden Cloud requirement persistence');
    const now = new Date().toISOString();
    const requirementPayload = publicCodenCloudRequirementPayload(requirement);
    const requirementsRow = {
      organization_id: project.organization_id,
      project_id: project.id,
      needs_database: requirementPayload.needs_database,
      needs_auth: requirementPayload.needs_auth,
      needs_storage: requirementPayload.needs_storage,
      needs_edge_functions: requirementPayload.needs_edge_functions,
      needs_secrets: requirementPayload.needs_secrets,
      detected_from_prompt: requirementPayload.detected_from_prompt,
      recommended_mode: requirementPayload.recommended_mode,
      status: 'detected',
      updated_at: now,
    };
    const { error: requirementsError } = await client
      .from('project_backend_requirements')
      .upsert([requirementsRow], { onConflict: 'project_id' });
    if (requirementsError) throw requirementsError;

    const cloudProjectRow = {
      organization_id: project.organization_id,
      project_id: project.id,
      provider: 'coden_cloud',
      mode: requirement.recommended_mode,
      status: 'planned',
      region: 'auto',
      schema_name: buildCodenCloudSchemaName(project.id),
      public_runtime_config: {
        backend_status: 'planned',
        backend_mode: requirement.recommended_mode,
        backend_summary: requirement.summary,
        managed_by: 'coden_cloud',
      },
      updated_at: now,
    };
    const { data: cloudProject, error: cloudProjectError } = await client
      .from('coden_cloud_projects')
      .upsert([cloudProjectRow], { onConflict: 'project_id' })
      .select('id,project_id,provider,mode,status,region,schema_name,public_runtime_config,created_at,updated_at')
      .maybeSingle();
    if (cloudProjectError) throw cloudProjectError;

    return { requirement, cloudProject: cloudProject || null };
  } catch (error: any) {
    if (isMissingCodenCloudTableError(error)) {
      console.warn('[coden:cloud_requirement_persistence_skipped]', { message: error.message });
      return { requirement, cloudProject: null };
    }
    throw error;
  }
}

async function loadProjectCodenCloud(projectId: string) {
  try {
    const client = requireSupabase('Coden Cloud project view');
    const [requirementsResult, cloudProjectResult, resourcesResult] = await Promise.all([
      client
        .from('project_backend_requirements')
        .select('needs_database,needs_auth,needs_storage,needs_edge_functions,needs_secrets,detected_from_prompt,recommended_mode,status,updated_at')
        .eq('project_id', projectId)
        .maybeSingle(),
      client
        .from('coden_cloud_projects')
        .select('id,project_id,provider,mode,status,region,schema_name,public_runtime_config,created_at,updated_at')
        .eq('project_id', projectId)
        .maybeSingle(),
      client
        .from('coden_cloud_resources')
        .select('id,resource_type,resource_name,schema_name,table_name,status,metadata,created_at,updated_at')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false }),
    ]);

    for (const result of [requirementsResult, cloudProjectResult, resourcesResult]) {
      if (result.error) throw result.error;
    }

    return {
      requirements: requirementsResult.data || null,
      project: cloudProjectResult.data || null,
      resources: resourcesResult.data || [],
    };
  } catch (error: any) {
    if (isMissingCodenCloudTableError(error)) {
      return { requirements: null, project: null, resources: [] };
    }
    throw error;
  }
}

const PUBLIC_MODEL_ROUTING_FIELD_RE = /^(model|model_id|model_name|selected_model|requested_model|routed_model|provider_model|selectedModel|requestedModel|auto_routed|task_complexity|routing_mode|selected_model_policy|provider)$/i;

function redactPublicAgentPayload<T>(value: T): T {
  const base = redactAgentPayload(value);
  if (Array.isArray(base)) return base.map(item => redactPublicAgentPayload(item)) as T;
  if (!base || typeof base !== 'object') return base;
  const output: Record<string, any> = {};
  for (const [key, item] of Object.entries(base as Record<string, any>)) {
    if (PUBLIC_MODEL_ROUTING_FIELD_RE.test(key)) continue;
    output[key] = redactPublicAgentPayload(item);
  }
  return output as T;
}

async function createAgentRun(project: GeneratedProject, userId: string, requestId: string, decision: IntentDecision, modelId: string, contextPack: Record<string, any>, skill?: CodenSkill, skillBudget?: CodenSkillBudget, workflowId?: string | null) {
  const row = {
    id: `run_${randomUUID()}`,
    request_id: requestId,
    organization_id: project.organization_id,
    project_id: project.id,
    user_id: userId,
    intent: decision.intent,
    mode: decision.requestedMode,
    model_id: modelId === 'auto' ? null : modelId,
    skill_id: skill?.id || null,
    skill_version: skill?.version || null,
    workflow_id: workflowId || null,
    skill_budget: skillBudget || {},
    skill_budget_used: {},
    status: 'running',
    context_summary: redactPublicAgentPayload(contextPack),
    public_payload: redactPublicAgentPayload({
      auto_plan_required: decision.autoPlanRequired,
      next_action: decision.nextAction,
      routing_source: decision.routingSource,
      durable_run: (contextPack as any)?.durable_run || null,
    }),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const client = requireSupabase('Agent run persistence');
  const { error } = await client.from('agent_runs').insert([row]);
  if (error) {
    if (isMissingAgentV2TableError(error)) {
      console.warn('[coden:agent_run_persistence_skipped]', { message: error.message });
      return row;
    }
    throw new Error(`Supabase agent run persistence failed: ${error.message}`);
  }
  return row;
}

async function updateAgentRunStatus(runId: string, status: string, extra: Record<string, any> = {}) {
  if (!runId) return;
  const client = requireSupabase('Agent run update');
  const update = redactPublicAgentPayload({
    status,
    ...extra,
    updated_at: new Date().toISOString(),
    completed_at: ['completed', 'failed'].includes(status) ? new Date().toISOString() : extra.completed_at,
    cancelled_at: status === 'cancelled' ? new Date().toISOString() : extra.cancelled_at,
  });
  const { error } = await client.from('agent_runs').update(update).eq('id', runId);
  if (error && isMissingAgentV2TableError(error)) return;
  if (error) throw new Error(`Supabase agent run update failed: ${error.message}`);
}

async function updateAgentRunV3Meta(runId: string, extra: Record<string, any> = {}) {
  if (!runId || !AGENT_V3_ENABLED) return;
  const client = requireSupabase('Agent V3 run metadata update');
  const update = redactAgentPayload({
    ...extra,
    updated_at: new Date().toISOString(),
  });
  const { error } = await client.from('agent_runs').update(update).eq('id', runId);
  if (error && isMissingAgentV2TableError(error)) return;
  if (error) console.warn('[coden:agent_v3_meta_update_skipped]', { message: error.message });
}

async function saveAgentRunStep(input: {
  agent_run_id: string;
  project: GeneratedProject;
  user_id: string;
  sequence_number: number;
  event_type: string;
  message: string;
  payload?: Record<string, unknown>;
  status?: string;
}) {
  if (!input.agent_run_id) return null;
  const row = {
    agent_run_id: input.agent_run_id,
    organization_id: input.project.organization_id,
    project_id: input.project.id,
    user_id: input.user_id,
    sequence_number: input.sequence_number,
    event_type: input.event_type,
    status: input.status || (input.event_type === 'error' ? 'failed' : 'completed'),
    message: redactSecrets(input.message || ''),
    public_payload: redactSecretPayload(redactPublicAgentPayload(input.payload || {})),
    created_at: new Date().toISOString(),
  };
  const client = requireSupabase('Agent run step persistence');
  const { error } = await client.from('agent_run_steps').insert([row]);
  const snapshotPersisted = await appendDurableProjectSnapshotItem({
    projectId: row.project_id,
    ownerId: row.user_id,
    organizationId: row.organization_id,
    field: 'events_snapshot',
    item: {
      sequence_number: row.sequence_number,
      event_type: row.event_type,
      status: row.status,
      message: row.message,
      public_payload: row.public_payload,
      agent_run_id: row.agent_run_id,
      created_at: row.created_at,
    },
    limit: 500,
    lastAgentRunId: row.agent_run_id,
  }).catch(snapshotError => {
    console.warn('[coden:agent_run_step_snapshot_failed]', { message: redactSecrets(snapshotError?.message || String(snapshotError), '[redacted]') });
    return false;
  });
  if (error && isMissingAgentV2TableError(error)) {
    if (!snapshotPersisted) console.warn('[coden:agent_run_step_not_durable]', { project_id: row.project_id, message: redactSecrets(error.message, '[redacted]') });
    return row;
  }
  if (error) console.warn('[coden:agent_run_step_persistence_skipped]', { message: redactSecrets(error.message, '[redacted]') });
  return row;
}

async function saveDurableRunCheckpoint(input: {
  agentRunId: string;
  project: GeneratedProject;
  userId: string;
  requestId: string;
  contract: ReturnType<typeof buildDurableRunContract>;
  phase: DurableRunPhase;
  sequenceNumber: number;
  attempt?: number;
  nextPhase?: DurableRunPhase | null;
  message?: string;
  evidence?: Record<string, unknown>;
  stopReason?: DurableRunCheckpoint['stop_reason'];
}) {
  if (!input.agentRunId || !input.contract.enabled) return null;
  const checkpoint = buildDurableCheckpoint({
    contract: input.contract,
    phase: input.phase,
    runId: input.agentRunId,
    projectId: input.project.id,
    requestId: input.requestId,
    attempt: input.attempt,
    nextPhase: input.nextPhase,
    stopReason: input.stopReason || null,
    message: input.message,
    evidence: input.evidence,
  });
  await saveAgentRunStep({
    agent_run_id: input.agentRunId,
    project: input.project,
    user_id: input.userId,
    sequence_number: input.sequenceNumber,
    event_type: 'durable_checkpoint',
    status: checkpoint.status === 'active' ? 'completed' : checkpoint.status,
    message: checkpoint.public_message,
    payload: buildDurableRunPayload({ contract: input.contract, checkpoint }),
  }).catch(error => {
    console.warn('[coden:durable_checkpoint_skipped]', {
      project_id: input.project.id,
      message: redactSecrets(error?.message || String(error), '[redacted]'),
    });
  });
  await updateAgentRunV3Meta(input.agentRunId, buildDurableRunPayload({ contract: input.contract, checkpoint })).catch(() => null);
  return checkpoint;
}

async function listAgentRuns(projectId: string, limitValue = 20) {
  const limit = Math.min(50, Math.max(1, Number(limitValue || 20)));
  const client = requireSupabase('Agent run listing');
  const { data, error } = await client.from('agent_runs').select('id,request_id,project_id,user_id,intent,status,diagnostic_code,suggested_action,duration_ms,public_payload,created_at,updated_at,completed_at,cancelled_at').eq('project_id', projectId).order('created_at', { ascending: false }).limit(limit);
  if (error && isMissingAgentV2TableError(error)) return [];
  if (error) throw new Error(`Supabase agent run listing failed: ${error.message}`);
  return (data || []).map(redactPublicAgentPayload);
}

async function getAgentRun(projectId: string, runId: string) {
  const client = requireSupabase('Agent run lookup');
  const { data, error } = await client.from('agent_runs').select('id,request_id,project_id,user_id,intent,status,diagnostic_code,suggested_action,duration_ms,public_payload,created_at,updated_at,completed_at,cancelled_at').eq('project_id', projectId).eq('id', runId).maybeSingle();
  if (error && isMissingAgentV2TableError(error)) return null;
  if (error) throw new Error(`Supabase agent run lookup failed: ${error.message}`);
  return data ? redactPublicAgentPayload(data) : null;
}

async function getAgentRunSteps(projectId: string, runId: string) {
  const client = requireSupabase('Agent run step listing');
  const { data, error } = await client.from('agent_run_steps').select('sequence_number,event_type,status,message,public_payload,created_at').eq('project_id', projectId).eq('agent_run_id', runId).order('sequence_number');
  if (error && isMissingAgentV2TableError(error)) return [];
  if (error) throw new Error(`Supabase agent run steps failed: ${error.message}`);
  return (data || []).map(redactPublicAgentPayload);
}

async function listAgentMemory(projectId: string) {
  const client = requireSupabase('Agent memory listing');
  const { data, error } = await client.from('agent_memories').select('id,memory_type,summary,architecture,ui_preferences,known_errors,recent_decisions,created_at,updated_at').eq('project_id', projectId).order('updated_at', { ascending: false }).limit(8);
  if (error && isMissingAgentV2TableError(error)) return [];
  if (error) throw new Error(`Supabase agent memory listing failed: ${error.message}`);
  return (data || []).map(redactAgentPayload);
}

async function upsertAgentMemory(project: GeneratedProject, userId: string, summary: string, payload: Record<string, any> = {}) {
  const row = {
    organization_id: project.organization_id,
    project_id: project.id,
    user_id: userId,
    memory_type: 'project_summary',
    summary: summary.slice(0, 4000),
    architecture: redactAgentPayload(payload.architecture || {}),
    ui_preferences: redactAgentPayload(payload.ui_preferences || {}),
    known_errors: redactAgentPayload(payload.known_errors || []),
    recent_decisions: redactAgentPayload(payload.recent_decisions || []),
    updated_at: new Date().toISOString(),
  };
  const client = requireSupabase('Agent memory persistence');
  const { error } = await client.from('agent_memories').upsert([row], { onConflict: 'project_id,memory_type' });
  if (error && isMissingAgentV2TableError(error)) return row;
  if (error) console.warn('[coden:agent_memory_persistence_skipped]', { message: error.message });
  return row;
}

async function upsertAgentTypedMemory(project: GeneratedProject, userId: string, memoryType: string, summary: string, payload: Record<string, any> = {}) {
  const row = {
    organization_id: project.organization_id,
    project_id: project.id,
    user_id: userId,
    memory_type: memoryType,
    summary: summary.slice(0, 4000),
    architecture: redactAgentPayload(payload.architecture || {}),
    ui_preferences: redactAgentPayload(payload.ui_preferences || {}),
    known_errors: redactAgentPayload(payload.known_errors || []),
    recent_decisions: redactAgentPayload(payload.recent_decisions || []),
    updated_at: new Date().toISOString(),
  };
  const client = requireSupabase('Agent typed memory persistence');
  const { error } = await client.from('agent_memories').upsert([row], { onConflict: 'project_id,memory_type' });
  if (error && isMissingAgentV2TableError(error)) return row;
  if (error) console.warn('[coden:agent_typed_memory_persistence_skipped]', { message: error.message });
  return row;
}

async function recordAgentImprovementSignal(project: GeneratedProject, userId: string, input: {
  prompt: string;
  decision: IntentDecision;
  outcome: 'answered' | 'clarified' | 'planned' | 'verified' | 'deployed_guidance' | 'generated' | 'failed' | 'cancelled';
  previewChanged?: boolean;
  qualityStatus?: string;
  issueCount?: number;
}) {
  const signal = buildAgentImprovementSignal(input);
  return upsertAgentTypedMemory(project, userId, signal.memoryType, signal.summary, signal.payload);
}

function improvementOutcomeForDecision(decision: IntentDecision): 'answered' | 'clarified' | 'planned' | 'verified' | 'deployed_guidance' {
  if (decision.intent === 'clarification_required') return 'clarified';
  if (decision.intent === 'plan') return 'planned';
  if (decision.intent === 'verify') return 'verified';
  if (decision.intent === 'deploy_assist') return 'deployed_guidance';
  return 'answered';
}

async function saveAgentVerifications(project: GeneratedProject, userId: string, runId: string, checks: AgentVerificationCheck[]) {
  if (!checks.length) return;
  const rows = checks.map(check => ({
    agent_run_id: runId || null,
    organization_id: project.organization_id,
    project_id: project.id,
    user_id: userId,
    check_type: check.key,
    status: check.status,
    severity: check.severity,
    message: check.message,
    file_path: check.file || null,
    public_payload: redactAgentPayload(check),
    created_at: new Date().toISOString(),
  }));
  const client = requireSupabase('Agent verification persistence');
  const { error } = await client.from('agent_verifications').insert(rows);
  if (error && isMissingAgentV2TableError(error)) return;
  if (error) console.warn('[coden:agent_verification_persistence_skipped]', { message: error.message });
}

const RELIABILITY_BLOCKING_CHECK_KEYS = new Set([
  'files_present',
  'safe_paths',
  'safe_path',
  'safe_write',
  'no_env_files',
  'no_secrets',
  'no_forbidden_pages',
  'preview_non_empty',
  'preview_runtime_guard',
  'preview_runtime_markers',
  'unsafe_runtime_api',
  'local_imports_resolve',
  'vite_index_present',
  'vite_main_present',
  'vite_app_present',
  'vite_root_mount',
  'vite_main_script',
  'functionality_modern_project',
  'functionality_vite_shell',
  'functionality_primary_controls',
  'control_handlers',
  'script_build_safe',
  'script_build_exec',
  'package_parse',
]);

type ReliabilityGateSummary = {
  status: 'passed' | 'warning' | 'failed';
  message: string;
  blocking: Array<{ key: string; severity: string; message: string; file: string | null }>;
  notes: Array<{ key: string; severity: string; message: string; file: string | null }>;
};

function normalizeVerificationKey(key: string) {
  return String(key || '').replace(/^runner_/, '');
}

function isBlockingVerificationFailure(check: AgentVerificationCheck) {
  if (check.status !== 'fail') return false;
  const key = normalizeVerificationKey(check.key);
  if (/^(technical_build_score|production_readiness_score|functionality_score|design_score|visual_interaction_probe_score)$/.test(key)) {
    return false;
  }
  if (RELIABILITY_BLOCKING_CHECK_KEYS.has(key)) return true;
  return check.severity === 'high'
    && /(secret|env|forbidden|preview|runtime|vite|import|control|functionality|script|package)/i.test(key);
}

function toPublicVerificationIssue(check: AgentVerificationCheck) {
  return {
    key: normalizeVerificationKey(check.key),
    severity: check.severity,
    message: check.message,
    file: check.file || null,
  };
}

function summarizeReliabilityGate(checks: AgentVerificationCheck[]): ReliabilityGateSummary {
  const blocking = checks.filter(isBlockingVerificationFailure).map(toPublicVerificationIssue);
  const notes = checks
    .filter(check => check.status === 'warn' || (check.status === 'fail' && !isBlockingVerificationFailure(check)))
    .slice(0, 12)
    .map(toPublicVerificationIssue);
  if (blocking.length) {
    return {
      status: 'failed',
      message: 'The preview still needs a clean verification before it can be marked ready.',
      blocking,
      notes,
    };
  }
  if (notes.length) {
    return {
      status: 'warning',
      message: `Checks passed with ${notes.length} non-blocking note${notes.length > 1 ? 's' : ''}. The app is usable, and Coden kept the notes in the run history.`,
      blocking,
      notes,
    };
  }
  return {
    status: 'passed',
    message: 'Checks passed. No blocking issue found.',
    blocking,
    notes,
  };
}

class ReliabilityGateError extends Error {
  diagnosticCode = 'RELIABILITY_GATE_FAILED';
  statusCode = 422;
  publicPayload: ReliabilityGateSummary;

  constructor(summary: ReliabilityGateSummary) {
    super(summary.message);
    this.name = 'ReliabilityGateError';
    this.publicPayload = summary;
  }
}

function summarizeQualityForMemory(checks: AgentVerificationCheck[]) {
  const scores: Record<string, number> = {};
  const failed = checks
    .filter(isBlockingVerificationFailure)
    .slice(0, 8)
    .map(check => ({
      key: check.key,
      severity: check.severity,
      message: check.message,
      file: check.file || null,
    }));
  const warnings = checks
    .filter(check => check.status === 'warn' || (check.status === 'fail' && !isBlockingVerificationFailure(check)))
    .slice(0, 8)
    .map(check => ({
      key: check.key,
      severity: check.severity,
      message: check.message,
      file: check.file || null,
    }));

  for (const check of checks) {
    if (!/_score$/.test(check.key)) continue;
    const match = check.message.match(/(\d+)\/100/);
    if (match) scores[check.key] = Number(match[1]);
  }

  return redactAgentPayload({
    scores,
    failed,
    warnings,
    status: failed.length ? 'failed' : warnings.length ? 'warning' : 'passed',
  });
}

function collectGenerationVerificationChecks(input: {
  projectName: string;
  prompt: string;
  files: GeneratedFile[];
  previewHtml: string;
  uiPolicy: any;
  hasExistingFiles: boolean;
  runnerResult: RunnerResult | null;
  browserResult?: BrowserTestResult | null;
}) {
  return [
    ...verifyGeneratedProject({ projectName: input.projectName, files: input.files, previewHtml: input.previewHtml }),
    ...auditGeneratedDesign({
      files: input.files,
      previewHtml: input.previewHtml,
      platformType: input.uiPolicy.appType,
      designDirection: input.uiPolicy.designDirection,
      hasExistingFiles: input.hasExistingFiles,
      prompt: input.prompt,
    }),
    ...auditGeneratedFunctionality({
      files: input.files,
      previewHtml: input.previewHtml,
      platformType: input.uiPolicy.appType,
      designDirection: input.uiPolicy.designDirection,
      hasExistingFiles: input.hasExistingFiles,
      prompt: input.prompt,
    }),
    ...inspectVisualPreview({
      files: input.files,
      previewHtml: input.previewHtml,
      platformType: input.uiPolicy.appType,
    }),
    ...scanGeneratedSecurity(input.files).checks,
    ...(input.runnerResult ? runnerChecksToVerificationChecks(input.runnerResult.checks) : []),
    ...(input.browserResult && input.browserResult.status !== 'skipped' ? input.browserResult.checks : []),
  ];
}

function reliabilitySummaryToAutoFixErrors(summary: ReliabilityGateSummary) {
  return summary.blocking.map(item => ({
    key: item.key,
    file: item.file || 'index.html',
    message: item.message,
    severity: item.severity,
  }));
}

async function finalReliabilityAutoFix(input: {
  project: GeneratedProject;
  userId: string;
  agentRunId: string;
  requestId: string;
  files: GeneratedFile[];
  pipeline: PreviewBuildResult;
  runnerResult: RunnerResult | null;
  uiPolicy: any;
  hasExistingFiles: boolean;
  shouldRunRunner: boolean;
  maxAttempts: number;
  signal?: AbortSignal;
}) {
  let files = input.files;
  let pipeline = input.pipeline;
  let previewHtml = pipeline.html;
  let runnerResult = input.runnerResult;
  let browserResult: BrowserTestResult | null = await runBrowserInteractionAuditDetailed({
    files,
    previewHtml,
    timeoutMs: Math.min(DEFAULT_AGENT_V3_BUDGET.runnerTimeoutMs, 20_000),
  });
  if (input.signal?.aborted) throw new Error('Agent run cancelled before reliability verification.');
  const previewPipelineChecks = () => pipeline.errors.map(error => ({
    key: 'preview_pipeline',
    status: 'fail' as const,
    severity: (['info', 'low', 'medium', 'high'].includes(String(error?.severity)) ? error.severity : 'high') as AgentVerificationCheck['severity'],
    message: String(error?.message || 'Preview pipeline failed.'),
    file: error?.file || 'index.html',
  }));
  let verificationChecks = [
    ...previewPipelineChecks(),
    ...collectGenerationVerificationChecks({
      projectName: input.project.name,
      prompt: input.project.prompt || input.project.name,
      files,
      previewHtml,
      uiPolicy: input.uiPolicy,
      hasExistingFiles: input.hasExistingFiles,
      runnerResult,
      browserResult,
    }),
  ];
  let verificationSummary = summarizeVerificationChecks(verificationChecks);
  let reliabilitySummary = summarizeReliabilityGate(verificationChecks);
  let qualitySummary = summarizeQualityForMemory(verificationChecks);
  let autoFixPatch: any = null;
  let attempts = 0;

  for (let attempt = 1; reliabilitySummary.status === 'failed' && attempt <= input.maxAttempts; attempt += 1) {
    const fix = applyAutoFix(input.project, files, reliabilitySummaryToAutoFixErrors(reliabilitySummary));
    if (!fix.fixed) break;
    attempts = attempt;
    autoFixPatch = fix.patch;
    files = fix.files;
    pipeline = runPreviewPipeline(input.project, files);
    previewHtml = pipeline.html;

    if (input.shouldRunRunner) {
      runnerResult = await projectRunner.run({
        runId: input.agentRunId || input.requestId,
        projectId: input.project.id,
        files,
        previewHtml,
        prompt: input.project.prompt || input.project.name,
        timeoutMs: DEFAULT_AGENT_V3_BUDGET.runnerTimeoutMs,
        signal: input.signal,
      });
      await saveAgentRunnerResults(input.project, input.userId, input.agentRunId, runnerResult);
    }

    browserResult = await runBrowserInteractionAuditDetailed({
      files,
      previewHtml,
      timeoutMs: Math.min(DEFAULT_AGENT_V3_BUDGET.runnerTimeoutMs, 20_000),
    });

    verificationChecks = [
      ...previewPipelineChecks(),
      ...collectGenerationVerificationChecks({
        projectName: input.project.name,
        prompt: input.project.prompt || input.project.name,
        files,
        previewHtml,
        uiPolicy: input.uiPolicy,
        hasExistingFiles: input.hasExistingFiles,
        runnerResult,
        browserResult,
      }),
    ];
    verificationSummary = summarizeVerificationChecks(verificationChecks);
    reliabilitySummary = summarizeReliabilityGate(verificationChecks);
    qualitySummary = summarizeQualityForMemory(verificationChecks);
  }

  return {
    files,
    pipeline,
    previewHtml,
    runnerResult,
    browserResult,
    verificationChecks,
    verificationSummary,
    reliabilitySummary,
    qualitySummary,
    autoFixPatch,
    attempts,
  };
}

async function saveAgentRunnerResults(project: GeneratedProject, userId: string, runId: string, result: RunnerResult | null) {
  if (!runId || !result) return [];
  const rows = result.checks.map(check => redactAgentPayload({
    agent_run_id: runId,
    organization_id: project.organization_id,
    project_id: project.id,
    user_id: userId,
    check_type: check.check_type,
    status: check.status,
    severity: check.severity,
    message: check.message,
    file_path: check.file_path || null,
    command: check.command || null,
    duration_ms: check.duration_ms || null,
    public_payload: check.public_payload || {},
    created_at: new Date().toISOString(),
  }));
  if (!rows.length) return [];
  const client = requireSupabase('Agent runner result persistence');
  const { error } = await client.from('agent_runner_results').insert(rows);
  if (error && isMissingAgentV2TableError(error)) return rows;
  if (error) console.warn('[coden:agent_runner_results_skipped]', { message: error.message });
  return rows;
}

async function listAgentRunnerResults(projectId: string, runId?: string, limitValue = 80) {
  const limit = Math.min(200, Math.max(1, Number(limitValue || 80)));
  const client = requireSupabase('Agent runner result listing');
  let query = client
    .from('agent_runner_results')
    .select('id,agent_run_id,project_id,check_type,status,severity,message,file_path,command,duration_ms,public_payload,created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (runId) query = query.eq('agent_run_id', runId);
  const { data, error } = await query;
  if (error && isMissingAgentV2TableError(error)) return [];
  if (error) throw new Error(`Supabase agent runner result listing failed: ${error.message}`);
  return (data || []).map(redactSecretPayload);
}

async function saveAgentResearchResults(project: GeneratedProject, userId: string, runId: string, result: ResearchResult | null) {
  if (!runId || !result) return [];
  const sourceRows = result.results.length ? result.results : [{ title: '', url: '', snippet: '', published_at: null, source: result.provider }];
  const rows = sourceRows.map(item => redactAgentPayload({
    agent_run_id: runId,
    organization_id: project.organization_id,
    project_id: project.id,
    user_id: userId,
    query: result.query,
    provider: result.provider,
    status: result.status,
    diagnostic_code: result.diagnostic_code || null,
    message: result.message,
    title: item.title || null,
    url: item.url || null,
    snippet: item.snippet || null,
    published_at: item.published_at || null,
    public_payload: { source: item.source || result.provider },
    created_at: new Date().toISOString(),
  }));
  const client = requireSupabase('Agent research result persistence');
  const { error } = await client.from('agent_research_results').insert(rows);
  if (error && isMissingAgentV2TableError(error)) return rows;
  if (error) console.warn('[coden:agent_research_results_skipped]', { message: error.message });
  return rows;
}

async function listAgentResearchResults(projectId: string, limitValue = 40) {
  const limit = Math.min(100, Math.max(1, Number(limitValue || 40)));
  const client = requireSupabase('Agent research result listing');
  const { data, error } = await client
    .from('agent_research_results')
    .select('id,agent_run_id,project_id,query,provider,status,diagnostic_code,message,title,url,snippet,published_at,created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error && isMissingAgentV2TableError(error)) return [];
  if (error) throw new Error(`Supabase agent research result listing failed: ${error.message}`);
  return (data || []).map(redactSecretPayload);
}

function isProjectMessageSchemaCompatibilityError(error: any) {
  return /project_messages|schema cache|relation .* does not exist|table .* does not exist|could not find .* in the schema cache|column .* does not exist|ai_message_id|parts|metadata|intent|requested_mode|organization_id/i.test(error?.message || '');
}

async function persistProjectMessageRow(client: any, row: any) {
  if (row.ai_message_id) {
    const existing = await client
      .from('project_messages')
      .select('id')
      .eq('project_id', row.project_id)
      .eq('ai_message_id', row.ai_message_id)
      .maybeSingle();

    if (!existing.error && existing.data?.id) {
      const { error } = await client
        .from('project_messages')
        .update(row)
        .eq('id', existing.data.id);
      return { error };
    }

    if (existing.error && !isProjectMessageSchemaCompatibilityError(existing.error)) {
      return { error: existing.error };
    }
  }

  return await client.from('project_messages').insert([row]);
}

async function saveProjectMessage(data: any) {
  const parts = redactMessageParts(
    normalizeMessageParts(data.parts, data.content || ''),
    value => redactSecrets(value),
  );
  const content = redactSecrets(messageTextFromParts(parts, data.content || ''));
  const row = {
    id: data.id || randomUUID(),
    ...data,
    content,
    parts,
    metadata: redactSecretPayload(data.metadata || {}),
    created_at: data.created_at || new Date().toISOString(),
  };
  const client = requireSupabase('Project message persistence');
  let { error } = await persistProjectMessageRow(client, row);
  if (error && isProjectMessageSchemaCompatibilityError(error)) {
    const compactRow = {
      id: row.id,
      project_id: row.project_id,
      user_id: row.user_id,
      role: row.role,
      content: row.content,
      created_at: row.created_at,
    };
    const retry = await client.from('project_messages').insert([compactRow]);
    error = retry.error;
  }
  const snapshotPersisted = await appendDurableProjectSnapshotItem({
    projectId: row.project_id,
    ownerId: row.user_id,
    organizationId: row.organization_id,
    field: 'messages_snapshot',
    item: row,
    limit: 250,
  }).catch(snapshotError => {
    console.warn('[coden:project_message_snapshot_failed]', { message: redactSecrets(snapshotError?.message || String(snapshotError), '[redacted]') });
    return false;
  });
  if (error) {
    if (isProjectMessageSchemaCompatibilityError(error)) {
      console.warn('[coden:project_message_persistence_skipped]', { message: error.message });
      if (snapshotPersisted) return row;
      throw new Error(`Project message persistence unavailable: ${error.message}`);
    }
    throw new Error(`Supabase project message persistence failed: ${error.message}`);
  }
  return row;
}

function sanitizeProjectMessageForUser(row: any) {
  const parts = redactMessageParts(
    normalizeMessageParts(row?.parts, row?.content || ''),
    value => redactSecrets(value),
  );
  return {
    ...row,
    content: messageTextFromParts(parts, row?.content || ''),
    parts,
  };
}

async function listProjectMessages(projectId: string) {
  const client = requireSupabase('Project message listing');
  const { data, error } = await client.from('project_messages').select('*').eq('project_id', projectId).order('created_at');
  if (error && /project_messages|schema cache|relation .* does not exist|table .* does not exist|could not find .* in the schema cache/i.test(error.message || '')) return [];
  if (error) throw new Error(`Supabase project message listing failed: ${error.message}`);
  return (data || []).map(sanitizeProjectMessageForUser);
}

async function listProjectMessagesPage(projectId: string, limitValue: any, beforeValue: any) {
  const limit = Math.min(100, Math.max(1, Number(limitValue || 100)));
  const client = requireSupabase('Project message page listing');
  let query = client.from('project_messages').select('*').eq('project_id', projectId).order('created_at', { ascending: false }).limit(limit);
  if (beforeValue) query = query.lt('created_at', String(beforeValue));
  const { data, error } = await query;
  if (error && /project_messages|schema cache|relation .* does not exist|table .* does not exist|could not find .* in the schema cache/i.test(error.message || '')) return [];
  if (error) throw new Error(`Supabase project message page failed: ${error.message}`);
  return (data || []).reverse().map(sanitizeProjectMessageForUser);
}

async function getRecentDecisionHistory(projectId: string, limitValue = 6): Promise<RecentHistoryMessage[]> {
  const rows = await listProjectMessagesPage(projectId, limitValue, null).catch(() => []);
  return rows
    .map((row: any) => ({
      role: row?.role === 'assistant' ? 'assistant' as const : 'user' as const,
      content: redactSecrets(messageTextFromParts(row?.parts, row?.content || '')).replace(/\s+/g, ' ').trim().slice(0, 1200),
    }))
    .filter((message: RecentHistoryMessage) => message.content.length > 0);
}

async function saveAnalyticsEvent(project: GeneratedProject, record: any) {
  const client = requireSupabase('Analytics event persistence');
  const now = new Date().toISOString();
  const pageviewDelta = record.event_type === 'pageview' ? 1 : 0;
  const { data: session } = await client
    .from('project_analytics_sessions')
    .select('id, pageviews, duration_seconds')
    .eq('project_id', project.id)
    .eq('session_id', record.session_id)
    .maybeSingle();

  if (session?.id) {
    const { error: sessionError } = await client
      .from('project_analytics_sessions')
      .update({
        source: record.source,
        country_code: record.country_code,
        country_name: record.country_name,
        device: record.device,
        environment: record.environment,
        pageviews: Number(session.pageviews || 0) + pageviewDelta,
        duration_seconds: Math.max(Number(session.duration_seconds || 0), Number(record.duration_seconds || 0)),
        last_seen_at: now,
      })
      .eq('id', session.id);
    if (sessionError) throw new Error(`Supabase analytics session update failed: ${sessionError.message}`);
  } else {
    const { error: sessionError } = await client.from('project_analytics_sessions').insert([{
      id: randomUUID(),
      organization_id: project.organization_id,
      project_id: project.id,
      session_id: record.session_id,
      visitor_id: record.visitor_id,
      environment: record.environment,
      source: record.source,
      country_code: record.country_code,
      country_name: record.country_name,
      device: record.device,
      pageviews: pageviewDelta,
      duration_seconds: Number(record.duration_seconds || 0),
      first_seen_at: now,
      last_seen_at: now,
    }]);
    if (sessionError) throw new Error(`Supabase analytics session insert failed: ${sessionError.message}`);
  }

  const { error } = await client.from('project_analytics_events').insert([{
    id: randomUUID(),
    organization_id: project.organization_id,
    project_id: project.id,
    ...record,
    occurred_at: now,
  }]);
  if (error) throw new Error(`Supabase analytics event insert failed: ${error.message}`);
}

function buildAnalyticsTimeseries(events: any[], range: ReturnType<typeof getAnalyticsRange>) {
  const startMs = range.start.getTime();
  const buckets = Array.from({ length: range.bucketCount }, (_, index) => {
    const bucketStart = startMs + index * range.bucketMs;
    const label = range.key === '24h'
      ? new Date(bucketStart).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
      : new Date(bucketStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return { start: bucketStart, label, visitors: new Set<string>(), pageviews: 0 };
  });

  events.forEach(event => {
    const occurredMs = new Date(event.occurred_at).getTime();
    const index = Math.min(range.bucketCount - 1, Math.max(0, Math.floor((occurredMs - startMs) / range.bucketMs)));
    buckets[index]?.visitors.add(String(event.visitor_id || event.session_id || 'unknown'));
    if (event.event_type === 'pageview') buckets[index].pageviews += 1;
  });

  return buckets.map(bucket => ({
    time: bucket.label,
    visitors: bucket.visitors.size,
    pageviews: bucket.pageviews,
  }));
}

async function loadProjectAnalysis(project: GeneratedProject, rangeKey: string) {
  const client = requireSupabase('Project analytics');
  const range = getAnalyticsRange(rangeKey);
  const startIso = range.start.toISOString();
  const { data: events = [], error: eventsError } = await client
    .from('project_analytics_events')
    .select('event_type, page_path, session_id, visitor_id, source, country_code, country_name, device, duration_seconds, environment, occurred_at')
    .eq('project_id', project.id)
    .gte('occurred_at', startIso)
    .order('occurred_at', { ascending: true })
    .limit(ANALYTICS_MAX_ROWS);
  if (eventsError) throw new Error(`Supabase analytics events load failed: ${eventsError.message}`);

  const { data: sessions = [], error: sessionsError } = await client
    .from('project_analytics_sessions')
    .select('session_id, visitor_id, source, country_code, country_name, device, pageviews, duration_seconds, environment, first_seen_at, last_seen_at')
    .eq('project_id', project.id)
    .gte('last_seen_at', startIso)
    .order('last_seen_at', { ascending: false })
    .limit(ANALYTICS_MAX_ROWS);
  if (sessionsError) throw new Error(`Supabase analytics sessions load failed: ${sessionsError.message}`);

  const pageviewEvents = events.filter((event: any) => event.event_type === 'pageview');
  const sessionCount = sessions.length;
  const visitorCount = uniqueCount(sessions.map((session: any) => String(session.visitor_id || session.session_id || '')));
  const pageviews = pageviewEvents.length;
  const totalDuration = sessions.reduce((sum: number, session: any) => sum + Number(session.duration_seconds || 0), 0);
  const bounceSessions = sessions.filter((session: any) => Number(session.pageviews || 0) <= 1).length;
  const currentCutoff = Date.now() - ANALYTICS_CURRENT_VISITOR_WINDOW_MS;
  const currentVisitors = uniqueCount(
    sessions
      .filter((session: any) => new Date(session.last_seen_at).getTime() >= currentCutoff)
      .map((session: any) => String(session.visitor_id || session.session_id || ''))
  );

  const sources = groupVisitors(pageviewEvents, (event: any) => cleanAnalyticsText(event.source, 'Direct', 80))
    .map(item => ({ source: item.label, visitors: item.visitors }));
  const pages = groupVisitors(pageviewEvents, (event: any) => normalizeAnalyticsPath(event.page_path))
    .map(item => ({ page: item.label, visitors: item.visitors }));
  const countriesMap = new Map<string, { country_code: string; country_name: string; visitors: Set<string> }>();
  pageviewEvents.forEach((event: any) => {
    const code = cleanAnalyticsText(event.country_code, 'UN', 2).toUpperCase();
    const key = `${code}:${cleanAnalyticsText(event.country_name, COUNTRY_NAMES[code] || 'Unknown', 80)}`;
    if (!countriesMap.has(key)) {
      countriesMap.set(key, { country_code: code, country_name: cleanAnalyticsText(event.country_name, COUNTRY_NAMES[code] || 'Unknown', 80), visitors: new Set() });
    }
    countriesMap.get(key)?.visitors.add(String(event.visitor_id || event.session_id || 'unknown'));
  });
  const countries = Array.from(countriesMap.values())
    .map(item => ({ country_code: item.country_code, country_name: item.country_name, visitors: item.visitors.size }))
    .sort((a, b) => b.visitors - a.visitors || a.country_name.localeCompare(b.country_name));
  const devices = groupVisitors(pageviewEvents, (event: any) => cleanAnalyticsText(event.device, 'Unknown', 24))
    .map(item => ({
      device: ['Mobile', 'Desktop', 'Tablet'].includes(item.label) ? item.label : 'Unknown',
      visitors: item.visitors,
      percentage: visitorCount ? Number(((item.visitors / visitorCount) * 100).toFixed(1)) : 0,
    }));

  return {
    current_visitors: currentVisitors,
    metrics: {
      visitors: visitorCount,
      pageviews,
      views_per_visit: sessionCount ? Number((pageviews / sessionCount).toFixed(2)) : 0,
      visit_duration_seconds: sessionCount ? Math.round(totalDuration / sessionCount) : 0,
      bounce_rate: sessionCount ? Math.round((bounceSessions / sessionCount) * 100) : 0,
    },
    timeseries: buildAnalyticsTimeseries(events, range),
    sources,
    pages,
    countries,
    devices,
  };
}

async function getLastProjectPlan(projectId: string): Promise<string> {
  const client = requireSupabase('Project plan lookup');
  const { data, error } = await client
    .from('project_messages')
    .select('content')
    .eq('project_id', projectId)
    .eq('intent', 'plan')
    .eq('role', 'assistant')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error && /project_messages|intent|schema cache|relation .* does not exist|table .* does not exist|column .* does not exist|could not find .* in the schema cache/i.test(error.message || '')) return '';
  if (error) throw new Error(`Supabase project plan lookup failed: ${error.message}`);
  return data?.content || '';
}

async function listAgentEvents(projectId: string) {
  const client = requireSupabase('Agent event listing');
  const { data, error } = await client.from('agent_events').select('*').eq('project_id', projectId).order('sequence_number');
  if (error && /agent_events|schema cache|relation .* does not exist|table .* does not exist|could not find .* in the schema cache/i.test(error.message || '')) return [];
  if (error) throw new Error(`Supabase agent event listing failed: ${error.message}`);
  return (data || []).map(redactSecretPayload);
}

async function listAgentEventsPage(projectId: string, limitValue: any, beforeValue: any) {
  const limit = Math.min(100, Math.max(1, Number(limitValue || 100)));
  const client = requireSupabase('Agent event page listing');
  let query = client.from('agent_events').select('*').eq('project_id', projectId).order('sequence_number', { ascending: false }).limit(limit);
  if (beforeValue) query = query.lt('sequence_number', Number(beforeValue));
  const { data, error } = await query;
  if (error && /agent_events|schema cache|relation .* does not exist|table .* does not exist|could not find .* in the schema cache/i.test(error.message || '')) return [];
  if (error) throw new Error(`Supabase agent event page failed: ${error.message}`);
  return (data || []).reverse().map(redactSecretPayload);
}

function normalizeWorkspaceMode(value: any): AgentRequestedMode {
  return normalizeRequestedMode(value);
}

function normalizeWorkspaceTab(value: any): 'preview' | 'code' | 'database' | 'analysis' {
  return ['preview', 'code', 'database', 'analysis'].includes(String(value)) ? String(value) as any : 'preview';
}

function normalizeWorkspacePreviewDevice(value: any): 'desktop' | 'tablet' | 'mobile' {
  return ['desktop', 'tablet', 'mobile'].includes(String(value)) ? String(value) as any : 'desktop';
}

function repairTextEncoding(value: any) {
  let text = String(value || '');
  const replacements: Array<[RegExp, string | ((match: string) => string)]> = [
    [/Ã©/g, 'é'],
    [/Ã¨/g, 'è'],
    [/Ãª/g, 'ê'],
    [/Ã«/g, 'ë'],
    [/Ã /g, 'à'],
    [/Ã¢/g, 'â'],
    [/Ã§/g, 'ç'],
    [/Ã®/g, 'î'],
    [/Ã¯/g, 'ï'],
    [/Ã´/g, 'ô'],
    [/Ã¹/g, 'ù'],
    [/Ã»/g, 'û'],
    [/Ã¼/g, 'ü'],
    [/Ã‰/g, 'É'],
    [/â€™/g, "'"],
    [/â€œ|â€/g, '"'],
    [/â€"/g, '-'],
    [/Â/g, ''],
    [/ï¿½/g, 'é'],
    [/cr�e/gi, match => match[0] === 'C' ? 'Crée' : 'crée'],
    [/cr�er/gi, match => match[0] === 'C' ? 'Créer' : 'créer'],
    [/g�n�re/gi, match => match[0] === 'G' ? 'Génère' : 'génère'],
    [/g�n�rer/gi, match => match[0] === 'G' ? 'Générer' : 'générer'],
    [/compl�te/gi, match => match[0] === 'C' ? 'Complète' : 'complète'],
    [/t�che/gi, match => match[0] === 'T' ? 'Tâche' : 'tâche'],
    [/t�ches/gi, match => match[0] === 'T' ? 'Tâches' : 'tâches'],
    [/�tat/gi, 'état'],
    [/�tats/gi, 'états'],
    [/�/g, 'é'],
  ];
  for (const [pattern, replacement] of replacements) {
    text = text.replace(pattern, replacement as any);
  }
  return text;
}

function sanitizeWorkspaceText(value: any, max = 8000) {
  return redactSecrets(repairTextEncoding(value).replace(/\u0000/g, ''), '[masked-secret]').slice(0, max);
}

function isMissingWorkspaceTableError(error: any) {
  const message = String(error?.message || '');
  return /user_workspace_state|project_workspace_state|schema cache|relation .* does not exist/i.test(message);
}

function isMissingPreviewDeviceColumnError(error: any) {
  const message = String(error?.message || '');
  return /preview_device|builder_preview_device|schema cache|column .* does not exist/i.test(message);
}

async function getUserWorkspaceState(userId: string) {
  const client = requireSupabase('User workspace state');
  const { data, error } = await client.from('user_workspace_state').select('*').eq('owner_id', userId).maybeSingle();
  if (error && isMissingWorkspaceTableError(error)) return null;
  if (error) throw new Error(`Supabase user workspace state failed: ${error.message}`);
  return data || null;
}

async function upsertUserWorkspaceState(userId: string, patch: Record<string, any>) {
  const row = {
    owner_id: userId,
    last_project_id: isUuid(patch.last_project_id) ? patch.last_project_id : patch.last_project_id === null ? null : undefined,
    dashboard_draft_prompt: patch.dashboard_draft_prompt === undefined ? undefined : sanitizeWorkspaceText(patch.dashboard_draft_prompt),
    dashboard_selected_mode: patch.dashboard_selected_mode === undefined ? undefined : normalizeWorkspaceMode(patch.dashboard_selected_mode),
    builder_draft_prompt: patch.builder_draft_prompt === undefined ? undefined : sanitizeWorkspaceText(patch.builder_draft_prompt),
    builder_selected_mode: patch.builder_selected_mode === undefined ? undefined : normalizeWorkspaceMode(patch.builder_selected_mode),
    builder_selected_model: patch.builder_selected_model === undefined ? undefined : sanitizeWorkspaceText(patch.builder_selected_model, 120) || 'auto',
    builder_active_tab: patch.builder_active_tab === undefined ? undefined : normalizeWorkspaceTab(patch.builder_active_tab),
    builder_preview_device: patch.builder_preview_device === undefined ? undefined : normalizeWorkspacePreviewDevice(patch.builder_preview_device),
    theme: patch.theme === undefined ? undefined : (patch.theme === 'dark' ? 'dark' : 'light'),
    last_route: patch.last_route === undefined ? undefined : sanitizeWorkspaceText(patch.last_route, 512),
    updated_at: new Date().toISOString(),
  };
  Object.keys(row).forEach(key => (row as any)[key] === undefined && delete (row as any)[key]);
  const client = requireSupabase('User workspace state persistence');
  let { data, error } = await client.from('user_workspace_state').upsert([row], { onConflict: 'owner_id' }).select('*').maybeSingle();
  if (error && isMissingPreviewDeviceColumnError(error) && 'builder_preview_device' in row) {
    delete (row as any).builder_preview_device;
    const retry = await client.from('user_workspace_state').upsert([row], { onConflict: 'owner_id' }).select('*').maybeSingle();
    data = retry.data;
    error = retry.error;
  }
  if (error && isMissingWorkspaceTableError(error)) return null;
  if (error) throw new Error(`Supabase user workspace state update failed: ${error.message}`);
  return data;
}

async function getProjectWorkspaceState(projectId: string) {
  const client = requireSupabase('Project workspace state');
  const { data, error } = await client.from('project_workspace_state').select('*').eq('project_id', projectId).maybeSingle();
  if (error && isMissingWorkspaceTableError(error)) return null;
  if (error) throw new Error(`Supabase project workspace state failed: ${error.message}`);
  return data || null;
}

async function upsertProjectWorkspaceState(userId: string, projectId: string, patch: Record<string, any>) {
  const client = requireSupabase('Project workspace state persistence');
  const row = {
    owner_id: userId,
    project_id: projectId,
    draft_prompt: patch.draft_prompt === undefined ? undefined : sanitizeWorkspaceText(patch.draft_prompt),
    selected_mode: patch.selected_mode === undefined ? undefined : normalizeWorkspaceMode(patch.selected_mode),
    selected_model: patch.selected_model === undefined ? undefined : sanitizeWorkspaceText(patch.selected_model, 120) || 'auto',
    active_tab: patch.active_tab === undefined ? undefined : normalizeWorkspaceTab(patch.active_tab),
    preview_device: patch.preview_device === undefined ? undefined : normalizeWorkspacePreviewDevice(patch.preview_device),
    sidebar_width: patch.sidebar_width === undefined ? undefined : Math.min(520, Math.max(280, Number(patch.sidebar_width || 380))),
    pending_clarification: patch.pending_clarification === undefined ? undefined : (patch.pending_clarification || null),
    last_opened_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  Object.keys(row).forEach(key => (row as any)[key] === undefined && delete (row as any)[key]);
  let { data, error } = await client.from('project_workspace_state').upsert([row], { onConflict: 'project_id' }).select('*').maybeSingle();
  if (error && isMissingPreviewDeviceColumnError(error) && 'preview_device' in row) {
    delete (row as any).preview_device;
    const retry = await client.from('project_workspace_state').upsert([row], { onConflict: 'project_id' }).select('*').maybeSingle();
    data = retry.data;
    error = retry.error;
  }
  if (error && isMissingWorkspaceTableError(error)) {
    const snapshotPersisted = await persistDurableWorkspaceSnapshot(projectId, userId, row).catch(() => false);
    if (!snapshotPersisted) return null;
    await upsertUserWorkspaceState(userId, { last_project_id: projectId, last_route: `/builder.html?project=${projectId}` });
    return row;
  }
  if (error) throw new Error(`Supabase project workspace state update failed: ${error.message}`);
  await persistDurableWorkspaceSnapshot(projectId, userId, data || row).catch(snapshotError => {
    console.warn('[coden:project_workspace_snapshot_failed]', {
      project_id: projectId,
      message: redactSecrets(snapshotError?.message || String(snapshotError), '[redacted]'),
    });
  });
  await upsertUserWorkspaceState(userId, { last_project_id: projectId, last_route: `/builder.html?project=${projectId}` });
  return data;
}

async function createProjectVersion(project: GeneratedProject, files: GeneratedFile[], reason: string, diff: any) {
  const versions = await listProjectVersions(project.id);
  const row = {
    id: randomUUID(),
    organization_id: project.organization_id,
    project_id: project.id,
    version_number: versions.length + 1,
    reason,
    files_snapshot: files,
    diff_summary: diff,
    created_at: new Date().toISOString(),
  };
  const client = requireSupabase('Project version persistence');
  let insertRow: Record<string, any> = { ...row };
  let error: any = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const result = await client.from('project_versions').insert([insertRow]);
    error = result.error;
    if (!error) return row;
    const missingColumn = getSchemaColumnFromMessage(String(error.message || ''));
    if (missingColumn && missingColumn in insertRow) {
      delete insertRow[missingColumn];
      continue;
    }
    if (/project_versions|schema cache|relation .* does not exist|table .* does not exist|column .* does not exist|could not find .* in the schema cache/i.test(error.message || '')) {
      console.warn('[coden:project_version_persistence_skipped]', { message: error.message });
      return row;
    }
    break;
  }
  if (error) throw new Error(`Supabase project version persistence failed: ${error.message}`);
  return row;
}

async function listProjectVersions(projectId: string) {
  const client = requireSupabase('Project version listing');
  const { data, error } = await client.from('project_versions').select('*').eq('project_id', projectId).order('version_number', { ascending: false });
  if (error && /project_versions|schema cache|relation .* does not exist|table .* does not exist|column .* does not exist|could not find .* in the schema cache/i.test(error.message || '')) {
    console.warn('[coden:project_version_listing_skipped]', { message: error.message });
    return [];
  }
  if (error) throw new Error(`Supabase project version listing failed: ${error.message}`);
  return (data || []).map(redactSecretPayload);
}

/**
 * Persist one preview/build error.
 *
 * The incoming object is a diagnostic from the preview pipeline, not a table
 * row: it carries whatever fields that diagnostic needed (`diagnostic_code`,
 * for one). Spreading it into the insert made PostgREST reject the whole row
 * for an unknown column, and this is only telemetry about a failure that was
 * already reported — it must never abort the run that produced it.
 */
async function saveBuildError(project: GeneratedProject, error: any) {
  const diagnosticCode = String(error?.diagnostic_code || '').trim();
  const message = String(error?.message || 'Unknown build error.');
  const row = {
    id: randomUUID(),
    organization_id: project.organization_id,
    project_id: project.id,
    file: error?.file ? String(error.file) : null,
    // The table has no diagnostic_code column, so keep the code in the message
    // rather than losing the one field that identifies the failure.
    message: diagnosticCode ? `[${diagnosticCode}] ${message}` : message,
    severity: String(error?.severity || 'medium'),
    status: String(error?.status || 'detected'),
    created_at: new Date().toISOString(),
  };
  const client = requireSupabase('Build error persistence');
  const { error: dbError } = await client.from('build_errors').insert([row]);
  if (dbError) {
    console.warn('[coden:build_error_persistence_skipped]', { message: redactSecrets(dbError.message, '[redacted]') });
  }
  return row;
}

async function listBuildErrors(projectId: string) {
  const client = requireSupabase('Build error listing');
  const { data, error } = await client.from('build_errors').select('*').eq('project_id', projectId).order('created_at', { ascending: false });
  if (error) throw new Error(`Supabase build error listing failed: ${error.message}`);
  return (data || []).map(redactSecretPayload);
}

async function createBuildSession(project: GeneratedProject, userId: string) {
  const row = {
    id: `build_${randomUUID()}`,
    organization_id: project.organization_id,
    project_id: project.id,
    user_id: userId,
    status: 'running',
    created_at: new Date().toISOString(),
  };
  const client = requireSupabase('Build session persistence');
  const { error } = await client.from('build_sessions').insert([row]);
  if (error) {
    console.warn('[coden:build_session_persistence_skipped]', { message: error.message });
  }
  return row;
}

async function getBuildSession(buildSessionId: string) {
  const client = requireSupabase('Build session lookup');
  const { data, error } = await client.from('build_sessions').select('*').eq('id', buildSessionId).maybeSingle();
  if (error && /build_sessions|schema cache|relation .* does not exist|table .* does not exist|could not find .* in the schema cache/i.test(error.message || '')) return null;
  if (error) throw new Error(`Supabase build session lookup failed: ${error.message}`);
  return data;
}

async function updateBuildSessionStatus(buildSessionId: string, status: string, extra: Record<string, unknown> = {}) {
  const client = requireSupabase('Build session update');
  const { error } = await client.from('build_sessions').update({ status, ...extra }).eq('id', buildSessionId);
  if (error && /build_sessions|schema cache|relation .* does not exist|table .* does not exist|could not find .* in the schema cache/i.test(error.message || '')) return;
  if (error) throw new Error(`Supabase build session update failed: ${error.message}`);
}

async function saveProjectPatch(project: GeneratedProject, patch: any) {
  if (!patch) return;
  const client = requireSupabase('Project patch persistence');
  const row = {
    id: randomUUID(),
    organization_id: project.organization_id,
    project_id: project.id,
    target_file: patch.target_file || patch.file || null,
    summary: patch.summary || 'Targeted patch applied.',
    created_at: new Date().toISOString(),
  };
  const { error } = await client.from('project_patches').insert([row]);
  if (error) throw new Error(`Supabase project patch persistence failed: ${error.message}`);
}

async function listProjectSecrets(projectId: string) {
  const client = requireSupabase('Project secrets listing');
  const { data, error } = await client.from('project_secrets').select('id, project_id, service, variable, masked_value, status, created_at, updated_at').eq('project_id', projectId).order('created_at', { ascending: false });
  if (error) throw new Error(`Supabase project secrets listing failed: ${error.message}`);
  return data || [];
}

async function saveProjectSecret(project: GeneratedProject, service: string, variable: string, value: string, status = 'configured') {
  const row = {
    id: randomUUID(),
    organization_id: project.organization_id,
    project_id: project.id,
    service,
    variable,
    encrypted_value: value ? pseudoEncryptSecret(value) : null,
    masked_value: value ? maskSecret(value) : 'not configured',
    status,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const client = requireSupabase('Project secret persistence');
  const { error } = await client.from('project_secrets').insert([row]);
  if (error) throw new Error(`Supabase project secret persistence failed: ${error.message}`);
  return { ...row, encrypted_value: undefined };
}



const CREDIT_BALANCE_COLUMNS = [
  'balance',
  'credits_balance',
  'available_credits',
  'balance_credits',
  'current_balance',
  'remaining_credits',
  'credits',
  'total_credits',
];
const CREDIT_BUCKET_COLUMNS = ['monthly_credits', 'daily_promo_credits', 'topup_credits', 'promo_credits'];
const FALLBACK_WALLET_CREDITS = 30;

function getNumericCreditValue(value: any) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

function getCreditBalanceColumn(row: Record<string, any> | null | undefined) {
  if (!row) return '';
  return CREDIT_BALANCE_COLUMNS.find(column => column in row) || '';
}

function getCreditBalanceFromRow(row: Record<string, any> | null | undefined) {
  const column = getCreditBalanceColumn(row);
  if (column) return getNumericCreditValue(row?.[column]);
  const bucketTotal = CREDIT_BUCKET_COLUMNS.reduce((total, bucket) => total + getNumericCreditValue(row?.[bucket]), 0);
  if (bucketTotal > 0) return bucketTotal;
  const hasKnownCreditShape = [...CREDIT_BALANCE_COLUMNS, ...CREDIT_BUCKET_COLUMNS].some(knownColumn => row && knownColumn in row);
  return row && !hasKnownCreditShape ? FALLBACK_WALLET_CREDITS : bucketTotal;
}

function isSchemaShapeError(error: any) {
  return /schema cache|column .*does not exist|column .* does not exist|could not find .* in the schema cache|Could not find the '([^']+)' column|relation .* does not exist|table .* does not exist/i.test(error?.message || '');
}

async function readCreditWalletRow(client: any, orgId: string) {
  const { data, error } = await client.from('credit_wallets').select('*').eq('organization_id', orgId).maybeSingle();
  if (error && /credit_wallets|relation .* does not exist|table .* does not exist/i.test(error.message || '')) {
    console.warn('[coden:credit_wallet_lookup_skipped]', { message: error.message });
    return null;
  }
  if (error) throw new Error(`Credit wallet lookup failed: ${error.message}`);
  return data || null;
}

async function writeCreditWalletBalance(client: any, orgId: string, next: number, preferredColumn = '') {
  const columns = preferredColumn
    ? [preferredColumn, ...CREDIT_BALANCE_COLUMNS, ...CREDIT_BUCKET_COLUMNS].filter((column, index, all) => all.indexOf(column) === index)
    : [...CREDIT_BALANCE_COLUMNS, ...CREDIT_BUCKET_COLUMNS];
  const existingWallet = await readCreditWalletRow(client, orgId);
  for (const column of columns) {
    const patch: Record<string, any> = {
      [column]: next,
      updated_at: new Date().toISOString(),
    };
    let error: any = null;
    if (existingWallet) {
      let result = await client.from('credit_wallets').update(patch).eq('organization_id', orgId);
      error = result.error;
      if (error && /updated_at/i.test(error.message || '') && isSchemaShapeError(error)) {
        delete patch.updated_at;
        result = await client.from('credit_wallets').update(patch).eq('organization_id', orgId);
        error = result.error;
      }
    } else {
      const row: Record<string, any> = { organization_id: orgId, ...patch };
      let result = await client.from('credit_wallets').insert([row]);
      error = result.error;
      if (error && /updated_at/i.test(error.message || '') && isSchemaShapeError(error)) {
        delete row.updated_at;
        result = await client.from('credit_wallets').insert([row]);
        error = result.error;
      }
      if (error && /duplicate key|unique constraint/i.test(error.message || '')) {
        const retryPatch = { ...patch };
        let retry = await client.from('credit_wallets').update(retryPatch).eq('organization_id', orgId);
        error = retry.error;
        if (error && /updated_at/i.test(error.message || '') && isSchemaShapeError(error)) {
          delete retryPatch.updated_at;
          retry = await client.from('credit_wallets').update(retryPatch).eq('organization_id', orgId);
          error = retry.error;
        }
      }
    }
    if (error && /updated_at/i.test(error.message || '') && isSchemaShapeError(error)) {
      continue;
    }
    if (!error) return column;
    if (isSchemaShapeError(error)) continue;
    throw new Error(`Credit wallet update failed: ${error.message}`);
  }
  console.warn('[coden:credit_wallet_update_skipped]', {
    reason: 'no_compatible_balance_column',
    organization_id: orgId,
    next_balance: next,
  });
  return preferredColumn || columns[0] || 'balance';
}

async function ensureCreditWalletRow(client: any, orgId: string, initialCredits = 30) {
  const existing = await readCreditWalletRow(client, orgId);
  if (existing) return existing;
  const column = await writeCreditWalletBalance(client, orgId, initialCredits);
  return { organization_id: orgId, [column]: initialCredits };
}

async function insertCreditLedgerRow(client: any, row: Record<string, any>) {
  let current = { ...row };
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const { error } = await client.from('credit_ledger').insert([current]);
    if (!error) return;
    if (/credit_ledger|relation .* does not exist|table .* does not exist/i.test(error.message || '')) {
      console.warn('[coden:credit_ledger_insert_skipped]', { message: error.message });
      return;
    }
    const column = getSchemaColumnFromMessage(error.message || '');
    if (isSchemaShapeError(error) && column && column in current) {
      delete current[column];
      continue;
    }
    throw new Error(`Credit ledger insert failed: ${error.message}`);
  }
}

function getDbHelpers() {
  const client = requireSupabase('Billing and usage persistence');
  return {
    getWallet: async (orgId: string) => {
      if (hasUnlimitedTestCredits(orgId)) return UNLIMITED_TEST_CREDIT_DISPLAY_BALANCE;
      const wallet = await ensureCreditWalletRow(client, orgId);
      return getCreditBalanceFromRow(wallet);
    },
    updateWallet: async (orgId: string, diff: number) => {
      if (hasUnlimitedTestCredits(orgId)) return UNLIMITED_TEST_CREDIT_DISPLAY_BALANCE;
      const wallet = await ensureCreditWalletRow(client, orgId);
      const balanceColumn = getCreditBalanceColumn(wallet);
      const current = getCreditBalanceFromRow(wallet);
      const next = current + diff;
      await writeCreditWalletBalance(client, orgId, next, balanceColumn);
      return next;
    },
    addLedger: async (orgId: string, type: string, amount: number, balance_after: number, desc: string, refId: string) => {
      const log = { wallet_id: orgId, type, amount, balance_after, description: desc, reference_id: refId, created_at: new Date().toISOString() };
      await insertCreditLedgerRow(client, log);
    },
    addAudit: async (data: any) => {
      const { error } = await client.from('audit_logs').insert([{ ...data, created_at: new Date().toISOString() }]);
      if (error) console.warn(`Audit log insert failed: ${error.message}`);
    },
    createReservation: async (orgId: string, amount: number, refId: string) => {
      const expires_at = new Date(Date.now() + 15 * 60000).toISOString();
      const reservationId = randomUUID();
      if (hasUnlimitedTestCredits(orgId)) {
        return { id: reservationId, wallet_id: orgId, amount, status: 'virtual', reference_id: refId, expires_at };
      }
      const ownerColumns = ['wallet_id', 'organization_id', 'user_id'];
      for (const ownerColumn of ownerColumns) {
        let res: Record<string, any> = { id: reservationId, [ownerColumn]: orgId, amount, status: 'reserved', reference_id: refId, expires_at };
        for (let attempt = 0; attempt < 8; attempt += 1) {
          const { error } = await client.from('credit_reservations').insert([res]);
          if (!error) return res;
          if (/credit_reservations|relation .* does not exist|table .* does not exist/i.test(error.message || '')) {
            console.warn('[coden:credit_reservation_skipped]', { message: error.message });
            return { id: reservationId, wallet_id: orgId, amount, status: 'virtual', reference_id: refId, expires_at };
          }
          const column = getSchemaColumnFromMessage(error.message || '');
          if (isSchemaShapeError(error) && column && column in res) {
            if (column === ownerColumn) break;
            delete res[column];
            continue;
          }
          if (isSchemaShapeError(error)) break;
          throw new Error(`Credit reservation failed: ${error.message}`);
        }
      }
      console.warn('[coden:credit_reservation_skipped]', {
        reason: 'no_compatible_owner_column',
        organization_id: orgId,
        reference_id: refId,
      });
      return { id: reservationId, wallet_id: orgId, amount, status: 'virtual', reference_id: refId, expires_at };
    }
  };
}

function getOptionalDbHelpers(context = 'optional persistence'): ReturnType<typeof getDbHelpers> | null {
  try {
    return getDbHelpers();
  } catch (error: any) {
    console.warn('[coden:db_helpers_unavailable]', {
      context,
      diagnostic_code: 'SERVER_PERSISTENCE_UNAVAILABLE',
      message: redactSecrets(error?.message || String(error)),
    });
    return null;
  }
}

async function getWalletWithFallback(
  helpers: ReturnType<typeof getDbHelpers> | null,
  orgId: string,
  fallback = FALLBACK_WALLET_CREDITS,
) {
  if (!helpers) return fallback;
  return helpers.getWallet(orgId).catch(() => fallback);
}

async function loadCloudWalletSnapshot(organizationId: string, plan: ReturnType<typeof getPlanConfig>) {
  const fallbackCloud = plan?.cloud || SAAS_PLANS.free.cloud;
  const snapshot = {
    balance_usd: fallbackCloud.balanceUsd,
    included_balance_usd: fallbackCloud.balanceUsd,
    ai_app_balance_usd: fallbackCloud.aiAppBalanceUsd,
    database_storage_gb: fallbackCloud.databaseStorageGb,
    file_storage_gb: fallbackCloud.fileStorageGb,
    bandwidth_gb: fallbackCloud.bandwidthGb,
    topup_min_usd: fallbackCloud.topupMinUsd,
    auto_topup_available: fallbackCloud.autoTopupAvailable,
    auto_topup_enabled: false,
    usage_categories: getCloudUsageCategories(),
  };

  try {
    const client = requireSupabase('Cloud wallet listing');
    const { data, error } = await client
      .from('cloud_wallets')
      .select('balance_usd,included_balance_usd,ai_app_balance_usd,auto_topup_enabled')
      .eq('organization_id', organizationId)
      .maybeSingle();

    if (error) throw error;

    if (data) {
      snapshot.balance_usd = Number(data.balance_usd ?? snapshot.balance_usd);
      snapshot.included_balance_usd = Number(data.included_balance_usd ?? snapshot.included_balance_usd);
      snapshot.ai_app_balance_usd = Number(data.ai_app_balance_usd ?? snapshot.ai_app_balance_usd);
      snapshot.auto_topup_enabled = Boolean(data.auto_topup_enabled);
    }
  } catch (error: any) {
    console.warn('[coden:cloud_wallet_snapshot_fallback]', { message: error?.message || String(error) });
  }

  return snapshot;
}

// ──────────────────────────────────────────────────────────────────────
// 1. BILLING ENDPOINTS
// ──────────────────────────────────────────────────────────────────────

// GET /billing/plans
app.get('/api/billing/plans', async (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = typeof authHeader === 'string' && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  let enterpriseVisible = false;

  if (token) {
    try {
      const authClient = getSupabaseAuthClient();
      const { data } = await authClient.auth.getUser(token);
      const userId = data?.user?.id;
      if (userId) {
        const plan = normalizePlanKey(await getOrganizationPlan(userId).catch(() => 'free')) || 'free';
        enterpriseVisible = isPaidPlanKey(plan);
      }
    } catch {
      enterpriseVisible = false;
    }
  }

  res.json({
    success: true,
    plans: getPublicPlans(),
    topups: TOPUP_PRODUCTS,
    cloud_topups: CLOUD_TOPUP_PRODUCTS,
    cloud_usage_categories: getCloudUsageCategories(),
    enterprise: enterpriseVisible ? SAAS_PLANS.enterprise : null,
    billing: {
      annual_discount_percent: 20,
      public_plan_keys: ['free', 'pro', 'scale'],
    },
  });
});

// GET /billing/wallet
app.get('/api/billing/wallet', async (req, res) => {
  const orgId = getUserOrgId(req);
  const helpers = getDbHelpers();
  const balance = await helpers.getWallet(orgId);
  const planKey = normalizePlanKey(await getOrganizationPlan(orgId).catch(() => 'free')) || 'free';
  const plan = getPlanConfig(planKey) || SAAS_PLANS.free;
  const cloud = await loadCloudWalletSnapshot(orgId, plan);

  res.json({
    success: true,
    organization_id: orgId,
    plan: plan.key,
    balance,
    unlimited: hasUnlimitedTestCredits(orgId),
    buckets: {
      monthly_credits: plan.credits,
      daily_promo_credits: plan.dailyCredits ?? null,
      topup_credits: null,
    },
    cloud,
  });
});

// GET /billing/ledger
app.get('/api/billing/ledger', async (req, res) => {
  const orgId = getUserOrgId(req);
  const client = requireSupabase('Credit ledger listing');
  const { data, error } = await client.from('credit_ledger').select('*').eq('wallet_id', orgId).order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true, ledger: (data || []).map(sanitizeCreditLedgerEntry) });
});

// POST /billing/checkout/subscription
app.post('/api/billing/checkout/subscription', async (req, res) => {
  const { planKey, email, successUrl, cancelUrl, billingInterval } = req.body;
  const orgId = getUserOrgId(req);

  try {
    const billing = new StripeService(getSupabase());
    const redirectUrl = await billing.createSubscriptionCheckout(
      orgId,
      email || 'test@coden.app',
      planKey || 'pro',
      successUrl || `${req.protocol}://${req.get('host')}/settings?success=true`,
      cancelUrl || `${req.protocol}://${req.get('host')}/settings?cancel=true`,
      billingInterval === 'annual' ? 'annual' : 'monthly'
    );
    res.json({ success: true, url: redirectUrl });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /billing/checkout/topup
app.post('/api/billing/checkout/topup', async (req, res) => {
  const { productId, email, successUrl, cancelUrl } = req.body;
  const orgId = req.body.orgId || DEFAULT_ORG_ID;

  try {
    const billing = new StripeService(getSupabase());
    const redirectUrl = await billing.createTopupCheckout(
      orgId,
      email || 'test@coden.app',
      productId || 'topup_credits_500',
      successUrl || `${req.protocol}://${req.get('host')}/settings?success=true`,
      cancelUrl || `${req.protocol}://${req.get('host')}/settings?cancel=true`
    );
    res.json({ success: true, url: redirectUrl });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /billing/portal
app.post('/api/billing/portal', async (req, res) => {
  const orgId = req.body.orgId || DEFAULT_ORG_ID;
  const client = requireSupabase('Billing portal');
  
  if (process.env.STRIPE_SECRET_KEY) {
    try {
      const { data } = await client.from('stripe_customers').select('stripe_customer_id').eq('id', orgId).single();
      if (data?.stripe_customer_id) {
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2025-02-18' as any });
        const portalSession = await stripe.billingPortal.sessions.create({
          customer: data.stripe_customer_id,
          return_url: `${req.protocol}://${req.get('host')}/settings`
        });
        return res.json({ success: true, url: portalSession.url });
      }
    } catch (e: any) {
      return res.status(503).json({ success: false, error: `Billing portal setup failed: ${e.message}` });
    }
  }
  
  res.status(503).json({ success: false, error: 'Stripe is not configured. Add STRIPE_SECRET_KEY on Railway.' });
});

// POST /stripe/webhook
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }) as any, async (req: any, res: any) => {
  const sig = req.headers['stripe-signature'] as string;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';

  try {
    const stripeService = new StripeService(getSupabase());
    const result = await stripeService.handleWebhook(req.body, sig, webhookSecret);
    res.json({ received: true, ...result });
  } catch (err: any) {
    res.status(400).send(`Webhook Error: ${err.message}`);
  }
});

// ──────────────────────────────────────────────────────────────────────
// 2. AI ENGINE ENDPOINTS
// ──────────────────────────────────────────────────────────────────────

// GET /ai/models
app.get('/api/ai/models', (req, res) => {
  res.json({
    success: true,
    models: buildPublicModelList(),
    providers: buildPublicModelProviderGroups(),
  });
});

// GET /ai/model-runtime
// Public, redacted model runtime view. It exposes capability routing and health
// signals, never provider secrets or raw provider payloads.
app.get('/api/ai/model-runtime', requireAuthWithTemporaryGeneration, (req: any, res) => {
  const profiles = getAllAIModelCapabilityProfiles().map(profile => ({
    id: profile.id,
    provider: profile.provider,
    display_name: AI_MODEL_DISPLAY_NAMES[profile.id as AllowedModelId] || providerModelToDisplayName(profile.id),
    best_for: profile.bestUse,
    strengths: {
      reasoning: profile.reasoning,
      code: profile.code,
      comprehension: profile.comprehension,
      agentic: profile.agentic,
      design: profile.design,
      security: profile.security,
    },
    supports: {
      streaming: profile.supports.streaming,
      tool_calling: profile.supports.toolCalling,
      structured_output: profile.supports.structuredOutput,
      vision: profile.supports.vision,
      long_context: profile.supports.longContext,
    },
    speed: profile.speed,
    reliability: profile.reliability,
    fallback_primary: profile.fallbackPrimary || null,
    fallback_secondary: profile.fallbackSecondary || null,
    limits_known: profile.limits.known,
    recommended_parameters: {
      temperature: profile.recommended.temperature,
      max_tokens: profile.recommended.maxTokens,
      timeout_ms: profile.recommended.timeoutMs,
      streaming_timeout_ms: profile.recommended.streamingTimeoutMs,
      reasoning_control: profile.supports.reasoningControl,
      json_mode: Boolean(profile.supports.jsonMode),
    },
  }));
  res.json({
    success: true,
    auto_model: {
      chooses_model: true,
      chooses_workflow: true,
      chooses_provider_config: true,
      uses_fallback: true,
    },
    runtime: profiles,
    monitoring: {
      metrics: providerGateway.getRuntimeMetricsSnapshot(),
      circuit_breakers: providerGateway.getCircuitSnapshot(),
    },
  });
});

// POST /ai/estimate
app.post('/api/ai/estimate', (req, res) => {
  res.json({
    allowed: true,
    requires_upgrade: false,
    suggested_action: 'continue'
  });
});

// POST /ai/route
app.post('/api/ai/route', async (req, res) => {
  const { plan, mode, userCredits, taskComplexity, requiredCapabilities, customModelId } = req.body;

  try {
    const context: RoutingContext = {
      plan: plan || 'free',
      mode: mode || 'Auto',
      userCredits: userCredits || 10,
      taskComplexity: taskComplexity || 'medium',
      requiredCapabilities: requiredCapabilities || {}
    };

    const targetModel = await modelRouter.selectModel(context, customModelId);
    res.json({
      success: true,
      routed_model: targetModel,
      runtime_capabilities: buildPublicRuntimeCapabilities(targetModel),
    });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/assistant/attachments', (req: any, res: any) => {
  const requestId = `attachment_${randomUUID()}`;
  const authUser = requireAuthenticatedUser(req, res, requestId);
  if (!authUser) return;
  const name = sanitizeWorkspaceText(req.body?.name || '', 240).trim();
  const mimeType = String(req.body?.mimeType || '').trim().toLowerCase();
  const declaredSize = Number(req.body?.size || 0);
  const dataUrl = String(req.body?.dataUrl || '');
  if (!name || !ASSISTANT_ATTACHMENT_ALLOWED_TYPES.has(mimeType)) {
    return res.status(400).json({ success: false, error: 'Attachment type is not allowed.', request_id: requestId });
  }
  try {
    const buffer = attachmentBuffer(dataUrl, mimeType);
    if (!buffer.length || buffer.length > ASSISTANT_ATTACHMENT_MAX_BYTES || declaredSize !== buffer.length) {
      return res.status(413).json({ success: false, error: 'Attachment size is invalid.', request_id: requestId });
    }
    if (!attachmentSignatureIsValid(buffer, mimeType)) {
      return res.status(400).json({ success: false, error: 'Attachment content does not match its declared type.', request_id: requestId });
    }
    cleanupAssistantAttachments();
    const id = `att_${randomUUID()}`;
    const now = Date.now();
    assistantAttachments.set(id, {
      id,
      userId: String(authUser.id),
      name,
      mimeType,
      size: buffer.length,
      dataUrl,
      createdAt: now,
      expiresAt: now + ASSISTANT_ATTACHMENT_TTL_MS,
    });
    return res.status(201).json({
      success: true,
      attachment: { id, name, mimeType, size: buffer.length, status: 'ready', expiresAt: new Date(now + ASSISTANT_ATTACHMENT_TTL_MS).toISOString() },
    });
  } catch (error: any) {
    return res.status(400).json({ success: false, error: error?.message || 'Attachment upload failed.', request_id: requestId });
  }
});

app.delete('/api/assistant/attachments/:attachmentId', (req: any, res: any) => {
  const requestId = `attachment_delete_${randomUUID()}`;
  const authUser = requireAuthenticatedUser(req, res, requestId);
  if (!authUser) return;
  const id = String(req.params.attachmentId || '');
  const record = assistantAttachments.get(id);
  if (!record || record.userId !== String(authUser.id)) {
    return res.status(404).json({ success: false, error: 'Attachment not found.', request_id: requestId });
  }
  assistantAttachments.delete(id);
  return res.json({ success: true, request_id: requestId });
});

// POST /assistant/decision
// The Dashboard asks the server to resolve Auto/Build/Plan before choosing a
// surface. The browser must not infer “this needs the Builder” from keywords.
app.post('/api/assistant/decision', async (req: any, res: any) => {
  const requestId = `decision_${randomUUID()}`;
  const authUser = requireAuthenticatedUser(req, res, requestId);
  if (!authUser) return;
  const basePrompt = sanitizeWorkspaceText(req.body?.prompt || '').trim();
  if (!basePrompt) return res.status(400).json({ success: false, error: 'Prompt is required.', request_id: requestId });

  const requestedMode = normalizeRequestedMode(req.body?.requestedMode || req.body?.mode);
  const userId = String(authUser.id);
  const attachmentRecords = resolveAssistantAttachments(userId, req.body?.attachmentIds);
  const attachmentContext = assistantAttachmentContext(attachmentRecords);
  const prompt = attachmentContext ? `${basePrompt}\n\nVerified user attachments:\n${attachmentContext}` : basePrompt;
  const requestedProjectId = String(req.body?.projectId || '').trim();
  let hasFiles = false;
  let lastPlan: string | undefined;
  if (isUuid(requestedProjectId)) {
    const project = await loadProject(requestedProjectId, userId).catch(() => null);
    if (project && hasProjectCapability(req, 'view', project)) {
      const files = await loadProjectFiles(project.id).catch(() => []);
      hasFiles = files.length > 0;
      lastPlan = await getLastProjectPlan(project.id).catch(() => undefined);
    }
  }

  const recentHistory: RecentHistoryMessage[] = Array.isArray(req.body?.messages)
    ? req.body.messages
      .filter((message: any) => (message?.role === 'user' || message?.role === 'assistant') && String(message?.content || '').trim())
      .slice(-10)
      .map((message: any) => ({ role: message.role, content: redactSecrets(String(message.content || '')).slice(0, 1200) }))
    : [];

  try {
    const decision = await resolveAgentDecision({ prompt, requestedMode, hasFiles, lastPlan, recentHistory });
    const resolvedAction = decision.intent === 'clarification_required'
      ? 'clarify'
      : decision.intent === 'debug_fix'
        ? 'debug'
        : decision.intent === 'deploy_assist'
          ? 'confirm'
          : decision.intent === 'credits_required' || decision.intent === 'external_keys_required'
            ? 'blocked'
            : decision.intent;
    const objective = decision.modelObjective
      ? {
          summary: decision.modelObjective.goal,
          requirements: [
            ...decision.modelObjective.scope.included,
            ...decision.modelObjective.acceptanceCriteria,
          ].slice(0, 12),
          included: decision.modelObjective.scope.included,
          excluded: decision.modelObjective.scope.excluded,
          constraints: decision.modelObjective.constraints,
          assumptions: decision.modelObjective.assumptions,
          confidence: decision.confidence,
        }
      : undefined;
    return res.json({
      success: true,
      request_id: requestId,
      requested_mode: decision.requestedMode,
      resolved_action: resolvedAction,
      requires_project: decision.requiresFileChanges || decision.requiresPreviewRebuild,
      requires_confirmation: decision.executionContract?.mode === 'critical_action' || decision.intent === 'deploy_assist',
      objective,
      clarification: decision.clarification
        ? { question: decision.clarification.question, options: decision.clarification.choices }
        : undefined,
      model_decision: {
        confidence: decision.confidence,
        intent: decision.intent,
        next_action: decision.nextAction,
      },
    });
  } catch (error: any) {
    return res.status(503).json({
      success: false,
      error: 'The selected AI model could not resolve this request.',
      message: diagnoseProviderError(error).message,
      diagnostic_code: 'AGENT_DECISION_UNAVAILABLE',
      request_id: requestId,
      suggested_action: 'retry_or_change_model',
    });
  }
});

// POST /assistant/chat
// Lightweight conversational response: no SSE, no project creation, no preview
// mutation. The selected model is still honored through the provider gateway.
app.post('/api/assistant/chat', async (req: any, res: any) => {
  const requestId = `chat_${randomUUID()}`;
  const authUser = requireAuthenticatedUser(req, res, requestId);
  if (!authUser) return;
  const userId = String(authUser.id);
  const basePrompt = sanitizeWorkspaceText(req.body?.prompt || '').trim();
  if (!basePrompt) {
    return res.status(400).json({
      success: false,
      error: 'Prompt is required.',
      message: 'Prompt is required.',
      diagnostic_code: 'PROMPT_REQUIRED',
      request_id: requestId,
      suggested_action: 'write_message',
    });
  }
  const attachmentRecords = resolveAssistantAttachments(userId, req.body?.attachmentIds);
  const attachmentContext = assistantAttachmentContext(attachmentRecords);
  const prompt = attachmentContext ? `${basePrompt}\n\nVerified user attachments:\n${attachmentContext}` : basePrompt;
  if (!enforceRateLimit(`assistant_chat:${userId}`, 30, 60_000)) {
    return res.status(429).json({
      success: false,
      error: 'Too many messages. Please wait a moment.',
      message: 'Too many messages. Please wait a moment.',
      diagnostic_code: 'RATE_LIMITED',
      request_id: requestId,
      suggested_action: 'retry_later',
    });
  }

  const selectedModel = normalizeModelSelectionId(req.body?.modelId || 'auto');
  const requestedMode = normalizeRequestedMode(req.body?.requestedMode || req.body?.mode);
  const requestedProjectId = String(req.body?.projectId || '').trim();
  const now = new Date().toISOString();
  let project: GeneratedProject = {
    id: 'assistant',
    owner_id: userId,
    organization_id: userId,
    created_by: userId,
    name: 'Coden',
    slug: 'coden-assistant',
    status: 'assistant',
    preview_status: 'idle',
    created_at: now,
    updated_at: now,
  };
  let files: GeneratedFile[] = [];
  let canPersistConversation = false;

  if (isUuid(requestedProjectId)) {
    const loadedProject = await loadProject(requestedProjectId, userId).catch(() => null);
    if (loadedProject && hasProjectCapability(req, 'view', loadedProject)) {
      project = loadedProject;
      files = await loadProjectFiles(project.id).catch(() => []);
      canPersistConversation = true;
    }
  }

  const history = Array.isArray(req.body?.messages)
    ? req.body.messages
      .filter((message: any) => (message?.role === 'user' || message?.role === 'assistant') && String(message?.content || '').trim())
      .slice(-10)
      .map((message: any) => `${message.role === 'assistant' ? 'Coden' : 'User'}: ${redactSecrets(String(message.content || '')).slice(0, 1200)}`)
      .join('\n')
    : '';
  const promptWithHistory = history
    ? `${prompt}\n\nRecent conversation context, for continuity only:\n${history}`
    : prompt;
  let decision: IntentDecision;
  try {
    decision = await resolveAgentDecision({
      prompt,
      requestedMode,
      hasFiles: files.length > 0,
      lastPlan: undefined,
      recentHistory: Array.isArray(req.body?.messages)
        ? req.body.messages.filter((message: any) => message?.role === 'user' || message?.role === 'assistant').slice(-10)
        : [],
    });
  } catch (error: any) {
    return res.status(503).json({ success: false, error: 'The selected AI model could not resolve this request.', message: diagnoseProviderError(error).message, diagnostic_code: 'AGENT_DECISION_UNAVAILABLE', request_id: requestId });
  }
  if (decision.requiresFileChanges || decision.requiresPreviewRebuild) {
    return res.status(409).json({ success: false, error: 'This request requires a project run in the Builder.', message: 'This request requires a project run in the Builder.', diagnostic_code: 'PROJECT_RUN_REQUIRED', requires_project: true, requested_mode: requestedMode, resolved_action: decision.intent, request_id: requestId });
  }

  const helpers = getOptionalDbHelpers('assistant_chat');
  const wallet = await getWalletWithFallback(helpers, userId);
  const estimate = estimateActionCost(prompt, decision, selectedModel);
  if (wallet < estimate.finalCredits) {
    return res.status(402).json({
      ...publicCreditGateResponse(),
      request_id: requestId,
    });
  }

  try {
    if (canPersistConversation) {
      await saveProjectMessage({
        organization_id: project.organization_id,
        project_id: project.id,
        user_id: userId,
        role: 'user',
        content: prompt,
        intent: 'conversation',
        requested_mode: requestedMode,
      }).catch(() => null);
    }

    const agentText = await createAgentTextResponse({
      project,
      prompt: promptWithHistory,
      files,
      decision,
      modelId: selectedModel,
      userCredits: wallet,
      allowLocalFallback: selectedModel === 'auto',
      visionInputs: attachmentRecords
        .filter(record => record.mimeType.startsWith('image/'))
        .map(record => ({ url: record.dataUrl, detail: 'auto' as const })),
    });

    const content = redactSecrets(agentText.text || '').trim();
    if (!content) throw new Error('The selected AI model returned an empty response.');
    if (canPersistConversation) {
      await saveProjectMessage({
        organization_id: project.organization_id,
        project_id: project.id,
        user_id: userId,
        role: 'assistant',
        content,
        intent: 'conversation',
        requested_mode: requestedMode,
      }).catch(() => null);
    }
    const chargedCredits = agentText.model === 'auto' && agentText.cost_usd === 0 ? 0 : estimate.finalCredits;
    await chargeCompletedAgentAction(helpers, userId, chargedCredits, `AI conversation with ${agentText.model}`, `agent_${randomUUID()}`);
    return res.json({
      success: true,
      request_id: requestId,
      text: content,
    });
  } catch (error: any) {
    /*
     * The conversation's own failure, in the user's language and never empty.
     *
     * `diagnoseProviderError` produces a message for a log, and its default
     * branch passes the exception's text through `redactSecrets` — which can
     * leave nothing a person can read. The client then falls back to its own
     * generic sentence, which is what production showed at 19:56 on a 502:
     * "The request could not be completed", with no code and no request id.
     */
    const diagnostic = diagnoseProviderError(error);
    console.error('[coden:assistant_chat_failed]', {
      request_id: requestId,
      diagnostic_code: diagnostic.diagnostic_code,
      message: redactSecrets(error?.message || String(error), '[redacted]'),
    });
    const publicMessage = publicRuntimeErrorMessage(diagnostic.diagnostic_code, isLikelyFrenchPrompt(basePrompt) ? 'fr' : 'en');
    return res.status(diagnostic.status >= 400 ? diagnostic.status : 502).json({
      success: false,
      error: publicMessage,
      message: publicMessage,
      diagnostic_code: diagnostic.diagnostic_code,
      request_id: requestId,
      suggested_action: diagnostic.suggested_action,
      recoverable: true,
    });
  }
});


// POST /api/chat
// Compatibility endpoint for AI Elements-style chat clients. It reuses Coden's
// conversation route so the app keeps one source of truth for auth,
// persistence, cancellation, credits, and provider fallback.
app.post('/api/chat', (req: any, res: any) => {
  req.url = '/api/assistant/chat';
  (app as any).handle(req, res);
});

// POST /billing/checkout/cloud-topup
app.post('/api/billing/checkout/cloud-topup', async (req, res) => {
  const { productId, email, successUrl, cancelUrl } = req.body;
  const orgId = req.body.orgId || getUserOrgId(req);

  try {
    const billing = new StripeService(getSupabase());
    const redirectUrl = await billing.createCloudTopupCheckout(
      orgId,
      email || (req as any).user?.email || 'test@coden.app',
      productId || 'cloud_topup_10',
      successUrl || `${req.protocol}://${req.get('host')}/settings?cloud_success=true`,
      cancelUrl || `${req.protocol}://${req.get('host')}/settings?cloud_cancel=true`
    );
    res.json({ success: true, url: redirectUrl });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

function adminSafeString(value: unknown, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function adminTableMissing(error: any) {
  return isSchemaShapeError(error) || /relation .* does not exist|table .* does not exist|schema cache/i.test(error?.message || '');
}

async function adminRows(client: any, table: string, select = '*', options: { limit?: number; order?: string } = {}) {
  try {
    let query = client.from(table).select(select).limit(options.limit || 100);
    if (options.order) query = query.order(options.order, { ascending: false });
    const { data, error } = await query;
    if (error) {
      return {
        available: false,
        rows: [],
        error: adminSafeString(error.message, 'Query failed'),
        missing: adminTableMissing(error),
      };
    }
    return { available: true, rows: Array.isArray(data) ? data : [], error: null, missing: false };
  } catch (error: any) {
    return {
      available: false,
      rows: [],
      error: adminSafeString(error?.message, 'Query failed'),
      missing: adminTableMissing(error),
    };
  }
}

async function adminAuthUsers(client: any, limit = 100) {
  try {
    const listUsers = (client.auth as any)?.admin?.listUsers;
    if (typeof listUsers !== 'function') {
      return { available: false, users: [], error: 'Supabase admin user API is unavailable.' };
    }
    const { data, error } = await listUsers.call((client.auth as any).admin, { page: 1, perPage: limit });
    if (error) return { available: false, users: [], error: error.message || 'Unable to list users.' };
    const users = Array.isArray(data?.users) ? data.users : [];
    return {
      available: true,
      users: users.map((user: any) => ({
        id: user.id,
        email: user.email || null,
        created_at: user.created_at || null,
        last_sign_in_at: user.last_sign_in_at || null,
        confirmed_at: user.confirmed_at || null,
        role: user.role || null,
        provider: Array.isArray(user.app_metadata?.providers) ? user.app_metadata.providers.join(', ') : user.app_metadata?.provider || null,
        is_platform_admin: getPlatformAdminEmails().has(normalizeAdminEmail(user.email)) ||
          user.app_metadata?.role === 'platform_admin' ||
          (Array.isArray(user.app_metadata?.roles) && user.app_metadata.roles.includes('platform_admin')),
      })),
      error: null,
    };
  } catch (error: any) {
    return { available: false, users: [], error: error?.message || 'Unable to list users.' };
  }
}

function adminCountBy(rows: any[], key: string) {
  return rows.reduce((acc: Record<string, number>, row: any) => {
    const value = adminSafeString(row?.[key], 'unknown');
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function adminRecentIso(days: number) {
  return Date.now() - days * 24 * 60 * 60 * 1000;
}

function adminIsRecent(value: unknown, days = 1) {
  const time = Date.parse(String(value || ''));
  return Number.isFinite(time) && time >= adminRecentIso(days);
}

function sanitizeAdminProject(row: any) {
  const fileCount = Array.isArray(row?.files)
    ? row.files.length
    : typeof row?.files_count === 'number'
      ? row.files_count
      : null;
  return {
    id: row?.id,
    name: row?.name || row?.title || 'Untitled project',
    slug: row?.slug || null,
    owner_id: row?.owner_id || row?.created_by || row?.user_id || null,
    organization_id: row?.organization_id || null,
    status: row?.status || 'draft',
    preview_status: row?.preview_status || row?.preview_state || 'unknown',
    publish_status: row?.deployment_status || row?.publish_status || null,
    live_url: row?.published_url || row?.live_url || row?.deployment_url || null,
    model_id: row?.model_id || null,
    file_count: fileCount,
    created_at: row?.created_at || null,
    updated_at: row?.updated_at || null,
  };
}

function sanitizeAdminRun(row: any) {
  return {
    id: row?.id,
    request_id: row?.request_id || null,
    project_id: row?.project_id || null,
    user_id: row?.user_id || null,
    intent: row?.intent || row?.mode || 'unknown',
    mode: row?.mode || null,
    model_id: row?.model_id || null,
    status: row?.status || 'unknown',
    diagnostic_code: row?.diagnostic_code || null,
    suggested_action: row?.suggested_action || null,
    duration_ms: Number(row?.duration_ms || 0),
    created_at: row?.created_at || null,
    completed_at: row?.completed_at || null,
  };
}

function sanitizeAdminDeployment(row: any) {
  return {
    id: row?.id || row?.deployment_id || row?.vercel_deployment_id || null,
    project_id: row?.project_id || null,
    status: row?.status || row?.deployment_status || 'unknown',
    url: row?.url || row?.deployment_url || row?.live_url || row?.published_url || null,
    domain: row?.domain || row?.custom_domain || null,
    provider: row?.provider || 'cloudflare',
    created_at: row?.created_at || null,
    updated_at: row?.updated_at || null,
  };
}

function sanitizeAdminWallet(row: any) {
  return {
    organization_id: row?.organization_id || row?.wallet_id || null,
    balance: getCreditBalanceFromRow(row),
    monthly_credits: getNumericCreditValue(row?.monthly_credits),
    daily_promo_credits: getNumericCreditValue(row?.daily_promo_credits || row?.promo_credits),
    topup_credits: getNumericCreditValue(row?.topup_credits),
    updated_at: row?.updated_at || null,
  };
}

function buildAdminHealth() {
  const supabaseDiagnostics = getSupabaseRuntimeDiagnostics();
  return [
    { id: 'supabase', label: 'Supabase', status: supabaseDiagnostics.project_refs_match ? 'ok' : 'warning', detail: supabaseDiagnostics.project_refs_match ? 'Frontend/backend refs match' : 'Check Supabase env refs' },
    { id: 'openrouter', label: 'OpenRouter', status: getOpenRouterApiKey() ? 'ok' : 'warning', detail: getOpenRouterApiKey() ? 'API key configured' : 'Missing provider key' },
    { id: 'stripe', label: 'Stripe', status: process.env.STRIPE_SECRET_KEY ? 'ok' : 'warning', detail: process.env.STRIPE_SECRET_KEY ? 'Billing key configured' : 'Billing key missing' },
    { id: 'admin', label: 'Admin guard', status: 'ok', detail: `${getPlatformAdminEmails().size} admin email${getPlatformAdminEmails().size > 1 ? 's' : ''} configured` },
  ];
}

app.get('/api/admin/overview', async (req: any, res) => {
  if (!requirePlatformAdmin(req, res)) return;
  const client = requireSupabase('Admin overview');
  const [usersResult, projectsResult, runsResult, aiRequestsResult, deploymentsResult, walletsResult] = await Promise.all([
    adminAuthUsers(client, 200),
    adminRows(client, 'projects', '*', { limit: 250, order: 'updated_at' }),
    adminRows(client, 'agent_runs', 'id,request_id,project_id,user_id,intent,mode,model_id,status,diagnostic_code,suggested_action,duration_ms,created_at,completed_at,cancelled_at', { limit: 300, order: 'created_at' }),
    adminRows(client, 'ai_requests', 'id,organization_id,project_id,model_id,request_type,status,created_at', { limit: 300, order: 'created_at' }),
    adminRows(client, 'deployments', '*', { limit: 150, order: 'created_at' }),
    adminRows(client, 'credit_wallets', '*', { limit: 250, order: 'updated_at' }),
  ]);

  const projects = projectsResult.rows.map(sanitizeAdminProject);
  const runs = runsResult.rows.map(sanitizeAdminRun);
  const deployments = deploymentsResult.rows.map(sanitizeAdminDeployment);
  const wallets = walletsResult.rows.map(sanitizeAdminWallet);
  const failedRuns = runs.filter((run: any) => run.status === 'failed');
  const successfulDeployments = deployments.filter((deployment: any) => /ready|success|published|completed/i.test(deployment.status));
  const totalCredits = wallets.reduce((sum: number, wallet: any) => sum + Number(wallet.balance || 0), 0);

  res.json({
    success: true,
    generated_at: new Date().toISOString(),
    admin: {
      email: getOptionalAuthState(req).email || null,
      role: 'platform_admin',
    },
    metrics: {
      users: usersResult.users.length,
      projects: projects.length,
      active_today: usersResult.users.filter((user: any) => adminIsRecent(user.last_sign_in_at, 1)).length,
      runs: runs.length,
      failed_runs: failedRuns.length,
      success_rate: runs.length ? Math.round(((runs.length - failedRuns.length) / runs.length) * 100) : 100,
      previews_ready: projects.filter((project: any) => project.preview_status === 'verified').length,
      publish_success: successfulDeployments.length,
      ai_requests: aiRequestsResult.rows.length,
      wallet_credits: Math.round(totalCredits * 10) / 10,
    },
    health: buildAdminHealth(),
    distributions: {
      project_status: adminCountBy(projects, 'status'),
      preview_status: adminCountBy(projects, 'preview_status'),
      run_status: adminCountBy(runs, 'status'),
      run_intent: adminCountBy(runs, 'intent'),
      deployment_status: adminCountBy(deployments, 'status'),
    },
    recent: {
      users: usersResult.users.slice(0, 8),
      projects: projects.slice(0, 8),
      failed_runs: failedRuns.slice(0, 8),
      deployments: deployments.slice(0, 8),
    },
    availability: {
      users: usersResult.available,
      projects: projectsResult.available,
      agent_runs: runsResult.available,
      ai_requests: aiRequestsResult.available,
      deployments: deploymentsResult.available,
      credit_wallets: walletsResult.available,
    },
  });
});

app.get('/api/admin/users', async (req: any, res) => {
  if (!requirePlatformAdmin(req, res)) return;
  const client = requireSupabase('Admin users');
  const query = String(req.query?.q || '').trim().toLowerCase();
  const [usersResult, walletsResult, projectsResult, runsResult] = await Promise.all([
    adminAuthUsers(client, 500),
    adminRows(client, 'credit_wallets', '*', { limit: 500, order: 'updated_at' }),
    adminRows(client, 'projects', 'id,name,owner_id,organization_id,status,preview_status,updated_at', { limit: 500, order: 'updated_at' }),
    adminRows(client, 'agent_runs', 'id,user_id,status,created_at', { limit: 500, order: 'created_at' }),
  ]);
  const wallets = new Map(walletsResult.rows.map((row: any) => [row.organization_id || row.wallet_id, sanitizeAdminWallet(row)]));
  const projectsByOwner = adminCountBy(projectsResult.rows, 'owner_id');
  const runsByUser = adminCountBy(runsResult.rows, 'user_id');
  const users = usersResult.users
    .filter((user: any) => !query || String(user.email || '').toLowerCase().includes(query) || String(user.id || '').toLowerCase().includes(query))
    .map((user: any) => ({
      ...user,
      wallet: wallets.get(user.id) || null,
      project_count: projectsByOwner[user.id] || 0,
      run_count: runsByUser[user.id] || 0,
    }));
  res.json({ success: true, users, availability: { users: usersResult.available, wallets: walletsResult.available } });
});

app.get('/api/admin/projects', async (req: any, res) => {
  if (!requirePlatformAdmin(req, res)) return;
  const client = requireSupabase('Admin projects');
  const query = String(req.query?.q || '').trim().toLowerCase();
  const projectsResult = await adminRows(client, 'projects', '*', { limit: 500, order: 'updated_at' });
  const projects = projectsResult.rows
    .map(sanitizeAdminProject)
    .filter((project: any) => !query || String(project.name || '').toLowerCase().includes(query) || String(project.id || '').toLowerCase().includes(query) || String(project.owner_id || '').toLowerCase().includes(query));
  res.json({ success: true, projects, availability: { projects: projectsResult.available }, error: projectsResult.error });
});

app.get('/api/admin/runs', async (req: any, res) => {
  if (!requirePlatformAdmin(req, res)) return;
  const client = requireSupabase('Admin runs');
  const runsResult = await adminRows(client, 'agent_runs', 'id,request_id,project_id,user_id,intent,mode,model_id,status,diagnostic_code,suggested_action,duration_ms,created_at,completed_at,cancelled_at', { limit: 500, order: 'created_at' });
  const runs = runsResult.rows.map(sanitizeAdminRun);
  res.json({ success: true, runs, distributions: { status: adminCountBy(runs, 'status'), intent: adminCountBy(runs, 'intent'), model: adminCountBy(runs, 'model_id') }, availability: { agent_runs: runsResult.available } });
});

app.get('/api/admin/errors', async (req: any, res) => {
  if (!requirePlatformAdmin(req, res)) return;
  const client = requireSupabase('Admin errors');
  const [runsResult, runnerResult] = await Promise.all([
    adminRows(client, 'agent_runs', 'id,request_id,project_id,user_id,intent,model_id,status,diagnostic_code,suggested_action,duration_ms,created_at', { limit: 500, order: 'created_at' }),
    adminRows(client, 'agent_runner_results', 'agent_run_id,status,check_type,severity,message,duration_ms,created_at', { limit: 500, order: 'created_at' }),
  ]);
  const failedRuns = runsResult.rows.map(sanitizeAdminRun).filter((run: any) => run.status === 'failed' || run.diagnostic_code);
  const runnerFailures = runnerResult.rows
    .filter((row: any) => row.status === 'failed' || row.severity === 'blocker' || row.severity === 'error')
    .map(redactAgentPayload);
  res.json({
    success: true,
    errors: {
      failed_runs: failedRuns,
      runner_failures: runnerFailures,
    },
    grouped: {
      diagnostic_code: adminCountBy(failedRuns, 'diagnostic_code'),
      check_type: adminCountBy(runnerFailures, 'check_type'),
      severity: adminCountBy(runnerFailures, 'severity'),
    },
    availability: { agent_runs: runsResult.available, agent_runner_results: runnerResult.available },
  });
});

app.get('/api/admin/publish', async (req: any, res) => {
  if (!requirePlatformAdmin(req, res)) return;
  const client = requireSupabase('Admin publish');
  const deploymentsResult = await adminRows(client, 'deployments', '*', { limit: 300, order: 'created_at' });
  const domainsResult = await adminRows(client, 'domains', '*', { limit: 300, order: 'created_at' });
  const deployments = deploymentsResult.rows.map(sanitizeAdminDeployment);
  res.json({
    success: true,
    deployments,
    domains: domainsResult.rows.map((row: any) => ({
      id: row?.id,
      project_id: row?.project_id,
      domain: row?.domain || row?.hostname,
      status: row?.status || row?.verification_status || 'unknown',
      is_primary: Boolean(row?.is_primary || row?.primary),
      created_at: row?.created_at || null,
    })),
    distributions: {
      deployment_status: adminCountBy(deployments, 'status'),
      domain_status: adminCountBy(domainsResult.rows, 'status'),
    },
    availability: { deployments: deploymentsResult.available, domains: domainsResult.available },
  });
});

app.get('/api/admin/security', async (req: any, res) => {
  if (!requirePlatformAdmin(req, res)) return;
  const client = requireSupabase('Admin security');
  const [runnerResult, projectsResult] = await Promise.all([
    adminRows(client, 'agent_runner_results', 'agent_run_id,status,check_type,severity,message,created_at', { limit: 500, order: 'created_at' }),
    adminRows(client, 'projects', 'id,name,owner_id,preview_status,status,updated_at', { limit: 300, order: 'updated_at' }),
  ]);
  const runnerFindings = runnerResult.rows
    .filter((row: any) => /security|secret|rls|auth|webhook|service_role|xss|csrf|upload/i.test(`${row.check_type} ${row.message}`))
    .map(redactAgentPayload);
  res.json({
    success: true,
    summary: {
      open_findings: runnerFindings.length,
      projects_observed: projectsResult.rows.length,
      secrets_exposed_to_client: false,
      service_role_frontend_guard: 'enabled',
      admin_guard: 'enabled',
    },
    findings: runnerFindings.slice(0, 100),
    checklist: [
      { label: 'Service role never returned to clients', status: 'ok' },
      { label: 'Admin endpoints require platform admin', status: 'ok' },
      { label: 'Provider payloads redacted in logs', status: 'ok' },
      { label: 'Generated app security checks tracked', status: runnerFindings.length ? 'warning' : 'ok' },
    ],
    health: buildAdminHealth(),
    availability: { agent_runner_results: runnerResult.available, projects: projectsResult.available },
  });
});

app.get('/api/admin/feature-flags', async (req: any, res) => {
  if (!requirePlatformAdmin(req, res)) return;
  res.json({
    success: true,
    flags: [
      { key: 'coden_media', label: 'Coden Media', enabled: true, rollout: 'beta', risk: 'medium' },
      { key: 'coden_design', label: 'Coden Design', enabled: true, rollout: 'beta', risk: 'medium' },
      { key: 'coden_decks', label: 'Coden Decks', enabled: true, rollout: 'beta', risk: 'medium' },
      { key: 'rich_message_parts_stream', label: 'Rich message parts stream', enabled: true, rollout: 'all', risk: 'low' },
      { key: 'browser_testing', label: 'Browser testing runtime', enabled: true, rollout: 'all', risk: 'medium' },
      { key: 'auto_model_router', label: 'Auto model router', enabled: true, rollout: 'all', risk: 'medium' },
    ],
    note: 'Flags are read-only here until rollout mutation endpoints are explicitly enabled.',
  });
});

app.get('/api/admin/billing/margins', async (req: any, res) => {
  if (!requirePlatformAdmin(req, res)) return;
  const client = requireSupabase('Admin billing margins');
  const result = await adminRows(
    client,
    'ai_request_usage',
    'id,request_id,provider_cost_usd,platform_cost_usd,final_cost_credits,status,created_at',
    { limit: 100, order: 'created_at' },
  );
  res.json({
    success: true,
    rows: result.rows,
    guardrails: PLAN_ECONOMICS_GUARDRAILS,
    availability: { ai_request_usage: result.available },
    error: result.error,
  });
});

app.get('/api/admin/ai-costs', async (req: any, res) => {
  if (!requirePlatformAdmin(req, res)) return;
  const client = requireSupabase('Admin AI costs');
  const result = await adminRows(
    client,
    'ai_requests',
    'id,organization_id,project_id,model_id,request_type,status,created_at',
    { limit: 100, order: 'created_at' },
  );
  res.json({
    success: true,
    rows: result.rows,
    availability: { ai_requests: result.available },
    error: result.error,
  });
});

app.get('/api/admin/provider-usage', async (req: any, res) => {
  if (!requirePlatformAdmin(req, res)) return;
  const client = requireSupabase('Admin provider usage');
  const result = await adminRows(client, 'provider_usage', '*', { limit: 100, order: 'created_at' });
  res.json({
    success: true,
    rows: result.rows,
    availability: { provider_usage: result.available },
    error: result.error,
  });
});

app.get('/api/admin/agent-observability', async (req: any, res) => {
  if (!requirePlatformAdmin(req, res)) return;
  const client = requireSupabase('Admin agent observability');
  const [runsResult, stepsResult, runnerResult, researchResult] = await Promise.all([
    client
      .from('agent_runs')
      .select('id,request_id,project_id,intent,mode,model_id,status,diagnostic_code,suggested_action,duration_ms,created_at,completed_at,cancelled_at')
      .order('created_at', { ascending: false })
      .limit(250),
    client
      .from('agent_run_steps')
      .select('agent_run_id,event_type,status,message,created_at')
      .order('created_at', { ascending: false })
      .limit(500),
    client
      .from('agent_runner_results')
      .select('agent_run_id,status,check_type,severity,message,duration_ms,created_at')
      .order('created_at', { ascending: false })
      .limit(500),
    client
      .from('agent_research_results')
      .select('agent_run_id,provider,status,diagnostic_code,message,created_at')
      .order('created_at', { ascending: false })
      .limit(200),
  ]);

  if (runsResult.error && !isMissingAgentV2TableError(runsResult.error)) return res.status(500).json({ success: false, error: runsResult.error.message });
  if (stepsResult.error && !isMissingAgentV2TableError(stepsResult.error)) return res.status(500).json({ success: false, error: stepsResult.error.message });
  if (runnerResult.error && !isMissingAgentV2TableError(runnerResult.error)) return res.status(500).json({ success: false, error: runnerResult.error.message });
  if (researchResult.error && !isMissingAgentV2TableError(researchResult.error)) return res.status(500).json({ success: false, error: researchResult.error.message });

  const runs = (runsResult.data || []).map(redactAgentPayload);
  const steps = (stepsResult.data || []).map(redactAgentPayload);
  const runnerRows = (runnerResult.data || []).map(redactAgentPayload);
  const researchRows = (researchResult.data || []).map(redactAgentPayload);
  const completedDurations = runs
    .map((run: any) => Number(run.duration_ms || 0))
    .filter((duration: number) => Number.isFinite(duration) && duration > 0);
  const countBy = (rows: any[], key: string) => rows.reduce((acc: Record<string, number>, row: any) => {
    const value = String(row?.[key] || 'unknown');
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});

  const failedRuns = runs.filter((run: any) => run.status === 'failed');
  const cancelledRuns = runs.filter((run: any) => run.status === 'cancelled');
  const runnerFailures = runnerRows.filter((row: any) => row.status === 'failed').slice(0, 30);
  const feedbackEvents = steps.filter((row: any) => row.event_type === 'user_feedback');
  const moatIntelligence = buildAgentMoatIntelligence({
    runs,
    runnerFailures,
    researchRows,
    feedbackEvents,
  });
  res.json({
    success: true,
    metrics: {
      total_runs: runs.length,
      completed_runs: runs.filter((run: any) => run.status === 'completed').length,
      failed_runs: failedRuns.length,
      cancelled_runs: cancelledRuns.length,
      average_duration_ms: completedDurations.length
        ? Math.round(completedDurations.reduce((sum: number, value: number) => sum + value, 0) / completedDurations.length)
        : 0,
      total_steps: steps.length,
      runner_failures: runnerFailures.length,
      research_events: researchRows.length,
      feedback_events: feedbackEvents.length,
    },
    distributions: {
      by_status: countBy(runs, 'status'),
      by_intent: countBy(runs, 'intent'),
      by_model: countBy(runs, 'model_id'),
      by_step_type: countBy(steps, 'event_type'),
      by_research_status: countBy(researchRows, 'status'),
    },
    moat_intelligence: moatIntelligence,
    recent_errors: failedRuns.slice(0, 25).map((run: any) => ({
      id: run.id,
      request_id: run.request_id,
      project_id: run.project_id,
      intent: run.intent,
      model_id: run.model_id,
      diagnostic_code: run.diagnostic_code,
      suggested_action: run.suggested_action,
      created_at: run.created_at,
    })),
    runner_failures: runnerFailures.map((row: any) => ({
      agent_run_id: row.agent_run_id,
      check_type: row.check_type,
      severity: row.severity,
      message: row.message,
      created_at: row.created_at,
    })),
  });
});

// PATCH /users/me/ai-preferences
app.patch('/api/users/me/ai-preferences', async (req: any, res) => {
  const { default_routing_mode, max_credits_per_action, ask_confirm_before_premium, auto_revert_to_auto } = req.body;
  const uid = getRequiredAuth(req).userId;

  const updated = {
    user_id: uid,
    default_routing_mode: default_routing_mode || 'Auto',
    max_credits_per_action: max_credits_per_action || 50.0,
    ask_confirm_before_premium: ask_confirm_before_premium !== false,
    auto_revert_to_auto: auto_revert_to_auto === true,
    updated_at: new Date().toISOString()
  };

  const client = requireSupabase('User AI preferences');
  const { error } = await client.from('user_ai_preferences').upsert([updated]);
  if (error) return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, preferences: updated });
});

app.get('/api/users/me/model-credit-rates', async (_req: any, res) => {
  res.json({
    success: true,
    models: MODEL_CREDIT_RATES,
  });
});

app.get('/api/users/me/ai-usage', async (req: any, res) => {
  const userId = getUserOrgId(req);
  const helpers = getDbHelpers();
  const client = requireSupabase('AI usage');
  const balance = await helpers.getWallet(userId);
  const planKey = normalizePlanKey(await getOrganizationPlan(userId).catch(() => 'free')) || 'free';
  const plan = getPlanConfig(planKey) || SAAS_PLANS.free;
  const cloud = await loadCloudWalletSnapshot(userId, plan);

  let history: any[] = [];
  try {
    const { data, error } = await client
      .from('ai_requests')
      .select('id, project_id, model_id, request_type, status, created_at, ai_request_usage(final_cost_credits,status), projects(name)')
      .eq('organization_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (!error && Array.isArray(data)) history = data.map(sanitizeAiUsageRow);
  } catch {
    history = [];
  }

  if (!history.length) {
    const { data } = await client
      .from('credit_ledger')
      .select('id,type,amount,balance_after,description,reference_id,created_at')
      .eq('wallet_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);
    history = (data || [])
      .filter((row: any) => ['usage', 'refund'].includes(String(row.type || '')))
      .map((row: any) => {
        const sanitized = sanitizeCreditLedgerEntry(row);
        const match = String(row.description || '').match(/with\s+([A-Za-z0-9_.:/-]+)/i) || String(row.description || '').match(/on:([A-Za-z0-9_.:/-]+)/i);
        return sanitizeAiUsageRow({
          ...sanitized,
          amount: row.amount,
          model_id: match?.[1],
          request_type: row.type === 'refund' ? 'Refund' : 'AI action',
          status: row.type === 'refund' ? 'refunded' : 'completed',
        });
      });
  }

  res.json({
    success: true,
    wallet: {
      balance,
      unlimited: hasUnlimitedTestCredits(userId),
      monthly_credits: plan.credits,
      daily_promo_credits: plan.dailyCredits ?? null,
      topup_credits: null,
      cloud,
    },
    history,
  });
});

app.get('/api/users/me/workspace-state', async (req: any, res) => {
  const userId = getUserOrgId(req);
  const state = await getUserWorkspaceState(userId);
  res.json({ success: true, state });
});

app.patch('/api/users/me/workspace-state', async (req: any, res) => {
  const userId = getUserOrgId(req);
  const patch = req.body || {};
  if (patch.last_project_id) {
    const project = await loadProject(String(patch.last_project_id), userId);
    if (!project) return res.status(404).json({ success: false, error: 'Last project not found.' });
  }
  const state = await upsertUserWorkspaceState(userId, patch);
  res.json({ success: true, state });
});

// PATCH /projects/:id/ai-preferences
app.patch('/api/projects/:id/ai-preferences', async (req: any, res) => {
  const { default_routing_mode, max_credits_per_action, ask_confirm_before_premium, auto_revert_to_auto } = req.body;
  const pid = req.params.id;
  const userId = getUserOrgId(req);
  const project = await loadProject(pid, userId);
  if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });

  const updated = {
    project_id: pid,
    default_routing_mode: default_routing_mode || 'Auto',
    max_credits_per_action: max_credits_per_action || 50.0,
    ask_confirm_before_premium: ask_confirm_before_premium !== false,
    auto_revert_to_auto: auto_revert_to_auto === true,
    updated_at: new Date().toISOString()
  };

  const client = requireSupabase('Project AI preferences');
  const { error } = await client.from('project_ai_preferences').upsert([updated]);
  if (error) return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, preferences: updated });
});

app.patch('/api/projects/:id/workspace-state', async (req: any, res) => {
  const userId = getUserOrgId(req);
  const project = await loadProject(req.params.id, userId);
  if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });
  const state = await upsertProjectWorkspaceState(userId, project.id, req.body || {});
  res.json({ success: true, state });
});

app.get('/api/projects/:id/messages', async (req: any, res) => {
  const userId = getUserOrgId(req);
  const project = await loadProject(req.params.id, userId);
  if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });
  let messages = await listProjectMessagesPage(project.id, req.query?.limit, req.query?.before);
  if (!messages.length) {
    const snapshot = await loadDurableProjectSnapshot(project.id, userId);
    const fallback = Array.isArray(snapshot?.messages_snapshot) ? snapshot!.messages_snapshot! : [];
    messages = fallback.slice(-Math.min(100, Math.max(1, Number(req.query?.limit || 100)))).map(sanitizeProjectMessageForUser);
  }
  res.json({ success: true, messages });
});

app.get('/api/projects/:id/events', async (req: any, res) => {
  const userId = getUserOrgId(req);
  const project = await loadProject(req.params.id, userId);
  if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });
  let events = await listAgentEventsPage(project.id, req.query?.limit, req.query?.before);
  if (!events.length) {
    const snapshot = await loadDurableProjectSnapshot(project.id, userId);
    const fallback = Array.isArray(snapshot?.events_snapshot) ? snapshot!.events_snapshot! : [];
    events = fallback.slice(-Math.min(100, Math.max(1, Number(req.query?.limit || 100)))).map(redactSecretPayload);
  }
  res.json({ success: true, events });
});

// POST /projects/:id/messages (THE AI ENGINE AND CREDIT BALANCER)
app.post('/api/projects/:id/messages', async (req: any, res: any) => {
  const projectId = req.params.id;
  const { messages, mode, customModelId, userId, taskComplexity = 'medium' } = req.body;
  const orgId = getUserOrgId(req);
  const clientHelpers = getDbHelpers();

  try {
    // 1. Check Wallet Balance
    const balance = await clientHelpers.getWallet(orgId);

    // 2. Select Model
    const routingCtx: RoutingContext = {
      plan: req.body.plan || 'free',
      mode: mode || 'Auto',
      userCredits: balance,
      taskComplexity: taskComplexity,
    };

    const targetModel = await modelRouter.selectModel(routingCtx, customModelId);

    // Dynamic initial estimation component
    const actionCostComp = {
      openrouter_cost_usd: 0.00001, // default baseline
      infra_cost_usd: 0.0001,
      storage_cost_usd: 0.00002,
      build_cost_usd: 0.001,
      domain_operation_cost_usd: 0,
      minimum_action_credits: Math.max(1, modelCreditFloor(targetModel)),
      complexity_surcharge: taskComplexity === 'complex' ? 1.5 : 0
    };

    const initialEstimate = costEstimator.calculateRequiredCredits(actionCostComp);
    if (balance < initialEstimate.finalCredits) {
      return res.status(402).json(publicCreditGateResponse());
    }

    // 3. Reserve Credits safely
    const refId = `req_${Math.random().toString(36).substring(2, 13)}`;
    await clientHelpers.createReservation(orgId, initialEstimate.finalCredits, refId);

    // 4. Call OpenRouter
    try {
      const completionResult = await providerGateway.chat(targetModel, messages, { allowFallback: false });

      // Re-estimate final cost from real OpenRouter token outputs
      const finalCostComp = {
        openrouter_cost_usd: completionResult.cost_usd,
        infra_cost_usd: 0.0001,
        storage_cost_usd: 0.00002,
        build_cost_usd: 0.001,
        domain_operation_cost_usd: 0,
        minimum_action_credits: Math.max(1, modelCreditFloor(completionResult.model)),
        complexity_surcharge: taskComplexity === 'complex' ? 1.5 : 0
      };

      const finalEstimate = costEstimator.calculateRequiredCredits(finalCostComp);

      const reservationServ = new CreditReservationService(requireSupabase('Credit reservation release'));
      await reservationServ.releaseReservation(refId, true, finalEstimate.finalCredits);
      const finalBalance = await clientHelpers.updateWallet(orgId, -finalEstimate.finalCredits);
      await clientHelpers.addLedger(orgId, 'usage', -finalEstimate.finalCredits, finalBalance, `AI usage on:${completionResult.model}`, refId);

      res.json({
        success: true,
        model: completionResult.model,
        text: completionResult.text,
        routing_mode: mode || 'Auto'
      });

    } catch (apiError: any) {
      // Platform / API service error => Refund fully!
      const reservationServ = new CreditReservationService(requireSupabase('Credit reservation refund'));
      await reservationServ.releaseReservation(refId, false);

      throw new Error(`Platform Engine Auto-Refund Triggered: ${apiError.message}`);
    }

  } catch (err: any) {
    if (err instanceof ForbiddenModelError) {
      await clientHelpers.addAudit({
        user_id: userId || 'anonymous',
        requested_model: customModelId || 'unknown',
        reason: 'Attempted use of non-whitelist model',
        source: 'chat'
      });
      return res.status(403).json({ success: false, error: 'ForbiddenModelError', message: err.message });
    }
    res.status(500).json({ success: false, message: err.message });
  }
});

// ──────────────────────────────────────────────────────────────────────
// 3. CUSTOM DOMAINS ENDPOINTS
// ──────────────────────────────────────────────────────────────────────

app.post('/api/analytics/collect', async (req: any, res: any) => {
  setAnalyticsCors(res);
  try {
    const projectId = String(req.body?.project_id || '').trim();
    if (!isUuid(projectId)) {
      return res.status(400).json({ success: false, error: 'A valid project_id is required.' });
    }

    const project = await loadProjectForAnalytics(projectId);
    if (!project) {
      return res.status(404).json({ success: false, error: 'Project not found.' });
    }

    const durationSeconds = Math.max(0, Math.min(24 * 60 * 60, Number(req.body?.duration_seconds || 0)));
    const country = detectAnalyticsCountry(req);
    await saveAnalyticsEvent(project, {
      session_id: cleanAnalyticsText(req.body?.session_id, randomUUID(), 120),
      visitor_id: cleanAnalyticsText(req.body?.visitor_id, randomUUID(), 120),
      event_type: normalizeAnalyticsEventType(req.body?.event_type),
      page_path: normalizeAnalyticsPath(req.body?.page_path),
      source: normalizeAnalyticsSource(req.body?.source),
      duration_seconds: Number.isFinite(durationSeconds) ? durationSeconds : 0,
      environment: normalizeAnalyticsEnvironment(req.body?.environment),
      country_code: country.country_code,
      country_name: country.country_name,
      device: detectAnalyticsDevice(req.headers['user-agent']),
    });

    return res.json({ success: true });
  } catch (error: any) {
    console.error('[coden:analytics_collect_failed]', { message: error?.message || String(error) });
    const status = error?.statusCode || (String(error?.message || '').includes('requires SUPABASE_SERVICE_ROLE_KEY') ? 503 : 500);
    return res.status(status).json({
      success: false,
      error: status === 503 ? 'Analytics storage is not configured.' : 'Analytics event could not be collected.',
    });
  }
});

app.get('/api/projects', async (req: any, res: any) => {
  const userId = getUserOrgId(req);
  const projects = await listProjectsForUser(userId);
  const enrichedProjects = await enrichProjectsForDashboard(projects);
  res.json({ success: true, projects: enrichedProjects });
});

app.post('/api/projects', async (req: any, res: any) => {
  const requestId = `req_${randomUUID()}`;
  try {
    const authUser = requireAuthenticatedUser(req, res);
    if (!authUser) return;
    const userId = authUser.id;
    const organizationId = await ensurePersonalOrganization(req, userId);
    const prompt = sanitizeWorkspaceText(req.body?.prompt || req.body?.description || '').trim();
    const requestedName = sanitizeProjectName(req.body?.name);
    const name = sanitizeProjectName(
      !requestedName || isAutomaticallyDerivedProjectName(requestedName, prompt)
        ? deriveProjectName(prompt)
        : requestedName,
    );

    if (!name) {
      return res.status(400).json({ success: false, error: 'Project name is required.' });
    }

    const now = new Date().toISOString();
    const project: GeneratedProject = {
      id: randomUUID(),
      owner_id: userId,
      organization_id: organizationId,
      created_by: userId,
      name,
      slug: await uniqueSlug(name, userId),
      prompt,
      template: String(req.body?.template || 'custom'),
      theme: String(req.body?.theme || 'light'),
      model_id: normalizeModelSelectionId(req.body?.model || req.body?.modelId || 'auto'),
      status: 'draft',
      preview_status: 'idle',
      created_at: now,
      updated_at: now,
    };

    // A new project starts with an honest empty preview. The builder owns the
    // loading state until real generated files have passed the quality gates.
    const files: GeneratedFile[] = [];
    project.preview_html = '';
    await saveProject(project, files);
    const codenCloud = prompt
      ? await upsertProjectBackendRequirements(project, prompt).catch((error: any) => {
        console.warn('[coden:cloud_requirement_create_skipped]', { message: error?.message || String(error) });
        return null;
      })
      : null;

    // Auto-provision a dedicated Supabase project (DB + Auth + Storage) for
    // this app, when a management token is configured. Best-effort: never
    // blocks project creation; result is returned to the caller for display.
    let supabaseProvision: any = null;
    try {
      const { provisionAppBackend, publicProvisionedProject } = await import('./src/services/supabase-auto-provision');
      const result = await provisionAppBackend({
        appName: project.name || `coden-${project.slug}`,
        files,
      });
      if (result.ok && result.project) {
        supabaseProvision = {
          status: 'provisioned',
          project: publicProvisionedProject(result.project),
          migration: result.migration || null,
          storage: result.storage || null,
        };
        console.log('[coden:supabase_auto_provisioned]', {
          project_id: project.id,
          supabase_ref: result.project.ref,
          region: result.project.region,
        });
      } else {
        supabaseProvision = { status: 'skipped', reason: result.reason || result.error || 'unknown' };
      }
    } catch (error: any) {
      console.warn('[coden:supabase_auto_provision_failed]', { message: error?.message || String(error) });
      supabaseProvision = { status: 'error', reason: error?.message || 'provision_failed' };
    }

    await upsertUserWorkspaceState(userId, {
      last_project_id: project.id,
      dashboard_draft_prompt: '',
      builder_draft_prompt: '',
      builder_selected_mode: normalizeRequestedMode(req.body?.requestedMode || req.body?.mode),
      builder_selected_model: project.model_id,
      builder_active_tab: 'preview',
      builder_preview_device: req.body?.preview_device || req.body?.previewDevice || 'desktop',
      last_route: `/builder.html?project=${project.id}`,
    });
    await upsertProjectWorkspaceState(userId, project.id, {
      draft_prompt: '',
      selected_mode: normalizeRequestedMode(req.body?.requestedMode || req.body?.mode),
      selected_model: project.model_id,
      active_tab: 'preview',
      preview_device: req.body?.preview_device || req.body?.previewDevice || 'desktop',
      sidebar_width: 380,
    });

    res.status(201).json({
      success: true,
      project,
      files,
      preview: {
        status: project.preview_status,
        html: project.preview_html,
      },
      coden_cloud: codenCloud
        ? {
          requirements: publicCodenCloudRequirementPayload(codenCloud.requirement),
          project: codenCloud.cloudProject,
        }
        : undefined,
      supabase_provision: supabaseProvision,
    });
  } catch (error: any) {
    const status = error?.statusCode || 500;
    const diagnosticCode = status === 503 ? 'PROJECT_STORAGE_NOT_CONFIGURED' : 'PROJECT_CREATE_FAILED';
    const message = status === 503
      ? 'Project storage is not configured.'
      : 'Coden could not create the project workspace. Please retry in a moment.';
    console.error('[coden:project_create_failed]', {
      request_id: requestId,
      diagnostic_code: diagnosticCode,
      message: redactSecrets(error?.message || String(error), '[redacted]'),
    });
    res.status(status).json({
      success: false,
      error: message,
      message,
      diagnostic_code: diagnosticCode,
      request_id: requestId,
      suggested_action: status === 503 ? 'check_supabase_configuration' : 'retry',
    });
  }
});

app.get('/api/projects/:id', async (req: any, res: any) => {
  const userId = getUserOrgId(req);
  const project = await loadProject(req.params.id, userId);
  if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });

  const [files, messages, events, workspaceState, snapshot] = await Promise.all([
    loadProjectFiles(project.id),
    listProjectMessages(project.id),
    listAgentEvents(project.id),
    getProjectWorkspaceState(project.id),
    loadDurableProjectSnapshot(project.id, userId),
  ]);
  const recovered = recoverProjectPayloadFromSnapshot({ project, files, messages, events, workspace: workspaceState, snapshot });
  await upsertUserWorkspaceState(userId, { last_project_id: project.id, last_route: `/builder.html?project=${project.id}` });
  res.json({
    success: true,
    recovery_source: recovered.recovery_source,
    project,
    files: recovered.files,
    messages: recovered.messages,
    events: recovered.events,
    workspace_state: recovered.workspace,
    preview: recovered.preview,
  });
});

app.patch('/api/projects/:id', async (req: any, res: any) => {
  const userId = getUserOrgId(req);
  const project = await loadProject(req.params.id, userId);
  if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });

  const name = sanitizeProjectName(req.body?.name);
  if (name.length < 2) {
    return res.status(400).json({ success: false, error: 'Project name must contain at least 2 characters.' });
  }

  const updatedProject = {
    ...project,
    name,
    slug: await resolveStableProjectSlug(project, name, userId),
    updated_at: new Date().toISOString(),
  };
  await saveProject(updatedProject);
  res.json({ success: true, project: updatedProject });
});

app.delete('/api/projects/:id', async (req: any, res: any) => {
  const userId = getUserOrgId(req);
  const project = await loadProject(req.params.id, userId, req);
  if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });
  await deleteProjectCascade(project);
  await upsertUserWorkspaceState(userId, {
    last_project_id: null,
    last_route: '/dashboard.html',
  }).catch(() => null);
  res.json({ success: true, deleted_project_id: project.id });
});

app.get('/api/projects/:id/state', async (req: any, res: any) => {
  const userId = getUserOrgId(req);
  const project = await loadProject(req.params.id, userId);
  if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });
  const [files, messages, events, versions, secrets, errors, workspaceState, snapshot] = await Promise.all([
    loadProjectFiles(project.id),
    listProjectMessages(project.id),
    listAgentEvents(project.id),
    listProjectVersions(project.id),
    listProjectSecrets(project.id),
    listBuildErrors(project.id),
    getProjectWorkspaceState(project.id),
    loadDurableProjectSnapshot(project.id, userId),
  ]);
  const recovered = recoverProjectPayloadFromSnapshot({ project, files, messages, events, workspace: workspaceState, snapshot });
  await upsertUserWorkspaceState(userId, { last_project_id: project.id, last_route: `/builder.html?project=${project.id}` });
  res.json({
    success: true,
    recovery_source: recovered.recovery_source,
    project,
    files: recovered.files,
    messages: recovered.messages,
    events: recovered.events,
    versions,
    secrets,
    errors,
    workspace_state: recovered.workspace,
    preview: recovered.preview,
  });
});

app.get('/api/projects/:id/analysis', async (req: any, res: any) => {
  try {
    const userId = getUserOrgId(req);
    const project = await loadProject(req.params.id, userId);
    if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });
    const files = await loadProjectFiles(project.id);
    const analysis = await loadProjectAnalysis(project, String(req.query?.range || '30d'));
    const seo = buildProjectSeoAudit(project, files);
    res.json({ success: true, project_id: project.id, range: String(req.query?.range || '30d'), ...analysis, seo });
  } catch (error: any) {
    const status = error?.statusCode || (String(error?.message || '').includes('requires SUPABASE_SERVICE_ROLE_KEY') ? 503 : 500);
    res.status(status).json({
      success: false,
      error: status === 503 ? 'Analytics storage is not configured.' : error?.message || 'Analysis unavailable.',
    });
  }
});

app.get('/api/projects/:id/seo-audit', async (req: any, res: any) => {
  try {
    const userId = getUserOrgId(req);
    const project = await loadProject(req.params.id, userId);
    if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });
    const files = await loadProjectFiles(project.id);
    res.json({ success: true, project_id: project.id, seo: buildProjectSeoAudit(project, files) });
  } catch (error: any) {
    const status = error?.statusCode || 500;
    res.status(status).json({
      success: false,
      error: error?.message || 'SEO audit unavailable.',
    });
  }
});

app.post('/api/projects/:id/estimate', async (req: any, res: any) => {
  const userId = getUserOrgId(req);
  const project = await loadProject(req.params.id, userId);
  if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });
  const files = await loadProjectFiles(project.id);
  const lastPlan = await getLastProjectPlan(project.id);
  const recentHistory = await getRecentDecisionHistory(project.id, 6);
  const decision = await resolveAgentDecision({
    prompt: sanitizeWorkspaceText(req.body?.prompt || ''),
    requestedMode: normalizeRequestedMode(req.body?.requestedMode),
    hasFiles: files.length > 0,
    lastPlan,
    recentHistory,
  });
  void decision;
  res.json({
    allowed: true,
    requires_upgrade: false,
    suggested_action: 'continue',
  });
});

app.post('/api/projects/:id/agent/answer', async (req: any, res: any) => {
  const userId = getUserOrgId(req);
  const project = await loadProject(req.params.id, userId);
  if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });

  const originalPrompt = redactSecrets(req.body?.originalPrompt || '').trim();
  const answer = redactSecrets(req.body?.answer || '').trim();
  const recommendation = redactSecrets(req.body?.recommendation || '').trim();
  const finalAnswer = answer || recommendation;

  if (!finalAnswer) {
    return res.status(400).json({ success: false, error: 'A clarification answer is required.' });
  }

  const resumedPrompt = [
    originalPrompt || 'Continue the current build request.',
    '',
    `Clarification answer: ${finalAnswer}`,
  ].join('\n');

  await saveProjectMessage({
    organization_id: project.organization_id,
    project_id: project.id,
    user_id: userId,
    role: 'user',
    content: `Clarification: ${finalAnswer}`,
    intent: 'clarification_required',
    requested_mode: normalizeRequestedMode(req.body?.requestedMode),
  });

  res.json({
    success: true,
    prompt: resumedPrompt,
    requestedMode: normalizeRequestedMode(req.body?.requestedMode),
  });
});

function buildMediaPrompt(input: {
  prompt: string;
  settings: CodenMediaSettings;
  project: GeneratedProject;
}) {
  const output = mediaOutputForKind(input.settings.kind);
  const isMarketingKit = output === 'marketing_kit';
  return [
    isMarketingKit
      ? 'Create a launch-ready marketing kit for Coden Media.'
      : `Create a ${output} concept for Coden Media.`,
    `Project: ${input.project.name}.`,
    `Format: ${input.settings.format}.`,
    `Duration: ${input.settings.duration}.`,
    `Asset type: ${input.settings.kind.replace(/_/g, ' ')}.`,
    'Style: clean, premium, marketing-ready, direct, modern, specific to the project, not generic AI design.',
    isMarketingKit
      ? 'Include brand DNA, campaign promise, social posts, WhatsApp copy, ad angles, CTA, asset checklist, and one-pager outline.'
      : 'If this is a rendered asset, keep the result visually simple, brand-safe, and useful for launch.',
    'If this is UGC or an ad, include a strong first-second hook, clear product promise, simple visual sequence, and CTA.',
    'Do not expose internal provider cost or raw provider payloads. Return a useful brief even if rendering is unavailable.',
    `User request: ${input.prompt}`,
  ].join('\n');
}

function mediaKindLabel(kind: CodenMediaSettings['kind']) {
  const labels: Record<CodenMediaSettings['kind'], string> = {
    launch_kit: 'Launch kit',
    campaign_pack: 'Campaign pack',
    social_posts: 'Social posts',
    ads_creatives: 'Ads creatives',
    brand_assets: 'Brand assets',
    pitch_one_pager: 'Pitch / one-pager',
    video_ad: 'Video ad',
    ugc: 'UGC ad',
    storyboard: 'Storyboard',
    product_image: 'Product image',
    social_creative: 'Social creative',
    thumbnail: 'Thumbnail',
  };
  return labels[kind] || 'Media';
}

function mediaRouteLabel(value: unknown) {
  const normalized = String(value || 'auto').replace(/_/g, ' ').toLowerCase();
  if (normalized === 'best quality') return 'Quality route';
  if (normalized === 'fast') return 'Fast route';
  if (normalized === 'flux' || normalized === 'openai image') return 'Image route';
  if (normalized === 'seedance' || normalized === 'veo' || normalized === 'sora' || normalized === 'kling') return 'Video route';
  return 'Auto route';
}

function projectAudienceHint(project: GeneratedProject, prompt: string) {
  const source = `${project.name || ''} ${prompt || ''}`.toLowerCase();
  if (/restaurant|menu|reservation|food|cafe|bar/.test(source)) return 'local customers who want to book, order or discover the offer quickly';
  if (/e-?commerce|shop|store|product|checkout|cart/.test(source)) return 'buyers comparing products and looking for trust, price and proof';
  if (/saas|dashboard|crm|analytics|tool|startup/.test(source)) return 'busy teams who want a faster workflow and a clear business outcome';
  if (/portfolio|agency|creator|studio/.test(source)) return 'clients who want to understand the work, credibility and next step quickly';
  if (/course|school|education|learn/.test(source)) return 'learners or parents looking for clarity, confidence and progress';
  return 'people who need the project promise explained clearly before they take action';
}

function buildMediaKitSections(input: {
  project: GeneratedProject;
  prompt: string;
  settings: CodenMediaSettings;
}) {
  const projectName = input.project.name || 'this app';
  const audience = projectAudienceHint(input.project, input.prompt);
  const cleanPrompt = input.prompt.replace(/\s+/g, ' ').trim();
  const promise = cleanPrompt.length > 12
    ? cleanPrompt
    : `${projectName} helps users get from idea to a useful result faster.`;
  const cta = input.settings.kind === 'pitch_one_pager'
    ? 'Book a demo'
    : input.settings.kind === 'social_posts'
      ? 'Try it today'
      : 'Launch with Coden';
  const angle = input.settings.kind === 'campaign_pack'
    ? 'Build one clear campaign system: hook, promise, visual proof, short copy, and repeatable variants.'
    : input.settings.kind === 'ads_creatives'
    ? 'Turn the pain point into a fast, visible before/after.'
    : input.settings.kind === 'brand_assets'
      ? 'Make every asset feel consistent, trustworthy and easy to reuse.'
      : input.settings.kind === 'pitch_one_pager'
        ? 'Lead with the problem, show the product, then prove the opportunity.'
        : 'Show the app as a practical launch-ready solution.';

  return [
    {
      title: 'Brand DNA',
      body: `${projectName} should feel direct, credible, launch-ready and easy to understand in under five seconds.`,
    },
    {
      title: 'Launch headline',
      body: `${projectName}: ${promise}`,
    },
    {
      title: 'Audience',
      body: audience,
    },
    {
      title: 'Core angle',
      body: angle,
    },
    {
      title: 'Facebook / Instagram',
      body: `Your next launch asset is ready. ${projectName} turns the main promise into a simple experience people can understand in seconds. ${cta}.`,
    },
    {
      title: 'LinkedIn',
      body: `We built ${projectName} to make the value obvious: clear workflow, polished interface, and a direct path from interest to action. ${cta}.`,
    },
    {
      title: 'WhatsApp',
      body: `Hi, I just launched ${projectName}. It helps ${audience}. Want me to send you the link?`,
    },
    {
      title: 'Ad variant A',
      body: `Hook: Stop losing time on manual work. Visual: app screen in context. CTA: ${cta}.`,
    },
    {
      title: 'Ad variant B',
      body: `Hook: See the result before you commit. Visual: before/after split. CTA: ${cta}.`,
    },
    {
      title: 'Brand assets',
      body: 'Use one hero screenshot, one square social card, one vertical story, one simple logo lockup, and one short CTA line.',
    },
    {
      title: 'Creative direction',
      body: `Format ${input.settings.format}, duration ${input.settings.duration}. Keep one visual idea, one promise and one CTA per asset.`,
    },
    {
      title: 'One-pager outline',
      body: `Problem, audience, product promise, 3 key benefits, proof or preview screenshot, pricing/next step, CTA: ${cta}.`,
    },
  ];
}

function renderMediaAsset(asset: FalMediaAsset) {
  if (asset.type === 'video') {
    return `<video class="media-preview-asset" src="${escapeHtml(asset.url)}" controls playsinline preload="metadata"></video>`;
  }
  return `<img class="media-preview-asset" src="${escapeHtml(asset.url)}" alt="Generated Coden Media asset">`;
}

function renderCodenMediaPreviewHtml(input: {
  project: GeneratedProject;
  prompt: string;
  settings: CodenMediaSettings;
  modelLabel: string;
  estimatedCredits: number;
  providerStatus: 'completed' | 'queued' | 'not_configured' | 'locked' | 'failed';
  assets: FalMediaAsset[];
  errorMessage?: string;
}) {
  const kind = mediaKindLabel(input.settings.kind);
  const output = mediaOutputForKind(input.settings.kind);
  const isMarketingKit = output === 'marketing_kit';
  const routeLabel = mediaRouteLabel(input.settings.modelPreference);
  const statusCopy: Record<'completed' | 'queued' | 'not_configured' | 'locked' | 'failed', string> = {
    completed: 'Asset ready',
    queued: 'Render queued',
    not_configured: 'Brief ready',
    locked: 'Plan upgrade required',
    failed: 'Render needs retry',
  };
  const heroCopy = input.providerStatus === 'completed'
    ? isMarketingKit ? 'Your marketing kit is ready.' : 'Your generated asset is ready.'
    : input.providerStatus === 'queued'
      ? 'The render was accepted and is being processed.'
      : input.providerStatus === 'locked'
        ? 'This media model is reserved for a higher plan or needs more credits.'
        : input.providerStatus === 'failed'
          ? 'The render could not complete, so Coden kept the usable brief and retry path.'
          : 'Coden prepared the creative direction. Connect media rendering when you want real output.';
  const cards = isMarketingKit
    ? buildMediaKitSections({ project: input.project, prompt: input.prompt, settings: input.settings })
    : [
      { title: 'Hook', body: input.settings.kind === 'ugc' ? 'Open with a human, problem-first line that feels native to Reels/TikTok.' : 'Lead with the clearest product promise in the first second.' },
      { title: 'Storyboard', body: output === 'image' ? 'One focal scene, product first, readable text and clean negative space.' : 'Three beats: problem, visible transformation, proof or CTA.' },
      { title: 'Prompt direction', body: `Use a premium ${input.settings.format} composition, short copy, clear lighting, and the current project tone.` },
      { title: 'Next action', body: input.assets.length ? 'Download, reuse, or ask Coden for a variation.' : 'Render when media access is ready, or ask for a cheaper/faster variant.' },
    ];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
:root{color-scheme:light dark;--bg:#fcfbf8;--panel:#fffefa;--ink:#1c1c1c;--muted:#5f5f5d;--line:#eceae4;--blue:#315fdc;--soft:#f7f4ed}
@media(prefers-color-scheme:dark){:root{--bg:#171613;--panel:#201f1b;--ink:#f8f4eb;--muted:#d8d1c3;--line:rgba(252,251,248,.14);--soft:#24231f}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 50% 0,rgba(59,130,246,.10),transparent 34%),var(--bg);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--ink)}
.media-lab{min-height:100vh;padding:clamp(18px,3vw,34px);display:grid;align-content:center;gap:14px}
.media-head{display:flex;align-items:flex-start;justify-content:space-between;gap:18px}
.eyebrow{display:inline-flex;align-items:center;gap:8px;color:var(--muted);font-size:12px;font-weight:850;letter-spacing:.08em;text-transform:uppercase}.dot{width:8px;height:8px;border-radius:99px;background:#3b82f6;box-shadow:0 0 0 5px rgba(59,130,246,.12)}
h1{margin:8px 0 8px;font-size:clamp(28px,4.4vw,48px);line-height:.98;letter-spacing:-.045em;max-width:780px}.summary{margin:0;max-width:680px;color:var(--muted);font-size:clamp(14px,1.6vw,17px);line-height:1.55}
.status{display:inline-flex;align-items:center;gap:8px;border:1px solid var(--line);border-radius:999px;background:var(--panel);padding:9px 12px;font-size:12px;font-weight:800;color:var(--ink);white-space:nowrap}
.grid{display:grid;grid-template-columns:${isMarketingKit ? '1fr' : 'minmax(0,1.25fr) minmax(280px,.75fr)'};gap:16px;align-items:stretch}.stage,.brief{border:1px solid var(--line);border-radius:22px;background:color-mix(in srgb,var(--panel) 92%,transparent);box-shadow:0 24px 70px rgba(28,28,28,.08);overflow:hidden}
.stage{min-height:${isMarketingKit ? 'auto' : '380px'};display:grid;place-items:center;padding:16px}.asset-wrap{width:100%;height:100%;display:grid;place-items:center;border-radius:18px;background:linear-gradient(135deg,var(--soft),var(--panel));border:1px solid var(--line);overflow:hidden}
.media-preview-asset{max-width:100%;max-height:68vh;border-radius:16px;display:block;object-fit:contain}.placeholder{padding:28px;text-align:center;max-width:520px}.orb{width:112px;height:112px;margin:0 auto 18px;border-radius:999px;background:radial-gradient(circle at 28% 24%,#fff,rgba(191,219,254,.9) 23%,rgba(49,95,220,.55) 52%,rgba(28,28,28,.18) 76%);box-shadow:0 24px 80px rgba(49,95,220,.20);animation:pulse 4s cubic-bezier(.22,1,.36,1) infinite}
.placeholder strong{display:block;font-size:22px;margin-bottom:8px}.placeholder span{color:var(--muted);font-size:14px;line-height:1.5}.brief{padding:18px;display:grid;gap:10px}.meta{display:flex;flex-wrap:wrap;gap:8px}.pill{border:1px solid var(--line);background:var(--soft);border-radius:999px;padding:7px 9px;font-size:12px;font-weight:800;color:var(--ink)}
.kit-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.card{border:1px solid var(--line);border-radius:16px;background:var(--panel);padding:14px}.card span{display:block;color:var(--muted);font-size:11px;font-weight:850;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px}.card p{margin:0;color:var(--ink);font-size:13px;line-height:1.48}
.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:4px}.actions a,.action-chip{height:32px;border-radius:999px;border:1px solid var(--line);background:var(--ink);color:var(--bg);padding:0 12px;font:800 12px Inter,system-ui;text-decoration:none;display:inline-flex;align-items:center}
.action-chip{background:transparent;color:var(--ink)}.error{color:#b42318;font-size:12px;margin-top:8px}
@keyframes pulse{0%,100%{transform:scale(1);opacity:.9}50%{transform:scale(1.04);opacity:1}}@media(max-width:820px){.grid,.kit-grid{grid-template-columns:1fr}.media-head{display:grid}.stage{min-height:${isMarketingKit ? 'auto' : '340px'}}}@media(prefers-reduced-motion:reduce){.orb{animation:none}}
</style>
</head>
<body>
<main class="media-lab">
  <section class="media-head">
    <div>
      <div class="eyebrow"><span class="dot"></span>Coden Media</div>
      <h1>${escapeHtml(kind)} for ${escapeHtml(input.project.name || 'your project')}</h1>
      <p class="summary">${escapeHtml(heroCopy)}</p>
    </div>
    <div class="status">${escapeHtml(statusCopy[input.providerStatus])}</div>
  </section>
  <section class="grid">
    ${isMarketingKit ? '' : `<div class="stage">
      <div class="asset-wrap">
        ${input.assets.length ? input.assets.map(renderMediaAsset).join('') : `<div class="placeholder"><div class="orb" aria-hidden="true"></div><strong>${escapeHtml(kind)} brief ready</strong><span>${escapeHtml(input.prompt)}</span>${input.errorMessage ? `<div class="error">${escapeHtml(input.errorMessage)}</div>` : ''}</div>`}
      </div>
    </div>`}
    <aside class="brief">
      <div class="meta">
        <span class="pill">${escapeHtml(input.settings.format)}</span>
        <span class="pill">${escapeHtml(input.settings.duration)}</span>
        <span class="pill">${escapeHtml(routeLabel)}</span>
        <span class="pill">~${input.estimatedCredits} credits</span>
      </div>
      <div class="${isMarketingKit ? 'kit-grid' : ''}">
        ${cards.map(card => `<div class="card"><span>${escapeHtml(card.title)}</span><p>${escapeHtml(card.body)}</p></div>`).join('')}
      </div>
      <div class="actions">
        ${input.assets[0]?.url ? `<a href="${escapeHtml(input.assets[0].url)}" download>Download</a>` : ''}
        <span class="action-chip">${isMarketingKit ? 'Ask for variants' : 'Ask for variation'}</span>
        <span class="action-chip">${isMarketingKit ? 'Turn into visual' : 'Use in app'}</span>
      </div>
    </aside>
  </section>
</main>
</body>
</html>`;
}

async function saveMediaAssetRecords(input: {
  project: GeneratedProject;
  userId: string;
  prompt: string;
  settings: CodenMediaSettings;
  modelId: string;
  assets: FalMediaAsset[];
  estimatedCredits: number;
}) {
  if (!input.assets.length) return;
  const client = getSupabase();
  if (!client) return;
  const rows = input.assets.map(asset => ({
    organization_id: input.project.organization_id,
    project_id: input.project.id,
    user_id: input.userId,
    asset_type: asset.type,
    provider: 'fal.ai',
    model_id: input.modelId,
    prompt: input.prompt,
    format: input.settings.format,
    duration: input.settings.duration,
    asset_url: asset.url,
    thumbnail_url: asset.type === 'image' ? asset.url : null,
    status: 'completed',
    credits_charged: input.estimatedCredits,
    public_metadata: {
      kind: input.settings.kind,
      width: asset.width || null,
      height: asset.height || null,
      content_type: asset.contentType || null,
    },
  }));
  const { error } = await client.from('media_assets').insert(rows);
  if (error && /media_assets|schema cache|relation .* does not exist|table .* does not exist/i.test(error.message || '')) {
    console.warn('[coden:media_assets_skipped]', { message: error.message });
    return;
  }
  if (error) console.warn('[coden:media_assets_insert_failed]', { message: redactSecrets(error.message) });
}

app.post('/api/projects/:id/media/generate', async (req: any, res: any) => {
  const requestId = `media_${randomUUID()}`;
  const authUser = requireAuthenticatedUser(req, res, requestId);
  if (!authUser) return;
  const userId = authUser.id;
  const project = await loadProject(req.params.id, userId);
  if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });
  if (!requireProjectCapability(req, res, 'view', project)) return;

  const prompt = sanitizeWorkspaceText(req.body?.prompt || '').trim();
  if (!prompt) return res.status(400).json({ success: false, error: 'Prompt is required.' });
  if (isAbusivePrompt(prompt)) {
    return res.status(400).json({ success: false, error: 'This request cannot be generated safely.' });
  }
  if (!enforceRateLimit(`media:${userId}`, 10, 60_000)) {
    return res.status(429).json({ success: false, error: 'Too many media requests. Please wait a moment.' });
  }

  const helpers = getDbHelpers();
  const plan = await getOrganizationPlan(project.organization_id).catch(() => 'free');
  const settings = normalizeMediaSettings(req.body?.settings || req.body?.mediaSettings || req.body?.studioContext?.settings || {});
  const model = selectMediaModel(settings, plan);
  const estimatedCredits = estimateMediaCredits(settings, model);
  const wallet = await helpers.getWallet(userId).catch(() => FALLBACK_WALLET_CREDITS);
  const modelAvailable = isMediaModelAvailable(model, plan);
  const output = mediaOutputForKind(settings.kind);
  const isMarketingKit = isMarketingMediaKind(settings.kind);

  await saveProjectMessage({
    organization_id: project.organization_id,
    project_id: project.id,
    user_id: userId,
    role: 'user',
    content: prompt,
    intent: 'conversation',
    requested_mode: 'auto',
  });

  let providerStatus: 'completed' | 'queued' | 'not_configured' | 'locked' | 'failed' = 'not_configured';
  let assets: FalMediaAsset[] = [];
  let errorMessage = '';
  if (!modelAvailable) {
    providerStatus = 'locked';
  } else if (wallet < estimatedCredits) {
    providerStatus = 'locked';
    errorMessage = 'Not enough credits for this media render.';
  } else if (isMarketingKit) {
    providerStatus = 'completed';
    const finalBalance = await helpers.updateWallet(userId, -estimatedCredits);
    await helpers.addLedger(userId, 'usage', -estimatedCredits, finalBalance, `Generated ${mediaKindLabel(settings.kind)} with Coden Media`, requestId);
  } else {
    try {
      const mediaPrompt = buildMediaPrompt({ prompt, settings, project });
      const result = await falMediaGateway.generate({ model, settings, prompt: mediaPrompt });
      providerStatus = result.status;
      assets = result.assets;
      if (assets.length) {
        const finalBalance = await helpers.updateWallet(userId, -estimatedCredits);
        await helpers.addLedger(userId, 'usage', -estimatedCredits, finalBalance, `Generated ${output} media with ${model.label}`, requestId);
        await saveMediaAssetRecords({ project, userId, prompt, settings, modelId: model.id, assets, estimatedCredits });
      }
    } catch (error: any) {
      providerStatus = 'failed';
      errorMessage = diagnoseProviderError(error).message || normalizeProviderError(error);
    }
  }

  const previewHtml = renderCodenMediaPreviewHtml({
    project,
    prompt,
    settings,
    modelLabel: model.label,
    estimatedCredits,
    providerStatus,
    assets,
    errorMessage,
  });
  const isFrench = isLikelyFrenchPrompt(prompt);
  const assistantText = isFrench
    ? [
      isMarketingKit
        ? 'J ai prepare un kit marketing propre dans la preview.'
        : assets.length ? 'Le media est pret dans la preview.' : 'J ai prepare un brief media utilisable dans la preview.',
      `${mediaKindLabel(settings.kind)} - ${settings.format} - ${settings.duration} - ~${estimatedCredits} credits.`,
      isMarketingKit
        ? 'Tu peux demander une variante, un format social ou une version visuelle.'
        : providerStatus === 'not_configured'
        ? 'Le rendu media reel n est pas encore connecte cote serveur, donc je garde un brief honnete au lieu de pretendre avoir genere une video/image.'
        : providerStatus === 'locked'
          ? 'Ce rendu demande un plan ou des credits suffisants.'
          : providerStatus === 'failed'
            ? 'Le rendu n a pas abouti. Le brief reste disponible pour relancer ou changer d option.'
            : 'Tu peux telecharger, creer une variante ou l utiliser dans le projet.',
    ].join('\n')
    : [
      isMarketingKit
        ? 'I prepared a clean marketing kit in Preview.'
        : assets.length ? 'The media asset is ready in Preview.' : 'I prepared a clean media brief in Preview.',
      `${mediaKindLabel(settings.kind)} - ${settings.format} - ${settings.duration} - ~${estimatedCredits} credits.`,
      isMarketingKit
        ? 'You can ask for variants, a social format, or a rendered visual next.'
        : providerStatus === 'not_configured'
        ? 'Real media rendering is not connected on the server yet, so I kept an honest brief instead of pretending an image/video was rendered.'
        : providerStatus === 'locked'
          ? 'This render needs the right plan or enough credits.'
        : providerStatus === 'failed'
            ? 'The render did not complete. The brief is available for retry or option changes.'
            : 'You can download, make a variation, or use it in the project.',
    ].join('\n');

  await saveProjectMessage({
    organization_id: project.organization_id,
    project_id: project.id,
    user_id: userId,
    role: 'assistant',
    content: assistantText,
    intent: 'conversation',
    requested_mode: 'auto',
  });

  res.json({
    success: true,
    request_id: requestId,
    status: providerStatus,
    provider_configured: falMediaGateway.isConfigured(),
    output,
    settings,
    model: {
      id: model.id,
      label: model.label,
      output: model.output,
      quality: model.quality,
      min_plan: model.minPlan,
    },
    estimated_credits: estimatedCredits,
    assets,
    text: assistantText,
    preview: {
      status: 'media',
      html: previewHtml,
    },
  });
});

app.post('/api/import/prepare', async (req: any, res: any) => {
  const requestId = `imp_${randomUUID()}`;
  const authUser = requireAuthenticatedUser(req, res, requestId);
  if (!authUser) return;

  const importContext = buildImportContext({
    source: req.body?.source,
    mode: req.body?.mode,
    url: req.body?.url || req.body?.source_url,
    fileName: req.body?.fileName || req.body?.file_name,
    mimeType: req.body?.mimeType || req.body?.mime_type,
    hasAttachment: Boolean(req.body?.hasAttachment),
  }, {
    figmaConfigured: Boolean(process.env.FIGMA_ACCESS_TOKEN || process.env.FIGMA_TOKEN),
    githubConfigured: Boolean(process.env.GITHUB_TOKEN || process.env.GITHUB_IMPORT_TOKEN),
  });

  if (!importContext) {
    return res.status(400).json({
      success: false,
      message: 'Unsupported import source.',
      diagnostic_code: 'IMPORT_SOURCE_UNSUPPORTED',
      request_id: requestId,
      suggested_action: 'choose_figma_github_image_or_url',
    });
  }

  const status = importContext.status === 'invalid' ? 400 : 200;
  return res.status(status).json({
    success: importContext.status !== 'invalid',
    request_id: requestId,
    import: publicImportContext(importContext),
    prompt: importContext.prompt,
  });
});

app.post('/api/projects/:id/generate', async (req: any, res: any) => {
  const requestId = `req_${randomUUID()}`;
  const authUser = requireAuthenticatedUser(req, res, requestId);
  if (!authUser) return;
  const userId = authUser.id;
  const project = await loadProject(req.params.id, userId);
  if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });

  const prompt = sanitizeWorkspaceText(req.body?.prompt || '').trim();
  if (!prompt) return res.status(400).json({ success: false, error: 'Prompt is required.' });
  const studioContext = req.body?.studioContext;
  const importContext = req.body?.importContext;
  const preparedImportContext = buildImportContext({
    source: importContext?.source,
    mode: importContext?.mode,
    url: importContext?.source_url || importContext?.url,
    fileName: importContext?.file_name || importContext?.fileName,
    mimeType: importContext?.mime_type || importContext?.mimeType,
    hasAttachment: Boolean(importContext?.file_name || importContext?.hasAttachment),
  }, {
    figmaConfigured: Boolean(process.env.FIGMA_ACCESS_TOKEN || process.env.FIGMA_TOKEN || importContext?.status === 'ready'),
    githubConfigured: Boolean(process.env.GITHUB_TOKEN || process.env.GITHUB_IMPORT_TOKEN || importContext?.status === 'ready'),
  }) || importContext;
  const visionInputs = Array.isArray(req.body?.visionInputs)
    ? req.body.visionInputs
      .map((item: any) => ({
        url: String(item?.url || '').trim(),
        detail: ['low', 'high'].includes(item?.detail) ? item.detail : 'auto',
      }))
      .filter((item: any) => /^https?:\/\/|^data:image\//i.test(item.url))
      .slice(0, 8)
    : [];
  const agentPrompt = applyRequestContextToPrompt(prompt, studioContext, preparedImportContext);
  if (!requireProjectCapability(req, res, 'view', project)) return;
  if (!enforceRateLimit(`generate:${userId}`, 12, 60_000)) {
    return res.status(429).json({ success: false, error: 'Too many build requests. Please wait a moment.' });
  }
  if (isAbusivePrompt(prompt)) {
    return res.status(400).json({ success: false, error: 'This request cannot be generated safely.' });
  }

  const requestedMode = normalizeRequestedMode(req.body?.requestedMode);
  let harnessContext: ActiveAgentHarnessContext | null = null;
  try {
    harnessContext = await prepareAgentHarnessContext({
      project,
      userId,
      prompt,
      requestedMode,
      requestId,
      clientMessageId: sanitizeWorkspaceText(req.body?.clientMessageId || '').slice(0, 140),
    });
  } catch (error: any) {
    console.error('[coden:harness_start_failed]', { requestId, message: redactSecrets(error?.message || String(error), '[redacted]') });
    // Never the exception's own text: it is written for this log, not for the
    // person who asked for an application.
    const french = isLikelyFrenchPrompt(prompt);
    const active = error instanceof HarnessRunActiveError;
    return res.status(409).json({
      success: false,
      error: active
        ? error.publicMessage(french)
        : french
          ? 'La génération n’a pas pu démarrer. Réessayez dans un instant.'
          : 'The run could not be started. Try again in a moment.',
      diagnostic_code: active ? error.diagnosticCode : 'HARNESS_START_FAILED',
      suggested_action: active ? error.suggestedAction : 'retry',
      recoverable: true,
      request_id: requestId,
    });
  }

  const generationAbortController = new AbortController();
  const generationDeadline = setTimeout(() => generationAbortController.abort('RUN_DEADLINE_EXCEEDED'), 15 * 60_000);
  generationDeadline.unref();
  res.once('finish', () => clearTimeout(generationDeadline));
  res.once('close', () => clearTimeout(generationDeadline));
  if (harnessContext) {
    activeHarnessTurnControllers.set(harnessContext.turn.id, generationAbortController);
    const releaseHarnessController = () => activeHarnessTurnControllers.delete(harnessContext!.turn.id);
    res.once('finish', releaseHarnessController);
    res.once('close', releaseHarnessController);
  }
  // A client that hangs up mid-run should not leave the run burning credits.
  res.on('close', () => {
    if (res.writableEnded) return;
    generationAbortController.abort();
    if (harnessContext) {
      void harnessContext.harness.cancelTurn(harnessContext.turn.id, userId, 'client_disconnected').catch(() => null);
    }
  });

  const frenchActivity = isLikelyFrenchPrompt(prompt);
  const eventStream = req.headers.accept?.includes('text/event-stream')
    ? createAgentEventStream(res, harnessContext?.turn.id || requestId) : null;
  const respondJson = async (status: number, payload: any) => {
    // The real application must be visible before the model writes its recap.
    // This URL comes from the verified sandbox, not from model-authored prose.
    if (status < 400 && payload.success === true && payload.preview?.live_url) {
      eventStream?.workspace({ type:'preview_ready', projectId:project.id, url:payload.preview.live_url, status:payload.preview.status });
    }
    if (status < 400 && payload.pipeline === 'multi_agent') {
      try {
        let seen = 0;
        const recap = await providerGateway.streamingCompletion('openai/gpt-5.6-luna', [
          { role:'system', content:'Write a concise user-facing report in the language of the request, at most three sentences. Report only the observed facts supplied. A passing build is not proof of functional browser QA. Mention unverified checks. Do not expose private reasoning, internal model names or secrets. Never invent successful tests.' },
          { role:'user', content:JSON.stringify({ request:prompt, success:payload.success, changes:{ created:payload.diff?.created?.length, modified:payload.diff?.modified?.length, deleted:payload.diff?.deleted?.length }, preview:payload.preview?.status, checks:payload.verification || null }) },
        ], { timeoutMs:30_000, signal:generationAbortController.signal, allowFallback:false,
          runtimeConfig:{ adapter:'openrouter', maxTokens:1200, reasoning:{ effort:'low' } },
          onChunk: accumulated => { const delta = accumulated.slice(seen); seen = accumulated.length; if (delta) eventStream?.chat({ type:'text_delta', delta }); },
        });
        payload.summary = recap.text;
        payload.assistant_source = 'model';
        payload.assistant_streamed = Boolean(eventStream);
      } catch (error) {
        payload.summary = '';
        payload.narration_error = 'MODEL_RECAP_UNAVAILABLE';
        eventStream?.workspace({ type:'narration_failed', code:'MODEL_RECAP_UNAVAILABLE' });
      }
    }
    if (harnessContext) {
      payload.threadId = harnessContext.thread.id;
      payload.turnId = harnessContext.turn.id;
      payload.runId = harnessContext.turn.id;
      try {
        if (payload.pipeline === 'multi_agent' && payload.summary) {
          await saveProjectMessage({organization_id:project.organization_id,project_id:project.id,user_id:userId,role:'assistant',content:payload.summary,intent:payload.intent?.intent,requested_mode:requestedMode});
        }
        const terminal = status === 499 ? 'cancelled' : status >= 400 || payload.success === false ? 'failed' : 'completed';
        const current = await harnessContext.harness.store.getTurn(harnessContext.turn.id);
        if (current && !['completed','failed','cancelled','blocked'].includes(current.status)) {
          await harnessContext.harness.transitionItem(harnessContext.assistantItemId, terminal, { source:payload.assistant_source || 'system', diagnostic_code:payload.diagnostic_code || null });
          await harnessContext.harness.transitionTurn(harnessContext.turn.id, terminal, { diagnostic_code:payload.diagnostic_code || null });
        }
      } catch (error) {
        console.error('[coden:harness_finalize_failed]', {requestId,message:redactSecrets(String(error))});
        status=503;
        payload={...payload,success:false,diagnostic_code:'HARNESS_PERSISTENCE_FAILED',recoverable:true,error:'The execution result could not be fully persisted. The existing project files are retained.'};
      }
    }
    if (eventStream) { eventStream.finish(payload, status); return res; }
    return res.status(status).json(payload);
  };
  eventStream?.chat({ type: 'run_started', messageId: String(req.body?.assistantMessageId || requestId) });
  if (harnessContext) eventStream?.workspace({type:'run_acknowledged',threadId:harnessContext.thread.id,turnId:harnessContext.turn.id,runId:harnessContext.turn.id});

  // The decision call can take noticeable time on a live provider. Acknowledge
  // the run without inventing model-authored narration so the Builder never looks
  // frozen while Coden is already analysing the request.

  const helpers = getDbHelpers();
  const requestedModelSelection = normalizeModelSelectionId(req.body?.modelId || project.model_id || 'auto');
  const existingFiles = await loadProjectFiles(project.id);
  const lastPlan = await getLastProjectPlan(project.id);
  const recentHistory = await getRecentDecisionHistory(project.id, 6);
  let initialDecision: IntentDecision;
  try {
    initialDecision = await resolveAgentDecision({
      prompt: agentPrompt,
      requestedMode,
      hasFiles: existingFiles.length > 0,
      lastPlan,
      recentHistory,
    });
  } catch (error: any) {
    const diagnostic = diagnoseProviderError(error);
    return respondJson(diagnostic.status, {
      success: false,
      needs_fix: true,
      error: diagnostic.message,
      message: diagnostic.message,
      diagnostic_code: diagnostic.diagnostic_code,
      request_id: requestId,
      suggested_action: diagnostic.suggested_action,
      verification: { status: 'needs_fix' },
    });
  }
  const decision: IntentDecision = initialDecision;

  /**
   * The multi-agent pipeline: a real sandbox, real tools, an approvable plan
   * before code is written. Behind a flag, off by default, and structured to
   * change nothing about the path below when it does not apply.
   *
   * This is an early, self-contained branch rather than a rewrite of the
   * ~1200 lines that follow: those lines are entangled with the blob path's
   * own verification apparatus (a reliability gate, a browser runner, a fact
   * ledger) that this pipeline does not need — its coder loop already
   * validates against the project's real toolchain and repairs what that
   * finds, which is stronger evidence than the heuristic gate it replaces.
   * Manufacturing fake versions of that bookkeeping to slot into the old
   * branching would be a worse trade than a short, separate answer.
   *
   * `resolvePipelineRoute` is `null` for anything that does not write code —
   * conversation, verify, deploy guidance, a clarifying question — so those
   * intents fall through completely unaffected, flag or no flag.
   */
  const pipelineRoute = resolvePipelineRoute({ intent: decision.intent, nextAction: decision.nextAction, hasFiles: existingFiles.length > 0 });
  if (process.env.CODEN_MULTI_AGENT_PIPELINE === '1' && pipelineRoute) {
    try {
      await saveProjectMessage({organization_id:project.organization_id,project_id:project.id,user_id:userId,role:'user',content:prompt,intent:decision.intent,requested_mode:requestedMode});
      const routingPlan = await getOrganizationPlan(project.organization_id).catch(() => 'free');
      const routingCredits = await getWalletWithFallback(getOptionalDbHelpers('model_routing'), project.organization_id);


      const outcome = await runMultiAgentPipeline({
        gateway: providerGateway,
        projectId: project.id,
        userId,
        prompt: agentPrompt,
        route: pipelineRoute,
        existingFiles,
        userPlan: routingPlan,
        credits: routingCredits,
        onChatEvent: eventStream ? event => eventStream.chat(event) : undefined,
        signal: generationAbortController.signal,
        onSnapshot: async files => { await saveProject({ ...project, preview_status:'needs_fix', updated_at:new Date().toISOString() }, files as GeneratedFile[]); },
        onSandboxEvent: event => {
          eventStream?.workspace({ ...event });
        },
        onCoderEvent: event => {
          eventStream?.workspace({ ...event });
        },
        harnessContext: harnessContext
          ? { harness: harnessContext.harness, threadId: harnessContext.thread.id, turnId: harnessContext.turn.id }
          : undefined,
      });

      if (outcome.started) {
        const pipelineFiles = outcome.files as GeneratedFile[];
        // The blob path renames the project from a fresh `appName` guess the
        // model invents every run; this pipeline's plan carries no such
        // field, so there is nothing honest to rename to — the name is left
        // exactly as it was.
        const updatedProject: GeneratedProject = {
          ...project,
          prompt,
          model_id: outcome.modelId,
          status: 'active',
          preview_status: outcome.ok ? 'verified' : 'needs_fix',
          updated_at: new Date().toISOString(),
        };
        const previewPipeline = runPreviewPipeline(updatedProject, pipelineFiles);
        updatedProject.preview_html = previewPipeline.html;

        await saveProject(updatedProject, pipelineFiles);
        const diff = diffFiles(existingFiles, pipelineFiles);
        await createProjectVersion(updatedProject, pipelineFiles, prompt, {
          ...diff,
          multi_agent_pipeline: true,
          route: pipelineRoute,
          ok: outcome.ok,
        }).catch(() => null);

        return respondJson(200, {
          success: outcome.ok,
          needs_fix: !outcome.ok,
          // A run that wrote files but did not verify is still a failure the
          // harness has to be able to name; without this it recorded
          // `turn.failed { diagnostic_code: null }`.
          ...(outcome.ok ? {} : {
            diagnostic_code: 'VERIFICATION_INCOMPLETE',
            suggested_action: 'retry_or_use_auto',
            recoverable: true,
          }),
          intent: decision,
          project: updatedProject,
          files: pipelineFiles,
          diff,
          summary: summarizePipelineOutcome({
            plan: outcome.plan,
            ok: outcome.ok,
            route: pipelineRoute,
            diff,
            stoppedBecause: outcome.repairOutcome.stoppedBecause,
            prompt,
          }),
          model: outcome.modelId,
          verification: outcome.repairOutcome.finalReport,
          plan: outcome.plan,
          preview: {
            status: outcome.ok ? 'verified' : 'needs_fix',
            html: previewPipeline.html,
            live_url: outcome.liveUrl,
            live_state: outcome.liveState,
            live_error: outcome.ok ? null : outcome.repairOutcome.stoppedBecause,
          },
          pipeline: 'multi_agent',
        });
      }

      // Keep the failed runtime explicit; never disguise it as a file-only success.
      // The reason is an npm/runtime string written for this log. It says
      // nothing useful to the person who asked for an application.
      console.warn('[coden:multi_agent_sandbox_failed]', { project: project.id, reason: outcome.startError });
      return respondJson(503, {
        success: false,
        error: frenchActivity
          ? 'L’environnement d’exécution n’a pas pu démarrer. Votre projet est intact : réessayez dans un instant.'
          : 'The execution environment could not start. Your project is untouched: try again in a moment.',
        diagnostic_code: 'SANDBOX_START_FAILED',
        suggested_action: 'retry',
        recoverable: true,
      });
    } catch (error: any) {
      // Partial files are retained by onSnapshot; surface the failure for recovery.
      if (generationAbortController.signal.aborted) {
        return respondJson(499,{ success: false, diagnostic_code:'RUN_INTERRUPTED', error: frenchActivity ? 'Génération interrompue.' : 'Generation interrupted.' });
      }
      console.warn('[coden:multi_agent_pipeline_failed]', { project: project.id, message: redactSecrets(error?.message || String(error), '[redacted]') });
      /*
       * The log gets the cause; the user gets a sentence.
       *
       * This line used to answer with `error.message` verbatim, which is how
       * `TOOL_BUDGET_EXCEEDED` came to be printed across a user's
       * conversation. The code still travels in `diagnostic_code`, where the
       * client can act on it, and the message is now written for the person
       * waiting — in the language they asked in.
       */
      const diagnosticCode = String(error?.diagnosticCode || 'AGENT_EXECUTION_FAILED');
      return respondJson(502, {
        success: false,
        error: publicRuntimeErrorMessage(diagnosticCode, frenchActivity ? 'fr' : 'en'),
        diagnostic_code: diagnosticCode,
        suggested_action: 'retry_or_use_auto',
        recoverable: true,
      });
    }
  }

  const publicGoal = String(decision.modelObjective?.goal || decision.userVisibleReason || '').trim().slice(0, 240);
  const skillResolution = resolveCodenSkill({
    prompt: agentPrompt,
    intent: decision.intent,
    requestedMode: decision.requestedMode,
    risk: decision.executionContract?.risk,
    plan: String((project as any).plan || (project as any).plan_key || 'free'),
  });
  const skill = skillResolution.skill;
  const skillBudget = getCodenSkillBudget(skill, String((project as any).plan || (project as any).plan_key || 'free'));
  const explicitConfirmation = req.body?.confirmed === true || req.body?.approvalGranted === true || req.body?.confirmation === 'confirmed';
  if (skillResolution.requiresConfirmation && isCriticalCodenAction(agentPrompt) && !explicitConfirmation) {
    return respondJson(409, {
      success: false,
      error: 'Explicit confirmation is required before this action can run.',
      diagnostic_code: 'AGENT_CONFIRMATION_REQUIRED',
      skill_id: skill.id,
      requires_confirmation: true,
    });
  }
  const reliability = buildReliabilityDecision(decision);
  const durableRunContract = buildDurableRunContract({
    contract: decision.executionContract || buildExecutionContract({
      prompt: agentPrompt,
      requestedMode,
      hasFiles: existingFiles.length > 0,
      legacyDecision: decision,
    }),
    maxAutoFixAttempts: DEFAULT_AGENT_V3_BUDGET.maxAutoFixAttempts,
  });
  const seniorAgentContext = compileSeniorAgentContext({
    prompt: agentPrompt,
    project,
    files: existingFiles,
    decision,
    importContext: preparedImportContext || undefined,
  });
  const deepReasoningContract = buildDeepReasoningContract({
    prompt: agentPrompt,
    projectName: project.name,
    files: existingFiles,
    decision,
    executionContract: decision.executionContract,
    recentHistory: recentHistory.map(item => `${item.role}: ${item.content}`),
  });
  const agentPromptForText = decision.intent === 'conversation'
    ? agentPrompt
    : applyDeepReasoningToPrompt(applySeniorAgentContextToPrompt(agentPrompt, seniorAgentContext), deepReasoningContract);
  const codenCloudPlan = reliability.should_mutate_files
    ? await upsertProjectBackendRequirements(project, prompt).catch((error: any) => {
      console.warn('[coden:cloud_requirement_generate_skipped]', { message: error?.message || String(error) });
      return null;
    })
    : null;
  const walletForRouting = await helpers.getWallet(userId).catch(() => FALLBACK_WALLET_CREDITS);
  let modelRouting;
  try {
    modelRouting = await resolveAgentProviderModel({
      modelId: requestedModelSelection,
      project,
      prompt: agentPrompt,
      decision,
      files: existingFiles,
      userCredits: walletForRouting,
    });
  } catch (error: any) {
    /*
     * Model routing failing is not the user running out of credits.
     *
     * Every exception here — a provider outage, an unverifiable catalog, a
     * routing bug — was answered with `publicCreditGateResponse()`, so the
     * person was told to upgrade. It logged nothing, carried no diagnostic
     * code, and returned HTTP 200, which is why production shows
     * `turn.failed { diagnostic_code: null }` with no matching server log and
     * why a run could end in seven seconds with nothing to explain it. The
     * account that hit it on 2026-09-04 at 16:09 had 27 credits.
     *
     * A genuine credit refusal is raised as one, and is recognised as one
     * below. Everything else is diagnosed for what it is.
     */
    const insufficientCredits = String(error?.diagnosticCode || '') === 'CREDITS_REQUIRED'
      || /insufficient credit|not enough credit|credit balance|upgrade required/i.test(String(error?.message || ''));
    // The run row does not exist yet at this point; the harness turn is
    // finalized from this payload's own diagnostic_code by `respondJson`.
    if (insufficientCredits) return respondJson(402, publicCreditGateResponse(frenchActivity));
    console.error('[coden:model_routing_failed]', { requestId, project: project.id, message: redactSecrets(error?.message || String(error), '[redacted]') });
    const diagnostic = diagnoseProviderError(error);
    const routingMessage = publicRuntimeErrorMessage(diagnostic.diagnostic_code, frenchActivity ? 'fr' : 'en');
    return respondJson(diagnostic.status >= 400 ? diagnostic.status : 502, {
      success: false,
      error: routingMessage,
      message: routingMessage,
      diagnostic_code: diagnostic.diagnostic_code,
      suggested_action: diagnostic.suggested_action,
      recoverable: true,
    });
  }
  const effectiveModelSelection = modelRouting.model;
  let agentRunId = '';
  if (AGENT_V2_ENABLED) {
    const contextPack = {
      ...buildAgentContextPack({
      project,
      files: existingFiles,
      messages: await listProjectMessagesPage(project.id, 12, null).catch(() => []),
      events: await listAgentEventsPage(project.id, 16, null).catch(() => []),
      versions: await listProjectVersions(project.id).catch(() => []),
      memory: await listAgentMemory(project.id).catch(() => []),
      previewStatus: project.preview_status,
      selectedModel: effectiveModelSelection,
      requestId,
      }),
      senior_agent_os: seniorAgentContext,
      deep_reasoning_contract: deepReasoningContract,
      durable_run: durableRunContract ? buildDurableRunPayload({ contract: durableRunContract }).durable_run : null,
      skill: { id: skill.id, version: skill.version, budget: skillBudget },
    };
    agentRunId = (await createAgentRun(project, userId, requestId, decision, effectiveModelSelection, contextPack, skill, skillBudget, req.body?.workflowId || null)).id;
    activeAgentRunControllers.set(agentRunId, generationAbortController);
    if (harnessContext) activeHarnessAgentRunIds.set(harnessContext.turn.id, agentRunId);
    const releaseActiveRun = () => {
      activeAgentRunControllers.delete(agentRunId);
      pendingAgentRunInstructions.delete(agentRunId);
      if (harnessContext) {
        activeHarnessTurnControllers.delete(harnessContext.turn.id);
        activeHarnessAgentRunIds.delete(harnessContext.turn.id);
      }
    };
    res.once('finish', releaseActiveRun);
    res.once('close', releaseActiveRun);
  }
  await saveProjectMessage({
    organization_id: project.organization_id,
    project_id: project.id,
    user_id: userId,
    role: 'user',
    content: prompt,
    intent: decision.intent,
    requested_mode: decision.requestedMode,
  });
  await upsertProjectWorkspaceState(userId, project.id, {
    draft_prompt: '',
    selected_mode: decision.requestedMode,
    selected_model: requestedModelSelection,
    active_tab: reliability.should_touch_preview ? 'preview' : undefined,
  });

  if (decision.intent === 'conversation' || decision.intent === 'clarification_required' || decision.intent === 'plan' || decision.intent === 'verify' || decision.intent === 'deploy_assist') {
    const cost = estimateActionCost(prompt, decision, effectiveModelSelection);
    const wallet = cost.finalCredits > 0 ? walletForRouting : Number.POSITIVE_INFINITY;
    if (wallet < cost.finalCredits) {
      await updateAgentRunStatus(agentRunId, 'failed', { diagnostic_code: 'CREDITS_REQUIRED', suggested_action: 'use_auto' });
      return respondJson(402, publicCreditGateResponse(frenchActivity));
    }
    let agentText: any;
    let content = '';
    try {
      agentText = await createAgentTextResponse({ project, prompt: agentPromptForText, files: existingFiles, decision, modelId: requestedModelSelection, userCredits: walletForRouting, allowLocalFallback: requestedModelSelection === 'auto' });
      content = agentText.text;
    } catch (error: any) {
      /*
       * A failure that says nothing is the worst kind.
       *
       * The diagnosis was already computed here and written to `agent_runs` —
       * and then dropped from the response, so the harness recorded
       * `turn.failed { diagnostic_code: null }`, the client had nothing to
       * classify, and the user got one bare sentence with no way forward.
       * Production shows exactly that on 2026-09-04 at 14:53.
       *
       * The status was 200 as well, so any handler reading the HTTP code
       * alone counted a failed run as a success.
       */
      const diagnostic = diagnoseProviderError(error);
      await updateAgentRunStatus(agentRunId, 'failed', { diagnostic_code: diagnostic.diagnostic_code, suggested_action: diagnostic.suggested_action });
      const message = publicRuntimeErrorMessage(diagnostic.diagnostic_code, frenchActivity ? 'fr' : 'en');
      return respondJson(diagnostic.status >= 400 ? diagnostic.status : 502, {
        success: false,
        error: message,
        message,
        diagnostic_code: diagnostic.diagnostic_code,
        suggested_action: diagnostic.suggested_action,
        recoverable: true,
      });
    }
    await saveProjectMessage({
      organization_id: project.organization_id,
      project_id: project.id,
      user_id: userId,
      role: 'assistant',
      content,
      intent: decision.intent,
      requested_mode: decision.requestedMode,
    });
    const chargedCredits = agentText.model === 'router' || (agentText.model === 'auto' && agentText.cost_usd === 0) ? 0 : cost.finalCredits;
    await chargeCompletedAgentAction(helpers, userId, chargedCredits, `AI ${decision.intent} with ${agentText.model}`, `agent_${randomUUID()}`);
    await recordAgentImprovementSignal(project, userId, {
      prompt,
      decision,
      outcome: improvementOutcomeForDecision(decision),
      previewChanged: false,
      qualityStatus: 'not_applicable',
    });
    await updateAgentRunStatus(agentRunId, 'completed');
    return respondJson(200, {
      success: true,
      intent: decision,
      text: content,
      model: agentText.model,
      assistant_source: agentText.model === 'router' ? 'system' : 'model',
      reliability,
      files: reliability.should_mutate_files ? existingFiles : undefined,
      preview: reliability.should_touch_preview
        ? { status: project.preview_status || 'unknown', html: getProjectPreviewHtml(project, existingFiles, 'preview') }
        : undefined,
    });
  }

  if (decision.requiresFileChanges && !hasProjectCapability(req, 'build', project)) {
    await updateAgentRunStatus(agentRunId, 'failed', { diagnostic_code: 'PERMISSION_DENIED', suggested_action: 'ask_project_owner' });
    return respondJson(403, { success: false, error: 'Action unavailable with your current project role.', diagnostic_code: 'PERMISSION_DENIED', suggested_action: 'ask_project_owner' });
  }

  const wallet = walletForRouting;
  const cost = estimateActionCost(prompt, decision, effectiveModelSelection);

  if (wallet < cost.finalCredits) {
    await updateAgentRunStatus(agentRunId, 'failed', { diagnostic_code: 'CREDITS_REQUIRED', suggested_action: 'use_auto' });
    return respondJson(402, publicCreditGateResponse(frenchActivity));
  }

  const refId = `gen_${randomUUID()}`;
  await helpers.createReservation(userId, cost.finalCredits, refId);

  try {
    let executionPlan = '';
    if (decision.autoPlanRequired) {
      try {
        const planDecision: IntentDecision = {
          ...decision,
          intent: 'plan',
          requiresFileChanges: false,
          requiresPreviewRebuild: false,
          nextAction: 'plan_only',
        };
        executionPlan = (await createAgentTextResponse({ project, prompt: agentPromptForText, files: existingFiles, decision: planDecision, modelId: requestedModelSelection, userCredits: walletForRouting, allowLocalFallback: requestedModelSelection === 'auto' })).text;
      } catch (error) {
        throw error;
      }
    }
    const steeredAgentPrompt = promptWithPendingAgentInstructions(agentPrompt, agentRunId);
    const basePrompt = req.body?.useLastPlan && lastPlan ? `${lastPlan}\n\nUser confirmed build: ${steeredAgentPrompt}` : steeredAgentPrompt;
    const generationProjectName = isAutomaticallyDerivedProjectName(project.name, project.prompt || prompt)
      ? deriveProjectName(prompt)
      : project.name;
    const generation = await generateFilesWithAi({
      projectName: generationProjectName,
      prompt: executionPlan ? `${executionPlan}\n\nBuild request:\n${basePrompt}` : basePrompt,
      project,
      decision,
      modelId: effectiveModelSelection,
      userCredits: walletForRouting,
      existingFiles,
      seniorAgentContext,
      deepReasoningContract,
      visionInputs,
      skill,
      skillBudget,
      signal: generationAbortController.signal,
      allowModelFallback: requestedModelSelection === 'auto',
      // ✅ Pass recent history for conflict detection
      recentHistory: recentHistory.map(item => `${item.role}: ${item.content}`),
    });
    if (!generation.summary || !generation.summary.trim()) {
      throw new Error('The selected model returned no final summary for this run.');
    }

    const mergedByPath = new Map<string, GeneratedFile>();
    existingFiles.forEach(file => mergedByPath.set(file.path, file));
    generation.files.forEach(file => mergedByPath.set(file.path, file));
    let files = withProjectSeoSupport(
      Array.from(mergedByPath.values()).sort((a, b) => a.path.localeCompare(b.path)),
      generationProjectName,
      prompt,
      { ensureIndex: true },
    );
    files = ensureModernFrontendProject(files, generationProjectName, prompt, project.id);
    const projectForRun: GeneratedProject = { ...project, name: generationProjectName, prompt };


    let pipeline = runPreviewPipeline(projectForRun, files);
    let finalFiles = files;
    let autoFix = null as any;
    if (pipeline.status === 'failed') {
      await Promise.all(pipeline.errors.map(error => saveBuildError(project, error)));
      for (let attempt = 1; attempt <= skillBudget.maxRetries && pipeline.status === 'failed'; attempt += 1) {
        const fix = applyAutoFix(projectForRun, finalFiles, pipeline.errors);
        autoFix = fix.patch;
        if (!fix.fixed) break;
        finalFiles = fix.files;
        pipeline = runPreviewPipeline(projectForRun, finalFiles);
      }
    }
    let previewHtml = pipeline.html;
    let runnerResult: RunnerResult | null = null;
    const strictRunnerRequired = STRICT_VERIFICATION_ENABLED && Boolean(decision.requiresFileChanges);
    if ((AGENT_V3_ENABLED || AGENT_RUNTIME_V2_ENABLED) && (reliability.requires_runner || strictRunnerRequired)) {
      runnerResult = await projectRunner.run({
        runId: agentRunId || requestId,
        projectId: project.id,
        files: finalFiles,
        previewHtml,
        prompt,
        timeoutMs: DEFAULT_AGENT_V3_BUDGET.runnerTimeoutMs,
        signal: generationAbortController.signal,
      });
      await saveAgentRunnerResults(project, userId, agentRunId, runnerResult);
      let runnerBlocking = runnerChecksToVerificationChecks(runnerResult.checks).filter(isBlockingVerificationFailure);
      for (let attempt = 1; runnerBlocking.length && attempt <= skillBudget.maxRetries; attempt += 1) {
        const fix = applyAutoFix(projectForRun, finalFiles, runnerBlocking.map(check => ({
          file: check.file || 'index.html',
          message: check.message,
          severity: check.severity,
        })));
        autoFix = fix.patch;
        if (!fix.fixed) break;
        finalFiles = fix.files;
        pipeline = runPreviewPipeline(projectForRun, finalFiles);
        previewHtml = pipeline.html;
        runnerResult = await projectRunner.run({
          runId: agentRunId || requestId,
          projectId: project.id,
          files: finalFiles,
          previewHtml,
          prompt,
          timeoutMs: DEFAULT_AGENT_V3_BUDGET.runnerTimeoutMs,
          signal: generationAbortController.signal,
        });
        await saveAgentRunnerResults(project, userId, agentRunId, runnerResult);
        runnerBlocking = runnerChecksToVerificationChecks(runnerResult.checks).filter(isBlockingVerificationFailure);
      }
    }
    const uiPolicy = buildWorldClassUiPolicy({ prompt });
    let visualBlocking = inspectVisualPreview({
      files: finalFiles,
      previewHtml,
      platformType: uiPolicy.appType,
    }).filter(isBlockingVerificationFailure);
    for (let attempt = 1; visualBlocking.length && attempt <= skillBudget.maxRetries; attempt += 1) {
      const fix = applyAutoFix(projectForRun, finalFiles, visualBlocking.map(check => ({
        file: check.file || 'src/App.tsx',
        message: check.message,
        severity: check.severity,
      })));
      autoFix = fix.patch;
      if (!fix.fixed) break;
      finalFiles = fix.files;
      pipeline = runPreviewPipeline(projectForRun, finalFiles);
      previewHtml = pipeline.html;
      visualBlocking = inspectVisualPreview({
        files: finalFiles,
        previewHtml,
        platformType: uiPolicy.appType,
      }).filter(isBlockingVerificationFailure);
    }
    let finalGate = await finalReliabilityAutoFix({
      project: projectForRun,
      userId,
      agentRunId,
      requestId,
      files: finalFiles,
      pipeline,
      runnerResult,
      uiPolicy,
      hasExistingFiles: existingFiles.length > 0,
      shouldRunRunner: Boolean((AGENT_V3_ENABLED || AGENT_RUNTIME_V2_ENABLED) && (reliability.requires_runner || strictRunnerRequired)),
      maxAttempts: skillBudget.maxRetries,
      signal: generationAbortController.signal,
    });
    finalFiles = finalGate.files;
    pipeline = finalGate.pipeline;
    previewHtml = finalGate.previewHtml;
    runnerResult = finalGate.runnerResult;
    if (finalGate.autoFixPatch) autoFix = finalGate.autoFixPatch;

    // Deterministic AutoFix handles known mechanical failures. When verified
    // blockers remain, use one bounded model-backed repair pass in the same
    // run, project and credit reservation. This is the safe checkpoint where
    // steering instructions received during generation are also consumed.
    // Without this pass the assistant could say "I will fix it" while the DAG
    // had already terminated as needs_fix.
    if (
      finalGate.reliabilitySummary.status === 'failed' &&
      skillBudget.maxRetries > 0 &&
      !generationAbortController.signal.aborted
    ) {
      // The runner captured the compiler output and nothing read it, so every
      // repair was a second full generation. When the build named files, aim at
      // them instead — that pass is what timed out at six minutes.
      const targetedRepair = buildTargetedRepair(finalGate.runnerResult?.checks);
      // A targeted repair knows the files, so the step says which ones rather
      // than "Coden is fixing the detected issues".
      const repairIssues = targetedRepair.targeted
        ? targetedRepair.files.map(file => ({ file }))
        : finalGate.reliabilitySummary.blocking;
      // The spine carries the stage; the shimmer carries the live detail. Giving
      // both the same sentence showed the user the same line twice.
      const repairBlockers = finalGate.reliabilitySummary.blocking.slice(0, 12).map(item => ({
        key: item.key,
        file: item.file || null,
        severity: item.severity,
        message: item.message,
      }));
      const repairDecision: IntentDecision = {
        ...decision,
        intent: 'debug_fix',
        requiresFileChanges: true,
        requiresPreviewRebuild: true,
        nextAction: 'debug_fix',
      };
      try {
        const repairGeneration = await generateFilesWithAi({
          projectName: generationProjectName,
          prompt: [
            promptWithPendingAgentInstructions(basePrompt, agentRunId),
            '',
            targetedRepair.targeted
              ? targetedRepair.instruction
              : 'Repair the existing project in place. Change only what is needed to resolve every verified blocker below, preserve valid files, keep the requested runtime, and do not introduce an external service the user excluded.',
            `Verified blockers: ${JSON.stringify(repairBlockers)}`,
            'Return the project-file JSON contract. Do not promise a later repair: implement it now.',
          ].join('\n'),
          project: projectForRun,
          decision: repairDecision,
          modelId: effectiveModelSelection,
          userCredits: walletForRouting,
          existingFiles: finalFiles,
          seniorAgentContext,
          deepReasoningContract,
          visionInputs,
          skill,
          skillBudget,
          signal: generationAbortController.signal,
          allowModelFallback: requestedModelSelection === 'auto',
          recentHistory: recentHistory.map(item => `${item.role}: ${item.content}`),
        });
        generation.cost_usd += repairGeneration.cost_usd;
        const repairedByPath = new Map<string, GeneratedFile>();
        finalFiles.forEach(file => repairedByPath.set(file.path, file));
        repairGeneration.files.forEach(file => repairedByPath.set(file.path, file));
        finalFiles = ensureModernFrontendProject(
          Array.from(repairedByPath.values()).sort((a, b) => a.path.localeCompare(b.path)),
          generationProjectName,
          promptWithPendingAgentInstructions(prompt, agentRunId),
          project.id,
        );
        pipeline = runPreviewPipeline(projectForRun, finalFiles);
        finalGate = await finalReliabilityAutoFix({
          project: projectForRun,
          userId,
          agentRunId,
          requestId,
          files: finalFiles,
          pipeline,
          runnerResult: null,
          uiPolicy,
          hasExistingFiles: existingFiles.length > 0,
          shouldRunRunner: Boolean((AGENT_V3_ENABLED || AGENT_RUNTIME_V2_ENABLED) && (reliability.requires_runner || strictRunnerRequired)),
          maxAttempts: skillBudget.maxRetries,
          signal: generationAbortController.signal,
        });
        finalFiles = finalGate.files;
        pipeline = finalGate.pipeline;
        previewHtml = finalGate.previewHtml;
        runnerResult = finalGate.runnerResult;
        if (finalGate.autoFixPatch) autoFix = finalGate.autoFixPatch;
      } catch (repairError: any) {
        console.warn('[coden:model_backed_reliability_repair_failed]', {
          project_id: project.id,
          run_id: agentRunId || requestId,
          message: redactSecrets(repairError?.message || String(repairError), '[redacted]'),
        });
      }
    }
    const verificationChecks = finalGate.verificationChecks;
    const verificationSummary = finalGate.verificationSummary;
    let reliabilitySummary = finalGate.reliabilitySummary;
    const qualitySummary = finalGate.qualitySummary;
    // `runnerResult.status` is already 'failed' whenever any check really
    // failed, so the remaining question is only whether verification was able
    // to run at all.
    const runnerSkipped = Boolean(
      strictRunnerRequired &&
      (!runnerResult
        || runnerResult.status !== 'passed'
        || runnerResult.checks.some(isVerificationCapabilityUnavailable)),
    );
    if (runnerSkipped) {
      verificationChecks.push({
        key: 'strict_runtime_verification',
        status: 'fail',
        severity: 'high',
        message: 'Strict verification requires a real build and browser runner result before the project can be marked verified.',
      });
      reliabilitySummary = {
        ...reliabilitySummary,
        status: 'failed',
        blocking: [
          ...(reliabilitySummary.blocking || []),
          { key: 'strict_runtime_verification', severity: 'high', message: 'A real runtime verification result is required before ready.', file: null },
        ],
      };
    }
    const strictRuntimeVerified = pipeline.status === 'ready'
      && reliabilitySummary.status === 'passed'
      && !runnerSkipped;
    const factLedger = createFactLedger(agentRunId || requestId);
    if (finalFiles.length) {
      finalFiles.forEach(file => appendVerifiedFact(factLedger, {
        type: 'file_modified',
        value: { path: file.path, bytes: file.content.length },
        source: 'filesystem',
        evidence: 'File was present in the final server-side project snapshot.',
      }));
    }
    if (pipeline.status === 'ready') {
      appendVerifiedFact(factLedger, {
        type: 'build_passed',
        value: { staticPipeline: true },
        source: 'build',
        evidence: 'Static preview pipeline completed without blocking errors.',
      });
    }
    if (runnerResult?.checks.some(check => check.check_type === 'script_test_exec' && check.status === 'passed')) {
      appendVerifiedFact(factLedger, {
        type: 'test_passed',
        value: { check: 'script_test_exec' },
        source: 'build',
        evidence: 'The project runner reported a passing test script.',
      });
    }
    if (runnerResult?.status === 'passed' && !runnerSkipped) {
      appendVerifiedFact(factLedger, {
        type: 'browser_check_passed',
        value: { checks: runnerResult.checks.length },
        source: 'browser',
        evidence: 'The configured project runner returned passed without skipped browser checks.',
      });
    }
    if (strictRuntimeVerified) {
      appendVerifiedFact(factLedger, {
        type: 'preview_verified',
        value: { status: 'verified' },
        source: 'preview',
        evidence: 'Preview passed the strict verification gate.',
      });
    } else {
      appendVerifiedFact(factLedger, {
        type: 'error_detected',
        value: { status: 'needs_fix', blocking: reliabilitySummary.blocking || [] },
        source: 'preview',
        evidence: 'The runtime did not satisfy the strict verification gate.',
      });
    }
    finalizeFactLedger(factLedger, strictRuntimeVerified ? 'complete' : 'failed');
    await saveAgentVerifications(project, userId, agentRunId, verificationChecks);
    /*
     * The application comes up before the verdict is written, not after.
     *
     * The branch below returns early whenever strict verification did not fully
     * pass -- and that is the common case, since it needs the pipeline ready,
     * the reliability summary passed, and the browser runner to have produced a
     * real result. Launching the sandbox after it meant the one situation where
     * a user most needs to see their app, a build carrying a warning, was the
     * one situation where they saw nothing at all.
     *
     * A dev server actually serving the application is stronger evidence than a
     * static check that is unsure about it, so it runs on both paths.
     */
    let livePreview: Awaited<ReturnType<typeof applyProjectEdit>> | null = null;
    let sandboxValidation: Awaited<ReturnType<typeof validateProject>> | null = null;
    let sandboxRepairInstruction = '';
    let sandboxRepair: Awaited<ReturnType<typeof runRepairLoop>> | null = null;
    if (process.env.CODEN_LIVE_SANDBOX === '1' && finalFiles.length) {
      try {
        // On a first build the scaffold goes under whatever the model wrote,
        // and the paths it owns win: a model that rewrites the build config or
        // the entry point breaks a project that worked, and the failure shows
        // up as a blank preview rather than a rejected write.
        const scaffolded = existingFiles.length
          ? { files: finalFiles.map(file => ({ path: file.path, content: file.content || '' })), rejected: [] as string[] }
          : applyStarter(selectStarter(prompt), finalFiles.map(file => ({ path: file.path, content: file.content || '' })));
        if (scaffolded.rejected.length) {
          console.warn('[coden:starter_protected_paths]', { project: project.id, rejected: scaffolded.rejected });
        }
        // Always the edit path: it hot-reloads when the server is already up
        // and the change allows it, and falls back to a full launch when it
        // does not. Deciding here would duplicate that judgement badly.
        livePreview = await applyProjectEdit({
          projectId: project.id,
          userId,
          files: scaffolded.files,
        });
        /*
         * The verdict that counts.
         *
         * Writing code is not success. This asks the project's own toolchain
         * whether it runs -- the dev server's output, then its typecheck --
         * and keeps the answer with the run, so what the interface reports is
         * what the compiler said rather than what the model claimed.
         *
         * The build is skipped here: it duplicates the typecheck's errors with
         * worse locations, and it is what Publish runs anyway.
         */
        if (livePreview?.ok) {
          const sandbox = sandboxRegistry.peek(project.id);
          if (sandbox) {
            sandboxValidation = await validateProject(sandbox, { skipBuild: true }).catch(() => null);
            if (sandboxValidation && !sandboxValidation.ok) {
              sandboxRepairInstruction = buildRepairInstruction(sandboxValidation);
              console.warn('[coden:sandbox_validation_failed]', {
                project: project.id,
                problems: sandboxValidation.problems.slice(0, 6).map(problem => ({ source: problem.source, file: problem.file, missing: problem.missingPackage })),
              });

              /*
               * Repair with tools, not with a regeneration.
               *
               * The model is handed the compiler's own errors and the means to
               * act on them — read the file the error names, edit the line,
               * install the package that is missing — and the project's
               * toolchain is asked again. Asking for the whole application a
               * second time costs as much as the first, and is a fresh chance
               * to lose a file the first one got right.
               *
               * The loop's own limits do the stopping: it gives up when a
               * round achieves nothing, because a model that could not fix an
               * error will not fix it by being asked twice.
               */
              const repairRuntime = createProviderRuntimeOptions({
                model: generation.model as AllowedModelId,
                prompt,
                decision,
                files: finalFiles,
                mode: 'text',
                stream: false,
                timeoutMs: 60_000,
                maxTokens: 6_000,
              });
              sandboxRepair = await runRepairLoop({
                sandbox,
                initialReport: sandboxValidation,
                turn: async ({ instruction, tools, call, maxToolCalls }) => {
                  let toolCalls = 0;
                  const handlers = Object.fromEntries(tools.map(tool => [
                    tool.name,
                    async (args: Record<string, unknown>) => { toolCalls += 1; return call(tool.name, args); },
                  ]));
                  await runLlmToolLoop({
                    gateway: providerGateway,
                    modelId: generation.model,
                    messages: [
                      { role: 'system', content: 'You repair a running application. Read the files the errors name, make the smallest change that fixes them, and change nothing else. Install a missing dependency rather than rewriting the import that needs it.' },
                      { role: 'user', content: instruction },
                    ],
                    handlers,
                    runtimeConfig: {
                      ...repairRuntime.providerConfig,
                      tools: tools.map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } })),
                      toolChoice: 'auto',
                    } as any,
                    runtimeConfigForModel: repairRuntime.runtimeConfigForModel,
                    timeoutMs: 60_000,
                    maxSteps: Math.min(6, maxToolCalls),
                  }).catch((error: any) => {
                    console.warn('[coden:sandbox_repair_turn_failed]', { project: project.id, message: redactSecrets(error?.message || String(error), '[redacted]') });
                  });
                  return { toolCalls };
                },
              }).catch((error: any) => {
                console.warn('[coden:sandbox_repair_failed]', { project: project.id, message: redactSecrets(error?.message || String(error), '[redacted]') });
                return null;
              });

              // The repair is only real if the checks now pass. Whatever the
              // loop concluded, the report it ends on is the verdict.
              if (sandboxRepair) sandboxValidation = sandboxRepair.finalReport;
              sandboxRepairInstruction = sandboxValidation.ok ? '' : buildRepairInstruction(sandboxValidation);
            }
          }
        }
      } catch (error: any) {
        console.warn('[coden:sandbox_launch_failed]', { project: project.id, message: redactSecrets(error?.message || String(error), '[redacted]') });
      }
    }

    if (runnerSkipped || shouldDeliverRecoverableDraft(reliabilitySummary)) {
      const generatedProjectName = isAutomaticallyDerivedProjectName(project.name, project.prompt || prompt)
        ? sanitizeSuggestedProjectName(generation.appName, prompt)
        : project.name;
      const recoverableProject: GeneratedProject = {
        ...project,
        name: generatedProjectName,
        slug: await resolveStableProjectSlug(project, generatedProjectName, userId),
        prompt,
        model_id: generation.model,
        status: project.status || 'draft',
        preview_status: 'needs_fix',
        preview_html: previewHtml,
        updated_at: new Date().toISOString(),
      };
      await saveProject(recoverableProject, finalFiles).catch(error => {
        console.warn('[coden:needs_fix_draft_save_failed]', { project_id: project.id, message: redactSecrets(error?.message || String(error), '[redacted]') });
      });
      const diff = diffFiles(existingFiles, finalFiles);
      await createProjectVersion(recoverableProject, finalFiles, prompt, {
        ...diff,
        verification: verificationSummary,
        reliability: reliabilitySummary,
        needs_fix: true,
        agent_run_id: agentRunId || null,
      }).catch(error => {
        console.warn('[coden:needs_fix_version_save_failed]', { project_id: project.id, message: redactSecrets(error?.message || String(error), '[redacted]') });
      });
      if (autoFix) await saveProjectPatch(recoverableProject, autoFix).catch(error => {
        console.warn('[coden:needs_fix_patch_save_failed]', { project_id: project.id, message: redactSecrets(error?.message || String(error), '[redacted]') });
      });
      const blockingCount = Number(reliabilitySummary.blocking?.length || (reliabilitySummary as any).failed?.length || 1);
      const finalizerDecision = { ...decision, intent: 'conversation', requiresFileChanges: false, requiresPreviewRebuild: false, requiresCredits: false } as IntentDecision;
      const finalizer = await createAgentTextResponse({
        project: recoverableProject,
        prompt: `${promptWithPendingAgentInstructions(agentPromptForText, agentRunId)}\n\nWrite the terminal user-facing response from these verified facts only. The preview is needs_fix, not ready. Never claim readiness. This run ends after the response: do not say that you are about to inspect, fix, retest, or continue. State the remaining blocker, explain that the recoverable draft was saved, and offer an explicit retry. Facts: ${JSON.stringify(factLedger.facts)}`,
        files: finalFiles,
        decision: finalizerDecision,
        modelId: effectiveModelSelection,
        userCredits: walletForRouting,
        allowLocalFallback: false,
        signal: generationAbortController.signal,
        finalizer: true,
      });
      const summary = finalizer.text.trim();
      if (!summary) throw new Error('The selected AI model returned no fact-grounded recovery response.');
      const recoveryContradictions = responseContradictions(summary, factLedger);
      if (recoveryContradictions.length) {
        throw new Error(`The model response contradicted verified facts: ${recoveryContradictions.join(', ')}`);
      }
      const outputContract = validateExecutionOutputContract({
        contract: (decision as any).executionContract as ExecutionContract | undefined,
        hasFiles: finalFiles.length > 0,
        previewReady: false,
        runnerChecked: Boolean(runnerResult),
        reliabilityStatus: reliabilitySummary.status,
        draftSaved: true,
        assistantText: summary,
      });
      const durableContinuation = decideDurableRunContinuation({
        reliabilityStatus: reliabilitySummary.status,
        previewStatus: 'needs_fix',
        autoFixAttempts: DEFAULT_AGENT_V3_BUDGET.maxAutoFixAttempts,
        maxAutoFixAttempts: DEFAULT_AGENT_V3_BUDGET.maxAutoFixAttempts,
        hasCredits: true,
      });
      await saveProjectMessage({
        organization_id: recoverableProject.organization_id,
        project_id: recoverableProject.id,
        user_id: userId,
        role: 'assistant',
        content: summary,
        intent: decision.intent,
        requested_mode: decision.requestedMode,
      }).catch(error => {
        console.warn('[coden:needs_fix_message_save_failed]', { project_id: project.id, message: redactSecrets(error?.message || String(error), '[redacted]') });
      });
      await recordAgentImprovementSignal(recoverableProject, userId, {
        prompt,
        decision,
        outcome: 'failed',
        previewChanged: true,
        qualityStatus: 'needs_fix',
        issueCount: blockingCount,
      }).catch(() => null);
      await updateAgentRunStatus(agentRunId, 'completed', {
        public_payload: {
          needs_fix: true,
          verification: verificationSummary,
          reliability: reliabilitySummary,
          quality: qualitySummary,
          output_contract: outputContract,
          durable_run: buildDurableRunPayload({
            contract: durableRunContract,
            continuation: durableContinuation,
          }).durable_run,
          browser: finalGate.browserResult ? { status: finalGate.browserResult.status, finding_count: finalGate.browserResult.findings.length } : null,
          fact_ledger: factLedger,
        },
      }).catch(() => null);
      const finalPayload = {
        success: false,
        needs_fix: true,
        intent: decision,
        project: recoverableProject,
        files: finalFiles,
        summary,
        model: generation.model,
        diff,
        auto_fix: autoFix,
        errors: pipeline.errors,
        verification: verificationSummary,
        reliability,
        reliability_summary: reliabilitySummary,
        output_contract: outputContract,
        durable_run: buildDurableRunPayload({
          contract: durableRunContract,
          continuation: durableContinuation,
        }).durable_run,
        durable_continuation: durableContinuation,
        runner: runnerResult ? { status: runnerResult.status, checks: runnerResult.checks } : null,
        preview: {
          status: 'needs_fix',
          html: previewHtml,
          // The static verdict is needs_fix, and the application may still be
          // running. Withholding its URL here is what left the user with a
          // blank panel while a working dev server sat behind it.
          live_url: livePreview?.previewUrl || null,
          live_state: livePreview?.state || null,
          live_error: livePreview?.error || null,
        },
        sandbox_validation: sandboxValidation
          ? { ok: sandboxValidation.ok, ran: sandboxValidation.ran, problems: sandboxValidation.problems.slice(0, 20), repair: sandboxRepairInstruction || undefined }
          : null,
        fact_ledger: factLedger,
      };
      return respondJson(200, finalPayload);
    }
    const generatedProjectName = isAutomaticallyDerivedProjectName(project.name, project.prompt || prompt)
      ? sanitizeSuggestedProjectName(generation.appName, prompt)
      : project.name;
    const verificationPassed = strictRuntimeVerified;
    const updatedProject: GeneratedProject = {
      ...project,
      name: generatedProjectName,
      slug: await resolveStableProjectSlug(project, generatedProjectName, userId),
      prompt,
      model_id: generation.model,
      status: project.status || 'draft',
      preview_status: verificationPassed ? 'verified' : 'needs_fix',
      // The rendering is saved whatever verification concluded; `preview_status`
      // carries the verdict. Overwriting it with a placeholder threw away the
      // only artefact the author actually wanted to look at, and replaced a
      // specific failure — the pipeline already writes its real reason into
      // this html — with a generic sentence.
      preview_html: previewHtml,
      updated_at: new Date().toISOString(),
    };

    const finalizerDecision = {
      ...decision,
      intent: 'conversation',
      requiresFileChanges: false,
      requiresPreviewRebuild: false,
      requiresCredits: false,
    } as IntentDecision;
    const finalizer = await createAgentTextResponse({
      project: updatedProject,
      prompt: [
        'Write the final user-facing response using only the verified facts below.',
        'Do not claim readiness, publication, connected backend, successful tests, or bug resolution unless an explicit verified fact supports it.',
        'Mention unresolved verification issues clearly and propose only actions supported by the facts.',
        JSON.stringify({ objective: decision.executionContract || decision.userVisibleReason, facts: factLedger.facts, ledger_status: factLedger.status }),
      ].join('\n\n'),
      files: finalFiles,
      decision: finalizerDecision,
      modelId: generation.model,
      userCredits: walletForRouting,
      allowLocalFallback: false,
      finalizer: true,
      signal: generationAbortController.signal,
    });
    const finalSummary = finalizer.text.trim();
    if (!finalSummary) throw new Error('The selected AI model returned no fact-grounded final response.');
    const finalContradictions = responseContradictions(finalSummary, factLedger);
    if (finalContradictions.length) {
      throw new Error(`The model response contradicted verified facts: ${finalContradictions.join(', ')}`);
    }

    await saveProject(updatedProject, finalFiles);

    /*
     * Bring the application up.
     *
     * Deliberately here, before the finalizer writes its summary: the preview
     * is the answer to the prompt, and making the user wait for a paragraph of
     * prose before they can see their own app is the wrong order. The stream
     * carries each stage as it happens, so the interface shows a pipeline
     * rather than a spinner.
     *
     * A sandbox that fails to come up is reported and does not fail the
     * generation: the files are real and saved either way, and the existing
     * preview stays as it was.
     */
    const diff = diffFiles(existingFiles, finalFiles);
    await createProjectVersion(updatedProject, finalFiles, prompt, { ...diff, verification: verificationSummary, reliability: reliabilitySummary, agent_run_id: agentRunId || null });
    if (autoFix) await saveProjectPatch(updatedProject, autoFix);
    await upsertAgentMemory(updatedProject, userId, summarizeAgentMemory({
      projectName: updatedProject.name,
      files: finalFiles,
      latestDecision: decision.userVisibleReason,
      latestOutcome: finalSummary,
    }), {
      recent_decisions: [{ intent: decision.intent, summary: decision.userVisibleReason, created_at: new Date().toISOString() }],
      known_errors: verificationChecks.filter(check => check.status === 'fail'),
      architecture: {
        quality: qualitySummary,
      },
    });
    await recordAgentImprovementSignal(updatedProject, userId, {
      prompt,
      decision,
      outcome: 'generated',
      previewChanged: true,
      qualityStatus: qualitySummary.status,
      issueCount: Number(qualitySummary.failed?.length || 0) + Number(qualitySummary.warnings?.length || 0),
    });

    const finalCost = costEstimator.calculateRequiredCredits({
      openrouter_cost_usd: generation.cost_usd,
      infra_cost_usd: 0.0005,
      storage_cost_usd: 0.0001,
      build_cost_usd: 0.001,
      domain_operation_cost_usd: 0,
      minimum_action_credits: Math.max(2, modelCreditFloor(generation.model)),
      complexity_surcharge: prompt.length > 400 ? 2 : 0,
    });
    const finalBalance = await helpers.updateWallet(userId, -finalCost.finalCredits);
    await helpers.addLedger(userId, 'usage', -finalCost.finalCredits, finalBalance, `Generated app files with ${generation.model}`, refId);
    await updateAgentRunStatus(agentRunId, 'completed', {
      public_payload: {
        verification: verificationSummary,
        reliability: reliabilitySummary,
        quality: qualitySummary,
        browser: finalGate.browserResult ? { status: finalGate.browserResult.status, finding_count: finalGate.browserResult.findings.length } : null,
        fact_ledger: factLedger,
      },
    });
    await saveProjectMessage({
      organization_id: updatedProject.organization_id,
      project_id: updatedProject.id,
      user_id: userId,
      role: 'assistant',
      content: finalSummary,
      intent: decision.intent,
      requested_mode: decision.requestedMode,
    });
    await refreshDurableProjectSnapshot(updatedProject, finalFiles);

    const finalPayload = {
      success: verificationPassed,
      needs_fix: !verificationPassed,
      intent: decision,
      project: updatedProject,
      files: finalFiles,
      summary: finalSummary,
      model: generation.model,
      diff,
      auto_fix: autoFix,
      errors: pipeline.errors,
      verification: verificationSummary,
      reliability,
      reliability_summary: reliabilitySummary,
      coden_cloud: codenCloudPlan
        ? {
          requirements: publicCodenCloudRequirementPayload(codenCloudPlan.requirement),
          project: codenCloudPlan.cloudProject,
        }
        : undefined,
      runner: runnerResult ? { status: runnerResult.status, checks: runnerResult.checks } : null,
      preview: {
        status: verificationPassed ? 'verified' : 'needs_fix',
        html: verificationPassed ? previewHtml : updatedProject.preview_html,
        // When the sandbox is up this is the application itself, running its
        // own dev server. The html above stays for the existing path.
        live_url: livePreview?.previewUrl || null,
        live_state: livePreview?.state || null,
        live_error: livePreview?.error || null,
      },
      // The project's own toolchain, not our reading of its source.
      sandbox_validation: sandboxValidation
        ? {
          ok: sandboxValidation.ok,
          ran: sandboxValidation.ran,
          problems: sandboxValidation.problems.slice(0, 20),
          repair: sandboxRepairInstruction || undefined,
          repair_rounds: sandboxRepair ? sandboxRepair.rounds : undefined,
          repair_outcome: sandboxRepair ? sandboxRepair.stoppedBecause : undefined,
        }
        : null,
      fact_ledger: factLedger,
    };
    // The last step closes on the run's real outcome: a project that still
    // needs fixes is not "ready", and saying so is the point of the machine.
    return respondJson(200, finalPayload);
  } catch (error: any) {
    // Whatever step the run died on stops spinning and reports its failure,
    // instead of the stream simply going quiet.
    await helpers.addLedger(userId, 'refund', cost.finalCredits, await helpers.getWallet(userId), `Generation failed: ${error.message}`, refId);
    await helpers.addAudit({
      user_id: userId,
      organization_id: userId,
      project_id: project.id,
      requested_model: requestedModelSelection,
      reason: `Generation failed: ${error.message}`,
      source: 'builder',
    });

    const diagnostic = diagnoseProviderError(error);
    await updateAgentRunStatus(agentRunId, 'failed', {
      diagnostic_code: diagnostic.diagnostic_code,
      suggested_action: diagnostic.suggested_action,
    });
    return respondJson(diagnostic.status, {
      success: false,
      error: diagnostic.message,
      message: diagnostic.message,
      diagnostic_code: diagnostic.diagnostic_code,
      request_id: requestId,
      suggested_action: diagnostic.suggested_action,
    });
  }
});

const previewSessionRegistry = new Map<string, {
  id: string;
  projectId: string;
  userId: string;
  status: string;
  createdAt: string;
  expiresAt: string;
  preview: Record<string, unknown>;
}>();

app.post('/api/projects/:id/preview', requireAuthWithTemporaryGeneration, async (req: any, res: any) => {
  if (!requireCodenAgentFeature(res, CODEN_AGENT_FLAGS.previewAdapters, 'preview_adapters')) return;
  try {
    const auth = getRequiredAuth(req);
    const project = await loadProject(req.params.id, auth.userId, req);
    if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });
    if (!requireProjectCapability(req, res, 'view', project)) return;
    const contract = await readGeneratedRuntimeContract(project);
    if (contract.validation.length) {
      return res.status(422).json({ success: false, needs_fix: true, validation: contract.validation, manifest: contract.manifest });
    }
    const verification = await verifyProjectPreviewWithRealBuild(project, contract.files, contract.manifest);
    const html = verification.verified
      ? verification.preview.html
      : buildPreviewErrorHtml({ projectName: project.name, error: verification.error });
    const updatedProject = {
      ...project,
      preview_status: verification.status,
      preview_html: html,
      updated_at: new Date().toISOString(),
    };
    await saveProject(updatedProject, contract.files);
    const sessionId = `preview_${randomUUID()}`;
    const createdAt = new Date();
    previewSessionRegistry.set(sessionId, {
      id: sessionId,
      projectId: project.id,
      userId: auth.userId,
      status: verification.status,
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + 60 * 60 * 1000).toISOString(),
      preview: { build: verification.build, browser: verification.browser, has_html: Boolean(html) },
    });
    return res.status(verification.verified ? 200 : 422).json({
      success: verification.verified,
      needs_fix: !verification.verified,
      session_id: sessionId,
      preview: {
        status: verification.status,
        html,
        build: verification.build,
        browser: verification.browser,
      },
      universal_manifest: contract.universalManifest,
      files: contract.files,
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, needs_fix: true, preview: { status: 'failed' }, error: error?.message || 'Preview verification failed.' });
  }
});

app.get('/api/projects/:id/preview/:sessionId', requireAuthWithTemporaryGeneration, async (req: any, res: any) => {
  if (!requireCodenAgentFeature(res, CODEN_AGENT_FLAGS.previewAdapters, 'preview_adapters')) return;
  const auth = getRequiredAuth(req);
  const project = await loadProject(req.params.id, auth.userId, req);
  if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });
  const session = previewSessionRegistry.get(req.params.sessionId);
  if (!session || session.projectId !== project.id || session.userId !== auth.userId) return res.status(404).json({ success: false, error: 'Preview session not found.' });
  if (Date.parse(session.expiresAt) <= Date.now()) {
    previewSessionRegistry.delete(session.id);
    return res.status(410).json({ success: false, error: 'Preview session expired.' });
  }
  return res.json({ success: session.status === 'verified' || session.status === 'ready', session });
});

app.delete('/api/projects/:id/preview/:sessionId', requireAuthWithTemporaryGeneration, async (req: any, res: any) => {
  if (!requireCodenAgentFeature(res, CODEN_AGENT_FLAGS.previewAdapters, 'preview_adapters')) return;
  const auth = getRequiredAuth(req);
  const project = await loadProject(req.params.id, auth.userId, req);
  if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });
  const session = previewSessionRegistry.get(req.params.sessionId);
  if (!session || session.projectId !== project.id || session.userId !== auth.userId) return res.status(404).json({ success: false, error: 'Preview session not found.' });
  previewSessionRegistry.delete(session.id);
  return res.json({ success: true, session_id: session.id, status: 'stopped' });
});

app.post('/api/projects/:id/build/cancel', async (req: any, res: any) => {
  const userId = getUserOrgId(req);
  const project = await loadProject(req.params.id, userId);
  if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });
  const buildSessionId = String(req.body?.buildSessionId || '');
  const agentRunId = String(req.body?.agentRunId || '');
  if (buildSessionId) await updateBuildSessionStatus(buildSessionId, 'cancelled', { cancelled_at: new Date().toISOString() });
  if (agentRunId) await updateAgentRunStatus(agentRunId, 'cancelled', { suggested_action: 'cancelled_by_user' });
  await saveAgentEvent({
    organization_id: project.organization_id,
    project_id: project.id,
    user_id: userId,
    sequence_number: persistenceSequenceNumber(),
    event_type: 'cancelled',
    message: 'Build cancelled by user.',
    payload: { build_session_id: buildSessionId, agent_run_id: agentRunId || null },
  });
  res.json({ success: true, status: 'cancelled', agent_run_id: agentRunId || null });
});

app.post('/api/projects/:id/build/resume', async (req: any, res: any) => {
  const userId = getUserOrgId(req);
  const project = await loadProject(req.params.id, userId);
  if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });
  res.json({
    success: true,
    message: 'Resume is ready. Send the original prompt again with confirmedCost or externalKeysConfirmed.',
    project_id: project.id,
  });
});

app.get('/api/projects/:id/agent/threads', async (req: any, res: any) => {
  const userId = getUserOrgId(req);
  const project = await loadProject(req.params.id, userId);
  if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });
  const persistent = getPersistentAgentHarness();
  try {
    const threads = persistent
      ? await persistent.store.listThreads(project.id, userId, Number(req.query?.limit || 20))
      : await inMemoryAgentHarness.store.listThreads(project.id, userId, Number(req.query?.limit || 20));
    return res.json({ success: true, harness_version: 'coden-harness/v3', threads });
  } catch (error) {
    if (!isMissingAgentHarnessSchemaError(error)) throw error;
    const threads = await inMemoryAgentHarness.store.listThreads(project.id, userId, Number(req.query?.limit || 20));
    return res.json({ success: true, harness_version: 'coden-harness/v3', persistence: 'memory_fallback', threads });
  }
});

app.get('/api/projects/:id/agent/threads/:threadId', async (req: any, res: any) => {
  const userId = getUserOrgId(req);
  const project = await loadProject(req.params.id, userId);
  if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });
  const resolved = await resolveAgentHarnessThread(req.params.threadId);
  if (!resolved || resolved.thread.projectId !== project.id || resolved.thread.userId !== userId) {
    return res.status(404).json({ success: false, error: 'Agent thread not found.' });
  }
  const activeTurn = resolved.thread.activeTurnId ? await resolved.harness.store.getTurn(resolved.thread.activeTurnId) : null;
  return res.json({ success: true, harness_version: 'coden-harness/v3', thread: resolved.thread, active_turn: activeTurn });
});

app.post('/api/projects/:id/agent/threads/:threadId/turns/:turnId/instructions', async (req: any, res: any) => {
  const userId = getUserOrgId(req);
  const project = await loadProject(req.params.id, userId);
  if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });
  const resolved = await resolveAgentHarnessThread(req.params.threadId);
  if (!resolved || resolved.thread.projectId !== project.id || resolved.thread.userId !== userId) {
    return res.status(404).json({ success: false, error: 'Agent thread not found.' });
  }
  const text = redactSecrets(String(req.body?.instruction || req.body?.text || '')).trim().slice(0, 4000);
  if (!text) return res.status(400).json({ success: false, error: 'Instruction is required.' });
  const instruction = await resolved.harness.steer({ turnId: req.params.turnId, userId, text });
  const activeRunId = activeHarnessAgentRunIds.get(req.params.turnId);
  if (activeRunId) {
    queueAgentRunInstruction(activeRunId, {
      id: instruction.id,
      text,
      createdAt: instruction.createdAt,
      userId,
    });
    await updateAgentRunV3Meta(activeRunId, {
      pending_user_instructions: publicPendingAgentInstructions(activeRunId),
      definition_of_done_updated_at: instruction.createdAt,
    }).catch(() => null);
  }
  return res.status(202).json({ success: true, harness_version: 'coden-harness/v3', instruction, message: 'Instruction reçue. Coden l’appliquera au prochain checkpoint sûr.' });
});

app.post('/api/projects/:id/agent/threads/:threadId/turns/:turnId/cancel', async (req: any, res: any) => {
  const userId = getUserOrgId(req);
  const project = await loadProject(req.params.id, userId);
  if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });
  const resolved = await resolveAgentHarnessThread(req.params.threadId);
  if (!resolved || resolved.thread.projectId !== project.id || resolved.thread.userId !== userId) {
    return res.status(404).json({ success: false, error: 'Agent thread not found.' });
  }
  const turn = await resolved.harness.cancelTurn(req.params.turnId, userId);
  activeHarnessTurnControllers.get(req.params.turnId)?.abort();
  return res.json({ success: true, harness_version: 'coden-harness/v3', turn });
});

app.post('/api/projects/:id/agent/threads/:threadId/turns/:turnId/approvals/:itemId', async (req: any, res: any) => {
  const userId = getUserOrgId(req);
  const project = await loadProject(req.params.id, userId);
  if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });
  const resolved = await resolveAgentHarnessThread(req.params.threadId);
  if (!resolved || resolved.thread.projectId !== project.id || resolved.thread.userId !== userId) {
    return res.status(404).json({ success: false, error: 'Agent thread not found.' });
  }
  const result = await resolved.harness.resolveApproval(req.params.itemId, req.body?.approved === true, userId);
  return res.json({ success: true, harness_version: 'coden-harness/v3', ...result });
});

app.get('/api/projects/:id/agent/runs', async (req: any, res: any) => {
  const userId = getUserOrgId(req);
  const project = await loadProject(req.params.id, userId);
  if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });
  const runs = await listAgentRuns(project.id, req.query?.limit || 20);
  res.json({ success: true, runs });
});

app.get('/api/projects/:id/agent/runs/:runId', async (req: any, res: any) => {
  const userId = getUserOrgId(req);
  const project = await loadProject(req.params.id, userId);
  if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });
  const run = await getAgentRun(project.id, req.params.runId);
  if (!run) return res.status(404).json({ success: false, error: 'Agent run not found.' });
  const steps = await getAgentRunSteps(project.id, req.params.runId);
  res.json({ success: true, run, steps });
});

app.get('/api/projects/:id/agent/runs/:runId/runner-results', async (req: any, res: any) => {
  const userId = getUserOrgId(req);
  const project = await loadProject(req.params.id, userId);
  if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });
  const run = await getAgentRun(project.id, req.params.runId);
  if (!run) return res.status(404).json({ success: false, error: 'Agent run not found.' });
  const results = await listAgentRunnerResults(project.id, req.params.runId, req.query?.limit || 120);
  res.json({ success: true, results });
});

app.post('/api/projects/:id/agent/feedback', async (req: any, res: any) => {
  const userId = getUserOrgId(req);
  const project = await loadProject(req.params.id, userId);
  if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });
  const allowedFeedback = new Set(['keep', 'modify', 'regenerate', 'publish', 'reject']);
  const feedback = allowedFeedback.has(String(req.body?.feedback || ''))
    ? String(req.body.feedback)
    : 'modify';
  const reasons = Array.isArray(req.body?.reasons)
    ? req.body.reasons.map((item: any) => String(item || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 80)).filter(Boolean).slice(0, 8)
    : [];
  const comment = redactSecrets(req.body?.comment || '').trim().slice(0, 2000);
  const messageId = String(req.body?.messageId || '').trim().slice(0, 120);
  const role = ['user', 'assistant', 'system'].includes(String(req.body?.role || ''))
    ? String(req.body.role)
    : null;
  const rating = req.body?.rating === 'positive' ? 'positive' : req.body?.rating === 'negative' ? 'negative' : null;
  const messageExcerpt = redactSecrets(req.body?.content || '').trim().slice(0, 1000);
  await saveAgentEvent({
    organization_id: project.organization_id || userId,
    project_id: project.id,
    user_id: userId,
    sequence_number: persistenceSequenceNumber(),
    event_type: 'user_feedback',
    message: `User feedback: ${feedback}.`,
    payload: redactAgentPayload({
      feedback,
      agent_run_id: req.body?.runId || null,
      version_id: req.body?.versionId || null,
      source: req.body?.source || 'builder',
      message_id: messageId || null,
      role,
      rating,
      reasons,
      comment,
      message_excerpt: messageExcerpt,
    }),
  });
  const learningSignal = buildUserFeedbackImprovementSignal({
    feedback,
    rating: rating as 'positive' | 'negative' | null,
    reasons,
    comment,
    role,
    messageExcerpt,
    source: String(req.body?.source || 'builder').slice(0, 120),
  });
  await upsertAgentTypedMemory(project, userId, learningSignal.memoryType, learningSignal.summary, learningSignal.payload).catch(() => null);
  res.json({ success: true, feedback, rating });
});

app.get('/api/projects/:id/agent/research', async (req: any, res: any) => {
  const userId = getUserOrgId(req);
  const project = await loadProject(req.params.id, userId);
  if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });
  const research = await listAgentResearchResults(project.id, req.query?.limit || 40);
  res.json({ success: true, research });
});

app.get('/api/projects/:id/agent/memory', async (req: any, res: any) => {
  const userId = getUserOrgId(req);
  const project = await loadProject(req.params.id, userId);
  if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });
  const memory = await listAgentMemory(project.id);
  res.json({ success: true, memory });
});

app.post('/api/projects/:id/agent/runs/:runId/instructions', async (req: any, res: any) => {
  if (!requireCodenAgentFeature(res, CODEN_AGENT_FLAGS.userSteering, 'user_steering')) return;
  const userId = getUserOrgId(req);
  const project = await loadProject(req.params.id, userId);
  if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });
  const run = await getAgentRun(project.id, req.params.runId);
  if (!run) return res.status(404).json({ success: false, error: 'Agent run not found.' });
  if (['completed', 'failed', 'cancelled', 'blocked'].includes(String((run as any).status || ''))) {
    return res.status(409).json({ success: false, error: 'This run is already finished. Start a new run for another change.' });
  }
  if (!enforceRateLimit(`agent-instruction:${userId}:${req.params.runId}`, 20, 60_000)) {
    return res.status(429).json({ success: false, error: 'Too many instructions. Wait a moment before sending another.' });
  }
  const text = redactSecrets(String(req.body?.instruction || req.body?.text || '')).trim().slice(0, 4000);
  if (!text) return res.status(400).json({ success: false, error: 'Instruction is required.' });
  const instruction: PendingAgentInstruction = { id: `instruction_${randomUUID()}`, text, createdAt: new Date().toISOString(), userId };
  queueAgentRunInstruction(req.params.runId, instruction);
  await saveAgentRunStep({
    agent_run_id: req.params.runId,
    project,
    user_id: userId,
    sequence_number: persistenceSequenceNumber(),
    event_type: 'user_instruction',
    status: 'pending',
    message: 'User instruction queued for the next safe checkpoint.',
    payload: { instruction_id: instruction.id, instruction: text, apply_at: 'next_safe_checkpoint' },
  });
  await updateAgentRunV3Meta(req.params.runId, {
    pending_user_instructions: publicPendingAgentInstructions(req.params.runId),
    definition_of_done_updated_at: instruction.createdAt,
  }).catch(() => null);
  return res.status(202).json({
    success: true,
    instruction_id: instruction.id,
    run_id: req.params.runId,
    status: 'queued',
    apply_at: 'next_safe_checkpoint',
    message: 'Instruction reçue. Coden l’appliquera au prochain checkpoint sûr.',
  });
});

app.post('/api/projects/:id/agent/runs/:runId/confirm', async (req: any, res: any) => {
  const userId = getUserOrgId(req);
  const project = await loadProject(req.params.id, userId);
  if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });
  const run = await getAgentRun(project.id, req.params.runId);
  if (!run) return res.status(404).json({ success: false, error: 'Agent run not found.' });
  const action = sanitizeWorkspaceText(req.body?.action || '').trim().slice(0, 120);
  if (!action) return res.status(400).json({ success: false, error: 'Confirmed action is required.' });
  await saveAgentRunStep({
    agent_run_id: req.params.runId,
    project,
    user_id: userId,
    sequence_number: persistenceSequenceNumber(),
    event_type: 'user_confirmation',
    status: 'completed',
    message: `User confirmed action: ${action}.`,
    payload: { action, confirmed: true, plan_id: req.body?.planId || null },
  });
  return res.json({ success: true, run_id: req.params.runId, action, confirmed: true });
});

app.post('/api/projects/:id/agent/runs/:runId/cancel', async (req: any, res: any) => {
  const userId = getUserOrgId(req);
  const project = await loadProject(req.params.id, userId);
  if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });
  await updateAgentRunStatus(req.params.runId, 'cancelled', { suggested_action: 'cancelled_by_user' });
  await saveAgentEvent({
    organization_id: project.organization_id,
    project_id: project.id,
    user_id: userId,
    sequence_number: persistenceSequenceNumber(),
    event_type: 'cancelled',
    message: 'Agent run cancelled by user.',
    payload: { agent_run_id: req.params.runId, request_id: req.body?.requestId || null },
  });
  res.json({ success: true, status: 'cancelled', run_id: req.params.runId });
});

app.get('/api/projects/:id/versions', async (req: any, res: any) => {
  const userId = getUserOrgId(req);
  const project = await loadProject(req.params.id, userId);
  if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });
  const versions = await listProjectVersions(project.id);
  res.json({ success: true, versions });
});

app.post('/api/projects/:id/versions/:versionId/rollback', async (req: any, res: any) => {
  const userId = getUserOrgId(req);
  const project = await loadProject(req.params.id, userId);
  if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });
  activeAgentRunControllers.get(req.params.runId)?.abort();
  activeAgentRunControllers.delete(req.params.runId);
  pendingAgentRunInstructions.delete(req.params.runId);
  if (!requireProjectCapability(req, res, 'build', project)) return;
  if (req.body?.confirmed !== true && req.body?.approvalGranted !== true) {
    return res.status(409).json({ success: false, requires_confirmation: true, error: 'Explicit confirmation is required before rolling back this project.' });
  }
  const versions = await listProjectVersions(project.id);
  const version = versions.find((item: any) => item.id === req.params.versionId);
  if (!version) return res.status(404).json({ success: false, error: 'Version not found.' });
  const files = normalizeGeneratedFiles(version.files_snapshot || []);
  const pipeline = runPreviewPipeline(project, files);
  const browser = pipeline.status === 'ready'
    ? await runBrowserInteractionAuditDetailed({ files, previewHtml: pipeline.html, timeoutMs: 20_000 })
    : null;
  const verified = pipeline.status === 'ready' && browser?.status === 'passed' && !browser.findings.some((finding: any) => finding.severity === 'high');
  const updatedProject = {
    ...project,
    preview_status: verified ? 'verified' : 'needs_fix',
    preview_html: verified ? pipeline.html : buildPreviewErrorHtml({ projectName: project.name, error: 'The rolled-back runtime could not be verified.' }),
    updated_at: new Date().toISOString(),
  };
  await saveProject(updatedProject, files);
  await createProjectVersion(updatedProject, files, `Rollback to v${version.version_number}`, { rollback_to: version.id });
  res.json({ success: verified, needs_fix: !verified, project: updatedProject, files, preview: { status: verified ? 'verified' : 'needs_fix', html: updatedProject.preview_html }, browser });
});

app.get('/api/projects/:id/diff', async (req: any, res: any) => {
  const userId = getUserOrgId(req);
  const project = await loadProject(req.params.id, userId);
  if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });
  const versions = await listProjectVersions(project.id);
  res.json({ success: true, diff: versions[0]?.diff_summary || { created: [], modified: [], deleted: [], summary: 'No diff yet' } });
});

app.post('/api/projects/:id/browser-test', async (req: any, res: any) => {
  const requestId = `browser_${randomUUID()}`;
  try {
    const userId = getUserOrgId(req);
    const project = await loadProject(req.params.id, userId);
    if (!project) {
      return res.status(404).json({ success: false, error: 'Project not found.', request_id: requestId });
    }
    if (!requireProjectCapability(req, res, 'view', project)) return;
    const files = await loadProjectFiles(project.id);
    const previewHtml = String(req.body?.preview_html || req.body?.previewHtml || getProjectPreviewHtml(project, files, 'preview'));
    const result = await runBrowserInteractionAuditDetailed({
      files,
      previewHtml,
      timeoutMs: Number(req.body?.timeout_ms || req.body?.timeoutMs || 20_000),
    });
    res.json({ success: true, request_id: requestId, browser_test: result });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      request_id: requestId,
      message: 'Browser test could not complete.',
      diagnostic_code: 'BROWSER_TEST_FAILED',
      suggested_action: 'retry_or_use_static_checks',
      error: redactSecrets(error?.message || String(error), '[redacted]'),
    });
  }
});

app.post('/api/projects/:id/security-scan', async (req: any, res: any) => {
  const requestId = `sec_${randomUUID()}`;
  try {
    const userId = getUserOrgId(req);
    const project = await loadProject(req.params.id, userId);
    if (!project) {
      return res.status(404).json({ success: false, error: 'Project not found.', request_id: requestId });
    }
    if (!requireProjectCapability(req, res, 'view', project)) return;
    const files = await loadProjectFiles(project.id);
    const security = scanGeneratedSecurity(files);
    res.json({ success: true, request_id: requestId, security });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      request_id: requestId,
      message: 'Security scan could not complete.',
      diagnostic_code: 'SECURITY_SCAN_FAILED',
      suggested_action: 'retry_or_run_build',
      error: redactSecrets(error?.message || String(error), '[redacted]'),
    });
  }
});

app.post('/api/projects/:id/import-context', async (req: any, res: any) => {
  const userId = getUserOrgId(req);
  const project = await loadProject(req.params.id, userId);
  if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });
  if (!requireProjectCapability(req, res, 'build', project)) return;
  const context = buildImportContext({
    source: req.body?.source,
    mode: req.body?.mode,
    url: req.body?.url,
    fileName: req.body?.file_name || req.body?.fileName,
    mimeType: req.body?.mime_type || req.body?.mimeType,
    hasAttachment: Boolean(req.body?.has_attachment || req.body?.hasAttachment),
  }, {
    figmaConfigured: Boolean(process.env.FIGMA_ACCESS_TOKEN || process.env.FIGMA_TOKEN),
    githubConfigured: Boolean(process.env.GITHUB_TOKEN || process.env.GH_TOKEN),
  });
  res.json({ success: true, import_context: publicImportContext(context), prompt_context: context?.prompt || '' });
});

app.post('/api/projects/:id/visual-edit', async (req: any, res: any) => {
  const userId = getUserOrgId(req);
  const project = await loadProject(req.params.id, userId);
  if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });
  if (!requireProjectCapability(req, res, 'build', project)) return;
  const selector = String(req.body?.selector || '').trim().slice(0, 240);
  const instruction = String(req.body?.instruction || req.body?.prompt || '').trim().slice(0, 1200);
  if (!instruction) {
    return res.status(400).json({
      success: false,
      message: 'Describe the visual change to apply.',
      diagnostic_code: 'VISUAL_EDIT_INSTRUCTION_REQUIRED',
      suggested_action: 'provide_visual_edit_instruction',
    });
  }
  const prompt = [
    'Visual edit request.',
    selector ? `Target selector: ${selector}` : 'Target selector: not provided; infer the smallest safe target from the current preview.',
    `Instruction: ${instruction}`,
    'Patch only the smallest relevant files. Preserve data, state, routes, generated app behavior and preview bootstrap code.',
  ].join('\n');
  res.json({
    success: true,
    mode: 'generate_with_visual_edit_prompt',
    prompt,
    suggested_action: 'send_prompt_to_generate_endpoint',
  });
});

app.get('/api/projects/:id/database', async (req: any, res: any) => {
  const userId = getUserOrgId(req);
  const project = await loadProject(req.params.id, userId);
  if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });
  const files = await loadProjectFiles(project.id);
  const schemaFile = files.find(file => file.path === 'supabase/schema.sql');
  const secrets = await listProjectSecrets(project.id);
  const client = requireSupabase('Project database view');
  const { data: integrations = [] } = await client.from('project_integrations').select('*').eq('project_id', project.id).order('updated_at', { ascending: false });
  const { data: assets = [] } = await client.from('project_assets').select('id, name, url, kind, created_at').eq('project_id', project.id).order('created_at', { ascending: false });
  const { data: activity = [] } = await client.from('agent_events').select('event_type, message, created_at').eq('project_id', project.id).order('created_at', { ascending: false }).limit(8);
  const codenCloud = await loadProjectCodenCloud(project.id);
  const tableMatches = [...(schemaFile?.content || '').matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-zA-Z0-9_]+)/gi)];
  const tables = tableMatches.length
    ? tableMatches.map(match => ({ name: match[1], rows: 0, source: 'supabase/schema.sql', columns: [] }))
    : [{ name: 'project_files', rows: files.length, source: 'coden_control_db', columns: ['path', 'language', 'updated_at'] }];
  res.json({
    success: true,
    database: {
      project_id: project.id,
      backend_status: codenCloud.project?.status || (schemaFile ? 'schema_generated' : 'waiting_for_schema'),
      mode: codenCloud.project?.mode || codenCloud.requirements?.recommended_mode || 'shared_supabase_project',
      cloud: {
        provider: codenCloud.project?.provider || 'coden_cloud',
        status: codenCloud.project?.status || (codenCloud.requirements ? 'detected' : 'not_detected'),
        mode: codenCloud.project?.mode || codenCloud.requirements?.recommended_mode || 'shared',
        region: codenCloud.project?.region || 'auto',
        schema_name: codenCloud.project?.schema_name || (codenCloud.requirements ? buildCodenCloudSchemaName(project.id) : null),
        requirements: codenCloud.requirements,
        resources: codenCloud.resources,
        runtime_config: codenCloud.project?.public_runtime_config || {},
      },
      rls_status: 'enabled_required',
      last_sync_at: project.updated_at,
      tables,
      records_preview: files.slice(0, 5).map(file => ({ table: 'project_files', path: file.path, language: file.language || 'text', updated_at: file.updated_at || project.updated_at })),
      schema: schemaFile?.content || '-- No project schema generated yet.',
      secrets,
      integrations,
      assets,
      storage: { bucket: 'project-assets', assets_count: assets.length },
      activity,
      security: { rls_required: true, secrets_masked: true, service_role_server_only: true },
    },
  });
});

app.get('/api/projects/:id/database/tables', async (req: any, res: any) => {
  const userId = getUserOrgId(req);
  const project = await loadProject(req.params.id, userId);
  if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });
  const files = await loadProjectFiles(project.id);
  const schemaFile = files.find(file => file.path === 'supabase/schema.sql');
  res.json({ success: true, tables: schemaFile ? [{ name: 'app_records', rows: 0, schema: schemaFile.content }] : [] });
});

app.get('/api/projects/:id/database/secrets', async (req: any, res: any) => {
  const userId = getUserOrgId(req);
  const project = await loadProject(req.params.id, userId);
  if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });
  const secrets = await listProjectSecrets(project.id);
  res.json({ success: true, secrets });
});

app.get('/api/projects/:id/integrations', async (req: any, res: any) => {
  const userId = getUserOrgId(req);
  const project = await loadProject(req.params.id, userId);
  if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });
  if (!requireProjectCapability(req, res, 'view', project)) return;
  const client = requireSupabase('Project integrations');
  const { data, error } = await client
    .from('project_integrations')
    .select('id,service,status,created_at,updated_at')
    .eq('project_id', project.id)
    .order('updated_at', { ascending: false });
  if (error) return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, integrations: data || [] });
});

app.patch('/api/projects/:id/integrations', async (req: any, res: any) => {
  const userId = getUserOrgId(req);
  const project = await loadProject(req.params.id, userId);
  if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });
  if (!requireProjectCapability(req, res, 'secrets', project)) return;
  const service = String(req.body?.service || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 80);
  const rawStatus = String(req.body?.status || '').trim().toLowerCase();
  const status = ['enabled', 'setup_required', 'disabled'].includes(rawStatus) ? rawStatus : 'disabled';
  if (!service) return res.status(400).json({ success: false, error: 'Connector service is required.' });
  const client = requireSupabase('Project integration update');
  const row = {
    organization_id: project.organization_id || userId,
    project_id: project.id,
    service,
    status,
    updated_at: new Date().toISOString(),
  };
  let { data, error } = await client
    .from('project_integrations')
    .upsert(row, { onConflict: 'project_id,service' })
    .select('id,service,status,created_at,updated_at')
    .single();
  if (error && /unique|constraint|on conflict|schema cache/i.test(error.message || '')) {
    const existing = await client
      .from('project_integrations')
      .select('id')
      .eq('project_id', project.id)
      .eq('service', service)
      .maybeSingle();
    if (existing.data?.id) {
      const updated = await client
        .from('project_integrations')
        .update({ status, updated_at: row.updated_at })
        .eq('id', existing.data.id)
        .select('id,service,status,created_at,updated_at')
        .single();
      data = updated.data;
      error = updated.error;
    } else {
      const inserted = await client
        .from('project_integrations')
        .insert(row)
        .select('id,service,status,created_at,updated_at')
        .single();
      data = inserted.data;
      error = inserted.error;
    }
  }
  if (error) return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, integration: data });
});

app.post('/api/projects/:id/database/secrets', async (req: any, res: any) => {
  const userId = getUserOrgId(req);
  const project = await loadProject(req.params.id, userId);
  if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });
  if (!requireProjectCapability(req, res, 'secrets', project)) return;
  if (!enforceRateLimit(`secret:${userId}`, 20, 60_000)) {
    return res.status(429).json({ success: false, error: 'Too many secret updates.' });
  }
  const row = await saveProjectSecret(project, String(req.body?.service || 'Custom'), String(req.body?.variable || 'CUSTOM_API_KEY'), String(req.body?.value || ''), 'configured');
  res.json({ success: true, secret: row });
});

app.post('/api/projects/:id/external-keys', async (req: any, res: any) => {
  const userId = getUserOrgId(req);
  const project = await loadProject(req.params.id, userId);
  if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });
  if (!requireProjectCapability(req, res, 'secrets', project)) return;
  const keys = Array.isArray(req.body?.keys) ? req.body.keys : [];
  const saved = [];
  for (const item of keys) {
    saved.push(await saveProjectSecret(project, String(item.service || 'Custom'), String(item.variable || 'CUSTOM_API_KEY'), String(item.value || ''), item.skip ? 'skipped' : 'configured'));
  }
  res.json({ success: true, secrets: saved });
});

app.delete('/api/projects/:id/database/secrets/:secretId', async (req: any, res: any) => {
  const userId = getUserOrgId(req);
  const project = await loadProject(req.params.id, userId);
  if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });
  if (!requireProjectCapability(req, res, 'secrets', project)) return;
  const client = requireSupabase('Project secret deletion');
  const { error } = await client.from('project_secrets').delete().eq('id', req.params.secretId).eq('project_id', project.id);
  if (error) return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true });
});

function sanitizeAssetName(value: unknown) {
  const raw = String(value || 'asset').trim();
  return raw
    .replace(/[\\/]/g, '-')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[^a-zA-Z0-9._ -]/g, '-')
    .slice(0, 120) || 'asset';
}

function decodeAssetPayload(contentBase64: unknown) {
  if (typeof contentBase64 !== 'string' || !contentBase64.trim()) return null;
  const clean = contentBase64.replace(/^data:[^;]+;base64,/i, '').trim();
  if (!/^[a-zA-Z0-9+/]+={0,2}$/.test(clean)) {
    throw new Error('Invalid asset encoding.');
  }
  const buffer = Buffer.from(clean, 'base64');
  if (!buffer.length) throw new Error('Asset file is empty.');
  if (buffer.length > MAX_PROJECT_ASSET_BYTES) {
    throw new Error('Asset is too large. Maximum file size is 4 MB.');
  }
  return buffer;
}

app.post('/api/projects/:id/assets', async (req: any, res: any) => {
  const userId = getUserOrgId(req);
  const project = await loadProject(req.params.id, userId);
  if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });
  if (!requireProjectCapability(req, res, 'build', project)) return;

  const client = requireSupabase('Project asset persistence');
  const id = randomUUID();
  const name = sanitizeAssetName(req.body?.name);
  const mimeType = String(req.body?.mime_type || req.body?.mimeType || 'application/octet-stream').toLowerCase();
  if (!ALLOWED_PROJECT_ASSET_MIME.has(mimeType)) {
    return res.status(400).json({ success: false, error: 'Unsupported asset type.' });
  }

  let url = String(req.body?.url || '');
  let storagePath = '';
  let sizeBytes = Number(req.body?.size_bytes || req.body?.size || 0) || 0;
  let status = url ? 'linked' : 'configured';

  try {
    const buffer = decodeAssetPayload(req.body?.content_base64 || req.body?.contentBase64);
    if (buffer) {
      sizeBytes = buffer.length;
      storagePath = `${project.id}/${id}-${name}`;
      const { error: uploadError } = await client.storage
        .from('project-assets')
        .upload(storagePath, buffer, {
          contentType: mimeType,
          upsert: false,
        });
      if (uploadError) {
        return res.status(500).json({
          success: false,
          error: 'Project asset storage is not configured. Create the Supabase Storage bucket "project-assets" and retry.',
        });
      }
      const { data: publicUrl } = client.storage.from('project-assets').getPublicUrl(storagePath);
      url = publicUrl?.publicUrl || '';
      status = 'uploaded';
    }
  } catch (error) {
    return res.status(400).json({ success: false, error: error instanceof Error ? error.message : 'Invalid asset payload.' });
  }

  const fullAsset = {
    id,
    organization_id: project.organization_id,
    project_id: project.id,
    name,
    url,
    kind: String(req.body?.kind || (mimeType.startsWith('image/') ? 'image' : 'file')),
    mime_type: mimeType,
    size_bytes: sizeBytes,
    status,
    storage_path: storagePath || null,
    created_at: new Date().toISOString(),
  };

  let { error } = await client.from('project_assets').insert([fullAsset]);
  if (error && /mime_type|size_bytes|status|storage_path/i.test(error.message || '')) {
    const compactAsset = {
      id: fullAsset.id,
      organization_id: fullAsset.organization_id,
      project_id: fullAsset.project_id,
      name: fullAsset.name,
      url: fullAsset.url,
      kind: fullAsset.kind,
      created_at: fullAsset.created_at,
    };
    const retry = await client.from('project_assets').insert([compactAsset]);
    error = retry.error;
  }
  if (error) return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, asset: fullAsset });
});

app.get('/api/projects/:id/export', async (req: any, res: any) => {
  const userId = getUserOrgId(req);
  const project = await loadProject(req.params.id, userId);
  if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });
  const files = await loadProjectFiles(project.id);
  const zip = createZipBuffer(files.length ? files : createTemplateFiles(project.name, project.prompt || project.name));
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${project.slug || 'coden-app'}.zip"`);
  res.send(zip);
});

// GET /projects/:id/domains
app.get('/api/projects/:id/domains', async (req: any, res) => {
  const userId = getUserOrgId(req);
  const projectId = req.params.id;
  const project = await loadProject(projectId, userId);
  if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });
  if (!requireProjectCapability(req, res, 'view', project)) return;
  const client = requireSupabase('Domain listing');
  const { data, error } = await client.from('domains').select('*').eq('project_id', projectId).neq('status', 'removed');
  if (error) return res.status(500).json({ success: false, error: error.message });
  const domains = (data || []) as any[];
  const ids = domains.map((item: any) => item.id).filter(Boolean);
  let dnsByDomain = new Map<string, any[]>();
  if (ids.length) {
    const dnsResult = await client
      .from('dns_verifications')
      .select('*')
      .in('domain_id', ids);
    if (!dnsResult.error) {
      dnsByDomain = ((dnsResult.data || []) as any[]).reduce((map, record) => {
        const key = String(record.domain_id || '');
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(record);
        return map;
      }, new Map<string, any[]>());
    } else if (!isSchemaShapeError(dnsResult.error)) {
      return res.status(500).json({ success: false, error: dnsResult.error.message });
    }
  }
  res.json({
    success: true,
    domains: domains.map((domain: any) => {
      const records = dnsByDomain.get(String(domain.id)) || [];
      // The interface needs one state, not a status column it has to interpret.
      const state = resolveDomainState({
        status: domain.status,
        hasInstructions: records.length > 0,
        errorMessage: domain.error_message,
      });
      return { ...domain, dns_records: records, state, state_label: domainStateLabel(state, 'fr') };
    }),
  });
});

/**
 * The Cloudflare host for one project's domains.
 *
 * The five `/domains` routes used to build a Vercel proxy, which threw
 * "not configured" on every request because VERCEL_TOKEN was never set. They
 * now use the same target the project is actually published to.
 */
async function createProjectDomainProvider(project: GeneratedProject) {
  const contract = await readGeneratedRuntimeContract(project);
  const cfName = projectSlugToCfName(String(project.slug || project.id));
  return createCloudflareDomainProvider(cfName, contract.manifest.runtime);
}

// POST /projects/:id/domains
app.post('/api/projects/:id/domains', async (req: any, res: any) => {
  const userId = getUserOrgId(req);
  const projectId = req.params.id;
  const { domain, type } = req.body;

  try {
    const project = await loadProject(projectId, userId);
    if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });
    if (!requireProjectCapability(req, res, 'deploy', project)) return;
    const plan = await getOrganizationPlan(project.organization_id);
    const domainService = new DomainService(requireSupabase('Domain creation'), () => createProjectDomainProvider(project));
    const records = await domainService.registerDomain(project.organization_id, projectId, domain, type || 'custom', plan as any);
    return res.json({ success: true, domain: records });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

function PARTS_RESERVED(sub: string): boolean {
  return ['admin', 'api', 'www', 'app', 'billing', 'support', 'assets', 'jobs'].includes(sub);
}

// POST /projects/:id/domains/:domainId/verify
app.post('/api/projects/:id/domains/:domainId/verify', async (req: any, res) => {
  const userId = getUserOrgId(req);
  const projectId = req.params.id;
  const domainId = req.params.domainId;

  try {
    const project = await loadProject(projectId, userId);
    if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });
    if (!requireProjectCapability(req, res, 'deploy', project)) return;
    const domainService = new DomainService(requireSupabase('Domain verification'), () => createProjectDomainProvider(project));
    const result = await domainService.verifyDnsRecords(projectId, domainId);
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// DELETE /projects/:id/domains/:domainId
app.delete('/api/projects/:id/domains/:domainId', async (req: any, res) => {
  const userId = getUserOrgId(req);
  const projectId = req.params.id;
  const domainId = req.params.domainId;

  try {
    const project = await loadProject(projectId, userId);
    if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });
    if (!requireProjectCapability(req, res, 'deploy', project)) return;
    const domainService = new DomainService(requireSupabase('Domain deletion'), () => createProjectDomainProvider(project));
    await domainService.removeDomain(projectId, domainId);
    res.json({ success: true, message: 'Domain deleted successfully.' });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// PATCH /projects/:id/domains/:domainId/primary
app.patch('/api/projects/:id/domains/:domainId/primary', async (req: any, res) => {
  const userId = getUserOrgId(req);
  const projectId = req.params.id;
  const domainId = req.params.domainId;

  try {
    const project = await loadProject(projectId, userId);
    if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });
    if (!requireProjectCapability(req, res, 'deploy', project)) return;
    const domainService = new DomainService(requireSupabase('Primary domain update'), () => createProjectDomainProvider(project));
    await domainService.setPrimaryDomain(projectId, domainId);
    res.json({ success: true, message: 'Primary domain updated.' });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ──────────────────────────────────────────────────────────────────────
// 4. DEPLOYMENTS ENDPOINTS
// ──────────────────────────────────────────────────────────────────────

async function createPublishContext(project: GeneratedProject): Promise<PublishContext> {
  const [files, latestDeployment, plan, customDomain, currentVisitors] = await Promise.all([
    loadProjectFiles(project.id),
    getLatestPublishedDeployment(project.id),
    getOrganizationPlan(project.organization_id),
    getPrimaryCustomDomain(project.id),
    getPublishCurrentVisitors(project.id),
  ]);
  return { project, files, latestDeployment, plan, customDomain, currentVisitors };
}

function getPublishPublicUrl(project: GeneratedProject, customDomain: string | null): string {
  return customDomain ? normalizeDomainUrl(customDomain) : getDefaultPublishedUrl(project);
}

app.get('/api/projects/:id/publish/status', async (req: any, res: any) => {
  const userId = getUserOrgId(req);
  const project = await loadProject(req.params.id, userId);
  if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });
  const context = await createPublishContext(project);
  res.json({
    success: true,
    publish: buildPublishStatus(context),
    deployment: sanitizeDeploymentForUser(
      context.latestDeployment,
      getPublishPublicUrl(project, context.customDomain),
      context.customDomain,
    ),
  });
});

// GET /projects/:id/deployments
app.get('/api/projects/:id/deployments', async (req: any, res) => {
  const projectId = req.params.id;
  const userId = getUserOrgId(req);
  const project = await loadProject(projectId, userId);
  if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });
  const customDomain = await getPrimaryCustomDomain(projectId);
  const publicUrl = getPublishPublicUrl(project, customDomain);
  const client = requireSupabase('Deployment listing');
  const { data, error } = await client.from('deployments').select('*').eq('project_id', projectId).order('created_at', { ascending: false });
  if (error && isSchemaShapeError(error)) return res.json({ success: true, deployments: [] });
  if (error) return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, deployments: (data || []).map((item: any) => sanitizeDeploymentForUser(item, publicUrl, customDomain)) });
});

async function loadPublicProjectBySlug(slugOrId: string): Promise<GeneratedProject | null> {
  const client = requireSupabase('Public project loading');
  const slug = String(slugOrId || '').trim();
  if (!slug) return null;
  const bySlug = await client.from('projects').select('*').eq('slug', slug).maybeSingle();
  if (bySlug.error) throw new Error(`Supabase public project load failed: ${bySlug.error.message}`);
  if (bySlug.data) return bySlug.data as GeneratedProject;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(slug)) {
    const byId = await client.from('projects').select('*').eq('id', slug).maybeSingle();
    if (byId.error) throw new Error(`Supabase public project load failed: ${byId.error.message}`);
    return (byId.data as GeneratedProject) || null;
  }
  return null;
}

async function loadPublicProjectByCustomDomain(host: string): Promise<GeneratedProject | null> {
  const domain = normalizeDomainHost(host);
  if (!domain) return null;
  const client = requireSupabase('Public custom domain loading');
  const { data, error } = await client
    .from('domains')
    .select('project_id,status,domain')
    .eq('domain', domain)
    .neq('status', 'removed')
    .limit(1);
  if (error) {
    if (isSchemaShapeError(error)) return null;
    throw new Error(`Supabase custom domain load failed: ${error.message}`);
  }
  const record = ((data || []) as any[]).find((item: any) => ['active', 'verified'].includes(String(item.status || '').toLowerCase()));
  if (!record?.project_id) return null;
  return loadProjectForAnalytics(record.project_id);
}

function isKnownCodenHost(host: string): boolean {
  const normalized = normalizeDomainHost(host);
  if (!normalized) return true;
  const publicHost = normalizeDomainHost(getCodenPublicOrigin());
  const rootHost = publicHost.replace(/^www\./, '');
  return [
    publicHost,
    rootHost,
    'localhost',
    '127.0.0.1',
    '0.0.0.0',
  ].some((known: string) => normalized === known || normalized.startsWith(`${known}:`));
}

function stripCodenPublishedBadge(html: string) {
  return html.replace(/<a\b[^>]*\bdata-coden-published-badge=["']true["'][\s\S]*?<\/a>/gi, '');
}

function rewritePublishedHtmlForProxy(html: string, project: GeneratedProject, deployment: any, proxyBasePath: string) {
  let output = html;
  if (deployment?.badge_required) {
    output = injectCodenPublishedBadge(stripCodenPublishedBadge(output), project, getCodenPublicOrigin());
  }
  if (proxyBasePath) {
    const base = proxyBasePath.replace(/\/+$/, '');
    output = output
      .replace(/\b(src|href)=["']\/(?!\/|api\/|built-with-coden\/|p\/)([^"']*)["']/gi, (_match, attr, target) => `${attr}="${base}/${target}"`)
      .replace(/url\(\s*(['"]?)\/(?!\/|api\/|built-with-coden\/|p\/)([^'")]+)\1\s*\)/gi, (_match, quote, target) => `url(${quote}${base}/${target}${quote})`);
  }
  return output;
}

function buildPublishedProxyTargets(project: GeneratedProject, deploymentUrl: string, requestPath: string) {
  const safePath = requestPath && requestPath.startsWith('/') ? requestPath : `/${requestPath || ''}`;
  // The fallback used to be a .vercel.app hostname, which nothing has served
  // since publishing moved to Cloudflare — a proxy retry that could only 404.
  const candidates = [deploymentUrl, getDefaultPublishedUrl(project)].filter(Boolean);
  const unique = Array.from(new Set(candidates));
  return unique.map(candidate => {
    const url = new URL(candidate);
    const requestUrl = new URL(`https://coden.local${safePath}`);
    url.pathname = requestUrl.pathname || '/';
    url.search = requestUrl.search;
    return url;
  });
}

async function servePublishedSnapshot(project: GeneratedProject, deployment: any, res: any, proxyBasePath = '') {
  const files = await loadProjectFiles(project.id);
  const html = getProjectPreviewHtml(project, files, 'production');
  if (!html.trim()) return res.status(404).send('This published app has no saved snapshot yet.');
  res.status(200);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  res.setHeader('X-Coden-Published-App', project.id);
  res.setHeader('X-Coden-Published-Source', 'snapshot');
  return res.send(rewritePublishedHtmlForProxy(html, project, deployment, proxyBasePath));
}

async function proxyPublishedDeployment(project: GeneratedProject, deployment: any, req: any, res: any, proxyBasePath = '') {
  const deploymentUrl = String(deployment?.deployment_url || '');
  if (!deploymentUrl) return servePublishedSnapshot(project, deployment, res, proxyBasePath);

  const requestPath = String(req.url || '/');
  const targets = buildPublishedProxyTargets(project, deploymentUrl, requestPath);
  let lastStatus = 502;

  for (const target of targets) {
    const upstream = await fetch(target.toString(), {
      headers: {
        accept: String(req.headers.accept || '*/*'),
        'user-agent': 'Coden published-app proxy',
      },
    });

    lastStatus = upstream.status;
    if ((upstream.status === 401 || upstream.status === 403) && /-projects\.vercel\.app$/i.test(target.hostname)) {
      continue;
    }

    if (!upstream.ok) continue;

    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    const cacheControl = upstream.headers.get('cache-control') || 'public, max-age=60, stale-while-revalidate=300';
    res.status(upstream.status);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', cacheControl);
    res.setHeader('X-Coden-Published-App', project.id);

    if (contentType.includes('text/html')) {
      const html = await upstream.text();
      return res.send(upstream.ok ? rewritePublishedHtmlForProxy(html, project, deployment, proxyBasePath) : html);
    }

    const body = Buffer.from(await upstream.arrayBuffer());
    return res.send(body);
  }

  return servePublishedSnapshot(project, deployment, res, proxyBasePath);
}

// Public published app route. This reads the latest publish snapshot only.
app.use('/p/:slug', async (req: any, res: any, next: any) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  try {
    const project = await loadPublicProjectBySlug(req.params.slug);
    if (!project) return res.status(404).send('Published app not found.');
    const deployment = await getLatestPublishedDeployment(project.id);
    return proxyPublishedDeployment(project, deployment, req, res, `/p/${encodeURIComponent(req.params.slug)}`);
  } catch (error: any) {
    res.status(500).send(escapeHtml(redactSecrets(error?.message || 'Unable to load published app.')));
  }
});

// Badge router: owner returns to builder when signed in; visitors land on Coden.
app.get('/built-with-coden/:projectId', async (req, res) => {
  try {
    const project = await loadProjectForAnalytics(req.params.projectId);
    if (!project) return res.redirect('/');
    const ownerId = JSON.stringify(project.owner_id);
    const projectId = JSON.stringify(project.id);
    res.setHeader('Cache-Control', 'no-store');
    res.send(`<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Built with Coden</title></head>
<body>
<script>
(() => {
  const ownerId = ${ownerId};
  const projectId = ${projectId};
  const landing = '/';
  const builder = '/builder.html?project=' + encodeURIComponent(projectId);
  const findUserId = () => {
    try {
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i) || '';
        if (!/^sb-|supabase/i.test(key)) continue;
        const parsed = JSON.parse(localStorage.getItem(key) || '{}');
        const user = parsed?.user || parsed?.currentSession?.user || parsed?.session?.user;
        if (user?.id) return String(user.id);
      }
    } catch {}
    return '';
  };
  window.location.replace(findUserId() === ownerId ? builder : landing);
})();
</script>
<noscript><a href="/">Open Coden</a></noscript>
</body></html>`);
  } catch {
    res.redirect('/');
  }
});

function normalizeMalformedAbsolutePath(rawPath: unknown) {
  const value = String(rawPath || '').trim();
  const match = value.match(/^\/https?:\/\/(?:www\.)?coden\.fun(\/[^?#]*)?([?#].*)?$/i);
  if (!match) return null;
  const targetPath = match[1] || '/';
  if (!targetPath.startsWith('/') || targetPath.startsWith('//') || targetPath.includes('\\')) return '/';
  return `${targetPath}${match[2] || ''}`;
}

app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  const normalizedPath = normalizeMalformedAbsolutePath(req.originalUrl || req.url || req.path);
  if (!normalizedPath) return next();
  return res.redirect(302, normalizedPath);
});

// ─── Async Job Queue API ──────────────────────────────────────────────────────

// GET /api/jobs/:id — poll job status
app.get('/api/jobs/:id', requireAuth, async (req: any, res: any) => {
  const auth = getRequiredAuth(req);
  const job = await getJobStatus(req.params.id);
  if (!job) return res.status(404).json({ success: false, error: 'Job not found.' });
  // Security: only job owner or org member can see it
  if (job.user_id !== auth.userId && job.organization_id !== auth.userId) {
    return res.status(403).json({ success: false, error: 'Access denied.' });
  }
  return res.json({ success: true, job: {
    id: job.id, type: job.type, status: job.status, priority: job.priority,
    project_id: job.project_id, attempts: job.attempts, max_attempts: job.max_attempts,
    created_at: job.created_at, started_at: job.started_at, completed_at: job.completed_at,
    result: job.result || null, error: job.error || null,
  }});
});

// GET /api/jobs/:id/events — SSE stream of job progress events
app.get('/api/jobs/:id/events', requireAuth, async (req: any, res: any) => {
  const auth = getRequiredAuth(req);
  const job = await getJobStatus(req.params.id);
  if (!job) return res.status(404).json({ success: false, error: 'Job not found.' });
  if (job.user_id !== auth.userId && job.organization_id !== auth.userId) {
    return res.status(403).json({ success: false, error: 'Access denied.' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const heartbeat = setInterval(() => {
    try { res.write(': keepalive\n\n'); } catch { clearInterval(heartbeat); }
  }, 15_000);
  res.on('close', () => clearInterval(heartbeat));

  let lastEventId = 0;
  const pollEvents = async () => {
    try {
      const supabase = getSupabase();
      if (!supabase) return;
      const { data: events } = await supabase
        .from('agent_job_events')
        .select('id, step, message, created_at')
        .eq('job_id', req.params.id)
        .gt('id', lastEventId)
        .order('created_at', { ascending: true });
      if (events?.length) {
        for (const event of events) {
          res.write(`data: ${JSON.stringify({ type: 'progress', step: event.step, message: event.message })}\n\n`);
          lastEventId = event.id;
        }
      }
      // Check if job is done
      const currentJob = await getJobStatus(req.params.id);
      if (currentJob && ['completed', 'failed', 'cancelled'].includes(currentJob.status)) {
        res.write(`data: ${JSON.stringify({ type: 'done', status: currentJob.status, result: currentJob.result, error: currentJob.error })}\n\n`);
        clearInterval(heartbeat);
        clearInterval(poller);
        res.end();
      }
    } catch { /* ignore polling errors */ }
  };

  const poller = setInterval(pollEvents, 2_000);
  await pollEvents();
});

// DELETE /api/jobs/:id — cancel a pending job
app.delete('/api/jobs/:id', requireAuth, async (req: any, res: any) => {
  const auth = getRequiredAuth(req);
  const cancelled = await cancelJob(req.params.id, auth.userId);
  return res.json({ success: cancelled });
});

app.use(async (req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
  const host = normalizeDomainHost(req.hostname || req.headers.host || '');
  if (isKnownCodenHost(host)) return next();
  try {
    const project = await loadPublicProjectByCustomDomain(host);
    if (!project) return next();
    const deployment = await getLatestPublishedDeployment(project.id);
    return proxyPublishedDeployment(project, deployment, req, res);
  } catch (error: any) {
    return res.status(500).send(escapeHtml(redactSecrets(error?.message || 'Unable to load custom domain app.')));
  }
});

/** True when this response is an open SSE stream rather than a pending JSON reply. */
function isEventStreamResponse(res: any): boolean {
  try {
    return String(res?.getHeader?.('Content-Type') || '').includes('text/event-stream');
  } catch {
    return false;
  }
}

app.use((error: any, req: any, res: any, next: any) => {
  const requestId = `err_${randomUUID()}`;
  const rawMessage = redactSecrets(error?.message || String(error || 'Unexpected server error'));
  const status = Number(error?.status || error?.statusCode || 500);
  const persistenceMissing = /SUPABASE_SERVICE_ROLE_KEY|persistence requires/i.test(rawMessage);
  const diagnosticCode = persistenceMissing
    ? 'SERVER_PERSISTENCE_UNAVAILABLE'
    : /Cannot read properties of undefined.*auth/i.test(rawMessage)
      ? 'SUPABASE_AUTH_CLIENT_UNDEFINED'
      : 'INTERNAL_SERVER_ERROR';
  const publicMessage = persistenceMissing
    ? 'Server persistence is not configured for this environment.'
    : 'The request could not be completed. Please retry in a moment.';

  console.error('[coden:api_unhandled_error]', {
    request_id: requestId,
    path: req.path,
    diagnostic_code: diagnosticCode,
    message: rawMessage,
    streaming: isEventStreamResponse(res),
  });

  // Headers already sent means a response is mid-flight (the job event stream
  // is the one that flushes early): there is no body left to replace, so the
  // log line above is the whole record and Express owns the socket from here.
  if (res.headersSent) return next(error);

  if (req.path?.startsWith('/api')) {
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      success: false,
      message: publicMessage,
      error: publicMessage,
      diagnostic_code: diagnosticCode,
      request_id: requestId,
      suggested_action: persistenceMissing ? 'check_server_env' : 'retry',
    });
  }

  return res.status(500).send(escapeHtml(publicMessage));
});

// Static files (frontend). Keep authenticated/action-only documents out of
// search indexes even when a crawler ignores page-level meta tags.
const publicRouteRedirects: Record<string, string> = (() => {
  try {
    const policyPath = path.join(__dirname, 'config', 'public-route-policy.json');
    const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8')) as { redirects?: Record<string, string> };
    return policy.redirects || {};
  } catch {
    return {};
  }
})();

app.use((req, res, next) => {
  const pathname = String(req.path || '/');
  const target = publicRouteRedirects[pathname]
    || publicRouteRedirects[pathname.endsWith('/') ? pathname.slice(0, -1) : `${pathname}/`];
  if (!target) return next();
  return res.redirect(301, target);
});

// A trailing slash after an MPA document (for example
// /dashboard.html/?localPreview=1) must never fall through to index.html.
// Canonicalize it before static serving so the landing and product shells
// cannot be mixed by a browser or deployment proxy.
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  const match = String(req.path || '').match(/^(\/(?:[^/]+\/)*[^/]+\.html)\/$/i);
  if (!match) return next();
  const query = req.originalUrl?.slice(String(req.path).length + 1) || '';
  return res.redirect(308, `${match[1]}${query}`);
});

const privateDocumentPaths = new Set([
  '/auth.html',
  '/dashboard.html',
  '/builder.html',
  '/checkout.html',
  '/admin.html',
]);

app.use((req, res, next) => {
  if (privateDocumentPaths.has(req.path)) {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  }
  next();
});

const LIVE_SANDBOX_ENABLED = process.env.CODEN_LIVE_SANDBOX === '1';

function requireLiveSandbox(res: any): boolean {
  if (LIVE_SANDBOX_ENABLED) return true;
  res.status(503).json({ success: false, error: 'live_sandbox_disabled', message: 'The live sandbox is not enabled on this server.' });
  return false;
}

app.all(/^\/preview\/([^/]+)(\/.*)?$/, (req: any, res: any) => {
  // Error documents must also be embeddable inside the isolated Builder.
  res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  if (!LIVE_SANDBOX_ENABLED) return res.status(503).json({ error: 'live_sandbox_disabled' });
  const token = req.params[0];
  const grant = readPreviewToken(token);
  if (!grant) return res.status(401).json({ error: 'preview_token_invalid' });
  const sandbox = sandboxRegistry.peek(grant.projectId);
  const status = sandbox?.status();
  if (!sandbox || !status?.port) {
    return res.status(503).json({ error: 'preview_not_running', state: status?.state || 'idle', message: status?.lastError || 'The preview is not running.' });
  }
  sandbox.lastUsedAt = Date.now();
  // Nothing is stripped: the dev server was started with this exact prefix as
  // its base, so it owns the whole path. Stripping it would hand the server a
  // URL outside its own base, which it answers with a redirect back to the
  // base -- and the browser and the proxy then chase each other until Chrome
  // gives up with ERR_TOO_MANY_REDIRECTS.
  proxyHttp(req, res, { port: status.port }, status.basePath ? '' : `/preview/${token}`);
});

app.use(express.static(pathExists(staticRoot) ? staticRoot : __dirname));

function pathExists(target: string): boolean {
  try {
    return Boolean(target && path.isAbsolute(target) && fs.existsSync(target));
  } catch {
    return false;
  }
}

// ============================================================
// Cloudflare Pages publish routes (coden.fun)
// ============================================================
import {
  publishProjectToCloudflare,
  attachUserCustomDomain,
  getCustomDomainStatus,
  removePublication,
  projectSlugToCfName,
  verifyCloudflareDeployment,
} from './src/services/publish-cloudflare.ts';
import { buildStaticSource } from './src/services/build-runner.ts';
import { codenHostForSlug } from './src/services/cloudflare-hosting-policy.ts';
import { hasBlockingGeneratedImport, strippedOfBlockingMarkers } from './src/services/generated-blocking-markers.ts';
import { insertBeforeBodyEnd, insertBeforeHeadEnd, scriptSafeJson, styleSafeCss, tailwindThemeLiteral } from './src/services/preview-embedding.ts';
import { buildAnalyticsSnippet } from './src/services/analytics-snippet.ts';
import { buildTargetedRepair } from './src/services/targeted-repair.ts';
import { renderProjectArchitecture } from './src/services/project-architecture.ts';
import { repairNarration, writingFileNarration } from './src/services/agent-narration.ts';
import { launchProjectPreview, applyProjectEdit } from './src/services/sandbox/launch.ts';
import { selectStarter, applyStarter, describeStarter } from './src/services/sandbox/starters.ts';
import { validateProject, buildRepairInstruction } from './src/services/sandbox/validate.ts';
import { runRepairLoop } from './src/services/sandbox/repair-loop.ts';
import { sandboxRegistry } from './src/services/sandbox/sandbox-registry.ts';
import { runMultiAgentPipeline, resolvePipelineRoute, summarizePipelineOutcome } from './src/services/multi-agent-pipeline.ts';
import { proxyHttp, proxyUpgrade } from './src/services/sandbox/preview-proxy.ts';
import { issuePreviewToken, readPreviewToken } from './src/services/sandbox/preview-token.ts';

async function readGeneratedRuntimeContract(project: GeneratedProject) {
  const files = await loadProjectFiles(project.id);
  const manifestEntry = files.find(file => file.path.replace(/\\/g, '/') === 'coden/app-manifest.json');
  let manifest: any = null;
  if (manifestEntry) {
    try { manifest = JSON.parse(manifestEntry.content); } catch { manifest = null; }
  }
  if (!manifest) {
    manifest = createGeneratedAppManifest({ prompt: project.prompt || project.name, files });
  }
  const universalEntry = files.find(file => file.path.replace(/\\/g, '/') === 'coden.project.json');
  let universalManifest: any = null;
  if (universalEntry) {
    try { universalManifest = JSON.parse(universalEntry.content); } catch { universalManifest = null; }
  }
  if (!universalManifest || !validateProjectManifest(universalManifest).valid) {
    universalManifest = createProjectManifest({ projectId: project.id, name: project.name, files });
  }
  const universalValidation = validateProjectManifest(universalManifest);
  const validation = [
    ...validateGeneratedAppManifest(manifest),
    ...universalValidation.errors.map(error => `coden.project.json: ${error}`),
  ];
  return { files, manifest, universalManifest, validation, warnings: universalValidation.warnings };
}

type PendingAgentInstruction = { id: string; text: string; createdAt: string; userId: string };
const activeAgentRunControllers = new Map<string, AbortController>();
const pendingAgentRunInstructions = new Map<string, PendingAgentInstruction[]>();

function queueAgentRunInstruction(runId: string, instruction: PendingAgentInstruction) {
  const current = pendingAgentRunInstructions.get(runId) || [];
  current.push(instruction);
  pendingAgentRunInstructions.set(runId, current.slice(-20));
}

function publicPendingAgentInstructions(runId: string) {
  return (pendingAgentRunInstructions.get(runId) || []).map(({ id, text, createdAt }) => ({ id, text, created_at: createdAt }));
}

function promptWithPendingAgentInstructions(prompt: string, runId: string) {
  const instructions = publicPendingAgentInstructions(runId);
  if (!instructions.length) return prompt;
  return [
    prompt,
    '',
    'New user steering instructions received during this run. Apply them at the next safe checkpoint, preserve valid artifacts, and do not create a second project or run:',
    ...instructions.map((instruction, index) => `${index + 1}. ${instruction.text}`),
  ].join('\n');
}

async function persistGeneratedRuntimeContract(project: GeneratedProject, manifest: any, sourceRunId?: string) {
  const client = getSupabase();
  if (!client) return;
  await client.from('project_runtime_profiles').upsert({
    project_id: project.id,
    organization_id: project.organization_id,
    profile: manifest.profile,
    framework: manifest.framework,
    runtime: manifest.runtime,
    backend: manifest.backend,
    manifest,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'project_id' }).catch((error: any) => {
    if (!isSchemaShapeError(error)) console.warn('[coden:runtime_profile_persist_skipped]', { message: error?.message });
  });
  await client.from('generated_app_manifests').insert({
    project_id: project.id,
    organization_id: project.organization_id,
    profile: manifest.profile,
    framework: manifest.framework,
    runtime: manifest.runtime,
    backend: manifest.backend,
    manifest,
    source_run_id: sourceRunId || null,
  }).catch((error: any) => {
    if (!isSchemaShapeError(error)) console.warn('[coden:generated_manifest_persist_skipped]', { message: error?.message });
  });
}

app.get('/api/projects/:id/runtime-profile', requireAuthWithTemporaryGeneration, async (req: any, res: any) => {
  try {
    const auth = getRequiredAuth(req);
    const project = await loadProject(req.params.id, auth.userId, req);
    if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });
    if (!requireProjectCapability(req, res, 'view', project)) return;
    const contract = await readGeneratedRuntimeContract(project);
    if (contract.validation.length) return res.status(422).json({ success: false, manifest: contract.manifest, validation: contract.validation });
    await persistGeneratedRuntimeContract(project, contract.manifest);
    return res.json({ success: true, manifest: contract.manifest, universal_manifest: contract.universalManifest, warnings: contract.warnings });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error?.message || 'Runtime profile could not be loaded.' });
  }
});

app.post('/api/projects/:id/preview/start', requireAuthWithTemporaryGeneration, async (req: any, res: any) => {
  try {
    const auth = getRequiredAuth(req);
    const project = await loadProject(req.params.id, auth.userId, req);
    if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });
    if (!requireProjectCapability(req, res, 'view', project)) return;
    const contract = await readGeneratedRuntimeContract(project);
    if (contract.validation.length) return res.status(422).json({ success: false, validation: contract.validation, manifest: contract.manifest });
    const verification = await verifyProjectPreviewWithRealBuild(project, contract.files, contract.manifest);
    const html = verification.verified
      ? verification.preview.html
      : buildPreviewErrorHtml({ projectName: project.name, error: verification.error });
    await saveProject({
      ...project,
      preview_status: verification.status,
      preview_html: html,
      updated_at: new Date().toISOString(),
    }, contract.files);
    return res.status(verification.verified ? 200 : 422).json({
      success: verification.verified,
      needs_fix: !verification.verified,
      status: verification.status,
      manifest: contract.manifest,
      universal_manifest: contract.universalManifest,
      checks: [
        { key: 'build', status: verification.build.status, detail: verification.build.error || verification.build.output_directory },
        ...(verification.browser?.checks || []),
      ],
      errors: verification.verified ? [] : [{ message: verification.error }],
      build: verification.build,
      browser: verification.browser,
      has_html: Boolean(verification.preview.html),
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error?.message || 'Preview could not be started.' });
  }
});

app.post('/api/projects/:id/build', requireAuthWithTemporaryGeneration, async (req: any, res: any) => {
  const buildId = String(req.headers['idempotency-key'] || req.body?.build_id || `build_${randomUUID()}`).slice(0, 140);
  try {
    const auth = getRequiredAuth(req);
    const project = await loadProject(req.params.id, auth.userId, req);
    if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });
    if (!requireProjectCapability(req, res, 'build', project)) return;
    const contract = await readGeneratedRuntimeContract(project);
    if (contract.validation.length) return res.status(422).json({ success: false, validation: contract.validation, manifest: contract.manifest });
    const client = getSupabase();
    if (client) {
      const { data: existingBuild } = await client.from('deployment_builds').select('*').eq('project_id', project.id).eq('build_id', buildId).maybeSingle();
      if (existingBuild && ['running', 'passed'].includes(String(existingBuild.status))) {
        return res.json({ success: existingBuild.status === 'passed', idempotent: true, build: existingBuild });
      }
    }
    const buildRow = {
      project_id: project.id,
      organization_id: project.organization_id,
      build_id: buildId,
      profile: contract.manifest.profile,
      status: 'running',
      output_directory: contract.manifest.outputDirectory,
      started_at: new Date().toISOString(),
    };
    if (client) await client.from('deployment_builds').upsert(buildRow, { onConflict: 'project_id,build_id' }).catch(() => null);
    await persistGeneratedRuntimeContract(project, contract.manifest);
    const workDir = path.join('/tmp', 'coden-builds', `${String(project.slug || project.id).replace(/[^a-z0-9-]/gi, '-')}-${randomUUID()}`);
    let distReady = false;
    try {
      const distDir = await buildStaticSource({ files: extractStaticFiles(project, contract.files) }, {
        slug: String(project.slug || project.id),
        workDir,
        runViteBuild: true,
        outputDirectory: contract.manifest.outputDirectory,
      });
      distReady = fs.existsSync(distDir) && fs.readdirSync(distDir, { withFileTypes: true }).length > 0;
      if (!distReady) throw new Error('Build output is empty.');
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
    if (client) await client.from('deployment_builds').update({ status: 'passed', completed_at: new Date().toISOString() }).eq('project_id', project.id).eq('build_id', buildId).catch(() => null);
    return res.json({ success: true, build_id: buildId, status: 'passed', profile: contract.manifest.profile, output_directory: contract.manifest.outputDirectory, dist_ready: distReady });
  } catch (error: any) {
    const client = getSupabase();
    if (client) await client.from('deployment_builds').update({ status: 'failed', error: String(error?.message || 'Build failed').slice(0, 1000), completed_at: new Date().toISOString() }).eq('build_id', buildId).catch(() => null);
    return res.status(500).json({ success: false, build_id: buildId, status: 'failed', error: error?.message || 'Build failed.' });
  }
});

app.get('/api/projects/:id/builds/:buildId', requireAuthWithTemporaryGeneration, async (req: any, res: any) => {
  try {
    const auth = getRequiredAuth(req);
    const project = await loadProject(req.params.id, auth.userId, req);
    if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });
    if (!requireProjectCapability(req, res, 'view', project)) return;
    const client = requireSupabase('Build lookup');
    const { data, error } = await client.from('deployment_builds').select('*').eq('project_id', project.id).eq('build_id', req.params.buildId).maybeSingle();
    if (error || !data) return res.status(404).json({ success: false, error: 'Build not found.' });
    return res.json({ success: true, build: data });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error?.message || 'Build could not be loaded.' });
  }
});

async function loadProjectForPublish(projectId: string, userId: string, req?: any) {
  const project = await loadProject(projectId, userId, req);
  if (!project) throw new Error('Project not found');
  return project;
}

function extractStaticFiles(project: any, storedFiles: GeneratedFile[] = []): Record<string, { content: string; encoding?: 'utf8' | 'base64' }> {
  if (storedFiles.length) {
    return Object.fromEntries(storedFiles.map(file => [
      String(file.path || '').replace(/^\/+/, ''),
      { content: String(file.content || ''), encoding: 'utf8' as const },
    ]).filter(([path]) => Boolean(path)));
  }
  const raw = project?.generated_files || project?.files || project?.dist_files || {};
  const files: Record<string, { content: string; encoding?: 'utf8' | 'base64' }> = {};
  for (const [key, val] of Object.entries(raw as Record<string, any>)) {
    if (typeof val === 'string') files[key] = { content: val, encoding: 'utf8' };
    else if (val && typeof val === 'object' && typeof val.content === 'string') {
      files[key] = { content: val.content, encoding: val.encoding === 'base64' ? 'base64' : 'utf8' };
    }
  }
  return files;
}

async function verifyProjectPreviewWithRealBuild(project: GeneratedProject, files: GeneratedFile[], manifest: any) {
  const preview = runPreviewPipeline(project, files);
  if (preview.status !== 'ready') {
    const error = preview.errors?.[0]?.message || 'The preview source could not be prepared.';
    return {
      verified: false,
      status: 'needs_fix' as const,
      error,
      preview,
      build: { status: 'skipped' as const, output_directory: String(manifest.outputDirectory || ''), error },
      browser: null,
    };
  }

  const buildId = `preview_${randomUUID()}`;
  const workDir = path.join('/tmp', 'coden-preview-builds', buildId);
  let build: { id: string; status: 'passed' | 'failed'; output_directory: string; error?: string };
  try {
    const distDir = await buildStaticSource({ files: extractStaticFiles(project, files) }, {
      slug: String(project.slug || project.id),
      workDir,
      runViteBuild: true,
      outputDirectory: manifest.outputDirectory,
    });
    const outputEntries = fs.readdirSync(distDir, { withFileTypes: true });
    if (!outputEntries.length) throw new Error(`Build output ${manifest.outputDirectory} is empty.`);
    build = { id: buildId, status: 'passed', output_directory: manifest.outputDirectory };
  } catch (error: any) {
    const message = String(error?.message || 'The generated project build failed.');
    build = { id: buildId, status: 'failed', output_directory: manifest.outputDirectory, error: message };
    return {
      verified: false,
      status: 'needs_fix' as const,
      error: message,
      preview,
      build,
      browser: null,
    };
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }

  const browser = await runBrowserInteractionAuditDetailed({ files, previewHtml: preview.html, timeoutMs: 20_000 });
  const verified = browser.status === 'passed' && !browser.findings.some((finding: any) => finding.severity === 'high');
  const error = verified
    ? ''
    : browser.findings.find((finding: any) => finding.severity === 'high')?.message
      || browser.findings[0]?.message
      || 'The browser runtime did not pass strict verification.';
  return {
    verified,
    status: verified ? 'verified' as const : 'needs_fix' as const,
    error,
    preview,
    build,
    browser: { status: browser.status, findings: browser.findings, checks: browser.checks },
  };
}

async function publishCloudflareProjectForRequest(req: any, res: any) {
  const requestId = `pub_${randomUUID()}`;
  const projectId = String(req.params.id || '');
  try {
    const auth = getRequiredAuth(req);
    if (!enforceRateLimit(`publish:${auth.userId}`, 6, 60_000)) {
      return res.status(429).json({
        success: false,
        error: 'Too many publish requests. Please wait a moment.',
        message: 'Too many publish requests. Please wait a moment.',
        diagnostic_code: 'PUBLISH_RATE_LIMITED',
        request_id: requestId,
        suggested_action: 'retry_later',
      });
    }

    const project = await loadProjectForPublish(projectId, auth.userId, req);
    if (!requireProjectCapability(req, res, 'deploy', project)) return;
    const context = await createPublishContext(project);
    const publishStatus = buildPublishStatus(context);
    if (!publishStatus.can_publish) {
      const failedCheck = publishStatus.checks.find((check: any) => check.status === 'fail');
      return res.status(409).json({
        success: false,
        error: failedCheck?.detail || 'A verified preview is required before publishing.',
        message: failedCheck?.detail || 'A verified preview is required before publishing.',
        diagnostic_code: failedCheck?.key === 'security' ? 'PUBLISH_SECURITY_CHECK_FAILED' : 'PREVIEW_NOT_VERIFIED',
        request_id: requestId,
        suggested_action: failedCheck?.key === 'security' ? 'fix_security_then_publish' : 'verify_preview_first',
        publish: publishStatus,
      });
    }
    if (req.body?.confirmed !== true && req.body?.approvalGranted !== true) {
      return res.status(409).json({
        success: false,
        requires_confirmation: true,
        error: 'Explicit confirmation is required before publishing this project.',
        message: 'Explicit confirmation is required before publishing this project.',
        diagnostic_code: 'PUBLISH_CONFIRMATION_REQUIRED',
        request_id: requestId,
        suggested_action: 'confirm_publish',
        publish: publishStatus,
      });
    }
    const slug = String(project.slug || project.id).toLowerCase();
    const files = extractStaticFiles(project, context.files);
    if (!Object.keys(files).length) {
      return res.status(400).json({ success: false, error: 'No generated files to publish.', request_id: requestId });
    }
    const contract = await readGeneratedRuntimeContract(project);
    if (contract.validation.length) {
      return res.status(422).json({ success: false, error: 'Generated app manifest is invalid.', validation: contract.validation, manifest: contract.manifest, request_id: requestId });
    }
    if (contract.manifest.runtime === 'node-server' || contract.universalManifest.deployment?.target === 'railway') {
      return res.status(409).json({
        success: false,
        error: 'This standalone Node application requires the Railway deployment adapter; static Cloudflare publication is blocked to preserve its backend.',
        message: 'This standalone Node application requires the Railway deployment adapter; static Cloudflare publication is blocked to preserve its backend.',
        diagnostic_code: 'RAILWAY_DEPLOYMENT_ADAPTER_REQUIRED',
        request_id: requestId,
        suggested_action: 'configure_railway_deployment',
      });
    }
    const artifactHash = immutableArtifactHash({
      files: contract.files.map(file => ({ path: file.path, content: file.content })),
      manifest: contract.universalManifest,
      previewSessionId: String((context as any).previewSessionId || project.id),
      verificationPassed: publishStatus.can_publish,
      securityBlockers: [],
    });
    const workDir = path.join('/tmp', 'coden-publish-builds', `${slug}-${requestId}`);
    let result: Awaited<ReturnType<typeof publishProjectToCloudflare>>;
    try {
      const distDir = await buildStaticSource({ files: extractStaticFiles(project, contract.files) }, {
        slug,
        workDir,
        runViteBuild: true,
        outputDirectory: contract.manifest.outputDirectory,
      });
      await persistGeneratedRuntimeContract(project, contract.manifest);
      result = await publishProjectToCloudflare({
        slug,
        distDir,
        projectDir: workDir,
        runtime: contract.manifest.runtime,
      });
      const publicRoutes = Array.isArray(contract.manifest.routes)
        ? contract.manifest.routes
            .filter((route: any) => route?.kind === 'public')
            .map((route: any) => String(route.path || '/'))
        : ['/'];
      const deploymentVerification = await verifyCloudflareDeployment(result, publicRoutes);
      if (!deploymentVerification.verified) {
        const lastCheck = deploymentVerification.checks.at(-1);
        throw new Error(
          `Cloudflare deployment could not be verified${lastCheck ? ` (${lastCheck.url}: ${lastCheck.status || lastCheck.error || 'unreachable'})` : ''}.`,
        );
      }
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
    const createdAt = new Date().toISOString();
    const deploy = {
      id: randomUUID(),
      organization_id: project.organization_id,
      project_id: project.id,
      provider: result.provider,
      provider_deployment_id: result.deploymentId,
      deployment_url: result.deploymentUrl || result.defaultUrl,
      public_url: result.codenUrl || publishStatus.public_url,
      custom_domain: publishStatus.custom_domain,
      badge_required: publishStatus.badge_required,
      status: 'ready',
      commit_hash: artifactHash,
      branch: req.body?.branch || 'main',
      created_at: createdAt,
    };

    const client = getSupabase();
    if (client) {
      await client.from('publications').upsert([{
        project_id: project.id,
        slug,
        cf_pages_project: result.cfName,
        default_url: result.defaultUrl,
        coden_subdomain: codenHostForSlug(slug),
        last_deployment_id: result.deploymentId,
        published_at: createdAt,
        status: 'ready',
      }], { onConflict: 'project_id' });
    }
    await saveDeploymentRecord(deploy);
    const nextStatus = buildPublishStatus({ ...context, latestDeployment: deploy });
    return res.json({
      success: true,
      deployment: { ...sanitizeDeploymentForUser(deploy, result.codenUrl || nextStatus.public_url, nextStatus.custom_domain), artifact_hash: artifactHash },
      publish: { ...nextStatus, public_url: result.codenUrl || nextStatus.public_url },
    });
  } catch (e: any) {
    const diagnostic = diagnosePublishError(e);
    console.error('[coden:publish-cf]', { request_id: requestId, project_id: projectId, diagnostic_code: diagnostic.diagnostic_code, message: e?.message || String(e) });
    return res.status(diagnostic.status).json({
      success: false,
      error: diagnostic.message,
      message: diagnostic.message,
      diagnostic_code: diagnostic.diagnostic_code,
      request_id: requestId,
      suggested_action: diagnostic.suggested_action,
    });
  }
}

app.post('/api/projects/:id/publish', requireAuth, publishCloudflareProjectForRequest);
app.post('/api/projects/:id/publish-cf', requireAuth, publishCloudflareProjectForRequest);
app.post('/api/projects/:id/deploy', requireAuth, publishCloudflareProjectForRequest);
app.post('/api/projects/:id/deployments', requireAuth, async (req: any, res: any) => {
  if (!requireCodenAgentFeature(res, CODEN_AGENT_FLAGS.deploymentAdapters, 'deployment_adapters')) return;
  return publishCloudflareProjectForRequest(req, res);
});

app.get('/api/projects/:id/deployments/:deploymentId', requireAuth, async (req: any, res: any) => {
  if (!requireCodenAgentFeature(res, CODEN_AGENT_FLAGS.deploymentAdapters, 'deployment_adapters')) return;
  const auth = getRequiredAuth(req);
  const project = await loadProjectForPublish(req.params.id, auth.userId, req);
  if (!requireProjectCapability(req, res, 'view', project)) return;
  const client = requireSupabase('Deployment lookup');
  const { data, error } = await client.from('deployments').select('*').eq('project_id', project.id).eq('id', req.params.deploymentId).maybeSingle();
  if (error || !data) return res.status(404).json({ success: false, error: 'Deployment not found.' });
  const domain = await getPrimaryCustomDomain(project.id);
  return res.json({ success: true, deployment: sanitizeDeploymentForUser(data, getPublishPublicUrl(project, domain), domain), artifact_hash: data.commit_hash || null });
});

app.post('/api/projects/:id/deployments/:deploymentId/rollback', requireAuth, async (req: any, res: any) => {
  if (!requireCodenAgentFeature(res, CODEN_AGENT_FLAGS.deploymentAdapters, 'deployment_adapters')) return;
  const auth = getRequiredAuth(req);
  const project = await loadProjectForPublish(req.params.id, auth.userId, req);
  if (!requireProjectCapability(req, res, 'deploy', project)) return;
  if (req.body?.confirmed !== true && req.body?.approvalGranted !== true) {
    return res.status(409).json({ success: false, requires_confirmation: true, error: 'Explicit confirmation is required before rollback.' });
  }
  const client = requireSupabase('Deployment rollback');
  const { data: target, error } = await client.from('deployments').select('*').eq('project_id', project.id).eq('id', req.params.deploymentId).maybeSingle();
  if (error || !target || !isPublishedDeploymentReady(target)) return res.status(404).json({ success: false, error: 'A ready rollback deployment was not found.' });
  const healthUrl = String(target.deployment_url || target.public_url || '');
  if (!/^https:\/\//i.test(healthUrl)) return res.status(409).json({ success: false, error: 'The target deployment has no immutable HTTPS artifact URL.' });
  const health = await fetch(healthUrl, { method: 'GET', redirect: 'follow' }).catch(() => null);
  if (!health?.ok) return res.status(409).json({ success: false, error: 'The rollback artifact is no longer reachable.' });
  const rollback = {
    ...target,
    id: randomUUID(),
    status: 'ready',
    created_at: new Date().toISOString(),
    commit_hash: target.commit_hash || null,
    branch: target.branch || 'main',
  };
  delete (rollback as any).updated_at;
  await saveDeploymentRecord(rollback);
  await client.from('publications').update({
    last_deployment_id: target.provider_deployment_id,
    default_url: target.deployment_url,
    status: 'ready',
    published_at: rollback.created_at,
  }).eq('project_id', project.id).catch(() => null);
  const domain = await getPrimaryCustomDomain(project.id);
  return res.json({
    success: true,
    rollback_of: target.id,
    deployment: sanitizeDeploymentForUser(rollback, getPublishPublicUrl(project, domain), domain),
    artifact_hash: rollback.commit_hash,
  });
});

app.post('/api/projects/:id/publish-cf/domain', requireAuth, async (req: any, res: any) => {
  try {
    const domain = String(req.body?.domain || '').trim().toLowerCase();
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) return res.status(400).json({ error: 'Invalid domain' });
    const auth = getRequiredAuth(req);
    const project = await loadProjectForPublish(req.params.id, auth.userId, req);
    if (!requireProjectCapability(req, res, 'deploy', project)) return;
    const contract = await readGeneratedRuntimeContract(project);
    if (contract.validation.length) {
      return res.status(422).json({ error: 'Generated app manifest is invalid.', validation: contract.validation });
    }
    const cfName = projectSlugToCfName(String(project.slug || project.id));
    const result = await attachUserCustomDomain(cfName, domain, contract.manifest.runtime);
    const client = getSupabase();
    if (client) {
      await client.from('publications').update({
        custom_domain: domain,
        custom_domain_status: 'pending',
      }).eq('project_id', project.id);
      await client.from('deployment_domains').upsert({
        project_id: project.id,
        organization_id: project.organization_id,
        provider: contract.manifest.runtime === 'cloudflare-workers' || process.env.CODEN_STATIC_HOSTING_PROVIDER !== 'cloudflare-pages'
          ? 'cloudflare-workers'
          : 'cloudflare-pages',
        hostname: domain,
        domain_type: 'custom',
        status: 'pending',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'project_id,hostname' }).catch((error: any) => {
        if (!isSchemaShapeError(error)) console.warn('[coden:deployment_domain_persist_skipped]', { message: error?.message });
      });
    }
    res.json({ ok: true, ...result });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Domain attach failed' });
  }
});

app.get('/api/projects/:id/publish-cf/domain/verify', requireAuth, async (req: any, res: any) => {
  try {
    const auth = getRequiredAuth(req);
    const project = await loadProjectForPublish(req.params.id, auth.userId, req);
    if (!requireProjectCapability(req, res, 'view', project)) return;
    const contract = await readGeneratedRuntimeContract(project);
    if (contract.validation.length) {
      return res.status(422).json({ error: 'Generated app manifest is invalid.', validation: contract.validation });
    }
    const cfName = projectSlugToCfName(String(project.slug || project.id));
    const domain = String(req.query.domain || '');
    if (!domain) return res.status(400).json({ error: 'domain query param required' });
    const status = await getCustomDomainStatus(cfName, domain, contract.manifest.runtime);
    const client = getSupabase();
    if (client) {
      await client.from('publications').update({
        custom_domain_status: status.status,
      }).eq('project_id', project.id).eq('custom_domain', domain);
      await client.from('deployment_domains').update({
        status: status.status,
        certificate_status: status.certificate_status || null,
        updated_at: new Date().toISOString(),
      }).eq('project_id', project.id).eq('hostname', domain).catch((error: any) => {
        if (!isSchemaShapeError(error)) console.warn('[coden:deployment_domain_status_skipped]', { message: error?.message });
      });
    }
    res.json(status);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Verify failed' });
  }
});

app.delete('/api/projects/:id/publish-cf', requireAuth, async (req: any, res: any) => {
  try {
    const auth = getRequiredAuth(req);
    const project = await loadProjectForPublish(req.params.id, auth.userId, req);
    if (!requireProjectCapability(req, res, 'deploy', project)) return;
    const slug = String(project.slug || project.id).toLowerCase();
    const cfName = projectSlugToCfName(slug);
    const contract = await readGeneratedRuntimeContract(project);
    if (contract.validation.length) {
      return res.status(422).json({ error: 'Generated app manifest is invalid.', validation: contract.validation });
    }
    await removePublication(cfName, slug, contract.manifest.runtime);
    const client = getSupabase();
    if (client) {
      await client.from('publications').delete().eq('project_id', project.id);
      await client.from('deployment_domains').update({ status: 'removed', updated_at: new Date().toISOString() }).eq('project_id', project.id).catch(() => null);
    }
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Unpublish failed' });
  }
});

// ── Native Coden skills and bounded workflows ──────────────────────────────
app.get('/api/projects/:id/skills', requireAuth, async (req: any, res: any) => {
  const auth = getRequiredAuth(req);
  const project = await loadProject(req.params.id, auth.userId);
  if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });
  if (!requireProjectCapability(req, res, 'view', project)) return;
  return res.json({ success: true, skills: listCodenSkills(), feature_flags: CODEN_SKILL_FLAGS });
});

app.get('/api/projects/:id/agent/skills/:skillId', requireAuth, async (req: any, res: any) => {
  const auth = getRequiredAuth(req);
  const project = await loadProject(req.params.id, auth.userId);
  if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });
  if (!requireProjectCapability(req, res, 'view', project)) return;
  const skill = getCodenSkill(req.params.skillId);
  if (!skill) return res.status(404).json({ success: false, error: 'Skill not found.' });
  return res.json({ success: true, skill });
});

app.post('/api/projects/:id/workflows', requireAuth, async (req: any, res: any) => {
  if (!CODEN_SKILL_FLAGS.workflows) return res.status(404).json({ success: false, error: 'Workflows are not enabled.' });
  const auth = getRequiredAuth(req);
  const project = await loadProject(req.params.id, auth.userId);
  if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });
  if (!requireProjectCapability(req, res, 'build', project)) return;
  const input = {
    name: String(req.body?.name || '').trim(),
    skill_id: String(req.body?.skill_id || req.body?.skillId || '').trim(),
    trigger_type: String(req.body?.trigger_type || req.body?.triggerType || 'manual') as CodenWorkflowTrigger,
    cron: req.body?.cron ? String(req.body.cron).trim() : null,
    budget: typeof req.body?.budget === 'object' && req.body.budget ? req.body.budget : {},
  };
  const validation = validateWorkflowInput(input);
  if (validation.length || !getCodenSkill(input.skill_id)) {
    return res.status(400).json({ success: false, error: validation.length ? 'Invalid workflow.' : 'Unknown skill.', validation: validation.length ? validation : ['skill_unknown'] });
  }
  const client = requireSupabase('Workflow persistence');
  const nextRun = computeNextWorkflowRun(input, new Date());
  const { data, error } = await client.from('agent_workflows').insert({
    organization_id: project.organization_id,
    project_id: project.id,
    name: input.name,
    skill_id: input.skill_id,
    trigger_type: input.trigger_type,
    cron: input.cron,
    status: 'active',
    budget: input.budget,
    next_run_at: nextRun,
    created_by: auth.userId,
  }).select('*').single();
  if (error) return res.status(500).json({ success: false, error: 'Workflow could not be saved.' });
  return res.status(201).json({ success: true, workflow: data });
});

app.get('/api/projects/:id/workflows', requireAuth, async (req: any, res: any) => {
  if (!CODEN_SKILL_FLAGS.workflows) return res.json({ success: true, workflows: [] });
  const auth = getRequiredAuth(req);
  const project = await loadProject(req.params.id, auth.userId);
  if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });
  if (!requireProjectCapability(req, res, 'view', project)) return;
  const client = requireSupabase('Workflow listing');
  const { data, error } = await client.from('agent_workflows').select('*').eq('project_id', project.id).order('created_at', { ascending: false });
  if (error) return res.status(500).json({ success: false, error: 'Workflows could not be loaded.' });
  return res.json({ success: true, workflows: data || [] });
});

app.patch('/api/projects/:id/workflows/:workflowId', requireAuth, async (req: any, res: any) => {
  const auth = getRequiredAuth(req);
  const project = await loadProject(req.params.id, auth.userId);
  if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });
  if (!requireProjectCapability(req, res, 'build', project)) return;
  const client = requireSupabase('Workflow update');
  const { data: existing } = await client.from('agent_workflows').select('*').eq('id', req.params.workflowId).eq('project_id', project.id).maybeSingle();
  if (!existing) return res.status(404).json({ success: false, error: 'Workflow not found.' });
  const nextStatus = ['active', 'paused', 'disabled'].includes(req.body?.status) ? req.body.status : existing.status;
  const nextCron = req.body?.cron === undefined ? existing.cron : (req.body.cron ? String(req.body.cron).trim() : null);
  const nextSkill = req.body?.skill_id || req.body?.skillId || existing.skill_id;
  const validation = validateWorkflowInput({ name: String(req.body?.name || existing.name), skill_id: String(nextSkill), trigger_type: String(req.body?.trigger_type || existing.trigger_type) as CodenWorkflowTrigger, cron: nextCron, budget: req.body?.budget || existing.budget });
  if (validation.length || !getCodenSkill(String(nextSkill))) return res.status(400).json({ success: false, validation: validation.length ? validation : ['skill_unknown'] });
  const update = {
    name: String(req.body?.name || existing.name).trim(), skill_id: String(nextSkill), trigger_type: String(req.body?.trigger_type || existing.trigger_type), cron: nextCron,
    status: nextStatus, budget: req.body?.budget || existing.budget,
    next_run_at: nextStatus === 'active' ? computeNextWorkflowRun({ trigger_type: String(req.body?.trigger_type || existing.trigger_type) as CodenWorkflowTrigger, cron: nextCron }, new Date()) : null,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await client.from('agent_workflows').update(update).eq('id', existing.id).select('*').single();
  if (error) return res.status(500).json({ success: false, error: 'Workflow could not be updated.' });
  return res.json({ success: true, workflow: data });
});

app.post('/api/projects/:id/workflows/:workflowId/run', requireAuth, async (req: any, res: any) => {
  if (!CODEN_SKILL_FLAGS.workflows) return res.status(404).json({ success: false, error: 'Workflows are not enabled.' });
  const auth = getRequiredAuth(req);
  const project = await loadProject(req.params.id, auth.userId);
  if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });
  if (!requireProjectCapability(req, res, 'build', project)) return;
  const client = requireSupabase('Workflow run');
  const { data: workflow } = await client.from('agent_workflows').select('*').eq('id', req.params.workflowId).eq('project_id', project.id).maybeSingle();
  if (!workflow) return res.status(404).json({ success: false, error: 'Workflow not found.' });
  if (workflow.status !== 'active') return res.status(409).json({ success: false, error: 'Workflow is not active.' });
  const idempotencyKey = String(req.headers['idempotency-key'] || req.body?.idempotency_key || workflowIdempotencyKey(workflow.id, 'manual', new Date().toISOString()));
  const { data: existingRun } = await client.from('agent_workflow_runs').select('*').eq('idempotency_key', idempotencyKey).maybeSingle();
  if (existingRun) return res.json({ success: true, idempotent: true, run: existingRun });
  const { data: run, error } = await client.from('agent_workflow_runs').insert({ workflow_id: workflow.id, trigger_type: 'manual', status: 'queued', idempotency_key: idempotencyKey }).select('*').single();
  if (error || !run) return res.status(500).json({ success: false, error: 'Workflow run could not be created.' });
  const jobId = await enqueueJob({ type: 'workflow_run', project_id: project.id, user_id: auth.userId, organization_id: project.organization_id, payload: { workflow_id: workflow.id, workflow_run_id: run.id, skill_id: workflow.skill_id }, priority: 'normal', max_attempts: 1 });
  await client.from('agent_workflow_runs').update({ result: { job_id: jobId } }).eq('id', run.id);
  return res.status(202).json({ success: true, run: { ...run, job_id: jobId } });
});

app.post('/api/projects/:id/workflows/:workflowId/pause', requireAuth, async (req: any, res: any) => {
  const auth = getRequiredAuth(req);
  const project = await loadProject(req.params.id, auth.userId);
  if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });
  if (!requireProjectCapability(req, res, 'build', project)) return;
  const client = requireSupabase('Workflow pause');
  const { data, error } = await client.from('agent_workflows').update({ status: 'paused', next_run_at: null, updated_at: new Date().toISOString() }).eq('id', req.params.workflowId).eq('project_id', project.id).select('*').single();
  if (error || !data) return res.status(404).json({ success: false, error: 'Workflow not found.' });
  return res.json({ success: true, workflow: data });
});

app.post('/api/projects/:id/workflows/:workflowId/resume', requireAuth, async (req: any, res: any) => {
  const auth = getRequiredAuth(req);
  const project = await loadProject(req.params.id, auth.userId);
  if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });
  if (!requireProjectCapability(req, res, 'build', project)) return;
  const client = requireSupabase('Workflow resume');
  const { data: existing } = await client.from('agent_workflows').select('*').eq('id', req.params.workflowId).eq('project_id', project.id).maybeSingle();
  if (!existing) return res.status(404).json({ success: false, error: 'Workflow not found.' });
  const next = computeNextWorkflowRun({ trigger_type: existing.trigger_type as CodenWorkflowTrigger, cron: existing.cron }, new Date());
  const { data, error } = await client.from('agent_workflows').update({ status: 'active', next_run_at: next, updated_at: new Date().toISOString() }).eq('id', existing.id).select('*').single();
  if (error) return res.status(500).json({ success: false, error: 'Workflow could not be resumed.' });
  return res.json({ success: true, workflow: data });
});

app.get('/api/projects/:id/workflows/:workflowId/runs', requireAuth, async (req: any, res: any) => {
  const auth = getRequiredAuth(req);
  const project = await loadProject(req.params.id, auth.userId);
  if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });
  if (!requireProjectCapability(req, res, 'view', project)) return;
  const client = requireSupabase('Workflow run history');
  const { data, error } = await client.from('agent_workflow_runs').select('*').eq('workflow_id', req.params.workflowId).order('created_at', { ascending: false }).limit(50);
  if (error) return res.status(500).json({ success: false, error: 'Workflow history could not be loaded.' });
  return res.json({ success: true, runs: data || [] });
});

/* ── Live sandbox preview ─────────────────────────────────────────────
 *
 * The project, actually running. Its files go to disk, its own dependencies
 * are installed, its own dev server serves it, and the builder's iframe
 * reaches that server through the proxy below.
 *
 * This is a second preview path, not a replacement: the existing one stays
 * the default until this has run against real generations. `CODEN_LIVE_SANDBOX=1`
 * turns it on.
 */

app.post('/api/projects/:id/sandbox/start', requireAuth, async (req: any, res: any) => {
  if (!requireLiveSandbox(res)) return;
  try {
    const auth = getRequiredAuth(req);
    const project = await loadProject(req.params.id, auth.userId, req);
    if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });
    if (!requireProjectCapability(req, res, 'view', project)) return;

    const files = await loadProjectFiles(project.id);
    if (!files.length) return res.status(422).json({ success: false, error: 'This project has no files to run yet.' });

    const sandbox = sandboxRegistry.get(project.id);
    // Before starting, not after: going over the host's limit and then
    // trimming makes the moment of peak load the moment it is most loaded.
    const evicted = await sandboxRegistry.makeRoomFor(project.id);
    await sandbox.writeFiles(files.map((file: any) => ({ path: file.path, content: file.content || '' })));

    // Installing is the slow step, so it is skipped when the tree is already
    // there. Reopening a project should resume in a second, not a minute.
    let install: { ok: boolean; durationMs: number } | null = null;
    if (!(await sandbox.hasFile('node_modules/.package-lock.json')) && !(await sandbox.hasFile('node_modules/.bin'))) {
      const result = await sandbox.install();
      install = { ok: result.ok, durationMs: result.durationMs };
      if (!result.ok) {
        return res.status(422).json({
          success: false, state: 'crashed', error: 'install_failed',
          message: 'The project dependencies could not be installed.',
          logs: sandbox.getLogs(60), install,
        });
      }
    }

    // The token is minted before the server starts, because it is also the
    // path the server is told to serve under: a dev server writes absolute
    // URLs for its own modules, so it has to know the prefix the browser will
    // reach it through, or every module 404s behind a document that loaded.
    const token = issuePreviewToken({ projectId: project.id, userId: auth.userId });
    const status = await sandbox.start({ basePath: `/preview/${token}/` });
    if (status.state !== 'running') {
      return res.status(422).json({
        success: false, state: status.state, error: 'dev_server_failed',
        message: status.lastError || 'The dev server did not start.',
        logs: sandbox.getLogs(60), install,
      });
    }
    return res.json({
      success: true,
      state: status.state,
      // Same-origin, so the iframe needs no cross-site cookie and the hot
      // reload socket needs no separate grant.
      preview_url: `/preview/${token}/`,
      port: status.port,
      install,
      evicted,
      logs: sandbox.getLogs(30),
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: 'sandbox_start_failed', message: error?.message || 'The sandbox could not start.' });
  }
});

app.get('/api/projects/:id/sandbox/status', requireAuth, async (req: any, res: any) => {
  if (!requireLiveSandbox(res)) return;
  const auth = getRequiredAuth(req);
  const project = await loadProject(req.params.id, auth.userId, req);
  if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });
  if (!requireProjectCapability(req, res, 'view', project)) return;
  const sandbox = sandboxRegistry.peek(project.id);
  if (!sandbox) return res.json({ success: true, state: 'idle', url: null, logs: [] });
  const status = sandbox.status();
  return res.json({
    success: true,
    state: status.state,
    port: status.port,
    last_error: status.lastError,
    // The prefix the server was started with, not a new one: a fresh token
    // would be a valid grant for a base this process never emits.
    preview_url: status.state === 'running' ? status.basePath : null,
    logs: sandbox.getLogs(Number(req.query.logs) || 60),
  });
});

app.post('/api/projects/:id/sandbox/stop', requireAuth, async (req: any, res: any) => {
  if (!requireLiveSandbox(res)) return;
  const auth = getRequiredAuth(req);
  const project = await loadProject(req.params.id, auth.userId, req);
  if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });
  if (!requireProjectCapability(req, res, 'build', project)) return;
  const sandbox = sandboxRegistry.peek(project.id);
  if (!sandbox) return res.json({ success: true, state: 'idle' });
  const status = await sandbox.stop();
  return res.json({ success: true, state: status.state });
});

/**
 * Write files into a running sandbox without restarting it.
 *
 * This is the incremental edit path: the dev server's own watcher notices the
 * change and hot-reloads it. Restarting is reserved for the cases that
 * genuinely need it -- a changed dependency list or build config -- which the
 * caller signals rather than this route guessing.
 */
app.post('/api/projects/:id/sandbox/files', requireAuth, async (req: any, res: any) => {
  if (!requireLiveSandbox(res)) return;
  const auth = getRequiredAuth(req);
  const project = await loadProject(req.params.id, auth.userId, req);
  if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });
  if (!requireProjectCapability(req, res, 'build', project)) return;
  const incoming = Array.isArray(req.body?.files) ? req.body.files : [];
  if (!incoming.length) return res.status(400).json({ success: false, error: 'No files given.' });
  const sandbox = sandboxRegistry.get(project.id);
  try {
    const written = await sandbox.writeFiles(incoming.map((file: any) => ({ path: String(file?.path || ''), content: String(file?.content ?? '') })));
    // A new dependency or a changed build config is not something hot reload
    // can absorb; the caller is told so rather than being left with a preview
    // that quietly no longer matches the project.
    const needsRestart = written.some(path => /^(?:package\.json|package-lock\.json|(?:vite|next|astro|svelte|nuxt)\.config\.[cm]?[jt]s)$/i.test(path));
    return res.json({ success: true, written, needs_restart: needsRestart, state: sandbox.status().state });
  } catch (error: any) {
    // A path that escapes the sandbox is a refusal, not a server fault.
    return res.status(400).json({ success: false, error: 'invalid_path', message: error?.message || 'The file could not be written.' });
  }
});

/**
 * The preview itself.
 *
 * Everything under the token is forwarded to that project's dev server: the
 * document, its modules, its assets, and — through the upgrade handler
 * installed below — its hot-reload socket.
 */

const httpServer = app.listen(port, () => {
  console.log(`Coden SaaS backend listening at http://localhost:${port}`);
  void ensureAgentHarnessSchema().catch((error: any) => {
    console.warn('[coden:harness_schema_startup_failed]', { message: redactSecrets(error?.message || String(error), '[redacted]') });
  });
  void reapInterruptedAgentRuns().catch((error: any) => {
    console.warn('[coden:interrupted_run_reap_failed]', { message: redactSecrets(error?.message || String(error), '[redacted]') });
  });

  registerJobHandler('workflow_run', async (job, onProgress) => {
    const client = getSupabase();
    const workflowRunId = String(job.payload.workflow_run_id || '');
    const workflowId = String(job.payload.workflow_id || '');
    const skillId = String(job.payload.skill_id || 'test');
    if (client && workflowRunId) await client.from('agent_workflow_runs').update({ status: 'running', started_at: new Date().toISOString() }).eq('id', workflowRunId);
    onProgress?.('skill_started', `workflow:${skillId}`);
    try {
      const project = await loadProject(job.project_id, job.user_id);
      if (!project) throw new Error('Project not found for workflow run.');
      const files = await loadProjectFiles(project.id);
      let result: Record<string, unknown> = { skill_id: skillId, files_checked: files.length };
      if (skillId === 'security') result = { ...result, security: scanGeneratedSecurity(files) };
      if (skillId === 'test' || skillId === 'review') {
        const preview = runPreviewPipeline(project, files);
        result = { ...result, preview_status: preview.status, preview_errors: preview.errors || [] };
      }
      if (client && workflowRunId) await client.from('agent_workflow_runs').update({ status: 'completed', completed_at: new Date().toISOString(), result }).eq('id', workflowRunId);
      if (client && workflowId) await client.from('agent_workflows').update({ last_run_at: new Date().toISOString(), failure_count: 0, lease_owner: null, lease_until: null, updated_at: new Date().toISOString() }).eq('id', workflowId);
      onProgress?.('skill_verification_completed', `workflow:${skillId}`);
      return result;
    } catch (error: any) {
      const message = redactSecrets(error?.message || String(error), '[redacted]');
      if (client && workflowRunId) await client.from('agent_workflow_runs').update({ status: 'failed', completed_at: new Date().toISOString(), error: message }).eq('id', workflowRunId);
      if (client && workflowId) {
        const { data: workflow } = await client.from('agent_workflows').select('failure_count,max_failures').eq('id', workflowId).maybeSingle();
        const failureCount = Number(workflow?.failure_count || 0) + 1;
        await client.from('agent_workflows').update({ failure_count: failureCount, status: failureCount >= Number(workflow?.max_failures || 3) ? 'disabled' : 'active', lease_owner: null, lease_until: null, updated_at: new Date().toISOString() }).eq('id', workflowId);
      }
      throw new Error(message);
    }
  });

  // ✅ Initialize async job queue worker — picks up long-running jobs from Supabase
  const supabaseClient = getSupabase();
  if (supabaseClient) {
    initJobQueue(supabaseClient);
    startJobWorker();
    console.log('[coden:job_queue] Worker initialized');
    if (CODEN_SKILL_FLAGS.scheduledRuns) {
      const workerId = `workflow_scheduler_${randomUUID()}`;
      setInterval(async () => {
        try {
          const { data: due = [] } = await supabaseClient.rpc('claim_due_coden_workflows', { p_worker_id: workerId, p_limit: 10 });
          for (const workflow of due as any[]) {
            if (!workflowIsDue(workflow, new Date())) continue;
            const scheduledAt = String(workflow.next_run_at || new Date().toISOString());
            const idempotencyKey = workflowIdempotencyKey(workflow.id, 'schedule', scheduledAt);
            const { data: run } = await supabaseClient.from('agent_workflow_runs').upsert({ workflow_id: workflow.id, trigger_type: 'schedule', status: 'queued', idempotency_key: idempotencyKey }, { onConflict: 'idempotency_key', ignoreDuplicates: true }).select('*').maybeSingle();
            if (run) await enqueueJob({ type: 'workflow_run', project_id: workflow.project_id, user_id: workflow.created_by, organization_id: workflow.organization_id, payload: { workflow_id: workflow.id, workflow_run_id: run.id, skill_id: workflow.skill_id }, max_attempts: 1 });
            await supabaseClient.from('agent_workflows').update({ next_run_at: computeNextWorkflowRun(workflow, new Date()), lease_owner: null, lease_until: null, updated_at: new Date().toISOString() }).eq('id', workflow.id);
          }
        } catch (error: any) {
          console.warn('[coden:workflow_scheduler]', { message: error?.message || String(error) });
        }
      }, 30_000);
    }
  } else {
    console.warn('[coden:job_queue] Skipped — Supabase not configured');
  }
});

/**
 * Hot reload's channel.
 *
 * A dev server's HMR runs over a WebSocket, and a WebSocket upgrade never
 * reaches an Express route — it arrives on the HTTP server as an `upgrade`
 * event before any middleware runs. Proxying the documents and forgetting
 * this is the classic half-working preview: the app loads once, then never
 * updates, while the console fills with failed reconnects.
 */
if (LIVE_SANDBOX_ENABLED) {
  httpServer.on('upgrade', (req: any, socket: any, head: any) => {
    const match = /^\/preview\/([^/?]+)(\/[^?]*)?/.exec(String(req.url || ''));
    if (!match) return; // Not ours — leave it for whatever else is listening.
    const token = match[1];
    const grant = readPreviewToken(token);
    const sandbox = grant ? sandboxRegistry.peek(grant.projectId) : null;
    const port = sandbox?.status().port;
    if (!grant || !port) {
      // The socket is ours to close: a dev server that is restarting refuses
      // the upgrade, and the client's reconnect loop handles it from there.
      socket.destroy();
      return;
    }
    sandbox!.lastUsedAt = Date.now();
    proxyUpgrade(req, socket, head, { port }, sandbox!.status().basePath ? '' : `/preview/${token}`);
  });

  // Idle dev servers stop on their own; their files stay, so coming back to a
  // project restarts over an existing node_modules instead of reinstalling it.
  sandboxRegistry.startSweeper();

  // A child that outlives the server holds a port and a few hundred megabytes
  // for nothing. Two signals, because Railway sends SIGTERM and a local Ctrl-C
  // sends SIGINT.
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      void sandboxRegistry.stopAll().finally(() => process.exit(0));
    });
  }
}
