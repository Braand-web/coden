import { describe, expect, it } from 'vitest';
import { STARTERS, STARTER_ENTRY_PLACEHOLDER, isStarterEntryUntouched } from '../sandbox/starters';
import { scanSecrets, scanSuspiciousCode } from './checks';
import { assembleTemplate, templateOverlay } from './template-apps';
import { OFFICIAL_TEMPLATES } from './templates';

const apps = OFFICIAL_TEMPLATES.filter(template => template.kind === 'app');

describe('the template apps', () => {
  it('are three, each with its files in the repository', () => {
    expect(apps.map(app => app.slug)).toEqual(['budget-clair', 'chez-marcel', 'cap-sur-le-monde']);
    for (const app of apps) expect(templateOverlay(app.slug).length, app.slug).toBeGreaterThan(4);
  });

  it('give the person the starter plus the app, never touching what the scaffold owns', () => {
    const starter = STARTERS['react-vite'];
    for (const app of apps) {
      const files = assembleTemplate(app.slug);
      const paths = new Set(files.map(file => file.path));
      for (const file of starter.files) expect(paths.has(file.path), `${app.slug} lacks ${file.path}`).toBe(true);
      const overlay = templateOverlay(app.slug).map(file => file.path);
      for (const reserved of starter.reservedPaths) expect(overlay, `${app.slug} overrides ${reserved}`).not.toContain(reserved);
      const entry = files.find(file => file.path === starter.entryPath)!;
      expect(entry.content).not.toBe(STARTER_ENTRY_PLACEHOLDER);
      expect(isStarterEntryUntouched(files, starter)).toBe(false);
    }
  });

  it('carry no key, no suspicious code and no connection to a backend', () => {
    for (const app of apps) {
      const files = assembleTemplate(app.slug);
      expect(scanSecrets(files), app.slug).toEqual([]);
      expect(scanSuspiciousCode(files), app.slug).toEqual([]);
      expect(files.map(file => file.content).join('\n'), app.slug).not.toMatch(/supabase|fetch\(|XMLHttpRequest|api[_-]?key/i);
    }
  });

  it('are in French, titled, described, responsive and themed without violet', () => {
    for (const app of apps) {
      const html = templateOverlay(app.slug).find(file => file.path === 'index.html')!.content;
      expect(html, app.slug).toMatch(/<html lang="fr"/);
      expect(html).toMatch(/<meta name="viewport"/);
      expect(html).toMatch(/<meta name="description" content="[^"]{40,}/);
      const theme = templateOverlay(app.slug).find(file => file.path === 'src/theme.css')!.content;
      for (const hue of [...theme.matchAll(/oklch\([\d.]+ [\d.]+ (\d+)\)/g)].map(match => Number(match[1]))) {
        expect(hue < 255 || hue > 305, `${app.slug} uses a violet hue (${hue})`).toBe(true);
      }
    }
  });

  it('keep the user’s data in their own browser and survive blocked storage', () => {
    for (const app of apps) {
      const source = assembleTemplate(app.slug).filter(file => file.path.startsWith('src/') && !/index\.css|theme\.css/.test(file.path)).map(file => file.content).join('\n');
      expect(source, app.slug).toContain('localStorage');
      expect(source, app.slug).toMatch(/catch \{/);
    }
  });

  it('are not offered when their files are missing from a deploy', () => {
    expect(assembleTemplate('budget-clair', '/nonexistent')).toEqual([]);
    expect(assembleTemplate('../../etc', undefined)).toEqual([]);
  });
});
