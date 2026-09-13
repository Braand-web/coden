import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const motion = read('./src/styles/motion-tokens.css');
const horizon = read('./src/styles/coden-horizon-system.css');
const dashboardCss = read('./src/styles/dashboard-react.css');
const dashboardTsx = read('./src/dashboard-react.tsx');
const landing = read('./src/landing-v3.ts');
const builder = read('./src/builder-live.ts');
const cloudCss = read('./src/styles/cloud-console.css');

/*
 * The motion contract reaches every surface.
 *
 * motion-tokens.css has existed for a while and was imported by index.css and
 * coden-shell.css — which reach the landing's secondary pages and the builder.
 * The dashboard imports neither, so `var(--transition-control)` resolved to
 * nothing there and every duration in that file had to be written by hand.
 * The design system is the one stylesheet all four entry points load, so the
 * contract rides with it.
 */
{
  assert.match(horizon, /@import "\.\/motion-tokens\.css";/, 'the design system carries the contract');

  // An @import is only honoured before other rules.
  const importAt = horizon.indexOf('@import "./motion-tokens.css"');
  const firstRule = horizon.search(/^[.:#a-zA-Z[]/m);
  assert.ok(importAt > 0, 'the import is present');
  assert.ok(firstRule > 0, 'and the file has rules to be ahead of');
  assert.ok(importAt < firstRule, 'and it is declared before the first of them');

  // The tokens the contract promised, including the two nothing had used.
  for (const token of ['--transition-control', '--transition-menu', '--ease-out']) {
    assert.match(motion, new RegExp(`${token}:`), `${token} is part of the contract`);
  }
  assert.match(dashboardCss, /animation: coden-dashboard-popover-in var\(--transition-menu\) both;/,
    'and the menu duration finally has a user');
}

/*
 * Nothing is hidden unless a script is there to bring it back.
 *
 * This is the whole safety argument for a scroll reveal. `opacity: 0` written
 * unconditionally in a stylesheet, waiting for a class that arrives from
 * JavaScript, is how a marketing page goes permanently blank for everyone
 * whose script failed, was blocked, or never ran. The hiding rule is therefore
 * gated behind an attribute that only the script sets, after it has decided it
 * is going to reveal.
 */
{
  assert.match(motion, /html\[data-coden-reveal="on"\] \[data-coden-reveal\] \{\s*opacity: 0;/,
    'the hiding rule is gated on the armed attribute');

  /*
   * No ungated opacity:0 anywhere else in the contract.
   *
   * Keyframes are excluded, and the distinction is the point: `from { opacity:
   * 0 }` is the start of an animation that runs on its own and always reaches
   * 1, whereas the same declaration in a static rule hides its element until
   * something else comes along to change it. Only the second kind can strand a
   * page blank.
   */
  const rules = motion
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '')
    .split('}');
  for (const rule of rules) {
    if (!/opacity:\s*0\s*;/.test(rule)) continue;
    assert.match(rule, /data-coden-reveal="on"/,
      `every opacity:0 is behind the armed attribute, not this one: ${rule.trim().slice(0, 60)}`);
  }

  // And the attribute comes from the script, never from the markup.
  assert.match(landing, /document\.documentElement\.dataset\.codenReveal = 'on';/, 'the script arms it');
  assert.doesNotMatch(motion, /html\[data-coden-reveal="on"\]\s*\{/, 'the stylesheet never arms itself');

  /*
   * Two exits before anything is hidden: a reader who asked for less motion,
   * and a browser that cannot observe. Both must return before the attribute
   * is set, or they get the hidden page without the mechanism that unhides it.
   */
  const armAt = landing.indexOf("dataset.codenReveal = 'on'");
  const reducedAt = landing.indexOf("matchMedia('(prefers-reduced-motion: reduce)').matches) return");
  const observerAt = landing.indexOf("typeof IntersectionObserver !== 'function') return");
  assert.ok(reducedAt > 0 && reducedAt < armAt, 'reduced motion returns before anything is hidden');
  assert.ok(observerAt > 0 && observerAt < armAt, 'and so does a browser that cannot observe');

  /*
   * The fold is never hidden. It is the headline and the composer — hiding it
   * to fade it back in is a blank first paint charged to every visitor, to
   * animate the thing they were already looking at.
   */
  assert.match(landing, /const targets = sections\.slice\(1\);/, 'the first section is excluded');

  // A bounded net: anything on screen that the observer missed is shown anyway.
  assert.match(landing, /getBoundingClientRect\(\)\.top < fold\) reveal\(section\)/,
    'and whatever ends up visible unrevealed is revealed regardless');
}

/*
 * A skeleton is worth having only if it is the same size as what replaces it.
 *
 * The dashboard grid loaded behind a 160px dashed rectangle reading
 * "Chargement des projets…" and then became three columns of cards, so every
 * load ended in a jump. A placeholder of the wrong size does not remove that
 * jump — it makes it prettier, and the jump was the expensive part.
 */
{
  assert.doesNotMatch(dashboardTsx, /coden-dashboard-loading"/, 'the dashed box is gone');
  assert.match(dashboardTsx, /function ProjectCardSkeleton\(\)/, 'replaced by a card-shaped skeleton');

  /*
   * Geometry, checked rather than asserted by eye. The caption row is centred
   * around a 36px avatar; the real copy comes to 35px, so the avatar sets the
   * row height. The skeleton keeps a 36px avatar and bars well under it, so
   * the same thing sets the height in both states and the row cannot resize.
   */
  const avatar = dashboardCss.slice(dashboardCss.indexOf('.coden-dashboard-project-card-avatar {'));
  assert.match(avatar.slice(0, avatar.indexOf('}')), /height: 36px;/, 'the real avatar is 36px');
  const ghost = dashboardCss.slice(dashboardCss.indexOf('.coden-dashboard-skeleton-avatar {'));
  assert.match(ghost.slice(0, ghost.indexOf('}')), /height: 36px;/, 'and so is the skeleton one');

  const bar = dashboardCss.slice(dashboardCss.indexOf('.coden-dashboard-skeleton-line {'));
  const barHeight = Number((bar.slice(0, bar.indexOf('}')).match(/height: (\d+)px;/) || [])[1]);
  assert.ok(barHeight > 0 && barHeight < 36,
    `the bars cannot be what sets the row height (${barHeight}px against a 36px avatar)`);

  // The tile is the card's own element, so it inherits the 16/10 ratio rather
  // than declaring a second one that could drift from it.
  assert.match(dashboardTsx, /className="coden-dashboard-project-preview coden-skeleton"/,
    'the tile is the card tile');

  /*
   * Six of them, because six is what the grid shows before the cap. A skeleton
   * standing in for a different number of cards reintroduces the shift.
   */
  assert.match(dashboardTsx, /Array\.from\(\{ length: 6 \}/, 'six, matching the grid');
  assert.match(dashboardCss, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/, 'three across');

  // The sentence survives where a sentence was right — for a screen reader.
  assert.match(dashboardTsx, /className="coden-dashboard-loading-label" role="status">Chargement des projets…/,
    'the announcement is kept');
  const label = dashboardCss.slice(dashboardCss.indexOf('.coden-dashboard-loading-label {'));
  assert.match(label.slice(0, label.indexOf('}')), /clip-path: inset\(50%\);/,
    'but not drawn, where it would take a cell of the grid');
}

/*
 * The Cloud console stopped announcing a table as one line of text.
 *
 * Seven places rendered "Chargement des tables…" into a region about to fill
 * with rows. A line of text and a table are not the same height, so each of
 * those loads shoved the rest of the panel down the page.
 */
{
  assert.doesNotMatch(builder, /db-state">Chargement/, 'no loading state is a bare sentence any more');
  assert.match(builder, /function dbLoadingSkeleton\(label: string, rows = 4\): string/, 'they share one skeleton');

  const calls = (builder.match(/dbLoadingSkeleton\(/g) || []).length;
  assert.ok(calls >= 8, `every site uses it (definition + ${calls - 1} call sites)`);

  // Announced for a screen reader, where the sentence was the right answer and
  // a row of grey bars says nothing at all.
  assert.match(builder, /role="status" aria-label="\$\{escapeHtml\(label\)\}"/, 'and each one still says what it is');
  assert.match(cloudCss, /\.db-skeleton-row \{[^}]*height: 14px;/, 'the bars are row-shaped');
}

/*
 * Everything introduced here can be switched off.
 *
 * Scoped by name rather than as a blanket `* { animation-duration: .01ms }`:
 * that override also fires every animationend handler in the app a frame after
 * load, which is a behaviour change and not an accessibility one.
 */
{
  const reducedAt = motion.indexOf('@media (prefers-reduced-motion: reduce)');
  assert.ok(reducedAt > 0, 'the contract has a reduced-motion block');
  const reduced = motion.slice(reducedAt);
  assert.match(reduced, /\.coden-skeleton \{[\s\S]*?animation: none;/, 'the skeleton sweep stops');
  assert.match(reduced, /background-image: none;/, 'and leaves a plain tint that still reads as loading');
  assert.match(reduced, /\.coden-enter,\s*\n\s*\.coden-enter-stagger > \* \{\s*\n\s*animation: none;/,
    'entrances stop');
  // A universal selector standing alone, not the `> *` of a scoped child rule.
  assert.doesNotMatch(reduced, /^\s*\*\s*[,{]/m, 'without a blanket override');

  // The press feedback too — it is a transform, and transforms are motion.
  assert.match(dashboardCss, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?:active[\s\S]*?transform: none;/,
    'and so does the press feedback');
}

/*
 * The stagger is capped.
 *
 * An uncapped 24ms step puts the sixty-third project of this account a second
 * and a half behind the first. That is not an entrance, it is a queue.
 */
{
  assert.match(motion, /\.coden-enter-stagger > :nth-child\(n\+6\) \{ animation-delay: 120ms; \}/,
    'everything past the sixth arrives together');
  const delays = [...motion.matchAll(/animation-delay: (\d+)ms;/g)].map(m => Number(m[1]));
  assert.ok(delays.length >= 5, `the stagger has steps to cap (${delays.length})`);
  assert.ok(Math.max(...delays) <= 200, `and the longest wait is short (${Math.max(...delays)}ms)`);
}

/*
 * And the dashboard stopped spelling its own durations.
 *
 * Five hand-written variants of "a control responding to a pointer", spread
 * over 40ms and two easing curves nobody chose deliberately.
 */
{
  assert.doesNotMatch(dashboardCss, /\b1[4-8]0ms (ease|cubic-bezier)/,
    'no hand-written control durations remain');
  assert.ok((dashboardCss.match(/var\(--transition-control\)/g) || []).length >= 20,
    'they all point at the contract instead');
}

console.log('motion and skeleton tests passed');
