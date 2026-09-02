import assert from 'node:assert/strict';
import { repairNarration, writingFileNarration } from './src/services/agent-narration.ts';

// Verification checks carry developer-facing English messages. Dumping one into
// the shimmer showed a non-technical user a rule they never wrote, in the wrong
// language. The file is the part that is safe, useful and needs no translation.
const leaky = [
  { key: 'fullstack_ai_secrets_server_side', file: 'src/lib/ai.ts', message: 'AI provider keys must be read in the server connector, not frontend files.' },
  { key: 'form_validation', file: 'src/App.tsx', message: 'Forms need validation and visible feedback.' },
];

for (const language of ['fr', 'en'] as const) {
  const line = repairNarration(leaky, language);
  assert.ok(line.includes('src/lib/ai.ts'), 'the file being repaired must be named');
  for (const internal of ['AI provider keys', 'server connector', 'fullstack_ai_secrets_server_side']) {
    assert.ok(!line.includes(internal), `internal wording must not reach the user: ${internal}`);
  }
  assert.ok(line.includes('1'), 'remaining issues are counted, not spelled out');
}

// One issue reads cleanly, with no dangling count.
assert.equal(repairNarration([{ file: 'src/App.tsx' }], 'fr'), 'Coden corrige src/App.tsx…');
assert.equal(repairNarration([{ file: 'src/App.tsx' }], 'en'), 'Coden is fixing src/App.tsx…');

// No usable file: stay general rather than invent a location or leak a message.
for (const issues of [
  [] as any[],
  [{ message: 'Preview HTML is empty.' }],
  [{ file: 'runtime', message: 'Preview raised runtime errors' }],
  [{ file: '   ' }],
]) {
  assert.equal(repairNarration(issues, 'fr'), 'Coden corrige les problèmes détectés…');
  assert.equal(repairNarration(issues, 'en'), 'Coden is fixing the detected issues…');
}

// Writing narration names the real file, and degrades safely.
assert.equal(writingFileNarration('src/App.tsx', 'fr'), 'Coden écrit src/App.tsx…');
assert.equal(writingFileNarration('src/App.tsx', 'en'), 'Coden is writing src/App.tsx…');
assert.equal(writingFileNarration('', 'fr'), 'Coden construit l’application…');

// Nothing in the narration may expose internal mechanics.
for (const line of [
  repairNarration(leaky, 'fr'),
  repairNarration(leaky, 'en'),
  writingFileNarration('src/App.tsx', 'fr'),
]) {
  for (const forbidden of ['model', 'modèle', 'fallback', 'secours', 'token', 'prompt', 'intent']) {
    assert.ok(!line.toLowerCase().includes(forbidden), `narration must not mention "${forbidden}": ${line}`);
  }
}

console.log('agent narration tests passed');
