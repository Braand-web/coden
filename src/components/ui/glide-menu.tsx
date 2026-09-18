import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { cn } from '../../lib/utils';
import '../../styles/glide-menu.css';

/**
 * A list whose hover highlight slides between rows instead of blinking.
 *
 * One element moves and resizes to sit behind whichever row the pointer or
 * keyboard is on. Giving each row its own background means every row fades
 * independently and the eye sees flicker travelling down the list; a single
 * travelling shape reads as one object being pointed at, which is what is
 * actually happening.
 *
 * Rows opt in with `data-menu-row`, so a child that is not a choice — a text
 * field, a separator — sits in the list without claiming the highlight.
 *
 * It measures with `offsetTop`/`offsetHeight` against the container rather
 * than with `getBoundingClientRect`, because the card this lives in animates
 * its own height: a viewport-relative rectangle read mid-transition points at
 * where the row was a frame ago.
 */
export default function GlideMenu({
  children,
  className,
  highlightClassName,
}: {
  children: ReactNode;
  className?: string;
  /** Styling for the travelling shape. It owns only its geometry. */
  highlightClassName?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [highlight, setHighlight] = useState<{ top: number; height: number } | null>(null);

  const moveTo = (target: EventTarget | null) => {
    const row = (target as HTMLElement | null)?.closest<HTMLElement>('[data-menu-row]');
    const host = container.current;
    if (!row || !host || !host.contains(row)) return;
    setHighlight({ top: row.offsetTop, height: row.offsetHeight });
  };

  const style: CSSProperties = highlight
    ? { top: highlight.top, height: highlight.height, opacity: 1 }
    : { opacity: 0 };

  return (
    <div
      ref={container}
      className={cn('coden-glide-menu', className)}
      style={{ position: 'relative' }}
      onPointerMove={event => moveTo(event.target)}
      onPointerLeave={() => setHighlight(null)}
      onFocusCapture={event => moveTo(event.target)}
      onBlurCapture={() => setHighlight(null)}
    >
      <span
        aria-hidden="true"
        className={cn('coden-glide-menu-highlight', highlightClassName)}
        style={{ position: 'absolute', pointerEvents: 'none', ...style }}
      />
      {children}
    </div>
  );
}
