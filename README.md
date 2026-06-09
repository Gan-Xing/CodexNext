# CodexNext

Your personal Codex control plane.

CodexNext is a Codex app-server first personal AI programming control plane. It now supports:

- direct localhost mode for local development
- relay mode for multi-device control through `apps/control`
- browser login gating for public relay deployments
- device pairing and revoke
- Codex approvals and sandbox controls delegated to Codex itself

## Phase 1 Scope

Included:

- pnpm monorepo
- `packages/protocol`
- `packages/codex-client`
- `apps/agent`
- `apps/web`
- `apps/control`
- docs and ADR
- `codexnext doctor`
- `codexnext goal-smoke --cwd <path> --goal <text> [--model <model>] [--token-budget <number>]`
- `codexnext serve`
- `codexnext pair`
- `codexnext connect`

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

## Run The Local Web Console

Start the local agent:

```bash
pnpm --filter @codexnext/agent dev -- serve \
  --host 127.0.0.1 \
  --port 17361 \
  --web-origin http://127.0.0.1:3000
```

Remote direct mode is disabled by default. To bind beyond loopback, you must opt in explicitly:

```bash
pnpm --filter @codexnext/agent dev -- serve \
  --host 0.0.0.0 \
  --port 17361 \
  --web-origin http://127.0.0.1:3000 \
  --allow-remote-direct
```

Start the Web Console:

```bash
pnpm --filter @codexnext/web dev
```

The Web dev server listens on `0.0.0.0:3000`, so the page is reachable from this Mac and from trusted devices on the same local network. Open the URL printed by `serve`. The page connects to the local agent, starts Codex sessions, sends chat messages, steers active turns, interrupts turns, manages Goals through `thread/goal/*`, streams app-server events, and resolves approval requests in the browser.

## Run The Relay Control Plane

Generate a password hash for the Web login gate:

```bash
node -e 'const {randomBytes,scryptSync}=require("node:crypto");const password=process.argv[1];const salt=randomBytes(16);const hash=scryptSync(password,salt,64);console.log(`scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`)' "your-password"
```

Start the control server:

```bash
pnpm --filter @codexnext/control dev -- \
  --owner-token "$CODEXNEXT_OWNER_TOKEN" \
  --host 0.0.0.0 \
  --port 3922 \
  --production \
  --allow-origin https://your-web-origin.example
```

Start the Web app against the relay:

```bash
CODEXNEXT_RELAY_URL=http://127.0.0.1:3922 \
CODEXNEXT_OWNER_TOKEN="$CODEXNEXT_OWNER_TOKEN" \
CODEXNEXT_WEB_AUTH_PASSWORD_HASH="$CODEXNEXT_WEB_AUTH_PASSWORD_HASH" \
CODEXNEXT_WEB_SESSION_SECRET="$CODEXNEXT_WEB_SESSION_SECRET" \
CODEXNEXT_PUBLIC_ORIGIN=https://your-web-origin.example \
pnpm --filter @codexnext/web dev
```

Pair a machine into the relay:

```bash
pnpm --filter @codexnext/agent dev -- pair --relay http://relay-host:3922
```

For long-running multi-device deployment with Linux `systemd` and macOS `launchd`, see:

- [docs/RELAY_DEPLOYMENT.md](/Users/ganxing/Desktop/Dev/codexnext/docs/RELAY_DEPLOYMENT.md)

Relay security notes:

- public relay Web requires login
- `ownerToken` is server-only
- relay browser sessions are short-lived and not persisted to `localStorage`
- relay `full-access` follows Codex by default; use `CODEXNEXT_DISABLE_RELAY_FULL_ACCESS=1` only if you want to turn it off at the relay gate
- device revocation disconnects the machine and blocks future reconnects

## Design Lab

Open `http://127.0.0.1:3000/design` while the Web app is running to review the fake-data UI workbench before wiring real agent logic. Stable design routes include `/design/new-session`, `/design/thread`, `/design/approval`, `/design/device`, `/design/components`, and `/design/archive`.

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

If relay Web keeps returning `401` on `/api/relay/session`, check:

- login cookie exists and is not expired
- `CODEXNEXT_WEB_SESSION_SECRET` is set
- `CODEXNEXT_WEB_AUTH_PASSWORD_HASH` is set
- `CODEXNEXT_OWNER_TOKEN` is available to the Web server process

If relay devices do not appear, check:

- control server `--allow-origin` includes the Web origin
- the machine has completed `codexnext pair`
- the device was not revoked

## Package Layout

- `packages/protocol`: shared JSON-RPC, Codex method names, lightweight app-server types, and Zod CLI validation.
- `packages/codex-client`: JSON-RPC client, stdio transport, Codex app-server wrappers, and approval callback routing.
- `apps/agent`: CLI commands and human-readable smoke-test event output.
- `apps/web`: Next.js App Router local Web Console for Phase 2A.
