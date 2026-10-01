/**
 * Communauté: published apps from everyone, classed by category, plus Coden's official templates.
 * Opened from the dashboard sidebar (#community …). Every text comes back from the server as a plain string and is
 * rendered by React, never as HTML.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { communityApi, communityHash, markCommunitySeen, TABS, type Tab } from '../../lib/community-client';
import { toast } from '../../lib/ui-feedback';
import { CardSkeleton, EmptyState, ErrorState, ListingCard, Sentinel, TemplateCard } from './community-cards';
import ListingDetail from './listing-detail';
import MyListings from './my-listings';
import '../../styles/community.css';

const errorText = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);

export type CommunityPageProps = {
  tab: Tab;
  listingId: string | null;
  navigate: (hash: string) => void;
  projects: Array<{ id: string; name: string }>;
  onUpgrade: () => void;
  onUseTemplate: (prompt: string) => void;
  builderUrl: (projectId: string) => string;
};

export default function CommunityPage({ tab, listingId, navigate, projects, onUpgrade, onUseTemplate, builderUrl }: CommunityPageProps) {
  useEffect(() => { markCommunitySeen(); }, []);
  const categories = useQuery({ queryKey: ['community-categories'], queryFn: communityApi.categories, staleTime: 10 * 60_000, retry: false });

  if (listingId) {
    return <ListingDetail id={listingId} onBack={() => navigate(communityHash({ tab }))} hrefFor={id => communityHash({ listingId: id })} builderUrl={builderUrl} />;
  }
  return (
    <section className="coden-community" aria-labelledby="community-title">
      <header className="coden-community-head">
        <div>
          <h1 id="community-title">Communauté</h1>
          <p>Des apps publiées par les créateurs de Coden, et des templates officiels pour démarrer. Remixez-en une en un clic.</p>
        </div>
      </header>
      <TabBar tab={tab} onChange={next => navigate(communityHash({ tab: next }))} />
      {tab === 'templates' ? <Templates categories={categories.data || []} onUse={onUseTemplate} />
        : tab === 'mine' ? <MyListings projects={projects} onUpgrade={onUpgrade} />
        : <Browse key={tab} tab={tab} categories={categories.data || []} navigate={navigate} />}
    </section>
  );
}

function TabBar({ tab, onChange }: { tab: Tab; onChange: (tab: Tab) => void }) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const onKey = (event: React.KeyboardEvent, index: number) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + TABS.length) % TABS.length;
    refs.current[next]?.focus();
    onChange(TABS[next].id);
  };
  return (
    <div className="coden-community-tabs" role="tablist" aria-label="Sections de la Communauté">
      {TABS.map((item, index) => (
        <button key={item.id} ref={node => { refs.current[index] = node; }} type="button" role="tab" id={`community-tab-${item.id}`} aria-selected={tab === item.id} tabIndex={tab === item.id ? 0 : -1}
          className={tab === item.id ? 'is-active' : ''} onClick={() => onChange(item.id)} onKeyDown={event => onKey(event, index)}>{item.label}</button>
      ))}
    </div>
  );
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => { const timer = window.setTimeout(() => setDebounced(value), ms); return () => window.clearTimeout(timer); }, [value, ms]);
  return debounced;
}

function Browse({ tab, categories, navigate }: { tab: 'discover' | 'trending' | 'recent'; categories: Array<{ slug: string; label: string }>; navigate: (hash: string) => void }) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const q = useDebounced(search.trim(), 300);
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true); const down = () => setOnline(false);
    window.addEventListener('online', up); window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);

  const query = useInfiniteQuery({
    queryKey: ['community-list', tab, category, q],
    queryFn: ({ pageParam }) => communityApi.list({ tab, category: category || undefined, q: q || undefined, cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: last => last.nextCursor,
    retry: false, staleTime: 15_000,
  });
  const items = useMemo(() => query.data?.pages.flatMap(page => page.items) || [], [query.data]);
  const loadMore = useCallback(() => { if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage(); }, [query]);

  return (
    <>
      <div className="coden-community-toolbar">
        <label className="coden-community-search">
          <Search size={15} aria-hidden="true" />
          <input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Rechercher une app, une catégorie, un créateur" aria-label="Rechercher dans la Communauté" maxLength={80} />
        </label>
      </div>
      <div className="coden-community-chips" role="group" aria-label="Catégories">
        <button type="button" className={!category ? 'is-active' : ''} aria-pressed={!category} onClick={() => setCategory('')}>Toutes</button>
        {categories.map(item => (
          <button key={item.slug} type="button" className={category === item.slug ? 'is-active' : ''} aria-pressed={category === item.slug} onClick={() => setCategory(category === item.slug ? '' : item.slug)}>{item.label}</button>
        ))}
      </div>

      {!online && <div className="coden-community-note is-warn" role="status"><p>Vous êtes hors connexion. Les résultats déjà chargés restent affichés.</p></div>}
      {query.isError && !items.length
        ? <ErrorState message={errorText(query.error, 'La Communauté ne se charge pas.')} onRetry={() => { void query.refetch(); }} />
        : query.isLoading
          ? <div className="coden-community-grid" aria-busy="true" aria-label="Chargement">{Array.from({ length: 8 }, (_, index) => <CardSkeleton key={index} />)}</div>
          : items.length === 0
            ? <EmptyState title={q || category ? 'Aucun résultat' : 'Rien à découvrir pour l’instant'} body={q || category ? 'Essayez un autre mot-clé ou une autre catégorie.' : 'Les apps publiées apparaîtront ici après vérification. Soyez la première personne à y figurer.'} />
            : (
              <>
                <div className="coden-community-grid">
                  {items.map(item => <ListingCard key={item.id} listing={item} categories={categories} href={communityHash({ listingId: item.id })} />)}
                  {query.isFetchingNextPage && Array.from({ length: 4 }, (_, index) => <CardSkeleton key={`more-${index}`} />)}
                </div>
                {query.isError && <ErrorState message="La suite ne s’est pas chargée." onRetry={() => { void query.fetchNextPage(); }} />}
                <Sentinel onVisible={loadMore} disabled={!query.hasNextPage || query.isFetchingNextPage || query.isError} />
              </>
            )}
      <span className="coden-sr-only" aria-live="polite">{query.isLoading ? 'Chargement' : `${items.length} apps affichées`}</span>
    </>
  );
}

function Templates({ categories, onUse }: { categories: Array<{ slug: string; label: string }>; onUse: (prompt: string) => void }) {
  const templates = useQuery({ queryKey: ['community-templates'], queryFn: communityApi.templates, retry: false, staleTime: 5 * 60_000 });
  const [busy, setBusy] = useState<string | null>(null);
  const use = async (slug: string) => {
    setBusy(slug);
    try {
      const result = await communityApi.useTemplate(slug);
      onUse(result.prompt);
    } catch (error) {
      toast(errorText(error, 'Ce template n’a pas pu être lancé.'), 'error');
      setBusy(null);
    }
  };
  if (templates.isLoading) return <div className="coden-community-grid" aria-busy="true">{Array.from({ length: 4 }, (_, index) => <CardSkeleton key={index} />)}</div>;
  if (templates.isError) return <ErrorState message={errorText(templates.error, 'Les templates ne se chargent pas.')} onRetry={() => { void templates.refetch(); }} />;
  return (
    <div className="coden-community-grid">
      {(templates.data || []).map(template => <TemplateCard key={template.slug} template={template} categories={categories} busy={busy === template.slug} onUse={() => { void use(template.slug); }} />)}
    </div>
  );
}
