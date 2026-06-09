# Security

CodexNext is a relay-first control plane for Codex app-server.

Normal product usage is relay-only:

- users log in to the Web app
- browsers/mobile connect to Web + control
- machines connect outbound to control as agents
- devices are added through pairing

Codex itself still owns command approvals, sandbox mode, and final permission enforcement. CodexNext security is responsible for the public entry, relay sessions, device trust, and audit boundaries.

## Phase 3B-R Guarantees

- Public Web requires login and uses an HttpOnly cookie.
- `/api/relay/session` returns `401` when not logged in.
- `ownerToken` is server-only and never belongs in browser URLs, `localStorage`, or React state.
- Relay browser sessions are short-lived and control stores only `tokenHash` with TTL, idle timeout, revoke, and prune.
- Relay session tokens are not persisted in browser storage.
- Pairing approve/reject requires authenticated user access.
- Pairing codes are rate-limited, one-time, fingerprinted, and pruned after expiry.
- Device registry stores `deviceTokenHash`, not plaintext `deviceToken`, and supports migration from older files.
- Revoked devices cannot reconnect and any live socket is disconnected immediately.
- Production CORS must use explicit allowlists; `origin: true` is not used.
- Relay `full-access` is disabled by default and requires `CODEXNEXT_ALLOW_RELAY_FULL_ACCESS=1` on the control server.
- Direct mode is hidden dev-only and requires `CODEXNEXT_ENABLE_DEV_DIRECT=1`.
- Audit logs record security-relevant actions without recording raw tokens, prompts, assistant content, or full command output.

## Secrets And Tokens

Never expose these values to browser JS, URLs, query strings, screenshots, or client-side storage:

- `CODEXNEXT_OWNER_TOKEN`
- raw relay `sessionToken`
- raw device pairing `deviceToken`
- Codex/OpenAI credentials from the local Codex installation

Persisted files:

- `~/.codexnext/device.json`
  - local device identity and device token
  - written with restrictive file permissions
- `~/.codexnext/control-devices.json`
  - trusted device metadata
  - `deviceTokenHash`, not plaintext token
- `~/.codexnext/control-audit.log`
- `~/.codexnext/web-audit.log`

## Relay Mode

Relay mode is the supported product path.

- browsers/mobile connect only to Web + control
- machines connect outbound to control over Socket.IO
- device trust is established through pairing
- device revoke disconnects the current machine socket and blocks future reconnects
- recent thread pages may be cached in control for faster switching, but the source of truth remains Codex app-server on the machine

## Hidden Dev-Only Direct Mode

Direct mode remains only as a local troubleshooting path for development.

- it is not part of normal product UX
- it requires `CODEXNEXT_ENABLE_DEV_DIRECT=1`
- non-loopback binding still requires `--allow-remote-direct`
- it does not print tokenized Web URLs

## Emergency Response

If a relay deployment looks compromised:

1. Stop `apps/control`.
2. Rotate `CODEXNEXT_OWNER_TOKEN`.
3. Rotate `CODEXNEXT_WEB_SESSION_SECRET`.
4. Revoke affected devices from the registry.
5. Invalidate old pairings by restarting control.
6. Review `control-audit.log` and `web-audit.log`.

## Future Work

Still out of scope:

- OAuth / passkeys
- multi-user SaaS authorization
- end-to-end encrypted relay payloads
- non-Codex agents
