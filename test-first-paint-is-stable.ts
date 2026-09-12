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

/*
 * Hashed assets are cached; documents never are.
 *
 * This was one `express.static` with no options, which stamps
 * `Cache-Control: public, max-age=0` on everything it serves. For the
 * documents that is right. For `dist/assets/*` it is pure waste: Vite writes
 * the content hash into every one of those filenames, so `builder-Dq0kH8VK.js`
 * can never change meaning — a new build is a new name. Serving them with
 * max-age=0 made the browser revalidate each one on every load: eight or more
 * conditional round-trips between a returning user and their first paint,
 * none of which could ever return anything but 304.
 *
 * The documents go the other way. They were relying on the default, which is
 * correct at the origin but says nothing to a CDN in front of it — and
 * coden.fun sits behind one. An HTML file cached there keeps pointing at the
 * previous build's hashed assets, so a deploy appears not to have happened.
 */
{
  const server = readFileSync(new URL('server.ts', root), 'utf8');
  const block = server.slice(server.indexOf('const staticDir ='), server.indexOf('function pathExists('));

  assert.match(block, /public, max-age=31536000, immutable/, 'content-hashed assets are cached for a year');
  assert.match(block, /res\.setHeader\('Cache-Control', 'no-cache'\)/, 'and documents are always revalidated');

  // The rule must match what Vite actually emits, and nothing else. An
  // unhashed file under assets/ is NOT safe to freeze for a year.
  const isAsset = (p: string) => /[\\/]assets[\\/]/.test(p) && /-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/i.test(p);
  assert.equal(isAsset('/dist/assets/builder-Dq0kH8VK.js'), true, 'a hashed bundle is immutable');
  assert.equal(isAsset('/dist/assets/builder-chat-ui-DdUxGvg5.js'), true, 'including a hyphenated name');
  assert.equal(isAsset('/dist/assets/logo.svg'), false, 'an unhashed asset is not frozen for a year');
  assert.equal(isAsset('/dist/builder.html'), false, 'and neither is a document');
}

/*
 * The publish panel is legible in every state.
 *
 * A user sent the same screenshot twice: title "Publication", a full-width
 * blue button reading "Vérifier d'abord", a counter reading 0, and a large
 * empty area between them. Three separate design faults, all of which made a
 * panel that had simply not received its status look like a broken one.
 */
{
  const panel = live.slice(live.indexOf('function renderPublishPanel('), live.indexOf('async function openPublishPanel('));

  // The placeholder is visible. It was a bare div tinted var(--bg-input),
  // which on a dark surface is the panel's own colour — an invisible box.
  assert.match(panel, /cdn-pub__url--pending/, 'the pending row keeps the real row\'s shape');
  assert.match(panel, /cdn-pub__shimmer/, 'and animates inside it');
  assert.doesNotMatch(panel, /background:var\(--bg-input\);"><\/div>/, 'the invisible placeholder is gone');

  const css = readFileSync(new URL('src/styles/publish-panel.css', root), 'utf8');
  assert.match(css, /@keyframes cdn-pub-shimmer/, 'the shimmer is real animation, not a tinted box');
  assert.match(css, /prefers-reduced-motion: reduce\)\s*\{\s*\.cdn-pub__shimmer \{ animation: none; \}/,
    'and it stops for readers who asked for less motion');

  // A bare "0" reads as "zero checks ran", which is the one thing it never
  // means: buildPublishStatus always returns five.
  assert.match(panel, /\$\{status && visibleCheckCount\n?\s*\? `<span class="cdn-pub__count"/, 'the count appears only when it counts something');

  // The loudest element on the panel was also the least informative: one
  // filled bar whether it could publish, could not act, or offered a retry.
  assert.match(panel, /data-variant="\$\{statusMissing \? 'retry' : canPublish \? 'go' : 'idle'\}"/,
    'the primary action is styled by what it can actually do');
  assert.match(css, /\.cdn-pub__primary\[data-variant='retry'\]/, 'a retry is an outline, not an achievement');
  assert.match(css, /\.cdn-pub__primary\[data-variant='idle'\]:disabled/, 'and an inert action recedes');
}

console.log('publish panel design tests passed');

/*
 * The conversation container is emptied before React mounts into it, never after.
 *
 * This is a regression the shell split caused and a test has to hold shut.
 * `ensureConversationApi` mounts the island INTO the chat scroll container,
 * and `loadProject` used to empty that same container with `innerHTML = ''`.
 * Both lived in one `init()`, so the wipe happened first by accident of
 * ordering. Moving the shell to DOMContentLoaded reversed it: the island
 * mounted at DOM-ready, `loadProject` ran later at auth-ready and deleted
 * every node React believed it had rendered. The feed showed nothing at all —
 * no restored history, no streaming — while React reconciled against a tree
 * whose DOM was gone.
 *
 * The wipe now lives inside the mount, which is what makes the order
 * impossible to reverse again: the only code that empties the container is the
 * code that then fills it.
 */
{
  const mount = live.slice(live.indexOf('function ensureConversationApi()'), live.indexOf('function bindConversationFeedbackBridge'));

  assert.match(mount, /scroll\.innerHTML = '';/, 'the container is emptied at mount time');
  assert.ok(
    mount.indexOf("scroll.innerHTML = ''") < mount.indexOf('mountBuilderConversation('),
    'and emptied BEFORE React is given the container, not after',
  );
  assert.match(mount, /if \(conversationApi\) return conversationApi;/, 'a second call never re-empties a live feed');

  // loadProject must not touch it: that is the ordering that broke.
  const load = live.slice(live.indexOf('async function loadProject()'), live.indexOf('function restoreMessages('));
  assert.doesNotMatch(load, /scroll\.innerHTML = ''/, 'loadProject no longer empties the conversation container');
  assert.doesNotMatch(load, /dataset\.liveInitialized = 'true'/, 'nor claims to have initialised it');

  // And the clear-then-restore pair still sits together, so a failed load
  // cannot leave an emptied feed behind.
  assert.ok(
    load.indexOf("ensureConversationApi()?.clear()") < load.indexOf('restoreMessages(payload)'),
    'the feed is replaced as one swap rather than emptied and hoped for',
  );
  assert.ok(
    load.indexOf('await ensureProject()') < load.indexOf("ensureConversationApi()?.clear()"),
    'and only once the payload that will replace it is in hand',
  );
}

console.log('conversation container ownership tests passed');
