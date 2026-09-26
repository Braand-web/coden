/**
 * Suggestions: ideas and bugs from every signed-in member, voted on and
 * discussed in public, with the team's answers and statuses.
 *
 * Opened from the dashboard sidebar (#suggestions, #suggestions/<id>). All
 * text comes back from the server as plain strings and is rendered by React,
 * so nothing a member writes is ever interpreted as HTML.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, Bell, Bug, ChevronUp, Flag, ImagePlus, Lightbulb, MessageSquare, Pin, Plus, Search, ShieldAlert, X } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { createAttachmentUploader } from '../../lib/attachment-client';
import { markSuggestionsSeen } from '../../lib/suggestions-summary';
import { confirmDialog } from '../../lib/ui-feedback';
import { FEEDBACK_SORTS, FEEDBACK_STATUSES, FEEDBACK_TYPES, type FeedbackSort, type FeedbackStatus, type FeedbackType } from '../../services/feedback/feedback-core';
import '../../styles/suggestions.css';

type Post = {
  id: string;
  type: FeedbackType;
  title: string;
  body: string;
  private: boolean;
  status: FeedbackStatus;
  author_name: string;
  mine: boolean;
  vote_count: number;
  comment_count: number;
  pinned: boolean;
  voted: boolean;
  has_attachment: boolean;
  created_at: string;
  screenshot_url?: string | null;
};
type Comment = { id: string; author_name: string; body: string; is_team: boolean; pinned: boolean; mine: boolean; created_at: string };
type ListResponse = { posts: Post[]; total: number; next_offset: number | null; counts: Record<string, number> };
type DetailResponse = { post: Post; comments: Comment[]; duplicate_of: { id: string; title: string } | null };
type Notification = { id: string; post_id: string; status: FeedbackStatus; title: string; read: boolean };
type Similar = { id: string; title: string; type: FeedbackType; status: FeedbackStatus; vote_count: number };

function relative(value: string) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return '';
  const minutes = Math.max(0, Math.round((Date.now() - time) / 60_000));
  if (minutes < 1) return 'à l’instant';
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `il y a ${days} j`;
  return new Date(time).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

const errorText = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);

function StatusPill({ status }: { status: FeedbackStatus }) {
  return <span className={`coden-suggest-status is-${status}`}>{FEEDBACK_STATUSES[status]}</span>;
}

function TypePill({ type, isPrivate }: { type: FeedbackType; isPrivate?: boolean }) {
  return (
    <span className={`coden-suggest-type is-${type}`}>
      {type === 'bug' ? <Bug size={12} aria-hidden="true" /> : <Lightbulb size={12} aria-hidden="true" />}
      {FEEDBACK_TYPES[type]}
      {isPrivate && <><ShieldAlert size={12} aria-hidden="true" /> privé</>}
    </span>
  );
}

function VoteButton({ post, onVoted }: { post: Pick<Post, 'id' | 'voted' | 'vote_count' | 'status' | 'title'>; onVoted: (voted: boolean, count: number) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const disabled = busy || post.status === 'duplicate';
  const toggle = async () => {
    if (disabled) return;
    setBusy(true);
    setError('');
    const next = !post.voted;
    onVoted(next, post.vote_count + (next ? 1 : -1));
    try {
      const result = await apiFetch<{ voted: boolean; vote_count: number }>(`/api/feedback/${encodeURIComponent(post.id)}/vote`, { method: 'POST', body: JSON.stringify({ voted: next }) });
      onVoted(result.voted, result.vote_count);
    } catch (caught) {
      onVoted(post.voted, post.vote_count);
      setError(errorText(caught, 'Vote impossible.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      className={`coden-suggest-vote${post.voted ? ' is-voted' : ''}`}
      aria-pressed={post.voted}
      aria-label={`${post.voted ? 'Retirer mon vote pour' : 'Voter pour'} « ${post.title} » (${post.vote_count} vote${post.vote_count > 1 ? 's' : ''})`}
      title={error || (post.status === 'duplicate' ? 'Fusionnée : votez pour l’originale' : undefined)}
      disabled={disabled}
      onClick={() => { void toggle(); }}
    >
      <ChevronUp size={16} aria-hidden="true" />
      <strong>{post.vote_count}</strong>
    </button>
  );
}

function CreateForm({ onClose, onCreated, openPost }: { onClose: () => void; onCreated: (id: string) => void; openPost: (id: string) => void }) {
  const [type, setType] = useState<FeedbackType>('feature');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [security, setSecurity] = useState(false);
  const [similar, setSimilar] = useState<Similar[]>([]);
  const [shot, setShot] = useState<{ id: string; name: string; preview: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const uploader = useMemo(() => createAttachmentUploader(), []);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => { titleRef.current?.focus(); }, []);

  // Suggestions that already say the same thing, while the title is typed.
  useEffect(() => {
    const text = title.trim();
    if (text.length < 6) { setSimilar([]); return; }
    const timer = window.setTimeout(() => {
      apiFetch<{ posts: Similar[] }>(`/api/feedback/similar?title=${encodeURIComponent(text)}`)
        .then(result => setSimilar(result.posts || []))
        .catch(() => setSimilar([]));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [title]);

  useEffect(() => () => { if (shot) URL.revokeObjectURL(shot.preview); }, [shot]);

  const pickShot = async (file: File | undefined) => {
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp|gif)$/i.test(file.type)) { setError('La capture doit être une image (PNG, JPEG, WebP ou GIF).'); return; }
    if (file.size > 8 * 1024 * 1024) { setError('La capture ne doit pas dépasser 8 Mo.'); return; }
    setError('');
    setUploading(true);
    try {
      const uploaded = await uploader.upload(file, () => undefined, new AbortController().signal);
      setShot({ id: uploaded.id, name: file.name, preview: URL.createObjectURL(file) });
    } catch (caught) {
      setError(errorText(caught, 'La capture n’a pas pu être envoyée.'));
    } finally {
      setUploading(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || uploading) return;
    setBusy(true);
    setError('');
    try {
      const result = await apiFetch<{ id: string }>('/api/feedback', {
        method: 'POST',
        body: JSON.stringify({ type, title, body, security: type === 'bug' && security, attachment_id: shot?.id || null }),
      });
      onCreated(result.id);
    } catch (caught) {
      setError(errorText(caught, 'La suggestion n’a pas pu être publiée.'));
      setBusy(false);
    }
  };

  return (
    <form className="coden-suggest-create" onSubmit={submit} aria-labelledby="coden-suggest-create-title">
      <div className="coden-suggest-create-head">
        <h2 id="coden-suggest-create-title">Nouvelle suggestion</h2>
        <button type="button" className="coden-suggest-icon" aria-label="Fermer" onClick={onClose}><X size={16} aria-hidden="true" /></button>
      </div>
      <div className="coden-suggest-segment" role="radiogroup" aria-label="Type">
        {(Object.keys(FEEDBACK_TYPES) as FeedbackType[]).map(value => (
          <button key={value} type="button" role="radio" aria-checked={type === value} className={type === value ? 'is-active' : ''} onClick={() => setType(value)}>
            {value === 'bug' ? <Bug size={14} aria-hidden="true" /> : <Lightbulb size={14} aria-hidden="true" />}
            {FEEDBACK_TYPES[value]}
          </button>
        ))}
      </div>
      <label className="coden-suggest-field">
        <span>Titre</span>
        <input ref={titleRef} value={title} onChange={event => setTitle(event.target.value)} minLength={8} maxLength={120} required placeholder={type === 'bug' ? 'Ex. : l’aperçu reste blanc après une modification' : 'Ex. : exporter un projet en ZIP'} />
        <small>{title.trim().length}/120</small>
      </label>
      {similar.length > 0 && (
        <div className="coden-suggest-similar" role="status">
          <strong>Existe déjà ? Votez plutôt pour l’une de celles-ci :</strong>
          <ul>
            {similar.map(item => (
              <li key={item.id}>
                <button type="button" onClick={() => openPost(item.id)}>
                  <span>{item.title}</span>
                  <small>{item.vote_count} vote{item.vote_count > 1 ? 's' : ''} · {FEEDBACK_STATUSES[item.status]}</small>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <label className="coden-suggest-field">
        <span>{type === 'bug' ? 'Ce qui s’est passé' : 'Description'} {type === 'feature' && <em>(facultatif)</em>}</span>
        <textarea value={body} onChange={event => setBody(event.target.value)} maxLength={5000} rows={6} required={type === 'bug'} placeholder={type === 'bug' ? 'Ce que vous faisiez, ce qui s’est passé, ce que vous attendiez.' : 'Le besoin derrière l’idée : ce que vous voulez pouvoir faire, et pourquoi.'} />
      </label>
      {type === 'bug' && (
        <>
          <div className="coden-suggest-shot">
            {shot ? (
              <figure>
                <img src={shot.preview} alt="Capture jointe" />
                <figcaption>{shot.name}</figcaption>
                <button type="button" className="coden-suggest-icon" aria-label="Retirer la capture" onClick={() => setShot(null)}><X size={14} aria-hidden="true" /></button>
              </figure>
            ) : (
              <label className="coden-suggest-shot-pick">
                <ImagePlus size={16} aria-hidden="true" />
                {uploading ? 'Envoi…' : 'Ajouter une capture d’écran (facultatif)'}
                <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={uploading} onChange={event => { void pickShot(event.target.files?.[0]); event.target.value = ''; }} />
              </label>
            )}
          </div>
          <label className="coden-suggest-check">
            <input type="checkbox" checked={security} onChange={event => setSecurity(event.target.checked)} />
            <span><strong>Problème de sécurité</strong> — visible seulement de vous et de l’équipe Coden.</span>
          </label>
        </>
      )}
      {error && <p className="coden-suggest-error" role="alert">{error}</p>}
      <div className="coden-suggest-actions">
        <button type="button" className="coden-suggest-button" onClick={onClose}>Annuler</button>
        <button type="submit" className="coden-suggest-button is-primary" disabled={busy || uploading}>{busy ? 'Publication…' : 'Publier'}</button>
      </div>
    </form>
  );
}

function Detail({ id, onBack, openPost }: { id: string; onBack: () => void; openPost: (id: string) => void }) {
  const [data, setData] = useState<DetailResponse | null>(null);
  const [error, setError] = useState('');
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [replyError, setReplyError] = useState('');
  const [reported, setReported] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      setData(await apiFetch<DetailResponse>(`/api/feedback/${encodeURIComponent(id)}`));
      setError('');
    } catch (caught) {
      setError(errorText(caught, 'Suggestion introuvable.'));
    }
  }, [id]);

  useEffect(() => { setData(null); void load(); }, [load]);

  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (sending || !reply.trim()) return;
    setSending(true);
    setReplyError('');
    try {
      await apiFetch(`/api/feedback/${encodeURIComponent(id)}/comments`, { method: 'POST', body: JSON.stringify({ body: reply }) });
      setReply('');
      await load();
    } catch (caught) {
      setReplyError(errorText(caught, 'La réponse n’a pas pu être publiée.'));
    } finally {
      setSending(false);
    }
  };

  const report = async (commentId?: string) => {
    const key = commentId || 'post';
    if (reported.has(key)) return;
    const ok = await confirmDialog({
      title: commentId ? 'Signaler cette réponse ?' : 'Signaler cette suggestion ?',
      body: 'L’équipe Coden la relira et la masquera si elle est abusive, hors sujet ou contient des données personnelles.',
      confirmLabel: 'Signaler',
    });
    if (!ok) return;
    try {
      await apiFetch(`/api/feedback/${encodeURIComponent(id)}/report`, { method: 'POST', body: JSON.stringify({ comment_id: commentId || null }) });
      setReported(previous => new Set(previous).add(key));
    } catch { /* the button stays available */ }
  };

  if (error) {
    return (
      <div className="coden-suggest-detail">
        <button type="button" className="coden-suggest-back" onClick={onBack}><ArrowLeft size={15} aria-hidden="true" /> Toutes les suggestions</button>
        <div className="coden-suggest-empty" role="alert"><strong>{error}</strong><span>Elle a peut-être été retirée par la modération.</span></div>
      </div>
    );
  }
  if (!data) return <div className="coden-suggest-detail"><div className="coden-suggest-skeleton" aria-busy="true" aria-label="Chargement" /></div>;
  const { post, comments } = data;

  return (
    <article className="coden-suggest-detail" aria-labelledby="coden-suggest-detail-title">
      <button type="button" className="coden-suggest-back" onClick={onBack}><ArrowLeft size={15} aria-hidden="true" /> Toutes les suggestions</button>
      <header className="coden-suggest-detail-head">
        <VoteButton post={post} onVoted={(voted, count) => setData(current => current && { ...current, post: { ...current.post, voted, vote_count: count } })} />
        <div>
          <div className="coden-suggest-meta"><TypePill type={post.type} isPrivate={post.private} /><StatusPill status={post.status} /></div>
          <h2 id="coden-suggest-detail-title">{post.title}</h2>
          <p className="coden-suggest-byline">{post.mine ? 'Vous' : post.author_name} · {relative(post.created_at)}</p>
        </div>
      </header>
      {data.duplicate_of && (
        <p className="coden-suggest-note">Fusionnée avec <button type="button" className="coden-suggest-link" onClick={() => openPost(data.duplicate_of!.id)}>{data.duplicate_of.title}</button> : les votes y ont été reportés.</p>
      )}
      {post.body && <p className="coden-suggest-body">{post.body}</p>}
      {post.screenshot_url && (
        <a className="coden-suggest-screenshot" href={post.screenshot_url} target="_blank" rel="noopener noreferrer"><img src={post.screenshot_url} alt="Capture d’écran jointe au signalement" loading="lazy" /></a>
      )}
      {!post.mine && (
        <button type="button" className="coden-suggest-report" onClick={() => { void report(); }} disabled={reported.has('post')}>
          <Flag size={13} aria-hidden="true" /> {reported.has('post') ? 'Signalée, merci' : 'Signaler'}
        </button>
      )}

      <section className="coden-suggest-thread" aria-label="Réponses">
        <h3>{comments.length} réponse{comments.length > 1 ? 's' : ''}</h3>
        {comments.map(comment => (
          <div key={comment.id} className={`coden-suggest-comment${comment.is_team ? ' is-team' : ''}`}>
            <div className="coden-suggest-comment-head">
              <strong>{comment.mine ? 'Vous' : comment.author_name}</strong>
              {comment.is_team && <span className="coden-suggest-team">Équipe</span>}
              {comment.pinned && <Pin size={12} aria-label="Épinglée" />}
              <time dateTime={comment.created_at}>{relative(comment.created_at)}</time>
              {!comment.mine && !comment.is_team && (
                <button type="button" className="coden-suggest-report is-inline" onClick={() => { void report(comment.id); }} disabled={reported.has(comment.id)} aria-label="Signaler cette réponse">
                  <Flag size={12} aria-hidden="true" />
                </button>
              )}
            </div>
            <p>{comment.body}</p>
          </div>
        ))}
        <form className="coden-suggest-reply" onSubmit={send}>
          <label className="coden-sr-only" htmlFor="coden-suggest-reply">Votre réponse</label>
          <textarea id="coden-suggest-reply" value={reply} onChange={event => setReply(event.target.value)} maxLength={3000} rows={3} placeholder="Ajoutez un détail, un cas d’usage, une piste…" />
          {replyError && <p className="coden-suggest-error" role="alert">{replyError}</p>}
          <button type="submit" className="coden-suggest-button is-primary" disabled={sending || !reply.trim()}>{sending ? 'Envoi…' : 'Répondre'}</button>
        </form>
      </section>
    </article>
  );
}

export function SuggestionsPage({ postId, navigate }: { postId: string | null; navigate: (hash: string) => void }) {
  const [sort, setSort] = useState<FeedbackSort>('trending');
  const [type, setType] = useState<'' | FeedbackType>('');
  const [status, setStatus] = useState('');
  const [mine, setMine] = useState(false);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [list, setList] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);

  useEffect(() => { markSuggestionsSeen(); }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  const params = useMemo(() => {
    const search = new URLSearchParams({ sort });
    if (type) search.set('type', type);
    if (status) search.set('status', status);
    if (mine) search.set('mine', '1');
    if (debounced) search.set('q', debounced);
    return search;
  }, [sort, type, status, mine, debounced]);

  const load = useCallback(async (offset = 0) => {
    setLoading(true);
    try {
      const search = new URLSearchParams(params);
      if (offset) search.set('offset', String(offset));
      const result = await apiFetch<ListResponse>(`/api/feedback?${search.toString()}`);
      setList(current => (offset && current ? { ...result, posts: [...current.posts, ...result.posts] } : result));
      setError('');
    } catch (caught) {
      setError(errorText(caught, 'Les suggestions sont momentanément indisponibles.'));
    } finally {
      setLoading(false);
    }
  }, [params]);

  useEffect(() => { if (!postId) void load(); }, [load, postId]);

  // Status changes on what the member wrote or voted for, then marked as read.
  useEffect(() => {
    apiFetch<{ notifications: Notification[] }>('/api/feedback/notifications')
      .then(result => {
        const unread = (result.notifications || []).filter(item => !item.read);
        setNotifications(unread);
        if (unread.length) void apiFetch('/api/feedback/notifications/read', { method: 'POST', body: '{}' }).catch(() => undefined);
      })
      .catch(() => undefined);
  }, []);

  const openPost = (id: string) => { setCreating(false); navigate(`#suggestions/${id}`); };

  if (postId) {
    return (
      <div className="coden-suggest">
        <Detail id={postId} onBack={() => navigate('#suggestions')} openPost={openPost} />
      </div>
    );
  }

  const updatePost = (id: string, patch: Partial<Post>) => setList(current => current && { ...current, posts: current.posts.map(post => (post.id === id ? { ...post, ...patch } : post)) });

  return (
    <div className="coden-suggest">
      {/* Back to the projects, for when the sidebar is out of reach (mobile). */}
      <button type="button" className="coden-suggest-back" onClick={() => navigate('')}>
        <ArrowLeft size={15} aria-hidden="true" /> Accueil
      </button>
      <header className="coden-suggest-head">
        <div>
          <h1>Suggestions</h1>
          <p>Proposez une idée ou signalez un bug. Votez pour ce qui compte pour vous : l’équipe Coden s’appuie sur ce classement pour décider de la suite.</p>
        </div>
        {!creating && (
          <button type="button" className="coden-suggest-button is-primary" onClick={() => setCreating(true)}>
            <Plus size={16} aria-hidden="true" /> Proposer
          </button>
        )}
      </header>

      {notifications.length > 0 && (
        <div className="coden-suggest-notice" role="status">
          <Bell size={16} aria-hidden="true" />
          <ul>
            {notifications.slice(0, 3).map(item => (
              <li key={item.id}>
                <button type="button" className="coden-suggest-link" onClick={() => openPost(item.post_id)}>{item.title}</button> est passée à <strong>{FEEDBACK_STATUSES[item.status]}</strong>.
              </li>
            ))}
          </ul>
          <button type="button" className="coden-suggest-icon" aria-label="Masquer" onClick={() => setNotifications([])}><X size={14} aria-hidden="true" /></button>
        </div>
      )}

      {creating && (
        <CreateForm
          onClose={() => setCreating(false)}
          onCreated={id => { setCreating(false); openPost(id); }}
          openPost={openPost}
        />
      )}

      <div className="coden-suggest-toolbar">
        <div className="coden-suggest-tabs" role="tablist" aria-label="Trier">
          {(Object.keys(FEEDBACK_SORTS) as FeedbackSort[]).map(value => (
            <button key={value} type="button" role="tab" aria-selected={sort === value} className={sort === value ? 'is-active' : ''} onClick={() => setSort(value)}>{FEEDBACK_SORTS[value]}</button>
          ))}
        </div>
        <div className="coden-suggest-filters">
          <label className="coden-suggest-search">
            <Search size={15} aria-hidden="true" />
            <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Rechercher" aria-label="Rechercher une suggestion" />
          </label>
          <select value={type} onChange={event => setType(event.target.value as '' | FeedbackType)} aria-label="Type">
            <option value="">Tout{list ? ` (${list.counts.all ?? 0})` : ''}</option>
            <option value="feature">Fonctionnalités{list ? ` (${list.counts.feature ?? 0})` : ''}</option>
            <option value="bug">Bugs{list ? ` (${list.counts.bug ?? 0})` : ''}</option>
          </select>
          <select value={status} onChange={event => setStatus(event.target.value)} aria-label="Statut">
            <option value="">Tous les statuts</option>
            <option value="open">Ouvertes</option>
            {(Object.keys(FEEDBACK_STATUSES) as FeedbackStatus[]).filter(value => value !== 'duplicate').map(value => <option key={value} value={value}>{FEEDBACK_STATUSES[value]}</option>)}
          </select>
          <button type="button" className={`coden-suggest-chip${mine ? ' is-active' : ''}`} aria-pressed={mine} onClick={() => setMine(value => !value)}>Mes suggestions</button>
        </div>
      </div>

      <section className="coden-suggest-list" aria-label="Suggestions" aria-busy={loading}>
        {error && <div className="coden-suggest-empty" role="alert"><strong>{error}</strong><button type="button" className="coden-suggest-button" onClick={() => { void load(); }}>Réessayer</button></div>}
        {!error && loading && !list && Array.from({ length: 4 }, (_, index) => <div key={index} className="coden-suggest-skeleton" />)}
        {!error && list && !list.posts.length && (
          <div className="coden-suggest-empty">
            <strong>{debounced || type || status || mine ? 'Aucune suggestion ne correspond' : 'Aucune suggestion pour le moment'}</strong>
            <span>{debounced || type || status || mine ? 'Essayez d’autres filtres.' : 'Soyez le premier à proposer une idée.'}</span>
          </div>
        )}
        {!error && list?.posts.map(post => (
          <article key={post.id} className={`coden-suggest-card${post.pinned ? ' is-pinned' : ''}`}>
            <VoteButton post={post} onVoted={(voted, count) => updatePost(post.id, { voted, vote_count: count })} />
            <button type="button" className="coden-suggest-card-main" onClick={() => openPost(post.id)}>
              <span className="coden-suggest-meta">
                <TypePill type={post.type} isPrivate={post.private} />
                <StatusPill status={post.status} />
                {post.pinned && <span className="coden-suggest-pinned"><Pin size={12} aria-hidden="true" /> Épinglée</span>}
              </span>
              <strong>{post.title}</strong>
              {post.body && <span className="coden-suggest-excerpt">{post.body}</span>}
              <span className="coden-suggest-byline">{post.mine ? 'Vous' : post.author_name} · {relative(post.created_at)}</span>
            </button>
            <span className="coden-suggest-comments" aria-label={`${post.comment_count} réponse${post.comment_count > 1 ? 's' : ''}`}>
              <MessageSquare size={15} aria-hidden="true" /> {post.comment_count}
            </span>
          </article>
        ))}
        {!error && list?.next_offset !== null && list?.next_offset !== undefined && (
          <button type="button" className="coden-suggest-button coden-suggest-more" disabled={loading} onClick={() => { void load(list.next_offset!); }}>
            {loading ? 'Chargement…' : 'Voir plus'}
          </button>
        )}
      </section>
    </div>
  );
}

export default SuggestionsPage;
