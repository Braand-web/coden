import * as React from "react";

export type AttachmentData = {
  id: string;
  type: "file";
  url: string;
  mediaType?: string;
  filename?: string;
};

const AttachmentContext = React.createContext<AttachmentData | null>(null);

function useAttachment() {
  const value = React.useContext(AttachmentContext);
  if (!value) throw new Error("Attachment children must be rendered inside <Attachment>.");
  return value;
}

export function Attachments({
  variant = "list",
  className = "",
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { variant?: "list" | "grid" }) {
  return (
    <div className={`coden-attachments coden-attachments-${variant} ${className}`} {...props}>
      {children}
    </div>
  );
}

export function Attachment({
  data,
  className = "",
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { data: AttachmentData }) {
  return (
    <AttachmentContext.Provider value={data}>
      <div className={`coden-attachment ${className}`} title={data.filename || "Attachment"} {...props}>
        {children}
      </div>
    </AttachmentContext.Provider>
  );
}

export function AttachmentPreview({ className = "", ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const data = useAttachment();
  const isImage = data.mediaType?.startsWith("image/") && data.url;
  return (
    <div className={`coden-attachment-preview ${className}`} {...props}>
      {isImage ? <img alt={data.filename || "Attachment"} src={data.url} /> : <span aria-hidden="true">file</span>}
      <strong>{data.filename || "Attachment"}</strong>
    </div>
  );
}

export function AttachmentRemove({ className = "", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button aria-label="Remove attachment" className={`coden-attachment-remove ${className}`} type="button" {...props}>
      ×
    </button>
  );
}
