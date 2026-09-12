import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const root = new URL('./', import.meta.url);
const markup = readFileSync(new URL('builder.html', root), 'utf8');
const live = readFileSync(new URL('src/builder-live.ts', root), 'utf8');

/*
 * The interface is built before the session is known, because it never
 * depended on it.
 *
 * Every one of these calls used to sit in a single `init()` behind
 * `coden:auth-ready` — and that event waits on `getVerifiedSession({
 * allowRefresh: true })`, a network round-trip to Supabase. So for the whole
 * of that round-trip the composer sat in raw HTML: the mode button had no
 * background (`setChatMode` paints it inline), the toolbar was unbuilt, the
 * textarea unsized. Then the session resolved and all of them changed shape
 * at once.
 *
 * That is the "buttons change shape before settling" a user reports, and it
 * is not a rendering problem: it is a dependency that was never real. Of the
 * twenty-odd calls in that function, exactly one touches the network.
 */
{
  const shell = live.slice(live.indexOf('function initShell() {'), live.indexOf('let dataReady = false;'));

  // The shell runs on the DOM, not on a session.
  assert.doesNotMatch(shell, /apiFetch|loadProject\(|ensureModelSelector|ensureSettingsPanelLazy/,
    'nothing in the shell phase waits on the network');

  // The composer's appearance comes from localStorage, which is readable at once.
  assert.match(shell, /applySelectedModel\(readStoredSelectedModel\(\)\);/, 'the stored mode paints immediately');
  assert.match(shell, /ensureToolbar\(\);/, 'and the toolbar is built with it');
  assert.match(shell, /ensurePlanBuildControls\(\);/, 'along with the plan and build controls');

  // Sizing the textarea last means it measures a toolbar that already exists.
  const sizingAt = shell.lastIndexOf('normalizeAiChatInputs();');
  assert.ok(sizingAt > shell.indexOf('ensureToolbar();'), 'the composer is sized after the toolbar is built');

  // Running twice must be harmless: auth can resolve before DOMContentLoaded.
  assert.match(live, /let shellReady = false;/, 'the shell records that it ran');
  assert.match(live, /if \(shellReady\) return;/, 'and refuses to run twice');
  assert.match(live, /if \(dataReady\) return;/, 'and so does the data phase');

  // It is actually scheduled on the DOM, not on auth.
  assert.match(live, /if \(document\.readyState === 'loading'\) document\.addEventListener\('DOMContentLoaded', initShell, \{ once: true \}\);/,
    'the shell is built as soon as the document exists');
  assert.match(live, /else initShell\(\);/, 'or immediately when it already does');

  // And the session still drives the data.
  const data = live.slice(live.indexOf('function init() {'), live.indexOf("if (document.readyState === 'loading')"));
  assert.match(data, /initShell\(\);/, 'auth-first boots still get a shell');
  assert.match(data, /void loadProject\(\)\.then/, 'and the project still loads behind auth');
  assert.match(live, /window\.addEventListener\('coden:auth-ready', init\);/, 'from the same event as before');
}

/*
 * No page blocks its first paint on an external stylesheet.
 *
 * All eleven pages pulled a Google Fonts stylesheet with a plain `<link
 * rel="stylesheet">` in `<head>`. A stylesheet there blocks rendering until
 * it resolves, and this one costs two round-trips to two third-party origins
 * (googleapis, then gstatic) before anything at all is painted — which is the
 * white unstyled page a user sees before the app appears. The page's own CSS
 * is inline in the same head and was ready the whole time.
 */
{
  const pages = readdirSync(new URL('.', root)).filter(file => file.endsWith('.html'));
  assert.ok(pages.length >= 11, 'the whole site is covered, not one page');

  for (const page of pages) {
    const source = readFileSync(new URL(page, root), 'utf8');
    if (!source.includes('fonts.googleapis.com')) continue;

    // The stylesheet is fetched at print media and promoted on load, so it
    // never sits on the critical path.
    assert.match(source, /media="print" onload="this\.media='all';this\.onload=null"/,
      `${page} does not block first paint on the font stylesheet`);
    assert.match(source, /<link rel="preload" as="style"[^>]*fonts\.googleapis/, `${page} still fetches it early`);
    assert.match(source, /<noscript><link rel="stylesheet"[^>]*fonts\.googleapis/, `${page} still styles text without scripts`);

    /*
     * And `display=optional` rather than `swap`: swap repaints every element
     * the font touches the moment it lands, which is a layout shift on a page
     * that had already settled. Optional keeps the fallback for this view and
     * uses the real face from the next one, once it is cached.
     */
    assert.match(source, /display=optional/, `${page} does not reflow when the font lands`);
    assert.doesNotMatch(source, /display=swap/, `${page} has no swap left`);

    // A plain render-blocking link must not have crept back in.
    const blocking = source.match(/<link\b(?![^>]*media="print")[^>]*rel="stylesheet"[^>]*fonts\.googleapis[^>]*>/g) || [];
    const inNoscript = (source.match(/<noscript><link rel="stylesheet"[^>]*fonts\.googleapis[^>]*><\/noscript>/g) || []).length;
    assert.equal(blocking.length, inNoscript, `${page} has no render-blocking font stylesheet outside <noscript>`);
  }
}

/*
 * The composer has a visible caret and no scrollbar.
 *
 * `src/builder.css` already said `caret-color: var(--text)` — the right
 * answer, since a caret is a text cursor. The textarea's inline style
 * overrode it with `var(--accent)`, and an inline style always wins: in the
 * dark theme `--accent` is `#f5f7fb`, so the blinking bar was pure white.
 */
{
  const textarea = markup.slice(markup.indexOf('id="chat-textarea-box"'), markup.indexOf('id="chat-textarea-box"') + 700);

  assert.match(textarea, /caret-color: var\(--text\)/, 'the caret follows the text colour');
  assert.doesNotMatch(textarea, /caret-color: var\(--accent\)/, 'not the accent, which is white in the dark theme');

  // The bar goes; the scrolling stays. WebKit draws it inside the padding, so
  // it shifted the text sideways the moment a fourth line appeared.
  assert.match(textarea, /scrollbar-width: none/, 'no scrollbar on Firefox');
  assert.match(textarea, /-ms-overflow-style: none/, 'nor on legacy Edge');
  assert.match(markup, /\.chat-input-textarea::-webkit-scrollbar \{/, 'nor on WebKit');
  assert.match(textarea, /max-height: 200px/, 'and the composer still caps its height');
}

console.log('first paint is stable tests passed');
