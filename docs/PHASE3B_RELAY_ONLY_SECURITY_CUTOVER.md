# Phase 3B-R: Relay-Only Security Cutover

## Goal

Cut CodexNext product UX over from mixed direct/relay operation to relay-only.

Users should no longer see:

- Agent URL
- Access Token
- `?agent=`
- `?token=`
- direct saved devices

Normal product entry becomes:

- Web login
- relay session bootstrap
- device discovery through control
- pairing through the Web UI

## Product Rules

- Browsers and mobile connect only to Web + control.
- Machines connect outbound to control as relay agents.
- `ownerToken` is server-only.
- relay `sessionToken` lives only in memory and is reissued after refresh through the login cookie.
- direct mode remains hidden dev-only and is not part of normal user docs or UI.

## Security Rules

- `/api/relay/session` requires login.
- browser sessions use token hashes, TTL, idle timeout, revoke, and prune.
- pairing approve/reject requires login.
- device tokens are hashed at rest.
- revoked devices are disconnected immediately and cannot reconnect.
- production CORS uses explicit allowlists.
- relay `full-access` is disabled unless `CODEXNEXT_ALLOW_RELAY_FULL_ACCESS=1` is set.

## UX Rules

- DeviceSheet is relay-only.
- old direct saved devices are discarded automatically.
- a one-time migration hint explains that local direct devices were removed.
- device add flow is pair-code based.

## Thread Switching Rules

- thread switching is recent-first, not full-detail-first
- recent pages may be cached in control for faster warm switches
- the source of truth remains the machine's Codex app-server
