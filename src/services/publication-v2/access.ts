import { timingSafeEqual } from 'node:crypto';
import { requireDatabaseResult } from '../database-result.ts';
import { PublicationError, canonicalHost, newOpaqueToken, safeReturnPath, tokenDigest } from './model.ts';
import type { PublicationRepository } from './repository.ts';

export interface VisitorIdentity { id: string; email: string; emailVerified: boolean }
export interface PublicationAccessDependencies {
  repository: PublicationRepository;
  rootDomain: string;
  codenOrigin: string;
  getIdentity(userId: string): Promise<VisitorIdentity | null>;
  isOwnerOrAdmin(projectId: string, userId: string): Promise<boolean>;
  isWorkspaceMember(projectId: string, userId: string): Promise<boolean>;
  workspaceStillAllowed(projectId: string): Promise<boolean>;
  now?: () => number;
}
export function verifyPlatformSecret(actual: unknown, expected: string): boolean {
  if (!expected || typeof actual !== 'string') return false;
  const a = Buffer.from(actual), b = Buffer.from(`Bearer ${expected}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Website access uses its own server-only tables, never Builder membership. */
export class PublicationAccessService {
  constructor(readonly deps: PublicationAccessDependencies) {}
  now() { return this.deps.now?.() ?? Date.now(); }
  async canVisit(projectId: string, userId: string): Promise<boolean> {
    const state = await this.deps.repository.state(projectId);
    if (!state?.enabled || !state.effective) return false;
    if (state.effective.audience === 'public') return true;
    const identity = await this.deps.getIdentity(userId);
    if (!identity?.emailVerified) return false;
    if (await this.deps.isOwnerOrAdmin(projectId, userId)) return true;
    if (state.effective.audience === 'workspace') return await this.deps.workspaceStillAllowed(projectId) && await this.deps.isWorkspaceMember(projectId, userId);
    const invitation: any = await requireDatabaseResult(this.deps.repository.client.from('publication_invitations').select('email').eq('project_id', projectId).eq('email', identity.email.trim().toLowerCase()).maybeSingle(), 'check website invitation');
    return !!invitation;
  }
  async authorize(projectId: string, rawHost: string, token?: string): Promise<Record<string, unknown>> {
    const host = canonicalHost(rawHost);
    const state = await this.deps.repository.state(projectId);
    if (!state?.enabled || !state.effective || !await this.deps.repository.knownHost(projectId, host)) return { allowed: false };
    const base = { release_id: state.release_id, primary_host: `${state.effective.subdomain}.${this.deps.rootDomain}` };
    if (state.effective.audience === 'public') return { ...base, allowed: true, public: true };
    if (token && /^[\w-]{43}$/.test(token)) {
      const session: any = await requireDatabaseResult(this.deps.repository.client.from('publication_visitor_sessions').select('user_id,expires_at').eq('token_hash', tokenDigest(token)).eq('project_id', projectId).eq('host', host).maybeSingle(), 'check website session');
      if (session && Date.parse(session.expires_at) > this.now() && await this.canVisit(projectId, session.user_id)) return { ...base, allowed: true, public: false };
    }
    return { ...base, allowed: false, login_url: `${this.deps.codenOrigin}/publication-auth?project_id=${encodeURIComponent(projectId)}&host=${encodeURIComponent(host)}` };
  }
  async handoff(projectId: string, userId: string, rawHost: string, returnPath: unknown): Promise<string> {
    const host = canonicalHost(rawHost);
    if (!await this.deps.repository.knownHost(projectId, host) || !await this.canVisit(projectId, userId)) throw new PublicationError('SITE_ACCESS_DENIED', 'Ce site n’est pas accessible avec ce compte.', 403);
    const token = newOpaqueToken();
    await requireDatabaseResult(this.deps.repository.client.from('publication_handoffs').insert({ token_hash: tokenDigest(token), project_id: projectId, user_id: userId, host, return_path: safeReturnPath(returnPath), expires_at: new Date(this.now() + 60_000).toISOString() }), 'create website handoff');
    // One-time code, never a Coden auth token. Callback consumes it atomically.
    return `https://${host}/_coden/publication/exchange?code=${encodeURIComponent(token)}&return_path=${encodeURIComponent(safeReturnPath(returnPath))}`;
  }
  async exchange(projectId: string, rawHost: string, code: string): Promise<Record<string, unknown>> {
    const host = canonicalHost(rawHost);
    if (!/^[\w-]{43}$/.test(code) || !await this.deps.repository.knownHost(projectId, host)) throw new PublicationError('INVALID_HANDOFF', 'Connexion expirée. Reconnectez-vous à Coden.', 403);
    const session = newOpaqueToken();
    const maxAge = 15 * 60;
    const row: any = await requireDatabaseResult(this.deps.repository.client.rpc('publication_consume_handoff', { p_hash: tokenDigest(code), p_project: projectId, p_host: host, p_session_hash: tokenDigest(session), p_session_expiry: new Date(this.now() + maxAge * 1000).toISOString() }), 'consume website handoff');
    if (!row || !await this.canVisit(projectId, row.user_id)) {
      await requireDatabaseResult(this.deps.repository.client.from('publication_visitor_sessions').delete().eq('token_hash', tokenDigest(session)), 'revoke denied website session');
      throw new PublicationError('SITE_ACCESS_DENIED', 'Ce site n’est pas accessible avec ce compte.', 403);
    }
    const state = await this.deps.repository.state(projectId);
    return { allowed: true, session_token: session, max_age: maxAge, return_path: safeReturnPath(row.return_path), release_id: state?.release_id, primary_host: state?.effective ? `${state.effective.subdomain}.${this.deps.rootDomain}` : undefined };
  }
}
