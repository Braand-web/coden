import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { REDUCED_MOTION_PREVIEW_HOOK, restoreLegacyMotionPreview } from './preview-motion-compat.ts';

const legacyPreview = `<!doctype html><script>
    window.MotionMock = {
      AnimatePresence: function(props) { return props.children; },
      motion: new Proxy({}, {})
    };

    window.require = function(importPath) {
      if (importPath === "motion/react") return window.MotionMock;
    };
</script>`;

describe('saved React preview Motion compatibility', () => {
  it('repairs existing preview documents without changing their app source', () => {
    const repaired = restoreLegacyMotionPreview(legacyPreview);
    expect(repaired).toContain(REDUCED_MOTION_PREVIEW_HOOK);
    expect(repaired).toContain('motion: new Proxy({}, {})');
    expect(repaired).toContain('window.require = function(importPath)');
    expect(restoreLegacyMotionPreview(repaired)).toBe(repaired);
  });

  it('leaves unrelated and already compatible documents untouched', () => {
    expect(restoreLegacyMotionPreview('<h1>My app</h1>')).toBe('<h1>My app</h1>');
    const current = legacyPreview.replace(
      '      motion: new Proxy',
      `      ${REDUCED_MOTION_PREVIEW_HOOK}\n      motion: new Proxy`,
    );
    expect(restoreLegacyMotionPreview(current)).toBe(current);
  });

  it('supplies the hook used by the Coden scaffold and honors reduced motion', () => {
    const makeHook = new Function('window', `return ({ ${REDUCED_MOTION_PREVIEW_HOOK} }).useReducedMotion;`);
    expect(makeHook({ matchMedia: () => ({ matches: true }) })()).toBe(true);
    expect(makeHook({ matchMedia: () => ({ matches: false }) })()).toBe(false);
    expect(makeHook({})()).toBe(false);
  });

  it('uses the compatibility hook for new and persisted previews', () => {
    const server = readFileSync(new URL('../../server.ts', import.meta.url), 'utf8');
    expect(server).toContain('`      ${REDUCED_MOTION_PREVIEW_HOOK}`');
    expect(server).toContain('enhanceHtmlSeo(restoreLegacyMotionPreview(savedHtml)');
    expect(server).toContain('preview_html: restoreLegacyMotionPreview(project.preview_html || \'\')');
    expect(server).toContain('restoreLegacyMotionPreview(refreshLegacyPreviewStyles(String(snapshotPreview?.html || \'\').trim()');
  });
});
