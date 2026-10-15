import { requireDatabaseResult } from '../database-result.ts';

/** Delivery runs only after activation. The caller chooses the transport; local
 * fixtures supply a recorder, never Resend/SMTP. A failure cannot unpublish. */
export async function deliverPublicationInvitations(client: any, releaseId: string, url: string, send: (email: string, url: string) => Promise<void>) {
  const rows = await requireDatabaseResult<any[]>(client.from('publication_invitation_outbox').select('id,email').eq('release_id', releaseId).eq('status', 'pending'), 'read invitation outbox') || [];
  for (const row of rows) {
    let delivered = false;
    try { await send(row.email, url); delivered = true; } catch { /* no provider detail or email in public errors */ }
    await requireDatabaseResult(client.from('publication_invitation_outbox').update({ status: delivered ? 'sent' : 'failed', error: delivered ? null : 'DELIVERY_FAILED' }).eq('id', row.id).eq('status', 'pending'), 'record invitation delivery');
  }
}
