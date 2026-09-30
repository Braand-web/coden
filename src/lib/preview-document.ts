/*
 * A thumbnail must not need the application to boot successfully.
 *
 * The preview frame is sandboxed with `allow-scripts` and deliberately WITHOUT
 * `allow-same-origin`: granting both to a srcDoc served from our own origin
 * would let the framed document reach into this page and drop its own sandbox,
 * which is an absurd price for a picture. The cost of that correct choice is an
 * opaque origin, where merely touching `localStorage` throws a SecurityError
 * synchronously — and a generated app that reads storage while mounting dies
 * before it paints anything.
 *
 * That is not hypothetical: the stored preview for this account's most recent
 * project is 60KB carrying `<script>`, `localStorage` and `sessionStorage`, and
 * its tile rendered as an empty dark rectangle.
 *
 * So the frame gets an in-memory stand-in, installed before the app's own
 * scripts run. A thumbnail has nothing to persist; it only has to survive
 * asking.
 */
const PREVIEW_STORAGE_SHIM = `<script>(function(){
  try {
    var store = function () {
      var data = Object.create(null);
      return {
        getItem: function (k) { return k in data ? data[k] : null; },
        setItem: function (k, v) { data[k] = String(v); },
        removeItem: function (k) { delete data[k]; },
        clear: function () { data = Object.create(null); },
        key: function (i) { return Object.keys(data)[i] || null; },
        get length() { return Object.keys(data).length; },
      };
    };
    for (var i = 0; i < 2; i++) {
      var name = i === 0 ? 'localStorage' : 'sessionStorage';
      var value = store();
      try { Object.defineProperty(window, name, { value: value, configurable: true, writable: false }); }
      catch (e) { try { window[name] = value; } catch (ignored) {} }
    }
  } catch (e) {}
})();</scr` + `ipt>`;

/** Put the shim before anything the document runs of its own. */
export function previewDocumentWithStorageShim(html: string): string {
  const head = html.search(/<head[^>]*>/i);
  if (head >= 0) {
    const insertAt = html.indexOf('>', head) + 1;
    return html.slice(0, insertAt) + PREVIEW_STORAGE_SHIM + html.slice(insertAt);
  }
  // No <head>: the browser builds one, and a leading script still runs first.
  return PREVIEW_STORAGE_SHIM + html;
}

