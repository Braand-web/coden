export const CODEN_PROJECT_MEMORY_VERSION = 'coden-project-memory-v1';

export const CODEN_PROJECT_MEMORY_PROMPT = [
  `Project memory contract version: ${CODEN_PROJECT_MEMORY_VERSION}.`,
  'Persistent project memory lives at mem://. Memories are RULES applied automatically, not suggestions. Never re-propose an idea the user has rejected. Never violate a stated preference.',
  'The index mem://index.md is always in context. It has two sections:',
  '  - Core: one-line rules applied on EVERY action (design tokens, stack decisions, forbidden patterns).',
  '  - Memories: references to detailed memory files with specific descriptions so the agent can judge relevance.',
  'Save immediately when the user states a preference, rejects an approach, describes a hard requirement, corrects the agent, or asks to remember/forget something.',
  'Memory types: design (visual decisions), constraint (rejected/forbidden with Why), preference (how the user wants things done), feature (business rules, formulas, edge cases), reference (external docs).',
  'Do not save code structure, file paths, obvious implementation details, or session-only notes.',
  'When saving, write the memory file at mem://<type>/<slug> with frontmatter {name, description, type} AND update mem://index.md in the same batch.',
  'User-level preferences (communication style, expertise) live at mem://~user as a flat file and follow the user across projects; project memory wins on project decisions when the two conflict.',
].join('\n');
