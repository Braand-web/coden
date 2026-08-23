import * as React from "react";

export function FileTree({ className = "", children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`coden-file-tree ${className}`} {...props}>
      {children}
    </div>
  );
}

export function FileTreeItem({
  path,
  status = "modified",
  className = "",
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { path: string; status?: "created" | "modified" | "deleted" | "writing" | "done" | "failed" }) {
  return (
    <div className={`coden-file-tree-item coden-file-tree-item-${status} ${className}`} data-status={status} title={path} {...props}>
      <span className="coden-file-tree-status" aria-hidden="true" />
      <span className="coden-file-tree-path">{children || path}</span>
    </div>
  );
}
