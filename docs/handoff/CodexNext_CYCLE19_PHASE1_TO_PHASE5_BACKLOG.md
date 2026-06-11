# CodexNext Cycle 19 Phase 1-5 Backlog

## 0. Count Semantics

This is the active Cycle 19 backlog. The cycle count must not increment until every checkbox in this file is complete, final verification passes, reverse audit finds no must-fix issue, and:

```bash
node scripts/codexnext-backlog-cycle-guard.mjs complete-cycle
```

succeeds.

Current count at backlog generation: 18/20.
Deadline: 2026-06-11 05:30 Europe/London.

## 1. Fresh Audit Summary

Cycle 18 completed and counted successfully. Evidence:

- Guard count is now 18/20 and `canContinue` is true.
- Cycle 18 final guard verification passed inside `complete-cycle`: `pnpm install`, `pnpm typecheck`, `pnpm test` (29 files / 232 tests), `pnpm test:guard`, `pnpm test:winsw`, and `pnpm --filter @codexnext/agent dev -- doctor`.
- Cycle 18 extracted device route registration into `apps/control/src/device-routes.ts` and added sidebar prefs not-found coverage.

Fresh Cycle 19 findings:

- `docs/handoff/CodexNext_TEST_COVERAGE_GAPS.md` now lists pairing route registration and relay RPC route registration as the main remaining control route-group work.
- `apps/control/src/server.ts` still registers `/api/pairings/device`, `/api/pairings/device/:requestId`, and `/api/pairings/requests/:code` approve/reject/view routes inline.
- Existing integration tests cover pairing approval, auth, one-time use, rejection polling, TTL expiry, lookup/decision/create rate limits, token omission in views, and machine authorization. Invalid create payload behavior should get a focused check before extraction.

## 2. Cycle 19 Goal

Cycle 19 should extract the pairing route group out of `server.ts`:

1. Create a dedicated control pairing route registration module for device create/poll and user lookup/approve/reject routes.
2. Move pairing approve URL construction with the pairing route module.
3. Keep pairings map, registry, audit logger, rate-limit map, owner access guard, and session issue closure owned by `createControlServer` and passed into the route module.
4. Add focused integration coverage for invalid pairing create payloads.
5. Refresh coverage docs, run targeted tests, perform security/reverse audits, and pass the full guard gate.

## 3. Non-Goals

- No pairing state semantics changes.
- No pairing TTL/rate-limit/token length changes.
- No relay RPC route extraction.
- No Web UI changes.
- No changes to device registry persistence.

## 4. Required Reading

- `docs/handoff/CodexNext_TEST_COVERAGE_GAPS.md`
- `docs/handoff/CodexNext_CYCLE18_PHASE1_TO_PHASE5_BACKLOG.md`
- `apps/control/src/server.ts`
- `apps/control/src/pairing.ts`
- `apps/control/test/control-server.test.ts`

## 5. Backlog

### A. Phase 1 / Phase 5 - Pairing Route Group Extraction

- [x] A1. Create a dedicated control pairing route registration module.
  - Acceptance: module registers pairing create, poll, lookup, approve, and reject routes.

- [x] A2. Update `server.ts` to call the pairing route registration module and remove inline pairing route handlers and pairing approve URL builder.
  - Acceptance: `server.ts` retains pairing state and prune timer behavior, while pairing route code moves out.

### B. Tests

- [x] B1. Add integration coverage for invalid pairing create payloads.
- [x] B2. Run existing control integration tests that cover approval, auth, one-time use, rejected poll, TTL expiry, rate limits, safe views, and machine authorization.

### C. Security / Product Boundary Audit

- [x] C1. Confirm safe pairing views still omit raw code, device token, and poll token.
- [x] C2. Confirm create/approve/reject audit metadata remains short-fingerprint based and does not log token material.

### D. Docs, Audit, And Final Gate

- [x] D1. Refresh coverage-gap docs to record pairing route extraction and leave relay RPC route extraction as remaining work.
- [x] D2. Run targeted control typecheck/tests.
- [x] D3. Run marker, pairing-route, and token/audit scans after code changes.
- [x] D4. Run final verification: `pnpm install`, `pnpm typecheck`, `pnpm test`, `pnpm test:guard`, `pnpm test:winsw`, `pnpm --filter @codexnext/agent dev -- doctor`.
- [x] D5. Run adversarial reverse audit after all checkboxes appear complete.
- [x] D6. Confirm this backlog has zero pending checkbox items and run `node scripts/codexnext-backlog-cycle-guard.mjs complete-cycle`.

## 6. Progress Log

- 2026-06-11T02:41Z
  - Completed: generated Cycle 19 backlog from current repo state after Cycle 18 completion.
  - Evidence read: guard status 18/20 with no active backlog; coverage-gap handoff; Cycle 18 backlog/progress; remaining pairing route registrations; pairing helper module; pairing integration tests.
  - Current status: active backlog path is `docs/handoff/CodexNext_CYCLE19_PHASE1_TO_PHASE5_BACKLOG.md`; completedCycles 18/20; canContinue true.
- 2026-06-11T02:45Z
  - Completed: added `apps/control/src/pairing-routes.ts` and updated `apps/control/src/server.ts` to call `registerPairingRoutes` while keeping pairing state/pruning in `createControlServer`.
  - Completed: moved pairing approve URL construction into the route module and removed the inline pairing route handlers from `server.ts`.
  - Completed: added invalid pairing create payload coverage to `apps/control/test/control-server.test.ts`.
  - Verification: `pnpm --filter @codexnext/control typecheck` passed; `pnpm exec vitest run apps/control/test/control-server.test.ts` passed with 57 tests.
  - Audit: marker scan was clean; pairing-route scan shows route handlers live in `pairing-routes.ts`; token/audit scan shows safe views continue through `toPairingView` and pairing create/approve/reject audit metadata remains limited to hostname and short fingerprint.
  - Docs: refreshed `docs/handoff/CodexNext_TEST_COVERAGE_GAPS.md` to record pairing route extraction and leave relay RPC route registration as remaining control route-group work.
- 2026-06-11T02:46Z
  - Final verification: `pnpm install` passed; `pnpm typecheck` passed; `pnpm test` passed with 29 files / 233 tests; `pnpm test:guard` passed; `pnpm test:winsw` validated 3 templates; `pnpm --filter @codexnext/agent dev -- doctor` passed local diagnostics with only the expected no-relay-URL health probe warning.
- 2026-06-11T02:47Z
  - Reverse audit: `git diff --check` passed; pending-checkbox scan showed only D5/D6 before marking D5; marker scan was clean; focused pairing-route scan found pairing route registrations and `buildPairApproveUrl` only in `pairing-routes.ts`, with `server.ts` limited to the `registerPairingRoutes` call.
  - Token/audit audit: pairing create still returns device-facing `code`/`pollToken` by contract, user-facing lookup still returns `toPairingView`, and pairing create/approve/reject audit metadata remains limited to hostname and short fingerprint.
- 2026-06-11T02:47Z
  - Final checklist audit: guard status showed 11/12 checkboxes complete with only D6 pending; D6 marked complete immediately before running `complete-cycle`.

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
