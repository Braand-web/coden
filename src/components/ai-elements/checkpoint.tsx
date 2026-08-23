import * as React from "react";

export function Checkpoint({ className = "", children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`coden-checkpoint ${className}`} {...props}>
      {children}
    </div>
  );
}

export function CheckpointIcon({ className = "", ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return <span className={`coden-checkpoint-icon ${className}`} aria-hidden="true" {...props} />;
}

export function CheckpointTrigger({
  tooltip,
  className = "",
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { tooltip?: string }) {
  return (
    <button className={`coden-checkpoint-trigger ${className}`} data-tooltip={tooltip} type="button" {...props}>
      {children}
    </button>
  );
}
