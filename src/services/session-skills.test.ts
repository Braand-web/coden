import { describe, it, expect } from 'vitest';
import { createSessionSkills, LOAD_SKILL_SCHEMA } from './session-skills.ts';

describe('on-demand session methods', () => {
  it('starts without loaded instructions and isolates sessions', () => {
    const a = createSessionSkills(), b = createSessionSkills();
    const before = b.context();
    expect(a.load({ id: 'code-reviewer' }).ok).toBe(true);
    expect(a.context()).toContain('Inspect the diff and callers');
    expect(b.context()).toBe(before);
  });
  it('rejects arbitrary files and unknown skills', () => {
    expect(createSessionSkills().load({ id: '../../secret.env' }).ok).toBe(false);
  });
  it('deduplicates loads and limits active context and lifetime budget', () => {
    const runtime = createSessionSkills();
    const ids = LOAD_SKILL_SCHEMA.parameters.properties.id.enum;
    for (const id of ids.slice(0, 6)) {
      const result = runtime.load({ id });
      expect(result.ok).toBe(true);
      expect(result.active!.length).toBeLessThanOrEqual(3);
    }
    expect(runtime.load({ id: ids[6] }).ok).toBe(false);
    expect(runtime.load({ id: ids[5] }).alreadyLoaded).toBe(true);
    expect(runtime.context().length).toBeLessThan(12000);
  });
  it('includes the existing design skill once rather than duplicating it', () => {
    expect(LOAD_SKILL_SCHEMA.parameters.properties.id.enum.filter(id => id === 'frontend-design')).toHaveLength(1);
  });
  it('loads backend expertise without claiming unavailable automation', () => {
    const session = createSessionSkills();
    expect(session.load({ id: 'senior-backend' }).ok).toBe(true);
    expect(session.context()).toContain('tenant-aware permissions');
    expect(session.context()).toContain('scripts are not supplied');
  });
});
