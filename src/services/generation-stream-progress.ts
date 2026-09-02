/**
 * Turns a partial generation stream into file progress events.
 *
 * Generation is the longest blocking step of a run and the user saw a single
 * "building" label for the whole of it. The model already streams its answer,
 * so the file boundaries are visible long before the run ends.
 *
 * This scanner is display-only by construction: it reports which file the model
 * is writing and how much of it has arrived, and never reconstructs content.
 * The files that get applied still come from the final validated parse, so a
 * mis-read here can only mis-label progress — it can never corrupt a project.
 */

export type GenerationProgressEvent =
  | { type: 'file_start'; path: string; index: number }
  | { type: 'file_delta'; path: string; chars: number }
  | { type: 'file_done'; path: string; bytes: number };

/** `"path": "src/App.tsx"` in the JSON envelope, or a ```lang path fence. */
const JSON_PATH = /"path"\s*:\s*"((?:[^"\\]|\\.){1,200})"/g;
const FENCE_PATH = /```[a-z0-9+-]*\s+([\w./@-]{1,200}\.[a-z0-9]{1,10})\s*\n/gi;

const MIN_DELTA_CHARS = 400;

function decodePath(raw: string): string {
  try {
    return JSON.parse(`"${raw}"`);
  } catch {
    return raw;
  }
}

export class GenerationProgressScanner {
  private buffer = '';
  private readonly seen = new Set<string>();
  private current: { path: string; startedAt: number } | null = null;
  private lastReportedChars = 0;
  private index = 0;

  /** Feed the accumulated stream text; returns the events it newly implies. */
  push(accumulated: string): GenerationProgressEvent[] {
    const text = String(accumulated || '');
    if (text.length < this.buffer.length) return [];
    this.buffer = text;

    const events: GenerationProgressEvent[] = [];
    for (const pattern of [JSON_PATH, FENCE_PATH]) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(text))) {
        const path = decodePath(match[1]).trim();
        if (!path || this.seen.has(path)) continue;
        this.seen.add(path);
        if (this.current) {
          events.push({ type: 'file_done', path: this.current.path, bytes: Math.max(0, match.index - this.current.startedAt) });
        }
        this.index += 1;
        events.push({ type: 'file_start', path, index: this.index });
        this.current = { path, startedAt: match.index };
        this.lastReportedChars = 0;
      }
    }

    if (this.current) {
      const chars = text.length - this.current.startedAt;
      if (chars - this.lastReportedChars >= MIN_DELTA_CHARS) {
        this.lastReportedChars = chars;
        events.push({ type: 'file_delta', path: this.current.path, chars });
      }
    }
    return events;
  }

  /** Close the file still open when the stream ends. */
  finish(): GenerationProgressEvent[] {
    if (!this.current) return [];
    const done: GenerationProgressEvent = {
      type: 'file_done',
      path: this.current.path,
      bytes: Math.max(0, this.buffer.length - this.current.startedAt),
    };
    this.current = null;
    return [done];
  }
}
