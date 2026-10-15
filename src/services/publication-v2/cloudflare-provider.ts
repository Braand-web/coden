import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { PublicationSnapshot, PublicationState } from './model.ts';
import type { PublicationProvider } from './service.ts';
import {
  buildPublicationGatewayModule,
  PUBLICATION_PROVIDER_VERSION,
  PUBLICATION_VERIFY_PATH,
  PUBLICATION_PROBE_PATH,
  type PublicationGatewayConfig,
  type PublicationGatewayMetadata,
} from './worker-gateway.ts';

const API = 'https://api.cloudflare.com/client/v4';
const BOOTSTRAP = 'export default { fetch() { return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } }); } };';
const MODULE_MIME = {
  esm: 'application/javascript+module', commonjs: 'application/javascript',
  wasm: 'application/wasm', text: 'text/plain', data: 'application/octet-stream',
} as const;

export interface BuiltPublicationAsset { path: string; bytes: Uint8Array; contentType: string }
export interface BuiltPublicationModule { name: string; type: keyof typeof MODULE_MIME; bytes: Uint8Array }
/** Bytes from an ISOLATED builder, never a path, script, shell command, Wrangler
 * config, arbitrary upload metadata, credentials, or an executable callback. */
export type BuiltPublicationArtifact = {
  runtime: 'static-assets';
  assets: readonly BuiltPublicationAsset[];
  notFoundHandling?: 'none' | 'single-page-application' | '404-page';
} | {
  runtime: 'cloudflare-workers';
  mainModule: string;
  modules: readonly BuiltPublicationModule[];
  assets?: readonly BuiltPublicationAsset[];
  assetsBinding?: string;
  compatibilityFlags?: readonly string[];
  notFoundHandling?: 'none' | 'single-page-application' | '404-page';
};

/** Main/core supplies an ownership-validated, CURRENT host/policy snapshot.
 * Audience is intentionally NOT embedded: the backend checks it per request. */
export interface PublicationProviderPolicy {
  revision: string;
  primaryHost: string;
  allowedHosts: readonly string[];
  metadata?: PublicationGatewayMetadata;
}
export interface StagePublicationInput {
  projectId: string;
  releaseId: string;
  policy: PublicationProviderPolicy;
  artifact: BuiltPublicationArtifact;
  /** Stable server-owned ID from PublicationState, never settings.subdomain. */
  hostingId?: string;
}
export interface StagedCloudflarePublication {
  readonly provider: 'cloudflare-workers';
  readonly providerVersion: typeof PUBLICATION_PROVIDER_VERSION;
  readonly projectId: string;
  readonly releaseId: string;
  readonly workerName: string;
  readonly contentWorkerName: string;
  readonly candidateWorkerName: string;
  readonly candidateUrl: string;
  readonly artifactDigest: string;
  readonly policyRevision: string;
  readonly runtime: BuiltPublicationArtifact['runtime'];
}
export interface VerifiedCloudflarePublication extends StagedCloudflarePublication { readonly verified: true }
export interface ActivatedCloudflarePublication {
  provider: 'cloudflare-workers';
  providerVersion: typeof PUBLICATION_PROVIDER_VERSION;
  projectId: string;
  releaseId: string;
  workerName: string;
  contentWorkerName: string;
  versionId: string;
  deploymentId: string;
  publicUrl: string;
  runtime: BuiltPublicationArtifact['runtime'];
  artifactDigest: string;
  policyRevision: string;
}
export interface CloudflarePublicationProviderOptions {
  /** Default OFF; main maps its server-only feature flag to this boolean. */
  enabled?: boolean;
  accountId: string;
  apiToken: string;
  workersSubdomain: string;
  platformOrigin: string;
  platformSecret: string;
  compatibilityDate: string;
  fetch?: typeof fetch;
}

/** JSON-safe, server-only checkpoint. No provider/platform/verification secret.
 * The MAC prevents rehydration from accepting altered hosts or Worker names. */
export interface CloudflarePublicationCandidateCheckpoint {
  candidate: StagedCloudflarePublication;
  policy: PublicationProviderPolicy;
  proof: string;
}

function hash(value: string | Uint8Array): string { return createHash('sha256').update(value).digest('hex'); }
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)]));
  return value;
}
function id(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > 256 || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(`Invalid ${label}`);
}
/** Stable identity MUST NOT depend on settings.subdomain or a custom hostname. */
export function cloudflarePublicationWorkerName(projectId: string): string {
  id(projectId, 'project ID');
  return `coden-pub-${hash(projectId).slice(0, 32)}`;
}
function hostingName(projectId: string, supplied?: string) {
  const derived = cloudflarePublicationWorkerName(projectId);
  const name = supplied || derived;
  if (![derived, `coden-${projectId.replace(/-/g, '')}`].includes(name)
    || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(name)) throw new Error('Unrecognized project hosting identity');
  return name;
}
function host(value: string): string {
  if (typeof value !== 'string' || value.length > 253 || value !== value.toLowerCase()
    || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value)
    || value.endsWith('.workers.dev') || value === 'workers.dev'
    || value.endsWith('.pages.dev') || value === 'pages.dev') throw new Error('Invalid publication host');
  return value;
}
function policySnapshot(policy: PublicationProviderPolicy): PublicationProviderPolicy {
  id(policy.revision, 'policy revision');
  const hosts = [...new Set(policy.allowedHosts.map(host))].sort();
  if (!hosts.length || hosts.length > 100 || !hosts.includes(host(policy.primaryHost))) throw new Error('Invalid primary host');
  let metadata: PublicationGatewayMetadata | undefined;
  if (policy.metadata !== undefined) {
    const m = policy.metadata;
    const asset = (value: unknown) => value === null || (typeof value === 'string' && value.length <= 512
      && /^\/(?!\/)[a-zA-Z0-9_./%-]+$/.test(value) && !/(?:%2e|%2f|%5c|\.\.)/i.test(value));
    if (!m || typeof m.title !== 'string' || !m.title.trim() || m.title.length > 120
      || typeof m.description !== 'string' || m.description.length > 320 || !asset(m.favicon) || !asset(m.image)) throw new Error('Invalid publication metadata');
    metadata = Object.freeze({ title: m.title, description: m.description, favicon: m.favicon, image: m.image });
  }
  return Object.freeze({ revision: policy.revision, primaryHost: policy.primaryHost, allowedHosts: Object.freeze(hosts), ...(metadata ? { metadata } : {}) });
}
function policyKey(policy: PublicationProviderPolicy) { return JSON.stringify(policySnapshot(policy)); }
function safeName(value: string, absolute = false) {
  if (typeof value !== 'string' || !value || value.length > 1024 || value.startsWith('/') !== absolute
    || /[\\?#\u0000-\u0020\u007f%]/.test(value)
    || value.split('/').slice(absolute ? 1 : 0).some(p => !p || p === '.' || p === '..')
    || value === 'metadata') throw new Error('Invalid artifact path');
  if (!absolute && !/^[A-Za-z0-9_./@-]+$/.test(value)) throw new Error('Invalid module path');
}
function snapshotArtifact(input: BuiltPublicationArtifact) {
  if (!input || !['static-assets', 'cloudflare-workers'].includes(input.runtime)) throw new Error('Unsupported publication runtime');
  const assets = (input.assets || []).map(asset => {
    safeName(asset.path, true);
    if (!(asset.bytes instanceof Uint8Array) || !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+(?:;[\x20-\x7e]+)?$/i.test(asset.contentType)) throw new Error('Invalid asset bytes or content type');
    return { ...asset, bytes: Uint8Array.from(asset.bytes) };
  }).sort((a, b) => a.path.localeCompare(b.path));
  if (new Set(assets.map(a => a.path)).size !== assets.length) throw new Error('Duplicate asset path');
  const notFoundHandling = input.notFoundHandling || 'none';
  if (!['none', 'single-page-application', '404-page'].includes(notFoundHandling)) throw new Error('Invalid asset routing');
  let modules: BuiltPublicationModule[];
  let mainModule: string;
  let assetsBinding = 'ASSETS';
  let compatibilityFlags: string[] = [];
  if (input.runtime === 'static-assets') {
    if (!assets.length) throw new Error('Empty static artifact');
    mainModule = 'static.mjs';
    modules = [{ name: mainModule, type: 'esm', bytes: new TextEncoder().encode('export default { fetch(request, env) { return env.ASSETS.fetch(request); } };') }];
  } else {
    safeName(input.mainModule);
    mainModule = input.mainModule;
    modules = input.modules.map(module => {
      safeName(module.name);
      if (!Object.hasOwn(MODULE_MIME, module.type) || !(module.bytes instanceof Uint8Array)) throw new Error('Invalid runtime module');
      return { ...module, bytes: Uint8Array.from(module.bytes) };
    }).sort((a, b) => a.name.localeCompare(b.name));
    if (new Set(modules.map(m => m.name)).size !== modules.length || !modules.some(m => m.name === mainModule && m.type === 'esm')) throw new Error('Missing executable ES module entrypoint or duplicate module');
    assetsBinding = input.assetsBinding || 'ASSETS';
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(assetsBinding) || assetsBinding.startsWith('CODEN_')) throw new Error('Invalid assets binding');
    compatibilityFlags = [...(input.compatibilityFlags || [])];
    // No project-supplied metadata/bindings. Privileged resources require a
    // separate ownership-checked adapter contract before being supported.
    if (compatibilityFlags.some(flag => !['nodejs_compat', 'nodejs_compat_v2'].includes(flag))) throw new Error('Unsupported runtime compatibility flag');
  }
  const digest = hash(JSON.stringify({ runtime: input.runtime, mainModule, assetsBinding, compatibilityFlags, notFoundHandling,
    modules: modules.map(m => [m.name, m.type, hash(m.bytes)]),
    assets: assets.map(a => [a.path, a.contentType, hash(a.bytes)]),
  }));
  return { runtime: input.runtime, assets, modules, mainModule, assetsBinding, compatibilityFlags, notFoundHandling, digest };
}

type CandidateState = { config: PublicationGatewayConfig; contentWorkerName: string; secret: string; policy: PublicationProviderPolicy; activating?: boolean; activated?: boolean };
/** Server-only, API-based adapter. It never reads a project directory or runs
 * build/install/deploy scripts. All network operations are injectable. */
export class CloudflarePublicationProvider {
  readonly #options: CloudflarePublicationProviderOptions;
  readonly #fetch: typeof fetch;
  readonly #staged = new WeakMap<object, CandidateState>();
  readonly #verified = new WeakMap<object, CandidateState>();
  constructor(options: CloudflarePublicationProviderOptions) {
    this.#options = { ...options };
    this.#fetch = options.fetch || fetch;
  }
  #enabled() {
    const o = this.#options;
    if (o.enabled !== true) throw new Error('Publication v2 Cloudflare provider is disabled');
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(o.accountId) || !/^[\x21-\x7e]{1,4096}$/.test(o.apiToken) || !/^[\x21-\x7e]{1,4096}$/.test(o.platformSecret)
      || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(o.workersSubdomain)
      || !/^\d{4}-\d{2}-\d{2}$/.test(o.compatibilityDate)) throw new Error('Invalid server-side provider configuration');
    const origin = new URL(o.platformOrigin);
    if (origin.protocol !== 'https:' || origin.origin !== o.platformOrigin || origin.username || origin.password) throw new Error('Invalid platform origin');
  }
  #script(name: string) { return `/accounts/${this.#options.accountId}/workers/scripts/${name}`; }
  async #api<T>(endpoint: string, init: RequestInit = {}, allowMissing = false, token = this.#options.apiToken): Promise<T | null> {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    if (!(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
    let response: Response;
    try {
      response = await this.#fetch(`${API}${endpoint}`, { ...init, headers, redirect: 'manual', signal: AbortSignal.timeout(30_000) });
    } catch { throw new Error('Cloudflare publication request failed'); }
    if (allowMissing && response.status === 404) return null;
    const payload = await response.json().catch(() => null) as { success?: boolean; result?: T } | null;
    // Do not echo provider response bodies: they can contain source or secrets.
    if (!response.ok || !payload || payload.success !== true || payload.result === undefined) throw new Error(`Cloudflare publication request rejected (${response.status})`);
    return payload.result;
  }
  #tags(projectId: string) { return [PUBLICATION_PROVIDER_VERSION, `coden-project:${hash(projectId)}`]; }
  #owned(tags: unknown, projectId: string) {
    return Array.isArray(tags) && this.#tags(projectId).every(tag => tags.includes(tag))
      && !tags.some(tag => typeof tag === 'string' && tag.startsWith('coden-cloudflare-workers/') && tag !== PUBLICATION_PROVIDER_VERSION);
  }
  #mac(purpose: string, value: unknown) {
    return createHmac('sha256', this.#options.platformSecret).update(`${purpose}\0${JSON.stringify(canonical(value))}`).digest('hex');
  }
  #state(candidate: StagedCloudflarePublication, policy: PublicationProviderPolicy): CandidateState {
    return {
      secret: this.#mac('verification', candidate), policy, contentWorkerName: candidate.contentWorkerName,
      config: { providerVersion: PUBLICATION_PROVIDER_VERSION, projectId: candidate.projectId, releaseId: candidate.releaseId,
        policyRevision: candidate.policyRevision, artifactDigest: candidate.artifactDigest, platformOrigin: this.#options.platformOrigin,
        primaryHost: policy.primaryHost, allowedHosts: policy.allowedHosts, metadata: policy.metadata,
        mode: 'candidate', candidateHost: new URL(candidate.candidateUrl).hostname },
    };
  }
  #form(metadata: Record<string, unknown>, modules: readonly BuiltPublicationModule[]) {
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }), 'metadata.json');
    for (const module of modules) form.append(module.name, new Blob([Uint8Array.from(module.bytes)], { type: MODULE_MIME[module.type] }), module.name);
    return form;
  }
  async #bootstrap(name: string, projectId: string, mustBeNew: boolean, extraTags: string[] = []) {
    const existing = await this.#api<{ tags?: string[] }>(`${this.#script(name)}/settings`, {}, true);
    if (existing) {
      if (mustBeNew || !this.#owned(existing.tags, projectId)) throw new Error('Unrecognized provider Worker/version; refusing to overwrite');
    } else {
      await this.#api(this.#script(name), { method: 'PUT', body: this.#form({
        main_module: 'deny.mjs', compatibility_date: this.#options.compatibilityDate,
        bindings: [], tags: [...this.#tags(projectId), ...extraTags],
      }, [{ name: 'deny.mjs', type: 'esm', bytes: new TextEncoder().encode(BOOTSTRAP) }]) });
    }
    await this.#subdomain(name, false);
  }
  async #subdomain(name: string, enabled: boolean) {
    const state = await this.#api<{ enabled: boolean; previews_enabled: boolean }>(`${this.#script(name)}/subdomain`, {
      method: 'POST', body: JSON.stringify({ enabled, previews_enabled: false }),
    });
    if (state?.enabled !== enabled || state.previews_enabled !== false) throw new Error('Cloudflare did not confirm private Worker routing');
  }
  async #version(name: string, mainModule: string, modules: readonly BuiltPublicationModule[], extra: Record<string, unknown>) {
    const version = await this.#api<{ id: string }>(`${this.#script(name)}/versions`, { method: 'POST', body: this.#form({
      main_module: mainModule, compatibility_date: this.#options.compatibilityDate,
      ...extra,
    }, modules) });
    if (!version?.id || !/^[a-zA-Z0-9_-]+$/.test(version.id)) throw new Error('Cloudflare returned no valid version ID');
    return version.id;
  }
  async #deploy(name: string, versionId: string, stamp?: string) {
    const deployed = await this.#api<{ id: string }>(`${this.#script(name)}/deployments`, {
      method: 'POST', body: JSON.stringify({ strategy: 'percentage', versions: [{ version_id: versionId, percentage: 100 }], ...(stamp ? { annotations: { 'workers/message': stamp } } : {}) }),
    });
    if (!deployed?.id) throw new Error('Cloudflare returned no deployment ID');
    return deployed.id;
  }
  async #deployment(name: string) {
    const result = await this.#api<{ deployments: Array<any> } | Array<any>>(`${this.#script(name)}/deployments`);
    const list = Array.isArray(result) ? result : result?.deployments;
    if (!Array.isArray(list)) throw new Error('Unrecognized Cloudflare deployment state');
    return list[0] as { id: string; versions?: Array<{ version_id: string; percentage: number }>; annotations?: Record<string, string> } | undefined;
  }
  async #immutableReady(name: string, projectId: string, tags: string[], stamp: string) {
    const settings = await this.#api<{ tags?: string[] }>(`${this.#script(name)}/settings`, {}, true);
    if (!settings) { await this.#bootstrap(name, projectId, true, tags); return false; }
    if (!this.#owned(settings.tags, projectId) || !tags.every(tag => settings.tags?.includes(tag))) throw new Error('Unrecognized existing stage artifact identity');
    await this.#subdomain(name, false);
    const deployment = await this.#deployment(name);
    return deployment?.annotations?.['workers/message'] === stamp
      && deployment.versions?.length === 1 && deployment.versions[0].percentage === 100;
  }
  async #assets(name: string, assets: ReturnType<typeof snapshotArtifact>['assets']) {
    // MIME is part of asset identity: identical bytes can be served under two
    // different content types, and multipart uploads are keyed by this hash.
    const assetHash = (asset: BuiltPublicationAsset) => createHash('sha256').update(asset.contentType).update('\0').update(asset.bytes).digest('hex').slice(0, 32);
    const byHash = new Map(assets.map(asset => [assetHash(asset), asset]));
    const manifest = Object.fromEntries(assets.map(asset => [asset.path, { hash: assetHash(asset), size: asset.bytes.byteLength }]));
    const session = await this.#api<{ jwt: string; buckets: string[][] }>(`${this.#script(name)}/assets-upload-session`, {
      method: 'POST', body: JSON.stringify({ manifest }),
    });
    if (typeof session?.jwt !== 'string' || !session.jwt || !Array.isArray(session.buckets)) throw new Error('Invalid Cloudflare asset upload session');
    let completion = session.buckets.length === 0 ? session.jwt : '';
    // Honor Cloudflare's EXACT bucket grouping; do not invent local batch sizes.
    for (const bucket of session.buckets) {
      if (!Array.isArray(bucket) || !bucket.length || bucket.some(key => !byHash.has(key))) throw new Error('Unrecognized Cloudflare asset upload bucket');
      const form = new FormData();
      for (const key of bucket) {
        const asset = byHash.get(key)!;
        form.append(key, new Blob([Buffer.from(asset.bytes).toString('base64')], { type: asset.contentType }), key);
      }
      const result = await this.#api<{ jwt?: string }>(`/accounts/${this.#options.accountId}/workers/assets/upload?base64=true`, {
        method: 'POST', body: form,
      }, false, session.jwt);
      completion = typeof result?.jwt === 'string' ? result.jwt : '';
    }
    if (!completion) throw new Error('Cloudflare asset upload completion token missing');
    return completion;
  }
  #gateway(state: CandidateState, mode: PublicationGatewayConfig['mode']) {
    const config = { ...state.config, mode };
    return {
      modules: [{ name: 'gateway.mjs', type: 'esm' as const, bytes: new TextEncoder().encode(buildPublicationGatewayModule(config)) }],
      bindings: [
        { name: 'CONTENT', type: 'service', service: state.contentWorkerName },
        { name: 'CODEN_PLATFORM_SECRET', type: 'secret_text', text: this.#options.platformSecret },
        { name: 'CODEN_VERIFY_SECRET', type: 'secret_text', text: state.secret },
      ],
    };
  }
  async stage(input: StagePublicationInput): Promise<StagedCloudflarePublication> {
    this.#enabled();
    id(input.projectId, 'project ID'); id(input.releaseId, 'release ID');
    const projectId = input.projectId;
    const releaseId = input.releaseId;
    const policy = policySnapshot(input.policy);
    const artifact = snapshotArtifact(input.artifact); // Validate/copy before any await or provider call.
    const workerName = hostingName(projectId, input.hostingId);
    const stageIdentity = { provider: PUBLICATION_PROVIDER_VERSION, projectId, releaseId, artifact: artifact.digest, policy };
    const nonce = hash(JSON.stringify(canonical(stageIdentity))).slice(0, 32);
    const contentWorkerName = `coden-content-${nonce}`;
    const candidateWorkerName = `coden-stage-${nonce}`;
    const candidateHost = `${candidateWorkerName}.${this.#options.workersSubdomain}.workers.dev`;
    const tags = [`coden-artifact:${artifact.digest}`, `coden-release:${hash(releaseId)}`, `coden-policy:${hash(policyKey(policy))}`];
    const contentStamp = this.#mac('content-deployment', stageIdentity);
    if (!await this.#immutableReady(contentWorkerName, projectId, tags, contentStamp)) {
      const jwt = artifact.assets.length ? await this.#assets(contentWorkerName, artifact.assets) : undefined;
      const contentVersion = await this.#version(contentWorkerName, artifact.mainModule, artifact.modules, {
        compatibility_flags: artifact.compatibilityFlags,
        bindings: jwt ? [{ name: artifact.assetsBinding, type: 'assets' }] : [],
        // API metadata is assets.config.*, NOT Wrangler's top-level assets.*.
        ...(jwt ? { assets: { jwt, config: { run_worker_first: true, not_found_handling: artifact.notFoundHandling } } } : {}),
      });
      await this.#deploy(contentWorkerName, contentVersion, contentStamp);
    }
    const result = Object.freeze({
      provider: 'cloudflare-workers' as const, providerVersion: PUBLICATION_PROVIDER_VERSION,
      projectId, releaseId, workerName, contentWorkerName, candidateWorkerName,
      candidateUrl: `https://${candidateHost}`, artifactDigest: artifact.digest, policyRevision: policy.revision, runtime: artifact.runtime,
    });
    const state = this.#state(result, policy);
    const candidateStamp = this.#mac('candidate-deployment', stageIdentity);
    if (!await this.#immutableReady(candidateWorkerName, projectId, tags, candidateStamp)) {
      const gateway = this.#gateway(state, 'candidate');
      const candidateVersion = await this.#version(candidateWorkerName, 'gateway.mjs', gateway.modules, { bindings: gateway.bindings });
      await this.#deploy(candidateWorkerName, candidateVersion, candidateStamp);
    }
    await this.#subdomain(candidateWorkerName, true); // Protected marker/root probe only; previews disabled.
    this.#staged.set(result, state);
    return result;
  }
  checkpoint(candidate: StagedCloudflarePublication): CloudflarePublicationCandidateCheckpoint {
    const state = this.#staged.get(candidate);
    if (!state) throw new Error('Unrecognized publication candidate');
    const payload = { candidate, policy: state.policy };
    return { ...payload, proof: this.#mac('checkpoint', payload) };
  }
  resume(checkpoint: CloudflarePublicationCandidateCheckpoint): StagedCloudflarePublication {
    this.#enabled();
    const payload = { candidate: checkpoint?.candidate, policy: checkpoint?.policy };
    const proof = checkpoint?.proof;
    const expected = this.#mac('checkpoint', payload);
    if (typeof proof !== 'string' || !/^[a-f0-9]{64}$/.test(proof)
      || !timingSafeEqual(Buffer.from(proof, 'hex'), Buffer.from(expected, 'hex'))
      || checkpoint.candidate?.providerVersion !== PUBLICATION_PROVIDER_VERSION) throw new Error('Unrecognized or altered publication checkpoint');
    const candidate = Object.freeze({ ...checkpoint.candidate });
    const policy = policySnapshot(checkpoint.policy);
    const state = this.#state(candidate, policy);
    this.#staged.set(candidate, state);
    return candidate;
  }
  async #probe(candidate: StagedCloudflarePublication, state: CandidateState, origin: string) {
    let response: Response;
    try {
      response = await this.#fetch(`${origin}${PUBLICATION_VERIFY_PATH}`, {
        headers: { 'X-Coden-Publication-Verification': state.secret }, redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(15_000),
      });
    } catch { throw new Error('Publication candidate marker verification failed'); }
    const marker = await response.json().catch(() => null);
    if (!response.ok || response.redirected || marker?.provider_version !== PUBLICATION_PROVIDER_VERSION
      || marker.project_id !== candidate.projectId || marker.release_id !== candidate.releaseId
      || marker.policy_revision !== candidate.policyRevision || marker.artifact_digest !== candidate.artifactDigest) throw new Error('Publication candidate marker verification failed');
  }
  async #contentProbe(candidate: StagedCloudflarePublication, state: CandidateState, origin: string) {
    let response: Response;
    try {
      response = await this.#fetch(`${origin}${PUBLICATION_PROBE_PATH}`, {
        headers: { 'X-Coden-Publication-Verification': state.secret }, redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(15_000),
      });
    } catch { throw new Error('Publication content probe failed'); }
    if (response.status !== 200 || response.redirected
      || response.headers.get('X-Coden-Publication-Release') !== candidate.releaseId
      || response.headers.get('X-Coden-Publication-Artifact') !== candidate.artifactDigest
      || response.headers.get('X-Coden-Publication-Provider') !== PUBLICATION_PROVIDER_VERSION) throw new Error('Publication content probe identity/status failed');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Publication content probe returned no body');
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 2 * 1024 * 1024) { await reader.cancel(); throw new Error('Publication content probe exceeded verification limit'); }
      chunks.push(chunk.value);
    }
    const body = Buffer.concat(chunks).toString('utf8');
    if (!body.trim()) throw new Error('Publication content probe returned an empty body');
    if (candidate.runtime === 'static-assets') {
      const tags = body.match(/<meta\b[^>]*>/gi) || [];
      const markers = tags.map(tag => Object.fromEntries(Array.from(tag.matchAll(/\s(name|content)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi), match => [match[1].toLowerCase(), match[2] ?? match[3]])))
        .filter(attributes => attributes.name === 'coden-release');
      if (markers.length !== 1 || markers[0].content !== candidate.releaseId) throw new Error('Publication static content release marker is missing, duplicate, or stale');
    }
  }
  async verify(candidate: StagedCloudflarePublication): Promise<VerifiedCloudflarePublication> {
    this.#enabled();
    const state = this.#staged.get(candidate);
    if (!state || candidate.providerVersion !== PUBLICATION_PROVIDER_VERSION) throw new Error('Unrecognized publication candidate');
    await this.#probe(candidate, state, candidate.candidateUrl);
    await this.#contentProbe(candidate, state, candidate.candidateUrl);
    const result = Object.freeze({ ...candidate, verified: true as const });
    this.#verified.set(result, state);
    return result;
  }
  async activate(candidate: VerifiedCloudflarePublication, currentPolicy: PublicationProviderPolicy, approvedHosts?: readonly string[]): Promise<ActivatedCloudflarePublication> {
    this.#enabled();
    const state = this.#verified.get(candidate);
    if (!state || state.activating || state.activated) throw new Error('Unrecognized, unverified, or consumed publication candidate');
    if (policyKey(currentPolicy) !== policyKey(state.policy)) throw new Error('Publication policy changed; stage and verify again');
    // Core supplies ownership-checked aliases at activation. This does not
    // bypass backend known-host/current-release checks for those aliases.
    const livePolicy = policySnapshot({ ...state.policy, allowedHosts: approvedHosts || state.policy.allowedHosts });
    state.activating = true;
    state.policy = livePolicy;
    state.config = { ...state.config, allowedHosts: livePolicy.allowedHosts };
    // Main MUST serialize this with policy/release activation and persist an
    // activation intent first. An ambiguous network failure is NOT auto-retried.
    const bound = new Set<string>();
    for (const hostname of state.policy.allowedHosts) {
      const existing = await this.#api<Array<{ hostname: string; service: string; enabled?: boolean; previews_enabled?: boolean }>>(`/accounts/${this.#options.accountId}/workers/domains?${new URLSearchParams({ hostname })}`);
      if (!Array.isArray(existing) || existing.some(domain => domain.hostname === hostname && domain.service !== candidate.workerName)) throw new Error('Publication host is already bound to another Worker or unrecognized');
      if (existing.some(domain => domain.hostname === hostname && domain.service === candidate.workerName && domain.enabled === true && domain.previews_enabled === false)) bound.add(hostname);
    }
    const attachMissing = async () => {
      for (const hostname of state.policy.allowedHosts) if (!bound.has(hostname)) {
        const binding = await this.#api<{ hostname: string; service: string; enabled: boolean; previews_enabled: boolean }>(`/accounts/${this.#options.accountId}/workers/domains`, { method: 'PUT', body: JSON.stringify({ hostname, service: candidate.workerName, enabled: true, previews_enabled: false }) });
        if (binding?.hostname !== hostname || binding.service !== candidate.workerName || binding.enabled !== true || binding.previews_enabled !== false) throw new Error('Cloudflare did not confirm guarded hostname routing');
      }
    };
    const activationStamp = this.#mac('active-deployment', { candidate, policy: livePolicy });
    const existingSettings = await this.#api<{ tags?: string[] }>(`${this.#script(candidate.workerName)}/settings`, {}, true);
    if (existingSettings && !this.#owned(existingSettings.tags, candidate.projectId)) throw new Error('Unrecognized provider Worker/version; refusing to overwrite');
    const current = existingSettings ? await this.#deployment(candidate.workerName) : undefined;
    let versionId: string;
    let deploymentId: string;
    if (current?.annotations?.['workers/message'] === activationStamp) {
      if (!current.id || current.versions?.length !== 1 || current.versions[0].percentage !== 100 || !current.versions[0].version_id) throw new Error('Ambiguous existing publication deployment');
      // Explicit resume only: no version upload/deploy when the exact signed
      // activation already exists. A failed live read does NOT redeploy.
      await attachMissing();
      await this.#probe(candidate, state, `https://${state.policy.primaryHost}`);
      await this.#contentProbe(candidate, state, `https://${state.policy.primaryHost}`);
      versionId = current.versions[0].version_id;
      deploymentId = current.id;
    } else {
      await this.#bootstrap(candidate.workerName, candidate.projectId, false);
      const gateway = this.#gateway(state, 'active');
      versionId = await this.#version(candidate.workerName, 'gateway.mjs', gateway.modules, { bindings: gateway.bindings });
      // Staging identity AND actual root content have already been verified.
      // Only now may a production version deploy or custom host attach.
      deploymentId = await this.#deploy(candidate.workerName, versionId, activationStamp);
      await attachMissing();
    }
    state.activated = true;
    return {
      provider: candidate.provider, providerVersion: candidate.providerVersion, projectId: candidate.projectId,
      releaseId: candidate.releaseId, workerName: candidate.workerName, contentWorkerName: candidate.contentWorkerName,
      versionId, deploymentId, publicUrl: `https://${state.policy.primaryHost}`, runtime: candidate.runtime,
      artifactDigest: candidate.artifactDigest, policyRevision: state.policy.revision,
    };
  }
  async verifyLive(candidate: VerifiedCloudflarePublication): Promise<void> {
    this.#enabled();
    const state = this.#verified.get(candidate);
    if (!state?.activated) throw new Error('Publication was not activated by this verified candidate');
    await this.#probe(candidate, state, `https://${state.policy.primaryHost}`);
    await this.#contentProbe(candidate, state, `https://${state.policy.primaryHost}`);
  }
  /** DB disable must happen first (PublicationService already does this).
   * Retain immutable private content for rollback; delete only owned routing. */
  async removeProject(projectId: string, hostingId: string, hosts: readonly string[]): Promise<void> {
    this.#enabled();
    const name = hostingName(projectId, hostingId);
    const approved = [...new Set(hosts.map(host))];
    const settings = await this.#api<{ tags?: string[] }>(`${this.#script(name)}/settings`, {}, true);
    if (settings && !this.#owned(settings.tags, projectId)) throw new Error('Unrecognized provider Worker/version; refusing to remove');
    if (settings) await this.#subdomain(name, false);
    for (const hostname of approved) {
      const domains = await this.#api<Array<{ id: string; hostname: string; service: string }>>(`/accounts/${this.#options.accountId}/workers/domains?${new URLSearchParams({ hostname })}`);
      if (!Array.isArray(domains)) throw new Error('Unrecognized Cloudflare host binding');
      for (const domain of domains.filter(d => d.hostname === hostname)) {
        if (domain.service !== name || !/^[a-zA-Z0-9_-]+$/.test(domain.id)) throw new Error('Refusing to remove a foreign host binding');
        await this.#api(`/accounts/${this.#options.accountId}/workers/domains/${domain.id}`, { method: 'DELETE' });
      }
    }
    if (settings) await this.#api(this.#script(name), { method: 'DELETE' });
  }
  /** Rollback is NEW content staging + CURRENT gateway/policy, not restoration
   * of an arbitrary old Cloudflare version/deployment. Main retains build bytes. */
  async stageRollback(input: StagePublicationInput & { restoredFromReleaseId: string }): Promise<StagedCloudflarePublication> {
    id(input.restoredFromReleaseId, 'rollback source release');
    if (input.restoredFromReleaseId === input.releaseId) throw new Error('Rollback requires a new release ID');
    return this.stage(input);
  }
}

type StoredAsset = Omit<BuiltPublicationAsset, 'bytes'> & { base64: string };
type StoredModule = Omit<BuiltPublicationModule, 'bytes'> & { base64: string };
/** Database-checkpoint-safe artifact; Uint8Array is never left for JSONB to
 * silently turn into an object. Source/built bytes remain server-only. */
export type StoredCloudflarePublicationArtifact = {
  version: 1;
  runtime: BuiltPublicationArtifact['runtime'];
  assets: StoredAsset[];
  modules?: StoredModule[];
  mainModule?: string;
  assetsBinding?: string;
  compatibilityFlags?: readonly string[];
  notFoundHandling?: BuiltPublicationArtifact['notFoundHandling'];
};
export function serializeBuiltArtifact(input: BuiltPublicationArtifact): StoredCloudflarePublicationArtifact {
  snapshotArtifact(input); // Validate before accepting a builder's result.
  return {
    version: 1, runtime: input.runtime,
    assets: (input.assets || []).map(({ path, bytes, contentType }) => ({ path, contentType, base64: Buffer.from(bytes).toString('base64') })),
    notFoundHandling: input.notFoundHandling || 'none',
    ...(input.runtime === 'cloudflare-workers' ? {
      mainModule: input.mainModule, assetsBinding: input.assetsBinding || 'ASSETS', compatibilityFlags: [...(input.compatibilityFlags || [])],
      modules: input.modules.map(({ name, type, bytes }) => ({ name, type, base64: Buffer.from(bytes).toString('base64') })),
    } : {}),
  };
}
export function deserializeBuiltArtifact(value: unknown): BuiltPublicationArtifact {
  const artifact = value as StoredCloudflarePublicationArtifact;
  if (artifact?.version !== 1 || !Array.isArray(artifact.assets)) throw new Error('Unrecognized stored publication artifact');
  const decode = (value: string) => {
    if (typeof value !== 'string' || Buffer.from(value, 'base64').toString('base64') !== value) throw new Error('Invalid stored artifact encoding');
    return Uint8Array.from(Buffer.from(value, 'base64'));
  };
  const assets = artifact.assets.map(({ path, contentType, base64 }) => ({ path, contentType, bytes: decode(base64) }));
  if (artifact.runtime === 'static-assets') return { runtime: 'static-assets', assets, notFoundHandling: artifact.notFoundHandling };
  if (artifact.runtime !== 'cloudflare-workers' || !Array.isArray(artifact.modules)) throw new Error('Unrecognized stored runtime artifact');
  return { runtime: 'cloudflare-workers', mainModule: artifact.mainModule!, assetsBinding: artifact.assetsBinding,
    compatibilityFlags: artifact.compatibilityFlags, notFoundHandling: artifact.notFoundHandling, assets,
    modules: artifact.modules.map(({ name, type, base64 }) => ({ name, type, bytes: decode(base64) })),
  };
}

export interface CloudflarePublicationPortOptions extends CloudflarePublicationProviderOptions {
  rootDomain: string;
  /** Trusted adapter for an isolated builder or retained prebuilt artifact store.
   * It must NOT execute snapshot files/scripts on the central server. For a
   * rollback return retained OLD content, but pass the NEW current snapshot. */
  isolatedBuilder: { build(snapshot: PublicationSnapshot): Promise<BuiltPublicationArtifact> };
}

/** Matches service.ts PublicationProvider exactly. The low-level provider above
 * stays independently usable; this factory bridges durable core checkpoints.
 *
 * Order: build -> stage -> verify(false) -> activate -> verify(true) -> DB RPC.
 * Before the final RPC, normal requests deny due to the release_id mismatch.
 * Core owns serialization/leases, current access policy, host ownership, and
 * database activation. Protected root probes check status 200 + nonempty body;
 * static roots additionally require <meta name="coden-release" content="ID">.
 * Runtime probes are root health checks, not a complete end-to-end app test.
 * Main must retain artifacts for content-only rollback.
 */
export function createCloudflarePublicationProvider(options: CloudflarePublicationPortOptions): PublicationProvider {
  const provider = new CloudflarePublicationProvider(options);
  const verified = new Map<string, VerifiedCloudflarePublication>();
  const primaryHost = (snapshot: PublicationSnapshot) => host(`${snapshot.settings.subdomain}.${options.rootDomain}`);
  const policyFor = (snapshot: PublicationSnapshot): PublicationProviderPolicy => ({
    revision: snapshot.fingerprint, primaryHost: primaryHost(snapshot), allowedHosts: [primaryHost(snapshot)],
    metadata: snapshot.settings.metadata,
  });
  const resume = (snapshot: PublicationSnapshot, checkpoint: CloudflarePublicationCandidateCheckpoint) => {
    const candidate = provider.resume(checkpoint);
    if (candidate.projectId !== snapshot.project_id || candidate.releaseId !== snapshot.id
      || candidate.policyRevision !== snapshot.fingerprint || policyKey(checkpoint.policy) !== policyKey(policyFor(snapshot))) throw new Error('Publication checkpoint does not match captured snapshot');
    return candidate;
  };
  return {
    async build(snapshot) {
      if (options.enabled !== true) throw new Error('Publication v2 Cloudflare provider is disabled');
      return serializeBuiltArtifact(await options.isolatedBuilder.build(snapshot));
    },
    async stage(snapshot, artifact, hostingId) {
      const staged = await provider.stage({ projectId: snapshot.project_id, releaseId: snapshot.id,
        policy: policyFor(snapshot), artifact: deserializeBuiltArtifact(artifact), hostingId });
      return provider.checkpoint(staged);
    },
    async verify(snapshot, checkpoint: CloudflarePublicationCandidateCheckpoint, live) {
      resume(snapshot, checkpoint); // Validate MAC even if an in-memory handle exists.
      if (!live) {
        verified.set(checkpoint.proof, await provider.verify(resume(snapshot, checkpoint)));
      } else {
        const candidate = verified.get(checkpoint.proof);
        if (!candidate) throw new Error('Candidate verification must precede live verification');
        await provider.verifyLive(candidate);
      }
    },
    async activate(snapshot, checkpoint: CloudflarePublicationCandidateCheckpoint, state, hosts) {
      const staged = resume(snapshot, checkpoint);
      if (state.project_id !== snapshot.project_id || hostingName(snapshot.project_id, state.hosting_id) !== staged.workerName) throw new Error('Publication state does not own candidate hosting');
      const candidate = verified.get(checkpoint.proof);
      if (!candidate) throw new Error('Candidate verification must precede activation');
      await provider.activate(candidate, policyFor(snapshot), [...new Set([...hosts, primaryHost(snapshot)])]);
    },
    async remove(state: PublicationState, hosts) {
      await provider.removeProject(state.project_id, state.hosting_id, hosts);
    },
  };
}
