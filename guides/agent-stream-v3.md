# Minimal agent streaming — current implementation

`POST /api/projects/:id/generate` accepts `Accept: text/event-stream`. Authentication,
project permissions and request validation still run before opening the stream.
JSON clients keep their existing response. No second generation request is made.

Each SSE frame has `id: seq` and a JSON envelope containing `seq`, `runId`, `ts`,
`channel` and `payload`. Chat carries real activity, provider prose, completed
file actions and terminal events. Workspace carries sandbox events and the final
authoritative result (files, preview, verification and status code).

The multi-agent pipeline streams actual provider deltas. Tool arguments and file
bodies are not forwarded; fenced code is filtered. A files_touched event only
follows successful sandbox tool execution, grouped by action within the tool batch.
The legacy file generator reports real phases and its final result, not simulated
token streaming. Its internal generated JSON is deliberately never shown as prose.

The client handles split UTF-8, CRLF, multiline SSE data, duplicate sequence IDs,
terminal errors and interrupted connections. A heartbeat runs every 15 seconds.
An incomplete connection is an error, never a successful run. Existing files and
recoverable preview results remain available when checks fail.

## Explicit limitations

This is not yet a detached durable job protocol. Disconnecting cancels the current
request. Sequence IDs support duplicate suppression but do not by themselves provide
server replay. Automatic reconnect, durable event storage, Last-Event-ID replay and
rehydration of historical tool parts are NOT advertised as implemented. Do not retry
the generation POST automatically, because it may duplicate work or charges.

The existing harness cancellation APIs remain authoritative. Browser rendering is
batched by the conversation store with requestAnimationFrame; there are no fabricated
activity cycles or typewriter timers. Reduced motion disables decorative movement.
