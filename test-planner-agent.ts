import assert from 'node:assert/strict';
import { ProviderGateway } from './src/services/provider-gateway.ts';
import { runPlannerAgent, isBuildPlan, type BuildPlan } from './src/services/planner-agent.ts';
import { MODEL_REGISTRY, type AllowedModelId } from './src/config/ai-models.ts';

/**
 * The planner, driven against a fake provider.
 *
 * The model is stubbed because what is under test is Coden's own contract
 * enforcement — that a valid plan reaches the caller unchanged, that an
 * invalid one gets exactly one repair attempt before failing loudly, and that
 * the planner never touches the sandbox — not a language model's judgement.
 */

/** Mirrors model-selection.ts's blended-cost formula, to state the expectation independently of its internals. */
function blendedCost(model: (typeof MODEL_REGISTRY)[number]) {
  return model.inputUsdPerMillion * 0.25 + model.outputUsdPerMillion * 0.75;
}
const byCost = [...MODEL_REGISTRY].sort((a, b) => blendedCost(a) - blendedCost(b));
const cheapestOverall = byCost[0].id as AllowedModelId;
// Planning carries a real reasoning floor (TASK_BAR.planning = 'high'), so
// the cheapest *capable* model is not the cheapest model in the catalogue —
// it is the cheapest one whose reasoningLevel actually clears that bar.
const cheapestCapableForPlanning = byCost.find(model => model.capabilities.reasoningLevel === 'high' || model.capabilities.reasoningLevel === 'frontier')!.id as AllowedModelId;

function fakeProvider(responses: string[]) {
  const calls: Array<{ modelId: string; messages: unknown }> = [];
  let index = 0;
  return {
    calls,
    service: {
      async chat(modelId: string, messages: unknown) {
        calls.push({ modelId, messages });
        const text = responses[Math.min(index, responses.length - 1)];
        index += 1;
        return { text, model: modelId, usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }, cost_usd: 0 };
      },
    } as any,
  };
}

const VALID_PLAN = JSON.stringify({
  summary: 'Add a dark mode toggle to the settings page.',
  files: [
    { path: 'src/components/ThemeToggle.tsx', action: 'create', rationale: 'A new switch component that flips the theme and persists the choice.' },
    { path: 'src/App.tsx', action: 'edit', rationale: 'Mount ThemeToggle in the header so the control is reachable from every screen.' },
  ],
  risks: ['No existing theme context — this introduces one rather than reusing something already there.'],
});

// -- a valid plan reaches the caller unchanged -----------------------------
{
  const provider = fakeProvider([VALID_PLAN]);
  const gateway = new ProviderGateway(provider.service);
  const plan = await runPlannerAgent({
    gateway,
    prompt: 'add a dark mode toggle',
    existingFiles: [{ path: 'src/App.tsx' }, { path: 'src/main.tsx' }],
    plan: 'pro',
  });
  assert.equal(plan.summary, 'Add a dark mode toggle to the settings page.');
  assert.equal(plan.files.length, 2);
  assert.equal(plan.files[0].action, 'create');
  assert.equal(plan.risks.length, 1);
  assert.equal(provider.calls.length, 1, 'a valid plan must not trigger a repair call');
}

// -- risks is normalized to [] when the model omits it ---------------------
{
  const provider = fakeProvider([JSON.stringify({
    summary: 'Rename the button label.',
    files: [{ path: 'src/App.tsx', action: 'edit', rationale: 'Change the button text from Submit to Send.' }],
  })]);
  const gateway = new ProviderGateway(provider.service);
  const plan = await runPlannerAgent({ gateway, prompt: 'rename the button', existingFiles: [], plan: 'free' });
  assert.deepEqual(plan.risks, [], 'a model that saw nothing worth flagging must not be forced to invent a risk');
}

// -- an invalid plan gets exactly one repair attempt -----------------------
{
  const provider = fakeProvider([
    'Sure! Here is my plan: first we will...',   // not JSON at all
    VALID_PLAN,                                    // the repair call succeeds
  ]);
  const gateway = new ProviderGateway(provider.service);
  const plan = await runPlannerAgent({ gateway, prompt: 'add dark mode', existingFiles: [], plan: 'pro' });
  assert.equal(plan.summary, 'Add a dark mode toggle to the settings page.');
  assert.equal(provider.calls.length, 2, 'invalid JSON must trigger exactly one repair call');
}

// -- a plan that is invalid twice fails loudly, not silently ---------------
{
  const provider = fakeProvider(['not json', 'still not json']);
  const gateway = new ProviderGateway(provider.service);
  await assert.rejects(
    () => runPlannerAgent({ gateway, prompt: 'add dark mode', existingFiles: [], plan: 'pro' }),
    /StructuredOutputError|JSON/i,
  );
  assert.equal(provider.calls.length, 2, 'a repair attempt must not be retried a second time');
}

// -- a plan naming no files is rejected, not accepted as "nothing to do" ---
{
  const provider = fakeProvider([
    JSON.stringify({ summary: 'Nothing needs to change.', files: [] }),
    VALID_PLAN,
  ]);
  const gateway = new ProviderGateway(provider.service);
  const plan = await runPlannerAgent({ gateway, prompt: 'add dark mode', existingFiles: [], plan: 'pro' });
  // An empty files array is caught by isBuildPlan and treated as invalid,
  // so the repair call must have run and produced the real plan.
  assert.equal(plan.files.length, 2, 'an empty-files plan must be rejected and repaired, not accepted as a no-op');
  assert.equal(provider.calls.length, 2);
}

// -- the validator itself: shape, not vibes --------------------------------
assert.equal(isBuildPlan(null), false);
assert.equal(isBuildPlan({}), false);
assert.equal(isBuildPlan({ summary: 'x', files: [] }), false, 'a plan needs at least one file');
assert.equal(isBuildPlan({ summary: '', files: [{ path: 'a', action: 'create', rationale: 'x' }] }), false, 'an empty summary is not a plan');
assert.equal(isBuildPlan({
  summary: 'x',
  files: [{ path: 'a', action: 'rewrite', rationale: 'x' }],
}), false, 'action must be one of create/edit/delete');
assert.equal(isBuildPlan({
  summary: 'x',
  files: [{ path: 'a', action: 'create', rationale: 'x' }],
} satisfies BuildPlan), true);

// -- the planner never touches a sandbox: it takes no sandbox at all -------
// This is enforced by the type signature itself (PlannerAgentInput has no
// `sandbox` field), so the check here is that the module genuinely does not
// import the sandbox surface a coder or reviewer would need.
const source = (await import('node:fs')).readFileSync('./src/services/planner-agent.ts', 'utf8');
assert.ok(!source.includes('sandbox-tools'), 'the planner must not import sandbox tools — it must not be able to write files');
assert.ok(!source.includes('ProjectSandbox'), 'the planner must not import the sandbox type — planning runs before one exists');

// -- model selection: the planner is a planning task, not hardcoded --------
{
  const provider = fakeProvider([VALID_PLAN]);
  const gateway = new ProviderGateway(provider.service);
  await runPlannerAgent({ gateway, prompt: 'add dark mode', existingFiles: [], plan: 'enterprise', credits: 9999 });
  assert.notEqual(provider.calls[0].modelId, cheapestOverall,
    'the globally cheapest model (Gemini, reasoning: medium) must not be picked for a task with a high reasoning floor');
  assert.equal(provider.calls[0].modelId, cheapestCapableForPlanning,
    'even on the richest plan, planning must take the cheapest model that actually clears its reasoning bar — not the most expensive one it could afford');
}

console.log('planner agent tests passed');
