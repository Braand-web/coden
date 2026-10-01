/**
 * The page inside the preview that lets a person point at an element.
 *
 * The preview is a generated app in a sandboxed frame: the builder cannot reach into its document. So the app is
 * served with this small script added, and the two talk by `postMessage`. Off, the script does nothing at all (no
 * listener on the page's own events); on, it draws an outline under the pointer, and a click — which never reaches the
 * app — sends back a description of the element: where it is in the page, its text, a bounded piece of its markup.
 *
 * Only the parent window is obeyed, and everything sent is what anyone looking at the page could read.
 */
export const PICKER_CHANNEL = 'picker';
export const INSPECTOR_MARKER = 'data-coden-inspector';

/** Kept as plain, dependency-free JavaScript: it runs inside whatever app the person generated. */
const SCRIPT = `
(function () {
  try {
    if (window.__codenInspector || window.parent === window) return;
    window.__codenInspector = true;
    var CH = '${PICKER_CHANNEL}', ON = false, hover = null, chosen = null, picked = null, frame = 0;
    var BLUE = '#3A83F7';
    function box(strong) {
      var d = document.createElement('div');
      d.setAttribute('data-coden-inspector-ui', '');
      d.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;box-sizing:border-box;border-radius:4px;display:none;' +
        (strong ? 'border:2px solid ' + BLUE + ';box-shadow:0 0 0 3px rgba(58,131,247,.25);' : 'border:2px dashed ' + BLUE + ';background:rgba(58,131,247,.08);');
      (document.body || document.documentElement).appendChild(d);
      return d;
    }
    function place(node, el) {
      if (!node) return;
      if (!el || !el.getBoundingClientRect) { node.style.display = 'none'; return; }
      var r = el.getBoundingClientRect();
      node.style.display = 'block';
      node.style.left = r.left + 'px'; node.style.top = r.top + 'px';
      node.style.width = r.width + 'px'; node.style.height = r.height + 'px';
    }
    function mine(el) { return !!(el && el.closest && el.closest('[data-coden-inspector-ui]')); }
    function clean(t) { return String(t || '').replace(/\\s+/g, ' ').trim(); }
    function cut(t, n) { t = clean(t); return t.length > n ? t.slice(0, n - 1) + '\\u2026' : t; }
    function part(el) {
      var tag = el.tagName.toLowerCase();
      if (el.id) return tag + '#' + el.id;
      var cls = String(el.getAttribute('class') || '').split(/\\s+/).filter(function (c) { return c && c.length <= 24 && !/^(css-|sc-)/.test(c); }).slice(0, 2).join('.');
      if (cls) return tag + '.' + cls;
      var p = el.parentElement;
      if (p) {
        var same = Array.prototype.filter.call(p.children, function (c) { return c.tagName === el.tagName; });
        if (same.length > 1) return tag + ':nth-of-type(' + (same.indexOf(el) + 1) + ')';
      }
      return tag;
    }
    function pathOf(el) {
      var out = [], n = el, i = 0;
      while (n && n.nodeType === 1 && n !== document.body && n !== document.documentElement && i < 4) { out.unshift(part(n)); n = n.parentElement; i++; }
      return out.join(' > ');
    }
    function describe(el) {
      var r = el.getBoundingClientRect();
      var html = '';
      try { html = el.cloneNode(true); var s = html.querySelectorAll ? html.querySelectorAll('script,style,svg') : []; for (var i = 0; i < s.length; i++) s[i].remove(); html = cut(html.outerHTML, 400); } catch (e) { html = ''; }
      return {
        selector: part(el), path: pathOf(el), tag: el.tagName.toLowerCase(),
        text: cut(el.innerText || el.textContent, 80),
        label: cut(el.getAttribute('aria-label') || el.getAttribute('alt') || el.getAttribute('title') || el.getAttribute('placeholder') || '', 80),
        html: html,
        rect: { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) },
        viewport: { width: window.innerWidth, height: window.innerHeight }
      };
    }
    function send(type, target) { try { window.parent.postMessage({ __coden: CH, type: type, target: target }, '*'); } catch (e) {} }
    function follow() { frame = 0; if (picked) place(chosen, picked); }
    function schedule() { if (!frame && picked) frame = requestAnimationFrame(follow); }
    function over(ev) { if (!ON) return; var el = ev.target; if (!el || el.nodeType !== 1 || mine(el) || el === document.documentElement || el === document.body) return; if (!hover) hover = box(false); place(hover, el); }
    function swallow(ev) { if (!ON) return; ev.stopImmediatePropagation(); }
    function click(ev) {
      if (!ON) return;
      var el = ev.target;
      ev.preventDefault(); ev.stopImmediatePropagation();
      if (!el || el.nodeType !== 1 || mine(el) || el === document.documentElement || el === document.body) return;
      if (!chosen) chosen = box(true);
      picked = el; place(chosen, el);
      setMode(false);
      send('selected', describe(el));
    }
    function key(ev) { if (ON && ev.key === 'Escape') { ev.preventDefault(); setMode(false); send('cancelled'); } }
    function setMode(on) {
      ON = !!on;
      if (!ON && hover) hover.style.display = 'none';
      document.documentElement.style.cursor = ON ? 'crosshair' : '';
    }
    function clear() { picked = null; if (chosen) chosen.style.display = 'none'; }
    document.addEventListener('mouseover', over, true);
    document.addEventListener('click', click, true);
    ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchend'].forEach(function (t) { document.addEventListener(t, swallow, true); });
    document.addEventListener('keydown', key, true);
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    window.addEventListener('message', function (ev) {
      if (ev.source !== window.parent) return;
      var d = ev.data;
      if (!d || d.__coden !== CH) return;
      if (d.type === 'mode') setMode(d.on);
      else if (d.type === 'clear') clear();
    });
    send('ready');
  } catch (e) {}
})();
`;

export const PREVIEW_INSPECTOR_SCRIPT = SCRIPT.trim();

/** Add the inspector to a document, once, as late as possible so the app has built its page first. */
export function injectPreviewInspector(html: string): string {
  const source = String(html || '');
  if (!source || source.includes(INSPECTOR_MARKER)) return source;
  const tag = `<script ${INSPECTOR_MARKER}>${PREVIEW_INSPECTOR_SCRIPT}</script>`;
  const at = source.toLowerCase().lastIndexOf('</body>');
  return at >= 0 ? `${source.slice(0, at)}${tag}${source.slice(at)}` : `${source}${tag}`;
}

export function previewPickerEnabled(env: Record<string, string | undefined> = typeof process !== 'undefined' ? process.env : {}): boolean {
  return env.CODEN_PREVIEW_PICKER !== '0';
}
