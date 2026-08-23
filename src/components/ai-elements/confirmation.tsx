import * as React from "react";

export type ConfirmationState = "approval-requested" | "accepted" | "rejected";

type ConfirmationContextValue = {
  state: ConfirmationState;
};

const ConfirmationContext = React.createContext<ConfirmationContextValue | null>(null);

function useConfirmationContext() {
  const value = React.useContext(ConfirmationContext);
  if (!value) throw new Error("Confirmation components must be rendered inside <Confirmation>.");
  return value;
}

export function Confirmation({
  state,
  className = "",
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { approval?: { id: string }; state: ConfirmationState }) {
  return (
    <ConfirmationContext.Provider value={{ state }}>
      <section className={`coden-confirmation coden-confirmation-${state} ${className}`} {...props}>
        {children}
      </section>
    </ConfirmationContext.Provider>
  );
}

export function ConfirmationTitle({ className = "", children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`coden-confirmation-title ${className}`} {...props}>
      {children}
    </div>
  );
}

export function ConfirmationRequest({ children }: { children: React.ReactNode }) {
  const { state } = useConfirmationContext();
  return state === "approval-requested" ? <>{children}</> : null;
}

export function ConfirmationAccepted({ children }: { children: React.ReactNode }) {
  const { state } = useConfirmationContext();
  return state === "accepted" ? <>{children}</> : null;
}

export function ConfirmationRejected({ children }: { children: React.ReactNode }) {
  const { state } = useConfirmationContext();
  return state === "rejected" ? <>{children}</> : null;
}

export function ConfirmationActions({ className = "", children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const { state } = useConfirmationContext();
  if (state !== "approval-requested") return null;

  return (
    <div className={`coden-confirmation-actions ${className}`} {...props}>
      {children}
    </div>
  );
}

export function ConfirmationAction({
  className = "",
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={`coden-confirmation-action ${className}`} type="button" {...props}>
      {children}
    </button>
  );
}
