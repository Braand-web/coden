import { FileText, Pencil } from 'lucide-react';
import type { ToolPart } from './agent-parts';
export function AgentToolLine({ part }: { part: ToolPart }) {
  const Icon = part.kind === 'read' ? FileText : Pencil;
  return <div className="coden-tool-line"><Icon size={15} strokeWidth={1.6} aria-hidden="true" /><span>{part.verb}</span><span className="coden-tool-paths" title={part.files.join(', ')}>{part.files.join(', ')}</span></div>;
}
