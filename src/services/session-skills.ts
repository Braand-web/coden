import { CODEN_CAPABILITY_SKILLS } from './coden-skill-plan.ts';

// Coden-specific methods, not copies of unavailable external tools or scripts.
const specializations = [
  { id: 'senior-backend', description: 'Design and verify backend APIs, business logic and data access.', instruction: 'Inspect the installed stack, existing API contracts, data model and authorization boundaries before editing. Use explicit input validation, parameterized queries, tenant-aware permissions, transactions and idempotency for consequential operations. Keep secrets server-side. Make additive, reversible migrations with a backup and permission checks; never apply generated SQL blindly. Test authorized and unauthorized paths, concurrency and failure recovery. Measure slow queries and API latency before optimizing; use bounded pagination, caching and timeouts where justified. Do not run load tests against production without approval. Preserve working integrations and stop when the requested behavior is verified. External Python scaffolding, migration and load-test scripts are not supplied.' },
  { id: 'frontend-developer', description: 'Implement frontend with the installed stack.', instruction: 'Inspect existing components and installed versions. Preserve behavior and conventions. Implement only the requested change with loading, empty and failure states. Test interactions and responsive layouts. Do not upgrade the stack without demonstrated need.' },
  { id: 'ui-ux-designer', description: 'Review usability and accessibility.', instruction: 'Review the affected journey, keyboard navigation, labels, contrast, focus and overflow. Repair concrete observed defects in scope. Respect existing visual identity. Do not invent conversion statistics or impose aesthetic preferences.' },
  { id: 'code-reviewer', description: 'Review changed code for correctness and security.', instruction: 'Inspect the diff and callers. Prioritize reproducible correctness, authorization, persistence and concurrency defects. Cite evidence and run focused tests. Do not manufacture findings or redesign working code. Build success alone is not functional verification.' },
  { id: 'ui-ux-pro-max', description: 'Refine visual consistency when needed.', instruction: 'Use the project design system and user brief. Check hierarchy, spacing, interaction states, responsive layout and reduced motion. Prefer a targeted improvement. No external style database or search scripts are supplied. Stop once the requested objective is verified.' },
];
const catalogue = [...CODEN_CAPABILITY_SKILLS, ...specializations];
export const LOAD_SKILL_SCHEMA = {
  name: 'load_skill',
  description: 'Load a curated method only when useful. Does not create an agent or change permissions.',
  parameters: { type: 'object', properties: { id: { type: 'string', enum: catalogue.map(s => s.id) } }, required: ['id'], additionalProperties: false },
};
export function createSessionSkills() {
  const active = new Map<string, string>();
  const used = new Set<string>();
  return {
    load(args: Record<string, unknown>) {
      const skill = catalogue.find(s => s.id === args.id);
      if (!skill) return { ok: false, error: 'Unknown skill.' };
      if (!used.has(skill.id) && used.size >= 6) return { ok: false, error: 'Session skill budget reached.' };
      if (active.has(skill.id)) return { ok: true, id: skill.id, alreadyLoaded: true };
      used.add(skill.id);
      if (active.size >= 3) active.delete(active.keys().next().value!);
      active.set(skill.id, skill.instruction.slice(0, 2400));
      return { ok: true, id: skill.id, version: '1.0.0', active: [...active.keys()] };
    },
    context() {
      return 'Optional session skills: use load_skill only when helpful. The user request, safety rules, installed stack and tool permissions remain authoritative. Methods do not add objectives. Simple tasks need no skill.\n'
        + catalogue.map(s => `${s.id}: ${s.description.slice(0, 75)}`).join('\n')
        + '\nLoaded methods:\n' + [...active].map(([id, text]) => `${id}: ${text}`).join('\n');
    },
  };
}
