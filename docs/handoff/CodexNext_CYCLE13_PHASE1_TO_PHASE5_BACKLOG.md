# CodexNext Cycle 13 Phase 1-5 Backlog

## 0. Count Semantics

This is the active Cycle 13 backlog. The cycle count must not increment until every checkbox in this file is complete, final verification passes, reverse audit finds no must-fix issue, and:

```bash
node scripts/codexnext-backlog-cycle-guard.mjs complete-cycle
```

succeeds.

Current count at backlog generation: 12/20.
Deadline: 2026-06-11 05:30 Europe/London.

## 1. Fresh Audit Summary

Cycle 12 completed and counted successfully. Evidence:

- Guard count is now 12/20 and `canContinue` is true.
- Cycle 12 final guard verification passed: `pnpm install`, `pnpm typecheck`, `pnpm test` (26 files / 214 tests), `pnpm test:guard`, `pnpm test:winsw`, and `pnpm --filter @codexnext/agent dev -- doctor`.
- Cycle 12 moved agent connect setup/handshake/reconnect/RPC unit behavior into covered areas and narrowed the remaining agent gap to true live relay integration.

Fresh Cycle 13 findings:

- `apps/control/src/server.ts` is still 1,918 lines and mixes route registration with pure relay RPC helpers.
- The current control integration tests are broad, and `apps/control/test/relay-rpc-error.test.ts` already tests `classifyRelayRpcError`, so a small extraction can be protected without changing route behavior.
- Pure helpers in scope are `classifyRelayRpcError`, `routeRpcTimeout`, `validateRelayRpcResult`, their supporting types/constants, and related tests. `invokeMachineRpc` and Fastify reply/audit wiring should stay in `server.ts` this cycle because they close over route state.
- Web hook-level session-expiry coverage remains a real gap, but the current Web test setup is Node/server-render based and does not provide a DOM hook harness. Control extraction is the safer high-value next slice.

## 2. Cycle 13 Goal

Cycle 13 should begin reducing the control server route-file size without behavior change:

1. Extract pure relay RPC helpers into a dedicated control module.
2. Keep server route behavior and exported compatibility intact.
3. Add/extend tests for relay RPC classification, timeout policy, and result validation.
4. Refresh coverage docs, run targeted tests, perform safety/reverse audits, and pass the full guard gate.

## 3. Non-Goals

- No route registration rewrite.
- No Socket.IO behavior changes.
- No pairing/auth/session extraction.
- No Web hook test harness work.
- No live relay integration test.

## 4. Required Reading

- `docs/handoff/CodexNext_TEST_COVERAGE_GAPS.md`
- `docs/handoff/CodexNext_CYCLE12_PHASE1_TO_PHASE5_BACKLOG.md`
- `apps/control/src/server.ts`
- `apps/control/test/control-server.test.ts`
- `apps/control/test/relay-rpc-error.test.ts`
- `packages/protocol/src/index.ts`

## 5. Backlog

### A. Phase 1 / Phase 5 - Relay RPC Helper Extraction

- [x] A1. Create a dedicated control relay RPC helper module.
  - Acceptance: module owns relay RPC error classification types, slow-route timeout policy, and result validation helpers.

- [x] A2. Update `server.ts` to import extracted helpers.
  - Acceptance: `server.ts` no longer defines the extracted pure helpers locally and route behavior is unchanged.

- [x] A3. Preserve public compatibility for existing imports of `classifyRelayRpcError`.
  - Acceptance: existing tests importing from `../src/server.js` continue to pass or are covered by an explicit re-export check.

### B. Tests

- [x] B1. Keep/extend tests for timeout/offline/not-found/protocol/generic error classification.
- [x] B2. Add tests for route timeout policy, including slow Codex history/session routes.
- [x] B3. Add tests for relay RPC result validation accepting parsed schema output and rejecting malformed output with method-specific errors.
- [x] B4. Run existing control server integration tests to prove route behavior survived the extraction.

### C. Security / Product Boundary Audit

- [x] C1. Confirm extraction does not change relay auth, owner-token, device-token, or audit redaction paths.
- [x] C2. Confirm no new logs expose tokens or raw RPC payload secrets.

### D. Docs, Audit, And Final Gate

- [x] D1. Refresh coverage-gap docs to record the control relay RPC helper extraction and leave larger route-group extraction as remaining work.
- [x] D2. Run targeted control typecheck/tests.
- [x] D3. Run marker and token/audit-log scans after code changes.
- [x] D4. Run final verification: `pnpm install`, `pnpm typecheck`, `pnpm test`, `pnpm test:guard`, `pnpm test:winsw`, `pnpm --filter @codexnext/agent dev -- doctor`.
- [x] D5. Run adversarial reverse audit after all checkboxes appear complete.
- [x] D6. Confirm this backlog has zero pending checkbox items and run `node scripts/codexnext-backlog-cycle-guard.mjs complete-cycle`.

## 6. Progress Log

- 2026-06-11T01:55Z
  - Completed: generated Cycle 13 backlog from current repo state after Cycle 12 completion.
  - Evidence read: guard status 12/20 with no active backlog, then active Cycle 13 placeholder; coverage-gap handoff; Cycle 12 backlog/progress; Web test setup and session-expiry gap; control server size/route-helper scan; current relay RPC error tests.
  - Current status: active backlog path is `docs/handoff/CodexNext_CYCLE13_PHASE1_TO_PHASE5_BACKLOG.md`; completedCycles 12/20; canContinue true.
- 2026-06-11T01:56Z
  - Completed: A1, A2, A3, B1, B2, B3, B4, D1, and D2.
  - Code: added `apps/control/src/relay-rpc.ts` for relay RPC error classification, timeout policy, result schema validation, and supporting types/constants.
  - Code: `server.ts` now imports extracted helpers and re-exports `classifyRelayRpcError` so existing imports remain compatible.
  - Tests: extended relay RPC helper tests for classification, slow-route timeout policy, parsed result acceptance, and malformed result rejection.
  - Verification: `pnpm --filter @codexnext/control typecheck`, `pnpm exec vitest run apps/control/test/relay-rpc-error.test.ts`, and `pnpm exec vitest run apps/control/test/control-server.test.ts apps/control/test/relay-rpc-error.test.ts` passed (58 control tests in the combined run).
  - Docs: updated `docs/handoff/CodexNext_TEST_COVERAGE_GAPS.md` to record the control relay RPC helper extraction and leave larger route-group extraction as remaining work.
- 2026-06-11T01:56Z
  - Completed: C1, C2, and D3.
  - Security audit: extraction only moved pure relay RPC helper logic; `server.ts` auth/session/device-token paths remain in place.
  - Token/audit-log audit: new helper module does not log tokens or raw RPC payloads; scans only found existing server auth paths and backlog notes.
  - Marker audit: no TODO/FIXME/HACK/PLACEHOLDER markers in the touched control source, helper tests, or Cycle 13 backlog.
- 2026-06-11T01:57Z
  - Completed: D4.
  - Final verification passed: `pnpm install`, `pnpm typecheck`, `pnpm test` (26 files / 217 tests), `pnpm test:guard`, `pnpm test:winsw`, and `pnpm --filter @codexnext/agent dev -- doctor`.
  - Doctor note: the only non-ok diagnostic was the expected local warning that no relay URL was supplied.
- 2026-06-11T01:57Z
  - Completed: D5.
  - Reverse audit: `git diff --check` passed; focused reads of `relay-rpc.ts`, `relay-rpc-error.test.ts`, and the active backlog found no must-fix issue.
  - Adversarial findings: extracted helper is pure and does not access tokens/log payloads; `server.ts` still owns auth/session/device state; classification compatibility remains covered through the existing `../src/server.js` test import.
- 2026-06-11T01:58Z
  - Completed: D6 checklist preparation.
  - Pending-checkbox check before marking D6 showed D6 as the only remaining open item; this entry marks it complete so the guard can count the cycle.

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
