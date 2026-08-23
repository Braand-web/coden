export type PendingPromptAttachment = {
  id: string;
  name: string;
  type: string;
  size: number;
  lastModified: number;
  dataUrl?: string;
  status?: 'pending' | 'uploaded' | 'failed';
};

type PromptInputActionsOptions = {
  root?: ParentNode;
  persistForBuilder?: boolean;
  onFiles?: (attachments: PendingPromptAttachment[]) => void | Promise<void>;
  onAttachmentsChange?: (attachments: PendingPromptAttachment[]) => void;
  onNotice?: (message: string, kind?: 'info' | 'success' | 'error') => void;
};

const DB_NAME = 'coden-prompt-attachments';
const DB_VERSION = 1;
const STORE_NAME = 'attachments';
const FALLBACK_KEY = 'coden-pending-attachment-names';
const MAX_FILES = 6;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_BYTES = 12 * 1024 * 1024;
const ACCEPTED_TYPES = [
  'image/*',
  'text/plain',
  'text/markdown',
  'application/json',
  'text/csv',
  'application/pdf',
].join(',');

function uid() {
  return `att-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatBytes(bytes: number) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

function attachmentKind(type: string, name: string) {
  if (type.startsWith('image/')) return 'image';
  if (/pdf/i.test(type) || /\.pdf$/i.test(name)) return 'PDF';
  if (/json/i.test(type) || /\.json$/i.test(name)) return 'JSON';
  if (/csv/i.test(type) || /\.csv$/i.test(name)) return 'CSV';
  if (/markdown/i.test(type) || /\.md$/i.test(name)) return 'MD';
  if (/text/i.test(type)) return 'TXT';
  return 'FILE';
}

function notify(message: string, kind: 'info' | 'success' | 'error' = 'info') {
  const existing = document.getElementById('coden-prompt-toast');
  existing?.remove();

  const toast = document.createElement('div');
  toast.id = 'coden-prompt-toast';
  toast.setAttribute('role', 'status');
  toast.style.cssText = [
    'position:fixed',
    'right:18px',
    'bottom:18px',
    'z-index:99999',
    'max-width:min(360px,calc(100vw - 32px))',
    'border:1px solid var(--border,rgba(9,9,11,.16))',
    'border-radius:12px',
    'padding:10px 12px',
    'font:12px/1.45 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
    'color:var(--text,#1c1c1c)',
    kind === 'error' ? 'background:#fff1f2' : kind === 'success' ? 'background:#f0fdf4' : 'background:var(--bg-surface,#fffdf8)',
    'box-shadow:0 18px 60px rgba(9,9,11,.16)',
  ].join(';');
  toast.textContent = message;
  document.body.appendChild(toast);
  window.setTimeout(() => toast.remove(), 3600);
}

function ensureStyles() {
  if (document.getElementById('coden-prompt-actions-style')) return;
  const style = document.createElement('style');
  style.id = 'coden-prompt-actions-style';
  style.textContent = `
    .prompt-attachment-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      padding: 8px 12px 2px;
    }
    .prompt-attachment-chip {
      display: inline-flex;
      align-items: center;
      max-width: 100%;
      gap: 8px;
      border: 1px solid color-mix(in srgb, var(--border, rgba(24,24,27,.16)) 86%, transparent);
      background: color-mix(in srgb, var(--bg-input, #fff) 94%, var(--text, #111) 6%);
      color: var(--text, #18181b);
      border-radius: 12px;
      padding: 6px 7px;
      font-size: 11px;
      line-height: 1.15;
      box-shadow: 0 1px 2px rgba(0,0,0,.04);
    }
    .prompt-attachment-thumb {
      width: 28px;
      height: 28px;
      border-radius: 8px;
      flex: 0 0 auto;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      background: color-mix(in srgb, var(--accent, #c4622d) 12%, transparent);
      border: 1px solid color-mix(in srgb, var(--accent, #c4622d) 18%, transparent);
      color: var(--text-muted, #6b7280);
      font-size: 9px;
      font-weight: 800;
      letter-spacing: .04em;
    }
    .prompt-attachment-thumb img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    .prompt-attachment-meta {
      min-width: 0;
      display: grid;
      gap: 2px;
    }
    .prompt-attachment-name {
      max-width: 150px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 650;
    }
    .prompt-attachment-sub {
      color: var(--text-muted, #71717a);
      font-size: 10px;
      white-space: nowrap;
    }
    .prompt-attachment-status {
      display: inline-block;
      width: 6px;
      height: 6px;
      border-radius: 999px;
      flex: 0 0 auto;
      background: var(--text-sub, #52525b);
    }
    .prompt-attachment-status.is-uploaded { background: #22c55e; }
    .prompt-attachment-status.is-failed { background: #ef4444; }
    .prompt-attachment-status.is-pending { background: #f59e0b; }
    .prompt-attachment-chip.is-failed {
      border-color: color-mix(in srgb, #ef4444 40%, transparent);
    }
    .prompt-attachment-chip button {
      width: 20px;
      height: 20px;
      border: 0;
      border-radius: 999px;
      background: color-mix(in srgb, var(--text, #111) 8%, transparent);
      color: var(--text-muted, #71717a);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      font-size: 13px;
      line-height: 1;
    }
    [data-prompt-action="voice"].is-recording,
    .btn-voice.is-recording {
      color: var(--accent-blue, #2f6df6) !important;
      border-color: color-mix(in srgb, var(--accent-blue, #2f6df6) 45%, transparent) !important;
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent-blue, #2f6df6) 16%, transparent);
    }
  `;
  document.head.appendChild(style);
}

function openDb(): Promise<IDBDatabase | null> {
  if (!('indexedDB' in window)) return Promise.resolve(null);
  return new Promise(resolve => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | undefined> {
  const db = await openDb();
  if (!db) return undefined;
  return new Promise(resolve => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    const request = callback(store);
    let value: T | undefined;
    if (request) {
      request.onsuccess = () => {
        value = request.result;
      };
    }
    tx.oncomplete = () => {
      db.close();
      resolve(value);
    };
    tx.onerror = () => {
      db.close();
      resolve(undefined);
    };
  });
}

export async function storePendingPromptAttachments(attachments: PendingPromptAttachment[]) {
  if (!attachments.length) {
    sessionStorage.removeItem(FALLBACK_KEY);
    await withStore('readwrite', store => {
      store.clear();
    });
    return;
  }
  const db = await openDb();
  if (!db) {
    const names = attachments.map(({ name, type, size }) => ({ name, type, size }));
    sessionStorage.setItem(FALLBACK_KEY, JSON.stringify(names));
    return;
  }

  const stored = await new Promise<boolean>(resolve => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    attachments.forEach(attachment => store.put(attachment));
    tx.oncomplete = () => {
      db.close();
      resolve(true);
    };
    tx.onerror = () => {
      db.close();
      resolve(false);
    };
  });
  if (!stored) {
    const names = attachments.map(({ name, type, size }) => ({ name, type, size }));
    sessionStorage.setItem(FALLBACK_KEY, JSON.stringify(names));
  }
}

export async function consumePendingPromptAttachments(): Promise<PendingPromptAttachment[]> {
  const records = await withStore<PendingPromptAttachment[]>('readwrite', store => store.getAll());
  await withStore('readwrite', store => {
    store.clear();
  });

  if (records?.length) return records;

  const fallback = sessionStorage.getItem(FALLBACK_KEY);
  sessionStorage.removeItem(FALLBACK_KEY);
  if (!fallback) return [];
  try {
    const parsed = JSON.parse(fallback);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item: any) => ({
      id: uid(),
      name: String(item.name || 'attachment'),
      type: String(item.type || ''),
      size: Number(item.size || 0),
      lastModified: Date.now(),
      status: 'pending',
    }));
  } catch {
    return [];
  }
}

function readFile(file: File): Promise<PendingPromptAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve({
        id: uid(),
        name: file.name,
        type: file.type || 'application/octet-stream',
        size: file.size,
        lastModified: file.lastModified,
        dataUrl: String(reader.result || ''),
        status: 'pending',
      });
    };
    reader.onerror = () => reject(reader.error || new Error('Unable to read file.'));
    reader.readAsDataURL(file);
  });
}

function insertAtCursor(textarea: HTMLTextAreaElement, value: string) {
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? start;
  const before = textarea.value.slice(0, start);
  const after = textarea.value.slice(end);
  const spacer = before && !before.endsWith(' ') && !before.endsWith('\n') ? ' ' : '';
  textarea.value = `${before}${spacer}${value}${after}`;
  const nextCursor = before.length + spacer.length + value.length;
  textarea.selectionStart = nextCursor;
  textarea.selectionEnd = nextCursor;
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.focus();
}

function renderChips(wrapper: Element, attachments: PendingPromptAttachment[], onRemove: (id: string) => void) {
  let chips = wrapper.querySelector('.prompt-attachment-chips') as HTMLElement | null;
  if (!chips) {
    chips = document.createElement('div');
    chips.className = 'prompt-attachment-chips';
    const actions = wrapper.querySelector('.input-actions');
    wrapper.insertBefore(chips, actions || null);
  }

  chips.innerHTML = attachments.map(attachment => {
    const status = attachment.status || 'pending';
    const kind = attachmentKind(attachment.type || '', attachment.name);
    const thumb = kind === 'image' && attachment.dataUrl
      ? `<img src="${escapeHtml(attachment.dataUrl)}" alt="">`
      : escapeHtml(kind);
    return `
    <div class="prompt-attachment-chip is-${status}" data-attachment-id="${attachment.id}">
      <span class="prompt-attachment-thumb">${thumb}</span>
      <span class="prompt-attachment-meta">
        <span class="prompt-attachment-name">${escapeHtml(attachment.name)}</span>
        <span class="prompt-attachment-sub">${escapeHtml(kind === 'image' ? 'Image' : kind)} &middot; ${formatBytes(attachment.size)}</span>
      </span>
      <span class="prompt-attachment-status is-${status}" title="${escapeHtml(status)}"></span>
      <button type="button" aria-label="Remove ${escapeHtml(attachment.name)}">&times;</button>
    </div>
  `;
  }).join('');

  chips.querySelectorAll<HTMLButtonElement>('button').forEach(button => {
    button.addEventListener('click', () => {
      const id = button.closest<HTMLElement>('[data-attachment-id]')?.dataset.attachmentId;
      if (id) onRemove(id);
    });
  });
}

function setButtonDefaults(button: HTMLButtonElement, action: 'upload' | 'voice') {
  button.type = 'button';
  button.dataset.promptAction = action;
  button.setAttribute('aria-label', action === 'upload' ? 'Attach files' : 'Voice input');
}

export function initPromptInputActions(options: PromptInputActionsOptions = {}) {
  ensureStyles();
  const root = options.root || document;
  const wrappers = Array.from(root.querySelectorAll<HTMLElement>('.input-wrapper'));

  wrappers.forEach(wrapper => {
    if (wrapper.dataset.promptActionsBound === 'true') return;

    const textarea = wrapper.querySelector('textarea') as HTMLTextAreaElement | null;
    if (!textarea) return;

    const uploadButton = wrapper.querySelector<HTMLButtonElement>(
      '[data-prompt-action="upload"], #btn-upload, .btn-upload, button[data-tooltip="Upload files"], button[title="Upload files"]',
    );
    const voiceButton = wrapper.querySelector<HTMLButtonElement>(
      '[data-prompt-action="voice"], #btn-voice, .btn-voice, button[data-tooltip="Voice input"], button[title="Voice input"]',
    );

    if (!uploadButton && !voiceButton) return;
    wrapper.dataset.promptActionsBound = 'true';

    let attachments: PendingPromptAttachment[] = [];
    const notice = options.onNotice || notify;

    if (uploadButton) {
      setButtonDefaults(uploadButton, 'upload');
      let input = wrapper.querySelector<HTMLInputElement>('input[type="file"][data-prompt-file-input], input[type="file"]');
      if (!input) {
        input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.accept = ACCEPTED_TYPES;
        input.dataset.promptFileInput = 'true';
        input.style.display = 'none';
        wrapper.appendChild(input);
      }
      input.dataset.promptFileInput = 'true';
      input.multiple = true;
      input.accept = input.accept || ACCEPTED_TYPES;

      const sync = async (next: PendingPromptAttachment[], selected: PendingPromptAttachment[] = next) => {
        attachments = next;
        options.onAttachmentsChange?.([...attachments]);
        const removeAttachment = async (id: string) => {
          attachments = attachments.filter(item => item.id !== id);
          renderChips(wrapper, attachments, removeAttachment);
          options.onAttachmentsChange?.([...attachments]);
          if (options.persistForBuilder !== false && !options.onFiles) {
            await storePendingPromptAttachments(attachments);
          }
        };
        renderChips(wrapper, attachments, removeAttachment);
        if (options.onFiles) {
          try {
            await options.onFiles(selected);
            const selectedIds = new Set(selected.map(item => item.id));
            attachments = attachments.map(item => selectedIds.has(item.id) ? { ...item, status: 'uploaded' } : item);
            renderChips(wrapper, attachments, removeAttachment);
          } catch (error) {
            const selectedIds = new Set(selected.map(item => item.id));
            attachments = attachments.map(item => selectedIds.has(item.id) ? { ...item, status: 'failed' } : item);
            renderChips(wrapper, attachments, removeAttachment);
            notice(error instanceof Error ? error.message : 'Attachment upload failed.', 'error');
          }
        } else if (options.persistForBuilder !== false) {
          await storePendingPromptAttachments(attachments);
        }
      };

      uploadButton.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        input?.click();
      });

      input.addEventListener('change', async () => {
        const files = Array.from(input?.files || []);
        input.value = '';
        if (!files.length) return;

        const remainingSlots = Math.max(0, MAX_FILES - attachments.length);
        if (!remainingSlots) {
          notice(`You can attach up to ${MAX_FILES} files.`, 'error');
          return;
        }
        const limited = files.slice(0, remainingSlots);
        if (files.length > remainingSlots) {
          notice(`Only ${MAX_FILES} files can be attached. Extra files were skipped.`, 'error');
        }
        const accepted = limited.filter(file => file.size <= MAX_FILE_BYTES);
        const rejected = limited.length - accepted.length;
        const total = attachments.reduce((sum, item) => sum + item.size, 0)
          + accepted.reduce((sum, file) => sum + file.size, 0);
        if (total > MAX_TOTAL_BYTES) {
          notice('Attachments are too large. Keep the total under 12 MB.', 'error');
          return;
        }
        if (rejected) notice(`${rejected} file(s) skipped because each attachment must be under 4 MB.`, 'error');

        try {
          const selected = await Promise.all(accepted.map(readFile));
          const next = [...attachments, ...selected];
          await sync(next, selected);
          if (accepted.length) notice(`${accepted.length} file(s) attached.`, 'success');
        } catch {
          const fallback = accepted.map(file => ({
            id: uid(),
            name: file.name,
            type: file.type || '',
            size: file.size,
            lastModified: file.lastModified,
            status: 'pending' as const,
          }));
          attachments = [...attachments, ...fallback];
          options.onAttachmentsChange?.([...attachments]);
          renderChips(wrapper, attachments, id => {
            attachments = attachments.filter(item => item.id !== id);
            options.onAttachmentsChange?.([...attachments]);
          });
          await storePendingPromptAttachments(fallback);
          notice('Files attached by name only because the browser could not read them.', 'error');
        }
      });
    }

    if (voiceButton) {
      setButtonDefaults(voiceButton, 'voice');
      let recognition: any = null;
      let recording = false;

      voiceButton.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();

        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SpeechRecognition) {
          notice('Voice input is not supported in this browser.', 'error');
          return;
        }

        if (recording && recognition) {
          recognition.stop();
          return;
        }

        recognition = new SpeechRecognition();
        recognition.lang = navigator.language || 'fr-FR';
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;
        recording = true;
        voiceButton.classList.add('is-recording');
        notice('Listening...', 'info');

        let committed = '';
        recognition.onresult = (event: any) => {
          let interim = '';
          for (let index = event.resultIndex; index < event.results.length; index += 1) {
            const transcript = event.results[index][0]?.transcript || '';
            if (event.results[index].isFinal) committed += transcript;
            else interim += transcript;
          }
          if (committed.trim()) {
            insertAtCursor(textarea, committed.trim());
            committed = '';
          } else if (interim.trim()) {
            voiceButton.setAttribute('title', interim.trim());
          }
        };
        recognition.onend = () => {
          recording = false;
          voiceButton.classList.remove('is-recording');
        };
        recognition.onerror = () => {
          recording = false;
          voiceButton.classList.remove('is-recording');
          notice('Voice recording failed. Check microphone permissions.', 'error');
        };
        recognition.start();
      });
    }
  });
}
