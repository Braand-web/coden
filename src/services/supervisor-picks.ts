/**
 * The models a supervisor may move to, found through the one selector.
 *
 * Every pick goes through `selectModel`, so the plan, the credits left, the
 * capabilities the request needs (tools, images, a long context) and the live
 * catalogue all still apply: the supervisor cannot reach a model the user's
 * plan does not grant, and cannot leave the models that can read the images
 * that were attached. A pick returns null when nothing qualifies, and the
 * supervisor moves to the next rung of its ladder.
 */
import { AI_MODEL_CAPABILITIES, MODEL_REGISTRY, type AllowedModelId } from '../config/ai-models.ts';
import { liveBlendedCost, selectModel, type SelectionRequest, type TaskComplexity } from './model-selection.ts';
import type { ModelPick, SupervisorPicks } from './model-supervisor.ts';
import { STRENGTH_RANK } from './model-scoring.ts';

const STRONGER: Record<TaskComplexity, TaskComplexity> = { simple: 'complex', medium: 'complex', complex: 'extreme', extreme: 'extreme' };

const providerOf = (modelId: string) => MODEL_REGISTRY.find(model => model.id === modelId)?.provider;

/** How strong a model is overall: what "stronger" and "at least as strong" are measured by. */
const power = (modelId: string) => {
  const caps = AI_MODEL_CAPABILITIES[modelId as AllowedModelId];
  if (!caps) return 0;
  return [caps.reasoningLevel, caps.codeLevel, caps.agenticLevel, caps.designLevel, caps.securityLevel].reduce((sum, level) => sum + STRENGTH_RANK[level], 0);
};

type Base = Omit<SelectionRequest, 'exclude' | 'requestedModel'>;

export function createSupervisorPicks(base: Base): SupervisorPicks {
  const attempt = (request: SelectionRequest): ModelPick => {
    try {
      const selection = selectModel({ ...request, requestedModel: undefined });
      return { modelId: selection.modelId, reasoningLevel: selection.reasoningLevel };
    } catch {
      return null;
    }
  };
  const complexity = base.complexity || 'medium';

  return {
    stronger(from, exclude) {
      const pick = attempt({ ...base, mode: 'performance', complexity: STRONGER[complexity], allowDegradation: false, exclude });
      // Only a model that really is stronger counts: a model of the same power is a retry in disguise.
      return pick && power(pick.modelId) > power(from) ? { ...pick, reasoningLevel: 'high' } : null;
    },
    otherFamily(from, exclude) {
      const sameFamily = MODEL_REGISTRY.filter(model => model.provider === providerOf(from)).map(model => model.id as AllowedModelId);
      const pick = attempt({ ...base, mode: 'balanced', complexity: STRONGER[complexity], allowDegradation: false, exclude: [...exclude, ...sameFamily] });
      // Not a step down: a different family is worth trying only if it is as capable.
      return pick && power(pick.modelId) >= power(from) ? { ...pick, reasoningLevel: 'high' } : null;
    },
    specialist(need, exclude) {
      if (need === 'long_context') {
        return attempt({ ...base, needs: { ...base.needs, longContext: true }, mode: 'balanced', exclude, estimatedInputTokens: base.estimatedInputTokens });
      }
      const task = need === 'design' ? 'design' : need === 'security' ? 'security' : need === 'performance' ? 'review' : 'debug';
      const pick = attempt({ ...base, task, complexity: STRONGER[complexity], mode: 'performance', allowDegradation: false, exclude });
      return pick ? { ...pick, reasoningLevel: 'high' } : null;
    },
    cheaper(from, exclude) {
      const pick = attempt({ ...base, mode: 'economy', exclude });
      return pick && liveBlendedCost(pick.modelId) < liveBlendedCost(from) ? pick : null;
    },
    opinion(from, exclude) {
      const sameFamily = MODEL_REGISTRY.filter(model => model.provider === providerOf(from)).map(model => model.id as AllowedModelId);
      // The judge does not need tools, only to read; but it must read what the run holds.
      const pick = attempt({ ...base, needs: { ...base.needs, tools: false }, task: 'review', mode: 'performance', complexity: STRONGER[complexity], allowDegradation: false, exclude: [...exclude, ...sameFamily] });
      return pick?.modelId ?? null;
    },
  };
}
