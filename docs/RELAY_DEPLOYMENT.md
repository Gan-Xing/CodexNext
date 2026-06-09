# Relay Deployment

This is the recommended long-running deployment model for CodexNext:

- one Linux server hosts the public relay control plane
- each machine you want to control runs one outbound relay agent
- browser and mobile only open the public Web URL

## Your Target Topology

For the setup you described:

- `144` Linux server:
  - `control`
  - `web`
  - `agent` for the Linux machine itself
- `Macmini`:
  - one relay `agent`
- `MacBook Air`:
  - optional later
- `phone`:
  - only opens the Linux Web page

That means:

- yes, the Linux server should run **three long-running services** if you want to control the Linux box itself
- yes, the `Macmini` only needs **one long-running relay agent service**

## Why Linux Needs 3 Services

`control`:
- the relay control plane
- keeps device presence
- relays RPC and event replay

`web`:
- the public browser/mobile UI
- handles login cookie
- bootstraps relay sessions

`agent`:
- represents the Linux server itself as a controllable Codex machine
- without this third service, the Linux server hosts the control plane but does not appear as a device

## Why Macmini Needs 1 Service

The `Macmini` does not need to expose Web or control:

- it does not need a public HTTP agent port
- it only needs one outbound relay agent connection
- after first pairing, it reconnects with its persisted local device identity

## Recommended Ports

On Linux:

- Web: `3002`
- Control: `3922`

Browser/mobile should only need:

- `http://144.217.243.161:3002`

Machines pair/connect to:

- `http://144.217.243.161:3922`

## Long-Running Process Model

### Linux

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
- [scripts/ops/build-web.sh](/Users/ganxing/Desktop/Dev/codexnext/scripts/ops/build-web.sh)

### macOS

Use `launchd` with `KeepAlive`.

Templates are in:

- [ops/launchd/com.codexnext.relay-agent.plist.template](/Users/ganxing/Desktop/Dev/codexnext/ops/launchd/com.codexnext.relay-agent.plist.template)
- [ops/launchd/relay-agent.env.example](/Users/ganxing/Desktop/Dev/codexnext/ops/launchd/relay-agent.env.example)
- [ops/launchd/run-relay-agent.sh](/Users/ganxing/Desktop/Dev/codexnext/ops/launchd/run-relay-agent.sh)

## Deploy Order

### 1. Linux server

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

### 2. Pair the Linux machine once

If the Linux agent has not been paired yet, run once on the Linux server:

```bash
pnpm --filter @codexnext/agent dev -- pair --relay http://144.217.243.161:3922 --device-name Linux
```

Approve it from the Web UI. After that, the systemd `codexnext-agent` service can reconnect by itself.

### 3. Pair the Macmini once

Run once on the `Macmini`:

```bash
pnpm --filter @codexnext/agent dev -- pair --relay http://144.217.243.161:3922 --device-name Macmini
```

Approve it from the phone or browser using the Linux Web page.

After pairing succeeds:

- copy `ops/launchd/relay-agent.env.example` to `~/.codexnext/relay-agent.env`
- fill in the real relay URL and device name
- install the launchd plist template with the real repo path
- load it with `launchctl`

## What The Phone Should Do

The phone only needs:

- open `http://144.217.243.161:3002`
- log in
- choose `Linux` or `Macmini`

The phone should **not** need:

- agent token
- direct endpoint
- `web-origin`
- Tailscale access to each machine

## Updating Later

On Linux:

```bash
git pull
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
./scripts/ops/build-web.sh
sudo systemctl restart codexnext-control codexnext-web codexnext-agent
```

On Macmini:

```bash
git pull
pnpm install --frozen-lockfile
launchctl kickstart -k gui/$(id -u)/com.codexnext.relay-agent
```

## Operational Notes

- `control` and `agent` currently run from source through `tsx`
- `web` runs as `next start` from a built production bundle
- this is fine for long-running service management as long as `systemd`/`launchd` owns restart policy

## Recommended Final Shape For You

For your exact setup, the deployment should be:

### Linux 144

- `codexnext-control`
- `codexnext-web`
- `codexnext-agent`

### Macmini

- `codexnext-relay-agent`

### MacBook Air

- nothing yet

### Phone

- only `http://144.217.243.161:3002`
