import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const server = readFileSync(new URL('../../server.ts', import.meta.url), 'utf8');
const builder = readFileSync(new URL('../builder-live.ts', import.meta.url), 'utf8');

describe('project preview persistence across reloads', () => {
  it('keeps intermediate build rounds out of committed project files', () => {
    const snapshot = server.slice(server.indexOf('onSnapshot: async files => {'), server.indexOf('onSandboxEvent: event => {'));
    expect(snapshot).toContain('persistDurableProjectSnapshot({');
    expect(snapshot).not.toContain('saveProject(');
    expect(server).toContain('authoritativeProjectFiles(input.files, snapshotFiles)');
  });

  it('preserves a verified app when a later edit cannot be verified', () => {
    const outcome = server.slice(server.indexOf('const preserveLastVerifiedApp = !outcome.ok'), server.indexOf('const pipelineProviderCostUsd ='));
    expect(outcome).toContain("project.preview_status === 'verified'");
    expect(outcome).toContain('if (!preserveLastVerifiedApp) {');
    expect(outcome).toContain('else await saveProject(updatedProject,pipelineFiles)');
    expect(outcome.indexOf('await completeDeliveredAction')).toBeLessThan(outcome.indexOf('if (!preserveLastVerifiedApp) {'));
    expect(outcome).toContain('generationDurablyDelivered=true');
    expect(server).toMatch(/project: visibleProject,\s+files: visibleFiles,/);
    expect(server).toContain("live_url: preserveLastVerifiedApp ? '' : outcome.liveUrl");
  });

  it('restarts the real app after immediately showing a saved preview', () => {
    const restore = builder.slice(builder.indexOf('const resumedLive = await resumeLivePreview()'), builder.indexOf('// The selected runtime above'));
    expect(restore).toContain('setPreview(payload.preview.html, payload.preview.status)');
    expect(restore).toContain('if (currentFiles.length) void ensureLivePreview(true)');
    expect(builder).toContain('async function ensureLivePreview(silent = false)');
  });

  it('does not erase an explicit project URL after a transient load error', () => {
    const restore = builder.slice(builder.indexOf('async function ensureProject()'), builder.indexOf('function projectNameFromPrompt'));
    expect(restore).toContain('return await apiFetch<ProjectPayload>(`/api/projects/${encodeURIComponent(currentProjectId)}`)');
    expect(restore).not.toContain("window.history.replaceState({}, '', '/builder.html?new=1')");
    expect(restore).toContain("if (Number((error as { status?: unknown })?.status || 0) !== 404) throw error");
  });
});
