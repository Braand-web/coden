import * as React from "react";

type PlanContextValue = {
  open: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
};

const PlanContext = React.createContext<PlanContextValue | null>(null);

function usePlanContext() {
  const value = React.useContext(PlanContext);
  if (!value) throw new Error("Plan components must be rendered inside <Plan>.");
  return value;
}

export function Plan({
  defaultOpen = false,
  className = "",
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { defaultOpen?: boolean }) {
  const [open, setOpen] = React.useState(defaultOpen);

  return (
    <PlanContext.Provider value={{ open, setOpen }}>
      <section className={`coden-plan ${open ? "coden-plan-open" : ""} ${className}`} {...props}>
        {children}
      </section>
    </PlanContext.Provider>
  );
}

export function PlanHeader({ className = "", children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`coden-plan-header ${className}`} {...props}>
      {children}
    </div>
  );
}

export function PlanTitle({ className = "", children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3 className={`coden-plan-title ${className}`} {...props}>
      {children}
    </h3>
  );
}

export function PlanDescription({ className = "", children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={`coden-plan-description ${className}`} {...props}>
      {children}
    </p>
  );
}

export function PlanTrigger({ className = "", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { open, setOpen } = usePlanContext();

  return (
    <button
      aria-expanded={open}
      aria-label={open ? "Collapse plan" : "Expand plan"}
      className={`coden-plan-trigger ${className}`}
      type="button"
      onClick={() => setOpen(current => !current)}
      {...props}
    >
      {open ? "-" : "+"}
    </button>
  );
}

export function PlanContent({ className = "", children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const { open } = usePlanContext();

  if (!open) return null;

  return (
    <div className={`coden-plan-content ${className}`} {...props}>
      {children}
    </div>
  );
}

export function PlanFooter({ className = "", children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`coden-plan-footer ${className}`} {...props}>
      {children}
    </div>
  );
}

export function PlanAction({ className = "", children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`coden-plan-action ${className}`} {...props}>
      {children}
    </div>
  );
}
