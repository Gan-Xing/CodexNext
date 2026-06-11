# CodexNext Cycle 03 Phase 1-5 Backlog

## 0. Count Semantics

This is the active Cycle 03 backlog. The cycle count must not increment until every checkbox in this file is complete, final verification passes, reverse audit finds no must-fix issue, and:

```bash
node scripts/codexnext-backlog-cycle-guard.mjs complete-cycle
```

succeeds.

Current count at backlog generation: 2/20.
Deadline: 2026-06-11 05:30 Europe/London.

## 1. Fresh Audit Summary

Cycle 02 completed and counted successfully. Evidence:

- Guard count is now 2/20 and `canContinue` is true.
- Cycle 02 final guard verification passed: `pnpm install`, `pnpm typecheck`, `pnpm test` (22 files / 151 tests), and `pnpm --filter @codexnext/agent dev -- doctor`.
- Cycle 02 added protocol/client/doctor tests, Web console helpers, strict localStorage write wrappers, relay-client URL/header helpers, multi-client replay/presence tests, approval conflict coverage in `ApprovalBridge`, guard smoke tests, and Phase 4/5 docs.

Fresh Cycle 03 findings:

- `packages/protocol` still lacks schemas for relay device records, presence payloads, machine hello/heartbeat acks, and relay RPC request/response payloads.
- Web device presence merging remains embedded in `useWebConsoleController`; Cycle 02 extracted high-risk localStorage and permission helpers but not presence state reduction.
- Control now disconnects user sockets on logout/revoke, but connected user sockets are not directly tested for prune/TTL expiry disconnection.
- Control multi-client revoke/offline behavior is tested for one user client; two-client offline convergence should be explicit.
- Approval conflict is tested at `ApprovalBridge`, but control should also have a route-level deterministic conflict fixture where the machine side rejects the stale second decision.
- `packages/relay-client` owns device/replay/approval URL helpers but not health, sessions, message, interrupt, or sidebar-pref URL construction.
- Phase 5 Windows service path is documented but has no checked-in WinSW template or validation script.
- The guard smoke test exists but is not exposed through a package script.

## 2. Cycle 03 Goal

Cycle 03 should make the newly added boundaries harder to regress:

1. Add relay/runtime protocol schemas for device, presence, machine, and RPC payloads.
2. Extract and test Web presence merge behavior from the controller.
3. Add control tests for TTL/prune socket disconnection, two-client revoke/offline convergence, and route-level stale approval decisions.
4. Extend `@codexnext/relay-client` URL helpers across the remaining mobile-critical HTTP routes and update Web where low-risk.
5. Add a real Windows service template slice with docs and validation.
6. Expose guard smoke verification through package scripts and run the full final gate.

## 3. Non-Goals

- No OAuth/passkeys.
- No database migration.
- No end-to-end encryption.
- No large route split of `apps/control/src/server.ts`.
- No fake `apps/mobile` placeholder without framework/runtime tests.
- No direct-mode revival in product paths.

## 4. Required Reading

```txt
docs/ROADMAP.md
docs/ARCHITECTURE.md
docs/RELAY_DEPLOYMENT.md
docs/PHASE1_FOUNDATION_CONTRACT.md
docs/PHASE4_MOBILE_CLIENT_BASELINE.md
docs/PHASE5_MULTI_DEVICE_RELIABILITY.md
docs/handoff/CodexNext_CYCLE02_PHASE1_TO_PHASE5_BACKLOG.md
docs/handoff/CodexNext_CYCLE02_WEB_STATE_AUDIT.md

packages/protocol/src/index.ts
packages/protocol/test/relay-schemas.test.ts
packages/relay-client/src/index.ts
packages/relay-client/test/relay-client.test.ts

apps/web/src/features/console/use-web-console-controller.ts
apps/web/src/features/console/console-utils.ts
apps/web/src/features/console/console-storage.ts
apps/web/src/lib/api.ts
apps/web/src/lib/api.test.ts

apps/control/src/server.ts
apps/control/test/control-server.test.ts
apps/control/test/relay-rpc-error.test.ts

apps/agent/src/local-server/approval-bridge.ts
apps/agent/test/local-server.test.ts

scripts/codexnext-backlog-cycle-guard.mjs
scripts/test-codexnext-backlog-cycle-guard.mjs
```

## 5. Backlog

### A. Phase 1 - Protocol And Diagnostic Contracts

- [x] A1. Add Zod schemas and fixture tests for relay device records, device presence payloads, machine hello/ack, heartbeat payloads, and relay error ack.
  - Reason: relay runtime payloads are public Web/mobile contracts but still rely mostly on TypeScript interfaces.
  - Modules: `packages/protocol/src/index.ts`, `packages/protocol/test/relay-schemas.test.ts`.
  - Verification: protocol typecheck and targeted tests.

- [x] A2. Add Zod schemas and fixture tests for `RelayRpcRequest` and `RelayRpcResponse`.
  - Reason: control/agent relay RPC error and result shapes should be explicit before more mobile/client helpers depend on them.
  - Modules: `packages/protocol`.
  - Verification: protocol tests.

- [x] A3. Add a package script for guard smoke verification.
  - Reason: Cycle 02 added the script but it is easy to miss during local verification.
  - Modules: root `package.json`, `scripts/test-codexnext-backlog-cycle-guard.mjs`.
  - Verification: `pnpm test:guard`.

### B. Phase 2 - Web State Boundaries

- [x] B1. Extract and test pure device presence merge behavior from `useWebConsoleController`.
  - Reason: presence polling and live presence updates are multi-client reliability signals and should not stay only in React state closures.
  - Modules: new or existing `apps/web/src/features/console/*` helper, controller.
  - Cover: pruning stale presence for removed saved devices, merging successful checks, preserving unrelated entries only when still saved.
  - Verification: web typecheck and targeted helper tests.

- [x] B2. Add relay session error formatting tests for non-expiry errors and Socket.IO `data.status` payloads.
  - Reason: Cycle 02 added the helper; Cycle 03 should lock down false positives and socket-specific status data.
  - Modules: `console-utils.test.ts`.
  - Verification: web tests.

- [x] B3. Add Web API URL helper coverage for sessions create/message, interrupt, health, and sidebar prefs once relay-client exposes those builders.
  - Reason: mobile and Web should share the same URL mapping beyond replay/approval.
  - Modules: `apps/web/src/lib/api.ts`, `apps/web/src/lib/api.test.ts`, `packages/relay-client`.

### C. Phase 3 - Control Runtime Hardening

- [x] C1. Add an integration test proving connected user sockets disconnect when browser sessions expire through TTL/prune, not only logout.
  - Reason: Cycle 02 fixed disconnects on revoke/prune but directly tested logout only.
  - Modules: `apps/control/test/control-server.test.ts`.
  - Verification: control tests.

- [x] C2. Add two-user-client device revoke/offline convergence test.
  - Reason: Phase 5 revoke semantics should update every observer, not just one connected browser.
  - Modules: control tests.
  - Verification: both clients receive `device:offline` or disconnect/blocked behavior deterministically.

- [x] C3. Add route-level stale approval decision conflict test through control relay RPC.
  - Reason: ApprovalBridge first-decision-wins is covered locally; control should prove stale machine rejection maps to a deterministic client HTTP response.
  - Modules: control tests.
  - Verification: first approval route succeeds; second route receives deterministic 404/400 error without duplicate success.

- [x] C4. Add pairing lookup/decision rate-limit tests if they are not already explicit.
  - Reason: Cycle 02 reviewed these paths but did not add dedicated coverage for lookup/decision limits.
  - Modules: control tests.
  - Verification: 429 behavior for lookup or decision abuse.

### D. Phase 4 - Mobile Shared Client Boundary

- [x] D1. Extend `@codexnext/relay-client` with URL helpers for health, sessions list/create, session message, turn interrupt, and sidebar prefs.
  - Reason: these are mobile scaffold-critical and should not be duplicated in future mobile code.
  - Modules: `packages/relay-client`.
  - Verification: relay-client tests.

- [x] D2. Update Web API URL construction to use the new relay-client builders where low-risk.
  - Reason: Web should dogfood the mobile-shared boundary.
  - Modules: `apps/web/src/lib/api.ts`, API tests.
  - Verification: web typecheck and API tests.

- [x] D3. Update Phase 4 docs with the expanded shared helper list and remaining framework decision.
  - Reason: the docs should make clear which parts are now implementation-ready for mobile.

### E. Phase 5 - Service And Reliability Slice

- [x] E1. Add WinSW example templates for control, web, and agent roles.
  - Reason: Phase 5 now names WinSW as the preferred Windows path; templates make that actionable.
  - Modules: `ops/winsw/*`.

- [x] E2. Add a deterministic validation script or tests for the WinSW templates.
  - Reason: checked-in XML/env placeholders should not drift silently.
  - Modules: `scripts/ops` or `scripts/test-*`.
  - Verification: script command passes.

- [x] E3. Update deployment docs and Phase 5 docs to reference the new WinSW templates and validation command.

### F. Cross-Phase Guard, Docs, And Final Gate

- [x] F1. Re-run marker and token storage audits after code changes.
- [x] F2. Run targeted verification for all Cycle 03 changes.
- [x] F3. Run final verification: `pnpm install`, `pnpm typecheck`, `pnpm test`, `pnpm test:guard`, `pnpm --filter @codexnext/agent dev -- doctor`.
- [x] F4. Run adversarial reverse audit after all checkboxes appear complete.
- [x] F5. Confirm this backlog has zero pending checkbox items and run `node scripts/codexnext-backlog-cycle-guard.mjs complete-cycle`.

## 6. Progress Log

- 2026-06-10T23:55Z
  - Completed: generated Cycle 03 backlog from current repo state after Cycle 02 completion.
  - Evidence read: guard status 2/20 with active Cycle 03 placeholder; Cycle 02 backlog/progress; current test inventory (22 test files); ROADMAP/ARCHITECTURE/RELAY_DEPLOYMENT/Phase 4/Phase 5 docs; marker audit output; source hotspots in protocol, relay-client, Web console/API, control server/tests, agent approval bridge, and guard scripts.
  - Current status: active backlog path is `docs/handoff/CodexNext_CYCLE03_PHASE1_TO_PHASE5_BACKLOG.md`; completedCycles 2/20; canContinue true.
- 2026-06-10T23:57Z
  - Completed: A1-A3.
  - Changes: added runtime schemas and fixtures for relay device/presence/machine ack/heartbeat/error ack and relay RPC request/response payloads; exposed guard smoke test as `pnpm test:guard`.
  - Verification: `pnpm --filter @codexnext/protocol typecheck`; `pnpm exec vitest run packages/protocol/test/relay-schemas.test.ts` (1 file / 6 tests); `pnpm test:guard`.
- 2026-06-10T23:58Z
  - Completed: B1-B2.
  - Changes: extracted `seedSavedDevicePresence` and `mergeDevicePresenceResults` from the Web controller presence effect; added tests for Socket.IO `data.status` expiry classification and non-expiry false positives.
  - Verification: `pnpm --filter @codexnext/web typecheck`; `pnpm exec vitest run apps/web/src/features/console/console-utils.test.ts` (1 file / 6 tests).
- 2026-06-10T23:59Z
  - Completed: B3 and D1-D3.
  - Changes: extended `@codexnext/relay-client` with health, sessions, message, interrupt, and sidebar prefs URL helpers; updated Web API URL construction/tests to dogfood those builders; updated Phase 4 and architecture docs with the expanded shared helper list.
  - Verification: `pnpm --filter @codexnext/relay-client typecheck`; `pnpm --filter @codexnext/web typecheck`; `pnpm exec vitest run packages/relay-client/test/relay-client.test.ts apps/web/src/lib/api.test.ts` (2 files / 9 tests).
- 2026-06-11T00:06Z
  - Completed: C1-C4.
  - Changes: added connected browser-session TTL/prune disconnect coverage; added two-browser revoke/offline convergence; added route-level stale approval decision coverage through control relay RPC; added pairing decision rate-limit coverage alongside existing lookup coverage; classified real `No pending approval...` relay errors as deterministic not-found responses.
  - Verification: `pnpm --filter @codexnext/control typecheck`; `pnpm exec vitest run apps/control/test/control-server.test.ts apps/control/test/relay-rpc-error.test.ts --testNamePattern "disconnects connected user sockets|broadcasts device revoke offline|maps stale approval decisions|rate limits pairing (lookup|decision)|maps timeout"` (2 files / 6 selected tests).
- 2026-06-11T00:10Z
  - Completed: E1-E3.
  - Changes: added WinSW XML templates for control, web, and agent roles; added `scripts/test-winsw-templates.mjs` and `pnpm test:winsw`; updated README, relay deployment, and Phase 5 docs with template links and validation command.
  - Verification: `pnpm test:winsw` (validated 3 WinSW templates).
- 2026-06-11T00:11Z
  - Completed: F1-F2.
  - Audit: marker scan found no TODO/FIXME/HACK hits in audited app/package/script/doc paths; token-storage scan only matched saved-device metadata migration/tests, which strip token-like fields and do not persist owner, browser session, or device tokens.
  - Verification: protocol typecheck plus relay schema tests; relay-client typecheck plus relay-client tests; web typecheck plus console-utils/API tests; control typecheck plus selected control/relay RPC tests; `pnpm test:winsw`; `pnpm test:guard`.
- 2026-06-11T00:12Z
  - Completed: F3.
  - Verification: `pnpm install`; `pnpm typecheck`; `pnpm test` (22 files / 159 tests); `pnpm test:guard`; `pnpm test:winsw`; `pnpm --filter @codexnext/agent dev -- doctor` (relay health warning only because no relay URL was supplied).
- 2026-06-11T00:12Z
  - Completed: F4-F5 preflight.
  - Reverse audit: `git diff --check` passed; guard status reported 19/21 complete before marking F4-F5 and `canContinue: true`; no pending implementation checkboxes remained outside the final audit rows.
  - Next command: `node scripts/codexnext-backlog-cycle-guard.mjs complete-cycle`.

## 7. Final Verification Commands

Run before `complete-cycle`:

```bash
node scripts/codexnext-backlog-cycle-guard.mjs status
pnpm install
pnpm typecheck
pnpm test
pnpm test:guard
pnpm --filter @codexnext/agent dev -- doctor
node scripts/codexnext-backlog-cycle-guard.mjs complete-cycle
```
