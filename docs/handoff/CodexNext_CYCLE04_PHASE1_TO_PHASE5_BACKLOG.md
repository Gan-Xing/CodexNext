# CodexNext Cycle 04 Phase 1-5 Backlog

## 0. Count Semantics

This is the active Cycle 04 backlog. The cycle count must not increment until every checkbox in this file is complete, final verification passes, reverse audit finds no must-fix issue, and:

```bash
node scripts/codexnext-backlog-cycle-guard.mjs complete-cycle
```

succeeds.

Current count at backlog generation: 3/20.
Deadline: 2026-06-11 05:30 Europe/London.

## 1. Fresh Audit Summary

Cycle 03 completed and counted successfully. Evidence:

- Guard count is now 3/20 and `canContinue` is true.
- Cycle 03 final guard verification passed: `pnpm install`, `pnpm typecheck`, `pnpm test` (22 files / 159 tests), and `pnpm --filter @codexnext/agent dev -- doctor`.
- Manual Cycle 03 final gate also ran `pnpm test:guard` and `pnpm test:winsw`.
- Cycle 03 added runtime schemas for relay device/presence/machine/RPC payloads, Web presence merge helpers, control multi-client hardening tests, shared URL helpers across core relay routes, and WinSW templates plus validation.

Fresh Cycle 04 findings:

- Web and future mobile clients still mostly trust relay JSON through TypeScript casts in `apps/web/src/lib/api.ts`; shared runtime parsing exists for some protocol payloads but not core local response payloads.
- `packages/protocol` has schemas for request inputs and relay envelopes, but not for `LocalSessionSummary`, local health, session list/create, message/interrupt responses, replay responses, or sidebar prefs.
- `packages/relay-client` owns URL/auth/replay semantics, but not response parsing for mobile-critical HTTP responses.
- Control forwards successful machine RPC results without route-specific result validation, so malformed machine payloads can cross the relay boundary as success.
- `scripts/codexnext-backlog-cycle-guard.mjs complete-cycle` still does not run `pnpm test:guard` or `pnpm test:winsw`; Cycle 03 had to run those manually before the guard.
- `docs/PHASE4_MOBILE_CLIENT_BASELINE.md` still says Cycle 03 may add `apps/mobile`; after Cycles 03-04, the more accurate next step is shared runtime parsing before a scaffold.
- `docs/handoff/CodexNext_TEST_COVERAGE_GAPS.md` is stale and still lists gaps closed by Cycles 02 and 03.

## 2. Cycle 04 Goal

Cycle 04 should harden the runtime contracts that Web and a future mobile scaffold will share:

1. Add protocol schemas for core local relay response payloads.
2. Add shared relay-client parsers that reject malformed responses without leaking token values.
3. Make Web API calls use those parsers on mobile-critical routes.
4. Make control reject malformed successful machine RPC results on core routes.
5. Fold guard smoke and WinSW validation into the cycle guard's verification set.
6. Refresh Phase 4 and coverage-gap docs to match the current implementation.

## 3. Non-Goals

- No `apps/mobile` scaffold until runtime parsing is shared and a framework decision is explicit.
- No OAuth/passkeys.
- No database migration.
- No end-to-end encryption.
- No large route split of `apps/control/src/server.ts`.
- No full schema coverage for Codex history pagination in this cycle.
- No Web UI redesign.

## 4. Required Reading

```txt
docs/ROADMAP.md
docs/ARCHITECTURE.md
docs/PHASE4_MOBILE_CLIENT_BASELINE.md
docs/PHASE5_MULTI_DEVICE_RELIABILITY.md
docs/handoff/CodexNext_TEST_COVERAGE_GAPS.md
docs/handoff/CodexNext_CYCLE03_PHASE1_TO_PHASE5_BACKLOG.md

packages/protocol/src/index.ts
packages/protocol/test/relay-schemas.test.ts
packages/relay-client/src/index.ts
packages/relay-client/test/relay-client.test.ts

apps/web/src/lib/api.ts
apps/web/src/lib/api.test.ts
apps/web/src/lib/types.ts
apps/web/src/features/console/use-web-console-controller.ts

apps/control/src/server.ts
apps/control/test/control-server.test.ts
apps/control/test/relay-rpc-error.test.ts

scripts/codexnext-backlog-cycle-guard.mjs
scripts/test-codexnext-backlog-cycle-guard.mjs
scripts/test-winsw-templates.mjs
```

## 5. Backlog

### A. Phase 1 - Protocol Response Schemas

- [x] A1. Add enum/helper Zod schemas for local session status, permission mode, approval policy, approvals reviewer, sandbox mode, reasoning effort, and thread goal.
  - Reason: `LocalSessionSummary` depends on these unions but only request inputs currently validate them.
  - Modules: `packages/protocol/src/index.ts`, `packages/protocol/test/relay-schemas.test.ts`.
  - Verification: protocol typecheck and relay schema tests.

- [x] A2. Add Zod schemas and fixture tests for `LocalSessionSummary`, session list/create responses, local health response, send-message response, interrupt response, event replay response, and sidebar prefs response.
  - Reason: these are Phase 4 mobile-critical response payloads and should be runtime contracts, not casts.
  - Modules: `packages/protocol`.
  - Verification: accepted fixtures and rejected malformed fixtures.

### B. Phase 4 - Shared Relay Client Parsers

- [x] B1. Add relay-client parse helpers for device list, sidebar prefs, health, replay, session list/create, send-message, and interrupt responses.
  - Reason: Web and mobile should share response parsing just as they now share URL/auth/replay helpers.
  - Modules: `packages/relay-client/src/index.ts`.
  - Acceptance: helpers return typed payloads and throw stable `Invalid relay response: <name>` errors without embedding raw payloads or tokens.

- [x] B2. Extend relay-client tests with valid fixtures and malformed response fixtures for each parser.
  - Reason: parser behavior must be contract-tested before Web starts relying on it.
  - Verification: relay-client typecheck and tests.

### C. Phase 2 - Web API Parsing Boundary

- [x] C1. Update `apps/web/src/lib/api.ts` to parse mobile-critical relay responses through `@codexnext/relay-client`.
  - Cover: `listRelayDevices`, `getRelaySidebarPrefs`, `updateRelaySidebarPrefs`, `health`, `replayEvents`, `listSessions`, `createSession`, `sendSessionMessage`, and `interruptSessionTurn`.
  - Acceptance: malformed successful JSON rejects before controller state mutation.

- [x] C2. Add Web API tests for parser use and invalid relay responses.
  - Reason: URL mapping is covered; response trust is not.
  - Verification: web typecheck and API tests.

### D. Phase 3 - Control RPC Result Validation

- [x] D1. Validate successful machine RPC results for core routes before returning them to browser/mobile clients.
  - Cover: health, sessions list/create, session message, turn interrupt, and event replay if applicable.
  - Reason: a connected machine should not be able to send malformed success payloads across the relay boundary.
  - Modules: `apps/control/src/server.ts`.

- [x] D2. Add control tests for malformed successful machine RPC results and stable error classification.
  - Acceptance: malformed core RPC success returns a deterministic upstream protocol error status and audit failure reason; valid fixtures still pass.
  - Verification: control typecheck and targeted control tests.

### E. Phase 5 - Guard And Reliability Process

- [x] E1. Extend `complete-cycle` and `validate-complete` verification to include `pnpm test:guard` and `pnpm test:winsw`.
  - Reason: Cycle 03 introduced required guard and WinSW checks, but the guard itself still does not enforce them.
  - Modules: `scripts/codexnext-backlog-cycle-guard.mjs`.

- [x] E2. Update guard smoke tests to assert the expanded verification command set without running the full project gate.
  - Reason: the guard test should catch accidental removal of these commands.
  - Modules: `scripts/test-codexnext-backlog-cycle-guard.mjs`.
  - Verification: `pnpm test:guard`.

### F. Docs, Audit, And Final Gate

- [x] F1. Update Phase 4 docs to say the next scaffold step is shared runtime response parsing plus framework decision, not a Cycle 03 mobile placeholder.
- [x] F2. Refresh `docs/handoff/CodexNext_TEST_COVERAGE_GAPS.md` to remove gaps closed by Cycles 02-03 and add remaining Cycle 04-adjacent gaps.
- [x] F3. Re-run marker and token storage audits after code changes.
- [x] F4. Run targeted verification for all Cycle 04 changes.
- [x] F5. Run final verification: `pnpm install`, `pnpm typecheck`, `pnpm test`, `pnpm test:guard`, `pnpm test:winsw`, `pnpm --filter @codexnext/agent dev -- doctor`.
- [x] F6. Run adversarial reverse audit after all checkboxes appear complete.
- [x] F7. Confirm this backlog has zero pending checkbox items and run `node scripts/codexnext-backlog-cycle-guard.mjs complete-cycle`.

## 6. Progress Log

- 2026-06-11T00:18Z
  - Completed: generated Cycle 04 backlog from current repo state after Cycle 03 completion.
  - Evidence read: guard status 3/20 with active Cycle 04 placeholder; Cycle 03 backlog/progress; ROADMAP; Phase 4/5 docs; coverage-gap handoff; protocol schemas; relay-client helpers/tests; Web API/controller; control RPC routes/tests; guard scripts.
  - Current status: active backlog path is `docs/handoff/CodexNext_CYCLE04_PHASE1_TO_PHASE5_BACKLOG.md`; completedCycles 3/20; canContinue true.
- 2026-06-11T00:18Z
  - Completed: A1-A2.
  - Changes: added protocol enum/helper schemas for thread goals, approval policy, reviewer, sandbox, permission, reasoning, and session status; added schemas for session summaries, session list/create, local health, message, interrupt, event replay, and sidebar prefs responses; reused enum schemas in local start/resume inputs.
  - Verification: `pnpm --filter @codexnext/protocol typecheck`; `pnpm exec vitest run packages/protocol/test/relay-schemas.test.ts` (1 file / 8 tests).
- 2026-06-11T00:20Z
  - Completed: B1-B2.
  - Changes: added shared relay-client parsers for device list, sidebar prefs, health, HTTP event replay, sessions list/create, session message, and turn interrupt responses; parser errors use stable payload-free messages.
  - Verification: `pnpm --filter @codexnext/relay-client typecheck`; `pnpm exec vitest run packages/relay-client/test/relay-client.test.ts` (1 file / 7 tests).
- 2026-06-11T00:22Z
  - Completed: C1-C2.
  - Changes: Web API core relay calls now parse device list, sidebar prefs, health, HTTP replay, sessions list/create, message, and interrupt responses through shared relay-client parsers; API tests cover parser success and malformed successful health responses.
  - Verification: `pnpm --filter @codexnext/protocol typecheck`; `pnpm --filter @codexnext/relay-client typecheck`; `pnpm --filter @codexnext/web typecheck`; `pnpm exec vitest run packages/protocol/test/relay-schemas.test.ts packages/relay-client/test/relay-client.test.ts apps/web/src/lib/api.test.ts` via targeted package/test runs.
- 2026-06-11T00:24Z
  - Completed: D1-D2.
  - Changes: control core RPC routes now validate successful machine results for health, sessions list/create, session message, and turn interrupt before returning them; malformed results classify as `relay_rpc_protocol_error` with HTTP 502.
  - Verification: `pnpm --filter @codexnext/control typecheck`; `pnpm exec vitest run apps/control/test/control-server.test.ts apps/control/test/relay-rpc-error.test.ts --testNamePattern "returns relay rpc ack results|rejects malformed successful relay rpc results|maps timeout"` (2 files / 3 selected tests).
- 2026-06-11T00:25Z
  - Completed: E1-E2.
  - Changes: `complete-cycle` and `validate-complete` now run `pnpm test:guard` and `pnpm test:winsw`; guard smoke tests assert the expanded command list through `CODEXNEXT_BACKLOG_GUARD_FAKE_COMMANDS=1` without running the full project gate.
  - Verification: `pnpm test:guard`.
- 2026-06-11T00:26Z
  - Completed: F1-F2.
  - Changes: Phase 4 mobile baseline now names shared runtime response parsers as part of the mobile-ready boundary and keeps `apps/mobile` deferred until framework choice; coverage-gap handoff refreshed to reflect closed Cycles 02-04 gaps and remaining risks.
- 2026-06-11T00:26Z
  - Completed: F3-F4.
  - Audit: marker scan found no TODO/FIXME/HACK hits in audited app/package/script/doc paths; token-storage scan only matched saved-device metadata migration/tests, which strip token-like fields and do not persist owner, browser session, or device tokens.
  - Verification: protocol typecheck plus relay schema tests; relay-client typecheck plus parser tests; web typecheck plus API parser tests; control typecheck plus selected RPC validation/classification tests; `pnpm test:guard`; `pnpm test:winsw`.
- 2026-06-11T00:27Z
  - Completed: F5.
  - Verification: `pnpm install`; `pnpm typecheck`; `pnpm test` (22 files / 166 tests); `pnpm test:guard`; `pnpm test:winsw`; `pnpm --filter @codexnext/agent dev -- doctor` (relay health warning only because no relay URL was supplied).
- 2026-06-11T00:27Z
  - Completed: F6-F7 preflight.
  - Reverse audit: `git diff --check` passed; guard status reported 15/17 complete before marking F6-F7 and `canContinue: true`; no pending implementation checkboxes remained outside the final audit rows.
  - Next command: `node scripts/codexnext-backlog-cycle-guard.mjs complete-cycle`.

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
