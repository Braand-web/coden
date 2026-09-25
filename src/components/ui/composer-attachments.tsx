import * as React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "../../lib/utils";
import { classifyAttachment, extractUrls, formatBytes, MAX_ATTACHMENTS_PER_MESSAGE, type AttachmentKind } from "../../lib/attachment-policy";
import { waitUntilRead, type AttachmentUploader, type RemoteAttachment } from "../../lib/attachment-types";

/*
 * What the composer carries besides text: files and links.
 *
 * A file is checked the moment it is chosen (type, size), shown with its
 * thumbnail, then sent: the chip shows the upload's progress, then "Analyse…"
 * while the server reads it, then its one-line summary. A link written in the
 * message becomes a card with the page's title and favicon, then "Analyse du
 * lien…" while Coden renders and reads it.
 *
 * Without an uploader (the landing, before sign-in) nothing leaves the browser:
 * the files travel with the message and are sent from the Builder.
 */

export type ComposerFile = {
  key: string;
  file: File;
  name: string;
  size: number;
  kind: AttachmentKind;
  label: string;
  previewUrl?: string;
  width?: number;
  height?: number;
  status: "local" | "uploading" | "processing" | "ready" | "failed";
  progress: number;
  remoteId?: string;
  summary?: string;
  error?: string;
};

export type ComposerLink = {
  url: string;
  host: string;
  status: "detected" | "analyzing" | "ready" | "failed";
  title?: string;
  favicon?: string;
  image?: string;
  remoteId?: string;
  error?: string;
};

export type ComposerSubmission = {
  /** Files that could not be sent from here (no session): the host carries them. */
  localFiles: File[];
  attachmentIds: string[];
  linkIds: string[];
  /** Links the user dismissed: the server must not analyse them. */
  skippedUrls: string[];
  /** What went with the message, for the conversation: file names and link hosts. */
  attachmentNames: string[];
};

const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } };
const newKey = () => `f-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export function useComposerAttachments({ uploader, value, maxFiles = MAX_ATTACHMENTS_PER_MESSAGE }: { uploader?: AttachmentUploader | null; value: string; maxFiles?: number }) {
  const [files, setFiles] = useState<ComposerFile[]>([]);
  const [links, setLinks] = useState<ComposerLink[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const controllers = useRef(new Map<string, AbortController>());
  const dismissed = useRef(new Set<string>());
  const started = useRef(new Set<string>());
  const filesRef = useRef(files);
  filesRef.current = files;

  const patchFile = useCallback((key: string, patch: Partial<ComposerFile>) => {
    setFiles(previous => previous.map(item => (item.key === key ? { ...item, ...patch } : item)));
  }, []);
  const patchLink = useCallback((url: string, patch: Partial<ComposerLink>) => {
    setLinks(previous => previous.map(item => (item.url === url ? { ...item, ...patch } : item)));
  }, []);

  const applyRemote = useCallback((key: string, remote: RemoteAttachment) => {
    patchFile(key, {
      remoteId: remote.id,
      status: remote.status === "ready" ? "ready" : remote.status === "failed" ? "failed" : "processing",
      summary: remote.summary || undefined,
      error: remote.error || undefined,
      progress: 1,
    });
  }, [patchFile]);

  const send = useCallback(async (item: ComposerFile) => {
    if (!uploader) return;
    const controller = new AbortController();
    controllers.current.set(item.key, controller);
    patchFile(item.key, { status: "uploading", progress: 0, error: undefined });
    try {
      const remote = await uploader.upload(item.file, fraction => patchFile(item.key, { progress: fraction }), controller.signal);
      applyRemote(item.key, remote);
      if (remote.status === "processing") {
        const final = await waitUntilRead(uploader, remote.id, 180_000, update => applyRemote(item.key, update));
        applyRemote(item.key, final);
      }
    } catch (error) {
      if ((error as Error)?.name === "AbortError") return;
      patchFile(item.key, { status: "failed", error: error instanceof Error ? error.message : "Envoi impossible." });
    } finally {
      controllers.current.delete(item.key);
    }
  }, [uploader, patchFile, applyRemote]);

  const addFiles = useCallback((incoming: File[]) => {
    if (!incoming.length) return;
    const problems: string[] = [];
    const room = Math.max(0, maxFiles - filesRef.current.length);
    if (incoming.length > room) problems.push(`Vous pouvez joindre ${maxFiles} fichiers par message.`);
    const accepted: ComposerFile[] = [];
    for (const file of incoming.slice(0, room)) {
      const verdict = classifyAttachment(file.name, file.size, file.type);
      if (!verdict.ok) { problems.push(verdict.error); continue; }
      const item: ComposerFile = {
        key: newKey(),
        file,
        name: file.name,
        size: file.size,
        kind: verdict.kind,
        label: verdict.label,
        previewUrl: verdict.kind === "image" || verdict.kind === "video" ? URL.createObjectURL(file) : undefined,
        status: uploader ? "uploading" : "local",
        progress: 0,
      };
      accepted.push(item);
    }
    setErrors(problems.slice(0, 3));
    if (!accepted.length) return;
    setFiles(previous => [...previous, ...accepted]);
    for (const item of accepted) {
      if (item.kind === "image" && item.previewUrl) {
        const image = new Image();
        image.onload = () => patchFile(item.key, { width: image.naturalWidth, height: image.naturalHeight });
        image.src = item.previewUrl;
      }
      void send(item);
    }
  }, [maxFiles, uploader, send, patchFile]);

  const removeFile = useCallback((key: string) => {
    controllers.current.get(key)?.abort();
    const target = filesRef.current.find(item => item.key === key);
    if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
    if (target?.remoteId && uploader) void uploader.remove(target.remoteId);
    setFiles(previous => previous.filter(item => item.key !== key));
  }, [uploader]);

  const retryFile = useCallback((key: string) => {
    const target = filesRef.current.find(item => item.key === key);
    if (target && uploader) void send(target);
  }, [uploader, send]);

  /* Links: detected as the message is written, analysed once each. */
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const found = extractUrls(value).filter(url => !dismissed.current.has(url));
      setLinks(previous => {
        const kept = previous.filter(link => found.includes(link.url));
        const added = found.filter(url => !kept.some(link => link.url === url)).map(url => ({ url, host: hostOf(url), status: "detected" as const }));
        return added.length || kept.length !== previous.length ? [...kept, ...added] : previous;
      });
    }, 650);
    return () => window.clearTimeout(timer);
  }, [value]);

  useEffect(() => {
    if (!uploader) return;
    for (const link of links) {
      if (link.status !== "detected" || started.current.has(link.url)) continue;
      started.current.add(link.url);
      patchLink(link.url, { status: "analyzing" });
      void (async () => {
        const preview = await uploader.previewLink(link.url).catch(() => null);
        if (preview?.ok) patchLink(link.url, { title: preview.title, favicon: preview.favicon, image: preview.image });
        try {
          const remote = await uploader.analyzeLink(link.url, value);
          patchLink(link.url, { remoteId: remote.id });
          const final = remote.status === "processing" ? await waitUntilRead(uploader, remote.id, 90_000) : remote;
          patchLink(link.url, {
            status: final.status === "ready" ? "ready" : final.status === "failed" ? "failed" : "analyzing",
            title: final.preview?.title || preview?.ok && preview.title || undefined,
            favicon: final.preview?.favicon || (preview?.ok ? preview.favicon : undefined),
            error: final.error || (preview && !preview.ok ? preview.error : undefined),
          });
        } catch (error) {
          patchLink(link.url, { status: "failed", error: error instanceof Error ? error.message : "Analyse impossible." });
        }
      })();
    }
  }, [links, uploader, patchLink, value]);

  const dismissLink = useCallback((url: string) => {
    dismissed.current.add(url);
    setLinks(previous => previous.filter(link => link.url !== url));
  }, []);

  const uploading = files.some(item => item.status === "uploading");

  const takeSubmission = useCallback((): ComposerSubmission => {
    const submission: ComposerSubmission = {
      localFiles: files.filter(item => item.status === "local").map(item => item.file),
      attachmentIds: files.filter(item => item.remoteId && item.status !== "failed").map(item => item.remoteId!),
      linkIds: links.filter(link => link.remoteId && link.status !== "failed").map(link => link.remoteId!),
      skippedUrls: [...dismissed.current],
      attachmentNames: [
        ...files.filter(item => item.status !== "failed").map(item => item.name),
        ...links.filter(link => link.status !== "failed").map(link => link.host),
      ],
    };
    files.forEach(item => { if (item.previewUrl) URL.revokeObjectURL(item.previewUrl); });
    setFiles([]);
    setLinks([]);
    setErrors([]);
    dismissed.current = new Set();
    started.current = new Set();
    return submission;
  }, [files, links]);

  // Object URLs die with the component.
  useEffect(() => () => {
    filesRef.current.forEach(item => { if (item.previewUrl) URL.revokeObjectURL(item.previewUrl); });
    controllers.current.forEach(controller => controller.abort());
  }, []);

  return { files, links, errors, setErrors, addFiles, removeFile, retryFile, dismissLink, uploading, takeSubmission };
}

/* ------------------------------------------------------------------------ */
/* Tray                                                                      */
/* ------------------------------------------------------------------------ */

const KIND_BADGE: Record<AttachmentKind, string> = {
  image: "IMG", video: "VID", document: "DOC", spreadsheet: "XLS", text: "TXT", code: "</>", archive: "ZIP", link: "URL",
};

function badgeFor(item: ComposerFile) {
  const extension = item.name.split(".").pop()?.toUpperCase() || KIND_BADGE[item.kind];
  return extension.length <= 4 ? extension : KIND_BADGE[item.kind];
}

function CloseGlyph() {
  return (
    <svg width="8" height="8" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M2.5 2.5L11.5 11.5M11.5 2.5L2.5 11.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

function Spinner() {
  return <span className="coden-attach-spinner" aria-hidden="true" />;
}

function fileStatusLine(item: ComposerFile): { text: string; tone?: "error" } {
  if (item.status === "uploading") return { text: `Envoi ${Math.round(item.progress * 100)} %` };
  if (item.status === "processing") return { text: item.kind === "video" ? "Analyse de la vidéo…" : "Analyse…" };
  if (item.status === "failed") return { text: item.error || "Échec", tone: "error" };
  if (item.status === "local") return { text: `${item.label} · ${formatBytes(item.size)}` };
  return { text: `${item.label} · ${formatBytes(item.size)}` };
}

export function AttachmentTray({
  files,
  links,
  errors,
  notice,
  onRemoveFile,
  onRetryFile,
  onDismissLink,
  onOpenImage,
  onDismissErrors,
}: {
  files: ComposerFile[];
  links: ComposerLink[];
  errors: string[];
  notice?: React.ReactNode;
  onRemoveFile: (key: string) => void;
  onRetryFile: (key: string) => void;
  onDismissLink: (url: string) => void;
  onOpenImage: (item: ComposerFile, rect: DOMRect) => void;
  onDismissErrors: () => void;
}) {
  const hasItems = files.length > 0 || links.length > 0;
  return (
    <div className="coden-attach-tray">
      {hasItems ? (
        <ul className="coden-attach-row prompt-scrollbar" aria-label="Pièces jointes et liens">
          {files.map((item, index) => {
            const line = fileStatusLine(item);
            const busy = item.status === "uploading" || item.status === "processing";
            return (
              <li
                key={item.key}
                className={cn("coden-attach-chip", item.status === "failed" && "is-failed")}
                style={{ animationDelay: `${index * 35}ms` }}
                title={item.summary ? `${item.name} — ${item.summary}` : item.name}
              >
                <button
                  type="button"
                  className="coden-attach-thumb"
                  onMouseDown={event => event.preventDefault()}
                  onClick={event => { if (item.kind === "image" && item.previewUrl) onOpenImage(item, event.currentTarget.getBoundingClientRect()); }}
                  aria-label={item.kind === "image" ? `Agrandir ${item.name}` : item.name}
                  tabIndex={item.kind === "image" ? 0 : -1}
                >
                  {item.kind === "image" && item.previewUrl ? <img src={item.previewUrl} alt="" draggable={false} /> : null}
                  {item.kind === "video" && item.previewUrl ? <video src={item.previewUrl} muted preload="metadata" playsInline /> : null}
                  {item.kind !== "image" && item.kind !== "video" ? <span className="coden-attach-badge">{badgeFor(item)}</span> : null}
                  {item.kind === "video" ? <span className="coden-attach-play" aria-hidden="true" /> : null}
                </button>
                <span className="coden-attach-meta">
                  <span className="coden-attach-name">{item.name}</span>
                  <span className={cn("coden-attach-sub", line.tone === "error" && "is-error")} aria-live="polite">
                    {busy ? <Spinner /> : null}
                    {line.text}
                    {item.status === "failed" && !/pèse|pris en charge/.test(line.text) ? (
                      <button type="button" className="coden-attach-retry" onMouseDown={event => event.preventDefault()} onClick={() => onRetryFile(item.key)}>Réessayer</button>
                    ) : null}
                  </span>
                </span>
                <button
                  type="button"
                  className="coden-attach-remove"
                  onMouseDown={event => event.preventDefault()}
                  onClick={() => onRemoveFile(item.key)}
                  aria-label={`Retirer ${item.name}`}
                >
                  <CloseGlyph />
                </button>
                {item.status === "uploading" ? (
                  <span className="coden-attach-progress" style={{ transform: `scaleX(${Math.max(0.03, item.progress)})` }} aria-hidden="true" />
                ) : null}
              </li>
            );
          })}
          {links.map(link => (
            <li key={link.url} className={cn("coden-attach-chip is-link", link.status === "failed" && "is-failed")} title={link.error ? `${link.url} — ${link.error}` : link.url}>
              <span className="coden-attach-thumb">
                {link.image ? <img src={link.image} alt="" draggable={false} referrerPolicy="no-referrer" onError={event => { event.currentTarget.style.display = "none"; }} /> : null}
                {link.favicon ? <img className="coden-attach-favicon" src={link.favicon} alt="" draggable={false} referrerPolicy="no-referrer" onError={event => { event.currentTarget.style.display = "none"; }} /> : <span className="coden-attach-badge">URL</span>}
              </span>
              <span className="coden-attach-meta">
                <span className="coden-attach-name">{link.title || link.host}</span>
                <span className={cn("coden-attach-sub", link.status === "failed" && "is-error")} aria-live="polite">
                  {link.status === "analyzing" ? <><Spinner />Analyse du lien…</> : null}
                  {link.status === "ready" ? `${link.host} · page analysée` : null}
                  {link.status === "detected" ? link.host : null}
                  {link.status === "failed" ? (link.error || "Lien illisible") : null}
                </span>
              </span>
              <button type="button" className="coden-attach-remove" onMouseDown={event => event.preventDefault()} onClick={() => onDismissLink(link.url)} aria-label={`Ne pas analyser ${link.host}`}>
                <CloseGlyph />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {notice ? <div className="coden-attach-notice">{notice}</div> : null}
      {errors.length ? (
        <div className="coden-attach-errors" role="alert">
          <span>{errors.join(" ")}</span>
          <button type="button" onMouseDown={event => event.preventDefault()} onClick={onDismissErrors} aria-label="Fermer le message">
            <CloseGlyph />
          </button>
        </div>
      ) : null}
    </div>
  );
}
