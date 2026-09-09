/**
 * The free resources a generated application is allowed to reach for.
 *
 * The request behind this file is "search and integrate the best free
 * resources online — components, icons, fonts, animation, CSS frameworks —
 * without manual intervention at each step". There are two ways to answer it,
 * and only one of them works here.
 *
 * The first is live web search. `web-research-gateway.ts` already implements
 * it, and production has no `FIRECRAWL_API_KEY`, `TAVILY_API_KEY` or
 * `BRAVE_SEARCH_API_KEY` — `isConfigured()` is false, so every call would
 * return `skipped`. Even configured it would be the wrong instrument: a search
 * costs up to twelve seconds per query on the critical path of a build, and it
 * answers a question the model does not actually have. A frontier model knows
 * what Lucide, Framer Motion and Inter are. What it does not know is which of
 * them this sandbox can install, at which version, against React 18.
 *
 * So this is the second way: a small curated catalogue, pinned and verified,
 * that turns "find something good" into "install this". It is the same
 * reasoning as `starters.ts` pinning its own versions — a floating range means
 * the generated app that built today does not build next week, and the first
 * anyone hears of it is a user's broken preview.
 *
 * Deliberately short. A catalogue of thirty libraries is a catalogue the model
 * reads around, and every entry it picks unnecessarily is install time paid on
 * someone's build. One good answer per need, not a survey.
 *
 * Nothing here is pre-installed. The scaffold stays small on purpose; these
 * are offered, and the coder installs only what the application it is actually
 * writing turns out to need.
 */

export type ResourceCategory =
  | 'icons'
  | 'motion'
  | 'typography'
  | 'primitives'
  | 'data-viz'
  | 'forms'
  | 'dates'
  | 'styling';

export type DesignResource = {
  /** npm package name, exactly as `install_package` takes it. */
  package: string;
  /**
   * The version verified against the scaffold's React 18.3.1 — every entry's
   * peer range was checked, not assumed. Pinned for the same reason
   * `starters.ts` pins its own: a fixture does not drift.
   */
  version: string;
  category: ResourceCategory;
  /** The licence, so "free" is a fact on the record rather than a claim. */
  license: string;
  /** What it is for, and — as importantly — when not to reach for it. */
  useWhen: string;
};

/**
 * One answer per need.
 *
 * Two icon sets in one application is not twice the choice, it is a visual
 * identity that does not hold together — which is the thing the design policy
 * spends two thousand tokens trying to prevent.
 */
export const DESIGN_RESOURCES: readonly DesignResource[] = [
  {
    package: 'lucide-react',
    version: '1.43.0',
    category: 'icons',
    license: 'ISC',
    useWhen: 'Any icon at all. Import only the icons used; never inline hand-drawn SVG paths or emoji as interface icons.',
  },
  {
    package: 'framer-motion',
    version: '13.2.0',
    category: 'motion',
    license: 'MIT',
    useWhen: 'Entrance, layout and presence transitions that CSS cannot express — shared layout, exit animations, drag. A hover or focus transition is a CSS transition on the token duration; do not install a library for one.',
  },
  {
    package: '@fontsource-variable/inter',
    version: '5.3.0',
    category: 'typography',
    license: 'OFL-1.1',
    useWhen: 'Only if the app must render offline or the CDN is unavailable — the scaffold already loads Inter from Google Fonts in index.html. Add a second family, self-hosted or from Google Fonts, only for display headings with real character.',
  },
  /*
   * Radix ships one package per primitive, each on its own version line, so
   * the siblings are listed with their own numbers rather than left for the
   * model to guess from the dialog's. Unstyled by design: they supply the
   * behaviour a hand-rolled div silently omits — focus trapping, scroll lock,
   * escape handling, the ARIA wiring — and none of the appearance, which is
   * what keeps the token layer in charge of how things look.
   */
  {
    package: '@radix-ui/react-dialog',
    version: '1.1.23',
    category: 'primitives',
    license: 'MIT',
    useWhen: 'Modals, sheets and drawers. Siblings on their own versions: @radix-ui/react-dropdown-menu@2.1.24, @radix-ui/react-popover@1.1.23, @radix-ui/react-tabs@1.1.21, @radix-ui/react-tooltip@1.2.16. Install the ones actually used.',
  },
  {
    package: 'recharts',
    version: '3.10.1',
    category: 'data-viz',
    license: 'MIT',
    useWhen: 'A dashboard or report with real charts. Style it with the CSS custom properties from index.css so charts inherit the theme instead of introducing a second palette.',
  },
  {
    package: 'react-hook-form',
    version: '7.87.0',
    category: 'forms',
    license: 'MIT',
    useWhen: 'A form with more than three fields, or any form needing per-field validation and error states. Pair with zod for the schema.',
  },
  {
    package: 'zod',
    version: '4.6.1',
    category: 'forms',
    license: 'MIT',
    useWhen: 'Validating form input or an API payload shape. One schema, used for both the type and the runtime check.',
  },
  {
    package: 'date-fns',
    version: '4.4.0',
    category: 'dates',
    license: 'MIT',
    useWhen: 'Formatting or arithmetic on dates. Tree-shakeable, so import the individual functions.',
  },
  {
    package: 'clsx',
    version: '2.1.1',
    category: 'styling',
    license: 'MIT',
    useWhen: 'Conditional class names. With tailwind-merge (3.6.0, MIT) when a component takes a className override that must win over its own defaults.',
  },
];

/**
 * The catalogue as a prompt section.
 *
 * Written as instruction rather than inventory: a list of packages tells the
 * model what exists, and it will still hand-roll a modal. What changes
 * behaviour is naming the tool that installs them and the rule for choosing.
 */
export function describeDesignResources(): string {
  const byCategory = new Map<ResourceCategory, DesignResource[]>();
  for (const resource of DESIGN_RESOURCES) {
    if (!byCategory.has(resource.category)) byCategory.set(resource.category, []);
    byCategory.get(resource.category)!.push(resource);
  }

  const entries = [...byCategory.entries()].map(([category, resources]) =>
    [
      `${category}:`,
      ...resources.map(resource => `  - ${resource.package}@${resource.version} (${resource.license}) — ${resource.useWhen}`),
    ].join('\n'),
  );

  return [
    'PRE-APPROVED FREE RESOURCES.',
    'These are already vetted for licence and for compatibility with this project\'s React 18. Install one with the install_package tool the moment the application needs it — pinned to the version given, and without asking first. This is the research step, already done: do not go looking for alternatives, and do not hand-roll what is listed here.',
    '',
    ...entries,
    '',
    'Rules for using them:',
    '- Install only what the application you are actually writing uses. An unused dependency is install time paid on every build of this project.',
    '- One library per need. A second icon set or a second animation library is not more choice, it is an interface that does not look like one product.',
    '- Tailwind and the design tokens in src/index.css are already installed and are the default. Reach for a package when the tokens genuinely cannot express the thing, not before.',
    '- Never add a UI kit that ships its own theme (Bootstrap, Material UI, Chakra, Ant Design). They override the token layer and the result stops looking designed and starts looking defaulted.',
    '- Anything outside this list that the app genuinely needs — a specific SDK, a niche parser — is still fair game via install_package. This list is what design is settled on, not the limit of what may be installed.',
  ].join('\n');
}
