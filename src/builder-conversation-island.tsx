import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import python from "highlight.js/lib/languages/python";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import "highlight.js/styles/github-dark.css";
import katex from "katex";
import "katex/dist/katex.min.css";
import MarkdownIt from "markdown-it";
import { ChevronDown, FileText } from "lucide-react";
import { nanoid } from "nanoid";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Response } from "./components/ui/response";
import { AgentMessage, type DecisionAnswersHandler } from './components/agent/agent-message';
import { EMPTY_MESSAGE, reduceAgentMessage, type AgentMessageState, type DecisionNotice } from './components/agent/agent-parts';
import { createTypingPacer, type TypingPacer } from './lib/typing-pacer';
import type { AgentEnvelope, ChatEvent } from './lib/agent-chat-protocol';
import type { AgentMode } from "./services/agent-mode";
import "./styles/agent-conversation.css";
import "./styles/agent-surface.css";

hljs.registerLanguage("bash", bash);
hljs.registerLanguage("css", css);
hljs.registerLanguage("html", xml);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("jsx", javascript);
hljs.registerLanguage("python", python);
hljs.registerLanguage("tsx", typescript);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("xml", xml);

export type CodenConversationRole = "user" | "assistant" | "system";

export type CodenConversationAction = {
  id: string;
  label: string;
  onClick: () => void;
};

type CodenConfirmationBlock = {
  type: "confirmation";
  title: string;
  body: string;
  state: "approval-requested" | "approved" | "rejected";
  approveLabel?: string;
  rejectLabel?: string;
};

type CodenApprovalBlock = {
  type: "approval";
  itemId: string;
  action: string;
  summary: string;
  state: "pending" | "approved" | "rejected";
};

type CodenPlanBlock = {
  type: "plan";
  title: string;
  summary: string;
  sections: Array<{
    id: "features" | "architecture" | "steps" | "files" | "risks";
    label: string;
    items: string[];
  }>;
};

type CodenRecoveryBlock = {
  type: "recovery";
  title: string;
  body: string;
};

type CodenConversationBlock = CodenConfirmationBlock | CodenApprovalBlock | CodenPlanBlock | CodenRecoveryBlock;

type LiveRunLine = {
  id: string;
  text: string;
  status: "active" | "done" | "failed" | "muted";
};

type ToolEntry = {
  id: string;
  name: string;
  status: "input-streaming" | "input-available" | "output-available" | "output-error";
  input?: unknown;
  output?: string;
  error?: string;
};

type SourceEntry = { id: string; url: string; title?: string };
type AttachmentEntry = { id: string; name: string; url?: string; mediaType?: string; size?: number };

type LiveRunState = {
  chat?: AgentMessageState;
  lastSequence?: number;
  status: "active" | "done" | "failed" | "cancelled";
  intentText: string;
  activeText: string;
  summary: string;
  assistantText: string;
  tools: ToolEntry[];
  sources: SourceEntry[];
  attachments: AttachmentEntry[];
  startedAt: number;
  skillId?: string;
  skillVersion?: string;
  lines: LiveRunLine[];
};

export type CodenConversationMessage = {
  id: string;
  role: CodenConversationRole;
  content: string;
  working?: boolean;
  actions?: CodenConversationAction[];
  block?: CodenConversationBlock;
  createdAt?: string;
  liveRun?: LiveRunState;
};

export type CodenConversationApi = {
  addMessage: (message: { id?: string; role: CodenConversationRole; content: string; working?: boolean }) => string;
  updateMessage: (id: string, content: string) => void;
  setParts: (id: string, parts: unknown[], content?: string) => void;
  setWorking: (id: string, label: string) => void;
  clearWorking: (id: string) => void;
  setBlock: (id: string, block: unknown | null) => void;
  setFlow: (id: string, flow: unknown) => void;
  startLiveRun: (id: string, meta?: { intent?: string; activeText?: string; mode?: AgentMode; model?: string; runId?: string }) => void;
  finishLiveRun: (id: string, summary?: string) => void;
  /**
   * The server's final, sanitised answer for a streamed reply. The streamed
   * text is only a preview of it; where the two differ, this one wins.
   */
  settleText: (id: string, text: string) => void;
  applyChatEvent: (id: string, event: AgentEnvelope) => void;
  failLiveRun: (id: string, message: string, status?: 'failed' | 'cancelled' | 'incomplete') => void;
  removeMessage: (id: string) => void;
  addAction: (id: string, label: string, onClick: () => void) => void;
  clearActions: (id: string) => void;
  clear: () => void;
  messages: () => CodenConversationMessage[];
};

type ConversationCallbacks = {
  onDecisionSelect?: (decisionId: string, option: DecisionNotice['options'][number]) => void;
  onDecisionAnswers?: DecisionAnswersHandler;
  onArtifactOpen?: (artifactId: string) => void;
  onApprovalDecision?: (itemId: string, approved: boolean) => void | Promise<void>;
};

const markdown = new MarkdownIt({
  html: true,
  linkify: true,
  breaks: true,
  highlight(code, language) {
    const lang = String(language || "").trim();
    if (lang && hljs.getLanguage(lang)) {
      try {
        const highlighted = hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
        return `<pre class="coden-code-block"><code class="hljs language-${escapeAttr(lang)}">${highlighted}</code></pre>`;
      } catch {
        // Fall through to escaped text.
      }
    }
    return `<pre class="coden-code-block"><code>${escapeHtml(code)}</code></pre>`;
  },
});

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&var(--syntax-cyan);");
}

function escapeAttr(value: unknown) {
  return String(value ?? "").replace(/[^a-z0-9_-]/gi, "");
}

function humanCheckName(name: string) {
  const value = String(name || "").replace(/[_-]+/g, " ").trim();
  if (!value) return "Verification";
  if (/build|runner|compile/i.test(value)) return "Build";
  if (/preview/i.test(value)) return "Preview";
  if (/browser|interaction/i.test(value)) return "Interactions";
  if (/security|secret/i.test(value)) return "Security";
  if (/mobile|responsive/i.test(value)) return "Mobile";
  if (/quality|design|visual/i.test(value)) return "Quality";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function humanCheckStatus(status: string) {
  const value = String(status || "").toLowerCase();
  if (value === "pass") return "OK";
  if (value === "fail") return "a corriger";
  if (value === "skip") return "ignore";
  if (value === "running" || value === "active") return "en cours";
  return value || "verifie";
}

function liveLineStatusForCheck(status: string): LiveRunLine["status"] {
  const value = String(status || "").toLowerCase();
  if (value === "fail" || value === "failed") return "failed";
  if (value === "skip" || value === "skipped") return "muted";
  if (value === "running" || value === "active") return "active";
  return "done";
}

function formatFileDoneLine(event: { path: string; additions?: number; deletions?: number }) {
  const additions = Number(event.additions || 0);
  const deletions = Number(event.deletions || 0);
  const suffix = additions || deletions ? ` +${additions} -${deletions}` : "";
  return `Modification de ${event.path}${suffix}`;
}

function renderMath(value: string, displayMode: boolean) {
  try {
    return katex.renderToString(value, {
      displayMode,
      throwOnError: false,
      strict: false,
      trust: false,
    });
  } catch {
    return escapeHtml(value);
  }
}

function renderMarkdown(value: string) {
  const mathBlocks: string[] = [];
  const inlineMath: string[] = [];
  const withBlockMath = String(value || "").replace(/\$\$([\s\S]+?)\$\$/g, (_match, expression) => {
    const index = mathBlocks.push(String(expression || "").trim()) - 1;
    return `\n\n<div data-coden-math-block="${index}"></div>\n\n`;
  });
  const withInlineMath = withBlockMath.replace(/\$(?!\s)([^$\n]+?)(?<!\s)\$/g, (_match, expression) => {
    const index = inlineMath.push(String(expression || "").trim()) - 1;
    return `<span data-coden-math-inline="${index}"></span>`;
  });
  let html = markdown.render(withInlineMath);
  mathBlocks.forEach((expression, index) => {
    html = html.replace(`<div data-coden-math-block="${index}"></div>`, `<div class="coden-math-block">${renderMath(expression, true)}</div>`);
  });
  inlineMath.forEach((expression, index) => {
    html = html.replace(`<span data-coden-math-inline="${index}"></span>`, `<span class="coden-math-inline">${renderMath(expression, false)}</span>`);
  });
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ["class", "target", "rel"],
  });
}

function textFromParts(parts: unknown[], fallback = "") {
  const text = parts
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const record = part as { text?: unknown; result?: unknown; content?: unknown; name?: unknown; path?: unknown; command?: unknown };
      const primary = record.text ?? record.result ?? record.content;
      if (primary) return String(primary);
      const secondary = [record.name, record.path, record.command].filter(Boolean).join(" ");
      return secondary ? String(secondary) : "";
    })
    .filter(Boolean)
    .join("\n");
  return text || fallback;
}

function textFromBlock(block: unknown) {
  if (!block || typeof block !== "object") return "";
  const record = block as { title?: unknown; body?: unknown; content?: unknown; summary?: unknown; intro?: unknown };
  return [record.title, record.body ?? record.content ?? record.summary ?? record.intro]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .join("\n\n");
}

export function normalizeConversationBlock(block: unknown): CodenConversationBlock | undefined {
  if (!block || typeof block !== "object") return undefined;
  const record = block as Record<string, unknown>;
  if (record.type === "confirmation") {
    const title = String(record.title || "").trim();
    const body = String(record.body || record.content || "").trim();
    if (!title && !body) return undefined;
    const state = ["approval-requested", "approved", "rejected"].includes(String(record.state))
      ? String(record.state) as CodenConfirmationBlock["state"]
      : "approval-requested";
    return {
      type: "confirmation",
      title,
      body,
      state,
      approveLabel: String(record.approveLabel || "").trim() || undefined,
      rejectLabel: String(record.rejectLabel || "").trim() || undefined,
    };
  }

  if (record.type === "approval") {
    const itemId = String(record.itemId || "").trim();
    const action = String(record.action || record.title || "").trim();
    const summary = String(record.summary || record.body || record.content || "").trim();
    if (!itemId || (!action && !summary)) return undefined;
    const state = ["pending", "approved", "rejected"].includes(String(record.state))
      ? String(record.state) as CodenApprovalBlock["state"]
      : "pending";
    return { type: "approval", itemId, action, summary, state };
  }

  if (record.type === "recovery") {
    const title = String(record.title || "").trim().slice(0, 160);
    const body = String(record.body || record.content || "").trim().slice(0, 640);
    if (!title && !body) return undefined;
    return { type: "recovery", title, body };
  }

  if (record.type !== "plan") return undefined;
  const title = String(record.title || "").trim().slice(0, 160);
  const summary = String(record.summary || record.body || "").trim().slice(0, 640);
  const validSectionIds = new Set(["features", "architecture", "steps", "files", "risks"]);
  const sections = (Array.isArray(record.sections) ? record.sections : [])
    .flatMap((section) => {
      if (!section || typeof section !== "object") return [];
      const item = section as Record<string, unknown>;
      const id = String(item.id || "");
      if (!validSectionIds.has(id)) return [];
      const items = (Array.isArray(item.items) ? item.items : [])
        .map(value => String(value || "").replace(/\s+/g, " ").trim().slice(0, 360))
        .filter(Boolean)
        .slice(0, 8);
      if (!items.length) return [];
      return [{
        id: id as CodenPlanBlock["sections"][number]["id"],
        label: String(item.label || id).trim().slice(0, 72),
        items,
      }];
    });
  if (!title && !summary && !sections.length) return undefined;
  return { type: "plan", title: title || "Plan", summary, sections };
}

function cloneMessages(messages: CodenConversationMessage[]) {
  return messages.map((message) => ({
    ...message,
    actions: [...(message.actions || [])],
    block: message.block ? { ...message.block } : undefined,
    liveRun: message.liveRun
      ? {
        ...message.liveRun,
        lines: [...message.liveRun.lines],
      }
      : undefined,
  }));
}

const CONVERSATION_STORAGE_PREFIX = 'coden:conversation:v1:';
const MAX_PERSISTED_MESSAGES = 120;
const STREAM_INTERRUPTED_COPY = 'La connexion a été interrompue. Votre travail déjà enregistré reste disponible.';

function conversationStorageKey() {
  if (typeof window === 'undefined') return `${CONVERSATION_STORAGE_PREFIX}server`;
  const search = typeof window.location?.search === 'string' ? window.location.search : '';
  const project = new URLSearchParams(search).get('project') || 'new-project';
  return `${CONVERSATION_STORAGE_PREFIX}${project.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80) || 'new-project'}`;
}

function persistedMessage(message: CodenConversationMessage): CodenConversationMessage {
  const copy = JSON.parse(JSON.stringify({ ...message, actions: [] })) as CodenConversationMessage;
  if (!copy.working) return copy;

  copy.working = false;
  if (copy.liveRun) {
    copy.liveRun.status = 'failed';
    copy.liveRun.activeText = '';
    copy.liveRun.summary = copy.liveRun.summary || STREAM_INTERRUPTED_COPY;
    copy.liveRun.chat = copy.liveRun.chat
      ? { ...copy.liveRun.chat, status: 'error', thinking: false, activity: null, error: STREAM_INTERRUPTED_COPY }
      : copy.liveRun.chat;
  }
  return copy;
}

function restorePersistedMessages(storageKey: string): CodenConversationMessage[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.sessionStorage.getItem(storageKey);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((message): message is CodenConversationMessage => Boolean(message && typeof message.id === 'string' && typeof message.role === 'string' && typeof message.content === 'string'))
      .slice(-MAX_PERSISTED_MESSAGES)
      .map((message) => ({ ...message, actions: [] }));
  } catch {
    return [];
  }
}

export function createStore(storageKey = conversationStorageKey()) {
  let messages: CodenConversationMessage[] = restorePersistedMessages(storageKey);
  const listeners = new Set<() => void>();
  let raf = 0;
  let persistFrame = 0;

  const persist = () => {
    if (typeof window === 'undefined') return;
    try {
      window.sessionStorage.setItem(storageKey, JSON.stringify(messages.slice(-MAX_PERSISTED_MESSAGES).map(persistedMessage)));
    } catch {
      // Persistence is an enhancement. A full or unavailable session store
      // must never prevent the current run from continuing in memory.
    }
  };

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('pagehide', persist);
  }

  /*
   * At most once a second.
   *
   * This ran on every animation frame, and during a stream every frame
   * mutates: the whole conversation — up to 120 messages — was serialised to
   * JSON and written to sessionStorage sixty times a second, on the same
   * thread that draws the text. Persistence is a safety net for a reload; a
   * second of lag on it costs nothing, and `pagehide` still writes the
   * latest state on the way out.
   */
  const schedulePersist = () => {
    if (persistFrame || typeof window === 'undefined' || typeof window.setTimeout !== 'function') return;
    persistFrame = window.setTimeout(() => {
      persistFrame = 0;
      persist();
    }, 1000) as unknown as number;
  };

  const notify = () => {
    if (raf) return;
    raf = window.requestAnimationFrame(() => {
      raf = 0;
      listeners.forEach((listener) => listener());
    });
  };

  const mutate = (callback: () => void) => {
    callback();
    schedulePersist();
    notify();
  };

  const find = (id: string) => messages.find((message) => message.id === id);

  /*
   * One paced queue per message, drained on a single shared tick.
   *
   * The provider does not send one character at a time, so applying deltas as
   * they land draws the reply in blocks. The pacer releases them steadily —
   * and, more importantly, keeps every other event behind the text it arrived
   * after, so a tool line never lands above the sentence introducing it.
   */
  const pacers = new Map<string, TypingPacer>();
  /*
   * Work that has to wait for the text queued ahead of it.
   *
   * The end of a run is reported twice: by the stream's own terminal event,
   * which travels through the pacer behind the text, and by the Builder when
   * the request resolves — which is the moment the last byte arrived, not the
   * moment it was drawn. Applying the second one straight away closed the
   * message while paced text was still queued, and the reducer drops text on
   * a closed message: the end of the reply was lost. It waits here instead.
   */
  const afterDrain = new Map<string, Array<() => void>>();
  const whenDrained = (id: string, work: () => void) => {
    if (!pacers.get(id)?.pending) { work(); return; }
    afterDrain.set(id, [...(afterDrain.get(id) || []), work]);
  };
  const runAfterDrain = (id: string) => {
    const work = afterDrain.get(id);
    if (!work) return;
    afterDrain.delete(id);
    work.forEach(item => item());
  };
  /** Everything queued for one message, applied now. */
  const flushMessage = (id: string) => {
    const pacer = pacers.get(id);
    if (pacer) {
      applyPaced(id, pacer.flush());
      pacers.delete(id);
    }
  };

  const applyPaced = (id: string, events: ChatEvent[]) => {
    if (!events.length) return;
    const message = find(id);
    if (!message) return;
    const run = ensureLiveRun(message);
    for (const payload of events) {
      /*
       * No sequence, deliberately.
       *
       * The reducer drops anything whose sequence it has already seen, and a
       * split delta carries the sequence of the event it came from — so every
       * fragment after the first would be discarded as a duplicate. The
       * de-duplication that matters already happened on arrival, both in
       * `consumeAgentStream` and at the push below.
       */
      run.chat = reduceAgentMessage(run.chat || { ...EMPTY_MESSAGE, parts: [] }, payload);
    }
    const chat = run.chat;
    if (!chat) return;
    const streamedText = chat.parts.filter(part => part.type === 'text').map(part => part.text).join('\n\n');
    if (streamedText) message.content = streamedText;
    message.working = chat.status === 'streaming';
  };

  /*
   * The pacer is drained once per display frame.
   *
   * It used to run on a 50ms interval whose result was then drawn on the
   * following animation frame: two clocks out of phase, so characters landed
   * in uneven steps of one to three frames. Draining inside the frame and
   * notifying in that same frame gives every frame its share and nothing
   * waits for the next one.
   */
  const canPace = typeof window !== 'undefined'
    && typeof window.requestAnimationFrame === 'function'
    && typeof window.cancelAnimationFrame === 'function';
  let pacingFrame = 0;

  const stopPacing = () => {
    if (!pacingFrame) return;
    window.cancelAnimationFrame(pacingFrame);
    pacingFrame = 0;
  };

  // One clock for pushing and draining: the frame timestamp and Date.now()
  // count from different origins, and mixing them made every elapsed time
  // either negative or enormous.
  const tick = () => {
    pacingFrame = 0;
    const now = Date.now();
    let stillPending = false;
    for (const [id, pacer] of [...pacers]) {
      if (!find(id)) { pacers.delete(id); continue; }
      applyPaced(id, pacer.drain(now));
      if (pacer.pending) stillPending = true;
      else { pacers.delete(id); runAfterDrain(id); }
    }
    schedulePersist();
    listeners.forEach((listener) => listener());
    if (stillPending) pacingFrame = window.requestAnimationFrame(tick);
  };

  /*
   * Pacing needs something to drain it.
   *
   * Without a scheduler — server rendering, a test runner, any environment
   * with no `window` — the queue would be filled and never emptied, and the
   * reply would simply never appear. So where nothing can tick, nothing is
   * held back: the events apply exactly as they did before pacing existed.
   */
  const startPacing = () => {
    if (pacingFrame || !canPace) return;
    pacingFrame = window.requestAnimationFrame(tick);
  };

  /*
   * A hidden tab gets no frames, so nothing paced would ever arrive.
   *
   * Everything queued is shown at once when the page is hidden — there is
   * nobody watching it type — and the run carries on unpaced until the page
   * is visible again.
   */
  const pageHidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';
  const flushAll = () => {
    if (!pacers.size) return;
    const ids = [...pacers.keys()];
    mutate(() => {
      for (const [id, pacer] of [...pacers]) applyPaced(id, pacer.flush());
      pacers.clear();
    });
    ids.forEach(runAfterDrain);
    stopPacing();
  };
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', () => { if (pageHidden()) flushAll(); });
  }

  const ensureLiveRun = (message: CodenConversationMessage, meta: { intent?: string; activeText?: string; mode?: AgentMode; model?: string; runId?: string } = {}): LiveRunState => {
    if (!message.liveRun) {
      message.liveRun = {
        status: "active",
        intentText: meta.intent || "",
        activeText: meta.activeText || "",
        summary: "",
        assistantText: "",
        tools: [],
        sources: [],
        attachments: [],
        startedAt: Date.now(),
        lines: [],
      };
    }
    if (meta.intent) message.liveRun.intentText = meta.intent;
    if (meta.activeText) message.liveRun.activeText = meta.activeText;
    message.working = true;
    return message.liveRun as LiveRunState;
  };

  const addLine = (run: LiveRunState, text: string, status: LiveRunLine["status"] = "done") => {
    const clean = String(text || "").trim();
    if (!clean) return;
    const last = run.lines[run.lines.length - 1];
    if (last?.text === clean && last.status === status) return;
    if (status === "active") {
      run.lines.forEach((line) => {
        if (line.status === "active") line.status = "done";
      });
    }
    run.lines.push({ id: nanoid(), text: clean, status });
    if (run.lines.length > 8) run.lines = run.lines.slice(-8);
  };

  const api: CodenConversationApi & { subscribe: (listener: () => void) => () => void } = {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    addMessage(message) {
      const id = message.id || nanoid();
      mutate(() => {
        messages.push({
          id,
          role: message.role,
          content: message.content,
          working: Boolean(message.working),
          actions: [],
          createdAt: new Date().toISOString(),
        });
      });
      return id;
    },
    updateMessage(id, content) {
      mutate(() => {
        const message = find(id);
        if (!message) return;
        message.content = content;
        if (content && message.liveRun?.chat && !message.liveRun.chat.parts.some(part => part.type === 'text' && part.text.trim())) {
          message.liveRun.chat.parts = [...message.liveRun.chat.parts, { id: 'final-text', type: 'text', text: content, done: true }];
        }
        if (content) message.working = false;
      });
    },
    setParts(id, parts, content = "") {
      mutate(() => {
        const message = find(id);
        if (!message) return;
        const text = textFromParts(parts, content);
        if (text) message.content = text;
        if (message.liveRun && text) {
          message.liveRun.summary = text;
          message.liveRun.status = message.liveRun.status === "failed" ? "failed" : "done";
        }
        message.working = false;
      });
    },
    setWorking(id, label) {
      mutate(() => {
        const message = find(id);
        if (!message) return;
        const run = ensureLiveRun(message, { activeText: label });
        /*
         * A working message has to have something to draw.
         *
         * The shimmer lives in `AgentMessage`, behind `streaming &&
         * state.thinking`, and `state` is `liveRun.chat`. This set the
         * `working` flag and an `activeText` and created no `chat`, so the
         * render fell through to `message.content` — empty on a fresh card —
         * and drew nothing at all. The bubble sat blank for the whole
         * intent-classification round, which is several seconds.
         *
         * `is-working` on the wrapper carries no styling anywhere, so the flag
         * alone was never going to show.
         */
        if (!run.chat) run.chat = { ...EMPTY_MESSAGE, parts: [], notices: [], thinking: true, activity: label || null };
        else if (run.chat.status === 'streaming') run.chat = { ...run.chat, thinking: true, activity: label || run.chat.activity };
        message.working = true;
      });
    },
    clearWorking(id) {
      mutate(() => {
        const message = find(id);
        if (!message) return;
        message.working = false;
        /*
         * "Stop showing work" has to reach the line that shows it.
         *
         * The shimmer is drawn from `liveRun.chat.thinking`, which this never
         * touched: a card whose run was not closed by a terminal event kept
         * "Coden analyse votre demande…" shimmering under the finished answer
         * for the rest of the session.
         */
        const chat = message.liveRun?.chat;
        if (chat?.status === 'streaming' && chat.thinking) message.liveRun!.chat = { ...chat, thinking: false };
      });
    },
    setBlock(id, block) {
      mutate(() => {
        const message = find(id);
        if (!message) return;
        message.block = normalizeConversationBlock(block);
        if (!message.block) return;
        const text = textFromBlock(message.block);
        if (text) message.content = text;
        message.working = false;
      });
    },
    setFlow(id, flow) {
      mutate(() => {
        const message = find(id);
        if (!message || !flow || typeof flow !== "object") return;
        const record = flow as {
          status?: LiveRunState["status"];
          intro?: string;
          phase?: string;
          streamingText?: string;
          summary?: string;
          checklist?: Array<{ label?: string; status?: LiveRunLine["status"] }>;
        };
        const run = ensureLiveRun(message, { intent: record.intro, activeText: record.phase || record.streamingText });
        run.status = record.status || run.status;
        run.intentText = record.intro || run.intentText;
        run.activeText = record.streamingText || record.phase || run.activeText;
        run.summary = record.summary || run.summary;
        (record.checklist || []).slice(-5).forEach((item) => {
          if (item.label) addLine(run, item.label, item.status || "done");
        });
        if (run.status !== "active") message.working = false;
      });
    },
    startLiveRun(id, meta = {}) {
      // A new run replaces the old one: nothing queued for it may land later.
      pacers.delete(id);
      afterDrain.delete(id);
      mutate(() => {
        const message = find(id);
        if (!message) return;
        /*
         * The phrase already on screen stays on screen.
         *
         * The Builder lights the shimmer with "Coden analyse votre demande…"
         * the instant the message is sent, then starts the run a moment
         * later. Starting from a blank state here swapped that phrase for the
         * default one, and the line faded out and back in for no reason at
         * the very first second of every reply.
         */
        const carriedActivity = message.liveRun?.chat?.status === 'streaming' ? message.liveRun.chat.activity : null;
        message.liveRun = undefined;
        message.content = '';
        const run = ensureLiveRun(message, meta);
        /*
         * A run that has just started is thinking, by definition.
         *
         * `EMPTY_MESSAGE` carries `thinking: false`, so the shimmer only lit
         * once the first `run_started` or `activity` envelope arrived from the
         * server — after auth, the project lookup, the harness turn and the
         * intent classification, which the run ledger times at four to eight
         * seconds. For that whole window the user watched an empty bubble.
         *
         * The reducer turns it off again on the first `text_delta` or on any
         * terminal event, so starting true cannot leave it stuck on.
         */
        run.chat = { ...EMPTY_MESSAGE, parts: [], notices: [], runId: meta.runId, thinking: true, activity: meta.activeText || carriedActivity || run.activeText || null };
        message.working = true;
      });
    },
    applyChatEvent(id, event) {
      if (event.channel !== 'chat') return;
      mutate(() => {
        const message = find(id);
        if (!message) return;
        const run = ensureLiveRun(message);
        if (!run.chat) run.chat = { ...EMPTY_MESSAGE, parts: [], runId: event.runId };
        /*
         * Recorded on arrival, not on display.
         *
         * This is what `Last-Event-ID` replays from after a dropped
         * connection. Advancing it only as the pacer releases events would
         * make a reconnect re-request everything still queued, and the
         * duplicates would be applied as new text.
         */
        if (event.seq > (run.lastSequence ?? -1)) run.lastSequence = event.seq;
        else return;
        const pacer = pacers.get(id) ?? createTypingPacer();
        pacers.set(id, pacer);
        pacer.push(event.payload);
        applyPaced(id, canPace && !pageHidden() ? pacer.drain(Date.now()) : pacer.flush());
        if (!pacer.pending) pacers.delete(id);
      });
      if (pacers.has(id)) startPacing();
      else runAfterDrain(id);
    },
    finishLiveRun(id, summary = "") {
      whenDrained(id, () => mutate(() => {
        const message = find(id);
        if (!message) return;
        const run = ensureLiveRun(message);
        run.status = run.status === "failed" ? "failed" : "done";
        run.summary = summary || run.summary;
        if (run.chat) {
          if (!run.chat.parts.some(part => part.type === 'text' && part.text.trim()) && run.summary) {
            run.chat.parts = [...run.chat.parts, { id: 'final-text', type: 'text', text: run.summary, done: true }];
          }
          run.chat = reduceAgentMessage(run.chat, { type: 'run_finished', reason: 'completed' });
        }
        message.working = false;
        if (!message.content && run.summary) message.content = run.summary;
      }));
    },
    settleText(id, text) {
      const final = String(text || '').trim();
      if (!final) return;
      whenDrained(id, () => mutate(() => {
        const message = find(id);
        const chat = message?.liveRun?.chat;
        if (!message || !chat) return;
        const streamed = chat.parts.filter(part => part.type === 'text').map(part => part.text).join('\n\n').trim();
        if (!message.content) message.content = final;
        if (streamed === final) return;
        /*
         * Replaced only where nothing else would move.
         *
         * A reply that is a single block of text can be swapped for its
         * checked version in place. A run that interleaved its narration with
         * file and tool lines cannot: collapsing the text into one part would
         * lift every sentence above the work it describes. There the streamed
         * text stays, and the settled version is only used when nothing
         * streamed at all.
         */
        const others = chat.parts.filter(part => part.type !== 'text');
        if (streamed && others.length) return;
        message.liveRun!.chat = { ...chat, parts: [{ id: 'final-text', type: 'text', text: final, done: true }, ...others] };
        message.content = final;
      }));
    },
    failLiveRun(id, summary, status = 'failed') {
      // A failure or a cancellation is immediate: what already arrived is
      // shown in full, then the run is closed.
      afterDrain.delete(id);
      mutate(() => {
        flushMessage(id);
        const message = find(id);
        if (!message) return;
        const run = ensureLiveRun(message);
        run.status = status === 'cancelled' ? 'cancelled' : 'failed';
        if (run.chat?.status === 'streaming') run.chat = reduceAgentMessage(run.chat, status === 'cancelled' ? { type: 'run_finished', reason: 'cancelled' } : { type: 'run_failed', message: summary });
        run.summary = summary;
        run.activeText = '';
        addLine(run, summary, 'failed');
        message.content = summary;
        message.working = false;
      });
    },
    removeMessage(id) {
      pacers.delete(id);
      afterDrain.delete(id);
      if (!pacers.size) stopPacing();
      mutate(() => {
        messages = messages.filter((message) => message.id !== id);
      });
    },
    addAction(id, label, onClick) {
      mutate(() => {
        const message = find(id);
        if (!message) return;
        message.actions ||= [];
        message.actions.push({ id: nanoid(), label, onClick });
      });
    },
    clearActions(id) {
      mutate(() => {
        const message = find(id);
        if (!message) return;
        message.actions = [];
      });
    },
    clear() {
      pacers.clear();
      afterDrain.clear();
      stopPacing();
      mutate(() => {
        messages = [];
        if (typeof window !== 'undefined') window.sessionStorage.removeItem(storageKey);
      });
    },
    messages() {
      return cloneMessages(messages);
    },
  };

  return api;
}

function ensureConversationStyles() {
  if (document.getElementById("coden-react-conversation-styles")) return;
  const style = document.createElement("style");
  style.id = "coden-react-conversation-styles";
  style.textContent = `
    .coden-conversation-react {
      min-height: 100%;
      display: flex;
      flex-direction: column;
      gap: 14px;
      padding: 0 0 8px;
      min-width: 0;
    }

    .coden-conversation-empty {
      border: 1px dashed color-mix(in srgb, var(--border) 62%, transparent);
      border-radius: 12px;
      color: var(--text-secondary);
      padding: 16px;
      background: color-mix(in srgb, var(--surface) 56%, transparent);
    }

    .coden-conversation-empty h3 {
      margin: 0 0 7px;
      color: var(--foreground);
      font-size: 13px;
      font-weight: 720;
    }

    .coden-conversation-empty p {
      margin: 0;
      font-size: 12px;
      line-height: 1.55;
    }

    .coden-chat-message {
      display: flex;
      width: 100%;
      animation: coden-message-in 180ms ease-out both;
    }

    .coden-chat-message.user { justify-content: flex-end; }
    .coden-chat-message.assistant,
    .coden-chat-message.system { justify-content: flex-start; }

    .coden-chat-bubble {
      min-width: 0;
      max-width: min(92%, 640px);
      border: 1px solid color-mix(in srgb, var(--border) 78%, transparent);
      border-radius: 14px;
      padding: 12px 14px;
      color: var(--foreground);
      background: color-mix(in srgb, var(--surface) 78%, transparent);
      box-shadow: 0 1px 2px color-mix(in srgb, var(--foreground) 4%, transparent);
      overflow-wrap: anywhere;
      word-break: break-word;
      font-size: 12.5px;
      line-height: 1.62;
    }

    .coden-chat-message.user .coden-chat-bubble {
      max-width: min(86%, 520px);
      background: var(--foreground);
      color: var(--background);
      border-color: transparent;
      white-space: pre-wrap;
    }

    .coden-chat-message.system .coden-chat-bubble {
      color: var(--text-secondary);
      background: transparent;
      border-style: dashed;
    }

    .coden-chat-working {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      color: var(--text-secondary);
    }

    .coden-chat-working::before {
      content: "";
      width: 7px;
      height: 7px;
      border-radius: 999px;
      background: var(--surface);
      box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 42%, transparent);
      animation: coden-pulse 1.25s ease-in-out infinite;
    }

    .coden-agent-pending {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      min-height: 18px;
      color: var(--text-secondary);
    }
    .coden-agent-pending > span {
      width: 5px;
      height: 5px;
      border-radius: 999px;
      background: var(--surface);
      animation: coden-typing-bounce 1s ease-in-out infinite;
    }
    .coden-agent-pending > span:nth-child(2) { animation-delay: 0.15s; }
    .coden-agent-pending > span:nth-child(3) { animation-delay: 0.3s; }
    @keyframes coden-typing-bounce {
      0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
      40% { transform: translateY(-3px); opacity: 1; }
    }

    .coden-live-run {
      display: grid;
      gap: 10px;
      min-width: min(100%, 360px);
    }

    .coden-live-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      color: var(--foreground);
      font-size: 12px;
      font-weight: 720;
    }

    .coden-skill-chip {
      display: inline-flex;
      align-items: center;
      min-height: 20px;
      padding: 0 7px;
      border: 1px solid var(--border, color-mix(in srgb, var(--accent) 25%, transparent));
      border-radius: 999px;
      color: var(--text-muted, var(--text-secondary));
      font: 600 10px/1.2 "JetBrains Mono", monospace;
      letter-spacing: .01em;
      flex: 0 0 auto;
    }

    .coden-live-dot {
      width: 7px;
      height: 7px;
      border-radius: 999px;
      background: var(--success);
      flex: 0 0 auto;
      animation: coden-pulse 1.25s ease-in-out infinite;
    }

    .coden-live-dot.is-done { animation: none; background: var(--success); }
    .coden-live-dot.is-failed { animation: none; background: var(--danger); }

    .coden-live-time {
      color: var(--text-muted);
      font-size: 11px;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }

    /*
     * No \`.coden-shimmer-text\` rule here.
     *
     * There was one, and this sheet is appended to <head> after the
     * component's own \`shimmering-text.css\`, so it won: \`background:
     * var(--surface)\` clipped to the glyphs with \`-webkit-text-fill-color:
     * transparent\` painted every thinking label in the page's background
     * colour. "Coden réfléchit…" was on screen from the first frame and could
     * not be seen. The component styles its own text.
     */

    .coden-shimmer-dots {
      display: inline-block;
      color: var(--text-muted);
      letter-spacing: 4px;
      animation: coden-dots-pulse 1.2s ease-in-out infinite;
    }

    .coden-live-lines {
      display: grid;
      gap: 6px;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .coden-live-line {
      display: grid;
      grid-template-columns: 14px minmax(0, 1fr);
      gap: 8px;
      align-items: start;
      color: var(--text-secondary);
      font-size: 11.5px;
      line-height: 1.45;
    }

    .coden-live-line span:first-child {
      width: 7px;
      height: 7px;
      margin-top: 5px;
      border-radius: 999px;
      background: color-mix(in srgb, var(--text-muted) 72%, transparent);
    }

    .coden-live-line.is-active span:first-child {
      background: var(--surface);
      animation: coden-pulse 1.25s ease-in-out infinite;
    }

    .coden-live-line.is-done span:first-child { background: var(--success); }
    .coden-live-line.is-failed span:first-child { background: var(--danger); }
    .coden-live-line.is-muted { opacity: .65; }

    .coden-live-summary {
      color: var(--foreground);
      font-size: 12.5px;
      line-height: 1.55;
    }

    .coden-rich-response {
      color: var(--foreground);
    }

    .coden-rich-response > :first-child { margin-top: 0; }
    .coden-rich-response > :last-child { margin-bottom: 0; }
    .coden-rich-response p { margin: 0 0 10px; }
    .coden-rich-response h1,
    .coden-rich-response h2,
    .coden-rich-response h3 {
      margin: 12px 0 7px;
      line-height: 1.18;
      font-weight: 760;
    }
    .coden-rich-response h1 { font-size: 18px; }
    .coden-rich-response h2 { font-size: 15px; }
    .coden-rich-response h3 { font-size: 13px; }
    .coden-rich-response ul,
    .coden-rich-response ol {
      margin: 8px 0 10px 18px;
      padding: 0;
    }
    .coden-rich-response li { margin: 3px 0; }
    .coden-rich-response blockquote {
      margin: 10px 0;
      padding-left: 11px;
      border-left: 2px solid color-mix(in srgb, var(--accent) 55%, var(--border));
      color: var(--text-secondary);
    }
    .coden-rich-response table {
      width: 100%;
      border-collapse: collapse;
      margin: 10px 0;
      font-size: 11.5px;
      overflow: hidden;
      border-radius: 10px;
    }
    .coden-rich-response th,
    .coden-rich-response td {
      border: 1px solid color-mix(in srgb, var(--border) 78%, transparent);
      padding: 7px 8px;
      text-align: left;
    }
    .coden-rich-response th {
      background: color-mix(in srgb, var(--input) 80%, transparent);
      font-weight: 720;
    }
    .coden-rich-response code:not(pre code) {
      padding: 1px 5px;
      border-radius: 6px;
      background: color-mix(in srgb, var(--input) 90%, transparent);
      color: var(--foreground);
      font-size: .92em;
    }
    .coden-code-block {
      margin: 10px 0;
      padding: 12px;
      border-radius: 11px;
      overflow: auto;
      background: var(--surface);
      border: 1px solid color-mix(in srgb, var(--border) 64%, transparent);
      font-size: 11.5px;
      line-height: 1.55;
    }
    .coden-math-block {
      overflow-x: auto;
      padding: 6px 0;
    }
    .coden-chat-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 7px;
      margin-top: 10px;
    }
    .coden-chat-actions button {
      height: 30px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--input);
      color: var(--foreground);
      padding: 0 10px;
      font: inherit;
      font-size: 11px;
      font-weight: 700;
      cursor: pointer;
    }

    .coden-approval-card {
      display: grid;
      gap: 11px;
      padding: 15px;
      border: 1px solid color-mix(in srgb, var(--accent) 42%, var(--border));
      border-radius: 15px;
      background: color-mix(in srgb, var(--input) 82%, transparent);
      box-shadow: 0 10px 26px color-mix(in srgb, var(--foreground) 9%, transparent);
    }
    .coden-approval-kicker {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      color: var(--text-secondary);
      font-size: 11px;
      font-weight: 760;
      letter-spacing: .02em;
      text-transform: uppercase;
    }
    .coden-approval-kicker > span {
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: var(--syntax-orange);
      box-shadow: 0 0 0 4px color-mix(in srgb, var(--danger) 14%, transparent);
    }
    .coden-approval-card[data-state="approved"] .coden-approval-kicker > span { background: var(--success); }
    .coden-approval-card[data-state="rejected"] .coden-approval-kicker > span { background: var(--danger); }
    .coden-approval-heading {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
    }
    .coden-approval-heading h3 {
      min-width: 0;
      margin: 0;
      color: var(--foreground);
      font-size: 14px;
      line-height: 1.3;
      overflow-wrap: anywhere;
    }
    .coden-approval-source {
      flex: 0 0 auto;
      color: var(--text-muted);
      font-size: 10px;
      font-weight: 650;
    }
    .coden-approval-card > p,
    .coden-approval-result {
      margin: 0;
      color: var(--text-secondary);
      font-size: 12px;
      line-height: 1.55;
    }
    .coden-approval-actions {
      display: flex;
      justify-content: flex-end;
      flex-wrap: wrap;
      gap: 8px;
      padding-top: 2px;
    }
    .coden-approval-actions button {
      min-height: 32px;
      border: 1px solid var(--border);
      border-radius: 9px;
      padding: 0 12px;
      background: transparent;
      color: var(--foreground);
      font: inherit;
      font-size: 11.5px;
      font-weight: 720;
      cursor: pointer;
      transition: transform 180ms cubic-bezier(.32,.72,0,1), background-color 180ms ease, border-color 180ms ease, opacity 180ms ease;
    }
    .coden-approval-actions button.is-primary {
      border-color: var(--accent);
      background: var(--accent);
      color: var(--text-on-accent);
    }
    .coden-approval-actions button:hover:not(:disabled) { filter: brightness(1.04); }
    .coden-approval-actions button:active:not(:disabled) { transform: scale(.98); }
    .coden-approval-actions button:disabled { cursor: wait; opacity: .55; }
    .coden-approval-actions button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

    .coden-plan-card {
      display: grid;
      gap: 12px;
      padding: 13px;
      border: 1px solid color-mix(in srgb, var(--accent) 38%, var(--border));
      border-radius: 16px;
      background: color-mix(in srgb, var(--input) 76%, transparent);
      box-shadow: 0 10px 26px color-mix(in srgb, var(--foreground) 9%, transparent);
    }
    /* Title and summary stay; the detail is what folds away. */
    .coden-plan-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
    }
    .coden-plan-heading {
      display: grid;
      gap: 6px;
      min-width: 0;
    }
    .coden-plan-kicker {
      display: flex;
      align-items: center;
      gap: 7px;
      color: var(--foreground);
      font-size: 13.5px;
      font-weight: 700;
      line-height: 1.3;
      letter-spacing: -.01em;
    }
    .coden-plan-kicker svg {
      flex: none;
      color: var(--accent);
    }
    .coden-plan-summary {
      margin: 0;
      color: var(--text-secondary);
      font-size: 12px;
      line-height: 1.55;
    }
    .coden-plan-trigger {
      flex: none;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      min-height: 27px;
      border: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
      border-radius: 999px;
      padding: 0 9px;
      background: transparent;
      color: var(--text-secondary);
      font: inherit;
      font-size: 11px;
      font-weight: 640;
      cursor: pointer;
      transition: color .16s ease, border-color .16s ease;
    }
    .coden-plan-trigger:hover {
      color: var(--foreground);
      border-color: var(--border);
    }
    .coden-plan-trigger svg { transition: transform .2s ease; }
    .coden-plan-trigger[aria-expanded="true"] svg { transform: rotate(180deg); }

    /* 0fr -> 1fr animates the height with no measurement and no layout thrash. */
    .coden-plan-content {
      display: grid;
      grid-template-rows: 0fr;
      transition: grid-template-rows .22s ease;
    }
    .coden-plan-content[data-open="true"] { grid-template-rows: 1fr; }
    .coden-plan-content > * { overflow: hidden; }

    @media (prefers-reduced-motion: reduce) {
      .coden-plan-content, .coden-plan-trigger svg { transition: none; }
    }
    .coden-plan-sections {
      display: grid;
      gap: 8px;
    }
    .coden-plan-section {
      padding: 9px 10px;
      border: 1px solid color-mix(in srgb, var(--border) 75%, transparent);
      border-radius: 11px;
      background: color-mix(in srgb, var(--background) 62%, transparent);
    }
    .coden-plan-section h4 {
      margin: 0 0 6px;
      color: var(--foreground);
      font-size: 10.5px;
      font-weight: 760;
      letter-spacing: .035em;
      text-transform: uppercase;
    }
    .coden-plan-section ul {
      display: grid;
      gap: 5px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .coden-plan-section li {
      display: grid;
      grid-template-columns: 5px minmax(0, 1fr);
      gap: 8px;
      color: var(--text-secondary);
      font-size: 11.5px;
      line-height: 1.45;
    }
    .coden-plan-section li::before {
      content: "";
      width: 5px;
      height: 5px;
      margin-top: 5px;
      border-radius: 999px;
      background: color-mix(in srgb, var(--accent) 72%, var(--text-muted));
    }
    /* Bottom right: where the eye lands after the summary, not before it. */
    .coden-plan-actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 7px;
      padding-top: 1px;
    }
    .coden-plan-actions kbd {
      margin-left: 7px;
      padding: 1px 4px;
      border-radius: 5px;
      background: color-mix(in srgb, var(--background) 16%, transparent);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 10px;
      font-weight: 600;
    }
    .coden-plan-actions button {
      display: inline-flex;
      align-items: center;
      min-height: 31px;
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 0 11px;
      background: transparent;
      color: var(--foreground);
      font: inherit;
      font-size: 11px;
      font-weight: 720;
      cursor: pointer;
    }
    .coden-plan-actions button.is-primary {
      border-color: var(--accent);
      background: var(--surface);
      color: var(--foreground);
    }
    .coden-plan-actions button:hover { filter: brightness(1.04); }

    .coden-recovery-card {
      display: grid;
      gap: 12px;
      padding: 16px;
      border: 1px solid color-mix(in srgb, var(--accent) 28%, var(--border));
      border-radius: 16px;
      background: color-mix(in srgb, var(--input) 72%, transparent);
      box-shadow: 0 10px 26px color-mix(in srgb, var(--foreground) 8%, transparent);
    }
    .coden-recovery-kicker {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      color: var(--text-secondary);
      font-size: 12px;
      font-weight: 700;
    }
    .coden-recovery-kicker span {
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: var(--surface);
      box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 12%, transparent);
    }
    .coden-recovery-card h3 {
      margin: 0;
      color: var(--foreground);
      font-size: 14px;
      line-height: 1.3;
      letter-spacing: -.01em;
    }
    .coden-recovery-card p {
      margin: 0;
      color: var(--text-secondary);
      font-size: 12px;
      line-height: 1.55;
    }
    .coden-recovery-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .coden-recovery-actions button {
      min-height: 32px;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 0 12px;
      background: transparent;
      color: var(--foreground);
      font: inherit;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
      transition: transform 180ms cubic-bezier(0.32,0.72,0,1), background-color 180ms cubic-bezier(0.32,0.72,0,1), border-color 180ms cubic-bezier(0.32,0.72,0,1);
    }
    .coden-recovery-actions button.is-primary {
      border-color: var(--accent);
      background: var(--accent);
      color: var(--text-on-accent);
    }
    .coden-recovery-actions button:hover { background: color-mix(in srgb, var(--accent) 10%, transparent); }
    .coden-recovery-actions button.is-primary:hover { background: var(--surface); filter: brightness(1.04); }
    .coden-recovery-actions button:active { transform: scale(.98); }
    .coden-recovery-actions button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

    @keyframes coden-message-in {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: translateY(0); }
    }

    @keyframes coden-pulse {
      0%, 100% { opacity: .55; transform: scale(.94); }
      50% { opacity: 1; transform: scale(1.08); }
    }

    @keyframes coden-dots-pulse {
      0%, 100% { opacity: .35; transform: translateY(0); }
      50% { opacity: 1; transform: translateY(-1px); }
    }

    .coden-tools-stack { display: grid; gap: 6px; margin: 8px 0; }
    .coden-tool {
      border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
      border-radius: 10px;
      background: color-mix(in srgb, var(--input) 60%, transparent);
      overflow: hidden;
    }
    .coden-tool-header {
      display: flex; align-items: center; gap: 8px; width: 100%;
      padding: 8px 10px; background: transparent; border: 0; cursor: pointer;
      color: var(--foreground); font: inherit; font-size: 12px; font-weight: 600;
    }
    .coden-tool-chevron { width: 12px; color: var(--text-muted); }
    .coden-tool-icon { display: inline-flex; }
    .coden-tool-name { flex: 1; text-align: left; }
    .coden-tool-status {
      font-size: 10.5px; font-weight: 600; padding: 2px 7px; border-radius: 999px;
      background: color-mix(in srgb, var(--accent) 14%, transparent);
      color: color-mix(in srgb, var(--foreground) 80%, var(--accent));
      text-transform: uppercase; letter-spacing: 0.04em;
    }
    .coden-tool-status.status-output-error {
      background: color-mix(in srgb, var(--danger) 18%, transparent);
      color: var(--danger);
    }
    .coden-tool-status.status-output-available {
      background: color-mix(in srgb, var(--success) 16%, transparent);
      color: var(--success);
    }
    .coden-tool-content {
      padding: 0 10px 10px;
      display: grid; gap: 8px;
      border-top: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
    }
    .coden-tool-input, .coden-tool-output-pre {
      margin: 8px 0 0; padding: 8px 10px;
      background: var(--surface); color: var(--foreground);
      border-radius: 8px; font-size: 11px; line-height: 1.5;
      overflow: auto; max-height: 280px;
    }
    .coden-tool-output.is-error { color: var(--danger); font-size: 12px; margin-top: 8px; }

    .coden-reasoning {
      border-left: 2px solid color-mix(in srgb, var(--accent) 50%, var(--border));
      padding-left: 10px; margin: 6px 0 10px; color: var(--text-secondary);
    }
    .coden-reasoning-trigger {
      background: transparent; border: 0; padding: 2px 0;
      color: var(--text-secondary); font-size: 11.5px; font-weight: 600;
      cursor: pointer;
    }
    .coden-reasoning-content { margin-top: 6px; font-size: 12px; }

    .coden-attachments { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
    .coden-attachment {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 6px 10px; border-radius: 8px; text-decoration: none;
      background: color-mix(in srgb, var(--input) 80%, transparent);
      color: var(--foreground); font-size: 11.5px;
      border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
    }
    .coden-attachment-meta { color: var(--text-muted); font-size: 10.5px; }

    @media (prefers-reduced-motion: reduce) {
      .coden-chat-message,
      .coden-live-dot,
      .coden-live-line.is-active span:first-child,
      .coden-chat-working::before,
      .coden-shimmer-dots {
        animation: none !important;
      }
    }
  `;
  document.head.appendChild(style);
}

function RichResponse({ content }: { content: string }) {
  const html = useMemo(() => renderMarkdown(content), [content]);
  return <div className="coden-rich-response" dangerouslySetInnerHTML={{ __html: html }} />;
}

export function ConversationDecision({ block, actions = [], callbacks = {} }: { block: CodenConversationBlock; actions?: CodenConversationAction[]; callbacks?: ConversationCallbacks }) {
  if (block.type === "approval") return <ConversationApproval block={block} onDecision={callbacks.onApprovalDecision} />;
  if (block.type === "plan") return <ConversationPlan block={block} actions={actions} />;
  if (block.type === "recovery") return <ConversationRecovery block={block} actions={actions} />;
  const stateLabel = block.state === "rejected" ? "Annulée" : block.state === "approved" ? "Confirmée" : "Décision requise";
  return (
    <section className="coden-decision-card" data-state={block.state} aria-label={block.title || stateLabel}>
      <div className="coden-decision-head">
        <span className="coden-decision-status" aria-hidden="true" />
        <span>{stateLabel}</span>
      </div>
      {block.title ? <h3>{block.title}</h3> : null}
      {block.body ? <p>{block.body}</p> : null}
      {actions.length ? (
        <div className="coden-decision-actions">
          {actions.map((action, index) => (
            <button key={action.id} type="button" className={index === 0 ? "is-primary" : "is-secondary"} onClick={action.onClick}>
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function ConversationApproval({ block, onDecision }: { block: CodenApprovalBlock; onDecision?: ConversationCallbacks['onApprovalDecision'] }) {
  const [busy, setBusy] = useState(false);
  const resolved = block.state !== "pending";
  const stateLabel = block.state === "approved" ? "Approuvée" : block.state === "rejected" ? "Refusée" : "Action requise";
  const decide = async (approved: boolean) => {
    if (!onDecision || busy || resolved) return;
    setBusy(true);
    try {
      await onDecision(block.itemId, approved);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="coden-approval-card" data-state={block.state} aria-label={block.action || "Approbation requise"}>
      <div className="coden-approval-kicker"><span aria-hidden="true" />{stateLabel}</div>
      <div className="coden-approval-heading">
        <h3>{block.action || "Action de l’agent"}</h3>
        <span className="coden-approval-source">Harness Coden</span>
      </div>
      {block.summary ? <p>{block.summary}</p> : null}
      {!resolved ? (
        <div className="coden-approval-actions">
          <button type="button" className="is-secondary" disabled={busy} onClick={() => void decide(false)}>Refuser</button>
          <button type="button" className="is-primary" disabled={busy} onClick={() => void decide(true)}>{busy ? "Enregistrement…" : "Continuer"}</button>
        </div>
      ) : (
        <p className="coden-approval-result">{block.state === "approved" ? "L’agent peut reprendre cette étape." : "L’agent ne poursuivra pas cette étape."}</p>
      )}
    </section>
  );
}

/** ⌘ on Apple hardware, Ctrl everywhere else — the hint has to match the key. */
function primaryModifierLabel() {
  if (typeof navigator === "undefined") return "Ctrl";
  return /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent) ? "⌘" : "Ctrl";
}

/**
 * The plan, as something to read before approving rather than a wall to scroll.
 *
 * The card used to lay everything flat: kicker, title, summary, then every
 * section expanded — six features and three architecture lines before the
 * button that actually matters. The decision a plan asks for is "build this or
 * not", and the summary answers it; the file list is the detail behind it.
 *
 * So: title and summary always visible, detail one click away, action at the
 * bottom right where the eye lands last.
 */
function ConversationRecovery({ block, actions = [] }: { block: CodenRecoveryBlock; actions?: CodenConversationAction[] }) {
  return (
    <section className="coden-recovery-card" aria-label={block.title || "Relance disponible"}>
      <div className="coden-recovery-kicker"><span aria-hidden="true" />Relance disponible</div>
      {block.title ? <h3>{block.title}</h3> : null}
      {block.body ? <p>{block.body}</p> : null}
      {actions.length ? (
        <div className="coden-recovery-actions">
          {actions.map((action, index) => (
            <button key={action.id} type="button" className={index === 0 ? "is-primary" : ""} onClick={action.onClick}>{action.label}</button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function ConversationPlan({ block, actions = [] }: { block: CodenPlanBlock; actions?: CodenConversationAction[] }) {
  const [open, setOpen] = useState(false);
  const cardRef = useRef<HTMLElement | null>(null);
  const contentId = useMemo(() => `coden-plan-${nanoid(6)}`, []);
  const primaryAction = actions[0];

  /*
   * The shortcut is real, because the hint is rendered.
   *
   * Showing `⌘↩` next to a button that only responds to a click is an
   * interface telling a small lie. It is bound globally — hands are in the
   * composer, not on this card — but only for the last actionable plan on
   * screen, so an older plan further up the conversation cannot answer for
   * the one the user is actually looking at.
   */
  useEffect(() => {
    if (!primaryAction) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
      const actionable = document.querySelectorAll('.coden-plan-card[data-actionable="true"]');
      if (actionable[actionable.length - 1] !== cardRef.current) return;
      event.preventDefault();
      primaryAction.onClick();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [primaryAction]);

  return (
    <section
      ref={cardRef}
      className="coden-plan-card"
      data-actionable={primaryAction ? "true" : "false"}
      aria-label={block.title || "Plan"}
    >
      <header className="coden-plan-header">
        <div className="coden-plan-heading">
          <div className="coden-plan-kicker">
            <FileText size={14} aria-hidden="true" />
            {block.title || "Plan"}
          </div>
          {block.summary ? <p className="coden-plan-summary">{block.summary}</p> : null}
        </div>
        {block.sections.length ? (
          <button
            type="button"
            className="coden-plan-trigger"
            aria-expanded={open}
            aria-controls={contentId}
            onClick={() => setOpen(value => !value)}
          >
            <span>{open ? "Masquer le détail" : "Voir le détail"}</span>
            <ChevronDown size={14} aria-hidden="true" />
          </button>
        ) : null}
      </header>

      {block.sections.length ? (
        // Collapsed with `grid-template-rows: 0fr`, so the height animates
        // without measuring anything — and `hidden` keeps the collapsed
        // content out of the tab order and out of a screen reader's way.
        <div className="coden-plan-content" id={contentId} data-open={open} hidden={!open}>
          <div className="coden-plan-sections">
            {block.sections.map(section => (
              <section className="coden-plan-section" key={section.id}>
                <h4>{section.label}</h4>
                <ul>{section.items.map((item, index) => <li key={`${section.id}-${index}`}>{item}</li>)}</ul>
              </section>
            ))}
          </div>
        </div>
      ) : null}

      {actions.length ? (
        <footer className="coden-plan-actions">
          {actions.map((action, index) => (
            <button key={action.id} type="button" className={index === 0 ? "is-primary" : ""} onClick={action.onClick}>
              {action.label}
              {index === 0 ? <kbd>{primaryModifierLabel()}↩</kbd> : null}
            </button>
          ))}
        </footer>
      ) : null}
    </section>
  );
}

function MessageView({ message, callbacks }: { message: CodenConversationMessage; callbacks: ConversationCallbacks }) {
  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";

  if (isUser) {
    return (
      <div className={`coden-chat-message ${message.role}${message.working ? " is-working" : ""}`} data-message-id={message.id}>
        <div className="coden-chat-bubble">
          {message.content}
          {message.actions?.length ? (
            <div className="coden-chat-actions">
              {message.actions.map((action) => (
                <button key={action.id} type="button" onClick={action.onClick}>
                  {action.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  if (isAssistant) {
    return (
      <div className={`coden-chat-message ${message.role}${message.working ? " is-working" : ""}`} data-message-id={message.id}>
        <section className="coden-agent-conversation-run" aria-busy={Boolean(message.working)}>
          {message.block
            ? <ConversationDecision block={message.block} actions={message.actions} callbacks={callbacks} />
            : message.liveRun?.chat
              ? <AgentMessage state={message.liveRun.chat} onCopy={() => { void navigator.clipboard.writeText(message.liveRun!.chat!.parts.filter(p => p.type === 'text').map(p => p.text).join('\n\n')); }} onDecisionSelect={callbacks.onDecisionSelect} onDecisionAnswers={callbacks.onDecisionAnswers} onArtifactOpen={callbacks.onArtifactOpen} />
              : message.content ? <Response isStreaming={Boolean(message.working)}>{message.content}</Response> : null}
          {!message.block && message.actions?.length ? (
            <div className="coden-chat-actions">
              {message.actions.map((action) => (
                <button key={action.id} type="button" onClick={action.onClick}>{action.label}</button>
              ))}
            </div>
          ) : null}
        </section>
      </div>
    );
  }

  return (
    <div className={`coden-chat-message ${message.role}${message.working ? " is-working" : ""}`} data-message-id={message.id}>
      <div className="coden-chat-bubble">
        {message.content}
        {message.actions?.length ? (
          <div className="coden-chat-actions">
            {message.actions.map((action) => (
              <button key={action.id} type="button" onClick={action.onClick}>
                {action.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ConversationApp({ store, host, callbacks }: { store: ReturnType<typeof createStore>; host: HTMLElement; callbacks: ConversationCallbacks }) {
  const [version, setVersion] = useState(0);
  const [hasUnread, setHasUnread] = useState(false);
  const messages = store.messages();
  const lastLengthRef = useRef(0);
  const scrollFrameRef = useRef<number | null>(null);
  const isAtBottomRef = useRef(true);
  const isStreaming = messages.some((m) => m.role === "assistant" && m.working);

  useEffect(() => store.subscribe(() => setVersion((value) => value + 1)), [store]);

  useEffect(() => {
    const syncScrollPosition = () => {
      const distanceFromBottom = host.scrollHeight - host.clientHeight - host.scrollTop;
      isAtBottomRef.current = distanceFromBottom < 36;
      if (isAtBottomRef.current) setHasUnread(false);
    };
    syncScrollPosition();
    host.addEventListener('scroll', syncScrollPosition, { passive: true });
    return () => host.removeEventListener('scroll', syncScrollPosition);
  }, [host]);

  useEffect(() => {
    void version;
    const distanceFromBottom = host.scrollHeight - host.clientHeight - host.scrollTop;
    const shouldFollow = isAtBottomRef.current || (messages.length !== lastLengthRef.current && distanceFromBottom < 96);
    if (shouldFollow && scrollFrameRef.current === null) {
      const startTop = host.scrollTop;
      const startedAt = performance.now();
      const animate = (now: number) => {
        const target = Math.max(0, host.scrollHeight - host.clientHeight);
        const progress = Math.min(1, (now - startedAt) / 240);
        const eased = 1 - Math.pow(1 - progress, 3);
        host.scrollTop = startTop + (target - startTop) * eased;
        if (progress < 1 && Math.abs(target - host.scrollTop) > 0.5) {
          scrollFrameRef.current = window.requestAnimationFrame(animate);
        } else {
          scrollFrameRef.current = null;
        }
      };
      scrollFrameRef.current = window.requestAnimationFrame(animate);
    } else if (version > 0 && !shouldFollow) {
      /*
       * Only when the reader has actually scrolled away.
       *
       * This branch also caught the case where the view was following but a
       * glide was already under way — which, while a reply streams, is most
       * frames. The "Nouveaux messages" pill flashed on and off under a
       * reader who was sitting at the bottom watching the text arrive.
       */
      setHasUnread(true);
    }

    lastLengthRef.current = messages.length;
  }, [host, messages.length, version, isStreaming]);

  useEffect(() => () => {
    if (scrollFrameRef.current !== null) window.cancelAnimationFrame(scrollFrameRef.current);
  }, []);

  const revealNewest = () => {
    isAtBottomRef.current = true;
    setHasUnread(false);
    host.scrollTo({ top: Math.max(0, host.scrollHeight - host.clientHeight), behavior: 'smooth' });
  };

  return (
    <div className="coden-conversation-react">
      {messages.length ? (
        messages.map((message) => <MessageView key={message.id} message={message} callbacks={callbacks} />)
      ) : (
        <div className="coden-conversation-empty">
          <h3>Entamez une conversation</h3>
          <p>Les messages apparaitront ici pendant que Coden repond, planifie ou construit.</p>
        </div>
      )}
      {hasUnread ? (
        <button type="button" className="coden-conversation-new-messages" onClick={revealNewest}>
          Nouveaux messages
        </button>
      ) : null}
    </div>
  );
}

export function mountBuilderConversation(host: HTMLElement, callbacks: ConversationCallbacks = {}): CodenConversationApi {
  ensureConversationStyles();
  host.innerHTML = "";
  const store = createStore();
  const root: Root = createRoot(host);
  root.render(<ConversationApp host={host} store={store} callbacks={callbacks} />);
  window.addEventListener("beforeunload", () => root.unmount(), { once: true });
  return store;
}
