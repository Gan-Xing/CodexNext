# CodexNext

Your personal Codex control plane.

CodexNext is a relay-first control plane for Codex app-server. Users sign in to the Web UI, pair machines into a control server, and then control those machines from one browser entry. Product UX is relay-only: no Agent URL, Access Token, `?agent=`, or `?token=` in normal use.

## Included

- `packages/protocol`
- `packages/codex-client`
- `apps/agent`
- `apps/control`
- `apps/web`
- relay login gate
- device pairing and revoke
- recent-first history loading
- shared recent-page cache for thread switching
- docs and ADRs
- `codexnext doctor`
- `codexnext goal-smoke`
- `codexnext pair`
- `codexnext connect`

## Not Included

- React Native
- OAuth / passkeys
- multi-user SaaS authorization
- non-Codex CLIs
- a rewritten Codex permission system

## Requirements

- Node >= 20
- pnpm
- Codex CLI with `codex app-server`
- a valid Codex login/session on each machine that will run an agent

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

## Relay-Only Product Topology

Think in service roles, not in one fixed machine layout:

- `control`
  - device presence
  - relay RPC
  - event replay
  - pairing / revoke
  - audit log
- `web`
  - login page
  - HttpOnly cookie session
  - relay session bootstrap
  - browser/mobile UI
- `agent`
  - one controllable Codex machine
  - outbound connection to control
  - local Codex execution
  - approvals still enforced by Codex itself

Common topology:

- one server runs `control + web + agent`
- every additional machine runs `agent`
- browsers and phones open only the Web URL

## Start The Relay Control Plane

Generate a password hash for the Web login gate:

```bash
node -e 'const {randomBytes,scryptSync}=require("node:crypto");const password=process.argv[1];const salt=randomBytes(16);const hash=scryptSync(password,salt,64);console.log(`scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`)' "your-password"
```

Start the control server:

```bash
pnpm --filter @codexnext/control dev --   --owner-token "$CODEXNEXT_OWNER_TOKEN"   --host 0.0.0.0   --port 3922   --production   --allow-origin https://your-web-origin.example
```

Start the Web app:

```bash
CODEXNEXT_RELAY_URL=http://127.0.0.1:3922 CODEXNEXT_OWNER_TOKEN="$CODEXNEXT_OWNER_TOKEN" CODEXNEXT_WEB_AUTH_PASSWORD_HASH="$CODEXNEXT_WEB_AUTH_PASSWORD_HASH" CODEXNEXT_WEB_SESSION_SECRET="$CODEXNEXT_WEB_SESSION_SECRET" CODEXNEXT_PUBLIC_ORIGIN=https://your-web-origin.example pnpm --filter @codexnext/web dev
```

Pair a machine into the relay:

```bash
pnpm --filter @codexnext/agent dev -- pair --relay http://relay-host:3922
```

After pairing, the machine appears in the Web UI automatically.

## Long-Running Deployment

For Linux `systemd`, macOS `launchd`, and service-role deployment examples, see:

- [docs/RELAY_DEPLOYMENT.md](./docs/RELAY_DEPLOYMENT.md)

Bundled helpers currently cover:

- Linux `systemd`
  - any subset of `control,web,agent`
- macOS `launchd`
  - bundled helper currently targets `agent`
- Windows
  - no bundled service-manager helper yet
  - the same roles still apply

Linux install examples:

```bash
./scripts/ops/install-linux-services.sh
./scripts/ops/install-linux-services.sh --roles agent
./scripts/ops/install-linux-services.sh --roles control,web
```

macOS agent install example:

```bash
./scripts/ops/install-macos-agent.sh
```

The agent startup helpers auto-discover a usable `codex` binary from common locations such as `PATH`, `~/.local/bin`, `~/bin`, and `~/.nvm/versions/node/*/bin`.

## Security Notes

- public relay Web requires login
- `ownerToken` is server-only
- relay session tokens are issued after login and should not be persisted client-side
- relay full-access follows Codex by default; set `CODEXNEXT_DISABLE_RELAY_FULL_ACCESS=1` on the control server only if you intentionally want an extra relay-only safety gate
- approvals and sandbox enforcement remain Codex-native

## Hidden Dev-Only Direct Mode

Direct mode is no longer part of the normal product path.

A hidden local troubleshooting path still exists for development only:

```bash
CODEXNEXT_ENABLE_DEV_DIRECT=1 pnpm --filter @codexnext/agent dev -- dev-serve --host 127.0.0.1 --port 17361
```

This command is intentionally hidden from normal UX and does not print tokenized Web URLs.
