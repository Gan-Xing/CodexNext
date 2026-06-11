# Phase 5 Multi-Device Reliability Model

Phase 5 builds on the Phase 3C relay runtime and the Phase 4 shared client boundary. Its goal is durable, predictable behavior when multiple browser or mobile clients observe and control one or more paired agents.

## Entity Hierarchy

- User: the owner authenticated to the Web/mobile entry.
- User client: one browser tab, browser profile, mobile app install, or future native client.
- Machine: a physical or virtual host running a CodexNext agent.
- Device: the registered relay identity for a machine, identified by `deviceId` and authorized by a local `deviceToken`.
- Workspace: cwd/root context inside a device.
- Thread: Codex app-server thread identity.
- Session: CodexNext runtime view of a thread on a device, including active turn, goal, approvals, and chat/event state.
- Event stream: per-device ordered `LocalEvent` sequence, replayed by `device:replay` and tailed by `device:event`.

## Boundary With Phase 3C

Already covered by Phase 3C:

- short-lived browser relay sessions
- pairing and revoke
- stale presence
- in-memory bounded per-device event replay
- Socket.IO reconnect replay using `lastSeqByDevice`
- safe health and audit log redaction
- default relay full-access behavior and operator disable

Phase 5 owns:

- durable multi-client session views
- longer retention and persistence choices
- conflict handling between simultaneous user clients
- deterministic reconnect UX across browser/mobile clients
- daemon/service polish and platform coverage beyond current helpers

## Multi-Device Session View Contract

A future session view should be expressible as:

- user client id
- selected device id
- device presence and lastSeenAt
- workspace cwd
- Codex thread id
- CodexNext session id
- active turn id, if any
- goal state
- pending approvals
- highest replayed sequence per device
- source of the view: replay, live event, history hydration, or active RPC response

Multiple user clients may observe the same device/session concurrently. They should converge by applying the same replay/live sequence rules from `@codexnext/relay-client`.

## Concrete Multi-Client Examples

Two browsers on one device:

```json
{
  "clients": [
    {"clientId": "browser_a", "lastSeqByDevice": {"device_1": 0}},
    {"clientId": "browser_b", "lastSeqByDevice": {"device_1": 1}}
  ],
  "replay": [
    {"clientId": "browser_a", "receivedSeq": [1, 2]},
    {"clientId": "browser_b", "receivedSeq": [2]}
  ],
  "live": {"deviceId": "device_1", "event": {"seq": 3, "type": "chat.assistant.delta"}}
}
```

Browser plus mobile on one device:

```json
{
  "clients": [
    {"clientId": "browser_a", "platform": "web", "selectedDeviceId": "device_1"},
    {"clientId": "mobile_a", "platform": "ios", "selectedDeviceId": "device_1"}
  ],
  "presence": {
    "deviceId": "device_1",
    "online": true,
    "lastSeenAt": 123,
    "activeSessions": 2
  }
}
```

Two agents observed by one client:

```json
{
  "clientId": "browser_a",
  "devices": [
    {"deviceId": "macbook", "online": true, "lastSeq": 12},
    {"deviceId": "linux_box", "online": true, "lastSeq": 4}
  ],
  "lastSeqByDevice": {
    "macbook": 12,
    "linux_box": 4
  }
}
```

Offline/reconnect:

```json
{
  "offline": {"deviceId": "device_1", "online": false, "lastSeenAt": 200},
  "reconnectAuth": {
    "clientType": "user",
    "sessionToken": "relay-session-token",
    "lastSeqByDevice": {"device_1": 8}
  },
  "replayAfterReconnect": [
    {"deviceId": "device_1", "event": {"seq": 9, "type": "session.updated"}}
  ]
}
```

Approval conflict:

```json
{
  "approvalId": "approval_1",
  "firstClient": {"clientId": "browser_a", "decision": "accept", "result": {"decision": "accept"}},
  "secondClient": {
    "clientId": "mobile_a",
    "decision": "decline",
    "error": "No pending approval for id approval_1"
  },
  "events": [
    {
      "type": "approval.resolved",
      "payload": {
        "approvalId": "approval_1",
        "decision": "accept",
        "reason": "user"
      }
    }
  ]
}
```

## Conflict Strategy V1

- Read-only operations such as health, device list, session list, history read, and replay are allowed concurrently.
- Turn steer and interrupt are allowed concurrently but must be associated with an explicit sessionId/turnId and should surface stale-turn errors.
- Approval decisions must be serialized by approvalId. The first accepted decision wins; later clients should receive an already-resolved or not-found response and refresh state.
- Session creation/resume for the same thread/workspace should be allowed, but UI must show which session is active on the selected device.
- Device revoke is authoritative. It disconnects the machine socket, marks clients offline, blocks reconnect, and bounds in-flight RPCs by timeout/offline failure.

## First Test Entry

Cycle 01 added a revoke-with-in-flight-RPC control test and shared replay helper tests. Cycle 02 adds two-user replay convergence, two-client presence convergence, relay RPC error classification tests, and an approval first-decision-wins bridge test. Next implementation slices should add:

- stale reconnect sends `lastSeqByDevice` and does not duplicate already applied assistant deltas
- revoke during a live session causes both clients to receive offline state
- end-to-end UI refresh behavior after a stale approval decision receives the not-found error

## Daemon And Service Polish

Current bundled helpers cover:

- Linux `systemd` for control, web, and agent roles
- macOS `launchd` for the outbound relay agent
- Windows WinSW templates for control, web, and agent roles
- shell wrappers for running control, web, and relay agent

Windows path:

- Preferred first implementation: checked-in WinSW service templates in `ops/winsw/` for control, web, and agent roles because they map closely to the existing `systemd` service/env split and can run Node/pnpm commands without a new resident daemon.
- Validation: `pnpm test:winsw` verifies all three templates keep required ids, env placeholders, commands, restart policy, and log rolling.
- Acceptable documented fallback: PowerShell Scheduled Tasks for agent-only outbound relay on personal machines.
- Deferred unless needed by a deployment: NSSM, because WinSW has clearer checked-in XML templates and service lifecycle documentation.
