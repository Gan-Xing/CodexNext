# CodexNext Cycle 17 Phase 1-5 Backlog

## 0. Count Semantics

This is the active Cycle 17 backlog. The cycle count must not increment until every checkbox in this file is complete, final verification passes, reverse audit finds no must-fix issue, and:

```bash
node scripts/codexnext-backlog-cycle-guard.mjs complete-cycle
```

succeeds.

Current count at backlog generation: 16/20.
Deadline: 2026-06-11 05:30 Europe/London.

## 1. Fresh Audit Summary

Cycle 16 completed and counted successfully. Evidence:

- Guard count is now 16/20 and `canContinue` is true.
- Cycle 16 final guard verification passed inside `complete-cycle`: `pnpm install`, `pnpm typecheck`, `pnpm test` (29 files / 230 tests), `pnpm test:guard`, `pnpm test:winsw`, and `pnpm --filter @codexnext/agent dev -- doctor`.
- Cycle 16 extracted control policy helpers into `apps/control/src/control-policy.ts` while preserving route-level CORS, rate-limit, and relay full-access enforcement.

Fresh Cycle 17 findings:

- `docs/handoff/CodexNext_TEST_COVERAGE_GAPS.md` now lists control route-group extraction as the main remaining control gap.
- `apps/control/src/server.ts` still registers `/api/auth/session` and `/api/auth/logout` inline, even though browser-session and policy helpers are already extracted.
- Existing integration tests cover session minting, invalid owner auth, logout revoke, idle expiry, TTL expiry, socket disconnect on logout, and pruning expiry; no focused auth-session rate-limit test exists yet.

## 2. Cycle 17 Goal

Cycle 17 should begin coverage-preserving route-group extraction by moving auth/session routes out of `server.ts`:

1. Create a dedicated control auth route registration module for `/api/auth/session` and `/api/auth/logout`.
2. Keep session issue/revoke state, audit logger, rate-limit map, and access-token validation owned by `createControlServer` and passed into the route module.
3. Add an integration test for auth-session rate limiting while preserving existing auth/logout/session expiry tests.
4. Refresh coverage docs, run targeted tests, perform security/reverse audits, and pass the full guard gate.

## 3. Non-Goals

- No pairing route extraction.
- No relay device route extraction.
- No browser-session behavior changes.
- No rate-limit threshold/window changes except adding coverage.
- No Web session-recovery work this cycle.

## 4. Required Reading

- `docs/handoff/CodexNext_TEST_COVERAGE_GAPS.md`
- `docs/handoff/CodexNext_CYCLE16_PHASE1_TO_PHASE5_BACKLOG.md`
- `apps/control/src/server.ts`
- `apps/control/src/browser-session.ts`
- `apps/control/src/control-policy.ts`
- `apps/control/test/control-server.test.ts`

## 5. Backlog

### A. Phase 1 / Phase 5 - Auth Route Group Extraction

- [x] A1. Create a dedicated control auth route registration module.
  - Acceptance: module registers `/api/auth/session` and `/api/auth/logout` and receives dependencies for audit, rate limits, owner token, session issue/revoke, and user-token validation.

- [x] A2. Update `server.ts` to call the auth route registration module and remove inline auth route handlers.
  - Acceptance: `server.ts` retains browser-session state and dependency closures, while auth route code moves out.

### B. Tests

- [x] B1. Add integration coverage for `/api/auth/session` rate limiting.
- [x] B2. Run existing control integration tests that cover session minting, invalid owner auth, logout revoke, idle expiry, TTL expiry, and socket disconnect behavior.

### C. Security / Product Boundary Audit

- [x] C1. Confirm auth routes still do not log or store raw browser session tokens in audit metadata.
- [x] C2. Confirm owner-token minting and browser-session revoke behavior remain unchanged.

### D. Docs, Audit, And Final Gate

- [x] D1. Refresh coverage-gap docs to record auth route extraction and leave pairing/device route extraction as remaining work.
- [x] D2. Run targeted control typecheck/tests.
- [x] D3. Run marker, auth-route, and token/audit scans after code changes.
- [x] D4. Run final verification: `pnpm install`, `pnpm typecheck`, `pnpm test`, `pnpm test:guard`, `pnpm test:winsw`, `pnpm --filter @codexnext/agent dev -- doctor`.
- [x] D5. Run adversarial reverse audit after all checkboxes appear complete.
- [x] D6. Confirm this backlog has zero pending checkbox items and run `node scripts/codexnext-backlog-cycle-guard.mjs complete-cycle`.

## 6. Progress Log

- 2026-06-11T02:29Z
  - Completed: generated Cycle 17 backlog from current repo state after Cycle 16 completion.
  - Evidence read: guard status 16/20 with no active backlog; coverage-gap handoff; Cycle 16 backlog/progress; control auth/session route handlers; browser-session and policy helper modules; existing auth/session integration tests.
  - Current status: active backlog path is `docs/handoff/CodexNext_CYCLE17_PHASE1_TO_PHASE5_BACKLOG.md`; completedCycles 16/20; canContinue true.
- 2026-06-11T02:31Z
  - Completed: A1, A2, B1, B2, C1, C2, D1, D2, and D3.
  - Code: added `apps/control/src/auth-routes.ts` to register `/api/auth/session` and `/api/auth/logout` with injected audit, rate-limit, owner-token, issue/revoke, and user-token validation dependencies.
  - Code: `server.ts` now calls `registerAuthRoutes(...)` and no longer defines inline auth route handlers.
  - Tests: added integration coverage for `/api/auth/session` rate limiting.
  - Verification: `pnpm --filter @codexnext/control typecheck` and `pnpm exec vitest run apps/control/test/control-server.test.ts` passed (55 control server tests).
  - Security audit: marker scan was clean; token/audit scans show raw browser session tokens remain response/auth values only, while auth route audit metadata remains IP-only.
  - Docs: updated `docs/handoff/CodexNext_TEST_COVERAGE_GAPS.md` to record extracted auth route registration and session mint/logout/rate-limit coverage.
- 2026-06-11T02:32Z
  - Completed: D4.
  - Final verification passed: `pnpm install`, `pnpm typecheck`, `pnpm test` (29 files / 231 tests), `pnpm test:guard`, `pnpm test:winsw`, and `pnpm --filter @codexnext/agent dev -- doctor`.
  - Doctor note: the only non-ok diagnostic was the expected local warning that no relay URL was supplied.
- 2026-06-11T02:32Z
  - Completed: D5.
  - Reverse audit: `git diff --check` passed; pending-checkbox scan shows only D5 and D6 before closing D5; focused auth-route scan confirms auth route registration now lives in `apps/control/src/auth-routes.ts` and `server.ts` only calls `registerAuthRoutes`.
  - Adversarial findings: auth route audit metadata remains IP-only; session issue/logout behavior is still covered through `createControlServer`; the new auth-session rate-limit test closes the missing 429 coverage.
- 2026-06-11T02:33Z
  - Completed: D6 preflight.
  - Evidence: guard status shows 11/12 completed checkboxes with only D6 pending, completedCycles 16/20, and `canContinue: true`.
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
