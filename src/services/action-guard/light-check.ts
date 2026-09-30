/**
 * Tier 2: changes to the user's own project.
 *
 * They pass, after a check that costs nothing: no secret or key written in
 * clear into the code, and a run that is not quietly deleting the project.
 * The design layer, protected scaffold files and paths outside the project are
 * defended elsewhere (sandbox tools, hard rules); this is the part only the
 * content can tell.
 */
import type { ToolAction } from './action-types.ts';

/** Keys written into source: provider-shaped tokens and private keys. A publishable key is not among them. */
const SECRET_SHAPES = [
  /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}/,
  /\bwhsec_[A-Za-z0-9]{16,}/,
  /\bsk-(?:ant|or|proj)-[A-Za-z0-9_-]{20,}/,
  /\bsk-[A-Za-z0-9]{40,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bghp_[A-Za-z0-9]{30,}/,
  /\bgithub_pat_[A-Za-z0-9_]{40,}/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
];

/** A JWT is only a secret when it is a service-role key: the anon key is meant to ship in the front end. */
function serviceRoleJwt(text: string): boolean {
  for (const match of text.matchAll(/\beyJ[A-Za-z0-9_-]{10,}\.(eyJ[A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}/g)) {
    try {
      const payload = JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8'));
      if (payload?.role === 'service_role') return true;
    } catch { /* not a decodable token */ }
  }
  return false;
}

export function containsHardcodedSecret(text: string): boolean {
  const source = String(text || '');
  return SECRET_SHAPES.some(shape => shape.test(source)) || serviceRoleJwt(source);
}

export type LightVerdict = { ok: true } | { ok: false; rule: string; reason: string };

/** Paths whose whole purpose is holding a placeholder for a key. */
const PLACEHOLDER_PATHS = /(?:^|\/)\.env\.(?:example|sample|template)$/i;

export function lightCheck(action: ToolAction): LightVerdict {
  const { tool, args } = action;
  if (tool !== 'write_file' && tool !== 'edit_file') return { ok: true };
  const path = String(args.path ?? '');
  const body = tool === 'write_file' ? String(args.content ?? '') : String(args.replace ?? '');
  if (PLACEHOLDER_PATHS.test(path)) return { ok: true };
  if (containsHardcodedSecret(body)) {
    return {
      ok: false,
      rule: 'secret_in_code',
      reason: 'Un secret ou une clé privée est écrit en clair dans le code. Utilise une variable d’environnement (import.meta.env.VITE_…) et demande la clé à l’utilisateur au lieu de l’écrire.',
    };
  }
  return { ok: true };
}

/** Deleting this many files in one run stops being tidying and becomes a decision. */
export const MASS_DELETE_THRESHOLD = 8;
