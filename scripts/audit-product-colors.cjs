const fs = require('fs');
const path = require('path');

const root = process.cwd();
const sourceExtensions = new Set(['.css', '.html', '.ts', '.tsx', '.js', '.jsx']);
const ignoredDirectories = new Set(['.git', 'dist', 'node_modules']);
const excludedPathFragments = [
  'scripts/',
  'src/lib/prompts/',
  'src/services/',
  'server.ts',
];

const requiredTokenValues = [
  '#FFFFFF', '#F3F3F3', '#F8F8F8', '#E7E8E8',
  '#EDEDED', '#E2E2E2', '#DEDEDE',
  '#1A1C1F', '#232528', '#505153', '#6A6C6E', '#8E8F90',
  '#3A83F7', '#9DBBFF', '#00A240', '#E7F4E7', '#BA2623', '#FBE6E2',
  '#751ED9', '#BD5800', '#008809', '#25B4CA', '#ECAD29',
  '#111111', '#202020', '#1C1C1C', '#232323', '#2F2F2F', '#0E0E0E',
  '#313131', '#FCFCFC', '#D4D4D4', '#9F9F9F', '#2C5CA7', '#1A2B1B',
  '#E02E2A', '#381C17', '#B06DFF', '#FA994C', '#85DF7B', '#5E51FF',
];

const obsoleteVariables = [
  /var\(--bg(?:-|[),])/,
  /var\(--text(?:[),])/,
  /var\(--blue(?:-|[),])/,
  /var\(--horizon-/,
  /var\(--pricing-/,
  /var\(--dashboard-(?:text|muted|surface|raised|border|focus)/,
  /var\(--accent-(?:blue|dim|hover|active)/,
  /var\(--text-(?:sub|faint)/,
  /var\(--border-(?:light|mid|focus)/,
  /var\(--success-dim/,
  /var\(--(?:warning|error)(?:-|[),])/,
];

function listFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (ignoredDirectories.has(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(fullPath));
    } else if (sourceExtensions.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }
  return files;
}

function isProductSource(relativePath) {
  if (relativePath.startsWith('test-') || relativePath.includes('.test.')) return false;
  return !excludedPathFragments.some((fragment) => relativePath.includes(fragment));
}

function lineNumber(source, offset) {
  return source.slice(0, offset).split(/\r?\n/).length;
}

function addFailure(failures, file, source, offset, message) {
  const relativePath = path.relative(root, file).replace(/\\/g, '/');
  failures.push(relativePath + ':' + lineNumber(source, offset) + ' ' + message);
}

const tokenFile = path.join(root, 'src', 'styles', 'coden-tokens.css');
const tokenSource = fs.readFileSync(tokenFile, 'utf8');
const failures = [];

for (const requiredValue of requiredTokenValues) {
  if (!tokenSource.includes(requiredValue)) {
    failures.push('src/styles/coden-tokens.css missing required token value ' + requiredValue);
  }
}

for (const file of listFiles(root)) {
  const relativePath = path.relative(root, file).replace(/\\/g, '/');
  if (!isProductSource(relativePath) || file === tokenFile) continue;

  const source = fs.readFileSync(file, 'utf8');
  const colorLiteral = /(?<!&)#[0-9a-fA-F]{3,8}\b/g;
  let match;

  while ((match = colorLiteral.exec(source))) {
    const surrounding = source.slice(Math.max(0, match.index - 64), match.index + match[0].length + 64);
    const isThemeMeta = /<meta\s+name=["']theme-color["']\s+content=["']#FFFFFF["']\s*\/?>/i.test(surrounding);
    if (!isThemeMeta) {
      addFailure(failures, file, source, match.index, 'literal color ' + match[0] + ' must come from coden-tokens.css');
    }
  }

  const forbiddenFunction = /\b(?:rgb|rgba|hsl|hsla|oklch|oklab|linear-gradient|radial-gradient|conic-gradient)\s*\(/gi;
  while ((match = forbiddenFunction.exec(source))) {
    addFailure(failures, file, source, match.index, 'forbidden color or gradient function ' + match[0]);
  }

  for (const obsoleteVariable of obsoleteVariables) {
    const variableMatch = obsoleteVariable.exec(source);
    if (variableMatch) {
      addFailure(failures, file, source, variableMatch.index, 'obsolete palette variable ' + variableMatch[0]);
    }
  }
}

if (failures.length) {
  console.error('Product color audit failed:');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}

console.log('Product color audit passed.');
