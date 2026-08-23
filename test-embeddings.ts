import assert from 'node:assert/strict';
import {
  LocalHashEmbedder,
  RemoteEmbedder,
  resolveEmbeddingProvider,
  embeddingsConfigured,
  cosineSimilarity,
  tokenizeForEmbedding,
} from './src/services/embeddings.ts';

// ── tokenizer ────────────────────────────────────────────────────────────────
{
  const toks = tokenizeForEmbedding('buildUserDashboard-component.tsx');
  assert.ok(toks.includes('build'));
  assert.ok(toks.includes('user'));
  assert.ok(toks.includes('dashboard'));
  assert.ok(toks.includes('component'));
  // stop words / short tokens removed
  assert.ok(!toks.includes('the'));
}

// ── LocalHashEmbedder: deterministic, normalized, semantic-ish ────────────────
{
  const embedder = new LocalHashEmbedder(128);
  assert.equal(embedder.dimensions, 128);
  assert.equal(embedder.id, 'local-hash-128');

  const [a1] = await embedder.embed(['user authentication login form']);
  const [a2] = await embedder.embed(['user authentication login form']);
  // deterministic
  assert.deepEqual(a1, a2);
  assert.equal(a1.length, 128);

  // L2-normalized → norm ~1
  const norm = Math.sqrt(a1.reduce((s, x) => s + x * x, 0));
  assert.ok(Math.abs(norm - 1) < 1e-9, `norm should be ~1, got ${norm}`);

  // Similar texts score higher than unrelated texts.
  const [login] = await embedder.embed(['user login authentication password']);
  const [signup] = await embedder.embed(['user signup registration authentication']);
  const [pizza] = await embedder.embed(['pizza recipe tomato cheese oven']);
  const simRelated = cosineSimilarity(login, signup);
  const simUnrelated = cosineSimilarity(login, pizza);
  assert.ok(simRelated > simUnrelated, `related (${simRelated}) should beat unrelated (${simUnrelated})`);

  // Empty text → zero vector → cosine 0
  const [empty] = await embedder.embed(['']);
  assert.equal(cosineSimilarity(empty, login), 0);
}

// ── cosineSimilarity edge cases ───────────────────────────────────────────────
{
  assert.equal(cosineSimilarity([], []), 0);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.ok(Math.abs(cosineSimilarity([1, 1], [1, 1]) - 1) < 1e-9);
}

// ── resolveEmbeddingProvider: picks local when no key, remote when key set ─────
{
  const local = resolveEmbeddingProvider({});
  assert.ok(local instanceof LocalHashEmbedder);
  assert.equal(embeddingsConfigured({}), false);

  const remote = resolveEmbeddingProvider({ EMBEDDINGS_API_KEY: 'sk-test' });
  assert.ok(remote instanceof RemoteEmbedder);
  assert.equal(embeddingsConfigured({ EMBEDDINGS_API_KEY: 'sk-test' }), true);
  assert.equal(embeddingsConfigured({ OPENAI_API_KEY: 'sk-test' }), true);
}

// ── RemoteEmbedder: uses injected fetch, parses + orders response ─────────────
{
  let captured: any = null;
  const fakeFetch = (async (_url: string, init: any) => {
    captured = JSON.parse(init.body);
    // Return out-of-order to verify sorting by index.
    return {
      ok: true,
      json: async () => ({
        data: [
          { index: 1, embedding: [0.4, 0.5, 0.6] },
          { index: 0, embedding: [0.1, 0.2, 0.3] },
        ],
      }),
    };
  }) as unknown as typeof fetch;

  const remote = new RemoteEmbedder({ apiKey: 'k', model: 'text-embedding-3-small', dimensions: 3, fetchImpl: fakeFetch });
  const vecs = await remote.embed(['first', 'second']);
  assert.equal(captured.model, 'text-embedding-3-small');
  assert.deepEqual(captured.input, ['first', 'second']);
  assert.deepEqual(vecs[0], [0.1, 0.2, 0.3], 'index 0 first');
  assert.deepEqual(vecs[1], [0.4, 0.5, 0.6], 'index 1 second');
}

// ── RemoteEmbedder: throws on non-ok ──────────────────────────────────────────
{
  const failFetch = (async () => ({ ok: false, status: 429, text: async () => 'rate limited' })) as unknown as typeof fetch;
  const remote = new RemoteEmbedder({ apiKey: 'k', fetchImpl: failFetch });
  await assert.rejects(() => remote.embed(['x']), /429/);
}

// ── RemoteEmbedder: empty input short-circuits (no fetch) ──────────────────────
{
  let called = false;
  const spyFetch = (async () => { called = true; return { ok: true, json: async () => ({ data: [] }) }; }) as unknown as typeof fetch;
  const remote = new RemoteEmbedder({ apiKey: 'k', fetchImpl: spyFetch });
  const out = await remote.embed([]);
  assert.deepEqual(out, []);
  assert.equal(called, false);
}

console.log('test-embeddings passed');
