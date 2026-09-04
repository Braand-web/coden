export const CODEN_AGENT_FEATURE_FLAG_NAMES = [
  'CODEN_CONVERSATION_UI_V2',
  'CODEN_ADVANCED_MODES',
  'CODEN_UNIVERSAL_MANIFEST',
  'CODEN_PREVIEW_ADAPTERS',
  'CODEN_FULLSTACK_PREVIEW',
  'CODEN_ROUTER_V2',
  'CODEN_DAG_RUNTIME',
  'CODEN_PARALLEL_WRITERS',
  'CODEN_USER_STEERING',
  'CODEN_DEPLOYMENT_ADAPTERS',
  'CODEN_INDEPENDENT_REVIEW',
] as const;

export type CodenAgentFeatureFlagName = typeof CODEN_AGENT_FEATURE_FLAG_NAMES[number];

export type CodenAgentFeatureFlags = {
  conversationUiV2: boolean;
  advancedModes: boolean;
  universalManifest: boolean;
  previewAdapters: boolean;
  fullstackPreview: boolean;
  routerV2: boolean;
  dagRuntime: boolean;
  parallelWriters: boolean;
  userSteering: boolean;
  deploymentAdapters: boolean;
  independentReview: boolean;
};

function readBooleanFlag(env: Record<string, string | undefined>, key: CodenAgentFeatureFlagName, fallback = true) {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  return !['0', 'false', 'off', 'disabled', 'no'].includes(raw.trim().toLowerCase());
}

export function readCodenAgentFeatureFlags(
  env: Record<string, string | undefined> = typeof process === 'undefined' ? {} : process.env,
): CodenAgentFeatureFlags {
  return {
    conversationUiV2: readBooleanFlag(env, 'CODEN_CONVERSATION_UI_V2'),
    advancedModes: readBooleanFlag(env, 'CODEN_ADVANCED_MODES'),
    universalManifest: readBooleanFlag(env, 'CODEN_UNIVERSAL_MANIFEST'),
    previewAdapters: readBooleanFlag(env, 'CODEN_PREVIEW_ADAPTERS'),
    fullstackPreview: readBooleanFlag(env, 'CODEN_FULLSTACK_PREVIEW'),
    routerV2: readBooleanFlag(env, 'CODEN_ROUTER_V2'),
    dagRuntime: readBooleanFlag(env, 'CODEN_DAG_RUNTIME'),
    parallelWriters: readBooleanFlag(env, 'CODEN_PARALLEL_WRITERS'),
    userSteering: readBooleanFlag(env, 'CODEN_USER_STEERING'),
    deploymentAdapters: readBooleanFlag(env, 'CODEN_DEPLOYMENT_ADAPTERS'),
    independentReview: readBooleanFlag(env, 'CODEN_INDEPENDENT_REVIEW'),
  };
}

