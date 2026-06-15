# CodexNext UX QA 与 Codex App 对比评估（2026-06-14）

## 范围与限制

- 本轮未修改任何代码，只做测试、代码阅读和评估；新增本 Markdown 作为测试文档。
- Codex App 已确认安装并运行：`/Applications/Codex.app`、`codex app-server`、`bare-modifier-monitor --key DoubleCommand --immediate` 均在进程中。
- 当前会话没有暴露可调用的 `computer-use` MCP 命名空间；macOS `System Events` 辅助访问也拒绝 `osascript` 读取/点击 Codex App UI。因此没有把 Codex App UI 伪装成已点击测试。
- CodexNext 用真实 Chrome 登录态、临时 headless Chrome、AppleScript 页面脚本、CDP 鼠标事件做验证。

## 10 轮核心测试结论

真实 Chrome 登录态，对 `http://100.100.115.100:3002/` 做 10 轮切换：

| 项目 | 结果 |
| --- | --- |
| 目标长会话 | `codexnext的给我看看这个项目给我部署起来` |
| 对照短会话 | `你好？` |
| 长会话点击命中 | 10/10 |
| 短会话点击命中 | 10/10 |
| 600ms 检查是否到底部 | 20/20 均 `bottom=0` |
| 输入框可聚焦 | 10/10 |
| 输入后发送按钮可用 | 10/10 |
| 覆盖层干扰 | 真实 Chrome 登录态 0 次 |

计时说明：逐步轮询脚本包含 AppleScript 调用开销，所以总耗时不是纯前端渲染耗时。长会话脚本总耗时平均 `1273ms`，短会话平均 `1198ms`；但 600ms 第一个检查点已全部到底，说明当前真实登录态没有复现 3-6 秒切换或不到底部的问题。

原始数据：

- `/tmp/codexnext-real-chrome-step-qa.json`
- `/tmp/codexnext-real-chrome-search-qa.json`

## 已观察到的问题

1. 移动端底部有黑色圆形浮层遮挡 composer 左侧操作区。状态：已修复。
   证据：`/var/folders/bx/0jff44955g3d0wlbcqf02s6h0000gn/T/codexnext-ux-qa/codexnext-real-cache-mobile-after-click.png`。它看起来像 `CN/N` 标记残留或浮层覆盖，但当前只确认现象，不硬判根因。
   修复记录：Next.js 16.2 的 development route indicator 默认在左下角，已在 `apps/web/next.config.mjs` 设置 `devIndicators: false`，避免开发态覆盖移动端 composer。

2. 移动端进入会话后聊天区信息密度仍不够。状态：已修复第一轮。
   截图里顶部标题、单张大卡片和底部 composer 占用大量空间；聊天内容区没有达到“90% 都是可滚动对话区”的目标。
   修复记录：已把移动端 `cn-thread-empty` 和 `cn-thread-loading-skeleton` 从大卡片压缩成轻量状态条，降低等待/空状态对聊天区的占用。

3. 搜索结果可读性差。状态：已修复第一轮。
   搜索 `dailywork` 从 36 行缩到 6 行，但多条标题是整段 build log/终端输出，侧栏被长文本污染。最佳实践应对会话标题做摘要化、单行化、去日志噪声，而不是直接拿整段首条内容。
   修复记录：侧栏展示标题新增日志清洗，优先提取 shell prompt 后的用户命令，其次提取错误诊断行，再回退到非噪声文本。原始历史数据不被改写。

4. 冷启动/隔离浏览器状态不稳定。状态：已修复。
   无真实 localStorage 的 headless 冷态显示“先连接设备”；带缓存 headless 又出现 `CodexNext relay` 设备覆盖层，说明 first-run、跨浏览器、缓存恢复路径仍脆弱。真实 Chrome 正常不代表冷启动体验已经稳定。
   修复记录：relay session bootstrap 成功且本地没有 savedDevices 时，会自动调用 relay devices 列表并选择在线设备。验证结果：全新 headless profile 无 localStorage，从 0 设备恢复到 `Macmini`，最终出现 36 行会话，状态为“已同步 13 个项目 · 51 条会话”。

5. hover action 的自动化验证不完整。
   代码里置顶/归档按钮已有 `aria-label` 和 `title`；但真实桌面指针级测试被 macOS 辅助访问限制挡住，headless 结果又被设备覆盖层污染。本项需要后续用可用的 computer-use 或 Chrome DevTools 端口做真指针复测。

## Codex App 对标点

可观察到的 Codex App 实用能力：

- Native App 运行独立 `app-server`，不是纯网页壳。
- 有 `DoubleCommand` 级别的快捷键监听，说明官方体验重视快速唤起/快速操作。
- 本地 App 不依赖浏览器 localStorage 选设备，天然减少“先连接设备/缓存丢失”的冷启动路径。

CodexNext 当前差距：

- 冷启动和跨环境恢复还依赖浏览器缓存与 relay session，失败时用户看到的是配置态，而不是可工作的最近会话。
- 移动端还像桌面布局压缩版，底部控制和会话内容区的优先级没有完全重排。
- 会话标题没有产品化摘要策略，长日志直接进侧栏会明显降低扫描效率。
- 没有稳定的自动化 UX 回归套件覆盖 hover、移动端、冷启动、会话切换到底部。

## 优先级建议

P0：修移动端 composer 遮挡和空间分配。状态：已完成第一轮。移动端应完全隐藏/重排桌面 rail 残留，把底部 composer 左侧操作保持干净，聊天区优先占满可用高度。

P0：做 first-run/cold-start 恢复兜底。状态：已完成第一轮。没有 localStorage 或 relay session 过期时，应自动尝试恢复最近设备和会话，并给出明确重连状态，不能让用户掉到“先连接设备”的空壳。

P1：会话标题摘要化。状态：已完成第一轮。标题来源需要分层：用户首句优先、日志/代码块压缩、最长一行截断、终端输出生成简短摘要。

P1：补真实 UX 自动化。把“点击会话到底部、移动端点击进聊天、hover 置顶/归档、输入框可用、搜索过滤”做成可重复脚本，避免以后靠手测争论。

P2：补 Codex App 真机对比。等 computer-use 或辅助访问可用后，实际点击 Codex App：新会话、切换会话、快捷键、长任务并发、错误态、移动/窄屏替代体验，再更新本报告。
