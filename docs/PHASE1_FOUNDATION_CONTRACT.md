# Phase 1 Foundation Contract

Phase 1 is the stable local Codex app-server foundation that relay, Web, mobile, and multi-device work are allowed to build on. It is not a product UI and it is not a replacement for Codex permissions.

## Stable Contracts

- `packages/protocol` owns Codex app-server method constants, notification names, server-initiated approval request names, shared relay method names, Socket.IO namespace/path constants, and Zod schemas for public request shapes.
- Token-bearing relay response schemas must reject unexpected fields so owner/browser/device tokens cannot be silently accepted through the wrong response contract.
- `packages/codex-client` owns JSON-RPC transport mechanics: request ids, notification dispatch, server-initiated request handlers, response errors, transport close errors, and request timeouts.
- `CodexAppServerClient` maps stable wrapper methods to `CodexClientMethod` constants and declines command/file approval requests by default when no approval handler returns a decision.
- `codexnext doctor` is a diagnostic command. It reports prerequisite status and secret presence/risk, but must not print raw owner tokens, relay session tokens, device tokens, prompts, assistant content, or command output.
- `codexnext goal-smoke` is a local smoke path for validating Codex app-server compatibility and Goal/turn wiring. It may print the requested goal and live app-server output by design, so it is not a safe log-redaction boundary.

## Dev Smoke Paths

- `goal-smoke` starts local `codex app-server --stdio`, creates a thread, sets a goal, starts one turn, and waits for completion. Failures in Codex availability, model access, cwd permissions, or app-server compatibility should be reported as local prerequisite/app-server failures rather than project phase failures.
- Hidden direct mode remains a local troubleshooting path only. It requires `CODEXNEXT_ENABLE_DEV_DIRECT=1` and must not be used by browser, mobile, or relay product flows.

## JSON-RPC Boundary

The JSON-RPC client must keep these behaviors stable:

- request timeouts reject with `JsonRpcTimeoutError`
- server error responses reject with `JsonRpcResponseError`
- unknown notifications are emitted to listeners without failing pending requests
- unknown server-initiated requests return JSON-RPC `-32601`
- server-initiated handler failures return JSON-RPC `-32000`
- transport close/error rejects all pending requests

Coverage is in `packages/codex-client/test/json-rpc-client.test.ts`.
