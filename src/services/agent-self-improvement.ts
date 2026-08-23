type ImprovementDecision = {
  intent?: string;
  requestedMode?: string;
  requiresFileChanges?: boolean;
  requiresPreviewRebuild?: boolean;
  understandingCategory?: string;
  userVisibleReason?: string;
  routingSource?: string;
};

type ImprovementInput = {
  prompt: string;
  decision: ImprovementDecision;
  outcome: 'answered' | 'clarified' | 'planned' | 'verified' | 'deployed_guidance' | 'generated' | 'failed' | 'cancelled';
  previewChanged?: boolean;
  qualityStatus?: string;
  issueCount?: number;
};

type UserFeedbackInput = {
  feedback: string;
  rating?: 'positive' | 'negative' | null;
  reasons?: string[];
  comment?: string;
  role?: string | null;
  messageExcerpt?: string;
  source?: string;
};

function compact(value: unknown, limit = 180) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}...` : text;
}

export function buildAgentImprovementSignal(input: ImprovementInput) {
  const decision = input.decision || {};
  const category = decision.understandingCategory || 'other';
  const changedFiles = Boolean(decision.requiresFileChanges || input.previewChanged);
  const safeBehavior = changedFiles
    ? 'file_action_after_intent_confirmation'
    : 'answer_without_preview_change';
  const qualityStatus = input.qualityStatus || (changedFiles ? 'unchecked' : 'not_applicable');
  const issueCount = Math.max(0, Number(input.issueCount || 0));

  const summary = [
    'Autonomous improvement signal.',
    `Intent ${decision.intent || 'unknown'} in category ${category}.`,
    `Outcome ${input.outcome}.`,
    `Behavior ${safeBehavior}.`,
    `Quality ${qualityStatus}${issueCount ? ` with ${issueCount} issue(s)` : ''}.`,
  ].join(' ');

  return {
    memoryType: 'agent_improvement',
    summary,
    payload: {
      architecture: {
        autonomous_learning: {
          last_intent: decision.intent || 'unknown',
          intent_category: category,
          requested_mode: decision.requestedMode || 'auto',
          routing_source: decision.routingSource || 'heuristic',
          preview_changed: Boolean(input.previewChanged),
          quality_status: qualityStatus,
          issue_count: issueCount,
          behavior: safeBehavior,
          updated_at: new Date().toISOString(),
        },
      },
      recent_decisions: [{
        intent: decision.intent || 'unknown',
        category,
        outcome: input.outcome,
        preview_changed: Boolean(input.previewChanged),
        summary: compact(decision.userVisibleReason || input.prompt, 220),
        created_at: new Date().toISOString(),
      }],
      ui_preferences: {
        stream_policy: changedFiles
          ? 'show_real_agent_steps_and_keep_trace_after_completion'
          : 'stream_answer_in_chat_only_without_preview_or_build_loader',
      },
    },
  };
}

export function buildUserFeedbackImprovementSignal(input: UserFeedbackInput) {
  const rating = input.rating || (input.feedback === 'keep' ? 'positive' : input.feedback === 'reject' ? 'negative' : null);
  const reasons = (input.reasons || []).slice(0, 8);
  const comment = compact(input.comment, 360);
  const messageExcerpt = compact(input.messageExcerpt, 260);
  const isNegative = rating === 'negative' || input.feedback === 'reject';
  const reasonCopy = reasons.length ? ` Reasons: ${reasons.join(', ')}.` : '';
  const commentCopy = comment ? ` Comment: ${comment}` : '';

  const summary = [
    'User feedback learning signal.',
    `Rating ${rating || input.feedback || 'unknown'} from ${input.source || 'builder'}.`,
    input.role ? `Message role ${input.role}.` : '',
    reasonCopy.trim(),
    commentCopy.trim(),
  ].filter(Boolean).join(' ');

  return {
    memoryType: 'agent_feedback_learning',
    summary,
    payload: {
      architecture: {
        feedback_learning: {
          last_rating: rating,
          last_feedback: input.feedback,
          last_source: input.source || 'builder',
          negative_feedback_requires_attention: isNegative,
          updated_at: new Date().toISOString(),
        },
      },
      recent_decisions: [{
        type: 'user_feedback',
        rating,
        feedback: input.feedback,
        reasons,
        comment,
        role: input.role || null,
        message_excerpt: messageExcerpt,
        created_at: new Date().toISOString(),
      }],
      ui_preferences: {
        feedback_policy: isNegative
          ? 'prefer_clarification_and_specific_corrections_when_similar_feedback_reappears'
          : 'preserve_response_style_and_agent_behavior_when_similar_requests_reappear',
      },
      known_errors: isNegative ? [{
        source: input.source || 'builder',
        reasons,
        comment,
        message_excerpt: messageExcerpt,
        created_at: new Date().toISOString(),
      }] : [],
    },
  };
}
