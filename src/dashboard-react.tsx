import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileCode2,
  LogOut,
  Menu,
  Plus,
  Search,
  Settings,
  WandSparkles,
  X,
} from 'lucide-react';
import { apiFetch } from './lib/api';
import { isLocalPreviewEnabled } from './local-preview';
import { ensureSettingsPanel, openSettings } from './settings-panel';
import {
  formatCreateProjectFlowStatus,
  startCreateProjectFlow,
  type CreateProjectFlowStatus,
} from './services/create-project-flow';
import { PromptInput } from './components/ui/ai-chat-input';
import { initCodenMotion } from './coden-motion';
import { initCodenNavigationTransitions } from './navigation-transitions';
import { initThemeController } from './theme-controller';
import './styles/dashboard-react.css';
import './styles/coden-horizon-system.css';
import './styles/coden-composer.css';

type ProfileResponse = {
  user?: { email?: string; name?: string; full_name?: string };
  plan?: { key?: string; label?: string };
};

type DashboardProject = {
  id: string;
  name: string;
  status?: string;
  preview_status?: string;
  publish_status?: string;
  live_url?: string;
  preview_html?: string;
  prompt?: string;
  template?: string;
  updated_at?: string;
  created_at?: string;
};

type ProjectsResponse = { projects?: DashboardProject[] };

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
  },
});

const isLocal = isLocalPreviewEnabled();

// The dashboard is a React entrypoint, so it does not pass through the public
// page bootstrap. Install the same motion, navigation and theme contract here
// before the first route is rendered.
initCodenMotion();
initCodenNavigationTransitions();
initThemeController();

function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
    </QueryClientProvider>
  );
}

const rootRoute = createRootRoute({ component: RootLayout, notFoundComponent: DashboardHome });
const dashboardRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: DashboardHome });
const routeTree = rootRoute.addChildren([dashboardRoute]);
const router = createRouter({ routeTree, basepath: '/dashboard.html', defaultPreload: 'intent' });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

async function fetchProfile() {
  if (isLocal) return { user: { name: 'Aperçu local' } } as ProfileResponse;
  return apiFetch<ProfileResponse>('/api/auth/me');
}

async function fetchProjects() {
  if (isLocal) {
    return {
      projects: [
        {
          id: 'local-preview-project-001',
          name: 'Pulseboard',
          status: 'ready',
          preview_status: 'verified',
          preview_html: '<!doctype html><html><body style="margin:0;font-family:system-ui;background:var(--surface);color:var(--foreground)"><main style="padding:28px"><nav style="display:flex;justify-content:space-between"><b>Pulseboard</b><span>Dashboard</span></nav><h1 style="margin-top:42px;font-size:34px">Votre activité, en un coup d’œil.</h1><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:28px"><div style="padding:18px;background:var(--surface);border-radius:12px">Projets<br><b style="font-size:24px">12</b></div><div style="padding:18px;background:var(--surface);border-radius:12px">Tâches<br><b style="font-size:24px">38</b></div><div style="padding:18px;background:var(--surface);border-radius:12px">Équipe<br><b style="font-size:24px">7</b></div></div></main></body></html>',
          updated_at: new Date().toISOString(),
        },
        { id: 'local-preview-project-002', name: 'TaskFlow', status: 'draft', updated_at: new Date(Date.now() - 86_400_000).toISOString() },
      ],
    } as ProjectsResponse;
  }
  return apiFetch<ProjectsResponse>('/api/projects');
}

function appUrl(path: string) {
  if (!isLocal) return path;
  return `${path}${path.includes('?') ? '&' : '?'}localPreview=1`;
}

function builderUrl(projectId?: string) {
  return appUrl(projectId
    ? `/builder.html?project=${encodeURIComponent(projectId)}&source=dashboard`
    : '/builder.html?new=1&source=dashboard');
}

function CodenMark({ size = 28 }: { size?: number }) {
  return <img className="coden-dashboard-mark" src="/favicon.svg" width={size} height={size} alt="" aria-hidden="true" />;
}

function relativeTime(value?: string) {
  if (!value) return 'récemment';
  const delta = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(delta) || delta < 60_000) return 'à l’instant';
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.floor(hours / 24);
  return `il y a ${days} j`;
}

/** One answer to "whose account is this", so the sidebar and the cards agree. */
function accountDisplayName(profile?: ProfileResponse | null) {
  return profile?.user?.name || profile?.user?.full_name || profile?.user?.email?.split('@')[0] || 'Compte';
}

function projectState(project: DashboardProject) {
  const state = `${project.status || ''} ${project.preview_status || ''} ${project.publish_status || ''}`.toLowerCase();
  if (project.live_url || /publish|deploy|live/.test(state)) return { key: 'published', label: 'En ligne' };
  if (/building|generating|running/.test(state)) return { key: 'building', label: 'En cours' };
  if (/fix|error|failed|blocked/.test(state)) return { key: 'issue', label: 'À vérifier' };
  if (/ready|verified|complete/.test(state)) return { key: 'ready', label: 'Prêt' };
  return { key: 'draft', label: 'Brouillon' };
}

function Sidebar({
  open,
  collapsed,
  projects,
  profile,
  onClose,
  onToggleCollapsed,
}: {
  open: boolean;
  collapsed: boolean;
  projects: DashboardProject[];
  profile?: ProfileResponse | null;
  onClose: () => void;
  onToggleCollapsed: () => void;
}) {
  const [accountOpen, setAccountOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const displayName = accountDisplayName(profile);
  const email = profile?.user?.email || 'Compte Coden';

  useEffect(() => {
    const closeMenu = (event: MouseEvent) => {
      if (!accountMenuRef.current?.contains(event.target as Node)) setAccountOpen(false);
    };
    document.addEventListener('mousedown', closeMenu);
    return () => document.removeEventListener('mousedown', closeMenu);
  }, []);

  const showSettings = () => {
    setAccountOpen(false);
    ensureSettingsPanel();
    openSettings('profile');
  };

  return (
    <>
      {open && <button className="coden-dashboard-backdrop" type="button" aria-label="Fermer le menu" onClick={onClose} />}
      <aside className={`coden-dashboard-sidebar${open ? ' is-open' : ''}${collapsed ? ' is-collapsed' : ''}`} aria-label="Navigation Coden">
        <div className="coden-dashboard-brand-row">
          <a className="coden-dashboard-brand" href="/dashboard.html" aria-label="Coden, projets">
            <CodenMark />
            <span>Coden</span>
          </a>
          <button className="coden-dashboard-icon-button coden-dashboard-collapse" type="button" aria-label={collapsed ? 'Étendre la barre latérale' : 'Rétracter la barre latérale'} onClick={onToggleCollapsed}>
            {collapsed ? <ChevronRight size={17} aria-hidden="true" /> : <ChevronLeft size={17} aria-hidden="true" />}
          </button>
          <button className="coden-dashboard-icon-button coden-dashboard-close" type="button" aria-label="Fermer le menu" onClick={onClose}>
            <X size={17} aria-hidden="true" />
          </button>
        </div>

        <a className="coden-dashboard-new-project" href={builderUrl()} aria-label="Nouveau projet" onClick={onClose}>
          <Plus size={17} aria-hidden="true" />
          <span>Nouveau projet</span>
        </a>

        <nav className="coden-dashboard-project-nav" aria-label="Projets récents">
          <span className="coden-dashboard-nav-label">Projets</span>
          <div className="coden-dashboard-project-links">
            {projects.slice(0, 7).map((project) => (
              <a key={project.id} className="coden-dashboard-project-link" href={builderUrl(project.id)} title={project.name} onClick={onClose}>
                <FileCode2 size={16} aria-hidden="true" />
                <span>{project.name}</span>
              </a>
            ))}
            {!projects.length && <span className="coden-dashboard-no-project">Aucun projet</span>}
          </div>
        </nav>

        <div className="coden-dashboard-sidebar-bottom">
          <div className="coden-dashboard-account-wrap" ref={accountMenuRef}>
            {accountOpen && (
              <div className="coden-dashboard-account-menu" role="menu">
                <button type="button" role="menuitem" onClick={showSettings}>
                  <Settings size={16} aria-hidden="true" />
                  Paramètres
                </button>
                <button type="button" role="menuitem" data-auth-logout>
                  <LogOut size={16} aria-hidden="true" />
                  Se déconnecter
                </button>
              </div>
            )}
            <button
              className="coden-dashboard-account"
              type="button"
              aria-label={`Compte : ${displayName}`}
              aria-haspopup="menu"
              aria-expanded={accountOpen}
              onClick={() => setAccountOpen((value) => !value)}
            >
              <span className="coden-dashboard-avatar">{displayName.slice(0, 1).toUpperCase()}</span>
              <span className="coden-dashboard-account-copy">
                <strong>{displayName}</strong>
                <small>{email}</small>
              </span>
              <ChevronDown size={15} aria-hidden="true" />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

/*
 * A thumbnail must not need the application to boot successfully.
 *
 * The preview frame is sandboxed with `allow-scripts` and deliberately WITHOUT
 * `allow-same-origin`: granting both to a srcDoc served from our own origin
 * would let the framed document reach into this page and drop its own sandbox,
 * which is an absurd price for a picture. The cost of that correct choice is an
 * opaque origin, where merely touching `localStorage` throws a SecurityError
 * synchronously — and a generated app that reads storage while mounting dies
 * before it paints anything.
 *
 * That is not hypothetical: the stored preview for this account's most recent
 * project is 60KB carrying `<script>`, `localStorage` and `sessionStorage`, and
 * its tile rendered as an empty dark rectangle.
 *
 * So the frame gets an in-memory stand-in, installed before the app's own
 * scripts run. A thumbnail has nothing to persist; it only has to survive
 * asking.
 */
const PREVIEW_STORAGE_SHIM = `<script>(function(){
  try {
    var store = function () {
      var data = Object.create(null);
      return {
        getItem: function (k) { return k in data ? data[k] : null; },
        setItem: function (k, v) { data[k] = String(v); },
        removeItem: function (k) { delete data[k]; },
        clear: function () { data = Object.create(null); },
        key: function (i) { return Object.keys(data)[i] || null; },
        get length() { return Object.keys(data).length; },
      };
    };
    for (var i = 0; i < 2; i++) {
      var name = i === 0 ? 'localStorage' : 'sessionStorage';
      var value = store();
      try { Object.defineProperty(window, name, { value: value, configurable: true, writable: false }); }
      catch (e) { try { window[name] = value; } catch (ignored) {} }
    }
  } catch (e) {}
})();</scr` + `ipt>`;

/** Put the shim before anything the document runs of its own. */
function previewDocumentWithStorageShim(html: string): string {
  const head = html.search(/<head[^>]*>/i);
  if (head >= 0) {
    const insertAt = html.indexOf('>', head) + 1;
    return html.slice(0, insertAt) + PREVIEW_STORAGE_SHIM + html.slice(insertAt);
  }
  // No <head>: the browser builds one, and a leading script still runs first.
  return PREVIEW_STORAGE_SHIM + html;
}

function ProjectCard({ project, owner }: { project: DashboardProject; owner: { initial: string; name: string } }) {
  const previewHtml = project.preview_html?.trim();
  const isErrorPreview = Boolean(previewHtml && /data-coden-preview-error\s*=\s*["']true/i.test(previewHtml));
  const hasRenderedPreview = Boolean(previewHtml && !isErrorPreview);
  const liveUrl = project.live_url?.trim();
  const hasLivePreview = Boolean(!hasRenderedPreview && liveUrl && /^https?:\/\//i.test(liveUrl));
  const state = isErrorPreview ? { key: 'issue', label: 'À vérifier' } : projectState(project);
  const fallbackMessage = /building|generating|running/i.test(`${project.status || ''} ${project.preview_status || ''}`)
    ? 'Aperçu en préparation'
    : isErrorPreview
      ? 'Aperçu à corriger'
      : 'Générez le projet pour afficher son aperçu';
  return (
    <article className="coden-dashboard-project-card">
      <a className="coden-dashboard-project-card-link" href={builderUrl(project.id)} aria-label={`Ouvrir le projet ${project.name}`}>
        <span className="coden-dashboard-project-preview">
          {/*
            * The placeholder is the floor, not the alternative.
            *
            * It used to render only when there was no preview, so a card whose
            * iframe came up blank — an app whose scripts cannot run under this
            * sandbox, a document that paints nothing above the fold — showed a
            * dark hole with a badge floating in it, and read as broken rather
            * than as pending. Drawing it underneath means the worst a failed
            * preview can look is the same as one that has not been generated.
            */}
          <span className="coden-dashboard-project-fallback" aria-hidden="true">
            <span><FileCode2 size={25} /></span>
            <small>{fallbackMessage}</small>
          </span>
          {hasRenderedPreview ? (
            <iframe
              title={`Aperçu de ${project.name}`}
              srcDoc={previewDocumentWithStorageShim(previewHtml!)}
              loading="lazy"
              sandbox="allow-scripts"
              tabIndex={-1}
            />
          ) : hasLivePreview ? (
            <iframe
              title={`Aperçu en ligne de ${project.name}`}
              src={liveUrl}
              loading="lazy"
              sandbox="allow-scripts allow-forms"
              referrerPolicy="no-referrer"
              tabIndex={-1}
            />
          ) : null}
          {/*
            * One badge, one axis: where the project is, never what the tile
            * happens to be showing. It used to read 'Aperçu' whenever a preview
            * rendered and the lifecycle state otherwise, so two cards side by
            * side answered different questions — one told you it had a picture,
            * the other that it was a draft.
            */}
          <span className={`coden-dashboard-project-badge is-${state.key}`}>{state.label}</span>
        </span>
        <span className="coden-dashboard-project-card-meta">
          {/*
            * The circle holds the OWNER, not the project.
            *
            * It used to hold `project.name`'s first letter, nine pixels from
            * the full name it was the first letter of — the card said the same
            * thing twice and truncated "High-end Premium Minimalist Ui" to pay
            * for it. Whose project it is, is a different fact from what it is
            * called, so the slot survives with the answer to the other
            * question.
            */}
          <span className="coden-dashboard-project-card-avatar" title={`Projet de ${owner.name}`} aria-hidden="true">
            {owner.initial}
          </span>
          <span className="coden-dashboard-project-card-copy">
            <strong>{project.name}</strong>
            <small>Modifié {relativeTime(project.updated_at || project.created_at)}</small>
          </span>
          <ArrowRight size={17} aria-hidden="true" />
        </span>
      </a>
    </article>
  );
}

/*
 * The same box as a real card, drawn empty.
 *
 * The grid used to load behind a 160px dashed rectangle reading "Chargement
 * des projets…", which was then replaced by three columns of cards — so every
 * single load ended in a layout jump, and the placeholder had no relationship
 * to what it was a placeholder for.
 *
 * The geometry is what makes this worth having, and it is exact: the tile
 * keeps the card's own 16/10 aspect ratio, and the caption row is driven by
 * the 36px avatar in both states — the two text bars are deliberately shorter
 * than that, so they cannot be what decides the row's height. Same box before
 * and after, nothing moves when the data lands.
 */
function ProjectCardSkeleton() {
  return (
    <article className="coden-dashboard-project-card" aria-hidden="true">
      <span className="coden-dashboard-project-preview coden-skeleton" />
      <span className="coden-dashboard-project-card-meta">
        <span className="coden-skeleton coden-dashboard-skeleton-avatar" />
        <span className="coden-dashboard-project-card-copy">
          <span className="coden-skeleton coden-dashboard-skeleton-line" />
          <span className="coden-skeleton coden-dashboard-skeleton-line is-short" />
        </span>
      </span>
    </article>
  );
}

function DashboardHome() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return window.localStorage.getItem('coden-dashboard-sidebar-collapsed') === 'true'; } catch { return false; }
  });
  const [search, setSearch] = useState('');
  const [prompt, setPrompt] = useState('');
  const [creating, setCreating] = useState(false);
  const [creationStatus, setCreationStatus] = useState('');
  const [projectView, setProjectView] = useState<'all' | 'recent'>('all');
  const [showAllProjects, setShowAllProjects] = useState(false);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const wasSidebarOpen = useRef(false);
  const { data: profile } = useQuery({ queryKey: ['coden-profile'], queryFn: fetchProfile });
  const projectsQuery = useQuery({ queryKey: ['coden-projects'], queryFn: fetchProjects });
  const projects = projectsQuery.data?.projects || [];
  const ownerName = accountDisplayName(profile);
  const owner = useMemo(
    () => ({ name: ownerName, initial: ownerName.slice(0, 1).toLocaleUpperCase('fr') }),
    [ownerName],
  );
  const filteredProjects = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('fr');
    return projects.filter((project) => {
      const matchesQuery = !query || project.name.toLocaleLowerCase('fr').includes(query);
      if (!matchesQuery) return false;
      if (projectView === 'recent') {
        const updated = new Date(project.updated_at || project.created_at || 0).getTime();
        return Number.isFinite(updated) && Date.now() - updated < 1000 * 60 * 60 * 24 * 7;
      }
      return true;
    });
  }, [projects, projectView, search]);
  const visibleProjects = showAllProjects ? filteredProjects : filteredProjects.slice(0, 6);

  /*
   * Which filter is hiding the rest, if any. Checked in the order a user
   * would undo them: the query they typed, then the tab they clicked, then
   * the cap they never chose.
   */
  const hiddenProjects = useMemo(() => {
    if (projects.length <= visibleProjects.length) return null;
    if (search.trim()) {
      return {
        reason: `Il ne correspond pas à « ${search.trim()} ».`,
        action: 'Effacer la recherche',
        onReveal: () => setSearch(''),
      };
    }
    if (projectView === 'recent') {
      return {
        reason: 'Cet onglet ne montre que les sept derniers jours.',
        action: 'Voir tous les projets',
        onReveal: () => setProjectView('all'),
      };
    }
    return {
      reason: `${projects.length - visibleProjects.length} autre${projects.length - visibleProjects.length === 1 ? '' : 's'} projet${projects.length - visibleProjects.length === 1 ? '' : 's'} ne tiennent pas dans cette grille.`,
      action: 'Tout parcourir',
      onReveal: () => setShowAllProjects(true),
    };
  }, [projects.length, visibleProjects.length, projectView, search]);

  const createFromPrompt = async (text: string, meta: { model: string; effort: string }) => {
    const request = text.trim();
    if (!request || creating) return;
    setCreating(true);
    setCreationStatus(formatCreateProjectFlowStatus('preparing', 'fr'));
    if (isLocal) {
      window.setTimeout(() => {
        setCreationStatus('Le parcours est prêt. La création réelle reste désactivée dans cet aperçu local.');
        setCreating(false);
      }, 450);
      return;
    }
    try {
      await startCreateProjectFlow(
        {
          prompt: request,
          mode: 'auto',
          source: 'dashboard',
          model: meta.model,
          effort: meta.effort,
        },
        {
          onStatus: (status: CreateProjectFlowStatus) => {
            setCreationStatus(formatCreateProjectFlowStatus(status, 'fr'));
          },
        },
      );
    } catch (error) {
      setCreationStatus(error instanceof Error ? error.message : 'Le projet n’a pas pu être créé.');
      setCreating(false);
    }
  };

  useEffect(() => {
    try { window.localStorage.setItem('coden-dashboard-sidebar-collapsed', String(sidebarCollapsed)); } catch { /* storage can be unavailable */ }
  }, [sidebarCollapsed]);

  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => { if (event.key === 'Escape' && sidebarOpen) setSidebarOpen(false); };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [sidebarOpen]);

  useEffect(() => {
    if (sidebarOpen) mainRef.current?.setAttribute('inert', '');
    else mainRef.current?.removeAttribute('inert');
    if (wasSidebarOpen.current && !sidebarOpen) menuTriggerRef.current?.focus();
    wasSidebarOpen.current = sidebarOpen;
  }, [sidebarOpen]);

  return (
    <div className="coden-dashboard-shell">
      <Sidebar
        open={sidebarOpen}
        collapsed={sidebarCollapsed}
        projects={projects}
        profile={profile}
        onClose={() => setSidebarOpen(false)}
        onToggleCollapsed={() => setSidebarCollapsed((value) => !value)}
      />

      <main ref={mainRef} id="coden-dashboard-main" className="coden-dashboard-main">
        <header className="coden-dashboard-topbar">
          <button ref={menuTriggerRef} className="coden-dashboard-icon-button coden-dashboard-menu-trigger" type="button" aria-label="Ouvrir le menu" aria-expanded={sidebarOpen} onClick={() => setSidebarOpen(true)}>
            <Menu size={19} aria-hidden="true" />
          </button>
          <span className="coden-dashboard-mobile-brand"><CodenMark size={24} /> Coden</span>
          <a className="coden-dashboard-mobile-new" href={builderUrl()}><Plus size={16} aria-hidden="true" /> Nouveau projet</a>
        </header>

        <div className="coden-dashboard-content">
          <section className="coden-dashboard-create" aria-labelledby="dashboard-create-title">
            <span className="coden-dashboard-create-mark" aria-hidden="true">
              <WandSparkles size={20} />
            </span>
            <h1 id="dashboard-create-title">Que voulez-vous créer&nbsp;?</h1>
            <p>Décrivez votre idée. Coden ouvrira un projet prêt à construire dans le Builder.</p>
            {/*
              * The composer is the PromptInput now, on all three surfaces.
              *
              * It opens on this page rather than starting collapsed: the
              * hero's whole job is to invite a prompt, and a 320px pill that
              * has to be clicked before it can be typed into puts a step in
              * front of the only action here.
              */}
            <PromptInput
              className="coden-dashboard-prompt-input"
              placeholder="Créez un CRM moderne, une boutique, un portfolio…"
              value={prompt}
              onChange={setPrompt}
              onSubmit={(text, meta) => { void createFromPrompt(text, meta); }}
              disabled={creating}
              defaultExpanded
              collapsedWidth={560}
              expandedWidth={700}
            />
            <div className="coden-dashboard-create-status" role="status" aria-live="polite">
              {creationStatus}
            </div>
          </section>

          {/*
            * One row, not two.
            *
            * A banner reading "Espace de travail / Mes projets" sat above a
            * toolbar whose first tab also read "Mes projets", so the page
            * spent 90 vertical pixels and two type sizes saying the same
            * words twice before showing a single project. The heading stays
            * for anyone navigating by headings; the eye gets the controls.
            */}
          <div className="coden-dashboard-project-toolbar">
            <h2 className="coden-dashboard-section-title">Mes projets</h2>
            {/* One pill: both of these narrow the same list. */}
            <div className="coden-dashboard-project-controls">
              <label className="coden-dashboard-search">
                <Search size={16} aria-hidden="true" />
                <input value={search} onChange={(event) => setSearch(event.target.value)} type="search" placeholder="Rechercher" aria-label="Rechercher un projet" />
              </label>
              <div className="coden-dashboard-project-filters" role="group" aria-label="Filtrer les projets">
                <button className={projectView === 'all' ? 'is-active' : ''} type="button" onClick={() => setProjectView('all')}>Mes projets</button>
                <button className={projectView === 'recent' ? 'is-active' : ''} type="button" onClick={() => setProjectView('recent')}>Récemment vus</button>
              </div>
            </div>
            {filteredProjects.length > 6 && (
              <button className="coden-dashboard-browse-all" type="button" onClick={() => setShowAllProjects((value) => !value)}>
                {showAllProjects ? 'Réduire' : 'Tout parcourir'}
                <ArrowRight size={15} aria-hidden="true" />
              </button>
            )}
          </div>

          <section className="coden-dashboard-project-list coden-enter-stagger" aria-label="Liste des projets" aria-live="polite">
            {projectsQuery.isLoading && (
              <>
                {/*
                  * Six, because six is what the grid shows before the cap —
                  * a skeleton that stands in for a different number of cards
                  * reintroduces the shift it exists to remove.
                  */}
                <span className="coden-dashboard-loading-label" role="status">Chargement des projets…</span>
                {Array.from({ length: 6 }, (_, index) => <ProjectCardSkeleton key={index} />)}
              </>
            )}
            {projectsQuery.isError && (
              <div className="coden-dashboard-empty" role="alert">
                <strong>Projets indisponibles</strong>
                <span>Actualisez la page pour réessayer.</span>
              </div>
            )}
            {!projectsQuery.isLoading && !projectsQuery.isError && visibleProjects.map((project) => (
              <ProjectCard key={project.id} project={project} owner={owner} />
            ))}
            {!projectsQuery.isLoading && !projectsQuery.isError && !filteredProjects.length && (
              <div className="coden-dashboard-empty">
                <strong>{search ? 'Aucun résultat' : 'Aucun projet'}</strong>
                <span>{search ? 'Essayez une autre recherche.' : 'Créez votre premier projet avec Coden.'}</span>
                {!search && <a href={builderUrl()}>Nouveau projet</a>}
              </div>
            )}
          </section>

          {/*
            * Where the rest of them are.
            *
            * Three things can hide a project from this grid — a search, the
            * seven-day filter, and the six-tile cap — and all three leave the
            * same impression that a project is missing. The note names which
            * one is doing it and hands over the control that undoes it,
            * rather than telling a user their project is elsewhere.
            */}
          {!projectsQuery.isLoading && !projectsQuery.isError && hiddenProjects && (
            <section className="coden-dashboard-project-more">
              <strong>Vous cherchez un autre projet&nbsp;?</strong>
              <span>{hiddenProjects.reason}</span>
              <button type="button" onClick={hiddenProjects.onReveal}>{hiddenProjects.action}</button>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}

const rootElement = document.getElementById('coden-dashboard-react-root');
if (rootElement) createRoot(rootElement).render(<RouterProvider router={router} />);
