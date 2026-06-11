# CodexNext Test Coverage Gaps

Updated during Cycle 04 after Cycles 01-03 closed the original bootstrap gaps.

## Current Coverage By Package

- `packages/protocol`
  - Covered: local session input schemas; relay session, pairing, device event, device presence, machine hello/heartbeat/ack, relay RPC, relay device list, local health, session list/create, message, interrupt, replay, sidebar prefs, Codex history response schemas, lower-level Codex app-server thread response schemas, method-specific approval request/response schemas, outbound app-server request parameter schemas used by `CodexAppServerClient`, goal/turn-start response schemas, and common app-server notification envelope/known-method params schemas.
  - Remaining gap: uncommon Codex app-server notification payload fields are still intentionally passthrough until their shapes stabilize.

- `packages/codex-client`
  - Covered: request id ordering, out-of-order responses, server error responses, notifications, timeouts, server-initiated request success, unknown server-initiated request handling, handler failure responses, transport close/error rejection, default approval decline behavior, method-specific approval request param validation, method-specific approval callback fail-closed handling, outbound app-server request parameter validation before send, app-server thread/goal/turn-start response validation, parsed known app-server notification delivery, malformed known notification skip behavior, unknown notification passthrough, and stdio transport stdout/stderr/invalid JSON/close lifecycle fixtures.
  - Remaining gap: uncommon app-server notification payload validation should stay conservative until Codex payload shapes are stable enough to avoid over-constraining passthrough fields.

- `packages/relay-client`
  - Covered: relay URL normalization, bearer header construction, user Socket.IO auth payloads, URL builders for device list/sidebar prefs/health/sessions/message/interrupt/replay/approval/Codex history routes, replay filtering, live-event acceptance, sequence advancement, and core plus Codex history response parsers with malformed fixture tests.
  - Remaining gap: shared Web/mobile adapter tests should reuse the same fixtures once a mobile framework is selected.

- `apps/agent`
  - Covered: local-server behavior, direct-mode security guard, restrictive device identity permissions, approval first-decision-wins behavior, doctor internals/output coverage, pair command create/poll HTTP failures, malformed pairing response validation, rejected/expired pairing statuses, approved pairing delegation into connect with normalized relay/device options, connect helper URL/error formatting, connect setup dependency injection, machine hello/heartbeat behavior, rejected-hello reconnect flow, event forwarding, RPC success/error acks, and close-handle cleanup.
  - Remaining gap: true live Socket.IO integration with a real relay, including transport-level reconnect timing and server compatibility, remains integration-only.

- `apps/control`
  - Covered: auth/session, pairing, revoke, CORS, full-access policy, health/audit redaction, event replay, stale presence, RPC timeout/cache paths, extracted relay RPC helper classification/timeout/result-validation coverage, relay RPC error classification re-export compatibility, extracted pairing helper code normalization/status/view/fingerprint/digit coverage, extracted browser-session helper hashing/issue/access/revoke/prune coverage, extracted control policy helper rate-limit/origin/full-access coverage, extracted auth route registration with session mint/logout/rate-limit coverage, extracted device route registration with list/revoke/sidebar prefs coverage, extracted pairing route registration with create/poll/lookup/approve/reject/invalid-payload coverage, extracted relay route registration with event replay/core RPC/Codex history route coverage, resume-cache regression coverage, connected user disconnects on logout/revoke/prune expiry, two-client replay/presence/revoke convergence, route-level stale approval decisions, pairing lookup/decision limits, malformed core machine RPC result rejection, and malformed Codex history RPC result rejection before cache mutation.
  - Remaining gap: the server still owns socket lifecycle, pruning, device state, and recent-history cache storage; future work should focus on small state/lifecycle helpers rather than route registration.

- `apps/web`
  - Covered: relay API URL mapping, parser use for core relay and Codex history responses, relay session bootstrap redaction, saved device sanitization, session title grouping, approval summaries, chat-state ingestion/dedupe, managed event-stream replay/live sequencing, reconnect auth update, presence merge helpers, permission filtering, controller-used relay session expiry formatting, rendered full-access option filtering for setup/live composer menus, and localStorage allowlisted wrappers.
  - Remaining gap: full hook-level tests for end-to-end session-expiry recovery across relay bootstrap, Socket.IO reconnect, and visible UI state are still missing.

## Cross-Phase Risks To Carry Forward

- Mobile scaffold should not proceed by copying Web controller state wholesale; it should consume `@codexnext/relay-client` URL/auth/replay/parser helpers and small typed adapters.
- Mobile history screens can consume shared Codex history URL/parser helpers, but still need adapter-level fixture reuse once the mobile framework is chosen.
- `apps/control/src/server.ts` and `apps/web/src/features/console/use-web-console-controller.ts` remain large; future extraction should be coverage-preserving and incremental. Control auth, device, pairing, relay route registration, relay RPC helpers, browser-session helpers, and policy helpers are now split out; remaining control-server risk is concentrated in socket lifecycle and state/cache ownership.
