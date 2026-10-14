export type MediaKind = 'image' | 'video';
export type MediaModel = {
  key: string; provider: 'fal' | 'openrouter'; model: string; kind: MediaKind;
  ratios: string[]; durations?: number[]; costUsd: number; credits: number;
  verifiedAt: string; quality: 'balanced' | 'premium';
};
export type MediaInput = { modelKey: string; prompt: string; purpose: string; ratio: string; count: number; duration?: number };
export type MediaFile = { id: string; path: string; storagePath: string; kind: MediaKind; mime: string; bytes: number; sha256: string; jobId: string; poster?: { path: string; storagePath: string; bytes: number; sha256: string } };
export type MediaJob = {
  id: string; projectId: string; userId: string; accountId: string; runId: string; turnId: string;
  messageId: string; requestText: string; input: MediaInput; model: MediaModel;
  state: 'awaiting_approval' | 'approved' | 'submitting' | 'queued' | 'ready' | 'failed' | 'declined' | 'unknown';
  createdAt: string; expiresAt: string; revision: number; reservation?: unknown;
  approvedAt?: string; authorization: 'request' | 'confirmation' | null;
  requests: Array<{ state: 'pending' | 'submitting' | 'queued' | 'completed' | 'failed' | 'unknown'; requestId?: string; file?: MediaFile; costUsd?: number }>;
  creditsMax: number; creditsCharged: number; settled: boolean; internalError?: string; leaseUntil?: string;
};
export type MediaScope = { projectId: string; userId: string; accountId: string; runId: string; turnId: string; messageId: string; requestText: string };
export interface MediaStore {
  create(job: MediaJob, fingerprint: string): Promise<MediaJob>;
  get(id: string, scope: Pick<MediaScope, 'projectId' | 'userId'>): Promise<MediaJob | null>;
  save(job: MediaJob, expectedRevision: number): Promise<MediaJob | null>;
  active(limit: number): Promise<MediaJob[]>;
  list(scope: Pick<MediaScope, 'projectId' | 'userId'>): Promise<MediaJob[]>;
  files(scope: Pick<MediaScope, 'projectId' | 'userId'>): Promise<MediaFile[]>;
  addFile(scope: MediaScope, file: MediaFile): Promise<void>;
}
export interface MediaGateway {
  submit(model: MediaModel, input: MediaInput): Promise<{ requestId?: string; bytes?: Uint8Array; url?: string; costUsd?: number }>;
  poll(model: MediaModel, requestId: string): Promise<{ status: 'pending' | 'completed' | 'failed'; bytes?: Uint8Array; url?: string; costUsd?: number }>;
}
export type MediaBilling = {
  reserve(job: MediaJob): Promise<unknown>;
  settle(job: MediaJob, credits: number, costUsd: number): Promise<void>;
  release(job: MediaJob): Promise<void>;
};
export type MediaTools = { schemas: Array<{ name: string; description: string; parameters: Record<string, unknown> }>; call(name: string, args: Record<string, unknown>): Promise<unknown>; guidance: string; restore: () => Promise<void> };
