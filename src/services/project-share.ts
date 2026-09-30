import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Sharing a project by link.
 *
 * The link carries a secret, so the database keeps only its hash: a leak of the table gives nobody a working link, and
 * the link itself is shown once, to the person who creates it — creating another revokes the one before. What the
 * recipient sees is deliberately small: the project's name, a short description and its saved preview. What they can do
 * is make their own copy (services/project-duplicate.ts says what a copy carries and what it leaves behind).
 */
export const SHARE_TTL_DAYS = 30;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32}$/;

export type ShareRow = { id?: string; project_id: string; token_hash: string; created_at?: string; expires_at?: string | null; revoked_at?: string | null; copy_count?: number };

/** 24 random bytes: 192 bits, written as 32 URL-safe characters. */
export function generateShareToken(): string {
  return randomBytes(24).toString('base64url');
}

export function isWellFormedShareToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_PATTERN.test(value);
}

export function hashShareToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

export function shareExpiry(now = Date.now(), days = SHARE_TTL_DAYS): string {
  return new Date(now + days * 86_400_000).toISOString();
}

/** Usable now: not revoked, not past its date. */
export function isShareActive(row: Pick<ShareRow, 'revoked_at' | 'expires_at'> | null | undefined, now = Date.now()): boolean {
  if (!row || row.revoked_at) return false;
  if (!row.expires_at) return true;
  const until = Date.parse(row.expires_at);
  return Number.isFinite(until) && until > now;
}

/** Only the owner gives a project away: an editor works on it, and a platform admin may read it, but neither hands it out. */
export function canShareProject(role: string | null | undefined): boolean {
  return role === 'owner';
}

export type SharedProjectView = { name: string; description: string; preview_html: string; files: number; shared_at: string | null };

/** What the page may show a stranger: never the prompt in full, never an owner, never a file. */
export function sharedProjectView(project: { name?: string | null; prompt?: string | null; preview_html?: string | null }, extras: { files?: number; shared_at?: string | null } = {}): SharedProjectView {
  const description = String(project.prompt || '').replace(/\s+/g, ' ').trim().slice(0, 240);
  return {
    name: String(project.name || 'Projet').slice(0, 120),
    description,
    preview_html: String(project.preview_html || '').slice(0, 400_000),
    files: Math.max(0, Math.round(extras.files || 0)),
    shared_at: extras.shared_at || null,
  };
}
