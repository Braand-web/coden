/**
 * Safe embedding of generated content into the preview document.
 *
 * Generated CSS and code are untrusted input: the model writes them, and any
 * sequence that closes the element it sits in escapes into the surrounding
 * document. A stylesheet carrying `</style>` ended the style element early, the
 * rest of the document was reparsed as content, and the preview bootstrap
 * script stopped parsing — surfacing as `SyntaxError: Invalid or unexpected
 * token` with a blank preview and a run stuck in needs_fix.
 */

/**
 * Neutralize any sequence that would end the `<style>` element.
 *
 * `\/` is a valid CSS escape for `/`, so the declaration keeps its meaning
 * while the HTML tokenizer no longer sees a closing tag.
 */
export function styleSafeCss(css: string): string {
  return String(css || '').replace(/<\/(style)/gi, '<\\/$1');
}

/**
 * Neutralize any sequence that would end an inline `<script>` element.
 *
 * Applied to a JSON literal, where `\/` is a valid escape for `/`, so the
 * embedded value parses identically.
 */
export function scriptSafeJson(json: string): string {
  return String(json || '').replace(/<\/(script)/gi, '<\\/$1');
}
