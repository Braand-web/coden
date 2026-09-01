import './styles/coden-light-theme.css';
import './styles/coden-shell.css';
import './styles/modern-shell.css';
import './styles/coherence.css';
import { initThemeController } from './theme-controller';
import './conversion-events';
import { apiFetch } from './lib/api';
import { CodenStreamHttpError, CodenStreamIncompleteError, openCodenStream } from './lib/stream-client';
import { isCodenStreamEvent } from './lib/stream-protocol';
import { getVerifiedSession, refreshVerifiedSession } from './lib/supabase-browser';
import { setVisualEditMode, isVisualEditModeActive, type VisualEditTarget } from './visual-edit-mode';
import { normalizeAiChatInputs } from './ai-chat-input-normalizer';
import { initCodenMotion } from './coden-motion';
import { initCodenNavigationTransitions } from './navigation-transitions';
import {
  consumePendingPromptAttachments,
  initPromptInputActions,
  storePendingPromptAttachments,
  type PendingPromptAttachment,
} from './prompt-input-actions';
import { MODEL_REGISTRY, PROVIDER_META } from './config/ai-models';
import { providerIconSvg } from './model-provider-icons';
import { mountBuilderConversation, type CodenConversationApi } from './builder-conversation-island';
import { mountAgentModeComposer } from './components/agent/agent-mode-composer';
import { openConnectorsPanel } from './connectors-panel';
import { redactSecretPayload, redactSecrets } from './services/secret-redaction';
import { clearCreateProjectFlow, readCreateProjectFlow } from './services/create-project-flow';
import { deriveProjectName } from './services/project-naming';
import { buildExecutionContract } from './services/execution-contract';
import { modeLabel, normalizeAgentMode, type AgentMode } from './services/agent-run-contract';

initThemeController();
import {
  DESIGN_WORKSHOP_OPTIONS,
  buildDesignStudioBrief,
  designWorkshopOptionLabel,
  normalizeDesignWorkshopSettings,
  type DesignWorkshopSettings,
} from './services/design-workshop';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

type ChatMode = AgentMode;
type PromptUiContext = 'chat_simple' | 'clarification_only' | 'planning_only' | 'project_mission' | 'critical_action';
type StudioWorkshop = 'chat' | 'design' | 'decks' | 'media';
type MessageHandle = HTMLElement & { __codenMessageId?: string };
type PlanKey = 'free' | 'pro' | 'scale' | 'enterprise';
type CodenConversationBlock = unknown;
type CodenMessagePart = Record<string, any> & { id?: string; type?: string; text?: string; result?: string };
type CodenFlowChecklistItem = {
  id: string;
  label: string;
  status: 'pending' | 'active' | 'done' | 'failed';
};

function messageTextFromParts(parts: unknown, fallbackContent: unknown = '') {
  if (!Array.isArray(parts)) return String(fallbackContent || '');
  const text = parts
    .map((part) => {
      if (!part || typeof part !== 'object') return '';
      const record = part as { text?: unknown; result?: unknown; content?: unknown };
      return String(record.text ?? record.result ?? record.content ?? '');
    })
    .filter(Boolean)
    .join('\n');
  return text || String(fallbackContent || '');
}

let activePromptAttachments: PendingPromptAttachment[] = [];

type GeneratedFile = {
  path: string;
  content: string;
  language?: string;
};

type ProjectPayload = {
  success: boolean;
  recovery_source?: 'normalized' | 'snapshot' | 'mixed';
  project: {
    id: string;
    name: string;
    slug?: string;
    model_id?: string;
    preview_status?: string;
  };
  files: GeneratedFile[];
  messages?: Array<{ role: string; content: string; parts?: unknown[]; intent?: string }>;
  events?: Array<{ event_type: string; message: string; sequence_number: number; payload?: any; public_payload?: any; status?: string; agent_run_id?: string; created_at?: string }>;
  workspace_state?: WorkspaceState | null;
  preview?: {
    status: string;
    html: string;
  };
  summary?: string;
  text?: string;
  model?: string;
  intent?: { intent: string };
  diff?: { created: string[]; modified: string[]; deleted: string[]; summary: string };
  errors?: Array<{ message: string; file?: string }>;
};

type MediaGeneratePayload = {
  success: boolean;
  status: 'completed' | 'queued' | 'not_configured' | 'locked' | 'failed';
  output: 'marketing_kit' | 'video' | 'image' | 'storyboard';
  settings: MediaSettings;
  model: {
    id: string;
    label: string;
    output: string;
    quality: string;
    min_plan: string;
  };
  estimated_credits: number;
  assets: Array<{ type: 'image' | 'video'; url: string }>;
  text: string;
  preview?: {
    status: string;
    html: string;
  };
};

type BillingWalletResponse = {
  success: boolean;
  plan?: string;
  balance?: number | null;
  buckets?: {
    monthly_credits?: number | null;
    daily_promo_credits?: number | null;
    topup_credits?: number | null;
  };
};

type WorkspaceState = {
  draft_prompt?: string;
  selected_mode?: ChatMode;
  selected_model?: string;
  active_tab?: 'preview' | 'code' | 'database' | 'analysis';
  sidebar_width?: number;
  preview_device?: PreviewDevice;
};

type UserWorkspaceState = {
  last_project_id?: string;
  builder_draft_prompt?: string;
  builder_selected_mode?: ChatMode;
  builder_selected_model?: string;
  builder_active_tab?: 'preview' | 'code' | 'database' | 'analysis';
  builder_preview_device?: PreviewDevice;
};

type PreviewDevice = 'desktop' | 'tablet' | 'mobile';
type EmptyPreviewMode = 'idle' | 'working';
type MediaKind = 'launch_kit' | 'campaign_pack' | 'social_posts' | 'ads_creatives' | 'brand_assets' | 'pitch_one_pager' | 'video_ad' | 'ugc' | 'storyboard' | 'product_image' | 'social_creative' | 'thumbnail';
type MediaFormat = '9:16' | '1:1' | '4:5' | '16:9' | '3:4';
type MediaDuration = '5s' | '8s' | '10s' | '15s' | '30s';
type MediaModelPreference = 'auto' | 'best_quality' | 'fast' | 'seedance' | 'veo' | 'sora' | 'kling' | 'flux' | 'openai_image';

type MediaSettings = {
  kind: MediaKind;
  format: MediaFormat;
  duration: MediaDuration;
  modelPreference: MediaModelPreference;
};

type AiModel = {
  id: string;
  display_name: string;
  tier?: string;
  provider?: string;
  description?: string;
  plan_minimum?: string;
  badges?: {
    new?: boolean;
    fast?: boolean;
    premium?: boolean;
  };
  locked?: boolean;
  capabilities?: Record<string, unknown>;
};

type PublishCheck = {
  key: string;
  label: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
};

type PublishStatusPayload = {
  state: 'not_ready' | 'ready_to_publish' | 'published' | 'changes_unpublished';
  public_url: string;
  custom_domain: string | null;
  current_visitors?: number;
  latest_published_at: string | null;
  project_updated_at: string | null;
  badge_required: boolean;
  checks: PublishCheck[];
  can_publish: boolean;
  has_unpublished_changes: boolean;
};

type PublishApiPayload = {
  success: boolean;
  publish: PublishStatusPayload;
  deployment?: {
    id?: string;
    status?: string;
    public_url?: string;
    deployment_url?: string;
    custom_domain?: string | null;
    created_at?: string;
  } | null;
};

type AiModelProviderGroup = {
  provider: string;
  meta: {
    label: string;
    color: string;
    textColor: string;
    icon: string;
  };
  models: AiModel[];
};

type AnalysisPayload = {
  current_visitors: number;
  metrics: {
    visitors: number;
    pageviews: number;
    views_per_visit: number;
    visit_duration_seconds: number;
    bounce_rate: number;
  };
  timeseries: Array<{ time: string; visitors: number; pageviews: number }>;
  sources: Array<{ source: string; visitors: number }>;
  pages: Array<{ page: string; visitors: number }>;
  countries: Array<{ country_code: string; country_name: string; visitors: number }>;
  devices: Array<{ device: 'Mobile' | 'Desktop' | 'Tablet' | 'Unknown'; visitors: number; percentage: number }>;
  seo?: {
    score: number;
    recommendations: string[];
    checks: Array<{ key: string; label: string; status: 'pass' | 'warn' | 'fail'; detail: string }>;
    preview?: {
      title?: string;
      description?: string;
      h1?: string;
      ogTitle?: string;
      structuredData?: boolean;
    };
  };
};

type AgentRunSummary = {
  id: string;
  intent?: string;
  mode?: string;
  model_id?: string;
  status?: string;
  diagnostic_code?: string | null;
  duration_ms?: number | null;
  created_at?: string;
};

type AgentRunStep = {
  sequence_number?: number;
  event_type: string;
  status?: string;
  message?: string;
  public_payload?: Record<string, any>;
  created_at?: string;
};

type ProjectVersionSummary = {
  id: string;
  version_number?: number;
  label?: string;
  created_at?: string;
  diff_summary?: { summary?: string; created?: string[]; modified?: string[]; deleted?: string[] };
};

let currentProjectId = '';
let currentFiles: GeneratedFile[] = [];
let currentPreviewHtml = '';
let isGenerating = false;
// Last known client-side wallet balance (credits). null = unknown -> defer to the
// server credit gate. 0 = known-empty -> block the workspace reveal and show the
// existing upgrade prompt instead.
let lastWalletBalance: number | null = null;
let lastPlan = '';
let lastBuildSessionId = '';
let lastAgentRunId = '';
let activeHarnessThreadId = '';
let activeHarnessTurnId = '';
let activeGenerationTouchesPreview = false;
let activeAbort: AbortController | null = null;
let activeStreamHandle: { cancel: () => void } | null = null;
let stopRequested = false;
let selectedChatMode: ChatMode = 'auto';
let activeWorkshop: StudioWorkshop = 'chat';
let designSettings: DesignWorkshopSettings = {
  action: 'autopilot',
  scope: 'focused',
  target: 'auto',
  direction: 'auto',
  artifact: 'auto',
  handoff: 'preview_first',
};
let mediaSettings: MediaSettings = {
  kind: 'launch_kit',
  format: '9:16',
  duration: '8s',
  modelPreference: 'auto',
};
let selectedModelId = 'auto';
let selectedPreviewDevice: PreviewDevice = 'desktop';
let currentProjectName = 'Projet sans titre';
let initialBuilderHandoff: { prompt: string; mode: ChatMode; importContext?: Record<string, unknown>; source?: string; shouldAutoRun?: boolean } | null = null;
let initialGenerationStarted = false;
let analysisPollTimer: number | null = null;
let analysisRange = '30d';
let projectWorkspaceState: WorkspaceState | null = null;
let userWorkspaceState: UserWorkspaceState | null = null;
let workspaceSaveTimer: number | null = null;
let emptyPreviewMode: EmptyPreviewMode | 'ready' = 'idle';
let emptyPreviewLabel = '';
let currentPreviewStatus = 'idle';
let currentBuilderView: 'preview' | 'code' | 'database' | 'analysis' = 'preview';
let currentMediaPreviewHtml = '';
let previewThemeSyncBound = false;
let currentPlanKey: PlanKey = 'free';
let conversationApi: CodenConversationApi | null = null;
let conversationFeedbackBridgeBound = false;
let modelSelectionBridgeBound = false;
let connectorsBridgeBound = false;
let settingsPanelModulePromise: Promise<typeof import('./settings-panel')> | null = null;
const LAST_BUILDER_PROJECT_STORAGE_KEY = 'coden-last-builder-project-id';
const SELECTED_MODEL_STORAGE_KEY = 'coden-selected-model';
const ACTIVE_WORKSHOP_STORAGE_KEY = 'coden-active-workshop';
const DESIGN_SETTINGS_STORAGE_KEY = 'coden-design-settings';
const MEDIA_SETTINGS_STORAGE_KEY = 'coden-media-settings';

const WORKSHOP_CONFIG: Record<StudioWorkshop, {
  label: string;
  shortLabel: string;
  placeholder: string;
  icon: string;
  disabled?: boolean;
  promptPrefix?: string;
}> = {
  chat: {
    label: 'Chat',
    shortLabel: 'Chat',
    placeholder: 'Ask Coden to answer, plan, fix or build',
    icon: '<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"></path>',
  },
  design: {
    label: 'Coden Design',
    shortLabel: 'Design',
    placeholder: 'Describe the interface, style, layout or design change',
    icon: '<rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M8 4v16"></path><path d="M3 9h18"></path><path d="M12 13h5"></path><path d="M12 16h3"></path>',
    promptPrefix: 'Coden Design workspace: treat this as UI/UX, product design, visual system, prototype, or targeted interface refinement. Preserve the existing app unless the user clearly asks for a new design. Use the current design system, avoid generic AI design, and make changes as focused as possible. Favor Opus-level design reasoning for hierarchy, spacing, motion, responsive states and product taste.',
  },
  decks: {
    label: 'Coden Decks',
    shortLabel: 'Decks',
    placeholder: 'Describe the deck, audience, story or slide changes',
    icon: '<rect x="4" y="5" width="16" height="12" rx="2"></rect><path d="M8 21h8"></path><path d="M12 17v4"></path><path d="M8 9h8"></path><path d="M8 12h5"></path>',
    promptPrefix: 'Coden Decks workspace: treat this as a pitch deck, slide deck, one-pager, product narrative, investor story, or presentation request. When building, create a polished responsive web presentation in Preview with clear slides, real slide navigation, keyboard support, subtle animation, progress, speaker-friendly copy, and an honest Download HTML or Download outline action when practical. Do not claim PPTX, PDF, Canva or video export unless implemented.',
  },
  media: {
    label: 'Coden Media',
    shortLabel: 'Media',
    placeholder: 'Describe the image, video ad, UGC or campaign asset you want',
    icon: '<rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="M8 5v14"></path><path d="M16 5v14"></path><path d="M3 10h5"></path><path d="M16 10h5"></path><path d="M3 14h5"></path><path d="M16 14h5"></path>',
    promptPrefix: 'Coden Media workspace: treat this as a creative marketing media request for images, videos, UGC ads, product storytelling, thumbnails, social creatives, app teasers, or campaign assets. Do not build a web app unless the user explicitly asks to use the asset inside the app. Choose media format and model intelligently from the compact settings, keep the result in Preview, and never expose provider costs. If details are missing, use the default vertical 15s TikTok/Reels UGC ad direction and ask at most one short product/offer question instead of listing every possible output.',
  },
};

const MEDIA_OPTIONS: {
  modelPreference: Array<{ value: MediaModelPreference; label: string; hint: string }>;
  format: Array<{ value: MediaFormat; label: string; hint: string }>;
  kind: Array<{ value: MediaKind; label: string; hint: string }>;
  duration: Array<{ value: MediaDuration; label: string; hint: string }>;
} = {
  modelPreference: [
    { value: 'auto', label: 'Auto', hint: 'Best fit' },
    { value: 'best_quality', label: 'Quality', hint: 'Premium' },
    { value: 'fast', label: 'Fast', hint: 'Lower cost' },
    { value: 'seedance', label: 'Seedance', hint: 'UGC/video' },
    { value: 'veo', label: 'Veo', hint: 'Cinematic' },
    { value: 'sora', label: 'Sora', hint: 'Premium' },
    { value: 'kling', label: 'Kling', hint: 'Motion' },
    { value: 'flux', label: 'Flux', hint: 'Image' },
    { value: 'openai_image', label: 'OpenAI Image', hint: 'Image' },
  ],
  format: [
    { value: '9:16', label: '9:16', hint: 'Reels/TikTok' },
    { value: '1:1', label: '1:1', hint: 'Square' },
    { value: '4:5', label: '4:5', hint: 'Ads' },
    { value: '16:9', label: '16:9', hint: 'YouTube' },
    { value: '3:4', label: '3:4', hint: 'Portrait' },
  ],
  kind: [
    { value: 'launch_kit', label: 'Launch kit', hint: 'Posts + CTAs' },
    { value: 'campaign_pack', label: 'Campaign', hint: 'Ads set' },
    { value: 'social_posts', label: 'Social posts', hint: 'FB/LinkedIn/WhatsApp' },
    { value: 'ads_creatives', label: 'Ads', hint: 'A/B angles' },
    { value: 'brand_assets', label: 'Brand assets', hint: 'Visual system' },
    { value: 'pitch_one_pager', label: 'One-pager', hint: 'Pitch copy' },
    { value: 'video_ad', label: 'Video ad', hint: 'Campaign' },
    { value: 'ugc', label: 'UGC video', hint: 'Creator-style' },
    { value: 'storyboard', label: 'Storyboard', hint: 'Plan shots' },
    { value: 'product_image', label: 'Product image', hint: 'Still' },
    { value: 'social_creative', label: 'Social creative', hint: 'Ad asset' },
    { value: 'thumbnail', label: 'Thumbnail', hint: 'Cover' },
  ],
  duration: [
    { value: '5s', label: '5s', hint: 'Hook' },
    { value: '8s', label: '8s', hint: 'Default' },
    { value: '10s', label: '10s', hint: 'Story' },
    { value: '15s', label: '15s', hint: 'Ad' },
    { value: '30s', label: '30s', hint: 'Long' },
  ],
};

const MEDIA_CONTROL_ORDER: Array<keyof typeof MEDIA_OPTIONS> = ['modelPreference', 'format', 'kind', 'duration'];

function mediaOptionLabel(key: keyof typeof MEDIA_OPTIONS, value: string) {
  return MEDIA_OPTIONS[key].find(option => option.value === value)?.label || String(value);
}

function normalizeMediaSettings(value: any): MediaSettings {
  const pick = <K extends keyof typeof MEDIA_OPTIONS>(key: K, fallback: MediaSettings[K]) => {
    const allowed = MEDIA_OPTIONS[key].map(option => option.value);
    return allowed.includes(value?.[key]) ? value[key] : fallback;
  };
  return {
    modelPreference: pick('modelPreference', 'auto'),
    format: pick('format', '9:16'),
    kind: pick('kind', 'launch_kit'),
    duration: pick('duration', '8s'),
  };
}

function loadMediaSettings() {
  try {
    mediaSettings = normalizeMediaSettings(JSON.parse(localStorage.getItem(MEDIA_SETTINGS_STORAGE_KEY) || '{}'));
  } catch {
    mediaSettings = normalizeMediaSettings({});
  }
}

function saveMediaSettings() {
  try {
    localStorage.setItem(MEDIA_SETTINGS_STORAGE_KEY, JSON.stringify(mediaSettings));
  } catch {
    // Non-critical UI preference.
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function loadSettingsPanelModule() {
  settingsPanelModulePromise ||= import('./settings-panel');
  return settingsPanelModulePromise;
}

async function ensureSettingsPanelLazy() {
  const module = await loadSettingsPanelModule();
  module.ensureSettingsPanel();
}

async function openBuilderSettings(tab: string) {
  const module = await loadSettingsPanelModule();
  module.openSettings(tab as any);
}

function normalizePlanKey(value: unknown): PlanKey {
  const raw = String(value || 'free').trim().toLowerCase();
  if (raw === 'pro' || raw === 'scale' || raw === 'enterprise') return raw;
  return 'free';
}

function planLabel(plan: PlanKey) {
  if (plan === 'enterprise') return 'Enterprise';
  return plan.charAt(0).toUpperCase() + plan.slice(1);
}

function planRank(plan: PlanKey) {
  return plan === 'enterprise' ? 4 : plan === 'scale' ? 3 : plan === 'pro' ? 2 : 1;
}

function syncBuilderPlanBadges(planInput: unknown) {
  const plan = normalizePlanKey(planInput);
  currentPlanKey = plan;
  document.querySelectorAll<HTMLElement>('#builder-plan-badge, #project-menu-plan-badge').forEach(badge => {
    badge.textContent = planLabel(plan);
    badge.classList.remove('free', 'pro', 'scale', 'enterprise');
    badge.classList.add(plan);
    badge.setAttribute('title', `Current workspace plan: ${planLabel(plan)}`);
  });
  document.querySelectorAll<HTMLElement>('.pane-plan-tag[data-plan-min], .builder-action-plan-tag[data-plan-min]').forEach(tag => {
    const minPlan = normalizePlanKey(tag.dataset.planMin);
    const included = planRank(plan) >= planRank(minPlan);
    tag.textContent = included ? 'Included' : planLabel(minPlan);
    tag.classList.toggle('included', included);
    tag.classList.toggle('locked', !included);
    tag.setAttribute('title', included
      ? `Available on your ${planLabel(plan)} plan`
      : `Requires ${planLabel(minPlan)} plan`);
  });
}

const DESIGN_CONTROL_ORDER: Array<keyof typeof DESIGN_WORKSHOP_OPTIONS> = ['action', 'artifact', 'handoff', 'scope', 'target', 'direction'];

function loadDesignSettings() {
  try {
    designSettings = normalizeDesignWorkshopSettings(JSON.parse(localStorage.getItem(DESIGN_SETTINGS_STORAGE_KEY) || '{}'));
  } catch {
    designSettings = normalizeDesignWorkshopSettings({});
  }
}

function saveDesignSettings() {
  try {
    localStorage.setItem(DESIGN_SETTINGS_STORAGE_KEY, JSON.stringify(designSettings));
  } catch {
    // Non-critical UI preference.
  }
}

function ensureDesignControlsStyle() {
  if (document.getElementById('coden-design-controls-style')) return;
  const style = document.createElement('style');
  style.id = 'coden-design-controls-style';
  style.textContent = `
    .coden-design-controls {
      display: none;
      align-items: center;
      flex-wrap: wrap;
      gap: 5px;
      margin: 7px 14px 0;
      max-width: calc(100% - 28px);
    }
    .coden-design-controls.visible { display: flex; }
    .coden-design-pill {
      height: 23px;
      border: 1px solid var(--border-light);
      border-radius: 999px;
      background: color-mix(in srgb, var(--bg-input) 84%, transparent);
      color: var(--text-muted);
      padding: 0 8px;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font: 760 10px/1 "Instrument Sans", Inter, system-ui, sans-serif;
      cursor: pointer;
      transition: border-color 140ms cubic-bezier(.22,1,.36,1), color 140ms cubic-bezier(.22,1,.36,1), background 140ms cubic-bezier(.22,1,.36,1), transform 140ms cubic-bezier(.22,1,.36,1);
    }
    .coden-design-pill:hover,
    .coden-design-pill[aria-expanded="true"] {
      border-color: var(--border-focus);
      background: var(--accent-dim);
      color: var(--text);
      transform: translateY(-1px);
    }
    .coden-design-pill svg {
      width: 11px;
      height: 11px;
      opacity: .78;
    }
    .coden-design-popover {
      position: fixed;
      z-index: 12000;
      min-width: 188px;
      max-width: min(272px, calc(100vw - 24px));
      padding: 6px;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: color-mix(in srgb, var(--bg-surface) 96%, transparent);
      box-shadow: 0 18px 52px rgba(28,28,28,.16);
      backdrop-filter: blur(18px) saturate(150%);
      display: grid;
      gap: 3px;
    }
    .coden-design-menu-option {
      width: 100%;
      min-height: 34px;
      border: 0;
      border-radius: 9px;
      background: transparent;
      color: var(--text);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 7px 8px;
      text-align: left;
      cursor: pointer;
    }
    .coden-design-menu-option:hover,
    .coden-design-menu-option.active {
      background: var(--accent-dim);
    }
    .coden-design-menu-option strong {
      font-size: 11px;
      font-weight: 820;
    }
    .coden-design-menu-option span {
      color: var(--text-muted);
      font-size: 10px;
      font-weight: 650;
    }
    @media (max-width: 520px) {
      .coden-design-controls { overflow-x: auto; flex-wrap: nowrap; padding-bottom: 2px; }
      .coden-design-pill { flex: 0 0 auto; }
    }
    @media (prefers-reduced-motion: reduce) {
      .coden-design-pill { transition: none; }
    }
  `;
  document.head.appendChild(style);
}

function closeDesignSettingsMenu() {
  document.getElementById('coden-design-popover')?.remove();
  document.querySelectorAll<HTMLElement>('.coden-design-pill[aria-expanded="true"]').forEach(button => {
    button.setAttribute('aria-expanded', 'false');
  });
}

function openDesignSettingsMenu(key: keyof typeof DESIGN_WORKSHOP_OPTIONS, anchor: HTMLElement) {
  closeDesignSettingsMenu();
  const rect = anchor.getBoundingClientRect();
  const popover = document.createElement('div');
  popover.id = 'coden-design-popover';
  popover.className = 'coden-design-popover';
  popover.style.left = `${Math.min(rect.left, window.innerWidth - 284)}px`;
  popover.style.top = `${Math.min(rect.bottom + 6, window.innerHeight - 280)}px`;
  popover.setAttribute('role', 'menu');
  anchor.setAttribute('aria-expanded', 'true');
  popover.innerHTML = DESIGN_WORKSHOP_OPTIONS[key].map(option => {
    const active = designSettings[key] === option.value;
    return `
      <button class="coden-design-menu-option${active ? ' active' : ''}" type="button" role="menuitem" data-design-value="${escapeHtml(String(option.value))}">
        <strong>${escapeHtml(option.label)}</strong>
        <span>${escapeHtml(option.hint)}</span>
      </button>
    `;
  }).join('');
  popover.querySelectorAll<HTMLElement>('[data-design-value]').forEach(option => {
    option.addEventListener('click', () => {
      (designSettings as any)[key] = option.dataset.designValue || designSettings[key];
      saveDesignSettings();
      closeDesignSettingsMenu();
      syncDesignControls();
      syncWorkshopPreview();
    });
  });
  document.body.appendChild(popover);
  setTimeout(() => {
    const close = (event: MouseEvent) => {
      if (popover.contains(event.target as Node) || anchor.contains(event.target as Node)) return;
      closeDesignSettingsMenu();
      document.removeEventListener('click', close, true);
    };
    document.addEventListener('click', close, true);
  }, 0);
}

function ensureDesignControls() {
  ensureDesignControlsStyle();
  let controls = document.getElementById('coden-design-controls') as HTMLElement | null;
  if (controls) return controls;
  const context = document.getElementById('coden-workshop-context');
  controls = document.createElement('div');
  controls.id = 'coden-design-controls';
  controls.className = 'coden-design-controls';
  controls.setAttribute('aria-label', 'Coden Design settings');
  context?.insertAdjacentElement('afterend', controls);
  return controls;
}

function syncDesignControls() {
  const controls = ensureDesignControls();
  controls.classList.toggle('visible', activeWorkshop === 'design');
  controls.setAttribute('aria-hidden', activeWorkshop === 'design' ? 'false' : 'true');
  if (activeWorkshop !== 'design') {
    closeDesignSettingsMenu();
    return;
  }
  controls.innerHTML = DESIGN_CONTROL_ORDER.map(key => `
    <button class="coden-design-pill" type="button" data-design-control="${key}" aria-haspopup="menu" aria-expanded="false">
      <span>${escapeHtml(designWorkshopOptionLabel(key, (designSettings as any)[key]))}</span>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg>
    </button>
  `).join('');
  controls.querySelectorAll<HTMLElement>('[data-design-control]').forEach(button => {
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      openDesignSettingsMenu(button.dataset.designControl as keyof typeof DESIGN_WORKSHOP_OPTIONS, button);
    });
  });
}

function normalizeWorkshop(value: unknown): StudioWorkshop {
  return value === 'design' || value === 'decks' || value === 'media' ? value : 'chat';
}

function currentWorkshopConfig() {
  return WORKSHOP_CONFIG[activeWorkshop] || WORKSHOP_CONFIG.chat;
}

function workshopIconSvg(workshop: StudioWorkshop) {
  const config = WORKSHOP_CONFIG[workshop] || WORKSHOP_CONFIG.chat;
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${config.icon}</svg>`;
}

function ensureMediaControlsStyle() {
  if (document.getElementById('coden-media-controls-style')) return;
  const style = document.createElement('style');
  style.id = 'coden-media-controls-style';
  style.textContent = `
    .coden-media-controls {
      display: none;
      align-items: center;
      flex-wrap: wrap;
      gap: 5px;
      margin: 8px 14px 0;
      max-width: calc(100% - 28px);
    }
    .coden-media-controls.visible { display: flex; }
    .coden-media-controls::before {
      content: "Media";
      color: var(--text-faint);
      font: 820 9px/1 "Instrument Sans", Inter, system-ui, sans-serif;
      letter-spacing: .08em;
      text-transform: uppercase;
      margin-right: 2px;
    }
    .coden-media-pill {
      height: 26px;
      border: 1px solid var(--border-light);
      border-radius: 999px;
      background: color-mix(in srgb, var(--bg-input) 88%, transparent);
      color: var(--text-muted);
      padding: 0 9px;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font: 780 10.5px/1 "Instrument Sans", Inter, system-ui, sans-serif;
      cursor: pointer;
      transition: border-color 140ms cubic-bezier(.22,1,.36,1), color 140ms cubic-bezier(.22,1,.36,1), background 140ms cubic-bezier(.22,1,.36,1), transform 140ms cubic-bezier(.22,1,.36,1);
    }
    .coden-media-pill:hover,
    .coden-media-pill[aria-expanded="true"] {
      border-color: var(--border-focus);
      background: var(--accent-dim);
      color: var(--text);
      transform: translateY(-1px);
    }
    .coden-media-pill svg {
      width: 11px;
      height: 11px;
      opacity: .78;
    }
    .coden-media-popover {
      position: fixed;
      z-index: 12000;
      min-width: 182px;
      max-width: min(286px, calc(100vw - 24px));
      padding: 6px;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: color-mix(in srgb, var(--bg-surface) 96%, transparent);
      box-shadow: 0 18px 52px rgba(28,28,28,.16);
      backdrop-filter: blur(18px) saturate(150%);
      display: grid;
      gap: 3px;
    }
    .coden-media-menu-option {
      width: 100%;
      min-height: 38px;
      border: 0;
      border-radius: 9px;
      background: transparent;
      color: var(--text);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 8px 9px;
      text-align: left;
      cursor: pointer;
    }
    .coden-media-menu-option:hover,
    .coden-media-menu-option.active {
      background: var(--accent-dim);
    }
    .coden-media-menu-option strong {
      font-size: 11.5px;
      font-weight: 820;
    }
    .coden-media-menu-option span {
      color: var(--text-muted);
      font-size: 10px;
      font-weight: 650;
    }
    @media (max-width: 520px) {
      .coden-media-controls { overflow-x: auto; flex-wrap: nowrap; padding-bottom: 2px; }
      .coden-media-pill { flex: 0 0 auto; }
    }
    @media (prefers-reduced-motion: reduce) {
      .coden-media-pill { transition: none; }
    }
  `;
  document.head.appendChild(style);
}

function closeMediaSettingsMenu() {
  document.getElementById('coden-media-popover')?.remove();
  document.querySelectorAll<HTMLElement>('.coden-media-pill[aria-expanded="true"]').forEach(button => {
    button.setAttribute('aria-expanded', 'false');
  });
}

function openMediaSettingsMenu(key: keyof typeof MEDIA_OPTIONS, anchor: HTMLElement) {
  closeMediaSettingsMenu();
  const rect = anchor.getBoundingClientRect();
  const popover = document.createElement('div');
  popover.id = 'coden-media-popover';
  popover.className = 'coden-media-popover';
  popover.style.left = `${Math.min(rect.left, window.innerWidth - 272)}px`;
  popover.style.top = `${Math.min(rect.bottom + 6, window.innerHeight - 260)}px`;
  popover.setAttribute('role', 'menu');
  anchor.setAttribute('aria-expanded', 'true');
  popover.innerHTML = MEDIA_OPTIONS[key].map(option => {
    const active = mediaSettings[key] === option.value;
    return `
      <button class="coden-media-menu-option${active ? ' active' : ''}" type="button" role="menuitem" data-media-value="${escapeHtml(String(option.value))}">
        <strong>${escapeHtml(option.label)}</strong>
        <span>${escapeHtml(option.hint)}</span>
      </button>
    `;
  }).join('');
  popover.querySelectorAll<HTMLElement>('[data-media-value]').forEach(option => {
    option.addEventListener('click', () => {
      (mediaSettings as any)[key] = option.dataset.mediaValue || mediaSettings[key];
      saveMediaSettings();
      closeMediaSettingsMenu();
      syncMediaControls();
      syncWorkshopPreview();
    });
  });
  document.body.appendChild(popover);
  setTimeout(() => {
    const close = (event: MouseEvent) => {
      if (popover.contains(event.target as Node) || anchor.contains(event.target as Node)) return;
      closeMediaSettingsMenu();
      document.removeEventListener('click', close, true);
    };
    document.addEventListener('click', close, true);
  }, 0);
}

function ensureMediaControls() {
  ensureMediaControlsStyle();
  let controls = document.getElementById('coden-media-controls') as HTMLElement | null;
  if (controls) return controls;
  const context = document.getElementById('coden-workshop-context');
  controls = document.createElement('div');
  controls.id = 'coden-media-controls';
  controls.className = 'coden-media-controls';
  controls.setAttribute('aria-label', 'Coden Media settings');
  context?.insertAdjacentElement('afterend', controls);
  return controls;
}

function syncMediaControls() {
  const controls = ensureMediaControls();
  controls.classList.toggle('visible', activeWorkshop === 'media');
  controls.setAttribute('aria-hidden', activeWorkshop === 'media' ? 'false' : 'true');
  if (activeWorkshop !== 'media') {
    closeMediaSettingsMenu();
    return;
  }
  controls.innerHTML = MEDIA_CONTROL_ORDER.map(key => `
    <button class="coden-media-pill" type="button" data-media-control="${key}" aria-haspopup="menu" aria-expanded="false">
      <span>${escapeHtml(mediaOptionLabel(key as any, (mediaSettings as any)[key]))}</span>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg>
    </button>
  `).join('');
  controls.querySelectorAll<HTMLElement>('[data-media-control]').forEach(button => {
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      openMediaSettingsMenu(button.dataset.mediaControl as keyof typeof MEDIA_OPTIONS, button);
    });
  });
}

function refreshWorkshopInputContext() {
  const input = document.getElementById('chat-textarea-box') as HTMLTextAreaElement | null;
  const context = document.getElementById('coden-workshop-context') as HTMLElement | null;
  const label = document.getElementById('coden-workshop-context-label') as HTMLElement | null;
  const chatTab = document.getElementById('btn-sidebar-chat') as HTMLElement | null;
  const studioTab = document.getElementById('btn-sidebar-studio') as HTMLElement | null;
  const wrapper = document.getElementById('pane-studio-wrapper') as HTMLElement | null;
  const config = currentWorkshopConfig();

  document.body.dataset.codenWorkshop = activeWorkshop;
  chatTab?.classList.toggle('active', activeWorkshop === 'chat');
  studioTab?.classList.toggle('active', activeWorkshop !== 'chat');
  wrapper?.querySelectorAll<HTMLElement>('[data-studio-panel]').forEach(option => {
    const selected = normalizeWorkshop(option.dataset.studioPanel) === activeWorkshop;
    option.classList.toggle('active', selected);
    if (selected) option.setAttribute('aria-current', 'true');
    else option.removeAttribute('aria-current');
  });

  if (input && !input.value.trim()) input.placeholder = config.placeholder;
  if (context && label) {
    context.classList.toggle('visible', activeWorkshop !== 'chat');
    context.setAttribute('aria-hidden', activeWorkshop === 'chat' ? 'true' : 'false');
    context.querySelector('svg')?.remove();
    context.insertAdjacentHTML('afterbegin', workshopIconSvg(activeWorkshop));
    label.textContent = config.label;
  }
  syncDesignControls();
  syncMediaControls();
}

function setActiveWorkshop(workshop: StudioWorkshop, options: { focusInput?: boolean } = {}) {
  const nextWorkshop = normalizeWorkshop(workshop);
  if (WORKSHOP_CONFIG[nextWorkshop]?.disabled) return;
  activeWorkshop = nextWorkshop;
  localStorage.setItem(ACTIVE_WORKSHOP_STORAGE_KEY, activeWorkshop);
  refreshWorkshopInputContext();
  syncWorkshopPreview();
  syncProjectReadinessClass();
  if (options.focusInput) {
    document.getElementById('chat-textarea-box')?.focus();
  }
}

function loadActiveWorkshop() {
  loadDesignSettings();
  loadMediaSettings();
  const requested = normalizeWorkshop(new URLSearchParams(window.location.search).get('workshop'));
  const saved = normalizeWorkshop(localStorage.getItem(ACTIVE_WORKSHOP_STORAGE_KEY));
  activeWorkshop = requested !== 'chat' && !WORKSHOP_CONFIG[requested]?.disabled
    ? requested
    : WORKSHOP_CONFIG[saved]?.disabled ? 'chat' : saved;
}

function studioPromptContextPayload() {
  const config = currentWorkshopConfig();
  return activeWorkshop === 'chat'
    ? undefined
    : {
        workshop: activeWorkshop,
        label: config.label,
        instruction: config.promptPrefix || '',
        ...(activeWorkshop === 'design' ? { settings: designSettings, designBrief: buildDesignStudioBrief({ settings: designSettings }) } : {}),
        ...(activeWorkshop === 'media' ? { settings: mediaSettings } : {}),
      };
}

function workshopPlaceholderForFollowUp(speaksFrench: boolean) {
  if (activeWorkshop === 'design') {
    return speaksFrench ? 'Decris le changement visuel a appliquer...' : 'Describe the visual change to apply...';
  }
  if (activeWorkshop === 'decks') {
    return speaksFrench ? 'Decris la slide, le deck ou le message a ameliorer...' : 'Describe the slide, deck, or story to improve...';
  }
  return speaksFrench ? 'Dis-moi quoi changer dans cette version...' : 'Tell me what to change in this version...';
}

function emptyPreviewHtml(mode: EmptyPreviewMode, label = '') {
  return centeredPreviewLoaderHtml(mode, label);
}

function getBuilderPreviewTheme(): 'light' | 'dark' {
  const documentTheme = document.documentElement.getAttribute('data-theme')?.toLowerCase();
  if (documentTheme === 'light' || documentTheme === 'dark') return documentTheme;
  try {
    const storedTheme = localStorage.getItem('coden-theme')?.toLowerCase();
    if (storedTheme === 'light' || storedTheme === 'dark') return storedTheme;
  } catch {
    // Keep the preview shell usable even when storage is unavailable.
  }
  return 'light';
}

function syncInternalPreviewTheme() {
  const frame = document.getElementById('preview-iframe-element') as HTMLIFrameElement | null;
  if (!frame) return;
  const theme = getBuilderPreviewTheme();
  if (frame.dataset.previewShellTheme === theme) return;
  if (frame.dataset.emptyPreview === 'true') {
    frame.dataset.previewShellTheme = theme;
    const mode: EmptyPreviewMode = emptyPreviewMode === 'working' ? 'working' : 'idle';
    frame.srcdoc = centeredPreviewLoaderHtml(mode, emptyPreviewLabel);
    return;
  }
  if (frame.dataset.designPreview === 'true' && activeWorkshop === 'design' && !isUsablePreviewHtml(currentPreviewHtml)) {
    setDesignPreviewHtml(designPreviewShellHtml('idle', 'Design canvas'));
    return;
  }
  if (frame.dataset.mediaPreview === 'true' && activeWorkshop === 'media' && !isUsablePreviewHtml(currentPreviewHtml)) {
    setMediaPreviewHtml(mediaPreviewShellHtml('idle', 'Media output'));
  }
}

/**
 * When the user picks an element in visual edit mode, prefill the composer
 * with a scoped edit instruction and focus it. The normal autonomous edit
 * path then turns this into a targeted patch — no full prompt required.
 */
function applyVisualEditTarget(target: VisualEditTarget) {
  const composer = document.getElementById('chat-textarea-box') as HTMLTextAreaElement | null;
  if (!composer) return;
  const existing = composer.value.trim();
  composer.value = existing ? `${target.instruction}${existing}` : target.instruction;
  composer.dispatchEvent(new Event('input', { bubbles: true }));
  composer.focus();
  // Place the caret at the end so the user types the change right after the target.
  composer.setSelectionRange(composer.value.length, composer.value.length);
}

function bindVisualEditMode() {
  const toggle = document.getElementById('btn-visual-edit');
  if (!toggle) return;
  const detectFrenchUi = () => {
    const lang = (document.documentElement.lang || navigator.language || '').toLowerCase();
    return lang.startsWith('fr');
  };
  const options = {
    getIframe: () => document.getElementById('preview-iframe-element') as HTMLIFrameElement | null,
    onPick: applyVisualEditTarget,
    isFrench: detectFrenchUi,
  };
  const reflect = () => {
    const on = isVisualEditModeActive();
    toggle.setAttribute('aria-pressed', String(on));
    toggle.classList.toggle('active', on);
  };
  const toggleMode = () => {
    // Only meaningful when a real generated preview is mounted.
    if (!isUsablePreviewHtml(currentPreviewHtml)) return;
    setVisualEditMode(!isVisualEditModeActive(), options);
    reflect();
  };
  reflect();
  toggle.addEventListener('click', toggleMode);
  toggle.addEventListener('keydown', (event) => {
    const key = (event as KeyboardEvent).key;
    if (key === 'Enter' || key === ' ') {
      event.preventDefault();
      toggleMode();
    }
  });
  // Picking an element exits the mode inside the module; keep the button in sync.
  const refresh = () => reflect();
  document.addEventListener('coden:visual-edit-picked', refresh);
}

function bindPreviewThemeSync() {
  if (previewThemeSyncBound) return;
  previewThemeSyncBound = true;
  bindVisualEditMode();
  if ('MutationObserver' in window) {
    const observer = new MutationObserver(() => syncInternalPreviewTheme());
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }
  window.addEventListener('storage', event => {
    if (event.key === 'coden-theme') syncInternalPreviewTheme();
  });
}

function isUsablePreviewHtml(html: unknown) {
  const source = String(html || '').trim();
  if (!source) return false;
  if (/data-preview-state=["'](?:idle|working)["']/i.test(source)) return false;
  if (/Preview is waiting for a real generated application/i.test(source)) return false;
  if (/data-coden-preview-fallback="true"/i.test(source) && !source.includes('window.__modules__')) return false;
  if (/Preview ready\. Generate or edit this project/i.test(source)) return false;
  return true;
}

function centeredPreviewLoaderHtml(mode: EmptyPreviewMode, label = '') {
  const isWorking = mode === 'working';
  const rawStatus = label || (isWorking ? 'Vérification en cours' : 'Preview non vérifiée');
  const status = escapeHtml(rawStatus);
  const letters = escapeHtml(rawStatus);
  const stateClass = isWorking ? 'working' : 'idle';
  const previewTheme = getBuilderPreviewTheme();
  return `<!DOCTYPE html>
<html lang="en" data-preview-state="${stateClass}" data-theme="${previewTheme}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
:root {
  color-scheme: light dark;
  --loader-text: #111827;
  --loader-bg-a: #f8fbff;
  --loader-bg-b: #eef5ff;
  --loader-bg-c: #ffffff;
  --ring-a: #e0ecff;
  --ring-b: #76a7ff;
  --ring-c: #2f6df6;
  --ring-mid-a: #c7dcff;
  --ring-mid-b: #4f8cff;
  --ring-mid-c: #173f8f;
  --ring-glow-a: rgba(79,140,255,.30);
  --ring-glow-b: rgba(47,109,246,.18);
}
@media (prefers-color-scheme: dark) {
  :root {
    --loader-text: #f5f7fb;
    --loader-bg-a: #0f1014;
    --loader-bg-b: #15171c;
    --loader-bg-c: #1b1e25;
    --ring-a: #243b66;
    --ring-b: #4f8cff;
    --ring-c: #8ab4ff;
    --ring-mid-a: #31568f;
    --ring-mid-b: #76a7ff;
    --ring-mid-c: #cfe0ff;
    --ring-glow-a: rgba(79,140,255,.34);
    --ring-glow-b: rgba(138,180,255,.18);
  }
}
:root[data-theme="light"] {
  color-scheme: light;
  --loader-text: #111827;
  --loader-bg-a: #f8fbff;
  --loader-bg-b: #eef5ff;
  --loader-bg-c: #ffffff;
  --ring-a: #e0ecff;
  --ring-b: #76a7ff;
  --ring-c: #2f6df6;
  --ring-mid-a: #c7dcff;
  --ring-mid-b: #4f8cff;
  --ring-mid-c: #173f8f;
  --ring-glow-a: rgba(79,140,255,.30);
  --ring-glow-b: rgba(47,109,246,.18);
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --loader-text: #f5f7fb;
  --loader-bg-a: #0f1014;
  --loader-bg-b: #15171c;
  --loader-bg-c: #1b1e25;
  --ring-a: #243b66;
  --ring-b: #4f8cff;
  --ring-c: #8ab4ff;
  --ring-mid-a: #31568f;
  --ring-mid-b: #76a7ff;
  --ring-mid-c: #cfe0ff;
  --ring-glow-a: rgba(79,140,255,.34);
  --ring-glow-b: rgba(138,180,255,.18);
}
* { box-sizing: border-box; }
html, body { min-height: 100%; }
body {
  margin: 0;
  overflow: hidden;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif;
  background:
    radial-gradient(circle at 50% 38%, rgba(79,140,255,.08), transparent 32%),
    linear-gradient(180deg, var(--loader-bg-a), var(--loader-bg-b) 52%, var(--loader-bg-c));
  color: var(--loader-text);
}
.preview-loader {
  position: fixed;
  inset: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
.loader-core {
  position: relative;
  width: min(180px, 54vw);
  height: min(180px, 54vw);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 520;
  letter-spacing: .01em;
  user-select: none;
}
.loader-text {
  position: relative;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  max-width: 78%;
  color: var(--loader-text);
  font-size: clamp(13px, 3vw, 16px);
  line-height: 1;
  text-align: center;
  filter: drop-shadow(0 1px 10px rgba(0,0,0,.18));
}
.loader-letter {
  display: inline-block;
  opacity: .4;
  animation: loaderLetter 3s infinite;
}
.loader-circle {
  position: absolute;
  inset: 0;
  border-radius: 999px;
  background:
    radial-gradient(circle at 32% 24%, rgba(255,255,255,.44), transparent 17%),
    radial-gradient(circle at 42% 42%, rgba(79,140,255,.12), transparent 48%);
  animation: loaderCircle 5s linear infinite;
}
.idle .loader-circle { animation-duration: 8s; opacity: .88; }
.idle .loader-letter { animation-duration: 4.5s; }
@keyframes loaderCircle {
  0% {
    transform: rotate(90deg);
    box-shadow: 0 6px 12px 0 var(--ring-a) inset, 0 12px 18px 0 var(--ring-b) inset, 0 36px 36px 0 var(--ring-c) inset, 0 0 3px 1.2px var(--ring-glow-a), 0 0 6px 1.8px var(--ring-glow-b);
  }
  50% {
    transform: rotate(270deg);
    box-shadow: 0 6px 12px 0 var(--ring-mid-a) inset, 0 12px 6px 0 var(--ring-mid-b) inset, 0 24px 36px 0 var(--ring-mid-c) inset, 0 0 3px 1.2px var(--ring-glow-a), 0 0 6px 1.8px var(--ring-glow-b);
  }
  100% {
    transform: rotate(450deg);
    box-shadow: 0 6px 12px 0 var(--ring-a) inset, 0 12px 18px 0 var(--ring-b) inset, 0 36px 36px 0 var(--ring-c) inset, 0 0 3px 1.2px var(--ring-glow-a), 0 0 6px 1.8px var(--ring-glow-b);
  }
}
@media (prefers-color-scheme: dark) {
  @keyframes loaderCircle {
    0%, 100% {
      transform: rotate(90deg);
      box-shadow: 0 6px 12px 0 var(--ring-a) inset, 0 12px 18px 0 var(--ring-b) inset, 0 36px 36px 0 var(--ring-c) inset, 0 0 3px 1.2px var(--ring-glow-a), 0 0 6px 1.8px var(--ring-glow-b);
    }
    50% {
      transform: rotate(270deg);
      box-shadow: 0 6px 12px 0 var(--ring-mid-a) inset, 0 12px 6px 0 var(--ring-mid-b) inset, 0 24px 36px 0 var(--ring-mid-c) inset, 0 0 3px 1.2px var(--ring-glow-a), 0 0 6px 1.8px var(--ring-glow-b);
    }
  }
}
@keyframes loaderLetter {
  0%, 100% { opacity: .4; transform: translateY(0) scale(1); }
  20% { opacity: 1; transform: scale(1.15); }
  40% { opacity: .7; transform: translateY(0) scale(1); }
}
@media (max-width: 520px) {
  .loader-core { width: min(150px, 58vw); height: min(150px, 58vw); }
  .loader-text { font-size: 13px; }
}
@media (prefers-reduced-motion: reduce) {
  .loader-circle,
  .loader-letter { animation: none !important; }
  .loader-letter { opacity: .86; }
}
</style>
</head>
<body>
  <main class="preview-loader ${stateClass}" aria-label="Preview preparation">
    <div class="loader-core" role="status" aria-live="polite" aria-label="${status}">
      <span class="loader-text">${letters}</span>
      <div class="loader-circle" aria-hidden="true"></div>
    </div>
  </main>
</body>
</html>`;
}

function setEmptyPreviewState(mode: EmptyPreviewMode = 'idle', label = '') {
  if (isUsablePreviewHtml(currentPreviewHtml)) return;
  const frame = document.getElementById('preview-iframe-element') as HTMLIFrameElement | null;
  if (!frame) return;
  const resolvedLabel = label || (mode === 'working' ? 'Vérification en cours' : 'Preview non vérifiée');
  if (emptyPreviewMode === mode && emptyPreviewLabel === resolvedLabel && frame.dataset.emptyPreview === 'true') return;
  emptyPreviewMode = mode;
  emptyPreviewLabel = resolvedLabel;
  currentPreviewStatus = mode;
  frame.dataset.emptyPreview = 'true';
  frame.dataset.emptyPreviewMode = mode;
  frame.dataset.previewShellTheme = getBuilderPreviewTheme();
  frame.srcdoc = centeredPreviewLoaderHtml(mode, resolvedLabel);
  setPreviewDevice(selectedPreviewDevice, false);
  syncPreviewAddress(null);
  syncPreviewToolbarControls();
}

function mediaPreviewShellHtml(state: 'idle' | 'working' = 'idle', title = 'Media output') {
  const isWorking = state === 'working';
  const previewTheme = getBuilderPreviewTheme();
  const status = isWorking ? title || 'Generating media' : 'Ready for media';
  const helper = isWorking
    ? 'Coden is turning the request into a usable creative brief and preview.'
    : 'Describe a product image, UGC video, storyboard, thumbnail or campaign pack.';
  return `<!doctype html>
<html lang="en" data-theme="${previewTheme}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
:root{color-scheme:light dark;--bg:#fcfbf8;--panel:#fffefa;--ink:#1c1c1c;--muted:#5f5f5d;--line:#eceae4;--soft:#f7f4ed;--blue:#2f6df6}
@media(prefers-color-scheme:dark){:root{--bg:#0f1014;--panel:#15171c;--ink:#f5f7fb;--muted:#c6cad3;--line:rgba(226,232,240,.12);--soft:#1b1e25}}
:root[data-theme=light]{color-scheme:light;--bg:#fcfbf8;--panel:#fffefa;--ink:#1c1c1c;--muted:#5f5f5d;--line:#eceae4;--soft:#f7f4ed;--blue:#2f6df6}
:root[data-theme=dark]{color-scheme:dark;--bg:#0f1014;--panel:#15171c;--ink:#f5f7fb;--muted:#c6cad3;--line:rgba(226,232,240,.12);--soft:#1b1e25;--blue:#4f8cff}
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 50% 0,rgba(47,109,246,.10),transparent 32%),var(--bg);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--ink)}
.wrap{min-height:100vh;display:grid;place-items:center;padding:clamp(18px,4vw,42px)}
.empty{width:min(760px,100%);display:grid;gap:14px;color:var(--muted)}
.status{width:max-content;display:inline-flex;align-items:center;gap:9px;border:1px solid var(--line);border-radius:999px;background:color-mix(in srgb,var(--panel) 88%,transparent);padding:9px 13px;color:var(--ink);font-size:13px;font-weight:780;box-shadow:0 8px 28px rgba(28,28,28,.06)}
.dot{width:8px;height:8px;border-radius:999px;background:#2f6df6;box-shadow:0 0 0 5px rgba(47,109,246,.10);animation:${isWorking ? 'pulse 1.6s cubic-bezier(.22,1,.36,1) infinite' : 'none'}}
.helper{margin:0;max-width:560px;font-size:clamp(15px,2.2vw,22px);line-height:1.35;color:var(--ink);font-weight:760;letter-spacing:-.02em}
.mini-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:4px}.mini-card{border:1px solid var(--line);border-radius:16px;background:color-mix(in srgb,var(--panel) 90%,transparent);padding:14px;min-height:86px}.mini-card strong{display:block;color:var(--ink);font-size:13px;margin-bottom:6px}.mini-card span{display:block;color:var(--muted);font-size:12px;line-height:1.4}
.bar{height:4px;width:min(360px,100%);overflow:hidden;border-radius:999px;background:var(--soft);border:1px solid var(--line)}.bar::after{content:"";display:block;width:38%;height:100%;border-radius:999px;background:linear-gradient(90deg,transparent,#2f6df6,transparent);animation:${isWorking ? 'scan 1.35s cubic-bezier(.22,1,.36,1) infinite' : 'none'}}
@keyframes pulse{0%,100%{opacity:.55;transform:scale(1)}50%{opacity:1;transform:scale(1.18)}}@keyframes scan{0%{transform:translateX(-110%)}100%{transform:translateX(270%)}}
@media(max-width:680px){.mini-grid{grid-template-columns:1fr}.helper{font-size:20px}.empty{gap:12px}}@media(prefers-reduced-motion:reduce){.dot,.bar::after{animation:none}}
</style>
</head>
<body>
<main class="wrap">
  <section class="empty" aria-label="Coden Media preview">
    <div class="status" role="status" aria-live="polite"><span class="dot" aria-hidden="true"></span>${escapeHtml(status)}</div>
    <p class="helper">${escapeHtml(helper)}</p>
    <div class="bar" aria-hidden="true"></div>
    <div class="mini-grid" aria-label="Media capabilities">
      <div class="mini-card"><strong>Campaign</strong><span>Angles, hooks, posts and ad variations.</span></div>
      <div class="mini-card"><strong>Visual</strong><span>Product images, thumbnails and hero assets.</span></div>
      <div class="mini-card"><strong>Video</strong><span>UGC scripts, storyboard and short promo direction.</span></div>
    </div>
  </section>
</main>
</body>
</html>`;
}

function setMediaPreviewHtml(html: string, addressLabel = 'media.coden.local / lab') {
  const frame = document.getElementById('preview-iframe-element') as HTMLIFrameElement | null;
  if (!frame) return;
  currentMediaPreviewHtml = html;
  frame.dataset.mediaPreview = 'true';
  frame.dataset.previewShellTheme = getBuilderPreviewTheme();
  frame.removeAttribute('data-design-preview');
  frame.removeAttribute('data-empty-preview');
  frame.srcdoc = html;
  currentPreviewStatus = 'idle';
  setPreviewDevice(selectedPreviewDevice, false);
  void addressLabel;
  syncPreviewAddress(null);
  syncPreviewToolbarControls();
}

function designPreviewShellHtml(state: 'idle' | 'working' = 'idle', title = 'Design canvas') {
  const isWorking = state === 'working';
  const previewTheme = getBuilderPreviewTheme();
  const brief = buildDesignStudioBrief({ settings: designSettings });
  const artifact = designWorkshopOptionLabel('artifact', brief.artifact_type);
  const handoff = designWorkshopOptionLabel('handoff', brief.handoff);
  const helper = isWorking
    ? 'Coden is shaping a visual direction, checking brand fit and preparing a clean handoff.'
    : 'Describe a screen, section, prototype, deck or brand direction. Coden will keep the canvas calm and the app safe.';
  return `<!doctype html>
<html lang="en" data-theme="${previewTheme}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
:root{color-scheme:light dark;--bg:#fcfbf8;--panel:#fffefa;--ink:#1c1c1c;--muted:#66625a;--line:#ece8df;--soft:#f7f3ea;--blue:#2f6df6;--blue-soft:rgba(47,109,246,.10)}
@media(prefers-color-scheme:dark){:root{--bg:#0f1014;--panel:#15171c;--ink:#f5f7fb;--muted:#c6cad3;--line:rgba(226,232,240,.12);--soft:#1b1e25;--blue-soft:rgba(79,140,255,.16)}}
:root[data-theme=light]{color-scheme:light;--bg:#fcfbf8;--panel:#fffefa;--ink:#1c1c1c;--muted:#66625a;--line:#ece8df;--soft:#f7f3ea;--blue:#2f6df6;--blue-soft:rgba(47,109,246,.10)}
:root[data-theme=dark]{color-scheme:dark;--bg:#0f1014;--panel:#15171c;--ink:#f5f7fb;--muted:#c6cad3;--line:rgba(226,232,240,.12);--soft:#1b1e25;--blue:#4f8cff;--blue-soft:rgba(79,140,255,.16)}
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 50% 0,var(--blue-soft),transparent 34%),var(--bg);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--ink)}
.wrap{min-height:100vh;display:grid;place-items:center;padding:clamp(18px,4vw,44px)}
.studio{width:min(860px,100%);display:grid;gap:16px}
.status{width:max-content;display:inline-flex;align-items:center;gap:9px;border:1px solid var(--line);border-radius:999px;background:color-mix(in srgb,var(--panel) 88%,transparent);padding:9px 13px;font-size:13px;font-weight:780;box-shadow:0 8px 28px rgba(28,28,28,.06)}
.dot{width:8px;height:8px;border-radius:999px;background:var(--blue);box-shadow:0 0 0 5px var(--blue-soft);animation:${isWorking ? 'pulse 1.6s cubic-bezier(.22,1,.36,1) infinite' : 'none'}}
h1{margin:0;max-width:720px;font-size:clamp(34px,6vw,70px);line-height:.98;letter-spacing:-.055em}
p{margin:0;max-width:620px;color:var(--muted);font-size:clamp(15px,2vw,20px);line-height:1.45}
.pills{display:flex;flex-wrap:wrap;gap:7px}.pill{border:1px solid var(--line);background:color-mix(in srgb,var(--panel) 88%,transparent);border-radius:999px;padding:8px 11px;color:var(--muted);font-size:12px;font-weight:760}.pill strong{color:var(--ink)}
.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-top:5px}.card{border:1px solid var(--line);border-radius:18px;background:color-mix(in srgb,var(--panel) 90%,transparent);padding:15px;min-height:112px;box-shadow:0 20px 60px rgba(28,28,28,.05)}.card strong{display:block;font-size:13px;margin-bottom:8px}.card span{display:block;color:var(--muted);font-size:12px;line-height:1.45}
.bar{height:4px;width:min(420px,100%);overflow:hidden;border-radius:999px;background:var(--soft);border:1px solid var(--line)}.bar::after{content:"";display:block;width:35%;height:100%;border-radius:999px;background:linear-gradient(90deg,transparent,var(--blue),transparent);animation:${isWorking ? 'scan 1.35s cubic-bezier(.22,1,.36,1) infinite' : 'none'}}
@keyframes pulse{0%,100%{opacity:.55;transform:scale(1)}50%{opacity:1;transform:scale(1.18)}}@keyframes scan{0%{transform:translateX(-110%)}100%{transform:translateX(300%)}}
@media(max-width:760px){.grid{grid-template-columns:1fr 1fr}h1{font-size:42px}.studio{gap:13px}}@media(max-width:520px){.grid{grid-template-columns:1fr}.pills{gap:6px}}@media(prefers-reduced-motion:reduce){.dot,.bar::after{animation:none}}
</style>
</head>
<body>
<main class="wrap">
  <section class="studio" aria-label="Coden Design preview">
    <div class="status" role="status" aria-live="polite"><span class="dot" aria-hidden="true"></span>${escapeHtml(isWorking ? title : 'Coden Design')}</div>
    <h1>${escapeHtml(isWorking ? 'Preparing a design direction' : 'Ready for design')}</h1>
    <p>${escapeHtml(helper)}</p>
    <div class="pills" aria-label="Design context">
      <span class="pill">Output <strong>${escapeHtml(artifact)}</strong></span>
      <span class="pill">Handoff <strong>${escapeHtml(handoff)}</strong></span>
      <span class="pill">Style <strong>${escapeHtml(designWorkshopOptionLabel('direction', designSettings.direction))}</strong></span>
    </div>
    <div class="bar" aria-hidden="true"></div>
    <div class="grid" aria-label="Design capabilities">
      <div class="card"><strong>Brand kit</strong><span>Extract colors, type, spacing, voice and motion from the current product.</span></div>
      <div class="card"><strong>Variations</strong><span>Explore clean alternatives without rewriting the whole app by default.</span></div>
      <div class="card"><strong>Critic</strong><span>Check hierarchy, contrast, mobile, states and anti-generic patterns.</span></div>
      <div class="card"><strong>Apply</strong><span>Patch the app only when handoff is set to Apply or the user asks clearly.</span></div>
    </div>
  </section>
</main>
</body>
</html>`;
}

function setDesignPreviewHtml(html: string, addressLabel = 'design.coden.local / canvas') {
  const frame = document.getElementById('preview-iframe-element') as HTMLIFrameElement | null;
  if (!frame) return;
  frame.dataset.designPreview = 'true';
  frame.dataset.previewShellTheme = getBuilderPreviewTheme();
  frame.removeAttribute('data-media-preview');
  frame.removeAttribute('data-empty-preview');
  frame.srcdoc = html;
  currentPreviewStatus = 'idle';
  setPreviewDevice(selectedPreviewDevice, false);
  void addressLabel;
  syncPreviewAddress(null);
  syncPreviewToolbarControls();
}

function syncWorkshopPreview() {
  const frame = document.getElementById('preview-iframe-element') as HTMLIFrameElement | null;
  if (!frame) return;
  if (activeWorkshop === 'design' && !isUsablePreviewHtml(currentPreviewHtml)) {
    activateBuilderView('preview');
    setDesignPreviewHtml(designPreviewShellHtml('idle', 'Design canvas'));
    return;
  }
  if (activeWorkshop === 'media') {
    activateBuilderView('preview');
    setMediaPreviewHtml(currentMediaPreviewHtml || mediaPreviewShellHtml('idle', 'Media output'));
    return;
  }
  if (frame.dataset.mediaPreview === 'true' || frame.dataset.designPreview === 'true') {
    frame.removeAttribute('data-media-preview');
    frame.removeAttribute('data-design-preview');
    if (currentPreviewHtml.trim()) {
      setPreview(currentPreviewHtml, currentPreviewStatus);
    } else {
      frame.srcdoc = '';
      setEmptyPreviewState('idle', 'Preview non vérifiée');
    }
  }
}

function getProjectIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get('project') || '';
}

function isNewProjectRoute() {
  const params = new URLSearchParams(window.location.search);
  return params.get('new') === '1';
}

function isRealProjectId(value?: string | null) {
  const clean = String(value || '').trim();
  return Boolean(clean && !clean.startsWith('proj-') && /^[a-zA-Z0-9_-]{8,}$/.test(clean));
}

function rememberLastBuilderProjectId(projectId = currentProjectId) {
  if (!isRealProjectId(projectId)) return;
  try {
    localStorage.setItem(LAST_BUILDER_PROJECT_STORAGE_KEY, String(projectId));
  } catch {
    // Local persistence is only a safety net for builder restore.
  }
}

function forgetLastBuilderProjectId(projectId?: string) {
  try {
    const remembered = localStorage.getItem(LAST_BUILDER_PROJECT_STORAGE_KEY) || '';
    if (!projectId || remembered === projectId) localStorage.removeItem(LAST_BUILDER_PROJECT_STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
}

function rememberedLastBuilderProjectId() {
  try {
    const remembered = localStorage.getItem(LAST_BUILDER_PROJECT_STORAGE_KEY) || '';
    return isRealProjectId(remembered) ? remembered : '';
  } catch {
    return '';
  }
}

function setCurrentBuilderProjectId(projectId: string, updateUrl = true) {
  currentProjectId = isRealProjectId(projectId) ? String(projectId).trim() : '';
  if (!currentProjectId) return;
  rememberLastBuilderProjectId(currentProjectId);
  if (updateUrl && getProjectIdFromUrl() !== currentProjectId) {
    window.history.replaceState({}, '', `/builder.html?project=${encodeURIComponent(currentProjectId)}`);
  }
}

function getInitialBuilderHandoff() {
  if (initialBuilderHandoff) return initialBuilderHandoff;
  const pendingFlow = readCreateProjectFlow();
  const sessionPrompt = pendingFlow?.prompt?.trim() || sessionStorage.getItem('coden-initial-prompt')?.trim() || '';
  const legacyPrompt = localStorage.getItem('coden-initial-prompt')?.trim() || '';
  const rawMode = pendingFlow?.mode || sessionStorage.getItem('coden-requested-mode');
  const rawImportContext = sessionStorage.getItem('coden-import-context') || localStorage.getItem('coden-import-context') || '';
  let importContext: Record<string, unknown> | undefined = pendingFlow?.importContext;
  if (rawImportContext) {
    try {
      const parsed = JSON.parse(rawImportContext);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) importContext = parsed;
    } catch {
      importContext = undefined;
    }
  }
  initialBuilderHandoff = {
    prompt: sessionPrompt || legacyPrompt,
    mode: rawMode === 'plan' ? 'plan' : rawMode === 'build' ? 'build' : 'auto',
    importContext,
    source: pendingFlow?.source,
    shouldAutoRun: Boolean(pendingFlow?.prompt) || new URLSearchParams(window.location.search).get('run') === 'initial',
  };
  clearCreateProjectFlow();
  sessionStorage.removeItem('coden-initial-prompt');
  sessionStorage.removeItem('coden-requested-mode');
  sessionStorage.removeItem('coden-import-context');
  localStorage.removeItem('coden-initial-prompt');
  localStorage.removeItem('coden-import-context');
  return initialBuilderHandoff;
}

function getInitialDashboardPrompt() {
  return getInitialBuilderHandoff().prompt;
}

function getInitialDashboardMode() {
  return getInitialBuilderHandoff().mode;
}

function selectedModel() {
  return selectedModelId || 'auto';
}

function normalizeBuilderModelSelection(value: unknown) {
  const raw = String(value || '').trim();
  if (!raw || raw === 'auto') return 'auto';
  return MODEL_REGISTRY.some(model => model.id === raw) ? raw : 'auto';
}

function readStoredSelectedModel() {
  try {
    return normalizeBuilderModelSelection(localStorage.getItem(SELECTED_MODEL_STORAGE_KEY));
  } catch {
    return 'auto';
  }
}

function applySelectedModel(modelId: unknown, options: { persist?: boolean; saveWorkspace?: boolean } = {}) {
  const normalized = normalizeBuilderModelSelection(modelId);
  selectedModelId = normalized;
  try {
    localStorage.setItem(SELECTED_MODEL_STORAGE_KEY, normalized);
  } catch {
    // Local storage is an optimization; the workspace state remains authoritative.
  }
  syncModelLabelFromSelection();
  if (options.saveWorkspace) scheduleWorkspaceSave({ selected_model: selectedModelId }, Boolean(options.persist));
}

function bindSharedModelSelectionEvents() {
  if (modelSelectionBridgeBound) return;
  modelSelectionBridgeBound = true;
  const syncFromEvent = (event: Event) => {
    const detail = (event as CustomEvent).detail || {};
    applySelectedModel(detail.modelId || detail.model || 'auto', { saveWorkspace: true });
  };
  window.addEventListener('coden:model-selected', syncFromEvent);
  window.addEventListener('coden:legacy-model-selected', syncFromEvent);
  window.addEventListener('storage', event => {
    if (event.key === SELECTED_MODEL_STORAGE_KEY) {
      applySelectedModel(event.newValue || 'auto');
    }
  });
}

function displayProjectName(value?: string) {
  const clean = String(value || '').trim();
  return clean || 'Projet sans titre';
}

function projectInitial(value?: string) {
  const clean = displayProjectName(value).replace(/[^a-zA-Z0-9]/g, '');
  return (clean[0] || 'H').toUpperCase();
}

function setProjectNameDisplay(value?: string) {
  currentProjectName = displayProjectName(value);
  const name = document.getElementById('project-name');
  const menuTitle = document.getElementById('project-menu-title');
  const avatar = document.getElementById('project-menu-avatar');
  const input = document.getElementById('project-name-input') as HTMLInputElement | null;
  if (name) name.textContent = currentProjectName;
  if (menuTitle) menuTitle.textContent = currentProjectName;
  if (avatar) avatar.textContent = projectInitial(currentProjectName);
  if (input && document.activeElement !== input) input.value = currentProjectName;
}

function activeBuilderView(): 'preview' | 'code' | 'database' | 'analysis' {
  const active = document.querySelector('.sub-nav-tab.active')?.id || '';
  if (active.includes('code')) return 'code';
  if (active.includes('database')) return 'database';
  if (active.includes('analysis')) return 'analysis';
  return 'preview';
}

function normalizePreviewDevice(value: unknown): PreviewDevice {
  return value === 'tablet' || value === 'mobile' ? value : 'desktop';
}

function previewDeviceLabel(device: PreviewDevice) {
  if (device === 'tablet') return 'Tablet';
  if (device === 'mobile') return 'Mobile';
  return 'Desktop';
}

function previewDeviceIcon(device: PreviewDevice) {
  if (device === 'tablet') {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="3" width="12" height="18" rx="2"></rect><path d="M11.9 17.5h.2"></path></svg>';
  }
  if (device === 'mobile') {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="2.5" width="8" height="19" rx="2"></rect><path d="M11.9 18h.2"></path></svg>';
  }
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2"></rect><path d="M8 21h8"></path><path d="M12 17v4"></path></svg>';
}

function syncPreviewAddress(label?: string | null) {
  const row = document.querySelector('.preview-address-row') as HTMLElement | null;
  const address = document.querySelector('.preview-address-glow span:last-child');
  const cleanLabel = typeof label === 'string' ? label.trim() : '';
  const hasRealPreviewAddress = Boolean(cleanLabel);
  row?.classList.toggle('address-hidden', !hasRealPreviewAddress);
  if (address) address.textContent = hasRealPreviewAddress ? cleanLabel : '';
}

function hasReadyAppPreview() {
  const frame = document.getElementById('preview-iframe-element') as HTMLIFrameElement | null;
  return currentBuilderView === 'preview'
    && currentPreviewStatus === 'verified'
    && emptyPreviewMode === 'ready'
    && isUsablePreviewHtml(currentPreviewHtml)
    && frame?.dataset.emptyPreview !== 'true'
    && frame?.dataset.designPreview !== 'true'
    && frame?.dataset.mediaPreview !== 'true';
}

function syncPreviewToolbarControls() {
  const controls = document.querySelector('.preview-toolbar-controls') as HTMLElement | null;
  const refresh = document.getElementById('btn-preview-refresh') as HTMLButtonElement | null;
  const visible = hasReadyAppPreview();
  controls?.classList.toggle('preview-controls-visible', visible);
  controls?.setAttribute('aria-hidden', visible ? 'false' : 'true');
  if (refresh) refresh.disabled = !visible;
  if (!visible) closePreviewDeviceMenu();
}

function closePreviewDeviceMenu() {
  const wrapper = document.getElementById('preview-device-toggle') as HTMLElement | null;
  const trigger = document.getElementById('preview-device-trigger') as HTMLButtonElement | null;
  wrapper?.classList.remove('open');
  trigger?.setAttribute('aria-expanded', 'false');
}

function setPreviewDevice(device: PreviewDevice, persist = true) {
  selectedPreviewDevice = normalizePreviewDevice(device);
  const panel = document.getElementById('screen-layout-preview') as HTMLElement | null;
  if (panel) panel.dataset.previewDevice = selectedPreviewDevice;
  document.querySelectorAll<HTMLButtonElement>('[data-preview-device-option]').forEach(button => {
    const active = button.dataset.previewDeviceOption === selectedPreviewDevice;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
    button.setAttribute('aria-checked', active ? 'true' : 'false');
  });
  const trigger = document.getElementById('preview-device-trigger') as HTMLButtonElement | null;
  const triggerIcon = document.getElementById('preview-device-trigger-icon');
  const triggerLabel = document.getElementById('preview-device-trigger-label');
  const label = previewDeviceLabel(selectedPreviewDevice);
  if (trigger) {
    trigger.setAttribute('aria-label', `Preview device: ${label}`);
    trigger.title = `${label} preview`;
  }
  if (triggerIcon) triggerIcon.innerHTML = previewDeviceIcon(selectedPreviewDevice);
  if (triggerLabel) triggerLabel.textContent = label;
  if (persist) scheduleWorkspaceSave({ preview_device: selectedPreviewDevice });
}

function bindPreviewDeviceToggle() {
  setPreviewDevice(selectedPreviewDevice, false);
  const wrapper = document.getElementById('preview-device-toggle') as HTMLElement | null;
  const trigger = document.getElementById('preview-device-trigger') as HTMLButtonElement | null;
  if (wrapper && trigger && trigger.dataset.boundPreviewDeviceMenu !== 'true') {
    trigger.dataset.boundPreviewDeviceMenu = 'true';
    trigger.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      const nextOpen = !wrapper.classList.contains('open');
      wrapper.classList.toggle('open', nextOpen);
      trigger.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
    });
  }
  if (document.documentElement.dataset.previewDeviceOutsideClickBound !== 'true') {
    document.documentElement.dataset.previewDeviceOutsideClickBound = 'true';
    document.addEventListener('click', event => {
      const currentWrapper = document.getElementById('preview-device-toggle');
      if (!currentWrapper?.contains(event.target as Node)) closePreviewDeviceMenu();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') closePreviewDeviceMenu();
    });
  }
  document.querySelectorAll<HTMLButtonElement>('[data-preview-device-option]').forEach(button => {
    if (button.dataset.boundPreviewDevice === 'true') return;
    button.dataset.boundPreviewDevice = 'true';
    button.addEventListener('click', event => {
      event.preventDefault();
      setPreviewDevice(normalizePreviewDevice(button.dataset.previewDeviceOption));
      closePreviewDeviceMenu();
    });
  });
}

function scheduleWorkspaceSave(patch: Partial<WorkspaceState> = {}, immediate = false) {
  if (workspaceSaveTimer !== null) window.clearTimeout(workspaceSaveTimer);
  const save = async () => {
    const input = document.getElementById('chat-textarea-box') as HTMLTextAreaElement | null;
    const body = {
      draft_prompt: input?.value || '',
      selected_mode: selectedChatMode,
      selected_model: selectedModelId,
      active_tab: activeBuilderView(),
      preview_device: selectedPreviewDevice,
      ...patch,
    };
    try {
      if (currentProjectId) {
        await apiFetch(`/api/projects/${encodeURIComponent(currentProjectId)}/workspace-state`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
      } else {
        await apiFetch('/api/users/me/workspace-state', {
          method: 'PATCH',
          body: JSON.stringify({
            builder_draft_prompt: body.draft_prompt,
            builder_selected_mode: body.selected_mode,
            builder_selected_model: body.selected_model,
            builder_active_tab: body.active_tab,
            builder_preview_device: body.preview_device,
            last_route: '/builder.html?new=1',
          }),
        });
      }
    } catch {
      // Draft persistence must never block typing or generation.
    }
  };
  if (immediate) {
    void save();
    return;
  }
  workspaceSaveTimer = window.setTimeout(save, 1500);
}

function applySidebarWidthPreference(width?: number) {
  const body = document.querySelector('.workspace-body') as HTMLElement | null;
  const sidebar = document.querySelector('.sidebar-pane') as HTMLElement | null;
  if (!body || !sidebar || !width || window.matchMedia('(max-width: 760px)').matches) return;
  if (body.classList.contains('sidebar-collapsed')) return;
  const next = Math.min(520, Math.max(280, Number(width || 380)));
  body.style.gridTemplateColumns = `${next}px minmax(0, 1fr)`;
  body.style.setProperty('--coden-sidebar-width', `${next}px`);
  const handle = document.getElementById('coden-sidebar-resizer') as HTMLElement | null;
  if (handle) handle.style.left = `${next - 4}px`;
}

function syncModelLabelFromSelection() {
  const label = document.getElementById('current-model-label');
  const options = Array.from(document.querySelectorAll<HTMLElement>('[data-model-id]'));
  const selected = options.find(option => (option.dataset.modelId || 'auto') === selectedModelId);
  if (label) label.textContent = selected?.dataset.modelName || (selectedModelId === 'auto' ? 'Auto' : selectedModelId);
  options.forEach(option => option.classList.toggle('active', (option.dataset.modelId || 'auto') === selectedModelId));
}

function applyWorkspaceState(state?: WorkspaceState | null) {
  if (!state) return;
  projectWorkspaceState = state;
  if (state.selected_mode) setChatMode(state.selected_mode);
  if (state.selected_model) {
    applySelectedModel(state.selected_model);
  }
  if (state.preview_device) setPreviewDevice(normalizePreviewDevice(state.preview_device), false);
  if (state.sidebar_width) {
    localStorage.setItem('coden-sidebar-width', String(state.sidebar_width));
    applySidebarWidthPreference(state.sidebar_width);
  }
  const handoff = getInitialBuilderHandoff();
  const input = document.getElementById('chat-textarea-box') as HTMLTextAreaElement | null;
  const submit = document.getElementById('chat-submit-btn') as HTMLButtonElement | null;
  if (input && !handoff.prompt && !input.value.trim() && state.draft_prompt) {
    input.value = repairTextEncoding(state.draft_prompt);
    input.style.height = `${Math.min(input.scrollHeight, 150)}px`;
    if (submit) syncSubmitButtonState();
  }
}

function chatScroll() {
  return document.getElementById('sidebar-scroll-area');
}

let chatScrollFrame: number | null = null;

function scrollChatToBottom() {
  const scroll = chatScroll();
  if (!scroll || chatScrollFrame !== null) return;

  const startTop = scroll.scrollTop;
  const startedAt = performance.now();
  const animate = (now: number) => {
    const target = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
    const progress = Math.min(1, (now - startedAt) / 240);
    const eased = 1 - Math.pow(1 - progress, 3);
    scroll.scrollTop = startTop + (target - startTop) * eased;
    if (progress < 1 && Math.abs(target - scroll.scrollTop) > 0.5) {
      chatScrollFrame = window.requestAnimationFrame(animate);
    } else {
      chatScrollFrame = null;
    }
  };

  chatScrollFrame = window.requestAnimationFrame(animate);
}

function ensureConversationApi() {
  if (conversationApi) return conversationApi;
  const scroll = chatScroll();
  if (!scroll) return null;
  conversationApi = mountBuilderConversation(scroll);
  bindConversationFeedbackBridge();
  return conversationApi;
}

function bindConversationFeedbackBridge() {
  if (conversationFeedbackBridgeBound) return;
  conversationFeedbackBridgeBound = true;
  window.addEventListener('coden-agent-feedback', (event: Event) => {
    const detail = (event as CustomEvent).detail || {};
    const feedback = detail.feedback === 'keep' || detail.rating === 'positive' ? 'keep' : 'reject';
    void recordAgentFeedback(feedback, {
      source: 'message_hover_toolbar',
      messageId: String(detail.messageId || ''),
      role: String(detail.role || ''),
      content: String(detail.content || ''),
      rating: detail.rating === 'positive' ? 'positive' : 'negative',
      reasons: Array.isArray(detail.reasons) ? detail.reasons : [],
      comment: String(detail.comment || ''),
    });
  });
  window.addEventListener('coden-edit-message', (event: Event) => {
    const detail = (event as CustomEvent).detail || {};
    const content = String(detail.content || '').trim();
    if (!content) return;
    const input = document.getElementById('chat-textarea-box') as HTMLTextAreaElement | null;
    if (!input) return;
    input.value = content;
    input.focus();
    input.style.height = `${Math.min(input.scrollHeight, 150)}px`;
    syncSubmitButtonState();
  });
}

function createMessageHandle(messageId: string): MessageHandle {
  const handle = document.createElement('div') as MessageHandle;
  handle.__codenMessageId = messageId;
  handle.dataset.messageId = messageId;
  return handle;
}

function messageHandleId(card: HTMLElement | null | undefined) {
  return (card as MessageHandle | null)?.__codenMessageId || card?.dataset.messageId || '';
}

function formatWorkingDuration(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}m ${seconds}s`;
}

function ensureInlineBlockHost() {
  let host = document.getElementById('chat-inline-blocks');
  if (host) return host;
  const inputRow = document.querySelector('.chat-input-row');
  host = document.createElement('div');
  host.id = 'chat-inline-blocks';
  host.style.cssText = 'display:grid;gap:8px;padding:0 24px 8px;';
  inputRow?.parentElement?.insertBefore(host, inputRow);
  return host;
}

function clearInlineBlocks() {
  const host = document.getElementById('chat-inline-blocks');
  if (host) host.innerHTML = '';
}

function startLiveRun(card: HTMLElement | null, meta: { intent?: string; activeText?: string; mode?: ChatMode; model?: string; runId?: string } = {}) {
  const id = messageHandleId(card);
  if (id && conversationApi?.startLiveRun) conversationApi.startLiveRun(id, meta);
}

function finishLiveRun(card: HTMLElement | null, summary = '') {
  const id = messageHandleId(card);
  if (id && conversationApi?.finishLiveRun) conversationApi.finishLiveRun(id, summary);
}

function failLiveRun(card: HTMLElement | null, summary: string, status: 'failed' | 'cancelled' | 'incomplete' = 'failed') {
  const id = messageHandleId(card);
  if (id && conversationApi?.failLiveRun) conversationApi.failLiveRun(id, summary, status);
  else updateMessage(card, summary);
}

function repairTextEncoding(value: unknown): string {
  let text = String(value ?? '');
  if (!text) return text;
  const replacements: Array<[RegExp, string | ((substring: string) => string)]> = [
    [/Ã©/g, 'é'],
    [/Ã¨/g, 'è'],
    [/Ãª/g, 'ê'],
    [/Ã«/g, 'ë'],
    [/Ã /g, 'à'],
    [/Ã¢/g, 'â'],
    [/Ã§/g, 'ç'],
    [/Ã®/g, 'î'],
    [/Ã¯/g, 'ï'],
    [/Ã´/g, 'ô'],
    [/Ã¹/g, 'ù'],
    [/Ã»/g, 'û'],
    [/Ã¼/g, 'ü'],
    [/Ã‰/g, 'É'],
    [/Â /g, ' '],
    [/Â/g, ''],
    [/â€™/g, "'"],
    [/â€œ|â€/g, '"'],
    [/â€“|â€”/g, '-'],
    [/cr�e/gi, match => match[0] === 'C' ? 'Crée' : 'crée'],
    [/cr�er/gi, match => match[0] === 'C' ? 'Créer' : 'créer'],
    [/g�n�re/gi, match => match[0] === 'G' ? 'Génère' : 'génère'],
    [/g�n�rer/gi, match => match[0] === 'G' ? 'Générer' : 'générer'],
    [/g�n�ration/gi, match => match[0] === 'G' ? 'Génération' : 'génération'],
    [/t�che/gi, match => match[0] === 'T' ? 'Tâche' : 'tâche'],
    [/t�ches/gi, match => match[0] === 'T' ? 'Tâches' : 'tâches'],
    [/�tat/gi, match => match[0] === '�' ? 'état' : 'état'],
    [/r�ponse/gi, match => match[0] === 'R' ? 'Réponse' : 'réponse'],
    [/pr�t/gi, match => match[0] === 'P' ? 'Prêt' : 'prêt'],
    [/d�j�/gi, 'déjà'],
    [/�/g, 'é'],
  ];
  for (const [pattern, replacement] of replacements) {
    text = typeof replacement === 'function'
      ? text.replace(pattern, replacement)
      : text.replace(pattern, replacement);
  }
  return text;
}

function appendMessage(kind: 'user' | 'assistant' | 'system', body: string, options: { working?: boolean } = {}) {
  const safeBody = repairTextEncoding(redactSecrets(body));
  const api = ensureConversationApi();
  if (api) {
    const id = api.addMessage({ role: kind, content: safeBody, working: Boolean(options.working) });
    return createMessageHandle(id);
  }

  const scroll = chatScroll();
  if (!scroll) return null;

  const card = document.createElement('div');
  card.className = `message-card message-card-${kind}`;
  card.innerHTML = `
    <p class="msg-body-paragraph" style="white-space:pre-wrap;"></p>
  `;
  const paragraph = card.querySelector('.msg-body-paragraph');
  if (paragraph) paragraph.textContent = safeBody;
  if (options.working) card.setAttribute('aria-busy', 'true');
  scroll.appendChild(card);
  scrollChatToBottom();
  return card;
}

function setMessageShimmer(card: HTMLElement | null, label = 'Coden is writing', withTimer = true) {
  // [REMPLACEMENT STREAMING UI ICI]
  // Ancien shimmer/progress/token streaming retire: on conserve seulement un
  // etat d'attente textuel pour ne pas casser le flux d'envoi.
  if (!card) return;
  void withTimer;
  const id = messageHandleId(card);
  if (id && conversationApi) {
    conversationApi.setWorking(id, label);
  }
  card.setAttribute('aria-busy', 'true');
  if (!id || !conversationApi) updateMessage(card, label);
}

function clearMessageShimmer(card: HTMLElement | null) {
  if (!card) return;
  const id = messageHandleId(card);
  if (id && conversationApi) conversationApi.clearWorking(id);
  card.removeAttribute('aria-busy');
}

function appendToMessageShimmer(card: HTMLElement | null, text: string) {
  void card;
  void text;
  // [REMPLACEMENT STREAMING UI ICI]
  // Token-by-token rendering intentionally removed.
}

function completeMessageShimmer(card: HTMLElement | null, label = 'Completed') {
  if (!card) return;
  const id = messageHandleId(card);
  if (id && conversationApi) conversationApi.clearWorking(id);
  card.removeAttribute('aria-busy');
  updateMessage(card, label);
}
function updateMessage(card: HTMLElement | null, body: string) {
  const safeBody = repairTextEncoding(redactSecrets(body));
  const id = messageHandleId(card);
  
  const scroll = document.getElementById("sidebar-scroll-area");
  const isAtBottom = scroll ? Math.abs(scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop) < 60 : false;

  if (id && conversationApi) {
    conversationApi.updateMessage(id, safeBody);
  } else {
    const paragraph = card?.querySelector('.msg-body-paragraph');
    if (paragraph) paragraph.textContent = safeBody;
  }

  if (isAtBottom && scroll) {
    scrollChatToBottom();
  }
}

function setMessageBlock(card: HTMLElement | null, block: CodenConversationBlock | null) {
  if (!card) return;
  const id = messageHandleId(card);
  if (id && conversationApi?.setBlock) {
    conversationApi.setBlock(id, block);
  }
}

type CodenStreamEntry = {
  id: string;
  kind: 'update' | 'group' | 'divider' | 'summary' | 'narration' | 'thinking' | 'file_edit' | 'command';
  text: string;
  detail?: string;
  status?: 'active' | 'done' | 'failed' | 'cancelled' | 'muted';
  items?: string[];
  path?: string;
  action?: 'created' | 'modified' | 'deleted';
  additions?: number;
  deletions?: number;
  command?: string;
};

type CodenStreamPartsState = {
  status: 'active' | 'done' | 'failed' | 'cancelled';
  startedAt?: string;
  elapsed?: string;
  entries: CodenStreamEntry[];
  activeText?: string;
  finalText?: string;
  restored?: boolean;
};

function createCodenStreamPartsState(): CodenStreamPartsState {
  return {
    status: 'active',
    startedAt: new Date().toISOString(),
    elapsed: '0m 00s',
    entries: [],
    activeText: 'Je commence par cadrer le résultat attendu avant de toucher au projet.',
  };
}

const FLOW_MILESTONE_INDEX: Record<string, number> = {
  understanding: 0, inspecting: 0,
  planning: 1,
  generating: 2, generation: 2,
  checking: 3, eval: 3, eval_ok: 3, eval_fail: 3, fixing: 3,
  preview_ready: 4, preview: 4,
};

function buildInitialFlowChecklist(speaksFrench: boolean): CodenFlowChecklistItem[] {
  const labels = speaksFrench
    ? [
        'Comprendre la demande',
        'Planifier la construction',
        'Générer les fichiers',
        'Vérifier le résultat',
        "Préparer l'aperçu",
      ]
    : [
        'Understand the request',
        'Plan the build',
        'Generate the files',
        'Verify the result',
        'Prepare the preview',
      ];
  return labels.map((label, index) => ({
    id: `flow_${index}`,
    label,
    status: 'pending' as const,
  }));
}

function advanceFlowChecklist(list: CodenFlowChecklistItem[], key: string): CodenFlowChecklistItem[] {
  const targetIndex = FLOW_MILESTONE_INDEX[key];
  if (targetIndex === undefined) return list;
  return list.map((item, index) => {
    if (index < targetIndex) return { ...item, status: 'done' as const };
    if (index === targetIndex && item.status !== 'done') return { ...item, status: 'active' as const };
    return item;
  });
}

function streamEntryStatus(status: CodenStreamEntry['status']) {
  if (status === 'failed' || status === 'cancelled') return 'failed';
  if (status === 'active') return 'active';
  if (status === 'muted') return 'done';
  return status || 'done';
}

function streamEntryBody(entry: CodenStreamEntry) {
  const lines: string[] = [];
  if (entry.detail) lines.push(entry.detail);
  if (entry.items?.length) lines.push(...entry.items);
  return lines.join('\n').trim();
}

function streamEntryToMessagePart(entry: CodenStreamEntry): CodenMessagePart | null {
  if (entry.kind === 'divider') return null;
  if (entry.kind === 'thinking') {
    const text = sanitizeModelStreamText(entry.detail || entry.text);
    if (!text) return null;
    return {
      id: entry.id,
      type: 'reasoning',
      text,
      status: streamEntryStatus(entry.status),
    };
  }
  if (entry.kind === 'command') {
    return {
      id: entry.id,
      type: 'terminal',
      command: entry.command || entry.text,
      output: streamEntryBody(entry),
      status: streamEntryStatus(entry.status),
      running: entry.status === 'active',
    };
  }
  if (entry.kind === 'file_edit') {
    return {
      id: entry.id,
      type: 'file_edit',
      name: entry.action === 'created'
        ? 'Creation de fichier'
        : entry.action === 'deleted'
          ? 'Suppression de fichier'
          : 'Modification de fichier',
      text: entry.text,
      detail: entry.detail,
      status: streamEntryStatus(entry.status),
      path: entry.path,
      action: entry.action,
      additions: entry.additions,
      deletions: entry.deletions,
    };
  }
  if (entry.kind === 'group') {
    const name = sanitizeModelStreamText(entry.text) || entry.text;
    const items = (entry.items || [])
      .map(item => sanitizeModelStreamText(item))
      .filter(Boolean);
    return {
      id: entry.id,
      type: 'tool_call',
      name,
      status: streamEntryStatus(entry.status),
      items,
      result: items.join('\n'),
    };
  }
  const text = sanitizeModelStreamText(entry.text);
  const detail = sanitizeModelStreamText(entry.detail || '');
  if (!text && !detail) return null;
  return {
    id: entry.id,
    type: 'text',
    text: [text, detail && journalTextKey(detail) !== journalTextKey(text) ? detail : ''].filter(Boolean).join('\n'),
  };
}

function streamStateToMessageParts(state: CodenStreamPartsState | null): CodenMessagePart[] {
  if (!state) return [];
  const parts: CodenMessagePart[] = [];
  const seen = new Set<string>();
  const hasActiveReasoning = state.entries.some(entry => entry.kind === 'thinking' && entry.status === 'active');
  const activeText = sanitizeModelStreamText(state.activeText || '');
  if (state.status === 'active' && activeText && !hasActiveReasoning) {
    seen.add(semanticJournalKey(activeText));
    parts.push({
      id: 'stream_active_reasoning',
      type: 'reasoning',
      text: activeText,
      status: 'active',
      elapsed: state.elapsed,
    });
  }
  for (const entry of state.entries) {
    const part = streamEntryToMessagePart(entry);
    if (!part) continue;
    const key = semanticJournalKey(String(part.text || part.result || part.name || part.command || part.path || ''));
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    parts.push(part);
  }
  if (state.finalText) {
    const finalText = sanitizeModelStreamText(state.finalText);
    const normalizedFinal = semanticJournalKey(finalText);
    const alreadyVisible = parts.some(part => semanticJournalKey(String(part.text || part.result || '')) === normalizedFinal);
    if (finalText && !alreadyVisible) parts.push({ id: 'stream_final_text', type: 'text', text: finalText });
  }
  return parts;
}

function setStreamMessageParts(card: HTMLElement | null, state: CodenStreamPartsState | null) {
  if (!card) return;
  const id = messageHandleId(card);
  if (!id || !conversationApi) return;
  conversationApi.setParts(id, streamStateToMessageParts(state));
  conversationApi.clearWorking(id);
}

function removeMessage(card: HTMLElement | null) {
  if (!card) return;
  const id = messageHandleId(card);
  if (id && conversationApi) {
    conversationApi.removeMessage(id);
    return;
  }
  card.remove();
}

function showTransientNotice(body: string, duration = 2400) {
  const card = appendMessage('system', body);
  if (duration > 0) window.setTimeout(() => removeMessage(card), duration);
  return card;
}

function isLikelyFrenchText(value: string) {
  const normalized = String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’‘`´ʼʹ]/g, "'");
  return /\b(je|tu|vous|nous|veux|j'aimerais|j aimerais|qu'est ce|qu est ce|cree|creer|genere|generer|corrige|repare|explique|comment|pourquoi|bonjour|salut|merci|projet|application|app web|couleur|bouton|tache|taches|supprime|ajoute|ameliore)\b/i.test(normalized);
}

function normalizePromptIntentText(value: string) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’‘`´ʼʹ']/g, ' ')
    .replace(/[!?.,;:()[\]{}"“”«»]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isQuickConversationPrompt(value: string, mode: ChatMode) {
  if (mode !== 'auto') return false;
  const normalized = normalizePromptIntentText(value);
  if (!normalized || normalized.length > 420) return false;
  const projectContextHints = /\b(ce projet|cette app|cette application|mon projet|mon app|mon application|l app actuelle|le code actuel|les fichiers|dans le projet|dans l application|preview actuelle|fichiers actuels|current project|current app|current files|existing code)\b/i;
  if (projectContextHints.test(normalized)) return false;
  const explicitProjectAction = /\b(create|build|generate|make|add|edit|change|modify|fix|debug|deploy|publish|implement|cr[ée]e|creer|g[ée]n[èe]re|genere|ajoute|modifie|corrige|d[ée]ploie|deploie|publie|supprime|remplace|impl[ée]mente|ameliore|am[ée]liore)\b[\s\S]{0,90}\b(app|application|site|page|component|composant|api|database|base de donnees|interface|dashboard|builder|projet|code|bug|auth|login|supabase|vercel|railway|button|bouton|couleur|color|texte|text|footer|header|pricing|settings|publish|design|ui|ux|saas|agent)\b/i;
  if (explicitProjectAction.test(normalized)) return false;
  const bareCriticalAction = /^(publish|publie|deploie|d[ée]ploie|deploy|rollback|restore|supprime|delete|efface|connecte domaine|custom domain)\b/i;
  if (bareCriticalAction.test(normalized)) return false;
  const direct = new Set([
    'bonjour',
    'bonsoir',
    'salut',
    'coucou',
    'hello',
    'hi',
    'hey',
    'merci',
    'thanks',
    'thank you',
    'ok',
    'okay',
    'd accord',
    'daccord',
    'comment ca va',
    'comment ça va',
    'how are you',
    'que peux tu faire',
    'que peux-tu faire',
    'que sais tu faire',
    'que sais-tu faire',
    'qu est ce que tu sais faire',
    "qu'est ce que tu sais faire",
    "qu'est-ce que tu sais faire",
    'tu peux faire quoi',
    'what can you do',
    'what are you able to do',
    'aide moi',
    'help me',
    'je veux juste discuter',
    'je veux discuter',
    'juste discuter',
    'parlons',
    'lets chat',
    'let s chat',
  ]);
  if (direct.has(normalized)) return true;
  if (/\b(dis moi|dit moi|c est quoi|c'est quoi|qu est ce que|qu'est ce que|qu'est-ce que|explique|pourquoi|comment|conseil|avis|compare|resume|reformule|corrige ce texte|que penses tu|note mon|peux tu me dire|est ce que|what is|what are|why|how|should|can you explain|tell me about)\b/i.test(normalized)) {
    return true;
  }
  return /^(qui es tu|qui es-tu|tu es qui|what are you|what is coden|c est quoi coden|c'est quoi coden|comment tu peux m aider|comment tu peux m'aider)/i.test(normalized);
}

function classifyPromptUiContext(value: string, mode: ChatMode): PromptUiContext {
  const normalized = normalizePromptIntentText(value);
  if (!normalized) return 'chat_simple';
  if (activeWorkshop !== 'chat') return 'project_mission';
  const bareAction = /^(cr[ée]e|creer|g[ée]n[èe]re|genere|create|build|make|ajoute|modifie|corrige|ameliore|am[ée]liore|refais|implemente|impl[ée]mente|applique|fais)(\s+(app|site|application|ca|ça|tout|cela))?$/i;
  if (bareAction.test(normalized)) return 'clarification_only';
  const legacyIntent = isQuickConversationPrompt(value, mode)
    ? 'conversation'
    : mode === 'plan'
      ? 'plan'
      : mode === 'build'
        ? currentFiles.length ? 'edit' : 'build'
        // Auto must preserve a project mission once the prompt is no longer a
        // simple conversation. The server Decision Core remains the authority
        // for the concrete action; this local branch only chooses the correct
        // transport (project generation instead of the chat stream).
        : 'build';
  const contract = buildExecutionContract({
    prompt: value,
    requestedMode: mode,
    hasFiles: currentFiles.length > 0,
    hasLastPlan: Boolean(lastPlan),
    legacyDecision: {
      intent: legacyIntent,
      confidence: 0.8,
      requestedMode: mode,
      requiresFileChanges: legacyIntent === 'build' || legacyIntent === 'edit',
      requiresPreviewRebuild: legacyIntent === 'build' || legacyIntent === 'edit',
      requiresCredits: legacyIntent !== 'conversation',
      userVisibleReason: 'Local builder gate',
    },
  });
  if (contract.mode === 'chat' || contract.mode === 'discuss_first') return 'chat_simple';
  if (contract.mode === 'clarify' || contract.mode === 'blocked') return 'clarification_only';
  if (contract.mode === 'plan' || contract.mode === 'verify') return 'planning_only';
  if (contract.mode === 'critical_action') return 'critical_action';
  return 'project_mission';
}

function showAssistantBubble(card: HTMLElement | null, text: string) {
  const safeText = redactSecrets(text);
  updateMessage(card, safeText);
  clearMessageShimmer(card);
  return Promise.resolve();
}

function recentConversationForAssistant(currentPrompt = '') {
  const api = ensureConversationApi();
  const normalizedPrompt = redactSecrets(currentPrompt).trim();
  const messages = (api?.messages() || [])
    .filter(message => (message.role === 'user' || message.role === 'assistant') && !message.working && String(message.content || '').trim())
    .slice(-12);
  const latest = messages[messages.length - 1];
  if (latest?.role === 'user' && redactSecrets(String(latest.content || '')).trim() === normalizedPrompt) {
    messages.pop();
  }
  return messages.map(message => ({
      role: message.role,
      content: redactSecrets(String(message.content || '')).slice(0, 2400),
    }));
}

function looksLikeGeneratedSourceDump(value: unknown) {
  const text = redactSecrets(String(value || '')).trim();
  if (text.length < 420) return false;

  const signals = [
    /```(?:tsx|jsx|ts|js|html|css|json)\b/i,
    /\bsrc\/(?:App|main|components|pages|lib)\.(?:tsx|jsx|ts|js)\b/i,
    /\bimport\s+(?:\*\s+as\s+)?React\b|\bfrom\s+['"]react['"]/i,
    /\bexport\s+default\s+(?:function|class|const)?\s*App\b/i,
    /\bfunction\s+App\s*\(|\bconst\s+App\s*[:=]/i,
    /\buseState\s*\(|\buseEffect\s*\(/i,
    /\bclassName\s*=\s*["'{]/i,
    /\blocalStorage\.(?:getItem|setItem)\s*\(/i,
    /<!doctype\s+html>|<html[\s>]|<body[\s>]/i,
  ].filter(pattern => pattern.test(text)).length;

  return signals >= 2;
}

function looksLikeInternalRecoveryText(value: string) {
  return /\b(draft recuperable|draft récupérable|recoverable draft|coden stopped before saving|blocking issue|blocking issues|points bloquants|blocage restant|forced runtime failure marker|preview contains a known forced runtime failure marker|task app must support|commerce app must include|technical build score|changes:\s*0 created|verification:\s*coden stopped)\b/i.test(value);
}

function safeAssistantDisplayText(value: unknown, _speaksFrench = false) {
  const text = repairTextEncoding(redactSecrets(String(value || '').trim()));
  if (!text) return '';
  const unfenced = text
    .replace(/^```(?:json|ts|tsx|html|css|javascript|typescript)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  if (looksLikeInternalRecoveryText(unfenced)) return '';
  if (/^[\[{]/.test(unfenced) && /["']?(status|plan|steps|target_files|next_action|files)["']?\s*:/.test(unfenced)) {
    return '';
  }
  if (looksLikeGeneratedSourceDump(text)) return '';
  return text.replace(/\n\s*[-*]\s*$/gm, '').trim();
}

async function streamSimpleConversation(card: HTMLElement | null, prompt: string, speaksFrench: boolean, requestedMode: ChatMode = 'auto'): Promise<boolean> {
  const session = await getVerifiedSession({ allowRefresh: true });
  const accessToken = session?.session?.access_token;
  if (!accessToken) throw new Error('An authenticated session is required to request a real AI response.');
  const messageId = messageHandleId(card);
  let streamedText = '';
  let finalPayload: any = null;
  const stream = openCodenStream({
    url: `${API_BASE_URL}/api/assistant/chat/stream`,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        prompt,
        requestedMode,
        modelId: selectedModel(),
        projectId: currentProjectId || undefined,
        messages: recentConversationForAssistant(prompt),
        clientMessageId: messageId ? `${messageId}_user` : undefined,
        assistantMessageId: messageId || undefined,
      }),
    },
    signal: activeAbort?.signal,
    resumeRequest: currentProjectId ? ({ threadId, turnId }) => ({
      url: `${API_BASE_URL}/api/projects/${encodeURIComponent(currentProjectId)}/agent/threads/${encodeURIComponent(threadId)}/events?format=sse${turnId ? `&turnId=${encodeURIComponent(turnId)}` : ''}`,
      init: { method: 'GET', headers: { Authorization: `Bearer ${accessToken}` } },
    }) : undefined,
    onEvent: (type, data) => {
      if (data?.runId) lastAgentRunId = String(data.runId);
      if (data?.threadId) activeHarnessThreadId = String(data.threadId);
      if (data?.turnId) activeHarnessTurnId = String(data.turnId);
      const id = messageId;
      if (id && conversationApi && isCodenStreamEvent(data)) conversationApi.applyStreamEvent(id, data);
      if (type === 'assistant_delta') {
        const delta = String(data?.text || data?.content || '');
        if (!delta) return;
        streamedText += delta;
        if (!id || !conversationApi) updateMessage(card, streamedText);
      } else if (type === 'done') {
        finalPayload = data?.payload || data;
      }
    },
    maxRetries: currentProjectId ? 4 : 0,
  });
  activeStreamHandle = stream;
  try {
    await stream.done;
  } finally {
    if (activeStreamHandle === stream) activeStreamHandle = null;
  }
  if (finalPayload?.success === false) throw new Error(finalPayload.message || finalPayload.error || 'Assistant response failed.');
  const content = String(finalPayload?.text || streamedText || '').trim();
  if (!content) throw new Error('The selected AI model returned an empty response.');
  const safeContent = safeAssistantDisplayText(content, speaksFrench);
  if (!safeContent) throw new Error('The selected AI model returned a response that failed the output safety checks.');
  if (messageId && conversationApi) conversationApi.updateMessage(messageId, safeContent);
  else updateMessage(card, safeContent);
  clearMessageShimmer(card);
  return true;
}

async function streamProjectGeneration(
  projectId: string,
  requestBody: Record<string, unknown>,
  onEvent: (type: string, data: any) => void,
  signal?: AbortSignal,
): Promise<any> {
  // Compatibility fallback contract: /api/projects/${encodeURIComponent(currentProjectId)}/generate
  const session = await getVerifiedSession({ allowRefresh: true });
  const accessToken = session?.session?.access_token;
  if (!accessToken) throw new Error('An authenticated session is required to start a real generation run.');

  let finalPayload: any = null;
  let streamObserved = false;
  const stream = openCodenStream({
    url: `${API_BASE_URL}/api/projects/${encodeURIComponent(projectId)}/generate?stream=true`,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(requestBody),
    },
    signal,
    resumeRequest: ({ threadId, turnId }) => ({
      url: `${API_BASE_URL}/api/projects/${encodeURIComponent(projectId)}/agent/threads/${encodeURIComponent(threadId)}/events?format=sse${turnId ? `&turnId=${encodeURIComponent(turnId)}` : ''}`,
      init: { method: 'GET', headers: { Authorization: `Bearer ${accessToken}` } },
    }),
    onConnected: () => { streamObserved = true; },
    onEvent: (type, data) => {
      streamObserved = true;
      if (type === 'done') finalPayload = data?.payload || data;
      onEvent(type, data);
    },
    maxRetries: 4,
  });
  activeStreamHandle = stream;
  try {
    await stream.done;
  } catch (error) {
    if (signal?.aborted || stream.isCancelled()) throw new DOMException('The generation was cancelled.', 'AbortError');
    if (!finalPayload && !streamObserved && error instanceof CodenStreamHttpError && [404, 405, 501].includes(error.status)) {
      throw new Error('The Coden Stream v2 endpoint is unavailable. Retry the same run or choose another model.');
    }
    throw error;
  } finally {
    if (activeStreamHandle === stream) activeStreamHandle = null;
  }
  if (!finalPayload) throw new CodenStreamIncompleteError();
  return finalPayload;
}

async function answerSimpleConversationFromProvider(card: HTMLElement | null, prompt: string, speaksFrench: boolean, requestedMode: ChatMode = 'auto') {
  setBusy(true);
  startLiveRun(card, { mode: requestedMode, model: selectedModel(), intent: prompt });
  try {
    // There is one production transport: the selected model's SSE stream.
    // A failed stream must remain an honest failure, never a hidden second run.
    await streamSimpleConversation(card, prompt, speaksFrench, requestedMode);
  } catch (error) {
    const message = error instanceof Error && error.message.trim()
      ? error.message.trim()
      : 'The selected AI model did not return a usable response.';
    updateMessage(card, message);
  } finally {
    setBusy(false);
    // Safety net: if the stream ended, was cancelled, or failed before any
    // assistant_delta arrived, ensure the thinking shimmer never sticks.
    clearMessageShimmer(card);
  }
}

function appendCriticalActionConfirmation(prompt: string, speaksFrench: boolean) {
  const card = appendMessage('assistant', '');
  const normalized = normalizePromptIntentText(prompt);
  const wantsPublish = /\b(publish|publie|publier|deploy|deploie|d[ée]ploie|mets en ligne|met en ligne)\b/i.test(normalized);
  const wantsRollback = /\b(rollback|restore|restaure|retour en arriere)\b/i.test(normalized);
  const title = speaksFrench ? 'Confirmation nécessaire' : 'Confirmation required';
  const body = speaksFrench
    ? wantsPublish
      ? 'Publier mettra en ligne la version actuelle. Je peux ouvrir le panneau Publish pour vérifier l’URL, les checks et le domaine avant action.'
      : wantsRollback
        ? 'Un rollback remplace la preview par une version précédente. Confirme avant que je touche à l’historique.'
        : 'Cette action peut modifier fortement ton projet. Confirme avant que je continue.'
    : wantsPublish
      ? 'Publishing will put the current version live. I can open the Publish panel so you can review the URL, checks, and domain first.'
      : wantsRollback
        ? 'A rollback replaces the preview with an older version. Please confirm before I touch history.'
        : 'This action can significantly change your project. Please confirm before I continue.';
  setMessageBlock(card, {
    type: 'confirmation',
    title,
    body,
    state: 'approval-requested',
    approveLabel: speaksFrench ? 'Continuer' : 'Continue',
    rejectLabel: speaksFrench ? 'Annuler' : 'Cancel',
  });
  if (wantsPublish) {
    addInlineAction(card, speaksFrench ? 'Ouvrir Publish' : 'Open Publish', () => void openPublishPanel());
  } else if (wantsRollback) {
    addInlineAction(card, speaksFrench ? 'Voir historique' : 'View history', () => void openHistoryPanel());
  } else {
    addInlineAction(card, speaksFrench ? 'Continuer en mission' : 'Continue as mission', () => void generateFromPrompt(prompt, 'auto', false, { confirmedCriticalAction: true }, prompt));
  }
  addInlineAction(card, speaksFrench ? 'Annuler' : 'Cancel', () => {
    setMessageBlock(card, {
      type: 'confirmation',
      title,
      body: speaksFrench ? 'Action annulée. Rien n’a été modifié.' : 'Action cancelled. Nothing was changed.',
      state: 'rejected',
      approveLabel: speaksFrench ? 'Continuer' : 'Continue',
      rejectLabel: speaksFrench ? 'Annuler' : 'Cancel',
    });
  });
  return card;
}

function addInlineAction(card: HTMLElement | null, label: string, action: () => void) {
  if (!card) return;
  const id = messageHandleId(card);
  if (id && conversationApi) {
    conversationApi.addAction(id, label, action);
    return;
  }
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.style.cssText = 'margin-top:10px;height:30px;border:1px solid var(--border);background:var(--text);color:var(--bg);border-radius:7px;padding:0 10px;font-size:11px;font-weight:700;cursor:pointer;';
  button.addEventListener('click', action);
  card.appendChild(button);
}

function formatAgentErrorMessage(event: any) {
  const payload = event?.payload || {};
  const base = String(event?.message || payload.message || 'Generation failed.').trim();
  if (/generation failed or empty response/i.test(base)) {
    return 'Coden n’a pas reçu de fichiers valides à afficher. Le travail reste récupérable et une nouvelle tentative peut repartir proprement.';
  }
  if (/preview contains a known forced runtime failure marker/i.test(base)) {
    return 'La preview contient encore un marqueur de crash. Coden doit le retirer, reconstruire, puis retester avant de livrer.';
  }
  const diagnostic = typeof payload.diagnostic_code === 'string' && payload.diagnostic_code.trim()
    ? ` Code: ${payload.diagnostic_code.trim()}.`
    : '';
  const action = typeof payload.suggested_action === 'string' && payload.suggested_action.trim()
    ? ` Suggested action: ${payload.suggested_action.trim().replace(/_/g, ' ')}.`
    : '';
  const requestId = typeof payload.request_id === 'string' && payload.request_id.trim()
    ? ` Request ID: ${payload.request_id.trim()}.`
    : '';
  return `${base}${diagnostic}${action}${requestId}`;
}

function positionProjectMenu() {
  const trigger = document.getElementById('project-combo-trigger') as HTMLElement | null;
  const panel = document.getElementById('project-menu-panel') as HTMLElement | null;
  if (!trigger || !panel) return;
  const rect = trigger.getBoundingClientRect();
  const maxLeft = window.innerWidth - Math.min(390, window.innerWidth - 24) - 12;
  panel.style.left = `${Math.max(12, Math.min(rect.left, maxLeft))}px`;
  panel.style.top = `${Math.min(rect.bottom + 10, window.innerHeight - 80)}px`;
}

function closeProjectMenu() {
  const panel = document.getElementById('project-menu-panel');
  const trigger = document.getElementById('project-combo-trigger');
  panel?.classList.remove('open');
  panel?.setAttribute('aria-hidden', 'true');
  trigger?.setAttribute('aria-expanded', 'false');
}

async function loadProjectMenuCredits() {
  const status = document.getElementById('project-menu-credit-status');
  const fill = document.getElementById('project-menu-credit-fill') as HTMLElement | null;
  try {
    const wallet = await apiFetch<BillingWalletResponse>('/api/billing/wallet');
    const balance = Number(wallet.balance ?? 0);
    lastWalletBalance = Number.isFinite(balance) ? balance : null;
    const monthly = Number(wallet.buckets?.monthly_credits ?? 0);
    const percent = monthly > 0 ? Math.max(0, Math.min(100, Math.round((balance / monthly) * 100))) : 100;
    syncBuilderPlanBadges(wallet.plan || 'free');
    if (status) status.textContent = `${Number.isFinite(balance) ? balance : 0} credits · ${planLabel(currentPlanKey)} plan`;
    if (fill) fill.style.width = `${percent}%`;
  } catch {
    syncBuilderPlanBadges('free');
    if (status) status.textContent = 'View credit usage in Settings.';
    if (fill) fill.style.width = '100%';
  }
}

function openProjectMenu() {
  const panel = document.getElementById('project-menu-panel');
  const trigger = document.getElementById('project-combo-trigger');
  if (!panel || !trigger) return;
  const isOpen = panel.classList.contains('open');
  if (isOpen) {
    closeProjectMenu();
    return;
  }
  setProjectNameDisplay(currentProjectName);
  positionProjectMenu();
  panel.classList.add('open');
  panel.setAttribute('aria-hidden', 'false');
  trigger.setAttribute('aria-expanded', 'true');
  void loadProjectMenuCredits();
}

function validateProjectName(value: string) {
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (clean.length < 2) return { ok: false, value: clean, error: 'Use at least 2 characters.' };
  if (clean.length > 80) return { ok: false, value: clean.slice(0, 80), error: 'Use 80 characters or fewer.' };
  return { ok: true, value: clean, error: '' };
}

async function saveProjectNameFromMenu() {
  const input = document.getElementById('project-name-input') as HTMLInputElement | null;
  const status = document.getElementById('project-name-status');
  const button = document.getElementById('project-name-save') as HTMLButtonElement | null;
  const validation = validateProjectName(input?.value || '');
  if (!validation.ok) {
    if (status) status.textContent = validation.error;
    return;
  }
  if (!currentProjectId) {
    setProjectNameDisplay(validation.value);
    if (status) status.textContent = 'Name saved for the next project.';
    return;
  }
  try {
    if (button) {
      button.disabled = true;
      button.textContent = 'Saving';
    }
    const response = await apiFetch<{ success: boolean; project: { name: string; slug?: string } }>(`/api/projects/${encodeURIComponent(currentProjectId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: validation.value }),
    });
    setProjectNameDisplay(response.project?.name || validation.value);
    if (status) status.textContent = 'Project name saved.';
  } catch (error) {
    if (status) status.textContent = error instanceof Error ? error.message : 'Unable to save project name.';
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = 'Save';
    }
  }
}

function bindProjectMenu() {
  const trigger = document.getElementById('project-combo-trigger');
  if (!trigger || trigger.dataset.boundProjectMenu === 'true') return;
  trigger.dataset.boundProjectMenu = 'true';
  trigger.addEventListener('click', event => {
    event.preventDefault();
    openProjectMenu();
  });
  document.getElementById('project-menu-dashboard')?.addEventListener('click', () => {
    window.location.href = '/dashboard.html';
  });
  document.getElementById('project-menu-upgrade')?.addEventListener('click', () => {
    closeProjectMenu();
    (document.querySelector('.btn-upgrade') as HTMLButtonElement | null)?.click();
  });
  document.getElementById('project-menu-free-credits')?.addEventListener('click', () => {
    showMiniModal('Get free credits', '<p>Free credit campaigns are not configured yet. Upgrade or buy credits to continue building without interruption.</p>', () => {});
  });
  document.getElementById('project-menu-settings')?.addEventListener('click', () => {
    closeProjectMenu();
    void openBuilderSettings('ai-usage');
  });
  document.getElementById('project-menu-history')?.addEventListener('click', () => {
    closeProjectMenu();
    void openHistoryPanel();
  });
  document.getElementById('project-name-save')?.addEventListener('click', () => void saveProjectNameFromMenu());
  document.getElementById('project-name-input')?.addEventListener('keydown', event => {
    if ((event as KeyboardEvent).key === 'Enter') void saveProjectNameFromMenu();
  });
  document.addEventListener('click', event => {
    const panel = document.getElementById('project-menu-panel');
    if (!panel?.classList.contains('open')) return;
    if (panel.contains(event.target as Node) || trigger.contains(event.target as Node)) return;
    closeProjectMenu();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeProjectMenu();
  });
  window.addEventListener('resize', positionProjectMenu);
}

function bindConnectorsButton() {
  document.querySelectorAll<HTMLButtonElement>('#btn-connectors, [data-open-connectors]').forEach(button => {
    if (button.dataset.codenConnectorsBound === 'true') return;
    button.dataset.codenConnectorsBound = 'true';
    button.addEventListener('click', event => {
      event.preventDefault();
      openConnectorsPanel({ projectId: currentProjectId || undefined });
    });
  });
  if (connectorsBridgeBound) return;
  connectorsBridgeBound = true;
  document.addEventListener('coden:open-connectors', () => {
    openConnectorsPanel({ projectId: currentProjectId || undefined });
  });
  document.addEventListener('coden:open-settings', event => {
    const tab = String((event as CustomEvent).detail?.tab || 'connectors');
    void openBuilderSettings(tab);
  });
}

// WebContainer state: cached URL + teardown for the current preview boot.
let webContainerUrl = '';
let webContainerTeardown: (() => void) | null = null;
let webContainerBootInFlight = false;

async function tryBootWebContainerPreview(frame: HTMLIFrameElement, files: GeneratedFile[]) {
  if (webContainerBootInFlight) return false;
  try {
    const mod = await import('./services/webcontainer-runner.ts');
    if (!mod.webContainerPreviewEnabled() || !mod.webContainersSupported()) return false;
    if (!files || files.length === 0) return false;
    webContainerBootInFlight = true;
    // Tear down any previous boot before starting a new one.
    if (webContainerTeardown) { try { webContainerTeardown(); } catch { /* ignore */ } webContainerTeardown = null; }
    const result = await mod.bootCodenWebContainer({
      files: files.map(f => ({ path: f.path, content: f.content })),
    });
    if (result.ok) {
      webContainerUrl = result.url;
      webContainerTeardown = result.teardown;
      frame.removeAttribute('srcdoc');
      frame.src = result.url;
      return true;
    }
    return false;
  } catch {
    return false;
  } finally {
    webContainerBootInFlight = false;
  }
}

function setPreview(html: string, status = 'unknown') {
  const normalizedStatus = String(status || '').trim().toLowerCase() || 'idle';
  if (normalizedStatus !== 'verified' || !isUsablePreviewHtml(html)) {
    currentPreviewHtml = '';
    currentPreviewStatus = normalizedStatus;
    emptyPreviewMode = normalizedStatus === 'building' ? 'working' : 'idle';
    setEmptyPreviewState(emptyPreviewMode, normalizedStatus === 'building' ? 'Generating' : normalizedStatus === 'needs_fix' ? 'Preview needs verification' : 'Preview not verified');
    syncProjectReadinessClass();
    syncPreviewToolbarControls();
    return;
  }
  currentPreviewHtml = html;
  currentPreviewStatus = normalizedStatus;
  emptyPreviewMode = 'ready';
  emptyPreviewLabel = '';
  syncProjectReadinessClass();
  const frame = document.getElementById('preview-iframe-element') as HTMLIFrameElement | null;
  if (frame) {
    frame.dataset.emptyPreview = 'false';
    frame.dataset.emptyPreviewMode = 'ready';
    frame.removeAttribute('data-media-preview');
    frame.removeAttribute('data-design-preview');
    frame.style.transition = 'opacity 180ms cubic-bezier(.22,1,.36,1), transform 180ms cubic-bezier(.22,1,.36,1)';
    frame.style.opacity = '0.72';
    frame.style.transform = 'scale(.998)';
    // WebContainer real-build preview (flag gated). When the boot succeeds, the
    // iframe shows the live Vite dev server (preview == production). On any
    // failure or when the flag is off, we fall back to the Babel preview html.
    void tryBootWebContainerPreview(frame, currentFiles).then(booted => {
      if (!booted) frame.srcdoc = html;
    });
    requestAnimationFrame(() => {
      frame.style.opacity = '1';
      frame.style.transform = 'scale(1)';
    });
  }
  setPreviewDevice(selectedPreviewDevice, false);

  activateBuilderView('preview');

  syncPreviewAddress(`${normalizedStatus}.coden.local / ${currentProjectId ? currentProjectId.slice(0, 8) : 'app'}`);
  syncPreviewToolbarControls();
}

function refreshPreviewFrame() {
  const button = document.getElementById('btn-preview-refresh') as HTMLButtonElement | null;
  const frame = document.getElementById('preview-iframe-element') as HTMLIFrameElement | null;
  if (!frame || !hasReadyAppPreview()) return;
  button?.classList.add('is-refreshing');
  window.setTimeout(() => button?.classList.remove('is-refreshing'), 560);
  if (frame.src && !frame.src.startsWith('about:')) {
    try {
      frame.contentWindow?.location.reload();
    } catch {
      frame.src = frame.src;
    }
    showTransientNotice('Preview refreshed.');
    return;
  }
  if (currentPreviewHtml) {
    const html = currentPreviewHtml;
    frame.srcdoc = '';
    window.setTimeout(() => {
      frame.srcdoc = html;
      showTransientNotice('Preview refreshed.');
    }, 45);
    return;
  }
  showTransientNotice('No preview to refresh yet.');
}

function renderFiles(files: GeneratedFile[]) {
  currentFiles = files;
  syncProjectReadinessClass();
  const tree = document.querySelector('.explorer-tree-scroll');
  if (tree) {
    tree.innerHTML = '';
    if (!files.length) {
      tree.innerHTML = `
        <div class="code-empty-state" style="margin:8px;">
          <h3>No files yet</h3>
          <p>Ask Coden for an app, feature, or fix. Generated files from your backend will appear here.</p>
        </div>
      `;
    }
    files.forEach((file, index) => {
      const item = document.createElement('div');
      item.className = `tree-file${index === 0 ? ' selected' : ''}`;
      item.setAttribute('data-file', file.path);
      item.innerHTML = `<span class="tree-file-icon">File</span><span>${escapeHtml(file.path)}</span>`;
      item.addEventListener('click', () => selectFile(file.path));
      tree.appendChild(item);
    });
  }
  if (files[0]) {
    selectFile(files.find(file => file.path === 'index.html')?.path || files[0].path);
    return;
  }
  const label = document.getElementById('open-file-tab-label');
  if (label) label.textContent = 'No file selected';
  const code = document.getElementById('code-content-view-panel');
  if (code) {
    code.innerHTML = '<div class="code-empty-state"><h3>No source file loaded</h3><p>Generated files will be loaded from the project once Coden receives them from the backend.</p></div>';
  }
}

function syncProjectReadinessClass() {
  const hasFiles = currentFiles.length > 0;
  const hasPreview = Boolean(currentPreviewHtml.trim());
  document.body.classList.toggle('coden-new-project-mode', !hasFiles && !hasPreview && activeWorkshop === 'chat');
}

function selectFile(filePath: string) {
  document.querySelectorAll('.tree-file').forEach(item => item.classList.toggle('selected', item.getAttribute('data-file') === filePath));
  const label = document.getElementById('open-file-tab-label');
  if (label) label.textContent = filePath;

  const file = currentFiles.find(item => item.path === filePath);
  const code = document.getElementById('code-content-view-panel');
  if (!code || !file) return;

  const lines = file.content.split('\n').slice(0, 600);
  code.innerHTML = lines
    .map((line, index) => `<div class="editor-line-row"><span class="editor-line-number">${index + 1}</span><span class="editor-line-content">${escapeHtml(line) || '&nbsp;'}</span></div>`)
    .join('');
}

function ensureToolbar() {
  const nav = document.querySelector('.sub-nav-right');
  if (!nav || document.getElementById('btn-live-cancel')) return;

  const style = 'height:28px;border:1px solid var(--border);background:var(--bg-input);color:var(--text);border-radius:7px;padding:0 10px;font-size:11px;cursor:pointer;';
  nav.insertAdjacentHTML('afterbegin', `
    <button id="btn-live-cancel" type="button" style="${style}display:none;">Cancel</button>
  `);

  document.getElementById('btn-live-cancel')?.addEventListener('click', cancelBuild);
  document.getElementById('action-download-zip')?.addEventListener('click', exportCode);
  document.getElementById('btn-preview-refresh')?.addEventListener('click', refreshPreviewFrame);
  document.querySelectorAll<HTMLButtonElement>('.btn-publish').forEach(button => {
    if (button.dataset.publishBound === 'true') return;
    button.dataset.publishBound = 'true';
    button.type = 'button';
    button.addEventListener('click', event => {
      event.preventDefault();
      void openPublishPanel();
    });
  });

  const shareBtn = document.getElementById('btn-share-project') as HTMLButtonElement | null;
  if (shareBtn && shareBtn.dataset.shareBound !== 'true') {
    shareBtn.dataset.shareBound = 'true';
    shareBtn.addEventListener('click', event => {
      event.preventDefault();
      void shareProjectLink(shareBtn);
    });
  }
}

function publishPrimaryLabel(status: PublishStatusPayload | null) {
  if (!status?.can_publish) return 'Build first';
  if (status.state === 'published' || status.state === 'changes_unpublished') return 'Update';
  return 'Publish';
}

function formatPublishDate(value: string | null | undefined) {
  if (!value) return 'Never';
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  } catch {
    return value;
  }
}

let publishPanelMode: 'main' | 'security' | 'domain' = 'main';

function publishPanelTitle(status: PublishStatusPayload | null) {
  if (!status) return 'Publishing';
  if (status.state === 'published' || status.state === 'changes_unpublished') return 'Published';
  if (status.state === 'ready_to_publish') return 'Ready to publish';
  return 'Publish';
}

function formatPublishUrl(url: string) {
  if (!url) return 'Not published yet';
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname === '/' ? '' : parsed.pathname}`;
  } catch {
    return url.replace(/^https?:\/\//i, '');
  }
}

function publishIcon(name: 'copy' | 'link' | 'globe' | 'visitors' | 'shield' | 'settings' | 'check' | 'warning' | 'fail') {
  const common = 'width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
  if (name === 'copy') return `<svg ${common}><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
  if (name === 'link') return `<svg ${common}><path d="M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1"></path><path d="M14 11a5 5 0 0 0-7.1 0l-2 2A5 5 0 0 0 12 20.1l1.1-1.1"></path></svg>`;
  if (name === 'globe') return `<svg ${common}><circle cx="12" cy="12" r="9"></circle><path d="M3 12h18"></path><path d="M12 3c2.4 2.5 3.6 5.5 3.6 9S14.4 18.5 12 21c-2.4-2.5-3.6-5.5-3.6-9S9.6 5.5 12 3Z"></path></svg>`;
  if (name === 'visitors') return `<svg ${common}><path d="M5 20V10"></path><path d="M12 20V4"></path><path d="M19 20v-7"></path></svg>`;
  if (name === 'shield') return `<svg ${common}><path d="M12 3 20 6v5c0 5-3.4 8.6-8 10-4.6-1.4-8-5-8-10V6l8-3Z"></path><path d="m9 12 2 2 4-5"></path></svg>`;
  if (name === 'settings') return `<svg ${common}><path d="M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5Z"></path><path d="M19.4 15a1.8 1.8 0 0 0 .36 2l.06.06a2.1 2.1 0 0 1-3 3l-.06-.06a1.8 1.8 0 0 0-2-.36 1.8 1.8 0 0 0-1.1 1.64V21a2.1 2.1 0 0 1-4.2 0v-.09A1.8 1.8 0 0 0 8.4 19.3a1.8 1.8 0 0 0-2 .36l-.06.06a2.1 2.1 0 1 1-3-3l.06-.06a1.8 1.8 0 0 0 .36-2A1.8 1.8 0 0 0 2.1 13H2a2.1 2.1 0 0 1 0-4.2h.09A1.8 1.8 0 0 0 3.7 7.6a1.8 1.8 0 0 0-.36-2l-.06-.06a2.1 2.1 0 1 1 3-3l.06.06a1.8 1.8 0 0 0 2 .36H8.4A1.8 1.8 0 0 0 9.5 1.3V1a2.1 2.1 0 0 1 4.2 0v.09a1.8 1.8 0 0 0 1.1 1.64 1.8 1.8 0 0 0 2-.36l.06-.06a2.1 2.1 0 1 1 3 3l-.06.06a1.8 1.8 0 0 0-.36 2V7.6a1.8 1.8 0 0 0 1.64 1.1H21a2.1 2.1 0 0 1 0 4.2h-.09A1.8 1.8 0 0 0 19.4 15Z"></path></svg>`;
  if (name === 'check') return `<svg ${common}><path d="m5 12 4 4L19 6"></path></svg>`;
  if (name === 'fail') return `<svg ${common}><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>`;
  return `<svg ${common}><path d="M12 8v5"></path><path d="M12 17h.01"></path><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"></path></svg>`;
}

function ensurePublishPanel() {
  let root = document.getElementById('coden-publish-panel');
  if (root) return root;
  root = document.createElement('div');
  root.id = 'coden-publish-panel';
  // Transparent click-catcher — the panel is a dropdown anchored to the
  // Publish button, not a centered, screen-dimming modal.
  root.style.cssText = 'position:fixed;inset:0;z-index:99999;background:transparent;';
  document.body.appendChild(root);
  root.addEventListener('click', event => {
    if (event.target === root) closePublishPanel();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && document.getElementById('coden-publish-panel')) closePublishPanel();
  });
  window.addEventListener('resize', positionPublishDropdown);
  return root;
}

function positionPublishDropdown() {
  const root = document.getElementById('coden-publish-panel');
  const section = root?.querySelector('section') as HTMLElement | null;
  const button = document.querySelector('.btn-publish') as HTMLElement | null;
  if (!root || !section) return;
  section.style.position = 'absolute';
  if (button) {
    const rect = button.getBoundingClientRect();
    const top = Math.round(rect.bottom + 8);
    const right = Math.max(12, Math.round(window.innerWidth - rect.right));
    section.style.top = `${top}px`;
    section.style.right = `${right}px`;
    section.style.left = 'auto';
  } else {
    section.style.top = '60px';
    section.style.right = '16px';
  }
}

function closePublishPanel() {
  document.getElementById('coden-publish-panel')?.remove();
}

function renderPublishPanel(payload: PublishApiPayload | null, isPublishing = false, error = '') {
  const root = ensurePublishPanel();
  const status = payload?.publish || null;
  const hasPublishedDeployment = Boolean(
    payload?.deployment &&
    status &&
    (status.state === 'published' || status.state === 'changes_unpublished')
  );
  const publicUrl = hasPublishedDeployment ? status?.public_url || '' : '';
  const publicUrlLabel = formatPublishUrl(publicUrl);
  const canOpen = Boolean(publicUrl && hasPublishedDeployment);
  const checks = status?.checks || [];
  const visitorCount = Math.max(0, Number(status?.current_visitors || 0));
  const visitorLabel = `${formatCompactNumber(visitorCount)} Visitor${visitorCount === 1 ? '' : 's'}`;
  const title = publishPanelTitle(status);
  const primaryLabel = isPublishing ? 'Publishing...' : publishPrimaryLabel(status);
  const checkCount = checks.length;
  const passCount = checks.filter(check => check.status === 'pass').length;
  const warnCount = checks.filter(check => check.status === 'warn').length;
  const failCount = checks.filter(check => check.status === 'fail').length;
  const statusDetail = status?.state === 'changes_unpublished'
    ? 'Live is stable. Update publishes the latest preview.'
    : status?.state === 'published'
      ? 'This URL serves the last published version.'
      : status?.state === 'ready_to_publish'
        ? 'Publish creates the live URL.'
        : 'Build a ready preview first.';
  const securityRows = checks.map(check => {
    const tone = check.status === 'pass' ? '#2fbf71' : check.status === 'warn' ? '#d97706' : '#dc2626';
    const iconName = check.status === 'pass' ? 'check' : check.status === 'warn' ? 'warning' : 'fail';
    return `
      <div style="display:grid;grid-template-columns:26px 1fr;gap:10px;align-items:start;padding:10px;border:1px solid var(--border);border-radius:12px;background:var(--bg-input);">
        <span style="display:grid;place-items:center;width:26px;height:26px;border-radius:9px;color:${tone};background:color-mix(in srgb, ${tone} 10%, var(--bg-surface));">${publishIcon(iconName as 'check' | 'warning' | 'fail')}</span>
        <span>
          <strong style="display:block;color:var(--text);font-size:12px;line-height:1.2;">${escapeHtml(check.label)}</strong>
          <small style="display:block;margin-top:4px;color:var(--text-muted);font-size:11px;line-height:1.4;">${escapeHtml(check.detail)}</small>
        </span>
      </div>
    `;
  }).join('');
  const detailPanel = publishPanelMode === 'security'
    ? `
      <div style="display:grid;gap:9px;padding:0 18px 14px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
          <strong style="color:var(--text);font-size:13px;">Security review</strong>
          <button type="button" data-publish-action="main" style="border:1px solid var(--border);background:var(--bg-input);color:var(--text);height:28px;border-radius:9px;padding:0 10px;font-size:12px;font-weight:750;cursor:pointer;">Back</button>
        </div>
        ${securityRows || '<p style="margin:0;color:var(--text-muted);font-size:13px;">No publish checks are available yet.</p>'}
      </div>
    `
    : publishPanelMode === 'domain'
      ? `
        <div style="display:grid;gap:10px;padding:0 18px 14px;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
            <strong style="color:var(--text);font-size:13px;">Custom domain</strong>
            <button type="button" data-publish-action="main" style="border:1px solid var(--border);background:var(--bg-input);color:var(--text);height:28px;border-radius:9px;padding:0 10px;font-size:12px;font-weight:750;cursor:pointer;">Back</button>
          </div>
          <div style="border:1px solid var(--border);background:var(--bg-input);border-radius:13px;padding:12px;color:var(--text-muted);font-size:12px;line-height:1.5;">
            ${status?.custom_domain
              ? `This app is configured for <strong style="color:var(--text);">${escapeHtml(status.custom_domain)}</strong>. Click Update after DNS changes are verified.`
              : 'Connect a custom domain from project settings and verify DNS. After a successful publish, Coden will serve this app under your Coden URL.'}
          </div>
          <button type="button" data-publish-action="settings" style="height:34px;border:1px solid var(--border);background:var(--bg-surface);color:var(--text);border-radius:11px;font-size:12px;font-weight:850;cursor:pointer;">Open settings</button>
        </div>
      `
      : '';
  root.innerHTML = `
    <section role="dialog" aria-label="Publish" style="position:absolute;width:min(360px,calc(100vw - 24px));border:1px solid var(--border);background:var(--bg-surface);color:var(--text);border-radius:16px;box-shadow:var(--shadow-lg,0 18px 48px rgba(0,0,0,.45));overflow:hidden;font-family:var(--font-body,Inter,ui-sans-serif,system-ui);transform-origin:top right;animation:coden-pub-in 140ms cubic-bezier(.22,1,.36,1) both;">
      <style>@keyframes coden-pub-in{from{opacity:0;transform:translateY(-6px) scale(.98)}to{opacity:1;transform:none}}</style>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 16px 11px;">
        <div style="display:flex;align-items:center;gap:8px;min-width:0;">
          <span style="width:8px;height:8px;border-radius:50%;flex:0 0 auto;background:${hasPublishedDeployment ? 'var(--success,#22c55e)' : 'var(--text-sub,#71717a)'};"></span>
          <h3 style="margin:0;color:var(--text);font-size:15px;line-height:1.1;letter-spacing:-.02em;font-weight:800;">${escapeHtml(title)}</h3>
        </div>
        <button type="button" data-publish-action="close" aria-label="Close" style="display:grid;place-items:center;width:26px;height:26px;border:0;border-radius:8px;background:transparent;color:var(--text-muted);cursor:pointer;padding:0;">${publishIcon('fail')}</button>
      </div>
      <div style="display:grid;gap:11px;padding:0 16px 14px;">
        ${error ? `<div style="border:1px solid var(--error-dim,rgba(248,113,113,.25));background:var(--error-dim,rgba(248,113,113,.10));color:var(--error,#f87171);border-radius:10px;padding:9px 11px;font-size:12px;line-height:1.4;">${escapeHtml(error)}</div>` : ''}
        ${status ? `
          <div style="display:flex;align-items:center;gap:8px;min-width:0;border:1px solid var(--border);background:var(--bg-input);border-radius:11px;padding:9px 11px;">
            <span style="color:var(--text-muted);display:grid;place-items:center;width:16px;height:16px;flex:0 0 auto;">${publishIcon('globe')}</span>
            <span title="${escapeHtml(publicUrl || publicUrlLabel)}" style="min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:${publicUrl ? 'var(--text)' : 'var(--text-muted)'};font-size:12.5px;font-weight:600;letter-spacing:-.01em;">${escapeHtml(publicUrlLabel)}</span>
            <button type="button" data-publish-action="copy" ${publicUrl ? '' : 'disabled'} aria-label="Copy URL" style="display:grid;place-items:center;width:24px;height:24px;border:0;border-radius:7px;background:transparent;color:${publicUrl ? 'var(--text-muted)' : 'color-mix(in srgb, var(--text-muted) 45%, transparent)'};cursor:${publicUrl ? 'pointer' : 'default'};padding:0;">${publishIcon('copy')}</button>
          </div>
        ` : `
          <div class="skeleton" style="height:40px;border-radius:11px;background:var(--bg-input);"></div>
        `}
        ${detailPanel ? `<div style="margin:0 -16px 0;">${detailPanel}</div>` : `
        <button type="button" data-publish-action="publish" ${status?.can_publish && !isPublishing ? '' : 'disabled'} style="height:40px;border:0;background:var(--accent-blue,#6366f1);color:#fff;border-radius:11px;font-size:13.5px;font-weight:800;letter-spacing:-.01em;cursor:${status?.can_publish && !isPublishing ? 'pointer' : 'default'};opacity:${status?.can_publish && !isPublishing ? '1' : '.5'};transition:filter 120ms ease;">${escapeHtml(primaryLabel)}</button>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
          <button type="button" data-publish-action="security" ${status ? '' : 'disabled'} style="display:inline-flex;align-items:center;gap:6px;border:0;background:transparent;color:var(--text-muted);font-size:12px;font-weight:650;cursor:${status ? 'pointer' : 'default'};padding:4px 2px;opacity:${status ? '1' : '.5'};">
            ${failCount ? 'Issues' : warnCount ? 'Review' : 'Checks'} <span style="display:inline-grid;place-items:center;min-width:17px;height:17px;border-radius:999px;background:${failCount ? 'var(--error,#f87171)' : warnCount ? 'var(--warning,#fbbf24)' : 'var(--accent-blue-soft)'};color:${failCount || warnCount ? '#fff' : 'var(--accent-blue-deep)'};font-size:10px;font-weight:800;">${checkCount || passCount}</span>
          </button>
          <button type="button" data-publish-action="domain" ${status ? '' : 'disabled'} style="border:0;background:transparent;color:var(--text-muted);font-size:12px;font-weight:650;cursor:${status ? 'pointer' : 'default'};padding:4px 2px;opacity:${status ? '1' : '.5'};">Custom domain</button>
          <button type="button" data-publish-action="open" ${canOpen ? '' : 'disabled'} style="border:0;background:transparent;color:${canOpen ? 'var(--accent-blue-deep)' : 'var(--text-muted)'};font-size:12px;font-weight:700;cursor:${canOpen ? 'pointer' : 'default'};padding:4px 2px;opacity:${canOpen ? '1' : '.45'};">Open ↗</button>
        </div>
        `}
      </div>
    </section>
  `;
  positionPublishDropdown();

  root.querySelectorAll<HTMLButtonElement>('[data-publish-action]').forEach(button => {
    button.addEventListener('click', () => {
      const action = button.dataset.publishAction || 'close';
      if (action === 'close') closePublishPanel();
      if (action === 'main') {
        publishPanelMode = 'main';
        renderPublishPanel(payload, isPublishing, error);
      }
      if (action === 'security') {
        publishPanelMode = publishPanelMode === 'security' ? 'main' : 'security';
        renderPublishPanel(payload, isPublishing, error);
      }
      if (action === 'domain') {
        publishPanelMode = publishPanelMode === 'domain' ? 'main' : 'domain';
        renderPublishPanel(payload, isPublishing, error);
      }
      if (action === 'settings') {
        closePublishPanel();
        void openBuilderSettings('account');
      }
      if (action === 'copy' && publicUrl) {
        void navigator.clipboard?.writeText(publicUrl);
        showTransientNotice('Live app link copied.');
      }
      if (action === 'open' && publicUrl && canOpen) window.open(publicUrl, '_blank', 'noopener,noreferrer');
      if (action === 'publish') void publishCurrentProject(payload);
    });
  });
}

async function openPublishPanel() {
  if (!currentProjectId) {
    appendMessage('system', 'Create or open a project before publishing.');
    return;
  }
  publishPanelMode = 'main';
  renderPublishPanel(null);
  try {
    const payload = await apiFetch<PublishApiPayload>(`/api/projects/${encodeURIComponent(currentProjectId)}/publish/status`);
    renderPublishPanel(payload);
  } catch (error) {
    renderPublishPanel(null, false, error instanceof Error ? error.message : 'Unable to load publish status.');
  }
}

async function shareProjectLink(button: HTMLButtonElement) {
  const label = button.querySelector('.btn-share-label') as HTMLElement | null;
  const fallbackText = button.textContent?.trim() || 'Partager';
  const original = label?.textContent || fallbackText;
  const setLabel = (text: string) => {
    if (label) label.textContent = text;
    else button.textContent = text;
  };
  const flash = (text: string, copied: boolean) => {
    setLabel(text);
    button.classList.toggle('is-copied', copied);
    window.setTimeout(() => {
      setLabel(original);
      button.classList.remove('is-copied');
      button.disabled = false;
    }, 1800);
  };

  if (!currentProjectId) {
    flash("Publiez d'abord", false);
    return;
  }

  button.disabled = true;
  try {
    const payload = await apiFetch<PublishApiPayload>(`/api/projects/${encodeURIComponent(currentProjectId)}/publish/status`);
    const status = payload?.publish || null;
    const hasLiveDeployment = Boolean(payload?.deployment && status && (status.state === 'published' || status.state === 'changes_unpublished'));
    const publicUrl = hasLiveDeployment ? status?.public_url || '' : '';
    if (!publicUrl) {
      flash("Publiez d'abord", false);
      return;
    }
    await navigator.clipboard?.writeText(publicUrl);
    flash('Lien copié', true);
  } catch {
    flash("Publiez d'abord", false);
  }
}

async function publishCurrentProject(previousPayload: PublishApiPayload | null) {
  if (!currentProjectId) return;
  const action = previousPayload?.publish?.state === 'published' || previousPayload?.publish?.state === 'changes_unpublished'
    ? 'mettre à jour la version publique'
    : 'publier cette application en ligne';
  if (!window.confirm(`Confirmer : ${action} ?`)) return;
  publishPanelMode = 'main';
  renderPublishPanel(previousPayload, true);
  try {
    const payload = await apiFetch<PublishApiPayload>(`/api/projects/${encodeURIComponent(currentProjectId)}/publish`, {
      method: 'POST',
      body: JSON.stringify({ branch: 'main', confirmed: true }),
    });
    renderPublishPanel(payload);
  } catch (error) {
    renderPublishPanel(previousPayload, false, error instanceof Error ? error.message : 'Publish failed.');
  }
}

function ensureHistoryPanel() {
  let root = document.getElementById('coden-history-panel');
  if (root) return root;
  root = document.createElement('div');
  root.id = 'coden-history-panel';
  root.style.cssText = 'position:fixed;inset:0;background:rgba(9,9,11,.38);display:grid;place-items:center;z-index:99999;padding:16px;backdrop-filter:blur(8px);';
  document.body.appendChild(root);
  root.addEventListener('click', event => {
    if (event.target === root) closeHistoryPanel();
  });
  return root;
}

function closeHistoryPanel() {
  document.getElementById('coden-history-panel')?.remove();
}

function formatShortDate(value?: string) {
  if (!value) return 'Unknown time';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function renderHistoryPanel(runs: AgentRunSummary[] = [], versions: ProjectVersionSummary[] = [], loading = false, error = '') {
  const root = ensureHistoryPanel();
  const runRows = runs.length ? runs.map(run => {
    const runMeta = [
      formatShortDate(run.created_at),
      run.duration_ms ? `${Math.max(1, Math.round(run.duration_ms / 1000))}s` : '',
    ].filter(Boolean).join(' · ');
    return `
    <div style="border:1px solid var(--border-light);background:var(--bg-elevated);border-radius:10px;padding:10px;display:grid;gap:5px;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
        <strong style="font-size:12px;color:var(--text);">${escapeHtml(run.intent || 'agent run')}</strong>
        <span style="font-size:10px;font-weight:800;color:var(--text-muted);text-transform:uppercase;letter-spacing:.08em;">${escapeHtml(run.status || 'unknown')}</span>
      </div>
      <div style="font-size:11px;color:var(--text-muted);">${escapeHtml(runMeta)}</div>
      ${run.diagnostic_code ? `<div style="font-size:11px;color:#991b1b;">${escapeHtml(run.diagnostic_code)}</div>` : ''}
    </div>
  `;
  }).join('') : '<div style="color:var(--text-muted);font-size:12px;">No agent runs recorded yet.</div>';
  const versionRows = versions.length ? versions.map(version => `
    <div style="border:1px solid var(--border-light);background:var(--bg-elevated);border-radius:10px;padding:10px;display:grid;gap:8px;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
        <strong style="font-size:12px;color:var(--text);">Version ${escapeHtml(String(version.version_number || ''))}</strong>
        <span style="font-size:11px;color:var(--text-muted);">${formatShortDate(version.created_at)}</span>
      </div>
      <div style="font-size:11px;color:var(--text-muted);line-height:1.45;">${escapeHtml(version.diff_summary?.summary || version.label || 'Saved project version.')}</div>
      <button type="button" data-history-rollback="${escapeHtml(version.id)}" style="justify-self:start;height:28px;border:1px solid var(--border);background:var(--bg-input);color:var(--text);border-radius:7px;padding:0 10px;font-size:11px;font-weight:800;cursor:pointer;">Rollback</button>
    </div>
  `).join('') : '<div style="color:var(--text-muted);font-size:12px;">No saved versions yet.</div>';

  root.innerHTML = `
    <section style="width:min(760px,100%);max-height:min(760px,calc(100vh - 32px));overflow:auto;border:1px solid var(--border);background:var(--bg-surface);color:var(--text);border-radius:16px;box-shadow:0 28px 90px rgba(9,9,11,.22);">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding:16px;border-bottom:1px solid var(--border-light);">
        <div>
          <div style="font-size:11px;color:var(--text-muted);font-weight:800;letter-spacing:.12em;text-transform:uppercase;">Project history</div>
          <h3 style="margin:4px 0 0;font-size:16px;line-height:1.2;">Runs, versions and rollback</h3>
        </div>
        <button type="button" data-history-close style="border:1px solid var(--border);background:var(--bg-input);color:var(--text);width:28px;height:28px;border-radius:8px;cursor:pointer;">×</button>
      </div>
      <div style="padding:16px;display:grid;gap:14px;">
        ${loading ? '<div style="font-size:12px;color:var(--text-muted);">Loading history...</div>' : ''}
        ${error ? `<div style="border:1px solid rgba(185,28,28,.28);background:rgba(254,242,242,.88);color:#991b1b;border-radius:10px;padding:10px;font-size:12px;">${escapeHtml(error)}</div>` : ''}
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px;">
          <div style="display:grid;gap:8px;align-content:start;">
            <h4 style="margin:0;font-size:13px;">Agent runs</h4>
            ${runRows}
          </div>
          <div style="display:grid;gap:8px;align-content:start;">
            <h4 style="margin:0;font-size:13px;">Saved versions</h4>
            ${versionRows}
          </div>
        </div>
      </div>
    </section>
  `;
  root.querySelector('[data-history-close]')?.addEventListener('click', closeHistoryPanel);
  root.querySelectorAll<HTMLButtonElement>('[data-history-rollback]').forEach(button => {
    button.addEventListener('click', () => void rollbackToVersion(button.dataset.historyRollback || ''));
  });
}

async function openHistoryPanel() {
  if (!currentProjectId) {
    appendMessage('system', 'Create or open a project before viewing history.');
    return;
  }
  renderHistoryPanel([], [], true);
  try {
    const [runsPayload, versionsPayload] = await Promise.all([
      apiFetch<{ success: boolean; runs: AgentRunSummary[] }>(`/api/projects/${encodeURIComponent(currentProjectId)}/agent/runs?limit=12`),
      apiFetch<{ success: boolean; versions: ProjectVersionSummary[] }>(`/api/projects/${encodeURIComponent(currentProjectId)}/versions`),
    ]);
    renderHistoryPanel(runsPayload.runs || [], versionsPayload.versions || []);
  } catch (error) {
    renderHistoryPanel([], [], false, error instanceof Error ? error.message : 'Unable to load project history.');
  }
}

async function rollbackToVersion(versionId: string) {
  if (!currentProjectId || !versionId) return;
  try {
    const payload = await apiFetch<{ success: boolean; files: GeneratedFile[]; preview?: { html?: string; status?: string }; project?: { name?: string } }>(`/api/projects/${encodeURIComponent(currentProjectId)}/versions/${encodeURIComponent(versionId)}/rollback`, {
      method: 'POST',
      body: JSON.stringify({ source: 'history_panel' }),
    });
    renderFiles(payload.files || []);
    if (payload.preview?.html) setPreview(payload.preview.html, payload.preview.status || 'unknown');
    if (payload.project?.name) setProjectNameDisplay(payload.project.name);
    closeHistoryPanel();
  } catch (error) {
    renderHistoryPanel([], [], false, error instanceof Error ? error.message : 'Rollback failed.');
  }
}

function recordAgentFeedback(feedback: 'keep' | 'modify' | 'regenerate' | 'publish' | 'reject', extra: Record<string, unknown> = {}) {
  if (!currentProjectId) return Promise.resolve();
  return apiFetch(`/api/projects/${encodeURIComponent(currentProjectId)}/agent/feedback`, {
    method: 'POST',
    body: JSON.stringify({ feedback, runId: lastAgentRunId, source: 'builder_inline_action', ...extra }),
  }).then(() => undefined).catch(() => undefined);
}

const sendIconSvg = `
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <line x1="12" y1="19" x2="12" y2="5"></line>
    <polyline points="5 12 12 5 19 12"></polyline>
  </svg>
`;

const stopIconSvg = `
  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <rect x="6" y="6" width="12" height="12" rx="2"></rect>
  </svg>
`;

function syncSubmitButtonState() {
  const input = document.getElementById('chat-textarea-box') as HTMLTextAreaElement | null;
  const submit = document.getElementById('chat-submit-btn') as HTMLButtonElement | null;
  if (!submit) return;
  const hasPrompt = Boolean(input?.value.trim());
  const shouldStop = isGenerating;
  const shouldSendInstruction = isGenerating && hasPrompt;
  submit.innerHTML = shouldStop && !shouldSendInstruction ? stopIconSvg : sendIconSvg;
  submit.classList.toggle('active', shouldStop || hasPrompt);
  submit.classList.toggle('is-generating', shouldStop);
  const submitLabel = shouldSendInstruction ? 'Send instruction' : shouldStop ? 'Stop generation' : 'Send message';
  submit.setAttribute('aria-label', submitLabel);
  submit.setAttribute('title', submitLabel);
  submit.setAttribute('aria-disabled', shouldStop || hasPrompt ? 'false' : 'true');
  submit.style.pointerEvents = 'auto';
  submit.style.cursor = shouldStop || hasPrompt ? 'pointer' : 'not-allowed';
}

function autoResizeChatInput() {
  const input = document.getElementById('chat-textarea-box') as HTMLTextAreaElement | null;
  if (!input) return;
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 200)}px`;
}

function setBusy(busy: boolean) {
  isGenerating = busy;
  const cancel = document.getElementById('btn-live-cancel') as HTMLButtonElement | null;
  if (cancel) cancel.style.display = busy ? 'inline-flex' : 'none';
  syncSubmitButtonState();
}

function renderTierColor(tier = 'Standard') {
  if (/premium/i.test(tier)) return '#c084fc';
  if (/pro/i.test(tier)) return '#60a5fa';
  if (/economy/i.test(tier)) return '#34d399';
  return '#52525b';
}

function buildLocalProviderGroups(): AiModelProviderGroup[] {
  return (Object.keys(PROVIDER_META) as Array<keyof typeof PROVIDER_META>)
    .map(provider => ({
      provider,
      meta: PROVIDER_META[provider],
      models: MODEL_REGISTRY
        .filter(model => model.provider === provider)
        .map(model => ({
          id: model.id,
          display_name: model.label,
          tier: model.tier,
          provider: model.provider,
          description: model.description,
          plan_minimum: model.minPlan,
          badges: {
            new: 'isNew' in model ? Boolean(model.isNew) : false,
            fast: 'isFast' in model ? Boolean(model.isFast) : false,
            premium: 'isPremium' in model ? Boolean(model.isPremium) : false,
          },
          locked: false,
          capabilities: { maxContextTokens: model.contextWindow },
        })),
    }))
    .filter(group => group.models.length > 0);
}

function ensureBuilderModelSelectorStyle() {
  if (document.getElementById('coden-builder-model-selector-style')) return;
  const style = document.createElement('style');
  style.id = 'coden-builder-model-selector-style';
  style.textContent = `
    .chat-input-row {
      --chat-action-height: 24px;
      --chat-action-radius: 5px;
      --chat-action-font: 10px;
    }
    .chat-input-row #btn-chat-mode,
    .chat-input-row .coden-builder-model-trigger {
      height: var(--chat-action-height) !important;
      min-height: var(--chat-action-height) !important;
      border-radius: var(--chat-action-radius) !important;
      font-size: var(--chat-action-font) !important;
      align-items: center !important;
      border: 1px solid var(--border) !important;
      background: transparent !important;
      color: var(--text-sub) !important;
      box-shadow: none !important;
    }
    .coden-builder-model-trigger {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      max-width: min(156px, 36vw);
      padding: 0 7px;
      border-radius: 5px;
      border: 1px solid var(--border);
      font-size: 10px;
      color: var(--text-muted);
      user-select: none;
      position: relative;
      transition: transform 180ms cubic-bezier(0.22, 1, 0.36, 1), border-color 180ms cubic-bezier(0.22, 1, 0.36, 1), background 180ms cubic-bezier(0.22, 1, 0.36, 1);
      cursor: pointer;
      background: transparent;
      flex: 0 1 auto;
      white-space: nowrap;
    }
    .coden-builder-model-trigger:hover,
    .coden-builder-model-trigger[aria-expanded="true"] {
      border-color: var(--border-focus, var(--border));
      background: var(--accent-hover, var(--bg-panel));
      color: var(--text);
      transform: translateY(-1px);
    }
    .coden-builder-model-trigger .model-label-prefix {
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-size: 9px;
      opacity: 0.62;
      padding-right: 6px;
      border-right: 1px solid var(--border);
    }
    .coden-builder-model-trigger .provider-dot {
      width: 14px;
      height: 14px;
      color: var(--accent);
      flex: 0 0 auto;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .coden-builder-model-trigger .provider-dot svg,
    .coden-provider-icon svg {
      width: 100%;
      height: 100%;
      display: block;
    }
    .coden-builder-model-trigger #current-model-label {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
      font-weight: 650;
      color: var(--text);
    }
    .coden-builder-model-trigger #chevron-icon {
      flex: 0 0 auto;
      transition: transform 140ms cubic-bezier(0.22, 1, 0.36, 1);
    }
    .coden-builder-model-trigger[aria-expanded="true"] #chevron-icon {
      transform: rotate(180deg);
    }
    .coden-model-dropdown {
      position: fixed;
      width: 224px;
      max-width: calc(100vw - 24px);
      max-height: min(320px, calc(100vh - 36px));
      overflow: visible;
      border: 1px solid var(--border);
      background: var(--bg-surface);
      color: var(--text);
      border-radius: 12px;
      padding: 6px;
      box-shadow: 0 14px 36px rgba(0,0,0,.16), 0 3px 10px rgba(0,0,0,.08);
      display: none;
      z-index: 3000;
      backdrop-filter: blur(18px);
    }
    .coden-model-dropdown.open {
      display: block;
    }
    .coden-builder-provider-list {
      display: grid;
      gap: 4px;
    }
    .coden-auto-model-option,
    .coden-builder-provider-card {
      width: 100%;
      min-height: 30px;
      border: 1px solid var(--border);
      background: var(--bg-input);
      color: var(--text);
      border-radius: 8px;
      padding: 5px 6px;
      display: flex;
      align-items: center;
      gap: 6px;
      text-align: left;
      cursor: pointer;
      transition: background 160ms cubic-bezier(0.22,1,0.36,1), border-color 160ms cubic-bezier(0.22,1,0.36,1), transform 160ms cubic-bezier(0.34,1.56,0.64,1);
    }
    .coden-auto-model-option:hover,
    .coden-auto-model-option.active,
    .coden-builder-provider-card:hover,
    .coden-builder-provider-card.active,
    .coden-builder-provider-card.open {
      background: var(--accent-hover, rgba(9,9,11,.08));
      border-color: var(--border-focus, var(--border));
    }
    .coden-builder-provider-card.open {
      transform: translateX(2px);
    }
    .coden-provider-icon {
      width: 18px;
      height: 18px;
      border-radius: 5px;
      background: var(--bg-input);
      color: var(--provider-color);
      border: 1px solid var(--border);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 9px;
      font-weight: 850;
      line-height: 1;
      flex: 0 0 auto;
      --provider-icon-bg: var(--bg-input);
    }
    .coden-provider-card-main {
      min-width: 0;
      display: grid;
      gap: 1px;
      flex: 1 1 auto;
    }
    .coden-provider-name {
      color: var(--text);
      font-size: 11px;
      font-weight: 720;
      line-height: 1.2;
    }
    .coden-provider-sub {
      color: var(--text-muted);
      font-size: 9px;
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .coden-provider-expand-btn {
      width: 22px;
      height: 22px;
      border: 1px solid var(--border);
      background: transparent;
      color: var(--text-muted);
      border-radius: 7px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: background 120ms cubic-bezier(0.22,1,0.36,1), color 120ms cubic-bezier(0.22,1,0.36,1), transform 150ms cubic-bezier(0.22,1,0.36,1);
    }
    .coden-provider-expand-btn:hover,
    .coden-provider-expand-btn.open {
      background: var(--bg-panel, var(--bg-input));
      color: var(--text);
    }
    .coden-provider-expand-btn.open {
      transform: rotate(90deg);
    }
    .coden-builder-model-panel {
      position: absolute;
      left: calc(100% + 6px);
      top: 0;
      width: 236px;
      max-height: min(320px, 66vh);
      border: 1px solid var(--border);
      background: var(--bg-surface);
      color: var(--text);
      border-radius: 12px;
      box-shadow: 0 14px 36px rgba(0,0,0,.16), 0 3px 10px rgba(0,0,0,.08);
      opacity: 0;
      transform: translateX(-8px) scale(.97);
      pointer-events: none;
      overflow: hidden;
      z-index: 3200;
      transition: opacity 120ms cubic-bezier(0,0,0.2,1), transform 150ms cubic-bezier(0.22,1,0.36,1);
    }
    .coden-builder-model-panel.visible {
      opacity: 1;
      transform: translateX(0) scale(1);
      pointer-events: auto;
    }
    .coden-model-list-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 8px 10px 6px;
      border-bottom: 1px solid var(--border);
    }
    .coden-model-list-title {
      font-size: 9px;
      font-weight: 850;
      letter-spacing: .08em;
      text-transform: uppercase;
      color: var(--text-muted);
    }
    .coden-model-list-count {
      border: 1px solid var(--border);
      border-radius: 999px;
      color: var(--text-muted);
      font-size: 9px;
      font-weight: 700;
      padding: 1px 6px;
    }
    .coden-model-list-scroll {
      max-height: 272px;
      overflow-y: auto;
      padding: 4px;
      display: grid;
      gap: 2px;
    }
    .coden-builder-model-item {
      width: 100%;
      border: 0;
      background: transparent;
      color: var(--text);
      border-radius: 8px;
      padding: 6px 8px;
      display: grid;
      gap: 2px;
      text-align: left;
      cursor: pointer;
      position: relative;
      animation: coden-builder-model-enter 130ms cubic-bezier(0.22,1,0.36,1) both;
      transition: background 120ms cubic-bezier(0.22,1,0.36,1), transform 120ms cubic-bezier(0.22,1,0.36,1);
    }
    .coden-builder-model-item:hover {
      background: var(--accent-hover, rgba(9,9,11,.08));
      transform: translateX(2px);
    }
    .coden-builder-model-item.selected {
      background: var(--accent-hover, rgba(9,9,11,.10));
    }
    .coden-builder-model-item.selected::before {
      content: "";
      position: absolute;
      left: 0;
      top: 22%;
      bottom: 22%;
      width: 3px;
      border-radius: 0 999px 999px 0;
      background: var(--accent);
    }
    .coden-model-item-name {
      font-size: 11px;
      font-weight: 720;
      color: var(--text);
      line-height: 1.25;
    }
    .coden-model-item-meta {
      font-size: 9px;
      color: var(--text-muted);
      line-height: 1.35;
    }
    .coden-model-item-badges {
      display: flex;
      flex-wrap: wrap;
      gap: 3px;
    }
    .coden-model-badge.new { color: #166534; background: #dcfce7; border-color: #bbf7d0; }
    .coden-model-badge.fast { color: #854d0e; background: #fef9c3; border-color: #fde68a; }
    .coden-model-badge.premium { color: #6b21a8; background: #f3e8ff; border-color: #e9d5ff; }
    @keyframes coden-builder-model-enter {
      from { opacity: 0; transform: translateX(-8px); }
      to { opacity: 1; transform: translateX(0); }
    }
    .coden-model-dropdown .dropdown-header {
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--text-muted);
      padding: 6px 8px 7px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 5px;
    }
    .coden-model-dropdown .dropdown-search-wrapper {
      display: flex;
      align-items: center;
      gap: 8px;
      height: 34px;
      margin: 0 4px 8px;
      padding: 0 10px;
      border-radius: 10px;
      border: 1px solid var(--border);
      background: var(--bg-input);
      color: var(--text-muted);
    }
    .coden-model-dropdown .dropdown-search-input {
      min-width: 0;
      width: 100%;
      border: 0;
      outline: 0;
      background: transparent;
      color: var(--text);
      font: inherit;
      font-size: 12px;
    }
    .coden-model-dropdown .dropdown-group-title {
      padding: 8px 10px 5px;
      color: var(--text-sub);
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-size: 9px;
      font-weight: 800;
    }
    .coden-model-dropdown .model-option {
      width: 100%;
      border: 0;
      background: transparent;
      color: var(--text);
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px;
      border-radius: 10px;
      cursor: pointer;
      text-align: left;
      transition: background 150ms cubic-bezier(0.22, 1, 0.36, 1), transform 150ms cubic-bezier(0.22, 1, 0.36, 1);
    }
    .coden-model-dropdown .model-option:hover,
    .coden-model-dropdown .model-option.active {
      background: var(--accent-hover, rgba(9,9,11,.08));
      transform: translateX(3px);
    }
    .coden-model-dropdown .model-option[aria-disabled="true"] {
      opacity: .58;
      cursor: not-allowed;
    }
    .coden-model-dropdown .model-dot {
      width: 8px;
      height: 8px;
      border-radius: 999px;
      flex: 0 0 auto;
    }
    .coden-model-dropdown .opt-meta {
      min-width: 0;
      display: grid;
      gap: 2px;
      flex: 1 1 auto;
    }
    .coden-model-dropdown .opt-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 12px;
      font-weight: 700;
      color: var(--text);
    }
    .coden-model-dropdown .opt-desc {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 10px;
      color: var(--text-muted);
      font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    .coden-model-badge {
      border: 1px solid currentColor;
      border-radius: 999px;
      padding: 1px 5px;
      font-size: 8px;
      font-weight: 800;
      flex: 0 0 auto;
    }
    .coden-model-upgrade {
      color: #b45309;
      font-size: 10px;
      font-weight: 800;
      flex: 0 0 auto;
    }
    @media (max-width: 640px) {
      .coden-builder-model-trigger {
        max-width: 132px;
      }
      .coden-model-dropdown {
        left: 10px !important;
        right: 10px !important;
        bottom: 10px !important;
        top: auto !important;
        width: auto !important;
        max-width: none;
        max-height: 64vh;
        border-radius: 14px;
      }
      .coden-builder-model-panel {
        position: fixed;
        left: 0;
        right: 0;
        bottom: 0;
        top: auto;
        width: 100%;
        max-height: 76dvh;
        border-radius: 16px 16px 0 0;
        transform: translateY(100%);
      }
      .coden-builder-model-panel.visible {
        transform: translateY(0);
      }
    }
  `;
  document.head.appendChild(style);
}

async function ensureModelSelector() {
  ensureBuilderModelSelectorStyle();
  const oldRoot = document.getElementById('model-select-btn');
  if (!oldRoot || oldRoot.dataset.liveBound === 'true') return;

  const root = oldRoot.cloneNode(false) as HTMLElement;
  root.id = 'model-select-btn';
  root.dataset.liveBound = 'true';
  root.className = 'model-select coden-builder-model-trigger';
  root.style.cssText = '';
  root.innerHTML = `
    <span class="model-label-prefix">Model</span>
    <span class="provider-dot">${providerIconSvg('auto')}</span>
    <span id="current-model-label">Auto</span>
    <svg id="chevron-icon" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
      <polyline points="6 9 12 15 18 9"></polyline>
    </svg>
  `;
  oldRoot.replaceWith(root);

  document.getElementById('model-dropdown')?.remove();
  const dropdown = document.createElement('div');
  dropdown.id = 'model-dropdown';
  dropdown.className = 'coden-model-dropdown';
  document.body.appendChild(dropdown);

  const label = root.querySelector('#current-model-label') as HTMLElement;
  const providerDot = root.querySelector('.provider-dot') as HTMLElement | null;
  let providerGroups: AiModelProviderGroup[] = buildLocalProviderGroups();
  let activeProvider = '';
  let hydrateModelsPromise: Promise<void> | null = null;
  const positionDropdown = () => {
    const rect = root.getBoundingClientRect();
    if (window.matchMedia('(max-width: 640px)').matches) {
      dropdown.style.left = '';
      dropdown.style.right = '';
      dropdown.style.bottom = '';
      dropdown.style.top = 'auto';
      return;
    }
    const width = Math.min(248, window.innerWidth - 24);
    const left = Math.min(window.innerWidth - width - 12, Math.max(12, rect.right - width));
    dropdown.style.width = `${width}px`;
    dropdown.style.left = `${left}px`;
    dropdown.style.right = 'auto';
    dropdown.style.bottom = `${Math.max(12, window.innerHeight - rect.top + 8)}px`;
    dropdown.style.top = 'auto';
  };
  const closeProviderPanel = () => {
    activeProvider = '';
    dropdown.querySelector<HTMLElement>('.coden-builder-model-panel')?.classList.remove('visible');
    dropdown.querySelectorAll('.coden-provider-expand-btn.open, .coden-builder-provider-card.open').forEach(item => item.classList.remove('open'));
  };
  const close = () => {
    dropdown.classList.remove('open');
    root.setAttribute('aria-expanded', 'false');
    closeProviderPanel();
  };
  const selectedProviderMeta = () => {
    const group = providerGroups.find(item => item.models.some(model => model.id === selectedModelId));
    return group?.meta || null;
  };
  const selectedModel = () => providerGroups.flatMap(group => group.models).find(model => model.id === selectedModelId);
  const setActiveOption = () => {
    dropdown.querySelectorAll<HTMLElement>('[data-model-id]').forEach(option => {
      option.classList.toggle('active', (option.dataset.modelId || 'auto') === selectedModelId);
      option.classList.toggle('selected', (option.dataset.modelId || 'auto') === selectedModelId);
    });
    dropdown.querySelectorAll<HTMLElement>('[data-provider]').forEach(card => {
      const group = providerGroups.find(item => item.provider === card.dataset.provider);
      const active = Boolean(group?.models.some(model => model.id === selectedModelId));
      card.classList.toggle('active', active);
      const sub = card.querySelector<HTMLElement>('.coden-provider-sub');
      if (sub && group) {
        const selected = group.models.find(model => model.id === selectedModelId);
        sub.textContent = selected ? selected.display_name : `${group.models.length} models`;
      }
    });
    const meta = selectedProviderMeta();
    if (providerDot) {
      providerDot.innerHTML = providerIconSvg(meta?.icon || 'auto');
      providerDot.style.color = meta?.color || 'var(--accent)';
    }
    if (label) {
      const selected = dropdown.querySelector<HTMLElement>(`[data-model-id="${CSS.escape(selectedModelId)}"]`);
      label.textContent = selected?.dataset.modelName || selectedModel()?.display_name || (selectedModelId === 'auto' ? 'Auto' : selectedModelId);
    }
  };
  const renderModelPanel = (group: AiModelProviderGroup) => `
    <div class="coden-model-list-header">
      <span class="coden-model-list-title">${escapeHtml(group.meta.label)}</span>
      <span class="coden-model-list-count">${group.models.length} models</span>
    </div>
    <div class="coden-model-list-scroll">
      ${group.models.map((model, index) => {
        const tier = model.tier || 'Standard';
        const locked = model.locked ? '<span class="coden-model-badge">Upgrade</span>' : '';
        const badges = [
          `<span class="coden-model-badge">${escapeHtml(tier)}</span>`,
          model.badges?.new ? '<span class="coden-model-badge new">New</span>' : '',
          model.badges?.fast ? '<span class="coden-model-badge fast">Fast</span>' : '',
          model.badges?.premium ? '<span class="coden-model-badge premium">Premium</span>' : '',
          model.plan_minimum && model.plan_minimum !== 'free' ? '<span class="coden-model-badge">Upgrade</span>' : '',
          locked,
        ].filter(Boolean).join('');
        const context = Number(model.capabilities?.maxContextTokens || 0);
        return `<button type="button" class="coden-builder-model-item${selectedModelId === model.id ? ' selected' : ''}" data-model-id="${escapeHtml(model.id)}" data-model-name="${escapeHtml(model.display_name || model.id)}" aria-disabled="${model.locked ? 'true' : 'false'}" style="animation-delay:${index * 25}ms">
          <span class="coden-model-item-name">${escapeHtml(model.display_name || model.id)}</span>
          <span class="coden-model-item-meta">${escapeHtml(tier)}${context ? ` · ${Math.round(context / 1000)}K ctx` : ''}</span>
          <span class="coden-model-item-badges">${badges}</span>
        </button>`;
      }).join('')}
    </div>
  `;
  const renderDropdownContent = () => `
    <div class="dropdown-header">Models</div>
    <button type="button" class="coden-auto-model-option active" data-model-id="auto" data-model-name="Auto">
      <span class="coden-provider-icon" style="--provider-color:var(--accent);--provider-text:var(--bg);">${providerIconSvg('auto')}</span>
      <span class="coden-provider-card-main">
        <span class="coden-provider-name">Auto</span>
        <span class="coden-provider-sub">Best fit</span>
      </span>
      <span class="coden-model-badge" style="color:${renderTierColor('Standard')}">Standard</span>
    </button>
    <div class="coden-builder-provider-list">
      ${providerGroups.map(group => {
        const activeModel = group.models.find(model => model.id === selectedModelId);
        return `<div class="coden-builder-provider-card" data-provider="${escapeHtml(group.provider)}" style="--provider-color:${escapeHtml(group.meta.color)};--provider-text:${escapeHtml(group.meta.textColor)};">
          <span class="coden-provider-icon">${providerIconSvg(group.meta.icon)}</span>
          <span class="coden-provider-card-main">
            <span class="coden-provider-name">${escapeHtml(group.meta.label)}</span>
            <span class="coden-provider-sub">${escapeHtml(activeModel?.display_name || `${group.models.length} models`)}</span>
          </span>
          <button class="coden-provider-expand-btn" type="button" aria-label="Open ${escapeHtml(group.meta.label)} models" data-provider-arrow="${escapeHtml(group.provider)}">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><polyline points="9 18 15 12 9 6"></polyline></svg>
          </button>
        </div>`;
      }).join('')}
    </div>
    <div class="coden-builder-model-panel" role="listbox" aria-label="Provider models"></div>
  `;
  const toggleProviderPanel = (provider: string) => {
    const panel = dropdown.querySelector<HTMLElement>('.coden-builder-model-panel');
    const group = providerGroups.find(item => item.provider === provider);
    if (!panel || !group) return;
    if (activeProvider === provider) {
      closeProviderPanel();
      return;
    }
    activeProvider = provider;
    dropdown.querySelectorAll('.coden-provider-expand-btn.open, .coden-builder-provider-card.open').forEach(item => item.classList.remove('open'));
    dropdown.querySelector<HTMLElement>(`[data-provider="${CSS.escape(provider)}"]`)?.classList.add('open');
    dropdown.querySelector<HTMLElement>(`[data-provider-arrow="${CSS.escape(provider)}"]`)?.classList.add('open');
    panel.innerHTML = renderModelPanel(group);
    panel.classList.add('visible');
    setActiveOption();
  };
  const renderDropdown = () => {
    const previousProvider = activeProvider;
    dropdown.innerHTML = renderDropdownContent();
    dropdown.dataset.loaded = 'true';
    setActiveOption();
    if (previousProvider) {
      activeProvider = '';
      toggleProviderPanel(previousProvider);
    }
  };
  const hydrateModelGroups = async () => {
    if (hydrateModelsPromise) return hydrateModelsPromise;
    hydrateModelsPromise = (async () => {
      try {
        const payload = await apiFetch<{ models: AiModel[]; providers?: AiModelProviderGroup[] }>('/api/ai/models');
        const models = (payload.models || []).filter(model => model.id !== 'auto');
        providerGroups = (payload.providers && payload.providers.length)
          ? payload.providers
          : Object.values(models.reduce<Record<string, AiModelProviderGroup>>((acc, model) => {
            const provider = model.provider || model.id.split('/')[0] || 'other';
            if (!acc[provider]) {
              acc[provider] = {
                provider,
                meta: { label: provider, color: renderTierColor(model.tier), textColor: '#fff', icon: provider },
                models: [],
              };
            }
            acc[provider].models.push(model);
            return acc;
          }, {}));
        const validIds = new Set(models.map(model => model.id));
        if (selectedModelId !== 'auto' && !validIds.has(selectedModelId)) {
          applySelectedModel('auto', { persist: true, saveWorkspace: true });
        }
        if (dropdown.classList.contains('open')) {
          renderDropdown();
          positionDropdown();
        } else {
          setActiveOption();
        }
      } catch {
        // The local registry already rendered the selector; network hydration is optional.
      }
    })();
    return hydrateModelsPromise;
  };
  setActiveOption();
  window.setTimeout(() => void hydrateModelGroups(), 0);
  const open = async () => {
    const shouldOpen = !dropdown.classList.contains('open');
    if (!shouldOpen) {
      close();
      return;
    }
    dropdown.classList.add('open');
    root.setAttribute('aria-expanded', 'true');
    positionDropdown();
    if (dropdown.dataset.loaded !== 'true') renderDropdown();
    void hydrateModelGroups();
  };

  window.addEventListener('resize', () => {
    if (dropdown.classList.contains('open')) positionDropdown();
  });
  root.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    void open();
  });
  dropdown.addEventListener('click', async event => {
    event.stopPropagation();
    const providerTarget = (event.target as HTMLElement).closest('[data-provider-arrow]') as HTMLElement | null;
    if (providerTarget) {
      event.preventDefault();
      toggleProviderPanel(providerTarget.dataset.providerArrow || '');
      return;
    }
    const target = (event.target as HTMLElement).closest('[data-model-id]') as HTMLElement | null;
    if (!target) return;
    if (target.getAttribute('aria-disabled') === 'true') return;
    applySelectedModel(target.dataset.modelId || 'auto', { saveWorkspace: true });
    if (label) label.textContent = target.dataset.modelName || 'Auto';
    setActiveOption();
    close();
    await apiFetch('/api/users/me/ai-preferences', {
      method: 'PATCH',
      body: JSON.stringify({ default_routing_mode: selectedModelId === 'auto' ? 'Auto' : 'Custom' }),
    }).catch(() => null);
  });
  document.addEventListener('click', close);
}

function ensurePlanBuildControls() {
  const submit = document.getElementById('chat-submit-btn');
  const submitWrapper = document.querySelector('.submit-wrapper') || submit?.parentElement;
  if (!submitWrapper) return;
  let wrapper = document.getElementById('chat-mode-wrapper');
  if (!wrapper) {
    wrapper = document.createElement('div');
    wrapper.id = 'chat-mode-wrapper';
    if (submit) submit.insertAdjacentElement('beforebegin', wrapper);
    else submitWrapper.appendChild(wrapper);
  }
  if (wrapper.dataset.codenAgentModeMounted === 'true') return;
  wrapper.dataset.codenAgentModeMounted = 'true';
  wrapper.innerHTML = '';
  mountAgentModeComposer(wrapper, {
    mode: selectedChatMode,
    locale: (document.documentElement.lang || '').toLowerCase().startsWith('fr') ? 'fr' : 'en',
    triggerId: 'btn-chat-mode',
    onModeChange: (mode) => {
      selectedChatMode = mode;
      scheduleWorkspaceSave({ selected_mode: mode });
    },
  });
}

function setChatMode(mode: ChatMode) {
  selectedChatMode = normalizeAgentMode(mode);
  window.dispatchEvent(new CustomEvent('coden-agent-mode-sync', { detail: { mode: selectedChatMode } }));
  const label = document.getElementById('chat-mode-label');
  const button = document.getElementById('btn-chat-mode') as HTMLButtonElement | null;
  const menu = document.getElementById('chat-mode-menu');
  if (label) label.textContent = modeLabel(selectedChatMode, (document.documentElement.lang || navigator.language || '').toLowerCase().startsWith('fr') ? 'fr' : 'en');
  if (button) {
    button.style.background = selectedChatMode === 'auto' ? 'transparent' : 'var(--accent-hover)';
    button.style.color = selectedChatMode === 'plan' ? 'var(--blue, var(--accent))' : 'var(--text)';
    button.setAttribute('aria-expanded', 'false');
  }
  document.querySelectorAll<HTMLElement>('[data-chat-mode]').forEach(option => {
    const active = option.dataset.chatMode === selectedChatMode;
    option.style.background = active ? 'var(--accent-hover, rgba(9,9,11,.08))' : 'transparent';
    option.style.color = active ? 'var(--text)' : 'var(--text-muted)';
  });
  if (menu) menu.style.display = 'none';
  scheduleWorkspaceSave({ selected_mode: selectedChatMode });
}

function activateBuilderView(view: 'preview' | 'code' | 'database' | 'analysis') {
  currentBuilderView = view;
  const screens: Record<string, string> = {
    preview: 'screen-layout-preview',
    code: 'screen-layout-code',
    database: 'screen-layout-database',
    analysis: 'screen-layout-analysis',
  };
  Object.entries(screens).forEach(([name, id]) => {
    const node = document.getElementById(id);
    if (!node) return;
    node.style.display = name === view ? (view === 'code' ? 'grid' : 'flex') : 'none';
    node.setAttribute('aria-hidden', name === view ? 'false' : 'true');
  });
  document.querySelectorAll('.sub-nav-tab, .builder-more-item').forEach(tab => tab.classList.remove('active'));
  document.getElementById(`tab-btn-${view}`)?.classList.add('active');
  const moreTrigger = document.getElementById('tab-btn-more');
  const moreWrapper = document.getElementById('builder-more-wrapper');
  if (moreTrigger) {
    moreTrigger.classList.toggle('active', view === 'analysis' || view === 'database');
    moreTrigger.setAttribute('aria-expanded', 'false');
  }
  moreWrapper?.classList.remove('open');
  if (view === 'database') void loadDatabase();
  if (view === 'analysis') {
    void loadAnalysis();
    startAnalysisPolling();
  } else {
    stopAnalysisPolling();
  }
  syncPreviewToolbarControls();
  scheduleWorkspaceSave({ active_tab: view });
}

function bindBuilderViews() {
  const entries: Array<['preview' | 'code' | 'database' | 'analysis', string]> = [
    ['preview', 'tab-btn-preview'],
    ['code', 'tab-btn-code'],
    ['database', 'tab-btn-database'],
    ['analysis', 'tab-btn-analysis'],
  ];
  entries.forEach(([view, id]) => {
    const oldButton = document.getElementById(id) as HTMLButtonElement | null;
    if (!oldButton || oldButton.dataset.liveBound === 'true') return;
    const button = oldButton.cloneNode(true) as HTMLButtonElement;
    button.dataset.liveBound = 'true';
    oldButton.replaceWith(button);
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      activateBuilderView(view);
    }, true);
  });
  document.getElementById('btn-add-secret')?.addEventListener('click', () => {
    showApiKeyModal([{ service: 'Custom', variable: 'CUSTOM_API_KEY', description: 'Project API key', required: false }]);
  });
}

function ensureDatabaseView() {
  if (document.getElementById('tab-btn-database')) {
    bindBuilderViews();
    return;
  }
  const tabs = document.querySelector('.sub-nav-tabs');
  const holder = document.querySelector('.viewport-content-holder');
  if (!tabs || !holder || document.getElementById('tab-btn-database')) return;

  const databaseBtn = document.createElement('button');
  databaseBtn.className = 'sub-nav-tab';
  databaseBtn.id = 'tab-btn-database';
  databaseBtn.innerHTML = '<span style="font-size:13px;">▦</span> Database';
  const analysis = document.getElementById('tab-btn-analysis');
  tabs.insertBefore(databaseBtn, analysis || null);

  const panel = document.createElement('div');
  panel.id = 'screen-layout-database';
  panel.style.cssText = 'display:none;flex:1;overflow:auto;padding:18px;background:var(--bg);color:var(--text);';
  panel.innerHTML = `
    <div style="display:grid;gap:14px;max-width:1120px;margin:0 auto;">
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;">
        <div>
          <h2 style="font-size:18px;margin:0 0 4px;">Project database</h2>
          <p style="font-size:12px;color:var(--text-muted);margin:0;">Shared Supabase backend isolated by project and organization.</p>
        </div>
        <button id="btn-add-secret" type="button" style="height:32px;border:1px solid var(--border);background:var(--text);color:var(--bg);border-radius:8px;padding:0 12px;font-size:12px;font-weight:800;cursor:pointer;">Add API key</button>
      </div>
      <div id="database-content" style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;"></div>
    </div>
  `;
  holder.appendChild(panel);
  databaseBtn.addEventListener('click', () => activateDatabaseView());
  panel.querySelector('#btn-add-secret')?.addEventListener('click', () => showApiKeyModal([{ service: 'Custom', variable: 'CUSTOM_API_KEY', description: 'Project API key', required: false }]));
}

function activateDatabaseView() {
  ['screen-layout-code', 'screen-layout-preview'].forEach(id => {
    const node = document.getElementById(id);
    if (node) node.style.display = 'none';
  });
  const analysis = document.getElementById('screen-layout-analysis');
  if (analysis) analysis.style.display = 'none';
  const database = document.getElementById('screen-layout-database');
  if (database) database.style.display = 'block';
  document.querySelectorAll('.sub-nav-tab').forEach(tab => tab.classList.remove('active'));
  document.getElementById('tab-btn-database')?.classList.add('active');
  void loadDatabase();
}

function emptyBuilderProjectPayload(workspaceState: UserWorkspaceState | null = userWorkspaceState): ProjectPayload {
  return {
    success: true,
    project: {
      id: '',
      name: currentProjectName || 'Projet sans titre',
      preview_status: 'idle',
    },
    files: [],
    messages: [],
    events: [],
    preview: {
      status: 'idle',
      html: currentPreviewHtml,
    },
    workspace_state: workspaceState ? {
      draft_prompt: workspaceState.builder_draft_prompt || '',
      selected_mode: workspaceState.builder_selected_mode || 'auto',
      selected_model: workspaceState.builder_selected_model || 'auto',
      active_tab: workspaceState.builder_active_tab || 'preview',
      preview_device: workspaceState.builder_preview_device || 'desktop',
    } : null,
  } as ProjectPayload;
}

async function ensureProject() {
  const wantsFreshProject = isNewProjectRoute();
  const routeProjectId = getProjectIdFromUrl();
  currentProjectId = isRealProjectId(routeProjectId) ? routeProjectId : '';

  if (currentProjectId) {
    rememberLastBuilderProjectId(currentProjectId);
    try {
      return await apiFetch<ProjectPayload>(`/api/projects/${encodeURIComponent(currentProjectId)}`);
    } catch (error) {
      // A bookmarked project can legitimately disappear (for example after a
      // workspace migration). Do not leave its id in memory: the next build
      // would otherwise receive a 404 and incorrectly present it as a missing
      // streaming endpoint. Start from a clean project flow instead.
      const status = Number((error as { status?: unknown })?.status || 0);
      if (status !== 404) throw error;
      const staleProjectId = currentProjectId;
      forgetLastBuilderProjectId(staleProjectId);
      currentProjectId = '';
      userWorkspaceState = null;
      window.history.replaceState({}, '', '/builder.html?new=1');
      return emptyBuilderProjectPayload(null);
    }
  }

  const userState = await apiFetch<{ success: boolean; state: UserWorkspaceState | null }>('/api/users/me/workspace-state').catch(() => null);
  userWorkspaceState = userState?.state || null;
  if (wantsFreshProject) {
    currentProjectId = '';
    userWorkspaceState = null;
    forgetLastBuilderProjectId();
    return emptyBuilderProjectPayload(null);
  }
  const stateProjectId = isRealProjectId(userWorkspaceState?.last_project_id) ? String(userWorkspaceState?.last_project_id) : '';
  const fallbackProjectId = stateProjectId || rememberedLastBuilderProjectId();

  if (fallbackProjectId) {
    setCurrentBuilderProjectId(fallbackProjectId);
    try {
      return await apiFetch<ProjectPayload>(`/api/projects/${encodeURIComponent(currentProjectId)}`);
    } catch (error) {
      forgetLastBuilderProjectId(fallbackProjectId);
      currentProjectId = '';
      window.history.replaceState({}, '', '/builder.html');
      if (userWorkspaceState?.last_project_id === fallbackProjectId) {
        await apiFetch('/api/users/me/workspace-state', {
          method: 'PATCH',
          body: JSON.stringify({ last_project_id: null, last_route: '/builder.html' }),
        }).catch(() => null);
      }
      console.warn('[coden] Unable to restore last builder project.', error);
    }
  }

  return emptyBuilderProjectPayload();
}

function projectNameFromPrompt(prompt: string) {
  return deriveProjectName(prompt);
}

async function ensureProjectForPrompt(prompt: string) {
  if (currentProjectId) return;
  const initialPrompt = prompt || getInitialDashboardPrompt() || 'Create a polished fullstack web application.';
  const selectedName = !isNewProjectRoute() && currentProjectName && currentProjectName !== 'Projet sans titre'
    ? currentProjectName
    : projectNameFromPrompt(initialPrompt);
  const created = await apiFetch<ProjectPayload>('/api/projects', {
    method: 'POST',
    body: JSON.stringify({
      name: selectedName,
      template: 'custom',
      theme: 'light',
      model: selectedModel(),
      prompt: initialPrompt,
    }),
  });
  setCurrentBuilderProjectId(created.project.id);
  setProjectNameDisplay(created.project.name || selectedName);
  await apiFetch(`/api/projects/${encodeURIComponent(currentProjectId)}/workspace-state`, {
    method: 'PATCH',
    body: JSON.stringify({
      draft_prompt: '',
      selected_mode: selectedChatMode,
      selected_model: selectedModelId,
      active_tab: 'preview',
      preview_device: selectedPreviewDevice,
      sidebar_width: Number(localStorage.getItem('coden-sidebar-width') || 380),
    }),
  }).catch(() => null);
  await apiFetch('/api/users/me/workspace-state', {
    method: 'PATCH',
    body: JSON.stringify({
      last_project_id: currentProjectId,
      dashboard_draft_prompt: '',
      builder_draft_prompt: '',
      builder_selected_mode: selectedChatMode,
      builder_selected_model: selectedModelId,
      builder_active_tab: 'preview',
      builder_preview_device: selectedPreviewDevice,
      last_route: `/builder.html?project=${currentProjectId}`,
    }),
  }).catch(() => null);
  await flushPendingPromptAttachments();
}

function dataUrlToBase64(dataUrl?: string) {
  if (!dataUrl) return '';
  const marker = 'base64,';
  const index = dataUrl.indexOf(marker);
  return index >= 0 ? dataUrl.slice(index + marker.length) : '';
}

async function uploadPromptAttachments(attachments: PendingPromptAttachment[]) {
  if (!attachments.length) return;
  if (!currentProjectId) {
    await storePendingPromptAttachments(attachments);
    appendMessage('system', `${attachments.length} file(s) will attach after the project is created.`);
    return;
  }

  let uploaded = 0;
  for (const attachment of attachments) {
    await apiFetch(`/api/projects/${encodeURIComponent(currentProjectId)}/assets`, {
      method: 'POST',
      body: JSON.stringify({
        name: attachment.name,
        kind: attachment.type?.startsWith('image/') ? 'image' : 'file',
        mime_type: attachment.type,
        size_bytes: attachment.size,
        content_base64: dataUrlToBase64(attachment.dataUrl),
      }),
    });
    uploaded += 1;
  }

  appendMessage('system', `${uploaded} file(s) attached to Database > Storage.`);
  if (document.getElementById('tab-btn-database')?.classList.contains('active')) {
    void loadDatabase();
  }
}

function promptVisionInputs() {
  // Keep the base64-expanded request safely below the server's 8 MB JSON limit.
  const maxVisionBytes = 4 * 1024 * 1024;
  let totalBytes = 0;
  return activePromptAttachments
    .filter(attachment => attachment.type?.startsWith('image/') && attachment.dataUrl)
    .slice(0, 4)
    .flatMap(attachment => {
      if (totalBytes + attachment.size > maxVisionBytes) return [];
      totalBytes += attachment.size;
      return [{ url: attachment.dataUrl!, detail: 'high' as const }];
    });
}

async function flushPendingPromptAttachments() {
  if (!currentProjectId) return;
  const pending = await consumePendingPromptAttachments();
  if (!pending.length) return;
  try {
    await uploadPromptAttachments(pending);
  } catch (error) {
    await storePendingPromptAttachments(pending);
    appendMessage('system', error instanceof Error ? error.message : 'Unable to attach pending files.');
  }
}

async function loadProject() {
  ensureToolbar();
  ensurePlanBuildControls();
  ensureDatabaseView();
  const scroll = chatScroll();
  if (scroll && scroll.dataset.liveInitialized !== 'true') {
    scroll.innerHTML = '';
    scroll.dataset.liveInitialized = 'true';
  }
  const api = ensureConversationApi();
  api?.clear();
  if (scroll) delete scroll.dataset.restored;
  const projectName = document.getElementById('project-name');
  const loading = showTransientNotice('Loading project files, timeline and preview...', 0);
  try {
    const payload = await ensureProject();
    if (isRealProjectId(payload.project?.id || currentProjectId)) {
      setCurrentBuilderProjectId(String(payload.project?.id || currentProjectId));
    }
    if (!currentProjectId) {
      const userState = await apiFetch<{ success: boolean; state: UserWorkspaceState | null }>('/api/users/me/workspace-state').catch(() => null);
      userWorkspaceState = userState?.state || null;
      if (userWorkspaceState) {
        applyWorkspaceState({
          draft_prompt: userWorkspaceState.builder_draft_prompt || '',
          selected_mode: userWorkspaceState.builder_selected_mode || 'auto',
          selected_model: userWorkspaceState.builder_selected_model || 'auto',
          active_tab: userWorkspaceState.builder_active_tab || 'preview',
          preview_device: userWorkspaceState.builder_preview_device || 'desktop',
        });
      }
    }
    if (projectName) setProjectNameDisplay(payload.project.name);
    if (currentProjectId) await flushPendingPromptAttachments();
    renderFiles(payload.files || []);
    applyWorkspaceState(payload.workspace_state || null);
    if (payload.preview?.html && payload.preview.status !== 'idle' && isUsablePreviewHtml(payload.preview.html)) {
      setPreview(payload.preview.html, payload.preview.status);
    } else {
      currentPreviewHtml = '';
      setEmptyPreviewState('idle');
    }
    syncProjectReadinessClass();
    restoreMessages(payload);
    const restoredStreamParts = restoreStreamPartsFromPayloadEvents(payload);
    if (!restoredStreamParts) await restoreLatestStreamPartsFromRunHistory(payload);
    const activeTab = payload.workspace_state?.active_tab || userWorkspaceState?.builder_active_tab;
    if (activeTab === 'code' || activeTab === 'database' || activeTab === 'analysis') {
      activateBuilderView(activeTab);
    } else if (activeTab) {
      activateBuilderView('preview');
    }
    setPreviewDevice(normalizePreviewDevice(payload.workspace_state?.preview_device || userWorkspaceState?.builder_preview_device), false);
    syncWorkshopPreview();
    removeMessage(loading);
    if (!payload.messages?.length) {
      showTransientNotice('Projet chargé.', 1600);
    }
  } catch (error) {
    updateMessage(loading, error instanceof Error ? error.message : 'Unable to load project.');
    window.setTimeout(() => removeMessage(loading), 5000);
  }
}

function restoreMessages(payload: ProjectPayload) {
  if (!payload.messages?.length) return;
  const scroll = chatScroll();
  if (!scroll || scroll.dataset.restored === 'true') return;
  scroll.dataset.restored = 'true';
  payload.messages
    .filter(message => {
      const text = messageTextFromParts(message.parts, message.content || '');
      return text && !/^Project (synchronized|ready)\./i.test(text);
    })
    .slice(-100)
    .forEach(message => {
      const role = message.role === 'user' ? 'user' : 'assistant';
      const rawContent = messageTextFromParts(message.parts, message.content || '');
      const content = role === 'assistant'
        ? safeAssistantDisplayText(rawContent, isLikelyFrenchText(rawContent))
        : rawContent;
      const card = appendMessage(role, content);
      void card;
      if (message.intent === 'plan') {
        lastPlan = rawContent;
      }
    });
}

function restoreStreamPartsFromPayloadEvents(payload: ProjectPayload) {
  const scroll = chatScroll();
  if (!scroll || scroll.dataset.streamPartsRestored === 'true' || !payload.events?.length) return false;
  const steps = payload.events.map((event, index) => ({
    sequence_number: Number(event.sequence_number || index + 1),
    event_type: event.event_type,
    status: event.status || 'completed',
    message: event.message || '',
    public_payload: event.public_payload || event.payload || {},
    created_at: event.created_at,
  })) as AgentRunStep[];
  const journal = buildStreamPartsFromSteps(steps, { status: 'completed' } as AgentRunSummary);
  if (!journal) return false;
  const latestAssistantContent = (payload.messages || []).slice().reverse().find(message => message.role !== 'user')?.content || '';
  if (journal.finalText && latestAssistantContent.includes(journal.finalText.slice(0, 80))) {
    journal.finalText = '';
  }
  const card = appendMessage('assistant', '');
  setStreamMessageParts(card, journal);
  scroll.dataset.streamPartsRestored = 'true';
  return true;
}

function buildStreamPartsFromSteps(steps: AgentRunStep[], run?: AgentRunSummary): CodenStreamPartsState | null {
  const relevant = steps
    .slice()
    .sort((a, b) => Number(a.sequence_number || 0) - Number(b.sequence_number || 0))
    .filter(step => step?.event_type);
  const hasStreamEvents = relevant.some(step => [
    'narration',
    'thinking',
    'file_edit',
    'command_started',
    'command_completed',
    'tool_group',
    'check_started',
    'check_completed',
    'check_running',
    'check_done',
    'final_summary',
    'preview_ready',
    'error',
    'cancelled',
  ].includes(step.event_type));
  if (!hasStreamEvents) return null;

  const journal = createCodenStreamPartsState();
  journal.status = run?.status === 'failed'
    ? 'failed'
    : run?.status === 'cancelled'
      ? 'cancelled'
      : run?.status === 'completed'
        ? 'done'
        : 'active';
  journal.elapsed = run?.duration_ms ? formatWorkingDuration(Number(run.duration_ms || 0)) : undefined;
  // A restored run has no local narration. The server event stream is the only
  // source for visible assistant activity.
  journal.activeText = '';
  const fileEntries = new Map<string, CodenStreamEntry>();
  const commandItems: string[] = [];
  const checkItems: string[] = [];
  let finalText = '';

  relevant.forEach(step => {
    const payload = redactInternalModelFields(step.public_payload || {});
    const message = redactSecrets(String(step.message || '')).trim();
    if (step.event_type === 'narration') {
      const text = sanitizeModelStreamText(payload.text || message || '');
      if (text) journal.entries.push({ id: journalEntryId('narration'), kind: 'narration', text, status: 'done' });
      return;
    }
    if (step.event_type === 'thinking' && journal.status === 'active') {
      const text = sanitizeModelStreamText(payload.text || message || '');
      if (text) journal.entries.push({ id: journalEntryId('thinking'), kind: 'thinking', text, status: 'muted' });
      return;
    }
    if (step.event_type === 'file_edit') {
      const entry = createFileEditJournalEntry(payload, true);
      if (entry?.path) fileEntries.set(entry.path, entry);
      return;
    }
    if (step.event_type === 'command_started' && journal.status === 'active') {
      const command = redactSecrets(String(payload.command || '')).trim();
      journal.entries.push({
        id: journalEntryId('command'),
        kind: 'command',
        text: 'En cours',
        command,
        status: 'active',
      });
      return;
    }
    if (step.event_type === 'command_completed') {
      if (payload.tool_group_deferred) return;
      const item = commandSummaryItem(payload, message);
      if (item && !commandItems.includes(item)) commandItems.push(item);
      return;
    }
    if (step.event_type === 'tool_group') {
      const items = Array.isArray(payload.items) ? payload.items.map((item: any) => redactSecrets(String(item || '')).trim()).filter(Boolean) : [];
      items.forEach((item: string) => {
        if (!commandItems.includes(item)) commandItems.push(item);
      });
      return;
    }
    if (step.event_type === 'check_completed' || step.event_type === 'check_done') {
      const checkType = redactSecrets(String(payload.check_type || 'check')).trim();
      const status = redactSecrets(String(payload.status || step.status || '')).trim();
      const summary = redactSecrets(String(payload.summary || message || '')).trim();
      const item = [checkType, status, summary].filter(Boolean).join(' — ');
      if (item && !checkItems.includes(item)) checkItems.push(item);
      return;
    }
    if (step.event_type === 'final_summary') {
      finalText = sanitizeModelStreamText(payload.text || message || '');
      return;
    }
    if (step.event_type === 'error') {
      journal.entries.push({ id: journalEntryId('error'), kind: 'update', text: sanitizeModelStreamText(message || ''), status: 'failed' });
      return;
    }
    if (step.event_type === 'cancelled') {
      journal.entries.push({ id: journalEntryId('cancelled'), kind: 'update', text: sanitizeModelStreamText(message || ''), status: 'cancelled' });
    }
  });

  fileEntries.forEach(entry => journal.entries.push(entry));
  if (commandItems.length) {
    journal.entries.push({
      id: 'commands_restored',
      kind: 'group',
      text: 'commandes exécutées',
      status: 'done',
      items: commandItems.slice(-32),
    });
  }
  if (checkItems.length) {
    journal.entries.push({
      id: 'checks_restored',
      kind: 'group',
      text: 'vérifications terminées',
      status: checkItems.some(item => /\bfailed\b|erreur|corriger/i.test(item)) ? 'failed' : 'done',
      items: checkItems.slice(-24),
    });
  }
  journal.finalText = finalText;
  return journal.entries.length || journal.finalText ? journal : null;
}

async function restoreLatestStreamPartsFromRunHistory(payload: ProjectPayload) {
  const scroll = chatScroll();
  if (!scroll || scroll.dataset.streamPartsRestored === 'true' || !currentProjectId) return;
  scroll.dataset.streamPartsRestored = 'true';
  try {
    const runsPayload = await apiFetch<{ success: boolean; runs: AgentRunSummary[] }>(`/api/projects/${encodeURIComponent(currentProjectId)}/agent/runs?limit=1`);
    const run = runsPayload.runs?.[0];
    if (!run?.id) return;
    const details = await apiFetch<{ success: boolean; run: AgentRunSummary; steps: AgentRunStep[] }>(`/api/projects/${encodeURIComponent(currentProjectId)}/agent/runs/${encodeURIComponent(run.id)}`);
    const journal = buildStreamPartsFromSteps(details.steps || [], details.run || run);
    if (!journal) return;
    const latestAssistantContent = (payload.messages || []).slice().reverse().find(message => message.role !== 'user')?.content || '';
    if (journal.finalText && latestAssistantContent.includes(journal.finalText.slice(0, 80))) {
      journal.finalText = '';
    }
    const card = appendMessage('assistant', '');
    setStreamMessageParts(card, journal);
  } catch (error) {
    console.warn('[coden] Unable to restore rich stream parts.', error);
  }
}

const STREAM_INTERNAL_MODEL_KEYS = [
  'model',
  'model_id',
  'selected_model',
  'requested_model',
  'routed_model',
  'provider_model',
  'selectedModel',
  'requestedModel',
  'auto_routed',
  'task_complexity',
  'routing_mode',
  'selected_model_policy',
  'provider',
];

function redactInternalModelFields(payload: any): any {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {};
  const redacted: any = redactSecretPayload({ ...payload });
  STREAM_INTERNAL_MODEL_KEYS.forEach(key => {
    if (key in redacted) delete redacted[key];
  });
  return redacted;
}

function journalEntryId(prefix = 'entry') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function journalTextKey(value: string) {
  return repairTextEncoding(redactSecrets(String(value || '')))
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[`´’‘ʼʹ"]/g, "'")
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);
}

/**
 * Browser-side stream hygiene only. The model/server owns all assistant copy;
 * this helper redacts secrets and removes transport noise without translating,
 * completing, or inventing a status.
 */
function sanitizeModelStreamText(value: unknown): string {
  return repairTextEncoding(redactSecrets(String(value || '')))
    .replace(/^```(?:json|ts|tsx|html|css|javascript|typescript)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
    .slice(0, 520);
}

function semanticJournalKey(value: string) {
  const key = journalTextKey(value);
  if (!key) return '';
  if (/\b(agents specialises en parallele|specialized agents in parallel)\b/.test(key)) {
    return 'specialist_context_checked';
  }
  if (/^\d+\s+\d+\s+agents?\s+(specialises|specialized|completed|completes)/.test(key)) {
    return 'specialist_context_checked';
  }
  if (/\b(analyse des dependances ast|analyzing dependencies ast)\b/.test(key)) {
    return 'project_influence_scan';
  }
  if (/\b(extraction de la memoire architecturale rag|architectural memory rag)\b/.test(key)) {
    return 'project_context_loaded';
  }
  if (/\b(chargement des tokens design|chargement des jetons design|loading design tokens)\b/.test(key)) {
    return 'visual_style_aligned';
  }
  if (/\b(brief affine|bref affine|brief refined)\b/.test(key)) {
    return 'brief_made_concrete';
  }
  if (/\b(demande recue|request received)\b/.test(key)) {
    return 'goal_framed';
  }
  if (/\b(je prepare le travail|coden prepare le travail|preparing the work)\b/.test(key)) {
    return 'goal_framed';
  }
  if (/\b(je commence par cadrer le resultat attendu avant de toucher au projet)\b/.test(key)) {
    return 'goal_framed';
  }
  if (/\b(je repere les parties du projet qui peuvent influencer ce changement)\b/.test(key)) {
    return 'project_influence_scan';
  }
  if (/\b(je verifie les angles importants en une seule passe pour eviter les oublis)\b/.test(key)) {
    return 'specialist_context_checked';
  }
  if (/\b(les points de vigilance sont clairs je passe a la generation)\b/.test(key)) {
    return 'specialist_context_checked_done';
  }
  if (/\b(je recupere le contexte utile pour rester coherent avec le projet)\b/.test(key)) {
    return 'project_context_loaded';
  }
  if (/\b(j aligne les couleurs l espacement et la typographie avec l existant)\b/.test(key)) {
    return 'visual_style_aligned';
  }
  if (/\b(je precise le brief pour construire quelque chose de concret)\b/.test(key)) {
    return 'brief_made_concrete';
  }
  if (/\b(draft recuperable|recoverable draft|work recoverable|false ready preview|preview reste en attente)\b/.test(key)) {
    return 'recoverable_draft_preview_waiting';
  }
  if (/\b(forced runtime failure marker|marqueur de crash force|crash force)\b/.test(key)) {
    return 'forced_runtime_failure_marker';
  }
  if (/\b(task app must support|commerce app must include|technical build score|blocking issue|points bloquants)\b/.test(key)) {
    return 'blocking_quality_findings';
  }
  if (/\b(preview is ready|preview prete|la preview est prete)\b/.test(key)) {
    return 'preview_ready';
  }
  return key;
}

function sanitizeProviderStreamText(value: unknown, _speaksFrench = false, fallback = '') {
  const raw = repairTextEncoding(redactSecrets(String(value || fallback || ''))).trim();
  if (!raw) return '';
  return raw.replace(/\s+/g, ' ').slice(0, 520).trim();
}
function sanitizeProviderJournalText(value: unknown, _speaksFrench = false, fallback = '') {
  const raw = repairTextEncoding(redactSecrets(String(value || fallback || ''))).trim();
  if (!raw) return '';
  return raw.replace(/\s+/g, ' ').slice(0, 520).trim();
}

function journalDetailFromPayload(payload: Record<string, any>, rawMessage = '') {
  const detail = repairTextEncoding(redactSecrets(String(payload.step_detail || payload.detail || ''))).trim();
  const message = repairTextEncoding(redactSecrets(rawMessage)).trim();
  if (detail && detail !== message) return detail;
  return '';
}

function journalFileLabel(path: string, status = '') {
  const suffix = status && status !== 'ready' ? ` · ${status}` : '';
  return `${path}${suffix}`;
}

function filesFromDiff(diff: any) {
  const created = Array.isArray(diff?.created) ? diff.created.map((path: string) => `+ ${path}`) : [];
  const modified = Array.isArray(diff?.modified) ? diff.modified.map((path: string) => `~ ${path}`) : [];
  const deleted = Array.isArray(diff?.deleted) ? diff.deleted.map((path: string) => `- ${path}`) : [];
  return [...created, ...modified, ...deleted].filter(Boolean).slice(0, 16);
}

function fileEditActionLabel(action: string, speaksFrench: boolean) {
  if (action === 'created') return speaksFrench ? 'Creation de' : 'Creation of';
  if (action === 'deleted') return speaksFrench ? 'Suppression de' : 'Deletion of';
  return speaksFrench ? 'Modification de' : 'Modification of';
}

function normalizedFileEditPayload(payload: Record<string, any>) {
  const path = String(payload.path || '').trim();
  if (!path) return null;
  const action = ['created', 'modified', 'deleted'].includes(String(payload.action || ''))
    ? String(payload.action)
    : 'modified';
  return {
    path,
    action: action as 'created' | 'modified' | 'deleted',
    additions: Math.max(0, Number(payload.additions || 0)),
    deletions: Math.max(0, Number(payload.deletions || 0)),
  };
}

function createFileEditJournalEntry(payload: Record<string, any>, speaksFrench: boolean): CodenStreamEntry | null {
  const edit = normalizedFileEditPayload(payload);
  if (!edit) return null;
  return {
    id: journalEntryId('file'),
    kind: 'file_edit',
    text: `${fileEditActionLabel(edit.action, speaksFrench)} ${edit.path}`,
    status: 'done',
    path: edit.path,
    action: edit.action,
    additions: edit.additions,
    deletions: edit.deletions,
  };
}

function commandSummaryItem(payload: Record<string, any>, rawMessage = '') {
  const command = repairTextEncoding(redactSecrets(String(payload.command || ''))).trim();
  const summary = repairTextEncoding(redactSecrets(String(payload.output_summary || payload.summary || rawMessage || ''))).trim();
  return [command, summary].filter(Boolean).join(' — ');
}

// ── Chat-to-Build: 3-state layout machine ────────────────────────────────────
// data-layout on .workspace-body: "chat-rest" (centered landing composer) ->
// "chat" (full-screen conversation, composer docked) -> "workspace" (IDE).
// CSS does the animation; these helpers only flip the attribute and await the morph.
type BuilderLayout = 'chat-rest' | 'chat' | 'revealing' | 'workspace';

function getWorkspaceBodyEl(): HTMLElement | null {
  return document.querySelector('.workspace-body') as HTMLElement | null;
}

function currentBuilderLayout(): string {
  return getWorkspaceBodyEl()?.dataset.layout || '';
}

function setBuilderLayout(state: BuilderLayout) {
  const body = getWorkspaceBodyEl();
  if (body) body.dataset.layout = state;
}

function focusComposer() {
  (document.getElementById('chat-textarea-box') as HTMLElement | null)?.focus?.();
}

async function revealWorkspaceLayout(): Promise<void> {
  const body = getWorkspaceBodyEl();
  if (!body || body.dataset.layout === 'workspace') return;
  const sidebar = document.querySelector('.sidebar-pane') as HTMLElement | null;
  const reduceMotion = Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
  body.dataset.layout = 'revealing';
  if (!reduceMotion) {
    await new Promise<void>(resolve => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        sidebar?.removeEventListener('transitionend', onEnd);
        resolve();
      };
      const onEnd = (event: TransitionEvent) => { if (event.target === sidebar) finish(); };
      sidebar?.addEventListener('transitionend', onEnd);
      window.setTimeout(finish, 450);
    });
  }
  body.dataset.layout = 'workspace';
  focusComposer();
}

// Initial layout when the builder loads: a project with files opens straight into
// the workspace; an empty project opens the centered "chat-rest" landing.
function applyInitialBuilderLayout() {
  const body = getWorkspaceBodyEl();
  if (!body || body.dataset.layout === 'revealing') return;
  // The builder always opens in the normal side-by-side workspace (sidebar +
  // preview). The centered chat-rest/chat landing belongs to the dashboard entry,
  // not the builder — forcing it here pushed every builder element to the center.
  body.dataset.layout = 'workspace';
}

async function generateFromPrompt(prompt: string, requestedMode: ChatMode, useLastPlan = false, extra: Record<string, unknown> = {}, displayText = prompt) {
  const safePrompt = repairTextEncoding(redactSecrets(prompt)).trim();
  const safeDisplayText = repairTextEncoding(redactSecrets(displayText));
  if (isGenerating || !safePrompt) return;
  // First send from the resting landing: drop the composer to the bottom and open
  // the conversation BEFORE rendering the message (state 1 -> state 2).
  if (currentBuilderLayout() === 'chat-rest') setBuilderLayout('chat');
  const speaksFrench = isLikelyFrenchText(safePrompt);
  const promptUiContext = extra.confirmedCriticalAction ? 'project_mission' : classifyPromptUiContext(safePrompt, requestedMode);
  const handoff = getInitialBuilderHandoff();
  const effectiveExtra = {
    ...extra,
    ...(extra.studioContext === undefined && activeWorkshop !== 'chat' ? { studioContext: studioPromptContextPayload() } : {}),
    ...(extra.importContext === undefined && handoff.importContext ? { importContext: handoff.importContext } : {}),
  };
  clearInlineBlocks();
  appendMessage('user', safeDisplayText);

  if (promptUiContext === 'chat_simple' || promptUiContext === 'clarification_only' || promptUiContext === 'planning_only') {
    activeAbort = new AbortController();
    const card = appendMessage('assistant', '', { working: true });
    setMessageShimmer(card, '', false);
    try {
      await answerSimpleConversationFromProvider(card, safePrompt, speaksFrench, requestedMode);
    } finally {
      activeAbort = null;
    }
    return;
  }

  if (promptUiContext === 'critical_action') {
    appendCriticalActionConfirmation(safePrompt, speaksFrench);
    return;
  }

  if (handoff.importContext && effectiveExtra.importContext === handoff.importContext) {
    delete handoff.importContext;
  }

  // Intent gate (state 2 -> state 3): reaching here means promptUiContext is the
  // build/edit run path (conversation/plan/clarify/critical returned earlier). If
  // we are not already in the workspace, reveal the builder before running — unless
  // credits are known-empty client-side, in which case show the upgrade prompt and
  // do not reveal/run.
  if (currentBuilderLayout() && currentBuilderLayout() !== 'workspace') {
    if (lastWalletBalance === 0) {
      showCreditsModal();
      return;
    }
    await revealWorkspaceLayout();
  }

  stopRequested = false;
  setBusy(true);
  activeAbort = new AbortController();

  const status = appendMessage('assistant', '');
  if (status) status.dataset.workingStartedAt = String(Date.now());
  let generationTouchesPreview = false;
  activeGenerationTouchesPreview = false;
  let streamedText = '';
  let assistantHasFinalContent = false;
  let plainResponseMode = false;
  const say = (fr: string, en: string) => speaksFrench ? fr : en;
  let responseCard: HTMLElement | null = status;
  const journal = createCodenStreamPartsState();
  const journalGroups = new Map<string, CodenStreamEntry>();
  const fileEditEntries = new Map<string, CodenStreamEntry>();
  const runningCommandEntries = new Map<string, CodenStreamEntry>();
  const seenJournalKeys = new Set<string>();
  let journalFrame = 0;
  let journalFlushTimer: number | null = null;
  let lastJournalFlushAt = 0;
  let lastWorkingTickAt = 0;
  let lastActiveTextAt = 0;
  let journalTimer: number | null = null;
  // One visible assistant message is the source of truth for an active run.
  const useAgentFlow = false;
  const renderTechnicalRun = false;
  let flowStatus: 'active' | 'done' | 'failed' | 'cancelled' = 'active';
  let flowChecklist: CodenFlowChecklistItem[] = [];
  let flowStreamingText = '';
  let flowIsStreaming = false;
  let flowPhase = say('Réflexion…', 'Thinking…');
  let flowIntro = say('Je regarde ta demande et je mets en place le plan.', 'Looking at your request and setting up the plan.');
  let flowSummary = '';

  const flowId = () => messageHandleId(status);

  const flushFlow = () => {
    const sid = flowId();
    if (!sid || !conversationApi?.setFlow) return;
    conversationApi.setFlow(sid, {
      status: flowStatus,
      intro: flowIntro,
      checklist: flowChecklist,
      streamingText: flowStreamingText,
      isStreaming: flowIsStreaming,
      phase: flowPhase,
      elapsed: elapsedForStatus(),
      summary: flowSummary,
    });
    const scroll = document.getElementById('sidebar-scroll-area');
    if (scroll && Math.abs(scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop) < 120) {
      scrollChatToBottom();
    }
  };

  const initFlow = () => {
    flowChecklist = buildInitialFlowChecklist(speaksFrench);
    flowStatus = 'active';
    flowIsStreaming = false;
    flowStreamingText = '';
    flowSummary = '';
    flowPhase = say('Réflexion…', 'Thinking…');
    const sid = flowId();
    if (!sid || !conversationApi?.setFlow) return;
    conversationApi.setFlow(sid, {
      status: 'active',
      intro: flowIntro,
      checklist: flowChecklist,
      isStreaming: false,
      phase: flowPhase,
      startedAt: new Date().toISOString(),
    });
  };

  const elapsedForStatus = () => {
    const startedAt = Number(status?.dataset.workingStartedAt || 0);
    return startedAt ? formatWorkingDuration(Date.now() - startedAt) : undefined;
  };
  const flushJournal = () => {
    journalFrame = 0;
    lastJournalFlushAt = Date.now();
    journal.elapsed = elapsedForStatus() || journal.elapsed;
    if (!renderTechnicalRun) return;
    if (useAgentFlow) {
      flushFlow();
      return;
    }
    setStreamMessageParts(status, journal);
  };
  const scheduleJournal = (immediate = false) => {
    if (journalFrame) return;
    if (immediate && journalFlushTimer !== null) {
      window.clearTimeout(journalFlushTimer);
      journalFlushTimer = null;
    } else if (journalFlushTimer !== null) {
      return;
    }
    const wait = immediate ? 0 : Math.max(0, 180 - (Date.now() - lastJournalFlushAt));
    const requestFrame = () => {
      journalFrame = window.requestAnimationFrame(flushJournal);
    };
    if (wait > 0) {
      journalFlushTimer = window.setTimeout(() => {
        journalFlushTimer = null;
        requestFrame();
      }, wait);
      return;
    }
    requestFrame();
  };
  const switchToPlainResponse = () => {
    if (plainResponseMode) return;
    plainResponseMode = true;
    journal.status = 'done';
    journal.entries = [];
    journal.activeText = '';
    journal.finalText = '';
    setMessageBlock(status, null);
  };
  // Map of step key → journal entry, so finishAgentStep can flip active→done.
  const activeStepEntries = new Map<string, CodenStreamEntry>();
  const addJournalLine = (text: string, detail = '', key = '', entryStatus: CodenStreamEntry['status'] = 'done') => {
    const clean = sanitizeProviderStreamText(sanitizeProviderJournalText(text, speaksFrench), speaksFrench);
    if (!clean) return;
    const cleanDetail = sanitizeProviderStreamText(sanitizeProviderJournalText(detail, speaksFrench), speaksFrench);
    const contentKey = semanticJournalKey(clean);
    const dedupeKey = key ? `${key}:${contentKey}` : contentKey;
    if (seenJournalKeys.has(dedupeKey)) return;
    const lastEntry = journal.entries[journal.entries.length - 1];
    if (seenJournalKeys.has(`content:${contentKey}`)) return;
    if (lastEntry?.kind !== 'group' && semanticJournalKey(lastEntry?.text || '') === contentKey) return;
    seenJournalKeys.add(dedupeKey);
    seenJournalKeys.add(`content:${contentKey}`);
    journal.entries.push({
      id: journalEntryId('line'),
      kind: 'update',
      text: clean,
      detail: cleanDetail && journalTextKey(cleanDetail) !== journalTextKey(clean) ? cleanDetail : undefined,
      status: entryStatus,
    });
    if (journal.entries.length > 28) journal.entries.splice(0, journal.entries.length - 28);
    scheduleJournal();
  };
  const addJournalDivider = (text: string, key = text) => {
    if (seenJournalKeys.has(`divider:${key}`)) return;
    seenJournalKeys.add(`divider:${key}`);
    journal.entries.push({ id: journalEntryId('divider'), kind: 'divider', text });
    scheduleJournal();
  };
  const upsertJournalGroup = (id: string, label: string, item: string, entryStatus: CodenStreamEntry['status'] = 'done') => {
    // Keep provider/server event text intact. Local code may redact and bound
    // the payload, but it must not translate or rewrite an agent claim.
    const cleanItem = sanitizeProviderJournalText(item, speaksFrench) || redactSecrets(item).trim();
    if (!cleanItem) return;
    const itemKey = semanticJournalKey(cleanItem);
    let group = journalGroups.get(id);
    if (!group) {
      group = { id, kind: 'group', text: label, items: [], status: entryStatus };
      journalGroups.set(id, group);
      journal.entries.push(group);
    }
    group.status = entryStatus;
    group.items ||= [];
    const hasItem = group.items.some(existing => semanticJournalKey(existing) === itemKey);
    if (!hasItem) group.items.push(cleanItem);
    if (group.items.length > 18) group.items = group.items.slice(-18);
    scheduleJournal();
  };
  const upsertFileEditEntry = (payload: Record<string, any>) => {
    const next = createFileEditJournalEntry(payload, speaksFrench);
    if (!next?.path) return;
    const existing = fileEditEntries.get(next.path);
    if (existing) {
      existing.text = next.text;
      existing.action = next.action;
      existing.additions = next.additions;
      existing.deletions = next.deletions;
      existing.status = next.status;
    } else {
      fileEditEntries.set(next.path, next);
      journal.entries.push(next);
    }
    scheduleJournal();
  };
  const commandKey = (payload: Record<string, any>) => String(payload.command || payload.label || 'command').trim() || 'command';
  const setRunningCommand = (payload: Record<string, any>) => {
    const command = redactSecrets(String(payload.command || '')).trim();
    const key = commandKey(payload);
    let entry = runningCommandEntries.get(key);
    if (!entry) {
      entry = {
        id: journalEntryId('command'),
        kind: 'command',
        text: speaksFrench ? 'En cours' : 'Running',
        command,
        status: 'active',
      };
      runningCommandEntries.set(key, entry);
      journal.entries.push(entry);
    } else {
      entry.command = command;
      entry.status = 'active';
    }
    scheduleJournal();
  };
  const completeRunningCommand = (payload: Record<string, any>, rawMessage: string) => {
    const key = commandKey(payload);
    const entry = runningCommandEntries.get(key);
    if (entry) {
      journal.entries = journal.entries.filter(item => item !== entry);
      runningCommandEntries.delete(key);
    }
    if (payload.tool_group_deferred) {
      scheduleJournal();
      return;
    }
    const item = commandSummaryItem(payload, rawMessage);
    if (item) upsertJournalGroup('commands', speaksFrench ? 'commandes exécutées' : 'commands executed', item, payload.status === 'failed' ? 'failed' : 'done');
  };
  const setJournalActive = (label: string, urgent = false) => {
    const clean = sanitizeProviderStreamText(sanitizeProviderJournalText(label, speaksFrench), speaksFrench);
    if (!clean || journal.activeText === clean) return;
    const now = Date.now();
    if (!urgent && now - lastActiveTextAt < 900) return;
    lastActiveTextAt = now;
    journal.activeText = clean;
    scheduleJournal(urgent);
  };
  const markAgentStep = (key: string, label: string, headline = label, detail?: string) => {
    setJournalActive(headline);
    const clean = sanitizeProviderStreamText(sanitizeProviderJournalText(label, speaksFrench), speaksFrench);
    if (clean) {
      // Mark any previous active step as done before adding the new one.
      for (const [, entry] of activeStepEntries) {
        if (entry.status === 'active') entry.status = 'done';
      }
      const dedupeKey = `step:${key}`;
      const existing = activeStepEntries.get(key);
      if (existing) {
        existing.text = clean;
        existing.status = 'active';
      } else if (!seenJournalKeys.has(dedupeKey)) {
        seenJournalKeys.add(dedupeKey);
        const entry: CodenStreamEntry = {
          id: journalEntryId('line'),
          kind: 'update',
          text: clean,
          detail: detail ? sanitizeProviderStreamText(sanitizeProviderJournalText(detail, speaksFrench), speaksFrench) || undefined : undefined,
          status: 'active',
        };
        activeStepEntries.set(key, entry);
        journal.entries.push(entry);
        if (journal.entries.length > 28) journal.entries.splice(0, journal.entries.length - 28);
      }
      scheduleJournal();
    }
    if (useAgentFlow) {
      flowChecklist = advanceFlowChecklist(flowChecklist, key);
      flowPhase = headline;
      flowIsStreaming = false;
      flushFlow();
    }
  };
  const finishAgentStep = (key: string, label?: string, detail?: string) => {
    const existing = activeStepEntries.get(key);
    if (existing) {
      existing.status = 'done';
      if (label) existing.text = sanitizeProviderStreamText(sanitizeProviderJournalText(label, speaksFrench), speaksFrench) || existing.text;
      if (detail) existing.detail = sanitizeProviderStreamText(sanitizeProviderJournalText(detail, speaksFrench), speaksFrench) || undefined;
      activeStepEntries.delete(key);
      scheduleJournal();
    } else if (label) {
      addJournalLine(label, detail || '', `step_done:${key}`);
    }
  };
  const setAssistantWorking = (label: string) => {
    if (assistantHasFinalContent) return;
    setJournalActive(label);
  };
  const promoteToPreviewWork = (label = say('Je prépare la preview', 'Preparing preview')) => {
    if (generationTouchesPreview) return;
    generationTouchesPreview = true;
    activeGenerationTouchesPreview = true;
    activateBuilderView('preview');
    setEmptyPreviewState('working', label);
  };
  const ensureResponseCard = (traceLabel = say('Terminé', 'Completed')) => {
    void traceLabel;
    if (assistantHasFinalContent) return responseCard;
    responseCard = status || appendMessage('assistant', '');
    assistantHasFinalContent = true;
    return responseCard;
  };
  const commitAssistantText = (content: unknown, fallback = '', traceLabel = say('Terminé', 'Completed')) => {
    void fallback;
    void traceLabel;
    const text = String(content || '').trim();
    if (!text) throw new Error('The selected AI model did not return a usable final response.');
    const target = ensureResponseCard(traceLabel);
    streamedText = text;
    if (target === status) {
      if (plainResponseMode) {
        setMessageBlock(target, null);
        updateMessage(target, text);
        return target;
      }
      journal.status = 'done';
      journal.activeText = '';
      journal.finalText = text;
      scheduleJournal();
    } else {
      updateMessage(target, text);
    }
    return target;
  };
  const startBuildStream = () => {
    journal.status = 'active';
    journal.activeText = '';
  };
  startBuildStream();
  try {
    await ensureProjectForPrompt(safePrompt);
    if (activeWorkshop === 'media') {
      generationTouchesPreview = true;
      activeGenerationTouchesPreview = true;
      activateBuilderView('preview');
      setAssistantWorking('Generating media');
      markAgentStep('media_brief', say('Brief media préparé.', 'Media brief prepared.'), say('Atelier media', 'Media workshop'), say('Je comprends le format, le modèle et le type de contenu.', 'I am reading the format, model and content type.'));
      setMediaPreviewHtml(mediaPreviewShellHtml('working', 'Generating media'), 'media.coden.local / rendering');
      const mediaPayload = await apiFetch<MediaGeneratePayload>(`/api/projects/${encodeURIComponent(currentProjectId)}/media/generate`, {
        method: 'POST',
        body: JSON.stringify({
          prompt: safePrompt,
          settings: mediaSettings,
          studioContext: studioPromptContextPayload(),
        }),
      });
      finishAgentStep('media_brief', say('Brief media pret.', 'Media brief ready.'));
      finishAgentStep('media_render', mediaPayload.assets?.length
        ? say('Asset media pret.', 'Media asset ready.')
        : mediaPayload.status === 'not_configured'
          ? say('Brief pret, provider a connecter.', 'Brief ready, provider needs connection.')
          : say('Resultat media pret.', 'Media result ready.'));
      if (mediaPayload.preview?.html) {
        setMediaPreviewHtml(mediaPayload.preview.html, `${mediaPayload.status}.media.coden.local`);
      }
      const mediaText = String(mediaPayload.text || '').trim();
      if (!mediaText) throw new Error('The media model did not return a usable response.');
      const target = commitAssistantText(mediaText, '', say('Media pret', 'Media ready'));
      if (mediaPayload.assets?.[0]?.url) {
        addInlineAction(target, 'Download', () => window.open(mediaPayload.assets[0].url, '_blank', 'noopener,noreferrer'));
      }
      addInlineAction(target, speaksFrench ? 'Variation' : 'Variation', () => void generateFromPrompt(`${safePrompt}\n\nMake a fresh variation with the same goal.`, 'auto', false, { studioContext: studioPromptContextPayload() }, safeDisplayText));
      addInlineAction(target, speaksFrench ? 'Utiliser dans l app' : 'Use in app', () => {
        setActiveWorkshop('chat', { focusInput: true });
        const promptInput = document.getElementById('chat-textarea-box') as HTMLTextAreaElement | null;
        if (promptInput) {
          promptInput.value = speaksFrench
            ? 'Utilise le dernier asset Coden Media dans la landing de cette app, sans casser le design actuel.'
            : 'Use the latest Coden Media asset in this app landing without breaking the current design.';
          promptInput.dispatchEvent(new Event('input', { bubbles: true }));
          promptInput.focus();
        }
      });
      return;
    }
    const visionInputs = promptVisionInputs();
    const requestBody = {
      prompt: safePrompt,
      requestedMode,
      useLastPlan,
      modelId: selectedModel(),
      clientMessageId: messageHandleId(status) || undefined,
      ...(visionInputs.length ? { visionInputs } : {}),
      ...effectiveExtra,
    };

    if (requestedMode === 'build' || requestedMode === 'fix' || requestedMode === 'auto') {
      generationTouchesPreview = true;
      activeGenerationTouchesPreview = true;
      activateBuilderView('preview');
      setEmptyPreviewState('working', speaksFrench ? 'Generation en cours' : 'Generating');
    }

    // Stream generation events into the React Response surface, then use the
    // authoritative done payload to refresh files and preview atomically.
    activeHarnessThreadId = '';
    activeHarnessTurnId = '';
    lastAgentRunId = '';
    startLiveRun(status, { mode: requestedMode, model: selectedModel(), intent: safePrompt });
    let payload: any = await streamProjectGeneration(currentProjectId, requestBody, (type, data) => {
      if (data?.runId) lastAgentRunId = String(data.runId);
      if (data?.threadId) activeHarnessThreadId = String(data.threadId);
      if (data?.turnId) activeHarnessTurnId = String(data.turnId);
      const id = messageHandleId(status);
      if (id && conversationApi && isCodenStreamEvent(data)) {
        conversationApi.applyStreamEvent(id, data);
      } else if (type === 'assistant_delta') {
        const delta = String(data?.text || data?.content || '');
        if (id && conversationApi && delta) conversationApi.appendAssistantDelta(id, delta);
      }
    }, activeAbort?.signal);
    {
      const statusCode = Number(payload?.status_code || 200);
      // A recoverable draft deliberately returns success:false + needs_fix so
      // the UI can preserve the generated files, preview and real summary.
      // Treating it as a transport failure discarded all of that work and
      // surfaced the misleading "Generation failed with 200" message.
      if (statusCode >= 400 || (payload?.success === false && !payload?.needs_fix)) {
        throw new Error(String(payload?.message || payload?.error || `Generation failed with ${statusCode}`));
      }
    }

    // [REMPLACEMENT STREAMING UI ICI]
    // Le nouveau rendu React consomme le transport SSE existant et retombe sur
    // cette reponse finale uniquement si le flux ne demarre pas.
    if (!payload) throw new Error('Generation failed or empty response');

    const responsePayload = redactInternalModelFields(payload || {});
    if (responsePayload.project?.id) {
      currentProjectId = String(responsePayload.project.id);
      setCurrentBuilderProjectId(currentProjectId);
      if (responsePayload.project.name) setProjectNameDisplay(String(responsePayload.project.name));
    }
    if (Array.isArray(responsePayload.files)) renderFiles(responsePayload.files);
    if (Array.isArray(responsePayload.diff?.file_stats)) {
      responsePayload.diff.file_stats.slice(0, 8).forEach((fileStat: Record<string, any>) => upsertFileEditEntry(fileStat));
    } else if (responsePayload.diff) {
      const paths = filesFromDiff(responsePayload.diff);
      paths.slice(0, 8).forEach((label: string) => {
        const action = label.startsWith('+ ')
          ? 'created'
          : label.startsWith('- ')
            ? 'deleted'
            : 'modified';
        upsertFileEditEntry({ path: label.replace(/^[+~-]\s+/, ''), action });
      });
    }

    const previewHtml = String(responsePayload.preview?.html || responsePayload.project?.preview_html || '').trim();
    const previewStatus = String(responsePayload.preview?.status || responsePayload.project?.preview_status || 'unknown');
    if (previewHtml) {
      generationTouchesPreview = true;
      activeGenerationTouchesPreview = true;
      activateBuilderView('preview');
      setPreview(previewHtml, previewStatus);
    }

    if (responsePayload.plan?.title || responsePayload.plan?.steps) {
      lastPlan = JSON.stringify(responsePayload.plan, null, 2);
    }

    const hasNeedsFix = Boolean(responsePayload.needs_fix);
    const rawText = String(responsePayload.summary || responsePayload.text || responsePayload.message || '').trim();
    const finalText = safeAssistantDisplayText(rawText, speaksFrench);
    if (!finalText) throw new Error('The selected AI model did not return a usable final summary.');

    clearMessageShimmer(status);
    // The final assistant response is produced by the selected model. Facts
    // and checks travel separately so the browser never manufactures a second
    // completion from local copy.
    const finalJoined = finalText;
    if (useAgentFlow) {
      flowStatus = hasNeedsFix ? 'failed' : 'done';
      flowIsStreaming = false;
      flowStreamingText = '';
      flowSummary = finalJoined;
      flowChecklist = flowChecklist.map(item => ({ ...item, status: item.status === 'failed' ? 'failed' : 'done' as const }));
      flowPhase = hasNeedsFix ? say('Échec', 'Failed') : say('Terminé', 'Done');
      flushFlow();
      updateMessage(status, finalJoined);
    }
    const target = commitAssistantText(finalJoined, '', '');
    if (hasNeedsFix && target === status) {
      journal.status = 'failed';
      journal.activeText = '';
      journal.finalText = finalText;
      scheduleJournal(true);
    }

    if (responsePayload.intent?.intent === 'clarification_required') {
      setMessageBlock(target, {
        type: 'confirmation',
        title: speaksFrench ? 'Clarification necessaire' : 'Clarification needed',
        body: finalText,
        state: 'approval-requested',
        approveLabel: speaksFrench ? 'Repondre' : 'Answer',
        rejectLabel: speaksFrench ? 'Annuler' : 'Cancel',
      });
    }

    if (Array.isArray(responsePayload.errors) && responsePayload.errors.length) showFixBugBox(responsePayload.errors);
    if (generationTouchesPreview && !previewHtml) setEmptyPreviewState('idle', 'Preview non vérifiée');
    return;
  } catch (error) {
    // The stream reader can surface cancellation as an incomplete stream
    // instead of a native AbortError. The explicit user intent is the source
    // of truth, so never present a deliberate stop as a transport defect.
    if (stopRequested || (error as Error).name === 'AbortError') {
      const stoppedText = stopRequested
        ? (speaksFrench ? 'Génération arrêtée.' : 'Generation stopped.')
        : (speaksFrench ? 'Build annulé.' : 'Build cancelled.');
      clearMessageShimmer(status);
      if (useAgentFlow) {
        flowStatus = 'cancelled';
        flowIsStreaming = false;
        flowStreamingText = '';
        flowSummary = stoppedText;
        flowPhase = say('Annulé', 'Cancelled');
        flushFlow();
      }
      journal.status = 'cancelled';
      journal.activeText = '';
      journal.finalText = stoppedText;
      scheduleJournal(true);
      failLiveRun(status, stoppedText, 'cancelled');
      if (generationTouchesPreview) setEmptyPreviewState('idle', stopRequested ? 'Generation stopped' : 'Build cancelled');
    } else {
      const errorText = error instanceof Error ? error.message : 'Generation failed.';
      const runStatus = error instanceof CodenStreamIncompleteError ? 'incomplete' : 'failed';
      clearMessageShimmer(status);
      if (useAgentFlow) {
        flowStatus = 'failed';
        flowIsStreaming = false;
        flowStreamingText = '';
        flowSummary = errorText;
        flowPhase = say('Échec', 'Failed');
        flushFlow();
      }
      journal.status = 'failed';
      journal.activeText = '';
      journal.finalText = errorText;
      scheduleJournal(true);
      failLiveRun(status, errorText, runStatus);
      if (generationTouchesPreview) setEmptyPreviewState('idle', 'Preview non vérifiée');
    }
  } finally {
    if (journalTimer !== null) window.clearInterval(journalTimer);
    if (journalFlushTimer !== null) window.clearTimeout(journalFlushTimer);
    if (journalFrame) window.cancelAnimationFrame(journalFrame);
    clearMessageShimmer(status);
    setBusy(false);
    activeAbort = null;
    activeStreamHandle = null;
    stopRequested = false;
    activeGenerationTouchesPreview = false;
  }
}

async function cancelBuild() {
  if (!isGenerating) return;
  stopRequested = true;
  activeAbort?.abort();
  activeStreamHandle?.cancel();
  if (currentProjectId) {
    if (activeHarnessThreadId && activeHarnessTurnId) {
      await apiFetch(`/api/projects/${encodeURIComponent(currentProjectId)}/agent/threads/${encodeURIComponent(activeHarnessThreadId)}/turns/${encodeURIComponent(activeHarnessTurnId)}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'cancelled_by_user' }),
      }).catch(() => null);
    }
    await apiFetch(`/api/projects/${encodeURIComponent(currentProjectId)}/build/cancel`, {
      method: 'POST',
      body: JSON.stringify({ buildSessionId: lastBuildSessionId, agentRunId: lastAgentRunId }),
    }).catch(() => null);
    if (lastAgentRunId) {
      await apiFetch(`/api/projects/${encodeURIComponent(currentProjectId)}/agent/runs/${encodeURIComponent(lastAgentRunId)}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ buildSessionId: lastBuildSessionId }),
      }).catch(() => null);
    }
  }
  if (activeGenerationTouchesPreview) setEmptyPreviewState('idle', 'Generation stopped');
  setBusy(false);
}

async function sendActiveHarnessInstruction(text: string) {
  if (!currentProjectId || !text.trim()) return;
  const instruction = repairTextEncoding(text).trim().slice(0, 4000);
  appendMessage('user', instruction);
  try {
    const endpoint = activeHarnessThreadId && activeHarnessTurnId
      ? `/api/projects/${encodeURIComponent(currentProjectId)}/agent/threads/${encodeURIComponent(activeHarnessThreadId)}/turns/${encodeURIComponent(activeHarnessTurnId)}/instructions`
      : lastAgentRunId
        ? `/api/projects/${encodeURIComponent(currentProjectId)}/agent/runs/${encodeURIComponent(lastAgentRunId)}/instructions`
        : '';
    if (!endpoint) throw new Error('The active agent turn is not ready to receive instructions yet.');
    const response = await apiFetch<{ message?: string }>(endpoint, {
      method: 'POST',
      body: JSON.stringify({ instruction }),
    });
    appendMessage('assistant', response.message || 'Instruction reçue. Coden l’appliquera au prochain checkpoint sûr.');
  } catch (error) {
    appendMessage('assistant', error instanceof Error ? error.message : 'The instruction could not be queued.');
  }
}

async function exportCode() {
  if (!currentProjectId) return;
  if (!currentFiles.length) {
    appendMessage('system', 'No generated files are available to export yet.');
    return;
  }
  const files = currentFiles;
  const blob = new Blob([JSON.stringify({ files }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'coden-code-export.json';
  link.click();
  URL.revokeObjectURL(url);
}

type DbBadgeKind = 'success' | 'warning' | 'error' | 'neutral';

function dbBadge(kind: DbBadgeKind, label: string): string {
  return `<span class="db-badge db-badge-${kind}">${escapeHtml(label)}</span>`;
}

// Classe l'état réel du provisioning cloud (cf. provisioning-state-machine.ts :
// pending → provisioning → migrating → ready / failed, + detected/not_detected).
function dbCloudStatus(rawStatus: string): { kind: DbBadgeKind; label: string } {
  const status = (rawStatus || '').toLowerCase();
  if (/not[_ ]?detect|not[_ ]?found|waiting_for_schema/.test(status)) return { kind: 'neutral', label: 'Non détecté' };
  if (/ready|provisioned|active|enabled|connected/.test(status)) return { kind: 'success', label: 'Provisionné' };
  if (/fail|error/.test(status)) return { kind: 'error', label: 'Échec du provisioning' };
  if (/provision|migrat|pending|queue|progress/.test(status)) return { kind: 'warning', label: 'Provisioning en cours' };
  if (/schema_generated/.test(status)) return { kind: 'warning', label: 'Schéma prêt — non provisionné' };
  if (/detect/.test(status)) return { kind: 'warning', label: 'Détecté (auto)' };
  return { kind: 'neutral', label: 'Non détecté' };
}

function dbProviderName(provider: string): string {
  const value = (provider || '').toLowerCase();
  if (value === 'coden_cloud' || !value) return 'Coden Cloud';
  if (value === 'supabase') return 'Supabase';
  return provider;
}

const DB_ICON_INFO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M12 16v-4"></path><path d="M12 8h.01"></path></svg>';

// Section 1 — Base de données intégrée. Tout ici reflète un backend réel
// (provisioning, schéma/migrations, clés API). Le parcours des lignes et la
// console des utilisateurs finaux n'ont pas d'API : état honnête, jamais de
// fausses données.
function renderDatabaseSection1(db: any): string {
  const cloud = db.cloud || {};
  const secrets: any[] = Array.isArray(db.secrets) ? db.secrets : [];
  const appTables: any[] = (Array.isArray(db.tables) ? db.tables : []).filter((table: any) => table && table.source === 'supabase/schema.sql');
  const hasSchema = db.backend_status === 'schema_generated' || appTables.length > 0;
  const conn = dbCloudStatus(cloud.status || db.backend_status || '');
  const region = cloud.region && cloud.region !== 'auto' ? String(cloud.region) : 'Région auto';

  const connectionCard = `
    <div class="db-card">
      <span class="db-card-label">Connexion cloud</span>
      <div class="db-card-value">${dbBadge(conn.kind, conn.label)}</div>
      <div class="db-row-meta">${escapeHtml(dbProviderName(cloud.provider))} · ${escapeHtml(region)}</div>
    </div>`;

  const schemaCard = `
    <div class="db-card">
      <span class="db-card-label">Schéma & migrations</span>
      <div class="db-card-value">${hasSchema
        ? dbBadge('success', appTables.length ? `${appTables.length} table${appTables.length > 1 ? 's' : ''} définie${appTables.length > 1 ? 's' : ''}` : 'Schéma généré')
        : dbBadge('warning', 'En attente de schéma')}</div>
      <div class="db-row-meta">${hasSchema ? 'Migrations gérées par Coden' : 'Décrivez votre modèle de données à Coden'}</div>
    </div>`;

  const secretsCard = `
    <div class="db-card">
      <span class="db-card-label">Clés API (${secrets.length})</span>
      ${secrets.length
        ? `<div class="db-card-list">${secrets.slice(0, 4).map((secret: any) => `
            <div class="db-row"><span class="db-row-key">${escapeHtml(secret.variable || '—')}</span><span class="db-row-meta">${escapeHtml(secret.masked_value || '••••')}</span></div>`).join('')}
          ${secrets.length > 4 ? `<div class="db-row-meta">+${secrets.length - 4} autre${secrets.length - 4 > 1 ? 's' : ''}</div>` : ''}</div>`
        : `<div class="db-empty">Aucune clé configurée — utilisez « Ajouter une clé API ».</div>`}
    </div>`;

  // Tables card = live read-only browser, hydrated by loadProjectDbBrowser().
  const tablesBlock = `
    <div class="db-card">
      <span class="db-card-label">Parcourir les données (lecture seule)</span>
      <div id="db-browser" class="db-browser" data-state="loading">
        <div class="db-state">Chargement des tables…</div>
      </div>
    </div>`;

  return `
    <section class="db-section">
      <div class="db-section-head">
        <span class="db-section-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><ellipse cx="12" cy="5" rx="8" ry="3"></ellipse><path d="M4 5v6c0 1.66 3.58 3 8 3s8-1.34 8-3V5"></path><path d="M4 11v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6"></path></svg></span>
        <div class="db-section-head-text">
          <h2 class="db-section-title">Base de données intégrée</h2>
          <p class="db-section-desc">Base managée, migrations de schéma et clés d'accès — provisionnées par Coden.</p>
        </div>
      </div>
      <div class="db-section-body">
        <div class="db-grid">${connectionCard}${schemaCard}${secretsCard}</div>
        ${tablesBlock}
      </div>
    </section>`;
}

// Section 2 — Authentification & utilisateurs. On reflète si l'app REQUIERT
// l'auth (requirements.needs_auth) et l'état de provisioning. La console des
// utilisateurs finaux n'a pas d'API : état honnête, pas de fausse table.
function renderDatabaseSection2(db: any): string {
  const cloud = db.cloud || {};
  const requirements = cloud.requirements || null;
  const cloudStatus = (cloud.status || db.backend_status || '').toLowerCase();
  const provisioned = /ready|provisioned|active|enabled/.test(cloudStatus);

  let authBadge: string;
  let authMeta: string;
  if (!requirements) {
    authBadge = dbBadge('neutral', 'Analyse en attente');
    authMeta = 'L\'analyse du backend démarre dès la première génération.';
  } else if (requirements.needs_auth) {
    authBadge = provisioned ? dbBadge('success', 'Activée') : dbBadge('warning', 'Requise — à configurer');
    authMeta = provisioned ? 'Connexion / inscription gérées par Coden Cloud.' : 'Sera provisionnée lors de la mise en place du backend.';
  } else {
    authBadge = dbBadge('neutral', 'Non requise par l\'app');
    authMeta = 'Aucun besoin d\'authentification détecté dans ce projet.';
  }

  return `
    <section class="db-section">
      <div class="db-section-head">
        <span class="db-section-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg></span>
        <div class="db-section-head-text">
          <h2 class="db-section-title">Authentification & utilisateurs</h2>
          <p class="db-section-desc">Connexion, inscription et gestion des comptes de votre application.</p>
        </div>
      </div>
      <div class="db-section-body">
        <div class="db-grid">
          <div class="db-card">
            <span class="db-card-label">Authentification de l'app</span>
            <div class="db-card-value">${authBadge}</div>
            <div class="db-row-meta">${escapeHtml(authMeta)}</div>
          </div>
          <div class="db-card">
            <span class="db-card-label">Fournisseur</span>
            <div class="db-card-value">${requirements && requirements.needs_auth ? escapeHtml(dbProviderName(cloud.provider) + ' Auth') : '—'}</div>
            <div class="db-row-meta">Service role serveur uniquement — jamais exposé au client.</div>
          </div>
        </div>
        <div class="db-card">
          <span class="db-card-label">Utilisateurs finaux</span>
          <div id="db-endusers" class="db-endusers" data-state="loading">
            <div class="db-state">Chargement des utilisateurs…</div>
          </div>
        </div>
      </div>
    </section>`;
}

// Section 3 — Stockage de fichiers. Aucun backend d'upload/diffusion n'existe
// encore : état honnête, sans zone d'upload ni faux fichiers.
function renderDatabaseSection3(db: any): string {
  const requirements = (db.cloud && db.cloud.requirements) || null;
  const needsStorage = Boolean(requirements && requirements.needs_storage);
  const statusBadge = needsStorage ? dbBadge('warning', 'Configuration requise') : dbBadge('neutral', 'Bientôt disponible');
  const detail = needsStorage
    ? 'Votre application requiert du stockage : il sera provisionné lors de la mise en place du backend.'
    : 'Décrivez vos besoins de fichiers à Coden (ex. « permets l\'upload d\'avatars ») pour l\'activer.';

  // [STORAGE BACKEND ICI] — brancher l'upload / la liste des fichiers quand le
  // backend de stockage existera. Tant qu'il n'existe pas : aucune zone d'upload.
  return `
    <section class="db-section">
      <div class="db-section-head">
        <span class="db-section-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg></span>
        <div class="db-section-head-text">
          <h2 class="db-section-title">Stockage de fichiers</h2>
          <p class="db-section-desc">Upload, gestion et diffusion des fichiers et médias de votre application.</p>
        </div>
      </div>
      <div class="db-section-body">
        <div class="db-soon">
          <span class="db-soon-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><path d="M7 10l5-5 5 5"></path><path d="M12 5v12"></path></svg></span>
          <div class="db-soon-text">
            <p class="db-soon-title">Stockage managé bientôt disponible</p>
            <p class="db-soon-desc">L'upload, la gestion et la diffusion de médias ne sont pas encore activés. ${escapeHtml(detail)} Aucune zone d'upload n'est affichée tant que le backend n'existe pas.</p>
          </div>
          ${statusBadge}
        </div>
      </div>
    </section>`;
}

async function loadDatabase() {
  const target = document.getElementById('database-content');
  if (!target) return;
  if (!currentProjectId) {
    target.innerHTML = `<div class="db-state">Ouvrez ou créez un projet pour consulter l'état réel de son backend cloud.</div>`;
    return;
  }
  target.innerHTML = `<div class="db-state">Chargement de l'état du backend…</div>`;
  try {
    const payload = await apiFetch<any>(`/api/projects/${encodeURIComponent(currentProjectId)}/database`);
    const db = payload.database || {};
    target.innerHTML = renderDatabaseSection1(db) + renderDatabaseSection2(db) + renderDatabaseSection3(db);
    // Section 1's table browser is hydrated from the real DB (read-only, no fake data).
    void loadProjectDbBrowser();
    // Section 2's end-user console is hydrated from the project's real auth.
    void loadProjectEndUsers();
  } catch (error) {
    target.innerHTML = `<div class="db-state db-state-error">${escapeHtml(error instanceof Error ? error.message : 'Backend cloud indisponible pour le moment.')}</div>`;
  }
}

// ── Read-only table browser (sous-système 2) ─────────────────────────────────
// Sends ONLY structured params to the server (schema/table/page) — never SQL.
let dbBrowserSchemas: string[] = [];
let dbBrowserTables: Array<{ schema: string; name: string; type: string }> = [];
let dbBrowserCurrent: { schema: string; table: string } | null = null;
let dbBrowserOffset = 0;
const DB_BROWSER_PAGE = 50;

function formatDbCell(value: unknown): string {
  if (value === null || value === undefined) return '∅';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return text.length > 140 ? `${text.slice(0, 140)}…` : text;
}

async function loadProjectDbBrowser() {
  const host = document.getElementById('db-browser');
  if (!host) return;
  if (!currentProjectId) {
    host.innerHTML = `<div class="db-empty">Ouvrez un projet pour parcourir ses tables.</div>`;
    return;
  }
  host.innerHTML = `<div class="db-state">Chargement des tables…</div>`;
  try {
    const schemasResp = await apiFetch<any>(`/api/projects/${encodeURIComponent(currentProjectId)}/db/schemas`);
    if (schemasResp?.provisioning_required) {
      host.innerHTML = `<div class="db-note">${DB_ICON_INFO}<span>Le parcours des tables s'active une fois le backend du projet provisionné. Aucune donnée n'est simulée ici.</span></div>`;
      return;
    }
    dbBrowserSchemas = Array.isArray(schemasResp?.schemas) ? schemasResp.schemas : [];
    if (!dbBrowserSchemas.length) {
      host.innerHTML = `<div class="db-empty">Aucun schéma applicatif exposé.</div>`;
      return;
    }
    const schema = dbBrowserSchemas.includes('public') ? 'public' : dbBrowserSchemas[0];
    await loadDbBrowserTables(schema, host);
  } catch (error) {
    host.innerHTML = `<div class="db-state db-state-error">${escapeHtml(error instanceof Error ? error.message : 'Parcours des tables indisponible.')}</div>`;
  }
}

async function loadDbBrowserTables(schema: string, host: HTMLElement) {
  const tablesResp = await apiFetch<any>(`/api/projects/${encodeURIComponent(currentProjectId)}/db/tables?schema=${encodeURIComponent(schema)}`);
  dbBrowserTables = Array.isArray(tablesResp?.tables) ? tablesResp.tables : [];
  renderDbBrowserShell(host, schema);
}

function renderDbBrowserShell(host: HTMLElement, schema: string) {
  const schemaSelector = dbBrowserSchemas.length > 1
    ? `<select id="db-schema-select" class="db-select" aria-label="Schéma">${dbBrowserSchemas.map(s => `<option value="${escapeHtml(s)}"${s === schema ? ' selected' : ''}>${escapeHtml(s)}</option>`).join('')}</select>`
    : `<span class="db-row-meta">schéma « ${escapeHtml(schema)} »</span>`;
  const chips = dbBrowserTables.length
    ? dbBrowserTables.map(table => `<button type="button" class="db-table-chip" data-db-table="${escapeHtml(table.name)}">${escapeHtml(table.name)}${table.type === 'VIEW' ? ' <span class="db-row-meta">vue</span>' : ''}</button>`).join('')
    : `<div class="db-empty">Aucune table dans ce schéma.</div>`;
  host.innerHTML = `
    <div class="db-browser-top">${dbBadge('neutral', 'Lecture seule')}${schemaSelector}</div>
    <div class="db-table-chips">${chips}</div>
    <div id="db-browser-rows"></div>`;
  host.querySelector('#db-schema-select')?.addEventListener('change', async event => {
    const next = (event.target as HTMLSelectElement).value;
    dbBrowserCurrent = null;
    try {
      await loadDbBrowserTables(next, host);
    } catch (error) {
      host.innerHTML = `<div class="db-state db-state-error">${escapeHtml(error instanceof Error ? error.message : 'Lecture des tables indisponible.')}</div>`;
    }
  });
  host.querySelectorAll<HTMLButtonElement>('[data-db-table]').forEach(button => {
    button.addEventListener('click', () => openDbTable(schema, button.getAttribute('data-db-table') || ''));
  });
}

async function openDbTable(schema: string, table: string) {
  if (!table) return;
  dbBrowserCurrent = { schema, table };
  dbBrowserOffset = 0;
  await renderDbRows();
}

async function renderDbRows() {
  const area = document.getElementById('db-browser-rows');
  if (!area || !dbBrowserCurrent) return;
  document.querySelectorAll<HTMLButtonElement>('[data-db-table]').forEach(button => {
    button.classList.toggle('active', button.getAttribute('data-db-table') === dbBrowserCurrent!.table);
  });
  area.innerHTML = `<div class="db-state">Chargement des lignes…</div>`;
  try {
    const query = `schema=${encodeURIComponent(dbBrowserCurrent.schema)}&table=${encodeURIComponent(dbBrowserCurrent.table)}&limit=${DB_BROWSER_PAGE}&offset=${dbBrowserOffset}`;
    const data = await apiFetch<any>(`/api/projects/${encodeURIComponent(currentProjectId)}/db/rows?${query}`);
    const columns: string[] = Array.isArray(data?.columns) ? data.columns : [];
    const rows: any[] = Array.isArray(data?.rows) ? data.rows : [];
    const total: number | null = data?.pagination?.total ?? null;
    if (!columns.length) {
      area.innerHTML = `<div class="db-empty">Table introuvable.</div>`;
      return;
    }
    const header = columns.map(column => `<th>${escapeHtml(column)}</th>`).join('');
    const body = rows.length
      ? rows.map(row => `<tr>${columns.map(column => `<td>${escapeHtml(formatDbCell(row[column]))}</td>`).join('')}</tr>`).join('')
      : `<tr><td colspan="${columns.length}" class="db-empty">Aucune ligne.</td></tr>`;
    const from = rows.length ? dbBrowserOffset + 1 : 0;
    const to = dbBrowserOffset + rows.length;
    const atEnd = (total != null && to >= total) || rows.length < DB_BROWSER_PAGE;
    area.innerHTML = `
      <div class="db-table-scroll"><table class="db-data-table"><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table></div>
      <div class="db-pager">
        <span class="db-row-meta">${from}–${to}${total != null ? ` sur ${total}` : ''}</span>
        <span class="db-pager-btns">
          <button class="db-file-btn" type="button" id="db-prev"${dbBrowserOffset <= 0 ? ' disabled' : ''} aria-label="Page précédente">‹</button>
          <button class="db-file-btn" type="button" id="db-next"${atEnd ? ' disabled' : ''} aria-label="Page suivante">›</button>
        </span>
      </div>`;
    area.querySelector('#db-prev')?.addEventListener('click', () => {
      dbBrowserOffset = Math.max(0, dbBrowserOffset - DB_BROWSER_PAGE);
      void renderDbRows();
    });
    area.querySelector('#db-next')?.addEventListener('click', () => {
      dbBrowserOffset += DB_BROWSER_PAGE;
      void renderDbRows();
    });
  } catch (error) {
    area.innerHTML = `<div class="db-state db-state-error">${escapeHtml(error instanceof Error ? error.message : 'Lecture des lignes indisponible.')}</div>`;
  }
}

// ── End-user management (sous-système 3) ─────────────────────────────────────
// Calls the ownership-gated, server-side admin endpoints. Destructive actions
// have explicit, visible confirmations (delete = double confirmation).
let endUserRoles: string[] = ['user', 'member', 'editor', 'admin'];

function endUserMsg(message: string, isError: boolean) {
  const el = document.getElementById('db-enduser-msg');
  if (!el) return;
  el.className = `db-enduser-msg${isError ? ' db-state-error' : ' db-enduser-ok'}`;
  el.textContent = message;
  window.setTimeout(() => { if (el) el.textContent = ''; }, 6000);
}

async function loadProjectEndUsers() {
  const host = document.getElementById('db-endusers');
  if (!host) return;
  if (!currentProjectId) {
    host.innerHTML = `<div class="db-empty">Ouvrez un projet pour gérer ses utilisateurs.</div>`;
    return;
  }
  host.innerHTML = `<div class="db-state">Chargement des utilisateurs…</div>`;
  try {
    const data = await apiFetch<any>(`/api/projects/${encodeURIComponent(currentProjectId)}/users`);
    if (data?.auth_configured === false) {
      host.innerHTML = `<div class="db-note">${DB_ICON_INFO}<span>Authentification non configurée pour ce projet. Provisionnez le backend (auth) pour gérer les utilisateurs finaux. Aucune donnée n'est simulée ici.</span></div>`;
      return;
    }
    if (Array.isArray(data?.roles) && data.roles.length) endUserRoles = data.roles;
    renderEndUsers(host, data);
  } catch (error) {
    host.innerHTML = `<div class="db-state db-state-error">${escapeHtml(error instanceof Error ? error.message : 'Gestion des utilisateurs indisponible.')}</div>`;
  }
}

function renderEndUsers(host: HTMLElement, data: any) {
  const users: any[] = Array.isArray(data?.users) ? data.users : [];
  const roleOptions = endUserRoles.map(role => `<option value="${escapeHtml(role)}">${escapeHtml(role)}</option>`).join('');
  const createRow = `
    <div class="db-enduser-create">
      <input type="email" id="db-enduser-email" class="db-input" placeholder="email@exemple.com" autocomplete="off" />
      <select id="db-enduser-role" class="db-select" aria-label="Rôle">${roleOptions}</select>
      <button type="button" class="db-action db-action-primary" id="db-enduser-add">Inviter</button>
    </div>`;
  const list = users.length
    ? `<div class="db-card-list">${users.map(user => {
        const statusBadge = user.banned ? dbBadge('warning', 'banni') : (user.confirmed ? dbBadge('success', 'confirmé') : dbBadge('neutral', 'en attente'));
        return `
        <div class="db-row db-enduser-row" data-uid="${escapeHtml(user.id)}" data-email="${escapeHtml(user.email || '')}">
          <span class="db-row-key">${escapeHtml(user.email || '(sans email)')} ${statusBadge}${user.role ? ` <span class="db-row-meta">${escapeHtml(user.role)}</span>` : ''}</span>
          <span class="db-file-actions">
            <button class="db-eu-btn" type="button" data-eu-reset>Réinit. MDP</button>
            <button class="db-eu-btn" type="button" data-eu-ban data-banned="${user.banned ? '1' : '0'}">${user.banned ? 'Débannir' : 'Bannir'}</button>
            <button class="db-eu-btn db-eu-del" type="button" data-eu-del>Supprimer</button>
          </span>
        </div>`;
      }).join('')}</div>`
    : `<div class="db-empty">Aucun utilisateur final pour l'instant.</div>`;
  host.innerHTML = `${createRow}<div class="db-enduser-msg" id="db-enduser-msg"></div>${list}`;
  bindEndUserHandlers(host);
}

function bindEndUserHandlers(host: HTMLElement) {
  host.querySelector('#db-enduser-add')?.addEventListener('click', () => createEndUser(host));
  host.querySelectorAll<HTMLElement>('.db-enduser-row').forEach(row => {
    const uid = row.getAttribute('data-uid') || '';
    const email = row.getAttribute('data-email') || '';
    row.querySelector('[data-eu-reset]')?.addEventListener('click', () => resetEndUser(uid, email));
    const banBtn = row.querySelector('[data-eu-ban]') as HTMLButtonElement | null;
    banBtn?.addEventListener('click', () => banEndUser(uid, email, banBtn.getAttribute('data-banned') !== '1'));
    row.querySelector('[data-eu-del]')?.addEventListener('click', () => deleteEndUser(uid, email));
  });
}

async function createEndUser(host: HTMLElement) {
  const emailInput = host.querySelector('#db-enduser-email') as HTMLInputElement | null;
  const roleSelect = host.querySelector('#db-enduser-role') as HTMLSelectElement | null;
  const email = (emailInput?.value || '').trim();
  const role = roleSelect?.value || '';
  if (!email) { endUserMsg('Saisissez un email.', true); return; }
  try {
    await apiFetch(`/api/projects/${encodeURIComponent(currentProjectId)}/users`, {
      method: 'POST',
      body: JSON.stringify({ email, role, action: 'invite', confirm: true }),
    });
    await loadProjectEndUsers();
  } catch (error) {
    endUserMsg(error instanceof Error ? error.message : 'Invitation impossible.', true);
  }
}

async function resetEndUser(uid: string, email: string) {
  if (!uid) return;
  if (!window.confirm(`Envoyer une réinitialisation de mot de passe à ${email || 'cet utilisateur'} ?`)) return;
  try {
    await apiFetch(`/api/projects/${encodeURIComponent(currentProjectId)}/users/${encodeURIComponent(uid)}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ confirm: true }),
    });
    endUserMsg('Réinitialisation déclenchée.', false);
  } catch (error) {
    endUserMsg(error instanceof Error ? error.message : 'Réinitialisation impossible.', true);
  }
}

async function banEndUser(uid: string, email: string, ban: boolean) {
  if (!uid) return;
  if (!window.confirm(`${ban ? 'Bannir' : 'Débannir'} ${email || 'cet utilisateur'} ?`)) return;
  try {
    await apiFetch(`/api/projects/${encodeURIComponent(currentProjectId)}/users/${encodeURIComponent(uid)}/ban`, {
      method: 'POST',
      body: JSON.stringify({ banned: ban, confirm: true }),
    });
    await loadProjectEndUsers();
  } catch (error) {
    endUserMsg(error instanceof Error ? error.message : 'Action impossible.', true);
  }
}

async function deleteEndUser(uid: string, email: string) {
  if (!uid) return;
  // Double confirmation, visible and explicit (mirrors the server-side guard).
  if (!window.confirm(`Supprimer définitivement ${email || 'cet utilisateur'} ? Cette action est irréversible.`)) return;
  const echoed = window.prompt(`Double confirmation : retapez l'email exact « ${email} » pour confirmer la suppression.`);
  if (echoed == null) return;
  try {
    await apiFetch(`/api/projects/${encodeURIComponent(currentProjectId)}/users/${encodeURIComponent(uid)}`, {
      method: 'DELETE',
      body: JSON.stringify({ confirm: true, confirm_email: echoed.trim() }),
    });
    await loadProjectEndUsers();
  } catch (error) {
    endUserMsg(error instanceof Error ? error.message : 'Suppression impossible.', true);
  }
}

function stopAnalysisPolling() {
  if (analysisPollTimer !== null) {
    window.clearInterval(analysisPollTimer);
    analysisPollTimer = null;
  }
}

function startAnalysisPolling() {
  stopAnalysisPolling();
  analysisPollTimer = window.setInterval(() => {
    if (document.getElementById('tab-btn-analysis')?.classList.contains('active')) {
      void loadAnalysis(true);
    }
  }, 30000);
}

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: value >= 10 ? 0 : 2 }).format(value || 0);
}

function formatDuration(seconds: number) {
  const safeSeconds = Math.max(0, Math.round(seconds || 0));
  const minutes = Math.floor(safeSeconds / 60);
  const remaining = safeSeconds % 60;
  if (minutes <= 0) return `${remaining}s`;
  if (minutes < 60) return `${minutes}m ${remaining}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function countryFlag(code: string) {
  const normalized = (code || '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized) || normalized === 'UN') return '';
  return normalized
    .split('')
    .map(char => String.fromCodePoint(127397 + char.charCodeAt(0)))
    .join('');
}

function renderAnalysisChart(points: AnalysisPayload['timeseries']) {
  const data = points.length ? points : [
    { time: '00:00', visitors: 0, pageviews: 0 },
    { time: '03:00', visitors: 0, pageviews: 0 },
    { time: '06:00', visitors: 0, pageviews: 0 },
    { time: '09:00', visitors: 0, pageviews: 0 },
    { time: '12:00', visitors: 0, pageviews: 0 },
  ];
  const width = 1000;
  const height = 260;
  const padX = 54;
  const padTop = 22;
  const padBottom = 36;
  const chartHeight = height - padTop - padBottom;
  const maxValue = Math.max(1, ...data.map(point => point.visitors));
  const stepX = data.length > 1 ? (width - padX * 2) / (data.length - 1) : 0;
  const coords = data.map((point, index) => {
    const x = padX + index * stepX;
    const y = padTop + chartHeight - (point.visitors / maxValue) * chartHeight;
    return { x, y, point };
  });
  const linePath = coords.map((coord, index) => `${index === 0 ? 'M' : 'L'} ${coord.x.toFixed(2)} ${coord.y.toFixed(2)}`).join(' ');
  const areaPath = `${linePath} L ${coords[coords.length - 1]?.x || padX} ${height - padBottom} L ${coords[0]?.x || padX} ${height - padBottom} Z`;
  const yTicks = maxValue <= 1 ? [0, 0.25, 0.5, 0.75, 1] : [0, 0.25, 0.5, 0.75, 1].map(item => Math.round(item * maxValue));
  const xLabelEvery = Math.max(1, Math.ceil(data.length / 5));
  return `
    <svg class="analysis-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Visitors over time">
      ${yTicks.map(tick => {
        const y = padTop + chartHeight - (tick / maxValue) * chartHeight;
        return `<line class="analysis-chart-grid" x1="${padX}" y1="${y}" x2="${width - padX}" y2="${y}"></line><text class="analysis-chart-label" x="10" y="${y + 4}">${tick}</text>`;
      }).join('')}
      <path class="analysis-chart-area" d="${areaPath}"></path>
      <path class="analysis-chart-line" d="${linePath}"></path>
      ${coords.map((coord, index) => index % xLabelEvery === 0 || index === coords.length - 1
        ? `<text class="analysis-chart-label" x="${coord.x}" y="${height - 8}" text-anchor="middle">${escapeHtml(coord.point.time)}</text>`
        : ''
      ).join('')}
    </svg>
  `;
}

function renderAnalysisBreakdown(
  title: string,
  rows: Array<{ label: string; visitors: number; suffix?: string }>
) {
  const maxVisitors = Math.max(1, ...rows.map(row => row.visitors));
  return `
    <section class="analysis-breakdown-card">
      <div class="analysis-breakdown-head"><span>${escapeHtml(title)}</span><span>Visitors</span></div>
      ${rows.length ? rows.map(row => `
        <div class="analysis-row">
          <div class="analysis-row-track" style="--row-width:${Math.max(8, (row.visitors / maxVisitors) * 100)}%;">
            <span>${escapeHtml(row.label)}</span>
          </div>
          <strong>${formatCompactNumber(row.visitors)}${row.suffix || ''}</strong>
        </div>
      `).join('') : '<p style="margin:0;color:var(--text-muted);font-size:12px;">No data yet</p>'}
    </section>
  `;
}

function renderSeoAudit(seo?: AnalysisPayload['seo']) {
  if (!seo) {
    return `
      <section class="analysis-seo-card">
        <div>
          <span class="analysis-seo-kicker">SEO readiness</span>
          <h3>SEO audit unavailable</h3>
          <p>No generated project files were available for an SEO review yet.</p>
        </div>
      </section>
    `;
  }

  const checks = (seo.checks || []).slice(0, 8);
  const recommendations = (seo.recommendations || []).slice(0, 3);
  return `
    <section class="analysis-seo-card">
      <div class="analysis-seo-summary">
        <div class="analysis-seo-score" aria-label="SEO score">${Math.max(0, Math.min(100, Math.round(seo.score || 0)))}</div>
        <div>
          <span class="analysis-seo-kicker">SEO & AI-search readiness</span>
          <h3>${seo.score >= 90 ? 'Search foundation looks strong' : 'SEO fixes are available'}</h3>
          <p>${seo.preview?.title ? escapeHtml(seo.preview.title) : 'Coden checks title, meta, H1, Open Graph, structured data, alt text, sitemap and robots.'}</p>
        </div>
        <button class="analysis-seo-action" id="btn-fix-seo" type="button">Fix SEO with AI</button>
      </div>
      <div class="analysis-seo-checks">
        ${checks.map(check => `
          <div class="analysis-seo-check is-${escapeHtml(check.status)}">
            <span>${escapeHtml(check.label)}</span>
            <strong>${escapeHtml(check.status)}</strong>
            <small>${escapeHtml(check.detail)}</small>
          </div>
        `).join('')}
      </div>
      ${recommendations.length ? `
        <div class="analysis-seo-recommendations">
          ${recommendations.map(item => `<span>${escapeHtml(item)}</span>`).join('')}
        </div>
      ` : ''}
    </section>
  `;
}

function renderAnalysis(payload: AnalysisPayload) {
  const target = document.getElementById('analysis-content');
  if (!target) return;
  const metrics = payload.metrics || {
    visitors: 0,
    pageviews: 0,
    views_per_visit: 0,
    visit_duration_seconds: 0,
    bounce_rate: 0,
  };
  const sourceRows = (payload.sources || []).map(row => ({ label: row.source || 'Direct', visitors: row.visitors }));
  const pageRows = (payload.pages || []).map(row => ({ label: row.page || '/', visitors: row.visitors }));
  const countryRows = (payload.countries || []).map(row => ({
    label: `${countryFlag(row.country_code)} ${row.country_name || row.country_code || 'Unknown'}`.trim(),
    visitors: row.visitors,
  }));
  const deviceRows = (payload.devices || []).map(row => ({
    label: row.device || 'Unknown',
    visitors: row.visitors,
    suffix: row.percentage ? ` · ${row.percentage}%` : '',
  }));

  target.innerHTML = `
    <div class="analysis-topbar">
      <div class="analysis-live-pill">
        <span class="analysis-live-dot"></span>
        <span>${formatCompactNumber(payload.current_visitors || 0)} current visitor${payload.current_visitors === 1 ? '' : 's'}</span>
      </div>
      <select id="analysis-range-select" class="analysis-range-select" aria-label="Analysis range">
        <option value="24h"${analysisRange === '24h' ? ' selected' : ''}>Last 24 hours</option>
        <option value="7d"${analysisRange === '7d' ? ' selected' : ''}>Last 7 days</option>
        <option value="30d"${analysisRange === '30d' ? ' selected' : ''}>Last 30 days</option>
        <option value="90d"${analysisRange === '90d' ? ' selected' : ''}>Last 90 days</option>
      </select>
    </div>
    <div class="analysis-metrics-grid">
      <section class="analysis-metric-card is-primary"><div class="analysis-metric-label">Visitors</div><div class="analysis-metric-value">${formatCompactNumber(metrics.visitors)}</div></section>
      <section class="analysis-metric-card"><div class="analysis-metric-label">Pageviews</div><div class="analysis-metric-value">${formatCompactNumber(metrics.pageviews)}</div></section>
      <section class="analysis-metric-card"><div class="analysis-metric-label">Views Per Visit</div><div class="analysis-metric-value">${formatCompactNumber(metrics.views_per_visit)}</div></section>
      <section class="analysis-metric-card"><div class="analysis-metric-label">Visit Duration</div><div class="analysis-metric-value">${formatDuration(metrics.visit_duration_seconds)}</div></section>
      <section class="analysis-metric-card"><div class="analysis-metric-label">Bounce Rate</div><div class="analysis-metric-value">${formatCompactNumber(metrics.bounce_rate)}%</div></section>
    </div>
    <section class="analysis-chart-card">
      ${renderAnalysisChart(payload.timeseries || [])}
    </section>
    ${renderSeoAudit(payload.seo)}
    <div class="analysis-breakdown-grid">
      ${renderAnalysisBreakdown('Source', sourceRows)}
      ${renderAnalysisBreakdown('Page', pageRows)}
      ${renderAnalysisBreakdown('Country', countryRows)}
      ${renderAnalysisBreakdown('Device', deviceRows)}
    </div>
  `;

  document.getElementById('analysis-range-select')?.addEventListener('change', event => {
    analysisRange = (event.target as HTMLSelectElement).value || '30d';
    void loadAnalysis();
  });
  document.getElementById('btn-fix-seo')?.addEventListener('click', () => {
    const input = document.getElementById('chat-textarea-box') as HTMLTextAreaElement | null;
    if (!input) return;
    input.value = 'Optimize this app for Google and AI search. Add strong title and meta descriptions, Open Graph tags, one clear H1, image alt text, structured data, sitemap.xml and robots.txt without changing the core product.';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
  });
}

async function loadAnalysis(silent = false) {
  const target = document.getElementById('analysis-content');
  if (!target) return;
  if (!currentProjectId) {
    target.innerHTML = '<div class="analysis-empty"><strong style="display:block;color:var(--text);font-size:14px;margin-bottom:6px;">No project selected</strong><span style="font-size:12px;">Open or create a project before viewing analysis.</span></div>';
    return;
  }
  if (!silent) {
    target.innerHTML = `
      <div class="analysis-topbar"><div class="analysis-skeleton" style="width:220px;min-height:36px;"></div><div class="analysis-skeleton" style="width:150px;min-height:36px;"></div></div>
      <div class="analysis-metrics-grid">${Array.from({ length: 5 }, () => '<div class="analysis-skeleton"></div>').join('')}</div>
      <div class="analysis-skeleton" style="min-height:310px;"></div>
    `;
  }
  try {
    const payload = await apiFetch<AnalysisPayload & { success: boolean }>(`/api/projects/${encodeURIComponent(currentProjectId)}/analysis?range=${encodeURIComponent(analysisRange)}`);
    renderAnalysis(payload);
  } catch (error) {
    target.innerHTML = `<div class="analysis-error"><strong style="display:block;color:var(--text);font-size:14px;margin-bottom:6px;">Analysis unavailable</strong><span style="font-size:12px;">${escapeHtml(error instanceof Error ? error.message : 'Unable to load project analysis.')}</span></div>`;
  }
}

function showClarificationBlock(payload: any, originalPrompt: string, requestedMode: ChatMode) {
  const host = ensureInlineBlockHost();
  const question = payload.question || 'What should Coden focus on first?';
  const isFrench = isLikelyFrenchText(`${originalPrompt} ${question}`);
  const choices: string[] = Array.isArray(payload.choices)
    ? payload.choices.filter((choice: unknown): choice is string => typeof choice === 'string' && choice.trim().length > 0).slice(0, 4)
    : [];
  const recommendation = payload.recommendation || choices[0] || '';
  const eyebrow = isFrench ? 'Un detail utile' : 'One useful detail';
  const placeholder = isFrench ? 'Ajoute la precision qui manque...' : 'Add the missing detail...';
  const recommendLabel = isFrench ? 'Utiliser la suggestion' : 'Use suggestion';
  const continueLabel = isFrench ? 'Envoyer la precision' : 'Send detail';
  host.innerHTML = `
    <div id="clarification-block" style="border:1px solid var(--border-focus, var(--border));background:var(--bg-surface);border-radius:13px;padding:12px;color:var(--text);box-shadow:0 18px 50px rgba(0,0,0,.16);">
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:8px;">
        <div>
          <div style="font-size:11px;color:var(--text-muted);font-weight:800;margin-bottom:4px;">${escapeHtml(eyebrow)}</div>
          <div style="font-size:13px;line-height:1.45;font-weight:650;">${escapeHtml(question)}</div>
        </div>
        <button type="button" data-action="dismiss" aria-label="Dismiss" style="border:0;background:transparent;color:var(--text-muted);cursor:pointer;font-size:18px;line-height:1;">&times;</button>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin:10px 0;">
        ${choices.map(choice => `<button type="button" data-choice="${escapeHtml(choice)}" style="border:1px solid var(--border);background:var(--bg-input);color:var(--text);border-radius:999px;padding:6px 9px;font-size:11px;font-weight:700;cursor:pointer;">${escapeHtml(choice)}</button>`).join('')}
      </div>
      <textarea data-free-answer placeholder="${escapeHtml(placeholder)}" style="width:100%;min-height:42px;max-height:90px;resize:vertical;border:1px solid var(--border);background:var(--bg-input);color:var(--text);border-radius:9px;padding:9px;font-size:12px;line-height:1.4;outline:none;"></textarea>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:9px;">
        ${recommendation ? `<button type="button" data-action="recommend" style="height:30px;border:1px solid var(--border);background:transparent;color:var(--text);border-radius:8px;padding:0 10px;font-size:11px;font-weight:750;cursor:pointer;">${escapeHtml(recommendLabel)}</button>` : ''}
        <button type="button" data-action="continue" style="height:30px;border:0;background:var(--text);color:var(--bg);border-radius:8px;padding:0 12px;font-size:11px;font-weight:850;cursor:pointer;">${escapeHtml(continueLabel)}</button>
      </div>
    </div>
  `;

  host.querySelectorAll('[data-choice]').forEach(button => {
    button.addEventListener('click', async () => {
      const selectedAnswer = (button as HTMLElement).dataset.choice || '';
      await resumeFromClarification(selectedAnswer, originalPrompt, requestedMode);
    });
  });
  host.querySelector('[data-action="dismiss"]')?.addEventListener('click', clearInlineBlocks);
  host.querySelector('[data-action="recommend"]')?.addEventListener('click', async () => {
    await resumeFromClarification(recommendation || choices[0] || 'Use the recommended product structure.', originalPrompt, requestedMode);
  });
  host.querySelector('[data-action="continue"]')?.addEventListener('click', async () => {
    const freeAnswer = (host.querySelector('[data-free-answer]') as HTMLTextAreaElement | null)?.value.trim() || '';
    await resumeFromClarification(freeAnswer || recommendation, originalPrompt, requestedMode);
  });
}

function showClarificationActions(card: HTMLElement | null, payload: any, originalPrompt: string, requestedMode: ChatMode) {
  if (!card) return false;
  clearInlineBlocks();
  const choices: string[] = Array.isArray(payload.choices)
    ? payload.choices.filter((choice: unknown): choice is string => typeof choice === 'string' && choice.trim().length > 0).slice(0, 4)
    : [];
  const recommendation = typeof payload.recommendation === 'string' ? payload.recommendation.trim() : '';
  const actions = choices.length ? choices : (recommendation ? [recommendation] : []);
  if (!actions.length) return false;

  actions.forEach(choice => {
    addInlineAction(card, choice, () => {
      void resumeFromClarification(choice, originalPrompt, requestedMode);
    });
  });

  return true;
}

async function resumeFromClarification(answer: string, originalPrompt: string, requestedMode: ChatMode) {
  const safeAnswer = redactSecrets(answer).trim();
  const safeOriginalPrompt = redactSecrets(originalPrompt).trim();
  if (!safeAnswer) return;
  clearInlineBlocks();
  const response = await apiFetch<{ prompt: string; requestedMode?: ChatMode }>(`/api/projects/${encodeURIComponent(currentProjectId)}/agent/answer`, {
    method: 'POST',
    body: JSON.stringify({ answer: safeAnswer, originalPrompt: safeOriginalPrompt, requestedMode, recommendation: safeAnswer }),
  });
  await generateFromPrompt(response.prompt || `${safeOriginalPrompt}\n\nClarification answer: ${safeAnswer}`, response.requestedMode || requestedMode, false, {}, safeAnswer);
}

function showCreditsModal() {
  showMiniModal('Upgrade required', `
    <p>Your current balance or plan does not support this action with the selected model.</p>
    <div class="coden-modal-actions">
      <button data-action="upgrade">Upgrade plan</button>
      <button data-action="topup">Buy credits</button>
      <button data-action="auto">Use Auto</button>
      <button data-action="cancel">Cancel</button>
    </div>
  `, (action) => {
    if (action === 'upgrade') ((document.getElementById('btn-upgrade') as HTMLElement | null) || document.querySelector<HTMLElement>('.btn-upgrade'))?.click();
    if (action === 'auto') {
      applySelectedModel('auto', { persist: true, saveWorkspace: true });
      const label = document.getElementById('current-model-label');
      if (label) label.textContent = 'Auto';
    }
  });
}

function showApiKeyModal(requirements: any[]) {
  const rows = requirements.length ? requirements : [{ service: 'Custom', variable: 'CUSTOM_API_KEY', description: 'Project API key' }];
  showMiniModal('Connect external API', `
    <p>Keys are stored server-side and masked in the Database tab.</p>
    ${rows.map((item, index) => `
      <label style="display:grid;gap:5px;margin:10px 0;font-size:11px;color:var(--text-muted);">
        ${escapeHtml(item.service)} &middot; ${escapeHtml(item.variable)}
        <input data-key-index="${index}" data-service="${escapeHtml(item.service)}" data-variable="${escapeHtml(item.variable)}" type="password" placeholder="${escapeHtml(item.variable)}" style="height:34px;border:1px solid var(--border);background:var(--bg-input);color:var(--text);border-radius:7px;padding:0 10px;">
      </label>
    `).join('')}
    <div class="coden-modal-actions">
      <button data-action="continue">Continue</button>
      <button data-action="skip">Skip for now</button>
    </div>
  `, async (action, root) => {
    if (action === 'skip') {
      await generateFromPrompt('Continue with safe placeholders', 'build', false, { skipExternalKeys: true });
      return;
    }
    if (action === 'continue') {
      const keys = Array.from(root.querySelectorAll('input')).map((input: any) => ({
        service: input.dataset.service,
        variable: input.dataset.variable,
        value: input.value,
      })).filter(item => item.value);
      await apiFetch(`/api/projects/${encodeURIComponent(currentProjectId)}/external-keys`, {
        method: 'POST',
        body: JSON.stringify({ keys }),
      });
      await loadDatabase();
      await generateFromPrompt('Continue build with configured API keys', 'build', false, { externalKeysConfirmed: true });
    }
  });
}

function showFixBugBox(errors: any[]) {
  const first = errors[0] || { message: 'Preview failed.' };
  showMiniModal('Fix bug', `
    <p>${escapeHtml(first.message || 'Preview failed.')}</p>
    <p style="color:var(--text-muted);">${escapeHtml(first.file || 'unknown file')}</p>
    <div class="coden-modal-actions">
      <button data-action="fix">Fix with AI</button>
      <button data-action="copy">Copy error</button>
      <button data-action="send">Send to chat</button>
    </div>
  `, async (action) => {
    if (action === 'copy') await navigator.clipboard?.writeText(first.message || 'Preview failed.');
    if (action === 'send') {
      const input = document.getElementById('chat-textarea-box') as HTMLTextAreaElement | null;
      if (input) input.value = `Fix this preview error: ${first.message}`;
    }
    if (action === 'fix') await generateFromPrompt(`Fix this preview error: ${first.message}`, 'build');
  });
}

function showMiniModal(title: string, html: string, onAction: (action: string, root: HTMLElement) => void | Promise<void>) {
  document.getElementById('coden-live-modal')?.remove();
  const root = document.createElement('div');
  root.id = 'coden-live-modal';
  root.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);display:grid;place-items:center;z-index:99999;padding:16px;';
  root.innerHTML = `
    <div style="width:min(420px,100%);border:1px solid var(--border);background:var(--bg-surface);color:var(--text);border-radius:14px;padding:18px;box-shadow:0 24px 80px rgba(0,0,0,.22);">
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:8px;">
        <h3 style="font-size:15px;margin:0;">${escapeHtml(title)}</h3>
        <button data-action="close" style="border:0;background:transparent;color:var(--text-muted);font-size:18px;cursor:pointer;">&times;</button>
      </div>
      <div style="font-size:12px;color:var(--text);line-height:1.5;">${html}</div>
    </div>
  `;
  root.querySelectorAll('button[data-action]').forEach(button => {
    button.addEventListener('click', async () => {
      const action = (button as HTMLElement).dataset.action || 'close';
      if (action !== 'close') await onAction(action, root);
      root.remove();
    });
  });
  document.body.appendChild(root);
}

function bindChat() {
  const input = document.getElementById('chat-textarea-box') as HTMLTextAreaElement | null;
  const oldSubmit = document.getElementById('chat-submit-btn') as HTMLButtonElement | null;
  if (!input || !oldSubmit) return;

  const submit = oldSubmit.cloneNode(true) as HTMLButtonElement;
  oldSubmit.replaceWith(submit);
  submit.style.pointerEvents = 'auto';
  submit.style.cursor = 'pointer';
  syncSubmitButtonState();

  input.addEventListener('input', () => {
    const repaired = repairTextEncoding(input.value);
    if (repaired !== input.value) {
      const start = input.selectionStart;
      const end = input.selectionEnd;
      input.value = repaired;
      input.setSelectionRange(Math.min(start, repaired.length), Math.min(end, repaired.length));
    }
  });

  const send = (mode: ChatMode) => {
    const value = repairTextEncoding(input.value).trim();
    if (!value) return;
    input.value = '';
    input.style.height = '48px';
    submit.classList.remove('active');
    syncSubmitButtonState();
    scheduleWorkspaceSave({ draft_prompt: '', selected_mode: mode }, true);
    if (isGenerating) {
      void sendActiveHarnessInstruction(value);
      return;
    }
    void generateFromPrompt(value, mode, false, { studioContext: studioPromptContextPayload() });
  };

  input.addEventListener('input', () => {
    autoResizeChatInput();
    syncSubmitButtonState();
    scheduleWorkspaceSave();
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      event.stopImmediatePropagation();
      send(selectedChatMode);
    }
  }, true);

  submit.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (isGenerating) {
      const value = repairTextEncoding(input.value).trim();
      if (value) send(selectedChatMode);
      else void cancelBuild();
      return;
    }
    send(selectedChatMode);
  }, true);

  const sharedModeMounted = document.getElementById('chat-mode-wrapper')?.dataset.codenAgentModeMounted === 'true';
  if (!sharedModeMounted) {
    document.getElementById('btn-chat-mode')?.addEventListener('click', (event) => {
      event.preventDefault();
      const menu = document.getElementById('chat-mode-menu');
      const button = document.getElementById('btn-chat-mode') as HTMLButtonElement | null;
      const nextOpen = menu?.style.display !== 'block';
      if (menu) menu.style.display = nextOpen ? 'block' : 'none';
      button?.setAttribute('aria-expanded', String(nextOpen));
    });

    document.querySelectorAll('[data-chat-mode]').forEach(option => {
      option.addEventListener('click', (event) => {
        event.preventDefault();
        setChatMode(normalizeAgentMode((option as HTMLElement).dataset.chatMode));
      });
    });
  }

  document.addEventListener('click', (event) => {
    const wrapper = document.getElementById('chat-mode-wrapper');
    if (wrapper && !wrapper.contains(event.target as Node)) {
      const menu = document.getElementById('chat-mode-menu');
      const button = document.getElementById('btn-chat-mode') as HTMLButtonElement | null;
      if (menu) menu.style.display = 'none';
      button?.setAttribute('aria-expanded', 'false');
    }
  });

  setChatMode(selectedChatMode);
  syncSubmitButtonState();
  refreshWorkshopInputContext();
}

function initStudioWorkshops() {
  loadActiveWorkshop();
  const chatTab = document.getElementById('btn-sidebar-chat');
  const studioTab = document.getElementById('btn-sidebar-studio');
  const studioWrapper = document.getElementById('pane-studio-wrapper');
  const studioMenu = document.getElementById('pane-studio-menu');

  chatTab?.addEventListener('click', () => {
    setActiveWorkshop('chat', { focusInput: true });
  });

  studioTab?.addEventListener('click', () => {
    refreshWorkshopInputContext();
  });

  studioMenu?.addEventListener('click', (event) => {
    const option = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-studio-panel]') : null;
    if (!option) return;
    const workshop = normalizeWorkshop(option.dataset.studioPanel);
    if (WORKSHOP_CONFIG[workshop]?.disabled) return;
    setActiveWorkshop(workshop, { focusInput: true });
    studioWrapper?.classList.remove('open');
    studioTab?.setAttribute('aria-expanded', 'false');
  });

  refreshWorkshopInputContext();
  syncWorkshopPreview();
}

function hydrateDashboardPrompt() {
  const input = document.getElementById('chat-textarea-box') as HTMLTextAreaElement | null;
  const submit = document.getElementById('chat-submit-btn') as HTMLButtonElement | null;
  const mode = getInitialDashboardMode();
  const prompt = getInitialDashboardPrompt();
  setChatMode(mode);
  if (!input || !prompt || input.value.trim()) return;
  if (!currentProjectId && currentProjectName === 'Projet sans titre') {
    setProjectNameDisplay(projectNameFromPrompt(prompt));
  }
  input.value = repairTextEncoding(prompt);
  input.style.height = `${Math.min(input.scrollHeight, 150)}px`;
  if (submit) syncSubmitButtonState();
}

function maybeStartInitialGeneration() {
  if (initialGenerationStarted || isGenerating) return;
  const handoff = getInitialBuilderHandoff();
  if (!handoff.shouldAutoRun) return;
  const prompt = repairTextEncoding(handoff.prompt).trim();
  if (!prompt) return;
  initialGenerationStarted = true;

  const input = document.getElementById('chat-textarea-box') as HTMLTextAreaElement | null;
  if (input && input.value.trim() === prompt) {
    input.value = '';
    input.style.height = '48px';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  scheduleWorkspaceSave({ draft_prompt: '', selected_mode: handoff.mode }, true);
  void generateFromPrompt(prompt, handoff.mode, false, {
    importContext: handoff.importContext,
    createFlowSource: handoff.source || new URLSearchParams(window.location.search).get('source') || 'builder',
    initialRun: true,
  });
}

function ensureResizableSidebar() {
  const body = document.querySelector('.workspace-body') as HTMLElement | null;
  const sidebar = document.querySelector('.sidebar-pane') as HTMLElement | null;
  if (!body || !sidebar || document.getElementById('coden-sidebar-resizer')) return;
  const savedWidth = Number(projectWorkspaceState?.sidebar_width || localStorage.getItem('coden-sidebar-width') || 380);
  const syncCompactClass = (width: number) => {
    body.classList.toggle('sidebar-compact', body.classList.contains('sidebar-collapsed') || width < 330);
  };
  const applyWidth = (width: number) => {
    if (window.matchMedia('(max-width: 760px)').matches) {
      body.style.gridTemplateColumns = '';
      body.style.removeProperty('--coden-sidebar-width');
      syncCompactClass(0);
      return;
    }
    const next = Math.min(520, Math.max(280, width));
    applySidebarWidthPreference(next);
    localStorage.setItem('coden-sidebar-width', String(next));
    syncCompactClass(next);
  };
  if (!body.classList.contains('sidebar-collapsed')) {
    applyWidth(savedWidth);
  }
  const handle = document.createElement('div');
  handle.id = 'coden-sidebar-resizer';
  handle.title = 'Resize chat panel';
  handle.style.cssText = 'position:absolute;top:0;bottom:0;left:calc(var(--coden-sidebar-width, 380px) - 4px);width:8px;cursor:col-resize;z-index:20;background:linear-gradient(90deg,transparent,rgba(9,9,11,.16),transparent);opacity:.45;touch-action:none;';
  body.style.position = 'relative';
  body.appendChild(handle);
  window.addEventListener('resize', () => {
    if (!body.classList.contains('sidebar-collapsed')) {
      applyWidth(Number(localStorage.getItem('coden-sidebar-width') || 380));
    }
  });
  handle.addEventListener('dblclick', () => applyWidth(380));
  handle.addEventListener('pointerdown', event => {
    if (window.matchMedia('(max-width: 760px)').matches) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebar.getBoundingClientRect().width;
    body.classList.add('is-resizing-sidebar');
    handle.setPointerCapture?.(event.pointerId);
    const move = (moveEvent: PointerEvent) => {
      const next = Math.min(520, Math.max(280, startWidth + moveEvent.clientX - startX));
      body.style.gridTemplateColumns = `${next}px minmax(0, 1fr)`;
      body.style.setProperty('--coden-sidebar-width', `${next}px`);
      handle.style.left = `${next - 4}px`;
      localStorage.setItem('coden-sidebar-width', String(Math.round(next)));
      syncCompactClass(next);
      scheduleWorkspaceSave({ sidebar_width: Math.round(next) });
    };
    const up = () => {
      body.classList.remove('is-resizing-sidebar');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
}

type MobileBuilderView = 'chat' | 'preview' | 'code' | 'design' | 'more';

function setMobileBuilderView(view: MobileBuilderView) {
  const body = document.querySelector('.workspace-body') as HTMLElement | null;
  if (!body) return;
  body.dataset.mobileView = view;
  document.querySelectorAll<HTMLButtonElement>('[data-mobile-builder-view]').forEach(button => {
    const active = button.dataset.mobileBuilderView === view;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });

  if (view === 'preview') {
    closeProjectMenu();
    activateBuilderView('preview');
    return;
  }
  if (view === 'code') {
    closeProjectMenu();
    activateBuilderView('code');
    return;
  }
  if (view === 'design') {
    closeProjectMenu();
    setActiveWorkshop('design', { focusInput: true });
    return;
  }
  if (view === 'more') {
    openProjectMenu();
    return;
  }
  closeProjectMenu();
  setActiveWorkshop('chat', { focusInput: true });
}

function bindMobileBuilderShell() {
  const body = document.querySelector('.workspace-body') as HTMLElement | null;
  if (body && !body.dataset.mobileView) body.dataset.mobileView = 'chat';
  document.querySelectorAll<HTMLButtonElement>('[data-mobile-builder-view]').forEach(button => {
    if (button.dataset.codenMobileBuilderBound === 'true') return;
    button.dataset.codenMobileBuilderBound = 'true';
    button.addEventListener('click', event => {
      event.preventDefault();
      setMobileBuilderView((button.dataset.mobileBuilderView || 'chat') as MobileBuilderView);
    });
  });
}

function isAnyBuilderOverlayOpen() {
  if (document.getElementById('project-menu-panel')?.classList.contains('open')) return true;
  if (document.getElementById('coden-publish-panel')) return true;
  if (document.getElementById('preview-device-toggle')?.classList.contains('open')) return true;
  if (document.getElementById('pane-studio-wrapper')?.classList.contains('open')) return true;
  if (document.getElementById('builder-more-wrapper')?.classList.contains('open')) return true;
  if (document.getElementById('coden-design-popover')) return true;
  if (document.getElementById('coden-media-popover')) return true;
  return false;
}

function bindGlobalKeyboardShortcuts() {
  document.addEventListener('keydown', (event) => {
    const meta = event.metaKey || event.ctrlKey;
    if (meta && (event.key === 'k' || event.key === 'K')) {
      event.preventDefault();
      (document.getElementById('chat-textarea-box') as HTMLTextAreaElement | null)?.focus();
      return;
    }
    if (meta && (event.key === 'b' || event.key === 'B')) {
      event.preventDefault();
      (document.querySelector('.collapse-sidebar-arrow') as HTMLElement | null)?.click();
      return;
    }
    if (event.key === 'Escape' && isGenerating && !isAnyBuilderOverlayOpen()) {
      event.preventDefault();
      void cancelBuild();
      return;
    }
    if (meta && event.shiftKey && (event.key === '1' || event.key === '2')) {
      event.preventDefault();
      activateBuilderView(event.key === '1' ? 'preview' : 'code');
      return;
    }
  });
}

function init() {
initCodenMotion();
initCodenNavigationTransitions();
  bindGlobalKeyboardShortcuts();
  void ensureSettingsPanelLazy();
  ensureConversationApi();
  bindSharedModelSelectionEvents();
  applySelectedModel(readStoredSelectedModel());
  normalizeAiChatInputs();
  ensureToolbar();
  void ensureModelSelector();
  ensurePlanBuildControls();
  normalizeAiChatInputs();
  ensureDatabaseView();
  ensureResizableSidebar();
  bindProjectMenu();
  bindConnectorsButton();
  syncBuilderPlanBadges(currentPlanKey);
  void loadProjectMenuCredits();
  bindPreviewDeviceToggle();
  bindPreviewThemeSync();
  bindMobileBuilderShell();
  initStudioWorkshops();
  initPromptInputActions({
    persistForBuilder: false,
    onFiles: uploadPromptAttachments,
    onAttachmentsChange: attachments => {
      activePromptAttachments = attachments;
    },
    onNotice: (message, kind) => appendMessage(kind === 'error' ? 'system' : 'system', message),
  });
  normalizeAiChatInputs();
  bindChat();
  hydrateDashboardPrompt();
  void loadProject().then(() => {
    applyInitialBuilderLayout();
    maybeStartInitialGeneration();
  });
}

window.addEventListener('coden:auth-ready', init);
if (document.documentElement.dataset.authReady === 'true') init();
