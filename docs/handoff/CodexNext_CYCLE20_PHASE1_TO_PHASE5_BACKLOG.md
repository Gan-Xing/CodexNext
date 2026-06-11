# CodexNext Cycle 20 Phase 1-5 Backlog

## 0. Count Semantics

This is the active Cycle 20 backlog. The cycle count must not increment until every checkbox in this file is complete, final verification passes, reverse audit finds no must-fix issue, and:

```bash
node scripts/codexnext-backlog-cycle-guard.mjs complete-cycle
```

succeeds.

Current count at backlog generation: 19/20.
Deadline: 2026-06-11 05:30 Europe/London.

## 1. Fresh Audit Summary

Cycle 19 completed and counted successfully. Evidence:

- Guard count is now 19/20 and `canContinue` is true.
- Cycle 19 final guard verification passed inside `complete-cycle`: `pnpm install`, `pnpm typecheck`, `pnpm test` (29 files / 233 tests), `pnpm test:guard`, `pnpm test:winsw`, and `pnpm --filter @codexnext/agent dev -- doctor`.
- Cycle 19 extracted pairing route registration into `apps/control/src/pairing-routes.ts` and added invalid pairing payload coverage.

Fresh Cycle 20 findings:

- `docs/handoff/CodexNext_TEST_COVERAGE_GAPS.md` now lists relay RPC route registration as the main remaining control route-group extraction.
- `apps/control/src/server.ts` still registers relay RPC HTTP routes inline for health, sessions, session messages, goals, interrupt, approvals, directories, Codex history list/detail/loaded/turns/archive/resume, and device event replay.
- Existing integration tests cover RPC validation errors, stale approval decisions, loaded-thread validation and state mutation, history turn cache hits/malformed results/archive invalidation/resume cache writes, full-access policy denial, and in-flight RPC behavior during revoke.

## 2. Cycle 20 Goal

Cycle 20 should extract relay device/event and relay RPC route registration out of `server.ts`:

1. Create a dedicated control relay route registration module for `/api/relay/devices/:deviceId/events` and the relay RPC HTTP routes.
2. Move shared relay route helpers with that module where appropriate: machine RPC invocation, generic RPC request handling, full-access request detection, approval-decision audit metadata, and RPC error replies.
3. Keep the `devices` map, device event stores, loaded-thread sets, recent history cache storage, audit logger, owner access guard, and policy settings owned by `createControlServer` and pass them into the route module.
4. Preserve Codex history cache behavior for loaded, turns, archive, resume, and machine event cache invalidation.
5. Refresh coverage docs, run targeted tests, perform security/reverse audits, and pass the full guard gate.

## 3. Non-Goals

- No relay protocol shape changes.
- No RPC timeout policy changes.
- No full-access operator policy changes.
- No Socket.IO machine/user namespace behavior changes.
- No Web UI or agent command changes.

## 4. Required Reading

- `docs/handoff/CodexNext_TEST_COVERAGE_GAPS.md`
- `docs/handoff/CodexNext_CYCLE19_PHASE1_TO_PHASE5_BACKLOG.md`
- `apps/control/src/server.ts`
- `apps/control/src/relay-rpc.ts`
- `apps/control/test/control-server.test.ts`
- `apps/control/test/relay-rpc-error.test.ts`

## 5. Backlog

### A. Phase 1 / Phase 5 - Relay Route Group Extraction

- [x] A1. Create a dedicated control relay route registration module.
  - Acceptance: module registers device event replay plus relay RPC routes for health, sessions, messages, goals, interrupt, approvals, directories, and Codex history.

- [x] A2. Update `server.ts` to call the relay route registration module and remove inline relay HTTP route handlers and relay route-only helpers.
  - Acceptance: `server.ts` retains device state, socket lifecycle, pruning, and cache storage while route code moves out.

### B. Tests

- [x] B1. Add focused integration coverage for a special Codex history relay route that mutates server-owned state after extraction.
- [x] B2. Run existing control integration tests that cover RPC validation errors, approval stale decisions, cache hits, malformed history results, archive invalidation, resume cache writes, full-access denial, and in-flight revoke behavior.

### C. Security / Product Boundary Audit

- [x] C1. Confirm relay full-access denial still happens before machine RPC invocation and logs only method/reason.
- [x] C2. Confirm relay RPC failure audit metadata remains method/device/reason based and does not log prompts, commands, outputs, tokens, or raw request bodies.

### D. Docs, Audit, And Final Gate

- [x] D1. Refresh coverage-gap docs to record relay route registration extraction and update remaining large-file risk.
- [x] D2. Run targeted control typecheck/tests.
- [x] D3. Run marker, relay-route, and audit/body-token scans after code changes.
- [x] D4. Run final verification: `pnpm install`, `pnpm typecheck`, `pnpm test`, `pnpm test:guard`, `pnpm test:winsw`, `pnpm --filter @codexnext/agent dev -- doctor`.
- [x] D5. Run adversarial reverse audit after all checkboxes appear complete.
- [x] D6. Confirm this backlog has zero pending checkbox items and run `node scripts/codexnext-backlog-cycle-guard.mjs complete-cycle`.

## 6. Progress Log

- 2026-06-11T02:50Z
  - Completed: replaced generated Cycle 20 placeholder with a fresh audited backlog after Cycle 19 counted successfully.
  - Evidence read: guard status 19/20 with no active backlog; coverage-gap handoff; Cycle 19 backlog/progress; inline relay route registration span in `server.ts`; relay RPC helper module; control relay integration tests.
  - Current status: active backlog path is `docs/handoff/CodexNext_CYCLE20_PHASE1_TO_PHASE5_BACKLOG.md`; completedCycles 19/20; canContinue true.
- 2026-06-11T02:57Z
  - Completed: added `apps/control/src/device-state.ts` and `apps/control/src/relay-routes.ts`, then updated `apps/control/src/server.ts` to call `registerRelayRoutes`.
  - Completed: moved relay route registration, machine RPC invocation, generic RPC handling, full-access detection, approval-decision audit metadata, and RPC error replies out of `server.ts`.
  - Completed: kept `devices`, socket lifecycle, pruning, loaded-thread sets, recent-history cache storage, and cache callbacks owned by `createControlServer`.
  - Tests: added resume-cache integration coverage proving `/codex-history/resume` writes a page served by a subsequent `/codex-history/turns` request without another machine RPC.
  - Verification: `pnpm --filter @codexnext/control typecheck` passed; `pnpm exec vitest run apps/control/test/control-server.test.ts apps/control/test/relay-rpc-error.test.ts` passed with 2 files / 62 tests.
  - Audit: marker scan was clean; relay-route scan found `/api/relay` handlers only in `relay-routes.ts` with `server.ts` limited to the registration call; audit/body-token scan shows denial and failure audit writes remain method/reason/device scoped and do not include raw request bodies.
  - Docs: refreshed `docs/handoff/CodexNext_TEST_COVERAGE_GAPS.md` to record relay route extraction and narrow remaining control-server risk to socket lifecycle and state/cache ownership.
- 2026-06-11T02:59Z
  - Final verification: `pnpm install` passed; `pnpm typecheck` passed; `pnpm test` passed with 29 files / 234 tests; `pnpm test:guard` passed; `pnpm test:winsw` validated 3 templates; `pnpm --filter @codexnext/agent dev -- doctor` passed local diagnostics with only the expected no-relay-URL health probe warning.
- 2026-06-11T03:00Z
  - Reverse audit: `git diff --check` passed; pending-checkbox scan showed only D5/D6 before marking D5; marker scan was clean.
  - Route audit: focused scan found `/api/relay` route registrations and relay helper functions only in `apps/control/src/relay-routes.ts`; `apps/control/src/server.ts` is limited to importing/calling `registerRelayRoutes`.
  - Security audit: denial paths still log `relay_full_access_disabled` before machine RPC invocation; relay RPC failure audit writes remain method/device/reason based, while request bodies are only forwarded as RPC params.
- 2026-06-11T03:00Z
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
