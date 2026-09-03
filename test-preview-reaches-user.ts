import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * The preview has to reach the user, including when verification is unhappy.
 *
 * This is the defect that made the product look broken: the generate route
 * returns early whenever strict verification did not fully pass — which needs
 * the pipeline ready, the reliability summary passed *and* a real browser
 * runner result, so it is the common case, not the edge one. The sandbox was
 * started after that branch. The result was that a build carrying any warning
 * produced a blank panel, while a dev server that would have served the
 * application perfectly well was never asked to start.
 *
 * The assertions are on the route's structure rather than on a response,
 * because the failure is structural: it is about which statement runs before
 * which return. A behavioural test would need a live model and would pass
 * against the broken code whenever verification happened to succeed.
 */

const server = readFileSync('./server.ts', 'utf8');

const generateStart = server.indexOf("app.post('/api/projects/:id/generate'");
assert.ok(generateStart > 0, 'the generate route must be findable');
const route = server.slice(generateStart, server.indexOf('\napp.post(', generateStart + 100));

const sandboxLaunch = route.indexOf('livePreview = await applyProjectEdit(');
const needsFixBranch = route.indexOf('if (runnerSkipped || shouldDeliverRecoverableDraft(reliabilitySummary)) {');
const happyPathSave = route.indexOf('await saveProject(updatedProject, finalFiles);');

assert.ok(sandboxLaunch > 0, 'the route must launch the sandbox');
assert.ok(needsFixBranch > 0, 'the needs_fix branch must still exist');
assert.ok(happyPathSave > 0, 'the verified path must still save the project');

// The ordering that is the whole point: the application comes up before the
// branch that can return without it.
assert.ok(
  sandboxLaunch < needsFixBranch,
  'the sandbox must start before the needs_fix branch, or a run with any verification warning shows the user nothing',
);
assert.ok(
  sandboxLaunch < happyPathSave,
  'and before the verified path, so both outcomes carry a running application',
);

/**
 * Both terminal payloads have to hand the URL over.
 *
 * Starting the sandbox and then not telling the client about it is the same
 * blank panel with more electricity spent.
 */
// Located by index rather than by a regex over a 65k slice: a lazy pattern
// stops at the first nested brace and quietly matches nothing useful.
const payloads: string[] = [];
for (let at = route.indexOf('preview: {'); at !== -1; at = route.indexOf('preview: {', at + 1)) {
  payloads.push(route.slice(at, at + 500));
}
assert.ok(payloads.length >= 2, `both terminal payloads must be findable, found ${payloads.length}`);
for (const payload of payloads) {
  assert.match(payload, /live_url/, `every terminal preview payload must carry live_url: ${payload.slice(0, 120)}`);
}

// The needs_fix payload specifically — the one that used to carry nothing but
// a static html the interface then refused to render.
const needsFixPayload = payloads.find(payload => payload.includes("status: 'needs_fix'"));
assert.ok(needsFixPayload, 'the needs_fix payload must be findable');
assert.match(needsFixPayload!, /live_url: livePreview\?\.previewUrl/, 'needs_fix must still hand over a running preview');

/**
 * And the builder has to prefer it.
 *
 * Its static path refuses anything whose status is not `verified`, so a
 * needs_fix run reaches `setPreview` and is dropped. The live URL has to be
 * checked first, or the fix above changes nothing the user can see.
 */
const builder = readFileSync('./src/builder-live.ts', 'utf8');
const liveCheck = builder.indexOf('preview?.live_url');
const staticCheck = builder.indexOf('const previewHtml = String(responsePayload.preview?.html');
assert.ok(liveCheck > 0, 'the builder must read live_url');
assert.ok(staticCheck > 0, 'and still handle the static preview');
assert.ok(liveCheck < staticCheck, 'the running application must win over the rendered one');
assert.match(builder, /if \(previewHtml && !liveUrl\)/, 'the static preview must not overwrite a live one');

// setPreview's gate is what made a needs_fix run invisible; the live path must
// not go through it.
assert.match(builder, /function setLivePreview\(url: string\)/, 'a live preview needs its own entry point');
const setLive = builder.slice(builder.indexOf('function setLivePreview'), builder.indexOf('function clearLivePreview'));
assert.doesNotMatch(setLive, /normalizedStatus !== 'verified'/, 'the live path must not inherit the verified-only gate');
assert.match(setLive, /frame\.removeAttribute\('srcdoc'\)/, 'and must clear srcdoc, which otherwise wins over src');

console.log('preview reaches the user tests passed');
