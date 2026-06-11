# CodexNext Cycle 01 Phase 1–5 Backlog Handoff

## 0. 这份文档的计数语义

本文件是 **Cycle 01 的当前活动 Backlog**。

计数规则非常严格：

```txt
只有当本文件中的所有 backlog checkbox 都完成，并且最终验证通过，才允许计数 +1。
```

也就是说：

```txt
不是完成一个子任务计数 1 次。
不是完成一个阶段计数 1 次。
不是跑一次检查计数 1 次。
不是写一次 commit 计数 1 次。

必须是：整份当前活动 Backlog 全部完成 + 测试通过 + 文档更新 + 自审通过，才计数 1 次。
```

计数 +1 后，必须重新针对 Phase 1–5 做一次全量项目审计，生成新的下一轮 Backlog。下一轮 Backlog 不能只是复制上一轮，也不能只挑简单任务。它必须重新审视代码、测试、文档、架构、历史 Handoff、Roadmap、运行风险，找出新的更深层缺口。

这个循环的目标不是快速把 checkbox 勾完，而是反复逼近真正可靠、经得起测试的 CodexNext。

补充约束：

```txt
整个 Backlog cycle 固定最多执行 20 次，不允许通过命令行参数或环境变量改写。
```

---

## 1. 当前项目状态判断

CodexNext 当前已经从本地 Codex CLI smoke test 发展为 relay-first personal Codex control plane。当前主线产品路径是：

```txt
Browser / mobile Web / future mobile client
  -> CodexNext Web login
  -> Web HttpOnly cookie
  -> Web server POST /api/relay/session
  -> Control relay browser session
  -> Paired outbound agent
  -> Local Codex app-server
```

当前 Roadmap 中 Phase 1、Phase 2、Phase 3A、Phase 3B-R 已标记 implemented，Phase 3C 已标记 completed。Phase 4 Mobile 仍处于 blocked / not implemented，Phase 5 Multi-device Reliability 仍是 future。

这意味着第一轮循环不应该继续重复 Phase 3C 的表层收尾，而应该做一次真正的 **Phase 1–5 质量审计与下一阶段启动准备**：

- Phase 1/2/3 已经有大量实现，但还需要验证它们是否真的可靠、可维护、可测试、可作为长期基线。
- Phase 4 尚未实现，需要从“被 Phase 3C 阻塞”推进到“可以安全启动 Mobile client 的协议、包边界、测试策略和最小 scaffold”。
- Phase 5 尚未实现，需要先建立多设备可靠性的模型、测试入口和边界，而不是直接写大而空的 orchestration。

---

## 2. Cycle 01 总目标

Cycle 01 的目标不是“一口气完成 Phase 4 和 Phase 5 的全部产品”，而是：

```txt
对 Phase 1–5 做第一轮完整质量闭环：
1. 检查已完成阶段是否存在浅实现、文档漂移、测试缺口、架构风险；
2. 修补 Phase 1–3 中会阻碍 Phase 4/5 的缺口；
3. 为 Phase 4 Mobile 建立可运行的启动基线；
4. 为 Phase 5 Multi-device Reliability 建立可测试的模型和首批 contract；
5. 所有发现的问题必须落为代码、测试、文档或下一轮 backlog；
6. 本文件所有 checkbox 完成并验证通过后，才允许计数 +1。
```

Cycle 01 完成后，CodexNext 应该从“Phase 3C completed 但 Phase 4/5 还没真正启动”，推进到：

```txt
Phase 1–3 基线经再审计加固；
Phase 4 Mobile 有正式启动入口与最小可验证 scaffold；
Phase 5 多设备可靠性有明确模型、测试入口和下一轮可执行方向。
```

---

## 3. 非目标

Cycle 01 不做以下事情：

- 不做 OAuth / passkeys。
- 不做多用户 SaaS authorization。
- 不做 E2E relay payload encryption。
- 不做非 Codex agent。
- 不做 Fastify -> NestJS 迁移。
- 不重写 Codex app-server permission / sandbox / approval。
- 不把 in-memory session/pairing/rate-limit 强行数据库化。
- 不用大规模重写 Web controller 来代替测试。
- 不为了快速打勾写一次性脚本或临时 hack。

---

## 4. 必读文件

执行 Cycle 01 前必须阅读：

```txt
README.md
package.json
pnpm-workspace.yaml
docs/ROADMAP.md
docs/ARCHITECTURE.md
docs/SECURITY.md
docs/RELAY_DEPLOYMENT.md
docs/PHASE3B_SECURITY_GATE.md
docs/handoff/CodexNext_Phase3C_RELAY_RUNTIME_HARDENING_HANDOFF.md

packages/protocol/src/index.ts
packages/codex-client/src/json-rpc.ts
packages/codex-client/src/codex-app-server-client.ts

apps/agent/src/index.ts
apps/agent/src/commands/doctor.ts
apps/agent/src/commands/goal-smoke.ts
apps/agent/src/commands/pair.ts
apps/agent/src/commands/connect.ts
apps/agent/src/local-server/session-manager.ts
apps/agent/src/local-server/local-agent.ts
apps/agent/src/relay/device-identity.ts
apps/agent/test/local-server.test.ts

apps/control/src/index.ts
apps/control/src/server.ts
apps/control/src/auth.ts
apps/control/src/audit-log.ts
apps/control/src/device-registry.ts
apps/control/src/device-event-store.ts
apps/control/test/control-server.test.ts

apps/web/src/lib/server-auth.ts
apps/web/src/lib/api.ts
apps/web/src/lib/relay.ts
apps/web/src/lib/event-stream.ts
apps/web/src/lib/types.ts
apps/web/src/features/console/use-web-console-controller.ts
apps/web/src/features/devices/device-utils.ts
apps/web/src/features/sessions/session-utils.ts
apps/web/src/components/PairPageClient.tsx
```

---

## 5. Backlog 完成规则

每个 checkbox 只有在满足以下条件后才允许改成 `[x]`：

1. 已阅读相关代码和相关文档。
2. 已完成真实实现或真实文档修正，不是 TODO 占位。
3. 已新增或更新测试；如果某项只能文档验证，必须写明原因。
4. 已运行相关 package 的 typecheck/test。
5. 已把验证结果写入本文件的 Progress Log。
6. 如果发现新的缺口，必须补入本文件或下一轮 backlog，不允许忽略。

整份 Backlog 完成后，还必须执行：

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm --filter @codexnext/agent dev -- doctor
node scripts/codexnext-backlog-cycle-guard.mjs complete-cycle
```

`complete-cycle` 只有在本文件没有任何未完成 checkbox 时才允许计数 +1。

---

## 6. Cycle 01 Backlog

### A. Phase 1 — Local Codex App-Server Foundation 再审计

目标：确认最底层 Codex app-server / JSON-RPC / CLI 基线不是“能跑一次”的 demo，而是后续 relay/mobile/multi-device 可长期依赖的协议层。

- [ ] A1. 审计 `packages/protocol` 与 `packages/codex-client` 的公开 API，确认 method constants、request/response typing、server-initiated approval request、error shape、timeout 行为都有测试或文档说明。
- [ ] A2. 为 JSON-RPC client 或 Codex app-server client 补齐至少一组边界测试：request timeout、server error response、unknown notification、server-initiated request handler failure 中至少覆盖两类。
- [ ] A3. 审计 `codexnext doctor` 与 `goal-smoke`，确认错误输出不泄漏 token、不会把 Codex 不存在误报为项目失败，并把诊断边界写入 docs 或命令帮助。
- [ ] A4. 补充 Phase 1 foundation 文档段落，说明哪些能力是稳定 contract，哪些只是 dev smoke path，避免 Mobile/Relay 误依赖内部细节。
- [ ] A5. 运行 `pnpm --filter @codexnext/codex-client typecheck`、相关 tests、`pnpm --filter @codexnext/agent dev -- doctor`，并把结果记录到 Progress Log。

完成标准：Phase 1 的协议/client/doctor 基线可作为长期依赖，不再只是历史 smoke test。

---

### B. Phase 2 — Web Console 可维护性与回归测试

目标：确认本地/Web Console 层的 session、history、goal、approval、event ingestion 不会因为后续 Mobile/Relay 改造而变成不可维护的大型状态黑箱。

- [ ] B1. 审计 `use-web-console-controller.ts` 的职责边界，列出必须保留、可以后续抽离、禁止现在大拆的模块边界，并写入新的 docs/handoff progress section。
- [ ] B2. 为 Web console 的至少一个核心纯函数/工具补测试：saved device sanitization、session title/history grouping、approval utils、event ingestion、history hydration 中选择高风险项。
- [ ] B3. 审计 Web localStorage 使用，确认不会保存 ownerToken、relay sessionToken、deviceToken、direct token；如果已有测试不完整，补足测试。
- [ ] B4. 审计 approval UI / full-access warning / session expired UX 文案，至少修正一个会导致用户误操作或安全误解的问题。
- [ ] B5. 确认 Web event stream 对 `device:replay` 和 `device:event` 的处理有测试或明确 contract；如果没有，补测试或补文档并记录后续改进点。
- [ ] B6. 运行 `pnpm --filter @codexnext/web typecheck` 与相关 Web tests，并把结果记录到 Progress Log。

完成标准：Phase 2 Web Console 不再只是“页面能用”，而是对后续 Phase 4/5 有明确状态边界和测试保护。

---

### C. Phase 3 — Relay Control Plane 第二轮硬化

目标：Phase 3C 虽已 completed，但 Cycle 01 要从“是否通过上一轮测试”继续追问“是否真的经得起并发、revoke、session expiry、pairing abuse、部署故障”。

- [ ] C1. 复查 `apps/control/src/server.ts` 中 session、pairing、device registry、event replay、stale presence、RPC timeout 的组合路径，列出至少 5 个 race/edge case，并确认其中至少 2 个有测试覆盖。
- [ ] C2. 增加或完善一个 relay 集成测试，覆盖 revoke 与正在进行的 RPC、Socket.IO reconnect、stale offline、pairing one-time reuse 中的一个高风险组合场景。
- [ ] C3. 审计 `/api/control/health`、audit log、doctor relay probe 的输出，确认不会泄漏 token、prompt、assistant content、command output，并补充测试或文档。
- [ ] C4. 审计 production 配置：allowed origin、owner token、machine owner-token bootstrap、HTTPS/WSS guidance，确认 README / SECURITY / RELAY_DEPLOYMENT 三处一致。
- [ ] C5. 对 `apps/control/src/server.ts` 的“大文件风险”做一次保守处理：只允许提取纯函数或测试 helper，不做大规模重写；如果不提取，必须在 handoff 中说明原因和后续拆分计划。
- [ ] C6. 运行 `pnpm --filter @codexnext/control typecheck`、control tests、全量 `pnpm test`，并把结果记录到 Progress Log。

完成标准：Phase 3 不只是实现了 relay-only，而是第二轮证明了主要 runtime 风险有测试或明确处置计划。

---

### D. Phase 4 — Mobile Client 启动基线

目标：把 Phase 4 从 “blocked / 0%” 推进到 “可以安全启动的最小移动端工程基线”。Cycle 01 不要求完整 Mobile 产品，但必须结束“没有入口、没有边界、没有测试策略”的状态。

- [ ] D1. 新增或更新 Phase 4 design doc，明确 mobile client 的 MVP 范围：login/session bootstrap、device list/presence、session/history view、turn steer/interrupt、approval prompt、event replay。
- [ ] D2. 明确 Mobile 不做的内容：OAuth/passkeys、多用户 SaaS、E2E encryption、非 Codex agents，并说明为什么继续沿用 Web/control relay path。
- [ ] D3. 设计 shared relay client boundary：决定是抽 `packages/relay-client`，还是先在 docs 中定义 Web/mobile 共用 API contract；必须解释选择原因。
- [ ] D4. 如果工程条件允许，新增最小 `apps/mobile` scaffold 或 `packages/relay-client` scaffold；如果暂不新增代码，必须提供可执行的下一轮 scaffold plan 与验收标准。
- [ ] D5. 为 mobile auth/session storage 写 threat model：移动端如何保存 Web-style session、如何刷新 relay session、如何避免 ownerToken/deviceToken 进入客户端。
- [ ] D6. 为 mobile event replay 写 contract test plan：`device:replay` initial batch、`device:event` live event、lastSeqByDevice、duplicate prevention、offline/reconnect UX。
- [ ] D7. 更新 Roadmap：Phase 4 状态不能继续只写 blocked；必须改成准确状态，例如 “ready for scaffold after Cycle 01 backlog” 或 “scaffold started”，并列出 entry/exit criteria。

完成标准：Phase 4 有清晰、可执行、可验证的启动基线；不再只是 Roadmap 中的未来标题。

---

### E. Phase 5 — Multi-Device Reliability 第一轮建模

目标：Phase 5 当前是 future。Cycle 01 要为多设备可靠性建立第一批真实模型与测试入口，避免未来直接堆 UI。

- [ ] E1. 新增或更新 Phase 5 design doc，定义 device、machine、session、thread、workspace、browser client、mobile client 的层级关系。
- [ ] E2. 明确 Phase 5 与 Phase 3C 的边界：哪些 reliability 已在 Phase 3C 完成，哪些属于 Phase 5，例如 durable multi-device session views、longer retention、conflict handling、daemon polish。
- [ ] E3. 设计 multi-device session view 的数据 contract：同一用户多个浏览器/手机、多个 agents、同一 Codex thread 在不同设备上的可见状态如何表达。
- [ ] E4. 设计 conflict handling 的第一版策略：同时多个 user clients 操作同一 device/session 时，哪些操作允许、哪些需要提示、哪些必须 serialized。
- [ ] E5. 增加至少一个测试或测试计划，覆盖多 user clients 同时连接同一 device 的 presence/event replay/RPC 行为。
- [ ] E6. 审计 daemon/service polish：systemd/launchd 当前覆盖哪些平台，Windows/service manager 缺口如何进入后续 backlog。
- [ ] E7. 更新 Roadmap：Phase 5 不能只写 “future”，必须列出首批可执行子阶段和验收标准。

完成标准：Phase 5 有模型、有边界、有首批测试入口或详细测试计划，下一轮可以开始做真正实现。

---

### F. Cross-Phase Quality Gate

目标：防止 AI 为了完成 checkbox 写简单实现、浅实现、不可维护实现。

- [ ] F1. 全仓审计 TODO/FIXME/HACK/temporary/dev-only/direct mode 相关标记，判断哪些必须进入当前或下一轮 backlog，并记录结果。
- [ ] F2. 全仓审计测试覆盖结构，记录每个 package/app 当前测试文件与明显缺口，形成 `docs/handoff/CodexNext_TEST_COVERAGE_GAPS.md` 或写入本文件。
- [ ] F3. 检查 docs 与代码是否漂移：README、ROADMAP、ARCHITECTURE、SECURITY、RELAY_DEPLOYMENT、Phase 3C handoff 必须与当前行为一致。
- [ ] F4. 运行完整验证：`pnpm install`、`pnpm typecheck`、`pnpm test`、`pnpm --filter @codexnext/agent dev -- doctor`。
- [ ] F5. 执行一次 adversarial self-review：假设上一轮 AI 写得太简单，从安全、可靠性、测试、文档、架构、长期维护角度重新挑刺；发现的问题必须补入当前 backlog 或下一轮 backlog。
- [ ] F6. 更新本文件 Progress Log：列出完成项、变更文件、测试结果、仍然未完成但进入下一轮的事项。
- [ ] F7. 确认本文件没有任何未完成 checkbox 后，执行 `node scripts/codexnext-backlog-cycle-guard.mjs complete-cycle`，只有此命令成功才算 Cycle 01 计数 +1。

完成标准：整份 Backlog 全部完成，最终验证通过，脚本计数 +1。

---

## 7. 最终验证命令

Cycle 01 完成前必须运行：

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm --filter @codexnext/agent dev -- doctor
node scripts/codexnext-backlog-cycle-guard.mjs status
node scripts/codexnext-backlog-cycle-guard.mjs complete-cycle
```

如果 `complete-cycle` 因为还有未完成 checkbox 而失败，必须回到本文件继续完成 Backlog，不能手动修改计数文件。

---

## 8. 下一轮 Backlog 生成规则

Cycle 01 计数 +1 后，必须立即重新生成 Cycle 02 Backlog。

Cycle 02 Backlog 不能只是复制 Cycle 01 的剩余项。它必须重新基于以下信息生成：

```txt
1. 当前代码状态
2. 当前测试结果
3. 当前文档状态
4. git diff / commit history
5. Cycle 01 Progress Log
6. Cycle 01 adversarial self-review
7. Phase 1–5 Roadmap
8. 新发现的浅实现、临时方案、测试缺口、架构风险
```

新 Backlog 必须继续覆盖 Phase 1–5，但可以根据实际风险调整权重。越往后循环，Backlog 应该越偏向可靠性、边界测试、可维护性、真实用户路径，而不是重复做表面功能。

---

## 9. Progress Log

Codex 必须持续更新本段。每次修改至少记录：

```txt
- 时间
- 完成的 backlog item
- 修改文件
- 测试命令
- 测试结果
- 新发现的问题
- 是否进入当前 backlog 或下一轮 backlog
```

### Cycle 01 Progress Entries

暂无。Codex 开始执行后必须更新。
