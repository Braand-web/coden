import assert from 'node:assert/strict';
import { selectModel, selectModelForAgent, MODELS_BY_COST, blendedCost } from './src/services/model-selection.ts';
import { AUTO_MODEL_IDS, MODEL_REGISTRY } from './src/config/ai-models.ts';

assert.equal(AUTO_MODEL_IDS.length, 5);
assert.deepEqual([...AUTO_MODEL_IDS].sort(), [
  'openai/gpt-5.6-luna',
  'openai/gpt-5.6-terra',
  'google/gemini-3.8-flash',
  'openai/gpt-5.6-sol',
  'anthropic/claude-opus-5',
].sort());
assert.ok(!(AUTO_MODEL_IDS as readonly string[]).includes('openai/gpt-6-astra'), 'Astra is a replacement escalation, not a sixth Auto call');
assert.ok(AUTO_MODEL_IDS.every(id=>!id.endsWith(':batch')));
for(let i=1;i<MODELS_BY_COST.length;i++) assert.ok(blendedCost(MODELS_BY_COST[i-1])<=blendedCost(MODELS_BY_COST[i]));
assert.equal(selectModel({task:'conversation',plan:'enterprise'}).modelId,'openai/gpt-5.6-luna');
assert.equal(selectModelForAgent('router',{plan:'free'}).modelId,'openai/gpt-5.6-luna');
assert.equal(selectModel({task:'architecture',plan:'scale'}).modelId,'openai/gpt-5.6-sol');
assert.equal(selectModel({task:'code_generation',plan:'pro'}).modelId,'openai/gpt-5.6-luna');
assert.equal(selectModel({task:'review',plan:'scale'}).modelId,'anthropic/claude-opus-5');
assert.equal(selectModel({task:'classification',needs:{vision:true},plan:'free'}).modelId,'google/gemini-3.8-flash');
const complex=selectModel({task:'code_generation',complexity:'complex',plan:'scale'});
assert.equal(MODEL_REGISTRY.find(m=>m.id===complex.modelId)?.capabilities.codeLevel,'frontier');
assert.ok(complex.rejected.every(r=>r.because.length>5));
/*
 * `architecture` degrades; it does not refuse.
 *
 * This line used to require a throw, on the reasoning that architecture is too
 * important to answer with a weaker model. Production disproved the trade:
 * `architecture` is the task behind `deploy_assist`, so that rule meant a free
 * user asking "how do I deploy this?" got an exception instead of an answer —
 * the same silent failure that emptied `code_generation` for five days, in a
 * quieter corner.
 *
 * A weaker answer here is visible and judgeable. `security` is the one place
 * it is not, and it stays fail-closed below.
 */
{
  const degraded = selectModel({task:'architecture',complexity:'extreme',plan:'free'});
  assert.ok(degraded.modelId, 'a free user still gets deployment guidance');
  assert.match(degraded.reason, /best accessible model/, 'and is told it is not the preferred model');
}
assert.throws(()=>selectModel({task:'security',complexity:'extreme',plan:'free'}),/No eligible/);
assert.throws(()=>selectModel({task:'code_generation',complexity:'complex',plan:'enterprise',credits:0}),/No eligible/);
assert.throws(()=>selectModel({task:'code_generation',plan:'enterprise',estimatedInputTokens:100000000}),/No eligible/);
for(const task of ['conversation','planning','code_edit','debug','review','architecture','security','design','research'] as const) {
  assert.ok((AUTO_MODEL_IDS as string[]).includes(selectModel({task,plan:'enterprise'}).modelId));
}
console.log('model selection tests passed');
