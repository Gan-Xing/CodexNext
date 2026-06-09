# ADR 0004: Relay-Only Security Gate

## Status

Accepted.

## Context

CodexNext originally exposed both direct and relay product paths. That created multiple user entry modes, duplicated connection UX, and a larger security surface:

- direct Agent URL and token handling in the browser
- relay session bootstrap in parallel with direct saved devices
- user confusion about which path was canonical

Phase 3A and Phase 3B introduced the relay control plane, login gate, browser sessions, pairing, device revoke, and audit logging. At that point, direct mode no longer needed to remain part of the normal product path.

## Decision

CodexNext product UX is relay-only.

- Web no longer parses `?agent=` or `?token=`.
- Web no longer presents Agent URL or Access Token forms.
- Saved devices are relay-only.
- Relay session bootstrap requires login and uses the server-side owner token.
- direct mode remains available only as a hidden dev-only troubleshooting path gated by `CODEXNEXT_ENABLE_DEV_DIRECT=1`.

## Consequences

### Positive

- one canonical UX across desktop Web, mobile Web, and future native shells
- smaller public attack surface
- no user-managed direct tokens in URLs or browser storage
- pairing becomes the only user-facing device-add path

### Negative

- local debugging now requires an explicit opt-in to direct mode
- relay availability becomes mandatory for normal product use

## Security Notes

- `ownerToken` is server-only
- device registry stores `deviceTokenHash`, not plaintext token
- relay `full-access` follows Codex by default; operators may still explicitly disable it
- Codex approvals and sandbox enforcement remain Codex-native
