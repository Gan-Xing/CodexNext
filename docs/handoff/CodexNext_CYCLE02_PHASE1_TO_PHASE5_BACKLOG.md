# CodexNext Cycle 02 Phase 1-5 Backlog

## 0. Count Semantics

This is the active Cycle 02 backlog. The cycle count must not increment until every checkbox in this file is complete, final verification passes, reverse audit finds no must-fix issue, and:

```bash
node scripts/codexnext-backlog-cycle-guard.mjs complete-cycle
```

succeeds.

Current count at backlog generation: 1/20.
Deadline: 2026-06-11 05:30 Europe/London.

## 1. Current State Judgment

Cycle 01 completed successfully. Evidence:

- `completedCycles` is now 1.
- Cycle 01 final verification passed: `pnpm install`, `pnpm typecheck`, `pnpm test` with 16 files / 125 tests, and `pnpm --filter @codexnext/agent dev -- doctor`.
- Cycle 01 added `packages/relay-client`, Web event stream tests, JSON-RPC server-request error tests, a revoke-with-in-flight-RPC control test, Phase 1/4/5 docs, and audit notes.

Fresh Cycle 02 audit findings:

- `apps/control/src/server.ts` still treats Socket.IO user authorization as connect-time only. Revoking a browser relay session through logout blocks future HTTP/user connections, but existing user sockets are not explicitly disconnected. This is a real relay security gap for browser/mobile clients.
- `packages/protocol` has many public Zod schemas and relay payload interfaces but only conversation-title tests. Schema compatibility for relay sessions, pairing, device events, and approval decisions is under-tested.
- `CodexAppServerClient` default approval decline behavior is documented but not directly tested.
- `JsonRpcClient` still lacks tests for transport error/close rejecting pending requests.
- `codexnext doctor` redaction helpers are embedded in the command module and not unit-tested.
- Web now has a tested replay helper boundary, but permission option filtering and session-expired UX are still embedded in the large controller/component path.
- Phase 4 has a relay-client package, but no mobile-facing bootstrap/API adapter or scaffold acceptance test.
- Phase 5 has a model, but multi-user-client convergence is not yet tested at the control layer.
- The cycle guard script is central to this workflow but has no tests. Its deadline handling should be checked against the fixed prompt semantics.

## 2. Cycle 02 Goal

Cycle 02 must deepen the reliability and security baseline rather than add broad product UI:

1. Close the connect-time-only Socket.IO user session gap.
2. Add protocol/schema fixtures and client error/default-approval tests.
3. Make doctor redaction testable.
4. Extract one or two Web controller decisions into pure, tested helpers.
5. Extend `packages/relay-client` toward a Web/mobile shared API boundary.
6. Add first multi-user-client convergence tests for replay/presence/approval conflict behavior.
7. Harden the backlog guard with tests or a documented verified invariant.

## 3. Non-Goals

- No OAuth/passkeys.
- No multi-user SaaS authorization.
- No E2E relay payload encryption.
- No database migration for sessions, pairing, event stores, or audit logs.
- No full React Native/Expo product build unless the minimal scaffold remains small and testable.
- No large rewrite of `apps/control/src/server.ts` or `use-web-console-controller.ts`.
- No direct mode revival in product paths.

## 4. Required Reading

Before checking items in this backlog, read the relevant current files:

```txt
README.md
docs/ROADMAP.md
docs/ARCHITECTURE.md
docs/SECURITY.md
docs/RELAY_DEPLOYMENT.md
docs/PHASE1_FOUNDATION_CONTRACT.md
docs/PHASE4_MOBILE_CLIENT_BASELINE.md
docs/PHASE5_MULTI_DEVICE_RELIABILITY.md
docs/handoff/CodexNext_CYCLE01_PHASE1_TO_PHASE5_BACKLOG.md
docs/handoff/CodexNext_CYCLE01_AUDIT_NOTES.md
docs/handoff/CodexNext_TEST_COVERAGE_GAPS.md
docs/handoff/CodexNext_Phase3C_RELAY_RUNTIME_HARDENING_HANDOFF.md

packages/protocol/src/index.ts
packages/protocol/test/conversation-titles.test.ts
packages/codex-client/src/json-rpc.ts
packages/codex-client/src/codex-app-server-client.ts
packages/codex-client/test/json-rpc-client.test.ts
packages/relay-client/src/index.ts
packages/relay-client/test/relay-client.test.ts

apps/agent/src/commands/doctor.ts
apps/agent/test/local-server.test.ts
apps/agent/test/security.test.ts

apps/control/src/server.ts
apps/control/src/device-registry.ts
apps/control/src/device-event-store.ts
apps/control/test/control-server.test.ts

apps/web/src/lib/event-stream.ts
apps/web/src/features/console/use-web-console-controller.ts
apps/web/src/features/devices/device-utils.ts
apps/web/src/features/sessions/session-utils.ts
apps/web/src/features/chat/chat-state.ts
apps/web/src/features/events/approval-utils.ts
apps/web/src/components/sheets/DeviceSheet.tsx
apps/web/src/components/sheets/ApprovalModal.tsx
```

## 5. Backlog

### A. Phase 1 - Protocol, Client, And Diagnostics Deep Contracts

- [x] A1. Add protocol fixture tests for relay session, pairing create/poll/approve, device event payload, local start/resume/send-message schemas, and approval decision schema.
  - Reason: public protocol compatibility currently relies mostly on TypeScript types and runtime usage, not explicit fixtures.
  - Modules: `packages/protocol/src/index.ts`, new or existing protocol tests.
  - Steps: create representative valid/invalid fixtures; assert schema parse behavior and stable literal method/event names.
  - Verification: `pnpm --filter @codexnext/protocol typecheck`; targeted Vitest protocol tests.
  - Done when schema fixture tests fail on payload drift.
- [x] A2. Add CodexAppServerClient default approval behavior tests.
  - Reason: default decline/denied behavior is security-relevant and currently only inferred.
  - Modules: `packages/codex-client/src/codex-app-server-client.ts`, codex-client tests.
  - Steps: use a fake `JsonRpcTransport`; emit command/file/legacy server-initiated approval requests; assert default decline/denied and callback override.
  - Verification: codex-client typecheck and tests.
  - Done when default approval behavior has direct regression coverage.
- [x] A3. Add JsonRpcClient transport close/error pending rejection tests.
  - Reason: mobile/relay reliability depends on bounded failure when Codex app-server or stdio closes.
  - Modules: `packages/codex-client/src/json-rpc.ts`, `packages/codex-client/test/json-rpc-client.test.ts`.
  - Steps: start pending requests; emit fake transport `error` and `close`; assert `JsonRpcTransportClosedError` and no pending request leaks.
  - Verification: codex-client tests.
  - Done when transport failure paths are explicitly covered.
- [x] A4. Make doctor redaction helpers testable and add tests.
  - Reason: `doctor --relay` is an operator-facing security diagnostic; URL and health payload redaction should not be untested.
  - Modules: `apps/agent/src/commands/doctor.ts`, agent tests.
  - Steps: export narrowly named test helpers or move pure helpers to a small module; test URL credential/query stripping, unsafe health payload rejection, and no raw token values in formatted labels.
  - Verification: agent typecheck and targeted tests.
  - Done when doctor redaction can be changed only with tests failing.
- [x] A5. Update Phase 1 contract docs if the tests expose a behavior that differs from `docs/PHASE1_FOUNDATION_CONTRACT.md`.
  - Reason: Cycle 01 docs must not become stale immediately.
  - Modules: `docs/PHASE1_FOUNDATION_CONTRACT.md`.
  - Verification: doc review plus relevant tests.

### B. Phase 2 - Web Console State Boundaries And UX Regression

- [x] B1. Extract and test the relay permission option filtering decision.
  - Reason: full-access visibility is security-sensitive and currently embedded in `useWebConsoleController`.
  - Modules: `apps/web/src/features/console/use-web-console-controller.ts` or a new helper module.
  - Steps: create a pure helper for available permission options based on relay-enabled and relay-full-access-disabled inputs; update controller to use it; add tests.
  - Verification: web typecheck and targeted helper tests.
  - Done when full-access filtering is tested without rendering the whole console.
- [x] B2. Add session-expired UX classification tests for relay HTTP/Socket errors.
  - Reason: mobile and browser users need clear expired-session recovery instead of generic failure strings.
  - Modules: `apps/web/src/lib/format/text.ts`, `DeviceSheet`, controller error handling, or a new helper.
  - Steps: identify current expired/error strings; extract classification if needed; test 401/410/session expired/unauthorized cases.
  - Verification: web tests.
  - Done when expired sessions have deterministic user-facing classification.
- [x] B3. Add a Web controller-adjacent test for localStorage preference writes that proves only allowlisted keys are written.
  - Reason: Cycle 01 audited token storage, but future controller work can reintroduce broad localStorage writes.
  - Modules: devices/session utils, controller helpers if extracted.
  - Steps: test saved devices, sidebar prefs, width, and migration notice write paths with token-like input.
  - Verification: web tests.
  - Done when owner/session/device/direct token strings cannot be persisted through tested helpers.
- [x] B4. Extend Web event-stream tests for close/reconnect behavior across selected device changes.
  - Reason: mobile/multi-device flows will switch devices and must not leave stale sockets receiving events.
  - Modules: `apps/web/src/lib/event-stream.ts`, controller stream lifecycle.
  - Steps: test `close()` marks closed, ignores later connect_error status, and refreshes auth only from current sequence.
  - Verification: web tests.
- [x] B5. Document the remaining Web controller extraction plan after the helper/test changes.
  - Reason: the controller is still large; the next extraction should be guided by evidence.
  - Modules: `docs/handoff/CodexNext_CYCLE02_WEB_STATE_AUDIT.md` or Cycle 02 progress log.
  - Done when no ambiguous "big file risk" remains untracked.

### C. Phase 3 - Relay Runtime Security And Multi-Client Hardening

- [x] C1. Fix existing user Socket.IO connections after browser session logout/revoke.
  - Reason: user namespace auth is connect-time only; logout revokes future access but does not explicitly disconnect already-connected sockets.
  - Modules: `apps/control/src/server.ts`, `apps/control/test/control-server.test.ts`.
  - Steps: associate user sockets with hashed browser session records or a session id; on `/api/auth/logout`, disconnect sockets for that session; ensure session expiry/prune also prevents continued event delivery where feasible.
  - Verification: add an integration test where a user socket connects, logout is called, machine emits an event, and the logged-out socket is disconnected or receives no event.
  - Done when existing sockets cannot continue after logout.
- [x] C2. Add two-user-client replay convergence test.
  - Reason: Phase 5 needs multiple browsers/mobile clients to converge on the same ordered event state.
  - Modules: control tests, possibly relay-client fixtures.
  - Steps: connect two user sockets with different `lastSeqByDevice`; emit stored and live events; assert each receives exactly the missing replay and same live event once.
  - Verification: control tests.
- [x] C3. Add approval conflict behavior test for two user clients.
  - Reason: simultaneous approval decisions are a Phase 5 conflict path.
  - Modules: control tests, local agent approval bridge tests if needed.
  - Steps: simulate two HTTP approval decisions or two clients against one pending approval; assert first result wins and second receives deterministic not-found/already-resolved behavior without duplicate pending approval state.
  - Verification: control/agent tests.
- [x] C4. Extract or unit-test relay RPC error classification.
  - Reason: `handleRpcRequest` and `replyWithRpcError` duplicate status mapping logic.
  - Modules: `apps/control/src/server.ts` or a new pure helper.
  - Steps: extract `relayRpcStatusForMessage`/classification helper; update both call sites; add unit tests for timeout/offline/not-found/generic cases.
  - Verification: control typecheck and tests.
- [x] C5. Review pairing/rate-limit abuse paths after C1-C4 and add any newly found must-fix item to this backlog before final verification.
  - Reason: auth/session changes can alter pairing/revoke semantics.
  - Modules: control tests and docs.
  - Verification: audit note in Progress Log.

### D. Phase 4 - Mobile Shared Client Boundary

- [x] D1. Extend `packages/relay-client` with a small HTTP API adapter or contract helpers for device list, device event replay URL, and approval decision URL construction.
  - Reason: mobile should not duplicate Web URL mapping and token header rules.
  - Modules: `packages/relay-client`, `apps/web/src/lib/api.ts` if reused.
  - Steps: decide whether helpers return `Request`/URL/header tuples or fetch wrappers; keep it platform-neutral; update Web to consume safe helpers if low-risk.
  - Verification: relay-client and web tests.
- [x] D2. Add mobile bootstrap acceptance fixtures.
  - Reason: Phase 4 still lacks a concrete scaffold gate.
  - Modules: `docs/PHASE4_MOBILE_CLIENT_BASELINE.md`, relay-client tests.
  - Steps: encode login/session bootstrap, device list, replay, live event, steer, interrupt, approval as fixtures or acceptance test plan with exact payloads.
  - Verification: docs plus tests where possible.
- [x] D3. Decide whether Cycle 02 should add `apps/mobile` or defer to Cycle 03 with a concrete dependency list.
  - Reason: adding a fake app would be worse than a tested shared client; but indefinite deferral would keep Phase 4 abstract.
  - Modules: Roadmap and Phase 4 doc.
  - Done when the decision has explicit acceptance criteria and next implementation commands.
- [x] D4. Update Roadmap Phase 4 status after D1-D3.
  - Reason: Roadmap must reflect whether scaffold is still pending, started, or blocked by framework choice.

### E. Phase 5 - Multi-Device Reliability First Implementation Slice

- [x] E1. Add a multi-client session view contract doc with concrete JSON examples.
  - Reason: Cycle 01 described the model, but implementation needs payload examples.
  - Modules: `docs/PHASE5_MULTI_DEVICE_RELIABILITY.md` or new doc.
  - Include: two browsers on one device, one browser plus mobile, two agents, offline/reconnect, approval conflict.
- [x] E2. Add a test or contract fixture for two clients receiving the same presence state.
  - Reason: presence is the smallest multi-device convergence signal.
  - Modules: control tests or relay-client tests.
  - Verification: test proves both clients converge on online/offline and activeSessions.
- [x] E3. Add a first conflict policy implementation or explicit rejection for stale approval/turn operations.
  - Reason: Phase 5 conflict handling should begin with one enforced behavior, not only documentation.
  - Modules: local approval bridge, control route behavior, Web helper.
  - Verification: test around already-resolved approval or stale turn id.
- [x] E4. Update daemon/service gap tracking with one concrete Windows/process-manager path.
  - Reason: Phase 5 service polish currently only names the gap.
  - Modules: `docs/RELAY_DEPLOYMENT.md`, Phase 5 doc.

### F. Cross-Phase Guard, Docs, And Final Gate

- [x] F1. Add tests or a deterministic verification script for `scripts/codexnext-backlog-cycle-guard.mjs`.
  - Reason: the backlog loop relies on this script, but it is currently untested.
  - Modules: script tests or a documented smoke command.
  - Cover: status with no state, init no-overwrite, complete-cycle blocks pending checkbox, completedCycles max fixed at 20, deadline semantics.
- [x] F2. Re-run marker and docs drift audits after all code changes.
  - Reason: Cycle 02 will touch security-sensitive auth/session code.
  - Commands: `rg` for TODO/FIXME/HACK/temporary/dev-only/direct mode/token markers; docs review.
- [x] F3. Update Cycle 02 Progress Log after each related task group.
  - Reason: guard count is per full backlog, not per task.
- [x] F4. Run final verification: `pnpm install`, `pnpm typecheck`, `pnpm test`, `pnpm --filter @codexnext/agent dev -- doctor`.
- [x] F5. Run adversarial reverse audit after all checkboxes appear complete.
  - Reason: assume the fixes are too local; inspect security, tests, docs, mobile, and multi-device effects.
- [x] F6. Confirm this backlog has zero pending checkbox items and then run `node scripts/codexnext-backlog-cycle-guard.mjs complete-cycle`.

## 6. Progress Log

- 2026-06-10T23:23Z
  - Completed: generated Cycle 02 backlog from current repo state after Cycle 01 completion.
  - Evidence read: current README/ROADMAP/ARCHITECTURE/SECURITY/RELAY_DEPLOYMENT, Cycle 01 backlog/progress/audit/test gaps, Phase 3C handoff headings/progress, git status/log, final verification report, current test inventory, protocol/client/control/web/agent target files.
  - Current status: active backlog path is `docs/handoff/CodexNext_CYCLE02_PHASE1_TO_PHASE5_BACKLOG.md`; completedCycles 1/20; canContinue true.
  - Tests referenced: Cycle 01 final `pnpm typecheck`, `pnpm test` 16 files / 125 tests, and doctor exit 0.
  - New issues entered in this backlog: user Socket.IO logout/revoke disconnect gap; protocol schema fixture gaps; doctor redaction test gap; Web permission/session-expired helper gap; multi-client replay/presence/approval conflict gaps; guard script test gap.
- 2026-06-10T23:31Z
  - Completed: A1-A5 and C1.
  - Changes: added protocol relay/pairing/device/local fixture schemas and tests; made token-bearing relay response schemas strict; added `CodexAppServerClient` default approval tests; added JSON-RPC transport error/close pending rejection tests; exported doctor redaction test internals and added helper tests; documented token-bearing relay response strictness; disconnected existing user Socket.IO sessions on browser session logout/revoke/prune.
  - Verification: `pnpm --filter @codexnext/protocol typecheck`; `pnpm --filter @codexnext/codex-client typecheck`; `pnpm --filter @codexnext/agent typecheck`; `pnpm exec vitest run packages/protocol/test/relay-schemas.test.ts packages/codex-client/test/json-rpc-client.test.ts packages/codex-client/test/codex-app-server-client.test.ts apps/agent/test/doctor.test.ts` (4 files / 20 tests); `pnpm exec vitest run apps/control/test/control-server.test.ts --testNamePattern "revokes browser sessions on logout|rejects Socket.IO user connections after relay session expiry|stores machine events and replays"` (3 passed / 42 skipped).
- 2026-06-10T23:42Z
  - Completed: B1-B5 and D1-D4.
  - Changes: extracted Web permission filtering/session-expiry helpers; added console localStorage write wrappers and tests; guarded closed event streams from stale replay/live/socket activity; extended `@codexnext/relay-client` with bearer header and device-list/replay/approval URL helpers; updated Web API URL construction to use the shared boundary; documented mobile bootstrap fixtures and the Cycle 02 decision to defer `apps/mobile` until the framework choice is explicit; added `docs/handoff/CodexNext_CYCLE02_WEB_STATE_AUDIT.md`.
  - Verification: `pnpm --filter @codexnext/web typecheck`; `pnpm --filter @codexnext/relay-client typecheck`; `pnpm exec vitest run apps/web/src/features/console/console-utils.test.ts apps/web/src/features/console/console-storage.test.ts apps/web/src/features/devices/device-utils.test.ts apps/web/src/lib/event-stream.test.ts apps/web/src/lib/api.test.ts packages/relay-client/test/relay-client.test.ts` (6 files / 20 tests).
- 2026-06-10T23:48Z
  - Completed: C2-C5 and E1-E4.
  - Changes: added two-user replay/live convergence and two-client presence convergence tests; extracted `classifyRelayRpcError` and covered timeout/offline/not-found/generic mappings; added ApprovalBridge first-decision-wins stale duplicate test; documented concrete Phase 5 multi-client JSON examples; updated Windows service/process-manager path to prefer WinSW templates with Scheduled Tasks as agent fallback.
  - Pairing/rate-limit audit: reviewed pairing create/poll/lookup/approve/reject rate limits and browser session revoke/prune paths after C1-C4; no new must-fix item found for this cycle.
  - Verification: `pnpm --filter @codexnext/control typecheck`; `pnpm --filter @codexnext/agent typecheck`; `pnpm exec vitest run apps/control/test/control-server.test.ts apps/control/test/relay-rpc-error.test.ts --testNamePattern "converges replay|broadcasts the same presence|classifyRelayRpcError|revokes browser sessions on logout"` (2 files / 4 tests); `pnpm exec vitest run apps/agent/test/local-server.test.ts --testNamePattern "lets the first approval decision win|maps legacy cancel"` (1 file / 2 tests).
- 2026-06-10T23:51Z
  - Completed: F1-F3.
  - Changes: added `scripts/test-codexnext-backlog-cycle-guard.mjs`, a deterministic isolated CLI smoke test covering status with no state, init no-overwrite, complete-cycle pending-checkbox blocking, successful no-verify completion, fixed maxCycles 20 normalization, and deadline stop semantics.
  - Verification: `node scripts/test-codexnext-backlog-cycle-guard.mjs` passed.
  - Marker/docs audit: `rg` for TODO/FIXME/HACK found no active code/doc markers in current source docs; dev-only/direct-mode matches are expected boundary references; token-marker scan is expected in types/tests/security docs; focused Web storage scan found only sanitized device migration storage and tests, with no raw token localStorage write path introduced. Guard status: completedCycles 1/20, active Cycle 02 backlog, canContinue true.
- 2026-06-10T23:52Z
  - Completed: F4.
  - Final verification: `pnpm install` passed; `pnpm typecheck` passed across all workspace packages; `pnpm test` passed (22 files / 151 tests); `pnpm --filter @codexnext/agent dev -- doctor` exited 0 with expected relay-health warning because no relay URL was supplied.
- 2026-06-10T23:53Z
  - Completed: F5.
  - Reverse audit: `git diff --check` passed; guard status still canContinue true; spot-read control socket tracking/RPC classification, Web console storage/session helpers, relay-client URL/header builders, and guard smoke test. No must-fix issue found.
- 2026-06-10T23:53Z
  - Completed: F6 checkbox before invoking guard, so the active backlog can reach zero pending items for `complete-cycle` validation.

## 7. Final Verification Commands

Run before `complete-cycle`:

```bash
node scripts/codexnext-backlog-cycle-guard.mjs status
pnpm install
pnpm typecheck
pnpm test
pnpm --filter @codexnext/agent dev -- doctor
node scripts/codexnext-backlog-cycle-guard.mjs complete-cycle
```
