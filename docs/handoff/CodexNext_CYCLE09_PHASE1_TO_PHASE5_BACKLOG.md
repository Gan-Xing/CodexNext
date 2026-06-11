# CodexNext Cycle 09 Phase 1-5 Backlog

## 0. Count Semantics

This is the active Cycle 09 backlog. The cycle count must not increment until every checkbox in this file is complete, final verification passes, reverse audit finds no must-fix issue, and:

```bash
node scripts/codexnext-backlog-cycle-guard.mjs complete-cycle
```

succeeds.

Current count at backlog generation: 8/20.
Deadline: 2026-06-11 05:30 Europe/London.

## 1. Fresh Audit Summary

Cycle 08 completed and counted successfully. Evidence:

- Guard count is now 8/20 and `canContinue` is true.
- Cycle 08 final guard verification passed: `pnpm install`, `pnpm typecheck`, `pnpm test` (23 files / 191 tests), `pnpm test:guard`, `pnpm test:winsw`, and `pnpm --filter @codexnext/agent dev -- doctor`.
- Cycle 08 added approval request param schemas, goal/turn-start response schemas, inbound approval request validation, and goal/turn-start response validation.

Fresh Cycle 09 findings:

- The Web coverage gap is now concrete: helper tests cover permission filtering and relay session expiry formatting, but rendered full-access option filtering is not tested in the actual permission menus.
- `useWebConsoleController` uses a local `formatConsoleError` wrapper for relay session expiry UX. The helper behavior is tested indirectly through `formatRelaySessionError`, but the controller-used wrapper itself is not exported or covered.
- There is no need for a new browser test framework to close this slice. React server rendering can verify that `SessionSetupSheet` and `LiveComposer` do not render the full-access option when the controller passes filtered options.
- This advances Phase 2 Web Console while preserving Phase 4/5 safety: mobile and multi-client flows should inherit the same filtered permission choices and non-leaking expired-session message.

## 2. Cycle 09 Goal

Cycle 09 should harden Web console UX safety around session expiry and full-access filtering:

1. Move the controller-used session error formatter into a tested utility.
2. Add rendered component tests proving full-access is absent from both setup and live-composer permission menus when filtered options are supplied.
3. Refresh coverage docs, run targeted Web checks, perform safety/reverse audits, and pass the full guard gate.

## 3. Non-Goals

- No Web redesign.
- No new browser or DOM testing framework.
- No change to relay full-access product policy.
- No mobile scaffold.
- No control route changes.

## 4. Required Reading

- `README.md`
- `docs/ROADMAP.md`
- `docs/ARCHITECTURE.md`
- `docs/SECURITY.md`
- `docs/RELAY_DEPLOYMENT.md`
- `docs/PHASE4_MOBILE_CLIENT_BASELINE.md`
- `docs/PHASE5_MULTI_DEVICE_RELIABILITY.md`
- `docs/handoff/CodexNext_BACKLOG_CYCLE_LOG.md`
- `docs/handoff/CodexNext_TEST_COVERAGE_GAPS.md`
- `docs/handoff/CodexNext_CYCLE08_PHASE1_TO_PHASE5_BACKLOG.md`
- `apps/web/src/features/console/use-web-console-controller.ts`
- `apps/web/src/features/console/console-utils.ts`
- `apps/web/src/features/console/console-utils.test.ts`
- `apps/web/src/components/sheets/SessionSetupSheet.tsx`
- `apps/web/src/components/chat/LiveComposer.tsx`

## 5. Backlog

### A. Phase 2 - Controller Session Expiry UX

- [x] A1. Move the controller-used console error formatter into `console-utils`.
  - Reason: the actual controller wrapper should be directly testable, not only its lower-level relay formatter.
  - Acceptance: `useWebConsoleController` imports the shared formatter; expired relay errors format to the localized login/session-expired message without leaking raw token/error text; unrelated errors still fall back to `formatError`.

- [x] A2. Extend console utility tests for the exported controller-level formatter.
  - Verification: clear HTTP/socket expiry errors produce the localized message; non-expiry errors keep normal formatting.

### B. Phase 2 / Phase 4 - Rendered Full-Access Filtering

- [x] B1. Add server-render tests for `SessionSetupSheet` permission options.
  - Reason: helper filtering is not enough if rendered menus later ignore filtered props.
  - Acceptance: rendered setup sheet includes request/auto/custom options and excludes the full-access label when `permissionOptions` is filtered.

- [x] B2. Add server-render tests for `LiveComposer` permission menu.
  - Reason: the live composer has a separate rendered menu for the same security-sensitive options.
  - Acceptance: rendered live composer permission menu excludes the full-access label when `permissionOptions` is filtered and still renders the selected safe option.

### C. Phase 5 / Security Audit

- [x] C1. Confirm tests and code do not introduce token persistence, direct-mode exposure, or a changed relay full-access policy.
- [x] C2. Confirm the rendered tests remain lightweight and do not require new dependencies or a browser runtime.

### D. Docs, Audit, And Final Gate

- [x] D1. Refresh coverage-gap docs to move rendered full-access filtering and controller-level session expiry formatting into covered areas.
- [x] D2. Run targeted Web typecheck/tests.
- [x] D3. Run marker and token-storage audits after code changes.
- [x] D4. Run final verification: `pnpm install`, `pnpm typecheck`, `pnpm test`, `pnpm test:guard`, `pnpm test:winsw`, `pnpm --filter @codexnext/agent dev -- doctor`.
- [x] D5. Run adversarial reverse audit after all checkboxes appear complete.
- [x] D6. Confirm this backlog has zero pending checkbox items and run `node scripts/codexnext-backlog-cycle-guard.mjs complete-cycle`.

## 6. Progress Log

- 2026-06-11T01:12Z
  - Completed: generated Cycle 09 backlog from current repo state after Cycle 08 completion.
  - Evidence read: guard status 8/20 with no active backlog, then active Cycle 09 placeholder; Cycle 08 backlog/progress; coverage-gap handoff; README/roadmap/architecture/security/deployment and Phase 4/5 docs from the current audit context; Web console utilities/tests; Web controller session error handling; `SessionSetupSheet`; `LiveComposer`; Web package dependencies.
  - Current status: active backlog path is `docs/handoff/CodexNext_CYCLE09_PHASE1_TO_PHASE5_BACKLOG.md`; completedCycles 8/20; canContinue true.
- 2026-06-11T01:18Z
  - Completed: A1-A2 and B1-B2.
  - Changes: exported controller-facing console error formatters from `console-utils`, updated `useWebConsoleController` to use them, enabled Vitest OXC JSX transforms for component imports, and added server-render permission menu tests for `SessionSetupSheet` and `LiveComposer`.
  - Verification: `pnpm --filter @codexnext/web typecheck`; `pnpm exec vitest run apps/web/src/features/console/console-utils.test.ts apps/web/src/components/permission-rendering.test.ts` (2 files / 10 tests).
- 2026-06-11T01:19Z
  - Completed: C1-C2 and D1-D3.
  - Docs: coverage-gap handoff now records controller-used relay session expiry formatting and rendered full-access filtering for setup/live composer menus as covered; remaining Web gap is broader hook-level expiry recovery across relay bootstrap, Socket.IO reconnect, and visible UI state.
  - Audit: marker scan found only existing hidden direct-mode documentation/serve/doctor references and prior handoff notes; token-storage scan matched known owner/session/device token surfaces and Web storage allowlist paths, with no Cycle 09 token persistence or direct-mode path; rendered tests use React server rendering only and add no dependency.
  - Verification: Web typecheck plus targeted console-utils/render tests; `git diff --check` passed for the Cycle 09 diff.
- 2026-06-11T01:21Z
  - Completed: D4.
  - Final verification: `pnpm install`; `pnpm typecheck`; `pnpm test` (24 files / 195 tests); `pnpm test:guard`; `pnpm test:winsw`; `pnpm --filter @codexnext/agent dev -- doctor` (relay health warning only because no relay URL was supplied).
  - Reverse-audit adjustment before final gate: rendered tests now pass the output of `availableRelayPermissionOptions` into the real components rather than a hand-filtered array; targeted Web checks and the full final gate were rerun after that change.
- 2026-06-11T01:21Z
  - Completed: D5.
  - Reverse audit: confirmed rendered tests exercise real helper-filtered options, controller error paths use shared session-expiry formatters, Vitest JSX config is limited to test transformation, marker/token scans found no new storage or direct-mode path, and `git diff --check` passed. No must-fix issue found.
- 2026-06-11T01:21Z
  - Completed: D6 preflight.
  - Guard status reported 11/12 complete before marking this row, `canContinue: true`, and no stop reasons. Next command: `node scripts/codexnext-backlog-cycle-guard.mjs complete-cycle`.

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
