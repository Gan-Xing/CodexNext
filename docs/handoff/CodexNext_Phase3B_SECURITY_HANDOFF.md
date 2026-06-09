# CodexNext Phase 3B Handoff v2

## Phase name

**Phase 3B: Authenticated Relay Security Gate**

Subtitle: make CodexNext safe enough to expose a Web/control endpoint publicly.

## Why this phase exists

CodexNext is no longer a local-only experiment. It now has:

- `apps/control` relay server
- Socket.IO `/user` and `/machine` namespaces
- agent `connect` and `pair`
- relay RPC into local Codex sessions
- device pairing
- direct local agent mode
- Web Console relay mode

That means CodexNext can remotely drive Codex, and Codex can run commands, modify files, use the project workspace, and request/receive approvals. Public exposure without a real login gate is unacceptable.

The important clarification for this phase:

> Codex already has its own permission and sandbox controls. Phase 3B should not reimplement Codex permissions. Phase 3B must secure **who can access the control plane**, **which devices are trusted**, **how tokens are stored**, and **how public exposure is gated**.

Codex permissions are the last line of defense. They are not an authentication system.

## Current implementation status by layer

### Layer 1: Web login / user authentication

**Status: not sufficient for public deployment.**

Current code has a relay session bootstrap route:

- `apps/web/src/app/api/relay/session/route.ts`
- It reads `CODEXNEXT_RELAY_URL` / `NEXT_PUBLIC_CODEXNEXT_RELAY_URL`
- It reads `CODEXNEXT_OWNER_TOKEN`
- It calls control `/api/auth/session`
- It returns `{ relayUrl, sessionToken }` to the browser

Problem:

- There is no Web login check before issuing the browser relay session.
- If a public deployment has `CODEXNEXT_OWNER_TOKEN` configured, an unauthenticated visitor may be able to obtain a relay session token.
- There is no HttpOnly login cookie.
- There is no logout.
- There is no password/session lifecycle.

Required Phase 3B outcome:

- Public Web entry must require login.
- `/api/relay/session` must require login.
- `ownerToken` must never enter browser JS, URL, localStorage, or query strings.
- Browser should use an HttpOnly cookie to prove login to the Web server.
- The browser may receive a short-lived relay `sessionToken`, but it must not be stored long-term in localStorage. Prefer memory; sessionStorage is acceptable only if documented.

---

### Layer 2: Browser session / relay access session

**Status: partially implemented, needs TTL/revoke/hashing.**

Current control server has in-memory `browserSessions` and issues random session tokens. The user namespace accepts either `ownerToken` or `sessionToken`.

Problems:

- No TTL / expiration enforcement.
- No revoke/logout path.
- Browser session tokens are stored in plain memory.
- Web currently stores relay access tokens in localStorage.
- Query params such as `ownerToken` / `sessionToken` are parsed by the Web controller.

Required Phase 3B outcome:

- `browserSessions` must store only token hashes.
- Sessions must have `createdAt`, `lastUsedAt`, `expiresAt`.
- Expired sessions must be rejected and pruned.
- Add `/api/auth/logout` or `/api/relay/session/revoke`.
- Web must stop accepting `ownerToken` in URL in production.
- Web must stop persisting relay access tokens in localStorage in production.
- User namespace must reject expired/revoked sessions.

---

### Layer 3: Device pairing

**Status: MVP implemented, needs security hardening.**

Current agent `pair` flow:

- agent posts `/api/pairings/device`
- control creates 6-digit code and 5-minute expiration
- agent polls `/api/pairings/device/:requestId?pollToken=...`
- user approves `/api/pairings/requests/:code/approve`
- control stores device record
- agent then calls `connect`

Good:

- 5-minute TTL exists.
- pollToken exists.
- approve route requires user access.
- pairing is separate from normal device connect.

Problems:

- pairing creation is unauthenticated and not rate-limited.
- pairing code lookup is not rate-limited.
- approve does not expose a strong fingerprint challenge.
- no reject endpoint.
- no explicit one-time invalidation cleanup after approval/expiry.
- no audit log.
- no device revoke path.

Required Phase 3B outcome:

- Add rate limiting for pairing create / lookup / approve.
- Add device fingerprint display: `deviceId`, `hostname`, `platform`, `arch`, `agentVersion`, `codexVersion`, `shortFingerprint`.
- Add explicit reject endpoint.
- Pairing request must be one-time use.
- Expired pairings should be pruned.
- Add audit logs for create/approve/reject/expire.
- Add device revoke endpoint and UI.

---

### Layer 4: Device identity / device token

**Status: implemented, but token storage is too weak for public relay.**

Current implementation:

- agent stores `~/.codexnext/device.json` with `deviceId`, `deviceName`, `deviceToken`
- control stores `deviceToken` in `~/.codexnext/control-devices.json`
- machine namespace accepts `ownerToken` or registry-authorized `deviceToken`

Problems:

- control stores device tokens in plaintext.
- `device.json` write does not explicitly set `0600`.
- `ownerToken` can be used by machine connection, which is convenient but should be restricted to bootstrap/dev mode.
- no device revoke path.
- no token rotation path.

Required Phase 3B outcome:

- Control must store `deviceTokenHash`, not plaintext token.
- Use HMAC-SHA256 with a server-side pepper or a password-hash style KDF. At minimum, `HMAC(serverSecret, deviceToken)`.
- Compare hashes with timing-safe comparison.
- `device.json` should be written with restrictive permissions where possible.
- Add device revoke: revoked devices cannot connect even if they still hold their old token.
- Add optional token rotation after pairing/revoke.
- `ownerToken` in machine auth should be marked dev/bootstrap-only and disabled in production unless explicitly allowed.

---

### Layer 5: Codex permission / sandbox / approval

**Status: already implemented at the Codex layer; do not reimplement.**

Current `resolvePermissions()` maps:

- `request-approval` -> `approvalPolicy: "on-request"`, `approvalsReviewer: "user"`, `sandbox: "workspace-write"`
- `auto-approve` -> `approvalPolicy: "on-request"`, `approvalsReviewer: "auto_review"`, `sandbox: "workspace-write"`
- `full-access` -> `approvalPolicy: "never"`, `sandbox: "danger-full-access"`
- `custom-config` -> pass-through explicit config

This means Codex permissions exist and are correctly delegated to Codex app-server.

Phase 3B should add only product-level safety guardrails:

- relay mode should default to `request-approval`
- `full-access` over relay should be disabled by default unless `CODEXNEXT_ALLOW_RELAY_FULL_ACCESS=1`
- UI must show a strong warning before full-access
- approval decisions should be audit logged
- never treat Codex approval as Web authentication

## Required implementation plan

### 1. Add Web auth module

Add:

```txt
apps/web/src/lib/server-auth.ts
apps/web/src/app/login/page.tsx
apps/web/src/app/api/auth/login/route.ts
apps/web/src/app/api/auth/logout/route.ts
apps/web/src/app/api/auth/status/route.ts
```

Environment:

```txt
CODEXNEXT_WEB_AUTH_PASSWORD_HASH=<hash>
CODEXNEXT_WEB_SESSION_SECRET=<random 32+ bytes>
CODEXNEXT_PUBLIC_ORIGIN=https://your-domain.example
CODEXNEXT_RELAY_URL=http://127.0.0.1:3002
CODEXNEXT_OWNER_TOKEN=<server-only root token>
```

Implementation requirements:

- Use HttpOnly cookie.
- Cookie must be `Secure` in production.
- Cookie must be `SameSite=Lax` or `Strict`.
- Cookie must have TTL.
- Password hash must not be plaintext.
- Provide a CLI/helper script to generate password hash, or document using Node crypto.
- Failed logins must be rate-limited.
- Do not leak whether password hash is configured.

### 2. Protect Web app and relay bootstrap

Update:

```txt
apps/web/src/app/api/relay/session/route.ts
```

Requirements:

- Require logged-in cookie.
- If not logged in, return 401.
- Server may use `CODEXNEXT_OWNER_TOKEN` to call control `/api/auth/session`.
- Browser receives only a short-lived `sessionToken`.
- Browser must not receive ownerToken.

Update Web console bootstrap:

- Remove production support for `?ownerToken=...`.
- Remove production support for `?sessionToken=...` unless `NEXT_PUBLIC_CODEXNEXT_ALLOW_URL_TOKEN=1`.
- Stop writing relay access token to localStorage in production.
- Prefer memory token state; refresh through `/api/relay/session` after reload.

### 3. Harden control browser sessions

Update:

```txt
apps/control/src/server.ts
apps/control/src/auth.ts
```

Requirements:

- `browserSessions` stores `tokenHash`, not raw token.
- Add TTL: default 8 hours.
- Add idle timeout: default 2 hours.
- Add prune interval.
- Add revoke endpoint.
- User namespace validates session expiration.
- `/api/auth/session` should create a short-lived session only when called with owner token by trusted Web server.
- Add rate limits to `/api/auth/session`.

### 4. Harden CORS and public mode

Update control server options:

```txt
--public-origin <origin>
--allow-origin <origin>
--production
```

Rules:

- In production, do not allow `origin: true`.
- Require explicit allowed origins.
- Socket.IO CORS must match allowed origins.
- If host is `0.0.0.0` and no auth/session secret is configured, fail fast.
- If `CODEXNEXT_PUBLIC_ORIGIN` is not HTTPS in production, warn or fail unless `CODEXNEXT_ALLOW_INSECURE_PUBLIC=1`.

### 5. Harden pairing

Update:

```txt
apps/control/src/server.ts
apps/agent/src/commands/pair.ts
```

Requirements:

- Add rate limit by IP and by deviceId.
- Add `shortFingerprint` to pairing view.
- Add reject endpoint:
  - `POST /api/pairings/requests/:code/reject`
- Approve/reject requires logged-in user access.
- Expired pairings are not returned as pending.
- Approved/rejected/expired pairings are one-time and pruned.
- Add audit events.

### 6. Harden device registry

Update:

```txt
apps/control/src/device-registry.ts
apps/agent/src/relay/device-identity.ts
```

Requirements:

- Replace `deviceToken` with `deviceTokenHash` in persisted control registry.
- Support migration:
  - if old plaintext `deviceToken` exists, convert to hash on load/save.
- Add `revokedAt?: number`.
- `isAuthorized()` must reject revoked devices.
- Use timing-safe comparison.
- Write registry with restrictive permissions where possible.
- Write agent `device.json` with restrictive permissions where possible.
- Add revoke endpoint:
  - `DELETE /api/devices/:deviceId`
- On revoke, disconnect active machine socket.

### 7. Relay full-access guard

Update session creation path:

- If request comes through relay and asks for `permissionMode: "full-access"`, reject unless env `CODEXNEXT_ALLOW_RELAY_FULL_ACCESS=1`.
- UI should hide full-access in relay mode unless allowed.
- If allowed, require an extra confirmation step.

### 8. Audit log

Add:

```txt
apps/control/src/audit-log.ts
```

Events:

- login success/failure
- session issue
- logout/revoke
- device pair create/approve/reject/expire
- device connect/disconnect
- device revoke
- relay RPC call: deviceId, method, sessionId if available, result status
- approval decision
- failed auth attempt

Do not log:

- ownerToken
- sessionToken
- deviceToken
- prompt content
- command output
- full file paths unless needed; prefer basename or redacted path

### 9. Documentation

Add/update:

```txt
docs/PHASE3B_SECURITY_GATE.md
docs/ADR/0004-authenticated-relay-security-gate.md
docs/SECURITY.md
README.md
```

Docs must clearly explain:

- direct mode is dev/local only
- relay mode is recommended for remote/mobile
- public Web requires login
- ownerToken is server-only
- device pairing flow
- revoke flow
- token rotation procedure
- emergency shutdown procedure

## Non-goals

Do not implement in this phase:

- React Native app
- OAuth/passkey
- multi-user SaaS
- complete E2E encryption
- non-Codex agents
- Codex TUI parsing
- general shell/file APIs
- deletion of direct mode

## Acceptance checklist

Automated:

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm --filter @codexnext/agent dev -- doctor
```

Manual security checks:

1. Public Web without login shows only login page.
2. Unauthenticated `POST /api/relay/session` returns 401.
3. Wrong password is rejected and rate-limited.
4. Successful login sets HttpOnly cookie.
5. Browser localStorage no longer contains ownerToken.
6. Reloading Web obtains relay session through cookie-protected `/api/relay/session`.
7. Pairing page requires login before approve/reject.
8. Pairing code expires after 5 minutes.
9. Rejected pairing cannot be reused.
10. Revoked device cannot reconnect.
11. Control registry no longer stores plaintext deviceToken.
12. Direct mode still works on localhost.
13. Remote direct mode requires explicit opt-in.
14. Relay full-access is blocked by default.
15. Approval decisions are audit logged.
16. Logging output never prints ownerToken/sessionToken/deviceToken.

## Prompt for implementation AI

```text
你正在开发 CodexNext。当前项目已经有 apps/control、Socket.IO relay、agent connect/pair、Web relay mode 和 Codex permissions。现在要实现 Phase 3B: Authenticated Relay Security Gate。

关键判断：
Codex app-server 已经有权限和 sandbox 控制，不要重写 Codex 权限。Phase 3B 要解决的是公网入口登录、relay session、device pairing、device token、CORS、direct mode 和审计日志。

必须先阅读：
- apps/web/src/app/api/relay/session/route.ts
- apps/web/src/lib/relay.ts
- apps/web/src/lib/api.ts
- apps/web/src/features/console/use-web-console-controller.ts
- apps/web/src/features/devices/device-utils.ts
- apps/control/src/server.ts
- apps/control/src/auth.ts
- apps/control/src/device-registry.ts
- apps/agent/src/commands/pair.ts
- apps/agent/src/commands/connect.ts
- apps/agent/src/commands/serve.ts
- apps/agent/src/relay/device-identity.ts
- apps/agent/src/local-server/session-manager.ts

必须实现：
1. Web 登录页和登录/logout/status API，使用 HttpOnly cookie。
2. /api/relay/session 必须要求登录；未登录返回 401。
3. ownerToken 只能在服务端使用，不能进入浏览器 URL、localStorage、JS state。
4. relay session token 短 TTL；不要长期保存到 localStorage。
5. control browserSessions 存 tokenHash，加 expiresAt、idle timeout、revoke/prune。
6. production CORS 禁止 origin:true，必须配置 allowed origins。
7. pairing create/lookup/approve/reject 加 rate limit；approve/reject 必须登录。
8. pairing view 增加 shortFingerprint；pairing one-time and pruned。
9. device registry 不再明文保存 deviceToken，改为 deviceTokenHash；支持迁移旧文件。
10. device revoke endpoint；revoked device 不能再连，已连接 socket 要断开。
11. agent device.json 用更严格文件权限写入。
12. direct remote mode 需要显式 --allow-remote-direct；否则只允许 loopback。
13. codex relay full-access 默认禁用，除非 CODEXNEXT_ALLOW_RELAY_FULL_ACCESS=1。
14. 添加 audit log，记录登录、pairing、device connect/revoke、relay RPC、approval decision，不记录敏感 token 和 prompt 内容。
15. 更新 README、SECURITY、docs/PHASE3B_SECURITY_GATE.md、docs/ADR/0004-authenticated-relay-security-gate.md。
16. 添加测试覆盖未登录不能获得 relay session、session TTL/revoke、device token hash、revoked device denied、pairing auth/rate-limit、direct remote guard、relay full-access guard。

不要做：
- React Native
- OAuth/passkey
- 多用户 SaaS
- 完整 E2E encryption
- 非 Codex agent
- 任意 shell/file API
- 删除 direct mode

验收：
未登录打开公网 Web 只能看到登录页；未登录 POST /api/relay/session 返回 401；登录后可看到设备并控制 Codex；退出登录后刷新不能继续控制；设备 revoke 后不能重连；control-devices.json 不含明文 deviceToken；relay full-access 默认被拒绝。
```
