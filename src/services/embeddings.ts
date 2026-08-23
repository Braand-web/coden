// Embeddings — dense vector representations for semantic search.
//
// Coden's semantic-rag was TF-IDF only (sparse, lexical). This adds a real
// dense-embedding path that works in two modes:
//
//   • LocalHashEmbedder  — zero-dependency, deterministic feature-hashing
//     embedder. No API, no network. Captures token co-occurrence in a fixed
//     dense vector. Always available; used as the default + offline fallback.
//
//   • RemoteEmbedder     — calls an OpenAI-compatible /v1/embeddings endpoint
//     (OpenAI, OpenRouter, local TEI, etc.). Injectable fetch for testing.
//
// `resolveEmbeddingProvider(env)` picks the remote provider when an API key is
// configured, otherwise the local one — so the rest of the app never branches.
//
// Pure & unit-tested. The only impurity (network) lives behind an injected
// fetch so it is fully testable with a mock.

export type EmbeddingVector = number[];

export interface EmbeddingProvider {
  /** Output dimensionality of the vectors this provider returns. */
  readonly dimensions: number;
  /** Stable identifier (used as the vector-store namespace / column tag). */
  readonly id: string;
  /** Embed a batch of texts. Returns one vector per input, in order. */
  embed(texts: string[]): Promise<EmbeddingVector[]>;
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'was', 'this',
  'that', 'with', 'have', 'from', 'will', 'your', 'they', 'into', 'then', 'some',
  'const', 'return', 'type', 'export', 'import', 'function', 'class', 'async',
  'await', 'null', 'undefined', 'true', 'false',
]);

/** Tokenize text into normalized lowercase tokens (camel/kebab/snake aware). */
export function tokenizeForEmbedding(text: string): string[] {
  return String(text || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_./\\]/g, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2 && t.length < 40 && !STOP_WORDS.has(t));
}

/** Deterministic 32-bit FNV-1a hash, returned as an unsigned int. */
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Cosine similarity between two dense vectors (0 when either is zero-length). */
export function cosineSimilarity(a: EmbeddingVector, b: EmbeddingVector): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  // Account for any tail dimensions when lengths differ.
  for (let i = n; i < a.length; i++) normA += a[i] * a[i];
  for (let i = n; i < b.length; i++) normB += b[i] * b[i];
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

/** L2-normalize a vector in place and return it. */
function l2normalize(v: EmbeddingVector): EmbeddingVector {
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < v.length; i++) v[i] /= norm;
  }
  return v;
}

/**
 * Zero-dependency embedder using the hashing trick over unigrams + bigrams.
 * Deterministic and fast. Each token is hashed into a bucket; a second hash
 * decides the sign (reduces collisions cancelling out signal). The result is
 * L2-normalized so cosine similarity is well-behaved.
 */
export class LocalHashEmbedder implements EmbeddingProvider {
  readonly dimensions: number;
  readonly id: string;

  constructor(dimensions = 256) {
    this.dimensions = dimensions;
    this.id = `local-hash-${dimensions}`;
  }

  private embedOne(text: string): EmbeddingVector {
    const vec = new Array<number>(this.dimensions).fill(0);
    const tokens = tokenizeForEmbedding(text);
    if (tokens.length === 0) return vec;

    const add = (feature: string, weight: number) => {
      const h = fnv1a(feature);
      const bucket = h % this.dimensions;
      const sign = (fnv1a('s:' + feature) & 1) === 0 ? 1 : -1;
      vec[bucket] += sign * weight;
    };

    for (let i = 0; i < tokens.length; i++) {
      add(tokens[i], 1);
      if (i + 1 < tokens.length) add(tokens[i] + ' ' + tokens[i + 1], 0.5); // bigram
    }
    return l2normalize(vec);
  }

  async embed(texts: string[]): Promise<EmbeddingVector[]> {
    return texts.map(t => this.embedOne(t));
  }
}

export type RemoteEmbedderOptions = {
  apiKey: string;
  model?: string;
  endpoint?: string;
  dimensions?: number;
  /** Injected for testing; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Max texts per request (provider batch limit). */
  batchSize?: number;
};

/**
 * Calls an OpenAI-compatible embeddings endpoint. Works with OpenAI,
 * OpenRouter, and self-hosted TEI servers that speak the same shape.
 */
export class RemoteEmbedder implements EmbeddingProvider {
  readonly dimensions: number;
  readonly id: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;
  private readonly batchSize: number;

  constructor(opts: RemoteEmbedderOptions) {
    this.apiKey = opts.apiKey;
    this.model = opts.model || 'text-embedding-3-small';
    this.endpoint = opts.endpoint || 'https://api.openai.com/v1/embeddings';
    this.dimensions = opts.dimensions || 1536;
    this.id = `remote-${this.model}`;
    this.fetchImpl = opts.fetchImpl || (globalThis.fetch as typeof fetch);
    this.batchSize = Math.max(1, opts.batchSize || 96);
  }

  async embed(texts: string[]): Promise<EmbeddingVector[]> {
    if (texts.length === 0) return [];
    const out: EmbeddingVector[] = [];
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);
      const res = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ model: this.model, input: batch }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`Embeddings request failed: ${res.status} ${detail.slice(0, 200)}`);
      }
      const json = await res.json() as { data?: Array<{ embedding: number[]; index: number }> };
      const rows = (json.data || []).slice().sort((a, b) => a.index - b.index);
      for (const row of rows) out.push(row.embedding);
    }
    return out;
  }
}

/**
 * Pick the best available embedding provider for the current environment.
 * Remote when an API key is present, else the deterministic local embedder.
 */
export function resolveEmbeddingProvider(
  env: Record<string, string | undefined> = {},
  opts: { fetchImpl?: typeof fetch } = {},
): EmbeddingProvider {
  const apiKey = env.EMBEDDINGS_API_KEY || env.OPENAI_API_KEY;
  if (apiKey) {
    return new RemoteEmbedder({
      apiKey,
      model: env.EMBEDDINGS_MODEL || 'text-embedding-3-small',
      endpoint: env.EMBEDDINGS_ENDPOINT,
      dimensions: env.EMBEDDINGS_DIMENSIONS ? Number(env.EMBEDDINGS_DIMENSIONS) : undefined,
      fetchImpl: opts.fetchImpl,
    });
  }
  return new LocalHashEmbedder(Number(env.EMBEDDINGS_LOCAL_DIMENSIONS) || 256);
}

/** True when a real (network) embedding provider is configured. */
export function embeddingsConfigured(env: Record<string, string | undefined> = {}): boolean {
  return Boolean(env.EMBEDDINGS_API_KEY || env.OPENAI_API_KEY);
}
