import * as React from "react";

export function WebPreview({
  status = "idle",
  className = "",
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { status?: "idle" | "building" | "ready" | "failed" }) {
  return (
    <section className={`coden-web-preview coden-web-preview-${status} ${className}`} data-status={status} {...props}>
      {children}
    </section>
  );
}

export function WebPreviewSkeleton({ className = "", ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`coden-web-preview-skeleton ${className}`} aria-hidden="true" {...props}>
      <span />
      <span />
      <span />
    </div>
  );
}

export function WebPreviewActions({ className = "", children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`coden-web-preview-actions ${className}`} {...props}>
      {children}
    </div>
  );
}
