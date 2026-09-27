export const META_PIXEL_ID = '1741271457133464';
export const META_PIXEL_CONSENT_KEY = 'coden-meta-marketing-consent-v1';
const META_PIXEL_PUBLIC_PATHS = new Set([
  '/', '/index.html', '/pricing.html', '/features.html', '/documentation.html',
  '/security.html', '/privacy.html', '/terms.html',
]);

type ConsentChoice = 'accepted' | 'rejected';
type PixelFunction = ((...args: unknown[]) => void) & {
  callMethod?: (...args: unknown[]) => void;
  queue?: unknown[][];
  push?: PixelFunction;
  loaded?: boolean;
  version?: string;
};
type PixelWindow = Window & { fbq?: PixelFunction; _fbq?: PixelFunction };

let consentUiBound = false;

function readConsent(): ConsentChoice | null {
  try {
    const value = window.localStorage.getItem(META_PIXEL_CONSENT_KEY);
    return value === 'accepted' || value === 'rejected' ? value : null;
  } catch {
    return null;
  }
}

function saveConsent(choice: ConsentChoice) {
  try {
    window.localStorage.setItem(META_PIXEL_CONSENT_KEY, choice);
  } catch {
    // Without a durable choice, this page must not start advertising measurement.
  }
}

export function metaPixelEventForCodenEvent(eventName: unknown): 'PageView' | 'Lead' | null {
  if (eventName === 'public_page_view' || eventName === 'landing_view') return 'PageView';
  if (eventName === 'start_building_click' || eventName === 'pricing_start_free' || eventName === 'pricing_choose_plan') return 'Lead';
  return null;
}

export function isMetaPixelPublicPath(pathname: string): boolean {
  return META_PIXEL_PUBLIC_PATHS.has(pathname);
}

function pixelWindow() {
  return window as PixelWindow;
}

function makePixelQueue(): PixelFunction {
  const win = pixelWindow();
  if (win.fbq) return win.fbq;
  const fbq = function (...args: unknown[]) {
    if (fbq.callMethod) fbq.callMethod(...args);
    else (fbq.queue ||= []).push(args);
  } as PixelFunction;
  fbq.push = fbq;
  fbq.loaded = true;
  fbq.version = '2.0';
  fbq.queue = [];
  win.fbq = fbq;
  win._fbq = fbq;
  return fbq;
}

function loadMetaPixel() {
  if (readConsent() !== 'accepted' || typeof document === 'undefined') return null;
  const win = pixelWindow();
  const fbq = makePixelQueue();
  const scriptExists = Boolean(document.querySelector('script[data-coden-meta-pixel]'));
  if (!scriptExists) {
    // Do not let the Pixel automatically inspect account forms for matching data.
    fbq('set', 'autoConfig', false, META_PIXEL_ID);
    fbq('init', META_PIXEL_ID);
    const script = document.createElement('script');
    script.async = true;
    script.dataset.codenMetaPixel = 'true';
    script.src = 'https://connect.facebook.net/fr_FR/fbevents.js';
    const firstScript = document.getElementsByTagName('script')[0];
    if (firstScript?.parentNode) firstScript.parentNode.insertBefore(script, firstScript);
    else document.head.appendChild(script);
  }
  return win.fbq || fbq;
}

function clearMetaPixelCookies() {
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  for (const name of ['_fbp', '_fbc']) {
    document.cookie = `${name}=; Max-Age=0; path=/; SameSite=Lax${secure}`;
    if (location.hostname === 'coden.fun' || location.hostname.endsWith('.coden.fun')) {
      document.cookie = `${name}=; Max-Age=0; path=/; domain=coden.fun; SameSite=Lax${secure}`;
    }
  }
}

function recordChoice(choice: ConsentChoice) {
  const previousChoice = readConsent();
  saveConsent(choice);
  const banner = document.getElementById('coden-meta-consent');
  if (banner) banner.hidden = true;

  if (choice === 'accepted') {
    const fbq = loadMetaPixel();
    if (!fbq) return;
    fbq('consent', 'grant');
    // A visit made before consent is not retroactively measured. Start at the
    // moment the visitor opts in, and never attach Coden metadata or form data.
    if (previousChoice !== 'accepted') fbq('track', 'PageView');
  } else {
    pixelWindow().fbq?.('consent', 'revoke');
    clearMetaPixelCookies();
  }
}

function makeButton(label: string, action: () => void, className: string) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  button.addEventListener('click', action);
  return button;
}

function mountConsentBanner() {
  if (document.getElementById('coden-meta-consent')) return;
  const banner = document.createElement('section');
  banner.id = 'coden-meta-consent';
  banner.className = 'coden-meta-consent';
  banner.hidden = readConsent() !== null;
  banner.setAttribute('aria-labelledby', 'coden-meta-consent-title');
  banner.setAttribute('aria-describedby', 'coden-meta-consent-description');
  banner.setAttribute('role', 'region');

  const copy = document.createElement('div');
  copy.className = 'coden-meta-consent-copy';
  const title = document.createElement('h2');
  title.id = 'coden-meta-consent-title';
  title.textContent = 'Mesure publicitaire';
  const description = document.createElement('p');
  description.id = 'coden-meta-consent-description';
  description.append(
    'Avec votre accord, Meta Pixel mesure les pages publiques et les clics vers la création de compte. Meta reçoit des informations de navigation et de navigateur ; Coden ne transmet pas vos prompts ni le contenu de vos projets. ',
  );
  const privacyLink = document.createElement('a');
  privacyLink.href = '/privacy.html#meta-pixel';
  privacyLink.textContent = 'En savoir plus';
  description.appendChild(privacyLink);
  copy.append(title, description);

  const actions = document.createElement('div');
  actions.className = 'coden-meta-consent-actions';
  actions.append(
    makeButton('Refuser', () => recordChoice('rejected'), 'coden-meta-consent-button'),
    makeButton('Accepter', () => recordChoice('accepted'), 'coden-meta-consent-button coden-meta-consent-accept'),
  );
  banner.append(copy, actions);
  document.body.appendChild(banner);
}

export function initMetaPixelConsentUi() {
  if (typeof window === 'undefined' || typeof document === 'undefined' || !isMetaPixelPublicPath(window.location.pathname)) return;
  // Keep preferences available on demand without interrupting the first visit.
  // Without an existing opt-in, advertising measurement remains off.
  if (readConsent() === 'accepted') loadMetaPixel()?.('consent', 'grant');

  if (consentUiBound) return;
  consentUiBound = true;
  document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-coden-open-consent]') : null;
    if (!target) return;
    event.preventDefault();
    mountConsentBanner();
    const banner = document.getElementById('coden-meta-consent');
    if (banner) {
      banner.hidden = false;
      banner.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
    }
  });
}

if (typeof window !== 'undefined') {
  window.addEventListener('coden:conversion', event => {
    if (readConsent() !== 'accepted' || !isMetaPixelPublicPath(window.location.pathname)) return;
    const detail = (event as CustomEvent<{ event_name?: unknown }>).detail;
    const pixelEvent = metaPixelEventForCodenEvent(detail?.event_name);
    if (!pixelEvent) return;
    loadMetaPixel()?.('track', pixelEvent);
  });
}
