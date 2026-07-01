# Architecture

CodexNext is a relay-first personal control plane for Codex app-server.

The normal product path is:

```txt
Browser / mobile Web / future mobile client
  -> CodexNext Web login
  -> Web HttpOnly cookie
  -> Web server POST /api/relay/session
  -> Control relay browser session
  -> Paired outbound agent
  -> Local Codex app-server
```

The user path must not expose an Agent URL, Access Token, `?agent=`, `?token=`, or `?ownerToken=`. Browser storage may keep device display metadata and UI preferences, but not owner tokens, relay session tokens, or device tokens.

## Runtime Services

`apps/control` is the relay control plane.

- Fastify provides HTTP APIs for health, session bootstrap, pairing, device listing, revoke, and relay RPC.
- Socket.IO provides `/user` and `/machine` namespaces.
- Browser sessions are short-lived bearer tokens stored server-side only as `tokenHash` records with TTL, idle timeout, revoke, and pruning.
- Machine authorization uses the v2 device registry with `deviceTokenHash`. Production disables machine owner-token bootstrap unless explicitly opted in.
- Pairing requests are one-time, fingerprinted, rate-limited, and expire after 15 minutes.
- Device events are stored in a bounded in-memory per-device event store.
- Audit logs record security actions and relay RPC outcomes with redaction.

`apps/web` is the public UI.

- Next.js handles the login page, auth routes, relay bootstrap route, and console UI.
- Login uses an HttpOnly Web session cookie.
- `/api/relay/session` uses the server-only `CODEXNEXT_OWNER_TOKEN` to mint a short-lived control session and returns only `{ relayUrl, sessionToken }`.
- Relay session tokens live in React memory and are reissued through the cookie-protected bootstrap path after refresh.
- Saved devices are relay-only metadata and are sanitized before being kept in `localStorage`.

`apps/agent` runs on each controllable machine.

- `pair` creates or reuses `~/.codexnext/device.json`, requests a pairing code, and polls until approved.
- `connect` opens one outbound Socket.IO machine connection and handles `rpc:request`.
- Provider Runtime is powered by the published `codex-provider` package. When a session requests a non-default provider, the agent starts a local CodexProvider adapter and passes the resulting Codex CLI args into the local Codex app-server startup path.
- The local Codex app-server remains the final authority for approvals, sandboxing, and command execution.
- `doctor` checks local prerequisites and can probe relay health, Web auth status, relay bootstrap routing, Socket.IO routing, Agent health, Provider runtime/catalog, same-origin deployment, and expected-closed public service ports.

## Relay Event Contract

Control uses two event shapes for browser clients:

```txt
device:replay -> initial reconnect batch, payload: DeviceEventPayload[]
device:event  -> live single event, payload: DeviceEventPayload
```

On user namespace connection, the browser supplies `lastSeqByDevice`. Control emits current `device:upsert` records and then one `device:replay` batch containing only events with `seq > lastSeqByDevice[deviceId]`.

After the connection is live, new machine events are emitted as `device:event`. Duplicate machine events with the same sequence number are stored once and are not re-emitted live.

## Device Presence

Machine agents send heartbeat messages using the interval returned by `machine:hello`. Control marks a device offline when it has been stale for the configured stale timeout, defaulting to four heartbeat intervals. Stale offline state does not delete the device workspace or event history; a later heartbeat/hello can mark the device online again if the device remains authorized.

Device revoke is stronger than stale presence: revoke marks the registry record, disconnects the live socket, emits offline to users, and prevents reconnect.

## History Cache

Recent Codex history pages are cached in memory per device for a short TTL to make thread switching fast. Cache entries are keyed by device, thread id, cwd, sort direction, items view, and limit. Archive and unloaded-thread events invalidate affected thread cache entries. The source of truth remains the local Codex app-server on the paired machine.

## Direct Dev-Only Boundary

`codexnext dev-serve` remains only as a hidden troubleshooting path for local development. It requires `CODEXNEXT_ENABLE_DEV_DIRECT=1`; non-loopback binding also requires `--allow-remote-direct`. It is not part of the product path, README setup flow, Web UI, or browser URL contract.

## Package Roles

`packages/protocol` owns shared TypeScript types, Zod schemas, relay method names, Socket.IO namespace/path constants, and Codex app-server request/response vocabulary.

`packages/codex-client` owns JSON-RPC transport mechanics for Codex app-server.

`packages/relay-client` owns the first shared Web/mobile relay client boundary. It is intentionally small and pure: URL normalization, bearer auth headers, device/session/event replay/sidebar/approval URL helpers, user Socket.IO auth payloads, replay filtering, live-event acceptance, and sequence advancement. Browser and future mobile clients should depend on this package before duplicating relay event state rules.

`codex-provider` is an external npm dependency consumed by `@codexnext/agent`, not vendored into this monorepo. `CODEXNEXT_CODEX_PROVIDER_MODULE` remains a development override for testing a local provider build, but a normal install should resolve the published package without requiring an adjacent CodexProvider checkout.

CodexNext intentionally does not replace Codex permissions. Permission mode, sandbox mode, approvals, and command execution enforcement remain inside the local Codex app-server.
