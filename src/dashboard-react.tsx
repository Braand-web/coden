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
  ChevronLeft,
  ChevronRight,
  FileCode2,
  Menu,
  Plus,
  Search,
  X,
} from 'lucide-react';
import { apiFetch } from './lib/api';
import { isLocalPreviewEnabled } from './local-preview';
import './styles/dashboard-react.css';

type ProfileResponse = { user?: { email?: string; name?: string; full_name?: string } };

type DashboardProject = {
  id: string;
  name: string;
  status?: string;
  preview_status?: string;
  publish_status?: string;
  live_url?: string;
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
        { id: 'local-preview-project-001', name: 'Pulseboard', status: 'ready', updated_at: new Date().toISOString() },
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
  const displayName = profile?.user?.name || profile?.user?.full_name || profile?.user?.email?.split('@')[0] || 'Compte';

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
          <a className="coden-dashboard-account" href="/auth.html?redirect=%2Fdashboard.html" aria-label={`Compte : ${displayName}`}>
            <span className="coden-dashboard-avatar">{displayName.slice(0, 1).toUpperCase()}</span>
            <span>{displayName}</span>
          </a>
        </div>
      </aside>
    </>
  );
}

function ProjectRow({ project }: { project: DashboardProject }) {
  const state = projectState(project);
  return (
    <article className="coden-dashboard-project-row">
      <a className="coden-dashboard-project-main" href={builderUrl(project.id)}>
        <span className="coden-dashboard-project-icon" aria-hidden="true"><FileCode2 size={18} /></span>
        <span className="coden-dashboard-project-copy">
          <strong>{project.name}</strong>
          <span>Modifié {relativeTime(project.updated_at || project.created_at)}</span>
        </span>
        <span className={`coden-dashboard-project-status is-${state.key}`}>{state.label}</span>
        <ArrowRight className="coden-dashboard-project-arrow" size={17} aria-hidden="true" />
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
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const wasSidebarOpen = useRef(false);
  const { data: profile } = useQuery({ queryKey: ['coden-profile'], queryFn: fetchProfile });
  const projectsQuery = useQuery({ queryKey: ['coden-projects'], queryFn: fetchProjects });
  const projects = projectsQuery.data?.projects || [];
  const filteredProjects = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('fr');
    if (!query) return projects;
    return projects.filter((project) => project.name.toLocaleLowerCase('fr').includes(query));
  }, [projects, search]);

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
          <section className="coden-dashboard-heading">
            <div>
              <p>Espace de travail</p>
              <h1>Mes projets</h1>
            </div>
            <span>{projects.length} projet{projects.length === 1 ? '' : 's'}</span>
          </section>

          <label className="coden-dashboard-search">
            <Search size={17} aria-hidden="true" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} type="search" placeholder="Rechercher un projet" aria-label="Rechercher un projet" />
          </label>

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
            {!projectsQuery.isLoading && !projectsQuery.isError && filteredProjects.map((project) => <ProjectRow key={project.id} project={project} />)}
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
