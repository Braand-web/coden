import { getCurrentPrivatePath, getVerifiedSession, signOutCurrentDevice } from './lib/supabase-browser';
import { getLocalPreviewAuth, installLocalPreviewSurface, isLocalPreviewEnabled } from './local-preview';

function redirectToAuth() {
  const redirect = encodeURIComponent(getCurrentPrivatePath());
  window.location.href = `/auth.html?redirect=${redirect}`;
}

async function restoreSessionBeforeRedirect() {
  const retryDelays = [180, 480];
  let verified = await getVerifiedSession({ allowRefresh: true });
  if (verified) return verified;

  for (const delay of retryDelays) {
    await new Promise((resolve) => window.setTimeout(resolve, delay));
    verified = await getVerifiedSession({ allowRefresh: true });
    if (verified) return verified;
  }

  return null;
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
  const verified = await restoreSessionBeforeRedirect();
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
