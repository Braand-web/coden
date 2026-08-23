import { getVerifiedSession, refreshVerifiedSession } from './supabase-browser';
import { getLocalPreviewApiResult, isLocalPreviewEnabled } from '../local-preview';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

export class ApiError extends Error {
  status: number;
  payload: unknown;

  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

function extractApiMessage(payload: unknown, fallback: string): string {
  if (typeof payload === 'object' && payload) {
    const record = payload as { error?: unknown; message?: unknown; diagnostic_code?: unknown; request_id?: unknown };
    const base = typeof record.message === 'string' && record.message.trim()
      ? record.message.trim()
      : typeof record.error === 'string' && record.error.trim()
        ? record.error.trim()
        : '';
    if (base) {
      const diagnostic = typeof record.diagnostic_code === 'string' && record.diagnostic_code.trim()
        ? ` Code: ${record.diagnostic_code.trim()}.`
        : '';
      const requestId = typeof record.request_id === 'string' && record.request_id.trim()
        ? ` Request ID: ${record.request_id.trim()}.`
        : '';
      return `${base}${diagnostic}${requestId}`;
    }
  }
  if (/failed with 5\d\d/i.test(fallback)) {
    return 'The request could not be completed. Please retry in a moment. If it keeps happening, check the server logs for the request ID.';
  }
  return fallback;
}

function isAuthSessionUnavailable(payload: unknown, status: number): boolean {
  if (status !== 401 || typeof payload !== 'object' || !payload) return false;
  const record = payload as { diagnostic_code?: unknown; suggested_action?: unknown };
  return record.diagnostic_code === 'AUTH_SESSION_UNAVAILABLE' || record.suggested_action === 'sign_in_again';
}

function redirectToAuth() {
  window.location.href = `/auth.html?redirect=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}`;
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  if (isLocalPreviewEnabled()) {
    const previewResult = getLocalPreviewApiResult(path, options.method || 'GET');
    if (previewResult.handled) {
      if (previewResult.blocked) {
        throw new ApiError('Cette action est désactivée dans l’aperçu local.', 403, { local_preview: true });
      }
      return previewResult.payload as T;
    }
  }
  let verified = await getVerifiedSession();
  if (!verified?.session?.access_token) {
    verified = await refreshVerifiedSession();
  }
  if (!verified?.session?.access_token) {
    redirectToAuth();
    throw new ApiError('Authentication required', 401, null);
  }

  const buildRequest = (accessToken: string) => ({
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      ...(options.headers || {}),
    },
  });

  let response = await fetch(`${API_BASE_URL}${path}`, buildRequest(verified.session.access_token));
  let payload = await response.json().catch(() => ({}));
  if (!response.ok && isAuthSessionUnavailable(payload, response.status)) {
    verified = await refreshVerifiedSession();
    if (verified?.session?.access_token) {
      response = await fetch(`${API_BASE_URL}${path}`, buildRequest(verified.session.access_token));
      payload = await response.json().catch(() => ({}));
    }
  }

  if (!response.ok) {
    if (isAuthSessionUnavailable(payload, response.status)) redirectToAuth();
    const message = extractApiMessage(payload, `Request failed with ${response.status}`);
    throw new ApiError(message, response.status, payload);
  }

  return payload as T;
}
