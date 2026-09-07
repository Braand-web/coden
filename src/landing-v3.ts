import { initPromptInputActions } from './prompt-input-actions';
import './styles/agent-surface.css';
import './styles/coden-horizon-system.css';

// Dedicated entrypoint: never mounts the legacy marketing shell or Builder UI.
const notice = document.getElementById('landing-notice');
function announce(message: string) {
  if (!notice) return;
  notice.textContent = message;
  notice.hidden = false;
}

let submitting = false;
document.querySelectorAll<HTMLTextAreaElement>('textarea').forEach(textarea => {
  const wrapper = textarea.parentElement!;
  wrapper.classList.add('input-wrapper');
  const submit = wrapper.querySelector<HTMLButtonElement>('[data-build]')!;
  const modeButton = wrapper.querySelector<HTMLButtonElement>('[data-mode-toggle]');
  let mode: 'auto' | 'plan' = 'auto';
  modeButton?.addEventListener('click', () => {
    mode = mode === 'auto' ? 'plan' : 'auto';
    wrapper.dataset.promptMode = mode;
    modeButton.setAttribute('aria-pressed', String(mode === 'plan'));
    modeButton.setAttribute('aria-label', mode === 'plan' ? 'Return to Auto mode' : 'Switch to Plan mode');
    modeButton.setAttribute('title', mode === 'plan' ? 'Prepare the work without changing the project.' : 'Coden chooses the best action.');
    const label = modeButton.querySelector('[data-mode-label]');
    if (label) label.textContent = mode === 'plan' ? 'Plan' : 'Auto';
    submit.setAttribute('aria-label', mode === 'plan' ? 'Plan this app' : 'Build now');
  });
  wrapper.dataset.promptMode = mode;
  async function start() {
    if (submitting) return;
    const prompt = textarea.value.trim();
    if (!prompt) { textarea.focus(); announce('Describe what you would like to build first.'); return; }
    submitting = true;
    document.querySelectorAll<HTMLButtonElement>('[data-build]').forEach(button => { button.disabled = true; });
    textarea.readOnly = true;
    wrapper.setAttribute('aria-busy', 'true');
    announce('Preparing your workspace…');
    try {
      const { startCreateProjectFlow, formatCreateProjectFlowStatus } = await import('./services/create-project-flow');
      await startCreateProjectFlow({ prompt, mode, source:'landing', projectName:prompt }, {
        createProject: true,
        onStatus: status => announce(formatCreateProjectFlowStatus(status, 'en')),
      });
    } catch (error) {
      announce(error instanceof Error ? error.message : 'Unable to open your workspace. Please try again.');
    } finally {
      submitting = false;
      textarea.readOnly = false;
      wrapper.removeAttribute('aria-busy');
      document.querySelectorAll<HTMLButtonElement>('[data-build]').forEach(button => { button.disabled = false; });
    }
  }
  submit.addEventListener('click', () => { void start(); });
  textarea.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); void start(); }
  });
});
initPromptInputActions({ persistForBuilder:true, onNotice: announce });

document.querySelectorAll<HTMLAnchorElement>('[data-start-from]').forEach(link => {
  link.addEventListener('click', event => {
    event.preventDefault();
    const textarea = document.querySelector<HTMLTextAreaElement>('#top textarea')!;
    textarea.scrollIntoView({ block:'center', behavior:matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    if (link.dataset.startFrom === 'screenshot') {
      document.querySelector<HTMLButtonElement>('#top [data-prompt-action="upload"]')?.click();
    } else {
      textarea.value = link.dataset.startFrom === 'repository'
        ? 'Help me work on this GitHub repository: '
        : 'Build a responsive customer portal with a dashboard, a list of projects and project detail pages.';
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
      if (link.dataset.startFrom === 'repository') announce('Paste your repository URL and describe the changes you need.');
    }
  });
});
