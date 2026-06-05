# Security

CodexNext Phase 1 is local-only. It does not expose Codex app-server over a network transport and does not store OpenAI or Codex credentials.

## Security Principles

- Keep Codex login state on the user's device.
- Prefer `codex app-server --stdio` for the first milestone.
- Do not expose app-server directly to the public internet.
- Do not persist approval decisions in phase 1.
- Default approval requests to decline until a real UI can ask the user.
- Treat `cwd` as a trusted local project selected by the user.

## Approval Handling

The Codex app-server may send server-initiated JSON-RPC requests for command execution or file changes. Phase 1 handles these requests through `onApprovalRequest` and returns a decline decision by default.

This keeps the first milestone safe while preserving the extension point needed for a future Web or mobile approval UI.

## Process Boundary

`apps/agent` starts `codex app-server --stdio` as a child process. JSON-RPC messages travel over stdin/stdout. Stderr is ignored by default and can be emitted for debug logging with `LOG_LEVEL=debug`.

Ctrl+C sends `turn/interrupt` when a turn is active and then closes the child process.

## Future Security Work

Later phases need additional controls before any remote control-plane feature ships:

- device identity and signing
- explicit project allowlists
- encrypted relay transport
- user-visible approval prompts
- audit log of approval decisions
- local secret storage for device keys
- no server-side storage of OpenAI tokens

