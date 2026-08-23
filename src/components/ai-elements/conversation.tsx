import * as React from "react";

export type ConversationDownloadMessage = {
  key: string;
  content: string;
  role: "user" | "assistant" | "system";
};

type ConversationProps = React.HTMLAttributes<HTMLDivElement>;

export function Conversation({ className = "", children, ...props }: ConversationProps) {
  return (
    <section className={`coden-conversation relative size-full ${className}`} {...props}>
      {children}
    </section>
  );
}

export function ConversationContent({ className = "", children, ...props }: ConversationProps) {
  return (
    <div className={`coden-conversation-content ${className}`} {...props}>
      {children}
    </div>
  );
}

export function ConversationEmptyState({
  title,
  description,
  icon,
}: {
  title: string;
  description: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="coden-conversation-empty">
      <div className="coden-conversation-empty-icon" aria-hidden="true">
        {icon}
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}

export function ConversationDownload({ messages }: { messages: ConversationDownloadMessage[] }) {
  const download = React.useCallback(() => {
    const visibleMessages = messages.map(({ role, content }) => ({ role, content }));
    const blob = new Blob([JSON.stringify(visibleMessages, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "coden-conversation.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }, [messages]);

  if (!messages.length) return null;

  return (
    <button className="coden-conversation-download" type="button" onClick={download}>
      Download
    </button>
  );
}

export function ConversationScrollButton() {
  const scrollToBottom = React.useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    const root = event.currentTarget.closest(".sidebar-scroll-area") as HTMLElement | null;
    if (root) root.scrollTo({ top: root.scrollHeight, behavior: "smooth" });
  }, []);

  return (
    <button className="coden-conversation-scroll" type="button" onClick={scrollToBottom} aria-label="Scroll to latest message">
      v
    </button>
  );
}
