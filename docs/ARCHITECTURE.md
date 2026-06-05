# Architecture

CodexNext Phase 1 is a local CLI smoke test for the Codex app-server protocol. It proves the core control-plane primitive before any Web, mobile, server, pairing, or multi-device work.

## Runtime Flow

```txt
codexnext goal-smoke
  -> spawn("codex", ["app-server", "--stdio"])
  -> initialize
  -> initialized notification
  -> thread/start
  -> thread/goal/set
  -> turn/start
  -> stream app-server notifications
  -> decline approval requests by callback
  -> turn/completed or Ctrl+C turn/interrupt
```

## Packages

`packages/protocol` owns shared protocol vocabulary:

- JSON-RPC message shapes
- Codex app-server method constants
- lightweight TypeScript types for phase-1 request and response payloads
- Zod validation for CLI inputs

`packages/codex-client` owns transport and protocol mechanics:

- request id allocation
- pending request tracking
- response matching
- error response conversion
- request timeout
- notification event emitter
- server-initiated request handling
- stdio child process transport
- Codex app-server method wrappers

`apps/agent` owns CLI behavior:

- environment checks in `doctor`
- smoke-test orchestration in `goal-smoke`
- human-readable app-server notification output
- Ctrl+C interruption

## Why stdio first

Stdio is the default app-server transport and keeps phase 1 private to the local machine. It avoids exposing a listener, avoids auth design too early, and mirrors the handoff requirement that the app-server stays on the user device.

## JSON-RPC Notes

Codex app-server uses JSON-RPC style messages with the `jsonrpc` header omitted on the wire. Requests have `id`, `method`, and optional `params`. Responses echo `id` and return either `result` or `error`. Notifications have `method` and optional `params` without `id`.

The client also handles server-initiated requests. This matters because approval prompts are requests from app-server to the client, not notifications.

## Phase Boundary

This architecture deliberately does not create a control server or UI. Those layers should depend on the same `@codexnext/codex-client` primitives after the smoke test proves the local app-server loop.

