export const CODEN_MESSAGE_STREAMING_PROMPT_VERSION = 'coden-message-streaming-prompt-v2';

export const CODEN_STRUCTURED_MESSAGE_STREAMING_CONTRACT = [
  `Message streaming prompt version: ${CODEN_MESSAGE_STREAMING_PROMPT_VERSION}.`,
  'Use structured message parts as the canonical chat representation.',
  'Do not flatten assistant output into a single raw content string when text, reasoning summaries, sources, files, tool calls, terminal output, diffs, errors, or completion state are available.',
  'A simple conversation streams text directly into the assistant message.',
  'A build, edit, or debug run enriches the same assistant message with compact parts: text, reasoning, tool_call, terminal, file_edit, code, diff, and final text.',
  'Never create one assistant message per token or per low-level event.',
  'Stream deltas are append-only and idempotent: each event is emitted once with a monotonic id, each delta is rendered exactly once, and the final assistant text must equal the concatenation of its deltas or replace them atomically in one final commit.',
  'Never emit or render the same chunk twice. If a transport retry redelivers events, deduplicate by event id before rendering.',
  'Reveal streamed text progressively and smoothly at reading pace; never dump a whole answer in one jump after a long silent wait when deltas were available earlier.',
  'Never show raw JSON, hidden intent labels, provider/model routing, token counts, hidden prompts, or chain-of-thought in user-visible stream parts.',
  'Render tool parts where they occur in the message, collapsed by default when they contain parameters or long output.',
  'Render a shimmer only while the request is submitted and no visible assistant part has arrived yet.',
  'Support ready, submitted, streaming, stopped, cancelled, failed, and completed states without losing already received safe output.',
  'Stop must cancel client rendering and request server cancellation when supported. Already streamed safe text stays visible after stop or failure.',
  'Persist the user message with stable idempotent identity, and persist the final assistant message once from trusted server-side completion data.',
  'After refresh, reconstruct the same message parts from persisted messages/events instead of inventing a new run.',
].join('\n');

export const CODEN_MESSAGE_PART_RENDERING_RULES = [
  'Message part rendering rules:',
  '- text: render as normal assistant prose or markdown.',
  '- reasoning/thinking: render a compact expandable reasoning summary, never raw chain-of-thought.',
  '- tool_call/dynamic-tool/tool-* : render action name, status, compact input/result, and sanitized error if present.',
  '- terminal/command: render command status and sanitized output.',
  '- file_edit: render path, action, additions, deletions, and optional excerpt.',
  '- code: render readable code block with language and filename when available.',
  '- diff: render a compact diff with path and hunks.',
  '- error: render a short actionable recovery message, not a stack trace dump.',
].join('\n');
