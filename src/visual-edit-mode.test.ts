import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { isVisualEditPrompt } from './services/preview-tool/preview-policy';
import { buildInstruction, createPreviewPicker, parsePickerMessage, PICKER_CHANNEL, sanitizeTarget, scopeSummary } from './visual-edit-mode';

const picked = { tag: 'button', selector: 'button.cta', path: 'main > section.hero > button.cta', text: 'Commander', label: '', html: '<button class="cta">Commander</button>', rect: { x: 10, y: 20, width: 120, height: 40 } };

describe('the sentence the pick becomes', () => {
  it('is the one the agents recognise, in either language', () => {
    expect(isVisualEditPrompt(buildInstruction(picked, true))).toBe(true);
    expect(isVisualEditPrompt(buildInstruction(picked, false))).toBe(true);
  });

  it('names the element, its words and where it is, precisely enough to find it again', () => {
    const sentence = buildInstruction(picked, true);
    expect(sentence).toContain('button');
    expect(sentence).toContain('« Commander »');
    expect(sentence).toContain('main > section.hero > button.cta');
  });

  it('falls back to the accessible label, then to the selector alone', () => {
    expect(buildInstruction({ ...picked, text: '', label: 'Fermer' }, true)).toContain('« Fermer »');
    expect(buildInstruction({ ...picked, text: '', label: '' }, true)).toContain('(main > section.hero > button.cta)'.slice(1, -1));
  });
});

describe('what comes back from the preview is untrusted', () => {
  it('is bounded, field by field', () => {
    const target = sanitizeTarget({ ...picked, text: 'x'.repeat(500), html: 'y'.repeat(5000), path: 'a'.repeat(900), rect: { x: 1e12, y: -1e12, width: NaN, height: '9' } })!;
    expect(target.text.length).toBeLessThanOrEqual(80);
    expect(target.html.length).toBeLessThanOrEqual(400);
    expect(target.path.length).toBeLessThanOrEqual(240);
    expect(target.rect).toEqual({ x: 100000, y: -100000, width: 0, height: 9 });
  });

  it('lets only the characters of a selector through, so it cannot become instructions or markup', () => {
    const target = sanitizeTarget({ ...picked, selector: 'div.a<script>alert(1)</script>', path: 'main > div[onclick="x"] > p' })!;
    expect(target.selector).not.toMatch(/[<"=\[\]]/);
    expect(target.path).not.toMatch(/[\["=\]]/);
  });

  it('refuses a tag that is not a tag, and a pick with nothing to find it by', () => {
    expect(sanitizeTarget({ ...picked, tag: 'div onclick=1' })).toBeNull();
    expect(sanitizeTarget({ ...picked, tag: '' })).toBeNull();
    expect(sanitizeTarget({ tag: 'div', selector: '', path: '' })).toBeNull();
    expect(sanitizeTarget(null)).toBeNull();
    expect(sanitizeTarget('x')).toBeNull();
  });

  it('is accepted only from the preview’s own window', () => {
    const frameWindow = {};
    const message = { source: frameWindow, data: { __coden: PICKER_CHANNEL, type: 'selected', target: picked } };
    expect(parsePickerMessage(message, frameWindow)?.type).toBe('selected');
    expect(parsePickerMessage({ ...message, source: {} }, frameWindow)).toBeNull();
    expect(parsePickerMessage(message, null)).toBeNull();
    expect(parsePickerMessage({ source: frameWindow, data: { __coden: 'other', type: 'selected', target: picked } }, frameWindow)).toBeNull();
    expect(parsePickerMessage({ source: frameWindow, data: { __coden: PICKER_CHANNEL, type: 'selected', target: { tag: 'x y' } } }, frameWindow)).toBeNull();
    expect(parsePickerMessage({ source: frameWindow, data: 'text' }, frameWindow)).toBeNull();
  });
});

describe('the scope the person sees', () => {
  it('says which element will change and that the rest will not', () => {
    const summary = scopeSummary(picked, true);
    expect(summary.title).toBe('button « Commander »');
    expect(summary.where).toBe('main > section.hero > button.cta');
    expect(summary.scope).toMatch(/Seul cet élément/);
    expect(summary.scope).toMatch(/reste de l’application reste tel quel/);
    expect(scopeSummary(picked, false).scope).toMatch(/Only this element/);
  });
});

describe('the picker', () => {
  function setup() {
    const frameWindow = { postMessage: vi.fn() };
    const listeners = new Map<string, (event: any) => void>();
    const host = { addEventListener: (type: string, fn: any) => listeners.set(type, fn), removeEventListener: (type: string) => listeners.delete(type) };
    const picks: any[] = [];
    const changes: boolean[] = [];
    const picker = createPreviewPicker({ getIframe: () => ({ contentWindow: frameWindow }) as any, isFrench: () => true, onPick: target => picks.push(target), onChange: active => changes.push(active), target: host as any });
    return { frameWindow, listeners, picks, changes, picker };
  }

  it('switches the preview’s mode on and off', () => {
    const { frameWindow, picker } = setup();
    expect(picker.toggle()).toBe(true);
    expect(frameWindow.postMessage).toHaveBeenLastCalledWith({ __coden: PICKER_CHANNEL, type: 'mode', on: true }, '*');
    expect(picker.toggle()).toBe(false);
    expect(frameWindow.postMessage).toHaveBeenLastCalledWith({ __coden: PICKER_CHANNEL, type: 'mode', on: false }, '*');
  });

  it('a pick ends the mode and hands over the target with its sentence', () => {
    const { frameWindow, listeners, picks, changes, picker } = setup();
    picker.toggle();
    listeners.get('message')!({ source: frameWindow, data: { __coden: PICKER_CHANNEL, type: 'selected', target: picked } });
    expect(picker.active).toBe(false);
    expect(changes).toEqual([true, false]);
    expect(picks[0].instruction).toMatch(/^Modifie cet élément de la page :/);
  });

  it('Escape in the preview ends the mode without a pick; a stranger’s message changes nothing', () => {
    const { frameWindow, listeners, picks, picker } = setup();
    picker.toggle();
    listeners.get('message')!({ source: {}, data: { __coden: PICKER_CHANNEL, type: 'selected', target: picked } });
    expect(picks).toHaveLength(0);
    expect(picker.active).toBe(true);
    listeners.get('message')!({ source: frameWindow, data: { __coden: PICKER_CHANNEL, type: 'cancelled' } });
    expect(picker.active).toBe(false);
  });

  it('can take the outline off, and lets go of its listener', () => {
    const { frameWindow, listeners, picker } = setup();
    picker.clearSelection();
    expect(frameWindow.postMessage).toHaveBeenLastCalledWith({ __coden: PICKER_CHANNEL, type: 'clear' }, '*');
    picker.dispose();
    expect(listeners.has('message')).toBe(false);
  });
});

describe('in the builder', () => {
  const builder = readFileSync('src/builder-live.ts', 'utf8');
  const html = readFileSync('builder.html', 'utf8');

  it('sets the composer through the island, not on its DOM node, and drops the target when the message is sent', () => {
    const fn = builder.slice(builder.indexOf('function applyVisualEditTarget'), builder.indexOf('function showTargetChip'));
    expect(fn).toMatch(/composerValue = /);
    expect(fn).toMatch(/renderComposer\(\)/);
    expect(fn).not.toMatch(/composer\.value =/);
    expect(builder).toMatch(/renderComposer\(\);\n    clearVisualEditTarget\(\);/);
  });

  it('shows the scope with textContent only, in a labelled group with a way to remove it', () => {
    const chip = builder.slice(builder.indexOf('function showTargetChip'), builder.indexOf('/** The target is spent'));
    expect(chip).not.toMatch(/innerHTML/);
    expect(html).toMatch(/id="coden-target-chip" hidden role="group" aria-label="Élément ciblé"/);
    expect(html).toMatch(/id="coden-target-clear"[^>]*aria-label="Retirer la cible"/);
  });

  it('the saved rendering carries the inspector too, and the mode needs a real app on screen', () => {
    expect(builder).toMatch(/frame\.srcdoc = injectPreviewInspector\(withHiddenPreviewScrollbars\(html\)\)/);
    expect(builder).toMatch(/if \(!hasReadyAppPreview\(\)\) return;\n    previewPicker\?\.toggle\(\)/);
  });
});
