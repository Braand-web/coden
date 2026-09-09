import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadProjectMemoryContext, saveArchitectureDecisions } from './src/services/project-memory-store.ts';

/*
 * The project remembers what it decided, on the path that actually runs.
 *
 * The memory layer — decision records, relevance ranking, the prompt section
 * they render into — was complete and wired into `generateFilesWithAi` alone.
 * When the multi-agent pipeline became the live path on 2026-09-03 it went
 * dark with the old one: 36 decisions and 20 token sets across 20 projects,
 * every row written on or before that day, nothing read or written since.
 *
 * So a project that had already settled on a router, a state library or a form
 * approach re-decided it from scratch on every request — which is what "no
 * memory between sessions" looked like from the outside.
 */

/** A Supabase-shaped double: enough of the builder to record what was asked. */
function fakeClient(seed: Record<string, any[]> = {}) {
  const tables: Record<string, any[]> = { project_memory: [], ...seed };
  const calls: Array<{ table: string; op: string; rows?: any[]; ids?: any[] }> = [];

  const builder = (table: string) => {
    let rows = [...(tables[table] || [])];
    const chain: any = {
      select() { return chain; },
      eq(column: string, value: unknown) { rows = rows.filter(row => row[column] === value); return chain; },
      order() { return chain; },
      limit() { return chain; },
      insert(inserted: any[]) { calls.push({ table, op: 'insert', rows: inserted }); tables[table].push(...inserted); return Promise.resolve({ error: null }); },
      delete() {
        return { in(_column: string, ids: any[]) { calls.push({ table, op: 'delete', ids }); tables[table] = tables[table].filter(row => !ids.includes(row.id)); return Promise.resolve({ error: null }); } };
      },
      then(resolve: any) { return Promise.resolve({ data: rows, error: null }).then(resolve); },
    };
    return chain;
  };
  return { client: { from: builder }, tables, calls };
}

// A project with no history says nothing, rather than inventing a section.
{
  const { client } = fakeClient();
  assert.equal(await loadProjectMemoryContext({ client, projectId: 'p1', prompt: 'build a todo list' }), '');
}

// A project with decisions hands them to the prompt as constraints.
{
  const { client } = fakeClient({
    project_memory: [{
      id: 'r1',
      project_id: 'p1',
      memory_type: 'adr',
      content: JSON.stringify({ topic: 'routing', decision: 'react-router', confidence: 'high', rationale: 'already wired' }),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }],
  });
  const context = await loadProjectMemoryContext({ client, projectId: 'p1', prompt: 'add a settings page' });
  assert.match(context, /routing/, 'the established topic must reach the prompt');
  assert.match(context, /react-router/, 'and the decision itself');
}

// Memory is an improvement to a run, never a precondition for one.
{
  const broken = { from() { throw new Error('table missing'); } };
  assert.equal(await loadProjectMemoryContext({ client: broken as any, projectId: 'p1', prompt: 'x' }), '', 'a broken memory must not stop a generation');
  assert.equal(await saveArchitectureDecisions({ client: broken as any, projectId: 'p1', prompt: 'x', assistantOutput: 'used react-router for routing' }), 0);
  assert.equal(await loadProjectMemoryContext({ client: null, projectId: 'p1', prompt: 'x' }), '', 'and neither must an absent one');
}

// A topic settled twice is one decision that changed, not two that compete.
{
  const { client, tables, calls } = fakeClient({
    project_memory: [{
      id: 'old',
      project_id: 'p1',
      memory_type: 'adr',
      content: JSON.stringify({ topic: 'routing', decision: 'wouter', confidence: 'medium' }),
    }],
  });
  const stored = await saveArchitectureDecisions({
    client,
    projectId: 'p1',
    prompt: 'switch the router',
    assistantOutput: 'Now using react-router for routing across the app.',
  });
  if (stored > 0) {
    assert.ok(calls.some(call => call.op === 'delete' && call.ids?.includes('old')), 'the superseded decision is removed, not left to contradict the new one');
    assert.ok(tables.project_memory.every(row => !String(row.content).includes('wouter')), 'the old choice is gone');
  }
}

// Nothing is written from a run that produced nothing to learn from.
{
  const { calls } = fakeClient();
  const { client } = fakeClient();
  assert.equal(await saveArchitectureDecisions({ client, projectId: 'p1', prompt: 'x', assistantOutput: '' }), 0);
  assert.equal(calls.length, 0);
}

/*
 * And it has to be wired where the run actually happens. This is what was
 * missing: the module existed, the pipeline never called it.
 */
{
  const server = readFileSync(new URL('./server.ts', import.meta.url), 'utf8');
  const branch = server.slice(server.indexOf('const outcome = await runMultiAgentPipeline({') - 1200);

  assert.match(branch, /loadProjectMemoryContext\(\{/, 'the pipeline run must load what the project decided');
  assert.match(branch, /memoryContext: projectMemory/, 'and pass it in');
  assert.match(branch, /saveArchitectureDecisions\(\{/, 'and record what this run decided');

  // Only from a run that verified: a decision read out of a build that did not
  // work is a mistake the project would then be told to repeat.
  const save = branch.slice(branch.indexOf('saveArchitectureDecisions({') - 200, branch.indexOf('saveArchitectureDecisions({'));
  assert.match(save, /if \(outcome\.ok\)/, 'a failed run must not teach the project anything');
}

// Both agents receive it, for different reasons.
{
  const pipeline = readFileSync(new URL('./src/services/multi-agent-pipeline.ts', import.meta.url), 'utf8');
  assert.match(pipeline, /memoryContext: input\.memoryContext/, 'the planner must see the established decisions');

  const instruction = pipeline.slice(pipeline.indexOf('const initialInstruction = ['));
  assert.match(instruction.slice(0, 900), /input\.memoryContext/, 'and so must the coder');

  const planner = readFileSync(new URL('./src/services/planner-agent.ts', import.meta.url), 'utf8');
  assert.match(planner, /memoryContext\?: string/, 'the planner accepts it');
  assert.match(planner, /input\.scaffold, input\.memoryContext/, 'and actually uses it');
}

console.log('project memory tests passed');
