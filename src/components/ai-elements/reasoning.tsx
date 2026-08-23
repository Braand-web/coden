import * as React from "react";

const Ctx = React.createContext<{ open: boolean; setOpen: (v: boolean) => void } | null>(null);

export function Reasoning({
  defaultOpen = false,
  isStreaming = false,
  className = "",
  children,
}: {
  defaultOpen?: boolean;
  isStreaming?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  React.useEffect(() => {
    if (isStreaming) setOpen(true);
  }, [isStreaming]);
  return (
    <Ctx.Provider value={{ open, setOpen }}>
      <div className={`coden-reasoning ${open ? "is-open" : ""} ${className}`}>{children}</div>
    </Ctx.Provider>
  );
}

export function ReasoningTrigger({ label = "Réflexion" }: { label?: string }) {
  const ctx = React.useContext(Ctx);
  if (!ctx) return null;
  return (
    <button
      type="button"
      className="coden-reasoning-trigger"
      onClick={() => ctx.setOpen(!ctx.open)}
      aria-expanded={ctx.open}
    >
      <span aria-hidden>{ctx.open ? "▾" : "▸"}</span> {label}
    </button>
  );
}

export function ReasoningContent({ children }: { children: React.ReactNode }) {
  const ctx = React.useContext(Ctx);
  if (!ctx?.open) return null;
  return <div className="coden-reasoning-content">{children}</div>;
}