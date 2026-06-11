# CodexNext Cycle 11 Phase 1-5 Backlog

## 0. Count Semantics

This is the active Cycle 11 backlog. The cycle count must not increment until every checkbox in this file is complete, final verification passes, reverse audit finds no must-fix issue, and:

```bash
node scripts/codexnext-backlog-cycle-guard.mjs complete-cycle
```

succeeds.

Current count at backlog generation: 10/20.
Deadline: 2026-06-11 05:30 Europe/London.

## 1. Fresh Audit Summary

Cycle 10 completed and counted successfully. Evidence:

- Guard count is now 10/20 and `canContinue` is true.
- Cycle 10 final guard verification passed: `pnpm install`, `pnpm typecheck`, `pnpm test` (25 files / 203 tests), `pnpm test:guard`, `pnpm test:winsw`, and `pnpm --filter @codexnext/agent dev -- doctor`.
- Cycle 10 moved agent pair command create/poll failure paths into covered tests and narrowed the remaining agent gap to live Socket.IO connect behavior.

Fresh Cycle 11 findings:

- `packages/protocol` still exports `AppServerNotification` as an interface with `params?: unknown`, while method constants enumerate known notification names and app/agent consumers branch on those names.
- `packages/codex-client` request/response validation is now broad, but `CodexAppServerClient.onNotification(...)` passes notifications straight through from `JsonRpcClient` without validating even known notification payload envelopes.
- Agent consumers intentionally tolerate extra notification fields and some unknown payload shapes, so notification validation must stay passthrough-friendly and only reject clearly malformed known fields when they are present.
- A conservative next slice is to add protocol schemas for known notification envelopes used by the agent (`thread/status/changed`, goal updates/clears, turn started/completed, text/output/diff/plan deltas) and have `CodexAppServerClient` deliver only parsed known notifications while preserving unknown notification methods.

## 2. Cycle 11 Goal

Cycle 11 should harden app-server notification handling without over-constraining Codex passthrough payloads:

1. Add protocol schemas/helpers for app-server notification envelopes and known notification params.
2. Validate known notifications in `CodexAppServerClient` before invoking global or method-specific notification listeners.
3. Preserve unknown notification method passthrough behavior.
4. Add protocol and codex-client tests for accepted known notifications, rejected malformed known notifications, and unknown-method passthrough.
5. Refresh coverage docs, run targeted tests, perform safety/reverse audits, and pass the full guard gate.

## 3. Non-Goals

- No live Codex app-server fixture.
- No changes to `JsonRpcClient` notification semantics.
- No app/agent event-store refactor.
- No attempt to fully model every possible Codex notification field.
- No Web/mobile work.

## 4. Required Reading

- `docs/handoff/CodexNext_TEST_COVERAGE_GAPS.md`
- `docs/handoff/CodexNext_CYCLE10_PHASE1_TO_PHASE5_BACKLOG.md`
- `packages/protocol/src/index.ts`
- `packages/protocol/test/relay-schemas.test.ts`
- `packages/codex-client/src/codex-app-server-client.ts`
- `packages/codex-client/test/codex-app-server-client.test.ts`
- `packages/codex-client/src/json-rpc.ts`
- `apps/agent/src/local-server/session-manager.ts`
- `apps/agent/src/commands/goal-smoke.ts`

## 5. Backlog

### A. Phase 1 / Phase 5 - Notification Protocol Schemas

- [x] A1. Add base `AppServerNotificationSchema` and exported type alignment.
  - Reason: the notification envelope is currently interface-only.
  - Acceptance: method must be a non-empty string; params remain optional and passthrough-compatible.

- [x] A2. Add known notification params schemas for thread/goal/turn/delta families used by the agent.
  - Reason: consumers already branch on these methods and read fields like `threadId`, `turn.id`, `goal`, `delta`, `deltaBase64`, and `diff`.
  - Acceptance: schemas preserve extra fields, allow omitted optional fields, and reject clearly malformed present fields such as empty IDs or non-string delta fields.

- [x] A3. Add a schema selection helper for known notification methods.
  - Reason: client validation should be method-aware while unknown methods remain passthrough.
  - Acceptance: unknown methods validate only against the base notification envelope.

### B. Phase 1 / Phase 5 - Codex Client Notification Validation

- [x] B1. Wrap `CodexAppServerClient.onNotification(listener)` through notification parsing.
  - Acceptance: valid known notifications and unknown notification methods reach the listener; malformed known notifications do not.

- [x] B2. Wrap `CodexAppServerClient.onNotificationMethod(method, listener)` through the same parsing.
  - Acceptance: method listeners receive parsed params for valid known notifications and are skipped for malformed known notifications.

### C. Tests

- [x] C1. Add protocol tests for known notification schema acceptance and malformed known payload rejection.
- [x] C2. Add codex-client tests for global notification listener validation.
- [x] C3. Add codex-client tests for method-specific notification listener validation and unknown-method passthrough.

### D. Docs, Audit, And Final Gate

- [x] D1. Refresh coverage-gap docs to move common app-server notification envelope validation into covered protocol/codex-client areas.
- [x] D2. Run targeted protocol and codex-client tests.
- [x] D3. Run marker and over-constraint audits after code changes.
- [x] D4. Run final verification: `pnpm install`, `pnpm typecheck`, `pnpm test`, `pnpm test:guard`, `pnpm test:winsw`, `pnpm --filter @codexnext/agent dev -- doctor`.
- [x] D5. Run adversarial reverse audit after all checkboxes appear complete.
- [x] D6. Confirm this backlog has zero pending checkbox items and run `node scripts/codexnext-backlog-cycle-guard.mjs complete-cycle`.

## 6. Progress Log

- 2026-06-11T01:33Z
  - Completed: generated Cycle 11 backlog from current repo state after Cycle 10 completion.
  - Evidence read: guard status 10/20 with no active backlog, then active Cycle 11 placeholder; coverage-gap handoff; Cycle 10 backlog/progress; protocol notification constants and current `AppServerNotification` interface; `CodexAppServerClient` listener methods; `JsonRpcClient` notification emission; agent notification consumers in session manager and goal-smoke.
  - Current status: active backlog path is `docs/handoff/CodexNext_CYCLE11_PHASE1_TO_PHASE5_BACKLOG.md`; completedCycles 10/20; canContinue true.
- 2026-06-11T01:36Z
  - Completed: A1, A2, A3, B1, B2, C1, C2, C3, D1, and D2.
  - Code: added `AppServerNotificationSchema`, known notification params schemas, a method-aware params schema helper, and `parseAppServerNotification` in `packages/protocol`.
  - Code: `CodexAppServerClient` now parses global and method-specific notifications before invoking listeners; valid known notifications and unknown methods pass through, malformed known notifications are skipped.
  - Tests: added protocol fixtures for known notification acceptance, malformed known payload rejection, and unknown-method passthrough; added codex-client listener validation tests.
  - Verification: `pnpm --filter @codexnext/protocol typecheck`, `pnpm --filter @codexnext/codex-client typecheck`, and `pnpm exec vitest run packages/protocol/test/relay-schemas.test.ts packages/codex-client/test/codex-app-server-client.test.ts` passed (2 files / 34 tests).
  - Docs: updated `docs/handoff/CodexNext_TEST_COVERAGE_GAPS.md` to move common notification validation into covered protocol/codex-client areas while keeping uncommon Codex fields passthrough.
- 2026-06-11T01:37Z
  - Completed: D3.
  - Marker audit: no TODO/FIXME/HACK/PLACEHOLDER markers in the touched protocol/client source, tests, or Cycle 11 backlog.
  - Over-constraint audit: notification params schemas use `.passthrough()`, unknown methods have explicit protocol and client passthrough tests, and goal/turn notification objects validate present common fields without requiring full response-shaped payloads.
- 2026-06-11T01:38Z
  - Completed: D4.
  - Final verification passed: `pnpm install`, `pnpm typecheck`, `pnpm test` (25 files / 209 tests), `pnpm test:guard`, `pnpm test:winsw`, and `pnpm --filter @codexnext/agent dev -- doctor`.
  - Doctor note: the only non-ok diagnostic was the expected local warning that no relay URL was supplied.
- 2026-06-11T01:39Z
  - Completed: D5.
  - Reverse audit: `git diff --check` passed; focused reads of the notification parser, client listener wrappers, protocol fixtures, and untracked codex-client notification tests found no must-fix issue.
  - Adversarial findings: known notification parsing is scoped to `CodexAppServerClient`, malformed known notifications are skipped before app listeners, unknown notification methods remain passthrough, and notification schemas intentionally avoid full response-shape requirements for goal/turn payloads.
- 2026-06-11T01:39Z
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
