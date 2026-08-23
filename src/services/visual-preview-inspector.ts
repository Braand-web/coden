import type { AgentGeneratedFile, AgentVerificationCheck, AgentVerificationSeverity } from './agent-v2.ts';
import type { GeneratedAppType } from './design-generation-policy.ts';

export type VisualPreviewInspectionInput = {
  files: AgentGeneratedFile[];
  previewHtml?: string;
  platformType?: GeneratedAppType;
};

type VisualSignal = {
  html: string;
  source: string;
  text: string;
  elementCount: number;
  buttons: VisualControl[];
  links: VisualControl[];
  inputs: VisualControl[];
  forms: VisualControl[];
};

type VisualControl = {
  tag: 'button' | 'a' | 'input' | 'select' | 'textarea' | 'form';
  label: string;
  attrs: string;
  body: string;
  disabled: boolean;
  hasHandler: boolean;
  hasSafeDestination: boolean;
};

const INTERACTIVE_RE = /\b(onClick|onSubmit|onChange|addEventListener|useState|useReducer|aria-expanded|dialog|modal|set[A-Z][A-Za-z0-9_]*\()/;
const STATE_MUTATION_RE = /\b(useState|useReducer|set[A-Z][A-Za-z0-9_]*\(|localStorage\.setItem|sessionStorage\.setItem|dispatch\(|filter\(|sort\(|map\(|reduce\()/;
const EMPTY_VISUAL_RE = /\b(empty|no results|nothing yet|aucun|vide|start by|create your first|no items)\b/i;
const ERROR_VISUAL_RE = /\b(error|failed|invalid|required|try again|erreur|echec|echoue|obligatoire|reessayer)\b/i;
const SUCCESS_VISUAL_RE = /\b(success|saved|done|complete|created|updated|succes|enregistre|termine)\b/i;
const FILTER_RE = /\b(search|filter|sort|status|category|query|recherche|filtre|tri|statut|categorie)\b/i;
const MODAL_RE = /\b(modal|dialog|popover|sheet|drawer|confirm|confirmation|aria-modal)\b/i;
const MODAL_STATE_RE = /\b(isOpen|openModal|closeModal|setOpen|set[A-Za-z0-9_]*Open|onClose|onOpen|aria-expanded)\b/i;
const TAB_RE = /\b(tab|tabs|tablist|aria-selected|role=["']tab|segmented|activeTab)\b/i;
const TAB_STATE_RE = /\b(activeTab|setActiveTab|aria-selected|data-tab|role=["']tab|onClick)\b/i;
const RESPONSIVE_RE = /@media|clamp\(|minmax\(|auto-fit|auto-fill|container-type|max-width|min-width/;
const ACCESSIBLE_NAME_RE = /aria-label|aria-labelledby|<label|htmlFor=|alt=/i;
const DANGEROUS_DEAD_DESTINATION_RE = /href=["'](?:#|javascript:void\(0\)|)["']/i;
const EMPTY_HANDLER_RE = /\bonClick=\{\s*(?:\(\)\s*=>\s*)?\{\s*\}\s*\}|\bonSubmit=\{\s*(?:\(\)\s*=>\s*)?\{\s*\}\s*\}|\bonChange=\{\s*(?:\(\)\s*=>\s*)?\{\s*\}\s*\}/i;
const FORM_SUBMIT_RE = /\b(onSubmit|preventDefault\(|type=["']submit|formAction|action=)/i;
const FORM_FEEDBACK_RE = /\b(required|minLength|maxLength|pattern|aria-invalid|invalid|error|validation|validate|setError|success|saved|loading|disabled)\b/i;
const PRIMARY_ACTION_LABEL_RE = /\b(add|create|save|submit|send|delete|remove|filter|search|checkout|reserve|book|login|sign|upload|publish|edit|update|next|continue|generate|run|stop|cancel|confirm|ajouter|creer|enregistrer|supprimer|chercher|reserver|publier|modifier|continuer)\b/i;
const LIST_APP_RE = /\b(todo|task|crm|dashboard|marketplace|ecommerce|admin|analytics|table|list|catalog|inventory|reservation|booking|kanban)\b/i;

function stripTags(html: string) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildSignal(input: VisualPreviewInspectionInput): VisualSignal {
  const html = String(input.previewHtml || input.files.find(file => /(?:^|\/)index\.html$/i.test(file.path))?.content || '');
  const source = input.files.map(file => `${file.path}\n${file.content || ''}`).join('\n\n');
  const visibleText = stripTags(`${html}\n${source}`);
  const fullSource = `${html}\n\n${source}`;
  return {
    html,
    source: fullSource,
    text: visibleText,
    elementCount: (html.match(/<[a-z][\w:-]*(?:\s|>)/gi) || []).length,
    buttons: extractButtons(source),
    links: extractLinks(source),
    inputs: extractInputs(source),
    forms: extractForms(source),
  };
}

function extractButtons(source: string): VisualControl[] {
  const controls: VisualControl[] = [];
  const regex = /<button\b([^>]*)>([\s\S]*?)<\/button>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(source))) {
    const attrs = match[1] || '';
    const body = match[2] || '';
    const label = normalizeLabel(stripTags(body) || attrValue(attrs, 'aria-label') || attrValue(attrs, 'title') || 'button');
    const isSubmit = /\btype=["']submit["']/i.test(attrs);
    controls.push({
      tag: 'button',
      label,
      attrs,
      body,
      disabled: /\bdisabled\b|aria-disabled=["']true["']/i.test(attrs),
      hasHandler: /\bon(?:Click|PointerDown|MouseDown|KeyDown)=/i.test(attrs) || (isSubmit && FORM_SUBMIT_RE.test(source)),
      hasSafeDestination: false,
    });
  }
  return controls;
}

function extractLinks(source: string): VisualControl[] {
  const controls: VisualControl[] = [];
  const regex = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(source))) {
    const attrs = match[1] || '';
    const body = match[2] || '';
    const href = attrValue(attrs, 'href');
    const label = normalizeLabel(stripTags(body) || attrValue(attrs, 'aria-label') || href || 'link');
    controls.push({
      tag: 'a',
      label,
      attrs,
      body,
      disabled: /\bdisabled\b|aria-disabled=["']true["']/i.test(attrs),
      hasHandler: /\bonClick=/i.test(attrs),
      hasSafeDestination: Boolean(href && href !== '#' && !/^javascript:void\(0\)$/i.test(href)),
    });
  }
  return controls;
}

function extractInputs(source: string): VisualControl[] {
  const controls: VisualControl[] = [];
  const regex = /<(input|select|textarea)\b([^>]*)/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(source))) {
    const tag = (match[1] || 'input').toLowerCase() as VisualControl['tag'];
    const attrs = match[2] || '';
    const label = normalizeLabel(attrValue(attrs, 'aria-label') || attrValue(attrs, 'placeholder') || attrValue(attrs, 'name') || tag);
    controls.push({
      tag,
      label,
      attrs,
      body: '',
      disabled: /\bdisabled\b|aria-disabled=["']true["']/i.test(attrs),
      hasHandler: /\bon(?:Change|Input|KeyDown|Blur)=/i.test(attrs) || FORM_SUBMIT_RE.test(source),
      hasSafeDestination: false,
    });
  }
  return controls;
}

function extractForms(source: string): VisualControl[] {
  const controls: VisualControl[] = [];
  const regex = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(source))) {
    const attrs = match[1] || '';
    const body = match[2] || '';
    controls.push({
      tag: 'form',
      label: normalizeLabel(attrValue(attrs, 'aria-label') || stripTags(body).slice(0, 42) || 'form'),
      attrs,
      body,
      disabled: false,
      hasHandler: /\bonSubmit=|action=|preventDefault\(/i.test(`${attrs}\n${body}`),
      hasSafeDestination: false,
    });
  }
  return controls;
}

function attrValue(attrs: string, name: string) {
  const match = attrs.match(new RegExp(`${name}=["']([^"']+)["']`, 'i'));
  return match?.[1] || '';
}

function normalizeLabel(value: string) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64);
}

function result(
  key: string,
  passed: boolean,
  severity: AgentVerificationSeverity,
  passMessage: string,
  failMessage: string,
): AgentVerificationCheck {
  return {
    key,
    status: passed ? 'pass' : severity === 'high' ? 'fail' : 'warn',
    severity: passed ? 'info' : severity,
    message: passed ? passMessage : failMessage,
  };
}

function scoreCheck(key: string, checks: AgentVerificationCheck[], label: string): AgentVerificationCheck {
  const penalty = checks.reduce((total, check) => {
    if (check.status === 'pass') return total;
    const base = check.severity === 'high' ? 26 : check.severity === 'medium' ? 14 : 6;
    return total + (check.status === 'fail' ? base : Math.ceil(base / 2));
  }, 0);
  const score = Math.max(0, Math.min(100, 100 - penalty));
  return {
    key,
    status: score >= 78 ? 'pass' : score >= 62 ? 'warn' : 'fail',
    severity: score >= 62 ? 'low' : 'high',
    message: `${label}: ${score}/100.`,
  };
}

function formatControlList(controls: VisualControl[]) {
  return controls
    .slice(0, 5)
    .map(control => `${control.tag} "${control.label || 'unlabeled'}"`)
    .join(', ');
}

function findDeadControls(signal: VisualSignal) {
  const deadButtons = signal.buttons.filter(control => {
    if (control.disabled) return false;
    if (!PRIMARY_ACTION_LABEL_RE.test(control.label) && signal.buttons.length > 6) return false;
    return !control.hasHandler && !/\btype=["']submit["']/i.test(control.attrs);
  });
  const deadLinks = signal.links.filter(control => !control.disabled && !control.hasHandler && !control.hasSafeDestination);
  const deadInputs = signal.inputs.filter(control => !control.disabled && !control.hasHandler && !/\b(readOnly|readonly)\b/i.test(control.attrs));
  return [...deadButtons, ...deadLinks, ...deadInputs];
}

export function inspectVisualPreview(input: VisualPreviewInspectionInput): AgentVerificationCheck[] {
  const signal = buildSignal(input);
  const checks: AgentVerificationCheck[] = [];
  const platform = input.platformType || 'generic_web_app';
  const source = signal.source;
  const textLength = signal.text.length;
  const allControls = [...signal.buttons, ...signal.links, ...signal.inputs];
  const hasControls = allControls.length > 0;
  const appLikePlatforms: GeneratedAppType[] = [
    'saas_dashboard',
    'analytics_dashboard',
    'admin_panel',
    'marketplace',
    'ecommerce',
    'restaurant',
    'crm_erp',
    'mobile_first_app',
    'auth_flow',
    'ai_tool',
    'fintech_billing',
    'healthcare_education',
    'gaming_creative',
    'generic_web_app',
  ];
  const isAppLike = appLikePlatforms.includes(platform);
  const deadControls = findDeadControls(signal);
  const hasForms = signal.forms.length > 0 || signal.inputs.length > 0;
  const hasFormSubmit = signal.forms.some(form => form.hasHandler) || FORM_SUBMIT_RE.test(source);
  const hasFormFeedback = FORM_FEEDBACK_RE.test(source);
  const hasTabs = TAB_RE.test(source);
  const hasModal = MODAL_RE.test(source);
  const hasFilter = FILTER_RE.test(source);
  const hasPrimaryStateMutation = STATE_MUTATION_RE.test(source);

  checks.push(result(
    'visual_preview_has_content',
    textLength >= 80 || signal.elementCount >= 18,
    'high',
    'Preview has enough visible structure to inspect.',
    'Preview looks visually empty or too sparse.',
  ));

  checks.push(result(
    'visual_primary_controls',
    hasControls || !isAppLike,
    isAppLike ? 'high' : 'medium',
    `Visual agent found ${allControls.length} primary control${allControls.length === 1 ? '' : 's'} to inspect.`,
    'No primary controls were detected in the generated UI.',
  ));

  if (hasControls) {
    checks.push(result(
      'visual_controls_have_behavior',
      INTERACTIVE_RE.test(source),
      'high',
      'Visible controls appear connected to behavior or state.',
      'Visible controls do not appear connected to behavior.',
    ));

    checks.push(result(
      'visual_no_dead_primary_controls',
      deadControls.length === 0,
      isAppLike ? 'high' : 'medium',
      'Visual agent did not find dead primary controls.',
      `Visual agent found dead or inert controls: ${formatControlList(deadControls)}.`,
    ));

    checks.push(result(
      'visual_state_changes_after_actions',
      hasPrimaryStateMutation,
      isAppLike ? 'high' : 'medium',
      'Primary actions appear to mutate visible state or data.',
      'Primary actions need visible state changes after click, input, submit, or selection.',
    ));
  }

  if (hasForms) {
    checks.push(result(
      'visual_form_submit_feedback',
      hasFormSubmit && hasFormFeedback,
      ['auth_flow', 'restaurant', 'ecommerce', 'ai_tool'].includes(platform) ? 'high' : 'medium',
      'Forms appear to submit intentionally and show validation or feedback.',
      'Forms need submit handling plus visible validation, loading, error, or success feedback.',
    ));
  }

  checks.push(result(
    'visual_state_coverage',
    EMPTY_VISUAL_RE.test(source) && ERROR_VISUAL_RE.test(source) && SUCCESS_VISUAL_RE.test(source),
    'medium',
    'Empty, error, and success states are represented.',
    'Generated UI should include empty, error, and success states for the core flow.',
  ));

  if (LIST_APP_RE.test(source)) {
    checks.push(result(
      'visual_list_tools',
      FILTER_RE.test(source),
      'medium',
      'List/table UI includes search, filtering, sorting, or status controls.',
      'List/table UI needs visible search, filtering, sorting, or status controls.',
    ));
  }

  if (hasFilter) {
    checks.push(result(
      'visual_filter_controls_update_results',
      /\b(onChange|set[A-Z][A-Za-z0-9_]*\(|filter\(|sort\(|useMemo|query|status)\b/i.test(source),
      'medium',
      'Filter/search controls appear wired to update visible results.',
      'Filter/search controls need state and list update behavior.',
    ));
  }

  if (/(delete|remove|supprimer|effacer|danger|destructive)/i.test(source)) {
    checks.push(result(
      'visual_destructive_confirmation',
      MODAL_RE.test(source) || /\b(confirm\(|undo|annuler|cancel)\b/i.test(source),
      'high',
      'Destructive actions have confirmation or undo-safe feedback.',
      'Destructive actions need confirmation or undo-safe feedback.',
    ));
  }

  if (hasTabs) {
    checks.push(result(
      'visual_tabs_are_switchable',
      TAB_STATE_RE.test(source),
      'medium',
      'Tabs or segmented controls appear switchable.',
      'Tabs or segmented controls need active state and click behavior.',
    ));
  }

  if (hasModal) {
    checks.push(result(
      'visual_modal_can_open_and_close',
      MODAL_STATE_RE.test(source) && /\b(close|cancel|dismiss|onClose|set[A-Za-z0-9_]*Open\(|annuler)\b/i.test(source),
      'medium',
      'Modal, drawer, or popover has open and close behavior.',
      'Modal, drawer, or popover needs open and close state.',
    ));
  }

  checks.push(result(
    'visual_accessible_names',
    ACCESSIBLE_NAME_RE.test(source),
    'medium',
    'Interactive or media elements include accessible names.',
    'Add labels, aria-labels, or alt text for key controls and media.',
  ));

  checks.push(result(
    'visual_responsive_contract',
    RESPONSIVE_RE.test(source),
    'medium',
    'Responsive behavior is represented in CSS or layout code.',
    'Generated UI needs explicit responsive behavior.',
  ));

  if (/dashboard|settings|admin|crm|analytics|billing/i.test(source)) {
    checks.push(result(
      'visual_navigation_depth',
      TAB_RE.test(source) || /sidebar|nav|menu|breadcrumb/i.test(source),
      'medium',
      'Operational UI includes navigation depth.',
      'Operational UI should expose tabs, sidebar, menu, or navigation depth.',
    ));
  }

  checks.push(result(
    'visual_no_dead_destinations',
    !DANGEROUS_DEAD_DESTINATION_RE.test(source) && !EMPTY_HANDLER_RE.test(source),
    'high',
    'No empty handlers or dead destinations were detected.',
    'Generated UI contains empty handlers or dead href destinations.',
  ));

  checks.push(scoreCheck('visual_interaction_probe_score', checks, 'Visual interaction probe score'));
  return checks;
}
