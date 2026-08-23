import { initThemeController } from './theme-controller';

type PublicEnhancementOptions = {
  faq?: boolean;
  back?: boolean;
  backFallback?: string;
};

const SHARED_FAQ_ITEMS = [
  {
    question: 'What can Coden build?',
    answer: 'Coden is built for web products: SaaS dashboards, portals, booking tools, e-commerce, internal tools, AI utilities, portfolios and landing pages. It opens a builder workspace so the idea can become a preview, then a publishable app.',
  },
  {
    question: 'Does Coden create real applications or only mockups?',
    answer: 'For app requests, Coden is designed to create structured React, TypeScript and Vite projects with files, styles, interactions and a preview. Simple static HTML should only be used when the user clearly asks for a very simple static page.',
  },
  {
    question: 'What is the difference between preview and publish?',
    answer: 'Preview is where you inspect and iterate safely. The live website should change only after you click Publish, so visitors do not see unfinished work.',
  },
  {
    question: 'Will my projects and conversations persist?',
    answer: 'Projects, messages, versions and usage should stay attached to your Coden account. If your session expires, Coden should ask you to reconnect instead of losing work.',
  },
  {
    question: 'How do credits and plans work?',
    answer: 'Credits are used for building and improving apps with AI. Paid plans add more included credits and higher limits. Cloud, storage and deployed AI usage can be tracked separately as live apps grow.',
  },
  {
    question: 'Can Coden connect auth, database or payments?',
    answer: 'Coden can plan and generate app structures for auth, database, storage and payments. Sensitive actions such as applying production migrations, connecting secrets or publishing should stay confirmed and server-safe.',
  },
  {
    question: 'How does Coden protect secrets?',
    answer: 'Provider keys, service-role keys and private tokens should never be exposed in generated frontend code. Server-side secrets stay in backend environments such as Railway, Supabase or secure deployment settings.',
  },
  {
    question: 'What are Coden Design, Decks and Media?',
    answer: 'They are beta creative workspaces for interface direction, pitch decks and marketing media. The main assistant stays the same, but the workspace context changes depending on what you want to create.',
  },
];

function injectSharedPublicStyles() {
  if (document.getElementById('coden-public-enhancements-style')) return;
  const style = document.createElement('style');
  style.id = 'coden-public-enhancements-style';
  style.textContent = `
    .coden-public-theme-toggle {
      width: 36px;
      height: 36px;
      display: inline-grid;
      place-items: center;
      border: 1px solid var(--border, var(--seo-border, rgba(20, 20, 20, 0.14)));
      border-radius: 8px;
      color: var(--text-muted, var(--seo-muted, #777166));
      background: transparent;
      cursor: pointer;
      font: inherit;
      transition: color 160ms ease, background 160ms ease, border-color 160ms ease, transform 160ms ease;
    }

    .coden-public-theme-toggle:hover {
      color: var(--text, var(--seo-text, #181613));
      background: color-mix(in srgb, var(--bg-surface, var(--seo-surface, #fffefa)) 92%, transparent);
      border-color: var(--border-focus, var(--seo-border, rgba(20, 20, 20, 0.24)));
      transform: translateY(-1px);
    }

    .coden-public-theme-toggle:focus-visible {
      outline: 0;
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent, #2563eb) 35%, transparent);
    }

    .back-home-link {
      position: fixed;
      left: 22px;
      top: 84px;
      z-index: 80;
      height: 38px;
      padding: 0 14px;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      border: 1px solid var(--border, var(--seo-border, rgba(20, 20, 20, 0.14)));
      border-radius: 999px;
      color: var(--text-muted, var(--seo-muted, #777166));
      background: color-mix(in srgb, var(--bg-surface, var(--seo-surface, #fffefa)) 86%, transparent);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      text-decoration: none;
      font-size: 13px;
      font-weight: 700;
      box-shadow: 0 12px 40px rgba(24, 22, 17, 0.08);
      transition: transform 160ms ease, color 160ms ease, border-color 160ms ease, background 160ms ease;
    }

    button.back-home-link {
      appearance: none;
      cursor: pointer;
      font-family: inherit;
    }

    .back-home-link:hover {
      color: var(--text, var(--seo-text, #181613));
      border-color: var(--border-focus, var(--seo-border, rgba(20, 20, 20, 0.24)));
      background: color-mix(in srgb, var(--bg-surface, var(--seo-surface, #fffefa)) 96%, transparent);
      transform: translateX(-2px);
    }

    .back-home-link:focus-visible,
    .coden-shared-faq button:focus-visible {
      outline: 2px solid color-mix(in srgb, var(--accent, #2563eb) 72%, white);
      outline-offset: 3px;
    }

    .coden-shared-faq {
      width: min(920px, calc(100vw - 40px));
      margin: 0 auto 72px;
      padding: clamp(28px, 5vw, 44px);
      border: 1px solid var(--border, var(--seo-border, rgba(20, 20, 20, 0.14)));
      border-radius: 28px;
      background:
        radial-gradient(circle at 92% 8%, color-mix(in srgb, var(--accent, #2563eb) 10%, transparent), transparent 32%),
        color-mix(in srgb, var(--bg-surface, var(--seo-surface, #fffefa)) 92%, transparent);
      box-shadow: var(--coden-shadow-card, 0 20px 70px rgba(24, 22, 17, 0.10));
    }

    .coden-shared-faq-header {
      max-width: 680px;
      margin-bottom: 22px;
    }

    .coden-shared-faq-kicker {
      display: inline-flex;
      margin-bottom: 12px;
      color: var(--text-muted, var(--seo-muted, #777166));
      font-size: 11px;
      font-weight: 820;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }

    .coden-shared-faq h2 {
      margin: 0;
      color: var(--text, var(--seo-text, #181613));
      font-size: clamp(2rem, 4vw, 3.4rem);
      line-height: 1;
      letter-spacing: 0;
    }

    .coden-shared-faq-list {
      display: grid;
      gap: 10px;
    }

    .coden-shared-faq-item {
      border: 1px solid var(--border, var(--seo-border, rgba(20, 20, 20, 0.14)));
      border-radius: 18px;
      background: color-mix(in srgb, var(--bg-elevated, var(--seo-panel, #f6f2e9)) 72%, transparent);
      overflow: hidden;
      transition: border-color 180ms ease, background 180ms ease, transform 180ms ease;
    }

    .coden-shared-faq-item:hover {
      transform: translateY(-1px);
      border-color: var(--border-focus, var(--seo-border, rgba(20, 20, 20, 0.24)));
      background: color-mix(in srgb, var(--bg-surface, var(--seo-surface, #fffefa)) 96%, transparent);
    }

    .coden-shared-faq-question {
      width: 100%;
      min-height: 58px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      border: 0;
      background: transparent;
      color: var(--text, var(--seo-text, #181613));
      padding: 0 18px;
      text-align: left;
      font: inherit;
      font-size: 15px;
      font-weight: 820;
      cursor: pointer;
    }

    .coden-shared-faq-icon {
      flex: 0 0 auto;
      transition: transform 180ms ease;
    }

    .coden-shared-faq-item.open .coden-shared-faq-icon {
      transform: rotate(45deg);
    }

    .coden-shared-faq-answer {
      display: none;
      padding: 0 18px 18px;
      color: var(--text-muted, var(--seo-muted, #777166));
      font-size: 14px;
      line-height: 1.68;
    }

    .coden-shared-faq-item.open .coden-shared-faq-answer {
      display: block;
    }

    @media (max-width: 640px) {
      .back-home-link {
        left: 16px;
        top: 76px;
      }

      .back-home-link span {
        display: none;
      }

      .coden-shared-faq {
        width: min(100% - 28px, 560px);
        margin-bottom: 54px;
        padding: 22px;
        border-radius: 22px;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .back-home-link,
      .coden-shared-faq-item,
      .coden-shared-faq-icon {
        transition: none;
      }
    }
  `;
  document.head.appendChild(style);
}

function isHomePath(pathname: string) {
  return pathname === '/' || pathname === '/index.html';
}

function shouldInstallBackButton() {
  const path = window.location.pathname;
  if (isHomePath(path)) return false;
  if (/\/(builder|dashboard)\.html$/.test(path)) return false;
  return true;
}

function getSafeBackTarget(fallback: string) {
  try {
    if (!document.referrer) return { mode: 'navigate' as const, href: fallback };
    const referrer = new URL(document.referrer);
    const current = new URL(window.location.href);
    const sameOrigin = referrer.origin === current.origin;
    const samePage = referrer.pathname === current.pathname;
    const unsafeAuthBounce = referrer.pathname === '/auth.html' && current.pathname !== '/auth.html';
    if (sameOrigin && !samePage && !unsafeAuthBounce && window.history.length > 1) {
      return { mode: 'history' as const, href: referrer.href };
    }
  } catch {
    // Fall through to safe fallback.
  }
  return { mode: 'navigate' as const, href: fallback };
}

export function installSmartBackNavigation(options: PublicEnhancementOptions = {}) {
  if (options.back === false || !shouldInstallBackButton() || document.querySelector('.back-home-link')) return;
  injectSharedPublicStyles();

  const fallback = options.backFallback || '/';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'back-home-link coden-smart-back';
  button.dataset.smartBackFallback = fallback;
  button.setAttribute('aria-label', 'Go back');
  button.innerHTML = `
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M19 12H5"></path>
      <path d="M12 19l-7-7 7-7"></path>
    </svg>
    <span>Back</span>
  `;

  button.addEventListener('click', () => {
    const target = getSafeBackTarget(button.dataset.smartBackFallback || fallback);
    if (target.mode === 'history') {
      window.history.back();
      return;
    }
    window.location.href = target.href;
  });

  const navbar = document.querySelector('.navbar, .seo-nav');
  if (navbar) {
    navbar.insertAdjacentElement('afterend', button);
    return;
  }
  document.body.prepend(button);
}

function bindEnhancedFaqRow(row: Element) {
  const trigger = row.querySelector<HTMLElement>('.faq-q, .faq-question, summary');
  if (!trigger || trigger.dataset.codenFaqBound === 'true') return;
  trigger.dataset.codenFaqBound = 'true';
  trigger.addEventListener('click', () => {
    if (trigger.tagName.toLowerCase() === 'summary') return;
    const item = trigger.closest('.faq-item');
    const section = trigger.closest('.faq-section');
    if (!item || !section) return;
    const open = !item.classList.contains('open') && !item.classList.contains('active');
    section.querySelectorAll('.faq-item').forEach(other => {
      other.classList.remove('open', 'active');
    });
    if (open) item.classList.add(trigger.classList.contains('faq-question') ? 'active' : 'open');
  });
}

function enhanceExistingFaq() {
  const existing = document.querySelector<HTMLElement>('.faq-section, .seo-faq');
  if (!existing || existing.dataset.codenFaqEnhanced === 'true') return false;
  existing.dataset.codenFaqEnhanced = 'true';

  const extraItems = SHARED_FAQ_ITEMS.slice(3, 8);
  if (existing.classList.contains('seo-faq')) {
    extraItems.forEach((item, index) => {
      const detail = document.createElement('details');
      if (index === 0 && !existing.querySelector('details[open]')) detail.open = true;
      detail.innerHTML = `<summary>${item.question}</summary><p>${item.answer}</p>`;
      existing.appendChild(detail);
    });
    return true;
  }

  const list = existing.querySelector<HTMLElement>('.faq-list') || existing;
  const pricingMarkup = Boolean(existing.querySelector('.faq-q'));
  extraItems.forEach(item => {
    const row = document.createElement('div');
    row.className = 'faq-item';
    row.innerHTML = pricingMarkup
      ? `
        <div class="faq-q">
          <span>${item.question}</span>
          <span class="plus-icon">+</span>
        </div>
        <div class="faq-a">${item.answer}</div>
      `
      : `
        <button class="faq-question" type="button">
          <span>${item.question}</span>
          <svg class="faq-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="6 9 12 15 18 9"></polyline></svg>
        </button>
        <div class="faq-answer">
          <p>${item.answer}</p>
        </div>
    `;
    list.appendChild(row);
    if (pricingMarkup) bindEnhancedFaqRow(row);
  });
  return true;
}

export function installSharedFaq(options: PublicEnhancementOptions = {}) {
  if (options.faq === false) return;
  if (enhanceExistingFaq()) return;
  if (document.querySelector('.coden-shared-faq')) return;
  const footer = document.querySelector('.footer, .seo-footer');
  if (!footer) return;
  injectSharedPublicStyles();

  const section = document.createElement('section');
  section.className = 'coden-shared-faq reveal';
  section.setAttribute('aria-labelledby', 'coden-shared-faq-title');
  section.innerHTML = `
    <div class="coden-shared-faq-header">
      <span class="coden-shared-faq-kicker">Questions before you build</span>
      <h2 id="coden-shared-faq-title">Useful answers, without the maze.</h2>
    </div>
    <div class="coden-shared-faq-list">
      ${SHARED_FAQ_ITEMS.map((item, index) => `
        <article class="coden-shared-faq-item${index === 0 ? ' open' : ''}">
          <button class="coden-shared-faq-question" type="button" aria-expanded="${index === 0 ? 'true' : 'false'}">
            <span>${item.question}</span>
            <svg class="coden-shared-faq-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
              <path d="M12 5v14"></path>
              <path d="M5 12h14"></path>
            </svg>
          </button>
          <div class="coden-shared-faq-answer">${item.answer}</div>
        </article>
      `).join('')}
    </div>
  `;

  footer.parentElement?.insertBefore(section, footer);

  section.querySelectorAll<HTMLButtonElement>('.coden-shared-faq-question').forEach(button => {
    button.addEventListener('click', () => {
      const item = button.closest('.coden-shared-faq-item');
      const open = !item?.classList.contains('open');
      section.querySelectorAll('.coden-shared-faq-item').forEach(row => {
        row.classList.remove('open');
        row.querySelector('button')?.setAttribute('aria-expanded', 'false');
      });
      if (item && open) {
        item.classList.add('open');
        button.setAttribute('aria-expanded', 'true');
      }
    });
  });
}

export function installPublicPageEnhancements(options: PublicEnhancementOptions = {}) {
  const navbar = document.querySelector('.seo-nav, .navbar');
  if (!document.querySelector('[data-theme-toggle], #theme-btn, #theme-btn-dashboard')) {
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'coden-public-theme-toggle';
    toggle.dataset.themeToggle = 'true';
    toggle.textContent = '☼';
    toggle.setAttribute('aria-label', 'Activer le thème clair');
    toggle.title = 'Activer le thème clair';
    if (navbar) {
      const actions = navbar.querySelector('.nav-actions, .seo-nav-actions') || navbar;
      actions.appendChild(toggle);
    } else {
      document.body.prepend(toggle);
    }
  }
  initThemeController();
  installSmartBackNavigation(options);
}
