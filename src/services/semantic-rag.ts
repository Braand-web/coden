/**
 * Semantic RAG — lightweight TF-IDF semantic search for file context selection.
 *
 * Zero external dependencies. Works purely in Node.js with no embedding APIs.
 * Optional upgrade path: when pgvector + OpenAI embeddings are configured,
 * falls back gracefully to TF-IDF.
 *
 * How it works:
 * 1. Build a TF-IDF index over project files (path + content keywords)
 * 2. Score each file against the query using cosine similarity on TF-IDF vectors
 * 3. Return ranked files — most semantically relevant first
 *
 * This solves: "Coden injects wrong files on 50+ file projects"
 */

import type { EmbeddingProvider } from './embeddings.ts';
import { InMemoryVectorStore } from './vector-store.ts';

export type RagDocument = {
  id: string;         // file path
  content: string;    // file content
  metadata?: Record<string, unknown>;
};

export type RagResult = {
  id: string;
  score: number;      // 0–1 cosine similarity
  excerpt: string;    // first 200 chars of content
};

// ─── TF-IDF implementation ────────────────────────────────────────────────────

/**
 * Tokenizes text into lowercase alphanumeric tokens, removing noise.
 * Handles camelCase, kebab-case, snake_case by splitting on boundaries.
 */
function tokenize(text: string): string[] {
  return text
    .replace(/([a-z])([A-Z])/g, '$1 $2')   // camelCase → camel Case
    .replace(/[-_./\\]/g, ' ')              // separators → space
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2 && t.length < 40)
    .filter(t => !STOP_WORDS.has(t));
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'her', 'was',
  'one', 'our', 'out', 'use', 'any', 'had', 'his', 'how', 'its', 'may', 'new',
  'now', 'old', 'see', 'two', 'way', 'who', 'boy', 'did', 'get', 'has', 'him',
  'let', 'put', 'say', 'she', 'too', 'via', 'from', 'that', 'this', 'with',
  'have', 'more', 'will', 'your', 'been', 'were', 'they', 'than', 'into',
  'then', 'some', 'what', 'when', 'which', 'there', 'their', 'about', 'would',
  'these', 'other', 'could', 'after', 'first', 'also', 'being', 'each', 'here',
  'const', 'return', 'type', 'interface', 'export', 'import', 'function', 'class',
  'async', 'await', 'null', 'undefined', 'true', 'false', 'string', 'number',
  'boolean', 'object', 'array', 'void', 'never', 'unknown', 'any',
]);

type TfIdfIndex = {
  documents: Array<{ id: string; tokens: string[]; tf: Map<string, number> }>;
  idf: Map<string, number>;
  totalDocs: number;
};

function buildTfIdfIndex(documents: RagDocument[]): TfIdfIndex {
  const docs = documents.map(doc => {
    // Weight path tokens 3× higher than content tokens (path is more signal-dense)
    const pathTokens = tokenize(doc.id).flatMap(t => [t, t, t]);
    const contentTokens = tokenize(doc.content.slice(0, 8000)); // cap at 8k chars
    const tokens = [...pathTokens, ...contentTokens];

    // Term frequency: count / total
    const termCount = new Map<string, number>();
    for (const t of tokens) termCount.set(t, (termCount.get(t) || 0) + 1);
    const tf = new Map<string, number>();
    for (const [term, count] of termCount) {
      tf.set(term, count / tokens.length);
    }

    return { id: doc.id, tokens, tf };
  });

  // Inverse document frequency: log(N / df)
  const dfCount = new Map<string, number>();
  for (const doc of docs) {
    const seen = new Set(doc.tokens);
    for (const t of seen) dfCount.set(t, (dfCount.get(t) || 0) + 1);
  }
  const idf = new Map<string, number>();
  const N = docs.length || 1;
  for (const [term, df] of dfCount) {
    idf.set(term, Math.log((N + 1) / (df + 1)) + 1); // smoothed IDF
  }

  return { documents: docs, idf, totalDocs: N };
}

function tfidfVector(tokens: string[], tf: Map<string, number>, idf: Map<string, number>): Map<string, number> {
  const vector = new Map<string, number>();
  const seen = new Set(tokens);
  for (const term of seen) {
    const tfVal = tf.get(term) || 0;
    const idfVal = idf.get(term) || 0;
    vector.set(term, tfVal * idfVal);
  }
  return vector;
}

function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (const [term, val] of a) {
    dot += val * (b.get(term) || 0);
    normA += val * val;
  }
  for (const val of b.values()) normB += val * val;

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export class SemanticRag {
  private index: TfIdfIndex | null = null;
  private documents: RagDocument[] = [];

  /**
   * Index a set of documents. Call this once per project context,
   * then call `search()` multiple times cheaply.
   */
  index_documents(documents: RagDocument[]): void {
    this.documents = documents;
    this.index = buildTfIdfIndex(documents);
  }

  /**
   * Search for the top-k most relevant documents for a query.
   * Returns results sorted by descending similarity score.
   */
  search(query: string, topK = 15): RagResult[] {
    if (!this.index || this.documents.length === 0) return [];

    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return [];

    // Build query TF-IDF vector
    const queryTf = new Map<string, number>();
    for (const t of queryTokens) queryTf.set(t, (queryTf.get(t) || 0) + 1 / queryTokens.length);
    const queryVec = tfidfVector(queryTokens, queryTf, this.index.idf);

    // Score each document
    const scored: RagResult[] = this.index.documents.map(doc => {
      const docVec = tfidfVector(doc.tokens, doc.tf, this.index!.idf);
      const score = cosineSimilarity(queryVec, docVec);
      const sourceDoc = this.documents.find(d => d.id === doc.id);
      return {
        id: doc.id,
        score,
        excerpt: String(sourceDoc?.content || '').slice(0, 200),
      };
    });

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .filter(r => r.score > 0);
  }

  /**
   * Convenience: index + search in one call.
   */
  static retrieve(documents: RagDocument[], query: string, topK = 15): RagResult[] {
    const rag = new SemanticRag();
    rag.index_documents(documents);
    return rag.search(query, topK);
  }

  /**
   * Dense-embedding search. Embeds the documents and the query with the given
   * provider, ranks by cosine similarity in a vector store, and falls back to
   * TF-IDF when embeddings are unavailable or fail (so callers never break).
   *
   * This is the pgvector-ready upgrade path: swap InMemoryVectorStore for a
   * pgvector adapter and the ranking contract is identical.
   */
  static async retrieveSemantic(
    documents: RagDocument[],
    query: string,
    provider: EmbeddingProvider,
    topK = 15,
  ): Promise<RagResult[]> {
    if (documents.length === 0 || !query.trim()) return [];
    try {
      const [queryVec] = await provider.embed([query]);
      if (!queryVec || queryVec.length === 0) return SemanticRag.retrieve(documents, query, topK);

      const docVectors = await provider.embed(documents.map(d => `${d.id}\n${(d.content || '').slice(0, 8000)}`));
      const store = new InMemoryVectorStore();
      store.upsert(documents.map((d, i) => ({ id: d.id, vector: docVectors[i] || [], metadata: { excerpt: String(d.content || '').slice(0, 200) } })));

      return store.query(queryVec, topK).map(r => ({
        id: r.id,
        score: r.score,
        excerpt: String((r.metadata?.excerpt as string) || ''),
      }));
    } catch {
      // Any embedding failure → graceful TF-IDF fallback.
      return SemanticRag.retrieve(documents, query, topK);
    }
  }

  /**
   * Returns files most relevant to a query — ready for context injection.
   * Merges semantic results with always-critical files.
   */
  static selectRelevantFiles(
    files: Array<{ path: string; content: string; language?: string }>,
    query: string,
    options: {
      topK?: number;
      alwaysCritical?: RegExp[];
      tokenBudget?: number;
    } = {},
  ): Array<{ path: string; content: string; language?: string; ragScore: number }> {
    const topK = options.topK ?? 20;
    const tokenBudget = options.tokenBudget ?? 80_000;
    const alwaysCritical = options.alwaysCritical ?? DEFAULT_CRITICAL_PATTERNS;

    const docs: RagDocument[] = files.map(f => ({ id: f.path, content: f.content || '' }));
    const results = SemanticRag.retrieve(docs, query, topK);
    const scoreById = new Map(results.map(r => [r.id, r.score]));
    return assembleRankedSelection(files, scoreById, alwaysCritical, tokenBudget);
  }

  /**
   * Same contract as `selectRelevantFiles` but scores files with dense
   * embeddings (pgvector-ready). Critical-file pinning and token budgeting are
   * identical. Falls back to TF-IDF scoring inside `retrieveSemantic` if the
   * provider errors, so callers get a result either way.
   */
  static async selectRelevantFilesSemantic(
    files: Array<{ path: string; content: string; language?: string }>,
    query: string,
    provider: EmbeddingProvider,
    options: { topK?: number; alwaysCritical?: RegExp[]; tokenBudget?: number } = {},
  ): Promise<Array<{ path: string; content: string; language?: string; ragScore: number }>> {
    const topK = options.topK ?? 20;
    const tokenBudget = options.tokenBudget ?? 80_000;
    const alwaysCritical = options.alwaysCritical ?? DEFAULT_CRITICAL_PATTERNS;

    const docs: RagDocument[] = files.map(f => ({ id: f.path, content: f.content || '' }));
    const results = await SemanticRag.retrieveSemantic(docs, query, provider, topK);
    const scoreById = new Map(results.map(r => [r.id, r.score]));
    return assembleRankedSelection(files, scoreById, alwaysCritical, tokenBudget);
  }
}

const DEFAULT_CRITICAL_PATTERNS: RegExp[] = [
  /^package\.json$/i,
  /^index\.html$/i,
  /^vite\.config\./i,
  /^src\/main\.(t|j)sx?$/i,
  /^src\/App\.(t|j)sx?$/i,
  /^supabase\/schema\.sql$/i,
];

/**
 * Shared ranking assembly: pins critical files first, orders the rest by score,
 * then greedily fills up to the token budget. Used by both the TF-IDF and the
 * embeddings selection paths so their output contracts stay identical.
 */
function assembleRankedSelection(
  files: Array<{ path: string; content: string; language?: string }>,
  scoreById: Map<string, number>,
  alwaysCritical: RegExp[],
  tokenBudget: number,
): Array<{ path: string; content: string; language?: string; ragScore: number }> {
  const criticalPaths = new Set(files.filter(f => alwaysCritical.some(p => p.test(f.path))).map(f => f.path));

  const ranked = files
    .map(f => ({ ...f, ragScore: scoreById.get(f.path) ?? 0 }))
    .sort((a, b) => {
      const aCrit = criticalPaths.has(a.path) ? 1 : 0;
      const bCrit = criticalPaths.has(b.path) ? 1 : 0;
      if (aCrit !== bCrit) return bCrit - aCrit;
      return b.ragScore - a.ragScore;
    });

  const selected: typeof ranked = [];
  let usedTokens = 0;
  for (const file of ranked) {
    const tokens = Math.ceil((file.content || '').length / 4);
    if (usedTokens + tokens > tokenBudget) continue;
    selected.push(file);
    usedTokens += tokens;
  }
  return selected;
}
