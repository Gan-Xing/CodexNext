# ADR 0004: Authenticated Relay Security Gate

## Status

Accepted.

## Context

Phase 3A introduced a Socket.IO relay with:

- `/user` and `/machine` namespaces
- outbound machine connections
- browser relay RPC
- pairing

That made CodexNext remotely operable from mobile and other devices, but the public entry was still too weak:

- Web could bootstrap relay sessions without a real login gate
- control browser sessions had no TTL/revoke model
- pairing lacked rate limit and reject/revoke hardening
- device registry stored plaintext device tokens
- remote direct mode could be exposed too casually

Codex itself already handles approvals and sandbox policy. The missing layer was authenticated access to the control plane.

## Decision

Phase 3B adds:

- Web login using HttpOnly cookie sessions
- cookie-protected relay session bootstrap
- hashed control-side browser sessions with TTL and idle timeout
- rate-limited pairing create/lookup/approve/reject
- hashed device token persistence and revoke support
- production-only explicit CORS allowlists
- optional relay full-access gate for operators who explicitly want to turn it off
- audit logging for security-relevant control-plane actions

## Consequences

### Positive

- public relay deployment now has a real login gate
- browser no longer needs owner token knowledge
- device compromise and token leakage impact is reduced
- revoke becomes an explicit administrative action
- direct mode remains available for local development

### Negative

- more operational configuration is required
- relay session bootstrap is no longer stateless
- public deployments now depend on cookie/session secrets
- pairing and device management have more lifecycle complexity

## Security Notes

- `ownerToken` is server-only
- device registry stores `deviceTokenHash`, not plaintext token
- relay full-access now follows Codex by default; operators may still disable it as an extra deployment policy
- approval prompts remain Codex-native, not reimplemented by CodexNext
