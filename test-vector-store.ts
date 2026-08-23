import assert from 'node:assert/strict';
import {
  InMemoryVectorStore,
  pgvectorCreateTableSql,
  pgvectorUpsertSql,
  pgvectorQuerySql,
  toPgvectorLiteral,
} from './src/services/vector-store.ts';

// ── InMemoryVectorStore: upsert, query, ranking ───────────────────────────────
{
  const store = new InMemoryVectorStore();
  store.upsert([
    { id: 'a', vector: [1, 0, 0], metadata: { path: 'a.ts' } },
    { id: 'b', vector: [0, 1, 0], metadata: { path: 'b.ts' } },
    { id: 'c', vector: [0.9, 0.1, 0], metadata: { path: 'c.ts' } },
  ]);
  assert.equal(store.size(), 3);

  const results = store.query([1, 0, 0], 2);
  assert.equal(results.length, 2);
  // 'a' is identical → highest; 'c' is close → second.
  assert.equal(results[0].id, 'a');
  assert.equal(results[1].id, 'c');
  assert.ok(results[0].score > results[1].score);
  assert.deepEqual(results[0].metadata, { path: 'a.ts' });
}

// ── upsert overwrites by id ───────────────────────────────────────────────────
{
  const store = new InMemoryVectorStore();
  store.upsert([{ id: 'x', vector: [1, 0] }]);
  store.upsert([{ id: 'x', vector: [0, 1] }]);
  assert.equal(store.size(), 1);
  const r = store.query([0, 1], 1);
  assert.ok(r[0].score > 0.99, 'updated vector is used');
}

// ── delete + clear ────────────────────────────────────────────────────────────
{
  const store = new InMemoryVectorStore();
  store.upsert([{ id: 'a', vector: [1, 0] }, { id: 'b', vector: [0, 1] }]);
  store.delete(['a']);
  assert.equal(store.size(), 1);
  store.clear();
  assert.equal(store.size(), 0);
  assert.deepEqual(store.query([1, 0], 5), []);
}

// ── empty store / empty query vector ──────────────────────────────────────────
{
  const store = new InMemoryVectorStore();
  assert.deepEqual(store.query([1, 2, 3], 5), []);
  store.upsert([{ id: 'a', vector: [1, 0] }]);
  assert.deepEqual(store.query([], 5), []);
}

// ── orthogonal vectors filtered out (score 0) ─────────────────────────────────
{
  const store = new InMemoryVectorStore();
  store.upsert([{ id: 'a', vector: [0, 1] }]);
  assert.deepEqual(store.query([1, 0], 5), [], 'zero-score results filtered');
}

// ── pgvector SQL builders ─────────────────────────────────────────────────────
{
  const ddl = pgvectorCreateTableSql('coden_vectors', 1536);
  assert.match(ddl, /CREATE EXTENSION IF NOT EXISTS vector/);
  assert.match(ddl, /vector\(1536\)/);
  assert.match(ddl, /ivfflat/);
  assert.match(ddl, /vector_cosine_ops/);

  const upsert = pgvectorUpsertSql('coden_vectors');
  assert.match(upsert, /INSERT INTO coden_vectors/);
  assert.match(upsert, /ON CONFLICT \(id\) DO UPDATE/);

  const query = pgvectorQuerySql('coden_vectors');
  assert.match(query, /1 - \(embedding <=> \$1\) AS score/);
  assert.match(query, /ORDER BY embedding <=> \$1 ASC LIMIT \$3/);
}

// ── identifier sanitization blocks injection ──────────────────────────────────
{
  assert.throws(() => pgvectorUpsertSql('foo; DROP TABLE bar;--'), /Invalid SQL identifier/);
  assert.throws(() => pgvectorCreateTableSql('123bad', 4), /Invalid SQL identifier/);
}

// ── pgvector literal serialization ────────────────────────────────────────────
{
  assert.equal(toPgvectorLiteral([1, 2, 3]), '[1,2,3]');
  assert.equal(toPgvectorLiteral([0.5, -0.25]), '[0.5,-0.25]');
  assert.equal(toPgvectorLiteral([NaN, 1]), '[0,1]', 'non-finite coerced to 0');
}

console.log('test-vector-store passed');
