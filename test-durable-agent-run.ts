import assert from 'node:assert/strict';
import { buildExecutionContract } from './src/services/execution-contract.ts';
import {
  buildDurableCheckpoint,
  buildDurableRunContract,
  decideDurableRunContinuation,
  durablePhaseForEvent,
  nextDurablePhase,
  shouldResumeRecoverableDraft,
} from './src/services/durable-agent-run.ts';

{
  const contract = buildExecutionContract({
    prompt: 'cree une mini app todo avec ajout, suppression, filtres et localStorage',
    hasFiles: false,
  });
  const durable = buildDurableRunContract({ contract, maxAutoFixAttempts: 3 });
  assert.equal(durable.enabled, true);
  assert.equal(durable.resumable, true);
  assert.equal(durable.worker_owned, true);
  assert.equal(durable.no_work_loss, true);
  assert.equal(durable.only_user_visible_stop_without_credit, false);
  assert.ok(durable.phase_plan.includes('generating'));
  assert.ok(durable.phase_plan.includes('testing'));
  assert.ok(durable.terminal_recoverable.includes('needs_fix'));
}

{
  const contract = buildExecutionContract({ prompt: 'bonjour', hasFiles: true });
  const durable = buildDurableRunContract({ contract });
  assert.equal(durable.worker_owned, false);
  assert.deepEqual(durable.phase_plan, ['queued', 'deciding', 'ready']);
}

{
  assert.equal(durablePhaseForEvent('model_started'), 'generating');
  assert.equal(durablePhaseForEvent('runner_started'), 'testing');
  assert.equal(durablePhaseForEvent('auto_fix_started'), 'fixing');
  assert.equal(durablePhaseForEvent('preview_ready'), 'ready');
  assert.equal(nextDurablePhase('testing', 'auto_fix_started'), 'fixing');
}

{
  const credits = decideDurableRunContinuation({ hasCredits: false });
  assert.equal(credits.action, 'stop');
  assert.equal(credits.stop_reason, 'credits_insufficient');
  assert.equal(credits.recoverable, false);
}

{
  const fallback = decideDurableRunContinuation({
    hasCredits: true,
    providerError: true,
    providerFallbackAvailable: true,
  });
  assert.equal(fallback.action, 'fallback_model');
  assert.equal(fallback.terminal, false);
  assert.equal(fallback.recoverable, true);

  const noFallback = decideDurableRunContinuation({
    hasCredits: true,
    providerError: true,
    providerFallbackAvailable: false,
  });
  assert.equal(noFallback.action, 'save_recoverable_draft');
  assert.equal(noFallback.phase, 'needs_fix');
}

{
  const fixing = decideDurableRunContinuation({
    reliabilityStatus: 'failed',
    autoFixAttempts: 1,
    maxAutoFixAttempts: 3,
  });
  assert.equal(fixing.action, 'auto_fix');
  assert.equal(fixing.terminal, false);

  const exhausted = decideDurableRunContinuation({
    reliabilityStatus: 'failed',
    autoFixAttempts: 3,
    maxAutoFixAttempts: 3,
  });
  assert.equal(exhausted.action, 'save_recoverable_draft');
  assert.equal(exhausted.recoverable, true);
}

{
  assert.equal(shouldResumeRecoverableDraft({
    prompt: 'corrige le blocage restant',
    previewStatus: 'needs_fix',
  }), true);
  assert.equal(shouldResumeRecoverableDraft({
    prompt: 'corrige le blocage restant',
    previewStatus: 'ready',
  }), false);
}

{
  const contract = buildExecutionContract({
    prompt: 'cree une mini app pomodoro',
    hasFiles: false,
  });
  const durable = buildDurableRunContract({ contract });
  const checkpoint = buildDurableCheckpoint({
    contract: durable,
    phase: 'testing',
    runId: 'run_1',
    projectId: 'project_1',
    requestId: 'req_1',
    evidence: { runner: 'started' },
  });
  assert.equal(checkpoint.status, 'active');
  assert.equal(checkpoint.resumable, true);
  assert.equal(checkpoint.can_continue_without_user, true);
  assert.equal(checkpoint.evidence.runner, 'started');
}

console.log('durable agent run tests passed');
