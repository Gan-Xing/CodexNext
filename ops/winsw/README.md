# CodexNext WinSW Templates

These XML templates describe the three CodexNext service roles for Windows Service Wrapper:

- `codexnext-control.xml.template` for the relay control API and Socket.IO relay.
- `codexnext-web.xml.template` for the web console.
- `codexnext-agent.xml.template` for an outbound relay agent.

Copy the matching template next to the WinSW executable, rename it to match that executable, and replace the example `env` values before installing the service. The templates intentionally keep environment configuration inline so they mirror the existing Linux `systemd` env files without introducing a second Windows-specific config format.

Validate template drift from the repo root with:

```bash
pnpm test:winsw
```
