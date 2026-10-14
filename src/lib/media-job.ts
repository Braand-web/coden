/** Public contract: never add supplier/model/diagnostic fields here. */
export type PublicMediaJob = {
  id: string; projectId: string; runId: string; turnId: string;
  kind: 'image' | 'video'; count: number; purpose: string;
  state: 'awaiting_approval' | 'approved' | 'submitting' | 'queued' | 'ready' | 'failed' | 'declined' | 'unknown';
  creditsMax: number; creditsCharged: number; createdAt: string; expiresAt: string;
  assets: Array<{ id: string; path: string; kind: 'image' | 'video'; mime: string; bytes: number; poster?: string }>;
};
