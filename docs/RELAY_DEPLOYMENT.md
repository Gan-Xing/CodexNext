# Relay Deployment

CodexNext deployment should be described by **service roles**, not by a fixed OS topology.

## Service Roles

`control`:
- relay control plane
- keeps device presence
- relays RPC and event replay
- handles pairing, revoke, and relay-side security gate

`web`:
- public browser/mobile UI
- handles login cookie
- bootstraps relay sessions

`agent`:
- represents one controllable Codex machine
- runs locally next to Codex
- keeps one outbound relay connection
- delegates approvals, sandbox, and permissions to Codex itself

Any host can run any subset of these roles if the dependencies are available.

## Common Deployment Shapes

Typical public control plane:

- one host runs `control + web`
- each controllable machine runs `agent`

If the control-plane host should also be controllable, add `agent` there too:

- `control + web + agent`

Typical node-only machine:

- `agent`

These are examples, not platform restrictions.

You may choose to run:

- all three roles on Linux
- all three roles on macOS
- only `agent` on Linux/macOS/Windows
- `control + web` on one host and `agent` on many others

## Recommended Ports

Example public control-plane ports:

- Web: `3002`
- Control: `3922`

Browser/mobile should only need:

- `http://144.217.243.161:3002`

Agent nodes pair/connect to:

- `http://144.217.243.161:3922`

## Long-Running Process Model

## Recommended Installers

Use the bundled install scripts when they match your platform and service manager.

### Linux `systemd`

Default install:

```bash
./scripts/ops/install-linux-services.sh
```

This installs:

- `codexnext-control`
- `codexnext-web`
- `codexnext-agent`

Agent-only install:

```bash
./scripts/ops/install-linux-services.sh --roles agent
```

You can also choose a subset explicitly:

```bash
./scripts/ops/install-linux-services.sh --roles control,web
./scripts/ops/install-linux-services.sh --roles web,agent
```

### macOS `launchd`

Bundled helper for the outbound relay agent:

```bash
./scripts/ops/install-macos-agent.sh
```

This writes a `launchd` plist and an editable env file under `~/.codexnext/relay-agent.env`.

Today the bundled macOS installer targets `agent`. That is a tooling coverage choice, not a product restriction.
If you want to run `control` and `web` on macOS too, use the same runtime commands and wire them into your preferred process manager.

### Windows

There is no bundled Windows service-manager installer yet.
The same three roles still apply; run them with your preferred Windows process manager.

### Linux `systemd`

Use `systemd` with:

- `Restart=always`
- `After=network-online.target`
- env files in `/etc/codexnext/*.env`

Templates are in:

- [ops/systemd/codexnext-control.service.example](/Users/ganxing/Desktop/Dev/codexnext/ops/systemd/codexnext-control.service.example)
- [ops/systemd/codexnext-web.service.example](/Users/ganxing/Desktop/Dev/codexnext/ops/systemd/codexnext-web.service.example)
- [ops/systemd/codexnext-agent.service.example](/Users/ganxing/Desktop/Dev/codexnext/ops/systemd/codexnext-agent.service.example)

Env examples:

- [ops/systemd/control.env.example](/Users/ganxing/Desktop/Dev/codexnext/ops/systemd/control.env.example)
- [ops/systemd/web.env.example](/Users/ganxing/Desktop/Dev/codexnext/ops/systemd/web.env.example)
- [ops/systemd/agent.env.example](/Users/ganxing/Desktop/Dev/codexnext/ops/systemd/agent.env.example)

Runtime scripts:

- [scripts/ops/run-control.sh](/Users/ganxing/Desktop/Dev/codexnext/scripts/ops/run-control.sh)
- [scripts/ops/run-web.sh](/Users/ganxing/Desktop/Dev/codexnext/scripts/ops/run-web.sh)
- [scripts/ops/run-relay-agent.sh](/Users/ganxing/Desktop/Dev/codexnext/scripts/ops/run-relay-agent.sh)
- [scripts/ops/install-linux-services.sh](/Users/ganxing/Desktop/Dev/codexnext/scripts/ops/install-linux-services.sh)
- [scripts/ops/detect-codex-bin.sh](/Users/ganxing/Desktop/Dev/codexnext/scripts/ops/detect-codex-bin.sh)
- [scripts/ops/build-web.sh](/Users/ganxing/Desktop/Dev/codexnext/scripts/ops/build-web.sh)

### macOS `launchd`

Use `launchd` with `KeepAlive`.

Templates are in:

- [ops/launchd/com.codexnext.relay-agent.plist.template](/Users/ganxing/Desktop/Dev/codexnext/ops/launchd/com.codexnext.relay-agent.plist.template)
- [ops/launchd/relay-agent.env.example](/Users/ganxing/Desktop/Dev/codexnext/ops/launchd/relay-agent.env.example)
- [ops/launchd/run-relay-agent.sh](/Users/ganxing/Desktop/Dev/codexnext/ops/launchd/run-relay-agent.sh)
- [scripts/ops/install-macos-agent.sh](/Users/ganxing/Desktop/Dev/codexnext/scripts/ops/install-macos-agent.sh)

## Deploy Order

### 1. Prepare the host that will expose the public Web and relay

Clone/update the repo, then:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
```

Build the Web with production env:

```bash
export CODEXNEXT_RELAY_URL=http://144.217.243.161:3922
export CODEXNEXT_OWNER_TOKEN=...
export CODEXNEXT_PUBLIC_ORIGIN=http://144.217.243.161:3002
export CODEXNEXT_WEB_AUTH_PASSWORD_HASH=...
export CODEXNEXT_WEB_SESSION_SECRET=...
./scripts/ops/build-web.sh
```

Install env files:

- `/etc/codexnext/control.env`
- `/etc/codexnext/web.env`
- `/etc/codexnext/agent.env`

The install script will create them from examples if they do not exist yet.

Install service units from the templates, replacing:

- `__CODEXNEXT_ROOT__`
- `__CODEXNEXT_USER__`

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now codexnext-control
sudo systemctl enable --now codexnext-web
sudo systemctl enable --now codexnext-agent
```

If you use the installer instead, the shorter form is:

```bash
./scripts/ops/install-linux-services.sh
```

### 2. Pair any machine that should appear as a controllable device

Run once on that machine:

```bash
pnpm --filter @codexnext/agent dev -- pair --relay http://144.217.243.161:3922 --device-name YourDeviceName
```

Approve it from the Web UI. After that, the long-running `agent` service can reconnect by itself.

If the machine is macOS and you want the bundled launchd flow:

Or use the installer:

```bash
./scripts/ops/install-macos-agent.sh
```

## What The Phone Should Do

The phone only needs:

- open `http://144.217.243.161:3002`
- log in
- choose whichever paired device is online

The phone should **not** need:

- agent token
- direct endpoint
- `web-origin`
- Tailscale access to each machine

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

## Operational Notes

- `control` and `agent` currently run from source through `tsx`
- `web` runs as `next start` from a built production bundle
- this is fine for long-running service management as long as `systemd`/`launchd` owns restart policy
- `run-relay-agent.sh` auto-discovers `codex` from common install paths if `CODEXNEXT_CODEX_BIN` is unset or not on `PATH`
- for locked-down environments, set `CODEXNEXT_CODEX_BIN` to an absolute binary path in the env file

## Example Topology

One valid example is:

- public host:
  - `control + web`
- public host, if also controllable:
  - add `agent`
- each additional machine:
  - `agent`
- phone/browser:
  - only the public Web URL
