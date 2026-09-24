import assert from 'node:assert/strict';
import http from 'node:http';
import { chromium } from 'playwright';
import { runAcceptanceScenarios } from './src/services/sandbox/acceptance.ts';

/*
 * A journey step lands on the kind of element it acts on.
 *
 * Production, 2026-09-24: a todo app with a button "Ajouter une nouvelle
 * tâche" and a field whose placeholder is "Nouvelle tâche". Every journey
 * failed on `fill "Nouvelle tâche"` — "Element is not an <input>" — because
 * one lookup served clicks and fills alike and tried buttons first. The app
 * worked; the run spent its rounds and its clock "repairing" it.
 */
const page = `<!doctype html><html><body>
<main>
  <h1>Ma liste de tâches</h1>
  <button type="button" onclick="document.querySelector('#title').focus()">Ajouter une nouvelle tâche</button>
  <form id="f">
    <input id="title" placeholder="Nouvelle tâche" />
    <span>Priorité</span>
    <select id="priority"><option>Basse</option><option>Haute</option></select>
    <button type="submit">Ajouter</button>
  </form>
  <ul id="list"></ul>
  <ul id="tasks">
    <li><span>Envoyer le compte rendu</span> <input type="checkbox" aria-label="Marquer comme terminée" onchange="this.parentElement.dataset.done='1'; document.getElementById('status').textContent='Terminée : Envoyer le compte rendu'"></li>
    <li><span>Préparer la réunion de lundi</span> <input type="checkbox" aria-label="Marquer comme terminée" onchange="this.parentElement.dataset.done='1'; document.getElementById('status').textContent='Terminée : Préparer la réunion de lundi'"></li>
  </ul>
  <p id="status"></p>
</main>
<script>
  document.getElementById('f').addEventListener('submit', event => {
    event.preventDefault();
    const li = document.createElement('li');
    li.textContent = document.getElementById('title').value + ' — ' + document.getElementById('priority').value;
    document.getElementById('list').appendChild(li);
  });
</script>
</body></html>`;

const server = http.createServer((_req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(page); });
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const port = (server.address() as any).port;
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
try {
  const tab = await browser.newPage();
  const [result] = await runAcceptanceScenarios(tab, new URL(`http://127.0.0.1:${port}/`), [{
    name: 'Créer une tâche',
    steps: [
      { action: 'click', target: 'Ajouter une nouvelle tâche' },
      { action: 'fill', target: 'Nouvelle tâche', value: 'Acheter du pain' },
      { action: 'select', target: 'Priorité', value: 'Haute' },
      { action: 'click', target: 'Ajouter' },
      { action: 'expect_text', text: 'Acheter du pain — Haute' },
    ],
  }]);
  assert.deepEqual(result, { name: 'Créer une tâche', ok: true }, JSON.stringify(result));

  /*
   * A label the planner guessed before the interface existed: the control is
   * "Marquer comme terminée", and the task name lives in its row. The right
   * row's checkbox is found, not the first one.
   */
  const [guessed] = await runAcceptanceScenarios(tab, new URL(`http://127.0.0.1:${port}/`), [{
    name: 'Terminer une tâche',
    steps: [
      { action: 'click', target: 'Marquer « Préparer la réunion de lundi » comme terminée' },
      { action: 'expect_text', text: 'Terminée : Préparer la réunion de lundi' },
    ],
  }]);
  assert.deepEqual(guessed, { name: 'Terminer une tâche', ok: true }, JSON.stringify(guessed));

  // And a target that shares nothing with any control still fails honestly.
  const [missing] = await runAcceptanceScenarios(tab, new URL(`http://127.0.0.1:${port}/`), [{
    name: 'Exporter',
    steps: [{ action: 'click', target: 'Exporter en PDF' }],
  }]);
  assert.equal(missing.ok, false);
  console.log('acceptance locator tests passed');
} finally {
  await browser.close();
  server.close();
}
