import './styles/public-pages.css';
import './styles/public-alive.css';
import { initCodenNavigationTransitions } from './navigation-transitions';
import { mountPublicShell } from './public-shell';

function installPublicRevealObserver() {
  const nodes = Array.from(document.querySelectorAll<HTMLElement>('[data-public-reveal]'));
  if (!nodes.length) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) {
    nodes.forEach(node => node.classList.add('is-visible'));
    return;
  }
  document.documentElement.dataset.publicReveal = 'on';
  const observer = new IntersectionObserver((entries, current) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      current.unobserve(entry.target);
    });
  }, { threshold: .12, rootMargin: '0px 0px -32px' });
  nodes.forEach(node => observer.observe(node));
}

/** The light that follows the pointer over the cards: only where there is a pointer, never under reduced motion. */
function installPointerLight() {
  if (!window.matchMedia('(hover: hover)').matches || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let frame = 0;
  document.addEventListener('pointermove', event => {
    const card = (event.target as Element | null)?.closest?.<HTMLElement>('.public-page-content article, .pricing-plan-card');
    if (!card || frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const box = card.getBoundingClientRect();
      card.style.setProperty('--mx', `${event.clientX - box.left}px`);
      card.style.setProperty('--my', `${event.clientY - box.top}px`);
    });
  }, { passive: true });
}

/** A thin line that fills as a long page is read. Short pages do not get one. */
function installReadingProgress() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (document.documentElement.scrollHeight < window.innerHeight * 2.2) return;
  const bar = document.createElement('div');
  bar.className = 'public-progress';
  bar.setAttribute('aria-hidden', 'true');
  document.body.append(bar);
  let frame = 0;
  const update = () => {
    frame = 0;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    bar.style.transform = `scaleX(${max > 0 ? Math.min(1, window.scrollY / max) : 0})`;
  };
  window.addEventListener('scroll', () => { if (!frame) frame = requestAnimationFrame(update); }, { passive: true });
  update();
}

function init() {
  mountPublicShell();
  initCodenNavigationTransitions();
  installPublicRevealObserver();
  installPointerLight();
  installReadingProgress();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
else init();

