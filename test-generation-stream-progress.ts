import assert from 'node:assert/strict';
import { GenerationProgressScanner, type GenerationProgressEvent } from './src/services/generation-stream-progress.ts';

/** Feed a full answer in small slices, the way the provider streams it. */
function replay(answer: string, sliceSize = 37): GenerationProgressEvent[] {
  const scanner = new GenerationProgressScanner();
  const events: GenerationProgressEvent[] = [];
  let sent = '';
  for (let i = 0; i < answer.length; i += sliceSize) {
    sent += answer.slice(i, i + sliceSize);
    events.push(...scanner.push(sent));
  }
  events.push(...scanner.finish());
  return events;
}

const body = (n: number) => 'x'.repeat(n);

// The JSON envelope the generator normally returns.
{
  const answer = JSON.stringify({
    appName: 'ClairListe',
    files: [
      { path: 'index.html', content: body(900) },
      { path: 'src/App.tsx', content: body(1500) },
      { path: 'src/index.css', content: body(500) },
    ],
  });
  const events = replay(answer);
  const started = events.filter(e => e.type === 'file_start').map(e => e.path);
  assert.deepEqual(started, ['index.html', 'src/App.tsx', 'src/index.css'], 'every file must be announced in order');

  const done = events.filter(e => e.type === 'file_done').map(e => e.path);
  assert.deepEqual(done, ['index.html', 'src/App.tsx', 'src/index.css'], 'every file must be closed exactly once');

  // Progress has to actually move while a large file streams.
  const appDeltas = events.filter(e => e.type === 'file_delta' && e.path === 'src/App.tsx');
  assert.ok(appDeltas.length >= 2, `a 1500-char file must report progress, got ${appDeltas.length}`);
  for (let i = 1; i < appDeltas.length; i += 1) {
    assert.ok(
      (appDeltas[i] as any).chars > (appDeltas[i - 1] as any).chars,
      'reported progress must never go backwards',
    );
  }
  // file_start indexes are 1-based and strictly increasing.
  const indexes = events.filter(e => e.type === 'file_start').map(e => (e as any).index);
  assert.deepEqual(indexes, [1, 2, 3]);
}

// The markdown fence form the parser also accepts.
{
  const answer = ['Voici l application.', '', '```tsx src/App.tsx', body(800), '```', '', '```css src/index.css', body(600), '```'].join('\n');
  const started = replay(answer).filter(e => e.type === 'file_start').map(e => e.path);
  assert.deepEqual(started, ['src/App.tsx', 'src/index.css']);
}

// A path must never be announced twice, however the slices fall.
{
  const answer = JSON.stringify({ files: [{ path: 'src/App.tsx', content: body(300) }] });
  for (const slice of [1, 3, 11, 500]) {
    const scanner = new GenerationProgressScanner();
    const events: GenerationProgressEvent[] = [];
    let sent = '';
    for (let i = 0; i < answer.length; i += slice) {
      sent += answer.slice(i, i + slice);
      events.push(...scanner.push(sent));
    }
    events.push(...scanner.finish());
    const starts = events.filter(e => e.type === 'file_start');
    assert.equal(starts.length, 1, `slice ${slice}: exactly one file_start`);
    assert.equal(starts[0].path, 'src/App.tsx', `slice ${slice}: correct path`);
  }
}

// Nothing to report is not an error: prose answers and empty streams stay quiet.
{
  assert.deepEqual(replay('Je vais construire une liste de tâches.'), []);
  const empty = new GenerationProgressScanner();
  assert.deepEqual(empty.push(''), []);
  assert.deepEqual(empty.finish(), []);
}

console.log('generation stream progress tests passed');
