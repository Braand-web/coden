import { useEffect, useRef, useState } from 'react';
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
  ArrowUp,
  Boxes,
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  Menu,
  Paperclip,
  Plus,
  Search,
  X,
  type LucideIcon,
} from 'lucide-react';
import { apiFetch } from './lib/api';
import { isLocalPreviewEnabled } from './local-preview';
import { startCreateProjectFlow, type CreateProjectFlowMode } from './services/create-project-flow';
import './styles/dashboard-react.css';

type ProfileResponse = { user?: { email?: string; name?: string; full_name?: string } };

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

function DashboardNotFound() {
  return <DashboardHome />;
}

const rootRoute = createRootRoute({ component: RootLayout, notFoundComponent: DashboardNotFound });
const dashboardRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: DashboardHome });
const routeTree = rootRoute.addChildren([dashboardRoute]);
const router = createRouter({ routeTree, basepath: '/dashboard.html', defaultPreload: 'intent' });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

async function fetchProfile() {
  if (isLocal) return null;
  return apiFetch<ProfileResponse>('/api/auth/me');
}

function CodenMark({ size = 38 }: { size?: number }) {
  return <img className="coden-orygin-mark" src="/favicon.svg" width={size} height={size} alt="" aria-hidden="true" />;
}

function SidebarItem({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick?: () => void }) {
  return (
    <button className="coden-orygin-sidebar-item" type="button" onClick={onClick}>
      <Icon className="coden-orygin-sidebar-icon" size={18} strokeWidth={1.7} aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}

function Sidebar({ open, collapsed, onClose, onToggleCollapsed, onFocusComposer }: { open: boolean; collapsed: boolean; onClose: () => void; onToggleCollapsed: () => void; onFocusComposer: () => void }) {
  const { data: profile } = useQuery({ queryKey: ['coden-profile'], queryFn: fetchProfile, enabled: !isLocal });
  const displayName = profile?.user?.name || profile?.user?.full_name || profile?.user?.email?.split('@')[0];
  const firstNavItemRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open && window.matchMedia('(max-width: 767px)').matches) firstNavItemRef.current?.focus();
  }, [open]);

  const goStudio = () => window.location.assign('/builder.html?new=1');

  return (
    <>
      {open && <button className="coden-orygin-backdrop" type="button" aria-label="Fermer le menu" onClick={onClose} />}
      <aside id="coden-orygin-sidebar" className={`coden-orygin-sidebar${open ? ' is-open' : ''}${collapsed ? ' is-collapsed' : ''}`} aria-label="Navigation Coden">
        <div className="coden-orygin-brand-row">
          <a href="/dashboard.html" className="coden-orygin-brand" aria-label="Coden, accueil">
            <CodenMark size={34} />
            <span>CODEN</span>
          </a>
          <button className="coden-orygin-icon-button coden-orygin-collapse" type="button" aria-label={collapsed ? 'Étendre la barre latérale' : 'Rétracter la barre latérale'} aria-pressed={collapsed} onClick={onToggleCollapsed}>
            {collapsed ? <ChevronRight size={18} aria-hidden="true" /> : <ChevronLeft size={18} aria-hidden="true" />}
          </button>
          <button className="coden-orygin-icon-button coden-orygin-close" type="button" aria-label="Fermer le menu" onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <button className="coden-orygin-new-chat" type="button" onClick={() => { onClose(); onFocusComposer(); }}>
          <Plus size={18} strokeWidth={2} aria-hidden="true" />
          <span>Nouveau chat</span>
        </button>

        <nav className="coden-orygin-nav" aria-label="Navigation principale">
          <button ref={firstNavItemRef} className="coden-orygin-sidebar-item" type="button" onClick={() => { onClose(); onFocusComposer(); }}>
            <Search className="coden-orygin-sidebar-icon" size={18} strokeWidth={1.7} aria-hidden="true" />
            <span>Recherche</span>
          </button>
          <SidebarItem icon={Boxes} label="Coden Studio" onClick={() => { onClose(); goStudio(); }} />
        </nav>

        <div className="coden-orygin-sidebar-bottom">
          <SidebarItem icon={Search} label="Modèles" onClick={() => setDashboardStatus('Les modèles sont disponibles depuis un projet actif.')} />
          <div className="coden-orygin-divider" />
          <a className="coden-orygin-account" href="/auth.html?redirect=%2Fdashboard.html">
            <span className="coden-orygin-avatar">{displayName ? displayName.slice(0, 1).toUpperCase() : 'C'}</span>
            <span>{displayName || 'Se connecter'}</span>
          </a>
        </div>
      </aside>
    </>
  );
}

function Composer({ onStatus }: { onStatus: (value: string) => void }) {
  const [value, setValue] = useState('');
  const [mode] = useState<CreateProjectFlowMode>('auto');
  const [busy, setBusy] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const focus = () => textareaRef.current?.focus();
    window.addEventListener('coden:focus-dashboard-composer', focus);
    return () => window.removeEventListener('coden:focus-dashboard-composer', focus);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        textareaRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const submit = async () => {
    const prompt = value.trim();
    if (!prompt || busy) return;
    if (isLocal) {
      onStatus('La génération est désactivée dans l’aperçu local.');
      return;
    }
    setBusy(true);
    onStatus('Préparation…');
    try {
      await startCreateProjectFlow({ prompt, mode, model: 'auto', source: 'dashboard' }, {
        createProject: true,
        onStatus: (status) => onStatus(status === 'creating_project' ? 'Création du projet…' : status === 'opening_builder' ? 'Ouverture du Builder…' : 'Préparation…'),
      });
    } catch (error) {
      onStatus(error instanceof Error ? error.message : 'Le projet n’a pas pu être créé.');
      setBusy(false);
    }
  };

  return (
    <form className={`coden-orygin-composer${busy ? ' is-busy' : ''}`} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <textarea
        ref={textareaRef}
        value={value}
        rows={2}
        aria-label="Décrire l’application à construire"
        placeholder="Demander à Coden…"
        disabled={busy}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submit(); }
        }}
      />
      <div className="coden-orygin-composer-actions">
        <button className="coden-orygin-attach" type="button" aria-label="Ajouter une pièce jointe" disabled={busy} onClick={() => onStatus('Les pièces jointes sont disponibles dans le Builder.') }>
          <Paperclip size={18} strokeWidth={1.7} aria-hidden="true" />
        </button>
        <span className="coden-orygin-composer-name">Coden</span>
        <button className="coden-orygin-send" type="submit" aria-label="Envoyer" disabled={isLocal || busy || !value.trim()}>
          {busy ? <LoaderCircle size={18} className="coden-orygin-spin" aria-hidden="true" /> : <ArrowUp size={18} strokeWidth={2.4} aria-hidden="true" />}
        </button>
      </div>
    </form>
  );
}

let latestStatusSetter: ((message: string) => void) | null = null;
function setDashboardStatus(message: string) { latestStatusSetter?.(message); }

function DashboardHome() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return window.localStorage.getItem('coden-dashboard-sidebar-collapsed') === 'true'; } catch { return false; }
  });
  const [status, setStatus] = useState('');
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const wasSidebarOpen = useRef(false);
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    latestStatusSetter = setStatus;
    document.body.dataset.codenReactDashboard = 'true';
    return () => { latestStatusSetter = null; delete document.body.dataset.codenReactDashboard; };
  }, []);

  useEffect(() => {
    try { window.localStorage.setItem('coden-dashboard-sidebar-collapsed', String(sidebarCollapsed)); } catch { /* storage may be unavailable */ }
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
    <div className="coden-orygin-dashboard">
      <Sidebar open={sidebarOpen} collapsed={sidebarCollapsed} onClose={() => setSidebarOpen(false)} onToggleCollapsed={() => setSidebarCollapsed((value) => !value)} onFocusComposer={() => window.dispatchEvent(new Event('coden:focus-dashboard-composer'))} />
      <main ref={mainRef} id="coden-dashboard-main" className="coden-orygin-main">
        <header className="coden-orygin-topbar">
          <button ref={menuTriggerRef} className="coden-orygin-icon-button coden-orygin-menu-trigger" type="button" aria-label="Ouvrir le menu" aria-expanded={sidebarOpen} aria-controls="coden-orygin-sidebar" onClick={() => setSidebarOpen(true)}><Menu size={20} aria-hidden="true" /></button>
          <span className="coden-orygin-topbar-title">Nouvelle conversation</span>
        </header>
        <div className="coden-orygin-content">
          <div className="coden-orygin-main-column">
            <div className="coden-orygin-hero">
              <CodenMark size={58} />
              <h1>Que veux-tu accomplir&nbsp;?</h1>
            </div>
            <Composer onStatus={setStatus} />
            <p className="coden-orygin-login-note">La connexion sera demandée au moment d’envoyer.</p>
            {status && <p className="coden-orygin-status" role="status">{status}</p>}
          </div>
        </div>
      </main>
    </div>
  );
}

const rootElement = document.getElementById('coden-dashboard-react-root');
if (rootElement) createRoot(rootElement).render(<RouterProvider router={router} />);
