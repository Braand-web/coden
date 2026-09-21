import './styles/public-pages.css';
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

function init() {
  mountPublicShell();
  initCodenNavigationTransitions();
  installPublicRevealObserver();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
else init();

