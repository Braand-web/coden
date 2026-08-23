export type CodenMediaKind =
  | 'launch_kit'
  | 'campaign_pack'
  | 'social_posts'
  | 'ads_creatives'
  | 'brand_assets'
  | 'pitch_one_pager'
  | 'video_ad'
  | 'ugc'
  | 'storyboard'
  | 'product_image'
  | 'social_creative'
  | 'thumbnail';

export type CodenMediaFormat = '9:16' | '1:1' | '4:5' | '16:9' | '3:4';
export type CodenMediaDuration = '5s' | '8s' | '10s' | '15s' | '30s';
export type CodenMediaModelPreference =
  | 'auto'
  | 'best_quality'
  | 'fast'
  | 'seedance'
  | 'veo'
  | 'sora'
  | 'kling'
  | 'flux'
  | 'openai_image';

export type CodenMediaModelId =
  | 'coden/media-kit'
  | 'bytedance/seedance-2.0/fast/text-to-video'
  | 'bytedance/seedance-2.0/text-to-video'
  | 'fal-ai/veo3.1'
  | 'fal-ai/sora-2/text-to-video/pro'
  | 'fal-ai/kling-video/v3/pro/text-to-video'
  | 'fal-ai/flux-2-pro'
  | 'fal-ai/gpt-image-2';

export type CodenMediaSettings = {
  kind: CodenMediaKind;
  format: CodenMediaFormat;
  duration: CodenMediaDuration;
  modelPreference: CodenMediaModelPreference;
};

export type CodenMediaModelDefinition = {
  id: CodenMediaModelId;
  label: string;
  family: 'coden' | 'seedance' | 'veo' | 'sora' | 'kling' | 'flux' | 'openai';
  output: 'marketing_kit' | 'video' | 'image';
  quality: 'fast' | 'balanced' | 'premium';
  endpointId: string;
  recommendedFor: CodenMediaKind[];
  creditBase: number;
  creditPerSecond?: number;
  minPlan: 'free' | 'pro' | 'scale' | 'enterprise';
};

export const MEDIA_MODEL_REGISTRY: CodenMediaModelDefinition[] = [
  {
    id: 'coden/media-kit',
    label: 'Coden Marketing Kit',
    family: 'coden',
    output: 'marketing_kit',
    quality: 'balanced',
    endpointId: 'internal-marketing-kit',
    recommendedFor: ['launch_kit', 'campaign_pack', 'social_posts', 'ads_creatives', 'brand_assets', 'pitch_one_pager'],
    creditBase: 4,
    minPlan: 'free',
  },
  {
    id: 'bytedance/seedance-2.0/fast/text-to-video',
    label: 'Seedance 2.0 Fast',
    family: 'seedance',
    output: 'video',
    quality: 'fast',
    endpointId: 'bytedance/seedance-2.0/fast/text-to-video',
    recommendedFor: ['video_ad', 'ugc', 'storyboard', 'social_creative'],
    creditBase: 8,
    creditPerSecond: 2,
    minPlan: 'pro',
  },
  {
    id: 'bytedance/seedance-2.0/text-to-video',
    label: 'Seedance 2.0',
    family: 'seedance',
    output: 'video',
    quality: 'balanced',
    endpointId: 'bytedance/seedance-2.0/text-to-video',
    recommendedFor: ['video_ad', 'ugc', 'storyboard', 'social_creative'],
    creditBase: 10,
    creditPerSecond: 3,
    minPlan: 'pro',
  },
  {
    id: 'fal-ai/veo3.1',
    label: 'Veo 3.1',
    family: 'veo',
    output: 'video',
    quality: 'premium',
    endpointId: 'fal-ai/veo3.1',
    recommendedFor: ['video_ad', 'storyboard', 'social_creative'],
    creditBase: 18,
    creditPerSecond: 5,
    minPlan: 'scale',
  },
  {
    id: 'fal-ai/sora-2/text-to-video/pro',
    label: 'Sora 2 Pro',
    family: 'sora',
    output: 'video',
    quality: 'premium',
    endpointId: 'fal-ai/sora-2/text-to-video/pro',
    recommendedFor: ['video_ad', 'storyboard', 'social_creative'],
    creditBase: 18,
    creditPerSecond: 5,
    minPlan: 'scale',
  },
  {
    id: 'fal-ai/kling-video/v3/pro/text-to-video',
    label: 'Kling 3.0 Pro',
    family: 'kling',
    output: 'video',
    quality: 'premium',
    endpointId: 'fal-ai/kling-video/v3/pro/text-to-video',
    recommendedFor: ['video_ad', 'ugc', 'storyboard'],
    creditBase: 16,
    creditPerSecond: 4,
    minPlan: 'scale',
  },
  {
    id: 'fal-ai/flux-2-pro',
    label: 'FLUX.2 Pro',
    family: 'flux',
    output: 'image',
    quality: 'premium',
    endpointId: 'fal-ai/flux-2-pro',
    recommendedFor: ['product_image', 'social_creative', 'thumbnail'],
    creditBase: 6,
    minPlan: 'pro',
  },
  {
    id: 'fal-ai/gpt-image-2',
    label: 'OpenAI Image',
    family: 'openai',
    output: 'image',
    quality: 'balanced',
    endpointId: 'fal-ai/gpt-image-2',
    recommendedFor: ['product_image', 'social_creative', 'thumbnail'],
    creditBase: 5,
    minPlan: 'pro',
  },
];

const MEDIA_KINDS = new Set<CodenMediaKind>([
  'launch_kit',
  'campaign_pack',
  'social_posts',
  'ads_creatives',
  'brand_assets',
  'pitch_one_pager',
  'video_ad',
  'ugc',
  'storyboard',
  'product_image',
  'social_creative',
  'thumbnail',
]);

const MEDIA_FORMATS = new Set<CodenMediaFormat>(['9:16', '1:1', '4:5', '16:9', '3:4']);
const MEDIA_DURATIONS = new Set<CodenMediaDuration>(['5s', '8s', '10s', '15s', '30s']);
const MEDIA_MODEL_PREFERENCES = new Set<CodenMediaModelPreference>([
  'auto',
  'best_quality',
  'fast',
  'seedance',
  'veo',
  'sora',
  'kling',
  'flux',
  'openai_image',
]);

export function normalizeMediaSettings(value: any): CodenMediaSettings {
  const kind = MEDIA_KINDS.has(value?.kind) ? value.kind : 'launch_kit';
  const format = MEDIA_FORMATS.has(value?.format) ? value.format : '9:16';
  const duration = MEDIA_DURATIONS.has(value?.duration) ? value.duration : '8s';
  const modelPreference = MEDIA_MODEL_PREFERENCES.has(value?.modelPreference)
    ? value.modelPreference
    : 'auto';

  return { kind, format, duration, modelPreference };
}

export function mediaDurationSeconds(duration: CodenMediaDuration): number {
  return Number(duration.replace('s', '')) || 8;
}

export function isMarketingMediaKind(kind: CodenMediaKind) {
  return kind === 'launch_kit'
    || kind === 'campaign_pack'
    || kind === 'social_posts'
    || kind === 'ads_creatives'
    || kind === 'brand_assets'
    || kind === 'pitch_one_pager';
}

export function mediaOutputForKind(kind: CodenMediaKind): 'marketing_kit' | 'video' | 'image' | 'storyboard' {
  if (isMarketingMediaKind(kind)) return 'marketing_kit';
  if (kind === 'product_image' || kind === 'thumbnail') return 'image';
  if (kind === 'storyboard') return 'storyboard';
  return 'video';
}

function planRank(plan: string) {
  const normalized = String(plan || 'free').toLowerCase();
  if (normalized === 'enterprise') return 3;
  if (normalized === 'scale') return 2;
  if (normalized === 'pro') return 1;
  return 0;
}

export function isMediaModelAvailable(model: CodenMediaModelDefinition, plan: string) {
  return planRank(plan) >= planRank(model.minPlan);
}

export function selectMediaModel(settings: CodenMediaSettings, plan = 'free'): CodenMediaModelDefinition {
  const output = mediaOutputForKind(settings.kind);
  const desiredOutput = output === 'marketing_kit' ? 'marketing_kit' : output === 'image' ? 'image' : 'video';
  const available = MEDIA_MODEL_REGISTRY.filter(model => (
    model.output === desiredOutput
    && model.recommendedFor.includes(settings.kind)
    && isMediaModelAvailable(model, plan)
  ));
  const candidates = available.length
    ? available
    : MEDIA_MODEL_REGISTRY.filter(model => model.output === desiredOutput && model.recommendedFor.includes(settings.kind));

  const byFamily = (family: CodenMediaModelDefinition['family']) => candidates.find(model => model.family === family) || candidates[0];

  if (settings.modelPreference === 'fast') {
    return candidates.find(model => model.quality === 'fast') || candidates[0];
  }
  if (settings.modelPreference === 'best_quality') {
    return [...candidates].reverse().find(model => model.quality === 'premium') || candidates[0];
  }
  if (settings.modelPreference === 'seedance') return byFamily('seedance');
  if (settings.modelPreference === 'veo') return byFamily('veo');
  if (settings.modelPreference === 'sora') return byFamily('sora');
  if (settings.modelPreference === 'kling') return byFamily('kling');
  if (settings.modelPreference === 'flux') return byFamily('flux');
  if (settings.modelPreference === 'openai_image') return byFamily('openai');

  if (desiredOutput === 'image') {
    return candidates.find(model => model.family === 'flux') || candidates[0];
  }
  return candidates.find(model => model.quality === 'fast') || candidates[0];
}

export function estimateMediaCredits(settings: CodenMediaSettings, model: CodenMediaModelDefinition): number {
  if (model.output === 'marketing_kit') {
    const kitCredits: Record<CodenMediaKind, number> = {
      launch_kit: 6,
      campaign_pack: 8,
      social_posts: 4,
      ads_creatives: 6,
      brand_assets: 5,
      pitch_one_pager: 10,
      video_ad: model.creditBase,
      ugc: model.creditBase,
      storyboard: model.creditBase,
      product_image: model.creditBase,
      social_creative: model.creditBase,
      thumbnail: model.creditBase,
    };
    return kitCredits[settings.kind] || model.creditBase;
  }
  if (model.output === 'image') return model.creditBase;
  const duration = mediaDurationSeconds(settings.duration);
  return Math.max(model.creditBase, model.creditBase + Math.ceil(duration * (model.creditPerSecond || 2)));
}

export function mediaSettingsSummary(settings: CodenMediaSettings) {
  const kindLabels: Record<CodenMediaKind, string> = {
    launch_kit: 'Launch kit',
    campaign_pack: 'Campaign pack',
    social_posts: 'Social posts',
    ads_creatives: 'Ads creatives',
    brand_assets: 'Brand assets',
    pitch_one_pager: 'Pitch / one-pager',
    video_ad: 'Video ad',
    ugc: 'UGC',
    storyboard: 'Storyboard',
    product_image: 'Product image',
    social_creative: 'Social creative',
    thumbnail: 'Thumbnail',
  };
  return `${kindLabels[settings.kind]} · ${settings.format} · ${settings.duration} · ${settings.modelPreference.replace(/_/g, ' ')}`;
}
