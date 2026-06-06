"use client";

import { useEffect, useRef, useState } from "react";
import type {
  LocalReasoningEffort,
  ThreadGoal
} from "@codexnext/protocol";
import {
  agentFetch,
  health,
  listCodexHistory,
  listDirectories,
  listSessions,
  type AgentConnection
} from "../lib/api";
import { openEventStream } from "../lib/event-stream";
import type {
  ChatItem,
  LocalCodexHistoryEntry,
  LocalDirectoryListResponse,
  LocalEvent,
  LocalHealthResponse,
  LocalPermissionMode,
  LocalSessionSummary,
  PendingApprovalView
} from "../lib/types";
import { CodexIcon, type CodexIconName } from "./DesignLab";

type ActiveSheet = "device" | "session" | "goal" | "events" | null;
type ActiveMenu = "model" | "permission" | null;

interface AttachmentDraft {
  name: string;
  type: string;
  size: number;
  content: string | null;
}

const modelOptions = [
  { label: "GPT-5.5", shortLabel: "5.5", value: "gpt-5.5" },
  { label: "GPT-5.4", shortLabel: "5.4", value: "gpt-5.4" },
  { label: "GPT-5.4 Mini", shortLabel: "5.4 mini", value: "gpt-5.4-mini" },
  {
    label: "GPT-5.3 Codex Spark",
    shortLabel: "5.3 spark",
    value: "gpt-5.3-codex-spark"
  }
];

const reasoningOptions: Array<{
  label: string;
  value: LocalReasoningEffort;
}> = [
  { label: "低", value: "low" },
  { label: "中", value: "medium" },
  { label: "高", value: "high" },
  { label: "超高", value: "xhigh" }
];

const permissionOptions: Array<{
  description: string;
  icon: CodexIconName;
  label: string;
  mode: LocalPermissionMode;
}> = [
  {
    description: "编辑外部文件和使用互联网时始终询问",
    icon: "hand",
    label: "请求批准",
    mode: "request-approval"
  },
  {
    description: "仅对检测到的风险操作请求批准",
    icon: "shield",
    label: "替我审批",
    mode: "auto-approve"
  },
  {
    description: "可不受限制地访问互联网和电脑上的任何文件",
    icon: "shieldAlert",
    label: "完全访问权限",
    mode: "full-access"
  },
  {
    description: "使用 config.toml 中定义的权限",
    icon: "settings",
    label: "自定义 config.toml",
    mode: "custom-config"
  }
];

export function WebConsole() {
  const [agentUrl, setAgentUrl] = useState("http://127.0.0.1:17361");
  const [token, setToken] = useState("");
  const [healthStatus, setHealthStatus] = useState<LocalHealthResponse | null>(null);
  const [streamStatus, setStreamStatus] = useState("disconnected");
  const [events, setEvents] = useState<LocalEvent[]>([]);
  const [lastSeq, setLastSeq] = useState(0);
  const [sessions, setSessions] = useState<LocalSessionSummary[]>([]);
  const [codexHistory, setCodexHistory] = useState<LocalCodexHistoryEntry[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [chatItems, setChatItems] = useState<ChatItem[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<PendingApprovalView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [autoConnect, setAutoConnect] = useState<AgentConnection | null>(null);
  const [deviceName, setDeviceName] = useState("");
  const [activeSheet, setActiveSheet] = useState<ActiveSheet>(null);
  const [activeMenu, setActiveMenu] = useState<ActiveMenu>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const [cwd, setCwd] = useState("");
  const [directoryList, setDirectoryList] =
    useState<LocalDirectoryListResponse | null>(null);
  const [directoryError, setDirectoryError] = useState<string | null>(null);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [model, setModel] = useState("gpt-5.5");
  const [reasoningEffort, setReasoningEffort] =
    useState<LocalReasoningEffort>("xhigh");
  const [permissionMode, setPermissionMode] =
    useState<LocalPermissionMode>("request-approval");
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<AttachmentDraft[]>([]);
  const [initialGoal, setInitialGoal] = useState("");
  const [initialTokenBudget, setInitialTokenBudget] = useState("");
  const [goalObjective, setGoalObjective] = useState("");
  const [goalTokenBudget, setGoalTokenBudget] = useState("");

  const eventSourceRef = useRef<EventSource | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const connection: AgentConnection = { agentUrl, token };
  const currentSession = currentSessionId
    ? sessions.find((session) => session.sessionId === currentSessionId) ?? null
    : null;
  const visibleChatItems = currentSession
    ? chatItems.filter((item) => item.sessionId === currentSession.sessionId)
    : [];
  const connected = Boolean(healthStatus?.ok && streamStatus === "connected");
  const activeTurn = Boolean(currentSession?.activeTurnId);
  const selectedModel =
    modelOptions.find((option) => option.value === model) ?? modelOptions[0]!;
  const selectedReasoning =
    reasoningOptions.find((option) => option.value === reasoningEffort) ??
    reasoningOptions[3]!;
  const selectedPermission =
    permissionOptions.find((option) => option.mode === permissionMode) ??
    permissionOptions[0]!;
  const deviceDisplayName =
    deviceName ||
    healthStatus?.device?.defaultName ||
    defaultDeviceName(agentUrl);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const queryAgent = params.get("agent");
    const queryToken = params.get("token");
    if (queryAgent) {
      setAgentUrl(queryAgent);
    }
    if (queryToken) {
      setToken(queryToken);
    }
    if (queryAgent && queryToken) {
      setAutoConnect({ agentUrl: queryAgent, token: queryToken });
    }
  }, []);

  useEffect(() => {
    const savedName = window.localStorage.getItem(deviceNameStorageKey(agentUrl));
    setDeviceName(savedName ?? "");
  }, [agentUrl]);

  useEffect(() => {
    if (!autoConnect) {
      return;
    }
    setAutoConnect(null);
    void connect(autoConnect).catch((err) => {
      setStreamStatus("error");
      setError(formatError(err));
    });
  }, [autoConnect]);

  useEffect(() => {
    if (currentSession?.goal?.objective) {
      setGoalObjective(currentSession.goal.objective);
      setGoalTokenBudget(
        currentSession.goal.tokenBudget ? String(currentSession.goal.tokenBudget) : ""
      );
      return;
    }
    setGoalObjective("");
    setGoalTokenBudget("");
  }, [currentSession?.goal]);

  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
    };
  }, []);

  async function connect(nextConnection: AgentConnection = connection) {
    setError(null);
    setStreamStatus("connecting");
    eventSourceRef.current?.close();

    const status = await health(nextConnection);
    setHealthStatus(status);
    const savedName = window.localStorage.getItem(
      deviceNameStorageKey(nextConnection.agentUrl)
    );
    if (!savedName) {
      setDeviceName(status.device?.defaultName ?? defaultDeviceName(nextConnection.agentUrl));
    }

    const replay = await agentFetch<{ events: LocalEvent[] }>(
      nextConnection,
      "/api/events?after=0"
    );
    ingestEvents(replay.events, { selectSessions: false });
    const loadedSessions = await listSessions(nextConnection);
    setSessions(loadedSessions.sessions);
    const history = await listCodexHistory(nextConnection);
    setCodexHistory(history.entries);
    const latestSession = [...loadedSessions.sessions].sort(
      (a, b) => b.updatedAt - a.updatedAt
    )[0];
    if (latestSession) {
      setCurrentSessionId((current) => current ?? latestSession.sessionId);
      setCwd((current) => current || latestSession.cwd);
    }
    setDirectoryLoading(true);
    setDirectoryError(null);
    try {
      const directories = await listDirectories(
        nextConnection,
        cwd || latestSession?.cwd || undefined
      );
      setDirectoryList(directories);
    } catch (err) {
      setDirectoryError(formatError(err));
    } finally {
      setDirectoryLoading(false);
    }

    let connectedOnce = false;
    const markConnected = () => {
      connectedOnce = true;
      setStreamStatus("connected");
    };

    const source = openEventStream(
      nextConnection,
      replay.events.at(-1)?.seq ?? 0,
      (event) => {
        markConnected();
        ingestEvents([event], { selectSessions: true });
      },
      () => {
        setStreamStatus(connectedOnce ? "reconnecting" : "error");
      }
    );
    source.onopen = markConnected;
    eventSourceRef.current = source;
    window.setTimeout(() => {
      if (!connectedOnce && source.readyState !== EventSource.CLOSED) {
        markConnected();
      }
    }, 750);
  }

  async function loadDirectories(path?: string) {
    if (!connected) {
      setActiveSheet("device");
      return;
    }
    setDirectoryLoading(true);
    setDirectoryError(null);
    try {
      const result = await listDirectories(connection, path || cwd || undefined);
      setDirectoryList(result);
    } catch (err) {
      setDirectoryError(formatError(err));
    } finally {
      setDirectoryLoading(false);
    }
  }

  async function startSession(input: {
    cwd: string;
    model?: string | null;
    reasoningEffort?: LocalReasoningEffort | null;
    tokenBudget?: number | null;
    permissionMode: LocalPermissionMode;
    initialGoal?: string | null;
    initialMessage?: string | null;
  }) {
    setError(null);
    const result = await agentFetch<{ session: LocalSessionSummary }>(
      connection,
      "/api/sessions",
      {
        method: "POST",
        body: JSON.stringify(input)
      }
    );
    setCurrentSessionId(result.session.sessionId);
    upsertSession(result.session);
    setActiveSheet(null);
  }

  async function submitComposer() {
    const text = draft.trim();
    if (!text) {
      return;
    }
    if (!connected) {
      setActiveSheet("device");
      return;
    }

    const message = buildMessageWithAttachments(text, attachments);
    setError(null);

    if (currentSession) {
      await agentFetch(connection, `/api/sessions/${currentSession.sessionId}/messages`, {
        method: "POST",
        body: JSON.stringify({ text: message })
      });
      setDraft("");
      setAttachments([]);
      return;
    }

    if (!cwd.trim()) {
      setActiveSheet("session");
      await loadDirectories(undefined);
      return;
    }

    await startSession({
      cwd: cwd.trim(),
      model,
      reasoningEffort,
      permissionMode,
      tokenBudget: initialTokenBudget ? Number(initialTokenBudget) : null,
      initialGoal: initialGoal.trim() || null,
      initialMessage: message
    });
    setDraft("");
    setAttachments([]);
  }

  async function interrupt() {
    if (!currentSession?.activeTurnId) {
      return;
    }
    await agentFetch(
      connection,
      `/api/sessions/${currentSession.sessionId}/turns/${currentSession.activeTurnId}/interrupt`,
      { method: "POST", body: "{}" }
    );
  }

  async function setGoal(input: {
    objective?: string | null;
    status?: string | null;
    tokenBudget?: number | null;
  }) {
    if (!currentSession) {
      setError("请先创建或选择一个会话。");
      return;
    }
    const result = await agentFetch<{ goal: ThreadGoal }>(
      connection,
      `/api/sessions/${currentSession.sessionId}/goal`,
      { method: "POST", body: JSON.stringify(input) }
    );
    upsertSession({ ...currentSession, goal: result.goal });
  }

  async function clearGoal() {
    if (!currentSession) {
      return;
    }
    await agentFetch(connection, `/api/sessions/${currentSession.sessionId}/goal`, {
      method: "DELETE"
    });
    upsertSession({ ...currentSession, goal: null });
  }

  async function refreshGoal() {
    if (!currentSession) {
      return;
    }
    const result = await agentFetch<{ goal: ThreadGoal | null }>(
      connection,
      `/api/sessions/${currentSession.sessionId}/goal`
    );
    upsertSession({ ...currentSession, goal: result.goal });
  }

  async function decideApproval(approvalId: string, decision: string) {
    await agentFetch(connection, `/api/approvals/${approvalId}/decision`, {
      method: "POST",
      body: JSON.stringify({ decision })
    });
  }

  async function attachFiles(files: FileList | null) {
    if (!files?.length) {
      return;
    }
    const next: AttachmentDraft[] = [];
    for (const file of Array.from(files).slice(0, 4)) {
      const textLike =
        file.type.startsWith("text/") ||
        /\.(css|go|html|java|js|jsx|json|md|py|rs|toml|ts|tsx|txt|yaml|yml)$/i.test(
          file.name
        );
      next.push({
        name: file.name,
        type: file.type || "unknown",
        size: file.size,
        content: textLike ? (await file.text()).slice(0, 24_000) : null
      });
    }
    setAttachments((previous) => [...previous, ...next].slice(0, 4));
  }

  function ingestEvents(
    incoming: LocalEvent[],
    options: { selectSessions: boolean } = { selectSessions: true }
  ) {
    setEvents((previous) => {
      const bySeq = new Map(previous.map((event) => [event.seq, event]));
      for (const event of incoming) {
        bySeq.set(event.seq, event);
      }
      const next = [...bySeq.values()].sort((a, b) => a.seq - b.seq);
      setLastSeq(next.at(-1)?.seq ?? 0);
      return next.slice(-500);
    });

    for (const event of incoming) {
      applyEvent(event, options);
    }
  }

  function applyEvent(event: LocalEvent, options: { selectSessions: boolean }) {
    switch (event.type) {
      case "session.created":
      case "session.updated":
        if (isSessionSummary(event.payload)) {
          upsertSession(event.payload);
          if (options.selectSessions) {
            setCurrentSessionId(event.payload.sessionId);
          }
        }
        return;
      case "approval.requested":
        const pendingPayload = event.payload;
        if (isPendingApproval(pendingPayload)) {
          setPendingApprovals((previous) => [
            ...previous.filter(
              (approval) => approval.approvalId !== pendingPayload.approvalId
            ),
            pendingPayload
          ]);
        }
        return;
      case "approval.resolved":
        const resolvedPayload = event.payload;
        if (isRecord(resolvedPayload) && typeof resolvedPayload.approvalId === "string") {
          setPendingApprovals((previous) =>
            previous.filter((approval) => approval.approvalId !== resolvedPayload.approvalId)
          );
        }
        return;
      case "chat.user":
        addChatItem({
          id: event.id,
          role: "user",
          text: readText(event.payload),
          ...(event.sessionId ? { sessionId: event.sessionId } : {}),
          ...(event.turnId ? { turnId: event.turnId } : {})
        });
        return;
      case "chat.assistant.delta":
        appendStreamingItem(
          "assistant",
          event.sessionId,
          event.turnId,
          readText(event.payload),
          event.id
        );
        return;
      case "command.output.delta":
        appendStreamingItem(
          "command",
          event.sessionId,
          event.turnId,
          readText(event.payload),
          event.id
        );
        return;
      case "diff.updated":
        addChatItem({
          id: event.id,
          role: "diff",
          text: readDiff(event.payload),
          ...(event.sessionId ? { sessionId: event.sessionId } : {}),
          ...(event.turnId ? { turnId: event.turnId } : {})
        });
        return;
      case "plan.updated":
        addChatItem({
          id: event.id,
          role: "system",
          text: readPlan(event.payload),
          ...(event.sessionId ? { sessionId: event.sessionId } : {}),
          ...(event.turnId ? { turnId: event.turnId } : {})
        });
        return;
      case "turn.completed":
        addChatItem({
          id: event.id,
          role: "system",
          text: `Turn completed: ${readTurnStatus(event.payload)}`,
          ...(event.sessionId ? { sessionId: event.sessionId } : {}),
          ...(event.turnId ? { turnId: event.turnId } : {})
        });
        return;
      case "agent.error":
      case "codex.error":
        setError(JSON.stringify(event.payload));
        return;
      default:
        return;
    }
  }

  function upsertSession(session: LocalSessionSummary) {
    setSessions((previous) => [
      session,
      ...previous.filter((item) => item.sessionId !== session.sessionId)
    ]);
  }

  function addChatItem(item: ChatItem) {
    setChatItems((previous) => [...previous, item].slice(-240));
  }

  function appendStreamingItem(
    role: "assistant" | "command",
    sessionId: string | undefined,
    turnId: string | undefined,
    text: string,
    fallbackId: string
  ) {
    if (!text) {
      return;
    }
    setChatItems((previous) => {
      const last = previous.at(-1);
      if (last?.role === role && last.turnId === turnId && last.sessionId === sessionId) {
        return [...previous.slice(0, -1), { ...last, text: `${last.text}${text}` }];
      }
      return [
        ...previous,
        {
          id: fallbackId,
          role,
          text,
          ...(sessionId ? { sessionId } : {}),
          ...(turnId ? { turnId } : {})
        }
      ].slice(-240);
    });
  }

  const sessionGroups = groupSessions(sessions);
  const directoryEntries = directoryList?.entries ?? [];
  const sidebarFolders = directoryEntries.filter(
    (entry) => !sessionGroups.some((group) => group.cwd === entry.path)
  );
  const historyGroups = groupCodexHistory(codexHistory);
  const firstApproval = pendingApprovals[0] ?? null;

  return (
    <main className="cn-live-console">
      <div
        className={
          sidebarCollapsed
            ? "cn-desktop-frame cn-app-frame sidebar-collapsed"
            : "cn-desktop-frame cn-app-frame"
        }
      >
        <nav className="cn-nav-rail" aria-label="CodexNext navigation">
          <div className="cn-mark">CN</div>
          {sidebarCollapsed ? (
            <button
              className="cn-rail-button"
              type="button"
              onClick={() => setSidebarCollapsed(false)}
              aria-label="展开会话栏"
            >
              <CodexIcon name="collapse" />
            </button>
          ) : null}
          <button
            className={connected ? "cn-rail-button active" : "cn-rail-button"}
            type="button"
            onClick={() => setActiveSheet("device")}
            aria-label="选择设备"
          >
            <CodexIcon name="terminal" />
            {connected ? <span className="cn-rail-dot" /> : null}
          </button>
          <button
            className="cn-rail-button"
            type="button"
            onClick={() => {
              setCurrentSessionId(null);
              setDraft("");
              setActiveSheet("session");
              void loadDirectories(undefined);
            }}
            aria-label="新建对话"
          >
            <CodexIcon name="compose" />
          </button>
          <button
            className="cn-rail-button muted"
            type="button"
            onClick={() => setActiveSheet("events")}
            aria-label="事件"
          >
            <CodexIcon name="more" />
          </button>
        </nav>

        <aside className="cn-session-sidebar cn-live-sidebar">
          <div className="cn-sidebar-fixed">
            <div className="cn-sidebar-windowbar" aria-label="窗口导航">
              <span className="cn-window-dot red" />
              <span className="cn-window-dot yellow" />
              <span className="cn-window-dot green" />
              <button
                type="button"
                aria-label="折叠会话栏"
                onClick={() => setSidebarCollapsed(true)}
              >
                <CodexIcon name="collapse" />
              </button>
              <button type="button" aria-label="后退" onClick={() => window.history.back()}>
                <CodexIcon name="back" />
              </button>
              <button type="button" aria-label="前进" onClick={() => window.history.forward()}>
                <CodexIcon name="forward" />
              </button>
            </div>

            <div className="cn-sidebar-brand">
              <strong>CodexNext</strong>
              <span>Your personal Codex control plane</span>
            </div>

            <button
              className="cn-device-summary"
              type="button"
              onClick={() => setActiveSheet("device")}
            >
              <CodexIcon name="terminal" className="cn-device-icon" />
              <span className={connected ? "cn-live-dot" : "cn-live-dot offline"} />
              <span className="cn-device-copy">
                <strong>{deviceDisplayName}</strong>
                <small>
                  {statusLabel(streamStatus)} ·{" "}
                  {healthStatus?.codex?.version ?? "codex-cli unknown"}
                </small>
              </span>
            </button>

            <button
              className="cn-new-chat-button"
              type="button"
              onClick={() => {
                setCurrentSessionId(null);
                setDraft("");
                setActiveSheet("session");
                void loadDirectories(undefined);
              }}
            >
              <CodexIcon name="compose" />
              新建对话
            </button>
          </div>

          <div className="cn-project-tree">
            <span className="cn-project-tree-title">项目</span>
            <div className="cn-project-scroll">
              {sidebarFolders.slice(0, 40).map((entry) => (
                <DirectoryProjectRow
                  key={entry.path}
                  entry={entry}
                  selected={cwd === entry.path && !currentSession}
                  onSelect={(pathValue) => {
                    setCwd(pathValue);
                    setCurrentSessionId(null);
                  }}
                />
              ))}

              {sessionGroups.map((group) => (
                <SessionProjectGroup
                  key={group.cwd}
                  activeSessionId={currentSessionId}
                  chatItems={chatItems}
                  group={group}
                  onSelectSession={setCurrentSessionId}
                />
              ))}

              {historyGroups.map((group) => (
                <CodexHistoryGroup
                  key={group.cwd}
                  cwd={cwd}
                  group={group}
                  onSelect={(pathValue) => {
                    setCwd(pathValue);
                    setCurrentSessionId(null);
                  }}
                />
              ))}

              {sidebarFolders.length === 0 &&
              sessionGroups.length === 0 &&
              historyGroups.length === 0 ? (
                <div className="cn-empty-sidebar">
                  已连接，但没有发现项目文件夹或本地 Codex 记录。
                </div>
              ) : null}
            </div>
          </div>

          <div className="cn-sidebar-footer">
            <button
              className="cn-settings-button"
              type="button"
              onClick={() => setActiveSheet("device")}
              aria-label="设置"
            >
              <span>
                <CodexIcon name="settings" />
                设置
              </span>
              <CodexIcon name="phone" />
            </button>
          </div>
        </aside>

        <section className={currentSession ? "cn-main thread cn-live-main" : "cn-main cn-live-main"}>
          <header className="cn-main-header cn-live-header">
            <div>
              <h1>{currentSession ? shortPath(currentSession.cwd) : "新会话"}</h1>
              <p>{currentSession ? sessionSubtitle(currentSession) : "选择项目后发送第一条消息"}</p>
            </div>
            <div className="cn-live-header-actions">
              {currentSession ? (
                <button className="cn-soft-button" type="button" onClick={() => setActiveSheet("goal")}>
                  Goal
                </button>
              ) : null}
              <button className="cn-soft-button" type="button" onClick={() => setActiveSheet("events")}>
                Events {lastSeq ? `#${lastSeq}` : ""}
              </button>
              {activeTurn ? (
                <button
                  className="cn-soft-button danger"
                  type="button"
                  onClick={() => void interrupt().catch((err) => setError(formatError(err)))}
                >
                  Interrupt
                </button>
              ) : null}
            </div>
          </header>

          {error ? (
            <div className="cn-live-error">
              <strong>操作失败</strong>
              <span>{error}</span>
            </div>
          ) : null}

          {currentSession ? (
            <ChatCanvas
              active={activeTurn}
              goal={currentSession.goal ?? null}
              items={visibleChatItems}
              pendingApprovals={pendingApprovals.length}
              session={currentSession}
              onOpenApproval={() => setActiveSheet("events")}
              onOpenGoal={() => setActiveSheet("goal")}
            />
          ) : (
            <NewSessionCanvas />
          )}

          <LiveComposer
            activeMenu={activeMenu}
            activeTurn={activeTurn}
            attachments={attachments}
            draft={draft}
            fileInputRef={fileInputRef}
            permissionMode={permissionMode}
            reasoningEffort={reasoningEffort}
            selectedModel={selectedModel}
            selectedPermission={selectedPermission}
            selectedReasoning={selectedReasoning}
            onAttachFiles={(files) =>
              void attachFiles(files).catch((err) => setError(formatError(err)))
            }
            onDraftChange={setDraft}
            onOpenMenu={(menu) => setActiveMenu(activeMenu === menu ? null : menu)}
            onRemoveAttachment={(attachment) =>
              setAttachments((previous) => previous.filter((item) => item !== attachment))
            }
            onSelectModel={setModel}
            onSelectPermission={setPermissionMode}
            onSelectReasoning={setReasoningEffort}
            onSubmit={() => void submitComposer().catch((err) => setError(formatError(err)))}
          />

          {activeSheet === "device" ? (
            <DeviceSheet
              agentUrl={agentUrl}
              connected={connected}
              deviceName={deviceDisplayName}
              healthStatus={healthStatus}
              streamStatus={streamStatus}
              token={token}
              onAgentUrlChange={setAgentUrl}
              onClose={() => setActiveSheet(null)}
              onConnect={async () => {
                try {
                  await connect();
                  setActiveSheet(null);
                } catch (err) {
                  setError(formatError(err));
                }
              }}
              onDeviceNameChange={(value) => {
                setDeviceName(value);
                window.localStorage.setItem(deviceNameStorageKey(agentUrl), value);
              }}
              onTokenChange={setToken}
            />
          ) : null}

          {activeSheet === "session" ? (
            <SessionSetupSheet
              connected={connected}
              cwd={cwd}
              deviceName={deviceDisplayName}
              directoryError={directoryError}
              directoryList={directoryList}
              directoryLoading={directoryLoading}
              initialGoal={initialGoal}
              initialTokenBudget={initialTokenBudget}
              model={model}
              permissionMode={permissionMode}
              reasoningEffort={reasoningEffort}
              streamStatus={streamStatus}
              onClose={() => setActiveSheet(null)}
              onInitialGoalChange={setInitialGoal}
              onInitialTokenBudgetChange={setInitialTokenBudget}
              onLoadDirectories={(path) =>
                void loadDirectories(path).catch((err) => setError(formatError(err)))
              }
              onOpenDevice={() => setActiveSheet("device")}
              onSelectCwd={(nextCwd) => {
                setCwd(nextCwd);
                setActiveSheet(null);
              }}
              onSelectModel={setModel}
              onSelectPermission={setPermissionMode}
              onSelectReasoning={setReasoningEffort}
            />
          ) : null}

          {activeSheet === "goal" ? (
            <GoalSheet
              currentSession={currentSession}
              objective={goalObjective}
              tokenBudget={goalTokenBudget}
              onClear={() => void clearGoal().catch((err) => setError(formatError(err)))}
              onClose={() => setActiveSheet(null)}
              onObjectiveChange={setGoalObjective}
              onRefresh={() => void refreshGoal().catch((err) => setError(formatError(err)))}
              onResume={() =>
                void setGoal({ status: "active" }).catch((err) => setError(formatError(err)))
              }
              onPause={() =>
                void setGoal({ status: "paused" }).catch((err) => setError(formatError(err)))
              }
              onSet={() =>
                void setGoal({
                  objective: goalObjective.trim(),
                  status: "active",
                  tokenBudget: goalTokenBudget ? Number(goalTokenBudget) : null
                }).catch((err) => setError(formatError(err)))
              }
              onTokenBudgetChange={setGoalTokenBudget}
            />
          ) : null}

          {activeSheet === "events" ? (
            <EventsSheet
              events={events}
              pendingApprovals={pendingApprovals}
              onClose={() => setActiveSheet(null)}
              onDecision={(approvalId, decision) =>
                void decideApproval(approvalId, decision).catch((err) => setError(formatError(err)))
              }
            />
          ) : null}

          {firstApproval ? (
            <ApprovalModal
              approval={firstApproval}
              onDecision={(decision) =>
                void decideApproval(firstApproval.approvalId, decision).catch((err) =>
                  setError(formatError(err))
                )
              }
            />
          ) : null}
        </section>
      </div>
    </main>
  );
}

function DirectoryProjectRow(props: {
  entry: LocalDirectoryListResponse["entries"][number];
  selected: boolean;
  onSelect: (pathValue: string) => void;
}) {
  return (
    <div className="cn-project-group">
      <button
        className={
          props.selected
            ? "cn-project-name cn-directory-project selected"
            : "cn-project-name cn-directory-project"
        }
        title={props.entry.path}
        type="button"
        onClick={() => props.onSelect(props.entry.path)}
      >
        <span className="cn-project-heading-copy">
          <CodexIcon name="folder" className="cn-project-icon" />
          <strong>{props.entry.name}</strong>
        </span>
      </button>
    </div>
  );
}

function CodexHistoryGroup(props: {
  cwd: string;
  group: { cwd: string; name: string; entries: LocalCodexHistoryEntry[] };
  onSelect: (pathValue: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className="cn-project-group cn-history-group">
      <button
        className="cn-project-name"
        title={props.group.cwd}
        type="button"
        onClick={() => setCollapsed((value) => !value)}
      >
        <span className="cn-project-heading-copy">
          <CodexIcon name="folder" className="cn-project-icon" />
          <strong>{props.group.name}</strong>
        </span>
        <CodexIcon
          name={collapsed ? "chevronRight" : "chevronDown"}
          className="cn-project-collapse-icon"
        />
      </button>
      {collapsed ? null : (
        <div className="cn-thread-list">
          {props.group.entries.slice(0, 8).map((entry) => (
            <button
              key={codexHistoryKey(entry)}
              className={
                props.cwd === entry.cwd
                  ? "cn-thread-row cn-history-row selected"
                  : "cn-thread-row cn-history-row"
              }
              title={entry.title}
              type="button"
              onClick={() => props.onSelect(entry.cwd)}
            >
              <span>{entry.title}</span>
              <small>Codex history</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SessionProjectGroup(props: {
  activeSessionId: string | null;
  chatItems: ChatItem[];
  group: { cwd: string; name: string; sessions: LocalSessionSummary[] };
  onSelectSession: (sessionId: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className="cn-project-group">
      <button
        className="cn-project-name"
        title={props.group.cwd}
        type="button"
        onClick={() => setCollapsed((value) => !value)}
      >
        <span className="cn-project-heading-copy">
          <CodexIcon name="folder" className="cn-project-icon" />
          <strong>{props.group.name}</strong>
        </span>
        <CodexIcon
          name={collapsed ? "chevronRight" : "chevronDown"}
          className="cn-project-collapse-icon"
        />
      </button>
      {collapsed ? null : (
        <div className="cn-thread-list">
          {props.group.sessions.map((session) => (
            <button
              key={session.sessionId}
              className={
                props.activeSessionId === session.sessionId
                  ? "cn-thread-row selected"
                  : "cn-thread-row"
              }
              title={sessionTitle(session, props.chatItems)}
              type="button"
              onClick={() => props.onSelectSession(session.sessionId)}
            >
              <span>{sessionTitle(session, props.chatItems)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function NewSessionCanvas() {
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

function ChatCanvas(props: {
  active: boolean;
  goal: ThreadGoal | null;
  items: ChatItem[];
  pendingApprovals: number;
  session: LocalSessionSummary;
  onOpenApproval: () => void;
  onOpenGoal: () => void;
}) {
  return (
    <section className="cn-thread-canvas cn-live-thread">
      <div className="cn-thread-status-strip">
        <span className={props.active ? "cn-run-status running" : "cn-run-status"}>
          {props.active ? "正在运行" : props.session.status}
        </span>
        {props.goal ? (
          <button className="cn-soft-button" type="button" onClick={props.onOpenGoal}>
            Goal {props.goal.status}
          </button>
        ) : null}
        {props.pendingApprovals > 0 ? (
          <button className="cn-soft-button danger" type="button" onClick={props.onOpenApproval}>
            {props.pendingApprovals} 个审批请求
          </button>
        ) : null}
      </div>

      {props.items.length === 0 ? (
        <div className="cn-empty-chat-card">
          <h2>会话已准备好</h2>
          <p>发送消息会调用 `turn/start`；运行中继续发送会调用 `turn/steer`。</p>
        </div>
      ) : (
        props.items.map((item) => (
          <article key={item.id} className={`cn-message ${messageClass(item.role)}`}>
            <span className="cn-message-label">{roleLabel(item.role)}</span>
            <div className="cn-message-text">{item.text}</div>
          </article>
        ))
      )}
    </section>
  );
}

function LiveComposer(props: {
  activeMenu: ActiveMenu;
  activeTurn: boolean;
  attachments: AttachmentDraft[];
  draft: string;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  permissionMode: LocalPermissionMode;
  reasoningEffort: LocalReasoningEffort;
  selectedModel: { label: string; shortLabel: string; value: string };
  selectedPermission: (typeof permissionOptions)[number];
  selectedReasoning: (typeof reasoningOptions)[number];
  onAttachFiles: (files: FileList | null) => void;
  onDraftChange: (value: string) => void;
  onOpenMenu: (menu: ActiveMenu) => void;
  onRemoveAttachment: (attachment: AttachmentDraft) => void;
  onSelectModel: (value: string) => void;
  onSelectPermission: (value: LocalPermissionMode) => void;
  onSelectReasoning: (value: LocalReasoningEffort) => void;
  onSubmit: () => void;
}) {
  return (
    <footer className={props.activeTurn ? "cn-desktop-composer cn-live-composer steer" : "cn-desktop-composer cn-live-composer"}>
      <textarea
        aria-label="CodexNext 输入框"
        placeholder={props.activeTurn ? "追加指令或调整方向..." : "要在 CodexNext 中构建什么？"}
        value={props.draft}
        onChange={(event) => props.onDraftChange(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            props.onSubmit();
          }
        }}
      />
      {props.attachments.length > 0 ? (
        <div className="cn-attachment-row">
          {props.attachments.map((attachment) => (
            <button
              key={`${attachment.name}-${attachment.size}`}
              className="cn-attachment-chip"
              type="button"
              onClick={() => props.onRemoveAttachment(attachment)}
              title="移除附件"
            >
              {attachment.name}
              <span>×</span>
            </button>
          ))}
        </div>
      ) : null}
      <div className="cn-composer-toolbar">
        <input
          ref={props.fileInputRef}
          className="cn-hidden-file"
          multiple
          type="file"
          onChange={(event) => props.onAttachFiles(event.target.files)}
        />
        <button
          className="cn-icon-button"
          type="button"
          title="上传文件"
          onClick={() => props.fileInputRef.current?.click()}
        >
          <CodexIcon name="plus" />
        </button>
        <button
          className="cn-composer-pill"
          type="button"
          onClick={() => props.onOpenMenu("model")}
        >
          {props.selectedModel.shortLabel} {props.selectedReasoning.label}
          <CodexIcon name="chevronDown" />
        </button>
        <button
          className="cn-composer-pill"
          type="button"
          onClick={() => props.onOpenMenu("permission")}
        >
          {props.selectedPermission.label}
          <CodexIcon name="chevronDown" />
        </button>
        <button
          className="cn-send-button"
          type="button"
          disabled={!props.draft.trim()}
          onClick={props.onSubmit}
          title={props.activeTurn ? "Steer active turn" : "Send"}
        >
          <CodexIcon name="arrowUp" />
        </button>
      </div>

      {props.activeMenu === "model" ? (
        <div className="cn-popover model cn-live-popover">
          <p>推理</p>
          {reasoningOptions.map((option) => (
            <button
              key={option.value}
              className={
                props.reasoningEffort === option.value
                  ? "cn-menu-row selected compact"
                  : "cn-menu-row compact"
              }
              type="button"
              onClick={() => props.onSelectReasoning(option.value)}
            >
              <strong>{option.label}</strong>
              {props.reasoningEffort === option.value ? (
                <em>
                  <CodexIcon name="check" />
                </em>
              ) : null}
            </button>
          ))}
          <div className="cn-menu-divider" />
          {modelOptions.map((option) => (
            <button
              key={option.value}
              className={
                props.selectedModel.value === option.value
                  ? "cn-menu-row selected compact"
                  : "cn-menu-row compact"
              }
              type="button"
              onClick={() => props.onSelectModel(option.value)}
            >
              <strong>{option.label}</strong>
              {props.selectedModel.value === option.value ? (
                <em>
                  <CodexIcon name="check" />
                </em>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}

      {props.activeMenu === "permission" ? (
        <div className="cn-popover permission cn-live-popover">
          <p>应如何批准 Codex 操作？</p>
          {permissionOptions.map((option) => (
            <button
              key={option.mode}
              className={
                props.permissionMode === option.mode
                  ? "cn-menu-row with-icon selected"
                  : "cn-menu-row with-icon"
              }
              type="button"
              onClick={() => props.onSelectPermission(option.mode)}
            >
              <CodexIcon name={option.icon} />
              <span>
                <strong>{option.label}</strong>
                <small>{option.description}</small>
              </span>
              {props.permissionMode === option.mode ? (
                <em>
                  <CodexIcon name="check" />
                </em>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </footer>
  );
}

function DeviceSheet(props: {
  agentUrl: string;
  connected: boolean;
  deviceName: string;
  healthStatus: LocalHealthResponse | null;
  streamStatus: string;
  token: string;
  onAgentUrlChange: (value: string) => void;
  onClose: () => void;
  onConnect: () => Promise<void>;
  onDeviceNameChange: (value: string) => void;
  onTokenChange: (value: string) => void;
}) {
  return (
    <div className="cn-overlay-panel device cn-live-overlay">
      <div className="cn-sheet-card cn-live-sheet">
        <button className="cn-close-button" type="button" onClick={props.onClose}>
          <CodexIcon name="x" />
        </button>
        <h2>连接设备</h2>
        <p>设备名代表你要控制的 Codex Agent，可以是这台 Mac，也可以是远程服务器。</p>

        <div className={props.connected ? "cn-real-device-row online" : "cn-real-device-row"}>
          <CodexIcon name="terminal" />
          <span className={props.connected ? "cn-live-dot" : "cn-live-dot offline"} />
          <div>
            <strong>{props.deviceName}</strong>
            <small>
              {statusLabel(props.streamStatus)} ·{" "}
              {props.healthStatus?.codex?.version ?? "codex-cli unknown"}
            </small>
          </div>
        </div>

        <label>
          设备名称
          <input
            value={props.deviceName}
            onChange={(event) => props.onDeviceNameChange(event.target.value)}
            placeholder="MacBookAir / Office Mac mini / Build server"
          />
        </label>
        <label>
          Agent URL
          <input
            value={props.agentUrl}
            onChange={(event) => props.onAgentUrlChange(event.target.value)}
          />
        </label>
        <label>
          Access Token
          <input
            value={props.token}
            onChange={(event) => props.onTokenChange(event.target.value)}
          />
        </label>

        <div className="cn-sheet-actions">
          <button className="cn-soft-button" type="button" onClick={props.onClose}>
            取消
          </button>
          <button
            className="cn-primary-button"
            type="button"
            onClick={() => void props.onConnect()}
          >
            {props.connected ? "重新连接" : "连接"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SessionSetupSheet(props: {
  connected: boolean;
  cwd: string;
  deviceName: string;
  directoryError: string | null;
  directoryList: LocalDirectoryListResponse | null;
  directoryLoading: boolean;
  initialGoal: string;
  initialTokenBudget: string;
  model: string;
  permissionMode: LocalPermissionMode;
  reasoningEffort: LocalReasoningEffort;
  streamStatus: string;
  onClose: () => void;
  onInitialGoalChange: (value: string) => void;
  onInitialTokenBudgetChange: (value: string) => void;
  onLoadDirectories: (path?: string) => void;
  onOpenDevice: () => void;
  onSelectCwd: (value: string) => void;
  onSelectModel: (value: string) => void;
  onSelectPermission: (value: LocalPermissionMode) => void;
  onSelectReasoning: (value: LocalReasoningEffort) => void;
}) {
  const selectedPermission =
    permissionOptions.find((option) => option.mode === props.permissionMode) ??
    permissionOptions[0]!;

  return (
    <div className="cn-overlay-panel project cn-live-overlay">
      <div className="cn-project-card cn-live-session-sheet">
        <button className="cn-close-button cn-sticky-close" type="button" onClick={props.onClose}>
          <CodexIcon name="x" />
        </button>
        <h2>新会话设置</h2>

        <button className="cn-settings-row" type="button" onClick={props.onOpenDevice}>
          <span>设备</span>
          <strong>{props.deviceName}</strong>
          <small>{statusLabel(props.streamStatus)}</small>
        </button>

        <div className="cn-project-search">
          <CodexIcon name="search" />
          {props.directoryList?.path ?? (props.cwd || "搜索或选择文件夹")}
        </div>

        <div className="cn-folder-picker-actions">
          <button
            className="cn-soft-button"
            type="button"
            disabled={!props.connected}
            onClick={() => props.onLoadDirectories(props.directoryList?.homePath)}
          >
            Home
          </button>
          <button
            className="cn-soft-button"
            type="button"
            disabled={!props.directoryList?.parentPath}
            onClick={() => props.onLoadDirectories(props.directoryList?.parentPath ?? undefined)}
          >
            上级
          </button>
          <button
            className="cn-soft-button"
            type="button"
            disabled={!props.connected}
            onClick={() => props.onLoadDirectories(props.cwd || undefined)}
          >
            浏览
          </button>
        </div>

        {props.directoryError ? <div className="cn-live-error inline">{props.directoryError}</div> : null}
        {props.directoryLoading ? <div className="cn-muted-line">正在读取文件夹...</div> : null}

        {props.directoryList ? (
          <>
            <div className="cn-path-label">{props.directoryList.path}</div>
            <div className="cn-folder-list cn-real-folder-list">
              {props.directoryList.entries.map((entry) => (
                <button
                  key={entry.path}
                  className="cn-folder-row"
                  type="button"
                  onClick={() => props.onLoadDirectories(entry.path)}
                  title={entry.path}
                >
                  <CodexIcon name="folder" />
                  <span>{entry.name}</span>
                </button>
              ))}
            </div>
            <button
              className="cn-primary-button cn-use-folder-button"
              type="button"
              onClick={() => props.onSelectCwd(props.directoryList!.path)}
            >
              使用此文件夹
            </button>
          </>
        ) : null}

        <div className="cn-session-settings-grid">
          <label>
            模型
            <select
              value={props.model}
              onChange={(event) => props.onSelectModel(event.target.value)}
            >
              {modelOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            推理
            <select
              value={props.reasoningEffort}
              onChange={(event) =>
                props.onSelectReasoning(event.target.value as LocalReasoningEffort)
              }
            >
              {reasoningOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="cn-permission-list-real">
          <p>权限模式：{selectedPermission.label}</p>
          {permissionOptions.map((option) => (
            <button
              key={option.mode}
              className={
                props.permissionMode === option.mode
                  ? "cn-menu-row with-icon selected"
                  : "cn-menu-row with-icon"
              }
              type="button"
              onClick={() => props.onSelectPermission(option.mode)}
            >
              <CodexIcon name={option.icon} />
              <span>
                <strong>{option.label}</strong>
                <small>{option.description}</small>
              </span>
              {props.permissionMode === option.mode ? (
                <em>
                  <CodexIcon name="check" />
                </em>
              ) : null}
            </button>
          ))}
        </div>

        <details className="cn-goal-advanced">
          <summary>Goal（可选，高级）</summary>
          <label>
            Objective
            <textarea
              value={props.initialGoal}
              onChange={(event) => props.onInitialGoalChange(event.target.value)}
              placeholder="如果这次新会话需要 Goal，再在这里设置。普通聊天不用填。"
            />
          </label>
          <label>
            Token Budget
            <input
              inputMode="numeric"
              value={props.initialTokenBudget}
              onChange={(event) => props.onInitialTokenBudgetChange(event.target.value)}
              placeholder="optional"
            />
          </label>
        </details>
      </div>
    </div>
  );
}

function GoalSheet(props: {
  currentSession: LocalSessionSummary | null;
  objective: string;
  tokenBudget: string;
  onClear: () => void;
  onClose: () => void;
  onObjectiveChange: (value: string) => void;
  onPause: () => void;
  onRefresh: () => void;
  onResume: () => void;
  onSet: () => void;
  onTokenBudgetChange: (value: string) => void;
}) {
  return (
    <div className="cn-overlay-panel cn-live-overlay right">
      <section className="cn-goal-sheet">
        <button className="cn-close-button" type="button" onClick={props.onClose}>
          <CodexIcon name="x" />
        </button>
        <h2>Goal</h2>
        <p>
          {props.currentSession?.goal
            ? `${props.currentSession.goal.status} · ${props.currentSession.goal.tokensUsed} tokens used`
            : "当前会话没有 Goal。"}
        </p>
        <label>
          Objective
          <textarea
            value={props.objective}
            onChange={(event) => props.onObjectiveChange(event.target.value)}
            placeholder="Keep this thread pointed at a durable outcome."
          />
        </label>
        <label>
          Token Budget
          <input
            inputMode="numeric"
            value={props.tokenBudget}
            onChange={(event) => props.onTokenBudgetChange(event.target.value)}
            placeholder="optional"
          />
        </label>
        <div className="cn-approval-actions">
          <button className="cn-primary-button" type="button" onClick={props.onSet}>
            Set
          </button>
          <button className="cn-soft-button" type="button" onClick={props.onPause}>
            Pause
          </button>
          <button className="cn-soft-button" type="button" onClick={props.onResume}>
            Resume
          </button>
          <button className="cn-soft-button" type="button" onClick={props.onRefresh}>
            Refresh
          </button>
          <button className="cn-soft-button danger" type="button" onClick={props.onClear}>
            Clear
          </button>
        </div>
      </section>
    </div>
  );
}

function EventsSheet(props: {
  events: LocalEvent[];
  pendingApprovals: PendingApprovalView[];
  onClose: () => void;
  onDecision: (approvalId: string, decision: string) => void;
}) {
  return (
    <div className="cn-overlay-panel cn-live-overlay right">
      <section className="cn-events-sheet">
        <button className="cn-close-button" type="button" onClick={props.onClose}>
          <CodexIcon name="x" />
        </button>
        <h2>Events</h2>
        {props.pendingApprovals.length > 0 ? (
          <div className="cn-events-approval-list">
            {props.pendingApprovals.map((approval) => (
              <article key={approval.approvalId} className="cn-event-approval-card">
                <strong>{approvalTitle(approval.params)}</strong>
                <span>{approval.method}</span>
                <div className="cn-approval-actions">
                  <button
                    className="cn-primary-button"
                    type="button"
                    onClick={() => props.onDecision(approval.approvalId, "accept")}
                  >
                    接受
                  </button>
                  <button
                    className="cn-soft-button"
                    type="button"
                    onClick={() => props.onDecision(approval.approvalId, "acceptForSession")}
                  >
                    本次会话
                  </button>
                  <button
                    className="cn-soft-button"
                    type="button"
                    onClick={() => props.onDecision(approval.approvalId, "decline")}
                  >
                    拒绝
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : null}
        <div className="cn-event-list">
          {props.events
            .slice()
            .reverse()
            .slice(0, 120)
            .map((event) => (
              <details key={event.seq} className="cn-event-row">
                <summary>
                  <span>#{event.seq}</span>
                  <strong>{event.type}</strong>
                </summary>
                <pre>{JSON.stringify(event.payload, null, 2)}</pre>
              </details>
            ))}
        </div>
      </section>
    </div>
  );
}

function ApprovalModal(props: {
  approval: PendingApprovalView;
  onDecision: (decision: string) => void;
}) {
  return (
    <div className="cn-approval-backdrop cn-real-approval-backdrop">
      <section className="cn-approval-modal">
        <h2>Codex 请求批准</h2>
        <p>{props.approval.method}</p>
        <pre>{approvalSummary(props.approval.params)}</pre>
        <div className="cn-approval-actions">
          <button className="cn-primary-button" type="button" onClick={() => props.onDecision("accept")}>
            接受
          </button>
          <button className="cn-soft-button" type="button" onClick={() => props.onDecision("acceptForSession")}>
            本次会话
          </button>
          <button className="cn-soft-button" type="button" onClick={() => props.onDecision("decline")}>
            拒绝
          </button>
          <button className="cn-soft-button wide" type="button" onClick={() => props.onDecision("cancel")}>
            取消
          </button>
        </div>
      </section>
    </div>
  );
}

function groupSessions(sessions: LocalSessionSummary[]) {
  const groups = new Map<string, { cwd: string; name: string; sessions: LocalSessionSummary[] }>();
  for (const session of sessions) {
    const existing = groups.get(session.cwd);
    if (existing) {
      existing.sessions.push(session);
    } else {
      groups.set(session.cwd, {
        cwd: session.cwd,
        name: shortPath(session.cwd),
        sessions: [session]
      });
    }
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      sessions: group.sessions.sort((a, b) => b.updatedAt - a.updatedAt)
    }))
    .sort((a, b) => (b.sessions[0]?.updatedAt ?? 0) - (a.sessions[0]?.updatedAt ?? 0));
}

function groupCodexHistory(entries: LocalCodexHistoryEntry[]) {
  const groups = new Map<string, { cwd: string; name: string; entries: LocalCodexHistoryEntry[] }>();
  const seen = new Set<string>();
  for (const entry of entries) {
    const uniqueKey = codexHistoryKey(entry);
    if (seen.has(uniqueKey)) {
      continue;
    }
    seen.add(uniqueKey);
    const existing = groups.get(entry.cwd);
    if (existing) {
      existing.entries.push(entry);
    } else {
      groups.set(entry.cwd, {
        cwd: entry.cwd,
        name: shortPath(entry.cwd),
        entries: [entry]
      });
    }
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      entries: group.entries.sort(
        (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
      )
    }))
    .sort(
      (a, b) =>
        Date.parse(b.entries[0]?.updatedAt ?? "") -
        Date.parse(a.entries[0]?.updatedAt ?? "")
    );
}

function codexHistoryKey(entry: LocalCodexHistoryEntry): string {
  return `${entry.id}::${entry.cwd}`;
}

function sessionTitle(session: LocalSessionSummary, chatItems: ChatItem[]): string {
  const firstUserMessage = chatItems.find(
    (item) => item.sessionId === session.sessionId && item.role === "user"
  );
  const text = firstUserMessage?.text.trim();
  if (text) {
    return text.split(/\n/)[0]?.slice(0, 80) ?? shortPath(session.cwd);
  }
  if (session.goal?.objective) {
    return session.goal.objective.slice(0, 80);
  }
  return `${shortPath(session.cwd)} · ${statusLabel(session.status)}`;
}

function sessionSubtitle(session: LocalSessionSummary): string {
  const model = session.model ? session.model.replace("gpt-", "") : "default model";
  return `${shortPath(session.cwd)} · ${model} · ${reasoningLabel(session.reasoningEffort)} · ${permissionLabel(session.permissionMode)}`;
}

function buildMessageWithAttachments(prompt: string, attachments: AttachmentDraft[]): string {
  if (!attachments.length) {
    return prompt;
  }
  const blocks = attachments.map((attachment) => {
    if (!attachment.content) {
      return `\n\n[Attached file: ${attachment.name}; ${attachment.type}; ${attachment.size} bytes; content not embedded because it is not a text file.]`;
    }
    return `\n\n[Attached file: ${attachment.name}]\n${attachment.content}`;
  });
  return `${prompt}${blocks.join("")}`;
}

function deviceNameStorageKey(agentUrl: string): string {
  return `codexnext.deviceName.${agentUrl}`;
}

function defaultDeviceName(agentUrl: string): string {
  try {
    const url = new URL(agentUrl);
    return `Codex agent @ ${url.hostname}`;
  } catch {
    return "Codex agent";
  }
}

function shortPath(input: string): string {
  const parts = input.split("/").filter(Boolean);
  return parts.at(-1) ?? input;
}

function statusLabel(status: string): string {
  if (status === "connected") {
    return "online";
  }
  if (status === "connecting") {
    return "connecting";
  }
  if (status === "reconnecting") {
    return "reconnecting";
  }
  if (status === "running") {
    return "running";
  }
  if (status === "completed") {
    return "completed";
  }
  if (status === "interrupted") {
    return "interrupted";
  }
  return status || "offline";
}

function reasoningLabel(value: LocalReasoningEffort | null | undefined): string {
  return reasoningOptions.find((option) => option.value === value)?.label ?? "默认推理";
}

function permissionLabel(value: LocalPermissionMode): string {
  return permissionOptions.find((option) => option.mode === value)?.label ?? "请求批准";
}

function roleLabel(role: ChatItem["role"]): string {
  if (role === "assistant") {
    return "Codex";
  }
  if (role === "command") {
    return "Command output";
  }
  if (role === "diff") {
    return "Diff";
  }
  if (role === "system") {
    return "System";
  }
  return "You";
}

function messageClass(role: ChatItem["role"]): string {
  if (role === "assistant") {
    return "assistant";
  }
  if (role === "command" || role === "diff") {
    return "command";
  }
  if (role === "system") {
    return "system";
  }
  return "user";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSessionSummary(value: unknown): value is LocalSessionSummary {
  return isRecord(value) && typeof value.sessionId === "string";
}

function isPendingApproval(value: unknown): value is PendingApprovalView {
  return isRecord(value) && typeof value.approvalId === "string";
}

function readText(payload: unknown): string {
  if (!isRecord(payload)) {
    return "";
  }
  return typeof payload.text === "string" ? payload.text : "";
}

function readDiff(payload: unknown): string {
  if (!isRecord(payload)) {
    return "";
  }
  return typeof payload.diff === "string" ? payload.diff : "";
}

function readPlan(payload: unknown): string {
  if (!payload) {
    return "Plan updated.";
  }
  return `Plan updated:\n${JSON.stringify(payload, null, 2)}`;
}

function readTurnStatus(payload: unknown): string {
  if (!isRecord(payload) || !isRecord(payload.turn)) {
    return "unknown";
  }
  return typeof payload.turn.status === "string" ? payload.turn.status : "unknown";
}

function approvalTitle(params: unknown): string {
  const record = isRecord(params) ? params : null;
  if (!record) {
    return "Codex requests approval";
  }
  const command = readString(record, "command") ?? readString(record, "cmd");
  if (command) {
    return command;
  }
  const filePath = readString(record, "path") ?? readString(record, "filePath");
  return filePath ?? "Codex requests approval";
}

function approvalSummary(params: unknown): string {
  if (!isRecord(params)) {
    return JSON.stringify(params, null, 2);
  }
  const cwd = readString(params, "cwd") ?? readString(params, "workdir");
  const command = readString(params, "command") ?? readString(params, "cmd");
  const filePath = readString(params, "path") ?? readString(params, "filePath");
  const lines = [
    cwd ? `cwd: ${cwd}` : null,
    command ? `$ ${command}` : null,
    filePath ? `file: ${filePath}` : null
  ].filter(Boolean);
  if (lines.length) {
    return lines.join("\n");
  }
  return JSON.stringify(params, null, 2);
}

function readString(record: Record<string, unknown>, key: string): string | null {
  return typeof record[key] === "string" ? record[key] : null;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
