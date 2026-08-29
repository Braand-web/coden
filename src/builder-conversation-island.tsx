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
import { nanoid } from "nanoid";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Response } from "./components/ui/response";
import type { CodenStreamEvent } from "./lib/stream-protocol";
import { applyAgentStreamEvent, createAgentRunViewModel, type AgentRunViewModel } from "./services/agent-run-store";
import type { AgentMode } from "./services/agent-run-contract";
import { AgentRunPanel } from "./components/agent/agent-run-panel";
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
  view?: AgentRunViewModel;
};

export type CodenConversationMessage = {
  id: string;
  role: CodenConversationRole;
  content: string;
  working?: boolean;
  actions?: CodenConversationAction[];
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
  applyStreamEvent: (id: string, event: CodenStreamEvent) => void;
  appendAssistantDelta: (id: string, text: string) => void;
  finishLiveRun: (id: string, summary?: string) => void;
  failLiveRun: (id: string, message: string, status?: 'failed' | 'cancelled' | 'incomplete') => void;
  removeMessage: (id: string) => void;
  addAction: (id: string, label: string, onClick: () => void) => void;
  clear: () => void;
  messages: () => CodenConversationMessage[];
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
    .replace(/'/g, "&#039;");
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

function cloneMessages(messages: CodenConversationMessage[]) {
  return messages.map((message) => ({
    ...message,
    actions: [...(message.actions || [])],
    liveRun: message.liveRun
      ? {
        ...message.liveRun,
        lines: [...message.liveRun.lines],
        view: message.liveRun.view
          ? {
            ...message.liveRun.view,
            activities: message.liveRun.view.activities.map((item) => ({ ...item })),
            files: [...message.liveRun.view.files],
            checks: message.liveRun.view.checks.map((item) => ({ ...item })),
            warnings: [...message.liveRun.view.warnings],
            objective: message.liveRun.view.objective ? { ...message.liveRun.view.objective } : undefined,
            plan: message.liveRun.view.plan ? { ...message.liveRun.view.plan, steps: message.liveRun.view.plan.steps.map((step) => ({ ...step })) } : undefined,
            verification: message.liveRun.view.verification ? { ...message.liveRun.view.verification, checks: message.liveRun.view.verification.checks.map((item) => ({ ...item })) } : undefined,
          }
          : undefined,
      }
      : undefined,
  }));
}

function createStore() {
  let messages: CodenConversationMessage[] = [];
  const listeners = new Set<() => void>();
  let raf = 0;

  const notify = () => {
    if (raf) return;
    raf = window.requestAnimationFrame(() => {
      raf = 0;
      listeners.forEach((listener) => listener());
    });
  };

  const mutate = (callback: () => void) => {
    callback();
    notify();
  };

  const find = (id: string) => messages.find((message) => message.id === id);

  // ── Smooth streaming text reveal ─────────────────────────────────────────
  // Network deltas arrive in bursts; revealing them character-by-character on
  // animation frames keeps the assistant text flowing instead of jumping.
  // The reveal speed adapts to the backlog so the UI never lags the model,
  // and any authoritative full-content update flushes the buffer instantly.
  const pendingDeltas = new Map<string, string>();
  let drainRaf = 0;
  const prefersReducedMotion = () =>
    typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const drainPendingDeltas = () => {
    drainRaf = 0;
    if (!pendingDeltas.size) return;
    const instant = prefersReducedMotion();
    for (const [id, pending] of pendingDeltas) {
      const message = find(id);
      if (!message) {
        pendingDeltas.delete(id);
        continue;
      }
      // Network deltas are already the model's units of meaning. Flush them in
      // animation-frame batches instead of simulating a typewriter effect.
      const step = instant ? pending.length : Math.min(pending.length, 4096);
      message.content += pending.slice(0, step);
      const rest = pending.slice(step);
      if (rest) pendingDeltas.set(id, rest);
      else pendingDeltas.delete(id);
    }
    notify();
    if (pendingDeltas.size) drainRaf = window.requestAnimationFrame(drainPendingDeltas);
  };

  const scheduleDrain = () => {
    if (!drainRaf) drainRaf = window.requestAnimationFrame(drainPendingDeltas);
  };

  const enqueueAssistantDelta = (message: CodenConversationMessage, text: string) => {
    // First token after a "thinking" placeholder: drop the shimmer label so
    // the streamed text takes over cleanly without flashing the label.
    if (message.working && message.content && !pendingDeltas.has(message.id)) {
      message.content = "";
    }
    message.working = false;
    pendingDeltas.set(message.id, (pendingDeltas.get(message.id) || "") + text);
    scheduleDrain();
  };

  // A full-content update (final commit, block, parts…) is authoritative:
  // discard any not-yet-revealed streamed text for that message.
  const flushPendingDeltas = (id: string) => {
    pendingDeltas.delete(id);
  };

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
        view: createAgentRunViewModel({
          runId: meta.runId || `${message.id}:run`,
          prompt: meta.intent || '',
          requestedMode: meta.mode || 'auto',
          status: 'submitting',
          model: meta.model || 'unknown',
        }),
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
        flushPendingDeltas(id);
        message.content = content;
        if (content) message.working = false;
      });
    },
    setParts(id, parts, content = "") {
      mutate(() => {
        const message = find(id);
        if (!message) return;
        const text = textFromParts(parts, content);
        if (text) flushPendingDeltas(id);
        if (text) message.content = text;
        if (message.liveRun && text) {
          message.liveRun.summary = text;
          message.liveRun.status = message.liveRun.status === "failed" ? "failed" : "done";
          if (message.liveRun.view) {
            message.liveRun.view.assistantText = text;
            message.liveRun.view.hasFinal = true;
            if (message.liveRun.view.status !== 'failed' && message.liveRun.view.status !== 'needs_fix') message.liveRun.view.status = 'completed';
          }
        }
        message.working = false;
      });
    },
    setWorking(id, label) {
      mutate(() => {
        const message = find(id);
        if (!message) return;
        ensureLiveRun(message, { activeText: label });
      });
    },
    clearWorking(id) {
      mutate(() => {
        const message = find(id);
        if (!message) return;
        message.working = false;
      });
    },
    setBlock(id, block) {
      mutate(() => {
        const message = find(id);
        if (!message || !block) return;
        const text = textFromBlock(block);
        if (text) {
          flushPendingDeltas(id);
          message.content = text;
        }
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
      mutate(() => {
        const message = find(id);
        if (!message) return;
        ensureLiveRun(message, meta);
      });
    },
    applyStreamEvent(id, event) {
      mutate(() => {
        const message = find(id);
        if (!message) return;
        const run = ensureLiveRun(message);
        if (run.view) run.view = applyAgentStreamEvent(run.view, event);
        switch (event.type) {
          case "status":
            run.activeText = event.message;
            break;
          case "milestone":
            if (event.label) {
              run.activeText = event.label;
              addLine(run, event.label, event.state === "active" ? "active" : "done");
            }
            break;
          case "phase":
            if (event.label) {
              run.activeText = event.label;
              addLine(run, event.label, event.state === "failed" ? "failed" : event.state === "active" ? "active" : "done");
            }
            break;
          case "understanding":
            run.intentText = event.summary;
            run.activeText = event.summary;
            addLine(run, event.summary, "active");
            break;
          case "assumption":
            run.activeText = event.text;
            addLine(run, event.text, "active");
            break;
          case "clarification":
            run.activeText = event.question;
            addLine(run, event.question, "active");
            break;
          case "plan":
            event.steps.slice(0, 5).forEach((step) => addLine(run, step.title || step.id, "muted"));
            break;
          case "plan_step":
            addLine(run, event.stepId, event.state === "failed" ? "failed" : event.state === "active" ? "active" : "done");
            break;
          case "assistant_delta":
            run.assistantText += event.text;
            enqueueAssistantDelta(message, event.text);
            break;
          case "activity_changed":
            run.activeText = event.message;
            message.working = event.active;
            break;
          case "assistant_message_completed":
            message.working = false;
            break;
          case "decision_required":
            message.working = false;
            break;
          case "preview_ready":
          case "deployment_ready":
            message.working = false;
            break;
          case "cancelled":
            run.status = "cancelled";
            message.working = false;
            break;
          case "blocked":
            run.status = "failed";
            run.summary = event.message;
            message.working = false;
            break;
          case "file_start":
            run.activeText = event.path;
            addLine(run, run.activeText, "active");
            break;
          case "file_delta":
            run.activeText = event.path;
            break;
          case "file_done":
            addLine(run, event.path, "done");
            break;
          case "check":
            addLine(
              run,
              `${humanCheckName(event.name)} ${humanCheckStatus(event.status)}${event.detail ? ` - ${event.detail}` : ""}`,
              liveLineStatusForCheck(event.status),
            );
            break;
          case "warning":
            addLine(run, event.message, "failed");
            break;
          case "error":
            run.status = event.recoverable ? "failed" : "failed";
            run.summary = event.message;
            addLine(run, event.message, "failed");
            message.working = false;
            break;
          case "done":
            run.status = run.status === "failed" ? "failed" : "done";
            message.working = false;
            break;
          case "tool_call": {
            const existing = run.tools.find((t) => t.id === event.callId);
            if (existing) {
              existing.input = event.input ?? existing.input;
              existing.status = event.state || "input-available";
            } else {
              run.tools.push({
                id: event.callId,
                name: event.name,
                input: event.input,
                status: event.state || "input-available",
              });
            }
            addLine(run, `Outil: ${event.name}`, "active");
            break;
          }
          case "tool_result": {
            const entry = run.tools.find((t) => t.id === event.callId);
            const outputText = typeof event.output === "string" ? event.output : event.output != null ? JSON.stringify(event.output, null, 2) : undefined;
            if (entry) {
              entry.status = event.error ? "output-error" : "output-available";
              entry.output = outputText;
              entry.error = event.error;
            } else {
              run.tools.push({
                id: event.callId,
                name: event.name || "tool",
                status: event.error ? "output-error" : "output-available",
                output: outputText,
                error: event.error,
              });
            }
            addLine(run, `Outil ${event.error ? "echec" : "OK"}: ${event.name || event.callId}`, event.error ? "failed" : "done");
            break;
          }
          case "source":
            if (!run.sources.find((s) => s.url === event.url)) {
              run.sources.push({ id: nanoid(), url: event.url, title: event.title });
            }
            break;
          case "citation":
            if (!run.sources.find((s) => s.url === event.url)) {
              run.sources.push({ id: nanoid(), url: event.url, title: event.title });
            }
            break;
          case "attachment":
            run.attachments.push({
              id: nanoid(),
              name: event.name,
              url: event.url,
              mediaType: event.mediaType,
              size: event.size,
            });
            break;
          case "skill_resolved":
            run.skillId = event.skill_id;
            run.skillVersion = event.skill_version;
            run.activeText = `Skill ${event.skill_id} sélectionné.`;
            addLine(run, run.activeText, "active");
            break;
          case "skill_started":
            run.skillId = event.skill_id;
            run.skillVersion = event.skill_version;
            run.activeText = `Skill ${event.skill_id} actif.`;
            addLine(run, run.activeText, "active");
            break;
          case "skill_budget_exhausted":
            run.activeText = `Budget du skill ${event.skill_id} atteint.`;
            addLine(run, run.activeText, "failed");
            break;
          case "approval_requested":
            run.activeText = event.summary;
            addLine(run, event.summary, "active");
            break;
          case "verification_started":
            run.activeText = "Coden vérifie le résultat réel.";
            addLine(run, run.activeText, "active");
            break;
          case "verification_completed":
            run.activeText = event.status === "pass" ? "Vérification terminée." : "Vérification incomplète.";
            addLine(run, run.activeText, event.status === "pass" ? "done" : "failed");
            break;
          default:
            break;
        }
      });
    },
    appendAssistantDelta(id, text) {
      if (!text) return;
      mutate(() => {
        const message = find(id);
        if (!message) return;
        if (message.liveRun) message.liveRun.assistantText += text;
        if (message.liveRun?.view) {
          message.liveRun.view.assistantText += text;
          if (['submitting', 'understanding', 'planning'].includes(message.liveRun.view.status)) message.liveRun.view.status = 'executing';
        }
        enqueueAssistantDelta(message, text);
      });
    },
    finishLiveRun(id, summary = "") {
      mutate(() => {
        const message = find(id);
        if (!message) return;
        const run = ensureLiveRun(message);
        run.status = run.status === "failed" ? "failed" : "done";
        run.summary = summary || run.summary;
        if (run.view) {
          run.view.hasFinal = Boolean(summary || run.view.assistantText);
          if (run.view.status !== 'failed' && run.view.status !== 'needs_fix') run.view.status = 'completed';
        }
        message.working = false;
        if (!message.content && !pendingDeltas.has(id) && run.summary) message.content = run.summary;
      });
    },
    failLiveRun(id, summary, status = 'failed') {
      mutate(() => {
        const message = find(id);
        if (!message) return;
        flushPendingDeltas(id);
        const run = ensureLiveRun(message);
        run.status = status === 'cancelled' ? 'cancelled' : 'failed';
        run.summary = summary;
        run.activeText = '';
        addLine(run, summary, 'failed');
        if (run.view) {
          run.view.status = status;
          run.view.hasFinal = false;
          run.view.warnings = [...run.view.warnings, summary];
        }
        message.content = summary;
        message.working = false;
      });
    },
    removeMessage(id) {
      mutate(() => {
        flushPendingDeltas(id);
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
    clear() {
      mutate(() => {
        pendingDeltas.clear();
        messages = [];
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
      color: var(--text-sub);
      padding: 16px;
      background: color-mix(in srgb, var(--bg-surface) 56%, transparent);
    }

    .coden-conversation-empty h3 {
      margin: 0 0 7px;
      color: var(--text);
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
      color: var(--text);
      background: color-mix(in srgb, var(--bg-surface) 78%, transparent);
      box-shadow: 0 1px 2px rgba(0,0,0,.04);
      overflow-wrap: anywhere;
      word-break: break-word;
      font-size: 12.5px;
      line-height: 1.62;
    }

    .coden-chat-message.user .coden-chat-bubble {
      max-width: min(86%, 520px);
      background: var(--text);
      color: var(--bg);
      border-color: transparent;
      white-space: pre-wrap;
    }

    .coden-chat-message.system .coden-chat-bubble {
      color: var(--text-sub);
      background: transparent;
      border-style: dashed;
    }

    .coden-chat-working {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      color: var(--text-sub);
    }

    .coden-chat-working::before {
      content: "";
      width: 7px;
      height: 7px;
      border-radius: 999px;
      background: var(--accent, #3b82f6);
      box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent, #3b82f6) 42%, transparent);
      animation: coden-pulse 1.25s ease-in-out infinite;
    }

    .coden-agent-pending {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      min-height: 18px;
      color: var(--text-sub);
    }
    .coden-agent-pending > span {
      width: 5px;
      height: 5px;
      border-radius: 999px;
      background: var(--accent, #3b82f6);
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
      color: var(--text);
      font-size: 12px;
      font-weight: 720;
    }

    .coden-skill-chip {
      display: inline-flex;
      align-items: center;
      min-height: 20px;
      padding: 0 7px;
      border: 1px solid var(--border, rgba(148,163,184,.25));
      border-radius: 999px;
      color: var(--text-muted, #94a3b8);
      font: 600 10px/1.2 "JetBrains Mono", monospace;
      letter-spacing: .01em;
      flex: 0 0 auto;
    }

    .coden-live-dot {
      width: 7px;
      height: 7px;
      border-radius: 999px;
      background: #10b981;
      flex: 0 0 auto;
      animation: coden-pulse 1.25s ease-in-out infinite;
    }

    .coden-live-dot.is-done { animation: none; background: #22c55e; }
    .coden-live-dot.is-failed { animation: none; background: #ef4444; }

    .coden-live-time {
      color: var(--text-muted);
      font-size: 11px;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }

    .coden-shimmer-text {
      display: inline;
      color: color-mix(in srgb, var(--text) 86%, var(--accent, #3b82f6));
      background: linear-gradient(90deg, var(--text-muted), var(--text), var(--accent, #3b82f6), var(--text));
      background-size: 260% 100%;
      -webkit-background-clip: text;
      background-clip: text;
      -webkit-text-fill-color: transparent;
      animation: coden-text-shimmer 2.25s ease-in-out infinite;
    }

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
      color: var(--text-sub);
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
      background: var(--accent, #3b82f6);
      animation: coden-pulse 1.25s ease-in-out infinite;
    }

    .coden-live-line.is-done span:first-child { background: #22c55e; }
    .coden-live-line.is-failed span:first-child { background: #ef4444; }
    .coden-live-line.is-muted { opacity: .65; }

    .coden-live-summary {
      color: var(--text);
      font-size: 12.5px;
      line-height: 1.55;
    }

    .coden-rich-response {
      color: var(--text);
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
      border-left: 2px solid color-mix(in srgb, var(--accent, #3b82f6) 55%, var(--border));
      color: var(--text-sub);
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
      background: color-mix(in srgb, var(--bg-input) 80%, transparent);
      font-weight: 720;
    }
    .coden-rich-response code:not(pre code) {
      padding: 1px 5px;
      border-radius: 6px;
      background: color-mix(in srgb, var(--bg-input) 90%, transparent);
      color: var(--text);
      font-size: .92em;
    }
    .coden-code-block {
      margin: 10px 0;
      padding: 12px;
      border-radius: 11px;
      overflow: auto;
      background: #0f1117;
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
      background: var(--bg-input);
      color: var(--text);
      padding: 0 10px;
      font: inherit;
      font-size: 11px;
      font-weight: 700;
      cursor: pointer;
    }

    @keyframes coden-message-in {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: translateY(0); }
    }

    @keyframes coden-pulse {
      0%, 100% { opacity: .55; transform: scale(.94); }
      50% { opacity: 1; transform: scale(1.08); }
    }

    @keyframes coden-text-shimmer {
      0% { background-position: 180% 0; }
      100% { background-position: -80% 0; }
    }

    @keyframes coden-dots-pulse {
      0%, 100% { opacity: .35; transform: translateY(0); }
      50% { opacity: 1; transform: translateY(-1px); }
    }

    .coden-tools-stack { display: grid; gap: 6px; margin: 8px 0; }
    .coden-tool {
      border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
      border-radius: 10px;
      background: color-mix(in srgb, var(--bg-input) 60%, transparent);
      overflow: hidden;
    }
    .coden-tool-header {
      display: flex; align-items: center; gap: 8px; width: 100%;
      padding: 8px 10px; background: transparent; border: 0; cursor: pointer;
      color: var(--text); font: inherit; font-size: 12px; font-weight: 600;
    }
    .coden-tool-chevron { width: 12px; color: var(--text-muted); }
    .coden-tool-icon { display: inline-flex; }
    .coden-tool-name { flex: 1; text-align: left; }
    .coden-tool-status {
      font-size: 10.5px; font-weight: 600; padding: 2px 7px; border-radius: 999px;
      background: color-mix(in srgb, var(--accent, #3b82f6) 14%, transparent);
      color: color-mix(in srgb, var(--text) 80%, var(--accent, #3b82f6));
      text-transform: uppercase; letter-spacing: 0.04em;
    }
    .coden-tool-status.status-output-error {
      background: color-mix(in srgb, #ef4444 18%, transparent);
      color: #ef4444;
    }
    .coden-tool-status.status-output-available {
      background: color-mix(in srgb, #22c55e 16%, transparent);
      color: #16a34a;
    }
    .coden-tool-content {
      padding: 0 10px 10px;
      display: grid; gap: 8px;
      border-top: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
    }
    .coden-tool-input, .coden-tool-output-pre {
      margin: 8px 0 0; padding: 8px 10px;
      background: #0f1117; color: #e5e7eb;
      border-radius: 8px; font-size: 11px; line-height: 1.5;
      overflow: auto; max-height: 280px;
    }
    .coden-tool-output.is-error { color: #ef4444; font-size: 12px; margin-top: 8px; }

    .coden-reasoning {
      border-left: 2px solid color-mix(in srgb, var(--accent, #3b82f6) 50%, var(--border));
      padding-left: 10px; margin: 6px 0 10px; color: var(--text-sub);
    }
    .coden-reasoning-trigger {
      background: transparent; border: 0; padding: 2px 0;
      color: var(--text-sub); font-size: 11.5px; font-weight: 600;
      cursor: pointer;
    }
    .coden-reasoning-content { margin-top: 6px; font-size: 12px; }

    .coden-attachments { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
    .coden-attachment {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 6px 10px; border-radius: 8px; text-decoration: none;
      background: color-mix(in srgb, var(--bg-input) 80%, transparent);
      color: var(--text); font-size: 11.5px;
      border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
    }
    .coden-attachment-meta { color: var(--text-muted); font-size: 10.5px; }

    @media (prefers-reduced-motion: reduce) {
      .coden-chat-message,
      .coden-live-dot,
      .coden-live-line.is-active span:first-child,
      .coden-chat-working::before,
      .coden-shimmer-text,
      .coden-shimmer-dots {
        animation: none !important;
      }
      .coden-shimmer-text {
        -webkit-text-fill-color: currentColor;
        background: none;
      }
    }
  `;
  document.head.appendChild(style);
}

function RichResponse({ content }: { content: string }) {
  const html = useMemo(() => renderMarkdown(content), [content]);
  return <div className="coden-rich-response" dangerouslySetInnerHTML={{ __html: html }} />;
}

function MessageView({ message }: { message: CodenConversationMessage }) {
  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";
  const run = message.liveRun;

  if (isAssistant && run?.view) {
    const retryAction = message.actions?.find((action) => /r[ée]essayer|retry/i.test(action.label));
    const buildPlanAction = message.actions?.find((action) => /construire.*plan|build.*plan|planifier la construction/i.test(action.label));
    return (
      <div className={`coden-chat-message ${message.role}${message.working ? " is-working" : ""}`} data-message-id={message.id}>
        <AgentRunPanel
          view={run.view}
          streamText={message.content}
          onRetry={retryAction?.onClick}
          onBuildPlan={buildPlanAction?.onClick}
        />
        {message.actions?.length ? (
          <div className="coden-chat-actions">
            {message.actions.map((action) => (
              <button key={action.id} type="button" onClick={action.onClick}>{action.label}</button>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

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
          {message.content ? <Response isStreaming={Boolean(message.working)}>{message.content}</Response> : null}
          {message.actions?.length ? (
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

function ConversationApp({ store, host }: { store: ReturnType<typeof createStore>; host: HTMLElement }) {
  const [version, setVersion] = useState(0);
  const messages = store.messages();
  const lastLengthRef = useRef(0);
  const scrollFrameRef = useRef<number | null>(null);
  const isStreaming = messages.some((m) => m.role === "assistant" && m.working);

  useEffect(() => store.subscribe(() => setVersion((value) => value + 1)), [store]);

  useEffect(() => {
    void version;
    const distanceFromBottom = host.scrollHeight - host.clientHeight - host.scrollTop;
    const shouldFollow = distanceFromBottom < 180 || (messages.length !== lastLengthRef.current && distanceFromBottom < 420);
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
    }

    lastLengthRef.current = messages.length;
  }, [host, messages.length, version, isStreaming]);

  useEffect(() => () => {
    if (scrollFrameRef.current !== null) window.cancelAnimationFrame(scrollFrameRef.current);
  }, []);

  return (
    <div className="coden-conversation-react">
      {messages.length ? (
        messages.map((message) => <MessageView key={message.id} message={message} />)
      ) : (
        <div className="coden-conversation-empty">
          <h3>Entamez une conversation</h3>
          <p>Les messages apparaitront ici pendant que Coden repond, planifie ou construit.</p>
        </div>
      )}
    </div>
  );
}

export function mountBuilderConversation(host: HTMLElement): CodenConversationApi {
  ensureConversationStyles();
  host.innerHTML = "";
  const store = createStore();
  const root: Root = createRoot(host);
  root.render(<ConversationApp host={host} store={store} />);
  window.addEventListener("beforeunload", () => root.unmount(), { once: true });
  return store;
}
