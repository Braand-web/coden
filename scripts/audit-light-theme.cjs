const fs = require('fs');
const path = require('path');

const root = process.cwd();
const includeExt = new Set(['.css', '.html', '.ts', '.tsx', '.js', '.jsx']);
const ignoreDirs = new Set(['node_modules', 'dist', '.git']);

const bannedExact = [
  '#F8F5F0',
  '#fffaf3',
  '#f7f4ef',
  '#18130d',
  '#FAFAF9',
  '#a1a1aa',
  '#A1A1AA',
  '#d4d4d8',
  '#D4D4D8',
  '#e4e4e7',
  '#E4E4E7',
];

const allowedLightExact = new Set(['#d4d4d8', '#D4D4D8', '#e4e4e7', '#E4E4E7']);
const bannedWords = /\b(beige|cream|sand)\b/i;
const weakWhiteBorder = /rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*(?:0?\.)0[0-9]/i;

function listFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignoreDirs.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFiles(full));
    } else if (includeExt.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

function lineInDarkBlock(lines, index) {
  let depth = 0;
  for (let i = index; i >= 0; i -= 1) {
    const line = lines[i];
    depth += (line.match(/}/g) || []).length;
    depth -= (line.match(/{/g) || []).length;
    if (line.includes('[data-theme="dark"]') || line.includes(":root[data-theme='dark']")) {
      return depth <= 0 || i === index;
    }
    if (line.includes('[data-theme="light"]') || line.includes(":root[data-theme='light']")) {
      return false;
    }
  }
  return false;
}

function lineInLightBlock(lines, index) {
  let depth = 0;
  for (let i = index; i >= 0; i -= 1) {
    const line = lines[i];
    depth += (line.match(/}/g) || []).length;
    depth -= (line.match(/{/g) || []).length;
    if (line.includes('[data-theme="light"]') || line.includes(":root[data-theme='light']")) {
      return depth <= 0 || i === index;
    }
    if (line.includes('[data-theme="dark"]') || line.includes(":root[data-theme='dark']")) {
      return false;
    }
  }
  return false;
}

const failures = [];

for (const file of listFiles(root)) {
  const rel = path.relative(root, file).replace(/\\/g, '/');
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);

  lines.forEach((line, index) => {
    const hasBannedExact = bannedExact.some(color => line.includes(color));
    const hasRelevantToken =
      hasBannedExact ||
      bannedWords.test(line) ||
      weakWhiteBorder.test(line) ||
      /data-theme=["']dark["']/.test(line);
    if (!hasRelevantToken) return;

    const darkScoped = lineInDarkBlock(lines, index);
    const lightScoped = lineInLightBlock(lines, index);
    const trimmed = line.trim();

    if (/data-theme=["']dark["']/.test(line) && /\.(html|tsx?|jsx?)$/.test(rel) && !trimmed.includes('[data-theme="dark"]')) {
      failures.push(`${rel}:${index + 1} default dark theme attribute is not allowed`);
    }

    for (const color of bannedExact) {
      const allowedLightBorder = allowedLightExact.has(color) && lightScoped;
      if (hasBannedExact && line.includes(color) && !darkScoped && !allowedLightBorder) {
        failures.push(`${rel}:${index + 1} banned weak/warm color ${color}`);
      }
    }

    if (bannedWords.test(line) && !darkScoped) {
      failures.push(`${rel}:${index + 1} banned warm theme word`);
    }

    if (weakWhiteBorder.test(line) && !darkScoped) {
      failures.push(`${rel}:${index + 1} weak white rgba leaks into light theme`);
    }
  });
}

if (failures.length) {
  console.error('Light theme audit failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Light theme audit passed.');
