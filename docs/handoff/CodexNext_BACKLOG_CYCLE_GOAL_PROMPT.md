# CodexNext Backlog-Cycle Goal Prompt

你正在开发 Gan-Xing/CodexNext。你不是做一次小修，而是在执行一个严格的 Backlog 循环系统。

## 0. 最重要的计数规则

计数单位不是子任务，不是阶段，不是一次检查，不是一次 commit。

```txt
只有当“当前活动 Backlog 文件”中的所有 checkbox 都完成，并且最终验证通过，才允许计数 +1。
```

完成整份 Backlog 后，必须运行：

```bash
node scripts/codexnext-backlog-cycle-guard.mjs complete-cycle
```

只有这个命令成功，才算本轮 cycle 计数 +1。

计数 +1 后，必须重新针对 Phase 1–5 做全量审计，生成新的下一轮 Backlog，然后继续执行。新的 Backlog 必须重新发现更深的问题，不能机械复制上一轮，也不能只挑简单任务。

停止条件：

```txt
满足任意一个即停止：
1. completedCycles >= maxCycles，固定 20，不允许通过环境变量或命令行覆盖；
2. 当前时间 >= 2026-06-11 05:30 Europe/London；
3. 脚本 status 明确显示不能继续；
4. 发生无法自动解决的外部阻塞，并已写入 progress log。
```

---

## 1. 初始化

如果仓库还没有脚本和 Cycle 01 Backlog，先把用户提供的文件放到：

```bash
docs/handoff/CodexNext_CYCLE01_PHASE1_TO_PHASE5_BACKLOG.md
scripts/codexnext-backlog-cycle-guard.mjs
```

然后执行：

```bash
chmod +x scripts/codexnext-backlog-cycle-guard.mjs
node scripts/codexnext-backlog-cycle-guard.mjs init \
  --backlog docs/handoff/CodexNext_CYCLE01_PHASE1_TO_PHASE5_BACKLOG.md
```

如果状态文件已存在，不要覆盖，直接进入 status。

---

## 2. 断点式循环总览

你必须按下面的断点循环。每个断点都要检查脚本状态，不能跳过。

```txt
断点 A：开始/恢复
  -> status
  -> 如果停止条件触发，停止并总结
  -> 如果没有 active backlog，进入断点 B
  -> 如果有 active backlog，进入断点 C

断点 B：生成新 Backlog
  -> 对 Phase 1–5 全量审计
  -> 生成新的 active backlog
  -> set-backlog 或 new-cycle
  -> 不计数
  -> 进入断点 C

断点 C：执行当前 Backlog
  -> 阅读当前 active backlog
  -> 按优先级完成所有 checkbox
  -> 每完成一组相关项，运行相关测试并更新 Progress Log
  -> 不能计数
  -> 所有 checkbox 完成后进入断点 D

断点 D：对当前 Backlog 做反向审计
  -> 假设前面实现太简单，重新挑刺
  -> 如果发现新问题，补进当前 Backlog，回到断点 C
  -> 如果没有新问题，进入断点 E

断点 E：最终验证与计数
  -> pnpm install
  -> pnpm typecheck
  -> pnpm test
  -> pnpm --filter @codexnext/agent dev -- doctor
  -> complete-cycle
  -> 只有 complete-cycle 成功才计数 +1
  -> 进入断点 A，继续下一轮
```

---

## 3. 断点 A：开始/恢复

每次启动或恢复时，先执行：

```bash
node scripts/codexnext-backlog-cycle-guard.mjs status
```

根据输出判断：

- `canContinue: false`：停止，输出原因。
- `activeBacklogPath` 为空：说明上一轮已经完成计数，需要生成下一轮 Backlog。
- `activeBacklogPath` 存在且有 pending checkbox：继续完成当前 Backlog。
- `activeBacklogPath` 存在且 pending 为 0：不要直接手动计数，先进入最终验证与 `complete-cycle`。

---

## 4. 断点 B：生成新 Backlog

如果没有 active backlog，先执行：

```bash
node scripts/codexnext-backlog-cycle-guard.mjs new-cycle
```

然后你必须用真实审计结果替换脚本生成的模板。生成 Backlog 时必须做这些事情：

1. 阅读 README、ROADMAP、ARCHITECTURE、SECURITY、RELAY_DEPLOYMENT、所有 handoff/progress。
2. 阅读 Phase 1–5 相关代码和测试。
3. 查看 git status、最近提交、当前测试结果。
4. 从以下角度重新挑问题：
   - 是否存在浅实现？
   - 是否只有 happy path，没有 edge case？
   - 是否缺少 tests？
   - 是否文档和代码漂移？
   - 是否存在安全、权限、token、revoke、session、race、reconnect、event replay 风险？
   - 是否有 TODO/FIXME/HACK/temporary/dev-only/direct-mode 残留？
   - 是否会阻碍 Mobile 或 Multi-device？
5. 生成新的 Phase 1–5 Backlog。

新的 Backlog 必须包含：

```txt
- 当前状态判断
- 本轮目标
- 非目标
- 必读文件
- 分阶段任务
- 每个任务的原因、涉及模块、实施步骤、验证方式、完成标准
- Progress Log
- 最终验证命令
```

不要生成太小的 Backlog。它必须足以支撑数小时工作。也不要生成不现实的“重写整个项目”。它应该是本轮能完成、但必须真实推进质量的 Backlog。

生成新 Backlog 后，执行：

```bash
node scripts/codexnext-backlog-cycle-guard.mjs set-backlog --backlog <new-backlog-path>
```

然后进入断点 C。注意：生成 Backlog 不计数。

---

## 5. 断点 C：执行当前 Backlog

你必须完成当前活动 Backlog 文件中的所有 checkbox。

执行规则：

1. 按 P0/P1/P2/P3 或文档顺序推进。
2. 每个 checkbox 完成前必须阅读相关代码和文档。
3. 每个实现必须配测试；如果不能测试，必须解释为什么，并用文档或手动验证替代。
4. 失败测试必须修复，不能把失败记录为完成。
5. 每完成一组相关任务，更新 Backlog 的 Progress Log。
6. 不要为了勾选而写临时实现。
7. 不要把新发现的问题藏起来；必须加入当前 Backlog 或下一轮 Backlog。
8. 不要在当前 Backlog 未全部完成前调用 `complete-cycle`。

推荐每组相关任务后运行：

```bash
pnpm typecheck
pnpm test
```

如果只改了单个 package，可以先运行 package 级 typecheck/test，但最终仍要跑全量验证。

---

## 6. 断点 D：反向审计

当你认为当前 Backlog 已经全部完成时，不要马上计数。先做反向审计。

反向审计要求：

```txt
假设前面的 AI 实现得太简单、太 happy path、太局部、太临时。
重新从 CTO / 架构负责人 / 安全审查 / 测试负责人角度检查。
```

至少检查：

- 新增功能有没有测试？
- 测试是否真的覆盖错误路径和边界？
- 文档是否和代码一致？
- 是否引入新的 token 泄漏风险？
- 是否破坏 relay-only 产品路径？
- 是否误把 direct dev-only 重新带回用户路径？
- 是否引入难以维护的大文件/重复逻辑？
- 是否影响 Phase 4 Mobile 或 Phase 5 Multi-device？

如果发现新问题：

1. 把它加入当前 Backlog 或 Progress Log 的 “must fix before complete-cycle”。
2. 回到断点 C。

只有反向审计没有发现必须本轮修复的问题，才进入断点 E。

---

## 7. 断点 E：最终验证与计数

执行：

```bash
node scripts/codexnext-backlog-cycle-guard.mjs status
pnpm install
pnpm typecheck
pnpm test
pnpm --filter @codexnext/agent dev -- doctor
node scripts/codexnext-backlog-cycle-guard.mjs complete-cycle
```

如果 `complete-cycle` 失败，按失败原因处理：

- 如果还有 unchecked checkbox：回到断点 C。
- 如果测试失败：修复后重新验证。
- 如果 deadline/maxCycles 触发：停止并总结。
- 如果没有 active backlog：检查状态文件，不要手动改计数。

`complete-cycle` 成功后，本轮才算真正计数 +1。

然后回到断点 A，继续下一轮。

---

## 8. 对 Phase 1–5 的长期方向

每一轮新 Backlog 都必须覆盖 Phase 1–5，但权重可以变化。

### Phase 1：Local Codex Foundation

关注：protocol、JSON-RPC、Codex client、doctor、goal-smoke、error taxonomy、approval handling、timeout/cancel。

目标：底层协议和 CLI 不是 smoke demo，而是稳定 foundation。

### Phase 2：Web Console

关注：chat、session、history、goal、approval、event ingestion、state boundaries、localStorage、UX safety。

目标：Web 是长期可维护 console，而不是巨型 controller 堆功能。

### Phase 3：Relay Control Plane

关注：auth、session、pairing、revoke、device registry、event replay、stale presence、audit、doctor、deployment、production config。

目标：relay-first control plane 可公开部署、可诊断、可测试。

### Phase 4：Mobile Client

关注：mobile auth/session、device list、presence、history/session view、turn steering、interrupt、approval prompt、replay adapter。

目标：从 0% 进入可运行、可验证、复用 relay contract 的 mobile client。

### Phase 5：Multi-device Reliability

关注：device/session layering、multi-client concurrency、durable views、longer retention、daemon polish、conflict handling。

目标：从单浏览器控制多机器，演进到可靠多客户端、多设备控制面。

---

## 9. 禁止行为

禁止：

- 当前 Backlog 未完成就计数。
- 手动编辑 state JSON 增加计数。
- 把一个阶段完成当作整轮完成。
- 只跑检查没有改动就计数。
- 发现问题但不写入 Backlog/Progress。
- 为了通过测试降低测试质量。
- 为了快速完成写临时方案。
- 大规模重构但没有测试锁定。
- 把 future SaaS/mobile/OAuth 目标混进当前安全边界，导致架构漂移。

---

## 10. 重启提示

如果上下文中断，下一个 Codex 只需要执行：

```bash
node scripts/codexnext-backlog-cycle-guard.mjs status
```

然后按照本 Prompt 的断点 A 继续。

永远以脚本状态和 active backlog 文件为准。
