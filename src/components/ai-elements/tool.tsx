import * as React from "react";

type ToolStatus = "input-streaming" | "input-available" | "output-available" | "output-error";

type ToolProps = React.HTMLAttributes<HTMLDivElement> & { defaultOpen?: boolean };

const ToolCtx = React.createContext<{ open: boolean; setOpen: (v: boolean) => void } | null>(null);

export function Tool({ defaultOpen = false, className = "", children, ...props }: ToolProps) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <ToolCtx.Provider value={{ open, setOpen }}>
      <div className={`coden-tool ${open ? "is-open" : ""} ${className}`} {...props}>
        {children}
      </div>
    </ToolCtx.Provider>
  );
}

export function ToolHeader({
  name,
  status,
  icon,
  className = "",
}: {
  name: string;
  status?: ToolStatus | string;
  icon?: React.ReactNode;
  className?: string;
}) {
  const ctx = React.useContext(ToolCtx);
  if (!ctx) return null;
  return (
    <button
      type="button"
      className={`coden-tool-header ${className}`}
      onClick={() => ctx.setOpen(!ctx.open)}
      aria-expanded={ctx.open}
    >
      <span className="coden-tool-chevron" aria-hidden>{ctx.open ? "▾" : "▸"}</span>
      {icon ? <span className="coden-tool-icon">{icon}</span> : null}
      <span className="coden-tool-name">{name}</span>
      {status ? <span className={`coden-tool-status status-${status}`}>{status}</span> : null}
    </button>
  );
}

export function ToolContent({ className = "", children }: React.HTMLAttributes<HTMLDivElement>) {
  const ctx = React.useContext(ToolCtx);
  if (!ctx?.open) return null;
  return <div className={`coden-tool-content ${className}`}>{children}</div>;
}

export function ToolInput({ input }: { input: unknown }) {
  return (
    <pre className="coden-tool-input">
      <code>{typeof input === "string" ? input : JSON.stringify(input, null, 2)}</code>
    </pre>
  );
}

export function ToolOutput({ output, errorText }: { output?: React.ReactNode; errorText?: string }) {
  if (errorText) return <div className="coden-tool-output is-error">{errorText}</div>;
  return <div className="coden-tool-output">{output}</div>;
}