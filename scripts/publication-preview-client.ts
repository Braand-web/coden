import '../src/styles/coden-light-theme.css';
import '../src/styles/coden-horizon-system.css';
import { mountPublishPanelV2, type PublishPanelV2Controller } from '../src/components/publish-panel-v2.ts';
import './publication-preview.css';
const projectId = '10000000-0000-4000-8000-000000000001';
const account = document.querySelector<HTMLSelectElement>('#account')!;
let panel: PublishPanelV2Controller | null = null;
async function request(path: string, options: RequestInit = {}) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', 'x-preview-account': account.value, ...options.headers } });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || 'La demande locale a échoué.'), { status: response.status });
  return data;
}
document.querySelector('#publish')!.addEventListener('click', () => {
  panel?.destroy();
  panel = mountPublishPanelV2({ container: document.body, projectId, request, onClose: () => { panel = null; }, onStatus: status => { document.querySelector('#publish')!.textContent = status.active_job && ['pending', 'processing'].includes(status.active_job.status) ? 'Publication en cours' : status.effective && status.has_unpublished_changes ? 'Publier les modifications' : 'Publier'; } });
});
document.querySelector('#theme')!.addEventListener('click', () => { document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; });
document.querySelector('#change')!.addEventListener('click', async () => {
  try { await request('/preview/change', { method: 'POST' }); document.querySelector<HTMLIFrameElement>('iframe')!.src = `/demo?v=${Date.now()}`; document.querySelector('#notice')!.textContent = 'Modification locale enregistrée, pas encore publiée.'; await panel?.refresh(); }
  catch (error: any) { document.querySelector('#notice')!.textContent = error.message; }
});
account.addEventListener('change', () => void panel?.refresh());
