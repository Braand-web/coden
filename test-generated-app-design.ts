import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CODEN_GENERATED_APP_DESIGN_PROMPT,
  CODEN_GENERATED_APP_DESIGN_VERSION,
} from './src/lib/prompts/generated-app-design.ts';

/**
 * The design contract for generated applications.
 *
 * Two things are pinned here, and the second matters more than the first.
 *
 * That the rules are present is easy. That nothing *else* in the prompt stack
 * contradicts them is the property that was actually broken: five separate
 * blocks each carried design rules, two of them opposed the rest, and the
 * model was left to arbitrate — which it did differently every run. A design
 * system that is contradicted is not a design system, so the absence of a
 * second authority is asserted as strictly as the presence of the first.
 */

const stack = readFileSync('./src/services/agent-prompt-stack.ts', 'utf8');

// -- the contract is present and versioned -----------------------------
assert.match(CODEN_GENERATED_APP_DESIGN_PROMPT, new RegExp(CODEN_GENERATED_APP_DESIGN_VERSION));
assert.match(CODEN_GENERATED_APP_DESIGN_PROMPT, /single authority on their design/);

// Every numbered section of the specification, so a future edit cannot quietly
// drop one. These are the author's own headings.
for (const section of [
  'TYPOGRAPHIE', 'COULEURS', 'LAYOUT ET ESPACEMENT', 'COMPOSANTS',
  'STRUCTURE DE PAGE ET NAVIGATION', 'CONTENU ET RÉDACTION', 'IMAGES ET MÉDIAS',
  'ANIMATIONS ET EFFETS', 'PERFORMANCE PERÇUE', 'COHÉRENCE MULTI-ÉCRANS',
  'ACCESSIBILITÉ', 'ANTI-PATTERNS À PROSCRIRE',
]) {
  assert.ok(CODEN_GENERATED_APP_DESIGN_PROMPT.includes(section), `the contract must keep section ${section}`);
}

// The rules with numbers in them are the ones most likely to drift, and the
// ones a model cannot infer.
for (const rule of [
  'chroma OKLCH <= 0.02',            // tinted neutrals, never pure
  '4 / 8 / 12 / 16 / 24 / 32 / 48 / 64px',
  '60-80 caractères',
  '4.5:1',                            // WCAG AA
  '44px',                             // touch targets
  'cubic-bezier(0.4, 0, 0.2, 1)',
  'prefers-reduced-motion',
]) {
  assert.ok(CODEN_GENERATED_APP_DESIGN_PROMPT.includes(rule), `the contract must keep the rule "${rule}"`);
}

// -- it reaches the model ----------------------------------------------
assert.match(stack, /import \{ CODEN_GENERATED_APP_DESIGN_PROMPT \}/, 'the contract must be imported');
assert.match(stack, /^\s*CODEN_GENERATED_APP_DESIGN_PROMPT,$/m, 'and injected into the generation prompt stack');

// -- and nothing contradicts it ----------------------------------------
/**
 * The specific contradictions that existed, each named so a regression says
 * what it broke rather than merely that something matched.
 */
const CONTRADICTIONS: Array<[RegExp, string]> = [
  [/default fonts \(Inter/i, 'a block banned Inter while the contract recommends it'],
  [/Use HSL variables/i, 'a block mandated HSL while the contract mandates OKLCH'],
  [/themed through shadcn\/ui component variants/i, 'a block mandated shadcn theming, which decides the colour space for us'],
  [/left border accent/i, 'a block prescribed a coloured left border, which the contract forbids (§12)'],
  [/#FFFFFF;|#FFFFFF"/i, 'a block prescribed pure white, which the contract forbids (§2)'],
  [/allow more expressive motion/i, 'a block licensed decorative motion, which the contract forbids (§8)'],
];
for (const [pattern, why] of CONTRADICTIONS) {
  assert.doesNotMatch(stack, pattern, why);
}

// The superseded blocks are gone, not merely unreferenced: a policy left
// declared in the file reads as active to anyone maintaining it, and three of
// these were dead for long enough that their rules had drifted 13k characters
// away from anything the model ever saw.
for (const dead of [
  'CODEN_GENERATED_APP_DESIGN_SYSTEM_POLICY',
  'CODEN_FRONTEND_CRAFT_POLICY',
  'CODEN_RESPONSIVE_ACCESSIBILITY_POLICY',
  'CODEN_MOTION_POLISH_POLICY',
  'CODEN_DESIGN_OVERRIDE_POLICY',
  'CODEN_DESIGN_EXCELLENCE_POLICY',
  'CODEN_PREMIUM_UI_ESCALATION_POLICY',
  'CODEN_DESIGN_SYSTEM_TOKENS_PROMPT',
]) {
  assert.ok(!stack.includes(dead), `${dead} was superseded and must not linger in the stack`);
}

// -- the mechanics survived the consolidation ---------------------------
// The rules say what the interface must be; these say what the code must
// contain for that to be true and for verification to be able to see it.
for (const mechanic of [
  'breakpoint variants',      // responsiveness must be visible in the code
  'motion-reduce:',           // the reduced-motion fallback, in the real stack
  'lucide-react',             // one icon set, the one the stack ships
  'honest empty state',       // never invent records
  'oklch()',                  // the colour space, as code
]) {
  assert.ok(CODEN_GENERATED_APP_DESIGN_PROMPT.includes(mechanic), `the implementation rules must keep "${mechanic}"`);
}

// -- it stays affordable -------------------------------------------------
// This rides on every generation request. The blocks it replaced totalled
// about 7k characters, so the contract must not be a quiet cost increase.
assert.ok(
  CODEN_GENERATED_APP_DESIGN_PROMPT.length < 12_000,
  `the design contract rides on every request, got ${CODEN_GENERATED_APP_DESIGN_PROMPT.length} chars`,
);

console.log('generated app design contract tests passed', JSON.stringify({
  chars: CODEN_GENERATED_APP_DESIGN_PROMPT.length,
  version: CODEN_GENERATED_APP_DESIGN_VERSION,
}));
