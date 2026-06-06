# ADR 0002: Local Interactive Web Console

## Status

Accepted.

## Context

Phase 1 proved that CodexNext can control `codex app-server` over stdio from a TypeScript CLI. The next useful product proof is a browser console where the user can start a session, chat with Codex, manage a real Codex Goal, inspect events, and handle approval requests.

We do not yet need a cloud server, pairing, mobile app, database, or multi-device relay.

## Decision

Phase 2A uses:

- Next.js App Router for `apps/web`
- Node `http` server in `codexnext serve`
- HTTP POST routes for actions
- Server-Sent Events for realtime local events
- `GET /api/events?after=<seq>` for replay
- token and Origin checks for local browser access

Codex app-server remains private behind the local agent. The browser never connects to Codex app-server directly.

## Consequences

Positive:

- simplest browser-testable loop
- fewer dependencies than WebSocket or Socket.IO
- replayable ordered events are established early
- approval request handling becomes user-visible
- later WebSocket or Control Server work can reuse the same local session/event model

Negative:

- SSE is one-way, so commands still use HTTP POST
- process memory is lost when the local agent exits
- only one local machine is supported in this phase

## Security Notes

The default bind host is `127.0.0.1`. All API routes and event streams except health require a local token. Browser requests with unexpected `Origin` are rejected. OpenAI/Codex login state remains inside the user's local Codex installation.

