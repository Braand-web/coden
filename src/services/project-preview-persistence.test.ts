import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const server = readFileSync(new URL('../../server.ts', import.meta.url), 'utf8');
const builder = readFileSync(new URL('../builder-live.ts', import.meta.url), 'utf8');

describe('project preview persistence across reloads', () => {
  it('does not replace live or saved applications with cancellation/loading placeholders', () => {
    const empty = builder.slice(builder.indexOf('function setEmptyPreviewState('), builder.indexOf('function mediaPreviewShellHtml('));
    expect(empty).toContain('shouldRetainPreview(');
    expect(empty.indexOf('shouldRetainPreview(')).toBeLessThan(empty.indexOf('setPreviewSourceDocument('));
    expect(empty).toContain('liveUrl: livePreviewUrl');
    const preview = builder.slice(builder.indexOf('function setPreview(html:'), builder.indexOf('function refreshPreviewFrame('));
    expect(preview.indexOf('shouldRetainPreview(')).toBeLessThan(preview.indexOf("livePreviewUrl = ''"));
  });
  it('keeps intermediate build rounds out of committed project files', () => {
    const snapshot = server.slice(server.indexOf('onSnapshot: async files => {'), server.indexOf('onSandboxEvent: event => {'));
    expect(snapshot).toContain('persistDurableProjectSnapshot({');
    expect(snapshot).not.toContain('saveProject(');
    expect(server).toContain('authoritativeProjectFiles(input.files, snapshotFiles)');
  });

  it('preserves a verified app when a later edit cannot be verified', () => {
    const outcome = server.slice(server.indexOf('const preserveLastVerifiedApp = !outcome.ok'), server.indexOf('const pipelineProviderCostUsd ='));
    expect(outcome).toContain("project.preview_status === 'verified'");
    expect(outcome).toContain('if (!preserveLastVerifiedApp) await saveProject(updatedProject, pipelineFiles)');
    expect(server).toMatch(/project: visibleProject,\s+files: visibleFiles,/);
    expect(server).toContain("live_url: preserveLastVerifiedApp ? '' : outcome.liveUrl");
  });

  it('restarts the real app after immediately showing a saved preview', () => {
    const restore = builder.slice(builder.indexOf('await restoreProjectPreview({'), builder.indexOf('// The selected runtime above'));
    expect(restore).toContain('renderSaved: (html, status) => setPreview(html, status, false)');
    expect(restore).toContain('startLive: () => { void ensureLivePreview(true); }');
    expect(restore).toContain('hasFiles: currentFiles.length > 0');
    expect(restore).not.toContain("payload.preview.status !== 'idle'");
    expect(builder).toContain('async function ensureLivePreview(silent = false)');
  });

  it('restarts interrupted first builds from their durable checkpoint with the original backend', () => {
    const start = server.slice(server.indexOf("app.post('/api/projects/:id/sandbox/start'"), server.indexOf("app.get('/api/projects/:id/sandbox/status'"));
    expect(start).toContain('loadGenerationFiles<GeneratedFile>({');
    expect(start).toContain('loadDurableProjectSnapshot(project.id, project.owner_id)');
    expect(start).toContain('sandbox.setEnv({ ...serverSecrets, ...backendEnv })');
    expect(start).toContain('releaseRun = sandboxRegistry.reserveRun(project.id)');
    expect(start).toContain('releaseRun?.()');
    expect(start.indexOf("running?.state === 'running'")).toBeLessThan(start.indexOf('sandbox.replaceProjectFiles('));
    expect(start).toContain("error?.diagnosticCode === 'PROJECT_RUN_ACTIVE'");
    expect(start).toContain('res.status(202)');
    expect(start).not.toMatch(/res\.json\([^;]*(?:serverSecrets|backendEnv)/);
  });

  it('does not erase an explicit project URL after a transient load error', () => {
    const restore = builder.slice(builder.indexOf('async function ensureProject()'), builder.indexOf('function projectNameFromPrompt'));
    expect(restore).toContain('return await apiFetch<ProjectPayload>(`/api/projects/${encodeURIComponent(currentProjectId)}`)');
    expect(restore).not.toContain("window.history.replaceState({}, '', '/builder.html?new=1')");
    expect(restore).toContain("if (Number((error as { status?: unknown })?.status || 0) !== 404) throw error");
  });
});
