# CodexNext

Your personal Codex control plane.

CodexNext is a relay-first control plane for Codex app-server. Users sign in to the Web UI, pair machines into a control server, and then control those machines from one browser entry. Product UX is relay-only: no Agent URL, Access Token, `?agent=`, or `?token=` in normal use.

## Included

- `packages/protocol`
- `packages/codex-client`
- `packages/relay-client`
- `apps/agent`
- `apps/control`
- `apps/web`
- relay login gate
- device pairing and revoke
- recent-first history loading
- shared recent-page cache for thread switching
- docs and ADRs
- `codexnext doctor`
- `codexnext goal-smoke`
- `codexnext pair`
- `codexnext connect`

## Conversation State Guardrails

These rules protect the chat path. Do not weaken them when adding features or
optimizing UI:

- The chat canvas reads from the normalized conversation store as the only live
  source of truth. Derived history, sidebar rows, or legacy `chatItems` mirrors
  may reconcile into that store, but must not replace live/pending/streaming
  state wholesale.
- Conversation identity is canonicalized by `conversationKey = threadId ??
  sessionId ?? pendingClientId`. RPC acknowledgements may remap aliases from an
  optimistic key to a real session/thread key, but the UI must not fork a second
  independent conversation.
- Sending a message must write a client message id, optimistic user message,
  and thinking placeholder immediately. The outbox state machine is
  `pending -> sent -> streaming -> complete/failed`; an RPC ack only means the
  backend accepted the turn, not that streaming is complete.
- Socket replay/live events may append or reconcile entities by sequence,
  message id, turn id, and client message id. They must not silently switch the
  user's selected conversation, reorder the active thread, or overwrite a live
  pending turn.
- History hydration is per-turn reconciliation. It may confirm completed turns
  and fill gaps, but it must preserve current live, pending, and streaming
  items unless the matching client message id, turn id, or message id proves
  replacement is correct.
- Development tracing must cover submit intent, queued state, RPC start, ack,
  socket receive, reducer apply, stream seen, selected conversation render, and
  reconciliation or failure. Render traces must stay summarized; never log the
  full visible message list on every render.

## Conversation Performance Guardrails

Cold conversation switching is a product-critical path. The implemented
architecture is local-first: clicking a conversation commits selection
immediately, renders normalized in-memory or persisted cache first, and lets
network history refresh run in the background.

- Selection should commit in under 50 ms. Do not block the click path on
  `getCodexHistoryTurns`, `listSessions`, event replay, or history hydration.
- Show the best local state first: in-memory conversation, persisted
  conversation cache, or a lightweight thread skeleton using sidebar title and
  preview metadata. Avoid empty waits for unopened conversations.
- Persist a bounded recent message cache per conversation in IndexedDB,
  separate from the outbox. The outbox is for unsent/in-flight recovery; it is
  not enough for fast cold thread switching.
- Revalidate stale conversations in the background and merge by message id,
  turn id, and client message id. Users should not experience "loading the whole
  history" as the primary interaction.
- Prefetch visible sidebar threads, pinned threads, and recent threads during
  idle time with a small concurrency budget.
- Large histories must use virtualized rendering or an equivalent windowing
  strategy. The chat canvas must not render hundreds of Markdown/code-highlighted
  messages in one synchronous pass.
- Development render logs must remain summary-only: selected key, message
  count, latest sequence, status counts, and latest item metadata. Do not log
  every visible message on each render.

## Not Included

- React Native
- OAuth / passkeys
- multi-user SaaS authorization
- non-Codex CLIs
- a rewritten Codex permission system

## Requirements

- Node >= 20
- pnpm
- Codex CLI with `codex app-server`
- a valid Codex login/session on each machine that will run an agent

## Install

```bash
pnpm install
```

## Verify

```bash
pnpm typecheck
pnpm test
pnpm --filter @codexnext/agent dev -- doctor
pnpm --filter @codexnext/agent dev -- doctor --relay https://<your-relay-host>
```

## Relay-Only Product Topology

Think in service roles, not in one fixed machine layout:

- `control`
  - device presence
  - relay RPC
  - event replay
  - stale presence
  - pairing / revoke
  - audit log
- `web`
  - login page
  - HttpOnly cookie session
  - relay session bootstrap
  - browser/mobile UI
- `agent`
  - one controllable Codex machine
  - outbound connection to control
  - local Codex execution
  - approvals still enforced by Codex itself

Common topology:

- one server runs `control + web + agent`
- every additional machine runs `agent`
- browsers and phones open only the Web URL

## Start The Relay Control Plane

Generate a password hash for the Web login gate:

```bash
node -e 'const {randomBytes,scryptSync}=require("node:crypto");const password=process.argv[1];const salt=randomBytes(16);const hash=scryptSync(password,salt,64);console.log(`scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`)' "your-password"
```

Start the control server:

```bash
pnpm --filter @codexnext/control dev --   --owner-token "$CODEXNEXT_OWNER_TOKEN"   --host 0.0.0.0   --port 3922   --production   --allow-origin https://your-web-origin.example
```

Start the Web app:

```bash
CODEXNEXT_RELAY_URL=http://127.0.0.1:3922 CODEXNEXT_OWNER_TOKEN="$CODEXNEXT_OWNER_TOKEN" CODEXNEXT_WEB_AUTH_PASSWORD_HASH="$CODEXNEXT_WEB_AUTH_PASSWORD_HASH" CODEXNEXT_WEB_SESSION_SECRET="$CODEXNEXT_WEB_SESSION_SECRET" CODEXNEXT_PUBLIC_ORIGIN=https://your-web-origin.example pnpm --filter @codexnext/web dev
```

Pair a machine into the relay:

```bash
pnpm --filter @codexnext/agent dev -- pair --relay https://<your-relay-host>
```

After pairing, the machine appears in the Web UI automatically.

## Long-Running Deployment

For Linux `systemd`, macOS `launchd`, and service-role deployment examples, see:

- [docs/RELAY_DEPLOYMENT.md](./docs/RELAY_DEPLOYMENT.md)

Bundled helpers currently cover:

- Linux `systemd`
  - any subset of `control,web,agent`
- macOS `launchd`
  - bundled helper currently targets `agent`
- Windows
  - WinSW XML templates for `control`, `web`, and `agent`
  - validate templates with `pnpm test:winsw`

Linux install examples:

```bash
./scripts/ops/install-linux-services.sh
./scripts/ops/install-linux-services.sh --roles agent
./scripts/ops/install-linux-services.sh --roles control,web
```

macOS agent install example:

```bash
./scripts/ops/install-macos-agent.sh
```

The agent startup helpers auto-discover a usable `codex` binary from common locations such as `PATH`, `~/.local/bin`, `~/bin`, and `~/.nvm/versions/node/*/bin`.

## Diagnostics

Use doctor before and after deployment:

```bash
pnpm --filter @codexnext/agent dev -- doctor
pnpm --filter @codexnext/agent dev -- doctor --relay https://<your-relay-host>
```

Doctor checks Node, pnpm, Codex CLI, device identity file permissions, relay health, Web/control env presence, production origin risks, and hidden direct-mode env state. It reports secret presence and risk without printing raw token values.

## Security Notes

- public relay Web requires login
- `ownerToken` is server-only
- relay session tokens are issued after login and should not be persisted client-side
- relay full-access follows Codex by default; set `CODEXNEXT_DISABLE_RELAY_FULL_ACCESS=1` on the control server only if you intentionally want an extra relay-only safety gate
- relay reconnect uses `device:replay` initial batches and `device:event` live events
- approvals and sandbox enforcement remain Codex-native
- shared relay client helpers define the Web/mobile replay auth boundary without storing owner or device tokens client-side

## Hidden Dev-Only Direct Mode

Direct mode is no longer part of the normal product path.

A hidden local troubleshooting path still exists for development only:

```bash
CODEXNEXT_ENABLE_DEV_DIRECT=1 pnpm --filter @codexnext/agent dev -- dev-serve --host 127.0.0.1 --port 17361
```

This command is intentionally hidden from normal UX and does not print tokenized Web URLs.
