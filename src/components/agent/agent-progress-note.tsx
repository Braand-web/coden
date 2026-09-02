'use client';

import { Response } from '../ui/response';
import type { AgentProgressNote as AgentProgressNoteValue } from '../../services/agent-run-store';

export function AgentProgressNote({ note }: { note: AgentProgressNoteValue }) {
  return (
    <div className="coden-agent-progress-note" data-phase={note.phase}>
      <Response className="coden-agent-progress-copy">{note.content}</Response>
      {note.nextAction ? <p className="coden-agent-progress-next">{note.nextAction}</p> : null}
    </div>
  );
}
