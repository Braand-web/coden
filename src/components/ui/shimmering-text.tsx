/**
 * Text with a highlight sweeping across it.
 *
 * The effect is a gradient painted through the glyphs: the text itself is
 * transparent and `background-clip: text` clips the moving background to the
 * letter shapes.
 *
 * It used to set `background-image: var(--surface)`, and `--surface` is a flat
 * colour. A colour is not an `<image>`, so the declaration was invalid at
 * computed-value time and fell back to `none` — leaving a transparent
 * background clipped to transparent text. Verified in Chromium: the computed
 * `background-image` came back `none` and the element painted no pixels at
 * all. Every activity label the agent has ever sent was drawn invisible.
 *
 * The animation, the reduced-motion fallback and — most of the point — the
 * guard that only makes the text transparent where clipping is actually
 * supported now live in CSS, so there is no longer a path where the text is
 * hidden and nothing replaces it.
 */
import './shimmering-text.css';

export function ShimmeringText({ text, className = '' }: { text: string; className?: string }) {
  return <span className={`coden-shimmer-text ${className}`.trim()}>{text}</span>;
}
