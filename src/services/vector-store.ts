// Vector store — pluggable nearest-neighbor index for embeddings.
//
// Defines a small VectorStore interface so the semantic layer can run against
// an in-memory cosine index today and a Postgres `pgvector` table tomorrow
// without changing calling code. Ships the in-memory implementation plus SQL
// builders that a future pgvector adapter can use verbatim.
//
// Pure & unit-tested.

import { cosineSimilarity, type EmbeddingVector } from './embeddings.ts';

export type VectorRecord = {
  id: string;
  vector: EmbeddingVector;
  metadata?: Record<string, unknown>;
};

export type VectorSearchResult = {
  id: string;
  score: number; // cosine similarity, higher is better
  metadata?: Record<string, unknown>;
};

export interface VectorStore {
  upsert(records: VectorRecord[]): Promise<void> | void;
  query(vector: EmbeddingVector, topK: number): Promise<VectorSearchResult[]> | VectorSearchResult[];
  delete(ids: string[]): Promise<void> | void;
  size(): number;
  clear(): void;
}

/**
 * In-memory cosine-similarity store. Suitable for per-request project context
 * (tens to low-thousands of vectors). Linear scan — exact, no ANN approximation.
 */
export class InMemoryVectorStore implements VectorStore {
  private readonly records = new Map<string, VectorRecord>();

  upsert(records: VectorRecord[]): void {
    for (const r of records) {
      if (!r.id) continue;
      this.records.set(r.id, { id: r.id, vector: r.vector, metadata: r.metadata });
    }
  }

  query(vector: EmbeddingVector, topK = 15): VectorSearchResult[] {
    if (this.records.size === 0 || vector.length === 0) return [];
    const scored: VectorSearchResult[] = [];
    for (const r of this.records.values()) {
      scored.push({ id: r.id, score: cosineSimilarity(vector, r.vector), metadata: r.metadata });
    }
    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(0, topK))
      .filter(r => r.score > 0);
  }

  delete(ids: string[]): void {
    for (const id of ids) this.records.delete(id);
  }

  size(): number {
    return this.records.size;
  }

  clear(): void {
    this.records.clear();
  }
}

// ─── pgvector SQL builders (for a future Postgres-backed adapter) ──────────────
// These produce parameterized statements; the caller binds values. Kept here so
// the SQL contract is tested even before a live pgvector connection exists.

/** DDL to create a pgvector-backed table for a given embedding dimension. */
export function pgvectorCreateTableSql(table: string, dimensions: number): string {
  const t = sanitizeIdentifier(table);
  return [
    'CREATE EXTENSION IF NOT EXISTS vector;',
    `CREATE TABLE IF NOT EXISTS ${t} (`,
    '  id text PRIMARY KEY,',
    '  namespace text NOT NULL DEFAULT \'\',',
    `  embedding vector(${Number(dimensions)}) NOT NULL,`,
    '  metadata jsonb NOT NULL DEFAULT \'{}\'::jsonb,',
    '  updated_at timestamptz NOT NULL DEFAULT now()',
    ');',
    `CREATE INDEX IF NOT EXISTS ${t}_embedding_idx ON ${t} USING ivfflat (embedding vector_cosine_ops);`,
  ].join('\n');
}

/** Parameterized upsert. $1=id, $2=namespace, $3=embedding, $4=metadata. */
export function pgvectorUpsertSql(table: string): string {
  const t = sanitizeIdentifier(table);
  return (
    `INSERT INTO ${t} (id, namespace, embedding, metadata, updated_at) ` +
    'VALUES ($1, $2, $3, $4, now()) ' +
    'ON CONFLICT (id) DO UPDATE SET ' +
    'embedding = EXCLUDED.embedding, metadata = EXCLUDED.metadata, updated_at = now();'
  );
}

/**
 * Parameterized cosine-distance KNN query.
 * $1=query embedding, $2=namespace, $3=limit. Returns id, metadata and a
 * similarity score (1 - cosine distance) so higher is better, matching the
 * in-memory store's contract.
 */
export function pgvectorQuerySql(table: string): string {
  const t = sanitizeIdentifier(table);
  return (
    `SELECT id, metadata, 1 - (embedding <=> $1) AS score ` +
    `FROM ${t} WHERE namespace = $2 ` +
    'ORDER BY embedding <=> $1 ASC LIMIT $3;'
  );
}

/** Serialize a JS number[] into pgvector's textual literal: "[1,2,3]". */
export function toPgvectorLiteral(vector: EmbeddingVector): string {
  return `[${vector.map(n => (Number.isFinite(n) ? n : 0)).join(',')}]`;
}

function sanitizeIdentifier(name: string): string {
  const value = String(name || '');
  // Reject (don't silently strip) anything that isn't a plain SQL identifier,
  // so a caller can never smuggle injection through a table name.
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) {
    throw new Error(`Invalid SQL identifier: ${JSON.stringify(name)}`);
  }
  return value;
}
