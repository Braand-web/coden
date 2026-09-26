import { describe, expect, it, vi } from 'vitest';
import { notifierChannels, readNotifierConfig, safeSlackWebhook, sendCostAlert } from './admin-alert-notifier';

describe('cost alert notifications', () => {
  it('only ever posts to Slack’s own webhook host', () => {
    expect(safeSlackWebhook('https://hooks.slack.com/services/T000/B000/XXXX')).toBe('https://hooks.slack.com/services/T000/B000/XXXX');
    for (const bad of ['http://hooks.slack.com/services/T/B/X', 'https://hooks.slack.com.evil.io/services/T/B/X', 'https://169.254.169.254/latest', 'https://user:pw@hooks.slack.com/services/T/B/X', 'https://hooks.slack.com:8443/services/T/B/X', 'https://hooks.slack.com/api/x', 'javascript:alert(1)']) {
      expect(safeSlackWebhook(bad)).toBeNull();
    }
  });

  it('reads e-mail settings strictly and needs all of them', () => {
    const config = readNotifierConfig({ CODEN_ALERTS_EMAIL_TO: 'ops@coden.fun, bad address, x@y.io\r\nBcc: z@z.io', CODEN_ALERTS_EMAIL_FROM: 'Coden <alerts@coden.fun>', RESEND_API_KEY: 're_x' });
    expect(config.emailTo).toEqual(['ops@coden.fun']);
    expect(notifierChannels(config)).toEqual(['email']);
    expect(notifierChannels(readNotifierConfig({ CODEN_ALERTS_EMAIL_TO: 'ops@coden.fun' }))).toEqual([]);
    expect(readNotifierConfig({ CODEN_ALERTS_EMAIL_FROM: 'x@y.io\r\nBcc: z@z.io' }).emailFrom).toBeNull();
  });

  it('sends on each configured channel and reports what was accepted', async () => {
    const fetchImpl = vi.fn(async (url: string) => ({ ok: !String(url).includes('resend') }) as Response);
    const delivered = await sendCostAlert('Budget OpenRouter dépassé pour toute la plateforme', {
      slackWebhook: 'https://hooks.slack.com/services/T/B/X', emailTo: ['ops@coden.fun'], emailFrom: 'alerts@coden.fun', resendKey: 're_x',
    }, fetchImpl as any);
    expect(delivered).toEqual(['slack']);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect((fetchImpl.mock.calls[0] as any)[1].redirect).toBe('error');
  });
});
