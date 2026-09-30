/**
 * The entrance: content that comes from outside is looked at before an agent reads it.
 *
 * A web page, a command's output, an API answer, a sub-agent's report and a
 * skill written by another agent are all text someone else may have written.
 * Each is scanned for phrasing that tries to give orders; what is found is
 * neutralised in place and the agent is told the content is untrusted data.
 * It is a net, not a wall — the hard rules and the judge still stand behind it.
 */
import { injectionNotice, neutralizeInjection, scanForInjection, type InjectionFinding } from '../injection-scan.ts';
import { containsHardcodedSecret } from './light-check.ts';
import { SECRET_READ } from './hard-rules.ts';

/** Tools whose results are text from outside the project. */
export const EXTERNAL_RESULT_TOOLS = new Set(['fetch_url', 'web_search', 'run_integration_tool', 'run_command', 'get_logs', 'install_package', 'list_integration_tools']);

export type ScreenedResult<T> = { result: T; findings: InjectionFinding[] };

function walk(value: unknown, findings: InjectionFinding[], depth = 0): unknown {
  if (depth > 6 || value == null) return value;
  if (typeof value === 'string') {
    const cleaned = neutralizeInjection(value);
    findings.push(...cleaned.findings);
    return cleaned.text;
  }
  if (Array.isArray(value)) return value.map(item => walk(item, findings, depth + 1));
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, walk(item, findings, depth + 1)]));
  return value;
}

/** A tool result with anything phrased as an order neutralised, and a notice when something was. */
export function screenToolResult<T>(tool: string, result: T): ScreenedResult<T> {
  if (!EXTERNAL_RESULT_TOOLS.has(tool) || !result || typeof result !== 'object') return { result, findings: [] };
  const findings: InjectionFinding[] = [];
  const cleaned = walk(result, findings) as Record<string, unknown>;
  if (!findings.length) return { result, findings: [] };
  return { result: { ...cleaned, untrusted: true, security_note: injectionNotice(findings) } as T, findings };
}

export type ContentVerdict = { ok: true } | { ok: false; reason: string; rule: string };

const HIJACK = /(?:deploy|d[ée]ploie[rz]?|send|envoie[rz]?|delete|supprime[rz]?|upload|publish|publie[rz]?|pay|paie[rz]?)\b[^.\n]{0,80}(?:without (?:asking|telling|the user)|sans (?:demander|pr[ée]venir|l['’]utilisateur))|(?:without asking|sans (?:demander|prévenir)|secretly|en secret|silently)[^.\n]{0,60}(?:send|envoie|deploy|d[ée]ploie|delete|supprime|upload|post|publie)|(?:reveal|print|send|envoie|exfiltrate)[^.\n]{0,40}(?:system prompt|env(?:ironment)? variables?|variables? d['’]environnement|\.env|secrets?|api[_ -]?keys?)|(?:ignore|bypass|disable|désactive|contourne)[^.\n]{0,40}(?:classifier|guard|classifieur|garde-fous?|safety|sécurité|user(?:'s)? (?:rules|instructions))/i;

/** An instruction handed to a sub-agent: it must not smuggle in what the user never asked. */
export function screenDelegation(tasks: Array<{ goal?: unknown; systemPrompt?: unknown; role?: unknown }>): ContentVerdict {
  for (const task of tasks) {
    const text = `${String(task.role ?? '')}\n${String(task.goal ?? '')}\n${String(task.systemPrompt ?? '')}`;
    if (scanForInjection(text).suspicious) return { ok: false, rule: 'delegation_injection', reason: 'Une consigne destinée à un sous-agent ressemble à un ordre venu d’un contenu extérieur, pas à la demande de l’utilisateur.' };
    if (HIJACK.test(text)) return { ok: false, rule: 'delegation_hijack', reason: 'Une consigne destinée à un sous-agent demande une action que l’utilisateur n’a pas demandée.' };
    if (SECRET_READ.test(` ${text} `)) return { ok: false, rule: 'delegation_secret_read', reason: 'Une consigne destinée à un sous-agent demande de lire des variables d’environnement ou des identifiants.' };
    if (containsHardcodedSecret(text)) return { ok: false, rule: 'delegation_secret', reason: 'Une consigne destinée à un sous-agent contient un secret.' };
  }
  return { ok: true };
}

/** What a sub-agent hands back is data for the master, never an order. */
export function screenReturn(summary: string): { text: string; findings: InjectionFinding[] } {
  return neutralizeInjection(summary);
}

/** A skill or agent that would be shared: read as everyone's future prompt, so held to the strictest standard. */
export function screenSharedContent(text: string): ContentVerdict {
  const source = String(text || '');
  if (scanForInjection(source).suspicious) return { ok: false, rule: 'shared_injection', reason: 'Ce contenu contient une consigne déguisée : il ne sera pas partagé.' };
  if (HIJACK.test(source)) return { ok: false, rule: 'shared_hijack', reason: 'Ce contenu demande d’agir sans l’utilisateur ou de contourner la sécurité : il ne sera pas partagé.' };
  if (containsHardcodedSecret(source)) return { ok: false, rule: 'shared_secret', reason: 'Ce contenu contient un secret : il ne sera pas partagé.' };
  if (/(?:curl|wget)\b[^\n|]{0,120}\|\s*(?:ba|z)?sh\b|\beval\s*\(\s*atob|child_process|rm\s+-rf\s+[/~]/i.test(source)) return { ok: false, rule: 'shared_dangerous_command', reason: 'Ce contenu contient une commande dangereuse : il ne sera pas partagé.' };
  return { ok: true };
}
