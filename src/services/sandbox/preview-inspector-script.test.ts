// @vitest-environment happy-dom
import { Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';
import { INSPECTOR_MARKER, injectPreviewInspector, PICKER_CHANNEL, PREVIEW_INSPECTOR_SCRIPT, previewPickerEnabled } from './preview-inspector-script';

describe('injecting the inspector', () => {
  it('goes at the end of the body, once', () => {
    const html = '<html><body><h1>Hi</h1></body></html>';
    const out = injectPreviewInspector(html);
    expect(out.indexOf(INSPECTOR_MARKER)).toBeGreaterThan(out.indexOf('</h1>'));
    expect(out.indexOf(INSPECTOR_MARKER)).toBeLessThan(out.lastIndexOf('</body>'));
    expect(injectPreviewInspector(out)).toBe(out);
  });

  it('is appended to a fragment, and leaves an empty document alone', () => {
    expect(injectPreviewInspector('<div>x</div>')).toContain(INSPECTOR_MARKER);
    expect(injectPreviewInspector('')).toBe('');
  });

  it('cannot close its own tag early', () => {
    expect(PREVIEW_INSPECTOR_SCRIPT.toLowerCase()).not.toContain('</script');
  });

  it('can be switched off', () => {
    expect(previewPickerEnabled({})).toBe(true);
    expect(previewPickerEnabled({ CODEN_PREVIEW_PICKER: '0' })).toBe(false);
  });
});

describe('inside a page', () => {
  /** Each test gets a window of its own: the script keeps listeners on its document for as long as the page lives. */
  function makePage(html: string) {
    const win: any = new Window({ url: 'https://app.example/' });
    win.document.body.innerHTML = html;
    const posted: any[] = [];
    const parent = { postMessage: (data: any) => posted.push(data) };
    Object.defineProperty(win, 'parent', { value: parent, configurable: true });
    win.eval(PREVIEW_INSPECTOR_SCRIPT);
    const toPage = (data: any, source: any = parent) => win.dispatchEvent(Object.assign(new win.Event('message'), { data, source }));
    const click = (selector: string) => {
      const event = new win.MouseEvent('click', { bubbles: true, cancelable: true });
      win.document.querySelector(selector).dispatchEvent(event);
      return event;
    };
    return { win, posted, toPage, click };
  }
  const PAGE = '<main><section class="hero"><h2 id="title">Bienvenue chez Dupain</h2><button class="cta">Commander</button></section></main>';

  it('announces itself, then does nothing to the page while off', () => {
    const { posted, click } = makePage(PAGE);
    expect(posted[0]).toMatchObject({ __coden: PICKER_CHANNEL, type: 'ready' });
    expect(click('.cta').defaultPrevented).toBe(false);
    expect(posted.filter(item => item.type === 'selected')).toHaveLength(0);
  });

  it('on, a click selects the element, tells the parent what it is, and never reaches the app', () => {
    const { win, posted, toPage, click } = makePage(PAGE);
    let reached = false;
    win.document.querySelector('.cta').addEventListener('click', () => { reached = true; });
    toPage({ __coden: PICKER_CHANNEL, type: 'mode', on: true });
    expect(click('.cta').defaultPrevented).toBe(true);
    expect(reached).toBe(false);
    const selected = posted.find(item => item.type === 'selected');
    expect(selected.target).toMatchObject({ tag: 'button', selector: 'button.cta', text: 'Commander', path: 'main > section.hero > button.cta' });
    expect(selected.target.html).toContain('<button');
    // One pick ends the mode: the next click is the app's own again.
    expect(click('.cta').defaultPrevented).toBe(false);
  });

  it('describes a heading by its id and its words, with where it sits', () => {
    const { posted, toPage, click } = makePage(PAGE);
    toPage({ __coden: PICKER_CHANNEL, type: 'mode', on: true });
    click('#title');
    expect(posted.find(item => item.type === 'selected').target).toMatchObject({ selector: 'h2#title', text: 'Bienvenue chez Dupain', path: 'main > section.hero > h2#title' });
  });

  it('obeys only its parent window', () => {
    const { toPage, click } = makePage(PAGE);
    toPage({ __coden: PICKER_CHANNEL, type: 'mode', on: true }, { not: 'the parent' });
    expect(click('.cta').defaultPrevented).toBe(false);
  });

  it('does nothing at all when the page is not in a frame', () => {
    const win: any = new Window({ url: 'https://app.example/' });
    win.document.body.innerHTML = PAGE;
    win.eval(PREVIEW_INSPECTOR_SCRIPT);
    expect(win.__codenInspector).toBeUndefined();
  });

  it('Escape leaves the mode and says so', () => {
    const { win, posted, toPage, click } = makePage(PAGE);
    toPage({ __coden: PICKER_CHANNEL, type: 'mode', on: true });
    win.document.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(posted.some(item => item.type === 'cancelled')).toBe(true);
    expect(click('.cta').defaultPrevented).toBe(false);
  });

  it('keeps scripts and styles out of the markup it reports', () => {
    const { posted, toPage, click } = makePage('<div id="box">Texte<script>secret()</script><style>.a{}</style></div>');
    toPage({ __coden: PICKER_CHANNEL, type: 'mode', on: true });
    click('#box');
    const html = posted.filter(item => item.type === 'selected').pop().target.html;
    expect(html).not.toContain('secret()');
    expect(html).not.toContain('<style');
  });
});
