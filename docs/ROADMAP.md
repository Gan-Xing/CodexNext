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
- `codexnext doctor` covers local prerequisites, relay diagnostics, Web/Socket route checks, Agent/Provider runtime checks, same-origin deployment checks, and expected-closed public service ports
- `pnpm typecheck`, `pnpm test`, and `pnpm --filter @codexnext/agent dev -- doctor` pass or any local external limitation is documented

## Phase 4: Mobile Client

Status: shared client boundary in progress; ready for scaffold after framework choice.

Phase 3C is complete, Cycle 01 started the shared relay client boundary in `packages/relay-client`, and Cycle 02 added shared relay URL/header helpers for device list, event replay, and approval decisions. The mobile client should consume the same Web/control relay path:

- Web-style login/session bootstrap adapted for mobile
- device list and presence
- session/history views
- turn steering and interrupt
- approval prompts
- replay using `device:replay` initial batches and `device:event` live events

Entry criteria:

- shared replay/auth helpers are covered by contract tests
- shared device list, replay, approval URL, and bearer-header helpers are covered by contract tests
- mobile session storage threat model is documented
- bootstrap request/response fixtures are documented in `docs/PHASE4_MOBILE_CLIENT_BASELINE.md`
- Web/control relay APIs remain the only client path

Exit criteria for the first mobile scaffold:

- a minimal app can authenticate, list devices, show presence, and replay one session stream without ownerToken or deviceToken in client storage
- the scaffold consumes `@codexnext/relay-client` instead of duplicating relay URL, auth, replay, or approval-decision rules

Still deferred:

- placeholder `apps/mobile` without a React Native/Expo versus mobile-Web-shell decision
- OAuth/passkeys
- multi-user SaaS authorization

## Phase 5: Multi-Device Reliability

Status: modeled for first implementation slices.

Phase 3C moves core runtime reliability earlier so mobile does not inherit an unstable relay. Phase 5 can build on that baseline with:

- durable multi-device session views
- longer retention and persistence choices
- richer reconnect UX
- local daemon/service polish
- conflict handling across simultaneous user clients

First executable subphases:

- define the device/machine/session/thread/workspace/client hierarchy
- make replay and presence behavior deterministic across multiple browser/mobile clients
- serialize or explicitly reject conflicting user operations per device/session
- extend service polish beyond Linux systemd and macOS launchd agent helpers, with Windows tracked as a gap
