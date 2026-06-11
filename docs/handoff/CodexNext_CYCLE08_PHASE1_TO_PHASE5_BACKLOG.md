# CodexNext Cycle 08 Phase 1-5 Backlog

## 0. Count Semantics

This is the active Cycle 08 backlog. The cycle count must not increment until every checkbox in this file is complete, final verification passes, reverse audit finds no must-fix issue, and:

```bash
node scripts/codexnext-backlog-cycle-guard.mjs complete-cycle
```

succeeds.

Current count at backlog generation: 7/20.
Deadline: 2026-06-11 05:30 Europe/London.

## 1. Fresh Audit Summary

Cycle 07 completed and counted successfully. Evidence:

- Guard count is now 7/20 and `canContinue` is true.
- Cycle 07 final guard verification passed: `pnpm install`, `pnpm typecheck`, `pnpm test` (23 files / 186 tests), `pnpm test:guard`, `pnpm test:winsw`, and `pnpm --filter @codexnext/agent dev -- doctor`.
- Cycle 07 added method-specific approval response schemas, outbound app-server request parameter schemas, fail-closed approval callback validation, and request validation before JSON-RPC send.

Fresh Cycle 08 findings:

- Server-initiated approval request params are still unvalidated before the approval callback sees them. A malformed server request should not be routed into Web/agent approval handling as if it were trustworthy.
- Goal and turn-start success responses still return directly from JSON-RPC without runtime validation, unlike the thread/history responses hardened in Cycles 06-07.
- The current docs still require Codex to remain the approval/sandbox authority while CodexNext protects the relay/client boundary. The right next slice is to validate inbound approval requests and the remaining stable goal/turn responses, not to add new UI or mobile scaffolding.
- Phase 4 and Phase 5 benefit because future mobile and multi-client flows need deterministic approval request shapes and validated active-turn/goal state.

## 2. Cycle 08 Goal

Cycle 08 should harden the remaining Codex app-server boundary around inbound approval requests and goal/turn success payloads:

1. Add protocol schemas for server-initiated approval request params.
2. Add protocol schemas for thread goal responses and turn-start responses.
3. Make `CodexAppServerClient` validate approval request params before invoking callbacks and validate goal/turn-start responses before returning them.
4. Refresh coverage docs, run targeted tests, perform security/reverse audits, and pass the full guard gate.

## 3. Non-Goals

- No change to Codex approval semantics or permission enforcement.
- No Web UI approval redesign.
- No relay route changes.
- No mobile scaffold.
- No notification payload taxonomy beyond the approval request params covered here.

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
- `docs/handoff/CodexNext_CYCLE07_PHASE1_TO_PHASE5_BACKLOG.md`
- `packages/protocol/src/index.ts`
- `packages/protocol/test/relay-schemas.test.ts`
- `packages/codex-client/src/codex-app-server-client.ts`
- `packages/codex-client/test/codex-app-server-client.test.ts`
- `apps/agent/src/local-server/approval-bridge.ts`
- `apps/agent/src/local-server/session-manager.ts`

## 5. Backlog

### A. Phase 1 - Protocol Schemas

- [x] A1. Add permissive-but-typed schemas for server-initiated approval request params.
  - Cover: modern command execution approval, modern file change approval, legacy exec approval, and legacy apply-patch approval.
  - Reason: inbound approval requests are permission-boundary events and should reject non-object payloads or invalid thread/turn id fields before callbacks see them.
  - Acceptance: schemas allow passthrough app-server fields, validate optional `threadId`/`turnId` string ids, and reject malformed non-object/empty-id fixtures.

- [x] A2. Add response schemas for thread goal set/get/clear and turn start.
  - Reason: goal and turn-start responses are stable enough to validate minimally without blocking app-server passthrough fields.
  - Acceptance: goal responses require valid `ThreadGoal` or nullable goal where applicable; turn-start responses require a turn with a non-empty id.

### B. Phase 1 - Codex App-Server Client Validation

- [x] B1. Validate inbound approval request params before invoking `onApprovalRequest`.
  - Reason: malformed server-initiated approval params should fail closed and should not enter application approval handling.
  - Acceptance: malformed params return the method default decline/denied response and do not call the callback.

- [x] B2. Validate goal and turn-start success responses before returning them.
  - Reason: malformed local app-server state should reject at the client boundary with stable errors.
  - Acceptance: malformed goal/turn-start success payloads reject with `Invalid app-server response: <method>`.

- [x] B3. Add codex-client tests for approval request param validation and goal/turn response validation.
  - Cover: valid approval params reach the callback, invalid approval params fail closed without callback invocation, valid goal/turn responses parse, malformed goal/turn responses reject.

### C. Phase 2 / Phase 4 / Phase 5 Compatibility Audit

- [x] C1. Confirm existing agent approval bridge and session-manager flows remain compatible with validated approval params and goal/turn responses.
  - Verification: targeted agent local-server tests plus codex-client fixtures.

- [x] C2. Confirm the new schemas do not introduce token persistence, direct-mode exposure, or mobile-incompatible request/response divergence.
  - Verification: targeted marker/token scans and docs audit.

### D. Docs, Audit, And Final Gate

- [x] D1. Refresh coverage-gap docs to move approval request params and goal/turn response validation into covered areas.
- [x] D2. Run targeted verification for protocol, codex-client, and affected agent flows.
- [x] D3. Run marker and token-storage audits after code changes.
- [x] D4. Run final verification: `pnpm install`, `pnpm typecheck`, `pnpm test`, `pnpm test:guard`, `pnpm test:winsw`, `pnpm --filter @codexnext/agent dev -- doctor`.
- [x] D5. Run adversarial reverse audit after all checkboxes appear complete.
- [x] D6. Confirm this backlog has zero pending checkbox items and run `node scripts/codexnext-backlog-cycle-guard.mjs complete-cycle`.

## 6. Progress Log

- 2026-06-11T01:01Z
  - Completed: generated Cycle 08 backlog from current repo state after Cycle 07 completion.
  - Evidence read: guard status 7/20 with no active backlog, then active Cycle 08 placeholder; Cycle 07 backlog/progress; coverage-gap handoff; README/roadmap/architecture/security/deployment and Phase 1/4/5 docs from the Cycle 08 audit context; protocol approval/goal/turn interfaces; Codex app-server client approval and goal/turn methods; codex-client tests; agent approval/session manager call sites.
  - Current status: active backlog path is `docs/handoff/CodexNext_CYCLE08_PHASE1_TO_PHASE5_BACKLOG.md`; completedCycles 7/20; canContinue true.
- 2026-06-11T01:03Z
  - Completed: A1-A2.
  - Changes: added server-initiated approval request param schemas with optional id validation and passthrough app-server fields; added goal set/get/clear response schemas and turn-start response schema.
  - Verification: `pnpm --filter @codexnext/protocol typecheck`; `pnpm exec vitest run packages/protocol/test/relay-schemas.test.ts` (1 file / 16 tests).
- 2026-06-11T01:05Z
  - Completed: B1-B3.
  - Changes: `CodexAppServerClient` validates inbound approval request params before invoking callbacks and fails closed without callback execution for malformed params; goal set/get/clear and turn-start success payloads now parse through protocol schemas.
  - Verification: `pnpm --filter @codexnext/codex-client typecheck`; `pnpm exec vitest run packages/codex-client/test/codex-app-server-client.test.ts` (1 file / 12 tests).
- 2026-06-11T01:06Z
  - Completed: C1-C2 and D1-D3.
  - Compatibility: agent approval bridge and session-manager flows still pass with validated approval params and parsed goal/turn responses; Phase 4/5 docs still require shared relay/client boundaries and memory-only relay session tokens.
  - Docs: coverage-gap handoff now records approval request param schemas and goal/turn-start response validation as covered; remaining protocol/client gap is broader app-server notification payload validation.
  - Audit: marker scan found only existing hidden direct-mode documentation/serve/doctor references and prior handoff notes; token-storage scan matched known owner/session/device token surfaces and Web storage allowlist paths, with no Cycle 08 token persistence or new direct-mode path; `git diff --check` passed for the Cycle 08 diff.
  - Verification: protocol typecheck plus relay schema tests; codex-client typecheck plus app-server client tests; agent typecheck plus local-server tests.
- 2026-06-11T01:08Z
  - Completed: D4.
  - Final verification: `pnpm install`; `pnpm typecheck`; `pnpm test` (23 files / 191 tests); `pnpm test:guard`; `pnpm test:winsw`; `pnpm --filter @codexnext/agent dev -- doctor` (relay health warning only because no relay URL was supplied).
  - Reverse-audit adjustment: loosened `TurnSchema.status` and `Turn.status` to string after noticing the stable contract only requires turn id; reran targeted protocol/codex-client/agent checks and the full final verification gate again with the same 23 files / 191 tests result.
- 2026-06-11T01:10Z
  - Completed: D5.
  - Reverse audit: checked approval request validation fails closed before callbacks, goal/turn response parsing uses stable `Invalid app-server response: <method>` errors, `TurnSchema` no longer over-constrains status values, marker/token scans showed no new storage or direct-mode path, and `git diff --check` passed. No must-fix issue found.
- 2026-06-11T01:10Z
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
