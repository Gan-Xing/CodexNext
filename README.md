# CodexNext

Your personal Codex control plane.

CodexNext is a Codex app-server first personal AI programming control plane. Phase 1 is intentionally small: a TypeScript CLI smoke test that talks to `codex app-server` over stdio, sets a real Codex Goal through the app-server API, starts a turn, streams notifications, and declines approval requests through an explicit callback.

## Phase 1 Scope

Included:

- pnpm monorepo
- `packages/protocol`
- `packages/codex-client`
- `apps/agent`
- docs and ADR
- `codexnext doctor`
- `codexnext goal-smoke --cwd <path> --goal <text> [--model <model>] [--token-budget <number>]`

Not included:

- Web UI
- React Native
- NestJS server
- pairing
- multi-device sync
- non-Codex CLIs
- Codex TUI parsing
- simulated `/goal` slash-command input

## Requirements

- Node >= 20
- pnpm
- Codex CLI with `codex app-server`
- A valid Codex login/session for running a real turn

## Install

```bash
pnpm install
```

## Verify

```bash
pnpm typecheck
pnpm test
pnpm --filter @codexnext/agent dev -- doctor
```

## Run The Smoke Test

```bash
pnpm --filter @codexnext/agent dev -- goal-smoke \
  --cwd /path/to/repo \
  --goal "Inspect the project and make one small verifiable change"
```

Optional:

```bash
pnpm --filter @codexnext/agent dev -- goal-smoke \
  --cwd /path/to/repo \
  --goal "Inspect the project and make one small verifiable change" \
  --model gpt-5.4 \
  --token-budget 20000
```

The command starts `codex app-server --stdio`, sends `initialize`, sends the `initialized` notification, starts a thread, calls `thread/goal/set`, starts a turn, prints app-server notifications, and exits when the turn completes.

Ctrl+C sends `turn/interrupt` when a turn is active, then closes the child process.

## Approval Behavior

Phase 1 defaults command and file approval requests to decline. This is not hard-coded into JSON-RPC internals. It is implemented through `onApprovalRequest`, so later UI work can replace the callback with an approval dialog.

Covered methods:

- `item/commandExecution/requestApproval`
- `item/fileChange/requestApproval`
- `execCommandApproval`
- `applyPatchApproval`

## Troubleshooting

If `doctor` fails on Node:

```bash
node --version
```

Install Node >= 20 using your preferred Node version manager.

If `doctor` fails on pnpm:

```bash
corepack enable
corepack prepare pnpm@latest --activate
```

If `doctor` fails on Codex:

```bash
which codex
codex --version
codex app-server --help
```

Install or upgrade the Codex CLI, ensure `codex` is on `PATH`, and restart the shell or Codex app if the PATH was recently changed.

If `goal-smoke` fails with an app-server JSON-RPC error, check:

- Codex login state
- model access
- `cwd` exists and is readable
- the installed Codex CLI supports `thread/goal/set`
- the request did not exceed the default 60 second JSON-RPC timeout

## Package Layout

- `packages/protocol`: shared JSON-RPC, Codex method names, lightweight app-server types, and Zod CLI validation.
- `packages/codex-client`: JSON-RPC client, stdio transport, Codex app-server wrappers, and approval callback routing.
- `apps/agent`: CLI commands and human-readable smoke-test event output.

