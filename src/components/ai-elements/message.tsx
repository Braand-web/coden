import * as React from "react";

type MessageProps = React.HTMLAttributes<HTMLDivElement> & {
  from: "user" | "assistant" | "system";
};

export function Message({ from, className = "", children, ...props }: MessageProps) {
  return (
    <article className={`coden-message coden-message-${from} ${className}`} data-role={from} {...props}>
      {children}
    </article>
  );
}

export function MessageContent({ className = "", children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`coden-message-content ${className}`} {...props}>
      {children}
    </div>
  );
}

export function MessageResponse({ className = "", children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`coden-message-response ${className}`} {...props}>
      {children}
    </div>
  );
}

export function MessageToolbar({ className = "", children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`coden-message-toolbar ${className}`} {...props}>
      {children}
    </div>
  );
}

export function MessageActions({ className = "", children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`coden-message-actions ${className}`} {...props}>
      {children}
    </div>
  );
}

export function MessageAction({
  className = "",
  label,
  tooltip,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label?: string; tooltip?: string }) {
  return (
    <button
      aria-label={label || tooltip}
      className={`coden-message-action ${className}`}
      data-tooltip={tooltip || label}
      type="button"
      {...props}
    >
      {children || label}
    </button>
  );
}

type MessageBranchContextValue = {
  branch: number;
  total: number;
  setBranch: React.Dispatch<React.SetStateAction<number>>;
};

const MessageBranchContext = React.createContext<MessageBranchContextValue | null>(null);

function useMessageBranchContext() {
  const value = React.useContext(MessageBranchContext);
  if (!value) throw new Error("Message branch components must be rendered inside <MessageBranch>.");
  return value;
}

export function MessageBranch({
  defaultBranch = 0,
  className = "",
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { defaultBranch?: number }) {
  const [branch, setBranch] = React.useState(defaultBranch);
  const [total, setTotal] = React.useState(1);
  const value = React.useMemo(() => ({ branch, total, setBranch }), [branch, total]);

  return (
    <MessageBranchContext.Provider value={value}>
      <div
        className={`coden-message-branch ${className}`}
        data-branch={branch}
        ref={node => {
          if (!node) return;
          const count = node.querySelectorAll("[data-message-branch-item]").length;
          if (count && count !== total) setTotal(count);
        }}
        {...props}
      >
        {children}
      </div>
    </MessageBranchContext.Provider>
  );
}

export function MessageBranchContent({ className = "", children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const { branch } = useMessageBranchContext();
  const items = React.Children.toArray(children);

  return (
    <div className={`coden-message-branch-content ${className}`} {...props}>
      {items.map((child, index) => (
        <div data-message-branch-item hidden={index !== branch} key={index}>
          {child}
        </div>
      ))}
    </div>
  );
}

export function MessageBranchSelector({ className = "", children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`coden-message-branch-selector ${className}`} {...props}>
      {children}
    </div>
  );
}

export function MessageBranchPrevious(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { branch, setBranch } = useMessageBranchContext();
  return (
    <button aria-label="Previous response" disabled={branch <= 0} type="button" onClick={() => setBranch(current => Math.max(0, current - 1))} {...props}>
      ‹
    </button>
  );
}

export function MessageBranchNext(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { branch, total, setBranch } = useMessageBranchContext();
  return (
    <button aria-label="Next response" disabled={branch >= total - 1} type="button" onClick={() => setBranch(current => Math.min(total - 1, current + 1))} {...props}>
      ›
    </button>
  );
}

export function MessageBranchPage({ className = "", ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  const { branch, total } = useMessageBranchContext();
  return (
    <span className={`coden-message-branch-page ${className}`} {...props}>
      {branch + 1}/{Math.max(1, total)}
    </span>
  );
}
