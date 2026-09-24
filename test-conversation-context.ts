import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/*
 * What the model is given for a reply.
 *
 * The agent "did not understand": the question arrived inside a JSON payload
 * under 64k characters of policy, previous turns were flattened into the same
 * string (or missing entirely on /generate), and a plan or deploy question was
 * answered in forced JSON mode. These pin the shape that fixed it.
 */
const server = readFileSync(new URL('./server.ts', import.meta.url), 'utf8');
const builder = server.slice(server.indexOf('function buildAgentTextMessages('), server.indexOf('async function createAgentTextResponse('));

assert.match(builder, /\.\.\.history\.map\(turn => \(\{ role: turn\.role, content: turn\.content \}\)/, 'previous turns are sent as real messages');
assert.doesNotMatch(builder, /request: prompt,/, 'the question is not buried in a JSON payload');
assert.match(builder, /content: visionInputs\?\.length \? buildVisionMessageContent\(request, visionInputs\) : request/, 'the last message is the user\'s own text');
assert.doesNotMatch(builder, /Follow it exactly/, 'internal flags are facts, never orders');

assert.match(server, /prompt,\n\s+history: historyTurns,/, 'the chat route passes the conversation as turns');
assert.equal((server.match(/history: recentHistory,/g) || []).length >= 2, true, '/generate text replies get the conversation too');
assert.doesNotMatch(server, /promptWithHistory/, 'no flattened history string remains');
assert.match(server, /preferStructuredOutput: input\.mode === 'generation',/, 'prose replies are never forced into JSON mode');

console.log('conversation context tests passed');

/*
 * Memory across turns and across rounds, the way Claude Code keeps a session.
 */
{
  const pipeline = readFileSync(new URL('./src/services/multi-agent-pipeline.ts', import.meta.url), 'utf8');
  assert.match(pipeline, /const rounds: ChatMessage\[\]\[\] = \[\];/, 'a run keeps its rounds');
  assert.match(pipeline, /\.\.\.carried,/, 'and the next round receives them');
  assert.match(pipeline, /rounds\.push\(carryOverTranscript\(loop\.messages\.slice\(1 \+ carried\.length\), loop\.result\?\.text\)\)/, 'recorded as a valid transcript, without duplicating the carried prefix');

  assert.match(server, /loadConversationContext\(\{\n\s+project,\n\s+userId,/, '/generate loads the conversation window and its summary');
  assert.doesNotMatch(server.slice(server.indexOf("app.post('/api/projects/:id/generate'")), /getRecentDecisionHistory\(project\.id, 6\)/, 'not the last six clipped messages');
  assert.match(server, /memoryContext: \[projectMemory, sessionContext\]/, 'the build agents get the session memory');
  assert.match(server, /void recordSessionRun\(project, userId, \{/, 'every build leaves a run record');
  assert.match(server, /sessionContext: canPersistConversation \? renderSessionContext\(await loadSessionMemory\(project\.id\)\) : undefined/, 'a project chat knows what was built');
}
console.log('session memory wiring tests passed');

/*
 * Live test, 2026-09-23: "une ville avec des humains" answering Coden's own
 * question was treated as small talk, "oui vas y" too, every reply appeared
 * twice, and a build died with a deploy.
 */
{
  const generate = server.slice(server.indexOf("app.post('/api/projects/:id/generate'"));
  const decisionCall = generate.slice(generate.indexOf('initialDecision = await resolveAgentDecision({'), generate.indexOf('initialDecision = await resolveAgentDecision({') + 400);
  assert.doesNotMatch(decisionCall, /localOnly: true/, 'the Builder asks the model router, which reads the conversation');
  assert.match(server, /resolvedPrompt: String\(raw\.normalized_prompt/, 'the router\'s restated request is kept');
  assert.match(generate, /const resolvedMission = decision\.resolvedPrompt/, 'and the build runs on it, not on "oui vas-y"');
  assert.match(generate, /assistant_streamed: streamedAny,/, 'a streamed answer is not sent a second time');

  const builderLive = readFileSync(new URL('./src/builder-live.ts', import.meta.url), 'utf8');
  const classifier = builderLive.slice(builderLive.indexOf('function classifyPromptUiContext('), builderLive.indexOf('function showAssistantBubble('));
  assert.ok(classifier.indexOf("if (currentProjectId) return 'project_mission';") > 0, 'in a project, the page does not pre-route by keywords');
  assert.ok(classifier.indexOf("if (currentProjectId) return 'project_mission';") < classifier.indexOf("return 'chat_simple'", classifier.indexOf('const contract')), 'before any chat shortcut');

  const router = readFileSync(new URL('./src/services/agent-prompt-stack.ts', import.meta.url), 'utf8');
  assert.match(router, /If Coden asked what to build or which option, and the user answers/, 'a reply to Coden\'s question is the missing detail');
  assert.match(router, /If Coden proposed to build or change something and the user agrees/, 'a yes to a proposal starts it');
}
console.log('live-test regression checks passed');

/*
 * Live test, 2026-09-24: "je veux une app de prise de rendez-vous premium"
 * failed in 2 s with SECURE_SANDBOX_REQUIRED. The pipeline ran where the
 * sandbox may not execute code, and the failure was recorded as an
 * interruption. No production build had succeeded since 2026-09-13.
 */
{
  assert.match(server, /if \(CODEN_AGENT_FLAGS\.multiAgentPipeline && pipelineRoute && hostSandboxExecutionAllowed\(\)\) \{/, 'the pipeline only runs where its sandbox can');
  assert.match(server, /\[coden:pipeline_sandbox_unavailable\]/, 'and the deployment says at boot which path it runs');
  assert.match(server, /await updateAgentRunStatus\(pipelineRunId, 'failed', \{\n\s+diagnostic_code: failureCode,/, 'a failed build records its real cause on its run');
}
console.log('sandbox gate checks passed');

/*
 * Session analysis 2026-09-24 (all generations failing in production).
 */
{
  assert.match(server, /const needsVision = hasImages;/, 'vision is required by attached images, not by words like "photo"');
  assert.match(server, /\[coden:pinned_model_substituted\]/, 'a pinned model that cannot do the request is substituted, not a failed run');
  assert.match(server, /const onlyRuntimeUnavailable = runnerSkipped/, 'a missing runtime alone does not fail a clean build');
  assert.match(server, /onFileStarted: eventStream/, 'the generation path shows each file as it is written');
  assert.match(server, /75 \* 60_000/, 'runs past the generation ceiling are closed, not left running');
  const pipeline = readFileSync(new URL('./src/services/multi-agent-pipeline.ts', import.meta.url), 'utf8');
  assert.match(pipeline, /selection = selectModel\(selectionRequest\);/, 'the pipeline substitutes an incompatible pinned model too');
  const sandbox = readFileSync(new URL('./src/services/sandbox/project-sandbox.ts', import.meta.url), 'utf8');
  assert.match(sandbox, /if \(remoteSandboxConfigured\(\)\) return true;/, 'an E2B key enables the isolated sandbox');
}
{
  // A deploy drains the runs in flight only if the server itself receives
  // SIGTERM. `npm run start` exits on the signal without passing it on, and
  // the container stops with it: every deploy killed the builds under way.
  const railway = JSON.parse(readFileSync(new URL('./railway.json', import.meta.url), 'utf8'));
  assert.doesNotMatch(railway.deploy.startCommand, /^npm\b/, 'Railway starts Node directly, not through npm');
  assert.match(railway.deploy.startCommand, /^node\b/);
  const nixpacks = readFileSync(new URL('./nixpacks.toml', import.meta.url), 'utf8');
  assert.match(nixpacks, /\[start\]\s*(?:#.*\n\s*)*cmd = "node /, 'the Nixpacks start command runs Node directly');
  assert.ok(railway.deploy.drainingSeconds >= 600, 'the old instance gets time to finish its runs');
}
{
  // Leaving the page never stopped the run; the page coming back lost it.
  const builderLive = readFileSync(new URL('./src/builder-live.ts', import.meta.url), 'utf8');
  assert.match(builderLive, /void approvalsRestored\.then\(\(\) => resumeActiveRun\(\)\)/, 'the builder looks for a live run when a project loads');
  assert.match(builderLive, /\/agent\/active-turn/, 'it asks the server which run is live');
  assert.match(builderLive, /__codenAttach/, 'and follows it instead of sending a new request');
  assert.match(builderLive, /if \(!isRecoveryRetry && !attach\) appendMessage\('user'/, 'without repeating the request already in the conversation');
  assert.match(server, /app\.get\('\/api\/projects\/:id\/agent\/active-turn'/, 'the server names the live run');
  assert.match(server, /RUN_SILENCE_LIMIT_MS/, 'a run silent for too long, held by no instance, is closed as interrupted');
  assert.match(server, /firstSequenceForTurn/, 'a replay starts at the turn, not at the start of the thread');
  assert.match(server, /const lastEventAt = await harness\.store\.lastEventAtForTurn\?\.\(turn\.threadId, turn\.id\)/, 'a run still draining on the previous instance is judged by its own activity, not by when this instance booted');
}
console.log('session analysis regression checks passed');
