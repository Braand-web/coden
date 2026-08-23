/**
 * Design Token Store — Persistent design system tokens per project.
 *
 * Solves the "thème qui diverge entre sessions" problem by:
 * 1. Extracting design tokens from generated code (colors, fonts, radii, spacing)
 * 2. Persisting them to the project_memory table (type: 'design_token')
 * 3. Injecting them back into every subsequent generation to enforce visual consistency
 *
 * This ensures Coden doesn't reinvent the color palette on every build.
 */

export type DesignToken = {
  category: 'color' | 'font' | 'radius' | 'spacing' | 'shadow' | 'motion' | 'breakpoint' | 'other';
  name: string;      // e.g. '--color-primary', 'primary', 'blue-600'
  value: string;     // e.g. '#2563eb', 'Inter', '8px'
  source: 'css_var' | 'tailwind_class' | 'inline_style' | 'inferred';
  confidence: 'high' | 'medium' | 'low';
};

export type ProjectDesignSystem = {
  tokens: DesignToken[];
  framework: 'tailwind' | 'css_modules' | 'styled_components' | 'vanilla_css' | 'unknown';
  primaryColor?: string;
  fontFamily?: string;
  borderRadius?: string;
  generatedAt: string;
};

// ─── Extraction patterns ──────────────────────────────────────────────────────

const CSS_VAR_PATTERNS: Array<{ re: RegExp; category: DesignToken['category'] }> = [
  { re: /--color-([a-z0-9-]+)\s*:\s*([^;}\n]+)/gi, category: 'color' },
  { re: /--font-([a-z0-9-]+)\s*:\s*([^;}\n]+)/gi, category: 'font' },
  { re: /--radius-([a-z0-9-]+)\s*:\s*([^;}\n]+)/gi, category: 'radius' },
  { re: /--spacing-([a-z0-9-]+)\s*:\s*([^;}\n]+)/gi, category: 'spacing' },
  { re: /--shadow-([a-z0-9-]+)\s*:\s*([^;}\n]+)/gi, category: 'shadow' },
  { re: /--(?:bg|background|surface)-([a-z0-9-]+)\s*:\s*([^;}\n]+)/gi, category: 'color' },
  { re: /--(?:text|foreground)-([a-z0-9-]+)\s*:\s*([^;}\n]+)/gi, category: 'color' },
  { re: /--(?:border)-([a-z0-9-]+)\s*:\s*([^;}\n]+)/gi, category: 'color' },
  { re: /--accent-([a-z0-9-]+)\s*:\s*([^;}\n]+)/gi, category: 'color' },
  { re: /--duration-([a-z0-9-]+)\s*:\s*([^;}\n]+)/gi, category: 'motion' },
];

// Primary color extraction from Tailwind classes
const TAILWIND_PRIMARY_PATTERNS = [
  /\bbg-(blue|indigo|violet|purple|sky|teal|green|red|orange|yellow|pink|rose|emerald|cyan|slate|zinc)-([0-9]{3})\b/,
  /\btext-(blue|indigo|violet|purple|sky|teal|green|red|orange|yellow|pink|rose|emerald|cyan|slate|zinc)-([0-9]{3})\b/,
];

// Font extraction from CSS
const FONT_PATTERNS = [
  /font-family\s*:\s*['"]?([^'";,\n]+)['"]?/gi,
  /fontFamily.*?['"]([^'"]+)['"]/g,
  /import\s+\{\s*\w+\s*\}\s+from\s+['"]@fontsource\/([^'"]+)['"]/g,
];

/**
 * Extracts design tokens from a set of generated files.
 */
export function extractDesignTokens(
  files: Array<{ path: string; content: string }>,
): ProjectDesignSystem {
  const tokens: DesignToken[] = [];
  const seen = new Set<string>();

  // Determine framework
  const allContent = files.map(f => f.content || '').join('\n');
  const framework: ProjectDesignSystem['framework'] =
    /tailwind/i.test(allContent) ? 'tailwind' :
    /styled-components|createGlobalStyle/i.test(allContent) ? 'styled_components' :
    /\.module\.css/i.test(allContent) ? 'css_modules' : 'vanilla_css';

  for (const file of files) {
    const content = String(file.content || '');
    if (!content) continue;

    // Extract CSS custom properties
    if (/\.(css|tsx?|jsx?)$/.test(file.path)) {
      for (const { re, category } of CSS_VAR_PATTERNS) {
        re.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = re.exec(content)) !== null) {
          const name = `--${category === 'color' ? 'color' : category}-${match[1].trim()}`;
          const value = match[2].trim().slice(0, 60);
          const key = `${name}:${value}`;
          if (!seen.has(key) && value.length > 0) {
            seen.add(key);
            tokens.push({ category, name, value, source: 'css_var', confidence: 'high' });
          }
        }
      }
    }

    // Extract font families
    for (const re of FONT_PATTERNS) {
      re.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = re.exec(content)) !== null) {
        const fontName = match[1].trim().split(',')[0].trim().replace(/['"]/g, '');
        if (fontName && fontName.length > 1 && fontName.length < 50) {
          const key = `font:${fontName}`;
          if (!seen.has(key)) {
            seen.add(key);
            tokens.push({ category: 'font', name: 'font-family', value: fontName, source: 'css_var', confidence: 'medium' });
          }
        }
      }
    }
  }

  // Infer primary color from Tailwind classes
  let primaryColor: string | undefined;
  for (const pattern of TAILWIND_PRIMARY_PATTERNS) {
    const match = allContent.match(pattern);
    if (match) {
      primaryColor = match[0].replace(/^(?:bg|text)-/, '');
      const key = `primary:${primaryColor}`;
      if (!seen.has(key)) {
        seen.add(key);
        tokens.push({ category: 'color', name: 'primary', value: primaryColor, source: 'tailwind_class', confidence: 'medium' });
      }
      break;
    }
  }

  // Infer border radius from inline classes
  const radiusMatch = allContent.match(/\brounded-((?:none|sm|md|lg|xl|2xl|3xl|full|\d+))\b/);
  if (radiusMatch) {
    const key = `radius:${radiusMatch[1]}`;
    if (!seen.has(key)) {
      seen.add(key);
      tokens.push({ category: 'radius', name: 'default-radius', value: `rounded-${radiusMatch[1]}`, source: 'tailwind_class', confidence: 'low' });
    }
  }

  // Extract font from first fontFamily token
  const fontToken = tokens.find(t => t.category === 'font');

  return {
    tokens: tokens.slice(0, 40), // cap to avoid token bloat
    framework,
    primaryColor,
    fontFamily: fontToken?.value,
    borderRadius: radiusMatch?.[1],
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Serializes a design system into a compact prompt injection string.
 * This is injected before every generation to enforce visual consistency.
 */
export function buildDesignTokenContext(system: ProjectDesignSystem | null): string {
  if (!system || system.tokens.length === 0) return '';

  const lines: string[] = [
    '[ESTABLISHED DESIGN SYSTEM — STRICTLY FOLLOW]',
    `Framework: ${system.framework}`,
  ];

  if (system.primaryColor) lines.push(`Primary color: ${system.primaryColor}`);
  if (system.fontFamily) lines.push(`Font family: ${system.fontFamily}`);
  if (system.borderRadius) lines.push(`Border radius: rounded-${system.borderRadius}`);

  // Group tokens by category
  const byCategory = new Map<DesignToken['category'], DesignToken[]>();
  for (const token of system.tokens) {
    if (!byCategory.has(token.category)) byCategory.set(token.category, []);
    byCategory.get(token.category)!.push(token);
  }

  for (const [category, catTokens] of byCategory.entries()) {
    const highConf = catTokens.filter(t => t.confidence !== 'low').slice(0, 8);
    if (highConf.length === 0) continue;
    lines.push(`${category}: ${highConf.map(t => `${t.name}=${t.value}`).join(', ')}`);
  }

  lines.push('Rule: Use ONLY these established values. Do not introduce new color palettes, fonts, or radii unless the user explicitly requests a design change.');

  return `\n${lines.join('\n')}\n`;
}

/**
 * Converts design tokens to project_memory rows for Supabase persistence.
 */
export function designSystemToMemoryRows(
  system: ProjectDesignSystem,
  projectId: string,
): Array<{ project_id: string; memory_type: string; content: string }> {
  if (system.tokens.length === 0) return [];
  return [{
    project_id: projectId,
    memory_type: 'design_token',
    content: JSON.stringify(system),
  }];
}

/**
 * Loads a ProjectDesignSystem from a project_memory row.
 */
export function designSystemFromMemoryRow(content: string): ProjectDesignSystem | null {
  try {
    const parsed = JSON.parse(content);
    if (parsed?.tokens && Array.isArray(parsed.tokens)) return parsed as ProjectDesignSystem;
    return null;
  } catch {
    return null;
  }
}
