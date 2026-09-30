// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createProposalCards } from './proposal-cards';

const card = (patch: Record<string, unknown> = {}) => ({ id: 'a1', title: 'Ajouter un état vide', why: 'Guide la personne.', detail: 'Explication longue.', category: 'quality', status: 'new', ...patch });

function setup(overrides: Partial<Parameters<typeof createProposalCards>[0]> = {}) {
  document.body.innerHTML = '<div><div class="chat-input-row"></div></div>';
  const calls: string[] = [];
  const send = vi.fn();
  const api = vi.fn(async (path: string, init?: any) => {
    calls.push(`${init?.method || 'GET'} ${path}`);
    if (path.endsWith('/proposals')) return { proposals: [card(), card({ id: 'b2', title: 'Autre idée' })], level: 'normal' };
    if (path.endsWith('/answer')) return JSON.parse(init.body).status === 'applied' ? { prompt: 'Ajoute un état vide.' } : {};
    return {};
  });
  const cards = createProposalCards({ api: api as any, send, busy: () => false, projectId: () => 'p1', ...overrides });
  return { cards, calls, send, api };
}
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('proposal cards', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('shows the ideas as text, above the composer, with the four answers', async () => {
    const { cards } = setup();
    await cards.refresh();
    const host = document.getElementById('chat-proposals')!;
    expect(host.nextElementSibling?.className).toBe('chat-input-row');
    expect(host.querySelectorAll('.coden-proposal')).toHaveLength(2);
    expect([...host.querySelectorAll('.coden-proposal:first-child button')].map(button => button.textContent)).toEqual(expect.arrayContaining(['Appliquer', 'Expliquer', 'Plus tard', 'Non']));
  });

  it('never renders server text as HTML', async () => {
    const { cards } = setup({ api: (async () => ({ proposals: [card({ title: '<img src=x onerror=alert(1)>' })], level: 'normal' })) as any });
    await cards.refresh();
    expect(document.querySelector('#chat-proposals img')).toBeNull();
    expect(document.querySelector('.coden-proposal-title')?.textContent).toBe('<img src=x onerror=alert(1)>');
  });

  it('applying sends the instruction the server returns and removes the card', async () => {
    const { cards, send } = setup();
    await cards.refresh();
    (document.querySelector('.coden-proposal-primary') as HTMLButtonElement).click();
    await flush();
    expect(send).toHaveBeenCalledWith('Ajoute un état vide.');
    expect(document.querySelectorAll('.coden-proposal')).toHaveLength(1);
  });

  it('explain opens the detail; no removes the card without sending anything', async () => {
    const { cards, send, calls } = setup();
    await cards.refresh();
    const detail = document.querySelector('.coden-proposal-detail') as HTMLElement;
    expect(detail.hidden).toBe(true);
    ([...document.querySelectorAll('.coden-proposal-secondary')].find(button => button.textContent === 'Expliquer') as HTMLButtonElement).click();
    expect(detail.hidden).toBe(false);
    ([...document.querySelectorAll('.coden-proposal-secondary')].find(button => button.textContent === 'Non') as HTMLButtonElement).click();
    await flush();
    expect(send).not.toHaveBeenCalled();
    expect(calls.some(call => call.startsWith('POST') && call.endsWith('/answer'))).toBe(true);
  });

  it('does not apply while a run is in progress, and steps aside when one starts', async () => {
    const { cards, send } = setup({ busy: () => true });
    // refresh itself waits for the run to end
    await cards.refresh();
    expect(document.getElementById('chat-proposals')).toBeNull();
    const idle = setup();
    await idle.cards.refresh();
    idle.cards.beforeRun();
    expect(document.querySelectorAll('.coden-proposal')).toHaveLength(0);
    expect(send).not.toHaveBeenCalled();
  });

  it('a "later" idea comes back alone after a run, not at page load; "off" shows nothing', async () => {
    const later = { proposals: [card({ status: 'later' })], level: 'normal' };
    const a = setup({ api: (async () => later) as any });
    await a.cards.refresh(false);
    expect(document.querySelectorAll('.coden-proposal')).toHaveLength(0);
    await a.cards.refresh(true);
    expect(document.querySelectorAll('.coden-proposal')).toHaveLength(1);
    const off = setup({ api: (async () => ({ proposals: [card()], level: 'off' })) as any });
    await off.cards.refresh();
    expect(document.querySelectorAll('.coden-proposal')).toHaveLength(0);
  });

  it('"propose less" saves the preference and clears the cards', async () => {
    const { cards, calls } = setup();
    await cards.refresh();
    (document.querySelector('.coden-proposal-fewer') as HTMLButtonElement).click();
    await flush();
    expect(calls).toContain('PUT /api/users/me/proposal-level');
    expect(document.querySelectorAll('.coden-proposal')).toHaveLength(0);
  });

  it('shows a quiet note, not an error page, when saving the answer fails', async () => {
    const api = vi.fn(async (path: string) => { if (path.endsWith('/answer')) throw new Error('down'); return { proposals: [card()], level: 'normal' }; });
    const { cards } = setup({ api: api as any });
    await cards.refresh();
    (document.querySelector('.coden-proposal-primary') as HTMLButtonElement).click();
    await flush();
    expect(document.querySelector('.coden-proposal-note')?.textContent).toMatch(/Impossible/);
    expect(document.querySelectorAll('.coden-proposal')).toHaveLength(1);
  });
});
