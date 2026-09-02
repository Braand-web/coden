/**
 * A compact map of the project, sent with every request.
 *
 * Context selection scores files against the prompt and keeps whatever fits the
 * budget. That is the right way to choose *file contents*, but it means the
 * model's knowledge of the project changes shape from one message to the next:
 * ask about the header and the database schema falls out of context, so the
 * next answer can contradict the last one, or reinvent a route that already
 * exists.
 *
 * This is the part that should never fall out. It costs a few hundred tokens
 * and answers the questions that do not depend on which file the user is
 * talking about: what is this built on, what routes exist, what tables exist,
 * what configuration it needs, and what changed most recently.
 *
 * Everything here is read from the files themselves. Nothing is inferred from
 * the prompt, and nothing is invented — a project with no router simply has no
 * routes line.
 */

export type ArchitectureFile = {
  path: string;
  content: string;
  language?: string;
  updated_at?: string;
};

export type ProjectArchitecture = {
  framework: string | null;
  dependencies: string[];
  routes: string[];
  tables: string[];
  env: string[];
  recentFiles: string[];
  fileCount: number;
};

function readJson(files: ArchitectureFile[], path: string): any {
  const file = files.find(item => item.path === path);
  if (!file) return null;
  try { return JSON.parse(file.content); } catch { return null; }
}

/** What the app is built on, named by the dependency that decides it. */
function detectFramework(pkg: any, files: ArchitectureFile[]): string | null {
  const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
  const has = (name: string) => Object.prototype.hasOwnProperty.call(deps, name);
  if (has('@tanstack/react-start')) return 'TanStack Start (React, SSR)';
  if (has('next')) return 'Next.js';
  if (has('@tanstack/react-router')) return 'React + TanStack Router';
  if (has('react-router-dom')) return 'React + React Router';
  if (has('react') && has('vite')) return 'React + Vite';
  if (has('react')) return 'React';
  if (files.some(file => file.path === 'index.html')) return 'Static HTML';
  return null;
}

/** Routes, from the file-based router if there is one, else from the JSX. */
function detectRoutes(files: ArchitectureFile[]): string[] {
  const fileRoutes = files
    .filter(file => /^src\/routes\/.+\.(tsx|jsx)$/.test(file.path))
    .map(file => {
      const name = file.path.replace(/^src\/routes\//, '').replace(/\.(tsx|jsx)$/, '');
      if (name === '__root') return null;
      if (name === 'index') return '/';
      return `/${name.replace(/\/index$/, '').replace(/\$/g, ':')}`;
    })
    .filter((route): route is string => Boolean(route));
  if (fileRoutes.length) return Array.from(new Set(fileRoutes)).sort();

  const declared = new Set<string>();
  for (const file of files) {
    if (!/\.(tsx|jsx)$/.test(file.path)) continue;
    for (const match of file.content.matchAll(/<Route\s[^>]*path=["']([^"']+)["']/g)) declared.add(match[1]);
    for (const match of file.content.matchAll(/createFileRoute\(\s*['"]([^'"]+)['"]/g)) declared.add(match[1]);
  }
  return Array.from(declared).sort();
}

/** Tables, from whatever SQL the project carries. */
function detectTables(files: ArchitectureFile[]): string[] {
  const tables = new Set<string>();
  for (const file of files) {
    if (!file.path.endsWith('.sql')) continue;
    for (const match of file.content.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?["']?([a-z0-9_]+)["']?/gi)) {
      tables.add(match[1]);
    }
  }
  return Array.from(tables).sort();
}

/** Public configuration the app reads at runtime. */
function detectEnv(files: ArchitectureFile[]): string[] {
  const names = new Set<string>();
  for (const file of files) {
    if (!/\.(ts|tsx|js|jsx)$/.test(file.path)) continue;
    for (const match of file.content.matchAll(/import\.meta\.env\.([A-Z0-9_]+)/g)) names.add(match[1]);
    for (const match of file.content.matchAll(/process\.env\.([A-Z0-9_]+)/g)) names.add(match[1]);
  }
  return Array.from(names).sort();
}

/**
 * The files touched most recently.
 *
 * The context selector claimed to boost these — its comment says "boost
 * recently modified files" — but the code under it only measured file size.
 * The timestamps are on the records, so this reads them.
 */
function detectRecent(files: ArchitectureFile[], limit = 5): string[] {
  return files
    .filter(file => file.updated_at)
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
    .slice(0, limit)
    .map(file => file.path);
}

export function describeProjectArchitecture(files: ArchitectureFile[]): ProjectArchitecture {
  // Content is read with matchAll all over this module, so a row whose content
  // is null — which a partial database row is — threw before the model was even
  // called. Normalise once, here, rather than guard at eight call sites.
  const list = (Array.isArray(files) ? files : [])
    .filter(file => file && typeof file.path === 'string')
    .map(file => ({ ...file, content: typeof file.content === 'string' ? file.content : '' }));
  const pkg = readJson(list, 'package.json');
  const deps = Object.keys(pkg?.dependencies || {}).sort();
  return {
    framework: detectFramework(pkg, list),
    dependencies: deps,
    routes: detectRoutes(list),
    tables: detectTables(list),
    env: detectEnv(list),
    recentFiles: detectRecent(list),
    fileCount: list.length,
  };
}

/**
 * The architecture as a prompt block.
 *
 * Deliberately terse: this rides along with every request, so each line has to
 * earn its tokens. A section with nothing to say is omitted rather than
 * printed empty, because "Routes: none" reads as a fact about the app when it
 * is really a fact about our detection.
 */
export function renderProjectArchitecture(files: ArchitectureFile[]): string {
  let architecture: ProjectArchitecture;
  try {
    architecture = describeProjectArchitecture(files);
  } catch {
    // A map of the project is a convenience. It must never be the reason a
    // generation fails, so an unreadable project simply gets no map.
    return '';
  }
  if (!architecture.fileCount) return '';

  const lines: string[] = [`Project map (${architecture.fileCount} files):`];
  if (architecture.framework) lines.push(`- Stack: ${architecture.framework}`);
  if (architecture.dependencies.length) {
    lines.push(`- Dependencies: ${architecture.dependencies.slice(0, 14).join(', ')}${architecture.dependencies.length > 14 ? ', …' : ''}`);
  }
  if (architecture.routes.length) {
    lines.push(`- Routes: ${architecture.routes.slice(0, 12).join(', ')}${architecture.routes.length > 12 ? ', …' : ''}`);
  }
  if (architecture.tables.length) {
    lines.push(`- Tables: ${architecture.tables.slice(0, 12).join(', ')}${architecture.tables.length > 12 ? ', …' : ''}`);
  }
  if (architecture.env.length) {
    lines.push(`- Runtime config: ${architecture.env.slice(0, 10).join(', ')}${architecture.env.length > 10 ? ', …' : ''}`);
  }
  if (architecture.recentFiles.length) {
    lines.push(`- Last changed: ${architecture.recentFiles.join(', ')}`);
  }
  return lines.join('\n');
}
