// Safety filter — LLM Core input/output guard (target architecture Layer 5).
//
// Coden had secret redaction but no toxicity / PII / prompt-injection guard.
// This is a dependency-free, deterministic first line of defense that runs on
// every prompt (input) and every model output (output). It is intentionally
// conservative — it flags and redacts, and only blocks on high-severity input
// (clear malware/abuse). An optional external moderation model can be layered
// on top later; the contract here stays the same.
//
// Pure & unit-tested. Reuses secret-redaction for credential stripping.

import { redactSecrets, containsSecret } from './secret-redaction.ts';

export type SafetyDirection = 'input' | 'output';
export type SafetySeverity = 'none' | 'low' | 'medium' | 'high';

export type SafetyFlag =
  | 'pii_email'
  | 'pii_phone'
  | 'pii_credit_card'
  | 'pii_ssn'
  | 'secret'
  | 'prompt_injection'
  | 'malware_request'
  | 'toxicity';

export type SafetyResult = {
  allowed: boolean;
  severity: SafetySeverity;
  flags: SafetyFlag[];
  /** Text with PII + secrets redacted, safe to log / persist / send onward. */
  sanitized: string;
  /** User-facing reason when blocked (allowed === false). */
  reason?: string;
};

const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
// Credit-card-like: 13-19 digits with optional spaces/dashes in 4-groups.
const CARD_RE = /\b(?:\d[ -]?){13,19}\b/g;
const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/g;
// Phone: international-ish, 9+ digits with separators. Conservative.
const PHONE_RE = /\b(?:\+\d{1,3}[ .-]?)?(?:\(?\d{2,4}\)?[ .-]?){3,5}\b/g;

const PROMPT_INJECTION_RE = /\b(ignore (all|the|your|previous|above)\s+(instructions|prompts?|rules)|disregard (the|all|your)\s+(system|previous)|you are now|reveal (your|the) (system )?prompt|print (your|the) (system )?prompt|jailbreak|developer mode|DAN mode)\b/i;

const MALWARE_RE = /\b(keylogger|ransomware|build (a|me)?\s*(virus|malware|trojan|botnet|rootkit)|ddos (attack|script|tool)|steal (credit cards?|passwords?|credentials)|phishing (kit|page|site)|carding|credential stuffing|sql injection payload to (drop|exfiltrate))\b/i;

const TOXICITY_RE = /\b(kill yourself|kys\b|go die|i('| a)?m going to (kill|hurt|murder)|racial slur)\b/i;

function luhnValid(digits: string): boolean {
  const num = digits.replace(/[^\d]/g, '');
  if (num.length < 13 || num.length > 19) return false;
  let sum = 0;
  let alt = false;
  for (let i = num.length - 1; i >= 0; i--) {
    let d = Number(num[i]);
    if (alt) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function highestSeverity(flags: SafetyFlag[], direction: SafetyDirection): SafetySeverity {
  if (flags.includes('malware_request') || flags.includes('toxicity')) return 'high';
  if (flags.includes('secret') || flags.includes('pii_credit_card') || flags.includes('pii_ssn')) return 'medium';
  if (flags.includes('prompt_injection')) return direction === 'input' ? 'medium' : 'low';
  if (flags.length) return 'low';
  return 'none';
}

export function inspectSafety(text: string, direction: SafetyDirection): SafetyResult {
  const source = String(text || '');
  const flags = new Set<SafetyFlag>();
  let sanitized = source;

  // PII redaction (always sanitize, regardless of allow/block).
  if (EMAIL_RE.test(source)) { flags.add('pii_email'); sanitized = sanitized.replace(EMAIL_RE, '[redacted-email]'); }
  // Credit cards: only treat as PII when Luhn-valid to cut false positives.
  const cardMatches = source.match(CARD_RE) || [];
  if (cardMatches.some(luhnValid)) {
    flags.add('pii_credit_card');
    sanitized = sanitized.replace(CARD_RE, m => (luhnValid(m) ? '[redacted-card]' : m));
  }
  if (SSN_RE.test(source)) { flags.add('pii_ssn'); sanitized = sanitized.replace(SSN_RE, '[redacted-ssn]'); }

  // Secrets (reuse the existing redactor).
  if (containsSecret(source)) { flags.add('secret'); sanitized = redactSecrets(sanitized); }

  // Behavioral flags (no redaction, just classification).
  if (PROMPT_INJECTION_RE.test(source)) flags.add('prompt_injection');
  if (MALWARE_RE.test(source)) flags.add('malware_request');
  if (TOXICITY_RE.test(source)) flags.add('toxicity');

  // Phone last (broad regex) — only flag if no card already consumed the digits.
  if (!flags.has('pii_credit_card') && PHONE_RE.test(source)) {
    const phones = source.match(PHONE_RE) || [];
    if (phones.some(p => (p.replace(/[^\d]/g, '').length >= 9))) {
      flags.add('pii_phone');
      sanitized = sanitized.replace(PHONE_RE, m => (m.replace(/[^\d]/g, '').length >= 9 ? '[redacted-phone]' : m));
    }
  }

  const flagList = Array.from(flags);
  const severity = highestSeverity(flagList, direction);

  // Block policy: only hard-block clearly abusive/malicious INPUT. PII/secrets
  // are redacted but not blocked (the app may legitimately handle user data).
  const blocked = direction === 'input'
    && (flagList.includes('malware_request') || flagList.includes('toxicity'));

  return {
    allowed: !blocked,
    severity,
    flags: flagList,
    sanitized,
    reason: blocked
      ? 'This request asks for harmful or abusive content and was declined.'
      : undefined,
  };
}

/** Convenience wrappers. */
export function inspectInput(text: string): SafetyResult { return inspectSafety(text, 'input'); }
export function inspectOutput(text: string): SafetyResult { return inspectSafety(text, 'output'); }
