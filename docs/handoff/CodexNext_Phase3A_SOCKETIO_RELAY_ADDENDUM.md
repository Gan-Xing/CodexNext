# CodexNext Phase 3A Addendum: Choose Socket.IO for Relay

## Decision

Use **Socket.IO** as the Phase 3A relay transport instead of raw `ws`.

This is now a product-level decision, not an implementation detail.

Reason:

- CodexNext is planned to support mobile clients.
- Browser, mobile Web, and future React Native clients need a stable realtime transport.
- Socket.IO gives us built-in reconnect behavior, event acknowledgements, timeouts, rooms/namespaces, transport fallback, and a mature client ecosystem.
- Happy uses the same style of server-mediated realtime control model, and CodexNext should borrow the useful parts while staying Codex-only.

## Updated Phase 3A Architecture

```txt
Browser Web / Mobile Web / Future React Native
  ↓ Socket.IO user-scoped connection
CodexNext Control Server
  ↓ Socket.IO machine-scoped connection
codexnext-agent connect
  ↓ local SessionManager / ApprovalBridge / EventStore
codex app-server stdio
```

The browser must not connect directly to each agent in relay mode.

The agent must not expose a public HTTP port in relay mode.

## Transport Packages

Add these dependencies:

```txt
apps/control:
  socket.io

apps/agent:
  socket.io-client

apps/web:
  socket.io-client
```

Use Socket.IO 4.x consistently across all apps.

## Socket.IO Path

Use a dedicated path so CodexNext relay traffic is explicit:

```txt
/socket.io/codexnext
```

Do not reuse the default path accidentally across unrelated servers.

## Namespaces

Use separate namespaces rather than one global socket namespace:

```txt
/io/user      browser, mobile Web, future React Native
/io/machine   device agents
```

Alternative if implementation simplicity wins:

```txt
/io
```

with `clientType` in auth:

```ts
type ClientType = "user" | "machine";
```

Preferred for Phase 3A: separate namespaces.

## Authentication

### Phase 3A single-user auth

Use one owner token for the control server:

```bash
CODEXNEXT_OWNER_TOKEN=<long-random-token>
```

Browser / Web auth:

```ts
io(relayUrl, {
  path: "/socket.io/codexnext",
  auth: {
    clientType: "user",
    ownerToken,
    lastSeqByDevice: { [deviceId]: seq }
  }
});
```

Agent auth:

```ts
io(relayUrl + "/machine", {
  path: "/socket.io/codexnext",
  auth: {
    clientType: "machine",
    ownerToken,
    deviceId,
    deviceToken,
    devicePublicKey,
    lastSeq
  }
});
```

For the first implementation, `ownerToken` can authorize device registration. Later, replace this with device key challenge auth.

## Device Identity

Agent stores local identity in:

```txt
~/.codexnext/device.json
```

Shape:

```ts
interface DeviceIdentityFile {
  version: 1;
  deviceId: string;
  deviceName: string;
  devicePrivateKey?: string;
  devicePublicKey?: string;
  deviceToken?: string;
  createdAt: number;
  relayUrl?: string;
}
```

Phase 3A may generate `deviceId` + `deviceToken` first. Phase 3B should add true public-key challenge auth.

## Machine Registration Event

Agent emits:

```ts
machine:hello
```

Payload:

```ts
interface MachineHelloPayload {
  deviceId: string;
  deviceName: string;
  hostname: string;
  platform: string;
  arch: string;
  agentVersion: string;
  codexVersion?: string | null;
  startedAt: number;
}
```

Ack response:

```ts
interface MachineHelloAck {
  ok: true;
  serverTime: number;
  heartbeatIntervalMs: number;
}
```

If unauthorized:

```ts
interface ErrorAck {
  ok: false;
  error: string;
}
```

All command-like emits must use ack with timeout.

## Heartbeat / Presence

Agent emits heartbeat:

```ts
machine:heartbeat
```

Payload:

```ts
interface MachineHeartbeatPayload {
  deviceId: string;
  at: number;
  activeSessions: number;
}
```

Control server maintains:

```ts
interface DevicePresence {
  deviceId: string;
  online: boolean;
  lastSeenAt: number;
  socketId?: string;
}
```

Browser receives:

```ts
device:upsert
device:offline
device:presence
```

## Relay RPC Envelope

Use Socket.IO acknowledgements for RPC. Do not invent a second WebSocket request-response protocol unless needed.

Control server sends to a machine socket:

```ts
machineSocket.timeout(30_000).emit("rpc:request", request, ack);
```

Request:

```ts
interface RelayRpcRequest {
  requestId: string;
  method: RelayMethod;
  params?: unknown;
  deadlineMs?: number;
}
```

Response:

```ts
type RelayRpcResponse =
  | { ok: true; result?: unknown }
  | { ok: false; error: { message: string; code?: string; data?: unknown } };
```

Required Phase 3A methods:

```txt
agent.health
sessions.list
sessions.create
sessions.message
sessions.goal.get
sessions.goal.set
sessions.goal.clear
turn.interrupt
approval.decision
directories.list
codexHistory.list
codexHistory.detail
codexHistory.resume
```

Do not add arbitrary shell or arbitrary file APIs.

## Event Relay

Agent sends local events to control server:

```ts
machine:event
```

Payload:

```ts
interface MachineEventPayload {
  deviceId: string;
  event: LocalEvent;
}
```

Control server stores per-device in-memory event buffer for Phase 3A:

```ts
Map<deviceId, EventStore>
```

Browser receives:

```ts
device:event
```

Payload:

```ts
interface DeviceEventPayload {
  deviceId: string;
  event: LocalEvent;
}
```

## Replay / Missed Events

Even with Socket.IO connection state recovery, CodexNext must keep its own `LocalEvent.seq` replay model.

Reason:

- Socket.IO can help with temporary disconnects, but recovery is not guaranteed.
- CodexNext already has `LocalEvent.seq` and event replay semantics.
- Mobile clients can be suspended or killed by the OS.
- Browser refresh should not lose events.

Browser should connect with:

```ts
io(relayUrl + "/user", {
  path: "/socket.io/codexnext",
  auth: {
    ownerToken,
    lastSeqByDevice: {
      [deviceId]: lastSeenSeq
    }
  }
});
```

On connection, control server should emit missed events for each device with `seq > lastSeenSeq`.

Also keep HTTP fallback endpoints for replay:

```txt
GET /api/relay/devices/:deviceId/events?after=<seq>
```

## Browser API Compatibility

Keep the existing `agentFetch()` public call sites as stable as possible.

Change the connection type:

```ts
type AgentConnection =
  | {
      mode: "direct";
      agentUrl: string;
      token: string;
    }
  | {
      mode: "relay";
      relayUrl: string;
      ownerToken: string;
      deviceId: string;
    };
```

Then implement:

```ts
agentFetch(connection, path, init)
openManagedEventStream(connection, after, handlers)
```

Both must branch internally for direct vs relay.

Direct mode remains for local development.
Relay mode becomes the default product mode.

## Control Server HTTP Endpoints

The Web app may still use HTTP for simple request/response calls, backed by Socket.IO RPC to the machine.

Required endpoints:

```txt
GET  /api/control/health
GET  /api/devices
GET  /api/relay/devices/:deviceId/health
GET  /api/relay/devices/:deviceId/sessions
POST /api/relay/devices/:deviceId/sessions
POST /api/relay/devices/:deviceId/sessions/:sessionId/messages
GET  /api/relay/devices/:deviceId/sessions/:sessionId/goal
POST /api/relay/devices/:deviceId/sessions/:sessionId/goal
DELETE /api/relay/devices/:deviceId/sessions/:sessionId/goal
POST /api/relay/devices/:deviceId/sessions/:sessionId/turns/:turnId/interrupt
POST /api/relay/devices/:deviceId/approvals/:approvalId/decision
GET  /api/relay/devices/:deviceId/events?after=<seq>
```

## Web Device UX

Device sheet should prioritize relay devices:

```txt
Devices
  MacBook Pro          online
  144 Server           online
  Build server         offline

Advanced
  Add direct endpoint
```

Direct endpoint should be hidden under Advanced and labelled as local/dev mode.

When using relay mode, user should not enter:

```txt
agent URL
agent token
web origin
Tailscale IP
```

## Pairing UX

Phase 3A can begin with owner-token connect:

```bash
codexnext connect \
  --relay http://144.217.243.161:3002 \
  --owner-token <token> \
  --device-name "MacBook"
```

Phase 3A.5 should add pairing:

```bash
codexnext pair --relay http://144.217.243.161:3002
```

Terminal output:

```txt
Pair this device:
Code: 482-913
Expires: 5 minutes
Open: http://144.217.243.161:3002/pair?code=482913
```

Web `/pair` confirms:

```txt
Device: MacBook
Platform: macOS arm64
Codex: <version>
Fingerprint: ab12 cd34 ef56

[Decline] [Bind device]
```

Pairing request must be one-time and short-lived.

## Tests Required

Add tests for:

```txt
control auth rejects missing owner token
machine hello registers device
device heartbeat updates presence
relay RPC returns ack result
relay RPC timeout returns 504-style error
machine event is stored in per-device event store
browser receives device:event
replay returns events after seq
direct mode still works
relay mode agentFetch maps paths correctly
```

## Manual Acceptance

1. Start control server on 144:

```bash
pnpm --filter @codexnext/control dev -- \
  --host 0.0.0.0 \
  --port 3002 \
  --owner-token <token>
```

2. Start MacBook agent in relay mode:

```bash
pnpm --filter @codexnext/agent dev -- connect \
  --relay http://144.217.243.161:3002 \
  --owner-token <token> \
  --device-name "MacBook"
```

3. Open Web from phone:

```txt
http://144.217.243.161:3002
```

4. Expected:

```txt
Phone sees MacBook online.
Phone selects MacBook.
Phone creates Codex session.
MacBook runs Codex locally.
Phone sees streaming output.
Phone can approve/decline approval requests.
Phone never accesses 100.x.x.x:17361.
Phone never configures agent webOrigin.
```
