import { existsSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { journeyMatchingTolerant, normalizeForMatch, pageShowsText, runAcceptanceScenarios, type AcceptanceScenario } from './acceptance';

describe('comparing what a journey expects with what the page shows', () => {
  const tolerant = { tolerant: true, present: true };

  it('ignores accents, case, quotes and spacing', () => {
    expect(normalizeForMatch('  Tâche   ajoutée ’ok’ ')).toBe("tache ajoutee 'ok'");
    expect(pageShowsText('Votre tache a ete ajoutee', 'Votre tâche a été ajoutée', tolerant)).toBe(true);
    expect(pageShowsText("L'équipe", 'L’équipe', tolerant)).toBe(true);
    expect(pageShowsText('Aucune   tâche', 'aucune tâche', tolerant)).toBe(true);
    expect(pageShowsText('Merci !', 'Merci', tolerant)).toBe(true);
  });

  it('accepts a longer sentence whose meaningful words are on the page, but not a short or different one', () => {
    expect(pageShowsText('3 tâches terminées sur 5 pour cette semaine', 'tâches terminées cette semaine', tolerant)).toBe(true);
    expect(pageShowsText('Bienvenue sur votre tableau de bord', 'Réservation confirmée pour demain soir', tolerant)).toBe(false);
    // A unique item name is never matched loosely.
    expect(pageShowsText('Test Coden 12', 'Test Coden 1', { tolerant: true, present: true })).toBe(true);
    expect(pageShowsText('Coden', 'Test Coden 1', { tolerant: true, present: true })).toBe(false);
  });

  it('keeps the absence check exact: a word elsewhere on the page does not count as « still there »', () => {
    expect(pageShowsText('Liste vide', 'Acheter du lait et du pain', { tolerant: true, present: false })).toBe(false);
    expect(pageShowsText('Acheter du lait', 'acheter du lait', { tolerant: true, present: false })).toBe(true);
  });

  it('can be switched off to the strict comparison', () => {
    expect(journeyMatchingTolerant({})).toBe(true);
    expect(journeyMatchingTolerant({ CODEN_JOURNEY_TOLERANT: '0' })).toBe(false);
    expect(pageShowsText('Tache ajoutee', 'Tâche ajoutée', { tolerant: false, present: true })).toBe(true); // accents are always ignored
    expect(pageShowsText('3 tâches terminées sur 5 pour cette semaine', 'tâches terminées cette semaine', { tolerant: false, present: true })).toBe(false);
  });
});

/** The runner itself, in a real browser on real pages. Skipped where no browser can be launched. */
const PAGES: Record<string, string> = {
  '/': `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Tâches</title></head><body>
    <h1>Mes tâches</h1>
    <label>Nouvelle tâche <input id="t" placeholder="Ex. Acheter du lait"></label>
    <button id="add">Ajouter</button><button aria-label="Tout effacer">×</button>
    <p id="msg"></p><ul id="list"></ul>
    <script>document.getElementById('add').onclick=()=>{const v=document.getElementById('t').value;if(!v)return;document.getElementById('list').insertAdjacentHTML('beforeend','<li>'+v+'</li>');document.getElementById('msg').textContent='Tache ajoutee avec succes'}</script>
  </body></html>`,
};
let server: http.Server;
let base = '';
let browser: Browser | null = null;

beforeAll(async () => {
  server = http.createServer((request, response) => { response.setHeader('content-type', 'text/html'); response.end(PAGES[(request.url || '/').split('?')[0]] || '<!doctype html><title>404</title>'); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  for (const executablePath of [undefined, process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, '/opt/pw-browsers/chromium'].filter((value, index) => index === 0 || (value && existsSync(value)))) {
    try { browser = await chromium.launch({ headless: true, timeout: 15_000, args: ['--disable-dev-shm-usage'], ...(executablePath ? { executablePath } : {}) }); break; } catch { browser = null; }
  }
});
afterAll(async () => { await browser?.close(); await new Promise(resolve => server.close(resolve)); });

const run = async (scenarios: AcceptanceScenario[]) => {
  const page = await (await browser!.newContext()).newPage();
  try { return await runAcceptanceScenarios(page, new URL(base), scenarios); } finally { await page.context().close(); }
};

describe('a journey whose expected text is a guess', { timeout: 60_000 }, () => {
  it('passes when the app says the same thing with other accents', async () => {
    if (!browser) return;
    const [result] = await run([{ name: 'ajouter', steps: [{ action: 'fill', target: 'Nouvelle tâche', value: 'Acheter du pain' }, { action: 'click', target: 'Ajouter' }, { action: 'expect_text', text: 'Tâche ajoutée avec succès' }, { action: 'expect_text', text: 'Acheter du pain' }] }]);
    expect(result).toMatchObject({ ok: true });
  });

  it('says what the page actually shows when a control or a text cannot be found', async () => {
    if (!browser) return;
    const [missingControl, missingText] = await run([
      { name: 'bouton inconnu', steps: [{ action: 'click', target: 'Créer une mission' }, { action: 'expect_text', text: 'x' }] },
      { name: 'texte inconnu', steps: [{ action: 'expect_text', text: 'Réservation confirmée pour demain soir' }] },
    ]);
    expect(missingControl.ok).toBe(false);
    expect(missingControl.error).toContain('Visible controls and fields');
    expect(missingControl.error).toContain('« Ajouter »');
    expect(missingControl.error).toContain('« Tout effacer »');
    expect(missingText.error).toContain('The page shows');
    expect(missingText.error).toContain('Mes tâches');
  });

  it('still fails a journey whose expected text really is missing', async () => {
    if (!browser) return;
    const [result] = await run([{ name: 'rien', steps: [{ action: 'click', target: 'Ajouter' }, { action: 'expect_text', text: 'Votre tâche a été enregistrée dans le classeur' }] }]);
    expect(result.ok).toBe(false);
  });
});
