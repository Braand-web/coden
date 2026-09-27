// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import {
  initMetaPixelConsentUi,
  META_PIXEL_CONSENT_KEY,
  META_PIXEL_ID,
  isMetaPixelPublicPath,
  metaPixelEventForCodenEvent,
} from './meta-pixel-consent';

function resetBrowserState() {
  document.body.innerHTML = '<button type="button" data-coden-open-consent>Préférences cookies</button><script></script>';
  document.querySelector('[data-coden-meta-pixel]')?.remove();
  localStorage.clear();
  delete (window as Window & { fbq?: unknown }).fbq;
  delete (window as Window & { _fbq?: unknown })._fbq;
}

afterEach(resetBrowserState);

describe('Coden Meta Pixel consent', () => {
  it('does not load the third-party script before an explicit choice', () => {
    resetBrowserState();
    initMetaPixelConsentUi();
    expect(document.getElementById('coden-meta-consent')).toBeNull();
    expect(document.querySelector('script[data-coden-meta-pixel]')).toBeNull();
    expect(localStorage.getItem(META_PIXEL_CONSENT_KEY)).toBeNull();
  });

  it('keeps an earlier opt-in active without showing preferences automatically', () => {
    resetBrowserState();
    localStorage.setItem(META_PIXEL_CONSENT_KEY, 'accepted');
    initMetaPixelConsentUi();
    expect(document.getElementById('coden-meta-consent')).toBeNull();
    expect(document.querySelector('script[data-coden-meta-pixel]')).not.toBeNull();
  });

  it('keeps tracking disabled after refusal and lets the visitor reopen preferences', () => {
    resetBrowserState();
    initMetaPixelConsentUi();
    document.querySelector<HTMLButtonElement>('[data-coden-open-consent]')?.click();
    document.querySelector<HTMLButtonElement>('.coden-meta-consent-button')?.click();
    expect(localStorage.getItem(META_PIXEL_CONSENT_KEY)).toBe('rejected');
    expect(document.querySelector('script[data-coden-meta-pixel]')).toBeNull();

    document.querySelector<HTMLButtonElement>('[data-coden-open-consent]')?.click();
    expect(document.getElementById('coden-meta-consent')?.hidden).toBe(false);
  });

  it('revokes an earlier choice and stops sending events after withdrawal', () => {
    resetBrowserState();
    initMetaPixelConsentUi();
    document.querySelector<HTMLButtonElement>('[data-coden-open-consent]')?.click();
    document.querySelectorAll<HTMLButtonElement>('.coden-meta-consent-button')[1]?.click();
    document.querySelector<HTMLButtonElement>('[data-coden-open-consent]')?.click();
    document.querySelector<HTMLButtonElement>('.coden-meta-consent-button')?.click();
    const before = (window as Window & { fbq?: { queue?: unknown[][] } }).fbq?.queue || [];
    const countBefore = before.length;

    window.dispatchEvent(new CustomEvent('coden:conversion', { detail: { event_name: 'public_page_view' } }));
    const queue = (window as Window & { fbq?: { queue?: unknown[][] } }).fbq?.queue || [];
    expect(localStorage.getItem(META_PIXEL_CONSENT_KEY)).toBe('rejected');
    expect(queue).toContainEqual(['consent', 'revoke']);
    expect(queue.slice(countBefore)).toEqual([]);
  });

  it('loads the configured pixel only after acceptance and starts with one page view', () => {
    resetBrowserState();
    initMetaPixelConsentUi();
    document.querySelector<HTMLButtonElement>('[data-coden-open-consent]')?.click();
    document.querySelectorAll<HTMLButtonElement>('.coden-meta-consent-button')[1]?.click();

    expect(localStorage.getItem(META_PIXEL_CONSENT_KEY)).toBe('accepted');
    expect(document.querySelector<HTMLScriptElement>('script[data-coden-meta-pixel]')?.src)
      .toBe('https://connect.facebook.net/fr_FR/fbevents.js');
    const queue = (window as Window & { fbq?: { queue?: unknown[][] } }).fbq?.queue || [];
    expect(queue).toContainEqual(['set', 'autoConfig', false, META_PIXEL_ID]);
    expect(queue).toContainEqual(['init', META_PIXEL_ID]);
    expect(queue).toContainEqual(['track', 'PageView']);
  });

  it('forwards only the whitelisted event name and not Coden conversion metadata', () => {
    resetBrowserState();
    initMetaPixelConsentUi();
    document.querySelector<HTMLButtonElement>('[data-coden-open-consent]')?.click();
    document.querySelectorAll<HTMLButtonElement>('.coden-meta-consent-button')[1]?.click();
    window.dispatchEvent(new CustomEvent('coden:conversion', {
      detail: { event_name: 'start_building_click', metadata: { email: 'private@example.com', prompt: 'private project idea' } },
    }));

    const queue = (window as Window & { fbq?: { queue?: unknown[][] } }).fbq?.queue || [];
    expect(queue).toContainEqual(['track', 'Lead']);
    expect(JSON.stringify(queue)).not.toContain('private@example.com');
    expect(JSON.stringify(queue)).not.toContain('private project idea');
  });

  it('maps only public views and explicit signup-intent clicks, never arbitrary metadata', () => {
    expect(metaPixelEventForCodenEvent('public_page_view')).toBe('PageView');
    expect(metaPixelEventForCodenEvent('pricing_choose_plan')).toBe('Lead');
    expect(metaPixelEventForCodenEvent('auth_completed')).toBeNull();
    expect(metaPixelEventForCodenEvent('project_prompt_submitted')).toBeNull();
    expect(isMetaPixelPublicPath('/pricing.html')).toBe(true);
    expect(isMetaPixelPublicPath('/builder.html')).toBe(false);
    expect(isMetaPixelPublicPath('/dashboard.html')).toBe(false);
    expect(isMetaPixelPublicPath('/auth.html')).toBe(false);
  });
});
