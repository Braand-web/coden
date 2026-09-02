import assert from 'node:assert/strict';
import fs from 'node:fs';
import express from 'express';
import { CODEN_SSE_HEADERS, CODEN_STREAM_PROTOCOL_VERSION, serializeCodenStreamEvent } from './src/lib/stream-protocol.ts';

/**
 * What a streaming request gets when the route throws outside its own try.
 *
 * The generate route flushes its headers immediately so the client starts
 * reading at once, then runs 461 lines — loading files, the last plan, the
 * decision history, creating the run, saving the message — before its own try
 * block begins. Every one of those is a database call that can fail.
 *
 * The global error handler opened with `if (res.headersSent) return next(error)`,
 * placed above its own log line. For a streaming request headersSent is always
 * true, so a failure there did two things at once: Express destroyed the socket,
 * and the failure never reached the server log. The user saw a generation that
 * produced nothing and said nothing; the logs showed no generation at all.
 */

const isEventStreamResponse = (res: any) => {
  try { return String(res?.getHeader?.('Content-Type') || '').includes('text/event-stream'); } catch { return false; }
};

/** The route shape: headers flushed, then a throw from outside any try. */
function buildApp(rescue: boolean) {
  const app = express();
  app.post('/gen', async (_req: any, res: any) => {
    Object.entries(CODEN_SSE_HEADERS).forEach(([key, value]) => res.setHeader(key, value as string));
    res.flushHeaders();
    throw new Error('Supabase project file loading failed');
  });
  app.use((error: any, _req: any, res: any, next: any) => {
    if (rescue && res.headersSent && isEventStreamResponse(res) && !res.writableEnded) {
      const frame = (id: number, body: Record<string, unknown>) => serializeCodenStreamEvent({
        v: CODEN_STREAM_PROTOCOL_VERSION, runId: 'err', id, sequence: id, ts: Date.now(), ...body,
      } as any);
      res.write(frame(1, { type: 'error', message: 'The request could not be completed. Please retry in a moment.', recoverable: true, diagnostic_code: 'INTERNAL_SERVER_ERROR' }));
      res.write(frame(2, { type: 'done', payload: { status_code: 500, success: false } }));
      return res.end();
    }
    if (res.headersSent) return next(error);
    res.status(500).json({ error: String(error?.message) });
  });
  return app;
}

async function callGenerate(rescue: boolean) {
  const server = buildApp(rescue).listen(0);
  const port = (server.address() as any).port;
  let body = '';
  let transportError = '';
  try {
    body = await (await fetch(`http://127.0.0.1:${port}/gen`, { method: 'POST' })).text();
  } catch (error: any) {
    transportError = error?.cause?.code || error?.message || String(error);
  }
  server.close();
  return { body, transportError, types: [...body.matchAll(/"type":"(\w+)"/g)].map(match => match[1]) };
}

// Without the rescue the socket is destroyed: no bytes, no terminal event, and
// nothing that tells the client or the user what went wrong.
{
  const result = await callGenerate(false);
  assert.equal(result.body.length, 0, 'the unrescued stream delivers nothing at all');
  assert.deepEqual(result.types, []);
  assert.ok(result.transportError, 'the client is left with a raw transport failure');
}

// With it, the stream ends the way the protocol says it must: a typed error the
// interface can show, then exactly one terminal `done`.
{
  const result = await callGenerate(true);
  assert.equal(result.transportError, '', 'the response completes instead of dying');
  assert.deepEqual(result.types, ['error', 'done'], 'a failed stream still ends with error then done');
  assert.ok(result.body.includes('INTERNAL_SERVER_ERROR'), 'the client receives a diagnostic code');
  assert.ok(!result.body.includes('Supabase'), 'the internal message must not reach the user');
}

// The server must carry the same rescue, and log before deciding — the log line
// used to sit below the early return, so streaming failures were never recorded.
const server = fs.readFileSync(new URL('./server.ts', import.meta.url), 'utf8');
const handlerStart = server.indexOf('app.use((error: any, req: any, res: any, next: any) => {');
const handler = server.slice(handlerStart, handlerStart + 3200);

assert.ok(handler.includes('isEventStreamResponse(res)'), 'the handler must recognise an open stream');
assert.ok(
  handler.indexOf("console.error('[coden:api_unhandled_error]'") < handler.indexOf('if (res.headersSent) {'),
  'a streaming failure must be logged before the handler decides what to do with it',
);
assert.ok(
  /isEventStreamResponse\(res\)[\s\S]{0,900}type: 'done'/.test(handler),
  'an open stream must be closed with a terminal done event',
);
assert.ok(
  /type: 'error'[\s\S]{0,200}message: publicMessage/.test(handler),
  'the stream error must carry the public message, never the raw one',
);
assert.ok(handler.includes('return next(error);'), 'a non-streaming sent response still defers to Express');

console.log('stream error rescue tests passed');
