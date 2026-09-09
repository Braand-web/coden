import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DESIGN_RESOURCES, describeDesignResources } from './src/services/design-resource-catalogue.ts';
import { buildWorldClassUiPolicy } from './src/services/design-generation-policy.ts';

/*
 * The design system reaches the agents that build the application.
 *
 * `design-generation-policy.ts` is 1055 lines — app-type classification,
 * layout and density strategy, required components, states and motion rules,
 * anti-generic-AI-design rules, a self-audit, a worked example. It has three
 * call sites and all three are in `generateFilesWithAi`, the legacy path.
 * When the multi-agent pipeline became the live one, `grep -n design` across
 * `multi-agent-pipeline.ts` and `planner-agent.ts` returned nothing: every
 * generation since has been designed by a model with no brief at all.
 *
 * These assertions are structural on purpose. What broke was not the policy's
 * content — that is covered by `test-policy.ts` — but the wiring between the
 * module that has it and the run that needs it, and only a structural check
 * fails when that wiring is absent.
 */

const pipeline = readFileSync(new URL('./src/services/multi-agent-pipeline.ts', import.meta.url), 'utf8');
const planner = readFileSync(new URL('./src/services/planner-agent.ts', import.meta.url), 'utf8');
const starters = readFileSync(new URL('./src/services/sandbox/starters.ts', import.meta.url), 'utf8');

// The live pipeline builds the policy itself rather than trusting a caller to
// remember: it is a pure function of the prompt, with no client or credential
// to inject, so there is no reason for it to be optional.
{
  assert.match(pipeline, /buildWorldClassUiPolicy/, 'the pipeline must build the design policy');
  assert.match(pipeline, /describeDesignResources/, 'and hand over the vetted resource catalogue');
  assert.match(pipeline, /const designPolicy = designContextForRoute\(/, 'computed once for the whole run');
}

// Both agents receive it, and for different reasons: the plan decides which
// screens exist, the coder decides what they look like.
{
  assert.match(pipeline, /designPolicy,\n\s*plan: input\.userPlan/, 'the planner must receive it');
  assert.match(planner, /designPolicy\?: string/, 'the planner accepts it');
  assert.match(planner, /buildPlannerSystemPrompt\(input\.designPolicy\)/, 'and actually uses it');

  const turn = pipeline.slice(pipeline.indexOf('turn: buildToolLoopTurn({'), pipeline.indexOf('turn: buildToolLoopTurn({') + 800);
  assert.match(turn, /designPolicy,/, 'and so must the coder');
}

/*
 * In the coder's system message, not its first instruction.
 *
 * Every round writes interface code, not only round one. A repair round that
 * has lost the design rules fixes the type error and flattens the component it
 * touched on the way past — and the system message is the only part of the
 * transcript rebuilt identically on each round.
 */
{
  const systemMessage = pipeline.slice(pipeline.indexOf("role: 'system'"), pipeline.indexOf("role: 'system'") + 300);
  assert.match(systemMessage, /input\.designPolicy/, 'the design policy belongs in the system message, which every round rebuilds');
}

/*
 * A small edit does not get a design review.
 *
 * The policy and its catalogue weigh about 3,500 tokens. Spending it to change a subtitle is
 * paying for a design brief on a typo, on the one route whose entire budget is
 * three minutes — the same waste that made a one-line edit run for nine
 * minutes before `budgetForRoute` existed.
 */
{
  const guard = pipeline.slice(pipeline.indexOf('function designContextForRoute('), pipeline.indexOf('function designContextForRoute(') + 700);
  assert.match(guard, /if \(route === 'small_edit'\) return undefined;/, 'a small edit must not carry the design system');
}

// An existing project's own identity outranks a hint derived from the request.
{
  const withFiles = pipeline.slice(pipeline.indexOf('function designContextForRoute('), pipeline.indexOf('/** The plan\'s file list'));
  assert.match(withFiles, /hasExistingFiles/, 'the design context must know whether it is designing onto something');
  assert.match(withFiles, /EXISTING APPLICATION/, 'and say so, so "add a booking page" does not restyle the dashboard it lands in');
}

/*
 * The resource catalogue: research already done, rather than research skipped.
 *
 * `web-research-gateway.ts` implements live search, and production has no
 * FIRECRAWL_API_KEY, TAVILY_API_KEY or BRAVE_SEARCH_API_KEY — `isConfigured()`
 * is false, so wiring it in would return `skipped` on every call. A pinned,
 * licence-checked catalogue answers the same need without putting a
 * twelve-second search on the critical path of every build.
 */
{
  const rendered = describeDesignResources();
  assert.match(rendered, /install_package/, 'the catalogue must name the tool that installs them, or it is only an inventory');
  assert.match(rendered, /lucide-react@/, 'icons');
  assert.match(rendered, /framer-motion@/, 'motion');
  assert.match(rendered, /@radix-ui\/react-dialog@/, 'accessible primitives');

  for (const resource of DESIGN_RESOURCES) {
    // Pinned for the reason `starters.ts` pins its own versions: a floating
    // range means the app that built today does not build next week, and the
    // first anyone hears of it is a user's broken preview.
    assert.match(resource.version, /^\d+\.\d+\.\d+$/, `${resource.package} must be pinned to an exact version, not a range`);
    assert.ok(resource.license.trim().length > 0, `${resource.package} must state its licence — "free" is a fact, not a claim`);
    assert.ok(resource.useWhen.trim().length > 0, `${resource.package} must say when to use it`);
    assert.ok(rendered.includes(`${resource.package}@${resource.version}`), `${resource.package} must appear in the rendered section`);
  }

  // One answer per need. Two icon sets in one application is not twice the
  // choice, it is an interface that does not look like one product.
  const icons = DESIGN_RESOURCES.filter(resource => resource.category === 'icons');
  assert.equal(icons.length, 1, 'exactly one icon library');
  assert.equal(DESIGN_RESOURCES.filter(resource => resource.category === 'motion').length, 1, 'exactly one animation library');

  // A themed UI kit overrides the token layer, and the result stops looking
  // designed and starts looking defaulted — the exact failure mode the policy
  // spends its anti-AI-design rules preventing.
  assert.match(rendered, /Never add a UI kit that ships its own theme/, 'themed kits stay out');
  for (const banned of ['bootstrap', '@mui/material', '@chakra-ui', 'antd']) {
    assert.ok(!DESIGN_RESOURCES.some(resource => resource.package === banned), `${banned} must not be offered`);
  }
}

/*
 * The scaffold loads the font it names.
 *
 * `index.css` has always set `font-family: Inter` and nothing ever fetched
 * Inter — no @font-face, no stylesheet link, no @fontsource dependency. Every
 * generated application fell through to the next entry in the stack, so the
 * typography half of the design contract was decided by whichever operating
 * system happened to open the preview.
 */
{
  const indexHtml = starters.slice(starters.indexOf('const INDEX_HTML ='), starters.indexOf('const MAIN_TSX ='));
  assert.match(indexHtml, /fonts\.googleapis\.com\/css2\?family=Inter/, 'the scaffold must actually load Inter');
  assert.match(indexHtml, /display=swap/, 'and stay readable from the first paint whether or not it arrives');
  assert.match(indexHtml, /rel="preconnect" href="https:\/\/fonts\.gstatic\.com" crossorigin/, 'with the connection open before the CSS asks for the file');

  const css = starters.slice(starters.indexOf('const INDEX_CSS ='), starters.indexOf('const TAILWIND_CONFIG ='));
  assert.match(css, /font-family: Inter/, 'and the family it loads is the one it names');
}

// The policy still produces a real brief through the path the pipeline uses —
// classification is a hypothesis, never an empty shell for an unknown product.
{
  const generic = buildWorldClassUiPolicy({ prompt: 'build me something useful for my niche workflow' });
  assert.ok(generic.systemPrompt.length > 3_000, 'an unclassifiable prompt still gets the full brief, not a thin fallback');
}

console.log('design system wiring tests passed');
