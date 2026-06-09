# Phase 3B: Authenticated Relay Security Gate

Phase 3B turns the relay proof-of-concept into a public-entry control plane with a real authentication gate.

## Scope

This phase secures:

- public Web login
- relay browser sessions
- device pairing
- device registry persistence
- direct-mode exposure rules
- relay full-access safety
- audit logging

This phase does **not** replace Codex approvals or Codex sandboxing.

## What Changed

### Web

- added `/login`
- added `/api/auth/login`
- added `/api/auth/logout`
- added `/api/auth/status`
- added cookie-protected `/api/relay/session`
- removed production dependence on `ownerToken` in browser state
- stopped persisting relay session tokens to `localStorage`

### Control

- browser sessions now store token hashes, TTL, idle timeout, revoke state
- production CORS now requires explicit allowed origins
- pairing create / lookup / approve / reject are rate-limited
- pairing records now expose `shortFingerprint`
- pairing requests are one-time and pruned
- device registry now stores `deviceTokenHash`
- revoked devices are denied and disconnected
- relay RPC and approval decisions are audit logged

### Agent

- `device.json` writes with restrictive permissions
- direct remote bind requires `--allow-remote-direct`

## Operational Model

### Direct mode

- use for localhost development
- keep behind loopback unless you explicitly opt in

### Relay mode

- Web and mobile talk to the control plane
- machine agent connects outbound to control
- user pairs a device, then selects it from the relay device list

## Environment

Required for public relay deployments:

- `CODEXNEXT_OWNER_TOKEN`
- `CODEXNEXT_RELAY_URL`
- `CODEXNEXT_WEB_AUTH_PASSWORD_HASH`
- `CODEXNEXT_WEB_SESSION_SECRET`
- `CODEXNEXT_PUBLIC_ORIGIN`

Optional:

- `CODEXNEXT_DISABLE_RELAY_FULL_ACCESS=1`
- `NEXT_PUBLIC_CODEXNEXT_DISABLE_RELAY_FULL_ACCESS=1`
- `NEXT_PUBLIC_CODEXNEXT_ALLOW_URL_TOKEN=1` for explicit debugging only

## Expected Security Behavior

- unauthenticated public Web opens the login page
- unauthenticated `/api/relay/session` returns `401`
- successful login sets an HttpOnly cookie
- logout removes the Web session cookie
- relay session bootstrap no longer leaks owner token to browser JS
- revoked devices cannot reconnect
- `control-devices.json` contains `deviceTokenHash`, not plaintext token
- relay `full-access` remains available by default; explicit disable is optional

## Manual Verification

1. Open public Web in a fresh browser profile.
2. Confirm login page appears.
3. Confirm `POST /api/relay/session` returns `401`.
4. Log in and open the main console.
5. Pair a device and approve it.
6. Confirm the device appears online.
7. Revoke the device.
8. Confirm the device disappears and cannot reconnect.
9. Attempt relay `full-access` and confirm it works like direct mode. If you set the disable env override, confirm it is rejected.
