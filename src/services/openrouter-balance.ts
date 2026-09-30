/**
 * What is left on Coden's OpenRouter account.
 *
 * Every generation is paid from this one balance. When it runs low OpenRouter
 * first shrinks what each answer may cost ("can only afford N tokens"), then
 * refuses — and generations degrade before they fail. The admin console shows
 * the balance and the operator is alerted before that point.
 *
 * GET https://openrouter.ai/api/v1/credits → { data: { total_credits, total_usage } }
 */
export type OpenRouterBalance = { total_credits_usd: number; total_usage_usd: number; remaining_usd: number; fetched_at: string };

export async function fetchOpenRouterBalance(apiKey: string, fetchImpl: typeof fetch = fetch, timeoutMs = 8_000): Promise<OpenRouterBalance> {
  const key = String(apiKey || '').trim();
  if (!key) throw new Error('OpenRouter is not configured.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl('https://openrouter.ai/api/v1/credits', {
      headers: { authorization: `Bearer ${key}` },
      redirect: 'error',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`OpenRouter credits HTTP ${response.status}`);
    const body: any = await response.json();
    const credits = Number(body?.data?.total_credits);
    const usage = Number(body?.data?.total_usage);
    if (!Number.isFinite(credits) || !Number.isFinite(usage)) throw new Error('OpenRouter credits response is not readable.');
    const round = (value: number) => Math.round(value * 10_000) / 10_000;
    return { total_credits_usd: round(credits), total_usage_usd: round(usage), remaining_usd: round(Math.max(0, credits - usage)), fetched_at: new Date().toISOString() };
  } finally {
    clearTimeout(timer);
  }
}

/** How the balance reads: fine, low (warn), critical (generations about to fail). */
export function balanceLevel(remainingUsd: number, lowThresholdUsd: number): 'ok' | 'low' | 'critical' {
  if (remainingUsd < Math.min(2, lowThresholdUsd / 5)) return 'critical';
  if (remainingUsd < lowThresholdUsd) return 'low';
  return 'ok';
}
