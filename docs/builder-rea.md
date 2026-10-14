# REA in the Coden Builder

The main session model receives four project-scoped tools alongside its existing
sandbox and preview tools. This is a server integration, independent of the
developer's Codex MCP configuration or global npm prefix.

`rea-agents` 6.4.0 and the MCP client 2.3.1 are production dependencies. The
server runtime must use Node 22.19+, 24.11+, or 26+. `CODEN_REA_ENABLED=false`
removes the tools for rollback; they are available by default and start no
process until the model invokes one.

- `rea_inspect_artifact`: inventory a selected imported application directory or ASAR.
- `rea_analyze_javascript`: bounded static JavaScript application analysis.
- `rea_read_analysis`: a summary or module page of evidence from this run.
- `rea_trace_feature`: a focused exact incoming/outgoing feature trace.

Inventory and JavaScript analysis use REA's application-artifact route, which
supports directories and ASAR without a native engine. Identical snapshots reuse
the same evidence rather than parsing the application twice.

Use ordinary read/search/edit tools for ordinary project source work. These tools
are for shipped or imported application artifacts, not a replacement for normal
development. They do not execute imported code, browse URLs, install engines,
grant permissions, or publish applications.

Each run owns a separate MCP process and private temporary snapshots. Paths are
project-relative; private files, symlinks, other projects and unknown evidence
references are rejected. Node filesystem permissions restrict the worker to its
temporary directory and installed dependencies. It receives no application
credentials. This is a restricted analysis process, not an additional VM.

Limits: two concurrent server sessions, two artifact operations and twelve REA
calls per run, 512 directory entries, 128 selected files, 2 MiB per file and 8 MiB total. Each call has a
30-second ceiling; source analysis uses a 192 MiB heap and a 20-second deadline.
Oversized delivery is explicitly marked incomplete and follows up by evidence ID.
The selected file count, excluded file count, scope and evidence limitations are
returned. Evidence references remain private to the current run and disappear at
cleanup; they are not durable links usable after reconnecting.

Harness entries record `artifact.inspect`, evidence IDs, duration and delivery
coverage. The normal LLM token usage remains accounted for by the existing loop;
no separate REA credit debit is introduced. Failures are bounded tool results and
the Builder can continue with existing tools.

Verification:

    node node_modules/vitest/vitest.mjs run src/services/builder-rea/service.test.ts --maxWorkers=1
    REA_INTEGRATION=1 node node_modules/vitest/vitest.mjs run src/services/builder-rea/integration.test.ts --maxWorkers=1

In PowerShell, set `$env:REA_INTEGRATION='1'` before the integration command.
The Agent quality CI workflow also runs the real worker integration.

The integration test scripts the model's tool choice but calls the real REA MCP
server through the actual Builder loop. No paid LLM call is required. It verifies
analysis, evidence reuse, feature tracing, inventory, non-execution and the worker
filesystem boundary. Unit tests cover cross-user/project evidence isolation,
path traversal, secrets, symbolic paths, input budgets, cancellation and cleanup.
