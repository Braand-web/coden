/** Opt-in live model evaluation. No secrets or user content are printed. */
import { readFileSync } from 'node:fs';
import { OpenRouterService } from '../src/services/openrouter-service.ts';
import { ProviderGateway } from '../src/services/provider-gateway.ts';
import { selectModelForAgent } from '../src/services/model-selection.ts';
import { isAllowedModelId } from '../src/config/ai-models.ts';
import { verifyMission } from '../src/services/mission-verifier.ts';

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  console.error('OPENROUTER_API_KEY is required from the local/CI secret store. Do not put it in the command or repository.');
  process.exit(2);
}
const requested = process.env.CODEN_EVAL_MODEL;
const modelId = requested && isAllowedModelId(requested) ? requested : selectModelForAgent('planner', { plan: 'pro' }).modelId;
const gateway = new ProviderGateway(new OpenRouterService({ apiKey, siteUrl: 'https://coden.fun', appName: 'Coden scope evaluation' }));
const cases = JSON.parse(readFileSync(new URL('../evals/mission-alignment.json', import.meta.url), 'utf8')).cases;
let measuredCost = 0;
let failures = 0;
for (const fixture of cases.slice(0, 6)) {
  if (measuredCost >= 0.25) { console.error('Measured evaluation cost threshold reached; remaining cases not run.'); process.exitCode = 2; break; }
  const start = Date.now();
  try {
    const result = await verifyMission({ gateway, modelId, request: fixture.request, context: fixture.context, stage: 'plan',
      plan: { summary: fixture.summary, files: [{ path: 'src/App.tsx', action: 'edit', rationale: fixture.summary }] } });
    measuredCost += result.costUsd;
    const passed = result.verdict.status === fixture.expected;
    if (!passed) failures += 1;
    console.log(JSON.stringify({ id: fixture.id, passed, status: result.verdict.status, latencyMs: Date.now()-start, costUsd: result.costUsd }));
  } catch {
    failures += 1;
    console.log(JSON.stringify({ id: fixture.id, passed: false, status: 'evaluation_unavailable', latencyMs: Date.now()-start }));
  }
}
console.log(JSON.stringify({ suite: 'mission-alignment', failures, measuredCostUsd: measuredCost, modelId }));
if (failures) process.exitCode = 1;
