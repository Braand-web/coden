type SkillRecord = { id: string; description: string; version: string; approvalPolicy: string; requiresVerification: boolean };
type WorkflowRecord = { id: string; name: string; skill_id: string; status: string; trigger_type: string; next_run_at?: string | null; last_run_at?: string | null };
import { isLocalPreviewEnabled } from './local-preview';

let activeProjectId = '';
let initialized = false;

function escapeHtml(value: unknown): string {
  return String(value || '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character] || character));
}

function formatDate(value?: string | null): string {
  if (!value) return 'Not scheduled';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not scheduled' : date.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

function panel(): HTMLElement | null { return document.querySelector<HTMLElement>('[data-skills-automations]'); }

async function loadSkillsAndWorkflows(): Promise<void> {
  const root = panel();
  if (!root || !activeProjectId) return;
  if (isLocalPreviewEnabled()) {
    root.hidden = false;
    const skillsList = root.querySelector<HTMLElement>('[data-skills-list]');
    const workflowsList = root.querySelector<HTMLElement>('[data-workflows-list]');
    if (skillsList) skillsList.innerHTML = '<p class="skills-empty">Skills disponibles après connexion à un projet réel.</p>';
    if (workflowsList) workflowsList.innerHTML = '<p class="skills-empty">Les workflows sont désactivés dans l’aperçu local.</p>';
    return;
  }
  const [skillsResponse, workflowsResponse] = await Promise.all([
    fetch(`/api/projects/${encodeURIComponent(activeProjectId)}/skills`, { credentials: 'include' }),
    fetch(`/api/projects/${encodeURIComponent(activeProjectId)}/workflows`, { credentials: 'include' }),
  ]);
  if (!skillsResponse.ok) { root.hidden = true; return; }
  const skills = (await skillsResponse.json()).skills as SkillRecord[];
  const workflows = workflowsResponse.ok ? ((await workflowsResponse.json()).workflows as WorkflowRecord[]) : [];
  root.hidden = false;
  const skillsList = root.querySelector<HTMLElement>('[data-skills-list]');
  const workflowsList = root.querySelector<HTMLElement>('[data-workflows-list]');
  if (skillsList) skillsList.innerHTML = skills.slice(0, 6).map(skill => `
    <article class="skill-card">
      <div class="skill-card-heading"><strong>${escapeHtml(skill.id)}</strong><span>v${escapeHtml(skill.version)}</span></div>
      <p>${escapeHtml(skill.description)}</p>
      <small>${skill.requiresVerification ? 'Verified before completion' : 'Read-only analysis'}</small>
    </article>`).join('');
  if (workflowsList) workflowsList.innerHTML = `
    <div class="skills-workflows-heading"><strong>Workflows</strong><span>${workflows.length} configured</span></div>
    ${workflows.length ? workflows.map(workflow => `<div class="workflow-row" data-workflow-id="${escapeHtml(workflow.id)}">
      <div><strong>${escapeHtml(workflow.name)}</strong><span>${escapeHtml(workflow.skill_id)} · ${escapeHtml(workflow.trigger_type)} · next ${escapeHtml(formatDate(workflow.next_run_at))}</span></div>
      <div class="workflow-actions"><span class="workflow-status" data-status>${escapeHtml(workflow.status)}</span><button type="button" data-workflow-action="run">Run</button><button type="button" data-workflow-action="${workflow.status === 'paused' ? 'resume' : 'pause'}">${workflow.status === 'paused' ? 'Resume' : 'Pause'}</button></div>
    </div>`).join('') : '<p class="skills-empty">No workflow configured yet. Create one from the API when you are ready.</p>'}`;
  workflowsList?.querySelectorAll<HTMLButtonElement>('[data-workflow-action]').forEach(button => button.addEventListener('click', async () => {
    const row = button.closest<HTMLElement>('[data-workflow-id]');
    const workflowId = row?.dataset.workflowId;
    if (!workflowId) return;
    const action = button.dataset.workflowAction;
    const method = action === 'run' ? 'POST' : 'POST';
    const response = await fetch(`/api/projects/${encodeURIComponent(activeProjectId)}/workflows/${encodeURIComponent(workflowId)}/${action}`, { method, credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (response.ok) void loadSkillsAndWorkflows();
  }));
}

export function initSkillsWorkflowsPanel(projectId: string): void {
  activeProjectId = projectId;
  if (!initialized) {
    initialized = true;
    document.querySelector<HTMLButtonElement>('[data-skills-refresh]')?.addEventListener('click', () => void loadSkillsAndWorkflows());
    const style = document.createElement('style');
    style.textContent = `.skills-automations-panel{margin:24px 0;padding:20px;border:1px solid var(--border);background:var(--bg-panel);border-radius:12px}.skills-automations-subtitle{margin-top:5px;color:var(--text-sub);font-size:12px}.skills-automations-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:14px}.skill-card{padding:13px;border:1px solid var(--border);background:var(--bg-surface);border-radius:8px}.skill-card-heading,.skills-workflows-heading,.workflow-row,.workflow-actions{display:flex;align-items:center;justify-content:space-between;gap:10px}.skill-card-heading span,.workflow-row span,.skills-workflows-heading span,.skill-card small{color:var(--text-sub);font-size:11px}.skill-card p{margin:8px 0;font-size:12px;color:var(--text-muted);line-height:1.45}.skills-automations-workflows{margin-top:16px;border-top:1px solid var(--border);padding-top:14px}.workflow-row{padding:12px 0;border-top:1px solid var(--border);font-size:12px}.workflow-row>div:first-child{display:grid;gap:4px}.workflow-actions{justify-content:flex-end}.workflow-actions button{min-height:32px;padding:0 10px;border:1px solid var(--border);border-radius:6px}.workflow-status{color:var(--accent-blue)!important}.skills-empty{color:var(--text-sub);font-size:12px;margin-top:12px}@media(max-width:760px){.skills-automations-grid{grid-template-columns:1fr}.workflow-row{align-items:flex-start;flex-direction:column}.workflow-actions{width:100%;justify-content:flex-start}}`;
    document.head.appendChild(style);
  }
  void loadSkillsAndWorkflows();
}
