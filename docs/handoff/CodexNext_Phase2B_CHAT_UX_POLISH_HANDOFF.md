# CodexNext Phase 2B Handoff

副标题：**Chat UX Polish & Codex-like Web Console**

> 目标：不要新增“大功能”，先把现有 Local Web Console 打磨到“用户本人可以舒服地在浏览器中真实测试 Codex”的程度。  
> 核心验收：点击发送后 100ms 内看到自己的消息、输入框立即清空、Codex 输出以 Markdown/代码/命令/Diff 的形式稳定流式展示，桌面/平板/手机没有明显布局错位。

---

## 0. 当前阶段判断

当前仓库已经不是“还没做 Web”的状态。它已经有：

- `apps/web` Next.js Web Console
- `apps/agent` local HTTP + SSE server
- 多设备 endpoint 保存
- Codex session/history
- `thread/goal/set/get/clear`
- `turn/start`
- `turn/steer`
- `turn/interrupt`
- approval modal
- SSE event replay
- 基础移动端抽屉布局

但是当前交互仍然像“工程验证台”，还不是可以长期自用的 Codex/ChatGPT-like 编程对话界面。

本阶段命名：

```txt
Phase 2B: Chat UX Polish & Codex-like Web Console
```

---

## 1. 本阶段不要做什么

不要在本阶段加入这些：

- React Native
- Tauri / Electron Launcher
- NestJS control server
- 云端 relay
- QR pairing
- 真正多设备绑定协议
- 用户系统
- 数据库持久化
- 远程公网暴露
- 任意 shell API
- 文件浏览器 / 完整 IDE
- 复用官方 Codex Renderer
- Electron-to-Web bridge
- 非 Codex CLI 支持
- 解析 Codex TUI
- 模拟 `/goal`

本阶段只改现有 Local Web Console 的体验、渲染、响应速度、布局可靠性和代码组织。

---

## 2. 当前主要问题

### 2.1 点击发送后反馈慢

现在 `submitComposer()` 在多数路径里是：

```txt
读取 draft
await POST /api/sessions/:id/messages
清空 draft
依赖后续 SSE 事件显示 chat.user
```

如果 agent / app-server 慢，用户会看到：

```txt
点了发送
输入框还在
消息没出现
像是没点中
```

这和 ChatGPT / Codex 类产品的常见体验不一致。用户输入应该先本地乐观显示，然后再等待服务端确认。

### 2.2 active turn 的 steer 也慢

agent 端当前 active turn 路径大致是：

```txt
await turn/steer
append chat.user
append turn.steer.accepted
```

这会导致“追加指令”也要等 app-server 接受后才显示。正确交互应该是：

```txt
用户点发送
Web 立即显示 user bubble: sending
agent 尽快 echo clientMessageId
turn/steer 成功后标记 sent
失败后标记 failed，可重试
```

### 2.3 Markdown 完全没渲染

当前 `ChatMessageRow` 只是：

```tsx
<div className="cn-message-text">{props.item.text}</div>
```

所以这些都不能正确展示：

- Markdown 标题
- 列表
- 表格
- 任务列表
- blockquote
- inline code
- fenced code block
- 语言标签
- 复制代码按钮
- 链接
- 长文本折叠
- 大段日志

这会严重影响 Codex 输出的可读性。

### 2.4 命令输出 / Diff / Plan 还是原始文本

当前事件映射已经有 `command.output.delta`、`diff.updated`、`plan.updated`，但 UI 基本只是普通文本或 JSON。需要改成语义卡片：

```txt
Command output
  - mono font
  - stdout/stderr display
  - copy
  - collapse large output
  - optional error highlighting

Diff
  - unified diff line parsing
  - file header
  - + green / - red / @@ muted
  - copy full diff
  - large diff collapse

Plan
  - checklist
  - status label
  - fallback JSON details
```

### 2.5 审批弹窗还太粗糙

当前 approval modal 只显示 method 和简单 `pre`。本阶段应该做成 Codex-like action card：

```txt
Codex wants to run a command
cwd: ...
command: pnpm test
reason: ...
buttons:
  Accept once
  Accept for session
  Decline
  Cancel
```

如果是文件变更审批，要显示文件路径、reason、grantRoot、diff/changes 摘要。  
如果是网络审批，要根据 `networkApprovalContext` 显示 host/protocol，而不是假设它一定是 shell command。

### 2.6 自适应存在明确问题

当前 CSS 在 `max-width: 1180px` 下给 `.cn-app-frame` 固定了：

```css
min-width: 1040px;
width: 1040px;
```

这会让 901px ~ 1180px 之间的平板、小窗口、折叠屏产生横向溢出。正确做法是：

```txt
>= 1180px: desktop 三栏
901px ~ 1179px: tablet 两栏或自动折叠侧栏，不固定 1040px
<= 900px: mobile 单屏 + sidebar drawer / bottom sheets
```

### 2.7 Scroll 和虚拟列表有点过早复杂

当前 `ChatCanvas` 自己做了高度测量和虚拟列表。问题是 Markdown、表格、代码块、折叠块、动态流式内容都会改变高度，容易带来跳动、测量失准和滚动不稳。

本阶段建议：

```txt
消息数量 <= 150：直接渲染，不启用虚拟列表
消息数量 > 150：再启用简化虚拟列表或后续接成熟库
```

先保证流式输出稳定、滚动逻辑可预测。

### 2.8 EventSource reconnect 不够稳

`openEventStream(connection, after, ...)` 只在初始连接时传入 `after`。原生 EventSource 断线自动重连时不会自动更新 query 里的 `after`。建议自己维护：

```txt
lastSeqRef
on error:
  close EventSource
  backoff
  GET /api/events?after=lastSeq
  ingest replay
  reopen /api/events/stream?after=lastSeq
```

这个和 Happy 的“seq replay”思想一致：可靠性靠单调 seq + replay，而不是只靠长连接。

---

## 3. 本阶段设计目标

### 3.1 发送体验

必须做到：

```txt
用户点击 Send
  ↓ 立即
输入框清空
user bubble 出现在底部，状态 sending
send 按钮进入短暂 pending 或 active 状态
  ↓ 网络请求成功
user bubble 状态 sent
  ↓ Codex 输出
assistant bubble 开始 streaming
  ↓ turn/completed
assistant bubble 停止 streaming，状态完成
```

失败时：

```txt
user bubble 标记 failed
显示错误信息
提供 Retry
不要把失败消息静默删除
不要把原始 draft 丢失
```

### 3.2 Chat item 新模型

更新 `apps/web/src/lib/types.ts`：

```ts
export type ChatItemRole =
  | "user"
  | "assistant"
  | "command"
  | "system"
  | "diff"
  | "plan";

export type ChatItemStatus =
  | "sending"
  | "sent"
  | "failed"
  | "streaming"
  | "complete";

export interface ChatItem {
  id: string;
  role: ChatItemRole;
  text: string;
  sessionId?: string | undefined;
  turnId?: string | undefined;
  clientMessageId?: string | undefined;
  status?: ChatItemStatus | undefined;
  createdAt?: number | undefined;
  error?: string | undefined;
  meta?: Record<string, unknown> | undefined;
}
```

### 3.3 Local message protocol

更新 `packages/protocol/src/index.ts`：

```ts
export const LocalSendMessageSchema = z.object({
  text: z.string().min(1),
  clientMessageId: z.string().min(1).optional()
});
```

事件 payload 约定：

```ts
chat.user payload:
{
  text: string;
  mode: "turn-start" | "steer";
  clientMessageId?: string;
}

turn.steer.accepted payload:
{
  text: string;
  clientMessageId?: string;
}

agent.error payload:
{
  message: string;
  clientMessageId?: string;
}
```

### 3.4 Web optimistic flow

新增纯函数 reducer，避免继续把所有逻辑堆在 `WebConsole.tsx`：

```txt
apps/web/src/features/chat/chat-state.ts
apps/web/src/features/chat/chat-events.ts
apps/web/src/features/chat/optimistic.ts
```

建议函数：

```ts
createOptimisticUserMessage(input)
markOptimisticMessageSent(state, clientMessageId)
markOptimisticMessageFailed(state, clientMessageId, error)
dedupeServerEcho(state, serverChatUserEvent)
appendAssistantDelta(state, event)
appendCommandDelta(state, event)
applyDiffUpdated(state, event)
applyPlanUpdated(state, event)
```

Web 发送流程伪结构：

```ts
async function submitComposer() {
  const text = draft.trim();
  if (!text) return;

  const clientMessageId = crypto.randomUUID();
  const message = buildMessageWithAttachments(text, attachments);

  const targetSessionId =
    currentSession?.sessionId ?? `pending-session:${clientMessageId}`;

  addOptimisticUserMessage({
    sessionId: targetSessionId,
    clientMessageId,
    text: message
  });

  setDraft("");
  setAttachments([]);

  try {
    if (currentSession) {
      await sendMessage(currentSession.sessionId, {
        text: message,
        clientMessageId
      });
      markMessageSent(clientMessageId);
      return;
    }

    await startSession({
      cwd: cwd.trim(),
      model,
      reasoningEffort,
      permissionMode,
      tokenBudget: initialTokenBudget ? Number(initialTokenBudget) : null,
      initialGoal: initialGoal.trim() || null,
      initialMessage: message,
      clientMessageId
    });
  } catch (error) {
    markMessageFailed(clientMessageId, formatError(error));
  }
}
```

如果 no-session 首条消息创建了 pending session，收到 `session.created` 后要把 pending session 的 chat items reassign 到真实 `sessionId`。当前代码已经有 `reassignSessionChatItems`，可以复用。

---

## 4. Markdown / Code / Diff 渲染

### 4.1 依赖建议

给 `apps/web` 增加：

```bash
pnpm --filter @codexnext/web add react-markdown remark-gfm rehype-highlight
```

不要启用 `rehype-raw`。默认不渲染 raw HTML，避免把模型输出当 HTML 执行。

### 4.2 新组件

建议创建：

```txt
apps/web/src/components/chat/MessageList.tsx
apps/web/src/components/chat/ChatMessageRow.tsx
apps/web/src/components/chat/MarkdownMessage.tsx
apps/web/src/components/chat/CodeBlock.tsx
apps/web/src/components/chat/CommandOutputBlock.tsx
apps/web/src/components/chat/DiffBlock.tsx
apps/web/src/components/chat/PlanBlock.tsx
apps/web/src/components/chat/ApprovalCard.tsx
apps/web/src/components/chat/CopyButton.tsx
```

### 4.3 MarkdownMessage 要求

必须支持：

- paragraph
- heading
- unordered / ordered list
- task list
- table
- blockquote
- inline code
- fenced code block
- link
- horizontal rule
- copy code

代码块示例：

```tsx
<CodeBlock language={language} code={code} />
```

`CodeBlock` 需要：

```txt
左上角语言标签
右上角 Copy
monospace
横向滚动
不要撑破移动端
```

### 4.4 DiffBlock 要求

实现一个轻量 unified diff parser：

```ts
type DiffLineKind = "file" | "hunk" | "add" | "remove" | "context";

interface DiffLine {
  kind: DiffLineKind;
  text: string;
}
```

渲染规则：

```txt
+++ / --- / diff --git → file
@@ ... @@ → hunk
+ 开头 → add
- 开头 → remove
其他 → context
```

不要在本阶段引入复杂 diff 交互。先做到清晰、可复制、可折叠。

### 4.5 CommandOutputBlock 要求

需要：

```txt
标题：Command output
正文：monospace pre-wrap
复制按钮
超过 300 行默认折叠
错误关键词轻微标记
```

不要解析 ANSI 为 HTML，除非明确加 sanitization。可以先 strip ANSI。

### 4.6 PlanBlock 要求

如果 payload 是：

```ts
{
  explanation?: string;
  plan?: Array<{ step?: string; status?: string }>
}
```

渲染成：

```txt
Plan updated
explanation
- [completed] ...
- [in_progress] ...
- [pending] ...
```

否则使用 collapsible JSON details。

---

## 5. Approval 交互

### 5.1 ApprovalModal 需要重做

当前 modal 不能只显示 `pre`。

新 UI：

```txt
Codex 请求批准

类型：
- Run command
- Apply file changes
- Network access
- Tool user input
- Unknown request

内容：
- command
- cwd
- reason
- file path
- grant root
- network host/protocol
- available decisions
- raw JSON details 折叠

按钮：
- Accept once
- Accept for session
- Decline
- Cancel
```

### 5.2 决策也要 optimistic

点击按钮后：

```txt
approval card 立即进入 resolving
modal 立即关闭或显示 submitting
等待 POST /api/approvals/:id/decision
失败则恢复 pending approval，并显示错误
```

---

## 6. 响应式布局要求

### 6.1 修复 901px ~ 1180px

删除或改掉：

```css
@media (max-width: 1180px) {
  .cn-app-frame {
    min-width: 1040px;
    width: 1040px;
  }
}
```

改成：

```css
.cn-app-frame {
  min-width: 0;
  width: min(1680px, calc(100vw - 2rem));
}

@media (max-width: 1180px) and (min-width: 901px) {
  .cn-live-console {
    padding: 0;
  }

  .cn-app-frame {
    border-radius: 0;
    height: 100dvh;
    width: 100vw;
    min-width: 0;
  }

  .cn-session-sidebar {
    width: min(var(--cn-sidebar-width), 34vw);
  }
}
```

### 6.2 移动端验收

必须在这些宽度手动看：

```txt
390px iPhone-like
430px large iPhone-like
768px tablet portrait
1024px tablet landscape / small desktop
1440px desktop
```

验收标准：

```txt
没有横向滚动
composer 没有被安全区遮挡
toolbar 按钮不挤出屏幕
bottom sheet 不超过 84dvh
approval buttons 可点击
代码块横向滚动在代码块内部，不撑爆页面
```

---

## 7. Scroll 策略

### 7.1 移除双重滚动控制

当前外层 `WebConsole` 和 `ChatCanvas` 都在试图把视图滚到底部。本阶段应该只保留 `ChatCanvas` 内的 pinned-bottom 逻辑。

删除或简化外层这个 effect：

```ts
useEffect(() => {
  const end = threadEndRef.current;
  end?.scrollIntoView({ block: "end" });
  const scroller = end?.closest(".cn-thread-canvas");
  ...
}, [currentSessionId, latestVisibleChatItem?.id, latestVisibleChatItem?.text.length]);
```

统一在 `ChatCanvas` 中处理。

### 7.2 虚拟列表策略

```txt
items.length <= 150:
  直接渲染所有消息

items.length > 150:
  暂时显示“历史较长，已折叠上方消息”或保留现有虚拟化
```

Markdown 渲染完成前，不要让虚拟化成为主要复杂度来源。

---

## 8. Event stream reconnect

改造 `openEventStream`：

```txt
不要只返回原生 EventSource
封装成 managed stream
维护 lastSeq
onmessage 更新 lastSeq
onerror:
  close
  set status reconnecting
  backoff
  GET /api/events?after=lastSeq
  ingest replay
  reopen stream with after=lastSeq
```

建议 API：

```ts
export interface ManagedEventStream {
  close(): void;
}

export function openManagedEventStream(input: {
  connection: AgentConnection;
  after: number;
  onReplay: (events: LocalEvent[]) => void;
  onEvent: (event: LocalEvent) => void;
  onStatus: (status: "connecting" | "connected" | "reconnecting" | "closed" | "error") => void;
  onError: (error: unknown) => void;
}): ManagedEventStream
```

---

## 9. 代码组织

当前 `WebConsole.tsx` 太大。本阶段至少拆出：

```txt
apps/web/src/components/chat/
apps/web/src/components/sheets/
apps/web/src/features/devices/
apps/web/src/features/sessions/
apps/web/src/features/events/
apps/web/src/features/chat/
apps/web/src/lib/format/
```

最低要求：

```txt
WebConsole.tsx <= 900 行
ChatCanvas 独立文件
LiveComposer 独立文件
DeviceSheet 独立文件
SessionSetupSheet 独立文件
GoalSheet 独立文件
EventsSheet 独立文件
ApprovalModal 独立文件
Markdown / Diff / Command 渲染独立文件
```

不要求一次拆得完美，但不要继续把 UI 堆进单文件。

---

## 10. 测试要求

优先写纯函数测试，不要为了 UI 测试引入太多成本。

### 10.1 必测

```txt
mergeLocalEvents 按 seq 去重排序
optimistic user message 立即加入
server chat.user echo 根据 clientMessageId 去重
failed optimistic message 标记 failed
append assistant delta 合并到同一个 streaming item
parseUnifiedDiff 分类 add/remove/hunk/file/context
plan payload 转 checklist
approval summary 支持 command/cwd/network/file
```

### 10.2 Agent 测试

```txt
LocalSendMessageSchema 接收 clientMessageId
startTurn 发出的 chat.user payload 包含 clientMessageId
steerTurn 在等待 turn/steer 前或至少尽早发出 optimistic/accepted 事件
turn/steer 失败时能发 agent.error 且带 clientMessageId
```

---

## 11. 验收命令

```bash
pnpm install
pnpm typecheck
pnpm test

pnpm --filter @codexnext/agent dev -- doctor

pnpm --filter @codexnext/agent dev -- serve \
  --host 127.0.0.1 \
  --port 17361 \
  --web-origin http://127.0.0.1:3000

pnpm --filter @codexnext/web dev
```

---

## 12. 手动验收脚本

### 12.1 普通发送

打开 Web，连接 agent，选择一个真实项目目录。

输入：

```txt
请阅读这个项目，先总结项目结构，不要修改文件。
```

验收：

```txt
点击发送 100ms 内出现 user bubble
输入框立即清空
user bubble 初始状态 sending
服务端确认后变 sent 或隐藏状态
Codex 回复以 Markdown 渲染
如果有代码块，代码块有语言标签和 copy
```

### 12.2 Markdown

让 Codex 输出：

```txt
请用 Markdown 返回：一个二级标题、一个列表、一个表格、一个 TypeScript 代码块。
```

验收：

```txt
标题/列表/表格/代码块正确渲染
代码块不撑破屏幕
代码块可以复制
移动端可横向滚动代码块
```

### 12.3 Diff

让 Codex 做一个非常小的 README 改动。

验收：

```txt
diff 卡片按 + / - / @@ 高亮
大 diff 可折叠
copy full diff 可用
```

### 12.4 Approval

选择 request-approval 权限，让 Codex 运行一个测试命令。

验收：

```txt
approval modal 显示 command/cwd/reason
点击 Accept once 后 modal 立即进入 resolving 或关闭
失败时恢复 pending 状态
成功后 pending approval 消失
```

### 12.5 Steer

在 Codex 正在运行时发送：

```txt
先不要新增依赖，只做最小可验证修改。
```

验收：

```txt
消息立即出现
标识为 steer 或在 active turn 中
请求成功后状态正常
```

### 12.6 Interrupt

运行中点击 Interrupt。

验收：

```txt
按钮立即变 disabled / interrupting
event timeline 出现 turn.interrupt.requested
最终 turn.completed/interrupted 后 active 状态清除
```

### 12.7 自适应

分别测试：

```txt
390px
430px
768px
1024px
1440px
```

验收：

```txt
无横向滚动
主对话区域可用
composer 可见
popover/bottom sheet 不溢出
approval 可完整操作
```

---

## 13. 给下一个 AI 的开发 Prompt

```text
你正在开发 CodexNext：Your personal Codex control plane。

当前仓库已经完成 Local Interactive Web Console，但现在要做 Phase 2B: Chat UX Polish & Codex-like Web Console。

本次任务不是新增大功能，而是把当前 Web 对话体验打磨到用户可以真实长期自测 Codex 的程度。

必须先阅读这些文件：
- apps/web/src/components/WebConsole.tsx
- apps/web/src/app/globals.css
- apps/web/src/lib/api.ts
- apps/web/src/lib/event-stream.ts
- apps/web/src/lib/types.ts
- apps/agent/src/local-server/session-manager.ts
- apps/agent/src/local-server/create-local-server.ts
- packages/protocol/src/index.ts

重点问题：
1. 点击发送后消息没有立即显示，输入框清空也慢。
2. active turn 的 steer 也要等 app-server 返回后才显示用户消息。
3. ChatMessageRow 只是纯文本，没有 Markdown、代码块、表格、Diff、命令输出格式化。
4. ApprovalModal 只显示粗糙 pre，不够 Codex-like。
5. 901px ~ 1180px 的布局有固定 1040px 宽度，容易横向溢出。
6. ChatCanvas 的虚拟列表对 Markdown 动态高度过早复杂，容易滚动抖动。
7. EventSource 重连没有基于最新 seq 做 replay。

请实现：

A. Optimistic message pipeline
- packages/protocol LocalSendMessageSchema 增加 clientMessageId?: string。
- Web submit 时生成 crypto.randomUUID()。
- 点击发送后立即 add optimistic user message，状态 sending。
- 立即清空 draft 和 attachments。
- 请求成功后标记 sent。
- 请求失败后标记 failed，并提供 retry 基础能力。
- server chat.user echo 必须根据 clientMessageId 去重。
- no-session 第一条消息创建 pending session，session.created 后把消息 reassign 到真实 sessionId。
- active turn steer 也必须立即显示 user bubble。

B. Agent event echo
- startTurn 的 chat.user payload 带 clientMessageId。
- sendMessage/steerTurn 的 chat.user payload 带 clientMessageId。
- turn/steer 失败时发 agent.error，payload 带 clientMessageId。
- 尽量让 chat.user 事件早于慢 RPC 返回，避免 UI 等待。

C. Markdown and rich rendering
- apps/web 增加 react-markdown、remark-gfm、rehype-highlight。
- 不启用 rehype-raw。
- 新增 MarkdownMessage、CodeBlock、CopyButton。
- 支持 heading/list/task list/table/blockquote/inline code/fenced code/link/hr。
- code block 有语言标签、copy、移动端内部横向滚动。
- 用户消息也可以使用轻量 Markdown，但保持 user bubble 风格。

D. Semantic blocks
- 新增 CommandOutputBlock，支持 monospace、copy、collapse large output。
- 新增 DiffBlock，轻量解析 unified diff，按 file/hunk/add/remove/context 渲染。
- 新增 PlanBlock，把 plan array 渲染成 checklist，fallback JSON details。
- ChatMessageRow 根据 role 调用不同 renderer。
- turn.completed 不要作为大段噪音消息，改成轻量状态 chip 或小 system row。

E. Approval UX
- ApprovalModal 改成 action card。
- 支持 command/cwd/reason/file/grantRoot/networkApprovalContext/availableDecisions。
- raw JSON 放到 details。
- 点击决策后 optimistic resolving，成功移除，失败恢复。
- 复制 command。

F. Responsive fix
- 移除 901px~1180px 固定 1040px 宽度。
- tablet 使用 fluid width，无横向滚动。
- mobile 继续 sidebar drawer + bottom sheet。
- 验证 390/430/768/1024/1440 宽度。

G. Scroll and streaming stability
- 只在 ChatCanvas 内管理 pinned-bottom。
- 删除 WebConsole 外层强制 scrollIntoView effect。
- items.length <= 150 直接渲染，不走虚拟列表。
- assistant delta 合并同一 streaming item。
- SSE 高频 delta 用 requestAnimationFrame batch，避免每个 token 都触发全量重排。

H. EventSource reconnect
- 新增 managed event stream。
- 维护 lastSeq。
- onerror 后 close/backoff/replay/reopen。
- reconnect 后 GET /api/events?after=lastSeq，避免丢事件。

I. Code organization
- WebConsole.tsx 拆分，目标 <= 900 行。
- 至少拆出 chat、sheets、events、devices 相关组件和 chat reducer/format 函数。
- 不要继续把新逻辑塞进 WebConsole.tsx。

测试：
- mergeLocalEvents 去重排序
- optimistic user message 立即加入
- server echo 根据 clientMessageId 去重
- failed message 标记 failed
- assistant delta 合并
- parseUnifiedDiff 分类
- plan payload 转 checklist
- approval summary 支持 command/network/file
- LocalSendMessageSchema 支持 clientMessageId
- agent startTurn/steerTurn 事件带 clientMessageId

验收命令：
pnpm install
pnpm typecheck
pnpm test
pnpm --filter @codexnext/agent dev -- doctor
pnpm --filter @codexnext/agent dev -- serve --host 127.0.0.1 --port 17361 --web-origin http://127.0.0.1:3000
pnpm --filter @codexnext/web dev

手动验收：
1. 点击发送 100ms 内出现自己的消息，输入框立即清空。
2. Assistant Markdown 正常渲染标题、列表、表格和 TS 代码块。
3. Diff 卡片有 + / - / @@ 高亮和 copy。
4. Approval modal 显示 command/cwd/reason，点击后立即响应。
5. active turn 中发送 steer 立即出现消息。
6. Interrupt 后 UI 立即进入 interrupting，最终清除 active 状态。
7. 390/430/768/1024/1440 宽度无横向滚动。
8. 断开 agent 再恢复，不丢事件，能 replay。
```

---

## 14. 本阶段完成定义

Phase 2B 完成后，用户应该能说：

```txt
我已经可以在浏览器里像使用 Codex/ChatGPT 一样和 Codex 对话。
发送立即有反馈。
输出可读。
代码块和 diff 能看。
审批能判断。
手机和平板不会崩布局。
```

这比新增 RN、多设备、pairing 更重要。  
只有 Phase 2B 完成后，才建议进入 Phase 3：Local Agent hardening / Device pairing design。
