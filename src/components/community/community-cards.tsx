/** Cards and small pieces shared by the Community screens. Tokens only; no violet. */
import { useEffect, useRef, type ReactNode } from 'react';
import { ArrowRight, Heart, LayoutTemplate } from 'lucide-react';
import type { CardListing, Category, Template } from '../../lib/community-client';

/** The shared loading placeholder (canonical-shell's skeleton), at the card's reserved size so nothing jumps when data arrives. */
export function CardSkeleton({ project = false, template = false }: { project?: boolean; template?: boolean }) {
  if (project) {
    return (
      <article className="coden-dashboard-project-card" aria-hidden="true">
        <span className="coden-dashboard-project-card-link">
          <span className="coden-dashboard-project-preview coden-ui-skeleton coden-community-shimmer" />
          <span className="coden-dashboard-project-card-meta">
            <span className="coden-dashboard-project-card-copy coden-dashboard-skeleton-copy">
              <span className="coden-ui-skeleton coden-community-shimmer" style={{ height: 14, width: '70%' }} />
              <span className="coden-ui-skeleton coden-community-shimmer" style={{ height: 11, width: '45%' }} />
            </span>
          </span>
          {template && <span className="coden-community-template-actions" aria-hidden="true"><span className="coden-ui-skeleton coden-community-shimmer" style={{ height: 36, width: 110, borderRadius: 10 }} /><span className="coden-ui-skeleton coden-community-shimmer" style={{ height: 36, width: 76, borderRadius: 10 }} /></span>}
        </span>
      </article>
    );
  }
  return (
    <div className="coden-community-card is-skeleton" aria-hidden="true">
      <div className="coden-community-thumb coden-ui-skeleton coden-community-shimmer" />
      <div className="coden-community-card-body">
        <div className="coden-ui-skeleton coden-community-shimmer" style={{ height: 14, width: '70%' }} />
        <div className="coden-ui-skeleton coden-community-shimmer" style={{ height: 11, width: '45%' }} />
      </div>
    </div>
  );
}

export function categoryLabel(categories: Category[], slug: string) {
  return categories.find(category => category.slug === slug)?.label || 'Autre';
}

export function Thumb({ src, alt, fallback }: { src: string | null; alt: string; fallback?: ReactNode }) {
  return (
    <div className="coden-community-thumb">
      {src
        // Dimensions are reserved (16/10); lazy and async so a long grid never blocks the page.
        ? <img src={src} alt={alt} width={800} height={500} loading="lazy" decoding="async" draggable={false} />
        : <div className="coden-community-thumb-empty" role="img" aria-label={alt}>{fallback}</div>}
    </div>
  );
}

export function ListingCard({ listing, href }: { listing: CardListing; href: string }) {
  return (
    <article className="coden-dashboard-project-card coden-community-project-card">
      <a className="coden-dashboard-project-card-link" href={href} aria-label={`${listing.title}, par ${listing.creator}`}>
        <span className="coden-dashboard-project-preview coden-community-project-preview">
          {listing.thumbnail
            ? <img src={listing.thumbnail} alt={listing.thumbnailAlt} width={800} height={500} loading="lazy" decoding="async" draggable={false} />
            : <span className="coden-community-thumb-empty" role="img" aria-label={listing.thumbnailAlt}><LayoutTemplate size={22} aria-hidden="true" /></span>}
        </span>
        <span className="coden-dashboard-project-card-meta">
          <span className="coden-dashboard-project-card-copy">
            <strong title={listing.title}>{listing.title}</strong>
            <small>Par {listing.creator}</small>
          </span>
          <span className="coden-dashboard-project-open" aria-hidden="true"><ArrowRight size={15} /></span>
        </span>
      </a>
    </article>
  );
}

export function TemplateCard({ template, onUse, onUpgrade, busy, onToggleLike, likeBusy }: { template: Template; onUse: () => void; onUpgrade: () => void; busy: boolean; onToggleLike: () => void; likeBusy: boolean }) {
  return (
    <article className="coden-dashboard-project-card coden-community-project-card coden-community-template-card">
      <div className="coden-dashboard-project-card-link">
        <span className="coden-dashboard-project-preview coden-community-project-preview">
          {template.thumbnail
            ? <img src={template.thumbnail} alt={`Aperçu du template ${template.title}`} width={800} height={500} loading="lazy" decoding="async" draggable={false} />
            : <span className="coden-community-thumb-empty" role="img" aria-label={`Aperçu du template ${template.title}`}><LayoutTemplate size={22} aria-hidden="true" /></span>}
        </span>
        <span className="coden-dashboard-project-card-meta">
          <span className="coden-dashboard-project-card-copy">
            <strong title={template.title}>{template.title}</strong>
            <small title={template.description}>{template.description || 'Template officiel Coden'}</small>
          </span>
          <button type="button" className={`coden-community-template-like${template.liked ? ' is-on' : ''}`} onClick={onToggleLike} disabled={likeBusy} aria-label={`${template.liked ? 'Retirer votre j’aime de' : 'Aimer'} ${template.title} · ${template.likes} j’aime`} aria-pressed={template.liked}>
            <Heart size={14} fill={template.liked ? 'currentColor' : 'none'} aria-hidden="true" /><span>{template.likes}</span>
          </button>
        </span>
        <span className="coden-community-template-actions">
          {template.available
            ? <button type="button" className="coden-community-button is-primary" onClick={onUse} disabled={busy}>{busy ? 'Création…' : template.kind === 'app' ? 'Remixer' : 'Utiliser'}</button>
            : <button type="button" className="coden-community-button is-primary" onClick={onUpgrade}>Voir les offres</button>}
          {template.previewUrl && <a className="coden-community-button" href={template.previewUrl} target="_blank" rel="noopener noreferrer">Aperçu</a>}
        </span>
      </div>
    </article>
  );
}

/** Calls `onVisible` when the sentinel scrolls near the viewport: the next page loads before the person reaches the end. */
export function Sentinel({ onVisible, disabled }: { onVisible: () => void; disabled: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node || disabled || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) onVisible(); }, { rootMargin: '600px 0px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [onVisible, disabled]);
  return <div ref={ref} className="coden-community-sentinel" aria-hidden="true" />;
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="coden-community-empty" role="status">
      <strong>{title}</strong>
      <span>{body}</span>
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="coden-community-empty is-error" role="alert">
      <strong>Un souci est survenu</strong>
      <span>{message}</span>
      <button type="button" className="coden-community-button" onClick={onRetry}>Réessayer</button>
    </div>
  );
}
