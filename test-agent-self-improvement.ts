import assert from 'node:assert/strict';

import { buildAgentImprovementSignal, buildUserFeedbackImprovementSignal } from './src/services/agent-self-improvement.ts';

const conversationSignal = buildAgentImprovementSignal({
  prompt: 'bonjour',
  decision: {
    intent: 'conversation',
    requestedMode: 'auto',
    requiresFileChanges: false,
    requiresPreviewRebuild: false,
    understandingCategory: 'conversation',
    userVisibleReason: 'Greeting answered locally.',
    routingSource: 'heuristic',
  },
  outcome: 'answered',
  previewChanged: false,
  qualityStatus: 'not_applicable',
});

assert.equal(conversationSignal.memoryType, 'agent_improvement');
assert.match(conversationSignal.summary, /conversation/);
assert.equal(conversationSignal.payload.recent_decisions[0].preview_changed, false);
assert.equal(conversationSignal.payload.architecture.autonomous_learning.behavior, 'answer_without_preview_change');
assert.equal(
  conversationSignal.payload.ui_preferences.stream_policy,
  'stream_answer_in_chat_only_without_preview_or_build_loader',
);

const generatedSignal = buildAgentImprovementSignal({
  prompt: 'Create a todo app',
  decision: {
    intent: 'build',
    requestedMode: 'auto',
    requiresFileChanges: true,
    requiresPreviewRebuild: true,
    understandingCategory: 'app',
    userVisibleReason: 'Build a focused app.',
    routingSource: 'ai',
  },
  outcome: 'generated',
  previewChanged: true,
  qualityStatus: 'passed',
  issueCount: 0,
});

assert.equal(generatedSignal.payload.recent_decisions[0].preview_changed, true);
assert.equal(generatedSignal.payload.architecture.autonomous_learning.behavior, 'file_action_after_intent_confirmation');
assert.equal(generatedSignal.payload.architecture.autonomous_learning.quality_status, 'passed');
assert.equal(
  generatedSignal.payload.ui_preferences.stream_policy,
  'show_real_agent_steps_and_keep_trace_after_completion',
);

const feedbackSignal = buildUserFeedbackImprovementSignal({
  feedback: 'reject',
  rating: 'negative',
  reasons: ['instructions_not_followed', 'lost_context'],
  comment: 'Coden generated an app when I only asked for advice.',
  role: 'assistant',
  messageExcerpt: 'I created the app.',
  source: 'message_hover_toolbar',
});

assert.equal(feedbackSignal.memoryType, 'agent_feedback_learning');
assert.equal(feedbackSignal.payload.architecture.feedback_learning.negative_feedback_requires_attention, true);
assert.equal(feedbackSignal.payload.recent_decisions[0].reasons.length, 2);
assert.match(feedbackSignal.payload.ui_preferences.feedback_policy, /prefer_clarification/);
assert.equal(feedbackSignal.payload.known_errors.length, 1);

console.log('agent-self-improvement tests passed');
