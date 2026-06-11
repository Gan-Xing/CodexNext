# CodexNext Cycle 15 Phase 1-5 Backlog

## 0. Count Semantics

This is the active Cycle 15 backlog. The cycle count must not increment until every checkbox in this file is complete, final verification passes, reverse audit finds no must-fix issue, and:

```bash
node scripts/codexnext-backlog-cycle-guard.mjs complete-cycle
```

succeeds.

Current count at backlog generation: 14/20.
Deadline: 2026-06-11 05:30 Europe/London.

## 1. Fresh Audit Summary

Cycle 14 completed and counted successfully. Evidence:

- Guard count is now 14/20 and `canContinue` is true.
- Cycle 14 final guard verification passed inside `complete-cycle`: `pnpm install`, `pnpm typecheck`, `pnpm test` (27 files / 221 tests), `pnpm test:guard`, `pnpm test:winsw`, and `pnpm --filter @codexnext/agent dev -- doctor`.
- Cycle 14 extracted pure pairing helpers into `apps/control/src/pairing.ts`, added helper-level tests, and stabilized the two-client replay duplicate-event integration test.

Fresh Cycle 15 findings:

- `apps/control/src/server.ts` still owns browser-session helper state and behavior directly: `BrowserSessionRecord`, session token hashing, issue/revoke, access-token resolution, idle/TTL expiry, pruning, and user-socket disconnection hooks.
- Existing integration tests already cover session minting, owner-auth requirements, logout revoke, idle expiry, TTL expiry, socket disconnect on logout, and pruning expiry.
- The browser-session cluster can move into a dedicated helper module while route registration, audit logging, and Socket.IO disconnect side effects remain in `server.ts`.

## 2. Cycle 15 Goal

Cycle 15 should continue reducing the control route-file surface by extracting browser-session helper logic:

1. Move browser-session record type and pure/session-map helper functions into a dedicated control module.
2. Preserve auth/session, logout, Socket.IO authorization, idle expiry, TTL expiry, and pruning behavior.
3. Add helper-level tests for hashed storage, token issue, owner-token bypass semantics, access resolution, revoke, and prune behavior.
4. Run existing control integration tests around session routes and sockets.
5. Refresh coverage docs, run targeted tests, perform security/reverse audits, and pass the full guard gate.

## 3. Non-Goals

- No auth route registration extraction.
- No change to browser-session token length, token hashing purpose string, TTL, idle timeout, logout semantics, or production owner-token rules.
- No pairing route changes.
- No relay device route extraction.
- No Web session-recovery UI work.

## 4. Required Reading

- `docs/handoff/CodexNext_TEST_COVERAGE_GAPS.md`
- `docs/handoff/CodexNext_CYCLE14_PHASE1_TO_PHASE5_BACKLOG.md`
- `apps/control/src/server.ts`
- `apps/control/src/pairing.ts`
- `apps/control/test/control-server.test.ts`

## 5. Backlog

### A. Phase 1 / Phase 5 - Browser Session Helper Extraction

- [x] A1. Create a dedicated control browser-session helper module.
  - Acceptance: module owns `BrowserSessionRecord`, session token hashing/issue helpers, access resolution, revoke, and prune helpers.

- [x] A2. Update `server.ts` to import browser-session helpers and remove local browser-session helper definitions.
  - Acceptance: route registration, audit writes, and Socket.IO disconnect side effects stay in `server.ts`; session behavior is unchanged.

### B. Tests

- [x] B1. Add helper tests for stable hashed storage and session issue records.
- [x] B2. Add helper tests for access resolution, valid-session `lastUsedAt` refresh, dev owner-token bypass, and production owner-token rejection.
- [x] B3. Add helper tests for revoke, TTL expiry, idle expiry, revoked-session expiry, and prune return values.
- [x] B4. Run existing control integration tests that cover auth/session, logout, expiry, and user-socket disconnect behavior.

### C. Security / Product Boundary Audit

- [x] C1. Confirm browser sessions still store only token hashes server-side and do not expose raw session tokens in audit logs.
- [x] C2. Confirm owner-token bypass remains dev-only and production requires minted browser sessions.

### D. Docs, Audit, And Final Gate

- [x] D1. Refresh coverage-gap docs to record the browser-session helper extraction and leave route registration extraction as remaining work.
- [x] D2. Run targeted control typecheck/tests.
- [x] D3. Run marker, token, and owner-token bypass scans after code changes.
- [x] D4. Run final verification: `pnpm install`, `pnpm typecheck`, `pnpm test`, `pnpm test:guard`, `pnpm test:winsw`, `pnpm --filter @codexnext/agent dev -- doctor`.
- [x] D5. Run adversarial reverse audit after all checkboxes appear complete.
- [x] D6. Confirm this backlog has zero pending checkbox items and run `node scripts/codexnext-backlog-cycle-guard.mjs complete-cycle`.

## 6. Progress Log

- 2026-06-11T02:12Z
  - Completed: generated Cycle 15 backlog from current repo state after Cycle 14 completion.
  - Evidence read: guard status 14/20 with no active backlog; coverage-gap handoff; Cycle 14 backlog/progress; control browser-session helpers and auth/session integration tests.
  - Current status: active backlog path is `docs/handoff/CodexNext_CYCLE15_PHASE1_TO_PHASE5_BACKLOG.md`; completedCycles 14/20; canContinue true.
- 2026-06-11T02:17Z
  - Completed: A1, A2, B1, B2, B3, B4, C1, C2, D1, D2, and D3.
  - Code: added `apps/control/src/browser-session.ts` for `BrowserSessionRecord`, token hashing, token issue, access resolution, revoke, and prune helpers.
  - Code: `server.ts` now imports browser-session helpers while retaining audit writes, route registration, and Socket.IO disconnect side effects locally.
  - Tests: added `apps/control/test/browser-session.test.ts` covering hash-only storage, session issue records, valid access refresh, dev-only owner-token bypass, production owner-token rejection, revoke, TTL/idle/revoked expiry, and prune return values.
  - Verification: `pnpm --filter @codexnext/control typecheck`, `pnpm exec vitest run apps/control/test/browser-session.test.ts`, and `pnpm exec vitest run apps/control/test/control-server.test.ts apps/control/test/browser-session.test.ts` passed (59 tests in the combined run).
  - Test stabilization: adjusted the existing two-client duplicate-event test to observe only the post-duplicate event window by duplicate event id, avoiding delayed delivery of the already-expected live event.
  - Security audit: marker scan was clean; token/audit scans show raw browser session tokens are still only returned by issue/approve responses and are not written to audit logs; helper tests assert owner-token bypass is dev-only and production treats the owner token as invalid for browser-session access.
  - Docs: updated `docs/handoff/CodexNext_TEST_COVERAGE_GAPS.md` to record browser-session helper coverage while leaving route registration extraction as remaining work.
- 2026-06-11T02:19Z
  - Completed: D4.
  - Final verification passed: `pnpm install`, `pnpm typecheck`, `pnpm test` (28 files / 226 tests), `pnpm test:guard`, `pnpm test:winsw`, and `pnpm --filter @codexnext/agent dev -- doctor`.
  - Doctor note: the only non-ok diagnostic was the expected local warning that no relay URL was supplied.
- 2026-06-11T02:19Z
  - Completed: D5.
  - Reverse audit: `git diff --check` passed; pending-checkbox scan shows only D5 and D6 before closing D5; focused browser-session helper scan confirms hashing/prune definitions live only in `apps/control/src/browser-session.ts`.
  - Adversarial findings: server-side audit writes remain token-free; route registration and Socket.IO disconnect side effects stay in `server.ts`; production owner-token behavior is covered by helper tests and existing control integration tests.
- 2026-06-11T02:20Z
  - Completed: D6 preflight.
  - Evidence: guard status shows 13/14 completed checkboxes with only D6 pending, completedCycles 14/20, and `canContinue: true`.
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
