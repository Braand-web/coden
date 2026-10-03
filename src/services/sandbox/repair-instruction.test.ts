import { describe, expect, it } from 'vitest';
import { buildRepairInstruction, type ValidationReport } from './validate';
const report = (message: string, file?: string): ValidationReport => ({ ok: false, durationMs: 0, ran: { devServer: true, typecheck: true, build: true }, problems: [{ severity: 'error', source: 'runtime', message, file }] });
describe('evidence-backed repair instructions', () => {
  it('does not turn a wrong-product verdict into a fictitious compiler error', () => {
    const instruction = buildRepairInstruction(report('MISSION_ALIGNMENT: Requested coaching, found arithmetic'));
    expect(instruction).toContain('behavior or mission');
    expect(instruction).not.toContain('does not run');
    expect(instruction).not.toContain('made in a real browser');
  });
  it('starts at failing files without forbidding a fix in the actual dependency', () => {
    const instruction = buildRepairInstruction(report('Missing export', 'src/App.tsx'));
    expect(instruction).toContain('src/App.tsx');
    expect(instruction).toContain('not necessarily the root cause');
    expect(instruction).toContain('Preserve working functionality, design');
    expect(instruction).toContain('weaken tests');
    expect(instruction).not.toContain('Change only these files');
  });
  it('does not invent a repair when there are no errors', () => {
    const clean = report('warning'); clean.problems[0].severity = 'warning';
    expect(buildRepairInstruction(clean)).toBe('');
  });
});
