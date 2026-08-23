export type ConversionMetadata = Record<string, unknown>;

const STORAGE_KEY = 'coden-landing-conversion-events';
const SESSION_KEY = 'coden-landing-conversion-session';

function sessionId() {
  try {
    let value = sessionStorage.getItem(SESSION_KEY);
    if (!value) {
      value = `funnel_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      sessionStorage.setItem(SESSION_KEY, value);
    }
    return value;
  } catch {
    return `funnel_${Date.now().toString(36)}`;
  }
}

function cleanMetadata(metadata: ConversionMetadata) {
  return Object.fromEntries(
    Object.entries(metadata)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([key, value]) => [key, String(value).slice(0, 160)]),
  );
}

/** Best-effort first-party funnel tracking. It never blocks navigation or checkout. */
export function trackFunnelEvent(eventName: string, metadata: ConversionMetadata = {}) {
  const safeName = String(eventName || '').trim().slice(0, 80);
  if (!safeName || typeof window === 'undefined') return;

  const payload = {
    id: `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    event_name: safeName,
    session_id: sessionId(),
    page_path: window.location.pathname || '/',
    device: window.matchMedia?.('(max-width: 767px)').matches ? 'mobile' : 'desktop',
    metadata: cleanMetadata(metadata),
    occurred_at: new Date().toISOString(),
  };

  try {
    const previous = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    const events = Array.isArray(previous) ? previous.slice(-79) : [];
    events.push(payload);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
  } catch {
    // Local analytics must never block the product.
  }

  try {
    (window as any).dataLayer = (window as any).dataLayer || [];
    (window as any).dataLayer.push({ event: safeName, coden_conversion: payload });
    window.dispatchEvent(new CustomEvent('coden:conversion', { detail: payload }));
  } catch {
    // Optional analytics bridge.
  }

  try {
    const body = JSON.stringify(payload);
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/landing/conversion', new Blob([body], { type: 'application/json' }));
    } else {
      void fetch('/api/landing/conversion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => undefined);
    }
  } catch {
    // Backend collection is best-effort.
  }
}

// Expose the same tracker to the small inline controllers used by the legacy
// builder/dashboard HTML shells. Keeping one bridge avoids separate analytics
// implementations for the in-app upgrade surfaces.
if (typeof window !== 'undefined') {
  (window as any).codenTrackFunnelEvent = trackFunnelEvent;
}
