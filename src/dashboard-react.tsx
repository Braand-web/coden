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
  Send,
  Settings,
  Sparkles,
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
import './styles/dashboard-react.css';

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
          preview_html: '<!doctype html><html><body style="margin:0;font-family:system-ui;background:#f7f8fc;color:#182033"><main style="padding:28px"><nav style="display:flex;justify-content:space-between"><b>Pulseboard</b><span>Dashboard</span></nav><h1 style="margin-top:42px;font-size:34px">Votre activité, en un coup d’œil.</h1><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:28px"><div style="padding:18px;background:white;border-radius:12px">Projets<br><b style="font-size:24px">12</b></div><div style="padding:18px;background:white;border-radius:12px">Tâches<br><b style="font-size:24px">38</b></div><div style="padding:18px;background:white;border-radius:12px">Équipe<br><b style="font-size:24px">7</b></div></div></main></body></html>',
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
  const displayName = profile?.user?.name || profile?.user?.full_name || profile?.user?.email?.split('@')[0] || 'Compte';
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
          <a className="coden-dashboard-upgrade" href="/pricing.html?source=dashboard">
            <Sparkles size={15} aria-hidden="true" />
            <span>Upgrade</span>
          </a>
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

function ProjectCard({ project }: { project: DashboardProject }) {
  const state = projectState(project);
  const previewHtml = project.preview_html?.trim();
  return (
    <article className="coden-dashboard-project-card">
      <a className="coden-dashboard-project-card-link" href={builderUrl(project.id)} aria-label={`Ouvrir le projet ${project.name}`}>
        <span className="coden-dashboard-project-preview">
          {previewHtml ? (
            <iframe
              title={`Aperçu de ${project.name}`}
              srcDoc={previewHtml}
              loading="lazy"
              sandbox="allow-scripts"
              tabIndex={-1}
            />
          ) : (
            <span className="coden-dashboard-project-fallback" aria-hidden="true">
              <span><FileCode2 size={25} /></span>
              <strong>{project.name}</strong>
              <small>Aucun aperçu vérifié</small>
            </span>
          )}
          <span className={`coden-dashboard-project-badge is-${state.key}`}>{state.label}</span>
        </span>
        <span className="coden-dashboard-project-card-meta">
          <span className="coden-dashboard-project-card-avatar">{project.name.slice(0, 1).toUpperCase()}</span>
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

  const createFromPrompt = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const request = prompt.trim();
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
        { prompt: request, mode: 'auto', source: 'dashboard' },
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
            <form className="coden-dashboard-composer" onSubmit={createFromPrompt}>
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing) return;
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
                rows={3}
                placeholder="Créez un CRM moderne, une boutique, un portfolio…"
                aria-label="Décrire le projet à créer"
                disabled={creating}
              />
              <div className="coden-dashboard-composer-footer">
                <span><WandSparkles size={14} aria-hidden="true" /> Auto</span>
                <button type="submit" disabled={!prompt.trim() || creating} aria-label="Créer le projet">
                  <Send size={16} aria-hidden="true" />
                </button>
              </div>
            </form>
            <div className="coden-dashboard-create-status" role="status" aria-live="polite">
              {creationStatus}
            </div>
          </section>

          <section className="coden-dashboard-heading">
            <div>
              <p>Espace de travail</p>
              <h2>Mes projets</h2>
            </div>
            <span>{projects.length} projet{projects.length === 1 ? '' : 's'}</span>
          </section>

          <div className="coden-dashboard-project-toolbar">
            <label className="coden-dashboard-search">
              <Search size={17} aria-hidden="true" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} type="search" placeholder="Rechercher" aria-label="Rechercher un projet" />
            </label>
            <div className="coden-dashboard-project-filters" role="group" aria-label="Filtrer les projets">
              <button className={projectView === 'all' ? 'is-active' : ''} type="button" onClick={() => setProjectView('all')}>Mes projets</button>
              <button className={projectView === 'recent' ? 'is-active' : ''} type="button" onClick={() => setProjectView('recent')}>Récemment vus</button>
            </div>
            {filteredProjects.length > 6 && (
              <button className="coden-dashboard-browse-all" type="button" onClick={() => setShowAllProjects((value) => !value)}>
                {showAllProjects ? 'Réduire' : 'Tout parcourir'}
                <ArrowRight size={15} aria-hidden="true" />
              </button>
            )}
          </div>

          <section className="coden-dashboard-project-list" aria-label="Liste des projets" aria-live="polite">
            {projectsQuery.isLoading && (
              <div className="coden-dashboard-loading" role="status">Chargement des projets…</div>
            )}
            {projectsQuery.isError && (
              <div className="coden-dashboard-empty" role="alert">
                <strong>Projets indisponibles</strong>
                <span>Actualisez la page pour réessayer.</span>
              </div>
            )}
            {!projectsQuery.isLoading && !projectsQuery.isError && visibleProjects.map((project) => <ProjectCard key={project.id} project={project} />)}
            {!projectsQuery.isLoading && !projectsQuery.isError && !filteredProjects.length && (
              <div className="coden-dashboard-empty">
                <strong>{search ? 'Aucun résultat' : 'Aucun projet'}</strong>
                <span>{search ? 'Essayez une autre recherche.' : 'Créez votre premier projet avec Coden.'}</span>
                {!search && <a href={builderUrl()}>Nouveau projet</a>}
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

const rootElement = document.getElementById('coden-dashboard-react-root');
if (rootElement) createRoot(rootElement).render(<RouterProvider router={router} />);
