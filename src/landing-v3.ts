import { initPromptInputActions } from './prompt-input-actions';
import { initThemeController } from './theme-controller';
import { initCodenNavigationTransitions } from './navigation-transitions';
import './styles/agent-surface.css';
import './styles/coden-horizon-system.css';
import './styles/coden-composer.css';

// Dedicated entrypoint: never mounts the legacy marketing shell or Builder UI.
const notice = document.getElementById('landing-notice');
initThemeController();
initCodenNavigationTransitions();

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
  const resize = () => {
    textarea.style.height = 'auto';
    const nextHeight = Math.min(Math.max(textarea.scrollHeight, 52), 240);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > 240 ? 'auto' : 'hidden';
  };
  textarea.rows = 1;
  resize();
  textarea.addEventListener('input', resize);
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

/*
 * Sections arrive as you reach them.
 *
 * This page had no scroll motion at all: the reveal machinery in main.ts
 * serves the five secondary public pages, and index.html loads landing-v3.ts
 * instead, so none of it was ever reaching the landing.
 *
 * Three deliberate constraints, in order of how badly each would hurt:
 *
 *  1. The first section is never hidden. It is the fold — the headline and the
 *     composer — and hiding it to fade it back in is a blank first paint, paid
 *     for by every visitor, to animate something they were already looking at.
 *  2. The attribute that arms the CSS is set from here, not written in the
 *     stylesheet, so a browser without IntersectionObserver and a reader with
 *     reduced motion both get the page whole rather than the page hidden.
 *  3. Anything that ends up on screen without the observer having fired is
 *     shown anyway a moment later. The net is bounded to what is actually
 *     visible, so sections further down keep their entrance.
 */
(() => {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (typeof IntersectionObserver !== 'function') return;

  const sections = Array.from(document.querySelectorAll<HTMLElement>('#landing-main > section'));
  const targets = sections.slice(1);
  if (!targets.length) return;

  for (const section of targets) section.setAttribute('data-coden-reveal', '');
  document.documentElement.dataset.codenReveal = 'on';

  const reveal = (element: Element) => element.classList.add('is-revealed');
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      reveal(entry.target);
      observer.unobserve(entry.target);
    }
  }, { threshold: 0.08, rootMargin: '0px 0px -8% 0px' });

  for (const section of targets) observer.observe(section);

  window.setTimeout(() => {
    const fold = window.innerHeight || document.documentElement.clientHeight;
    for (const section of targets) {
      if (section.classList.contains('is-revealed')) continue;
      if (section.getBoundingClientRect().top < fold) reveal(section);
    }
  }, 1200);
})();

/*
 * The manifesto is intentionally the one expressive motion moment on the
 * page.  It uses the same observer contract as the section reveals instead
 * of a scroll handler, so it does not compete with scrolling or run for
 * people who have asked for reduced motion.
 */
(() => {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (typeof IntersectionObserver !== 'function') return;

  const manifesto = document.querySelector<HTMLElement>('#manifesto');
  const words = Array.from(document.querySelectorAll<HTMLElement>('[data-word-reveal]'));
  if (!manifesto || !words.length) return;

  // Arm the hidden start state only once the progressive enhancement is known
  // to be available. Without this, an older browser would keep the heading
  // invisible forever instead of simply showing a static heading.
  manifesto.dataset.wordReveal = 'on';

  const observer = new IntersectionObserver(entries => {
    if (!entries.some(entry => entry.isIntersecting)) return;
    words.forEach((word, index) => {
      window.setTimeout(() => word.classList.add('is-revealed'), index * 52);
    });
    observer.disconnect();
  }, { threshold: .34 });

  observer.observe(manifesto);
})();

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
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
      if (link.dataset.startFrom === 'repository') announce('Paste your repository URL and describe the changes you need.');
    }
  });
});
