import { describe, expect, it } from 'vitest';
import { balanceLevel, fetchOpenRouterBalance } from './openrouter-balance';

const reply = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('OpenRouter balance', () => {
  it('reads what is left from total credits and usage', async () => {
    const balance = await fetchOpenRouterBalance('sk-test', reply({ data: { total_credits: 100, total_usage: 97.25 } }));
    expect(balance.remaining_usd).toBe(2.75);
    expect(balance.total_credits_usd).toBe(100);
  });

  it('never reports a negative balance and rejects unreadable answers', async () => {
    expect((await fetchOpenRouterBalance('sk-test', reply({ data: { total_credits: 10, total_usage: 12 } }))).remaining_usd).toBe(0);
    await expect(fetchOpenRouterBalance('sk-test', reply({ data: {} }))).rejects.toThrow(/readable/);
    await expect(fetchOpenRouterBalance('sk-test', reply({}, 401))).rejects.toThrow(/401/);
    await expect(fetchOpenRouterBalance('', reply({}))).rejects.toThrow(/not configured/);
  });

  it('warns before generations start failing', () => {
    expect(balanceLevel(50, 20)).toBe('ok');
    expect(balanceLevel(12, 20)).toBe('low');
    expect(balanceLevel(1.5, 20)).toBe('critical');
    expect(balanceLevel(3, 20)).toBe('low');
  });
});
