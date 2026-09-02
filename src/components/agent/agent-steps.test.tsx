import fs from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AgentSteps } from './agent-steps';

/**
 * The step spine.
 *
 * The server emits eight phases with active/done/failed states, the run store
 * turns them into `view.activities`, and nothing rendered them: the value was
 * built, cloned through the island, and dropped. The shimmer said what was
 * happening now; nothing said what had already run or where it had failed.
 */

const root = resolve(import.meta.dirname, '../../..');
const read = (path: string) => fs.readFileSync(resolve(root, path), 'utf8');

const activities = [
  { id: 'phase:understand', label: 'Analyse de votre demande', status: 'done' as const },
  { id: 'phase:decide', label: 'Choix de l’approche', status: 'done' as const },
  { id: 'phase:build', label: 'Création de l’application', status: 'done' as const },
  { id: 'phase:verify', label: 'Vérification de l’application', status: 'failed' as const },
  { id: 'phase:fix', label: 'Correction des problèmes détectés', status: 'active' as const },
  { id: 'file:src/App.tsx', label: 'src/App.tsx', status: 'done' as const },
  { id: 'check:seo_title', label: 'seo_title', status: 'done' as const },
];

const render = (props: Parameters<typeof AgentSteps>[0]) =>
  renderToStaticMarkup(React.createElement(AgentSteps, props));

describe('run step spine', () => {
  const html = render({ activities });

  it('shows the phases and only the phases', () => {
    // The same list also collects a row per generated file and per verification
    // check — useful data, wrong shape here: twenty file rows between "Building"
    // and "Verifying" turn a pipeline into a log.
    expect((html.match(/class="coden-agent-step"/g) || []).length).toBe(5);
    expect(html).not.toContain('>seo_title<');
    expect(html).not.toContain('>src/App.tsx<');
  });

  it('carries every state into the markup', () => {
    for (const status of ['done', 'failed', 'active']) {
      expect(html).toContain(`data-status="${status}"`);
    }
  });

  it('gives a failed step its own mark rather than a silent dot', () => {
    expect(/data-status="failed"[\s\S]{0,220}<svg/.test(html)).toBe(true);
    expect(/data-status="done"[\s\S]{0,220}<svg/.test(html)).toBe(true);
    // The running step keeps the dot, because the pulse is what animates.
    expect(/data-status="active"[\s\S]{0,220}coden-agent-step__dot/.test(html)).toBe(true);
  });

  it('renders nothing when there is no phase yet', () => {
    // An empty spine must not leave a gap above the first message.
    expect(render({ activities: [] })).toBe('');
    expect(render({ activities: [{ id: 'file:a.tsx', label: 'a.tsx', status: 'done' }] })).toBe('');
  });

  it('announces itself in the reader’s language', () => {
    expect(html).toContain('aria-label="Étapes de la génération"');
    expect(render({ activities, locale: 'en' })).toContain('aria-label="Generation steps"');
  });

  it('is rendered by the run panel', () => {
    // Without this the component repeats the defect it exists to fix.
    expect(read('src/components/agent/agent-run-panel.tsx')).toMatch(/<AgentSteps activities=\{view\.activities\}/);
  });

  it('does not repeat the shimmer’s sentence', () => {
    // The repair step briefly carried the narration as its label, so the user
    // read "Coden corrige src/App.tsx…" twice: once in the list, once under it.
    expect(read('server.ts')).not.toMatch(/phases\.start\('fix', repairNarration/);
  });

  it('animates the running step and stops for a reader who asked for less', () => {
    const css = read('src/styles/agent-conversation.css');
    expect(css).toMatch(/coden-agent-step-pulse/);
    expect(css).toMatch(/prefers-reduced-motion[\s\S]{0,220}coden-agent-step__dot[\s\S]{0,60}animation: none/);
  });

  it('leaves one motion system, not two', () => {
    // agent-motion.css defined a complete second one — agent-card, agent-phase,
    // agent-mini-card — that no component used and that was never imported.
    expect(fs.existsSync(resolve(root, 'src/styles/agent-motion.css'))).toBe(false);
  });
});
