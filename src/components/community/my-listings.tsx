/** « Mes publications »: the status of each app in the Community, the reason, the stats, and what the owner may change. */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, Heart, Copy, RefreshCw } from 'lucide-react';
import { communityApi, type Category, type MineResponse, type OwnerListing } from '../../lib/community-client';
import { toast } from '../../lib/ui-feedback';
import { CardSkeleton, EmptyState, ErrorState, Thumb } from './community-cards';

const errorText = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);
const TONE: Record<string, string> = { online: 'is-ok', pending: 'is-wait', needs_fix: 'is-warn', refused: 'is-bad', removed_by_user: '', removed_by_moderation: 'is-bad', hidden: 'is-warn' };
const CHOICE_SEEN = 'coden-community-choice-seen';

export default function MyListings({ projects, onUpgrade }: { projects: Array<{ id: string; name: string }>; onUpgrade: () => void }) {
  const queryClient = useQueryClient();
  const mine = useQuery({ queryKey: ['community-mine'], queryFn: communityApi.mine, retry: false, refetchInterval: query => (query.state.data?.listings.some(item => item.status === 'pending') ? 8_000 : false) });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['community-mine'] });
  const [choiceSeen, setChoiceSeen] = useState(() => { try { return window.localStorage.getItem(CHOICE_SEEN); } catch { return 'x'; } });

  if (mine.isLoading) return <div className="coden-community-list"><CardSkeleton /><CardSkeleton /></div>;
  if (mine.isError || !mine.data) return <ErrorState message={errorText(mine.error, 'Vos publications ne se chargent pas.')} onRetry={() => { void mine.refetch(); }} />;
  const data = mine.data;
  const free = !data.controls.canChoose;
  const names = new Map(projects.map(project => [project.id, project.name]));
  const showChoice = !free && data.listings.some(item => item.status === 'online' || item.status === 'pending') && choiceSeen !== data.plan;

  return (
    <div className="coden-community-mine">
      {free ? (
        <div className="coden-community-note">
          <p>{data.freeNotice}</p>
          <button type="button" className="coden-community-link" onClick={() => { void communityApi.upgradeClick(); onUpgrade(); }}>Passer à un plan payant pour choisir</button>
        </div>
      ) : (
        <div className="coden-community-note">
          <p>Sur votre plan, vos apps restent privées tant que vous ne les ajoutez pas à la Communauté. Vous pouvez changer d’avis à tout moment.</p>
        </div>
      )}
      {data.notice && (
        <div className="coden-community-note is-warn" role="status">
          <p>Vous êtes passé au plan gratuit : vos apps publiées apparaîtront dans la Communauté à partir du {new Date(data.notice.effectiveAt).toLocaleDateString('fr-FR')}. Vous pouvez modifier leur titre, leur description et leur catégorie, ou repasser à un plan payant pour choisir.</p>
        </div>
      )}
      {showChoice && (
        <div className="coden-community-note" role="status">
          <p>Vous êtes passé à un plan payant : choisissez les apps à garder dans la Communauté. Sans choix de votre part, rien ne change.</p>
          <button type="button" className="coden-community-link" onClick={() => { try { window.localStorage.setItem(CHOICE_SEEN, data.plan); } catch { /* storage can be unavailable */ } setChoiceSeen(data.plan); }}>C’est noté</button>
        </div>
      )}

      {data.listings.length === 0 && data.unlisted.length === 0 && (
        <EmptyState title="Aucune publication pour l’instant" body={free ? 'Publiez une app : elle apparaîtra ici, puis dans la Communauté après vérification.' : 'Publiez une app, puis ajoutez-la à la Communauté si vous le souhaitez.'} />
      )}

      <ul className="coden-community-rows">
        {data.listings.map(listing => <Row key={listing.id} listing={listing} categories={data.categories} free={free} onChanged={refresh} />)}
        {!free && data.unlisted.map(projectId => (
          <li key={projectId} className="coden-community-row">
            <div className="coden-community-row-main">
              <strong>{names.get(projectId) || 'App publiée'}</strong>
              <span className="coden-community-fine">Publiée, privée : non visible dans la Communauté.</span>
            </div>
            <AddSwitch projectId={projectId} onChanged={refresh} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function AddSwitch({ projectId, onChanged }: { projectId: string; onChanged: () => void }) {
  const add = useMutation({
    mutationFn: () => communityApi.editListing(projectId, { optedIn: true }),
    onSuccess: () => { toast('Ajoutée : elle apparaîtra dans quelques minutes, après vérification.', 'success'); onChanged(); },
    onError: error => toast(errorText(error, 'Action impossible pour le moment.'), 'error'),
  });
  return (
    <label className="coden-community-switch">
      <input type="checkbox" role="switch" checked={add.isPending} disabled={add.isPending} onChange={() => add.mutate()} />
      <span>Ajouter à la communauté</span>
    </label>
  );
}

function Row({ listing, categories, free, onChanged }: { listing: OwnerListing; categories: Category[]; free: boolean; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [appealing, setAppealing] = useState(false);
  const [draft, setDraft] = useState({ title: listing.title, description: listing.description, category: listing.category, alias: listing.creatorAlias || '' });
  const save = useMutation({
    mutationFn: (patch: Record<string, unknown>) => communityApi.editListing(listing.projectId, patch),
    onSuccess: () => { toast('Enregistré.', 'success'); setEditing(false); onChanged(); },
    onError: error => toast(errorText(error, 'Enregistrement impossible.'), 'error'),
  });
  const thumb = useMutation({
    mutationFn: () => communityApi.refreshThumbnail(listing.projectId),
    onSuccess: () => { toast('L’aperçu sera actualisé dans un instant.', 'success'); onChanged(); },
    onError: error => toast(errorText(error, 'Actualisation impossible.'), 'error'),
  });
  const removed = listing.status === 'removed_by_user';

  return (
    <li className="coden-community-row">
      <Thumb src={listing.thumbnail} alt={`Aperçu de « ${listing.title} »`} />
      <div className="coden-community-row-main">
        <div className="coden-community-row-title">
          <strong>{listing.title}</strong>
          <span className={`coden-community-status ${TONE[listing.status] || ''}`}>{listing.statusLabel}</span>
          {listing.featured && <span className="coden-community-pill is-choice">Choix de Coden</span>}
        </div>
        {listing.statusReason && listing.statusCode !== 'checks_passed' && listing.status !== 'online' && <p className="coden-community-fine">{listing.statusReason}</p>}
        {listing.status === 'online' && listing.statusCode && !['checks_passed', 'quality_ok', 'listable_free_auto', 'listable_paid_opt_in'].includes(listing.statusCode) && listing.statusReason && (
          <p className="coden-community-fine is-warn">Dernière mise à jour : {listing.statusReason} La version précédente reste affichée.</p>
        )}
        <div className="coden-community-stats">
          <span title="Vues uniques"><Eye size={13} aria-hidden="true" /> {listing.stats.views}</span>
          <span title="J’aime"><Heart size={13} aria-hidden="true" /> {listing.stats.likes}</span>
          <span title="Remix"><Copy size={13} aria-hidden="true" /> {listing.stats.remixes}</span>
          {listing.qualityScore !== null && <span title="Score de qualité">Qualité {listing.qualityScore}/100</span>}
        </div>

        {!free && (
          <div className="coden-community-controls">
            <label className="coden-community-switch">
              <input type="checkbox" role="switch" checked={listing.optedIn && !removed} disabled={save.isPending || listing.status === 'removed_by_moderation'} onChange={event => save.mutate({ optedIn: event.target.checked })} />
              <span>Ajouter à la communauté</span>
            </label>
            <label className="coden-community-select">
              <span className="coden-sr-only">Remix</span>
              <select value={listing.remixable ? 'remixable' : 'preview'} onChange={event => save.mutate({ remixable: event.target.value === 'remixable' })} disabled={save.isPending}>
                <option value="remixable">Remixable</option>
                <option value="preview">Aperçu seulement</option>
              </select>
            </label>
          </div>
        )}

        <div className="coden-community-actions">
          {!removed && <button type="button" className="coden-community-button" onClick={() => setEditing(value => !value)} aria-expanded={editing}>Modifier la fiche</button>}
          {listing.status === 'online' && <button type="button" className="coden-community-button" onClick={() => thumb.mutate()} disabled={thumb.isPending}><RefreshCw size={14} aria-hidden="true" /> Actualiser l’aperçu</button>}
          {listing.status === 'online' && <a className="coden-community-button" href={`#community/app/${listing.id}`}>Voir</a>}
          {listing.canContest && <button type="button" className="coden-community-button is-quiet" onClick={() => setAppealing(value => !value)}>Contester</button>}
        </div>

        {editing && (
          <form className="coden-community-form" onSubmit={event => { event.preventDefault(); save.mutate({ title: draft.title, description: draft.description, category: draft.category, creatorAlias: draft.alias }); }}>
            <label className="coden-community-field">Titre
              <input value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} maxLength={80} required minLength={3} />
            </label>
            <label className="coden-community-field">Description
              <textarea value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} maxLength={300} rows={3} />
            </label>
            <label className="coden-community-field">Catégorie
              <select value={draft.category} onChange={event => setDraft({ ...draft, category: event.target.value })}>
                {categories.map(category => <option key={category.slug} value={category.slug}>{category.label}</option>)}
              </select>
            </label>
            <label className="coden-community-field">Nom affiché (laisser vide pour « Créateur anonyme »)
              <input value={draft.alias} onChange={event => setDraft({ ...draft, alias: event.target.value })} maxLength={40} placeholder="Créateur anonyme" />
            </label>
            <p className="coden-community-fine">N’indiquez ni e-mail ni téléphone : ils seraient visibles de tous.</p>
            <div className="coden-community-actions">
              <button type="submit" className="coden-community-button is-primary" disabled={save.isPending}>{save.isPending ? 'Enregistrement…' : 'Enregistrer'}</button>
              <button type="button" className="coden-community-button" onClick={() => setEditing(false)}>Annuler</button>
            </div>
          </form>
        )}
        {appealing && <AppealForm id={listing.id} onDone={() => { setAppealing(false); onChanged(); }} />}
      </div>
    </li>
  );
}

function AppealForm({ id, onDone }: { id: string; onDone: () => void }) {
  const [message, setMessage] = useState('');
  const send = useMutation({
    mutationFn: () => communityApi.appeal(id, message),
    onSuccess: () => { toast('Votre contestation a été transmise.', 'success'); onDone(); },
    onError: error => toast(errorText(error, 'Envoi impossible.'), 'error'),
  });
  return (
    <form className="coden-community-form" onSubmit={event => { event.preventDefault(); send.mutate(); }}>
      <label className="coden-community-field">Pourquoi cette décision vous semble-t-elle erronée ?
        <textarea value={message} onChange={event => setMessage(event.target.value)} rows={3} maxLength={1000} required minLength={10} />
      </label>
      <div className="coden-community-actions">
        <button type="submit" className="coden-community-button is-primary" disabled={send.isPending || message.trim().length < 10}>Envoyer</button>
      </div>
    </form>
  );
}

export type { MineResponse };
