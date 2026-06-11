# CodexNext Cycle 10 Phase 1-5 Backlog

## 0. Count Semantics

This is the active Cycle 10 backlog. The cycle count must not increment until every checkbox in this file is complete, final verification passes, reverse audit finds no must-fix issue, and:

```bash
node scripts/codexnext-backlog-cycle-guard.mjs complete-cycle
```

succeeds.

Current count at backlog generation: 9/20.
Deadline: 2026-06-11 05:30 Europe/London.

## 1. Fresh Audit Summary

Cycle 09 completed and counted successfully. Evidence:

- Guard count is now 9/20 and `canContinue` is true.
- Cycle 09 final guard verification passed: `pnpm install`, `pnpm typecheck`, `pnpm test` (24 files / 195 tests), `pnpm test:guard`, `pnpm test:winsw`, and `pnpm --filter @codexnext/agent dev -- doctor`.
- Cycle 09 added controller-used relay session expiry formatters, rendered full-access filtering tests, and Vitest JSX support for component imports.

Fresh Cycle 10 findings:

- `apps/agent` still has pair/connect failure paths mostly covered only by live integration. The concrete next slice is `runPair`: it uses live `fetch`, sleeps between polls, casts JSON responses, and immediately calls `runConnect` on approval.
- Protocol already owns pairing response schemas, so `runPair` should validate create/poll JSON before trusting it.
- Pairing can be tested without a live relay by injecting fetch/sleep/connect/device/codex dependencies. That improves failure coverage without changing the CLI surface.
- `connect` itself is an infinite Socket.IO loop, so this cycle should avoid pretending to integration-test it. Instead, cover stable connect helpers such as relay URL normalization/error formatting and verify approved pairing delegates into `runConnect` with normalized relay/device options.

## 2. Cycle 10 Goal

Cycle 10 should harden and test agent pairing failure paths:

1. Add runtime validation for pairing create and poll responses in `runPair`.
2. Add narrow dependency injection for `runPair` so command failure paths can be unit-tested without live fetch, sleep, or Socket.IO.
3. Add tests for create failure, malformed create response, poll failure, rejected/expired statuses, and approved status delegating to connect.
4. Add small connect helper tests for URL normalization/error formatting.
5. Refresh coverage docs, run targeted tests, perform safety/reverse audits, and pass the full guard gate.

## 3. Non-Goals

- No live relay integration test.
- No Socket.IO client refactor.
- No change to the CLI command surface.
- No Web/mobile work.
- No control route extraction.

## 4. Required Reading

- `README.md`
- `docs/ROADMAP.md`
- `docs/ARCHITECTURE.md`
- `docs/SECURITY.md`
- `docs/RELAY_DEPLOYMENT.md`
- `docs/handoff/CodexNext_BACKLOG_CYCLE_LOG.md`
- `docs/handoff/CodexNext_TEST_COVERAGE_GAPS.md`
- `docs/handoff/CodexNext_CYCLE09_PHASE1_TO_PHASE5_BACKLOG.md`
- `apps/agent/src/commands/pair.ts`
- `apps/agent/src/commands/connect.ts`
- `apps/agent/src/relay/device-identity.ts`
- `packages/protocol/src/index.ts`
- `packages/protocol/test/relay-schemas.test.ts`

## 5. Backlog

### A. Phase 1 / Phase 5 - Pairing Runtime Validation

- [x] A1. Parse pairing create and poll JSON through protocol schemas.
  - Reason: pairing responses carry trust-establishing data and should not be interface-only at the CLI boundary.
  - Acceptance: malformed create/poll success payloads throw stable `Invalid pairing response: <name>` errors.

- [x] A2. Add narrow injectable dependencies for `runPair`.
  - Reason: tests need to exercise failure statuses without real network, sleep, device files, Codex CLI, or Socket.IO.
  - Acceptance: default CLI behavior is unchanged; tests can inject fetch, sleep, connect, identity, and Codex version providers.

### B. Phase 1 / Phase 5 - Agent Command Tests

- [x] B1. Add pair command tests for create HTTP failure and malformed create JSON.
- [x] B2. Add pair command tests for poll HTTP failure, malformed poll JSON, rejected status, and expired status.
- [x] B3. Add pair command test for approved status delegating to connect with normalized relay URL and device name.
- [x] B4. Add connect helper tests for `normalizeRelayUrl` and `formatError`.

### C. Security / Product Boundary Audit

- [x] C1. Confirm dependency injection is not exposed through CLI args and does not weaken device token handling.
- [x] C2. Confirm tests do not persist device tokens or require live relay/Codex credentials.

### D. Docs, Audit, And Final Gate

- [x] D1. Refresh coverage-gap docs to move pair command failure paths into covered areas and narrow the remaining connect gap.
- [x] D2. Run targeted agent typecheck/tests.
- [x] D3. Run marker and token-storage audits after code changes.
- [x] D4. Run final verification: `pnpm install`, `pnpm typecheck`, `pnpm test`, `pnpm test:guard`, `pnpm test:winsw`, `pnpm --filter @codexnext/agent dev -- doctor`.
- [x] D5. Run adversarial reverse audit after all checkboxes appear complete.
- [x] D6. Confirm this backlog has zero pending checkbox items and run `node scripts/codexnext-backlog-cycle-guard.mjs complete-cycle`.

## 6. Progress Log

- 2026-06-11T01:23Z
  - Completed: generated Cycle 10 backlog from current repo state after Cycle 09 completion.
  - Evidence read: guard status 9/20 with no active backlog, then active Cycle 10 placeholder; Cycle 09 backlog/progress; coverage-gap handoff; README/roadmap/architecture/security/deployment docs from current context; `runPair`; `runConnect`; agent test patterns; protocol pairing schemas.
  - Current status: active backlog path is `docs/handoff/CodexNext_CYCLE10_PHASE1_TO_PHASE5_BACKLOG.md`; completedCycles 9/20; canContinue true.
- 2026-06-11T01:27Z
  - Completed: A1, A2, B1, B2, B3, B4, D1, and D2.
  - Code: `runPair` now validates pairing create/poll JSON through protocol schemas and supports injectable fetch, sleep, connect, identity, Codex version, and output dependencies for unit tests without changing CLI args.
  - Tests: added pair command coverage for create/poll HTTP failures, malformed payloads, rejected/expired statuses, approved delegation into connect, and connect helper normalization/error formatting.
  - Verification: `pnpm --filter @codexnext/agent typecheck` and `pnpm exec vitest run apps/agent/test/pair-command.test.ts` passed with 8 tests.
  - Docs: updated `docs/handoff/CodexNext_TEST_COVERAGE_GAPS.md` to move pair command failure paths into covered areas and narrow the remaining agent gap to live Socket.IO connect behavior.
- 2026-06-11T01:28Z
  - Completed: C1, C2, and D3.
  - Security audit: `apps/agent/src/index.ts` still calls `runPair(options)` only from the public CLI action; test dependencies are not exposed as command-line switches.
  - Token audit: new pair tests use in-memory dummy `device-token` and `poll-token` fixtures only; they inject identity/fetch/sleep/connect and do not touch device files, live relay credentials, or Codex credentials.
  - Marker audit: no new TODO/FIXME/HACK/PLACEHOLDER markers in the touched agent command/test paths; existing local-server test helper names are unrelated.
- 2026-06-11T01:29Z
  - Completed: D4.
  - Final verification passed: `pnpm install`, `pnpm typecheck`, `pnpm test` (25 files / 203 tests), `pnpm test:guard`, `pnpm test:winsw`, and `pnpm --filter @codexnext/agent dev -- doctor`.
  - Doctor note: the only non-ok diagnostic was the expected local warning that no relay URL was supplied.
- 2026-06-11T01:30Z
  - Completed: D5.
  - Reverse audit: `git diff --check` passed; direct reads of the new untracked pair test and coverage docs found no mismatch with the checklist.
  - Adversarial findings: no must-fix issue found. The only remaining agent gap is intentionally live Socket.IO connect handshake/reconnect behavior, which is outside Cycle 10's non-goals.
- 2026-06-11T01:30Z
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
