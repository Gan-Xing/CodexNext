# Security

CodexNext now has two operating modes:

- direct mode: local development and localhost-only use
- relay mode: multi-device remote control through `apps/control`

Codex already owns command approvals, sandbox mode, and final permission enforcement. CodexNext security is responsible for:

- who may access the public Web entry
- which devices are trusted to join the relay
- how relay/browser/device tokens are stored
- how remote and direct entry points are exposed
- how administrative actions are audited

## Phase 3B Guarantees

- Public relay Web requires login.
- Web login uses an HttpOnly cookie.
- `ownerToken` is server-only.
- Browser relay sessions are short-lived and hashed in control memory.
- Relay browser session tokens are not persisted to `localStorage`.
- Pairing approve/reject requires authenticated user access.
- Pairing requests are rate-limited, expire after 5 minutes, and are pruned.
- Control registry stores `deviceTokenHash`, not plaintext `deviceToken`.
- Revoked devices cannot reconnect.
- Direct remote mode requires explicit `--allow-remote-direct`.
- Relay `full-access` remains available in relay mode by default so Codex permissions stay consistent across direct and relay entry points. Set `CODEXNEXT_DISABLE_RELAY_FULL_ACCESS=1` only if you intentionally want an extra relay-only gate.
- Audit logs record login, pairing, session issue/revoke, device connect/revoke, relay RPC status, and approval decisions.

## Secrets And Tokens

Never expose these values to browser JS, URLs, query strings, or shared screenshots:

- `CODEXNEXT_OWNER_TOKEN`
- raw relay `sessionToken`
- raw device pairing `deviceToken`
- Codex/OpenAI credentials from the local Codex installation

Persisted files:

- `~/.codexnext/device.json`
  - contains device identity and local device token
  - written with restrictive permissions
- `~/.codexnext/control-devices.json`
  - stores trusted device metadata
  - stores `deviceTokenHash`, not plaintext token
- `~/.codexnext/control-audit.log`
- `~/.codexnext/web-audit.log`

## Direct Mode

Direct mode is for local development.

- Default bind host is loopback.
- Any non-loopback bind requires `--allow-remote-direct`.
- Direct mode still uses token + Origin checks.
- Direct mode should not be your public/mobile deployment path.

## Relay Mode

Relay mode is the recommended remote/mobile path.

- browsers/mobile connect only to Web + control
- machines connect outbound to control over Socket.IO
- device trust is established through pairing
- device revoke disconnects the current machine socket and blocks future reconnects

## Emergency Response

If a relay deployment looks compromised:

1. Stop `apps/control`.
2. Rotate `CODEXNEXT_OWNER_TOKEN`.
3. Rotate `CODEXNEXT_WEB_SESSION_SECRET`.
4. Revoke affected devices from the registry.
5. Invalidate old pairings by restarting control.
6. Review `control-audit.log` and `web-audit.log`.

## Future Work

Still out of scope in Phase 3B:

- OAuth or passkeys
- multi-user SaaS authorization
- end-to-end encrypted relay payloads
- non-Codex agents
