import * as React from "react";

type SourcesContextValue = {
  open: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
};

const SourcesContext = React.createContext<SourcesContextValue | null>(null);

function useSourcesContext() {
  const value = React.useContext(SourcesContext);
  if (!value) throw new Error("Sources components must be rendered inside <Sources>.");
  return value;
}

export function Sources({ className = "", children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const [open, setOpen] = React.useState(false);
  return (
    <SourcesContext.Provider value={{ open, setOpen }}>
      <section className={`coden-sources ${open ? "coden-sources-open" : ""} ${className}`} {...props}>
        {children}
      </section>
    </SourcesContext.Provider>
  );
}

export function SourcesTrigger({ count, className = "", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { count: number }) {
  const { open, setOpen } = useSourcesContext();
  return (
    <button aria-expanded={open} className={`coden-sources-trigger ${className}`} type="button" onClick={() => setOpen(current => !current)} {...props}>
      Sources {count}
    </button>
  );
}

export function SourcesContent({ className = "", children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const { open } = useSourcesContext();
  if (!open) return null;
  return (
    <div className={`coden-sources-content ${className}`} {...props}>
      {children}
    </div>
  );
}

export function Source({ href, title, className = "", ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; title: string }) {
  return (
    <a className={`coden-source ${className}`} href={href} rel="noreferrer" target="_blank" {...props}>
      {title}
    </a>
  );
}
