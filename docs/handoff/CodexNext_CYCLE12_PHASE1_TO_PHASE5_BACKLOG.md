# CodexNext Cycle 12 Phase 1-5 Backlog

## 0. Count Semantics

This is the active Cycle 12 backlog. The cycle count must not increment until every checkbox in this file is complete, final verification passes, reverse audit finds no must-fix issue, and:

```bash
node scripts/codexnext-backlog-cycle-guard.mjs complete-cycle
```

succeeds.

Current count at backlog generation: 11/20.
Deadline: 2026-06-11 05:30 Europe/London.

## 1. Fresh Audit Summary

Cycle 11 completed and counted successfully. Evidence:

- Guard count is now 11/20 and `canContinue` is true.
- Cycle 11 final guard verification passed: `pnpm install`, `pnpm typecheck`, `pnpm test` (25 files / 209 tests), `pnpm test:guard`, `pnpm test:winsw`, and `pnpm --filter @codexnext/agent dev -- doctor`.
- Cycle 11 added common app-server notification envelope/known-method validation and narrowed the remaining protocol/client gap to intentionally passthrough uncommon Codex notification fields.

Fresh Cycle 12 findings:

- `apps/agent/src/commands/connect.ts` still creates a live Socket.IO client, local runtime, signal handlers, heartbeat interval, and an infinite wait in one function.
- Cycle 10 covered pair command delegation into connect helpers, but connect handshake, reconnect-after-rejected-hello, event forwarding, and `rpc:request` ack behavior still require live Socket.IO to exercise.
- `createLocalAgentRuntime` already has a clean `LocalAgentRuntime` interface, so connect can accept narrow runtime/socket dependencies without changing the CLI surface.
- A conservative next slice is to extract a testable `startConnectAgent` setup function that returns a close handle, keep `runConnect` as the CLI wrapper that installs signals and waits forever, and test connect lifecycle behavior with a fake Socket.IO client and fake runtime.

## 2. Cycle 12 Goal

Cycle 12 should move core connect lifecycle behavior out of integration-only coverage:

1. Add a narrow dependency seam and `startConnectAgent` handle for `connect.ts`.
2. Preserve `runConnect(options)` CLI behavior, including signal shutdown and infinite wait.
3. Add tests for successful machine hello, heartbeat emission, rejected hello reconnect flow, event-store forwarding, and RPC success/error ack behavior.
4. Refresh coverage docs, run targeted tests, perform safety/reverse audits, and pass the full guard gate.

## 3. Non-Goals

- No live relay or real Socket.IO server integration test.
- No changes to relay protocol events or auth payload shape.
- No changes to local runtime business logic.
- No pair command changes beyond continuing to call `runConnect`.
- No Web/mobile/control work.

## 4. Required Reading

- `docs/handoff/CodexNext_TEST_COVERAGE_GAPS.md`
- `docs/handoff/CodexNext_CYCLE11_PHASE1_TO_PHASE5_BACKLOG.md`
- `apps/agent/src/commands/connect.ts`
- `apps/agent/src/commands/pair.ts`
- `apps/agent/src/local-server/local-agent.ts`
- `apps/agent/test/pair-command.test.ts`
- `apps/agent/test/local-server.test.ts`
- `packages/protocol/src/index.ts`

## 5. Backlog

### A. Phase 1 / Phase 5 - Testable Connect Setup

- [x] A1. Extract connect setup into `startConnectAgent(options, dependencies?)`.
  - Reason: connect lifecycle handlers need unit coverage without entering the infinite CLI wait.
  - Acceptance: `startConnectAgent` creates the relay socket, registers handlers, and returns a close handle.

- [x] A2. Add narrow injectable dependencies for socket factory, local runtime factory, identity, Codex version, timers, sleep, active-session count, and output functions.
  - Reason: tests need deterministic fake Socket.IO/runtime behavior without touching device files, real network, timers, or stdout.
  - Acceptance: dependency hooks are source-level only; no new CLI args.

- [x] A3. Keep `runConnect(options)` as the CLI wrapper.
  - Reason: production behavior should remain a long-running relay agent with SIGINT/SIGTERM shutdown.
  - Acceptance: `runConnect` delegates to `startConnectAgent`, installs process signal handlers, and still waits indefinitely.

### B. Phase 1 / Phase 5 - Connect Lifecycle Tests

- [x] B1. Add connect test for successful hello ack, auth payload, ready output, and initial heartbeat.
- [x] B2. Add connect test for rejected hello ack that disconnects, sleeps, refreshes auth, reconnects, and succeeds.
- [x] B3. Add connect test for forwarding local event-store events only while connected.
- [x] B4. Add connect test for `rpc:request` success and error ack responses.
- [x] B5. Add connect close-handle test for stopping heartbeat and closing runtime/socket.

### C. Security / Product Boundary Audit

- [x] C1. Confirm dependency injection is not exposed through CLI args and does not weaken device token handling.
- [x] C2. Confirm tests use dummy in-memory tokens only and do not require live relay/Codex credentials.

### D. Docs, Audit, And Final Gate

- [x] D1. Refresh coverage-gap docs to move connect handshake/reconnect/RPC unit behavior into covered areas and narrow the remaining agent gap to true live Socket.IO integration.
- [x] D2. Run targeted agent typecheck/tests.
- [x] D3. Run marker and token/auth payload audits after code changes.
- [x] D4. Run final verification: `pnpm install`, `pnpm typecheck`, `pnpm test`, `pnpm test:guard`, `pnpm test:winsw`, `pnpm --filter @codexnext/agent dev -- doctor`.
- [x] D5. Run adversarial reverse audit after all checkboxes appear complete.
- [x] D6. Confirm this backlog has zero pending checkbox items and run `node scripts/codexnext-backlog-cycle-guard.mjs complete-cycle`.

## 6. Progress Log

- 2026-06-11T01:43Z
  - Completed: generated Cycle 12 backlog from current repo state after Cycle 11 completion.
  - Evidence read: guard status 11/20 with no active backlog, then active Cycle 12 placeholder; coverage-gap handoff; Cycle 11 backlog/progress; `connect.ts`; `pair.ts`; local runtime interface in `local-agent.ts`; existing pair/local-server test patterns.
  - Current status: active backlog path is `docs/handoff/CodexNext_CYCLE12_PHASE1_TO_PHASE5_BACKLOG.md`; completedCycles 11/20; canContinue true.
- 2026-06-11T01:47Z
  - Completed: A1, A2, A3, B1, B2, B3, B4, B5, D1, and D2.
  - Code: extracted `startConnectAgent(options, dependencies?)` from `runConnect`; added injectable socket/runtime/identity/Codex version/timer/sleep/output dependencies and a close handle while keeping `runConnect(options)` as the signal-handling infinite CLI wrapper.
  - Tests: added fake Socket.IO/runtime coverage for successful hello/auth/heartbeat/ready output, rejected hello reconnect, connected-only event forwarding, RPC success/error acks, and close cleanup.
  - Verification: `pnpm --filter @codexnext/agent typecheck`, `pnpm exec vitest run apps/agent/test/connect-command.test.ts`, and `pnpm exec vitest run apps/agent/test/connect-command.test.ts apps/agent/test/pair-command.test.ts` passed (13 focused command tests).
  - Docs: updated `docs/handoff/CodexNext_TEST_COVERAGE_GAPS.md` to move connect setup/handshake/reconnect/RPC unit behavior into covered areas and narrow the remaining agent gap to true live relay integration.
- 2026-06-11T01:48Z
  - Completed: C1, C2, and D3.
  - Security audit: `apps/agent/src/index.ts` still exposes only the existing connect CLI options and calls `runConnect(options)`; dependency injection is source-level only.
  - Token/auth audit: connect tests use dummy `device-token`, `owner-token`, and relay URL query strings in memory only; they inject identity/socket/runtime and do not read device files or contact a live relay/Codex process.
  - Marker audit: no TODO/FIXME/HACK/PLACEHOLDER markers in touched connect source, connect tests, or Cycle 12 backlog.
- 2026-06-11T01:49Z
  - Completed: D4.
  - Final verification passed: `pnpm install`, `pnpm typecheck`, `pnpm test` (26 files / 214 tests), `pnpm test:guard`, `pnpm test:winsw`, and `pnpm --filter @codexnext/agent dev -- doctor`.
  - Re-ran the same full gate after reverse-audit cleanup edits; it passed again with the same 26 files / 214 tests.
  - Doctor note: the only non-ok diagnostic was the expected local warning that no relay URL was supplied.
- 2026-06-11T01:51Z
  - Completed: D5.
  - Reverse audit: `git diff --check` passed; focused scans confirmed the new dependency seam is only source-level, CLI options remain unchanged, and token/auth strings are dummy test fixtures.
  - Adversarial findings: no must-fix issue found. The remaining agent risk is true live relay/socket compatibility, which is explicitly outside this unit-test cycle.
- 2026-06-11T01:51Z
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
