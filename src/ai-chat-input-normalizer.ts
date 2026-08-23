let inputStyleInstalled = false;

const arrowIcon = `
  <svg class="coden-submit-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 19V5m0 0-6 6m6-6 6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
`;

function installAiInputStyle() {
  if (inputStyleInstalled || typeof document === 'undefined') return;
  const style = document.createElement('style');
  style.id = 'coden-ai-input-normalizer-style';
  style.textContent = `
    :root {
      --chat-action-height: 24px;
      --chat-action-radius: 5px;
      --chat-action-font: 10px;
      --chat-action-icon: 12px;
    }

    .coden-ai-input.input-wrapper,
    .coden-ai-input {
      border: 1px solid var(--border, #eceae4) !important;
      background: var(--bg-input, #fffefa) !important;
      color: var(--text, #1c1c1c) !important;
      box-shadow: 0 1px 0 rgba(255,255,255,.78) inset, 0 12px 32px rgba(28,28,28,.07) !important;
      overflow: visible !important;
      text-align: left !important;
    }

    .coden-ai-input.input-wrapper::before,
    .coden-ai-input.input-wrapper::after {
      display: none !important;
    }

    .coden-ai-input:focus-within {
      border-color: var(--border-mid, var(--border, #eceae4)) !important;
      box-shadow: 0 1px 0 rgba(255,255,255,.78) inset, 0 12px 32px rgba(28,28,28,.08) !important;
    }

    .coden-ai-input textarea,
    .coden-ai-input #ai-textarea,
    .coden-ai-input #chat-textarea-box {
      color: var(--text, #1c1c1c) !important;
      text-align: left !important;
    }

    .coden-ai-input textarea::placeholder {
      color: var(--text-sub, #77736b) !important;
      opacity: .82 !important;
    }

    .coden-ai-input .input-actions {
      align-items: center !important;
      gap: 6px !important;
    }

    .coden-ai-input .submit-wrapper {
      display: inline-flex !important;
      align-items: center !important;
      width: auto !important;
      height: var(--chat-action-height) !important;
    }

    .coden-ai-input .submit-wrapper::before,
    .coden-ai-input .submit-wrapper::after {
      display: none !important;
    }

    .coden-ai-input .icon-btn,
    .coden-ai-input .submit-btn,
    .coden-ai-input .model-select,
    .coden-ai-input .prompt-mode-btn,
    .coden-ai-input #btn-chat-mode {
      min-height: var(--chat-action-height) !important;
      height: var(--chat-action-height) !important;
      border-radius: var(--chat-action-radius) !important;
      border: 1px solid var(--border, #eceae4) !important;
      background: transparent !important;
      color: var(--text-sub, #77736b) !important;
      box-shadow: none !important;
      font-size: var(--chat-action-font) !important;
      font-weight: 750 !important;
      line-height: 1 !important;
    }

    .coden-ai-input .icon-btn,
    .coden-ai-input .submit-btn {
      width: var(--chat-action-height) !important;
      min-width: var(--chat-action-height) !important;
      padding: 0 !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
    }

    .coden-ai-input .icon-btn svg,
    .coden-ai-input .submit-btn svg,
    .coden-ai-input .model-select svg,
    .coden-ai-input .prompt-mode-btn svg,
    .coden-ai-input #btn-chat-mode svg {
      width: var(--chat-action-icon) !important;
      height: var(--chat-action-icon) !important;
      flex: 0 0 auto !important;
    }

    .coden-ai-input .model-select,
    .coden-ai-input .prompt-mode-btn,
    .coden-ai-input #btn-chat-mode {
      width: auto !important;
      min-width: 0 !important;
      max-width: min(156px, 36vw) !important;
      padding: 0 7px !important;
      gap: 5px !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      white-space: nowrap !important;
    }

    .coden-ai-input .model-label-prefix,
    .coden-ai-input .current-model-label,
    .coden-ai-input #current-model-label,
    .coden-ai-input .prompt-mode-label {
      font-size: var(--chat-action-font) !important;
      line-height: 1 !important;
    }

    .coden-ai-input .submit-btn span {
      display: none !important;
    }

    .coden-ai-input .submit-btn.active,
    .coden-ai-input .submit-btn:not(:disabled).active {
      background: var(--accent-blue, var(--text, #1c1c1c)) !important;
      color: var(--bg, #fcfbf8) !important;
      border-color: var(--accent-blue, var(--text, #1c1c1c)) !important;
      cursor: pointer !important;
      pointer-events: auto !important;
      box-shadow: 0 8px 18px color-mix(in srgb, var(--accent-blue, #2f6df6) 18%, transparent) !important;
    }

    .coden-ai-input .submit-btn:not(.active) {
      opacity: .72 !important;
    }

    .coden-ai-input .icon-btn:hover,
    .coden-ai-input .model-select:hover,
    .coden-ai-input .prompt-mode-btn:hover,
    .coden-ai-input #btn-chat-mode:hover {
      border-color: var(--border-focus, rgba(47,109,246,.34)) !important;
      color: var(--accent-blue, var(--text, #1c1c1c)) !important;
      background: var(--accent-blue-soft, var(--bg-elevated, #f7f4ed)) !important;
    }

    [data-theme="dark"] .coden-ai-input.input-wrapper,
    [data-theme="dark"] .coden-ai-input {
      box-shadow: 0 1px 0 rgba(255,255,255,.04) inset, 0 12px 34px rgba(0,0,0,.22) !important;
    }

    @media (max-width: 480px) {
      .coden-ai-input .input-actions {
        gap: 4px !important;
      }

      .coden-ai-input .model-select {
        max-width: 132px !important;
      }
    }
  `;
  document.head.appendChild(style);
  inputStyleInstalled = true;
}

export function normalizeAiChatInputs(root: ParentNode = document) {
  if (typeof document === 'undefined') return;
  installAiInputStyle();

  root.querySelectorAll<HTMLElement>('.input-wrapper').forEach(wrapper => {
    if (!wrapper.querySelector('textarea') || !wrapper.querySelector('.input-actions')) return;
    wrapper.classList.add('coden-ai-input');
    wrapper.dataset.aiChatInput = 'true';

    wrapper.querySelectorAll<HTMLButtonElement>('button').forEach(button => {
      if (!button.getAttribute('type')) button.type = 'button';
    });

    const submit = wrapper.querySelector<HTMLButtonElement>('.submit-btn');
    if (submit) {
      const visibleLabel = submit.querySelector('span')?.textContent?.trim();
      const accessibleLabel = submit.id === 'submit-btn'
        ? visibleLabel || 'Créer mon application'
        : visibleLabel || 'Send prompt';
      submit.setAttribute('aria-label', submit.getAttribute('aria-label') || accessibleLabel);
      submit.title = submit.title || accessibleLabel;
      if (!submit.querySelector('svg')) {
        submit.insertAdjacentHTML('beforeend', arrowIcon);
      }
    }

    const modelSelect = wrapper.querySelector<HTMLElement>('.model-select');
    if (modelSelect) {
      modelSelect.setAttribute('role', modelSelect.getAttribute('role') || 'button');
      modelSelect.setAttribute('tabindex', modelSelect.getAttribute('tabindex') || '0');
      modelSelect.setAttribute('aria-label', modelSelect.getAttribute('aria-label') || 'Choose AI model');
    }
  });
}
