/**
 * A mailto: link is not a resource that failed to load.
 *
 * Production, a restaurant booking site: the browser check clicked "Nous
 * écrire" (mailto:), Chromium reported the hand-off as a failed document
 * request, and the check filed "Resource unavailable: contact@…" as an error.
 * With every user journey passing, the run was failed on it, twice.
 */

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import http from 'node:http';

const executablePath = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  (await import('playwright')).chromium.executablePath(),
  '/opt/pw-browsers/chromium',
].filter(Boolean).find(candidate => existsSync(candidate as string));

if (!executablePath) {
  console.warn('external link smoke check skipped: no Chromium available in this environment');
} else {
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = executablePath;
  const { verifyLivePreview } = await import('./src/services/sandbox/live-smoke.ts');
  const page = '<!doctype html><html><body><div id="root"><h1>Restaurant</h1><p>Réservez une table pour ce soir dans notre restaurant, ouvert tous les jours.</p>'
    + '<a id="m" href="mailto:contact@example.fr" style="display:inline-block;padding:14px">Nous écrire</a> <a id="t" href="tel:0123456789" style="display:inline-block;padding:14px">Appeler</a></div>'
    + '<script>setTimeout(()=>{document.getElementById("m").click();document.getElementById("t").click()},50)</script></body></html>';
  const server = http.createServer((_request, response) => { response.setHeader('content-type', 'text/html; charset=utf-8'); response.end(page); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = (server.address() as any).port;
    const sandbox: any = { status: () => ({ state: 'running', port, basePath: '/' }), getLogs: () => [] };
    const report = await verifyLivePreview(sandbox);
    const errors = report.problems.filter(problem => problem.severity === 'error').map(problem => problem.message);
    assert.deepEqual(errors, [], 'mailto: and tel: links must not be reported as errors');
    console.log('live smoke: mailto: and tel: links are not failures');
  } finally {
    server.close();
  }
}
