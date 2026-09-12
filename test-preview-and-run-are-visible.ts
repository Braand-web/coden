import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { previewErrorDocument } from './src/services/sandbox/preview-proxy.ts';

/*
 * Two failures that ran indefinitely because nothing recorded them.
 *
 * Production, 2026-09-12, 02:47 → 02:53: `/preview/<token>/` answered 502 on
 * every request, dozens of them over five minutes. The application's own logs
 * for that window contain no line about the preview at all — not one. The only
 * evidence the outage existed was the edge proxy's status codes.
 *
 * The same window produced six pieces of work and one `agent_runs` row.
 */

const server = readFileSync(new URL('./server.ts', import.meta.url), 'utf8');

/*
 * ONE — a preview that cannot be served says so, in the logs and on screen.
 */
{
  const route = server.slice(server.indexOf('app.all(/^\\/preview\\/'), server.indexOf('app.use(express.static('));

  assert.match(route, /\[coden:preview_not_running\]/, 'a preview that is not running is logged');
  assert.match(route, /\[coden:preview_proxy_failed\]/, 'and so is a dev server that stops answering');
  assert.match(route, /project_id: grant\.projectId/, 'with the project, so it can be traced to one user');

  /*
   * The response is rendered inside the builder's iframe, so it has to be a
   * document. A raw `{"error":"preview_not_running"}` filling the preview pane
   * is what a user reads as "the application it generated is broken" — and
   * this is the ordinary state after every deploy, because the registry is an
   * in-memory Map that a restart empties.
   */
  assert.match(route, /previewErrorDocument\(/, 'the iframe is given a document, not a payload');
  assert.match(route, /content-type', 'text\/html; charset=utf-8'/, 'declared as one');
}

/*
 * The proxy tells the sandbox when its port stops answering.
 *
 * This is the loop that made the outage permanent. `child.on('close')` is the
 * only thing that corrects the state, and it fires only when Node reaps the
 * child. A dev server whose process survives but whose socket is gone leaves
 * `state: 'running'` with a port pointing at nothing — so `resumeLivePreview`
 * kept reattaching to it, and `ensureLivePreview`, the one thing that would
 * have fixed it, was never reached.
 */
{
  const proxy = readFileSync(new URL('./src/services/sandbox/preview-proxy.ts', import.meta.url), 'utf8');
  assert.match(proxy, /onError\?: \(error: Error\) => void,/, 'the proxy can report an unreachable upstream');
  assert.match(proxy, /onError\?\.\(error as Error\);/, 'and does so before answering');

  const sandbox = readFileSync(new URL('./src/services/sandbox/project-sandbox.ts', import.meta.url), 'utf8');
  const mark = sandbox.slice(sandbox.indexOf('markUnreachable(reason: string)'), sandbox.indexOf('getLogs(limit = 120)'));
  assert.match(mark, /this\.state = 'crashed';/, 'an unreachable sandbox stops claiming to be running');
  assert.match(mark, /this\.port = null;/, 'and stops advertising a port that answers nothing');
  assert.match(mark, /if \(this\.state !== 'running' && this\.state !== 'starting'\) return;/,
    'a sandbox that already knows it is stopped is not overwritten');

  assert.match(server, /sandbox\.markUnreachable\(/, 'the route connects the two');

  // And the client must then restart rather than reattach.
  const live = readFileSync(new URL('./src/builder-live.ts', import.meta.url), 'utf8');
  const resume = live.slice(live.indexOf('async function resumeLivePreview'), live.indexOf('async function ensureLivePreview'));
  assert.match(resume, /if \(!url \|\| status\?\.state !== 'running'\) return false;/,
    'a crashed sandbox falls through to the restart path');
}

/*
 * The document is a document, and it escapes what it is given.
 *
 * The detail line carries a dev server's own error text, which is neither
 * trusted nor controlled by us.
 */
{
  const html = previewErrorDocument('Titre', 'Message', '<script>alert(1)</script>');
  assert.match(html, /^<!doctype html>/, 'it is a document');
  assert.match(html, /<title>Titre<\/title>/, 'with the title it was given');
  assert.match(html, /Message/, 'and the message');
  assert.doesNotMatch(html, /<script>alert/, 'the detail is escaped, never executed');
  assert.match(html, /&lt;script&gt;/, 'and is still readable once escaped');

  // No detail, no empty element.
  assert.doesNotMatch(previewErrorDocument('A', 'B'), /<code>/, 'an absent detail renders nothing');

  // It is read in a builder that can be in either theme.
  assert.match(html, /color-scheme: light dark/, 'it is legible in both themes');
}

/*
 * TWO — the run that did the work records that it happened.
 *
 * `createAgentRun` sits below the multi-agent branch, so every build and edit
 * that went through the pipeline returned without writing a row. The session
 * above proves it: six pieces of work, one run row, and that row was the
 * clarification that took the other branch.
 */
{
  const branch = server.slice(server.indexOf("if (process.env.CODEN_MULTI_AGENT_PIPELINE === '1' && pipelineRoute)"));
  const opening = branch.slice(0, branch.indexOf('const routingPlan ='));

  assert.match(opening, /pipelineRunId = \(await createAgentRun\(/, 'the pipeline opens a run');
  assert.match(opening, /pipeline: 'multi_agent', route: pipelineRoute/, 'recording which path it took');

  // Opened before the work, so a run that never returns is still visible as
  // one that started.
  assert.ok(
    branch.indexOf('createAgentRun(') < branch.indexOf('runMultiAgentPipeline({'),
    'the run is opened before the work, not after it succeeds',
  );

  // Bookkeeping never fails a run that produced an application.
  assert.match(opening, /\[coden:pipeline_run_create_failed\]/, 'a failed run row is logged, not thrown');
}

{
  const respond = server.slice(
    server.indexOf(`let pipelineRunId = '';`),
    server.indexOf("if (status < 400 && payload.pipeline === 'multi_agent')"),
  );

  assert.match(respond, /if \(pipelineRunId\) \{/, 'the run is settled on the way out');
  assert.match(respond, /const terminal = status === 499 \? 'cancelled' : status >= 400 \|\| payload\.success === false \? 'failed' : 'completed';/,
    'with the outcome the response actually carries');
  assert.match(respond, /effective_model: payload\.model \|\| null,/, 'and the model that really served it');
  assert.match(respond, /\[coden:pipeline_run_status_failed\]/, 'a failed settle is logged, not thrown');
  assert.match(respond, /pipelineRunId = '';/, 'and a run is settled once, not on every response');

  /*
   * `updateAgentRunStatus` derives duration_ms from the row's own created_at
   * on a terminal status, so opening the run is what makes the latency of the
   * building path measurable at all.
   */
  assert.match(server, /const TERMINAL_RUN_STATUSES = \['completed', 'failed', 'cancelled'\];/, 'and the duration follows from that');
}

console.log('preview and run are visible tests passed');
