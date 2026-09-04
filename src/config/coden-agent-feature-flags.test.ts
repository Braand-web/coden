import { describe, expect, it } from 'vitest';
import { CODEN_AGENT_FEATURE_FLAG_NAMES, readCodenAgentFeatureFlags } from './coden-agent-feature-flags';

describe('Coden Agent OS feature flags', () => {
  it('enables the complete local rollout by default', () => {
    expect(Object.values(readCodenAgentFeatureFlags({})).every(Boolean)).toBe(true);
    expect(CODEN_AGENT_FEATURE_FLAG_NAMES).toHaveLength(11);
  });

  it('accepts explicit disable values without affecting other capabilities', () => {
    const flags = readCodenAgentFeatureFlags({
      CODEN_PREVIEW_ADAPTERS: '0',
      CODEN_USER_STEERING: 'false',
      CODEN_DEPLOYMENT_ADAPTERS: 'off',
    });

    expect(flags.previewAdapters).toBe(false);
    expect(flags.userSteering).toBe(false);
    expect(flags.deploymentAdapters).toBe(false);
    expect(flags.universalManifest).toBe(true);
  });
});

