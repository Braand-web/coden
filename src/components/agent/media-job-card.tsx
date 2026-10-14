import { useEffect, useState } from 'react';
import type { PublicMediaJob } from '../../lib/media-job';
import { apiFetch } from '../../lib/api';

const terminal = new Set(['ready', 'failed', 'declined', 'unknown']);
export function MediaJobCard({ initial }: { initial: PublicMediaJob }) {
  const [job, setJob] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState('');
  useEffect(() => { setJob(initial); }, [initial]);
  useEffect(() => {
    if (terminal.has(job.state)) return;
    let alive = true;
    const timer = setInterval(() => {
      void apiFetch<{ jobs: PublicMediaJob[] }>('/api/projects/' + encodeURIComponent(job.projectId) + '/media/jobs')
        .then(result => { const fresh = result.jobs.find(item => item.id === job.id); if (alive && fresh) { setJob(fresh); setHint(''); } })
        .catch(() => { if (alive) setHint('Le suivi reprendra automatiquement. Votre projet est conservé.'); });
    }, 5000);
    return () => { alive = false; clearInterval(timer); };
  }, [job.id, job.projectId, job.state]);
  async function decide(accept: boolean) {
    if (busy) return;
    setBusy(true); setHint('');
    try {
      const result = await apiFetch<{ job: PublicMediaJob }>('/api/projects/' + encodeURIComponent(job.projectId) + '/media/jobs/' + encodeURIComponent(job.id) + '/decision',
        { method: 'POST', body: JSON.stringify({ accept }) });
      setJob(result.job);
    } catch { setHint('La décision n’a pas été enregistrée. Vous pouvez réessayer sans lancer une autre génération.'); }
    finally { setBusy(false); }
  }
  const title = job.kind === 'image' ? 'Génération d’image' : 'Génération de vidéo';
  const status = job.state === 'awaiting_approval' ? 'Votre accord est nécessaire.'
    : job.state === 'ready' ? 'Média enregistré dans votre projet.'
    : job.state === 'declined' ? 'Le développement continue sans génération.'
    : job.state === 'failed' || job.state === 'unknown' ? 'Le média n’a pas pu être livré. Aucun débit pour les fichiers non livrés.'
    : 'La génération continue, même si vous quittez cette page.';
  return <section className="coden-stream-notice coden-media-job" aria-label={title}>
    <h3>{title}</h3><p>{job.purpose}</p>
    <p className="coden-media-quote">{job.count} {job.kind === 'image' ? 'image(s)' : 'vidéo'} · {job.state === 'ready' ? job.creditsCharged : job.creditsMax} crédits Coden {job.state === 'ready' ? 'utilisés' : 'maximum'}</p>
    <p role="status">{status}{hint ? ' ' + hint : ''}</p>
    {job.state === 'awaiting_approval' ? <div className="coden-media-actions">
      <button type="button" disabled={busy} onClick={() => void decide(true)}>Générer</button>
      <button type="button" disabled={busy} onClick={() => void decide(false)}>Continuer sans génération</button>
    </div> : null}
    {job.state === 'ready' ? <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('coden:integrate-media', { detail: { projectId: job.projectId, jobId: job.id } }))}>Intégrer dans le projet</button> : null}
  </section>;
}
