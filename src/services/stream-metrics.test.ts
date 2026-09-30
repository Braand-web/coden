import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { recordStream, resetStreamMetrics, streamMetrics } from './stream-metrics';

describe('stream metrics', () => {
  beforeEach(() => { resetStreamMetrics(); vi.spyOn(console, 'info').mockImplementation(() => undefined); });

  it('says how many streams were cut and how many follow-ups reached the end of the run', () => {
    for (let i = 0; i < 10; i += 1) recordStream('started');
    recordStream('interrupted'); recordStream('interrupted');
    for (let i = 0; i < 4; i += 1) recordStream('resume_started');
    for (let i = 0; i < 3; i += 1) recordStream('resume_completed');
    recordStream('resume_abandoned');
    const metrics = streamMetrics();
    expect(metrics.interruptedRate).toBe(0.2);
    expect(metrics.resumeSuccessRate).toBe(0.75);
    expect(metrics.resume_abandoned).toBe(1);
  });

  it('has no rate before there is anything to divide', () => {
    expect(streamMetrics().interruptedRate).toBeNull();
    expect(streamMetrics().resumeSuccessRate).toBeNull();
  });

  it('is wired to the run stream, the replay route (which no longer waits for a socket that left) and the admin', () => {
    const server = readFileSync('server.ts', 'utf8');
    expect(server).toMatch(/onTransportLost: \(\) => recordStream\('interrupted'/);
    expect(server).toMatch(/recordStream\('resume_started'/);
    expect(server).toMatch(/terminalEnvelopeSeen \? 'resume_completed'/);
    expect(server).toMatch(/res\.once\('drain', done\); res\.once\('close', done\)/);
    expect(server).toMatch(/app\.get\('\/api\/admin\/streaming\/overview'/);
  });
});
