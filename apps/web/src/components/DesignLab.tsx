"use client";

import { getCodexUiIcon, type CodexUiIconName } from "@codexnext/codex-icons";
import { useState } from "react";

export type DesignState =
  | "empty"
  | "device"
  | "project"
  | "permission"
  | "model"
  | "typing"
  | "chat"
  | "running"
  | "approval";

export type DesignFlow =
  | "current"
  | "new-session"
  | "thread"
  | "approval-flow"
  | "device-flow"
  | "settings"
  | "components"
  | "archive";

const designStates: Array<{
  id: DesignState;
  label: string;
  description: string;
}> = [
  {
    id: "empty",
    label: "01 空白新会话",
    description: "普通入口只保留底部输入框，不显示 Goal / Token Budget。"
  },
  {
    id: "device",
    label: "02 选择设备",
    description: "设备是可编辑名称的 Codex Agent 目标，不是当前浏览器。"
  },
  {
    id: "project",
    label: "03 选择项目",
    description: "目录浏览选择 cwd，不要求用户手动输入路径。"
  },
  {
    id: "permission",
    label: "04 权限菜单",
    description: "四种 Codex 权限模式，贴近输入框的轻菜单。"
  },
  {
    id: "model",
    label: "05 模型与推理",
    description: "模型、推理深度、速度在一个菜单里完成选择。"
  },
  {
    id: "typing",
    label: "06 输入发送",
    description: "没有正在运行的任务时，上箭头会开启新一轮对话。"
  },
  {
    id: "chat",
    label: "07 聊天视图",
    description: "进入同一个对话后继续交流，事件融入消息流。"
  },
  {
    id: "running",
    label: "08 运行中追加",
    description: "正在运行时，输入框用于追加指令和调整方向。"
  },
  {
    id: "approval",
    label: "09 审批请求",
    description: "审批请求必须由用户处理，不再默认拒绝。"
  }
];

const designStateById = new Map(designStates.map((state) => [state.id, state]));

const designFlows: Array<{
  id: DesignFlow;
  href: string;
  label: string;
  description: string;
  defaultState: DesignState;
  states: DesignState[];
}> = [
  {
    id: "current",
    href: "/design",
    label: "当前主设计",
    description: "最新可执行的 CodexNext Web 控制台设计板。",
    defaultState: "empty",
    states: ["empty", "device", "project", "permission", "model", "typing", "chat", "running", "approval"]
  },
  {
    id: "new-session",
    href: "/design/new-session",
    label: "新会话流程",
    description: "新建对话、选择项目、模型、推理和权限。",
    defaultState: "empty",
    states: ["empty", "project", "permission", "model", "typing"]
  },
  {
    id: "thread",
    href: "/design/thread",
    label: "对话与运行中",
    description: "同一 thread 的聊天视图、running、steer 和 interrupt。",
    defaultState: "chat",
    states: ["chat", "running"]
  },
  {
    id: "approval-flow",
    href: "/design/approval",
    label: "审批请求",
    description: "命令/文件 approval request 的浏览器处理体验。",
    defaultState: "approval",
    states: ["approval"]
  },
  {
    id: "device-flow",
    href: "/design/device",
    label: "设备与项目",
    description: "设备命名、连接状态、项目文件夹选择入口。",
    defaultState: "device",
    states: ["device", "project"]
  },
  {
    id: "settings",
    href: "/design/settings",
    label: "设置与账户",
    description: "后续账户、设备、偏好设置的设计占位。",
    defaultState: "empty",
    states: ["empty", "device"]
  },
  {
    id: "components",
    href: "/design/components",
    label: "组件与图标",
    description: "Codex 风图标、按钮、菜单、pill 的共享样式库。",
    defaultState: "empty",
    states: ["empty", "permission", "model"]
  },
  {
    id: "archive",
    href: "/design/archive",
    label: "设计归档",
    description: "保存旧版本、Figma 截图和阶段性决策。",
    defaultState: "empty",
    states: ["empty"]
  }
];

const defaultDesignFlow = designFlows[0]!;

function getDesignFlow(flow: DesignFlow) {
  return designFlows.find((candidate) => candidate.id === flow) ?? defaultDesignFlow;
}

export type CodexIconName = CodexUiIconName;

const folders = [
  "Applications",
  "Desktop",
  "Dev",
  "Documents",
  "Downloads",
  "Pictures"
];

const projectTree = [
  {
    name: "dailywork",
    sessions: ["估算5月6月成本"]
  },
  {
    name: "Dev",
    sessions: [
      "CodexNext",
      "安装并启动 odysseus",
      "Gmail邮件",
      "拉取最新代码"
    ]
  },
  {
    name: "虚量合同",
    sessions: ["按文件内容重命名"]
  },
  {
    name: "翘楚弹幕",
    sessions: ["发送弹幕并记录时间"]
  },
  {
    name: "pi",
    sessions: ["了解 pi 用法"]
  },
  {
    name: "工程量处理",
    sessions: ["查找历史报价单资料", "按清单计算钢筋用量", "整理三项目人员并修改Word"]
  },
  {
    name: "Desktop",
    sessions: ["查找物资计划总表", "查询意大利旅游材料", "编写视频下载脚本"]
  },
  {
    name: "文件处理",
    sessions: ["同步最终提交版本", "检查材料统计表公式"]
  },
  {
    name: "月报",
    sessions: ["更新安全月活动方案", "生成第三周周报"]
  },
  {
    name: "账单签收件_12个PDF_2026-06",
    sessions: ["找出缺少签收的文件"]
  }
];

export function CodexIcon(props: { name: CodexIconName; className?: string }) {
  const className = ["cn-codex-icon", props.className].filter(Boolean).join(" ");
  const icon = getCodexUiIcon(props.name);
  return (
    <span
      aria-hidden="true"
      className={className}
      style={
        icon.rotateDegrees == null
          ? undefined
          : { transform: `rotate(${icon.rotateDegrees}deg)` }
      }
      dangerouslySetInnerHTML={{ __html: icon.svg }}
    />
  );
}

export function DesignLab(props: { flow?: DesignFlow; initialState?: DesignState }) {
  const initialFlow = props.flow ?? "current";
  const initialFlowConfig = getDesignFlow(initialFlow);
  const [activeFlow, setActiveFlow] = useState<DesignFlow>(initialFlow);
  const [activeState, setActiveState] = useState<DesignState>(
    props.initialState ?? initialFlowConfig.defaultState
  );
  const [projectName, setProjectName] = useState("CodexNext");
  const [permission, setPermission] = useState("请求批准");
  const [model, setModel] = useState("5.5 超高");
  const [draft, setDraft] = useState("");

  const selectedFlow = getDesignFlow(activeFlow);
  const selectedState = designStates.find((state) => state.id === activeState);
  const visibleStates = selectedFlow.states
    .map((state) => designStateById.get(state))
    .filter((state): state is (typeof designStates)[number] => Boolean(state));

  function openState(state: DesignState) {
    setActiveState(state);
  }

  function openFlow(flow: DesignFlow) {
    const nextFlow = getDesignFlow(flow);
    setActiveFlow(nextFlow.id);
    setActiveState(nextFlow.defaultState);
  }

  function sendDraft() {
    if (activeState === "running") {
      return;
    }
    setDraft("");
    setActiveState("chat");
  }

  return (
    <main className="cn-design-lab">
      <aside className="cn-design-control">
        <div className="cn-design-control-heading">
          <span>CodexNext</span>
          <strong>设计工作台</strong>
          <p>长期运行的 React/CSS 设计系统。只做 UI 和交互，不连 agent。</p>
        </div>

        <div className="cn-design-flow-list" aria-label="设计流">
          {designFlows.map((flow) => (
            <a
              key={flow.id}
              className={
                activeFlow === flow.id
                  ? "cn-design-flow-button active"
                  : "cn-design-flow-button"
              }
              href={flow.href}
              onClick={(event) => {
                event.preventDefault();
                openFlow(flow.id);
              }}
            >
              <strong>{flow.label}</strong>
              <span>{flow.description}</span>
            </a>
          ))}
        </div>

        <div className="cn-design-state-section">
          <span className="cn-design-section-label">当前 flow 状态</span>
          <div className="cn-design-state-list">
            {visibleStates.map((state) => (
              <button
                key={state.id}
                className={
                  activeState === state.id
                    ? "cn-design-state-button active"
                    : "cn-design-state-button"
                }
                type="button"
                onClick={() => openState(state.id)}
              >
                <strong>{state.label}</strong>
                <span>{state.description}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="cn-design-notes">
          <strong>设计约定</strong>
          <p>新阶段先进入对应 flow，用假数据调 UI；确认后再对接真实 agent。</p>
          <p>普通新会话不出现 Goal，也不出现 Token Budget。</p>
        </div>
      </aside>

      <section className="cn-design-preview-area">
        <header className="cn-design-preview-header">
          <div>
            <span>{selectedFlow.label}</span>
            <strong>{selectedState?.label}</strong>
          </div>
          <a href="/" aria-label="Open live console">
            真实控制台
          </a>
        </header>

        {activeFlow === "components" ? (
          <DesignComponentGallery
            model={model}
            permission={permission}
            onOpenModel={() => openState("model")}
            onOpenPermission={() => openState("permission")}
          />
        ) : activeFlow === "archive" ? (
          <DesignArchivePanel />
        ) : (
          <CodexDesktopMock
            activeState={activeState}
            draft={draft}
            model={model}
            permission={permission}
            projectName={projectName}
            onDraftChange={setDraft}
            onOpenDevice={() => openState("device")}
            onOpenProject={() => openState("project")}
            onOpenPermission={() => openState("permission")}
            onOpenModel={() => openState("model")}
            onSend={sendDraft}
            onSelectProject={(value) => {
              setProjectName(value);
              setActiveState("typing");
            }}
            onSelectPermission={(value) => {
              setPermission(value);
              setActiveState("typing");
            }}
            onSelectModel={(value) => {
              setModel(value);
              setActiveState("typing");
            }}
            onCloseOverlay={() => setActiveState("empty")}
            onNewChat={() => {
              setDraft("");
              setActiveState("project");
            }}
            onInterrupt={() => setActiveState("chat")}
            onOpenApproval={() => setActiveState("approval")}
            onStartRunning={() => setActiveState("running")}
          />
        )}
      </section>
    </main>
  );
}

function DesignComponentGallery(props: {
  model: string;
  permission: string;
  onOpenModel: () => void;
  onOpenPermission: () => void;
}) {
  const iconNames: CodexIconName[] = [
    "compose",
    "search",
    "folder",
    "terminal",
    "settings",
    "collapse",
    "back",
    "forward",
    "plus",
    "more",
    "arrowUp",
    "shield",
    "shieldAlert",
    "hand",
    "check",
    "phone"
  ];

  return (
    <section className="cn-design-component-gallery">
      <div className="cn-component-hero">
        <span>Codex-style registry</span>
        <h2>组件和图标先在这里统一，再进入真实页面。</h2>
        <p>
          这里是持续维护的组件样板间：以后新增 Goal、diff、events、设备管理，
          都先补到这个 flow，确认后再接真实数据。
        </p>
      </div>

      <div className="cn-component-grid">
        <article className="cn-component-card wide">
          <span className="cn-component-label">Composer</span>
          <DesktopComposer
            activeState="typing"
            draft=""
            model={props.model}
            permission={props.permission}
            projectName="CodexNext"
            running={false}
            onDraftChange={() => undefined}
            onOpenModel={props.onOpenModel}
            onOpenPermission={props.onOpenPermission}
            onSend={() => undefined}
            onStartRunning={() => undefined}
          />
        </article>

        <article className="cn-component-card">
          <span className="cn-component-label">Device card</span>
          <button className="cn-device-summary sample" type="button">
            <CodexIcon name="terminal" className="cn-device-icon" />
            <span className="cn-live-dot" />
            <span className="cn-device-copy">
              <strong>MacBookAir</strong>
              <small>在线 · codex-cli 0.137</small>
            </span>
          </button>
        </article>

        <article className="cn-component-card">
          <span className="cn-component-label">Menu rows</span>
          <button className="cn-menu-row with-icon selected" type="button">
            <CodexIcon name="shieldAlert" />
            <span>
              <strong>完全访问权限</strong>
              <small>不受限制地访问互联网和本机文件</small>
            </span>
            <em>
              <CodexIcon name="check" />
            </em>
          </button>
          <button className="cn-menu-row compact selected" type="button">
            <strong>超高</strong>
            <em>
              <CodexIcon name="check" />
            </em>
          </button>
        </article>

        <article className="cn-component-card wide">
          <span className="cn-component-label">Icon registry</span>
          <div className="cn-icon-grid">
            {iconNames.map((icon) => (
              <div key={icon} className="cn-icon-swatch" title={icon}>
                <CodexIcon name={icon} />
                <span>{icon}</span>
              </div>
            ))}
          </div>
        </article>
      </div>
    </section>
  );
}

function DesignArchivePanel() {
  return (
    <section className="cn-design-archive">
      <div>
        <span>Archive</span>
        <h2>旧版本留在归档里，新版本只维护当前 flow。</h2>
        <p>
          以后不会继续用 10-19、20-29 这种编号堆图。每个阶段只新增稳定 flow，
          旧截图、Figma 输出和被替换的方案放进归档，方便回看但不干扰当前实现。
        </p>
      </div>
      <div className="cn-archive-list">
        <article>
          <strong>Phase 2A nine-grid</strong>
          <span>最早的九宫格新会话设计草图，已被当前 flow 结构替代。</span>
          <code>docs/design/phase2-new-chat-ui-9grid.svg</code>
        </article>
        <article>
          <strong>Figma desktop exploration</strong>
          <span>桌面 Web 设计探索稿，作为视觉参考，不直接作为实现源。</span>
          <code>docs/design/figma-phase2-new-chat-ui.png</code>
        </article>
        <article>
          <strong>Codex icon registry</strong>
          <span>Codex 风图标系统说明，后续所有 UI 图标从这里扩展。</span>
          <code>docs/design/CODEX_ICON_SYSTEM.md</code>
        </article>
      </div>
    </section>
  );
}

function CodexDesktopMock(props: {
  activeState: DesignState;
  draft: string;
  model: string;
  permission: string;
  projectName: string;
  onDraftChange: (value: string) => void;
  onOpenDevice: () => void;
  onOpenProject: () => void;
  onOpenPermission: () => void;
  onOpenModel: () => void;
  onSend: () => void;
  onSelectProject: (value: string) => void;
  onSelectPermission: (value: string) => void;
  onSelectModel: (value: string) => void;
  onCloseOverlay: () => void;
  onNewChat: () => void;
  onInterrupt: () => void;
  onOpenApproval: () => void;
  onStartRunning: () => void;
}) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const inThread =
    props.activeState === "chat" ||
    props.activeState === "running" ||
    props.activeState === "approval";
  const running = props.activeState === "running";
  const revealMainOnMobile = () => {
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 900px)").matches) {
      setSidebarCollapsed(true);
    }
  };
  const openDevice = () => {
    revealMainOnMobile();
    props.onOpenDevice();
  };
  const openNewChat = () => {
    revealMainOnMobile();
    props.onNewChat();
  };
  const selectThread = () => {
    revealMainOnMobile();
    props.onSend();
  };

  return (
    <div
      className={
        sidebarCollapsed
          ? "cn-desktop-frame sidebar-collapsed"
          : "cn-desktop-frame"
      }
    >
      <NavigationRail
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={() => setSidebarCollapsed((collapsed) => !collapsed)}
        onOpenDevice={openDevice}
        onNewChat={openNewChat}
      />
      <SessionSidebar
        activeProject={props.projectName}
        onToggleSidebar={() => setSidebarCollapsed((collapsed) => !collapsed)}
        onNewChat={openNewChat}
        onOpenDevice={openDevice}
        onSelectThread={selectThread}
      />

      <section className={inThread ? "cn-main thread" : "cn-main"}>
        <DesktopHeader
          activeState={props.activeState}
          model={props.model}
          onOpenApproval={props.onOpenApproval}
          onToggleSidebar={() => setSidebarCollapsed((collapsed) => !collapsed)}
          projectName={props.projectName}
          sidebarCollapsed={sidebarCollapsed}
        />

        {inThread ? (
          <ThreadCanvas
            running={running}
            onInterrupt={props.onInterrupt}
            onOpenApproval={props.onOpenApproval}
            onStartRunning={props.onStartRunning}
          />
        ) : (
          <NewChatCanvas activeState={props.activeState} />
        )}

        <DesktopComposer
          draft={props.draft}
          model={props.model}
          permission={props.permission}
          projectName={props.projectName}
          running={running}
          activeState={props.activeState}
          onDraftChange={props.onDraftChange}
          onOpenModel={props.onOpenModel}
          onOpenPermission={props.onOpenPermission}
          onSend={props.onSend}
          onStartRunning={props.onStartRunning}
        />

        {props.activeState === "device" ? (
          <DeviceSheet onClose={props.onCloseOverlay} />
        ) : null}
        {props.activeState === "project" ? (
          <ProjectSheet
            selectedProject={props.projectName}
            onSelect={props.onSelectProject}
          />
        ) : null}
        {props.activeState === "permission" ? (
          <PermissionMenu
            selected={props.permission}
            onSelect={props.onSelectPermission}
          />
        ) : null}
        {props.activeState === "model" ? (
          <ModelMenu selected={props.model} onSelect={props.onSelectModel} />
        ) : null}
        {props.activeState === "approval" ? <ApprovalModal /> : null}
      </section>
    </div>
  );
}

function NavigationRail(props: {
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  onOpenDevice: () => void;
  onNewChat: () => void;
}) {
  return (
    <nav className="cn-nav-rail" aria-label="Design lab navigation">
      <div className="cn-mark">CN</div>
      {props.sidebarCollapsed ? (
        <button
          className="cn-rail-button"
          type="button"
          onClick={props.onToggleSidebar}
          aria-label="展开会话栏"
        >
          <CodexIcon name="collapse" />
        </button>
      ) : null}
      <button
        className="cn-rail-button active"
        type="button"
        onClick={props.onOpenDevice}
        aria-label="选择设备"
      >
        <CodexIcon name="terminal" />
        <span className="cn-rail-dot" />
      </button>
      <button
        className="cn-rail-button"
        type="button"
        onClick={props.onNewChat}
        aria-label="新建对话"
      >
        <CodexIcon name="compose" />
      </button>
      <button className="cn-rail-button muted" type="button" aria-label="更多">
        <CodexIcon name="more" />
      </button>
    </nav>
  );
}

function SessionSidebar(props: {
  activeProject: string;
  onToggleSidebar: () => void;
  onNewChat: () => void;
  onOpenDevice: () => void;
  onSelectThread: () => void;
}) {
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(
    () => new Set(["账单签收件_12个PDF_2026-06"])
  );

  function toggleProject(projectName: string) {
    setCollapsedProjects((current) => {
      const next = new Set(current);
      if (next.has(projectName)) {
        next.delete(projectName);
      } else {
        next.add(projectName);
      }
      return next;
    });
  }

  return (
    <aside className="cn-session-sidebar">
      <div className="cn-sidebar-fixed">
        <div className="cn-sidebar-windowbar" aria-label="窗口导航">
          <span className="cn-window-dot red" />
          <span className="cn-window-dot yellow" />
          <span className="cn-window-dot green" />
          <button type="button" aria-label="折叠会话栏" onClick={props.onToggleSidebar}>
            <CodexIcon name="collapse" />
          </button>
          <button type="button" aria-label="后退" onClick={props.onNewChat}>
            <CodexIcon name="back" />
          </button>
          <button type="button" aria-label="前进" onClick={props.onSelectThread}>
            <CodexIcon name="forward" />
          </button>
        </div>

        <div className="cn-sidebar-brand">
          <strong>CodexNext</strong>
          <span>Your personal Codex control plane</span>
        </div>

        <button className="cn-device-summary" type="button" onClick={props.onOpenDevice}>
          <CodexIcon name="terminal" className="cn-device-icon" />
          <span className="cn-live-dot" />
          <span className="cn-device-copy">
            <strong>MacBookAir</strong>
            <small>在线 · codex-cli 0.137</small>
          </span>
        </button>

        <button className="cn-new-chat-button" type="button" onClick={props.onNewChat}>
          <CodexIcon name="compose" />
          新建对话
        </button>
      </div>

      <div className="cn-project-tree">
        <span className="cn-project-tree-title">项目</span>
        <div className="cn-project-scroll">
          {projectTree.map((project) => (
            <div key={project.name} className="cn-project-group">
              <button
                className="cn-project-name"
                title={project.name}
                type="button"
                onClick={() => toggleProject(project.name)}
              >
                <span className="cn-project-heading-copy">
                  <CodexIcon name="folder" className="cn-project-icon" />
                  <strong>{project.name}</strong>
                </span>
                <CodexIcon
                  name={collapsedProjects.has(project.name) ? "chevronRight" : "chevronDown"}
                  className="cn-project-collapse-icon"
                />
              </button>
              {collapsedProjects.has(project.name) ? null : (
                <div className="cn-thread-list">
                  {project.sessions.map((session) => (
                    <button
                      key={`${project.name}-${session}`}
                      className={
                        props.activeProject === session
                          ? "cn-thread-row selected"
                          : "cn-thread-row"
                      }
                      title={session}
                      type="button"
                      onClick={props.onSelectThread}
                    >
                      <span>{session}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="cn-sidebar-footer">
        <button className="cn-settings-button" type="button" aria-label="设置">
          <span>
            <CodexIcon name="settings" />
            设置
          </span>
          <CodexIcon name="phone" />
        </button>
      </div>
    </aside>
  );
}

function DesktopHeader(props: {
  activeState: DesignState;
  model: string;
  onOpenApproval: () => void;
  onToggleSidebar: () => void;
  projectName: string;
  sidebarCollapsed: boolean;
}) {
  const inThread =
    props.activeState === "chat" ||
    props.activeState === "running" ||
    props.activeState === "approval";
  const title =
    inThread ? props.projectName : "新会话";
  const status =
    props.activeState === "running"
      ? "正在处理 · 可以继续追加指令"
      : "MacBookAir · 在线";

  return (
    <header className="cn-main-header">
      <button
        className="cn-mobile-menu-button"
        type="button"
        onClick={props.onToggleSidebar}
        aria-label={props.sidebarCollapsed ? "展开目录" : "收起目录"}
      >
        <CodexIcon name={props.sidebarCollapsed ? "collapse" : "chevronLeft"} />
      </button>
      <div>
        <h1>{title}</h1>
        <p>{status}</p>
      </div>
      <div className="cn-live-header-actions">
        {inThread ? (
          <button className="cn-soft-button" type="button">
            Goal
          </button>
        ) : null}
        <button className="cn-soft-button" type="button" onClick={props.onOpenApproval}>
          Events #128
        </button>
        {props.activeState === "running" ? (
          <button className="cn-soft-button danger" type="button">
            Interrupt
          </button>
        ) : null}
      </div>
    </header>
  );
}

function NewChatCanvas(_props: { activeState: DesignState }) {
  return (
    <section className="cn-empty-canvas cn-live-empty">
      <div className="cn-empty-copy">
        <h2>要在 CodexNext 中构建什么？</h2>
        <p>
          像 Codex 一样从底部输入开始。新会话设置只在弹窗里完成：
          选择设备、项目文件夹、权限、模型和推理深度。
        </p>
      </div>
    </section>
  );
}

function ThreadCanvas(props: {
  running: boolean;
  onInterrupt: () => void;
  onOpenApproval: () => void;
  onStartRunning: () => void;
}) {
  return (
    <section className="cn-thread-canvas">
      <article className="cn-message user">
        检查这个项目，先告诉我有哪些明显问题
      </article>
      <article className="cn-message assistant">
        {props.running ? (
          <>
            <span className="cn-running-note">Codex 正在处理 · 已用时 46s</span>
            <p>计划已更新，准备执行命令。</p>
            <p>我会先检查 package、agent 和 web 的边界。</p>
          </>
        ) : (
          <>
            <p>我会先检查 workspace、agent 和 web 的边界。</p>
            <p>然后给你可验证的问题列表。</p>
          </>
        )}
      </article>
      <article className="cn-message command">
        <span>$ rg --files apps packages</span>
      </article>
      {props.running ? (
        <button className="cn-inline-stop" type="button" onClick={props.onInterrupt}>
          停止当前 turn
        </button>
      ) : (
        <button className="cn-inline-approval-trigger" type="button" onClick={props.onOpenApproval}>
          预览审批请求
        </button>
      )}
    </section>
  );
}

function DesktopComposer(props: {
  draft: string;
  model: string;
  permission: string;
  projectName: string;
  running: boolean;
  activeState: DesignState;
  onDraftChange: (value: string) => void;
  onOpenModel: () => void;
  onOpenPermission: () => void;
  onSend: () => void;
  onStartRunning: () => void;
}) {
  const inputValue =
    props.activeState === "typing" && !props.draft
      ? "检查这个项目，先告诉我\n有哪些明显问题"
      : props.running
        ? "先不要改代码，只输出问题列表"
        : props.draft;

  return (
    <footer className={props.running ? "cn-desktop-composer steer" : "cn-desktop-composer"}>
      <textarea
        aria-label="设计输入框"
        placeholder={props.running ? "追加指令或调整方向..." : "要在 CodexNext 中构建什么？"}
        value={inputValue}
        onChange={(event) => props.onDraftChange(event.target.value)}
      />
      <div className="cn-composer-toolbar">
        <button className="cn-icon-button" type="button" title="上传文件">
          <CodexIcon name="plus" />
        </button>
        <button className="cn-composer-pill" type="button" onClick={props.onOpenModel}>
          {props.model}
          <CodexIcon name="chevronDown" />
        </button>
        <button className="cn-composer-pill" type="button" onClick={props.onOpenPermission}>
          {props.permission}
          <CodexIcon name="chevronDown" />
        </button>
        <button
          className="cn-send-button"
          type="button"
          disabled={!inputValue.trim()}
          onClick={props.running ? props.onStartRunning : props.onSend}
        >
          <CodexIcon name="arrowUp" />
        </button>
      </div>
    </footer>
  );
}

function DeviceSheet(props: { onClose: () => void }) {
  return (
    <div className="cn-overlay-panel device">
      <div className="cn-sheet-card cn-live-sheet">
        <button className="cn-close-button" type="button" onClick={props.onClose}>
          <CodexIcon name="x" />
        </button>
        <h2>连接设备</h2>
        <p>设备名代表你要控制的 Codex Agent，可以是这台 Mac，也可以是远程服务器。</p>

        <div className="cn-real-device-row online">
          <CodexIcon name="terminal" />
          <span className="cn-live-dot" />
          <div>
            <strong>MacBookAir</strong>
            <small>connected · codex-cli 0.137</small>
          </div>
        </div>

        <label>
          设备名称
          <input value="MacBookAir" readOnly />
        </label>
        <label>
          Agent URL
          <input value="http://127.0.0.1:17361" readOnly />
        </label>
        <label>
          Access Token
          <input value="cn-demo-token" readOnly />
        </label>

        <div className="cn-sheet-actions">
          <button className="cn-soft-button" type="button" onClick={props.onClose}>
            取消
          </button>
          <button className="cn-primary-button" type="button">
            重新连接
          </button>
        </div>
      </div>
    </div>
  );
}

function ProjectSheet(props: {
  selectedProject: string;
  onSelect: (value: string) => void;
}) {
  return (
    <div className="cn-overlay-panel project">
      <div className="cn-project-card cn-live-session-sheet">
        <button className="cn-close-button cn-sticky-close" type="button">
          <CodexIcon name="x" />
        </button>
        <h2>新会话设置</h2>

        <button className="cn-settings-row" type="button">
          <span>设备</span>
          <strong>MacBookAir</strong>
          <small>connected</small>
        </button>

        <div className="cn-project-search">
          <CodexIcon name="search" />
          /Users/ganxing/Dev/CodexNext
        </div>

        <div className="cn-folder-picker-actions">
          <button className="cn-soft-button" type="button">
            Home
          </button>
          <button className="cn-soft-button" type="button">
            上级
          </button>
          <button className="cn-soft-button" type="button">
            浏览
          </button>
        </div>

        <div className="cn-path-label">/Users/ganxing/Dev</div>
        <div className="cn-folder-list cn-real-folder-list">
          {["CodexNext", "dailywork", "CLIProxyAPI", "agent-social-publisher", "local-tools"].map((folder) => (
            <button
              key={folder}
              className={
                props.selectedProject === folder || folder === "CodexNext"
                  ? "cn-folder-row selected"
                  : "cn-folder-row"
              }
              type="button"
              onClick={() => props.onSelect(folder)}
            >
              <CodexIcon name="folder" />
              <span>{folder}</span>
            </button>
          ))}
        </div>

        <button
          className="cn-primary-button cn-use-folder-button"
          type="button"
          onClick={() => props.onSelect("CodexNext")}
        >
          使用此文件夹
        </button>

        <div className="cn-session-settings-grid">
          <label>
            模型
            <select value="gpt-5.5" onChange={() => undefined}>
              <option>GPT-5.5</option>
            </select>
          </label>
          <label>
            推理
            <select value="xhigh" onChange={() => undefined}>
              <option value="xhigh">超高</option>
            </select>
          </label>
        </div>

        <div className="cn-permission-list-real">
          {[
            ["hand", "请求批准", "编辑外部文件和使用互联网时始终询问"],
            ["shieldCode", "替我审批", "仅对检测到的风险操作请求批准"],
            ["shieldAlert", "完全访问权限", "可不受限制地访问互联网和电脑上的任何文件"],
            ["settings", "自定义 config.toml", "使用 config.toml 中定义的权限"]
          ].map(([icon, label, description]) => (
            <button
              key={label}
              className={label === "请求批准" ? "cn-menu-row with-icon selected" : "cn-menu-row with-icon"}
              type="button"
            >
              <CodexIcon name={icon as CodexIconName} />
              <span>
                <strong>{label}</strong>
              </span>
              {label === "请求批准" ? (
                <em>
                  <CodexIcon name="check" />
                </em>
              ) : null}
            </button>
          ))}
        </div>

        <details className="cn-goal-advanced">
          <summary>Goal（可选）</summary>
          <label>
            Objective
            <textarea readOnly placeholder="目标" />
          </label>
          <label>
            Token Budget
            <input inputMode="numeric" placeholder="可选" readOnly />
          </label>
        </details>
      </div>
    </div>
  );
}

function PermissionMenu(props: {
  selected: string;
  onSelect: (value: string) => void;
}) {
  const permissions: Array<{
    description: string;
    icon: CodexIconName;
    label: string;
  }> = [
    {
      description: "编辑外部文件和使用互联网时始终询问",
      icon: "hand",
      label: "请求批准"
    },
    {
      description: "仅对检测到的风险操作请求批准",
      icon: "shield",
      label: "替我审批"
    },
    {
      description: "可不受限制地访问互联网和电脑上的任何文件",
      icon: "shieldAlert",
      label: "完全访问权限"
    },
    {
      description: "使用 config.toml 中定义的权限",
      icon: "settings",
      label: "自定义 config.toml"
    }
  ];

  return (
    <div className="cn-popover permission">
      <p>应如何批准 Codex 操作？</p>
      {permissions.map((permission) => (
        <button
          key={permission.label}
          className={
            props.selected === permission.label
              ? "cn-menu-row with-icon selected"
              : "cn-menu-row with-icon"
          }
          type="button"
          onClick={() => props.onSelect(permission.label)}
        >
          <CodexIcon name={permission.icon} />
          <span>
            <strong>{permission.label}</strong>
            <small>{permission.description}</small>
          </span>
          {props.selected === permission.label ? (
            <em>
              <CodexIcon name="check" />
            </em>
          ) : null}
        </button>
      ))}
    </div>
  );
}

function ModelMenu(props: {
  selected: string;
  onSelect: (value: string) => void;
}) {
  return (
    <div className="cn-popover model">
      <p>推理</p>
      {["低", "中", "高", "超高"].map((effort) => (
        <button
          key={effort}
          className={props.selected.includes(effort) ? "cn-menu-row selected compact" : "cn-menu-row compact"}
          type="button"
          onClick={() => props.onSelect(`5.5 ${effort}`)}
        >
          <strong>{effort}</strong>
          {props.selected.includes(effort) ? (
            <em>
              <CodexIcon name="check" />
            </em>
          ) : null}
        </button>
      ))}
      <div className="cn-menu-divider" />
      {["GPT-5.5", "GPT-5.4", "GPT-5.4 Mini", "GPT-5.3 Codex Spark"].map((modelName) => (
        <button
          key={modelName}
          className={props.selected.includes(modelName.replace("GPT-", "")) ? "cn-menu-row selected compact" : "cn-menu-row compact"}
          type="button"
          onClick={() => props.onSelect(`${modelName.replace("GPT-", "")} 超高`)}
        >
          <strong>{modelName}</strong>
          {modelName === "GPT-5.5" ? (
            <em>
              <CodexIcon name="check" />
            </em>
          ) : null}
        </button>
      ))}
    </div>
  );
}

function ApprovalModal() {
  return (
    <div className="cn-approval-backdrop">
      <div className="cn-inline-approval">
        <strong>需要批准</strong>
        <span>pnpm test</span>
      </div>
      <section className="cn-approval-modal">
        <h2>需要批准</h2>
        <pre>{`cwd: /Users/ganxing/Dev/CodexNext\n$ pnpm test`}</pre>
        <div className="cn-approval-actions">
          <button className="cn-primary-button" type="button">
            接受
          </button>
          <button className="cn-soft-button" type="button">
            本次会话
          </button>
          <button className="cn-soft-button" type="button">
            拒绝
          </button>
          <button className="cn-soft-button wide" type="button">
            取消
          </button>
        </div>
      </section>
    </div>
  );
}
