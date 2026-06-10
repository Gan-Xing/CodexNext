# Relay Deployment

CodexNext deployment is described by service roles, not by a fixed OS topology.

## Service Roles

`control`

- Fastify + Socket.IO relay control plane
- browser relay sessions
- device presence, event replay, and relay RPC
- pairing, revoke, registry, and audit

`web`

- public browser/mobile UI
- Web login and HttpOnly cookie
- server-side relay session bootstrap

`agent`

- runs next to a local Codex installation
- keeps one outbound relay connection to control
- delegates approvals, sandboxing, and command enforcement to Codex app-server

Any host can run any subset of these roles.

## Common Topologies

Public control plane:

- one host runs `control + web`
- each controllable machine runs `agent`

Self-controlling public host:

- one host runs `control + web + agent`
- additional machines run `agent`

Agent-only machine:

- one machine runs only `agent`

Browser and future mobile clients open only the Web origin, for example:

```txt
https://<your-web-origin>
```

Agents pair/connect to the control origin, for example:

```txt
https://<your-relay-host>
```

For local development or private LAN testing, HTTP is acceptable:

```txt
http://127.0.0.1:3002
http://127.0.0.1:3922
```

For public production, put Web and control behind HTTPS. If control is exposed through a reverse proxy path or subdomain, use that HTTPS URL consistently for `CODEXNEXT_RELAY_URL` and agent `--relay`.

## Ports

Default examples:

- Web: `3002`
- Control: `3922`

These ports are examples. Reverse proxies may expose standard `443` public origins while forwarding to local service ports.

## Environment Matrix

| Role | Variable | Dev example | Production example | Notes |
| --- | --- | --- | --- | --- |
| control | `CODEXNEXT_OWNER_TOKEN` | `dev-owner-token` | long random secret | Server-only. Do not put in URLs or browser storage. |
| control | `CODEXNEXT_CONTROL_HOST` | `127.0.0.1` | `0.0.0.0` behind firewall/proxy | Bind address. |
| control | `CODEXNEXT_CONTROL_PORT` | `3922` | `3922` | Internal service port. |
| control | `CODEXNEXT_PRODUCTION` | unset or `0` | `1` | Enables production checks. |
| control | `CODEXNEXT_PUBLIC_WEB_ORIGIN` | `http://127.0.0.1:3002` | `https://<your-web-origin>` | Used for pairing approve links. |
| control | `CODEXNEXT_ALLOWED_ORIGINS` | optional | `https://<your-web-origin>` | Required in production. Comma-separated for multiple origins. |
| control | `CODEXNEXT_ALLOW_MACHINE_OWNER_TOKEN` | optional `1` | default `0` | Production machines should use paired device tokens. |
| control | `CODEXNEXT_DISABLE_RELAY_FULL_ACCESS` | optional `0` | optional `0` or `1` | Default is follows Codex / allowed. |
| control | `CODEXNEXT_HEARTBEAT_INTERVAL_MS` | `15000` | `15000` | Agent heartbeat interval. |
| control | `CODEXNEXT_STALE_DEVICE_TIMEOUT_MS` | unset | unset or explicit ms | Defaults to four heartbeat intervals. |
| control | `CODEXNEXT_RPC_TIMEOUT_MS` | `30000` | `30000` | Default relay RPC timeout. |
| web | `CODEXNEXT_RELAY_URL` | `http://127.0.0.1:3922` | `https://<your-relay-host>` | Server-side Web to control URL. |
| web | `CODEXNEXT_OWNER_TOKEN` | same as control | same as control | Used only server-side to mint relay sessions. |
| web | `CODEXNEXT_PUBLIC_ORIGIN` | `http://127.0.0.1:3002` | `https://<your-web-origin>` | Controls secure cookie behavior and public links. |
| web | `CODEXNEXT_WEB_AUTH_PASSWORD_HASH` | scrypt hash | scrypt hash | Generate with the README command. |
| web | `CODEXNEXT_WEB_SESSION_SECRET` | random secret | long random secret | Signs HttpOnly Web cookies. |
| agent | `CODEXNEXT_RELAY_URL` | `http://127.0.0.1:3922` | `https://<your-relay-host>` | Control URL used by pair/connect. |
| agent | `CODEXNEXT_DEVICE_NAME` | optional | optional | Display name. |
| agent | `CODEXNEXT_CODEX_BIN` | `codex` | explicit path if needed | Startup helper auto-discovers common paths if unset. |
| agent | `CODEXNEXT_APPROVAL_TIMEOUT_MS` | `300000` | `300000` | Local approval timeout. |

## Installers And Runtime Scripts

Linux `systemd` helper:

```bash
./scripts/ops/install-linux-services.sh
./scripts/ops/install-linux-services.sh --roles agent
./scripts/ops/install-linux-services.sh --roles control,web
```

macOS `launchd` helper for the outbound relay agent:

```bash
./scripts/ops/install-macos-agent.sh
```

Windows has no bundled service-manager installer yet. The same roles apply; run the scripts with your preferred process manager.

Templates and scripts:

- [ops/systemd/codexnext-control.service.example](../ops/systemd/codexnext-control.service.example)
- [ops/systemd/codexnext-web.service.example](../ops/systemd/codexnext-web.service.example)
- [ops/systemd/codexnext-agent.service.example](../ops/systemd/codexnext-agent.service.example)
- [ops/systemd/control.env.example](../ops/systemd/control.env.example)
- [ops/systemd/web.env.example](../ops/systemd/web.env.example)
- [ops/systemd/agent.env.example](../ops/systemd/agent.env.example)
- [ops/launchd/com.codexnext.relay-agent.plist.template](../ops/launchd/com.codexnext.relay-agent.plist.template)
- [ops/launchd/relay-agent.env.example](../ops/launchd/relay-agent.env.example)
- [scripts/ops/run-control.sh](../scripts/ops/run-control.sh)
- [scripts/ops/run-web.sh](../scripts/ops/run-web.sh)
- [scripts/ops/run-relay-agent.sh](../scripts/ops/run-relay-agent.sh)
- [scripts/ops/build-web.sh](../scripts/ops/build-web.sh)

## Deploy Order

1. Prepare the host that exposes Web and control:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm --filter @codexnext/agent dev -- doctor
```

2. Generate a Web password hash:

```bash
node -e 'const {randomBytes,scryptSync}=require("node:crypto");const password=process.argv[1];const salt=randomBytes(16);const hash=scryptSync(password,salt,64);console.log(`scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`)' "your-password"
```

3. Configure `control` and `web` env files from the examples.

4. Build Web with production env:

```bash
export CODEXNEXT_RELAY_URL=https://<your-relay-host>
export CODEXNEXT_OWNER_TOKEN=<long-random-owner-token>
export CODEXNEXT_PUBLIC_ORIGIN=https://<your-web-origin>
export CODEXNEXT_WEB_AUTH_PASSWORD_HASH=<scrypt-hash>
export CODEXNEXT_WEB_SESSION_SECRET=<long-random-session-secret>
./scripts/ops/build-web.sh
```

5. Start services through `systemd`, `launchd`, or your process manager.

6. Pair each controllable machine:

```bash
pnpm --filter @codexnext/agent dev -- pair --relay https://<your-relay-host> --device-name <device-name>
```

Approve the code from the Web UI. After approval, the long-running agent can reconnect using its device identity.

## Diagnostics

Local prerequisite check:

```bash
pnpm --filter @codexnext/agent dev -- doctor
```

Relay health and deployment diagnostics:

```bash
pnpm --filter @codexnext/agent dev -- doctor --relay https://<your-relay-host>
```

The doctor checks Node, pnpm, Codex CLI, device identity file permissions, relay health, Web/control env presence, production origin risks, and whether hidden direct mode is enabled. It reports secret presence and risk without printing raw token values.

The control health endpoint is intentionally safe:

```bash
curl https://<your-relay-host>/api/control/health
```

It returns operational counts and uptime, not owner tokens, session tokens, device tokens, prompts, assistant content, or command output.

## Updating Later

On a `systemd` host:

```bash
git pull
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
./scripts/ops/build-web.sh
sudo systemctl restart codexnext-control codexnext-web codexnext-agent
```

On a macOS host using the bundled launchd helper:

```bash
git pull
pnpm install --frozen-lockfile
launchctl kickstart -k gui/$(id -u)/com.codexnext.relay-agent
```

## Product Boundary

Users should only need the Web origin. They should not need an agent URL, direct endpoint, access token, owner token, `?agent=`, `?token=`, `?ownerToken=`, or per-machine VPN/Tailscale access.

Direct mode remains hidden dev-only troubleshooting and requires `CODEXNEXT_ENABLE_DEV_DIRECT=1`.
