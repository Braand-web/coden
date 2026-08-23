export type DesignWorkshopAction =
  | 'autopilot'
  | 'anti_ai'
  | 'premium'
  | 'mobile'
  | 'harmonize'
  | 'audit'
  | 'variants';

export type DesignWorkshopScope = 'focused' | 'element' | 'section' | 'page' | 'app';
export type DesignWorkshopTarget = 'auto' | 'desktop' | 'tablet' | 'mobile';
export type DesignWorkshopDirection =
  | 'auto'
  | 'soft_saas'
  | 'saas_premium'
  | 'enterprise_clean'
  | 'startup_yc'
  | 'minimal_luxury';
export type DesignWorkshopArtifact =
  | 'auto'
  | 'ui_screen'
  | 'landing_section'
  | 'prototype'
  | 'deck'
  | 'brand_kit'
  | 'design_audit';
export type DesignWorkshopHandoff = 'preview_first' | 'apply_to_app' | 'critique_only';

export type DesignWorkshopSettings = {
  action: DesignWorkshopAction;
  scope: DesignWorkshopScope;
  target: DesignWorkshopTarget;
  direction: DesignWorkshopDirection;
  artifact: DesignWorkshopArtifact;
  handoff: DesignWorkshopHandoff;
};

type WorkshopOption<T extends string> = { value: T; label: string; hint: string };

export const DESIGN_WORKSHOP_OPTIONS: {
  action: Array<WorkshopOption<DesignWorkshopAction>>;
  scope: Array<WorkshopOption<DesignWorkshopScope>>;
  target: Array<WorkshopOption<DesignWorkshopTarget>>;
  direction: Array<WorkshopOption<DesignWorkshopDirection>>;
  artifact: Array<WorkshopOption<DesignWorkshopArtifact>>;
  handoff: Array<WorkshopOption<DesignWorkshopHandoff>>;
} = {
  action: [
    { value: 'autopilot', label: 'Autopilot', hint: 'Best safe polish' },
    { value: 'anti_ai', label: 'Anti-AI fix', hint: 'Less generic' },
    { value: 'premium', label: 'Premium', hint: 'Stronger UI' },
    { value: 'mobile', label: 'Mobile', hint: 'Responsive pass' },
    { value: 'harmonize', label: 'Harmonize', hint: 'Tokens + consistency' },
    { value: 'audit', label: 'Audit', hint: 'Score first' },
    { value: 'variants', label: 'Variants', hint: 'Explore looks' },
  ],
  artifact: [
    { value: 'auto', label: 'Auto output', hint: 'Best format' },
    { value: 'ui_screen', label: 'UI screen', hint: 'Interface' },
    { value: 'landing_section', label: 'Landing', hint: 'Section' },
    { value: 'prototype', label: 'Prototype', hint: 'Clickable flow' },
    { value: 'deck', label: 'Deck', hint: 'Slides' },
    { value: 'brand_kit', label: 'Brand kit', hint: 'Tokens' },
    { value: 'design_audit', label: 'Audit', hint: 'Critique' },
  ],
  handoff: [
    { value: 'preview_first', label: 'Preview first', hint: 'Show option' },
    { value: 'apply_to_app', label: 'Apply', hint: 'Patch app' },
    { value: 'critique_only', label: 'Critique', hint: 'No files' },
  ],
  scope: [
    { value: 'focused', label: 'Focused', hint: 'Smallest safe scope' },
    { value: 'element', label: 'Element', hint: 'Selected thing' },
    { value: 'section', label: 'Section', hint: 'Current block' },
    { value: 'page', label: 'Page', hint: 'One page' },
    { value: 'app', label: 'Whole app', hint: 'Global design pass' },
  ],
  target: [
    { value: 'auto', label: 'Auto target', hint: 'Coden decides' },
    { value: 'desktop', label: 'Desktop', hint: 'Large screens' },
    { value: 'tablet', label: 'Tablet', hint: 'Mid screens' },
    { value: 'mobile', label: 'Mobile', hint: 'Small screens' },
  ],
  direction: [
    { value: 'auto', label: 'Auto style', hint: 'Project fit' },
    { value: 'soft_saas', label: 'Soft SaaS', hint: 'Calm + clear' },
    { value: 'saas_premium', label: 'SaaS premium', hint: 'Product-led' },
    { value: 'enterprise_clean', label: 'Enterprise', hint: 'Dense + calm' },
    { value: 'startup_yc', label: 'Startup YC', hint: 'Sharp + direct' },
    { value: 'minimal_luxury', label: 'Minimal luxury', hint: 'Quiet polish' },
  ],
};

export function designWorkshopOptionLabel<K extends keyof typeof DESIGN_WORKSHOP_OPTIONS>(
  key: K,
  value: string,
) {
  return DESIGN_WORKSHOP_OPTIONS[key].find(option => option.value === value)?.label || String(value);
}

export function normalizeDesignWorkshopSettings(value: any): DesignWorkshopSettings {
  const pick = <K extends keyof typeof DESIGN_WORKSHOP_OPTIONS>(key: K, fallback: DesignWorkshopSettings[K]) => {
    const allowed = DESIGN_WORKSHOP_OPTIONS[key].map(option => option.value);
    return allowed.includes(value?.[key]) ? value[key] : fallback;
  };

  return {
    action: pick('action', 'autopilot'),
    scope: pick('scope', 'focused'),
    target: pick('target', 'auto'),
    direction: pick('direction', 'auto'),
    artifact: pick('artifact', 'auto'),
    handoff: pick('handoff', 'preview_first'),
  };
}

export function designWorkshopSummary(settings: DesignWorkshopSettings) {
  return [
    designWorkshopOptionLabel('action', settings.action),
    designWorkshopOptionLabel('artifact', settings.artifact),
    designWorkshopOptionLabel('handoff', settings.handoff),
    designWorkshopOptionLabel('scope', settings.scope),
    designWorkshopOptionLabel('target', settings.target),
    designWorkshopOptionLabel('direction', settings.direction),
  ].join(' · ');
}

export function designWorkshopInstructionLines(settings: DesignWorkshopSettings) {
  const lines = [
    `- Current design settings: ${designWorkshopSummary(settings)}.`,
    '- Treat these controls as context, not as a command to rewrite the whole project.',
    '- Coden Design is a lightweight design studio: one assistant, one input, preview canvas, and clear handoff to the app.',
  ];

  if (settings.action === 'audit') {
    lines.push('- Start with a design audit and do not modify files unless the user asks to apply fixes.');
  }
  if (settings.action === 'anti_ai') {
    lines.push('- Prioritize removing generic AI patterns: vague hero, repeated cards, cliched gradients, fake metrics, weak CTA hierarchy.');
  }
  if (settings.action === 'mobile' || settings.target === 'mobile') {
    lines.push('- Prioritize mobile usability: readable text, tap targets, no horizontal overflow, compact navigation and clear CTA placement.');
  }
  if (settings.action === 'variants') {
    lines.push('- Provide or generate distinct visual directions; apply one only when the user asks to apply it.');
  }
  if (settings.scope === 'focused' || settings.scope === 'element') {
    lines.push('- Use the smallest safe patch. Do not redesign unrelated sections.');
  }
  if (settings.scope === 'app') {
    lines.push('- Keep behavior and data intact while harmonizing visual tokens, layout rhythm and component consistency across the app.');
  }
  if (settings.direction !== 'auto') {
    lines.push(`- Visual direction preference: ${designWorkshopOptionLabel('direction', settings.direction)}.`);
  }
  if (settings.artifact !== 'auto') {
    lines.push(`- Desired design artifact: ${designWorkshopOptionLabel('artifact', settings.artifact)}.`);
  }
  if (settings.handoff === 'preview_first') {
    lines.push('- Show the design as a lightweight preview artifact first. Do not apply it to project files unless the user asks to apply it.');
  }
  if (settings.handoff === 'apply_to_app') {
    lines.push('- Apply the chosen design direction to the current app with a focused, testable patch and preserve existing behavior.');
  }
  if (settings.handoff === 'critique_only') {
    lines.push('- Return a concise design critique and recommended changes only. Do not modify files.');
  }
  return lines;
}

export type DesignStudioBrief = {
  artifact_type: DesignWorkshopArtifact;
  output_surface: 'preview_canvas' | 'app_patch' | 'chat_critique';
  brand_kit: {
    extract: string[];
    preserve: string[];
  };
  design_critic: string[];
  interaction_requirements: string[];
  handoff: DesignWorkshopHandoff;
};

export function inferDesignArtifactType(prompt = '', settings: DesignWorkshopSettings): DesignWorkshopArtifact {
  if (settings.artifact !== 'auto') return settings.artifact;
  const text = String(prompt || '').toLowerCase();
  if (settings.action === 'audit' || /\b(audit|critique|review|score|analyse|analyze)\b/.test(text)) return 'design_audit';
  if (/\b(deck|slides?|presentation|pitch|one[- ]pager)\b/.test(text)) return 'deck';
  if (/\b(brand|branding|logo|colors?|colours?|font|typography|tokens?)\b/.test(text)) return 'brand_kit';
  if (/\b(prototype|flow|clickable|interaction|onboarding|wizard)\b/.test(text)) return 'prototype';
  if (/\b(hero|landing|section|pricing|footer|header)\b/.test(text)) return 'landing_section';
  return 'ui_screen';
}

export function buildDesignStudioBrief(input: {
  prompt?: string;
  settings?: Partial<DesignWorkshopSettings> | null;
}): DesignStudioBrief {
  const settings = normalizeDesignWorkshopSettings(input.settings || {});
  const artifact = inferDesignArtifactType(input.prompt || '', settings);
  const outputSurface =
    settings.handoff === 'apply_to_app'
      ? 'app_patch'
      : settings.handoff === 'critique_only' || artifact === 'design_audit'
        ? 'chat_critique'
        : 'preview_canvas';

  return {
    artifact_type: artifact,
    output_surface: outputSurface,
    brand_kit: {
      extract: ['colors', 'typography', 'spacing rhythm', 'radius scale', 'motion tone', 'voice'],
      preserve: ['existing logo', 'working flows', 'auth/data/billing behavior', 'published/live state'],
    },
    design_critic: [
      'hierarchy',
      'contrast',
      'spacing',
      'mobile fit',
      'component states',
      'brand consistency',
      'anti-generic AI patterns',
    ],
    interaction_requirements: [
      'hover/focus/active states',
      'responsive layout',
      'empty/loading/error states when relevant',
      'prefers-reduced-motion',
      'clear apply or next action',
    ],
    handoff: settings.handoff,
  };
}
