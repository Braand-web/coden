import { describe, expect, it, vi } from 'vitest';
import { verifyMission } from './mission-verifier';
import { runPlannerAgent } from './planner-agent';
import { transcriptSize, compactTranscript } from './llm-tool-loop';
import { buildMissionContext } from './agent-mission-context';
import { buildResumeBrief } from './resume-brief';
import type { ProviderGateway } from './provider-gateway';

function gatewayFor(outputs: unknown[]) {
  const chat = vi.fn(async () => ({ text: JSON.stringify(outputs.shift()), model: 'openai/gpt-6-luna',
    usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 }, cost_usd: 0.001 }));
  return { gateway: { chat } as unknown as ProviderGateway, chat };
}
const plan = (summary: string) => ({ summary, files: [{ path: 'src/App.tsx', action: 'edit', rationale: summary }], risks: [] });
const satisfied = { status: 'satisfied', reason: 'The requested page is present.', evidence: ['src/App.tsx'] };

describe('mission alignment boundary (mocked model, not a live success metric)', () => {
  it('preserves authenticated corrections received while the agent works', async () => {
    const fake = gatewayFor([satisfied]);
    await verifyMission({ gateway: fake.gateway, modelId: 'openai/gpt-6-luna', request: 'Create a booking page',
      instructions: ['Remove the payment step'], stage: 'artifact', files: [{ path: 'src/App.tsx', content: 'booking' }] });
    const calls = fake.chat.mock.calls as unknown as Array<[string, Array<{ content: string }>, unknown]>;
    expect(JSON.stringify(calls[0][1][1].content)).toContain('currentUserInstructions');
    expect(JSON.stringify(calls[0][1][1].content)).toContain('Remove the payment step');
    expect(calls[0][1][0].content).toContain('latest explicit user correction takes precedence');
  });
  it('rejects a wrong product and replans once against the original request', async () => {
    const fake = gatewayFor([plan('Build a calculator'), { status: 'unsatisfied', reason: 'The request is a dental landing page, not a calculator.', evidence: ['src/App.tsx'] }, plan('Create a dental landing page'), satisfied]);
    const result = await runPlannerAgent({ gateway: fake.gateway, prompt: 'Create a dental landing page. Historical context: simple calculator.',
      userRequest: 'Create a dental landing page', plan: 'pro', selectedModel: 'openai/gpt-6-luna', existingFiles: [] });
    expect(result.summary).toBe('Create a dental landing page');
    expect(fake.chat).toHaveBeenCalledTimes(4);
    expect(result.costUsd).toBeCloseTo(0.004);
    const calls = fake.chat.mock.calls as unknown as Array<[string, Array<{ content: string }>, unknown]>;
    expect(calls[0][1][0].content).not.toContain('The request is for something small');
    expect(calls[0][1][0].content).not.toContain('for a calculator');
    expect(JSON.stringify(calls[1][1][1].content)).toContain('currentUserRequest');
  });
  it('never invents a fallback product when evidence is uncertain', async () => {
    const fake = gatewayFor([plan('Something'), { status: 'uncertain', reason: 'Cannot identify the requested task.', evidence: [] }]);
    await expect(runPlannerAgent({ gateway: fake.gateway, prompt: 'oui', userRequest: 'oui', plan: 'pro', selectedModel: 'openai/gpt-6-luna', existingFiles: [] })).rejects.toThrow('MISSION_ALIGNMENT_REQUIRED');
    expect(fake.chat).toHaveBeenCalledTimes(2);
  });
  it.each([{}, { ...satisfied, evidence: [] }, { ...satisfied, evidence: ['invented.tsx'] }])('does not accept unsupported success: %j', async decision => {
    const fake = gatewayFor([decision]);
    const result = await verifyMission({ gateway: fake.gateway, modelId: 'openai/gpt-6-luna', request: 'Create a booking page', stage: 'artifact', files: [{ path: 'src/App.tsx', content: 'booking' }] });
    expect(result.verdict.status).toBe('uncertain');
  });
  it('accepts a grounded decision and keeps provider failure distinct from a product defect', async () => {
    const fake = gatewayFor([satisfied]);
    expect((await verifyMission({ gateway: fake.gateway, modelId: 'openai/gpt-6-luna', request: 'Create a booking page', stage: 'artifact', files: [{ path: 'src/App.tsx', content: 'booking' }] })).verdict.status).toBe('satisfied');
    fake.chat.mockRejectedValueOnce(new Error('provider unavailable'));
    await expect(verifyMission({ gateway: fake.gateway, modelId: 'openai/gpt-6-luna', request: 'booking', stage: 'artifact', files: [] })).rejects.toThrow('provider unavailable');
  });
});

describe('context and compaction', () => {
  it('does not silently exceed the history budget for one giant assistant message', () => {
    const result = buildMissionContext({ prompt: 'Build a coach website', fileCount: 0, history: [{ role: 'assistant', content: 'x'.repeat(100000) }] });
    expect(result.text.length).toBeLessThan(18000);
    expect(result.text).toContain('latest user request is authoritative');
  });
  it('labels old interrupted work as context, not an instruction to resume it', () => {
    const brief = buildResumeBrief({ turnId: 'old', prompt: 'Create a calculator', round: 2, verified: ['build'] });
    expect(brief).toContain('NOT THE CURRENT REQUEST');
    expect(brief).not.toContain('Continue that work');
    expect(brief).toContain('not evidence for the current revision');
  });
  it('counts write arguments and multipart content before compaction', () => {
    const messages: any[] = [{ role: 'assistant', content: '', tool_calls: [{ id: 't', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: 'src/App.tsx', content: 'x'.repeat(250000) }) } }] },
      { role: 'user', content: [{ type: 'text', text: 'y'.repeat(1000) }] }];
    expect(transcriptSize(messages)).toBeGreaterThan(251000);
    expect(transcriptSize(compactTranscript(messages, 0))).toBeLessThan(3000);
  });
  it('does not mistake image encoding bytes for text tokens', () => {
    const size = transcriptSize([{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,' + 'x'.repeat(2000000), detail: 'high' } }] }]);
    expect(size).toBeGreaterThan(16000);
    expect(size).toBeLessThan(17000);
  });
});
