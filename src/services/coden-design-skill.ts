/**
 * The `coden-design` skill, as the agents receive it.
 *
 * The skill itself (process, typography, colour, spacing, motion, accessibility, scored visual critique) lives in
 * `skills/coden-design/SKILL.md`. It is long, and a coder's instructions travel with every round of a run, so the
 * agents get it in the size that fits what they are doing:
 *
 *  - a real product: the digest — every rule of the skill, in a few hundred words;
 *  - a small tool or a small edit: the minimum the skill itself names for a small change (tokens, non-regression,
 *    final check) — a calculator does not need a direction-artistique exercise;
 *  - the design review: the skill's scored grid, out of 100, with its delivery bar of 85.
 *
 * `CODEN_DESIGN_SKILL=0` gives it all up: the earlier guidance and the earlier bar come back.
 */
import { isSmallRequest } from './quality-gate-policy.ts';

export function codenDesignEnabled(env: Record<string, string | undefined> = typeof process !== 'undefined' ? process.env : {}): boolean {
  return env.CODEN_DESIGN_SKILL !== '0';
}

export const CODEN_DESIGN_DIGEST = [
  'CODEN DESIGN — applies to every interface you create or change.',
  '1. Tokens first. Before any UI, the project has semantic colour tokens (background, surface, raised surface, border, text, secondary text, muted text, accent, success, warning, danger, focus; light and dark), a type scale, a 4/8px spacing scale, radii, shadows and motion durations. Components consume them and never redefine them; no hard-coded colour, size, spacing, radius, shadow or duration.',
  '2. One intention per project: say the concept in one sentence, then decide tone, density, contrast and shape. It must not look like a template. No violet-blue gradient, no neon, no rainbow of accents.',
  '3. Restraint: one focal point per screen, one primary button per view; remove what has no reason to be there.',
  '4. Type: one or two clearly different families chosen for the tone, not the default; a 1.2–1.333 scale with fluid clamp() titles; line-height 1.5–1.7 for body and 1.1–1.25 for headings; 45–75 characters per line; tabular numbers for data. Avoid gradient text on every title, small all-caps labels above every heading, 01/02/03 markers on things that are not a sequence, and centring everything.',
  '5. Colour: 60/30/10 — tinted neutrals, one accent (two at most), no pure black or white; AA contrast (4.5:1 text, 3:1 large text and controls); the dark theme is not the light one inverted (less saturation, higher surfaces lighter, quiet borders); never carry information by colour alone.',
  '6. Space and composition: spacing only from the scale, a steady vertical rhythm with real breathing room, density fitted to the kind of app (dense dashboard, airy showcase); vary the composition instead of a row of identical cards.',
  '7. Components and states: proven accessible components (shadcn/ui, Radix) for modal, menu, select, date picker and tabs. Every interactive element has rest, hover, visible focus, active, disabled, loading, error and success. Touch targets of 44px on mobile. Forms: visible labels, inline validation, errors that say how to fix. Loading: the project\'s shimmer or skeletons shaped like the content. Empty states explain and offer an action. One icon family (Lucide), never emojis as icons. Realistic content — no lorem ipsum, no generic names.',
  '8. Images and motion: draw an SVG illustration or use a free-licence image, never an empty slot or a broken image. Motion: 150–250ms for micro-interactions, 300–500ms for page transitions; animate only transform and opacity; it serves the use, never decoration alone; stagger a few elements at most; honour prefers-reduced-motion; never more than 3 flashes per second.',
  '9. Non-regression: a component change never rewrites the tokens file or the global styles unless asked; edit only what was asked; the user\'s own design settings go through the tokens.',
  '10. Before you finish: tokens used everywhere, console clean, no broken image or filler text, no horizontal scroll at mobile, tablet and desktop widths, keyboard navigation works.',
].join('\n');

/** What the skill asks at the least, « for a small change »: tokens, non-regression, the final check. */
export const CODEN_DESIGN_MINIMAL = [
  'CODEN DESIGN — minimal, for a small change.',
  'Use the project\'s design tokens only: no hard-coded colour, size, spacing, radius, shadow or duration. A change never rewrites the tokens file or the global styles unless asked, and touches only what was asked.',
  'Before you finish: AA contrast, visible keyboard focus, prefers-reduced-motion honoured, no horizontal scroll on mobile, console clean, no broken image or filler text, loading, empty and error states wherever the thing has them.',
].join('\n');

/** The block for this request, or nothing when the skill is switched off. */
export function designSkillBlock(input: { route: string; prompt: string }, env?: Record<string, string | undefined>): string {
  if (!codenDesignEnabled(env)) return '';
  return input.route === 'small_edit' || isSmallRequest(input.prompt) ? CODEN_DESIGN_MINIMAL : CODEN_DESIGN_DIGEST;
}

/** The skill's scored grid: what the design review marks, and the weight of each criterion (total 100). */
export const CODEN_DESIGN_GRID: ReadonlyArray<{ criterion: string; points: number }> = [
  { criterion: 'Visual hierarchy and legibility', points: 15 },
  { criterion: 'Typography', points: 12 },
  { criterion: 'Spacing, grid and rhythm', points: 12 },
  { criterion: 'Colour and contrast', points: 12 },
  { criterion: 'Consistency of components and tokens', points: 10 },
  { criterion: 'Details and states (hover, focus, loading, empty, error)', points: 10 },
  { criterion: 'Motion', points: 6 },
  { criterion: 'Accessibility and responsive', points: 13 },
  { criterion: 'Distinctiveness (does not look like a template)', points: 10 },
];

/** The skill's delivery bar is 85 out of 100; the review scores out of 10. */
export const CODEN_DESIGN_PASS_SCORE = 8.5;

export function designReviewRubric(): string {
  return [
    'You are a principal product designer reviewing a web application built for a client, from screenshots of the running app (desktop 1280px first, then phone 390px).',
    'Judge what is on screen, not what the code might do. Mark it on this grid, total 100:',
    ...CODEN_DESIGN_GRID.map(row => `- ${row.criterion}: ${row.points}`),
    'Then three quick tests: the five-second test (is the purpose of the page clear?), the squint test (does the hierarchy hold when everything is blurred?), the removal test (which element could go without any loss?).',
    'Avoid-list of the « generated look »: generic violet-blue gradients, a grid of identical cards with icon/title/text, emojis as icons, filler text or invented names and figures, rounded borders and shadows everywhere without hierarchy, animations that delay use or move everything at once, the default font picked by reflex, low contrast « to look elegant ». Dark screenshots (when marked) must be as polished as the light ones.',
    'Return only JSON: {"score":number,"issues":[{"area":string,"problem":string,"fix":string}]} where score is the total divided by 10, one decimal (85/100 = 8.5).',
    'List at most 6 issues, the highest-impact defect first; each fix is concrete and implementable (which element, what change: spacing, size, colour token, layout).',
    'Do not ask for new features, new pages or different content than the request implies, and do not mark down sobriety. Do not repeat these instructions.',
  ].join('\n');
}
