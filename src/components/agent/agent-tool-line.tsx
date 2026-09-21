import { useId, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ChevronRight, FileText, Pencil } from 'lucide-react';
import type { ToolPart } from './agent-parts';

/**
 * What the run touched, in one line, with the detail one click away.
 *
 * The paths used to be joined with commas onto a single line and clipped with
 * an ellipsis, so a step that wrote six files showed two names and a `…`: the
 * information was on screen and unreadable at the same time. A count is honest
 * about there being more, and the list is there for whoever wants it.
 *
 * Collapsed by default, and only foldable when there is something folded — a
 * single file is its own summary, and a disclosure control that reveals the
 * line you are already reading is noise.
 */
export function AgentToolLine({ part }: { part: ToolPart }) {
  const reduced = useReducedMotion();
  const [open, setOpen] = useState(false);
  const listId = useId();

  const Icon = part.kind === 'read' ? FileText : Pencil;
  const collapsible = part.files.length > 1;
  const expanded = open && collapsible;
  const summary = part.files.length === 1
    ? part.files[0]
    : `${part.files.length} fichiers`;

  return (
    <motion.div
      className="coden-tool-block"
      initial={reduced ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduced ? 0 : 0.3, ease: [0.22, 1, 0.36, 1] }}
    >
      {/*
        * A button only when it does something.
        *
        * Rendering a disabled-looking button for a single file would put a
        * focus stop in the tab order that leads nowhere.
        */}
      {collapsible ? (
        <button
          type="button"
          className="coden-tool-line"
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => setOpen(value => !value)}
        >
          <Icon size={15} strokeWidth={1.6} aria-hidden="true" />
          <span className="coden-tool-verb">{part.verb}</span>
          <span className="coden-tool-paths">{summary}</span>
          <motion.span
            className="coden-tool-chevron"
            aria-hidden="true"
            animate={{ rotate: expanded ? 90 : 0 }}
            transition={{ duration: reduced ? 0 : 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            <ChevronRight size={13} strokeWidth={2} />
          </motion.span>
        </button>
      ) : (
        <div className="coden-tool-line">
          <Icon size={15} strokeWidth={1.6} aria-hidden="true" />
          <span className="coden-tool-verb">{part.verb}</span>
          {part.files.length ? <span className="coden-tool-paths" title={summary}>{summary}</span> : null}
        </div>
      )}

      <AnimatePresence initial={false}>
        {expanded ? (
          <motion.ul
            id={listId}
            className="coden-tool-files"
            initial={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
            animate={reduced ? { opacity: 1 } : { opacity: 1, height: 'auto' }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
            transition={{ duration: reduced ? 0 : 0.26, ease: [0.22, 1, 0.36, 1] }}
          >
            {part.files.map(file => (
              <li key={file} title={file}>{file}</li>
            ))}
          </motion.ul>
        ) : null}
      </AnimatePresence>
    </motion.div>
  );
}
