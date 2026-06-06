# Phase 2A: Local Interactive Web Console

Phase 2A adds the first browser-testable CodexNext loop.

```txt
Next.js Web Console
  -> HTTP + SSE on localhost
codexnext-agent serve
  -> CodexAppServerClient
  -> stdio
codex app-server
```

## Scope

Included:

- `codexnext serve`
- localhost-only agent HTTP API
- token-protected SSE event stream
- in-memory `LocalEvent` replay through `GET /api/events?after=<seq>`
- Next.js App Router Web Console
- browser chat messages through `turn/start` and `turn/steer`
- interrupt through `turn/interrupt`
- Goal set/get/clear through `thread/goal/set|get|clear`
- approval request bridge from app-server to browser decisions

Excluded:

- React Native
- Tauri or Electron
- NestJS or cloud Control Server
- pairing
- multi-device sync
- persistent database
- arbitrary shell or file API
- Codex TUI parsing
- simulated `/goal`
- direct exposure of Codex app-server WebSocket

## Run

Terminal 1:

```bash
pnpm --filter @codexnext/agent dev -- serve \
  --host 127.0.0.1 \
  --port 17361 \
  --web-origin http://127.0.0.1:3000
```

Terminal 2:

```bash
pnpm --filter @codexnext/web dev
```

Open the Web URL printed by `serve`, for example:

```txt
http://127.0.0.1:3000?agent=http%3A%2F%2F127.0.0.1%3A17361&token=<local-token>
```

## Manual Test

1. Connect to the local agent.
2. Start a session with a real local repo path as `cwd`.
3. Send a normal chat message without setting a Goal.
4. Confirm assistant deltas stream into ChatPanel.
5. Send a second message after completion and confirm the same thread continues.
6. Set a Goal in the Goal panel and confirm the panel updates.
7. During an active turn, send another message to steer.
8. Use Interrupt during a running turn.
9. If approval appears, choose accept, accept for session, decline, or cancel in the browser.
10. Inspect the Event timeline to confirm ordered `LocalEvent.seq` values and raw `codex.notification` payloads.

## Local API

All routes except `GET /api/health` require the local token.

- `GET /api/health`
- `GET /api/sessions`
- `POST /api/sessions`
- `POST /api/sessions/:sessionId/messages`
- `POST /api/sessions/:sessionId/goal`
- `GET /api/sessions/:sessionId/goal`
- `DELETE /api/sessions/:sessionId/goal`
- `POST /api/sessions/:sessionId/turns`
- `POST /api/sessions/:sessionId/turns/:turnId/steer`
- `POST /api/sessions/:sessionId/turns/:turnId/interrupt`
- `POST /api/approvals/:approvalId/decision`
- `GET /api/events?after=<seq>`
- `GET /api/events/stream?token=<token>&after=<seq>`

## Event Model

The agent emits replayable in-memory `LocalEvent` objects:

```ts
interface LocalEvent {
  id: string;
  seq: number;
  type: LocalEventType;
  ts: number;
  sessionId?: string;
  threadId?: string;
  turnId?: string;
  payload?: unknown;
}
```

`seq` is process-global and monotonically increasing. The current store is an in-memory ring buffer with a default limit of 2,000 events.

## Approval Bridge

In `serve` mode, approval requests are not immediately declined. The agent:

1. creates an `approvalId`
2. stores the pending resolver in process memory
3. emits `approval.requested`
4. waits for the Web decision endpoint
5. resolves the original app-server server-initiated request
6. emits `approval.resolved`

If no decision arrives before the timeout, the bridge resolves with decline.

