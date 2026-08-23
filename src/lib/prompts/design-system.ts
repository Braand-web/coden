export const CODEN_DESIGN_SYSTEM_TOKENS_VERSION = 'coden-design-system-tokens-v1';

export const CODEN_DESIGN_SYSTEM_TOKENS_PROMPT = [
  `Design system tokens contract version: ${CODEN_DESIGN_SYSTEM_TOKENS_VERSION}.`,
  'All color, gradient, shadow, radius, and typography values must be semantic design tokens defined in the project global CSS (index.css or styles.css) and themed through shadcn/ui component variants.',
  'Never hardcode Tailwind color utilities such as text-white, bg-black, text-slate-900, or arbitrary color literals like bg-[#123456] inside generated components; they bypass theming and break dark mode.',
  'Use HSL variables (e.g. --primary, --background, --foreground, --muted, --accent, --destructive) declared under :root and .dark, then reference them via Tailwind semantic classes (bg-primary, text-foreground, border-border).',
  'Reject generic AI aesthetics: default fonts (Inter, Poppins), purple/indigo gradients on white, interchangeable hero/nav/footer layouts. Commit to one distinctive visual direction per project unless the user asks otherwise.',
  'Every generated app must ship a coherent theme: tokens + shadcn variants + typography scale + spacing scale + motion tokens defined once and reused everywhere.',
].join('\n');
