# Roadmap

CodexNext is moving toward a stable relay-first personal Codex control plane. Historical handoff files remain useful context, but this roadmap is the current phase source of truth.

## Phase 1: Local Codex App-Server Smoke Test

Status: implemented.

- pnpm TypeScript monorepo
- shared protocol package
- JSON-RPC Codex app-server client
- `codexnext doctor`
- `codexnext goal-smoke`
- JSON-RPC tests and first ADRs

## Phase 2: Local Interactive Web Console

Status: implemented.

- local browser console
- Codex session create/message/interrupt
- live event stream and replay
- approval UI
- Goal controls
- history and chat UX foundation

## Phase 3A: Socket.IO Relay Foundation

Status: implemented.

- Fastify + Socket.IO control service
- outbound machine namespace
- browser/user namespace
- relay HTTP RPC adapters
- device presence and relay event transport

## Phase 3B-R: Relay-Only Security Cutover

Status: implemented.

- public Web login with HttpOnly cookie
- cookie-protected `/api/relay/session`
- relay-only Web product path
- direct mode hidden behind dev-only env
- pairing, device registry v2, revoke
- production CORS allowlists
- full-access follows Codex by default unless explicitly disabled

## Phase 3C: Relay Runtime Reliability, Observability & Release Readiness Gate

Status: completed.

Exit criteria:

- architecture, deployment, security, and README docs match current code
- Web login/session, control session, pairing, registry, revoke, full-access, and audit contracts are covered by tests
- event replay contract is `device:replay` for initial batches and `device:event` for live events
- reconnect/last-seq behavior avoids duplicate live events
- stale presence marks devices offline without clearing workspace state
- session expiry has predictable HTTP and Socket.IO behavior
- `/api/control/health` and audit logs are safe for operators
- `codexnext doctor` covers local prerequisites and relay diagnostics
- `pnpm typecheck`, `pnpm test`, and `pnpm --filter @codexnext/agent dev -- doctor` pass or any local external limitation is documented

## Phase 4: Mobile Client

Status: blocked on Phase 3C gate.

Phase 4 should begin only after Phase 3C proves the relay protocol and runtime contracts. The mobile client should consume the same Web/control relay path:

- Web-style login/session bootstrap adapted for mobile
- device list and presence
- session/history views
- turn steering and interrupt
- approval prompts
- replay using `device:replay` initial batches and `device:event` live events

Out of scope until after Phase 3C:

- React Native implementation
- OAuth/passkeys
- multi-user SaaS authorization

## Phase 5: Multi-Device Reliability

Status: future.

Phase 3C moves core runtime reliability earlier so mobile does not inherit an unstable relay. Phase 5 can build on that baseline with:

- durable multi-device session views
- longer retention and persistence choices
- richer reconnect UX
- local daemon/service polish
- conflict handling across simultaneous user clients
