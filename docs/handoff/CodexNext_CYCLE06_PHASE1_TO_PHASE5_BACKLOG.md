# CodexNext Cycle 06 Phase 1-5 Backlog

## 0. Count Semantics

This is the active Cycle 06 backlog. The cycle count must not increment until every checkbox in this file is complete, final verification passes, reverse audit finds no must-fix issue, and:

```bash
node scripts/codexnext-backlog-cycle-guard.mjs complete-cycle
```

succeeds.

Current count at backlog generation: 5/20.
Deadline: 2026-06-11 05:30 Europe/London.

## 1. Fresh Audit Summary

Cycle 05 completed and counted successfully. Evidence:

- Guard count is now 5/20 and `canContinue` is true.
- Cycle 05 final guard verification passed: `pnpm install`, `pnpm typecheck`, `pnpm test` (22 files / 173 tests), `pnpm test:guard`, `pnpm test:winsw`, and `pnpm --filter @codexnext/agent dev -- doctor`.
- Cycle 05 added Codex history response schemas/parsers/builders, Web history API parser usage, and control history RPC validation before cache mutation.

Fresh Cycle 06 findings:

- `packages/protocol` still leaves lower-level Codex app-server thread list/read/turn responses as interface-only.
- `packages/codex-client` returns typed app-server thread responses directly from JSON-RPC without runtime validation.
- `StdioCodexTransport` has no direct lifecycle tests for stderr forwarding, invalid stdout JSON, or close escalation behavior.
- Agent history code consumes `CodexAppServerClient`, so client-side app-server validation improves Phase 1 and Phase 5 reliability without changing relay routes.
- Coverage-gap docs now identify lower-level app-server schemas and stdio lifecycle fixtures as the next concrete gaps.

## 2. Cycle 06 Goal

Cycle 06 should harden the local Codex app-server boundary:

1. Add protocol schemas for lower-level app-server thread list/read/turn/archive responses.
2. Make `CodexAppServerClient` validate app-server thread response payloads before returning them.
3. Add stdio transport lifecycle tests for process stderr, invalid stdout JSON, and close behavior.
4. Refresh coverage docs and run the full expanded guard gate.

## 3. Non-Goals

- No app-server protocol redesign.
- No relay route changes unless required by type alignment.
- No mobile scaffold.
- No Web UI changes.
- No process-manager/service changes.

## 4. Backlog

### A. Phase 1 - App-Server Protocol Schemas

- [x] A1. Add Zod schemas and fixture tests for `CodexThread`, `CodexThreadTurn`, thread list, loaded list, read, turns list, archive, and unarchive responses.
  - Reason: these are the raw app-server shapes that feed local history and relay history.
  - Modules: `packages/protocol/src/index.ts`, `packages/protocol/test/relay-schemas.test.ts`.

- [x] A2. Add response schemas for thread start/resume where they can be validated without over-constraining app-server passthrough fields.
  - Reason: resume responses carry initial turns pages used by agent history resume.
  - Verification: protocol typecheck and schema fixtures.

### B. Phase 1/2 - Codex App-Server Client Validation

- [x] B1. Update `CodexAppServerClient` thread methods to parse app-server responses through protocol schemas.
  - Cover: start, resume, archive, unarchive, list, loaded list, read, and turns list.
  - Acceptance: malformed JSON-RPC success payloads reject with stable `Invalid app-server response: <method>` errors.

- [x] B2. Add codex-client tests for valid parsing and malformed app-server success responses.
  - Verification: codex-client typecheck and targeted tests.

### C. Phase 5 - Stdio Transport Lifecycle Fixtures

- [x] C1. Add direct `StdioCodexTransport` tests for valid stdout message parsing, invalid stdout JSON error emission, and stderr forwarding when configured.
- [x] C2. Add a close lifecycle test proving `close()` resolves for a child process that does not exit immediately.
  - Reason: process lifecycle failures are a current coverage gap.
  - Verification: codex-client tests.

### D. Docs, Audit, And Final Gate

- [x] D1. Refresh coverage-gap docs to remove lower-level app-server schemas and stdio lifecycle tests from remaining gaps.
- [x] D2. Re-run marker and token storage audits after code changes.
- [x] D3. Run targeted verification for all Cycle 06 changes.
- [x] D4. Run final verification: `pnpm install`, `pnpm typecheck`, `pnpm test`, `pnpm test:guard`, `pnpm test:winsw`, `pnpm --filter @codexnext/agent dev -- doctor`.
- [x] D5. Run adversarial reverse audit after all checkboxes appear complete.
- [x] D6. Confirm this backlog has zero pending checkbox items and run `node scripts/codexnext-backlog-cycle-guard.mjs complete-cycle`.

## 5. Progress Log

- 2026-06-11T00:42Z
  - Completed: generated Cycle 06 backlog from current repo state after Cycle 05 completion.
  - Evidence read: guard status 5/20 with active Cycle 06 placeholder; Cycle 05 backlog/progress; coverage-gap handoff; protocol app-server thread interfaces; Codex app-server client methods; stdio transport implementation; codex-client tests.
  - Current status: active backlog path is `docs/handoff/CodexNext_CYCLE06_PHASE1_TO_PHASE5_BACKLOG.md`; completedCycles 5/20; canContinue true.
- 2026-06-11T00:42Z
  - Completed: A1-A2.
  - Changes: added permissive lower-level Codex app-server schemas for thread start/resume, archive/unarchive, thread items, turns, threads, list, loaded list, read, and turns list responses with valid/malformed fixtures.
  - Verification: `pnpm --filter @codexnext/protocol typecheck`; `pnpm exec vitest run packages/protocol/test/relay-schemas.test.ts` (1 file / 12 tests).
- 2026-06-11T00:43Z
  - Completed: B1-B2.
  - Changes: `CodexAppServerClient` now validates thread start/resume/archive/unarchive/list/loaded/read/turns JSON-RPC success payloads through protocol schemas; malformed success payloads reject with `Invalid app-server response: <method>`.
  - Verification: `pnpm --filter @codexnext/codex-client typecheck`; `pnpm exec vitest run packages/codex-client/test/codex-app-server-client.test.ts` (1 file / 5 tests).
- 2026-06-11T00:44Z
  - Completed: C1-C2.
  - Changes: added direct `StdioCodexTransport` lifecycle tests for stdout JSON parsing, stderr forwarding, invalid stdout JSON errors, and closing a child process that does not exit immediately.
  - Verification: `pnpm --filter @codexnext/codex-client typecheck`; `pnpm exec vitest run packages/codex-client/test/codex-app-server-client.test.ts packages/codex-client/test/stdio-transport.test.ts` (2 files / 8 tests).
- 2026-06-11T00:44Z
  - Completed: D1.
  - Changes: coverage-gap handoff now records lower-level app-server response schemas, Codex app-server client validation, and stdio lifecycle fixtures as covered; remaining gaps now focus on request parameter schemas and approval callback edges.
- 2026-06-11T00:45Z
  - Completed: D2-D3.
  - Audit: marker scan found no TODO/FIXME/HACK hits in audited app/package/script/doc paths; token-storage scan only matched saved-device metadata migration/tests, which strip token-like fields and do not persist owner, browser session, or device tokens.
  - Verification: protocol typecheck plus relay schema tests; codex-client typecheck plus app-server client/stdio transport tests; `pnpm test:guard`; `pnpm test:winsw`.
- 2026-06-11T00:46Z
  - Completed: D4.
  - Verification: `pnpm install`; `pnpm typecheck`; `pnpm test` (23 files / 180 tests); `pnpm test:guard`; `pnpm test:winsw`; `pnpm --filter @codexnext/agent dev -- doctor` (relay health warning only because no relay URL was supplied).
- 2026-06-11T00:46Z
  - Completed: D5-D6 preflight.
  - Reverse audit: `git diff --check` passed; guard status reported 10/12 complete before marking D5-D6 and `canContinue: true`; no pending implementation checkboxes remained outside the final audit rows.
  - Next command: `node scripts/codexnext-backlog-cycle-guard.mjs complete-cycle`.

## 6. Final Verification Commands

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
