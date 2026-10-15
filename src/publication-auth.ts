import './styles/coden-light-theme.css';
import './styles/coden-horizon-system.css';
import './styles/publication-auth.css';
import { initThemeController } from './theme-controller';
import { apiFetch } from './lib/api';

initThemeController();
const params = new URLSearchParams(location.search);
const status = document.getElementById('publication-login-status')!;
const retry = document.getElementById('publication-login-retry') as HTMLButtonElement;
const account = document.getElementById('publication-login-account') as HTMLAnchorElement;
account.href = `/auth.html?redirect=${encodeURIComponent(location.pathname + location.search)}`;
async function connect() {
  retry.hidden = true; account.hidden = true;
  status.textContent = 'Vérification de votre compte Coden…';
  try {
    const host = params.get('host') || '';
    const response = await apiFetch<{ success: boolean; url: string }>('/api/publication-access/handoff', { method: 'POST', body: JSON.stringify({ project_id: params.get('project_id'), host, return_path: params.get('return_path') || '/' }) });
    const target = new URL(response.url);
    if (!response.success || target.protocol !== 'https:' || target.hostname !== host || target.pathname !== '/_coden/publication/exchange') throw new Error('INVALID_HANDOFF');
    location.replace(target.href);
  } catch {
    status.textContent = 'Ce site n’est pas accessible avec ce compte, ou la connexion a expiré. Vérifiez l’adresse invitée puis réessayez.';
    retry.hidden = false; account.hidden = false;
  }
}
retry.addEventListener('click', () => void connect());
void connect();
