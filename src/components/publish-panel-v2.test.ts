// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicationStatusV2, PublishJobProgress, PublishSettings } from '../shared/publish';
import { mountPublishPanelV2, type PublishPanelV2Controller, type PublishPanelV2Options } from './publish-panel-v2';

const draft = (): PublishSettings => ({
  subdomain: 'atelier', audience: 'public', invitations: [],
  metadata: { title: 'Atelier', description: 'Les créations de notre atelier.', favicon: null, image: null },
});
const state = (overrides: Partial<PublicationStatusV2> = {}): PublicationStatusV2 => ({
  version: 2, proposed_url: 'https://atelier.coden.app', public_url: null, draft: draft(), effective: null,
  has_unpublished_changes: false, active_job: null, can_publish: true, can_use_workspace: false, checks: [], ...overrides,
});
const job = (overrides: Partial<PublishJobProgress> = {}): PublishJobProgress => ({
  id: 'job-1', status: 'processing', phase: 'building', message: 'Construction de la version enregistrée', sequence: 3, ...overrides,
});
const payload = (publish: PublicationStatusV2) => ({ success: true, publish });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
let controllers: PublishPanelV2Controller[];
let host: HTMLElement;
const get = <T extends HTMLElement = HTMLElement>(selector: string) => host.querySelector<T>(selector)!;
const click = async (action: string) => { get<HTMLButtonElement>(`[data-action="${action}"]`).click(); await flush(); };
const set = (name: string, value: string) => {
  const field = get<HTMLInputElement>(`[name="${name}"]`);
  field.value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
};
const commit = (name: string) => get(`[name="${name}"]`).dispatchEvent(new Event('change', { bubbles: true }));
const submit = async () => { get('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flush(); };
const mount = (request: PublishPanelV2Options['request'], extra: Partial<Pick<PublishPanelV2Options, 'onClose' | 'onStatus' | 'onManageDomains' | 'projectId'>> = {}) => {
  const controller = mountPublishPanelV2({ container: host, projectId: 'project-1', request, ...extra });
  controllers.push(controller);
  return controller;
};

beforeEach(() => {
  vi.useFakeTimers();
  controllers = [];
  host = document.createElement('div');
  document.body.append(host);
});
afterEach(() => {
  controllers.forEach(controller => controller.destroy());
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Publish V2 settings and publication', () => {
  it('keeps interrupted removal recoverable after reopening without a live URL', async () => {
    const request = vi.fn(async (_path: string, init?: RequestInit) => payload(state({ removal_pending: init?.method !== 'DELETE', can_publish: init?.method === 'DELETE' })));
    mount(request);
    await flush();
    expect(get('[data-state-title]').textContent).toBe('Retrait à terminer');
    expect(get('[data-unpublish-section]').hidden).toBe(false);
    expect(get('[data-action="unpublish"]').textContent).toBe('Terminer le retrait');
    expect(get<HTMLButtonElement>('[data-action="publish"]').disabled).toBe(true);
    await click('unpublish');
    await click('confirm-unpublish');
    expect(request.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(1);
    expect(get('[data-unpublish-section]').hidden).toBe(true);
    expect(get<HTMLButtonElement>('[data-action="publish"]').disabled).toBe(false);
  });
  it('loads status through the injected authenticated request and keeps a proposed URL inactive', async () => {
    const request = vi.fn().mockResolvedValue(payload(state()));
    const onStatus = vi.fn();
    mount(request, { projectId: 'project/with space', onStatus });
    expect(get('[data-loading]').hidden).toBe(false);
    await flush();
    expect(request).toHaveBeenCalledWith('/api/projects/project%2Fwith%20space/publish/status', expect.objectContaining({ method: 'GET', signal: expect.any(AbortSignal) }));
    expect(get('[data-proposed-url]').textContent).toBe('https://atelier.coden.app');
    expect(get('[data-live-url]').hasAttribute('href')).toBe(false);
    expect(get('[data-live-url]').hidden).toBe(true);
    expect(get('[data-live-actions]').hidden).toBe(true);
    expect(get<HTMLInputElement>('[name="subdomain"]').value).toBe('atelier');
    expect(onStatus).toHaveBeenCalledWith(expect.objectContaining({ version: 2 }));
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('one panel submit saves the full settings then starts exactly one confirmed async publication', async () => {
    const queued = state({ active_job: job({ status: 'pending', phase: 'queued', sequence: 1 }) });
    let saved = state();
    const save = deferred<any>();
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      if (init?.method === 'PUT') { saved = state({ draft: JSON.parse(init.body as string) }); return save.promise; }
      if (init?.method === 'POST') return { publish: { ...queued, draft: saved.draft }, job_id: 'job-1' };
      return payload(state());
    });
    mount(request);
    await flush();
    set('subdomain', 'Atelier-Nord');
    set('audience', 'invite_only');
    set('invitations', 'Jules@example.com, ada@example.com\njules@example.com');
    set('title', 'Atelier du Nord');
    set('description', 'Une nouvelle collection.');
    set('favicon', '/favicon.ico');
    set('image', '/images/share.jpg');
    await submit();
    await submit();
    expect(get<HTMLButtonElement>('[data-action="publish"]').disabled).toBe(true);
    expect(request.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(1);
    expect(request.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
    save.resolve(payload(saved));
    await flush();
    const calls = request.mock.calls;
    expect(calls.map(([, init]) => init?.method)).toEqual(['GET', 'PUT', 'POST']);
    expect(calls[1][0]).toBe('/api/projects/project-1/publish/settings');
    expect(JSON.parse(calls[1][1]!.body as string)).toEqual({
      subdomain: 'atelier-nord', audience: 'invite_only', invitations: ['jules@example.com', 'ada@example.com'],
      metadata: { title: 'Atelier du Nord', description: 'Une nouvelle collection.', favicon: '/favicon.ico', image: '/images/share.jpg' },
    });
    expect(JSON.parse(calls[2][1]!.body as string)).toEqual({ async: true, confirmed: true, idempotency_key: expect.any(String) });
    expect(calls[2][1]!.signal).toBeUndefined();
    expect(get('[data-unpublish-confirm]').hidden).toBe(true);
    expect(get('[aria-current="step"]').textContent).toContain('En attente');
  });

  it('polls real job phases and only enables the effective URL after success', async () => {
    let current = state({ active_job: job() });
    const request = vi.fn().mockImplementation(async () => payload(current));
    mount(request);
    await flush();
    expect(get('[aria-current="step"]').textContent).toContain('Construction');
    expect(get('[data-job-message]').textContent).toContain('Construction de la version enregistrée');
    expect(get('[data-live-url]').hasAttribute('href')).toBe(false);
    current = state({ active_job: job({ phase: 'verifying', sequence: 5 }) });
    await vi.advanceTimersByTimeAsync(1500);
    expect(get('[aria-current="step"]').textContent).toContain('Vérification du site');
    current = state({ public_url: 'https://atelier-live.example.com', effective: draft(), active_job: job({ status: 'completed', phase: 'completed', sequence: 8 }) });
    await vi.advanceTimersByTimeAsync(1500);
    expect(get<HTMLAnchorElement>('[data-live-url]').href).toBe('https://atelier-live.example.com/');
    expect(get('[data-live-url]').getAttribute('rel')).toBe('noopener noreferrer');
    expect(get('[data-live-actions]').hidden).toBe(false);
    expect(get('[data-state-title]').textContent).toBe('Votre site est en ligne');
    expect(get<HTMLButtonElement>('[data-action="publish"]').disabled).toBe(false);
  });

  it('preserves local edits and focus during status polling, ignoring out of order job events', async () => {
    let current = state();
    const request = vi.fn().mockImplementation(async () => payload(current));
    const controller = mount(request);
    await flush();
    set('title', 'Mon titre non enregistré');
    const title = get<HTMLInputElement>('[name="title"]');
    get<HTMLDetailsElement>('details').open = true;
    title.focus();
    await controller.refresh();
    expect(title.value).toBe('Mon titre non enregistré');
    expect(document.activeElement).toBe(title);
    current = state({ active_job: job({ phase: 'uploading', sequence: 6 }) });
    await controller.refresh();
    current = state({ active_job: job({ phase: 'building', sequence: 2 }) });
    await controller.refresh();
    expect(get('[aria-current="step"]').textContent).toContain('Transfert');
  });

  it('does not let an earlier status request overwrite a saved publication', async () => {
    const pendingRead = deferred<any>();
    let gets = 0;
    const current = state({ active_job: job() });
    const request = vi.fn(async (_path: string, init?: RequestInit) => {
      if (init?.method === 'GET') return ++gets === 1 ? payload(state()) : pendingRead.promise;
      if (init?.method === 'PUT') return payload(state());
      return { ...payload(current), job_id: 'job-1' };
    });
    const controller = mount(request);
    await flush();
    const refresh = controller.refresh();
    await submit();
    pendingRead.resolve(payload(state()));
    await refresh;
    expect(get('[aria-current="step"]').textContent).toContain('Construction');
  });

  it('closing during save does not cancel the confirmed publication or update the removed panel', async () => {
    const save = deferred<any>();
    const onClose = vi.fn();
    const onStatus = vi.fn();
    const request = vi.fn(async (_path: string, init?: RequestInit) => {
      if (init?.method === 'PUT') return save.promise;
      if (init?.method === 'POST') return { ...payload(state({ active_job: job() })), job_id: 'job-1' };
      return payload(state());
    });
    const controller = mount(request, { onClose, onStatus });
    await flush();
    await submit();
    await click('close');
    save.resolve(payload(state()));
    await flush();
    expect(request.mock.calls.map(([, init]) => init?.method)).toEqual(['GET', 'PUT', 'POST']);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onStatus).toHaveBeenCalledTimes(1);
    expect(host.querySelector('dialog')).toBeNull();
    await vi.advanceTimersByTimeAsync(30000);
    await controller.refresh();
    expect(request).toHaveBeenCalledTimes(3);
  });
});

describe('Publish V2 validation and recovery', () => {
  it('shows loading failure and retries without a write', async () => {
    const request = vi.fn().mockRejectedValueOnce(new Error('Réseau indisponible')).mockResolvedValue(payload(state()));
    mount(request);
    await flush();
    expect(get('[data-loading]').hidden).toBe(true);
    expect(get('[role="alert"]').textContent).toContain('Réseau indisponible');
    await click('retry');
    expect(get('[role="alert"]').hidden).toBe(true);
    expect(get('form').hidden).toBe(false);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('times out a stalled status read and offers a working retry', async () => {
    const stalled = deferred<any>();
    const request = vi.fn().mockImplementationOnce(() => stalled.promise).mockResolvedValue(payload(state()));
    mount(request);
    await vi.advanceTimersByTimeAsync(15000);
    expect(get('[data-error-message]').textContent).toContain('trop de temps');
    expect(request.mock.calls[0][1].signal.aborted).toBe(true);
    await click('retry');
    expect(get('[data-error]').hidden).toBe(true);
    stalled.resolve(payload(state({ can_publish: false })));
    await flush();
    expect(get<HTMLButtonElement>('[data-action="publish"]').disabled).toBe(false);
  });

  it('rejects malformed success envelopes and HTTP authorization failures with recovery', async () => {
    const request = vi.fn().mockResolvedValueOnce({ success: true }).mockRejectedValueOnce({ status: 401 }).mockResolvedValue(payload(state()));
    mount(request);
    await flush();
    expect(get('[data-error-message]').textContent).toContain('état de publication valide');
    await click('retry');
    expect(get('[data-error-message]').textContent).toContain('session a expiré');
    await click('retry');
    expect(get('[data-error]').hidden).toBe(true);
  });

  it('does not publish if saving settings fails and keeps all edits for retry', async () => {
    const request = vi.fn().mockResolvedValueOnce(payload(state())).mockRejectedValueOnce(new Error('Adresse déjà réservée'));
    mount(request);
    await flush();
    set('subdomain', 'nouvel-atelier');
    set('title', 'Titre conservé');
    await submit();
    expect(request).toHaveBeenCalledTimes(2);
    expect(get<HTMLInputElement>('[name="subdomain"]').value).toBe('nouvel-atelier');
    expect(get<HTMLInputElement>('[name="title"]').value).toBe('Titre conservé');
    expect(get('[data-error-message]').textContent).toContain('Adresse déjà réservée');
    expect(get<HTMLButtonElement>('[data-action="publish"]').disabled).toBe(false);
  });

  it('reuses the idempotency key after an ambiguous POST failure', async () => {
    let posts = 0;
    const request = vi.fn(async (_path: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        if (++posts === 1) throw new Error('Connexion interrompue');
        return { ...payload(state({ active_job: job() })), job_id: 'job-1' };
      }
      return payload(state());
    });
    mount(request);
    await flush();
    await submit();
    await click('retry');
    const keys = request.mock.calls.filter(([, init]) => init?.method === 'POST').map(([, init]) => JSON.parse(init!.body as string).idempotency_key);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it('uses secure random bytes when randomUUID is unavailable in a local fixture', async () => {
    vi.stubGlobal('crypto', { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) });
    const request = vi.fn(async (_path: string, init?: RequestInit) => init?.method === 'POST'
      ? { job_id: 'job-1', publish: state({ active_job: job() }) } : payload(state()));
    mount(request);
    await flush();
    await submit();
    const post = request.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(post![1]!.body as string).idempotency_key).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  });

  it('gates workspace by capability, validates invite emails and associates errors with fields', async () => {
    const request = vi.fn().mockResolvedValue(payload(state()));
    mount(request);
    await flush();
    expect(get<HTMLOptionElement>('option[value="workspace"]').disabled).toBe(true);
    set('audience', 'workspace');
    await submit();
    expect(get('[name="audience"]').getAttribute('aria-invalid')).toBe('true');
    expect(request).toHaveBeenCalledTimes(1);
    set('audience', 'invite_only');
    expect(get('[data-invitations-field]').hidden).toBe(false);
    set('invitations', 'not-an-email');
    await submit();
    const field = get('[name="invitations"]');
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(field.getAttribute('aria-describedby')).toContain(get('[data-field-error="invitations"]').id);
    expect(document.activeElement).toBe(field);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('allows workspace when entitled and never invents enabled publication or live URLs', async () => {
    const request = vi.fn().mockResolvedValue(payload(state({ can_publish: false, can_use_workspace: true, public_url: 'javascript:alert(1)', checks: [{ id: 'build', label: 'Corriger la construction', status: 'fail', detail: 'Le projet ne compile pas.' }] })));
    mount(request);
    await flush();
    expect(get<HTMLOptionElement>('option[value="workspace"]').disabled).toBe(false);
    expect(get<HTMLButtonElement>('[data-action="publish"]').disabled).toBe(true);
    expect(get('[data-checks]').textContent).toContain('Corriger la construction');
    expect(get('[data-live-url]').hasAttribute('href')).toBe(false);
    await submit();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('previews metadata as text, rejects unsafe assets and gracefully reports broken images', async () => {
    mount(vi.fn().mockResolvedValue(payload(state())));
    await flush();
    set('title', '<img src=x onerror=alert(1)>');
    set('description', 'مرحبا 世界 🧵');
    expect(get('[data-preview-title]').textContent).toBe('<img src=x onerror=alert(1)>');
    expect(get('[data-preview-title]').children).toHaveLength(0);
    set('image', 'javascript:alert(1)');
    await submit();
    expect(get('[name="image"]').getAttribute('aria-invalid')).toBe('true');
    expect(get<HTMLDetailsElement>('details').open).toBe(true);
    set('image', '/images/share.png');
    const image = get<HTMLImageElement>('[data-preview-image]');
    expect(image.hasAttribute('src')).toBe(false);
    commit('image');
    expect(image.getAttribute('src')).toBe('/images/share.png');
    image.dispatchEvent(new Event('error'));
    expect(image.hidden).toBe(true);
    expect(get('[data-image-error]').hidden).toBe(false);
    set('image', '');
    expect(image.hasAttribute('src')).toBe(false);
  });

  it('labels server simulation explicitly and still uses the real request contract', async () => {
    const request = vi.fn().mockResolvedValue(payload(state({ simulation: true })));
    mount(request);
    await flush();
    expect(get('[data-simulation]').hidden).toBe(false);
    expect(get('[data-action="publish"]').textContent).toBe('Lancer la simulation');
    expect(get('[data-live-url]').hasAttribute('href')).toBe(false);
  });

  it('keeps the last good public site available after a failed new publication', async () => {
    const request = vi.fn().mockResolvedValue(payload(state({ effective: draft(), public_url: 'https://live.example.com', active_job: job({ status: 'failed', phase: 'failed', error: 'La construction a échoué.' }) })));
    mount(request);
    await flush();
    expect(get('[data-state-title]').textContent).toContain('échoué');
    expect(get('[data-state-detail]').textContent).toContain('construction a échoué');
    expect(get<HTMLAnchorElement>('[data-live-url]').href).toBe('https://live.example.com/');
    expect(get('[data-action="publish"]').textContent).toBe('Réessayer la publication');
  });
});

describe('Publish V2 backend validation parity', () => {
  it('exposes the model limits and project-path instructions on the form', async () => {
    mount(vi.fn().mockResolvedValue(payload(state())));
    await flush();
    for (const [name, limit] of [['subdomain', 48], ['title', 120], ['description', 320], ['favicon', 512], ['image', 512]] as const) {
      expect(get<HTMLInputElement>(`[name="${name}"]`).maxLength).toBe(limit);
    }
    expect(get<HTMLInputElement>('[name="subdomain"]').minLength).toBe(3);
    expect(get<HTMLInputElement>('[name="title"]').required).toBe(true);
    const assetHintId = get('[name="image"]').getAttribute('aria-describedby')!.split(' ')[0];
    expect(document.getElementById(assetHintId)?.textContent).toContain('512 caractères maximum');
    expect(document.getElementById(assetHintId)?.textContent).toContain('Les URL externes');
  });

  it.each(['', 'a', 'ab', 'a'.repeat(49), '-abc', 'abc-', 'a_b', 'a.b'])('rejects subdomains outside the backend format: %s', async value => {
    const request = vi.fn().mockResolvedValue(payload(state()));
    mount(request);
    await flush();
    set('subdomain', value);
    await submit();
    expect(get('[name="subdomain"]').getAttribute('aria-invalid')).toBe('true');
    expect(get('[data-field-error="subdomain"]').textContent).toContain('3 à 48');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each(['abc', 'a'.repeat(48)])('allows subdomains at the backend length boundaries: %s', async value => {
    const request = vi.fn(async (_path: string, init?: RequestInit) => init?.method === 'POST'
      ? { job_id: 'job-1', publish: state({ active_job: job() }) } : payload(state()));
    mount(request);
    await flush();
    set('subdomain', value);
    await submit();
    const saved = request.mock.calls.find(([, init]) => init?.method === 'PUT');
    expect(JSON.parse(saved![1]!.body as string).subdomain).toBe(value);
  });

  it('leaves reserved subdomains authoritative on the server and displays its rejection', async () => {
    const request = vi.fn().mockResolvedValueOnce(payload(state())).mockRejectedValueOnce(new Error('Cette adresse est réservée.'));
    mount(request);
    await flush();
    set('subdomain', 'admin');
    await submit();
    expect(request.mock.calls.map(([, init]) => init?.method)).toEqual(['GET', 'PUT']);
    expect(get('[data-error-message]').textContent).toContain('adresse est réservée');
    expect(get<HTMLInputElement>('[name="subdomain"]').value).toBe('admin');
  });

  it.each([
    ['title', ''], ['title', '   '], ['title', 'a'.repeat(121)], ['description', 'a'.repeat(321)],
  ])('rejects invalid metadata length or an empty required title: %s', async (name, value) => {
    const request = vi.fn().mockResolvedValue(payload(state()));
    mount(request);
    await flush();
    set(name, value);
    await submit();
    expect(get(`[name="${name}"]`).getAttribute('aria-invalid')).toBe('true');
    expect(get<HTMLDetailsElement>('details').open).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('accepts the exact metadata limits and saves project paths, never absolute asset URLs', async () => {
    const request = vi.fn(async (_path: string, init?: RequestInit) => init?.method === 'POST'
      ? { job_id: 'job-1', publish: state({ active_job: job() }) } : payload(state()));
    mount(request);
    await flush();
    const image = `/${'a'.repeat(507)}.png`;
    expect(image.length).toBe(512);
    set('title', 'a'.repeat(120));
    set('description', 'a'.repeat(320));
    set('favicon', '/favicon.ico');
    set('image', image);
    await submit();
    const saved = request.mock.calls.find(([, init]) => init?.method === 'PUT');
    expect(JSON.parse(saved![1]!.body as string).metadata).toEqual({ title: 'a'.repeat(120), description: 'a'.repeat(320), favicon: '/favicon.ico', image });
  });

  it.each(['favicon', 'image'])('rejects external, traversing, encoded-separator and oversized paths for %s without preview requests', async name => {
    const request = vi.fn().mockResolvedValue(payload(state()));
    mount(request);
    await flush();
    const image = get<HTMLImageElement>(`[data-preview-${name}]`);
    for (const path of [
      'https://external.example/image.png', 'http://external.example/image.png', '//external.example/image.png',
      'javascript:alert(1)', 'data:image/svg+xml,<svg/>', 'images/share.png',
      '/../private.png', '/images/../private.png', '/images/a..png', '/%2e%2e/private.png',
      '/images%2Fprivate.png', '/images/%5cprivate.png', '/images\\private.png',
      '/images/share.png?redirect=https://external.example', '/images/share.png#fragment', '/images/share image.png',
      `/${'a'.repeat(512)}`,
    ]) {
      set(name, path);
      commit(name);
      await submit();
      expect(image.hasAttribute('src'), path).toBe(false);
      expect(get(`[name="${name}"]`).getAttribute('aria-invalid'), path).toBe('true');
    }
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('does not load image sources while typing or polling, and loads only a committed valid project path', async () => {
    const request = vi.fn().mockResolvedValue(payload(state()));
    const controller = mount(request);
    await flush();
    const image = get<HTMLImageElement>('[data-preview-image]');
    const assign = vi.spyOn(image, 'setAttribute');
    set('image', '/images/share.png');
    await controller.refresh();
    expect(image.hasAttribute('src')).toBe(false);
    expect(assign.mock.calls.some(([attribute]) => attribute === 'src')).toBe(false);
    commit('image');
    expect(image.getAttribute('src')).toBe('/images/share.png');
    set('image', 'https://external.example/share.png');
    commit('image');
    expect(image.hasAttribute('src')).toBe(false);
    expect(assign.mock.calls.filter(([attribute]) => attribute === 'src').map(([, value]) => value)).toEqual(['/images/share.png']);
  });

  it('never previews legacy external assets returned in server draft metadata', async () => {
    const serverDraft = draft();
    serverDraft.metadata.favicon = '//external.example/favicon.ico';
    serverDraft.metadata.image = 'https://external.example/share.png';
    mount(vi.fn().mockResolvedValue(payload(state({ draft: serverDraft }))));
    await flush();
    expect(get('[data-preview-favicon]').hasAttribute('src')).toBe(false);
    expect(get('[data-preview-image]').hasAttribute('src')).toBe(false);
  });
});

describe('Publish V2 owner-only invitation lists', () => {
  it.each([
    { label: 'a new owner-only private publication', existing: [], value: '' },
    { label: 'withdrawal of all previous invitations', existing: ['lea@example.com', 'sami@example.com'], value: '' },
    { label: 'a whitespace-only cleared list', existing: ['lea@example.com'], value: ' \n,; ' },
  ])('allows $label', async ({ existing, value }) => {
    const serverDraft = draft();
    serverDraft.audience = 'invite_only';
    serverDraft.invitations = existing;
    let saved = serverDraft;
    const request = vi.fn(async (_path: string, init?: RequestInit) => {
      if (init?.method === 'PUT') { saved = JSON.parse(init.body as string); return payload(state({ draft: saved })); }
      if (init?.method === 'POST') return { job_id: 'job-1', publish: state({ draft: saved, active_job: job() }) };
      return payload(state({ draft: serverDraft, effective: existing.length ? serverDraft : null, public_url: existing.length ? 'https://private.example.com' : null }));
    });
    mount(request);
    await flush();
    set('invitations', value);
    await submit();
    expect(request.mock.calls.map(([, init]) => init?.method)).toEqual(['GET', 'PUT', 'POST']);
    expect(saved.audience).toBe('invite_only');
    expect(saved.invitations).toEqual([]);
    expect(get('[name="invitations"]').getAttribute('aria-invalid')).not.toBe('true');
    expect(get('[data-invitations-field]').textContent).toContain('une liste vide réserve l’accès au propriétaire');
  });

  it.each([100, 101])('enforces the invitation count boundary at %s addresses', async count => {
    const request = vi.fn(async (_path: string, init?: RequestInit) => init?.method === 'POST'
      ? { job_id: 'job-1', publish: state({ active_job: job() }) } : payload(state()));
    mount(request);
    await flush();
    set('audience', 'invite_only');
    set('invitations', Array.from({ length: count }, (_, i) => `invite-${i}@example.com`).join('\n'));
    await submit();
    if (count === 100) {
      const saved = request.mock.calls.find(([, init]) => init?.method === 'PUT');
      expect(JSON.parse(saved![1]!.body as string).invitations).toHaveLength(100);
    } else {
      expect(request).toHaveBeenCalledTimes(1);
      expect(get('[data-field-error="invitations"]').textContent).toContain('maximum 100');
      expect(document.activeElement).toBe(get('[name="invitations"]'));
    }
  });

  it('reveals invalid retained invitations for correction even after changing audience', async () => {
    const request = vi.fn().mockResolvedValue(payload(state()));
    mount(request);
    await flush();
    set('audience', 'invite_only');
    set('invitations', 'invalid-email');
    set('audience', 'public');
    await submit();
    expect(get('[data-invitations-field]').hidden).toBe(false);
    expect(get('[name="invitations"]').getAttribute('aria-invalid')).toBe('true');
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe('Publish V2 explicit interrupted-job resume', () => {
  const interrupted = (overrides: Partial<PublicationStatusV2> = {}) => state({
    can_publish: false,
    active_job: job({ id: 'interrupted-job', status: 'failed', phase: 'failed', recoverable: true, message: 'Résultat de l’hébergeur incertain', sequence: 9 }),
    ...overrides,
  });
  const resumed = () => state({ can_publish: false, active_job: job({ id: 'interrupted-job', status: 'processing', phase: 'verifying', sequence: 10 }) });

  it('requires explicit resume and preserves edited drafts while using only the captured job ID', async () => {
    let current = state();
    const request = vi.fn(async (_path: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        current = resumed();
        return { job_id: 'interrupted-job', publish: current };
      }
      return payload(current);
    });
    const controller = mount(request);
    await flush();
    set('title', 'Brouillon local à conserver');
    set('subdomain', 'invalid draft!');
    current = interrupted();
    await controller.refresh();
    expect(get<HTMLFieldSetElement>('[data-fields]').disabled).toBe(true);
    expect(get('[data-action="publish"]').hidden).toBe(true);
    expect(get('[data-action="resume"]').hidden).toBe(false);
    expect(get<HTMLButtonElement>('[data-action="resume"]').disabled).toBe(false);
    expect(get('[data-action="resume"]').textContent).toBe('Reprendre la publication');
    expect(get('[data-resume-notice]').hidden).toBe(false);
    expect(get('[data-resume-notice]').textContent).toBe('La version capturée sera reprise ; vos brouillons restent conservés.');
    expect(get('[data-fields]').getAttribute('aria-describedby')).toBe(get('[data-resume-notice]').id);
    await submit();
    await vi.advanceTimersByTimeAsync(10000);
    expect(request.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true);

    await click('resume');
    const writes = request.mock.calls.filter(([, init]) => init?.method !== 'GET');
    expect(writes).toHaveLength(1);
    expect(writes[0][0]).toBe('/api/projects/project-1/publish');
    expect(writes[0][1]?.method).toBe('POST');
    expect(JSON.parse(writes[0][1]!.body as string)).toEqual({ async: true, confirmed: true, resume_job_id: 'interrupted-job' });
    expect(get<HTMLInputElement>('[name="title"]').value).toBe('Brouillon local à conserver');
    expect(get<HTMLInputElement>('[name="subdomain"]').value).toBe('invalid draft!');
    expect(get('[data-action="resume"]').hidden).toBe(true);
    expect(get('[aria-current="step"]').textContent).toContain('Vérification du site');
    expect(request.mock.calls.at(-1)?.[1]?.method).toBe('GET');
    await vi.advanceTimersByTimeAsync(1500);
    expect(request.mock.calls.at(-1)?.[1]?.method).toBe('GET');
    expect(request.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  });

  it('blocks double clicks, ordinary form submits and unpublish while resume is in flight', async () => {
    const pending = deferred<any>();
    const current = interrupted({ public_url: 'https://live.example.com', effective: draft() });
    const request = vi.fn(async (_path: string, init?: RequestInit) => init?.method === 'POST' ? pending.promise : payload(current));
    mount(request);
    await flush();
    expect(get<HTMLButtonElement>('[data-action="unpublish"]').disabled).toBe(false);
    await click('resume');
    expect(get<HTMLButtonElement>('[data-action="unpublish"]').disabled).toBe(true);
    await click('resume');
    await submit();
    await click('unpublish');
    expect(get('[data-action="resume"]').textContent).toBe('Reprise en cours…');
    expect(get<HTMLButtonElement>('[data-action="resume"]').disabled).toBe(true);
    expect(request.mock.calls.map(([, init]) => init?.method)).toEqual(['GET', 'POST']);
    const post = request.mock.calls[1][1]!;
    expect(post.signal).toBeUndefined();
    expect(JSON.parse(post.body as string)).toEqual({ async: true, confirmed: true, resume_job_id: 'interrupted-job' });
    pending.resolve({ job_id: 'interrupted-job', publish: resumed() });
    await flush();
    expect(request.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  });

  it('keeps the captured version and frozen draft after a resume error and retries the same resume request', async () => {
    let current = interrupted();
    let attempts = 0;
    const request = vi.fn(async (_path: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        if (++attempts === 1) throw new Error('Connexion interrompue pendant la reprise');
        current = resumed();
        return { job_id: 'interrupted-job', publish: current };
      }
      return payload(current);
    });
    mount(request);
    await flush();
    await click('resume');
    expect(get('[data-error-message]').textContent).toContain('Connexion interrompue pendant la reprise');
    expect(get('[data-error-message]').textContent).toContain('version capturée et vos brouillons sont conservés');
    expect(get('[data-action="retry"]').textContent).toBe('Reprendre la publication');
    expect(get<HTMLFieldSetElement>('[data-fields]').disabled).toBe(true);
    expect(get<HTMLButtonElement>('[data-action="resume"]').disabled).toBe(false);
    expect(get<HTMLInputElement>('[name="title"]').value).toBe('Atelier');
    await click('retry');
    const writes = request.mock.calls.filter(([, init]) => init?.method !== 'GET');
    expect(writes).toHaveLength(2);
    expect(writes.map(([, init]) => JSON.parse(init!.body as string))).toEqual([
      { async: true, confirmed: true, resume_job_id: 'interrupted-job' },
      { async: true, confirmed: true, resume_job_id: 'interrupted-job' },
    ]);
    expect(get('[data-error]').hidden).toBe(true);
    expect(get('[aria-current="step"]').textContent).toContain('Vérification du site');
  });

  it('never auto-resumes a recoverable job and keeps ordinary failed jobs editable', async () => {
    let current = interrupted({ can_publish: true });
    const request = vi.fn(async (_path: string, _init?: RequestInit) => payload(current));
    const controller = mount(request);
    await flush();
    await submit();
    await vi.advanceTimersByTimeAsync(30000);
    expect(request.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true);
    current = state({ active_job: job({ status: 'failed', phase: 'failed', recoverable: false, sequence: 10 }) });
    await controller.refresh();
    expect(get('[data-action="resume"]').hidden).toBe(true);
    expect(get('[data-resume-notice]').hidden).toBe(true);
    expect(get('[data-action="publish"]').hidden).toBe(false);
    expect(get<HTMLFieldSetElement>('[data-fields]').disabled).toBe(false);
    expect(get('[data-fields]').hasAttribute('aria-describedby')).toBe(false);
  });

  it('closing during resume does not cancel it or restart local polling', async () => {
    const pending = deferred<any>();
    const request = vi.fn(async (_path: string, init?: RequestInit) => init?.method === 'POST' ? pending.promise : payload(interrupted()));
    const onClose = vi.fn();
    const onStatus = vi.fn();
    mount(request, { onClose, onStatus });
    await flush();
    await click('resume');
    await click('close');
    pending.resolve({ job_id: 'interrupted-job', publish: resumed() });
    await flush();
    await vi.advanceTimersByTimeAsync(30000);
    expect(host.querySelector('dialog')).toBeNull();
    expect(request.mock.calls.map(([, init]) => init?.method)).toEqual(['GET', 'POST']);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onStatus).toHaveBeenCalledTimes(1);
  });
});

describe('Publish V2 reconciliation removal', () => {
  const uncertain = (recoverable: boolean, overrides: Partial<PublicationStatusV2> = {}) => state({
    can_publish: false,
    active_job: job({ id: 'uncertain-job', status: 'failed', phase: 'failed', reconciliation_required: true, recoverable, sequence: 12, message: 'Résultat de publication incertain' }),
    ...overrides,
  });

  it.each([true, false])('allows confirmed removal of a failed first publication without a public URL (recoverable=%s)', async recoverable => {
    const deletion = deferred<any>();
    const serverDraft = draft();
    serverDraft.metadata.title = 'Brouillon conservé après le retrait';
    const request = vi.fn(async (_path: string, init?: RequestInit) => init?.method === 'DELETE'
      ? deletion.promise : payload(uncertain(recoverable, { draft: serverDraft })));
    mount(request);
    await flush();
    expect(get('[data-live-url]').hasAttribute('href')).toBe(false);
    expect(get('[data-unpublish-section]').hidden).toBe(false);
    expect(get('[data-action="unpublish"]').textContent).toBe('Retirer la publication interrompue');
    expect(get<HTMLButtonElement>('[data-action="unpublish"]').disabled).toBe(false);
    expect(get('[data-action="resume"]').hidden).toBe(!recoverable);
    expect(get<HTMLFieldSetElement>('[data-fields]').disabled).toBe(true);
    await click('unpublish');
    expect(get('[data-unpublish-confirm]').hidden).toBe(false);
    expect(get('[data-unpublish-confirm]').textContent).toContain('Une éventuelle version en ligne ne sera plus accessible');
    expect(get('[data-action="cancel-unpublish"]').textContent).toBe('Conserver la publication interrompue');
    expect(request).toHaveBeenCalledTimes(1);
    await click('confirm-unpublish');
    await click('confirm-unpublish');
    expect(request.mock.calls.map(([, init]) => init?.method)).toEqual(['GET', 'DELETE']);
    expect(request.mock.calls[1][0]).toBe('/api/projects/project-1/publish');
    expect(request.mock.calls[1][1]?.signal).toBeUndefined();
    deletion.resolve(payload(state({ draft: serverDraft })));
    await flush();
    expect(get('[data-unpublish-section]').hidden).toBe(true);
    expect(get('[data-action="resume"]').hidden).toBe(true);
    expect(get('[data-action="publish"]').hidden).toBe(false);
    expect(get<HTMLButtonElement>('[data-action="publish"]').disabled).toBe(false);
    expect(get<HTMLFieldSetElement>('[data-fields]').disabled).toBe(false);
    expect(get<HTMLInputElement>('[name="title"]').value).toBe('Brouillon conservé après le retrait');
    expect(get('[data-announcement]').textContent).toContain('publication interrompue a été retirée');
    expect(document.activeElement).toBe(get('[data-action="publish"]'));
  });

  it('explains exhausted reconciliation without offering an impossible resume or a new publication', async () => {
    // Even a stale can_publish=true must not bypass reconciliation fencing in the panel.
    const request = vi.fn().mockResolvedValue(payload(uncertain(false, { can_publish: true })));
    mount(request);
    await flush();
    expect(get('[data-state-detail]').textContent).toContain('nombre maximal de reprises est atteint');
    expect(get('[data-state-detail]').textContent).toContain('Retirez la publication interrompue');
    expect(get('[data-action="resume"]').hidden).toBe(true);
    expect(get<HTMLButtonElement>('[data-action="resume"]').disabled).toBe(true);
    expect(get('[data-action="publish"]').hidden).toBe(true);
    expect(get<HTMLButtonElement>('[data-action="publish"]').disabled).toBe(true);
    expect(get<HTMLFieldSetElement>('[data-fields]').disabled).toBe(true);
    expect(get('[data-fields]').getAttribute('aria-describedby')).toBe(get('[data-state-detail]').id);
    await click('resume');
    await submit();
    await vi.advanceTimersByTimeAsync(10000);
    expect(request.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true);
    expect(get<HTMLButtonElement>('[data-action="unpublish"]').disabled).toBe(false);
  });

  it('keeps failed reconciliation removable after a DELETE error and retries without a live site', async () => {
    let deletions = 0;
    const request = vi.fn(async (_path: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') {
        if (++deletions === 1) throw new Error('Le retrait de la route a échoué');
        return payload(state());
      }
      return payload(uncertain(false));
    });
    mount(request);
    await flush();
    await click('unpublish');
    await click('confirm-unpublish');
    expect(get('[data-error-message]').textContent).toContain('publication interrompue n’a pas pu être retirée');
    expect(get('[data-error-message]').textContent).toContain('Le retrait de la route a échoué');
    expect(get('[data-unpublish-confirm]').hidden).toBe(false);
    expect(get<HTMLButtonElement>('[data-action="confirm-unpublish"]').disabled).toBe(false);
    expect(get<HTMLFieldSetElement>('[data-fields]').disabled).toBe(true);
    await click('retry');
    expect(request.mock.calls.map(([, init]) => init?.method)).toEqual(['GET', 'DELETE', 'DELETE']);
    expect(get('[data-error]').hidden).toBe(true);
    expect(get('[data-unpublish-section]').hidden).toBe(true);
  });

  it.each(['pending', 'processing'] as const)('never removes reconciliation while the job is %s', async jobStatus => {
    const current = uncertain(true, {
      public_url: 'https://live.example.com', effective: draft(),
      active_job: job({ id: 'uncertain-job', status: jobStatus, phase: 'verifying', reconciliation_required: true, recoverable: true }),
    });
    const request = vi.fn().mockResolvedValue(payload(current));
    mount(request);
    await flush();
    expect(get<HTMLButtonElement>('[data-action="unpublish"]').disabled).toBe(true);
    expect(get<HTMLButtonElement>('[data-action="confirm-unpublish"]').disabled).toBe(true);
    expect(get('[data-action="resume"]').hidden).toBe(true);
    await click('unpublish');
    await click('confirm-unpublish');
    expect(get('[data-unpublish-confirm]').hidden).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('removes a stale resume-error action when polling reports exhausted reconciliation', async () => {
    let current = uncertain(true);
    const request = vi.fn(async (_path: string, init?: RequestInit) => {
      if (init?.method === 'POST') throw new Error('La reprise a échoué');
      return payload(current);
    });
    const controller = mount(request);
    await flush();
    await click('resume');
    expect(get('[data-action="retry"]').textContent).toBe('Reprendre la publication');
    current = uncertain(false, { active_job: job({ id: 'uncertain-job', status: 'failed', phase: 'failed', recoverable: false, reconciliation_required: true, sequence: 13 }) });
    await controller.refresh();
    expect(get('[data-error]').hidden).toBe(true);
    expect(get('[data-action="resume"]').hidden).toBe(true);
    expect(get('[data-state-detail]').textContent).toContain('nombre maximal de reprises');
    expect(get<HTMLButtonElement>('[data-action="unpublish"]').disabled).toBe(false);
    expect(request.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  });

  it.each([false, true])('describes invitation delivery accurately for simulation=%s', async simulation => {
    const serverDraft = draft();
    serverDraft.audience = 'invite_only';
    serverDraft.invitations = ['lea@example.com'];
    mount(vi.fn().mockResolvedValue(payload(state({ simulation, draft: serverDraft }))));
    await flush();
    expect(get('[data-invitations-field]').hidden).toBe(false);
    expect(get('[data-invitation-delivery]').textContent).toBe(simulation
      ? 'Aucun email réel n’est envoyé en simulation.'
      : 'Les invitations sont envoyées après une publication réussie.');
    expect(get('[data-invitations-field]').textContent).not.toContain('Aucun e mail n’est envoyé par ce panneau');
  });
});

describe('Publish V2 published site controls', () => {
  const live = () => state({ public_url: 'https://live.example.com', effective: draft() });

  it('copies only the effective public URL and catches clipboard errors', async () => {
    const writeText = vi.fn().mockRejectedValueOnce(new Error('Accès au presse papier refusé')).mockResolvedValue(undefined);
    vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue({ writeText } as unknown as Clipboard);
    mount(vi.fn().mockResolvedValue(payload(live())));
    await flush();
    await click('copy');
    expect(writeText).toHaveBeenCalledWith('https://live.example.com/');
    expect(get('[data-error-message]').textContent).toContain('presse papier refusé');
    await click('retry');
    expect(get('[data-announcement]').textContent).toContain('copiée');
    expect(get('[data-error]').hidden).toBe(true);
    expect(writeText).toHaveBeenCalledTimes(2);
  });

  it('requires inline confirmation for DELETE and handles double clicks', async () => {
    const deletion = deferred<any>();
    const request = vi.fn().mockImplementation(async (_path: string, init?: RequestInit) => init?.method === 'DELETE' ? deletion.promise : payload(live()));
    mount(request);
    await flush();
    await click('unpublish');
    expect(request).toHaveBeenCalledTimes(1);
    expect(get('[data-unpublish-confirm]').hidden).toBe(false);
    expect(document.activeElement).toBe(get('[data-action="cancel-unpublish"]'));
    await click('cancel-unpublish');
    expect(request).toHaveBeenCalledTimes(1);
    await click('unpublish');
    await click('confirm-unpublish');
    await click('confirm-unpublish');
    expect(request.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(1);
    deletion.resolve(payload(state()));
    await flush();
    expect(get('[data-live-url]').hasAttribute('href')).toBe(false);
    expect(get('[data-unpublish-section]').hidden).toBe(true);
    expect(document.activeElement).toBe(get('[data-action="publish"]'));
  });

  it('retains the effective site and confirmation after DELETE fails, with working retry', async () => {
    let deletions = 0;
    const request = vi.fn(async (_path: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') { if (++deletions === 1) throw { status: 403 }; return payload(state()); }
      return payload(live());
    });
    mount(request);
    await flush();
    await click('unpublish');
    await click('confirm-unpublish');
    expect(get('[data-error-message]').textContent).toContain('autorisation');
    expect(get('[data-live-url]').hidden).toBe(false);
    expect(get('[data-unpublish-confirm]').hidden).toBe(false);
    await click('retry');
    expect(deletions).toBe(2);
    expect(get('[data-live-url]').hidden).toBe(true);
  });
});

describe('Publish V2 modal accessibility and cleanup', () => {
  it('does not expose domain management when no callback is provided', async () => {
    mount(vi.fn().mockResolvedValue(payload(state())));
    await flush();
    expect(host.querySelector('[data-action="manage-domains"]')).toBeNull();
  });

  it('closes the modal before handing off to the existing domain manager', async () => {
    const order: string[] = [];
    const onClose = vi.fn(() => { order.push('close'); });
    const onManageDomains = vi.fn(() => {
      expect(host.querySelector('dialog')).toBeNull();
      order.push('domains');
    });
    const request = vi.fn().mockResolvedValue(payload(state()));
    mount(request, { onClose, onManageDomains });
    await flush();
    expect(get('[data-action="manage-domains"]').textContent).toBe('Gérer les domaines');
    await click('manage-domains');
    expect(order).toEqual(['close', 'domains']);
    expect(onManageDomains).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('names the dialog and fields, traps keyboard focus, closes on Escape, and restores its opener', async () => {
    const opener = document.createElement('button');
    opener.textContent = 'Publier';
    document.body.prepend(opener);
    opener.focus();
    const onClose = vi.fn();
    mount(vi.fn().mockResolvedValue(payload(state())), { onClose });
    await flush();
    const dialog = get<HTMLDialogElement>('dialog');
    const close = get('[data-action="close"]');
    expect(dialog.open).toBe(true);
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent).toBe('Publier');
    expect(document.activeElement).toBe(close);
    for (const field of Array.from(host.querySelectorAll<HTMLInputElement>('input, select, textarea'))) expect(host.querySelector(`label[for="${field.id}"]`)).not.toBeNull();
    close.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(get('[data-action="publish"]'));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(close);
    opener.focus();
    expect(dialog.contains(document.activeElement)).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(host.querySelector('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('aborts only observation on destroy, cleans listeners and preserves unrelated container content', async () => {
    const sibling = document.createElement('p');
    sibling.textContent = 'Contenu existant';
    host.append(sibling);
    const pending = deferred<any>();
    const request = vi.fn().mockImplementation(() => pending.promise);
    const onClose = vi.fn();
    const controller = mount(request, { onClose });
    const signal = request.mock.calls[0][1].signal as AbortSignal;
    controller.destroy();
    controller.destroy();
    pending.resolve(payload(state()));
    await flush();
    await vi.advanceTimersByTimeAsync(30000);
    expect(signal.aborted).toBe(true);
    expect(host.contains(sibling)).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(1);
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();
    expect(document.activeElement).toBe(outside);
  });

  it('isolates the fallback modal and restores preexisting inert states', async () => {
    vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(() => { throw new Error('Modal API unavailable'); });
    const outside = document.createElement('button');
    const alreadyInert = document.createElement('section');
    alreadyInert.inert = true;
    document.body.append(outside, alreadyInert);
    const controller = mount(vi.fn().mockResolvedValue(payload(state())));
    await flush();
    expect(get<HTMLDialogElement>('dialog').open).toBe(true);
    expect(outside.inert).toBe(true);
    controller.destroy();
    expect(outside.inert).toBe(false);
    expect(alreadyInert.inert).toBe(true);
  });
});
