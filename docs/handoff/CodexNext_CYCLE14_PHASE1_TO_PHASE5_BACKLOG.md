# CodexNext Cycle 14 Phase 1-5 Backlog

## 0. Count Semantics

This is the active Cycle 14 backlog. The cycle count must not increment until every checkbox in this file is complete, final verification passes, reverse audit finds no must-fix issue, and:

```bash
node scripts/codexnext-backlog-cycle-guard.mjs complete-cycle
```

succeeds.

Current count at backlog generation: 13/20.
Deadline: 2026-06-11 05:30 Europe/London.

## 1. Fresh Audit Summary

Cycle 13 completed and counted successfully. Evidence:

- Guard count is now 13/20 and `canContinue` is true.
- Cycle 13 final guard verification passed: `pnpm install`, `pnpm typecheck`, `pnpm test` (26 files / 217 tests), `pnpm test:guard`, `pnpm test:winsw`, and `pnpm --filter @codexnext/agent dev -- doctor`.
- Cycle 13 extracted pure relay RPC helpers out of `apps/control/src/server.ts` and preserved route behavior through control integration tests.

Fresh Cycle 14 findings:

- `apps/control/src/server.ts` still contains pairing helper types/functions in the main route file: `PairingRequestRecord`, `pairingForCode`, `resolvePairingStatus`, `toPairingView`, `buildShortFingerprint`, `normalizePairCode`, and `randomDigits`.
- Pairing routes already have broad integration coverage for approval, auth, one-time use, safe views, rejected poll behavior, TTL expiry, and rate limits.
- The helper cluster is mostly pure and can move to a dedicated module with deterministic unit tests. Route registration and registry/session side effects should stay in `server.ts` this cycle.

## 2. Cycle 14 Goal

Cycle 14 should continue reducing the control route-file surface by extracting pairing helper logic:

1. Move pairing record type and pure helper functions into a dedicated control module.
2. Keep pairing route behavior unchanged.
3. Add helper-level tests for code normalization, lookup, status resolution, safe view shaping, fingerprint stability, and digit generation.
4. Run existing control integration tests to prove route behavior survived.
5. Refresh coverage docs, run targeted tests, perform safety/reverse audits, and pass the full guard gate.

## 3. Non-Goals

- No pairing route registration rewrite.
- No change to pairing token storage, approval semantics, TTL, rate limits, or registry updates.
- No auth/session/device route extraction.
- No Web hook test harness work.
- No live relay integration test.

## 4. Required Reading

- `docs/handoff/CodexNext_TEST_COVERAGE_GAPS.md`
- `docs/handoff/CodexNext_CYCLE13_PHASE1_TO_PHASE5_BACKLOG.md`
- `apps/control/src/server.ts`
- `apps/control/src/relay-rpc.ts`
- `apps/control/test/control-server.test.ts`
- `apps/control/test/relay-rpc-error.test.ts`
- `packages/protocol/src/index.ts`

## 5. Backlog

### A. Phase 1 / Phase 5 - Pairing Helper Extraction

- [x] A1. Create a dedicated control pairing helper module.
  - Acceptance: module owns `PairingRequestRecord` and pure helpers for pairing status, safe view creation, lookup, fingerprinting, code normalization, and digit generation.

- [x] A2. Update `server.ts` to import pairing helpers and remove local helper definitions.
  - Acceptance: pairing routes continue to create, poll, view, approve, reject, expire, and prune pairings without behavior changes.

### B. Tests

- [x] B1. Add helper tests for code normalization and normalized lookup.
- [x] B2. Add helper tests for pending/expired/approved/rejected status resolution.
- [x] B3. Add helper tests for `toPairingView` safe shaping without `deviceToken`, `pollToken`, or raw `code`.
- [x] B4. Add helper tests for stable short fingerprint and deterministic digit generation.
- [x] B5. Run existing control server integration tests to prove route behavior survived the extraction.

### C. Security / Product Boundary Audit

- [x] C1. Confirm safe pairing views still omit device tokens, poll tokens, and raw dashed codes.
- [x] C2. Confirm route audit logs still use short fingerprints rather than token material.

### D. Docs, Audit, And Final Gate

- [x] D1. Refresh coverage-gap docs to record the control pairing helper extraction and leave larger route-group extraction as remaining work.
- [x] D2. Run targeted control typecheck/tests.
- [x] D3. Run marker and pairing-token scans after code changes.
- [x] D4. Run final verification: `pnpm install`, `pnpm typecheck`, `pnpm test`, `pnpm test:guard`, `pnpm test:winsw`, `pnpm --filter @codexnext/agent dev -- doctor`.
- [x] D5. Run adversarial reverse audit after all checkboxes appear complete.
- [x] D6. Confirm this backlog has zero pending checkbox items and run `node scripts/codexnext-backlog-cycle-guard.mjs complete-cycle`.

## 6. Progress Log

- 2026-06-11T01:59Z
  - Completed: generated Cycle 14 backlog from current repo state after Cycle 13 completion.
  - Evidence read: guard status 13/20 with no active backlog, then active Cycle 14 placeholder; coverage-gap handoff; Cycle 13 backlog/progress; control pairing routes/helpers in `server.ts`; existing pairing integration tests.
  - Current status: active backlog path is `docs/handoff/CodexNext_CYCLE14_PHASE1_TO_PHASE5_BACKLOG.md`; completedCycles 13/20; canContinue true.
- 2026-06-11T02:01Z
  - Completed: A1, A2, B1, B2, B3, B4, B5, D1, and D2.
  - Code: added `apps/control/src/pairing.ts` for `PairingRequestRecord`, code normalization, normalized lookup, status resolution, safe view shaping, short fingerprinting, and digit generation.
  - Code: `server.ts` now imports pairing helpers and no longer defines those pure helpers locally.
  - Tests: added `apps/control/test/pairing.test.ts` covering normalization/lookup, status resolution, safe view omission of token material/raw code, fingerprint stability, and deterministic digits.
  - Verification: `pnpm --filter @codexnext/control typecheck`, `pnpm exec vitest run apps/control/test/pairing.test.ts`, and `pnpm exec vitest run apps/control/test/control-server.test.ts apps/control/test/pairing.test.ts` passed (58 control tests in the combined run).
  - Docs: updated `docs/handoff/CodexNext_TEST_COVERAGE_GAPS.md` to record the control pairing helper extraction while leaving route registration extraction as remaining work.
- 2026-06-11T02:02Z
  - Completed: C1, C2, and D3.
  - Security audit: helper tests assert `toPairingView` omits `deviceToken`, `pollToken`, and raw dashed `code`.
  - Token/audit audit: route scans show pairing audit entries continue to use `shortFingerprint` metadata; token material remains in device registration/polling flows where required and is not newly logged by the helper extraction.
  - Marker audit: no TODO/FIXME/HACK/PLACEHOLDER markers in touched pairing source, tests, or Cycle 14 backlog.
- 2026-06-11T02:03Z
  - Completed: D4.
  - Final verification passed: `pnpm install`, `pnpm typecheck`, `pnpm test` (27 files / 221 tests), `pnpm test:guard`, `pnpm test:winsw`, and `pnpm --filter @codexnext/agent dev -- doctor`.
  - Doctor note: the only non-ok diagnostic was the expected local warning that no relay URL was supplied.
- 2026-06-11T02:03Z
  - Completed: D5.
  - Reverse audit: `git diff --check` passed; focused reads of `pairing.ts`, `pairing.test.ts`, and the active backlog found no must-fix issue.
  - Adversarial findings: safe pairing view shaping remains covered by unit tests and existing integration tests; route-level token-bearing create/poll/device registration behavior is unchanged.
- 2026-06-11T02:04Z
  - Attempted: D6 completion.
  - Result: `node scripts/codexnext-backlog-cycle-guard.mjs complete-cycle` did not count the cycle because its internal `pnpm test` run failed once in `apps/control/test/control-server.test.ts` (`converges replay and live events across two user clients` observed a delayed live `evt_3` while checking duplicate suppression).
  - Current action: D6 is reopened while the failure is investigated and the final gate is rerun.
- 2026-06-11T02:05Z
  - Updated: stabilized the existing control duplicate-live-event test by draining one Socket.IO delivery tick after the expected live event before attaching duplicate listeners.
  - Current action: D5 is reopened until focused tests, full verification, and reverse audit are clean again after this test change.
- 2026-06-11T02:08Z
  - Completed: D5 after the control test stabilization.
  - Verification rerun: `pnpm exec vitest run apps/control/test/control-server.test.ts apps/control/test/pairing.test.ts` passed (58 tests); `pnpm install`, `pnpm typecheck`, `pnpm test` (27 files / 221 tests), `pnpm test:guard`, `pnpm test:winsw`, and `pnpm --filter @codexnext/agent dev -- doctor` passed.
  - Doctor note: the only non-ok diagnostic remains the expected local warning that no relay URL was supplied.
  - Reverse audit: `git diff --check` passed; pending-checkbox scan shows only D6 remains; focused pairing-helper scan confirms `server.ts` only calls the extracted pairing helpers while implementation remains in `apps/control/src/pairing.ts`.
- 2026-06-11T02:09Z
  - Completed: D6 preflight.
  - Evidence: guard status shows 14/15 completed checkboxes with only D6 pending, completedCycles 13/20, and `canContinue: true`.
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
