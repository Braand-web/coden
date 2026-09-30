/**
 * The ideas the agent proposes, as small cards above the composer:
 * Apply · Later · No · Explain, and a way to ask for fewer.
 *
 * Kept out of builder-live.ts: the builder gives it three things — how to call
 * the API, how to send an instruction to the agent, and where the cards go —
 * and this owns the rest. Text from the server is always set as text, never as HTML.
 */
export type ProposalCard = { id: string; title: string; why: string; detail: string; category: string; status: 'new' | 'later' };
export type ProposalLevel = 'normal' | 'fewer' | 'off';

export type ProposalCardDeps = {
  api: <T>(path: string, init?: { method?: string; body?: string }) => Promise<T>;
  /** Sends the instruction to the agent as the person's own request. */
  send: (instruction: string) => Promise<void> | void;
  /** True while a run is in progress: cards wait rather than compete with it. */
  busy: () => boolean;
  projectId: () => string;
};

const CATEGORY_LABEL: Record<string, string> = { feature: 'Fonctionnalité', design: 'Design', quality: 'Qualité', performance: 'Performance', growth: 'Croissance' };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function createProposalCards(deps: ProposalCardDeps) {
  let timers: number[] = [];
  let hostFor = '';

  const host = () => {
    let node = document.getElementById('chat-proposals');
    if (node) return node;
    const inputRow = document.querySelector('.chat-input-row');
    if (!inputRow?.parentElement) return null;
    node = el('div', 'coden-proposals');
    node.id = 'chat-proposals';
    node.setAttribute('aria-live', 'polite');
    inputRow.parentElement.insertBefore(node, inputRow);
    return node;
  };

  const clear = () => { const node = document.getElementById('chat-proposals'); if (node) node.replaceChildren(); };

  async function answer(card: ProposalCard, status: 'applied' | 'later' | 'dismissed', node: HTMLElement) {
    const projectId = deps.projectId();
    if (!projectId) return;
    node.setAttribute('aria-busy', 'true');
    try {
      const result = await deps.api<{ prompt?: string }>(`/api/projects/${encodeURIComponent(projectId)}/proposals/${encodeURIComponent(card.id)}/answer`, { method: 'POST', body: JSON.stringify({ status }) });
      node.remove();
      if (status === 'applied' && result.prompt) await deps.send(result.prompt);
    } catch {
      node.removeAttribute('aria-busy');
      const note = node.querySelector('.coden-proposal-note') || node.appendChild(el('div', 'coden-proposal-note'));
      note.textContent = 'Impossible d’enregistrer votre réponse. Réessayez dans un instant.';
    }
  }

  function render(cards: ProposalCard[], level: ProposalLevel, includeLater: boolean) {
    const container = host();
    if (!container) return;
    container.replaceChildren();
    if (!cards.length || level === 'off') return;
    // Never a wall of them: the newest ideas; one that was put off comes back only after a later run, and alone.
    const fresh = cards.filter(card => card.status === 'new').slice(0, 2);
    const list = fresh.length ? fresh : includeLater ? cards.filter(card => card.status === 'later').slice(-1) : [];
    for (const card of list) {
      const node = el('section', 'coden-proposal');
      node.setAttribute('aria-label', `Idée : ${card.title}`);
      const head = el('div', 'coden-proposal-head');
      head.append(el('span', 'coden-proposal-kicker', `Idée · ${CATEGORY_LABEL[card.category] || CATEGORY_LABEL.feature}`));
      const close = el('button', 'coden-proposal-close', '×');
      close.type = 'button';
      close.setAttribute('aria-label', 'Plus tard');
      close.addEventListener('click', () => void answer(card, 'later', node));
      head.append(close);
      const title = el('div', 'coden-proposal-title', card.title);
      const why = el('div', 'coden-proposal-why', card.why);
      const detail = el('div', 'coden-proposal-detail', card.detail);
      detail.hidden = true;
      const actions = el('div', 'coden-proposal-actions');
      const apply = el('button', 'coden-proposal-primary', 'Appliquer');
      apply.type = 'button';
      apply.addEventListener('click', () => { if (deps.busy()) return; void answer(card, 'applied', node); });
      const explain = el('button', 'coden-proposal-secondary', 'Expliquer');
      explain.type = 'button';
      explain.setAttribute('aria-expanded', 'false');
      explain.addEventListener('click', () => { detail.hidden = !detail.hidden; explain.setAttribute('aria-expanded', String(!detail.hidden)); });
      const later = el('button', 'coden-proposal-secondary', 'Plus tard');
      later.type = 'button';
      later.addEventListener('click', () => void answer(card, 'later', node));
      const no = el('button', 'coden-proposal-secondary', 'Non');
      no.type = 'button';
      no.addEventListener('click', () => void answer(card, 'dismissed', node));
      actions.append(apply, explain, later, no);
      node.append(head, title, why, detail, actions);
      container.append(node);
    }
    if (list.length) {
      const fewer = el('button', 'coden-proposal-fewer', level === 'fewer' ? 'Ne plus proposer d’idées' : 'Proposer moins d’idées');
      fewer.type = 'button';
      fewer.addEventListener('click', async () => {
        const next: ProposalLevel = level === 'fewer' ? 'off' : 'fewer';
        try { await deps.api('/api/users/me/proposal-level', { method: 'PUT', body: JSON.stringify({ level: next }) }); } catch { /* the cards stay; nothing was changed */ }
        clear();
      });
      container.append(fewer);
    }
  }

  async function refresh(includeLater = false) {
    const projectId = deps.projectId();
    if (!projectId || deps.busy()) return;
    hostFor = projectId;
    try {
      const payload = await deps.api<{ proposals?: ProposalCard[]; level?: ProposalLevel }>(`/api/projects/${encodeURIComponent(projectId)}/proposals`);
      // The person may have opened another project while this was in flight.
      if (hostFor !== deps.projectId()) return;
      render(Array.isArray(payload.proposals) ? payload.proposals : [], payload.level || 'normal', includeLater);
    } catch {
      /* Ideas are a bonus: never an error on screen. */
    }
  }

  return {
    refresh,
    clear,
    /** A run just ended: the ideas are generated in the background, so look once soon and once a bit later. */
    afterRun() {
      timers.forEach(timer => window.clearTimeout(timer));
      timers = [7_000, 16_000].map(delay => window.setTimeout(() => void refresh(true), delay));
    },
    /** A run starts: the cards step aside. */
    beforeRun() { timers.forEach(timer => window.clearTimeout(timer)); timers = []; clear(); },
  };
}
