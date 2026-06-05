# ADR 0001: Codex app-server first

## Status

Accepted.

## Context

CodexNext is a personal Codex control plane. The core product needs to create Codex threads, set Goals, start and steer turns, interrupt turns, stream events, show diffs, show command output, and handle approval requests.

Codex already exposes these primitives through `codex app-server`. Parsing the Codex TUI or sending slash-command text would be less reliable and would lose protocol-level events.

## Decision

CodexNext integrates with Codex through `codex app-server` first. Phase 1 uses stdio transport only.

The first milestone calls:

- `initialize`
- `initialized`
- `thread/start`
- `thread/goal/set`
- `turn/start`
- `turn/interrupt`

Goal state is set with `thread/goal/set`. CodexNext does not simulate `/goal`.

## Consequences

Positive:

- keeps Codex auth and local repo access on the user's machine
- preserves streamed app-server events
- exposes approval requests as structured server-initiated JSON-RPC requests
- gives future Web and mobile clients a stable client package to reuse

Negative:

- depends on the installed Codex CLI version
- experimental app-server fields may change
- phase 1 must handle JSON-RPC and child-process lifecycle carefully

## Follow-up

Future phases can add WebSocket or relay transport, but should keep app-server as the Codex integration boundary.

