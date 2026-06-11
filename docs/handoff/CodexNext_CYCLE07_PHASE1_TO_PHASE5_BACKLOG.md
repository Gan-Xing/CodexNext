# CodexNext Cycle 07 Phase 1-5 Backlog

## 0. Count Semantics

This is the active Cycle 07 backlog. The cycle count must not increment until every checkbox in this file is complete, final verification passes, reverse audit finds no must-fix issue, and:

```bash
node scripts/codexnext-backlog-cycle-guard.mjs complete-cycle
```

succeeds.

Current count at backlog generation: 6/20.
Deadline: 2026-06-11 05:30 Europe/London.

## 1. Fresh Audit Summary

Cycle 06 completed and counted successfully. Evidence:

- Guard count is now 6/20 and `canContinue` is true.
- Cycle 06 final guard verification passed: `pnpm install`, `pnpm typecheck`, `pnpm test` (23 files / 180 tests), `pnpm test:guard`, `pnpm test:winsw`, and `pnpm --filter @codexnext/agent dev -- doctor`.
- Cycle 06 added lower-level Codex app-server thread response schemas, `CodexAppServerClient` thread response validation, and direct stdio transport lifecycle fixtures.

Fresh Cycle 07 findings:

- `packages/protocol` still defines approval callback responses as TypeScript-only unions. Runtime code cannot distinguish valid modern command, modern file, and legacy approval responses.
- `CodexAppServerClient` currently forwards any `onApprovalRequest` result to Codex. A malformed callback can produce an invalid JSON-RPC success response, and a throwing callback becomes a JSON-RPC handler failure instead of a safe denial.
- App-server request parameter types remain mostly interface-only. Wrapper methods can still send malformed method params to Codex app-server before local validation catches them.
- The project docs continue to require relay-only product usage while preserving Codex as the final approval/sandbox authority. The correct next slice is therefore boundary validation in protocol and codex-client, not Web UI expansion or mobile scaffold work.
- Phase 4 and Phase 5 benefit indirectly: future mobile and multi-client adapters need the same fail-closed approval semantics and stable app-server request contracts that Web/agent use today.

## 2. Cycle 07 Goal

Cycle 07 should harden the Codex app-server client boundary:

1. Add runtime protocol schemas for approval responses and app-server request parameters.
2. Validate outbound `CodexAppServerClient` request params before sending JSON-RPC messages.
3. Validate approval callback responses method-by-method and fail closed on malformed or throwing callbacks.
4. Refresh coverage docs, run targeted tests, perform security/reverse audits, and pass the full guard gate.

## 3. Non-Goals

- No change to Codex approval semantics or permission enforcement.
- No Web UI redesign or approval UX expansion.
- No relay route changes unless type alignment requires it.
- No mobile scaffold.
- No process-manager or deployment-template changes.

## 4. Required Reading

- `README.md`
- `docs/ROADMAP.md`
- `docs/ARCHITECTURE.md`
- `docs/SECURITY.md`
- `docs/RELAY_DEPLOYMENT.md`
- `docs/PHASE1_FOUNDATION_CONTRACT.md`
- `docs/PHASE4_MOBILE_CLIENT_BASELINE.md`
- `docs/PHASE5_MULTI_DEVICE_RELIABILITY.md`
- `docs/handoff/CodexNext_BACKLOG_CYCLE_LOG.md`
- `docs/handoff/CodexNext_TEST_COVERAGE_GAPS.md`
- `docs/handoff/CodexNext_CYCLE06_PHASE1_TO_PHASE5_BACKLOG.md`
- `packages/protocol/src/index.ts`
- `packages/protocol/test/relay-schemas.test.ts`
- `packages/codex-client/src/codex-app-server-client.ts`
- `packages/codex-client/test/codex-app-server-client.test.ts`

## 5. Backlog

### A. Phase 1 - Protocol Boundary Schemas

- [x] A1. Add Zod schemas for modern command approval, modern file approval, legacy approval, and the shared approval response union.
  - Reason: approval callback handling is a permission boundary and cannot remain interface-only.
  - Modules: `packages/protocol/src/index.ts`, `packages/protocol/test/relay-schemas.test.ts`.
  - Verification: valid enum decisions and structured command/legacy decisions parse; malformed decisions reject.

- [x] A2. Add Zod schemas for outbound app-server request params used by `CodexAppServerClient`.
  - Cover: initialize, thread start/resume/archive/unarchive/list/loaded/read/turns, goal set/get/clear, turn start/steer/interrupt.
  - Reason: request parameter validation is the remaining app-server protocol gap after Cycle 06 response validation.
  - Acceptance: schemas reject empty required ids, invalid enum values, non-positive limits, and malformed user input arrays without stripping supported passthrough config objects.

### B. Phase 1 - Codex App-Server Client Hardening

- [x] B1. Validate outbound wrapper method params before sending JSON-RPC.
  - Reason: malformed local adapter state should fail locally with a stable error instead of reaching Codex app-server.
  - Acceptance: invalid params reject with `Invalid app-server request params: <method>` and do not enqueue a JSON-RPC request.

- [x] B2. Validate approval callback results method-by-method and fail closed.
  - Reason: approvals must never become malformed positive responses through callback bugs.
  - Acceptance: invalid, undefined, throwing, or rejected callbacks return `{ decision: "decline" }` for modern approvals and `{ decision: "denied" }` for legacy approvals.

- [x] B3. Add codex-client tests for request validation and approval callback edge cases.
  - Cover: invalid thread/read/turn params are rejected before send, valid params still send, invalid modern callback falls back to decline, invalid legacy callback falls back to denied, throwing async callback falls back to decline.

### C. Phase 2 / Phase 4 / Phase 5 Compatibility Audit

- [x] C1. Confirm existing agent/Web relay approval flows still map user decisions to the Codex response shapes accepted by the new schemas.
  - Reason: Web and future mobile clients use local approval decisions, but Codex app-server receives method-specific approval responses.
  - Verification: targeted existing agent approval tests plus protocol schema fixtures.

- [x] C2. Confirm the new request validation does not break current agent history/session/goal flows.
  - Reason: `apps/agent` is the consumer that connects relay actions to `CodexAppServerClient`.
  - Verification: targeted agent local-server tests or full test suite.

### D. Docs, Audit, And Final Gate

- [x] D1. Refresh coverage-gap docs to move approval callback edge cases and app-server request parameter validation into covered areas.
- [x] D2. Run marker and token-storage audits after code changes.
- [x] D3. Run targeted verification for protocol, codex-client, and affected agent flows.
- [x] D4. Run final verification: `pnpm install`, `pnpm typecheck`, `pnpm test`, `pnpm test:guard`, `pnpm test:winsw`, `pnpm --filter @codexnext/agent dev -- doctor`.
- [x] D5. Run adversarial reverse audit after all checkboxes appear complete.
- [x] D6. Confirm this backlog has zero pending checkbox items and run `node scripts/codexnext-backlog-cycle-guard.mjs complete-cycle`.

## 6. Progress Log

- 2026-06-11T00:48Z
  - Completed: generated Cycle 07 backlog from current repo state after Cycle 06 completion.
  - Evidence read: guard status 6/20 with active Cycle 07 placeholder; Cycle 06 backlog/progress; coverage-gap handoff; README; ROADMAP; ARCHITECTURE; SECURITY; RELAY_DEPLOYMENT; Phase 1/4/5 docs; protocol approval/app-server interfaces; Codex app-server client approval and request methods; codex-client approval tests.
  - Current status: active backlog path is `docs/handoff/CodexNext_CYCLE07_PHASE1_TO_PHASE5_BACKLOG.md`; completedCycles 6/20; canContinue true.
- 2026-06-11T00:54Z
  - Completed: A1-A2.
  - Changes: added shared JSON value/object schemas, method-specific approval response schemas, app-server request parameter schemas for initialize/thread/history/goal/turn methods, and protocol fixtures for valid plus malformed approval/param payloads.
  - Verification: `pnpm --filter @codexnext/protocol typecheck`; `pnpm exec vitest run packages/protocol/test/relay-schemas.test.ts` (1 file / 14 tests).
- 2026-06-11T00:57Z
  - Completed: B1-B3.
  - Changes: `CodexAppServerClient` validates outbound params before sending JSON-RPC; invalid params reject with `Invalid app-server request params: <method>` and leave the transport untouched; approval callbacks are validated per method and fall back to decline/denied on malformed, undefined, thrown, or rejected callback results.
  - Verification: `pnpm --filter @codexnext/codex-client typecheck`; `pnpm exec vitest run packages/codex-client/test/codex-app-server-client.test.ts` (1 file / 9 tests).
- 2026-06-11T00:57Z
  - Completed: C1-C2.
  - Compatibility: existing agent approval bridge mapping still returns schema-valid modern and legacy Codex approval responses; agent session/history/goal/turn flows remain compatible with the app-server client contract.
  - Verification: `pnpm --filter @codexnext/agent typecheck`; `pnpm exec vitest run apps/agent/test/local-server.test.ts` (1 file / 23 tests).
- 2026-06-11T00:58Z
  - Completed: D1.
  - Changes: coverage-gap handoff now records protocol approval response schemas, app-server request parameter schemas, codex-client outbound request validation, and approval callback fail-closed handling as covered; remaining gaps are narrowed to server-initiated approval request params, broader notification payloads, and future goal/turn response validation.
- 2026-06-11T00:59Z
  - Completed: D2-D3.
  - Audit: marker scan found only existing hidden direct-mode documentation/serve/doctor references and prior handoff notes; token-storage scan matched the known owner/session/device token surfaces and Web storage allowlist paths, with no Cycle 07 protocol/client token persistence or new direct-mode path.
  - Verification: protocol typecheck plus relay schema tests; codex-client typecheck plus app-server client tests; agent typecheck plus local-server tests; `git diff --check` passed for the Cycle 07 diff.
- 2026-06-11T01:00Z
  - Completed: D4.
  - Final verification: `pnpm install`; `pnpm typecheck`; `pnpm test` (23 files / 186 tests); `pnpm test:guard`; `pnpm test:winsw`; `pnpm --filter @codexnext/agent dev -- doctor` (relay health warning only because no relay URL was supplied).
- 2026-06-11T01:00Z
  - Completed: D5.
  - Reverse audit: checked app-server validation strictness against real agent `makeTextInput` call sites, verified approval fallback is method-specific and fail-closed, confirmed the bare text-input fixture is history data in a fake test client rather than a runtime request, and reran `git diff --check` for the Cycle 07 diff. No must-fix issue found.
- 2026-06-11T01:00Z
  - Completed: D6 preflight.
  - Guard status reported 12/13 complete before marking this row, `canContinue: true`, and no stop reasons. Next command: `node scripts/codexnext-backlog-cycle-guard.mjs complete-cycle`.

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
