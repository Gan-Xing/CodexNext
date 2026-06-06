"use client";

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";
import type {
  LocalReasoningEffort,
  ThreadGoal
} from "@codexnext/protocol";
import {
  agentFetch,
  getCodexHistoryDetail,
  health,
  listCodexHistory,
  listDirectories,
  listSessions,
  resumeCodexHistory,
  type AgentConnection
} from "../lib/api";
import { openEventStream } from "../lib/event-stream";
import type {
  ChatItem,
  LocalCodexHistoryDetailResponse,
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

interface ProjectThreadGroupData {
  cwd: string;
  name: string;
  updatedAt: number;
  sessions: LocalSessionSummary[];
  entries: LocalCodexHistoryEntry[];
}

interface SavedDevice {
  id: string;
  name: string;
  agentUrl: string;
  token: string;
  codexVersion?: string | null;
  lastConnectedAt?: number | null;
}

interface DeviceDraftState {
  selectedDeviceId: string | null;
  name: string;
  agentUrl: string;
  token: string;
}

interface DevicePresenceState {
  checkedAt: number;
  codexVersion?: string | null;
  error?: string | null;
  status: "checking" | "offline" | "online";
}

interface DeviceWorkspace {
  chatItems: ChatItem[];
  codexHistory: LocalCodexHistoryEntry[];
  connection: AgentConnection;
  currentSessionId: string | null;
  cwd: string;
  directoryError: string | null;
  directoryList: LocalDirectoryListResponse | null;
  directoryLoading: boolean;
  events: LocalEvent[];
  healthStatus: LocalHealthResponse | null;
  historyLoadingKey: string | null;
  pendingApprovals: PendingApprovalView[];
  resumeStates: Record<string, ResumeState>;
  selectedHistoryKey: string | null;
  sessions: LocalSessionSummary[];
  streamStatus: string;
}

type StateUpdater<T> = T | ((previous: T) => T);

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

const MESSAGE_ESTIMATED_HEIGHT = 180;
const MESSAGE_GAP = 16;
const MESSAGE_OVERSCAN_PX = 420;

type ResumeState = "history" | "resuming" | "failed" | "missing";

const savedDevicesStorageKey = "codexnext.savedDevices.v1";

export function WebConsole() {
  const [agentUrl, setAgentUrl] = useState("http://127.0.0.1:17361");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [autoConnect, setAutoConnect] = useState<AgentConnection | null>(null);
  const [savedDevices, setSavedDevices] = useState<SavedDevice[]>([]);
  const [devicePresence, setDevicePresence] = useState<
    Record<string, DevicePresenceState>
  >({});
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [deviceName, setDeviceName] = useState("");
  const [activeSheet, setActiveSheet] = useState<ActiveSheet>(null);
  const [activeMenu, setActiveMenu] = useState<ActiveMenu>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [deviceWorkspaces, setDeviceWorkspaces] = useState<
    Record<string, DeviceWorkspace>
  >({});

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

  const eventSourceRefs = useRef(new Map<string, EventSource>());
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const historyDetailCacheRef = useRef(
    new Map<string, LocalCodexHistoryDetailResponse>()
  );
  const pendingDeviceStreamIds = useRef(new Set<string>());
  const selectedDeviceIdRef = useRef<string | null>(null);
  const threadEndRef = useRef<HTMLDivElement | null>(null);

  const activeWorkspace = selectedDeviceId
    ? deviceWorkspaces[selectedDeviceId] ?? null
    : null;
  const connection: AgentConnection = activeWorkspace?.connection ?? { agentUrl, token };
  const healthStatus = activeWorkspace?.healthStatus ?? null;
  const streamStatus = activeWorkspace?.streamStatus ?? "disconnected";
  const events = activeWorkspace?.events ?? [];
  const sessions = activeWorkspace?.sessions ?? [];
  const codexHistory = activeWorkspace?.codexHistory ?? [];
  const currentSessionId = activeWorkspace?.currentSessionId ?? null;
  const selectedHistoryKey = activeWorkspace?.selectedHistoryKey ?? null;
  const selectedHistoryEntry = selectedHistoryKey
    ? codexHistory.find((entry) => codexHistoryKey(entry) === selectedHistoryKey) ??
      null
    : null;
  const historyLoadingKey = activeWorkspace?.historyLoadingKey ?? null;
  const resumeStates = activeWorkspace?.resumeStates ?? {};
  const chatItems = activeWorkspace?.chatItems ?? [];
  const pendingApprovals = activeWorkspace?.pendingApprovals ?? [];
  const cwd = activeWorkspace?.cwd ?? "";
  const directoryList = activeWorkspace?.directoryList ?? null;
  const directoryError = activeWorkspace?.directoryError ?? null;
  const directoryLoading = activeWorkspace?.directoryLoading ?? false;
  const currentSession = currentSessionId
    ? sessions.find((session) => session.sessionId === currentSessionId) ?? null
    : null;
  const visibleChatItems = currentSession
    ? chatItems.filter((item) => item.sessionId === currentSession.sessionId)
    : [];
  const latestVisibleChatItem = visibleChatItems.at(-1);
  const connected = Boolean(
    healthStatus?.ok && streamStatus === "connected"
  );
  const activeTurn = Boolean(currentSession?.activeTurnId);
  const currentResumeState = currentSession
    ? resumeStates[currentSession.sessionId] ?? null
    : null;
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

  function patchDeviceWorkspace(
    deviceId: string,
    updater: (workspace: DeviceWorkspace) => DeviceWorkspace
  ) {
    setDeviceWorkspaces((previous) => {
      const device = savedDevices.find((item) => item.id === deviceId);
      const current =
        previous[deviceId] ??
        createDeviceWorkspace({
          agentUrl: device?.agentUrl ?? agentUrl,
          token: device?.token ?? token
        });
      return {
        ...previous,
        [deviceId]: updater(current)
      };
    });
  }

  function patchActiveWorkspace(
    updater: (workspace: DeviceWorkspace) => DeviceWorkspace
  ) {
    if (!selectedDeviceId) {
      return;
    }
    patchDeviceWorkspace(selectedDeviceId, updater);
  }

  function setHealthStatus(updater: StateUpdater<LocalHealthResponse | null>) {
    patchActiveWorkspace((workspace) => ({
      ...workspace,
      healthStatus: resolveStateUpdater(workspace.healthStatus, updater)
    }));
  }

  function setStreamStatus(updater: StateUpdater<string>) {
    patchActiveWorkspace((workspace) => ({
      ...workspace,
      streamStatus: resolveStateUpdater(workspace.streamStatus, updater)
    }));
  }

  function setEvents(updater: StateUpdater<LocalEvent[]>) {
    patchActiveWorkspace((workspace) => ({
      ...workspace,
      events: resolveStateUpdater(workspace.events, updater)
    }));
  }

  function setSessions(updater: StateUpdater<LocalSessionSummary[]>) {
    patchActiveWorkspace((workspace) => ({
      ...workspace,
      sessions: resolveStateUpdater(workspace.sessions, updater)
    }));
  }

  function setCodexHistory(updater: StateUpdater<LocalCodexHistoryEntry[]>) {
    patchActiveWorkspace((workspace) => ({
      ...workspace,
      codexHistory: resolveStateUpdater(workspace.codexHistory, updater)
    }));
  }

  function setCurrentSessionId(updater: StateUpdater<string | null>) {
    patchActiveWorkspace((workspace) => ({
      ...workspace,
      currentSessionId: resolveStateUpdater(workspace.currentSessionId, updater)
    }));
  }

  function setSelectedHistoryKey(updater: StateUpdater<string | null>) {
    patchActiveWorkspace((workspace) => ({
      ...workspace,
      selectedHistoryKey: resolveStateUpdater(
        workspace.selectedHistoryKey,
        updater
      )
    }));
  }

  function setHistoryLoadingKey(updater: StateUpdater<string | null>) {
    patchActiveWorkspace((workspace) => ({
      ...workspace,
      historyLoadingKey: resolveStateUpdater(workspace.historyLoadingKey, updater)
    }));
  }

  function setResumeStates(updater: StateUpdater<Record<string, ResumeState>>) {
    patchActiveWorkspace((workspace) => ({
      ...workspace,
      resumeStates: resolveStateUpdater(workspace.resumeStates, updater)
    }));
  }

  function setChatItems(updater: StateUpdater<ChatItem[]>) {
    patchActiveWorkspace((workspace) => ({
      ...workspace,
      chatItems: resolveStateUpdater(workspace.chatItems, updater)
    }));
  }

  function setPendingApprovals(updater: StateUpdater<PendingApprovalView[]>) {
    patchActiveWorkspace((workspace) => ({
      ...workspace,
      pendingApprovals: resolveStateUpdater(workspace.pendingApprovals, updater)
    }));
  }

  function setCwd(updater: StateUpdater<string>) {
    patchActiveWorkspace((workspace) => ({
      ...workspace,
      cwd: resolveStateUpdater(workspace.cwd, updater)
    }));
  }

  function setDirectoryList(
    updater: StateUpdater<LocalDirectoryListResponse | null>
  ) {
    patchActiveWorkspace((workspace) => ({
      ...workspace,
      directoryList: resolveStateUpdater(workspace.directoryList, updater)
    }));
  }

  function setDirectoryError(updater: StateUpdater<string | null>) {
    patchActiveWorkspace((workspace) => ({
      ...workspace,
      directoryError: resolveStateUpdater(workspace.directoryError, updater)
    }));
  }

  function setDirectoryLoading(updater: StateUpdater<boolean>) {
    patchActiveWorkspace((workspace) => ({
      ...workspace,
      directoryLoading: resolveStateUpdater(workspace.directoryLoading, updater)
    }));
  }

  useEffect(() => {
    const storedDevices = readSavedDevices();
    setSavedDevices(storedDevices);
    setDeviceWorkspaces((previous) => {
      const next = { ...previous };
      for (const device of storedDevices) {
        next[device.id] =
          next[device.id] ??
          createDeviceWorkspace({
            agentUrl: device.agentUrl,
            token: device.token
          });
      }
      return next;
    });

    const params = new URLSearchParams(window.location.search);
    const queryAgent = params.get("agent");
    const queryToken = params.get("token");
    if (queryAgent) {
      setAgentUrl(queryAgent);
    }
    if (queryToken) {
      setToken(queryToken);
    }
    if (queryAgent) {
      const matchedDevice = findSavedDevice(
        storedDevices,
        queryAgent,
        queryToken ?? ""
      );
      if (matchedDevice) {
        setSelectedDeviceId(matchedDevice.id);
        setDeviceName(matchedDevice.name);
      } else {
        const savedName = window.localStorage.getItem(
          deviceNameStorageKey(queryAgent)
        );
        setDeviceName(savedName ?? defaultDeviceName(queryAgent));
      }
    } else {
      const preferredDevice = [...storedDevices].sort(
        (a, b) => (b.lastConnectedAt ?? 0) - (a.lastConnectedAt ?? 0)
      )[0];
      if (preferredDevice) {
        setSelectedDeviceId(preferredDevice.id);
        setAgentUrl(preferredDevice.agentUrl);
        setToken(preferredDevice.token);
        setDeviceName(preferredDevice.name);
      }
    }
    if (queryAgent && queryToken) {
      setAutoConnect({ agentUrl: queryAgent, token: queryToken });
    }
  }, []);

  useEffect(() => {
    selectedDeviceIdRef.current = selectedDeviceId;
  }, [selectedDeviceId]);

  useEffect(() => {
    const selectedDevice = savedDevices.find(
      (device) => device.id === selectedDeviceId
    );
    if (selectedDevice && isSameDeviceEndpoint(selectedDevice, agentUrl, token)) {
      setDeviceName(selectedDevice.name);
      return;
    }
    const matchingDevice = findSavedDevice(savedDevices, agentUrl, token);
    if (matchingDevice) {
      setSelectedDeviceId(matchingDevice.id);
      setDeviceName(matchingDevice.name);
      return;
    }
    const savedName = window.localStorage.getItem(deviceNameStorageKey(agentUrl));
    setDeviceName(savedName ?? "");
  }, [agentUrl, savedDevices, selectedDeviceId, token]);

  useEffect(() => {
    if (savedDevices.length === 0) {
      setDevicePresence({});
      return;
    }

    let cancelled = false;
    const savedDeviceIds = new Set(savedDevices.map((device) => device.id));

    const refreshPresence = async () => {
      const checkedAt = Date.now();
      setDevicePresence((previous) => {
        const next: Record<string, DevicePresenceState> = {};
        for (const device of savedDevices) {
          next[device.id] = previous[device.id] ?? {
            checkedAt,
            codexVersion: device.codexVersion ?? null,
            status: "checking"
          };
        }
        return next;
      });

      const results = await Promise.all(
        savedDevices.map(async (device) => {
          try {
            const status = await health({
              agentUrl: device.agentUrl,
              token: device.token
            });
            void attachSavedDeviceStream(device, status);
            return {
              id: device.id,
              presence: {
                checkedAt: Date.now(),
                codexVersion: status.codex?.version ?? device.codexVersion ?? null,
                status: "online" as const
              }
            };
          } catch (err) {
            eventSourceRefs.current.get(device.id)?.close();
            eventSourceRefs.current.delete(device.id);
            pendingDeviceStreamIds.current.delete(device.id);
            patchDeviceWorkspace(device.id, (workspace) => ({
              ...workspace,
              healthStatus: null,
              streamStatus: "error"
            }));
            return {
              id: device.id,
              presence: {
                checkedAt: Date.now(),
                codexVersion: device.codexVersion ?? null,
                error: formatError(err),
                status: "offline" as const
              }
            };
          }
        })
      );

      if (cancelled) {
        return;
      }
      setDevicePresence((previous) => {
        const next: Record<string, DevicePresenceState> = {};
        for (const [deviceId, presence] of Object.entries(previous)) {
          if (savedDeviceIds.has(deviceId)) {
            next[deviceId] = presence;
          }
        }
        for (const result of results) {
          if (savedDeviceIds.has(result.id)) {
            next[result.id] = result.presence;
          }
        }
        return next;
      });
    };

    void refreshPresence();
    const interval = window.setInterval(() => void refreshPresence(), 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [savedDevices]);

  useEffect(() => {
    if (!autoConnect) {
      return;
    }
    setAutoConnect(null);
    void connect(autoConnect).catch((err) => {
      setStreamStatus("error");
      setError(formatConnectionError(err, autoConnect.agentUrl));
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
      for (const source of eventSourceRefs.current.values()) {
        source.close();
      }
      eventSourceRefs.current.clear();
    };
  }, []);

  useEffect(() => {
    const end = threadEndRef.current;
    end?.scrollIntoView({ block: "end" });
    const scroller = end?.closest(".cn-thread-canvas");
    if (scroller instanceof HTMLElement) {
      window.requestAnimationFrame(() => {
        scroller.scrollTop = scroller.scrollHeight;
      });
    }
  }, [
    currentSessionId,
    latestVisibleChatItem?.id,
    latestVisibleChatItem?.text.length
  ]);

  async function connect(
    nextConnection: AgentConnection = connection,
    options?: { deviceId?: string | null; deviceName?: string }
  ) {
    setError(null);
    let connectingDeviceId: string | null = options?.deviceId ?? null;
    try {
      const status = await health(nextConnection);
      const connectedDevice = upsertConnectedDevice(
        nextConnection,
        status,
        options
      );
      connectingDeviceId = connectedDevice.id;
      const deviceConnection = {
        agentUrl: connectedDevice.agentUrl,
        token: connectedDevice.token
      };
      setSelectedDeviceId(connectedDevice.id);
      setAgentUrl(connectedDevice.agentUrl);
      setToken(connectedDevice.token);
      setDeviceName(connectedDevice.name);
      setDeviceWorkspaces((previous) => {
        const current =
          previous[connectedDevice.id] ??
          createDeviceWorkspace(deviceConnection);
        return {
          ...previous,
          [connectedDevice.id]: {
            ...current,
            connection: deviceConnection,
            healthStatus: status,
            streamStatus: "connecting"
          }
        };
      });
      setDevicePresence((previous) => ({
        ...previous,
        [connectedDevice.id]: {
          checkedAt: Date.now(),
          codexVersion: status.codex?.version ?? null,
          status: "online"
        }
      }));

      const replay = await agentFetch<{ events: LocalEvent[] }>(
        deviceConnection,
        "/api/events?after=0"
      );
      ingestDeviceEvents(connectedDevice.id, replay.events, {
        selectSessions: false
      });
      const loadedSessions = await listSessions(deviceConnection);
      const history = await listCodexHistory(deviceConnection);
      const latestSession = [...loadedSessions.sessions].sort(
        (a, b) => b.updatedAt - a.updatedAt
      )[0];
      patchDeviceWorkspace(connectedDevice.id, (workspace) => ({
        ...workspace,
        codexHistory: history.entries,
        currentSessionId: workspace.currentSessionId ?? latestSession?.sessionId ?? null,
        cwd: workspace.cwd || latestSession?.cwd || "",
        directoryError: null,
        directoryLoading: true,
        sessions: loadedSessions.sessions
      }));
      try {
        const directories = await listDirectories(
          deviceConnection,
          cwd || latestSession?.cwd || undefined
        );
        patchDeviceWorkspace(connectedDevice.id, (workspace) => ({
          ...workspace,
          directoryList: directories
        }));
      } catch (err) {
        patchDeviceWorkspace(connectedDevice.id, (workspace) => ({
          ...workspace,
          directoryError: formatError(err)
        }));
      } finally {
        patchDeviceWorkspace(connectedDevice.id, (workspace) => ({
          ...workspace,
          directoryLoading: false
        }));
      }

      let connectedOnce = false;
      const markConnected = () => {
        connectedOnce = true;
        patchDeviceWorkspace(connectedDevice.id, (workspace) => ({
          ...workspace,
          streamStatus: "connected"
        }));
      };

      eventSourceRefs.current.get(connectedDevice.id)?.close();
      const source = openEventStream(
        deviceConnection,
        replay.events.at(-1)?.seq ?? 0,
        (event) => {
          markConnected();
          ingestDeviceEvents(connectedDevice.id, [event], {
            selectSessions: true
          });
        },
        () => {
          patchDeviceWorkspace(connectedDevice.id, (workspace) => ({
            ...workspace,
            streamStatus: connectedOnce ? "reconnecting" : "error"
          }));
        }
      );
      source.onopen = markConnected;
      eventSourceRefs.current.set(connectedDevice.id, source);
      window.setTimeout(() => {
        if (!connectedOnce && source.readyState !== EventSource.CLOSED) {
          markConnected();
        }
      }, 750);
    } catch (err) {
      if (connectingDeviceId) {
        eventSourceRefs.current.get(connectingDeviceId)?.close();
        eventSourceRefs.current.delete(connectingDeviceId);
        patchDeviceWorkspace(connectingDeviceId, (workspace) => ({
          ...workspace,
          healthStatus: null,
          streamStatus: "error"
        }));
      }
      throw err;
    }
  }

  async function attachSavedDeviceStream(
    device: SavedDevice,
    initialHealthStatus?: LocalHealthResponse
  ) {
    if (
      eventSourceRefs.current.has(device.id) ||
      pendingDeviceStreamIds.current.has(device.id)
    ) {
      return;
    }
    pendingDeviceStreamIds.current.add(device.id);
    const deviceConnection = {
      agentUrl: device.agentUrl,
      token: device.token
    };
    try {
      const status = initialHealthStatus ?? (await health(deviceConnection));
      patchDeviceWorkspace(device.id, (workspace) => ({
        ...workspace,
        connection: deviceConnection,
        healthStatus: status,
        streamStatus: "connecting"
      }));

      const replay = await agentFetch<{ events: LocalEvent[] }>(
        deviceConnection,
        "/api/events?after=0"
      );
      ingestDeviceEvents(device.id, replay.events, { selectSessions: false });
      const [loadedSessions, history] = await Promise.all([
        listSessions(deviceConnection),
        listCodexHistory(deviceConnection)
      ]);
      const latestSession = [...loadedSessions.sessions].sort(
        (a, b) => b.updatedAt - a.updatedAt
      )[0];
      patchDeviceWorkspace(device.id, (workspace) => ({
        ...workspace,
        codexHistory: history.entries,
        currentSessionId: workspace.currentSessionId ?? latestSession?.sessionId ?? null,
        cwd: workspace.cwd || latestSession?.cwd || "",
        sessions: loadedSessions.sessions
      }));

      let connectedOnce = false;
      const markConnected = () => {
        connectedOnce = true;
        patchDeviceWorkspace(device.id, (workspace) => ({
          ...workspace,
          streamStatus: "connected"
        }));
        setDevicePresence((previous) => ({
          ...previous,
          [device.id]: {
            checkedAt: Date.now(),
            codexVersion: status.codex?.version ?? device.codexVersion ?? null,
            status: "online"
          }
        }));
      };

      if (eventSourceRefs.current.has(device.id)) {
        markConnected();
        return;
      }
      const source = openEventStream(
        deviceConnection,
        replay.events.at(-1)?.seq ?? 0,
        (event) => {
          markConnected();
          ingestDeviceEvents(device.id, [event], { selectSessions: true });
        },
        () => {
          patchDeviceWorkspace(device.id, (workspace) => ({
            ...workspace,
            streamStatus: connectedOnce ? "reconnecting" : "error"
          }));
        }
      );
      source.onopen = markConnected;
      eventSourceRefs.current.set(device.id, source);
      window.setTimeout(() => {
        if (!connectedOnce && source.readyState !== EventSource.CLOSED) {
          markConnected();
        }
      }, 750);
    } catch (err) {
      eventSourceRefs.current.get(device.id)?.close();
      eventSourceRefs.current.delete(device.id);
      patchDeviceWorkspace(device.id, (workspace) => ({
        ...workspace,
        healthStatus: null,
        streamStatus: "error"
      }));
      setDevicePresence((previous) => ({
        ...previous,
        [device.id]: {
          checkedAt: Date.now(),
          codexVersion: device.codexVersion ?? null,
          error: formatError(err),
          status: "offline"
        }
      }));
    } finally {
      pendingDeviceStreamIds.current.delete(device.id);
    }
  }

  function persistDevices(nextDevices: SavedDevice[]) {
    const sortedDevices = [...nextDevices].sort(
      (a, b) => (b.lastConnectedAt ?? 0) - (a.lastConnectedAt ?? 0)
    );
    setSavedDevices(sortedDevices);
    window.localStorage.setItem(
      savedDevicesStorageKey,
      JSON.stringify(sortedDevices)
    );
  }

  function upsertConnectedDevice(
    nextConnection: AgentConnection,
    status: LocalHealthResponse,
    options?: { deviceId?: string | null; deviceName?: string }
  ): SavedDevice {
    const normalizedAgentUrl = normalizeAgentUrl(nextConnection.agentUrl);
    const existingBySelection = options?.deviceId
      ? savedDevices.find((device) => device.id === options.deviceId)
      : null;
    const existingByEndpoint = findSavedDevice(
      savedDevices,
      normalizedAgentUrl,
      nextConnection.token
    );
    const existingDevice = existingBySelection ?? existingByEndpoint ?? null;
    const nextDevice: SavedDevice = {
      id: existingDevice?.id ?? createSavedDeviceId(),
      name:
        options?.deviceName?.trim() ||
        deviceName.trim() ||
        existingDevice?.name ||
        status.device?.defaultName ||
        defaultDeviceName(normalizedAgentUrl),
      agentUrl: normalizedAgentUrl,
      token: nextConnection.token,
      codexVersion: status.codex?.version ?? null,
      lastConnectedAt: Date.now()
    };
    const nextDevices = [
      nextDevice,
      ...savedDevices.filter(
        (device) =>
          device.id !== nextDevice.id &&
          !isSameDeviceEndpoint(device, nextDevice.agentUrl, nextDevice.token)
      )
    ];
    persistDevices(nextDevices);
    window.localStorage.setItem(
      deviceNameStorageKey(nextDevice.agentUrl),
      nextDevice.name
    );
    return nextDevice;
  }

  function deleteSavedDevice(deviceId: string) {
    const nextDevices = savedDevices.filter((device) => device.id !== deviceId);
    persistDevices(nextDevices);
    eventSourceRefs.current.get(deviceId)?.close();
    eventSourceRefs.current.delete(deviceId);
    pendingDeviceStreamIds.current.delete(deviceId);
    setDevicePresence((previous) => {
      const next = { ...previous };
      delete next[deviceId];
      return next;
    });
    setDeviceWorkspaces((previous) => {
      const next = { ...previous };
      delete next[deviceId];
      return next;
    });
    if (deviceId === selectedDeviceId) {
      setSelectedDeviceId(null);
    }
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
    clearSelectedHistory();
    upsertSession(result.session);
    setActiveSheet(null);
  }

  async function selectHistory(entry: LocalCodexHistoryEntry) {
    const key = codexHistoryKey(entry);
    if (!connected) {
      setActiveSheet("device");
      return;
    }
    const previewSession = makeHistoryPreviewSession(entry);
    const previewSessionId = previewSession.sessionId;
    setError(null);
    setSelectedHistoryKey(key);
    setHistoryLoadingKey(key);
    setActiveSheet(null);
    setCwd(entry.cwd);
    upsertSession(previewSession);
    setResumeStates((previous) => ({
      ...previous,
      [previewSessionId]: isPreviewOnlyHistoryEntry(entry) ? "missing" : "history"
    }));
    setCurrentSessionId(previewSessionId);
    revealMainOnMobile();
    try {
      const cachedDetail = historyDetailCacheRef.current.get(key);
      const detail =
        cachedDetail ??
        (await getCodexHistoryDetail(connection, {
          id: entry.id,
          cwd: entry.cwd,
          filePath: entry.filePath
        }));
      historyDetailCacheRef.current.set(key, detail);
      hydrateSessionFromHistory(previewSessionId, detail.messages);
      setResumeStates((previous) => ({
        ...previous,
        [previewSessionId]: isPreviewOnlyHistoryEntry(detail.entry)
          ? "missing"
          : "history"
      }));
    } catch (err) {
      if (isMissingHistoryCwdError(err)) {
        setResumeStates((previous) => ({
          ...previous,
          [previewSessionId]: "missing"
        }));
        return;
      }
      setResumeStates((previous) => ({
        ...previous,
        [previewSessionId]: "failed"
      }));
      setError(formatError(err));
    } finally {
      setHistoryLoadingKey(null);
    }
  }

  async function resumeHistorySessionForMessage(
    entry: LocalCodexHistoryEntry,
    previewSession: LocalSessionSummary,
    message: string
  ) {
    if (isPreviewOnlyHistoryEntry(entry)) {
      setResumeStates((previous) => ({
        ...previous,
        [previewSession.sessionId]: "missing"
      }));
      throw new Error("这条历史的项目目录已经不存在，只能查看历史记录。");
    }

    setResumeStates((previous) => ({
      ...previous,
      [previewSession.sessionId]: "resuming"
    }));

    try {
      const result = await resumeCodexHistory(connection, {
        id: entry.id,
        cwd: entry.cwd,
        filePath: entry.filePath,
        model,
        permissionMode,
        reasoningEffort
      });
      upsertSession(result.session);
      reassignSessionChatItems(previewSession.sessionId, result.session.sessionId);
      hydrateSessionFromHistory(result.session.sessionId, result.history.messages);
      clearSelectedHistory();
      setCurrentSessionId(result.session.sessionId);
      setCwd(result.session.cwd);
      removeSession(previewSession.sessionId);
      setResumeStates((previous) => {
        const next = { ...previous };
        delete next[previewSession.sessionId];
        delete next[result.session.sessionId];
        return next;
      });
      await agentFetch(
        connection,
        `/api/sessions/${result.session.sessionId}/messages`,
        {
          method: "POST",
          body: JSON.stringify({ text: message })
        }
      );
    } catch (err) {
      setResumeStates((previous) => ({
        ...previous,
        [previewSession.sessionId]: isMissingHistoryCwdError(err)
          ? "missing"
          : "failed"
      }));
      throw err;
    }
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

    if (currentResumeState === "resuming") {
      setError("正在恢复历史会话，恢复完成后就可以继续发送。");
      return;
    }
    if (currentResumeState === "failed") {
      setError("这条历史会话恢复失败，当前只是历史预览，不能直接发送。");
      return;
    }
    if (currentResumeState === "missing") {
      setError("这条历史的项目目录已经不存在，只能查看历史；请选择现有项目后新建会话。");
      return;
    }

    if (currentSession) {
      if (isHistoryPreviewSessionId(currentSession.sessionId)) {
        const historyEntry =
          selectedHistoryEntry ??
          codexHistory.find(
            (entry) => historyPreviewSessionId(entry) === currentSession.sessionId
          ) ??
          null;
        if (!historyEntry) {
          setError("找不到这条历史会话的 thread 信息，请刷新历史列表后重试。");
          return;
        }
        await resumeHistorySessionForMessage(historyEntry, currentSession, message);
        setDraft("");
        setAttachments([]);
        return;
      }
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
    if (!selectedDeviceId) {
      return;
    }
    ingestDeviceEvents(selectedDeviceId, incoming, options);
  }

  function ingestDeviceEvents(
    deviceId: string,
    incoming: LocalEvent[],
    options: { selectSessions: boolean } = { selectSessions: true }
  ) {
    patchDeviceWorkspace(deviceId, (workspace) =>
      ingestEventsIntoWorkspace(workspace, incoming, options)
    );
    if (selectedDeviceIdRef.current === deviceId) {
      const errorEvent = incoming.find(
        (event) => event.type === "agent.error" || event.type === "codex.error"
      );
      if (errorEvent) {
        setError(JSON.stringify(errorEvent.payload));
      }
    }
  }

  function upsertSession(session: LocalSessionSummary) {
    setSessions((previous) => [
      session,
      ...previous.filter((item) => item.sessionId !== session.sessionId)
    ]);
  }

  function removeSession(sessionId: string) {
    setSessions((previous) =>
      previous.filter((session) => session.sessionId !== sessionId)
    );
  }

  function selectSession(sessionId: string) {
    const previousSessionId = currentSessionId;
    clearSelectedHistory();
    setCurrentSessionId(sessionId);
    if (previousSessionId && isHistoryPreviewSessionId(previousSessionId)) {
      removeSession(previousSessionId);
    }
    revealMainOnMobile();
  }

  function clearSelectedHistory() {
    setSelectedHistoryKey(null);
  }

  function addChatItem(item: ChatItem) {
    setChatItems((previous) => [...previous, item].slice(-500));
  }

  function reassignSessionChatItems(fromSessionId: string, toSessionId: string) {
    setChatItems((previous) =>
      previous.map((item) =>
        item.sessionId === fromSessionId
          ? {
              ...item,
              id: item.id.replace(fromSessionId, toSessionId),
              sessionId: toSessionId
            }
          : item
      )
    );
  }

  function hydrateSessionFromHistory(
    sessionId: string,
    messages: LocalCodexHistoryDetailResponse["messages"]
  ) {
    const historyItems = messages.map((message) =>
      historyMessageToChatItem(sessionId, message)
    );
    setChatItems((previous) => [
      ...previous.filter(
        (item) =>
          item.sessionId !== sessionId ||
          !item.id.startsWith(`history-${sessionId}-`)
      ),
      ...historyItems
    ].slice(-500));
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
      ].slice(-500);
    });
  }

  const projectGroups = groupProjectThreads(sessions, codexHistory);
  const firstApproval = pendingApprovals[0] ?? null;

  function revealMainOnMobile() {
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 900px)").matches) {
      setSidebarCollapsed(true);
    }
  }

  function openDeviceSheet() {
    revealMainOnMobile();
    setActiveSheet("device");
  }

  function openEventsSheet() {
    revealMainOnMobile();
    setActiveSheet("events");
  }

  function openNewSessionSetup() {
    const previousSessionId = currentSessionId;
    setCurrentSessionId(null);
    clearSelectedHistory();
    if (previousSessionId && isHistoryPreviewSessionId(previousSessionId)) {
      removeSession(previousSessionId);
    }
    setDraft("");
    revealMainOnMobile();
    setActiveSheet("session");
    void loadDirectories(undefined);
  }

  function selectDirectory(pathValue: string) {
    const previousSessionId = currentSessionId;
    setCwd(pathValue);
    setCurrentSessionId(null);
    clearSelectedHistory();
    if (previousSessionId && isHistoryPreviewSessionId(previousSessionId)) {
      removeSession(previousSessionId);
    }
    revealMainOnMobile();
  }

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
            onClick={openDeviceSheet}
            aria-label="选择设备"
          >
            <CodexIcon name="terminal" />
            {connected ? <span className="cn-rail-dot" /> : null}
          </button>
          <button
            className="cn-rail-button"
            type="button"
            onClick={openNewSessionSetup}
            aria-label="新建对话"
          >
            <CodexIcon name="compose" />
          </button>
          <button
            className="cn-rail-button muted"
            type="button"
            onClick={openEventsSheet}
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
              onClick={openDeviceSheet}
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

          </div>

          <div className="cn-project-tree">
            <span className="cn-project-tree-title">项目</span>
            <div className="cn-project-scroll">
              {projectGroups.map((group) => (
                <ProjectThreadGroup
                  key={group.cwd}
                  activeSessionId={currentSessionId}
                  chatItems={chatItems}
                  group={group}
                  historyLoadingKey={historyLoadingKey}
                  selectedHistoryKey={selectedHistoryKey}
                  onSelectHistory={(entry) => void selectHistory(entry)}
                  onSelectSession={selectSession}
                />
              ))}

              {projectGroups.length === 0 ? (
                <div className="cn-empty-sidebar">
                  已连接，但没有发现本地 Codex 对话记录。
                </div>
              ) : null}
            </div>
          </div>

          <div className="cn-sidebar-footer">
            <button
              className="cn-settings-button"
              type="button"
              onClick={openDeviceSheet}
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
            <button
              className="cn-mobile-menu-button"
              type="button"
              onClick={() => setSidebarCollapsed(false)}
              aria-label="显示目录"
            >
              <CodexIcon name="collapse" />
            </button>
            <div>
              <h1>
                {selectedHistoryEntry
                  ? selectedHistoryEntry.title
                  : currentSession
                    ? sessionTitle(currentSession, chatItems)
                    : "新会话"}
              </h1>
              <p>
                {selectedHistoryEntry
                  ? historySubtitle(selectedHistoryEntry)
                  : currentSession
                    ? sessionSubtitle(currentSession)
                    : "选择项目后发送第一条消息"}
              </p>
            </div>
            <div className="cn-live-header-actions">
              {currentSession ? (
                <button className="cn-soft-button" type="button" onClick={() => setActiveSheet("goal")}>
                  Goal
                </button>
              ) : null}
              <button className="cn-soft-button" type="button" onClick={openEventsSheet}>
                活动
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
              endRef={threadEndRef}
              goal={currentSession.goal ?? null}
              items={visibleChatItems}
              pendingApprovals={pendingApprovals.length}
              resumeState={currentResumeState}
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
            onCloseMenu={() => setActiveMenu(null)}
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
              devicePresence={devicePresence}
              deviceName={deviceName}
              healthStatus={healthStatus}
              savedDevices={savedDevices}
              selectedDeviceId={selectedDeviceId}
              streamStatus={streamStatus}
              token={token}
              onClose={() => setActiveSheet(null)}
              onConnect={async (nextConnection, nextDeviceName, nextDeviceId) => {
                try {
                  await connect(nextConnection, {
                    deviceId: nextDeviceId,
                    deviceName: nextDeviceName
                  });
                  setActiveSheet(null);
                } catch (err) {
                  setError(formatConnectionError(err, nextConnection.agentUrl));
                }
              }}
              onDeleteDevice={deleteSavedDevice}
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
                revealMainOnMobile();
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

function ProjectThreadGroup(props: {
  activeSessionId: string | null;
  chatItems: ChatItem[];
  group: ProjectThreadGroupData;
  historyLoadingKey: string | null;
  selectedHistoryKey: string | null;
  onSelectHistory: (entry: LocalCodexHistoryEntry) => void;
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
              <small>{statusLabel(session.status)}</small>
            </button>
          ))}
          {props.group.entries.slice(0, 12).map((entry) => {
            const key = codexHistoryKey(entry);
            return (
              <button
                key={key}
                className={
                  props.selectedHistoryKey === key
                    ? "cn-thread-row cn-history-row selected"
                    : "cn-thread-row cn-history-row"
                }
                title={entry.title}
                type="button"
                onClick={() => props.onSelectHistory(entry)}
              >
                <span>{entry.title}</span>
                <small>
                  {props.historyLoadingKey === key ? "正在读取..." : historyTime(entry)}
                </small>
              </button>
            );
          })}
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
  endRef: React.RefObject<HTMLDivElement | null>;
  goal: ThreadGoal | null;
  items: ChatItem[];
  pendingApprovals: number;
  resumeState: ResumeState | null;
  session: LocalSessionSummary;
  onOpenApproval: () => void;
  onOpenGoal: () => void;
}) {
  const viewportRef = useRef<HTMLElement | null>(null);
  const statusRef = useRef<HTMLDivElement | null>(null);
  const messageHeightsRef = useRef<Map<string, number>>(new Map());
  const scrollUpdateFrameRef = useRef<number | null>(null);
  const heightUpdateFrameRef = useRef<number | null>(null);
  const pinnedRef = useRef(true);
  const previousSessionRef = useRef<string | null>(null);
  const previousTailRef = useRef("");
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [heightVersion, setHeightVersion] = useState(0);
  const [showJumpButton, setShowJumpButton] = useState(false);
  const tailSignature = buildChatTailSignature(props.items.at(-1));

  useEffect(() => {
    messageHeightsRef.current.clear();
    setHeightVersion((current) => current + 1);
    pinnedRef.current = true;
    setShowJumpButton(false);
  }, [props.session.sessionId]);

  useEffect(() => () => {
    if (scrollUpdateFrameRef.current !== null) {
      cancelAnimationFrame(scrollUpdateFrameRef.current);
    }
    if (heightUpdateFrameRef.current !== null) {
      cancelAnimationFrame(heightUpdateFrameRef.current);
    }
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    function commitScrollState() {
      if (!viewport) {
        return;
      }
      const distanceFromBottom =
        viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
      pinnedRef.current = distanceFromBottom < 56;
      const roundedScrollTop = Math.round(viewport.scrollTop / 12) * 12;
      setScrollTop((current) =>
        current === roundedScrollTop ? current : roundedScrollTop
      );
      setViewportHeight((current) =>
        current === viewport.clientHeight ? current : viewport.clientHeight
      );
      setShowJumpButton((current) =>
        current === !pinnedRef.current ? current : !pinnedRef.current
      );
    }

    function scheduleScrollState() {
      if (scrollUpdateFrameRef.current !== null) {
        return;
      }
      scrollUpdateFrameRef.current = requestAnimationFrame(() => {
        scrollUpdateFrameRef.current = null;
        commitScrollState();
      });
    }

    commitScrollState();
    const resizeObserver = new ResizeObserver(commitScrollState);
    resizeObserver.observe(viewport);
    viewport.addEventListener("scroll", scheduleScrollState, { passive: true });
    return () => {
      resizeObserver.disconnect();
      viewport.removeEventListener("scroll", scheduleScrollState);
    };
  }, [props.session.sessionId]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      previousSessionRef.current = props.session.sessionId;
      previousTailRef.current = tailSignature;
      return;
    }
    const sessionChanged = previousSessionRef.current !== props.session.sessionId;
    const tailChanged = previousTailRef.current !== tailSignature;
    if (sessionChanged || (tailChanged && pinnedRef.current)) {
      viewport.scrollTop = viewport.scrollHeight;
      pinnedRef.current = true;
      setShowJumpButton(false);
    } else if (tailChanged && !pinnedRef.current) {
      setShowJumpButton(true);
    }
    previousSessionRef.current = props.session.sessionId;
    previousTailRef.current = tailSignature;
  }, [heightVersion, props.session.sessionId, tailSignature]);

  const handleMessageMeasure = useCallback((id: string, height: number) => {
    if (!Number.isFinite(height) || height <= 0) {
      return;
    }
    const previous = messageHeightsRef.current.get(id);
    if (typeof previous === "number" && Math.abs(previous - height) < 1) {
      return;
    }
    messageHeightsRef.current.set(id, height);
    if (heightUpdateFrameRef.current !== null) {
      return;
    }
    heightUpdateFrameRef.current = requestAnimationFrame(() => {
      heightUpdateFrameRef.current = null;
      setHeightVersion((current) => current + 1);
    });
  }, []);

  const virtualState = useMemo(() => {
    if (props.items.length === 0) {
      return {
        bottomPadding: 0,
        topPadding: 0,
        totalHeight: 0,
        visibleItems: [] as ChatItem[]
      };
    }
    const statusHeight = statusRef.current?.offsetHeight ?? 0;
    const listScrollTop = Math.max(0, scrollTop - statusHeight - MESSAGE_GAP);
    const visibleTop = Math.max(0, listScrollTop - MESSAGE_OVERSCAN_PX);
    const visibleBottom =
      listScrollTop + viewportHeight + MESSAGE_OVERSCAN_PX;
    let offset = 0;
    let startIndex = 0;
    let endIndex = props.items.length - 1;
    let foundStart = false;

    for (let index = 0; index < props.items.length; index += 1) {
      const item = props.items[index];
      if (!item) {
        continue;
      }
      const height =
        messageHeightsRef.current.get(item.id) ?? MESSAGE_ESTIMATED_HEIGHT;
      const itemEnd = offset + height;
      if (!foundStart && itemEnd >= visibleTop) {
        startIndex = index;
        foundStart = true;
      }
      if (offset <= visibleBottom) {
        endIndex = index;
      }
      offset += height + (index === props.items.length - 1 ? 0 : MESSAGE_GAP);
    }

    const totalHeight = offset;
    let topPadding = 0;
    for (let index = 0; index < startIndex; index += 1) {
      const item = props.items[index];
      if (!item) {
        continue;
      }
      topPadding +=
        (messageHeightsRef.current.get(item.id) ?? MESSAGE_ESTIMATED_HEIGHT) +
        MESSAGE_GAP;
    }

    let renderedHeight = 0;
    for (let index = startIndex; index <= endIndex; index += 1) {
      const item = props.items[index];
      if (!item) {
        continue;
      }
      renderedHeight +=
        messageHeightsRef.current.get(item.id) ?? MESSAGE_ESTIMATED_HEIGHT;
      if (index < endIndex) {
        renderedHeight += MESSAGE_GAP;
      }
    }

    return {
      bottomPadding: Math.max(0, totalHeight - topPadding - renderedHeight),
      topPadding,
      totalHeight,
      visibleItems: props.items.slice(startIndex, endIndex + 1)
    };
  }, [heightVersion, props.items, scrollTop, viewportHeight]);

  function scrollToBottom(behavior: ScrollBehavior = "smooth") {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }
    viewport.scrollTo({ top: viewport.scrollHeight, behavior });
    pinnedRef.current = true;
    setShowJumpButton(false);
  }

  const statusLabelText =
    props.resumeState === "resuming"
      ? "正在恢复"
      : props.resumeState === "failed"
        ? "历史预览"
        : props.resumeState === "missing"
          ? "历史预览"
          : props.resumeState === "history"
            ? "历史记录"
            : props.active
              ? "正在运行"
              : props.session.status;

  return (
    <section className="cn-thread-canvas cn-live-thread" ref={viewportRef}>
      <div className="cn-thread-status-strip" ref={statusRef}>
        <span
          className={
            props.active || props.resumeState === "resuming"
              ? "cn-run-status running"
              : "cn-run-status"
          }
        >
          {statusLabelText}
        </span>
        {props.resumeState === "resuming" ? (
          <span className="cn-resume-note">先显示本地历史，后台接入原 thread…</span>
        ) : null}
        {props.resumeState === "failed" ? (
          <span className="cn-resume-note danger">恢复失败，只能查看历史。</span>
        ) : null}
        {props.resumeState === "missing" ? (
          <span className="cn-resume-note">项目目录不存在，只显示历史记录。</span>
        ) : null}
        {props.resumeState === "history" ? (
          <span className="cn-resume-note">发送消息时会接入原 Codex thread。</span>
        ) : null}
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
        <div
          className="cn-message-virtual-list"
          style={{ height: `${virtualState.totalHeight}px` }}
        >
          <div
            className="cn-message-window"
            style={{
              paddingBottom: `${virtualState.bottomPadding}px`,
              transform: `translateY(${virtualState.topPadding}px)`
            }}
          >
            {virtualState.visibleItems.map((item) => (
              <ChatMessageRow
                key={item.id}
                item={item}
                onMeasure={handleMessageMeasure}
              />
            ))}
          </div>
          <div
            ref={props.endRef}
            className="cn-thread-end"
            style={{ transform: `translateY(${virtualState.totalHeight}px)` }}
          />
        </div>
      )}
      {showJumpButton ? (
        <div className="cn-thread-jump-wrap">
          <button
            className="cn-thread-jump"
            type="button"
            onClick={() => scrollToBottom("smooth")}
          >
            回到底部 <strong>↓</strong>
          </button>
        </div>
      ) : null}
    </section>
  );
}

const ChatMessageRow = memo(function ChatMessageRow(props: {
  item: ChatItem;
  onMeasure: (id: string, height: number) => void;
}) {
  const rowRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const node = rowRef.current;
    if (!node) {
      return;
    }
    function measure() {
      if (!node) {
        return;
      }
      props.onMeasure(props.item.id, node.getBoundingClientRect().height);
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [props.item.id, props.item.text, props.onMeasure]);

  return (
    <article
      ref={rowRef}
      className={`cn-message ${messageClass(props.item.role)}`}
    >
      <span className="cn-message-label">{roleLabel(props.item.role)}</span>
      <div className="cn-message-text">{props.item.text}</div>
    </article>
  );
});

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
  onCloseMenu: () => void;
  onDraftChange: (value: string) => void;
  onOpenMenu: (menu: ActiveMenu) => void;
  onRemoveAttachment: (attachment: AttachmentDraft) => void;
  onSelectModel: (value: string) => void;
  onSelectPermission: (value: LocalPermissionMode) => void;
  onSelectReasoning: (value: LocalReasoningEffort) => void;
  onSubmit: () => void;
}) {
  function closeMenuOnMobile() {
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 900px)").matches) {
      props.onCloseMenu();
    }
  }

  function selectReasoning(value: LocalReasoningEffort) {
    props.onSelectReasoning(value);
    closeMenuOnMobile();
  }

  function selectModel(value: string) {
    props.onSelectModel(value);
    closeMenuOnMobile();
  }

  function selectPermission(value: LocalPermissionMode) {
    props.onSelectPermission(value);
    closeMenuOnMobile();
  }

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
          <div className="cn-menu-column">
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
                onClick={() => selectReasoning(option.value)}
              >
                <strong>{option.label}</strong>
                {props.reasoningEffort === option.value ? (
                  <em>
                    <CodexIcon name="check" />
                  </em>
                ) : null}
              </button>
            ))}
          </div>
          <div className="cn-menu-divider" />
          <div className="cn-menu-column">
            <p>模型</p>
            {modelOptions.map((option) => (
              <button
                key={option.value}
                className={
                  props.selectedModel.value === option.value
                    ? "cn-menu-row selected compact"
                    : "cn-menu-row compact"
                }
                type="button"
                onClick={() => selectModel(option.value)}
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
              onClick={() => selectPermission(option.mode)}
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
  devicePresence: Record<string, DevicePresenceState>;
  deviceName: string;
  healthStatus: LocalHealthResponse | null;
  savedDevices: SavedDevice[];
  selectedDeviceId: string | null;
  streamStatus: string;
  token: string;
  onClose: () => void;
  onConnect: (
    connection: AgentConnection,
    deviceName: string,
    deviceId: string | null
  ) => Promise<void>;
  onDeleteDevice: (deviceId: string) => void;
}) {
  const [draft, setDraft] = useState<DeviceDraftState>(() =>
    createActiveDeviceDraft({
      agentUrl: props.agentUrl,
      deviceName: props.deviceName,
      savedDevices: props.savedDevices,
      selectedDeviceId: props.selectedDeviceId,
      token: props.token
    })
  );
  const draftSavedDevice = draft.selectedDeviceId
    ? props.savedDevices.find((device) => device.id === draft.selectedDeviceId) ?? null
    : null;
  const draftPresence = draftSavedDevice
    ? props.devicePresence[draftSavedDevice.id] ?? null
    : null;
  const draftConnected = Boolean(
    draft.selectedDeviceId &&
      props.connected &&
      isSameDeviceEndpoint(
        {
          id: draft.selectedDeviceId,
          name: draft.name,
          agentUrl: draft.agentUrl,
          token: draft.token
        },
        props.agentUrl,
        props.token
      )
  );
  const draftOnline =
    draftConnected || draftPresence?.status === "online";
  const draftStatus = draftConnected
    ? props.streamStatus
    : draftPresence?.status === "online"
      ? "connected"
      : draftPresence?.status ?? "disconnected";
  const draftCodexVersion = draftConnected
    ? props.healthStatus?.codex?.version
    : draftPresence?.codexVersion ?? draftSavedDevice?.codexVersion;
  const draftDisplayName =
    draft.name.trim() || draftSavedDevice?.name || "新设备";

  useEffect(() => {
    if (
      draft.selectedDeviceId &&
      !props.savedDevices.some((device) => device.id === draft.selectedDeviceId)
    ) {
      setDraft(createEmptyDeviceDraft());
    }
  }, [draft.selectedDeviceId, props.savedDevices]);

  return (
    <div className="cn-overlay-panel device cn-live-overlay">
      <div className="cn-sheet-card cn-live-sheet cn-device-sheet">
        <button className="cn-close-button" type="button" onClick={props.onClose}>
          <CodexIcon name="x" />
        </button>
        <h2>连接设备</h2>
        <p>保存多个 Codex Agent endpoint，然后选择其中一台 Mac 或服务器连接。</p>

        <div className="cn-device-manager">
          <section className="cn-device-library" aria-label="已保存设备">
            <div className="cn-device-library-header">
              <strong>设备</strong>
              <button
                className="cn-add-mini-button"
                type="button"
                onClick={() => setDraft(createEmptyDeviceDraft())}
              >
                <CodexIcon name="plus" />
                新增
              </button>
            </div>

            <div className="cn-saved-device-list">
              {props.savedDevices.length === 0 ? (
                <div className="cn-empty-device-list">
                  还没有保存设备。填写右侧信息并连接后会自动保存。
                </div>
              ) : null}
              {props.savedDevices.map((device) => {
                const selected = draft.selectedDeviceId === device.id;
                const presence = props.devicePresence[device.id];
                const online =
                  presence?.status === "online" ||
                  (props.connected &&
                    isSameDeviceEndpoint(device, props.agentUrl, props.token));
                return (
                  <article
                    key={device.id}
                    className={
                      selected
                        ? "cn-saved-device-card selected"
                        : "cn-saved-device-card"
                    }
                  >
                    <button
                      className="cn-saved-device-main"
                      type="button"
                      onClick={() =>
                        setDraft({
                          selectedDeviceId: device.id,
                          name: device.name,
                          agentUrl: device.agentUrl,
                          token: device.token
                        })
                      }
                      title={`${device.name} · ${device.agentUrl}`}
                    >
                      <span className={online ? "online" : ""} />
                      <strong>{device.name}</strong>
                      <small>
                        {shortAgentUrl(device.agentUrl)}
                        {presence?.codexVersion
                          ? ` · ${presence.codexVersion}`
                          : device.codexVersion
                            ? ` · ${device.codexVersion}`
                            : ""}
                      </small>
                    </button>
                    <button
                      className="cn-device-delete-button"
                      type="button"
                      onClick={() => {
                        props.onDeleteDevice(device.id);
                        if (draft.selectedDeviceId === device.id) {
                          setDraft(createEmptyDeviceDraft());
                        }
                      }}
                      aria-label={`删除设备 ${device.name}`}
                    >
                      删除
                    </button>
                  </article>
                );
              })}
            </div>
          </section>

          <section className="cn-device-editor" aria-label="设备连接设置">
            <div
              className={
                draftOnline ? "cn-real-device-row online" : "cn-real-device-row"
              }
            >
              <CodexIcon name="terminal" />
              <span className={draftOnline ? "cn-live-dot" : "cn-live-dot offline"} />
              <div>
                <strong>{draftDisplayName}</strong>
                <small>
                  {statusLabel(draftStatus)} · {draftCodexVersion ?? "codex-cli unknown"}
                </small>
              </div>
            </div>

            <label>
              设备名称
              <input
                value={draft.name}
                onChange={(event) =>
                  setDraft((previous) => ({
                    ...previous,
                    name: event.target.value
                  }))
                }
                placeholder="MacBookAir / Office Mac mini / Build server"
              />
            </label>
            <label>
              Agent URL
              <input
                value={draft.agentUrl}
                onChange={(event) =>
                  setDraft((previous) => ({
                    ...previous,
                    agentUrl: event.target.value,
                    selectedDeviceId: null
                  }))
                }
                placeholder="http://127.0.0.1:17361"
              />
            </label>
            <label>
              Access Token
              <input
                value={draft.token}
                onChange={(event) =>
                  setDraft((previous) => ({
                    ...previous,
                    selectedDeviceId: null,
                    token: event.target.value
                  }))
                }
                placeholder="test-token"
              />
            </label>

            <div className="cn-sheet-actions">
              <button className="cn-soft-button" type="button" onClick={props.onClose}>
                取消
              </button>
              <button
                className="cn-primary-button"
                type="button"
                onClick={() =>
                  void props.onConnect(
                    { agentUrl: draft.agentUrl, token: draft.token },
                    draft.name,
                    draft.selectedDeviceId
                  )
                }
              >
                {draftConnected
                  ? "重新连接"
                  : draft.selectedDeviceId
                    ? "连接此设备"
                    : "保存并连接"}
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function createActiveDeviceDraft(params: {
  agentUrl: string;
  deviceName: string;
  savedDevices: SavedDevice[];
  selectedDeviceId: string | null;
  token: string;
}): DeviceDraftState {
  const selectedDevice = params.selectedDeviceId
    ? params.savedDevices.find((device) => device.id === params.selectedDeviceId) ??
      null
    : null;
  const matchedDevice =
    selectedDevice ??
    findSavedDevice(params.savedDevices, params.agentUrl, params.token);
  if (matchedDevice) {
    return {
      selectedDeviceId: matchedDevice.id,
      name: matchedDevice.name,
      agentUrl: matchedDevice.agentUrl,
      token: matchedDevice.token
    };
  }
  return {
    selectedDeviceId: null,
    name: params.deviceName || defaultDeviceName(params.agentUrl),
    agentUrl: params.agentUrl,
    token: params.token
  };
}

function createEmptyDeviceDraft(): DeviceDraftState {
  return {
    selectedDeviceId: null,
    name: "",
    agentUrl: "http://127.0.0.1:17361",
    token: "test-token"
  };
}

function createDeviceWorkspace(connection: AgentConnection): DeviceWorkspace {
  return {
    chatItems: [],
    codexHistory: [],
    connection,
    currentSessionId: null,
    cwd: "",
    directoryError: null,
    directoryList: null,
    directoryLoading: false,
    events: [],
    healthStatus: null,
    historyLoadingKey: null,
    pendingApprovals: [],
    resumeStates: {},
    selectedHistoryKey: null,
    sessions: [],
    streamStatus: "disconnected"
  };
}

function resolveStateUpdater<T>(previous: T, updater: StateUpdater<T>): T {
  return typeof updater === "function"
    ? (updater as (value: T) => T)(previous)
    : updater;
}

function ingestEventsIntoWorkspace(
  workspace: DeviceWorkspace,
  incoming: LocalEvent[],
  options: { selectSessions: boolean }
): DeviceWorkspace {
  let next = {
    ...workspace,
    events: mergeLocalEvents(workspace.events, incoming)
  };
  for (const event of incoming) {
    next = applyEventToWorkspace(next, event, options);
  }
  return next;
}

function mergeLocalEvents(
  existing: LocalEvent[],
  incoming: LocalEvent[]
): LocalEvent[] {
  const bySeq = new Map(existing.map((event) => [event.seq, event]));
  for (const event of incoming) {
    bySeq.set(event.seq, event);
  }
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq).slice(-500);
}

function applyEventToWorkspace(
  workspace: DeviceWorkspace,
  event: LocalEvent,
  options: { selectSessions: boolean }
): DeviceWorkspace {
  switch (event.type) {
    case "session.created":
    case "session.updated":
      if (!isSessionSummary(event.payload)) {
        return workspace;
      }
      return {
        ...upsertSessionInWorkspace(workspace, event.payload),
        currentSessionId: options.selectSessions
          ? event.payload.sessionId
          : workspace.currentSessionId,
        selectedHistoryKey: options.selectSessions
          ? null
          : workspace.selectedHistoryKey
      };
    case "approval.requested":
      if (!isPendingApproval(event.payload)) {
        return workspace;
      }
      const pendingApproval = event.payload;
      return {
        ...workspace,
        pendingApprovals: [
          ...workspace.pendingApprovals.filter(
            (approval) => approval.approvalId !== pendingApproval.approvalId
          ),
          pendingApproval
        ]
      };
    case "approval.resolved":
      if (!isRecord(event.payload) || typeof event.payload.approvalId !== "string") {
        return workspace;
      }
      const resolvedApprovalId = event.payload.approvalId;
      return {
        ...workspace,
        pendingApprovals: workspace.pendingApprovals.filter(
          (approval) => approval.approvalId !== resolvedApprovalId
        )
      };
    case "chat.user":
      return addChatItemToWorkspace(workspace, {
        id: event.id,
        role: "user",
        text: readText(event.payload),
        ...(event.sessionId ? { sessionId: event.sessionId } : {}),
        ...(event.turnId ? { turnId: event.turnId } : {})
      });
    case "chat.assistant.delta":
      return appendStreamingItemToWorkspace(
        workspace,
        "assistant",
        event.sessionId,
        event.turnId,
        readText(event.payload),
        event.id
      );
    case "command.output.delta":
      return appendStreamingItemToWorkspace(
        workspace,
        "command",
        event.sessionId,
        event.turnId,
        readText(event.payload),
        event.id
      );
    case "diff.updated":
      return addChatItemToWorkspace(workspace, {
        id: event.id,
        role: "diff",
        text: readDiff(event.payload),
        ...(event.sessionId ? { sessionId: event.sessionId } : {}),
        ...(event.turnId ? { turnId: event.turnId } : {})
      });
    case "plan.updated":
      return addChatItemToWorkspace(workspace, {
        id: event.id,
        role: "system",
        text: readPlan(event.payload),
        ...(event.sessionId ? { sessionId: event.sessionId } : {}),
        ...(event.turnId ? { turnId: event.turnId } : {})
      });
    case "turn.completed":
      return addChatItemToWorkspace(workspace, {
        id: event.id,
        role: "system",
        text: `Turn completed: ${readTurnStatus(event.payload)}`,
        ...(event.sessionId ? { sessionId: event.sessionId } : {}),
        ...(event.turnId ? { turnId: event.turnId } : {})
      });
    default:
      return workspace;
  }
}

function upsertSessionInWorkspace(
  workspace: DeviceWorkspace,
  session: LocalSessionSummary
): DeviceWorkspace {
  return {
    ...workspace,
    sessions: [
      session,
      ...workspace.sessions.filter((item) => item.sessionId !== session.sessionId)
    ]
  };
}

function addChatItemToWorkspace(
  workspace: DeviceWorkspace,
  item: ChatItem
): DeviceWorkspace {
  return {
    ...workspace,
    chatItems: [...workspace.chatItems, item].slice(-500)
  };
}

function appendStreamingItemToWorkspace(
  workspace: DeviceWorkspace,
  role: "assistant" | "command",
  sessionId: string | undefined,
  turnId: string | undefined,
  text: string,
  fallbackId: string
): DeviceWorkspace {
  if (!text) {
    return workspace;
  }
  const last = workspace.chatItems.at(-1);
  if (last?.role === role && last.turnId === turnId && last.sessionId === sessionId) {
    return {
      ...workspace,
      chatItems: [
        ...workspace.chatItems.slice(0, -1),
        { ...last, text: `${last.text}${text}` }
      ]
    };
  }
  return addChatItemToWorkspace(workspace, {
    id: fallbackId,
    role,
    text,
    ...(sessionId ? { sessionId } : {}),
    ...(turnId ? { turnId } : {})
  });
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
  const visibleEvents = props.events.filter(
    (event) => event.type !== "codex.notification"
  );
  const lastSeq = props.events.at(-1)?.seq;

  return (
    <div className="cn-overlay-panel cn-live-overlay right">
      <section className="cn-events-sheet">
        <button className="cn-close-button" type="button" onClick={props.onClose}>
          <CodexIcon name="x" />
        </button>
        <h2>活动</h2>
        <p className="cn-events-meta">
          显示最近 {Math.min(visibleEvents.length, 120)} 条活动 · 原始事件{" "}
          {props.events.length} 条{lastSeq ? ` · 最新 #${lastSeq}` : ""}
        </p>
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
          {visibleEvents
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

function groupProjectThreads(
  sessions: LocalSessionSummary[],
  entries: LocalCodexHistoryEntry[]
): ProjectThreadGroupData[] {
  const groups = new Map<string, ProjectThreadGroupData>();
  for (const session of sessions) {
    if (isHistoryPreviewSessionId(session.sessionId)) {
      continue;
    }
    const existing = groups.get(session.cwd);
    if (existing) {
      existing.sessions.push(session);
      existing.updatedAt = Math.max(existing.updatedAt, session.updatedAt);
    } else {
      groups.set(session.cwd, {
        cwd: session.cwd,
        name: shortPath(session.cwd),
        updatedAt: session.updatedAt,
        sessions: [session],
        entries: []
      });
    }
  }

  const seen = new Set<string>();
  for (const entry of entries.filter(isVisibleCodexHistoryEntry)) {
    const uniqueKey = codexHistoryKey(entry);
    if (seen.has(uniqueKey)) {
      continue;
    }
    seen.add(uniqueKey);
    const existing = groups.get(entry.cwd);
    const updatedAt = Date.parse(entry.updatedAt) || 0;
    if (existing) {
      existing.entries.push(entry);
      existing.updatedAt = Math.max(existing.updatedAt, updatedAt);
    } else {
      groups.set(entry.cwd, {
        cwd: entry.cwd,
        name: shortPath(entry.cwd),
        updatedAt,
        sessions: [],
        entries: [entry]
      });
    }
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      sessions: group.sessions.sort((a, b) => b.updatedAt - a.updatedAt),
      entries: group.entries.sort(
        (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
      )
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

function codexHistoryKey(entry: LocalCodexHistoryEntry): string {
  return `${entry.id}::${entry.cwd}`;
}

function isVisibleCodexHistoryEntry(entry: LocalCodexHistoryEntry): boolean {
  const cwdName = shortPath(entry.cwd);
  return !(
    entry.cwd.startsWith("/tmp/codex-goal-probe-") ||
    cwdName.startsWith("codex-goal-probe-") ||
    isAutomationPromptHistoryTitle(entry.title)
  );
}

function isAutomationPromptHistoryTitle(title: string): boolean {
  const trimmed = title.trim();
  return (
    trimmed.startsWith("# Codex Native API Loop Prompt") ||
    trimmed.startsWith("# Codex Gateway Loop Prompt") ||
    trimmed.startsWith("# CodexBridge Loop Prompt") ||
    trimmed.startsWith("你正在执行 CodexBridge 后台 Agent 任务")
  );
}

function isPreviewOnlyHistoryEntry(entry: LocalCodexHistoryEntry): boolean {
  return entry.cwdExists === false;
}

function isMissingHistoryCwdError(error: unknown): boolean {
  return formatError(error).includes("cwd does not exist:");
}

function historyPreviewSessionId(entry: LocalCodexHistoryEntry): string {
  return `history-preview:${codexHistoryKey(entry)}`;
}

function isHistoryPreviewSessionId(sessionId: string): boolean {
  return sessionId.startsWith("history-preview:");
}

function makeHistoryPreviewSession(
  entry: LocalCodexHistoryEntry
): LocalSessionSummary {
  const updatedAt = Date.parse(entry.updatedAt);
  const createdAt = Date.parse(entry.createdAt);
  return {
    sessionId: historyPreviewSessionId(entry),
    threadId: entry.id,
    status: "idle",
    cwd: entry.cwd,
    model: null,
    reasoningEffort: null,
    permissionMode: "request-approval",
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    sandbox: "workspace-write",
    goal: null,
    createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now()
  };
}

function buildChatTailSignature(item: ChatItem | undefined): string {
  if (!item) {
    return "";
  }
  return `${item.id}:${item.text.length}:${item.text.slice(-24)}`;
}

function historyMessageToChatItem(
  sessionId: string,
  message: LocalCodexHistoryDetailResponse["messages"][number]
): ChatItem {
  return {
    id: `history-${sessionId}-${message.id}`,
    role: message.role,
    text: message.text,
    sessionId
  };
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

function historySubtitle(entry: LocalCodexHistoryEntry): string {
  return `${shortPath(entry.cwd)} · Codex history · ${formatRelativeTime(entry.updatedAt)}`;
}

function historyTime(entry: LocalCodexHistoryEntry): string {
  return formatRelativeTime(entry.updatedAt);
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

function readSavedDevices(): SavedDevice[] {
  try {
    const raw = window.localStorage.getItem(savedDevicesStorageKey);
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter(isSavedDevice)
      .map((device) => ({
        ...device,
        agentUrl: normalizeAgentUrl(device.agentUrl)
      }));
  } catch {
    return [];
  }
}

function isSavedDevice(value: unknown): value is SavedDevice {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.agentUrl === "string" &&
    typeof value.token === "string"
  );
}

function findSavedDevice(
  devices: SavedDevice[],
  agentUrl: string,
  token: string
): SavedDevice | null {
  const normalizedAgentUrl = normalizeAgentUrl(agentUrl);
  return (
    devices.find((device) =>
      isSameDeviceEndpoint(device, normalizedAgentUrl, token)
    ) ?? null
  );
}

function isSameDeviceEndpoint(
  device: SavedDevice,
  agentUrl: string,
  token: string
): boolean {
  return normalizeAgentUrl(device.agentUrl) === normalizeAgentUrl(agentUrl) &&
    device.token === token;
}

function isSameAgentConnection(
  left: AgentConnection,
  right: AgentConnection
): boolean {
  return normalizeAgentUrl(left.agentUrl) === normalizeAgentUrl(right.agentUrl) &&
    left.token === right.token;
}

function normalizeAgentUrl(agentUrl: string): string {
  const trimmed = agentUrl.trim();
  try {
    const url = new URL(trimmed);
    url.pathname = url.pathname.replace(/\/+$/, "");
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return trimmed.replace(/\/+$/, "");
  }
}

function createSavedDeviceId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `device_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

function shortAgentUrl(agentUrl: string): string {
  try {
    const url = new URL(agentUrl);
    return `${url.hostname}:${url.port || (url.protocol === "https:" ? "443" : "80")}`;
  } catch {
    return agentUrl;
  }
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

function formatRelativeTime(input: string): string {
  const timestamp = Date.parse(input);
  if (!Number.isFinite(timestamp)) {
    return "Codex history";
  }
  const diffMs = Date.now() - timestamp;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diffMs < minute) {
    return "刚刚";
  }
  if (diffMs < hour) {
    return `${Math.max(1, Math.floor(diffMs / minute))} 分`;
  }
  if (diffMs < day) {
    return `${Math.max(1, Math.floor(diffMs / hour))} 小时`;
  }
  if (diffMs < 14 * day) {
    return `${Math.max(1, Math.floor(diffMs / day))} 天`;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric"
  }).format(timestamp);
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

function formatConnectionError(error: unknown, agentUrl: string): string {
  const message = formatError(error);
  const pageOrigin =
    typeof window === "undefined" ? "current Web page" : window.location.origin;
  let agentHost = "";
  try {
    agentHost = new URL(agentUrl).host;
  } catch {
    agentHost = agentUrl;
  }
  if (
    message.includes("Unexpected Origin") ||
    message.includes("Failed to fetch") ||
    message.includes("NetworkError")
  ) {
    return `连接 ${agentHost} 失败：远端 Agent 可能没有允许当前页面 ${pageOrigin}。请把这个 origin 加到 codexnext serve --web-origin，或打开远端 Agent 对应的 Web 页面。`;
  }
  return message;
}
