import * as React from "react";

export function Suggestions({ className = "", children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`coden-suggestions ${className}`} {...props}>
      {children}
    </div>
  );
}

export function Suggestion({
  suggestion,
  className = "",
  onClick,
  ...props
}: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onClick"> & {
  suggestion: string;
  onClick?: (suggestion: string) => void;
}) {
  return (
    <button className={`coden-suggestion ${className}`} type="button" onClick={() => onClick?.(suggestion)} {...props}>
      {suggestion}
    </button>
  );
}
