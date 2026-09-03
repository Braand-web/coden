/**
 * The credential the preview iframe carries.
 *
 * A dev server's own requests -- modules, assets, the hot-reload socket --
 * are made by the browser, not by our code, so they cannot carry an
 * Authorization header. The alternative most reach for is a cookie, but the
 * preview is embedded cross-context in an iframe and a cookie there is at the
 * mercy of the browser's partitioning rules; the day it is dropped, the
 * preview 401s with no explanation.
 *
 * So the grant lives in the path. It is signed, scoped to one project and one
 * user, and expires -- a URL someone copies out of the network tab stops
 * working, and it never grants anything but that one project's preview.
 */

import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';

export type PreviewGrant = { projectId: string; userId: string; expiresAt: number };

const DEFAULT_TTL_MS = 8 * 60 * 60_000;

/**
 * The signing key.
 *
 * Falls back to a per-process random secret rather than a constant: a shared
 * default in source is not a secret, and a restart invalidating outstanding
 * preview URLs is a far smaller problem than anyone being able to mint them.
 */
let processSecret: Buffer | null = null;
function signingKey(): Buffer {
  const configured = process.env.CODEN_PREVIEW_TOKEN_SECRET;
  if (configured) return Buffer.from(configured, 'utf8');
  if (!processSecret) processSecret = randomBytes(32);
  return processSecret;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function sign(payload: string): string {
  return createHmac('sha256', signingKey()).update(payload).digest('base64url');
}

export function issuePreviewToken(grant: Omit<PreviewGrant, 'expiresAt'> & { ttlMs?: number }): string {
  const expiresAt = Date.now() + (grant.ttlMs ?? DEFAULT_TTL_MS);
  const payload = base64url(JSON.stringify({ p: grant.projectId, u: grant.userId, e: expiresAt }));
  return `${payload}.${sign(payload)}`;
}

/**
 * Read a token, or return null.
 *
 * Never throws and never explains: a caller distinguishing "bad signature"
 * from "expired" gives an attacker a way to tell whether a forgery was close.
 * The proxy only needs to know whether to serve.
 */
export function readPreviewToken(token: unknown): PreviewGrant | null {
  const raw = String(token || '');
  const separator = raw.lastIndexOf('.');
  if (separator <= 0) return null;
  const payload = raw.slice(0, separator);
  const provided = Buffer.from(raw.slice(separator + 1), 'base64url');
  const expected = Buffer.from(sign(payload), 'base64url');
  // Compare in constant time, and only when the lengths already match --
  // timingSafeEqual throws on a mismatch, which would itself be a signal.
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const grant: PreviewGrant = { projectId: String(decoded.p), userId: String(decoded.u), expiresAt: Number(decoded.e) };
    if (!grant.projectId || !grant.userId || !Number.isFinite(grant.expiresAt)) return null;
    if (grant.expiresAt <= Date.now()) return null;
    return grant;
  } catch {
    return null;
  }
}
