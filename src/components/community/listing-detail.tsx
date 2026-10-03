/**
 * One app of the Community: shareable address, live preview in an isolated frame, the one main action (Remixer), then the others.
 *
 * The preview is the app's own public address in an iframe with `sandbox` (scripts, forms and pop-ups only: no
 * allow-same-origin, so the app is a stranger to Coden's cookies and storage) and no referrer. It loads only on a click.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Copy, ExternalLink, Flag, Heart, Monitor, Share2, Smartphone } from 'lucide-react';
import { communityApi, relativeDate, REPORT_REASONS, type RemixResult } from '../../lib/community-client';
import { toast } from '../../lib/ui-feedback';
import { categoryLabel, CardSkeleton, ErrorState, ListingCard, Thumb } from './community-cards';

const errorText = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);

export default function ListingDetail({ id, onBack, hrefFor, builderUrl }: { id: string; onBack: () => void; hrefFor: (id: string) => string; builderUrl: (projectId: string) => string }) {
  const queryClient = useQueryClient();
  const detail = useQuery({ queryKey: ['community-detail', id], queryFn: () => communityApi.detail(id), retry: false });
  const [frame, setFrame] = useState<'closed' | 'desktop' | 'mobile'>('closed');
  const [reporting, setReporting] = useState(false);
  const [remixed, setRemixed] = useState<RemixResult | null>(null);
  const listing = detail.data?.listing;

  // A view counts once per visitor per day, on the server; the page only says it was opened.
  useEffect(() => { void communityApi.view(id).catch(() => null); setFrame('closed'); setRemixed(null); }, [id]);

  const like = useMutation({
    mutationFn: () => communityApi.like(id),
    onSuccess: result => queryClient.setQueryData(['community-detail', id], (old: typeof detail.data) => old && ({ ...old, listing: { ...old.listing, liked: result.liked, likes: result.likes } })),
    onError: error => toast(errorText(error, 'Action impossible pour le moment.'), 'error'),
  });
  const remix = useMutation({
    mutationFn: () => communityApi.remix(id),
    onSuccess: result => setRemixed(result),
    onError: error => toast(errorText(error, 'Le remix a échoué.'), 'error'),
  });

  const share = async () => {
    const url = `${window.location.origin}/c/${id}`;
    try {
      if (navigator.share) await navigator.share({ title: listing?.title, url });
      else { await navigator.clipboard.writeText(url); toast('Lien copié.', 'success'); }
    } catch { /* the person closed the share sheet */ }
  };

  if (detail.isLoading) return <div className="coden-community-detail" aria-busy="true"><div className="coden-community-preview coden-ui-skeleton coden-community-shimmer" /></div>;
  if (detail.isError || !listing) {
    return (
      <div className="coden-community-detail">
        <button type="button" className="coden-community-back" onClick={onBack}><ArrowLeft size={16} aria-hidden="true" /> Communauté</button>
        <ErrorState message={errorText(detail.error, 'Cette app n’est plus disponible dans la Communauté.')} onRetry={() => { void detail.refetch(); }} />
      </div>
    );
  }
  const categories = detail.data!.categories;

  return (
    <div className="coden-community-detail">
      <button type="button" className="coden-community-back" onClick={onBack}><ArrowLeft size={16} aria-hidden="true" /> Communauté</button>
      <div className="coden-community-detail-grid">
        <section className="coden-community-stage" aria-label="Aperçu">
          <div className="coden-community-stage-bar">
            <div className="coden-community-segment" role="group" aria-label="Taille de l’aperçu">
              <button type="button" className={frame !== 'mobile' ? 'is-active' : ''} aria-pressed={frame !== 'mobile'} onClick={() => setFrame('desktop')}><Monitor size={14} aria-hidden="true" /> Bureau</button>
              <button type="button" className={frame === 'mobile' ? 'is-active' : ''} aria-pressed={frame === 'mobile'} onClick={() => setFrame('mobile')}><Smartphone size={14} aria-hidden="true" /> Mobile</button>
            </div>
          </div>
          <div className={`coden-community-preview${frame === 'mobile' ? ' is-mobile' : ''}`}>
            {frame !== 'closed' && listing.publicUrl ? (
              <iframe
                title={`Aperçu de ${listing.title}`} src={listing.publicUrl} sandbox="allow-scripts allow-forms allow-popups" referrerPolicy="no-referrer"
                allow="" loading="lazy" className="coden-community-frame"
              />
            ) : (
              <button type="button" className="coden-community-preview-start" onClick={() => setFrame('desktop')} disabled={!listing.publicUrl}>
                <Thumb src={listing.thumbnail} alt={listing.thumbnailAlt} />
                <span>Lancer l’aperçu en direct</span>
              </button>
            )}
          </div>
        </section>

        <aside className="coden-community-side">
          <h1>{listing.title}</h1>
          <p className="coden-community-byline">
            {listing.creator} · <span className="coden-community-pill">{categoryLabel(categories, listing.category)}</span> {listing.featured && <span className="coden-community-pill is-choice">Choix de Coden</span>}
          </p>
          {listing.description && <p className="coden-community-description">{listing.description}</p>}
          <p className="coden-community-fine">Publiée {relativeDate(listing.listedAt)} · {listing.likes} j’aime · {listing.remixes} remix</p>

          {listing.remixable ? (
            <button type="button" className="coden-community-button is-primary is-large" onClick={() => remix.mutate()} disabled={remix.isPending}>
              <Copy size={16} aria-hidden="true" /> {remix.isPending ? 'Création du remix…' : 'Remixer'}
            </button>
          ) : <p className="coden-community-fine">Le créateur propose cette app en aperçu seulement.</p>}

          <div className="coden-community-actions">
            {listing.publicUrl && <a className="coden-community-button" href={listing.publicUrl} target="_blank" rel="nofollow ugc noopener noreferrer"><ExternalLink size={15} aria-hidden="true" /> Ouvrir l’app</a>}
            <button type="button" className={`coden-community-button${listing.liked ? ' is-on' : ''}`} onClick={() => like.mutate()} disabled={like.isPending || listing.mine} aria-pressed={Boolean(listing.liked)} title={listing.mine ? 'Vous ne pouvez pas aimer votre propre app' : undefined}>
              <Heart size={15} aria-hidden="true" /> J’aime
            </button>
            <button type="button" className="coden-community-button" onClick={() => { void share(); }}><Share2 size={15} aria-hidden="true" /> Partager</button>
            {!listing.mine && <button type="button" className="coden-community-button is-quiet" onClick={() => setReporting(true)}><Flag size={15} aria-hidden="true" /> Signaler</button>}
          </div>
        </aside>
      </div>

      {detail.data!.similar.length > 0 && (
        <section aria-label="Apps similaires" className="coden-community-similar">
          <h2>Apps similaires</h2>
          <div className="coden-community-project-grid coden-dashboard-project-list">
            {detail.data!.similar.map(item => <ListingCard key={item.id} listing={item} href={hrefFor(item.id)} />)}
          </div>
        </section>
      )}

      {reporting && <ReportDialog id={id} onClose={() => setReporting(false)} />}
      {remixed && (
        <div className="coden-community-modal" role="dialog" aria-modal="true" aria-labelledby="remix-title">
          <div className="coden-community-modal-panel">
            <h2 id="remix-title">Votre remix est prêt</h2>
            <p className="coden-community-fine">{remixed.attribution}. C’est un projet à vous, indépendant de l’original.</p>
            <p><strong>À reconnecter</strong></p>
            <ul className="coden-community-reconnect">{remixed.reconnect.map(item => <li key={item.key}><strong>{item.label}</strong><span>{item.hint}</span></li>)}</ul>
            <div className="coden-community-actions">
              <a className="coden-community-button is-primary" href={builderUrl(remixed.project.id)}>Ouvrir dans le builder</a>
              <button type="button" className="coden-community-button" onClick={() => setRemixed(null)}>Rester ici</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ReportDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const send = useMutation({
    mutationFn: () => communityApi.report(id, reason, details),
    onSuccess: () => { toast('Merci, votre signalement a été transmis.', 'success'); onClose(); },
    onError: error => toast(errorText(error, 'Le signalement n’a pas pu être envoyé.'), 'error'),
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="coden-community-modal" role="dialog" aria-modal="true" aria-labelledby="report-title" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <form className="coden-community-modal-panel" onSubmit={event => { event.preventDefault(); if (reason) send.mutate(); }}>
        <h2 id="report-title">Signaler cette app</h2>
        <fieldset className="coden-community-reasons">
          <legend className="coden-sr-only">Motif</legend>
          {Object.entries(REPORT_REASONS).map(([key, label]) => (
            <label key={key}><input type="radio" name="reason" value={key} checked={reason === key} onChange={() => setReason(key)} /> {label}</label>
          ))}
        </fieldset>
        <label className="coden-community-field">Précisions (facultatif)
          <textarea value={details} onChange={event => setDetails(event.target.value)} maxLength={1000} rows={3} />
        </label>
        <div className="coden-community-actions">
          <button type="submit" className="coden-community-button is-primary" disabled={!reason || send.isPending}>{send.isPending ? 'Envoi…' : 'Envoyer le signalement'}</button>
          <button type="button" className="coden-community-button" onClick={onClose}>Annuler</button>
        </div>
      </form>
    </div>
  );
}

export { CardSkeleton };
