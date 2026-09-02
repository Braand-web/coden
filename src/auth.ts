import './styles/coden-light-theme.css';
import './styles/coden-shell.css';
import { initThemeController } from './theme-controller';
import {
  getAuthRedirectUrl,
  getRedirectTarget,
  getVerifiedSession,
  safeRedirectTarget,
  supabase,
} from './lib/supabase-browser';
import { readPricingSelection } from './public-pricing-flow';
import { trackFunnelEvent } from './conversion-events';
import { initCodenMotion } from './coden-motion';
import { initCodenNavigationTransitions } from './navigation-transitions';
import './styles/modern-shell.css';
import './styles/coherence.css';
import './styles/auth-premium.css';

type AuthMode = 'login' | 'signup' | 'forgot-password' | 'reset-password';
type StatusTone = 'info' | 'error' | 'success';

const form = document.getElementById('auth-form') as HTMLFormElement | null;
const emailInput = document.getElementById('input-email') as HTMLInputElement | null;
const passwordInput = document.getElementById('input-password') as HTMLInputElement | null;
const confirmPasswordInput = document.getElementById('input-password-confirm') as HTMLInputElement | null;
const nameInput = document.getElementById('input-name') as HTMLInputElement | null;
const submitButton = document.getElementById('btn-submit') as HTMLButtonElement | null;
const passwordToggle = document.getElementById('toggle-password') as HTMLButtonElement | null;
const tabLogin = document.getElementById('tab-login') as HTMLButtonElement | null;
const tabSignup = document.getElementById('tab-signup') as HTMLButtonElement | null;
const authTabs = document.getElementById('auth-tabs') as HTMLElement | null;
const nameField = document.getElementById('name-field') as HTMLElement | null;
const emailField = document.getElementById('email-field') as HTMLElement | null;
const passwordField = document.getElementById('password-field') as HTMLElement | null;
const confirmPasswordField = document.getElementById('password-confirm-field') as HTMLElement | null;
const forgotPasswordLink = document.getElementById('forgot-password-link') as HTMLButtonElement | null;
const socialAuth = document.getElementById('social-auth') as HTMLElement | null;
const statusEl = document.getElementById('auth-status') as HTMLElement | null;
const modeTitle = document.getElementById('auth-title') as HTMLElement | null;
const modeSubtitle = document.getElementById('auth-subtitle') as HTMLElement | null;
const footerText = document.getElementById('auth-footer-text') as HTMLElement | null;
const authCard = document.querySelector<HTMLElement>('.auth-card');
const authBackLink = document.getElementById('auth-back-link') as HTMLAnchorElement | null;
const socialButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-provider]'));

initCodenMotion();
initCodenNavigationTransitions();
initThemeController();
document.body.classList.add('auth-premium-ready');

const searchParams = new URLSearchParams(window.location.search);
const requestedMode = searchParams.get('mode');
let mode: AuthMode = requestedMode === 'signup'
  ? 'signup'
  : requestedMode === 'forgot-password'
    ? 'forgot-password'
    : requestedMode === 'reset-password'
      ? 'reset-password'
      : 'login';
let redirecting = false;
const pricingSelection = readPricingSelection();

trackFunnelEvent('auth_viewed', {
  mode,
  plan: pricingSelection.plan,
  billing: pricingSelection.billing,
});

function setStatus(message: string, tone: StatusTone = 'info') {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.dataset.tone = tone;
}

function submitLabel() {
  if (mode === 'signup') return 'Créer mon compte';
  if (mode === 'forgot-password') return 'Envoyer le lien';
  if (mode === 'reset-password') return 'Mettre à jour le mot de passe';
  return 'Se connecter';
}

function busyLabel() {
  if (mode === 'signup') return 'Création du compte…';
  if (mode === 'forgot-password') return 'Envoi du lien…';
  if (mode === 'reset-password') return 'Mise à jour…';
  return 'Connexion…';
}

function setBusy(isBusy: boolean, label?: string) {
  if (submitButton) {
    submitButton.disabled = isBusy;
    submitButton.setAttribute('aria-busy', isBusy ? 'true' : 'false');
    submitButton.textContent = isBusy ? label || 'Patientez…' : submitLabel();
  }

  socialButtons.forEach((button) => {
    button.disabled = isBusy;
    button.setAttribute('aria-busy', isBusy ? 'true' : 'false');
  });
}

function setOAuthBusy(activeButton: HTMLButtonElement | null, isBusy: boolean) {
  socialButtons.forEach((button) => {
    button.disabled = isBusy;
    button.setAttribute('aria-busy', isBusy ? 'true' : 'false');
    const label = button.querySelector<HTMLElement>('[data-oauth-label]');
    if (label) {
      label.textContent = isBusy && button === activeButton ? 'Ouverture de Google…' : 'Continuer avec Google';
      return;
    }
  });
}

function setMode(nextMode: AuthMode) {
  authCard?.classList.add('is-mode-switching');
  mode = nextMode;
  document.documentElement.dataset.authMode = mode;

  const isAccountMode = mode === 'login' || mode === 'signup';
  const isForgotMode = mode === 'forgot-password';
  const isResetMode = mode === 'reset-password';

  if (authTabs) authTabs.hidden = !isAccountMode;
  if (socialAuth) socialAuth.hidden = !isAccountMode;
  if (forgotPasswordLink) forgotPasswordLink.hidden = mode !== 'login';
  if (nameField) nameField.hidden = mode !== 'signup';
  if (emailField) emailField.hidden = isResetMode;
  if (passwordField) passwordField.hidden = isForgotMode;
  if (confirmPasswordField) confirmPasswordField.hidden = !isResetMode;

  if (nameInput) nameInput.required = mode === 'signup';
  if (emailInput) {
    emailInput.required = !isResetMode;
    emailInput.autocomplete = isResetMode ? 'off' : 'email';
  }
  if (passwordInput) {
    passwordInput.required = !isForgotMode;
    passwordInput.autocomplete = mode === 'signup' || isResetMode ? 'new-password' : 'current-password';
  }
  if (confirmPasswordInput) confirmPasswordInput.required = isResetMode;

  tabLogin?.classList.toggle('active', mode === 'login');
  tabSignup?.classList.toggle('active', mode === 'signup');
  tabLogin?.setAttribute('aria-selected', mode === 'login' ? 'true' : 'false');
  tabSignup?.setAttribute('aria-selected', mode === 'signup' ? 'true' : 'false');
  tabLogin?.setAttribute('tabindex', mode === 'login' ? '0' : '-1');
  tabSignup?.setAttribute('tabindex', mode === 'signup' ? '0' : '-1');

  if (modeTitle) {
    modeTitle.textContent = mode === 'signup'
      ? 'Créer votre compte'
      : mode === 'forgot-password'
        ? 'Mot de passe oublié'
        : mode === 'reset-password'
          ? 'Nouveau mot de passe'
          : 'Bienvenue';
  }
  if (modeSubtitle) {
    modeSubtitle.textContent = mode === 'signup'
      ? 'Un espace simple pour construire et publier vos projets.'
      : mode === 'forgot-password'
        ? 'Saisissez votre adresse e-mail pour recevoir un lien sécurisé.'
        : mode === 'reset-password'
          ? 'Choisissez un mot de passe sécurisé.'
          : 'Retrouvez vos projets, prévisualisez vos changements et publiez sereinement.';
  }
  if (footerText) {
    footerText.innerHTML = mode === 'signup'
      ? 'Vous avez déjà un compte&nbsp;? <button type="button" data-auth-switch="login">Se connecter</button>'
      : mode === 'forgot-password' || mode === 'reset-password'
        ? '<button type="button" data-auth-switch="login">Retour à la connexion</button>'
        : 'Nouveau sur Coden&nbsp;? <button type="button" data-auth-switch="signup">Créer un compte</button>';
  }

  setStatus('');
  setBusy(false);
  window.setTimeout(() => authCard?.classList.remove('is-mode-switching'), 220);
}

function setupBackLink() {
  if (!authBackLink) return;

  const redirect = searchParams.get('redirect');
  let referrerTarget = '';
  try {
    const referrer = new URL(document.referrer);
    if (referrer.origin === window.location.origin && referrer.pathname !== window.location.pathname) {
      referrerTarget = safeRedirectTarget(`${referrer.pathname}${referrer.search}${referrer.hash}`);
    }
  } catch {
    // A missing or external referrer does not create a visible back action.
  }

  const target = redirect ? safeRedirectTarget(redirect) : referrerTarget;
  if (!target || target === window.location.pathname) return;
  authBackLink.href = target;
  authBackLink.hidden = false;
}

function redirectToApp() {
  if (redirecting) return;
  redirecting = true;
  setStatus('Ouverture de votre espace…', 'success');
  window.location.href = safeRedirectTarget(getRedirectTarget());
}

function getPasswordResetRedirectUrl() {
  const redirect = encodeURIComponent(safeRedirectTarget(getRedirectTarget()));
  return `${window.location.origin}/auth.html?mode=reset-password&redirect=${redirect}`;
}

function getReturnedAuthError(): string | null {
  const search = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  return (
    search.get('error_description') ||
    hash.get('error_description') ||
    search.get('error') ||
    hash.get('error')
  );
}

function friendlyAuthError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || '');
  if (/invalid login credentials/i.test(message)) return 'L’e-mail ou le mot de passe est incorrect.';
  if (/email not confirmed/i.test(message)) return 'Confirmez votre e-mail avant de vous connecter.';
  if (/password/i.test(message) && /six|6|weak|short/i.test(message)) {
    return 'Utilisez un mot de passe plus robuste d’au moins 6 caractères.';
  }
  if (/same|match|identical/i.test(message)) return 'Les deux mots de passe doivent être identiques.';
  if (/expired|invalid.*link|otp/i.test(message)) return 'Ce lien est expiré ou invalide. Demandez un nouveau lien.';
  if (/fetch|network|failed/i.test(message)) return 'Un problème réseau est survenu. Vérifiez votre connexion puis réessayez.';
  return message || 'La connexion a échoué. Réessayez.';
}

async function handleEmailAuth(event: Event) {
  event.preventDefault();
  const email = emailInput?.value.trim().toLowerCase() || '';
  const password = passwordInput?.value || '';
  const confirmPassword = confirmPasswordInput?.value || '';
  const fullName = nameInput?.value.trim() || '';

  if (!email && mode !== 'reset-password') {
    setStatus('Saisissez votre adresse e-mail pour continuer.', 'error');
    emailInput?.focus();
    return;
  }

  if (mode === 'forgot-password') {
    setBusy(true, busyLabel());
    setStatus('Préparation du lien sécurisé…', 'info');
    trackFunnelEvent('auth_started', { mode, plan: pricingSelection.plan, billing: pricingSelection.billing });
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: getPasswordResetRedirectUrl(),
      });
      if (error) throw error;
      trackFunnelEvent('password_reset_requested', { plan: pricingSelection.plan, billing: pricingSelection.billing });
      setStatus('Si un compte correspond à cette adresse, un lien de réinitialisation vient d’être envoyé.', 'success');
    } catch (error) {
      setStatus(friendlyAuthError(error), 'error');
    } finally {
      setBusy(false);
    }
    return;
  }

  if (mode === 'reset-password') {
    if (!password || password.length < 6) {
      setStatus('Utilisez au moins 6 caractères pour votre nouveau mot de passe.', 'error');
      passwordInput?.focus();
      return;
    }
    if (password !== confirmPassword) {
      setStatus('Les deux mots de passe doivent être identiques.', 'error');
      confirmPasswordInput?.focus();
      return;
    }

    setBusy(true, busyLabel());
    setStatus('Mise à jour de votre mot de passe…', 'info');
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      trackFunnelEvent('password_reset_completed', { plan: pricingSelection.plan, billing: pricingSelection.billing });
      try { await supabase.auth.signOut({ scope: 'local' }); } catch { /* Keep the confirmation visible if local cleanup fails. */ }
      if (passwordInput) passwordInput.value = '';
      if (confirmPasswordInput) confirmPasswordInput.value = '';
      setMode('login');
      setStatus('Votre mot de passe a été mis à jour. Vous pouvez maintenant vous connecter.', 'success');
    } catch (error) {
      setStatus(friendlyAuthError(error), 'error');
    } finally {
      setBusy(false);
    }
    return;
  }

  if (!password) {
    setStatus('Saisissez votre mot de passe pour continuer.', 'error');
    passwordInput?.focus();
    return;
  }
  if (mode === 'signup' && password.length < 6) {
    setStatus('Utilisez au moins 6 caractères pour votre mot de passe.', 'error');
    passwordInput?.focus();
    return;
  }

  setBusy(true, busyLabel());
  setStatus(mode === 'signup' ? 'Création de votre compte…' : 'Connexion à votre espace…', 'info');
  trackFunnelEvent('auth_started', { mode, plan: pricingSelection.plan, billing: pricingSelection.billing });

  try {
    if (mode === 'signup') {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName },
          emailRedirectTo: getAuthRedirectUrl(),
        },
      });
      if (error) throw error;
      if (data.session) {
        trackFunnelEvent('auth_completed', { mode, plan: pricingSelection.plan, billing: pricingSelection.billing });
        redirectToApp();
        return;
      }
      trackFunnelEvent('auth_completed', { mode, plan: pricingSelection.plan, billing: pricingSelection.billing });
      setStatus('Compte créé. Vérifiez votre e-mail pour le confirmer.', 'success');
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    trackFunnelEvent('auth_completed', { mode, plan: pricingSelection.plan, billing: pricingSelection.billing });
    redirectToApp();
  } catch (error) {
    setStatus(friendlyAuthError(error), 'error');
  } finally {
    setBusy(false);
  }
}

async function handleOAuth(button: HTMLButtonElement) {
  setOAuthBusy(button, true);
  setStatus('Ouverture de la connexion Google…', 'info');
  trackFunnelEvent('auth_started', { mode, provider: 'google', plan: pricingSelection.plan, billing: pricingSelection.billing });
  try {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: getAuthRedirectUrl(),
        queryParams: { prompt: 'select_account' },
      },
    });
    if (error) throw error;
  } catch (error) {
    setOAuthBusy(button, false);
    setStatus(friendlyAuthError(error), 'error');
  }
}

function setPasswordVisibility(visible: boolean) {
  if (!passwordInput || !passwordToggle) return;
  passwordInput.type = visible ? 'text' : 'password';
  passwordToggle.textContent = visible ? 'Masquer' : 'Afficher';
  passwordToggle.setAttribute('aria-label', visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe');
  passwordToggle.setAttribute('aria-pressed', visible ? 'true' : 'false');
}

form?.addEventListener('submit', handleEmailAuth);

tabLogin?.addEventListener('click', () => setMode('login'));
tabSignup?.addEventListener('click', () => setMode('signup'));

passwordToggle?.addEventListener('click', () => {
  setPasswordVisibility(passwordInput?.type !== 'text');
});

document.addEventListener('click', (event) => {
  const target = (event.target as Element | null)?.closest('[data-auth-switch]') as HTMLElement | null;
  if (!target) return;
  event.preventDefault();
  const requested = target.dataset.authSwitch;
  setMode(requested === 'signup' || requested === 'forgot-password' || requested === 'reset-password' ? requested : 'login');
});

socialButtons.forEach((button) => {
  button.addEventListener('click', (event) => {
    event.preventDefault();
    if (button.dataset.provider === 'google') void handleOAuth(button);
  });
});

setupBackLink();
setMode(mode);

const returnedAuthError = getReturnedAuthError();
if (returnedAuthError) {
  setStatus(`La connexion Google n’a pas abouti : ${returnedAuthError}`, 'error');
}

supabase.auth.onAuthStateChange((event, session) => {
  if (mode === 'reset-password') return;
  if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session?.access_token) {
    void getVerifiedSession({ allowRefresh: false }).then((verified) => {
      if (verified) redirectToApp();
    });
  }
});

void getVerifiedSession({ allowRefresh: true }).then((verified) => {
  if (mode === 'reset-password') {
    if (!verified) setStatus('Ce lien de réinitialisation est expiré ou invalide. Demandez un nouveau lien.', 'error');
    return;
  }
  if (verified) redirectToApp();
});
