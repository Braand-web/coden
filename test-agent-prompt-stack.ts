import assert from 'node:assert/strict';
import {
  CODEN_AGENT_PROMPT_VERSION,
  MODE_SELECTION_PROMPT,
  buildAgentTextSystemPrompt,
  buildGenerationSystemPrompt,
  buildIntentRouterSystemPrompt,
} from './src/services/agent-prompt-stack.ts';
import { CODEN_SYSTEM_CONTRACT_VERSION } from './src/services/coden-system-contract.ts';
import {
  CODEN_COMMUNICATION_PROTOCOL_VERSION,
  validatePublicNarrationBeat,
} from './src/lib/prompts/communication.ts';
import { CODEN_AUTO_INFRASTRUCTURE_PROMPT_VERSION } from './src/lib/prompts/infrastructure.ts';
import { CODEN_MESSAGE_STREAMING_PROMPT_VERSION } from './src/lib/prompts/message-streaming.ts';
import { CODEN_UNIVERSAL_BUILDER_PROMPT_VERSION } from './src/lib/prompts/system-prompt.ts';

const routerPrompt = buildIntentRouterSystemPrompt();
const textPrompt = buildAgentTextSystemPrompt({
  intent: 'conversation',
  modeInstruction: 'Mode test.',
  languageInstruction: 'Respond in French.',
});
const generationPrompt = buildGenerationSystemPrompt({
  prompt: 'Create a SaaS app with auth, database and billing.',
  uiPolicySystemPrompt: 'UI policy test.',
  hasExistingFiles: false,
});

assert.equal(CODEN_AGENT_PROMPT_VERSION, 'coden-agent-prompt-stack-v27');
assert.equal(CODEN_SYSTEM_CONTRACT_VERSION, 'coden-system-contract-v2');
assert.equal(CODEN_COMMUNICATION_PROTOCOL_VERSION, 'coden-communication-protocol-v2');
assert.equal(CODEN_UNIVERSAL_BUILDER_PROMPT_VERSION, 'coden-universal-builder-prompt-v1');
assert.equal(CODEN_MESSAGE_STREAMING_PROMPT_VERSION, 'coden-message-streaming-prompt-v2');
assert.equal(CODEN_AUTO_INFRASTRUCTURE_PROMPT_VERSION, 'coden-auto-infrastructure-prompt-v1');

for (const prompt of [routerPrompt, textPrompt]) {
  assert.ok(prompt.includes('This contract has priority over every lower-level Coden prompt policy'), 'every prompt must include the root system contract');
  assert.ok(prompt.includes('Product engineering operating contract'), 'every prompt must include the product engineering operating contract');
  assert.ok(prompt.includes('Coden is not specialized in one app category'), 'every prompt must keep Coden general-purpose');
  assert.ok(prompt.includes('Build the actual product, not a generic marketing page'), 'every prompt must prevent generic placeholder output');
  assert.ok(prompt.includes('Do not trust user_id, owner_id, role, plan, credits, org_id'), 'every prompt must reject client-controlled privileged fields');
  assert.ok(prompt.includes('structured messages/parts'), 'every prompt must preserve structured chat parts');
  assert.ok(prompt.includes('A green type check does not prove runtime behavior'), 'every prompt must require layer-appropriate verification');
  assert.ok(prompt.includes('Never invent file contents, tool results, API behavior, tests, preview status, deployment status, or success'), 'every prompt must enforce truthful completion');
  assert.ok(prompt.includes('Require explicit approval before destructive migrations'), 'every prompt must enforce critical-action approval');
  assert.ok(prompt.includes('Never promise unlimited usage'), 'prompt must block unlimited usage claims');
  assert.ok(prompt.includes('gross margin'), 'prompt must keep margin-sensitive language in safety/business context');
  assert.ok(prompt.includes('Do not expose internal model policy'), 'prompt must hide internal stream/model details');
  assert.ok(prompt.includes('Architect policy'), 'prompt must include Architect policy');
  assert.ok(prompt.includes('Deep reasoning policy'), 'prompt must include deep reasoning policy');
  assert.ok(prompt.includes('Do not expose hidden reasoning'), 'prompt must keep deep reasoning internal');
  assert.ok(prompt.includes('Interleaved narration and actions'), 'every prompt must include interleaved communication');
  assert.ok(prompt.includes('Never produce a long monologue followed by a burst of actions'), 'every prompt must prevent wall-of-text streaming');
  assert.ok(prompt.includes('one concrete sentence, then the real action it announces'), 'every prompt must enforce short narration/action beats');
  assert.ok(prompt.includes('Never stream duplicate or near-duplicate lines'), 'every prompt must prevent repeated stream lines');
  assert.ok(prompt.includes('Do not expose internal jargon: AST, RAG'), 'every prompt must hide internal stream jargon');
  assert.ok(prompt.includes('Do not write counters or percentages in prose'), 'every prompt must prevent progress counters in narration');
  assert.ok(prompt.includes('Reject public narration that starts with filler'), 'every prompt must include narration validation rules');
  assert.ok(prompt.includes('senior autonomous full-stack product builder'), 'every prompt must include the universal builder identity');
  assert.ok(prompt.includes('not a category-specific template bot'), 'every prompt must forbid template-only specialization');
  assert.ok(prompt.includes('Use structured message parts as the canonical chat representation'), 'every prompt must include structured message streaming');
  assert.ok(prompt.includes('Never create one assistant message per token'), 'every prompt must prevent token-message spam');
  assert.ok(prompt.includes('When a generated app requires a backend'), 'every prompt must include auto-provisioned infrastructure rules');
  assert.ok(prompt.includes('A backend is usable only after a real ready state'), 'every prompt must prevent fake backend readiness');
  assert.ok(prompt.includes('A clear app creation request should trigger generation'), 'every prompt must enforce action-first generation');
  assert.ok(prompt.includes('AUTONOMOUS MODE SELECTION - DECIDE BEFORE ACTING'), 'every prompt must include autonomous mode selection');
  assert.ok(prompt.includes('CLARITY'), 'every prompt must evaluate clarity before action');
  assert.ok(prompt.includes('REVERSIBILITY'), 'every prompt must evaluate reversibility before action');
  assert.ok(prompt.includes('ACTIONABILITY TREE'), 'every prompt must include the autonomous actionability tree');
  assert.ok(prompt.includes('Scope touches > 5 files'), 'every prompt must plan before large scope changes');
  assert.ok(prompt.includes('Ask 1-3 questions MAX'), 'every prompt must cap blocker questions');
  assert.ok(prompt.includes('OVERRIDE HIERARCHY'), 'every prompt must include override priority');
  assert.ok(prompt.includes('ALL GREEN means BUILD'), 'every prompt must include the autonomous go/no-go rule');
  assert.ok(prompt.includes('The mode is never declared, it is revealed through behavior'), 'every prompt must keep modes internal');
}

assert.ok(generationPrompt.includes('This contract has priority over every lower-level Coden prompt policy'), 'generation must keep the root contract');
assert.ok(generationPrompt.includes('Product engineering operating contract'), 'generation must keep the engineering contract');
assert.ok(generationPrompt.includes('Never invent file contents, tool results, API behavior, tests, preview status, deployment status, or success'), 'generation must remain truthful');
assert.ok(generationPrompt.length < 55_000, `generation prompt must stay output-focused, received ${generationPrompt.length} characters`);

assert.ok(MODE_SELECTION_PROMPT.includes('DISCUSS leads to PLAN'), 'mode prompt must include transitions');
assert.ok(MODE_SELECTION_PROMPT.includes('Never print DISCUSS, PLAN, BUILD, ASK'), 'mode prompt must forbid exposing internal modes');
assert.ok(MODE_SELECTION_PROMPT.includes('If the user says "go", "do it", "vas-y", "ok", "applique", or "continue"'), 'mode prompt must auto-build after confirmation');
assert.ok(MODE_SELECTION_PROMPT.includes('Never silently make destructive choices'), 'mode prompt must stop before destructive choices');
assert.ok(MODE_SELECTION_PROMPT.includes('Plan/Build UI toggle, only as a tiebreaker'), 'mode prompt must not depend on UI toggles');

assert.equal(validatePublicNarrationBeat('Je reconstruis la preview avant de livrer.').ok, true);
assert.equal(validatePublicNarrationBeat('Let me think about how to inspect the project first.').ok, false);
assert.equal(validatePublicNarrationBeat('Possible directions: répondre sans générer ou créer une app précise.').ok, false);
assert.equal(validatePublicNarrationBeat('Demande reçue.').ok, false);
assert.equal(validatePublicNarrationBeat('Analyse des dépendances AST.').ok, false);
assert.equal(validatePublicNarrationBeat('2/2 agents spécialisés complétés.').ok, false);

assert.ok(textPrompt.includes('Sound like a calm senior engineer and product designer'), 'text prompt must include senior voice policy');
assert.ok(textPrompt.includes('Persist the final assistant message once, never once per token'), 'text prompt must preserve safe chat persistence');
assert.ok(textPrompt.includes('answer naturally and directly'), 'conversation prompt must stay direct');
assert.ok(generationPrompt.includes('Senior agent voice'), 'generation prompt must include senior voice policy');
assert.ok(generationPrompt.toLowerCase().includes('return a complete modern react project structure'), 'generation prompt must prefer modern React app output');
assert.ok(generationPrompt.includes('Never assume a global supabase variable'), 'generation prompt must forbid global Supabase auth clients');
assert.ok(generationPrompt.includes('never call supabase.auth unless supabase is imported or created'), 'generation prompt must require an explicit auth client');
assert.ok(generationPrompt.includes('show a safe unavailable/auth-unavailable state instead of crashing'), 'generation prompt must keep auth previews safe when config is missing');
assert.ok(generationPrompt.includes('Generation stack v2 is mandatory'), 'generation prompt must include the strict generation stack v2 policy');
assert.ok(generationPrompt.includes('React 18'), 'generation prompt must require React 18');
assert.ok(generationPrompt.includes('lucide-react'), 'generation prompt must require lucide-react icons');
assert.ok(generationPrompt.includes('tailwind.config.ts'), 'generation prompt must require Tailwind config');
assert.ok(generationPrompt.includes('postcss.config.cjs'), 'generation prompt must require PostCSS config');
assert.ok(generationPrompt.includes('src/lib/supabaseClient.ts'), 'generation prompt must require a browser-safe Supabase client for backend apps');
assert.ok(routerPrompt.includes('Words like create, add, generate, improve, fix, modify, arrange, or correct are not enough'), 'router must resist keyword-only coding decisions');
assert.ok(routerPrompt.includes('Figma, GitHub, Image, and Website URL'), 'router prompt must understand import sources');
assert.ok(generationPrompt.includes('convert static frames into a real responsive app'), 'generation prompt must upgrade Figma frames into product UI');
assert.ok(generationPrompt.includes('preserve the imported codebase'), 'generation prompt must preserve imported GitHub apps');
assert.ok(generationPrompt.includes('recreate it as an editable responsive app'), 'generation prompt must handle screenshot imports');
assert.ok(generationPrompt.includes('Never copy competitor logos'), 'generation prompt must keep URL imports safe and original');
assert.ok(routerPrompt.includes('Senior Agent OS policy'), 'router prompt must include Senior Agent OS policy');
assert.ok(textPrompt.includes('Senior Agent OS policy'), 'text prompt must include Senior Agent OS policy');
assert.ok(generationPrompt.includes('Senior Agent OS policy'), 'generation prompt must include Senior Agent OS policy');
assert.ok(generationPrompt.includes('The 16 blueprint sections are an internal completeness checklist'), 'generation prompt must use architect completeness checklist');
assert.ok(generationPrompt.includes('No fake success'), 'generation prompt must enforce no-fake-success delivery');
assert.ok(generationPrompt.includes('decompose tasks'), 'generation prompt must require task decomposition before execution');
assert.ok(generationPrompt.includes('Production-readiness policy'), 'generation prompt must include production-readiness policy');
assert.ok(generationPrompt.includes('Universal product contract (binding)'), 'generation prompt must be driven by the universal product contract');
assert.ok(generationPrompt.includes('Optional production architecture reference'), 'generation prompt may keep blueprints as optional engineering references');
assert.ok(generationPrompt.includes('must never constrain the product shape'), 'blueprints must never constrain the requested product');
assert.ok(generationPrompt.includes('Never invent user-facing data'), 'generation prompt must forbid invented user-facing records');
assert.ok(generationPrompt.includes('Every private table needs RLS'), 'generation prompt must enforce private table RLS');
assert.ok(generationPrompt.includes('A builder agent should not over-explain before acting'), 'generation prompt must keep builder behavior action-first');
assert.ok(generationPrompt.includes('Never answer a clear build request with a generic plan'), 'generation prompt must reject generic plan detours for build requests');
assert.ok(generationPrompt.includes('ask exactly one concise question'), 'generation prompt must keep clarification short');
assert.ok(routerPrompt.includes('Do not ask "Build or Plan?"'), 'router prompt must forbid generic mode questions');
assert.ok(generationPrompt.includes('Zero-bug generation contract'), 'generation prompt must include zero-bug generation contract');
assert.ok(generationPrompt.includes('src/main.tsx must import React'), 'generation prompt must require a real Vite entrypoint');
assert.ok(generationPrompt.includes('process.exit(isValid ? 0 : 1)'), 'generation prompt must require a non-throwing smoke test');
assert.ok(generationPrompt.includes('Never generate throw new Error() inside src/App.tsx'), 'generation prompt must forbid runtime throw markers');
assert.ok(generationPrompt.includes('Never output __CODEN_FORCE_ERROR__'), 'generation prompt must forbid forced runtime failure markers');
assert.ok(generationPrompt.includes('Coden is a general web-app builder'), 'generation prompt must stay general-purpose');
assert.ok(generationPrompt.includes('Recovery pass is mandatory'), 'generation prompt must require repair/retest before final delivery');
assert.ok(generationPrompt.includes('Generated app design system policy'), 'generation prompt must include generated app design system policy');
assert.ok(generationPrompt.includes('design tokens'), 'generation prompt must require design tokens');
assert.ok(generationPrompt.includes('Avoid generic AI patterns'), 'generation prompt must reject generic AI aesthetics');
assert.ok(generationPrompt.includes('Frontend craft policy'), 'generation prompt must include frontend craft policy');
assert.ok(generationPrompt.includes('Touch targets must be at least 44x44px'), 'generation prompt must enforce touch target accessibility');
assert.ok(generationPrompt.includes('prefers-reduced-motion'), 'generation prompt must respect reduced motion');
assert.ok(generationPrompt.includes('Motion and polish policy'), 'generation prompt must include motion polish guidance');
assert.ok(generationPrompt.includes('Generated-application security contract'), 'generation prompt must include generated-app security boundaries');
assert.ok(generationPrompt.includes('Every generated application has an immutable project id'), 'generation prompt must include infrastructure isolation');

console.log('agent prompt stack ok');
