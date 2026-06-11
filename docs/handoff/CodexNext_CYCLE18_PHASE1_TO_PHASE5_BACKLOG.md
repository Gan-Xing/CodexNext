# CodexNext Cycle 18 Phase 1-5 Backlog

## 0. Count Semantics

This is the active Cycle 18 backlog. The cycle count must not increment until every checkbox in this file is complete, final verification passes, reverse audit finds no must-fix issue, and:

```bash
node scripts/codexnext-backlog-cycle-guard.mjs complete-cycle
```

succeeds.

Current count at backlog generation: 17/20.
Deadline: 2026-06-11 05:30 Europe/London.

## 1. Fresh Audit Summary

Cycle 17 completed and counted successfully. Evidence:

- Guard count is now 17/20 and `canContinue` is true.
- Cycle 17 final guard verification passed inside `complete-cycle`: `pnpm install`, `pnpm typecheck`, `pnpm test` (29 files / 231 tests), `pnpm test:guard`, `pnpm test:winsw`, and `pnpm --filter @codexnext/agent dev -- doctor`.
- Cycle 17 extracted auth route registration into `apps/control/src/auth-routes.ts` and added `/api/auth/session` rate-limit coverage.

Fresh Cycle 18 findings:

- `docs/handoff/CodexNext_TEST_COVERAGE_GAPS.md` lists pairing and relay device route extraction as remaining control route-group work.
- `apps/control/src/server.ts` still registers `/api/devices`, `/api/devices/:deviceId`, and `/api/devices/:deviceId/sidebar-prefs` inline.
- Existing integration tests cover device listing auth, sidebar prefs read/write/persistence, revoke disconnect/reconnect behavior, two-user revoke broadcast, and in-flight RPC bounding on revoke. A focused not-found sidebar prefs route check is still worth adding before extraction.

## 2. Cycle 18 Goal

Cycle 18 should extract the device route group out of `server.ts`:

1. Create a dedicated control device route registration module for device list, revoke, and sidebar prefs read/write routes.
2. Keep device maps, registry, sidebar prefs store, audit logger, user namespace broadcasts, and user-access guard owned by `createControlServer` and passed into the route module.
3. Add focused integration coverage for sidebar prefs not-found behavior.
4. Refresh coverage docs, run targeted tests, perform security/reverse audits, and pass the full guard gate.

## 3. Non-Goals

- No pairing route extraction.
- No relay RPC route extraction.
- No device registry storage behavior changes.
- No sidebar prefs schema changes.
- No Web UI changes.

## 4. Required Reading

- `docs/handoff/CodexNext_TEST_COVERAGE_GAPS.md`
- `docs/handoff/CodexNext_CYCLE17_PHASE1_TO_PHASE5_BACKLOG.md`
- `apps/control/src/server.ts`
- `apps/control/src/auth-routes.ts`
- `apps/control/test/control-server.test.ts`

## 5. Backlog

### A. Phase 1 / Phase 5 - Device Route Group Extraction

- [x] A1. Create a dedicated control device route registration module.
  - Acceptance: module registers `/api/devices`, `DELETE /api/devices/:deviceId`, and `GET/PUT /api/devices/:deviceId/sidebar-prefs`.

- [x] A2. Update `server.ts` to call the device route registration module and remove inline device route handlers.
  - Acceptance: `server.ts` retains device state and dependency closures, while device route code moves out.

### B. Tests

- [x] B1. Add integration coverage for sidebar prefs not-found behavior on unknown devices.
- [x] B2. Run existing control integration tests that cover device list auth, sidebar prefs persistence, device revoke, two-user revoke broadcast, and in-flight RPC bounding.

### C. Security / Product Boundary Audit

- [x] C1. Confirm device routes still require user access before returning device/sidebar data or mutating revoke/sidebar prefs.
- [x] C2. Confirm revoke audit and offline broadcasts remain route-local behavior after extraction.

### D. Docs, Audit, And Final Gate

- [x] D1. Refresh coverage-gap docs to record device route extraction and leave pairing/relay RPC route extraction as remaining work.
- [x] D2. Run targeted control typecheck/tests.
- [x] D3. Run marker, device-route, and auth-guard scans after code changes.
- [x] D4. Run final verification: `pnpm install`, `pnpm typecheck`, `pnpm test`, `pnpm test:guard`, `pnpm test:winsw`, `pnpm --filter @codexnext/agent dev -- doctor`.
- [x] D5. Run adversarial reverse audit after all checkboxes appear complete.
- [x] D6. Confirm this backlog has zero pending checkbox items and run `node scripts/codexnext-backlog-cycle-guard.mjs complete-cycle`.

## 6. Progress Log

- 2026-06-11T02:35Z
  - Completed: generated Cycle 18 backlog from current repo state after Cycle 17 completion.
  - Evidence read: guard status 17/20 with no active backlog; coverage-gap handoff; Cycle 17 backlog/progress; remaining control route registrations; device/sidebar/revoke integration tests.
  - Current status: active backlog path is `docs/handoff/CodexNext_CYCLE18_PHASE1_TO_PHASE5_BACKLOG.md`; completedCycles 17/20; canContinue true.
- 2026-06-11T02:37Z
  - Completed: A1, A2, B1, B2, C1, C2, D1, D2, and D3.
  - Code: added `apps/control/src/device-routes.ts` for device list, device revoke, and sidebar prefs read/write route registration.
  - Code: `server.ts` now calls `registerDeviceRoutes(...)` and no longer defines inline `/api/devices` route handlers.
  - Tests: added integration coverage for sidebar prefs not-found behavior on unknown devices.
  - Verification: `pnpm --filter @codexnext/control typecheck` and `pnpm exec vitest run apps/control/test/control-server.test.ts` passed (56 control server tests).
  - Security/product audit: marker scan was clean; route scans confirm moved device routes require `requireUserAccess`; revoke still writes `device.revoke` audit records and emits `device:offline`.
  - Docs: updated `docs/handoff/CodexNext_TEST_COVERAGE_GAPS.md` to record extracted device route registration and list/revoke/sidebar prefs coverage.
- 2026-06-11T02:38Z
  - Completed: D4.
  - Final verification passed: `pnpm install`, `pnpm typecheck`, `pnpm test` (29 files / 232 tests), `pnpm test:guard`, `pnpm test:winsw`, and `pnpm --filter @codexnext/agent dev -- doctor`.
  - Doctor note: the only non-ok diagnostic was the expected local warning that no relay URL was supplied.
- 2026-06-11T02:38Z
  - Completed: D5.
  - Reverse audit: `git diff --check` passed; pending-checkbox scan shows only D5 and D6 before closing D5; focused device-route scan confirms `/api/devices` route registration lives in `apps/control/src/device-routes.ts` and `server.ts` only calls `registerDeviceRoutes`.
  - Adversarial findings: moved device routes still guard access before returning or mutating device state; revoke audit/offline broadcast behavior remains in the extracted route module with existing integration coverage.
- 2026-06-11T02:39Z
  - Completed: D6 preflight.
  - Evidence: guard status shows 11/12 completed checkboxes with only D6 pending, completedCycles 17/20, and `canContinue: true`.
  - Current action: running `node scripts/codexnext-backlog-cycle-guard.mjs complete-cycle`.

## 7. Final Verification Commands

Run before `complete-cycle`:

```bash
node scripts/codexnext-backlog-cycle-guard.mjs status
pnpm install
pnpm typecheck
pnpm test
pnpm test:guard
pnpm test:winsw
pnpm --filter @codexnext/agent dev -- doctor
node scripts/codexnext-backlog-cycle-guard.mjs complete-cycle
```
