export type DependencyNode = {
  path: string;
  imports: string[];
  exportedSymbols: string[];
};

export type DependencyGraph = Map<string, DependencyNode>;

/**
 * A lightweight regex-based AST parser equivalent to track dependencies
 * and prevent "Cannot read properties of undefined" or missing imports.
 */
export function buildDependencyGraph(files: Array<{ path: string; content?: string }>): DependencyGraph {
  const graph: DependencyGraph = new Map();

  for (const file of files) {
    if (!/\.(tsx?|jsx?)$/.test(file.path)) continue;
    
    const content = file.content || '';
    const imports: string[] = [];
    const exportedSymbols: string[] = [];

    // Extract imports: import { X, Y } from './path' or import Z from './path'
    const importRegex = /import\s+[^'"]+['"]([^'"]+)['"]/g;
    let match;
    while ((match = importRegex.exec(content)) !== null) {
      imports.push(match[1]);
    }

    // Extract exports: export const X = ... or export function Y() ...
    const exportRegex = /export\s+(?:const|let|var|function|class|type|interface)\s+([a-zA-Z0-9_]+)/g;
    while ((match = exportRegex.exec(content)) !== null) {
      exportedSymbols.push(match[1]);
    }

    graph.set(file.path, {
      path: file.path,
      imports,
      exportedSymbols,
    });
  }

  return graph;
}

/**
 * Given a list of modified files, returns all files that depend on them
 * so the AI knows to update them as well.
 */
export function findDependents(modifiedFilePaths: string[], graph: DependencyGraph): string[] {
  const dependents = new Set<string>();

  for (const [filePath, node] of graph.entries()) {
    for (const modified of modifiedFilePaths) {
      // Very basic relative path resolution match
      const basename = modified.split('/').pop()?.replace(/\.[tj]sx?$/, '') || '';
      if (basename && node.imports.some(imp => imp.includes(basename))) {
        dependents.add(filePath);
      }
    }
  }

  return Array.from(dependents);
}
