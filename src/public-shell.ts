import { navLabel, PUBLIC_ACTIONS, PUBLIC_LEGAL_LINKS, PUBLIC_NAV } from './config/public-routes';
import { applySignedInLinks, hasStoredSession } from './lib/stored-session';
import { trackFunnelEvent } from './conversion-events';
import { initThemeController } from './theme-controller';
import './styles/public-shell.css';

let mounted = false;

const svgNamespace = 'http://www.w3.org/2000/svg';

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function logoMark() {
  const svg = document.createElementNS(svgNamespace, 'svg');
  svg.setAttribute('viewBox', '0 0 32 32');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('coden-public-logo');
  const parts = [
    ['rect', { width: '32', height: '32', rx: '8', fill: 'var(--accent)' }],
    ['path', { d: 'M16 8L25 13.5V14.5L16 9.5L7 14.5V13.5L16 8Z', fill: 'var(--background)' }],
    ['path', { d: 'M7 16.5V24.5L11.5 22V14L7 16.5Z', fill: 'var(--background)' }],
    ['path', { d: 'M25 16.5V24.5L16 24.5V22H20.5V14L25 16.5Z', fill: 'var(--background)' }],
  ] as const;
  parts.forEach(([tag, attributes]) => {
    const child = document.createElementNS(svgNamespace, tag);
    Object.entries(attributes).forEach(([name, value]) => child.setAttribute(name, value));
    svg.appendChild(child);
  });
  return svg;
}

function themeIcon(kind: 'dark' | 'light') {
  const svg = document.createElementNS(svgNamespace, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');
  svg.dataset.themeIcon = kind;
  if (kind === 'dark') {
    const path = document.createElementNS(svgNamespace, 'path');
    path.setAttribute('d', 'M20.5 15.3A8.5 8.5 0 1 1 8.7 3.5 8.5 8.5 0 0 0 20.5 15.3Z');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.8');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path);
  } else {
    const circle = document.createElementNS(svgNamespace, 'circle');
    circle.setAttribute('cx', '12');
    circle.setAttribute('cy', '12');
    circle.setAttribute('r', '4');
    circle.setAttribute('stroke', 'currentColor');
    circle.setAttribute('stroke-width', '1.8');
    const path = document.createElementNS(svgNamespace, 'path');
    path.setAttribute('d', 'M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.8');
    path.setAttribute('stroke-linecap', 'round');
    svg.append(circle, path);
  }
  return svg;
}

function routeIsCurrent(href: string) {
  const target = new URL(href, window.location.origin);
  return target.pathname === window.location.pathname && (!target.hash || target.hash === window.location.hash);
}

function navigationLink(href: string, label: string, className?: string) {
  const link = element('a', className);
  link.href = href;
  link.textContent = label;
  if (routeIsCurrent(href)) link.setAttribute('aria-current', 'page');
  return link;
}

function setMenuState(open: boolean, menu: HTMLElement, trigger: HTMLButtonElement) {
  menu.hidden = !open;
  menu.inert = !open;
  menu.setAttribute('aria-hidden', String(!open));
  trigger.setAttribute('aria-expanded', String(open));
  trigger.setAttribute('aria-label', open ? 'Fermer la navigation' : 'Ouvrir la navigation');
  trigger.closest('header')?.classList.toggle('is-menu-open', open);
  document.body.classList.toggle('coden-public-menu-open', open);
  if (open) menu.querySelector<HTMLElement>('a, button')?.focus({ preventScroll: true });
}

function mountHeader() {
  const host = document.getElementById('coden-marketing-header-root');
  if (!host) return;
  host.replaceChildren();

  const skip = element('a', 'coden-public-skip-link');
  skip.href = '#main-content';
  skip.textContent = 'Aller au contenu';
  document.body.prepend(skip);

  const sentinel = element('div', 'coden-public-header-sentinel');
  sentinel.setAttribute('aria-hidden', 'true');
  document.body.insertBefore(sentinel, host);

  const header = element('header', 'coden-public-header');
  header.dataset.headerState = 'top';

  const brand = element('a', 'coden-public-brand');
  brand.href = '/';
  brand.setAttribute('aria-label', 'Accueil Coden');
  brand.append(logoMark());
  const brandText = element('span');
  brandText.textContent = 'Coden';
  brand.appendChild(brandText);

  const nav = element('nav', 'coden-public-nav');
  nav.setAttribute('aria-label', 'Navigation principale');
  PUBLIC_NAV.forEach(link => nav.appendChild(navigationLink(link.href, navLabel(link, 'fr'))));

  const actions = element('div', 'coden-public-actions');
  // Signed in: one way back to the projects, no sign-in or sign-up offer.
  const signedIn = hasStoredSession();
  const signIn = navigationLink(PUBLIC_ACTIONS.signIn.href, navLabel(PUBLIC_ACTIONS.signIn, 'fr'), 'coden-public-signin');
  signIn.dataset.conversionEvent = 'sign_in_click';
  signIn.dataset.conversionPlace = 'navbar';
  const cta = signedIn
    ? navigationLink('/dashboard.html', 'Mes projets', 'coden-public-cta')
    : navigationLink(PUBLIC_ACTIONS.cta.href, 'Créer mon application', 'coden-public-cta');
  if (!signedIn) {
    cta.dataset.conversionEvent = 'start_building_click';
    cta.dataset.conversionPlace = 'navbar';
  }

  const trigger = element('button', 'coden-public-menu-trigger');
  trigger.type = 'button';
  trigger.setAttribute('aria-controls', 'coden-public-mobile-menu');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-label', 'Ouvrir la navigation');
  const menuIcon = element('span', 'coden-public-menu-icon');
  menuIcon.setAttribute('aria-hidden', 'true');
  menuIcon.append(element('i'), element('i'), element('i'));
  trigger.appendChild(menuIcon);
  if (signedIn) actions.append(cta, trigger);
  else actions.append(signIn, cta, trigger);
  header.append(brand, nav, actions);

  const mobileMenu = element('div', 'coden-public-mobile-menu');
  mobileMenu.id = 'coden-public-mobile-menu';
  mobileMenu.hidden = true;
  mobileMenu.inert = true;
  mobileMenu.setAttribute('aria-hidden', 'true');
  mobileMenu.setAttribute('role', 'dialog');
  mobileMenu.setAttribute('aria-modal', 'true');
  mobileMenu.setAttribute('aria-label', 'Navigation mobile');
  const mobilePanel = element('nav', 'coden-public-mobile-panel');
  mobilePanel.setAttribute('aria-label', 'Navigation mobile');
  PUBLIC_NAV.forEach(link => mobilePanel.appendChild(navigationLink(link.href, navLabel(link, 'fr'))));
  if (signedIn) {
    mobilePanel.append(navigationLink('/dashboard.html', 'Mes projets', 'coden-public-mobile-primary'));
  } else {
    mobilePanel.append(
      navigationLink(PUBLIC_ACTIONS.signIn.href, navLabel(PUBLIC_ACTIONS.signIn, 'fr'), 'coden-public-mobile-secondary'),
      navigationLink(PUBLIC_ACTIONS.cta.href, 'Créer mon application', 'coden-public-mobile-primary'),
    );
  }
  mobileMenu.appendChild(mobilePanel);
  host.append(header, mobileMenu);

  trigger.addEventListener('click', () => setMenuState(Boolean(mobileMenu.hidden), mobileMenu, trigger));
  mobileMenu.addEventListener('click', event => {
    if (event.target === mobileMenu || (event.target instanceof Element && event.target.closest('a'))) {
      setMenuState(false, mobileMenu, trigger);
    }
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || mobileMenu.hidden) return;
    setMenuState(false, mobileMenu, trigger);
    trigger.focus({ preventScroll: true });
  });
  const media = window.matchMedia('(min-width: 901px)');
  const closeForDesktop = () => { if (media.matches && !mobileMenu.hidden) setMenuState(false, mobileMenu, trigger); };
  media.addEventListener?.('change', closeForDesktop);

  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(([entry]) => {
      header.dataset.headerState = entry?.isIntersecting ? 'top' : 'scrolled';
    }, { threshold: 0 });
    observer.observe(sentinel);
  }
}

function footerLink(href: string, label: string) {
  const link = element('a');
  link.href = href;
  link.textContent = label;
  return link;
}

type FooterColumn = { title: string; links: ReadonlyArray<readonly [string, string]> };

/*
 * Every link here resolves to a page that exists — the canonical public
 * routes, the anchors of the landing, the account entry points and the
 * legal pages from the route policy. No placeholder destinations.
 */
function footerColumns(signedIn = hasStoredSession()): FooterColumn[] {
  const signup = signedIn ? '/dashboard.html' : PUBLIC_ACTIONS.cta.href;
  const account: ReadonlyArray<readonly [string, string]> = signedIn
    ? [['/dashboard.html', 'Mes projets']]
    : [[PUBLIC_ACTIONS.signIn.href, navLabel(PUBLIC_ACTIONS.signIn, 'fr')], [signup, 'Créer un compte'], ['/dashboard.html', 'Mes projets']];
  return [
    { title: 'Produit', links: [['/features.html', 'Fonctionnalités'], ['/pricing.html', 'Tarifs'], ['/#exemples', 'Exemples'], [signup, 'Créer une application']] },
    { title: 'Ressources', links: [['/documentation.html', 'Documentation'], ['/#faq', 'Questions fréquentes'], ['/security.html', 'Sécurité']] },
    { title: 'Compte', links: account },
    { title: 'Mentions légales', links: PUBLIC_LEGAL_LINKS.map(link => [link.href, navLabel(link, 'fr')] as const) },
  ];
}

function mountFooter() {
  const host = document.getElementById('coden-marketing-footer-root');
  if (!host) return;
  host.replaceChildren();
  const frame = element('div', 'coden-public-footer-frame');
  const footer = element('footer', 'coden-public-footer');

  const brand = element('div', 'coden-public-footer-brand');
  const home = element('a', 'coden-public-footer-logo');
  home.href = '/';
  home.setAttribute('aria-label', 'Accueil Coden');
  home.append(logoMark());
  const tagline = element('p');
  tagline.textContent = 'De l’idée à l’application web.';
  brand.append(home, tagline);

  const columns = element('nav', 'coden-public-footer-columns');
  columns.setAttribute('aria-label', 'Liens du pied de page');
  footerColumns().forEach(column => {
    const group = element('div', 'coden-public-footer-column');
    const title = element('h2');
    title.textContent = column.title;
    const list = element('ul');
    column.links.forEach(([href, label]) => {
      const item = element('li');
      item.appendChild(footerLink(href, label));
      list.appendChild(item);
    });
    group.append(title, list);
    columns.appendChild(group);
  });

  const bottom = element('div', 'coden-public-footer-bottom');
  const theme = element('button', 'coden-public-theme-toggle');
  theme.type = 'button';
  theme.dataset.themeToggle = '';
  const lightLabel = element('span');
  lightLabel.dataset.themeLabel = 'light';
  lightLabel.textContent = 'Clair';
  const darkLabel = element('span');
  darkLabel.dataset.themeLabel = 'dark';
  darkLabel.textContent = 'Sombre';
  theme.append(themeIcon('dark'), themeIcon('light'), lightLabel, darkLabel);
  const copyright = element('span', 'coden-public-footer-copyright');
  copyright.textContent = `@coden${new Date().getFullYear()}`;
  bottom.append(theme, copyright);

  footer.append(brand, columns, bottom);
  frame.appendChild(footer);
  host.appendChild(frame);
}

function bindConversionTracking() {
  trackFunnelEvent('public_page_view', { referrer: document.referrer ? new URL(document.referrer, location.origin).hostname : 'direct' });
  document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-conversion-event]') : null;
    if (!target) return;
    trackFunnelEvent(target.dataset.conversionEvent || 'click', {
      place: target.dataset.conversionPlace,
      plan: target.dataset.conversionPlan,
    });
  });
}

export function mountPublicShell() {
  if (mounted) return;
  mounted = true;
  document.documentElement.lang = 'fr';
  document.body.classList.add('coden-public-surface');
  document.querySelectorAll('.navbar, .seo-nav, .navbar-line, .footer, .seo-footer, .pricing-footer').forEach(node => node.remove());
  mountHeader();
  mountFooter();
  // The page's own sign-up buttons (pricing cards, final call to action).
  if (hasStoredSession()) applySignedInLinks(document);
  initThemeController();
  bindConversionTracking();
}
