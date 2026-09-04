import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STARTERS, STARTER_ENTRY_PLACEHOLDER, applyStarter, describeStarter, isStarterEntryUntouched, selectStarter } from './src/services/sandbox/starters.ts';

/*
 * The most expensive thing this product got wrong.
 *
 * Of the last twelve generations recorded in production, eleven left
 * `src/App.tsx` at its 194-byte placeholder — and seven of those were stamped
 * `verified`. One of them, a calculator, had a complete implementation in
 * `src/calculator.js`, `src/main.js` and `src/style.css`. None of it ran:
 * `index.html` loads `src/main.tsx`, which renders `App`, which still said
 * "Building…". The user's preview showed "Building…" forever and the run
 * reported success.
 *
 * Every existing check passed it, and each was right on its own terms. The
 * placeholder renders, so the preview is not blank. It raises no runtime
 * error. The build succeeds. And the pipeline's own scaffold guard only asked
 * whether *any* file had changed — several had.
 *
 * Only the entry file's own content answers the question that matters.
 */
for (const starter of Object.values(STARTERS)) {
  const scaffold = applyStarter(starter, []).files;
  assert.ok(starter.entryPath, `${starter.id} must name the file the model has to replace`);
  assert.ok(scaffold.some(file => file.path === starter.entryPath), `${starter.id} must ship ${starter.entryPath}`);

  // The untouched scaffold is exactly the case to catch.
  assert.equal(isStarterEntryUntouched(scaffold, starter), true, `${starter.id}: an untouched scaffold is not an application`);

  // Writing other files — however many, however large — does not build an app.
  const busyButEmpty = applyStarter(starter, [
    { path: 'src/calculator.js', content: 'export const add = (a, b) => a + b;\n'.repeat(40) },
    { path: 'src/main.js', content: 'import { add } from "./calculator.js";\n'.repeat(40) },
    { path: 'src/style.css', content: '.button { padding: 8px; }\n'.repeat(60) },
  ]).files;
  assert.equal(
    isStarterEntryUntouched(busyButEmpty, starter),
    true,
    `${starter.id}: files that ${starter.entryPath} never imports do not make an application`,
  );

  // Replacing the entry is what actually builds it.
  const real = applyStarter(starter, [
    { path: starter.entryPath, content: 'export default function App() {\n  return <main>Real application</main>;\n}\n' },
  ]).files;
  assert.equal(isStarterEntryUntouched(real, starter), false, `${starter.id}: a replaced entry is an application`);

  // A project that has no such file at all is a different situation, not this one.
  assert.equal(isStarterEntryUntouched(scaffold.filter(file => file.path !== starter.entryPath), starter), false);
}

/*
 * Why the guard that existed did not catch it.
 *
 * The pipeline asked whether any file differed from the scaffold baseline.
 * The busy-but-empty project above differs in three files, so it passed —
 * which is exactly how a calculator with no calculator in it was verified.
 */
{
  const starter = selectStarter('build me a calculator');
  const baseline = new Map(applyStarter(starter, []).files.map(file => [file.path, file.content]));
  const busyButEmpty = applyStarter(starter, [
    { path: 'src/calculator.js', content: 'export const add = (a, b) => a + b;\n' },
    { path: 'src/main.js', content: 'import { add } from "./calculator.js";\n' },
    { path: 'src/style.css', content: '.button { padding: 8px; }\n' },
  ]).files;
  const somethingChanged = busyButEmpty.some(file =>
    !/^(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/.test(file.path) && baseline.get(file.path) !== file.content);
  assert.equal(somethingChanged, true, 'the old rule is satisfied here — which is the bug');
  assert.equal(isStarterEntryUntouched(busyButEmpty, starter), true, 'and the new rule catches what it missed');
}

// Whitespace alone is not a rewrite, and must not read as one.
{
  const starter = selectStarter('build me a todo list');
  const padded = [{ path: starter.entryPath, content: `\n\n${STARTER_ENTRY_PLACEHOLDER}\n  ` }];
  assert.equal(isStarterEntryUntouched(padded, starter), true, 'reformatting the placeholder does not implement anything');
}

// And the pipeline must actually consult it, on the verification path.
{
  const pipeline = readFileSync(new URL('./src/services/multi-agent-pipeline.ts', import.meta.url), 'utf8');
  const verify = pipeline.slice(pipeline.indexOf('verifyPreview:async () => {'));
  const body = verify.slice(0, verify.indexOf('afterRound,'));
  assert.match(body, /isStarterEntryUntouched\(files, starter\)/, 'verification must check the entry file, not just that something changed');
  assert.match(body, /preview\.ok=false/, 'an untouched entry must fail verification');
  assert.match(body, /starter\.entryPath/, 'the repair instruction must name the file to write');
}

/*
 * And the cause upstream of the check: nobody had told anyone about the scaffold.
 *
 * `describeExistingFiles` answered "This is a new project. Nothing exists
 * yet." for every new project — while the sandbox was launched with a full
 * React + Vite + Tailwind scaffold. A planner told the project is empty plans
 * for an empty project, which is why production plans read `src/calculator.js`,
 * `src/main.js`, `src/style.css`: a plain-JavaScript layout, planned into a
 * React app that imports none of it. `describeStarter` had existed all along
 * and was passed to nobody on this path.
 */
{
  const starter = selectStarter('une calculatrice simple');
  const briefing = describeStarter(starter);
  assert.match(briefing, /src\/main\.tsx/, 'the briefing must say what renders the app');
  assert.ok(briefing.includes(starter.entryPath), 'and name the file to replace');
  assert.match(briefing, /Building…/, 'and say that the placeholder is what the user currently sees');
  assert.match(briefing, /React \+ TypeScript|\.tsx/, 'and that this is a React/TypeScript project, not a plain-JS one');

  const planner = readFileSync(new URL('./src/services/planner-agent.ts', import.meta.url), 'utf8');
  assert.match(planner, /scaffold\?: string/, 'the planner must be able to receive the scaffold');
  assert.match(planner, /if \(scaffold\) return scaffold;/, 'and it must replace the "nothing exists yet" claim');

  const pipeline = readFileSync(new URL('./src/services/multi-agent-pipeline.ts', import.meta.url), 'utf8');
  const plannerCall = pipeline.slice(pipeline.indexOf('runPlannerAgent({'));
  assert.match(
    plannerCall.slice(0, plannerCall.indexOf('});')),
    /scaffold: starter \? describeStarter\(starter\) : undefined/,
    'the pipeline must brief the planner on the scaffold it will build on',
  );
  // The planner must be given it before the sandbox picks it, or the plan is
  // written for a scaffold that was chosen afterwards.
  assert.ok(
    pipeline.indexOf('const starter = input.route ===') < pipeline.indexOf('runPlannerAgent({'),
    'the scaffold must be chosen before the plan is written',
  );
  // And round one carries it too, for the coder that executes the plan.
  const instruction = pipeline.slice(pipeline.indexOf('const initialInstruction ='));
  assert.match(instruction.slice(0, 900), /describeStarter\(starter\)/, "the coder's first instruction must carry the scaffold rules");
  assert.match(instruction.slice(0, 900), /starter\.entryPath/, 'and name the entry file it must reach');
}

console.log('scaffold-is-not-an-app tests passed');
