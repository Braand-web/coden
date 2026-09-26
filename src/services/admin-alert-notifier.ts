/**
 * Cost alerts leave the admin console: a Slack message and/or an e-mail.
 *
 * Configuration lives in the server's environment only — never in the
 * database, never sent to a browser:
 *   CODEN_ALERTS_SLACK_WEBHOOK_URL  an incoming-webhook URL on hooks.slack.com
 *   CODEN_ALERTS_EMAIL_TO           up to five addresses, comma-separated
 *   CODEN_ALERTS_EMAIL_FROM         a sender on a domain verified in Resend
 *   RESEND_API_KEY                  Coden's own Resend key
 *
 * The webhook host is pinned to Slack: a URL anywhere else is refused, so a
 * misconfigured variable cannot turn the server into a proxy to an internal
 * address. Messages carry amounts and a masked address, nothing more.
 */

export type NotifierConfig = {
  slackWebhook: string | null;
  emailTo: string[];
  emailFrom: string | null;
  resendKey: string | null;
};

const EMAIL_RE = /^[^\s@<>"',;]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/;

export function safeSlackWebhook(value: string | undefined): string | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.hostname !== 'hooks.slack.com' || url.port || url.username || url.password) return null;
    if (!/^\/services\/[A-Za-z0-9/_-]+$/.test(url.pathname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function readNotifierConfig(env: Record<string, string | undefined> = process.env): NotifierConfig {
  const emailTo = String(env.CODEN_ALERTS_EMAIL_TO || '')
    .split(',')
    .map(item => item.trim())
    .filter(item => EMAIL_RE.test(item))
    .slice(0, 5);
  const from = String(env.CODEN_ALERTS_EMAIL_FROM || '').trim();
  const fromAddress = /<([^>]+)>$/.exec(from)?.[1] || from;
  return {
    slackWebhook: safeSlackWebhook(env.CODEN_ALERTS_SLACK_WEBHOOK_URL),
    emailTo,
    emailFrom: from && EMAIL_RE.test(fromAddress) && !/[\r\n]/.test(from) ? from : null,
    resendKey: String(env.RESEND_API_KEY || '').trim() || null,
  };
}

export function notifierChannels(config: NotifierConfig): Array<'slack' | 'email'> {
  const channels: Array<'slack' | 'email'> = [];
  if (config.slackWebhook) channels.push('slack');
  if (config.emailTo.length && config.emailFrom && config.resendKey) channels.push('email');
  return channels;
}

async function postJson(url: string, body: unknown, headers: Record<string, string>, fetchImpl: typeof fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), redirect: 'error', signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Sends one alert on every configured channel; returns the channels that accepted it. */
export async function sendCostAlert(message: string, config: NotifierConfig, fetchImpl: typeof fetch = fetch): Promise<Array<'slack' | 'email'>> {
  const delivered: Array<'slack' | 'email'> = [];
  const text = message.replace(/[\u0000-\u0008\u000b-\u001f]/g, ' ').slice(0, 1_000);
  if (config.slackWebhook && await postJson(config.slackWebhook, { text: `:warning: ${text}` }, {}, fetchImpl)) delivered.push('slack');
  if (config.emailTo.length && config.emailFrom && config.resendKey) {
    const sent = await postJson('https://api.resend.com/emails', {
      from: config.emailFrom,
      to: config.emailTo,
      subject: text.startsWith('Budget OpenRouter dépassé') ? '[Coden] Budget OpenRouter dépassé' : '[Coden] Budget OpenRouter bientôt atteint',
      text: `${text}\n\nDétails dans la console d’administration, onglet Coûts.`,
    }, { authorization: `Bearer ${config.resendKey}` }, fetchImpl);
    if (sent) delivered.push('email');
  }
  return delivered;
}
