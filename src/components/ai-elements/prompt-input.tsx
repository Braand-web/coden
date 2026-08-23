import * as React from "react";

export function PromptInput({ className = "", children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`coden-prompt-input ${className}`} {...props}>
      {children}
    </div>
  );
}

export function PromptInputTextarea({ className = "", ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`coden-prompt-input-textarea ${className}`} {...props} />;
}

export function PromptInputToolbar({ className = "", children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`coden-prompt-input-toolbar ${className}`} {...props}>
      {children}
    </div>
  );
}

export function PromptInputSubmit({ className = "", children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={`coden-prompt-input-submit ${className}`} type="submit" {...props}>
      {children}
    </button>
  );
}
