const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const files = ['index.html', 'pricing.html', 'dashboard.html'];

function findBalancedDivEnd(html, start) {
  const matcher = /<\/?div\b[^>]*>/gi;
  matcher.lastIndex = start;
  let depth = 0;
  let match;
  while ((match = matcher.exec(html))) {
    const token = match[0];
    if (token.startsWith('</')) {
      depth -= 1;
      if (depth === 0) return matcher.lastIndex;
    } else {
      depth += 1;
    }
  }
  return -1;
}

function compact(file) {
  const fullPath = path.join(root, file);
  let html = fs.readFileSync(fullPath, 'utf8');
  let cursor = 0;
  let changed = false;

  while (true) {
    const start = html.indexOf('<div class="dropdown"', cursor);
    if (start === -1) break;
    const openEnd = html.indexOf('>', start);
    const end = findBalancedDivEnd(html, start);
    if (openEnd === -1 || end === -1) break;
    const openTag = html.slice(start, openEnd + 1);
    const replacement = `${openTag}\n                                <div class="dropdown-header">Choose AI Engine</div>\n                            </div>`;
    html = `${html.slice(0, start)}${replacement}${html.slice(end)}`;
    cursor = start + replacement.length;
    changed = true;
  }

  if (changed) fs.writeFileSync(fullPath, html, 'utf8');
}

files.forEach(compact);
