import { initThemeController } from './theme-controller';
import './styles/agent-surface.css';
import './styles/coden-horizon-system.css';
import './styles/coden-composer.css';

// Dedicated entrypoint: never mounts the legacy marketing shell or Builder UI.
const notice = document.getElementById('landing-notice');
initThemeController();

function announce(message: string) {
  if (!notice) return;
  notice.textContent = message;
  notice.hidden = false;
}

let submitting = false;

/*
 * Both composers on this page are the shared PromptInput now.
 *
 * There are two — the hero and the closing call to action — and each used to
 * be hand-wired markup with its own resize handler, its own mode toggle and
 * its own submit button. They are replaced in place: the textarea's own
 * container becomes the island host, so index.html keeps its layout and the
 * component brings the behaviour.
 */
async function startFromPrompt(
  prompt: string,
  meta: { model: string; effort: string },
  setBusy: (busy: boolean) => void,
) {
  const request = prompt.trim();
  if (!request || submitting) return;
  submitting = true;
  setBusy(true);
  announce('Preparing your workspace…');
  try {
    const { startCreateProjectFlow, formatCreateProjectFlowStatus } = await import('./services/create-project-flow');
    await startCreateProjectFlow(
      { prompt: request, mode: 'auto', source: 'landing', projectName: request, model: meta.model, effort: meta.effort },
      {
        createProject: true,
        onStatus: status => announce(formatCreateProjectFlowStatus(status, 'en')),
      },
    );
  } catch (error) {
    announce(error instanceof Error ? error.message : 'Unable to open your workspace. Please try again.');
  } finally {
    submitting = false;
    setBusy(false);
  }
}

/*
 * Each island owns its own value, so the page can drive it.
 *
 * The composer is a controlled component here rather than uncontrolled,
 * because the "start from a screenshot / a repository / an example" links at
 * the bottom of the page prefill it. Writing `.value` on a React-controlled
 * textarea sets the DOM property and nothing else — the component re-renders
 * from state on the next keystroke and the prefill vanishes. Holding the
 * value out here is what keeps those three links working.
 */
type ComposerIsland = { setValue: (value: string) => void; openFilePicker: () => void };
const composerIslands: ComposerIsland[] = [];

document.querySelectorAll<HTMLTextAreaElement>('textarea').forEach(textarea => {
  const host = textarea.parentElement;
  if (!host) return;
  const placeholder = textarea.getAttribute('placeholder') || 'Describe the app you want to build…';

  let value = '';
  let busy = false;
  let render = () => {};

  void import('./mount-prompt-input').then(({ mountPromptInput }) => {
    render = () => mountPromptInput(host, {
      placeholder,
      value,
      onChange: next => { value = next; render(); },
      defaultExpanded: true,
      collapsedWidth: 640,
      expandedWidth: 640,
      disabled: busy,
      onSubmit: (submitted, meta) => {
        void startFromPrompt(submitted, meta, next => { busy = next; render(); });
      },
    });
    render();
    composerIslands.push({
      setValue: next => { value = next; render(); },
      openFilePicker: () => host.querySelector<HTMLButtonElement>('[data-prompt-action="upload"]')?.click(),
    });
  });
});


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

document.querySelectorAll<HTMLAnchorElement>('[data-start-from]').forEach(link => {
  link.addEventListener('click', event => {
    event.preventDefault();
    const hero = composerIslands[0];
    document.getElementById('top')?.scrollIntoView({
      block: 'center',
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    });
    if (!hero) return;
    if (link.dataset.startFrom === 'screenshot') {
      hero.openFilePicker();
      return;
    }
    hero.setValue(link.dataset.startFrom === 'repository'
      ? 'Help me work on this GitHub repository: '
      : 'Build a responsive customer portal with a dashboard, a list of projects and project detail pages.');
    if (link.dataset.startFrom === 'repository') announce('Paste your repository URL and describe the changes you need.');
  });
});
