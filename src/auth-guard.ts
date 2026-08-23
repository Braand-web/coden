import { getCurrentPrivatePath, getVerifiedSession, signOutCurrentDevice } from './lib/supabase-browser';
import { getLocalPreviewAuth, installLocalPreviewSurface, isLocalPreviewEnabled } from './local-preview';

function redirectToAuth() {
  const redirect = encodeURIComponent(getCurrentPrivatePath());
  window.location.href = `/auth.html?redirect=${redirect}`;
}

async function guardPage() {
  document.documentElement.dataset.authReady = 'checking';
  if (isLocalPreviewEnabled()) {
    const previewAuth = getLocalPreviewAuth();
    document.documentElement.dataset.authReady = 'true';
    (window as any).codenAuthReady = previewAuth;
    installLocalPreviewSurface(document.body?.dataset.codenSurface || 'private');
    window.dispatchEvent(new CustomEvent('coden:auth-ready', { detail: previewAuth }));
    return;
  }
  const verified = await getVerifiedSession({ allowRefresh: true });
  if (!verified?.user?.id || !verified.session?.access_token) {
    document.documentElement.dataset.authReady = 'false';
    redirectToAuth();
    return;
  }

  document.documentElement.dataset.authReady = 'true';
  (window as any).codenAuthReady = verified;
  window.dispatchEvent(new CustomEvent('coden:auth-ready', { detail: verified }));
}

document.addEventListener('click', (event) => {
  const logoutButton = (event.target as Element | null)?.closest('[data-auth-logout]');
  if (!logoutButton) return;
  event.preventDefault();
  if (isLocalPreviewEnabled()) {
    window.location.href = '/auth.html';
    return;
  }
  void signOutCurrentDevice().then(() => {
    window.location.href = '/auth.html';
  });
});

void guardPage();
