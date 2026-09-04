import assert from 'node:assert/strict';
import { selectModel, selectModelForAgent, MODELS_BY_COST, blendedCost } from './src/services/model-selection.ts';
import { AUTO_MODEL_IDS, MODEL_REGISTRY } from './src/config/ai-models.ts';

assert.equal(AUTO_MODEL_IDS.length,7);
assert.ok(AUTO_MODEL_IDS.every(id=>!id.endsWith(':batch')));
for(let i=1;i<MODELS_BY_COST.length;i++) assert.ok(blendedCost(MODELS_BY_COST[i-1])<=blendedCost(MODELS_BY_COST[i]));
assert.equal(selectModel({task:'conversation',plan:'enterprise'}).modelId,'openai/gpt-5.6-luna');
assert.equal(selectModelForAgent('router',{plan:'free'}).modelId,'openai/gpt-5.6-luna');
assert.equal(selectModel({task:'architecture',plan:'scale'}).modelId,'openai/gpt-5.6-sol');
assert.equal(selectModel({task:'code_generation',plan:'pro'}).modelId,'x-ai/grok-4.6');
assert.equal(selectModel({task:'review',plan:'scale'}).modelId,'anthropic/claude-opus-5');
assert.equal(selectModel({task:'classification',needs:{vision:true},plan:'free'}).modelId,'google/gemini-3.8-flash');
const complex=selectModel({task:'code_generation',complexity:'complex',plan:'scale'});
assert.equal(MODEL_REGISTRY.find(m=>m.id===complex.modelId)?.capabilities.codeLevel,'frontier');
assert.ok(complex.rejected.every(r=>r.because.length>5));
assert.throws(()=>selectModel({task:'architecture',complexity:'extreme',plan:'free'}),/No eligible/);
assert.throws(()=>selectModel({task:'code_generation',complexity:'complex',plan:'enterprise',credits:0}),/No eligible/);
assert.throws(()=>selectModel({task:'code_generation',plan:'enterprise',estimatedInputTokens:100000000}),/No eligible/);
for(const task of ['conversation','planning','code_edit','debug','review','architecture','security','design','research'] as const) {
  assert.ok((AUTO_MODEL_IDS as string[]).includes(selectModel({task,plan:'enterprise'}).modelId));
}
console.log('model selection tests passed');
