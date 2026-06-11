# CodexNext Cycle 01 Audit Notes

This file records Cycle 01 audit evidence that is broader than one code patch.

## Phase 1 Protocol And Client API Audit

Reviewed:

- `packages/protocol/src/index.ts`
- `packages/codex-client/src/json-rpc.ts`
- `packages/codex-client/src/codex-app-server-client.ts`
- `apps/agent/src/commands/doctor.ts`
- `apps/agent/src/commands/goal-smoke.ts`

Findings:

- Method constants cover initialize, thread, turn, goal, notification, server approval request, relay RPC, Socket.IO namespace/path, pairing, device, and local event contracts.
- JSON-RPC request timeout and error response paths already had tests. Cycle 01 added unknown server request and handler-failure tests.
- `CodexAppServerClient` default approval behavior is conservative for command/file approval requests, returning decline/denied when the callback does not produce a decision.
- `doctor` reports presence and risk without printing raw tokens. Relay health validation rejects payload keys matching token/secret/password/prompt/assistant/command/output/content.
- `goal-smoke` is intentionally a local smoke path and can print the supplied goal plus live app-server output. It should not be described as a redaction-safe diagnostic.

## Phase 2 Web Controller Boundary Audit

Reviewed:

- `apps/web/src/features/console/use-web-console-controller.ts`
- `apps/web/src/features/devices/device-utils.ts`
- `apps/web/src/features/sessions/session-utils.ts`
- `apps/web/src/lib/event-stream.ts`
- `apps/web/src/features/chat/chat-state.ts`
- approval summary and sheet components

Current responsibilities to keep in the controller for now:

- selecting a relay device and binding it to a workspace
- managing sheet/menu UI state
- joining session, history, goal, approval, and stream state for the main console view
- coordinating relay session bootstrap with saved relay device metadata

Boundaries now extracted or protected:

- saved device sanitization lives in `features/devices/device-utils.ts`
- session/history grouping lives in `features/sessions/session-utils.ts`
- replay/live event sequencing now uses `@codexnext/relay-client`
- chat/event ingestion stays in `features/chat/chat-state.ts`

Boundaries to extract in later cycles:

- relay bootstrap and refresh lifecycle
- stream lifecycle and device reconnect status transitions
- localStorage preference persistence
- controller-level session expired and full-access filtering render tests

Do not do now:

- no large controller rewrite while Phase 4/5 contracts are still moving
- no new direct-mode branch or URL token parsing
- no duplicated mobile controller copied from Web

## Web LocalStorage Audit

Allowed browser storage:

- `codexnext.savedDevices.v1` with relay-only device display metadata
- sidebar width
- relay-only migration notice
- thread/project sidebar prefs

Disallowed browser storage:

- ownerToken
- relay sessionToken
- deviceToken
- direct token

Evidence:

- `readSavedDevicesState` drops legacy direct devices and sanitizes unknown token-like fields.
- `connectionFromSavedDevice` requires an in-memory relay session token.
- `apps/web/src/features/devices/device-utils.test.ts` asserts owner/session/device/direct tokens are not persisted.
- `requestRelaySession` is server-cookie backed and `relayBootstrap.sessionToken` is React memory state.

## Phase 3 Runtime Edge Cases

Reviewed:

- `apps/control/src/server.ts`
- `apps/control/src/device-registry.ts`
- `apps/control/src/device-event-store.ts`
- `apps/control/src/audit-log.ts`
- `apps/control/test/control-server.test.ts`

Edge cases identified:

- Browser relay session expiry while HTTP routes and Socket.IO user namespace use the old token.
- Pairing approval reuse after a pairing is already approved/rejected/expired.
- Device revoke while the machine is connected and while reconnect is attempted with an old token.
- Device revoke while an HTTP relay RPC is in flight.
- Stale heartbeat offline transition without losing known device/workspace state.
- Replay reconnect after `lastSeqByDevice` with duplicate machine events.
- Production CORS without explicit allowed origins.
- Machine owner-token bootstrap accidentally enabled in production.

Coverage:

- Existing tests cover session expiry, Socket.IO rejection after expiry, pairing one-time approval, stale offline, duplicate replay/live events, production CORS, owner-token bootstrap restrictions, full-access policy, safe health, and audit redaction.
- Cycle 01 added revoke during an in-flight relay RPC.

## Control Server File Risk

`apps/control/src/server.ts` remains large. Cycle 01 deliberately did not split route groups because the current risk is regression in relay/session/device interactions, and broad extraction would create a larger blast radius than the tests justify.

Conservative follow-up:

- extract pure route helpers only after adding multi-user-client tests
- avoid moving Socket.IO, pairing, and browser session state into separate modules until the contracts are stable
- prefer tests around race paths before refactoring

## Production Config Drift Audit

README, `docs/SECURITY.md`, `docs/ARCHITECTURE.md`, and `docs/RELAY_DEPLOYMENT.md` are aligned on:

- relay-only product path
- ownerToken server-only
- no owner/session/device/direct token in browser storage
- HTTPS/WSS guidance for public deployments
- explicit CORS allowlist in production
- production machine owner-token bootstrap disabled unless explicitly allowed
- relay full-access follows Codex by default unless disabled by operator policy
- `device:replay` initial batches and `device:event` live events
- safe `/api/control/health`

Roadmap changed Phase 4 from blocked to ready for scaffold after Cycle 01 and Phase 5 from future to modeled first slices.

## Marker Audit

Search command:

```bash
rg -n "TODO|FIXME|HACK|temporary|dev-only|direct mode|direct-mode|CODEXNEXT_ENABLE_DEV_DIRECT|ownerToken|sessionToken|deviceToken" . --glob '!node_modules' --glob '!pnpm-lock.yaml'
```

Findings:

- No code TODO/FIXME/HACK markers requiring current-cycle fixes were found.
- `dev-only` and direct-mode matches are intentional hidden troubleshooting boundary references in docs and `apps/agent/src/commands/serve.ts`.
- owner/session/device token matches are expected in protocol types, server-side control/session code, tests, and security docs.
- Historical handoff docs still describe older direct/owner-token risks for context. They are superseded by current README, ROADMAP, ARCHITECTURE, SECURITY, RELAY_DEPLOYMENT, and Cycle 01 docs.

## Adversarial Self-Review

Questions asked:

- Did Cycle 01 just add docs without executable protection?
- Does mobile scaffold work risk copying Web's large controller?
- Does the new relay-client package leak tokens or weaken relay-only boundaries?
- Did control revoke/RPC hardening cover a real runtime race?
- Did any change reintroduce direct mode into user paths?

Findings:

- The shared relay client is intentionally small and tested. It carries no ownerToken/deviceToken fields.
- Web event-stream now consumes the shared replay/auth helpers and has a unit test covering replay, live events, and reconnect auth sequence advancement.
- Control adds a real revoke/in-flight-RPC integration test.
- Phase 4 did not create a full app scaffold yet; this is acceptable because the shared replay/auth package is the safer first engineering boundary. The next scaffold has explicit acceptance criteria.
- No direct-mode user path was added.

Must-fix before Cycle 01 completion:

- None found after the targeted test pass. Full verification still required before `complete-cycle`.
