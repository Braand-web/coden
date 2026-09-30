/**
 * What a message carries, drawn once, the same everywhere.
 *
 * Images are thumbnails in a small grid (« +N » past four); any other file is a one-line card with an icon for its
 * kind, its name as a title and its type and size in grey. The name is the one the person gave the file, cut in the
 * middle so the extension stays; a machine's name (an identifier, a hash) is never shown (`attachment-display.ts`).
 * A click on an image opens it full screen; a click on a file opens or downloads it.
 *
 * The same component serves the conversation, the history (messages reloaded from the server) and, through its
 * parts, the composer's tray.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './message-attachments.css';
import { attachmentAriaLabel, attachmentKindOf, displayFileName, fileMetaLine, splitForMiddleEllipsis } from '../../lib/attachment-display';
import { resolveAttachments } from '../../lib/attachment-resolve';

export type MessageAttachment = {
  id?: string;
  name: string;
  mimeType?: string;
  size?: number;
  kind?: string;
  /** A thumbnail that is already at hand: a data URL made when the file was chosen, or a signed link. */
  previewUrl?: string;
  /** The original, to open or download. */
  fullUrl?: string;
  status?: 'uploading' | 'processing' | 'ready' | 'failed';
  analysis?: 'pending' | 'done' | 'none';
  error?: string;
  createdAt?: string;
};

/** Images shown before the « +N » tile. */
export const MAX_VISIBLE_IMAGES = 4;

/* ------------------------------------------------------------------------ */
/* Icons: one family, stroke only, drawn for each kind of file               */
/* ------------------------------------------------------------------------ */

const GLYPHS: Record<string, string> = {
  image: 'M4 5h16v14H4zM8.5 10a1.5 1.5 0 1 0 0-.01M4 16l4.5-4.5L13 16l3-3 4 4',
  video: 'M4 6h12v12H4zM16 10l4-2v8l-4-2',
  document: 'M7 3h7l4 4v14H7zM14 3v4h4M9.5 12h5M9.5 15.5h5',
  spreadsheet: 'M4 5h16v14H4zM4 10h16M4 14.5h16M10 5v14',
  archive: 'M6 3h12v18H6zM11 3v3h2V3M11 8h2v3h-2zM11 13h2v3h-2z',
  code: 'M9 8l-4 4 4 4M15 8l4 4-4 4M13 6l-2 12',
  text: 'M6 4h12v16H6zM9 9h6M9 12.5h6M9 16h4',
  link: 'M10 14a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1 1M14 10a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1-1',
  file: 'M7 3h7l4 4v14H7zM14 3v4h4',
};

export function FileTypeIcon({ kind, size = 18 }: { kind: string; size?: number }) {
  const path = GLYPHS[kind] || GLYPHS.file;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={path} />
    </svg>
  );
}

function ErrorGlyph() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 5h16v14H4zM9 9l6 6M15 9l-6 6" /></svg>;
}

/* ------------------------------------------------------------------------ */
/* Thumbnails and originals, fetched once for the messages that carry an id  */
/* ------------------------------------------------------------------------ */

const UUID = /^[0-9a-f-]{36}$/i;

function useResolved(items: MessageAttachment[]): MessageAttachment[] {
  const [extra, setExtra] = useState<Map<string, Partial<MessageAttachment>>>(new Map());
  const key = items.map(item => item.id || '').join(',');
  useEffect(() => {
    const ids = items.filter(item => item.id && UUID.test(item.id) && (!item.previewUrl || !item.fullUrl) && item.status !== 'uploading').map(item => item.id!);
    if (!ids.length) return;
    let cancelled = false;
    void resolveAttachments(ids).then(found => {
      if (cancelled) return;
      setExtra(previous => {
        const next = new Map(previous);
        // Asked for and not found (deleted, expired, unreachable): shown as unavailable, not as a skeleton forever.
        for (const id of ids) if (UUID.test(id) && !found.has(id) && !next.has(id)) next.set(id, { status: 'failed', error: 'Fichier indisponible' });
        for (const [id, remote] of found) next.set(id, { previewUrl: remote.thumbnailUrl || undefined, fullUrl: remote.downloadUrl || undefined, status: remote.status, analysis: remote.analysis, error: remote.error || undefined, size: remote.size || undefined, mimeType: remote.mimeType || undefined });
        return next;
      });
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return useMemo(() => items.map(item => {
    const more = item.id ? extra.get(item.id) : undefined;
    if (!more) return item;
    return { ...item, previewUrl: item.previewUrl || more.previewUrl, fullUrl: item.fullUrl || more.fullUrl, status: item.status === 'uploading' ? item.status : (more.status || item.status), analysis: more.analysis ?? item.analysis, error: item.error || more.error, size: item.size || more.size, mimeType: item.mimeType || more.mimeType };
  }), [items, extra]);
}

/** A file name on one line, cut in the middle by the browser so the extension always stays visible. */
export function MiddleEllipsis({ text, className = '', title }: { text: string; className?: string; title?: string }) {
  const { head, tail } = splitForMiddleEllipsis(text);
  return (
    <span className={`coden-att-mid ${className}`.trim()} title={title ?? text}>
      <span className="coden-att-mid-head">{head}</span>
      {tail ? <span className="coden-att-mid-tail">{tail}</span> : null}
    </span>
  );
}

/* ------------------------------------------------------------------------ */
/* Image tile                                                                */
/* ------------------------------------------------------------------------ */

function ImageTile({ item, count, hidden, onOpen }: { item: MessageAttachment; count: number; hidden?: number; onOpen: (event: React.MouseEvent<HTMLButtonElement>) => void }) {
  const [state, setState] = useState<'loading' | 'ready' | 'broken'>(item.previewUrl ? 'loading' : item.status === 'failed' ? 'broken' : 'loading');
  const [ratio, setRatio] = useState<number | null>(null);
  const shown = displayFileName(item);
  useEffect(() => { setState(item.previewUrl ? 'loading' : item.status === 'failed' ? 'broken' : 'loading'); }, [item.previewUrl, item.status]);
  const label = hidden ? `${hidden} autres images, afficher toutes` : `Agrandir ${attachmentAriaLabel(item)}`;
  const analysing = item.analysis === 'pending';
  return (
    <button
      type="button"
      className="coden-att-tile"
      data-state={state}
      data-count={count}
      style={count === 1 && ratio ? { aspectRatio: String(ratio) } : undefined}
      onClick={onOpen}
      aria-label={label}
      title={shown.original || shown.text}
    >
      {state !== 'broken' && item.previewUrl ? (
        <img
          src={item.previewUrl}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={event => {
            const { naturalWidth: w, naturalHeight: h } = event.currentTarget;
            if (w && h) setRatio(Math.min(1.9, Math.max(0.75, w / h)));
            setState('ready');
          }}
          onError={() => setState('broken')}
        />
      ) : null}
      {state === 'loading' ? <span className="coden-att-skeleton" aria-hidden="true" /> : null}
      {state === 'broken' ? (
        <span className="coden-att-broken">
          <ErrorGlyph />
          <span>{item.status === 'failed' ? 'Image illisible' : 'Aperçu indisponible'}</span>
        </span>
      ) : null}
      {analysing && state !== 'broken' ? <span className="coden-att-analysing" role="status"><span className="coden-att-spinner" aria-hidden="true" />{count === 1 ? 'Analyse de l’image…' : 'Analyse…'}</span> : null}
      {hidden ? <span className="coden-att-more" aria-hidden="true">+{hidden}</span> : null}
    </button>
  );
}

/* ------------------------------------------------------------------------ */
/* File card                                                                 */
/* ------------------------------------------------------------------------ */

function statusLine(item: MessageAttachment): { text: string; tone?: 'busy' | 'error' } | null {
  if (item.status === 'uploading') return { text: 'Envoi…', tone: 'busy' };
  if (item.status === 'processing') return { text: 'Lecture…', tone: 'busy' };
  if (item.status === 'failed') return { text: item.error || 'Fichier illisible', tone: 'error' };
  if (item.analysis === 'pending') return { text: 'Analyse en cours…', tone: 'busy' };
  return null;
}

function FileCard({ item }: { item: MessageAttachment }) {
  const kind = attachmentKindOf(item);
  const shown = displayFileName(item);
  const status = statusLine(item);
  const meta = fileMetaLine(item);
  const inner = (
    <>
      <span className="coden-att-icon" data-kind={kind} aria-hidden="true"><FileTypeIcon kind={kind} /></span>
      <span className="coden-att-text">
        <MiddleEllipsis className="coden-att-name" text={shown.text} title={shown.original || shown.text} />
        <span className="coden-att-meta" data-tone={status?.tone}>
          {status?.tone === 'busy' ? <span className="coden-att-spinner" aria-hidden="true" /> : null}
          {status ? status.text : meta}
        </span>
      </span>
    </>
  );
  const aria = attachmentAriaLabel(item, status?.text || '');
  return item.fullUrl && item.status !== 'failed'
    ? <a className="coden-att-file" href={item.fullUrl} target="_blank" rel="noopener noreferrer" download={shown.original || undefined} aria-label={`${aria}. Ouvrir ou télécharger`}>{inner}</a>
    : <span className="coden-att-file is-static" data-failed={item.status === 'failed' ? '' : undefined} role="group" aria-label={aria}>{inner}</span>;
}

/* ------------------------------------------------------------------------ */
/* Full-screen preview                                                       */
/* ------------------------------------------------------------------------ */

function Lightbox({ images, start, onClose, opener }: { images: MessageAttachment[]; start: number; onClose: () => void; opener: HTMLElement | null }) {
  const [index, setIndex] = useState(start);
  const [zoom, setZoom] = useState(1);
  const [broken, setBroken] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const current = images[index];
  const shown = displayFileName(current);
  const source = current.fullUrl || current.previewUrl;
  const go = useCallback((delta: number) => { setIndex(value => (value + delta + images.length) % images.length); setZoom(1); setBroken(false); }, [images.length]);

  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = overflow; (opener || previous)?.focus?.(); };
  }, [opener]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
      else if (event.key === 'ArrowRight' && images.length > 1) { event.preventDefault(); go(1); }
      else if (event.key === 'ArrowLeft' && images.length > 1) { event.preventDefault(); go(-1); }
      else if (event.key === '+' || event.key === '=') setZoom(value => Math.min(4, value + 0.5));
      else if (event.key === '-') setZoom(value => Math.max(1, value - 0.5));
      else if (event.key === 'Tab') {
        const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button, a[href]') || [])].filter(element => !element.hasAttribute('disabled'));
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [go, onClose, images.length]);

  return createPortal(
    <div className="coden-att-lightbox" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={dialogRef} className="coden-att-lightbox-panel" role="dialog" aria-modal="true" aria-label={`Aperçu : ${shown.text}${images.length > 1 ? `, image ${index + 1} sur ${images.length}` : ''}`}>
        <header className="coden-att-lightbox-bar">
          <span className="coden-att-lightbox-title">
            <MiddleEllipsis className="coden-att-lightbox-name" text={shown.text} title={shown.original || shown.text} />
            <span className="coden-att-lightbox-sub">{[images.length > 1 ? `${index + 1} / ${images.length}` : '', fileMetaLine(current)].filter(Boolean).join(' · ')}</span>
          </span>
          <span className="coden-att-lightbox-tools">
            <button type="button" onClick={() => setZoom(value => Math.max(1, value - 0.5))} disabled={zoom <= 1} aria-label="Réduire">−</button>
            <button type="button" onClick={() => setZoom(1)} aria-label="Taille réelle : 100 %" className="is-value">{Math.round(zoom * 100)} %</button>
            <button type="button" onClick={() => setZoom(value => Math.min(4, value + 0.5))} disabled={zoom >= 4} aria-label="Agrandir">+</button>
            {source ? <a href={source} download={shown.original || undefined} target="_blank" rel="noopener noreferrer" aria-label="Télécharger">Télécharger</a> : null}
            <button ref={closeRef} type="button" onClick={onClose} aria-label="Fermer l’aperçu (Échap)" className="is-close">✕</button>
          </span>
        </header>
        <div className="coden-att-lightbox-stage" data-zoomed={zoom > 1 ? '' : undefined} onDoubleClick={() => setZoom(value => (value > 1 ? 1 : 2))}>
          {source && !broken
            ? <img src={source} alt={shown.text} draggable={false} style={{ width: `${zoom * 100}%`, maxWidth: zoom > 1 ? 'none' : '100%' }} onError={() => setBroken(true)} />
            : <div className="coden-att-lightbox-broken"><ErrorGlyph /><p>Cette image ne peut pas être affichée.</p>{current.fullUrl ? <a href={current.fullUrl} target="_blank" rel="noopener noreferrer">Ouvrir le fichier</a> : null}</div>}
        </div>
        {images.length > 1 ? (
          <>
            <button type="button" className="coden-att-lightbox-nav is-prev" onClick={() => go(-1)} aria-label="Image précédente">‹</button>
            <button type="button" className="coden-att-lightbox-nav is-next" onClick={() => go(1)} aria-label="Image suivante">›</button>
          </>
        ) : null}
        <p className="coden-att-sr" role="status" aria-live="polite">{images.length > 1 ? `Image ${index + 1} sur ${images.length} : ${shown.text}` : ''}</p>
      </div>
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------------------ */
/* The component                                                             */
/* ------------------------------------------------------------------------ */

export function MessageAttachments({ items, className = '' }: { items: MessageAttachment[]; className?: string }) {
  const resolved = useResolved(items);
  const [open, setOpen] = useState<{ index: number; opener: HTMLElement | null } | null>(null);
  // A picture with nothing to show (an old message that only kept a name) is drawn as a file card, not as an empty tile.
  const isPicture = (item: MessageAttachment) => attachmentKindOf(item) === 'image' && Boolean(item.previewUrl || item.fullUrl || (item.id && /^[0-9a-f-]{36}$/i.test(item.id)));
  const images = resolved.filter(isPicture);
  const files = resolved.filter(item => !isPicture(item));
  if (!resolved.length) return null;
  const visible = images.slice(0, MAX_VISIBLE_IMAGES);
  // The last tile wears the « +N » and covers its own picture, so N counts that one too.
  const hidden = images.length > MAX_VISIBLE_IMAGES ? images.length - (MAX_VISIBLE_IMAGES - 1) : 0;
  const openAt = (index: number) => (event: React.MouseEvent<HTMLButtonElement>) => setOpen({ index, opener: event.currentTarget });
  return (
    <div className={`coden-att-stack ${className}`.trim()}>
      {images.length ? (
        <ul className="coden-att-images" data-count={Math.min(images.length, MAX_VISIBLE_IMAGES)} aria-label={`${images.length} image${images.length > 1 ? 's' : ''} jointe${images.length > 1 ? 's' : ''}`}>
          {visible.map((item, index) => (
            <li key={item.id || `${item.name}-${index}`}>
              <ImageTile item={item} count={visible.length} hidden={hidden && index === visible.length - 1 ? hidden : undefined} onOpen={openAt(hidden && index === visible.length - 1 ? index : index)} />
            </li>
          ))}
        </ul>
      ) : null}
      {files.length ? (
        <ul className="coden-att-files" aria-label={`${files.length} fichier${files.length > 1 ? 's' : ''} joint${files.length > 1 ? 's' : ''}`}>
          {files.map((item, index) => <li key={item.id || `${item.name}-${index}`}><FileCard item={item} /></li>)}
        </ul>
      ) : null}
      {open ? <Lightbox images={images} start={open.index} opener={open.opener} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}
