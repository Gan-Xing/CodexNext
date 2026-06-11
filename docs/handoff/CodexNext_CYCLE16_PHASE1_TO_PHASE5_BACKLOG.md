# CodexNext Cycle 16 Phase 1-5 Backlog

## 0. Count Semantics

This is the active Cycle 16 backlog. The cycle count must not increment until every checkbox in this file is complete, final verification passes, reverse audit finds no must-fix issue, and:

```bash
node scripts/codexnext-backlog-cycle-guard.mjs complete-cycle
```

succeeds.

Current count at backlog generation: 15/20.
Deadline: 2026-06-11 05:30 Europe/London.

## 1. Fresh Audit Summary

Cycle 15 completed and counted successfully. Evidence:

- Guard count is now 15/20 and `canContinue` is true.
- Cycle 15 final guard verification passed inside `complete-cycle`: `pnpm install`, `pnpm typecheck`, `pnpm test` (28 files / 226 tests), `pnpm test:guard`, `pnpm test:winsw`, and `pnpm --filter @codexnext/agent dev -- doctor`.
- Cycle 15 extracted browser-session helper logic into `apps/control/src/browser-session.ts` while preserving route-level audit and Socket.IO disconnect side effects.

Fresh Cycle 16 findings:

- `apps/control/src/server.ts` still owns a cohesive policy-helper cluster: `RateLimitRecord`, `consumeRateLimit`, `pruneRateLimits`, `createOriginMatcher`, and `resolveRelayFullAccessSetting`.
- Existing integration tests cover production origin requirements, production CORS allowlist behavior, pairing rate limits, and relay full-access allow/deny behavior.
- These helpers can move to a dedicated policy module with deterministic unit tests while keeping Fastify/CORS registration and route-level enforcement in `server.ts`.

## 2. Cycle 16 Goal

Cycle 16 should continue reducing `server.ts` by extracting reusable control policy helpers:

1. Move rate-limit record/helper logic, origin matching, and relay full-access setting resolution into a dedicated control policy module.
2. Preserve CORS behavior, pairing/auth rate limits, and relay full-access operator policy.
3. Add helper-level tests for rate-limit windows/pruning, origin allowlist behavior, and explicit/env/default full-access settings.
4. Run existing control integration tests for CORS, rate limits, and full-access behavior.
5. Refresh coverage docs, run targeted tests, perform security/reverse audits, and pass the full guard gate.

## 3. Non-Goals

- No route registration extraction.
- No rate-limit thresholds or window changes.
- No CORS allowlist semantics changes.
- No relay full-access policy changes.
- No Web UI changes.

## 4. Required Reading

- `docs/handoff/CodexNext_TEST_COVERAGE_GAPS.md`
- `docs/handoff/CodexNext_CYCLE15_PHASE1_TO_PHASE5_BACKLOG.md`
- `apps/control/src/server.ts`
- `apps/control/test/control-server.test.ts`

## 5. Backlog

### A. Phase 1 / Phase 5 - Control Policy Helper Extraction

- [x] A1. Create a dedicated control policy helper module.
  - Acceptance: module owns `RateLimitRecord`, `consumeRateLimit`, `pruneRateLimits`, `createOriginMatcher`, and `resolveRelayFullAccessSetting`.

- [x] A2. Update `server.ts` to import policy helpers and remove local policy helper definitions.
  - Acceptance: Fastify/CORS registration, route handlers, and relay RPC policy checks keep the same behavior.

### B. Tests

- [x] B1. Add helper tests for rate-limit count/window behavior and pruning expired buckets.
- [x] B2. Add helper tests for origin matching in production and development allowlist modes.
- [x] B3. Add helper tests for explicit, env-disabled, and default relay full-access settings.
- [x] B4. Run existing control integration tests covering production origins, CORS, rate limits, and full-access enforcement.

### C. Security / Product Boundary Audit

- [x] C1. Confirm production origin requirements and CORS allowlist behavior remain restricted.
- [x] C2. Confirm relay full-access remains denyable by explicit config and `CODEXNEXT_DISABLE_RELAY_FULL_ACCESS=1`.

### D. Docs, Audit, And Final Gate

- [x] D1. Refresh coverage-gap docs to record the control policy helper extraction and leave route registration extraction as remaining work.
- [x] D2. Run targeted control typecheck/tests.
- [x] D3. Run marker and policy-behavior scans after code changes.
- [x] D4. Run final verification: `pnpm install`, `pnpm typecheck`, `pnpm test`, `pnpm test:guard`, `pnpm test:winsw`, `pnpm --filter @codexnext/agent dev -- doctor`.
- [x] D5. Run adversarial reverse audit after all checkboxes appear complete.
- [x] D6. Confirm this backlog has zero pending checkbox items and run `node scripts/codexnext-backlog-cycle-guard.mjs complete-cycle`.

## 6. Progress Log

- 2026-06-11T02:22Z
  - Completed: generated Cycle 16 backlog from current repo state after Cycle 15 completion.
  - Evidence read: guard status 15/20 with no active backlog; coverage-gap handoff; Cycle 15 backlog/progress; control policy helpers and CORS/rate-limit/full-access integration tests.
  - Current status: active backlog path is `docs/handoff/CodexNext_CYCLE16_PHASE1_TO_PHASE5_BACKLOG.md`; completedCycles 15/20; canContinue true.
- 2026-06-11T02:24Z
  - Completed: A1, A2, B1, B2, B3, B4, C1, C2, D1, D2, and D3.
  - Code: added `apps/control/src/control-policy.ts` for `RateLimitRecord`, rate-limit consume/prune helpers, origin matching, and relay full-access setting resolution.
  - Code: `server.ts` now imports policy helpers and no longer defines the policy helper cluster locally.
  - Tests: added `apps/control/test/control-policy.test.ts` covering rate-limit windows, pruning, production/dev origin matching, and explicit/env/default full-access resolution.
  - Verification: `pnpm --filter @codexnext/control typecheck`, `pnpm exec vitest run apps/control/test/control-policy.test.ts`, and `pnpm exec vitest run apps/control/test/control-server.test.ts apps/control/test/control-policy.test.ts` passed (58 tests in the combined run).
  - Security/product audit: marker scan was clean; policy scans confirm production CORS and full-access denial behavior remain covered by existing integration tests and direct helper tests.
  - Docs: updated `docs/handoff/CodexNext_TEST_COVERAGE_GAPS.md` to record extracted policy helper coverage while leaving route registration extraction as remaining work.
- 2026-06-11T02:25Z
  - Completed: D4.
  - Final verification passed: `pnpm install`, `pnpm typecheck`, `pnpm test` (29 files / 230 tests), `pnpm test:guard`, `pnpm test:winsw`, and `pnpm --filter @codexnext/agent dev -- doctor`.
  - Doctor note: the only non-ok diagnostic was the expected local warning that no relay URL was supplied.
- 2026-06-11T02:25Z
  - Completed: D5.
  - Reverse audit: `git diff --check` passed; pending-checkbox scan shows only D5 and D6 before closing D5; focused policy scan confirms helper definitions live only in `apps/control/src/control-policy.ts`.
  - Adversarial findings: production CORS restrictions, rate-limit 429 behavior, and full-access denial remain route-enforced and covered by integration tests; direct policy tests cover the extracted branch logic.
- 2026-06-11T02:26Z
  - Completed: D6 preflight.
  - Evidence: guard status shows 13/14 completed checkboxes with only D6 pending, completedCycles 15/20, and `canContinue: true`.
  - Current action: running `node scripts/codexnext-backlog-cycle-guard.mjs complete-cycle`.

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
