/**
 * The motion every public page shares: the landing, features, pricing, documentation, security,
 * privacy and terms speak the same language — the calm brand mesh behind the first screen, a light
 * that follows the pointer over the cards, and a thin line that fills as a long page is read.
 * Nothing here moves under reduced motion.
 */
import { mountBrandMesh } from './brand-mesh';

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Adds the brand mesh behind the first screen of a page that has none yet. */
export function mountHeroMesh(hero: HTMLElement | null) {
  if (!hero || hero.querySelector(':scope > .lp-mesh')) return;
  const host = document.createElement('div');
  host.className = 'lp-mesh';
  host.dataset.lpMesh = 'hero';
  host.setAttribute('aria-hidden', 'true');
  hero.prepend(host);
  mountBrandMesh(host, 'hero');
}

/** The light that follows the pointer over the cards: only where there is a pointer. */
export function installPointerLight(selector: string) {
  if (!window.matchMedia('(hover: hover)').matches || reducedMotion()) return;
  let frame = 0;
  document.addEventListener('pointermove', event => {
    const card = (event.target as Element | null)?.closest?.<HTMLElement>(selector);
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
export function installReadingProgress() {
  if (reducedMotion()) return;
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

/** Lets the mesh drift a little slower than the page, so the background has depth. */
export function installMeshParallax() {
  if (reducedMotion()) return;
  const hosts = Array.from(document.querySelectorAll<HTMLElement>('.lp-mesh'));
  if (!hosts.length) return;
  let frame = 0;
  const update = () => {
    frame = 0;
    hosts.forEach(host => {
      const box = host.parentElement?.getBoundingClientRect();
      if (!box || box.bottom < -200 || box.top > window.innerHeight + 200) return;
      host.style.setProperty('--py', `${Math.round((box.top + box.height / 2 - window.innerHeight / 2) * -0.06)}px`);
    });
  };
  window.addEventListener('scroll', () => { if (!frame) frame = requestAnimationFrame(update); }, { passive: true });
  update();
}
