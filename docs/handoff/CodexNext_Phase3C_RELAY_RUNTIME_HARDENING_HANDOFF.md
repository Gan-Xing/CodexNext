# CodexNext Phase 3C Handoff

## Relay Runtime Reliability, Observability & Release Readiness Gate

### 0. 当前上下文

CodexNext 的产品目标是 personal Codex control plane。正常用户路径必须是：

```txt
Browser / Mobile Web / future mobile client
  -> CodexNext Web login
  -> Web HttpOnly cookie
  -> Web server bootstraps relay session
  -> Control relay session
  -> Paired outbound agent
  -> Local Codex app-server
```

用户路径中不得出现：

```txt
Agent URL
Access Token
?agent=
?token=
?ownerToken=
手动直连 endpoint
浏览器 localStorage 中的 ownerToken/sessionToken
```

Direct mode 只允许保留为 hidden dev-only troubleshooting path，不进入 README 主流程、不进入 UI、不进入正常 URL 参数。

### 1. 本阶段目标

把已经完成主体实现的 Phase 3B-R relay-only security cutover，推进为 **可发布、可维护、可诊断、可扩展的 Phase 3C relay runtime baseline**。

本阶段不是移动端开发，不是 SaaS auth，不是 UI 小修，不是框架迁移。

本阶段完成后，项目应该具备：

- 清晰准确的架构文档。
- 完整的 Roadmap 阶段状态。
- 可回归的 relay security/runtime 测试矩阵。
- 可诊断的 deployment/doctor/health/audit 基线。
- 为 Phase 4 Mobile 提供稳定协议契约。

### 2. 非目标

本阶段不要做：

- React Native / Expo mobile client。
- OAuth / passkeys。
- 多用户 SaaS authorization。
- 非 Codex agent。
- E2E relay payload encryption。
- 数据库化 session/pairing/rate-limit。
- Fastify → NestJS 迁移。
- 大规模 Web controller 重写。
- 重写 Codex app-server permission/sandbox/approval 系统。
- 新增任意 shell/file API。

### 3. 必读文件

Codex 执行前必须阅读：

```txt
README.md
docs/ROADMAP.md
docs/ARCHITECTURE.md
docs/SECURITY.md
docs/PHASE3B_SECURITY_GATE.md
docs/RELAY_DEPLOYMENT.md
docs/handoff/CodexNext_Phase3B_Relay_Only_Security_Cutover_HANDOFF.md

package.json
pnpm-workspace.yaml

apps/control/src/index.ts
apps/control/src/server.ts
apps/control/src/auth.ts
apps/control/src/audit-log.ts
apps/control/src/device-registry.ts
apps/control/src/device-event-store.ts
apps/control/src/sidebar-prefs-store.ts
apps/control/test/control-server.test.ts

apps/web/src/lib/server-auth.ts
apps/web/src/middleware.ts
apps/web/src/app/api/auth/login/route.ts
apps/web/src/app/api/auth/logout/route.ts
apps/web/src/app/api/auth/status/route.ts
apps/web/src/app/api/relay/session/route.ts
apps/web/src/lib/relay.ts
apps/web/src/lib/api.ts
apps/web/src/lib/event-stream.ts
apps/web/src/lib/types.ts
apps/web/src/features/console/use-web-console-controller.ts
apps/web/src/features/devices/device-utils.ts
apps/web/src/components/PairPageClient.tsx

apps/agent/src/index.ts
apps/agent/src/commands/doctor.ts
apps/agent/src/commands/pair.ts
apps/agent/src/commands/connect.ts
apps/agent/src/commands/serve.ts
apps/agent/src/relay/device-identity.ts
apps/agent/src/local-server/session-manager.ts

packages/protocol/src/index.ts
```

### 4. Stage A — Truth Reconciliation 与阶段基线

#### 目标

建立当前项目的真实 source of truth，消除文档与代码之间的误导。

#### 为什么做

当前 `ARCHITECTURE.md` 仍然是 Phase 1-only，Roadmap 中 Phase 3 仍写 NestJS control server，而实际产品已经是 Fastify + Socket.IO relay-only control plane。继续让文档漂移，会导致后续 Codex、维护者和贡献者做出错误规划。

#### 涉及模块

```txt
docs/ARCHITECTURE.md
docs/ROADMAP.md
docs/SECURITY.md
docs/RELAY_DEPLOYMENT.md
docs/handoff/
README.md
```

#### 实施步骤

1. 阅读 README、Roadmap、Architecture、Security、Relay Deployment、Phase 3B handoff。
2. 更新 `docs/ARCHITECTURE.md`：
   - 描述当前三服务架构：control / web / agent。
   - 描述 relay-only 产品路径。
   - 描述 direct dev-only 边界。
   - 描述 control Fastify + Socket.IO，而不是 NestJS。
   - 描述 session、pairing、device registry、event replay、audit 的模块关系。
3. 更新 `docs/ROADMAP.md`：
   - Phase 1：implemented。
   - Phase 2：implemented。
   - Phase 3A/3B-R：implemented 或 completed。
   - 新增 Phase 3C：Relay Runtime Reliability & Release Readiness Gate。
   - 明确 Phase 4 Mobile 依赖 Phase 3C gate。
   - Phase 5 Multi-device Reliability 调整为 Phase 3C/Phase 5 的衔接，不再让 reliability 全部等到 mobile 后。
4. 更新 `docs/RELAY_DEPLOYMENT.md`：
   - 删除 `/Users/ganxing/Desktop/...` 绝对路径。
   - 删除或泛化硬编码公网 IP。
   - 增加 `<your-web-origin>`、`<your-relay-host>`、`<your-domain>` 占位示例。
   - 增加 dev / production env matrix。
   - 明确 HTTP 仅适合内网或 dev；public production 建议 HTTPS reverse proxy。
5. 对齐 `docs/SECURITY.md` 与实际代码：
   - pairing TTL 当前是 15 分钟；要么代码改回 5 分钟并补测试，要么文档改成 15 分钟并解释原因。
   - relay full-access 当前默认 allowed；旧文档中相反表述必须标记 superseded。
6. 新增并持续更新：
   ```txt
   docs/handoff/CodexNext_Phase3C_RELAY_RUNTIME_HARDENING_HANDOFF.md
   ```
   并在其中创建 progress checklist。

#### 风险

- 不要为了 Roadmap 里的 NestJS 旧目标做框架迁移。
- 不要把历史 handoff 全删掉；旧文档应保留，但新的 Phase 3C 文档必须说明 supersedes 哪些决策。
- 不要把未来 SaaS/mobile 目标写成当前承诺。

#### 验证方式

```bash
pnpm typecheck
pnpm test
```

并人工检查 docs 中不再出现本机绝对路径；Roadmap 能解释当前代码状态。

#### 完成标准

- Architecture 与当前代码一致。
- Roadmap 明确 Phase 3C。
- Deployment 文档可给外部开源用户阅读。
- Security 文档与 full-access / pairing TTL 代码一致。
- Phase 3C progress checklist 存在。

### 5. Stage B — Relay Security Contract Regression Tests

#### 目标

把 Phase 3B-R 已实现的安全边界变成可回归测试，防止后续移动端、UX 或 refactor 破坏 control plane。

#### 为什么做

当前 control/Web/agent 已经有大量安全逻辑，但测试矩阵还不够完整。CodexNext 是远程控制本地 Codex 的工具，一旦认证、revoke、pairing、session、full-access contract 被破坏，风险高于普通 Web 应用。

#### 涉及模块

```txt
apps/control/src/server.ts
apps/control/src/device-registry.ts
apps/control/src/audit-log.ts
apps/control/test/control-server.test.ts

apps/web/src/lib/server-auth.ts
apps/web/src/app/api/relay/session/route.ts
apps/web/src/app/api/auth/login/route.ts
apps/web/src/middleware.ts

apps/web/src/lib/api.ts
apps/web/src/lib/relay.ts
apps/web/src/features/devices/device-utils.ts
```

#### 实施步骤

新增或扩展测试，至少覆盖以下 contract。

##### B1. Web login 与 relay session bootstrap

测试：

- relay 未配置时 `/api/relay/session` 返回 204。
- relay 已配置且 Web login enabled，但无 cookie 时返回 401。
- 有合法 cookie 时返回 `{ relayUrl, sessionToken }`。
- response 不包含 `ownerToken`。
- session token 不写入 localStorage 的逻辑在 Web utility/controller 测试中锁定。
- login 成功设置 HttpOnly cookie。
- logout 清 cookie。
- 错误密码触发 rate limit。
- malformed password hash 不泄漏配置状态。

##### B2. Control browser session

测试：

- `/api/auth/session` 缺 owner token 返回 401。
- bad owner token 返回 401。
- good owner token 返回 relay session token。
- control 内部只存 tokenHash，不存明文 token。
- session TTL 到期后 user namespace / HTTP relay endpoint 拒绝。
- idle timeout 到期后拒绝。
- logout/revoke 后拒绝。
- non-production ownerToken 可以作为 user access fallback。
- production 下 ownerToken 不作为 browser user access fallback。

##### B3. Production CORS 与 machine owner token

测试：

- production 且没有 allowedOrigins 时 server 创建失败。
- production 下未列入 allowlist 的 origin 被拒绝。
- production 默认 `allowMachineOwnerToken=false`。
- 非 production 可用 owner token bootstrap machine。
- production 只有 registry-authorized device token 才能 machine connect。

##### B4. Device registry

测试：

- 新 registry 写入 v2。
- persisted JSON 不包含 `"deviceToken"` 明文字段。
- legacy v1 明文 deviceToken 加载后迁移为 deviceTokenHash。
- `isAuthorized` 对正确 token true，错误 token false。
- revoked device false。
- registry 文件权限尽可能为 `0600`。
- timing-safe compare 路径不因长度不一致 throw。

##### B5. Pairing

测试：

- create pairing 需要完整 payload。
- create by IP/deviceId rate limit 生效。
- lookup by code rate limit 生效。
- approve 缺 user token 返回 401。
- reject 缺 user token 返回 401。
- approve 成功后 one-time，第二次 approve/reject 返回 409。
- reject 后 poll 返回 rejected。
- expired pairing 返回 expired / 410。
- prune 后 lookup 不再返回。
- pairing view 包含 shortFingerprint，不包含 deviceToken。
- pairing TTL 与文档一致。

##### B6. Device revoke

测试：

- DELETE `/api/devices/:deviceId` 缺 user token 返回 401。
- revoke 已连接设备后 socket disconnect。
- revoke 后 registry 记录 `revokedAt`。
- revoked device 不能 reconnect。
- user namespace 收到 offline/remove 事件。
- revoke audit 不含 deviceToken。

##### B7. Relay full-access

测试：

- 默认情况下 `permissionMode: "full-access"` 通过 relay create/resume 路径允许。
- 设置 `CODEXNEXT_DISABLE_RELAY_FULL_ACCESS=1` 或 option false 后拒绝。
- 拒绝时返回 403 和清晰错误。
- audit 记录 `relay_full_access_disabled`，但不记录 prompt 内容。

#### 风险

- 这些测试可能暴露现有实现问题。必须修复问题，而不是降低测试标准。
- 不要把测试写成实现细节过拟合；优先测试 public contract。
- 对内部 map 的明文 token 检查可以通过 server test helper 或 behavior+serialization 检查实现，不要大幅暴露生产 API。

#### 验证方式

```bash
pnpm test
pnpm typecheck
```

#### 完成标准

- Phase 3B-R security contract 被测试覆盖。
- 所有新增测试通过。
- 任何策略变更同步更新 Security/Roadmap/Handoff。

### 6. Stage C — Relay Runtime Reliability：event replay、reconnect、stale presence

#### 目标

让 relay runtime 支撑后续 Web/mobile 长时间使用，而不是只在 happy path 下工作。

#### 为什么做

Mobile 和多设备体验依赖稳定的 event replay、断线重连、设备在线状态、session expiry 处理。如果这里不稳定，移动端会放大问题。

#### 涉及模块

```txt
apps/control/src/server.ts
apps/control/src/device-event-store.ts
apps/web/src/lib/event-stream.ts
apps/web/src/features/console/use-web-console-controller.ts
apps/agent/src/commands/connect.ts
packages/protocol/src/index.ts
```

#### 实施步骤

##### C1. 明确 event replay contract

当前 user namespace connect 时会按 `lastSeqByDevice` 发历史事件。Web event stream 同时监听 `device:replay` 与 `device:event`。本阶段必须选择并文档化其中一种 contract。

推荐 contract：

```txt
device:replay -> initial replay batch, payload: DeviceEventPayload[]
device:event  -> live single event, payload: DeviceEventPayload
```

如果选择这个 contract：

- control user connection 初始 replay 应 emit `device:replay` batch。
- Web 继续监听 `device:replay` batch。
- 增加测试：用户带 lastSeq 重连后只收到 missing events。
- 增加测试：重复 replay 不导致 UI duplicate。

如果保持当前逐条 `device:event` replay：

- 删除或标注 `device:replay` 为 legacy/unused。
- 文档明确 replay 也走 `device:event`。
- 增加测试避免移动端误实现。

##### C2. stale device presence

增加或验证：

- heartbeat 超过 `N * heartbeatIntervalMs` 后设备标记 offline。
- stale timeout 可配置。
- 设备 socket disconnect 与 heartbeat stale 逻辑不冲突。
- stale offline audit 不泄漏敏感信息。
- Web 显示 offline 状态不清空历史 workspace。

##### C3. reconnect 与 session expiry

测试并修复：

- relay session expired 后 HTTP relay endpoint 返回 401。
- Web 能重新请求 `/api/relay/session` 或提示重新登录。
- Socket.IO reconnect 使用最新 sessionToken。
- 多浏览器 tab 同时连接同一 device 不互相破坏 state。
- revoke device 后 Web workspace 不继续发送 RPC。

##### C4. recent history cache contract

验证：

- recent history page cache TTL 生效。
- archive/resume 后 cache invalidation 正确。
- loaded thread ids 与 archived thread 状态一致。
- cache 不跨 device 泄漏。

#### 风险

- 不要把 event replay 改成复杂队列系统。
- 不要引入持久化数据库。
- 不要让 stale presence 误杀仍在线但长任务中的 agent；heartbeat timeout 需要保守默认值。

#### 验证方式

```bash
pnpm test
pnpm typecheck
```

并新增至少一个 Socket.IO reconnect/replay 集成测试。

#### 完成标准

- event replay contract 被文档化并有测试。
- stale/offline 行为有测试。
- session expiry/reconnect 行为可预测。
- Mobile 可以基于同一 contract 实现。

### 7. Stage D — Observability 与 relay doctor

#### 目标

让用户和维护者能诊断部署问题，而不是只能读源码或看浏览器报错。

#### 为什么做

长期维护的开源项目必须有 operator-facing diagnostics。CodexNext 运行链路包含 Web、control、agent、Codex CLI、cookie、relay session、device registry、Socket.IO，多点任一出错都需要诊断工具。

#### 涉及模块

```txt
apps/agent/src/commands/doctor.ts
apps/control/src/server.ts
apps/control/src/audit-log.ts
apps/web/src/lib/audit-log.ts
docs/RELAY_DEPLOYMENT.md
README.md
```

#### 实施步骤

##### D1. Audit redaction tests

补测试确认 audit log 不包含：

```txt
ownerToken
sessionToken
deviceToken
prompt content
assistant content
full command output
file contents
```

允许记录：

```txt
action
outcome
deviceId
method
duration/status
shortFingerprint
ip
reason code
```

##### D2. Safe health/status

检查并必要时扩展 `/api/control/health`：

- 可以返回 `ok`、online device count、uptime、version。
- 不返回 token。
- 不返回 prompt。
- 不返回完整 command output。
- 不返回完整 device registry secret。
- production 行为明确。

##### D3. Relay doctor

扩展 `codexnext doctor` 或新增 `codexnext doctor --relay`：

检查项建议：

- Node/pnpm/Codex CLI 可用。
- `codex app-server` 可启动或版本可读取。
- relay URL 可访问 `/api/control/health`。
- agent device identity 文件存在与权限检查。
- control/web 必需 env 是否配置。
- production 时 owner token 长度与默认值风险提示。
- Web login env：password hash/session secret/public origin。
- control allowed origin 与 web origin 是否匹配。
- direct dev-only env 是否误开。
- 输出不打印任何 raw token。

##### D4. 文档更新

在 README 和 RELAY_DEPLOYMENT 增加：

```bash
pnpm --filter @codexnext/agent dev -- doctor
pnpm --filter @codexnext/agent dev -- doctor --relay http://<relay-host>:3922
```

如果实际命令形式不同，由 Codex 根据 commander 结构实现并记录。

#### 风险

- doctor 不应变成监控系统。
- 不要让 doctor 泄漏 token。
- 不要在 doctor 中强制登录用户 Web 密码；只检查配置和 relay health。

#### 验证方式

```bash
pnpm --filter @codexnext/agent dev -- doctor
pnpm test
pnpm typecheck
```

#### 完成标准

- doctor 输出可用于定位 control/web/agent/Codex CLI/env 问题。
- audit redaction 有测试。
- docs 说明如何使用 doctor。
- health/status 输出安全。

### 8. Stage E — Final Quality Gate、文档与进度记录

#### 目标

把本阶段结果打包成可继续交接的项目状态，避免下一次又回到规划阶段。

#### 涉及模块

```txt
docs/handoff/CodexNext_Phase3C_RELAY_RUNTIME_HARDENING_HANDOFF.md
docs/ROADMAP.md
docs/ARCHITECTURE.md
docs/SECURITY.md
docs/RELAY_DEPLOYMENT.md
README.md
```

#### 实施步骤

1. 更新 Phase 3C handoff：
   - Completed checklist。
   - Remaining checklist。
   - Tests run。
   - Known limitations。
   - Next recommended phase。
2. 更新 Roadmap：
   - Phase 3C status。
   - Phase 4 entry criteria。
3. 更新 README：
   - 保持 relay-only product path。
   - 保持 hidden dev-only direct mode。
   - 增加 doctor/diagnostics 简短说明。
4. 更新 Security：
   - 对齐 full-access、pairing TTL、session TTL、audit redaction。
5. 运行完整验证：
   ```bash
   pnpm typecheck
   pnpm test
   pnpm --filter @codexnext/agent dev -- doctor
   ```
6. 若测试失败，修复后重复运行。
7. 提交代码与文档。

#### 完成标准

- 所有自动测试通过。
- 文档不再误导到 direct mode / NestJS / Phase 1-only 架构。
- Phase 3C handoff 可直接给下一轮 Codex 使用。
- 下一阶段可以开始 Phase 4 Mobile 的 protocol/client planning，或者继续 Phase 5-style multi-device reliability，不需要重新做全局梳理。

### 9. Progress Log

Updated: 2026-06-10

#### Completed in current Phase 3C pass

- Stage A docs reconciled:
  - `docs/ARCHITECTURE.md` now describes current control/web/agent relay-first architecture.
  - `docs/ROADMAP.md` marks Phase 1, Phase 2, Phase 3A, and Phase 3B-R as implemented and adds Phase 3C gate before Phase 4 Mobile.
  - `docs/RELAY_DEPLOYMENT.md` removes local absolute paths and hardcoded public IP examples, adds service-role topology, HTTPS guidance, env matrix, and diagnostics.
  - `docs/SECURITY.md` is aligned with current session TTL, pairing TTL, full-access default, direct dev-only boundary, event replay, health, and audit redaction.
  - README now includes relay doctor usage and replay contract notes.
- Stage B security contract coverage expanded:
  - Web login cookie, logout, invalid login rate limit, malformed password hash behavior, relay bootstrap 204/401/success, and no ownerToken relay response.
  - Saved relay device localStorage sanitization so session/owner/device tokens and legacy direct tokens are not retained.
  - Control session TTL, idle timeout, production owner-token fallback denial, CORS allowlist behavior, and Socket.IO expiry denial.
  - Device registry v2 hash persistence, legacy plaintext migration, 0600 permissions, and revoked authorization denial.
  - Pairing safe view, one-time approve, reject poll, expiry, and lookup rate limit.
  - Device revoke disconnect/reconnect denial.
  - Relay full-access default allow plus option/env disable.
  - Audit redaction for raw tokens, prompts, assistant content, and command output.
- Stage C runtime reliability implemented:
  - Control emits `device:replay` initial batches and `device:event` live events.
  - Duplicate machine events by seq are stored once and not re-emitted live.
  - Configurable stale device presence marks offline without deleting device state.
  - Recent history cache TTL is configurable and tested.
- Stage D observability implemented:
  - `/api/control/health` returns safe operational fields only.
  - `codexnext doctor --relay <url>` probes relay health and checks local/env diagnostics without printing secret values.

#### Tests run so far

```bash
pnpm test
pnpm typecheck
pnpm --filter @codexnext/control typecheck
pnpm test apps/control/test/control-server.test.ts
pnpm --filter @codexnext/web typecheck
pnpm test apps/web/src/app/api/relay/session/route.test.ts apps/web/src/features/devices/device-utils.test.ts
pnpm --filter @codexnext/agent typecheck
pnpm install
pnpm --filter @codexnext/agent dev -- doctor
```

Final gate result:

```txt
pnpm install: passed, lockfile already up to date.
pnpm typecheck: passed.
pnpm test: passed, 14 files / 116 tests.
pnpm --filter @codexnext/agent dev -- doctor: passed with expected warning that no --relay URL was supplied.
```

#### Remaining before final gate

- None. Code, docs, tests, diagnostics, final gate, and commit are complete.

#### Known limitations

- Sessions, pairings, rate limits, replay event stores, and recent history cache remain in-memory by design for this phase.
- Relay payloads are not end-to-end encrypted; transport security should be provided by HTTPS/WSS in public production.
- Phase 4 Mobile remains blocked until the final Phase 3C gate passes.

#### Next recommended phase

After the final Phase 3C gate passes, start Phase 4 Mobile protocol/client planning against the documented relay contracts, especially Web login/session bootstrap, `device:replay`, `device:event`, pairing, revoke, and stale presence.
