import type { CodenCapabilitySkillId } from './coden-skill-plan.ts';

export type AuditedSkillRepository = {
  id: string;
  repository: string;
  commit: string;
  license: 'MIT' | 'Apache-2.0' | 'UNSPECIFIED';
  runtimeEligible: boolean;
};

export type CodenSkillSource = {
  repositoryId: string;
  sourcePath: string;
  contentSha256: string;
};

export const AUDITED_SKILL_REPOSITORIES: readonly AuditedSkillRepository[] = [
  { id: 'superpowers', repository: 'https://github.com/obra/superpowers', commit: 'b36e0829c6d0140e93cfef2ca599b1b07d4a7797', license: 'MIT', runtimeEligible: true },
  { id: 'mattpocock-skills', repository: 'https://github.com/mattpocock/skills', commit: '3cca18b368ae95cdbdebbff572ccafa662551015', license: 'MIT', runtimeEligible: true },
  { id: 'addy-agent-skills', repository: 'https://github.com/addyosmani/agent-skills', commit: '48cb1168aeaaa70dfc2bbf709eddfa2a8ed8129a', license: 'MIT', runtimeEligible: true },
  { id: 'impeccable', repository: 'https://github.com/pbakaus/impeccable', commit: '831cabee8b4bc1a2b66e5ae22003e9a19b57d464', license: 'Apache-2.0', runtimeEligible: true },
  { id: 'gstack', repository: 'https://github.com/garrytan/gstack', commit: 'c24121663732644c56280474a1720475dbe53127', license: 'MIT', runtimeEligible: true },
  { id: 'vercel-agent-skills', repository: 'https://github.com/vercel-labs/agent-skills', commit: '063bee94c3f4df8453406c830b0a7df0f2860278', license: 'UNSPECIFIED', runtimeEligible: false },
  { id: 'anthropic-skills', repository: 'https://github.com/anthropics/skills', commit: '41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f', license: 'Apache-2.0', runtimeEligible: true },
  { id: 'microsoft-skills', repository: 'https://github.com/microsoft/skills', commit: '02e0b2f852b39ea00c43283f999b83fc12079273', license: 'MIT', runtimeEligible: true },
  { id: 'mblode-agent-skills', repository: 'https://github.com/mblode/agent-skills', commit: '0a639b1ef3b75aa6cc945e778fb1486def1d41bf', license: 'MIT', runtimeEligible: true },
  { id: 'repo-to-skill', repository: 'https://github.com/shuyhere/repo-to-skill', commit: 'f4fe8c564b07dd6e50fa7ec089da8946ef1c29da', license: 'MIT', runtimeEligible: false },
  { id: 'rk-skills', repository: 'https://github.com/richkuo/rk-skills', commit: '2e24981458cb83c544d93a6538bb694da0ec87ba', license: 'MIT', runtimeEligible: true },
] as const;

const source = (repositoryId: string, sourcePath: string, contentSha256: string): CodenSkillSource => ({ repositoryId, sourcePath, contentSha256 });

export const CODEN_SKILL_PROVENANCE: Readonly<Record<CodenCapabilitySkillId, readonly CodenSkillSource[]>> = {
  'requirements-discovery': [source('mattpocock-skills', 'skills/productivity/grilling/SKILL.md', 'd806733216b16e51adad834e724bfec5540a436d06395bfc75b843cda9f7404b')],
  'specification-and-dod': [source('mattpocock-skills', 'skills/engineering/to-spec/SKILL.md', 'c73a2250beac0479e384f5466e834bb54ce6e30b7f8705e9999ba840d9d59b36')],
  'planning-and-execution': [
    source('superpowers', 'skills/writing-plans/SKILL.md', '48508f44bbfd7d24b029fbf3a314f3cd14c9615599059366e922f47b8dc08cf2'),
    source('superpowers', 'skills/executing-plans/SKILL.md', 'c4c3d8b628c51114cd165fb8246fe02744cd8be180032328391252e653028d9b'),
  ],
  'context-and-repo-intelligence': [source('addy-agent-skills', 'skills/context-engineering/SKILL.md', '1392005054efb0a5c9cbbd83811f95ac30d34e5228a1f6837baf59fb7d588017')],
  'architecture-and-domain': [
    source('mattpocock-skills', 'skills/engineering/codebase-design/SKILL.md', '362b0bec828219d9f4b08ca7c466164e67253bdd817359258e60d2e9c5692a8f'),
    source('mattpocock-skills', 'skills/engineering/domain-modeling/SKILL.md', 'dd4c753a617bd7db97c34fd3e049581c4bc0c0590e8a8b1f97d3b9d6013131dc'),
  ],
  'multi-agent-orchestration': [
    source('rk-skills', 'skills/fable-orchestrate/SKILL.md', '3a82b0083e77f1d05d5d193b6666d3e2768dd493328343c328d7a416d5ba91a2'),
    source('superpowers', 'skills/dispatching-parallel-agents/SKILL.md', '1968923066f3b707eb01d1992cdf4c42284c3855f70253b9cd5000ff45fca13c'),
  ],
  'incremental-implementation': [source('addy-agent-skills', 'skills/incremental-implementation/SKILL.md', '3a3581e7084a0dc85af420afcc91211a159d3dc46f3d81075a4d53c566b70b80')],
  'tdd-implementation': [source('mattpocock-skills', 'skills/engineering/tdd/SKILL.md', '193b791c489d1640ccfb58d7cbd60fc9e059ef44632b3c92f208784cfe45ab78')],
  'systematic-debugging': [source('mattpocock-skills', 'skills/engineering/diagnosing-bugs/SKILL.md', 'bca66b7141da7d225b7dfd1abf6f2bee657b8044d3897604055e760749c71724')],
  'integration-setup': [source('mattpocock-skills', 'skills/engineering/wizard/SKILL.md', 'dbefb750eae07d9f8b05ab1084f6acfdda2752df2a6b577c46a505e2bc790164')],
  'database-and-migrations': [],
  'frontend-design': [
    source('anthropic-skills', 'skills/frontend-design/SKILL.md', 'b8009ae690dfa69edc7f08bb8715f32db8817112cfa4388741dbaf876c237df8'),
    source('impeccable', 'plugin/skills/impeccable/SKILL.md', '2d2f8400bdecb08ae4c5807be057b6f8b95f28442a1b53dc5646cb3480107176'),
  ],
  'ux-accessibility-review': [
    source('microsoft-skills', '.github/skills/frontend-design-review/SKILL.md', 'a595fe62ad12448d6e3ca3b9b20dd210938e2f8f976a16aff623d44d867c02d7'),
    source('mblode-agent-skills', 'skills/product-design/SKILL.md', '018481a37fad4a3e8024f1edabf81212048e2f583a1c2639c67ef023c2df8c48'),
  ],
  'browser-and-visual-qa': [
    source('addy-agent-skills', 'skills/browser-testing-with-devtools/SKILL.md', '4e3aacd6a380cd25bc6c2d67fdd1c926a9b22535b8a62109ecd33cefd909e3d9'),
    source('gstack', 'qa/SKILL.md', '6fbae04bbd44b15da8c2da08c4d8a7c4365e113a25578972999252e3ffa946dc'),
  ],
  'security-performance-observability': [
    source('addy-agent-skills', 'skills/security-and-hardening/SKILL.md', '287e2a2850f9d9fcec68a0dbf2cf20ee587928beadcef4937aeb120754915cb6'),
    source('addy-agent-skills', 'skills/performance-optimization/SKILL.md', '00694d0c69bbde674d0e39de24052d90afea32d9fef9553eaee21a50a7e9b8cf'),
    source('addy-agent-skills', 'skills/observability-and-instrumentation/SKILL.md', '3170fdbfe029173bf0a2b6969afd6b926c6b5fecaa74d2a5cfee570915f68043'),
  ],
  'git-checkpoint-and-conflicts': [source('mattpocock-skills', 'skills/engineering/resolving-merge-conflicts/SKILL.md', 'd97e7320010bbe7d32313c574acd47cec830d64edd59c956bd0ce2cba84e6ad7')],
  'deployment-and-rollback': [source('gstack', 'land-and-deploy/SKILL.md', '66787168d3d489a4ad188fd72ad0e4f2fc9f292bf5cc166fd7c9b7d575cea56f')],
  'independent-verification': [
    source('superpowers', 'skills/verification-before-completion/SKILL.md', '2befe7fc55bcadaa3d97dd9e8efeb633d2561c0ebe74c5a8b17c4d9e7e4520b3'),
    source('mattpocock-skills', 'skills/engineering/code-review/SKILL.md', '3abbdfe52540f9242e16589fae2cc423b3d98994c37683944462b29bab89495c'),
  ],
};

export function validateSkillProvenance(): string[] {
  const repositories = new Map(AUDITED_SKILL_REPOSITORIES.map(repository => [repository.id, repository]));
  const errors: string[] = [];
  for (const [skillId, sources] of Object.entries(CODEN_SKILL_PROVENANCE)) {
    for (const item of sources) {
      const repository = repositories.get(item.repositoryId);
      if (!repository) errors.push(`${skillId}: unknown repository ${item.repositoryId}`);
      else if (!repository.runtimeEligible) errors.push(`${skillId}: ineligible repository ${item.repositoryId}`);
      if (!/^[a-f0-9]{64}$/.test(item.contentSha256)) errors.push(`${skillId}: invalid content hash`);
    }
  }
  return errors;
}
