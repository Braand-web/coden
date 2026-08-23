import {
  MODEL_REGISTRY,
  PROVIDER_META,
  getModelsByProvider,
  normalizeModelSelectionId,
  type ModelProvider,
} from './config/ai-models';
import { providerIconSvg } from './model-provider-icons';

type SelectorOptions = {
  selector?: string;
  storageKey?: string;
};

const DEFAULT_SELECTOR = '.input-wrapper .model-select';
const DEFAULT_STORAGE_KEY = 'coden-selected-model';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function injectProviderSelectorStyle() {
  if (document.getElementById('coden-provider-model-selector-style')) return;
  const style = document.createElement('style');
  style.id = 'coden-provider-model-selector-style';
  style.textContent = `
    .coden-provider-model-select {
      position: relative;
      min-height: 30px;
      max-width: min(168px, 42vw);
      gap: 7px;
      padding: 0 9px;
      border-radius: 999px;
      isolation: isolate;
      transition:
        background 180ms cubic-bezier(0.22,1,0.36,1),
        border-color 180ms cubic-bezier(0.22,1,0.36,1),
        box-shadow 180ms cubic-bezier(0.22,1,0.36,1),
        transform 180ms cubic-bezier(0.22,1,0.36,1);
    }
    .coden-provider-model-select[aria-expanded="true"] {
      border-color: var(--border-focus, var(--accent));
      background: var(--accent-blue-soft, var(--accent-hover));
      color: var(--text);
    }
    .coden-provider-model-select:focus-visible {
      outline: none;
      border-color: var(--border-focus, var(--accent));
      box-shadow: 0 0 0 3px var(--accent-blue-soft, var(--accent-dim));
    }
    .coden-provider-model-select .provider-dot {
      width: 16px;
      height: 16px;
      border-radius: 5px;
      color: var(--accent-blue, var(--accent));
      flex: 0 0 auto;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .coden-provider-model-select .provider-dot svg,
    .provider-icon svg {
      width: 100%;
      height: 100%;
      display: block;
    }
    .coden-provider-model-select .current-model-label,
    .coden-provider-model-select #current-model-label {
      min-width: 0;
      max-width: 104px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
      font-weight: 650;
    }
    .coden-provider-model-select .provider-chevron {
      width: 11px;
      height: 11px;
      flex: 0 0 auto;
      transition: transform 180ms cubic-bezier(0.22,1,0.36,1);
    }
    .coden-provider-model-select[aria-expanded="true"] .provider-chevron {
      transform: rotate(180deg);
    }
    .coden-provider-model-menu {
      width: 224px;
      overflow: visible;
      display: grid;
      gap: 4px;
    }
    .coden-provider-model-menu.open {
      overflow: visible;
    }
    .coden-provider-list {
      display: grid;
      gap: 4px;
    }
    .coden-auto-model-option,
    .coden-provider-card {
      width: 100%;
      border: 1px solid var(--border);
      background: var(--bg-input);
      color: var(--text);
      border-radius: 8px;
      min-height: 30px;
      padding: 5px 6px;
      display: flex;
      align-items: center;
      gap: 6px;
      text-align: left;
      cursor: pointer;
      transition:
        background 160ms cubic-bezier(0.22,1,0.36,1),
        border-color 160ms cubic-bezier(0.22,1,0.36,1),
        transform 160ms cubic-bezier(0.22,1,0.36,1);
    }
    .coden-auto-model-option:hover,
    .coden-auto-model-option.active,
    .coden-provider-card:hover,
    .coden-provider-card.active {
      background: var(--accent-blue-soft, var(--accent-hover, rgba(9,9,11,.08)));
      border-color: var(--border-focus, var(--border));
    }
    .coden-provider-card.open {
      background: var(--accent-blue-hover, var(--accent-hover, rgba(9,9,11,.10)));
      border-color: var(--border-focus, var(--border));
      transform: translateX(2px);
    }
    .provider-icon {
      width: 18px;
      height: 18px;
      border-radius: 5px;
      color: var(--provider-color);
      background: var(--bg-input);
      border: 1px solid var(--border);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 9px;
      font-weight: 850;
      line-height: 1;
      flex: 0 0 auto;
      --provider-icon-bg: var(--bg-input);
    }
    .provider-card-main {
      min-width: 0;
      display: grid;
      gap: 1px;
      flex: 1 1 auto;
    }
    .provider-name-row {
      display: flex;
      align-items: center;
      gap: 5px;
      min-width: 0;
    }
    .provider-name {
      color: var(--text);
      font-size: 11px;
      font-weight: 720;
    }
    .provider-selected-label,
    .provider-count {
      color: var(--text-muted);
      font-size: 9px;
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .provider-expand-btn {
      width: 22px;
      height: 22px;
      border: 1px solid var(--border);
      background: transparent;
      color: var(--text-muted);
      border-radius: 7px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition:
        background 120ms cubic-bezier(0.22,1,0.36,1),
        color 120ms cubic-bezier(0.22,1,0.36,1),
        transform 150ms cubic-bezier(0.22,1,0.36,1);
    }
    .provider-expand-btn:hover,
    .provider-expand-btn.open {
      background: var(--bg-elevated, var(--bg-input));
      color: var(--text);
    }
    .provider-expand-btn.open {
      transform: rotate(90deg);
    }
    .coden-model-list-panel {
      position: absolute;
      left: calc(100% + 6px);
      top: 0;
      width: 236px;
      max-height: min(320px, 66vh);
      border: 1px solid var(--border);
      background: var(--bg-elevated, var(--bg-surface));
      color: var(--text);
      border-radius: 12px;
      box-shadow: 0 14px 36px rgba(0,0,0,.16), 0 3px 10px rgba(0,0,0,.08);
      opacity: 0;
      transform: translateX(-8px) scale(.97);
      pointer-events: none;
      overflow: hidden;
      z-index: 5200;
      transition:
        opacity 120ms cubic-bezier(0,0,0.2,1),
        transform 150ms cubic-bezier(0.22,1,0.36,1);
    }
    .coden-model-list-panel.visible {
      opacity: 1;
      transform: translateX(0) scale(1);
      pointer-events: auto;
    }
    .coden-model-list-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 8px 10px 6px;
      border-bottom: 1px solid var(--border);
    }
    .coden-model-list-title {
      font-size: 9px;
      font-weight: 850;
      letter-spacing: .08em;
      text-transform: uppercase;
      color: var(--text-muted);
    }
    .coden-model-list-count {
      border: 1px solid var(--border);
      border-radius: 999px;
      color: var(--text-muted);
      font-size: 9px;
      font-weight: 700;
      padding: 1px 6px;
    }
    .coden-model-list-scroll {
      max-height: 272px;
      overflow-y: auto;
      padding: 4px;
      display: grid;
      gap: 2px;
    }
    .coden-model-item {
      width: 100%;
      border: 0;
      background: transparent;
      color: var(--text);
      border-radius: 9px;
      padding: 7px 9px 7px 8px;
      display: grid;
      grid-template-columns: 20px 1fr 16px;
      align-items: center;
      gap: 9px;
      text-align: left;
      cursor: pointer;
      position: relative;
      animation: coden-model-enter 130ms cubic-bezier(0.22,1,0.36,1) both;
      transition:
        background 150ms cubic-bezier(0.22,1,0.36,1),
        transform 150ms cubic-bezier(0.34,1.56,0.64,1);
    }
    .coden-model-item:hover {
      background: var(--accent-dim, rgba(9,9,11,.08));
      transform: translateX(2px);
    }
    .coden-model-item.selected {
      background: var(--accent-blue-soft, var(--accent-hover, rgba(9,9,11,.10)));
    }
    .coden-model-item.selected::before {
      content: "";
      position: absolute;
      left: 0;
      top: 20%;
      bottom: 20%;
      width: 3px;
      border-radius: 0 999px 999px 0;
      background: var(--accent-blue, var(--accent));
    }
    .model-item-icon {
      width: 20px;
      height: 20px;
      border-radius: 6px;
      border: 1px solid var(--border);
      background: var(--bg-input);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: var(--provider-color, var(--accent));
      flex: 0 0 auto;
      align-self: start;
      margin-top: 1px;
      --provider-icon-bg: var(--bg-input);
    }
    .model-item-icon svg { width: 13px; height: 13px; display: block; }
    .model-item-body { min-width: 0; display: grid; gap: 2px; }
    .model-item-name-row {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
    }
    .model-item-desc {
      font-size: 10px;
      color: var(--text-muted);
      line-height: 1.4;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .model-item-check {
      width: 16px;
      height: 16px;
      flex: 0 0 auto;
      color: var(--accent-blue, var(--accent));
      opacity: 0;
      transform: scale(.6);
      transition: opacity 150ms ease, transform 200ms cubic-bezier(0.34,1.56,0.64,1);
    }
    .model-item-check svg { width: 100%; height: 100%; display: block; }
    .coden-model-item.selected .model-item-check { opacity: 1; transform: scale(1); }
    .model-item-name {
      font-size: 11.5px;
      font-weight: 720;
      color: var(--text);
      line-height: 1.25;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .model-item-badges {
      display: flex;
      flex-wrap: wrap;
      gap: 3px;
    }
    .coden-model-badge {
      border-radius: 999px;
      padding: 1px 5px;
      font-size: 8px;
      font-weight: 850;
      letter-spacing: .05em;
      text-transform: uppercase;
      line-height: 1;
      background: var(--bg-input);
      color: var(--text-muted);
      border: 1px solid var(--border);
    }
    .coden-model-badge.new { color: #166534; background: #dcfce7; border-color: #bbf7d0; }
    .coden-model-badge.fast { color: #854d0e; background: #fef9c3; border-color: #fde68a; }
    .coden-model-badge.premium { color: #6b21a8; background: #f3e8ff; border-color: #e9d5ff; }
    @keyframes coden-model-enter {
      from { opacity: 0; transform: translateX(-8px); }
      to { opacity: 1; transform: translateX(0); }
    }
    @media (prefers-reduced-motion: reduce) {
      .coden-model-item { animation: none; }
      .coden-model-item:hover,
      .coden-provider-card.open { transform: none; }
      .model-item-check,
      .coden-provider-model-select,
      .provider-chevron,
      .coden-model-list-panel { transition: none; }
    }
    @media (max-width: 767px) {
      .coden-provider-model-menu {
        left: 12px !important;
        right: 12px !important;
        bottom: 12px !important;
        top: auto !important;
        width: auto !important;
        max-width: none !important;
      }
      .coden-model-list-panel {
        position: fixed;
        left: 0;
        right: 0;
        bottom: 0;
        top: auto;
        width: 100%;
        max-height: 76dvh;
        border-radius: 16px 16px 0 0;
        transform: translateY(100%);
      }
      .coden-model-list-panel.visible {
        transform: translateY(0);
      }
    }
  `;
  document.head.appendChild(style);
}

function selectorIcon(icon: string) {
  return providerIconSvg(icon);
}

function selectionIcon(modelId: string) {
  const provider = modelId === 'auto' ? null : modelProvider(modelId);
  return selectorIcon(provider ? PROVIDER_META[provider].icon : 'auto');
}

function modelLabel(modelId: string) {
  if (modelId === 'auto') return 'Auto';
  return MODEL_REGISTRY.find(model => model.id === modelId)?.label || 'Auto';
}

function modelProvider(modelId: string): ModelProvider | null {
  return MODEL_REGISTRY.find(model => model.id === modelId)?.provider || null;
}

function updateAllSelectors(selectedId: string, storageKey: string) {
  const normalized = normalizeModelSelectionId(selectedId);
  localStorage.setItem(storageKey, normalized);
  document.querySelectorAll<HTMLElement>('.coden-provider-model-select').forEach(root => {
    const label = root.querySelector<HTMLElement>('.current-model-label, #current-model-label');
    const dot = root.querySelector<HTMLElement>('.provider-dot');
    const selectedProvider = normalized === 'auto' ? null : modelProvider(normalized);
    if (label) label.textContent = modelLabel(normalized);
    if (dot) {
      dot.innerHTML = selectionIcon(normalized);
      dot.style.color = selectedProvider ? PROVIDER_META[selectedProvider].color : 'var(--accent)';
    }
    root.querySelectorAll<HTMLElement>('[data-model-id]').forEach(item => {
      const isSel = item.dataset.modelId === normalized;
      item.classList.toggle('active', isSel);
      item.classList.toggle('selected', isSel);
      if (item.getAttribute('role') === 'option') item.setAttribute('aria-selected', isSel ? 'true' : 'false');
    });
    root.querySelectorAll<HTMLElement>('[data-provider]').forEach(card => {
      const provider = card.dataset.provider as ModelProvider;
      card.classList.toggle('active', selectedProvider === provider);
      const selectedLabel = card.querySelector<HTMLElement>('.provider-selected-label');
      if (selectedLabel) {
        selectedLabel.textContent = selectedProvider === provider ? modelLabel(normalized) : `${getModelsByProvider()[provider].length} models`;
      }
    });
  });
  window.dispatchEvent(new CustomEvent('coden:model-selected', { detail: { modelId: normalized } }));
  window.dispatchEvent(new CustomEvent('coden:legacy-model-selected', { detail: { modelId: normalized } }));
}

function renderModelPanel(provider: ModelProvider, selectedId: string) {
  const models = getModelsByProvider()[provider] || [];
  const meta = PROVIDER_META[provider];
  return `
    <div class="coden-model-list-header">
      <span class="coden-model-list-title">${escapeHtml(meta.label)}</span>
      <span class="coden-model-list-count">${models.length} models</span>
    </div>
    <div class="coden-model-list-scroll">
      ${models.map((model, index) => `
        <button type="button" class="coden-model-item${selectedId === model.id ? ' selected' : ''}" data-model-id="${escapeHtml(model.id)}" data-model-name="${escapeHtml(model.label)}" role="option" aria-selected="${selectedId === model.id ? 'true' : 'false'}" style="animation-delay:${index * 25}ms">
          <span class="model-item-icon" style="--provider-color:${meta.color};">${selectorIcon(meta.icon)}</span>
          <span class="model-item-body">
            <span class="model-item-name-row">
              <span class="model-item-name">${escapeHtml(model.label)}</span>
              ${model.isNew ? '<span class="coden-model-badge new">New</span>' : ''}
              ${model.isPremium ? '<span class="coden-model-badge premium">Premium</span>' : (model.isFast ? '<span class="coden-model-badge fast">Fast</span>' : '')}
              ${model.minPlan !== 'free' ? '<span class="coden-model-badge">Upgrade</span>' : ''}
            </span>
            <span class="model-item-desc">${escapeHtml(model.description || `${model.tier} · ${Math.round(model.contextWindow / 1000)}K context`)}</span>
          </span>
          <span class="model-item-check" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></span>
        </button>
      `).join('')}
    </div>
  `;
}

export function initProviderModelSelectors(options: SelectorOptions = {}) {
  injectProviderSelectorStyle();
  const selector = options.selector || DEFAULT_SELECTOR;
  const storageKey = options.storageKey || DEFAULT_STORAGE_KEY;
  const groups = getModelsByProvider();
  const providers = Object.keys(groups) as ModelProvider[];

  document.querySelectorAll<HTMLElement>(selector).forEach(oldRoot => {
    if (oldRoot.dataset.providerModelEnhanced === 'true') return;
    const id = oldRoot.id;
    const selectedId = normalizeModelSelectionId(localStorage.getItem(storageKey) || 'auto');
    const selectedProvider = selectedId === 'auto' ? null : modelProvider(selectedId);
    const root = document.createElement('div');
    if (id) root.id = id;
    root.className = `${oldRoot.className} coden-provider-model-select`;
    root.dataset.providerModelEnhanced = 'true';
    root.setAttribute('role', 'button');
    root.setAttribute('tabindex', '0');
    root.setAttribute('aria-haspopup', 'listbox');
    root.setAttribute('aria-expanded', 'false');
    root.innerHTML = `
      <span class="provider-dot" style="color:${selectedProvider ? PROVIDER_META[selectedProvider].color : 'var(--accent)'}">${selectionIcon(selectedId)}</span>
      <span class="${id ? '' : 'current-model-label'}" ${id ? 'id="current-model-label"' : ''}>${escapeHtml(modelLabel(selectedId))}</span>
      <svg class="provider-chevron" id="${id ? 'chevron-icon' : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="6 9 12 15 18 9"></polyline></svg>
      <div class="dropdown coden-provider-model-menu" id="${id ? 'model-dropdown' : ''}">
        <div class="dropdown-header">Models</div>
        <button type="button" class="coden-auto-model-option${selectedId === 'auto' ? ' active' : ''}" data-model-id="auto" data-model-name="Auto">
          <span class="provider-icon" style="--provider-color:var(--accent);--provider-text:var(--bg);">${selectorIcon('auto')}</span>
          <span class="provider-card-main">
            <span class="provider-name">Auto</span>
            <span class="provider-count">Best fit</span>
          </span>
        </button>
        <div class="coden-provider-list">
          ${providers.map(provider => {
            const meta = PROVIDER_META[provider];
            const isActive = selectedProvider === provider;
            return `
              <div class="coden-provider-card${isActive ? ' active' : ''}" data-provider="${provider}" style="--provider-color:${meta.color};--provider-text:${meta.textColor};">
                <span class="provider-icon">${selectorIcon(meta.icon)}</span>
                <span class="provider-card-main">
                  <span class="provider-name-row">
                    <span class="provider-name">${escapeHtml(meta.label)}</span>
                  </span>
                  <span class="provider-selected-label">${escapeHtml(isActive ? modelLabel(selectedId) : `${groups[provider].length} models`)}</span>
                </span>
                <button class="provider-expand-btn" type="button" aria-label="Open ${escapeHtml(meta.label)} models" data-provider-arrow="${provider}">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><polyline points="9 18 15 12 9 6"></polyline></svg>
                </button>
              </div>
            `;
          }).join('')}
        </div>
        <div class="coden-model-list-panel" role="listbox" aria-label="Provider models"></div>
      </div>
    `;

    oldRoot.replaceWith(root);

    const menu = root.querySelector<HTMLElement>('.coden-provider-model-menu');
    const panel = root.querySelector<HTMLElement>('.coden-model-list-panel');
    let activeProvider: ModelProvider | null = null;

    const closePanel = () => {
      activeProvider = null;
      panel?.classList.remove('visible');
      root.querySelectorAll('.provider-expand-btn.open, .coden-provider-card.open').forEach(item => item.classList.remove('open'));
    };
    const closeMenu = () => {
      menu?.classList.remove('open');
      root.setAttribute('aria-expanded', 'false');
      closePanel();
    };
    const openMenu = () => {
      menu?.classList.add('open');
      root.setAttribute('aria-expanded', 'true');
    };
    const toggleProvider = (provider: ModelProvider) => {
      if (!panel) return;
      if (activeProvider === provider) {
        closePanel();
        return;
      }
      activeProvider = provider;
      root.querySelectorAll('.provider-expand-btn.open, .coden-provider-card.open').forEach(item => item.classList.remove('open'));
      root.querySelector<HTMLElement>(`[data-provider="${provider}"]`)?.classList.add('open');
      root.querySelector<HTMLElement>(`[data-provider-arrow="${provider}"]`)?.classList.add('open');
      panel.innerHTML = renderModelPanel(provider, normalizeModelSelectionId(localStorage.getItem(storageKey) || selectedId));
      panel.classList.add('visible');
    };

    root.addEventListener('click', event => {
      const target = event.target as HTMLElement;
      if (target.closest('[data-provider-arrow]')) {
        event.preventDefault();
        event.stopPropagation();
        openMenu();
        toggleProvider(target.closest<HTMLElement>('[data-provider-arrow]')?.dataset.providerArrow as ModelProvider);
        return;
      }
      const modelTarget = target.closest<HTMLElement>('[data-model-id]');
      if (modelTarget) {
        event.preventDefault();
        event.stopPropagation();
        updateAllSelectors(modelTarget.dataset.modelId || 'auto', storageKey);
        closeMenu();
        return;
      }
      if (target.closest('.coden-model-list-panel, .coden-provider-model-menu')) {
        event.stopPropagation();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (menu?.classList.contains('open')) closeMenu();
      else openMenu();
    });

    root.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (menu?.classList.contains('open')) closeMenu();
        else openMenu();
      }
      if (event.key === 'Escape') closeMenu();
    });

    document.addEventListener('click', event => {
      if (!root.contains(event.target as Node)) closeMenu();
    });
  });

  updateAllSelectors(normalizeModelSelectionId(localStorage.getItem(storageKey) || 'auto'), storageKey);
}
