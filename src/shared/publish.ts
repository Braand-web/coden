/** Public publication contracts. Never include provider credentials or source snapshots. */
export type PublishedAudience = 'public' | 'invite_only' | 'workspace';

export interface PublishSettings {
  subdomain: string;
  audience: PublishedAudience;
  invitations: string[];
  metadata: {
    title: string;
    description: string;
    favicon: string | null;
    image: string | null;
  };
}

export type PublishPhase = 'queued' | 'validating' | 'building' | 'uploading' | 'verifying' | 'activating' | 'completed' | 'failed';
export interface PublishJobProgress {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  phase: PublishPhase;
  message: string;
  sequence: number;
  error?: string;
  recoverable?: boolean;
  reconciliation_required?: boolean;
}

export interface PublicationStatusV2 {
  version: 2;
  proposed_url: string;
  public_url: string | null;
  draft: PublishSettings;
  effective: PublishSettings | null;
  has_unpublished_changes: boolean;
  active_job: PublishJobProgress | null;
  can_publish: boolean;
  can_use_workspace: boolean;
  removal_pending?: boolean;
  checks: Array<{ id: string; label: string; status: 'pass' | 'warn' | 'fail'; detail?: string }>;
  simulation?: boolean;
}
