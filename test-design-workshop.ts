import assert from 'node:assert/strict';
import {
  buildDesignStudioBrief,
  designWorkshopInstructionLines,
  designWorkshopOptionLabel,
  designWorkshopSummary,
  inferDesignArtifactType,
  normalizeDesignWorkshopSettings,
} from './src/services/design-workshop.ts';

const defaults = normalizeDesignWorkshopSettings({});
assert.equal(defaults.action, 'autopilot');
assert.equal(defaults.scope, 'focused');
assert.equal(defaults.target, 'auto');
assert.equal(defaults.direction, 'auto');
assert.equal(defaults.artifact, 'auto');
assert.equal(defaults.handoff, 'preview_first');
assert.equal(designWorkshopOptionLabel('action', defaults.action), 'Autopilot');
assert.ok(designWorkshopSummary(defaults).includes('Autopilot'));
assert.ok(designWorkshopSummary(defaults).includes('Preview first'));

const antiAiMobile = normalizeDesignWorkshopSettings({
  action: 'anti_ai',
  scope: 'section',
  target: 'mobile',
  direction: 'soft_saas',
  artifact: 'prototype',
  handoff: 'apply_to_app',
});
const antiAiLines = designWorkshopInstructionLines(antiAiMobile).join('\n');
assert.ok(antiAiLines.includes('generic AI patterns'));
assert.ok(antiAiLines.includes('mobile usability'));
assert.ok(antiAiLines.includes('Soft SaaS'));
assert.ok(antiAiLines.includes('Prototype'));
assert.ok(antiAiLines.includes('Apply'));

const audit = normalizeDesignWorkshopSettings({ action: 'audit', scope: 'app' });
const auditLines = designWorkshopInstructionLines(audit).join('\n');
assert.ok(auditLines.includes('do not modify files'));
assert.ok(auditLines.includes('harmonizing visual tokens'));

const invalid = normalizeDesignWorkshopSettings({
  action: 'delete_database',
  scope: 'billing',
  target: 'server',
  direction: 'cyber_noise',
  artifact: 'database',
  handoff: 'delete',
});
assert.deepEqual(invalid, defaults);

assert.equal(inferDesignArtifactType('create a 6 slide investor pitch deck', defaults), 'deck');
assert.equal(inferDesignArtifactType('audit the dashboard spacing and contrast', defaults), 'design_audit');
assert.equal(inferDesignArtifactType('make this hero section more premium', defaults), 'landing_section');

const brief = buildDesignStudioBrief({
  prompt: 'make a clickable onboarding prototype',
  settings: { handoff: 'preview_first' },
});
assert.equal(brief.artifact_type, 'prototype');
assert.equal(brief.output_surface, 'preview_canvas');
assert.ok(brief.brand_kit.extract.includes('colors'));
assert.ok(brief.design_critic.includes('mobile fit'));

const applyBrief = buildDesignStudioBrief({
  prompt: 'apply this design to the current dashboard',
  settings: { handoff: 'apply_to_app' },
});
assert.equal(applyBrief.output_surface, 'app_patch');

console.log('test-design-workshop passed');
