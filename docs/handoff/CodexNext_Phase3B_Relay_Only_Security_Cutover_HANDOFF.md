# CodexNext Phase 3B-R: Relay-only Security Cutover Handoff

副标题：Your personal Codex control plane.

## 0. 背景

CodexNext 目前已经从本地直连 Agent 发展到 Socket.IO Relay 架构。现在的核心产品目标应当收敛为：

```txt
Web / Mobile Web / Future React Native
  -> authenticated CodexNext Web
  -> authenticated Control / Relay
  -> outbound codexnext-agent connect / pair
  -> local Codex app-server stdio
```

不要再让用户看到或管理 `agentUrl + token`。Direct mode 曾经适合 Phase 2 本地验证，但现在已经和公网多设备安全目标冲突。

## 1. 这次阶段的名字

**Phase 3B-R: Relay-only Security Cutover**

它是 Phase 3B 的一个更干净版本：把产品层直接切成 relay-only，同时保留必要的底层开发排障能力，但绝不再进入用户路径。

## 2. 当前代码状态判断

### 已经实现

- `apps/control` 已经存在，使用 Fastify + Socket.IO。
- Control server 已经有 `/user` 与 `/machine` namespace 的概念。
- Machine auth 已经支持 `deviceId + deviceToken`，也支持 `ownerToken` 作为 bootstrap/dev 方式。
- Agent 已经有 `codexnext pair`。
- Agent 已经有 `codexnext connect`。
- Pairing 已经支持 6 位 code、5 分钟 expiresAt、pollToken。
- Agent connect 已经会连接 Relay machine namespace、发送 `machine:hello`、heartbeat、处理 `rpc:request`。
- Web 已经支持 relay mode、saved relay devices、relay bootstrap。
- Web 仍然保留大量 direct mode 残留。

### 主要问题

当前 Web 和文档仍然在产品层暴露 direct mode：

- Web controller 仍解析 `?agent=...&token=...`。
- Web controller 仍解析 `?ownerToken=...&sessionToken=...` 并写入 localStorage。
- `AgentConnection` 仍是 direct/relay 混合。
- `SavedDevice` 仍是 direct/relay 混合。
- `agentFetch` 仍有 direct URL 分支。
- `DeviceSheet` 仍有 direct endpoint 输入。
- README 仍描述 direct local agent 流程。
- `agent serve` 仍会打印带 token 的 Web URL。

这些在 Phase 2 可接受，但在公网多设备控制平面中不可接受。

## 3. 关键产品决策

### 3.1 Web 产品必须 relay-only

用户路径中不再存在：

```txt
agentUrl
direct token
?agent=...
?token=...
保存 direct 设备
手填 agent endpoint
```

统一变成：

```txt
登录 Web
查看 Relay 设备列表
通过 pair code 绑定设备
选择设备
控制 Codex
```

### 3.2 本地开发也走三服务

本地开发默认流程：

```bash
# terminal 1
pnpm --filter @codexnext/control dev -- \
  --host 127.0.0.1 \
  --port 3002 \
  --owner-token <dev-owner-token>

# terminal 2
pnpm --filter @codexnext/web dev

# terminal 3
pnpm --filter @codexnext/agent dev -- pair \
  --relay http://127.0.0.1:3002 \
  --device-name "Local Mac"
```

或者配对过后：

```bash
pnpm --filter @codexnext/agent dev -- connect \
  --relay http://127.0.0.1:3002
```

### 3.3 `agent serve` 不再是用户功能

两种可接受实现方式：

**推荐实现 A：隐藏 dev-only**
- 保留 `serve` 底层代码和少量测试。
- CLI 命令改名为 `dev-serve` 或隐藏在 help 之外。
- 必须设置 `CODEXNEXT_ENABLE_DEV_DIRECT=1` 才能启动。
- 不再打印带 token 的 Web URL。
- README 用户流程不再提它。

**更激进实现 B：删除 CLI 命令**
- 删除正常 CLI 入口里的 `serve`。
- 保留 `createLocalServer` 仅供测试或后续内部 harness。
- 如果测试依赖太多，先不要删底层文件。

本阶段建议实现 A，避免一次性破坏测试；但产品层必须 100% relay-only。

## 4. 安全原则

1. **公网 Web 必须先登录。**
2. **未登录不能拿 relay session。**
3. **ownerToken 永远不进入浏览器 URL、localStorage、React state。**
4. **浏览器最多只持有短期 sessionToken，且只存在内存。刷新后通过 HttpOnly cookie 重新换取。**
5. **deviceToken 不明文保存在 control registry。**
6. **pairing approve/reject 必须登录。**
7. **direct remote mode 默认禁止。**
8. **Relay 下 full-access 默认允许，只有显式配置 `CODEXNEXT_DISABLE_RELAY_FULL_ACCESS=1` 时才禁止。**
9. **Codex app-server 权限系统继续作为最后一层，不在 CodexNext 重写。**
10. **审计日志不记录 prompt、token、完整命令输出，只记录 metadata。**

## 5. 本阶段必须完成的工作

### 5.1 Web 登录门禁

新增：

```txt
apps/web/src/app/login/page.tsx
apps/web/src/app/api/auth/login/route.ts
apps/web/src/app/api/auth/logout/route.ts
apps/web/src/app/api/auth/status/route.ts
apps/web/src/lib/server-auth.ts
```

要求：

- 登录使用密码。
- 密码 hash 使用 scrypt 或 argon2id。
- 支持 `CODEXNEXT_ADMIN_PASSWORD_HASH`。
- dev 环境可支持 `CODEXNEXT_ADMIN_PASSWORD`，但 production 必须拒绝明文密码 env。
- 登录成功设置 HttpOnly cookie。
- cookie 属性：
  - `HttpOnly`
  - `SameSite=Lax` 或 `Strict`
  - production 下必须 `Secure`
  - 有 maxAge / expires
- 未登录访问主控制台时显示登录页或重定向 `/login`。

### 5.2 `/api/relay/session` 必须登录

修改：

```txt
apps/web/src/app/api/relay/session/route.ts
```

要求：

- 未登录返回 401。
- 已登录后，server-side 使用 `CODEXNEXT_OWNER_TOKEN` 向 control 换取短期 relay sessionToken。
- 不返回 ownerToken。
- 返回的 sessionToken 只给前端内存使用，禁止写 localStorage。
- 如果没有 `CODEXNEXT_RELAY_URL` 或 `CODEXNEXT_OWNER_TOKEN`，返回明确错误或 204 dev fallback，但公网 production 必须 fail fast。

### 5.3 Web 删除 direct 产品路径

修改：

```txt
apps/web/src/lib/api.ts
apps/web/src/lib/event-stream.ts
apps/web/src/lib/relay.ts
apps/web/src/features/console/use-web-console-controller.ts
apps/web/src/features/devices/device-utils.ts
apps/web/src/components/sheets/DeviceSheet.tsx
```

要求：

- `AgentConnection` 改成 relay-only：
  ```ts
  export interface AgentConnection {
    mode: "relay";
    relayUrl: string;
    deviceId: string;
    sessionToken: string;
  }
  ```
  或者直接去掉 `mode` 字段：
  ```ts
  export interface AgentConnection {
    relayUrl: string;
    deviceId: string;
    sessionToken: string;
  }
  ```
- `agentFetch` 不再支持 direct URL。
- `openManagedEventStream` 不再支持 direct agent.
- 删除 `?agent`、`?token` 参数解析。
- 删除 `?ownerToken`、`?sessionToken` 参数解析。
- 删除 localStorage 中 relay access token 的长期保存。
- `SavedDevice` 只保留 relay device：
  ```ts
  interface SavedDevice {
    id: string;
    name: string;
    relayUrl: string;
    deviceId: string;
    hostname?: string | null;
    online?: boolean;
    codexVersion?: string | null;
    lastConnectedAt?: number | null;
  }
  ```
- 旧 localStorage 中 direct devices 要么忽略，要么迁移时丢弃并显示一次性提示：
  “Direct devices are no longer supported. Run `codexnext pair` to bind this device through Relay.”
- DeviceSheet 删除 `Agent URL` / `Access Token` 输入。
- DeviceSheet 默认显示:
  - 当前登录状态
  - Relay URL
  - 在线设备列表
  - Pair code 输入/扫码入口
  - 删除/撤销设备
- Web 文案统一：绑定设备、选择设备、在线/离线。

### 5.4 Control session 安全化

修改：

```txt
apps/control/src/server.ts
apps/control/src/auth.ts
```

要求：

- `browserSessions` 存 `tokenHash`，不要明文 token。
- `sessionToken` 有：
  - `createdAt`
  - `lastUsedAt`
  - `expiresAt`
  - idle timeout
- 定期 prune expired sessions。
- 新增 revoke/logout endpoint：
  ```txt
  POST /api/auth/session/revoke
  ```
- `userNamespace` 验证 sessionToken 时检查 TTL。
- 生产环境拒绝空 ownerToken、短 ownerToken、默认 ownerToken。
- `ownerToken` 只能服务端换 session 使用，不用于浏览器握手。

### 5.5 Device token hash 与 revoke

修改：

```txt
apps/control/src/device-registry.ts
apps/control/src/server.ts
apps/agent/src/relay/device-identity.ts
```

要求：

- control registry 不再保存明文 `deviceToken`。
- 保存：
  ```ts
  deviceTokenHash: string
  tokenHashVersion: 1
  ```
- hash 使用 HMAC-SHA256 或 scrypt。
- 认证时用 timingSafeEqual。
- 支持读取旧 `deviceToken` 记录并迁移为 hash，然后保存。
- 新增 revoke endpoint：
  ```txt
  DELETE /api/devices/:deviceId
  ```
- revoke 后：
  - registry 删除或标记 revoked。
  - 如果 device socket 在线，立即 disconnect。
  - Web 收到 device offline/remove。
  - agent 后续不能再 connect，必须重新 pair。
- agent `device.json` 写入权限尽量设置为 `0600`。

### 5.6 Pairing 加固

修改：

```txt
apps/control/src/server.ts
apps/web/src/app/pair/page.tsx
apps/web/src/lib/relay.ts
```

要求：

- `/pair` 页面必须登录后才能 approve/reject。
- pairing request 保持 5 分钟 TTL。
- pairing code lookup / approve / reject 加 rate limit。
- pairing approve 后一次性失效。
- 新增 reject：
  ```txt
  POST /api/pairings/requests/:code/reject
  ```
- pairing view 展示：
  - deviceName
  - hostname
  - platform / arch
  - agentVersion
  - codexVersion
  - relayUrl
  - short fingerprint
  - expiresAt
- 不展示 deviceToken。
- 过期 pairing 定期清理。

### 5.7 Relay full-access guard

修改：

```txt
apps/agent/src/local-server/session-manager.ts
apps/agent/src/local-server/local-agent.ts
```

或在 Relay RPC 层拦截：

- 如果 request 来自 relay，且 `permissionMode === "full-access"` 或 `sandbox === "danger-full-access"` 或 `approvalPolicy === "never"`：
  - 默认拒绝。
  - 返回清晰错误：
    “Relay full-access follows Codex by default. Set CODEXNEXT_DISABLE_RELAY_FULL_ACCESS=1 on the control server only if you intentionally want to block it.”
- 本地 dev-only direct/harness 可不受此限制，但用户路径 relay 默认必须限制。
- 不重写 Codex approval/sandbox，只是防止远程默认选择最危险模式。

### 5.8 `agent serve` 降级为 dev-only

修改：

```txt
apps/agent/src/index.ts
apps/agent/src/commands/serve.ts
README.md
```

要求：

- 正常 help 不再展示 `serve`。
- 或改成 `dev-serve`。
- 启动必须要求：
  ```txt
  CODEXNEXT_ENABLE_DEV_DIRECT=1
  ```
- 如果 host 不是 loopback，必须额外要求：
  ```txt
  --allow-remote-direct
  ```
- 不再打印带 token 的 Web URL。
- 只打印：
  ```txt
  API: http://127.0.0.1:17361
  Dev token generated. Use Authorization: Bearer <token>.
  ```
- 文档中只在 “Internal debugging” 小节提及。

### 5.9 审计日志

新增：

```txt
apps/control/src/audit-log.ts
```

记录：

- login success/failure
- logout
- relay session issued/revoked
- pairing created/approved/rejected/expired
- device connected/disconnected/revoked
- relay RPC method + deviceId + status + duration
- approval decision

禁止记录：

- ownerToken
- sessionToken
- deviceToken
- prompt content
- assistant content
- command full output
- file contents

## 6. 文件级改动清单

### Web

```txt
apps/web/src/app/login/page.tsx
apps/web/src/app/api/auth/login/route.ts
apps/web/src/app/api/auth/logout/route.ts
apps/web/src/app/api/auth/status/route.ts
apps/web/src/app/api/relay/session/route.ts
apps/web/src/lib/server-auth.ts
apps/web/src/lib/relay.ts
apps/web/src/lib/api.ts
apps/web/src/lib/event-stream.ts
apps/web/src/features/console/use-web-console-controller.ts
apps/web/src/features/devices/device-utils.ts
apps/web/src/components/sheets/DeviceSheet.tsx
apps/web/src/app/pair/page.tsx
```

### Control

```txt
apps/control/src/server.ts
apps/control/src/auth.ts
apps/control/src/device-registry.ts
apps/control/src/audit-log.ts
apps/control/test/control-server.test.ts
```

### Agent

```txt
apps/agent/src/index.ts
apps/agent/src/commands/serve.ts
apps/agent/src/commands/connect.ts
apps/agent/src/commands/pair.ts
apps/agent/src/relay/device-identity.ts
apps/agent/src/local-server/session-manager.ts
```

### Protocol

```txt
packages/protocol/src/index.ts
```

### Docs

```txt
README.md
SECURITY.md
docs/PHASE3B_RELAY_ONLY_SECURITY_CUTOVER.md
docs/ADR/0004-relay-only-security-gate.md
```

## 7. 验收标准

### 自动测试

必须通过：

```bash
pnpm install
pnpm typecheck
pnpm test
```

新增测试至少覆盖：

1. 未登录 `POST /api/relay/session` 返回 401。
2. 登录成功设置 HttpOnly cookie。
3. logout 后不能再拿 relay session。
4. relay session token TTL / idle timeout 生效。
5. browserSessions 不存明文 token。
6. control-devices.json 不含明文 deviceToken。
7. revoked device 不能 connect。
8. pairing approve 必须登录。
9. pairing code 过期后不能 approve。
10. pairing reject 生效。
11. Web 不再解析 `?agent=` / `?token=`。
12. Web 不再保存 direct devices。
13. direct `serve/dev-serve` 未设置 env 时拒绝启动。
14. relay full-access 默认允许。
15. 设置 `CODEXNEXT_DISABLE_RELAY_FULL_ACCESS=1` 后拒绝 full-access。

### 手动验收

#### 本地 relay-only

```bash
# terminal 1
pnpm --filter @codexnext/control dev -- \
  --host 127.0.0.1 \
  --port 3002 \
  --owner-token <long-random-token>

# terminal 2
CODEXNEXT_RELAY_URL=http://127.0.0.1:3002 \
CODEXNEXT_OWNER_TOKEN=<long-random-token> \
CODEXNEXT_ADMIN_PASSWORD_HASH=<hash> \
pnpm --filter @codexnext/web dev

# terminal 3
pnpm --filter @codexnext/agent dev -- pair \
  --relay http://127.0.0.1:3002 \
  --device-name "Local Mac"
```

验收：

- 打开 Web 先看到登录页。
- 登录后看到 relay 设备列表。
- 通过 pair code 绑定本机。
- 选择设备后能创建 Codex session。
- 能发送消息、看到 streaming output。
- 能处理 approval。
- Web 不出现 Agent URL / Access Token。
- URL 不包含 agent/token/ownerToken/sessionToken。
- localStorage 不包含 ownerToken、sessionToken、direct token。
- direct endpoint 不在 UI 中出现。

#### 公网安全

- 未登录访问公网 Web 只能看到登录页。
- 未登录 `curl /api/relay/session` 返回 401。
- 知道公网地址和端口但没有密码，不能看到设备、不能 pair、不能控制。
- logout 后刷新不能继续操作。
- revoke device 后 agent 断开，并且不能自动重连。
- control registry 不含明文 device token。

## 8. 给下一个 AI 的执行 Prompt

```text
请实现 CodexNext Phase 3B-R: Relay-only Security Cutover。

目标：
CodexNext 产品层从 direct/relay 混合彻底切换为 relay-only。用户不再看到 Agent URL、Access Token、?agent=、?token=。本地和公网都使用 control + web + agent connect/pair 三服务链路。保留 direct 底层能力最多只作为隐藏 dev-only 入口，不进入用户 UI、正常 README 或 URL 参数。

当前已经有：
- apps/control Fastify + Socket.IO
- /user 和 /machine namespace
- /api/auth/session
- pairing device/request/approve
- device registry
- apps/agent pair/connect
- machine hello / heartbeat / rpc:request
- apps/web relay mode
- direct mode 残留

必须实现：
1. Web 登录页和 auth API，使用 HttpOnly cookie。
2. /api/relay/session 必须要求登录；未登录 401。
3. ownerToken 只能服务端使用，不能进入浏览器 URL/localStorage/React state。
4. relay sessionToken 只存在内存；刷新后通过 HttpOnly cookie 重新换取。
5. Web 删除 direct 产品路径：删除 ?agent/?token 解析、DirectSavedDevice、direct agentFetch、direct event stream、DeviceSheet 中 Agent URL/Access Token 表单。
6. SavedDevice 改成 relay-only。
7. 旧 direct saved devices 自动丢弃，并显示一次性迁移提示。
8. DeviceSheet 改成 relay devices + pair code UX。
9. control browserSessions 改为 tokenHash + TTL + idle timeout + revoke/prune。
10. device registry 改为 deviceTokenHash，不明文保存 deviceToken，支持旧文件迁移。
11. 新增 device revoke endpoint，revoked device 不能重连，已连接 socket 断开。
12. pairing approve/reject 必须登录，pairing code 加 TTL、rate limit、one-time use、fingerprint。
13. production CORS 禁止 origin:true，必须配置 allowed origins。
14. relay full-access 默认允许，只有 CODEXNEXT_DISABLE_RELAY_FULL_ACCESS=1 时才禁用。
15. agent serve 改为 hidden dev-only 或 dev-serve，必须 CODEXNEXT_ENABLE_DEV_DIRECT=1，不再打印 token URL。
16. 新增 audit log，不能记录 token、prompt、assistant content、完整命令输出。
17. 更新 README、SECURITY.md、docs/PHASE3B_RELAY_ONLY_SECURITY_CUTOVER.md、docs/ADR/0004-relay-only-security-gate.md。
18. 添加测试覆盖所有安全验收项。

不要做：
- React Native
- OAuth/passkey
- 多用户 SaaS
- 完整 Happy E2E encryption
- 非 Codex agent
- 任意 shell/file API
- 重写 Codex app-server 的权限系统

验收：
pnpm install
pnpm typecheck
pnpm test

手动验收：
未登录公网 Web 只能看到登录页；未登录 POST /api/relay/session 返回 401；登录后才能看到设备；pair 设备后才能控制；Web 不出现 direct endpoint；URL/localStorage 不含 ownerToken/sessionToken/direct token；revoke device 后不能重连；relay full-access 默认允许。
```

## 9. 实施顺序建议

1. 先加 Web 登录和 `/api/relay/session` 登录校验。
2. 再删除 Web direct 产品路径。
3. 再做 control session TTL/revoke。
4. 再做 deviceTokenHash/revoke。
5. 再做 pairing rate limit/reject/fingerprint。
6. 最后处理 `agent serve` dev-only 和文档。

不要先大规模删除底层 direct 文件，否则测试和调试会变复杂。先确保用户路径干净，再逐步清理底层。
