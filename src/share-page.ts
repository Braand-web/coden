import { apiFetch } from './lib/api';
import { previewDocumentWithStorageShim } from './lib/preview-document';

/*
 * The page a shared link opens: the project's name, a short description and its saved preview — read-only, nothing to
 * sign in for — and one action, « Créer ma copie », which asks for an account only at that moment.
 */
type SharedView = { name: string; description: string; preview_html: string; files: number; shared_at: string | null };

/** The width the saved preview was drawn for. */
const DESKTOP_WIDTH = 1280;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;
const token = new URLSearchParams(window.location.search).get('t') || '';

function showError(message: string) {
  const error = $('share-error');
  if (error) { error.textContent = message; error.hidden = false; }
}

async function publicJson<T>(path: string): Promise<{ status: number; body: T | null }> {
  const response = await fetch(path, { headers: { Accept: 'application/json' }, cache: 'no-store', referrerPolicy: 'no-referrer' });
  return { status: response.status, body: await response.json().catch(() => null) };
}

async function load() {
  const title = $('share-title');
  document.querySelectorAll('.skeleton').forEach(node => node.remove());
  if (!token) { if (title) title.textContent = 'Lien incomplet'; showError('Ce lien est incomplet : copiez-le en entier.'); return; }
  try {
    const { status, body } = await publicJson<{ success: boolean; project?: SharedView; error?: string }>(`/api/share/${encodeURIComponent(token)}`);
    if (status !== 200 || !body?.project) {
      if (title) title.textContent = status === 404 ? 'Ce lien n’est plus actif' : 'Ouverture impossible';
      showError(body?.error || 'Ce lien ne peut pas être ouvert pour le moment.');
      return;
    }
    const view = body.project;
    document.title = `${view.name} | Coden`;
    if (title) title.textContent = view.name;
    if (view.description) {
      const description = document.createElement('p');
      description.className = 'description';
      description.textContent = view.description;
      title?.after(description);
    }
    const html = view.preview_html.trim();
    if (html) {
      const frame = $('share-frame');
      const iframe = document.createElement('iframe');
      iframe.title = `Aperçu de ${view.name}`;
      // Scripts run, but without the page's own origin: the framed app can reach nothing of Coden's.
      iframe.setAttribute('sandbox', 'allow-scripts');
      iframe.setAttribute('referrerpolicy', 'no-referrer');
      iframe.loading = 'lazy';
      iframe.tabIndex = -1;
      iframe.srcdoc = previewDocumentWithStorageShim(html);
      frame?.append(iframe);
      if (frame) {
        frame.hidden = false;
        // The app is laid out at a desktop width and scaled down to the card, so it reads as the page it is.
        const fit = () => {
          const scale = frame.clientWidth / DESKTOP_WIDTH;
          iframe.style.transform = `scale(${scale})`;
          iframe.style.height = `${frame.clientHeight / scale}px`;
        };
        fit();
        if (typeof ResizeObserver !== 'undefined') new ResizeObserver(fit).observe(frame);
        else window.addEventListener('resize', fit);
      }
    }
    const actions = $('share-actions');
    if (actions) actions.hidden = false;
  } catch {
    if (title) title.textContent = 'Ouverture impossible';
    showError('Ce lien ne peut pas être ouvert pour le moment. Vérifiez votre connexion.');
  }
}

$('share-copy')?.addEventListener('click', async event => {
  const button = event.currentTarget as HTMLButtonElement;
  button.disabled = true;
  button.textContent = 'Copie en cours…';
  $('share-error')?.setAttribute('hidden', '');
  try {
    // Without a session, apiFetch sends the person to sign in and back to this very page.
    const result = await apiFetch<{ builder_url?: string }>(`/api/share/${encodeURIComponent(token)}/copy`, { method: 'POST' });
    if (result.builder_url) window.location.href = result.builder_url;
  } catch (error) {
    showError(error instanceof Error && error.message ? error.message : 'La copie a échoué.');
    button.disabled = false;
    button.textContent = 'Créer ma copie';
  }
});

void load();
