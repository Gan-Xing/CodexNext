# CodexNext Cycle 05 Phase 1-5 Backlog

## 0. Count Semantics

This is the active Cycle 05 backlog. The cycle count must not increment until every checkbox in this file is complete, final verification passes, reverse audit finds no must-fix issue, and:

```bash
node scripts/codexnext-backlog-cycle-guard.mjs complete-cycle
```

succeeds.

Current count at backlog generation: 4/20.
Deadline: 2026-06-11 05:30 Europe/London.

## 1. Fresh Audit Summary

Cycle 04 completed and counted successfully. Evidence:

- Guard count is now 4/20 and `canContinue` is true.
- Cycle 04 final guard verification passed: `pnpm install`, `pnpm typecheck`, `pnpm test` (22 files / 166 tests), `pnpm test:guard`, `pnpm test:winsw`, and `pnpm --filter @codexnext/agent dev -- doctor`.
- Cycle 04 added runtime schemas/parsers for core relay responses, Web API parser usage, control malformed RPC result rejection, and expanded guard verification.

Fresh Cycle 05 findings:

- Codex history is now the main Phase 4 mobile-critical API family still mostly protected by TypeScript casts rather than runtime schemas.
- `packages/relay-client` does not yet own Codex history URL builders or response parsers, so future mobile history screens would duplicate Web URL/query rules.
- `apps/web/src/lib/api.ts` still routes and casts Codex history list/loaded/detail/turns/archive/resume responses manually.
- Control has custom Codex history routes for loaded cache, turns cache, archive cache invalidation, and resume cache write-through; malformed successful history RPC results are not uniformly schema-validated.
- `docs/PHASE4_MOBILE_CLIENT_BASELINE.md` mentions session/history view but does not list Codex history helper/parser readiness.

## 2. Cycle 05 Goal

Cycle 05 should make Codex history ready for shared Web/mobile consumption:

1. Add protocol schemas for Codex history entries, messages, list/loaded/detail/page/resume/archive responses.
2. Add relay-client Codex history URL builders and response parsers.
3. Update Web API history functions to use shared builders/parsers.
4. Validate successful Codex history machine RPC results in control before returning or caching them.
5. Update Phase 4 and coverage-gap docs.

## 3. Non-Goals

- No mobile scaffold.
- No Codex app-server schema overhaul beyond local Codex history response shapes.
- No large control route extraction.
- No UI redesign.
- No persistence/database changes.

## 4. Required Reading

```txt
docs/ROADMAP.md
docs/PHASE4_MOBILE_CLIENT_BASELINE.md
docs/handoff/CodexNext_TEST_COVERAGE_GAPS.md
docs/handoff/CodexNext_CYCLE04_PHASE1_TO_PHASE5_BACKLOG.md

packages/protocol/src/index.ts
packages/protocol/test/relay-schemas.test.ts
packages/relay-client/src/index.ts
packages/relay-client/test/relay-client.test.ts

apps/web/src/lib/api.ts
apps/web/src/lib/api.test.ts
apps/web/src/lib/types.ts

apps/control/src/server.ts
apps/control/test/control-server.test.ts
apps/control/test/relay-rpc-error.test.ts

apps/agent/src/local-server/local-agent.ts
apps/agent/src/local-server/create-local-server.ts
```

## 5. Backlog

### A. Phase 1 - Codex History Protocol Schemas

- [x] A1. Add Zod schemas and fixture tests for Codex history entries, loaded-thread response, history list response, detail response, and paged turns response.
  - Reason: mobile session/history views need runtime response contracts.
  - Modules: `packages/protocol/src/index.ts`, `packages/protocol/test/relay-schemas.test.ts`.

- [x] A2. Add schemas and fixture tests for Codex history archive and resume responses.
  - Reason: archive/resume are mutating history routes and should be validated before Web/mobile state changes.
  - Modules: `packages/protocol`.
  - Verification: protocol typecheck and relay schema tests.

### B. Phase 4 - Shared Codex History Client Boundary

- [x] B1. Add relay-client URL builders for Codex history list, loaded, detail, turns, archive, and resume routes.
  - Reason: future mobile code should not duplicate query construction for id/cwd/cursor/limit/sort parameters.
  - Modules: `packages/relay-client/src/index.ts`.

- [x] B2. Add relay-client parsers for Codex history list, loaded, detail, turns page, archive, and resume responses.
  - Acceptance: malformed payloads throw stable `Invalid relay response: <name>` errors.
  - Verification: relay-client typecheck and tests.

### C. Phase 2 - Web History API Boundary

- [x] C1. Update Web Codex history API functions to use shared relay-client URL builders.
  - Cover: `listCodexHistory`, `getLoadedCodexThreads`, `getCodexHistoryDetail`, `getCodexHistoryTurns`, `archiveCodexHistory`, and `resumeCodexHistory`.

- [x] C2. Update Web Codex history API functions to parse successful responses through shared relay-client parsers.
  - Acceptance: malformed successful history JSON rejects before controller state mutation.
  - Verification: web typecheck and API tests.

### D. Phase 3 - Control History RPC Validation

- [x] D1. Validate successful Codex history machine RPC results in control before returning or caching them.
  - Cover: list, loaded, detail, turns, archive, and resume.
  - Reason: cache mutation should only happen after result shape validation.
  - Modules: `apps/control/src/server.ts`.

- [x] D2. Add control tests for malformed successful Codex history RPC results.
  - Acceptance: malformed result returns deterministic `relay_rpc_protocol_error` / 502 and does not update loaded-thread or recent-history caches.
  - Verification: control typecheck and targeted tests.

### E. Docs, Audit, And Final Gate

- [x] E1. Update Phase 4 docs to include Codex history URL/parser helper readiness and remaining mobile scaffold decision.
- [x] E2. Refresh coverage-gap docs to remove Codex history response schemas/parsers from remaining gaps and identify the next highest-risk gaps.
- [x] E3. Re-run marker and token storage audits after code changes.
- [x] E4. Run targeted verification for all Cycle 05 changes.
- [x] E5. Run final verification: `pnpm install`, `pnpm typecheck`, `pnpm test`, `pnpm test:guard`, `pnpm test:winsw`, `pnpm --filter @codexnext/agent dev -- doctor`.
- [x] E6. Run adversarial reverse audit after all checkboxes appear complete.
- [x] E7. Confirm this backlog has zero pending checkbox items and run `node scripts/codexnext-backlog-cycle-guard.mjs complete-cycle`.

## 6. Progress Log

- 2026-06-11T00:31Z
  - Completed: generated Cycle 05 backlog from current repo state after Cycle 04 completion.
  - Evidence read: guard status 4/20 with active Cycle 05 placeholder; Cycle 04 backlog/progress; current coverage-gap doc; protocol history interfaces; relay-client helpers; Web history API functions; control Codex history routes; agent local history handlers; Web test dependency inventory.
  - Current status: active backlog path is `docs/handoff/CodexNext_CYCLE05_PHASE1_TO_PHASE5_BACKLOG.md`; completedCycles 4/20; canContinue true.
- 2026-06-11T00:30Z
  - Completed: A1-A2.
  - Changes: added protocol schemas for Codex history entries, messages, list, loaded threads, detail, turns page, archive, and resume responses with valid/malformed fixtures.
  - Verification: `pnpm --filter @codexnext/protocol typecheck`; `pnpm exec vitest run packages/protocol/test/relay-schemas.test.ts` (1 file / 10 tests).
- 2026-06-11T00:32Z
  - Completed: B1-B2.
  - Changes: added relay-client Codex history URL builders for list, loaded, detail, turns, archive, and resume routes; added parsers for all matching history responses with stable malformed-payload errors.
  - Verification: `pnpm --filter @codexnext/relay-client typecheck`; `pnpm exec vitest run packages/relay-client/test/relay-client.test.ts` (1 file / 8 tests).
- 2026-06-11T00:33Z
  - Completed: C1-C2.
  - Changes: Web Codex history list/loaded/detail/turns/archive/resume API functions now use shared relay-client URL builders and response parsers; API tests cover history URL mapping, parser success, and malformed successful history responses.
  - Verification: `pnpm --filter @codexnext/web typecheck`; `pnpm exec vitest run apps/web/src/lib/api.test.ts` (1 file / 8 tests).
- 2026-06-11T00:36Z
  - Completed: D1-D2.
  - Changes: control now validates successful Codex history list, loaded, detail, turns, archive, and resume RPC results before returning or mutating loaded-thread/recent-history caches; added malformed loaded and turns tests, including no-cache behavior for bad pages.
  - Verification: `pnpm --filter @codexnext/control typecheck`; `pnpm exec vitest run apps/control/test/control-server.test.ts apps/control/test/relay-rpc-error.test.ts --testNamePattern "loaded thread ids|malformed loaded history|allows longer timeout|relays paged history turns|malformed history turns|archives a thread|maps timeout"` (2 files / 7 selected tests).
- 2026-06-11T00:36Z
  - Completed: E1-E2.
  - Changes: Phase 4 docs now list shared Codex history URL/parser helpers; coverage-gap handoff updated to remove Codex history response schemas/parsers from remaining gaps and carry forward lower-level app-server schemas plus adapter fixture reuse.
- 2026-06-11T00:37Z
  - Completed: E3-E4.
  - Audit: marker scan found no TODO/FIXME/HACK hits in audited app/package/script/doc paths; token-storage scan only matched saved-device metadata migration/tests, which strip token-like fields and do not persist owner, browser session, or device tokens.
  - Verification: protocol typecheck plus relay schema tests; relay-client typecheck plus helper/parser tests; web typecheck plus API tests; control typecheck plus selected history validation tests; `pnpm test:guard`; `pnpm test:winsw`.
- 2026-06-11T00:38Z
  - Completed: E5.
  - Verification: `pnpm install`; `pnpm typecheck`; `pnpm test` (22 files / 173 tests); `pnpm test:guard`; `pnpm test:winsw`; `pnpm --filter @codexnext/agent dev -- doctor` (relay health warning only because no relay URL was supplied).
- 2026-06-11T00:38Z
  - Completed: E6-E7 preflight.
  - Reverse audit: `git diff --check` passed; guard status reported 13/15 complete before marking E6-E7 and `canContinue: true`; no pending implementation checkboxes remained outside the final audit rows.
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
