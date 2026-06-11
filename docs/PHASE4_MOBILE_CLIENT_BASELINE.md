# Phase 4 Mobile Client Baseline

Phase 4 starts from the relay-only Web/control path. The first mobile client must not introduce a new direct-device protocol, owner-token client auth, or separate trust model.

## MVP Scope

- Login/session bootstrap through Web-style authenticated session exchange.
- Device list and presence from control.
- Session and history view for a selected paired device.
- Turn steering and interrupt for an active session.
- Approval prompts with command/file/network/user-input summaries.
- Event replay using `device:replay` initial batches and `device:event` live events.

## Non-Goals

- OAuth or passkeys.
- Multi-user SaaS authorization.
- End-to-end relay payload encryption.
- Non-Codex agents.
- Direct agent URLs, per-machine access tokens, or VPN/Tailscale-only UX as a product requirement.

## Shared Relay Client Boundary

Cycle 01 started `packages/relay-client` instead of immediately scaffolding a full mobile app. Cycle 02 extended it to cover the first shared HTTP URL/header boundary, Cycle 03 expanded route URL helpers across the mobile-critical HTTP surface, and Cycle 04 adds shared runtime parsers for the core relay response payloads. This remains the smaller correct boundary because mobile and Web first need shared semantics for replay, auth payloads, URL construction, response parsing, and sequence advancement before duplicating UI.

The package currently owns:

- user Socket.IO auth payloads with `sessionToken` and `lastSeqByDevice`
- bearer auth header construction from the short-lived relay session token
- device list URL construction
- selected-device health URL construction
- session list/create URL construction
- session message and turn interrupt URL construction
- Codex history list/loaded/detail/turns/archive/resume URL construction
- sidebar preference URL construction
- device event replay URL construction
- approval decision URL/body construction
- response parsing for device list, sidebar prefs, health, event replay, sessions list/create, session message, turn interrupt, and Codex history payloads
- replay filtering by selected device and last seen sequence
- live event acceptance for newer events only
- sequence advancement after replay/live delivery
- relay URL normalization that strips query strings and fragments

Next scaffold step:

- defer `apps/mobile` until the framework decision is explicit: React Native/Expo versus a mobile-optimized Web shell
- consume `@codexnext/relay-client` for all replay/auth/URL/response parsing state, including Codex history adapters
- add contract tests that run the same replay fixtures against Web and mobile adapters

Acceptance for the first scaffold:

- no ownerToken or deviceToken in mobile JS state, URLs, or persistent storage
- session bootstrap can refresh an expired relay session through the authenticated Web/mobile session path
- the app can list devices, show presence, replay a session stream, receive live events, send a turn steer, interrupt a turn, and resolve one approval prompt

Current scaffold decision:

- Do not add a placeholder `apps/mobile` in this cycle.
- A future cycle may add it once the framework choice is explicit and the scaffold can consume `@codexnext/relay-client` URL/auth/replay/parser helpers on day one.
- First scaffold commands must include dependency installation, a typecheck, and at least one contract test that reuses the replay/auth fixtures in `packages/relay-client/test/relay-client.test.ts`.

## Mobile Bootstrap Acceptance Fixtures

These fixtures describe the first mobile adapter contract. They intentionally use the same relay HTTP and Socket.IO paths as Web.

1. Login:

```http
POST /api/auth/login
Content-Type: application/json

{"password":"<user password>"}
```

Expected success response:

```json
{"ok":true}
```

The authenticated cookie/platform session is the only persisted login credential.

2. Relay session bootstrap:

```http
POST /api/relay/session
```

Expected success response:

```json
{"relayUrl":"https://relay.example","sessionToken":"relay-session-token"}
```

The `sessionToken` is memory-only client state. A 401 or 410 must be shown as an expired login/session state.

3. Device list:

```http
GET https://relay.example/api/devices
Authorization: Bearer relay-session-token
```

Expected response:

```json
{
  "devices": [
    {
      "deviceId": "device_1",
      "deviceName": "MacBook",
      "hostname": "macbook.local",
      "platform": "darwin",
      "arch": "arm64",
      "agentVersion": "0.1.0",
      "codexVersion": "codex 0.0.0",
      "startedAt": 1,
      "online": true,
      "lastSeenAt": 2,
      "activeSessions": 1
    }
  ]
}
```

4. Event replay:

```http
GET https://relay.example/api/relay/devices/device_1/events?after=4
Authorization: Bearer relay-session-token
```

Expected response:

```json
{
  "events": [
    {
      "id": "evt_5",
      "seq": 5,
      "ts": 5,
      "type": "chat.user",
      "sessionId": "session_1",
      "payload": {"text":"continue"}
    }
  ]
}
```

5. Live events:

```json
{
  "namespace": "/user",
  "auth": {
    "clientType": "user",
    "sessionToken": "relay-session-token",
    "lastSeqByDevice": {"device_1": 5}
  },
  "events": [
    {
      "name": "device:event",
      "payload": {
        "deviceId": "device_1",
        "event": {
          "id": "evt_6",
          "seq": 6,
          "ts": 6,
          "type": "chat.assistant.delta",
          "sessionId": "session_1",
          "payload": {"text":"ok"}
        }
      }
    }
  ]
}
```

6. Turn steer:

```http
POST https://relay.example/api/relay/devices/device_1/sessions/session_1/messages
Authorization: Bearer relay-session-token
Content-Type: application/json

{"text":"continue","clientMessageId":"msg_1"}
```

Expected response:

```json
{"mode":"steer","turnId":"turn_1"}
```

7. Turn interrupt:

```http
POST https://relay.example/api/relay/devices/device_1/sessions/session_1/turns/turn_1/interrupt
Authorization: Bearer relay-session-token
Content-Type: application/json

{}
```

Expected response:

```json
{"turnId":"turn_1"}
```

8. Approval decision:

```http
POST https://relay.example/api/relay/devices/device_1/approvals/approval_1/decision
Authorization: Bearer relay-session-token
Content-Type: application/json

{"decision":"acceptForSession"}
```

Expected response:

```json
{"ok":true}
```

## Mobile Auth And Storage Threat Model

- Mobile clients may persist only a Web-style authenticated session credential appropriate for the platform storage layer. The raw control `sessionToken` should be treated as short-lived memory state and reissued through server bootstrap.
- `CODEXNEXT_OWNER_TOKEN` stays server-only in `apps/web`/deployment env.
- Machine `deviceToken` stays on the paired agent machine in `~/.codexnext/device.json`.
- Saved mobile device metadata may include display name, deviceId, relay URL, hostname, online state, and codexVersion, but not ownerToken, sessionToken, deviceToken, direct token, prompts, or command output.
- Logout must clear mobile session state and any in-memory relay session token.

## Event Replay Contract Test Plan

- Initial connect sends `lastSeqByDevice` for the selected device.
- `device:replay` batches are filtered to the selected device, sorted by `seq`, deduped by `seq`, and applied only when `seq > lastSeenSeq`.
- `device:event` live events are ignored for other devices and ignored when `seq <= lastSeenSeq`.
- Reconnect auth advances `lastSeqByDevice` after replay and live events.
- Offline/reconnect UX must distinguish relay reconnect, device offline, and session expired.
