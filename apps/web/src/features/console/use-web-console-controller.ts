"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import type { LocalReasoningEffort, ThreadGoal } from "@codexnext/protocol";
import {
  agentFetch,
  createSession,
  getCodexHistoryDetail,
  health,
  interruptSessionTurn,
  listCodexHistory,
  listDirectories,
  listRelayDevices,
  listSessions,
  replayEvents,
  resolveApproval,
  resumeCodexHistory,
  sendSessionMessage,
  type AgentConnection
} from "../../lib/api";
import { openManagedEventStream, type ManagedEventStream } from "../../lib/event-stream";
import { formatConnectionError, formatError } from "../../lib/format/text";
import {
  legacyRelayOwnerTokenStorageKey,
  relayAccessTokenStorageKey,
  requestRelaySession,
  resolveDefaultRelayUrl
} from "../../lib/relay";
import type {
  ChatItem,
  LocalApprovalDecision,
  LocalCodexHistoryDetailResponse,
  LocalCodexHistoryEntry,
  LocalEvent,
  LocalHealthResponse,
  LocalPermissionMode,
  LocalSessionSummary,
  PendingApprovalView
} from "../../lib/types";
import {
  addOptimisticUserMessage,
  createDeviceWorkspace,
  hydrateSessionFromHistory,
  ingestEventsIntoWorkspace,
  markOptimisticMessageFailed,
  markOptimisticMessageSent,
  reassignSessionChatItems,
  rememberSessionHistoryOrigin,
  resolveStateUpdater,
  type AttachmentDraft,
  type DeviceWorkspace,
  type ResumeState,
  upsertSessionInWorkspace
} from "../chat/chat-state";
import {
  createSavedDeviceId,
  connectionFromSavedDevice,
  defaultDeviceName,
  deviceNameStorageKey,
  findSavedDevice,
  isSameDeviceEndpoint,
  isSameAgentConnection,
  normalizeAgentUrl,
  readSavedDevices,
  readSidebarWidth,
  savedDevicesStorageKey,
  savedDeviceAddressLabel,
  sidebarWidthStorageKey,
  shortAgentUrl,
  type DevicePresenceState,
  type SavedDevice
} from "../devices/device-utils";
import {
  codexHistoryKey,
  getProjectSidebarPrefs,
  getThreadSidebarPrefs,
  groupProjectThreads,
  historyPreviewSessionId,
  historySubtitle,
  isHistoryPreviewSessionId,
  isPendingSessionId,
  isPreviewOnlyHistoryEntry,
  makeHistoryPreviewSession,
  makePendingSession,
  pendingSessionId,
  projectSidebarPrefsStorageKey,
  readThreadSidebarPrefs,
  readProjectSidebarPrefs,
  sanitizeProjectSidebarPrefs,
  sanitizeThreadSidebarPrefs,
  sessionSubtitle,
  sessionTitle,
  shortPath,
  threadPrefsScope,
  threadSidebarPrefsStorageKey,
  type ProjectSidebarPrefs,
  type ProjectThreadGroupData,
  type ThreadListItem,
  type ThreadSidebarPrefs
} from "../sessions/session-utils";
import type { CodexIconName } from "../../components/DesignLab";

export type ActiveSheet = "device" | "session" | "goal" | "summary" | null;
export type ActiveMenu = "plus" | "model" | "permission" | null;

export interface ThreadHoverPreview {
  left: number;
  maxWidth: number;
  title: string;
  top: number;
}

export const modelOptions = [
  { label: "GPT-5.5", shortLabel: "5.5", value: "gpt-5.5" },
  { label: "GPT-5.4", shortLabel: "5.4", value: "gpt-5.4" },
  { label: "GPT-5.4 Mini", shortLabel: "5.4 mini", value: "gpt-5.4-mini" },
  { label: "GPT-5.3 Codex Spark", shortLabel: "5.3 spark", value: "gpt-5.3-codex-spark" }
];

export const reasoningOptions: Array<{ label: string; value: LocalReasoningEffort }> = [
  { label: "低", value: "low" },
  { label: "中", value: "medium" },
  { label: "高", value: "high" },
  { label: "超高", value: "xhigh" }
];

export const permissionOptions: Array<{
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

const DEFAULT_SIDEBAR_WIDTH = 292;
const MIN_SIDEBAR_WIDTH = 272;
const MAX_SIDEBAR_WIDTH = 620;
const RELAY_CONFIGURED = Boolean(process.env.NEXT_PUBLIC_CODEXNEXT_RELAY_URL);

interface RelayBootstrapConfig {
  accessToken: string;
  relayUrl: string;
}

export function useWebConsoleController() {
  const [agentUrl, setAgentUrl] = useState("http://127.0.0.1:17361");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [autoConnect, setAutoConnect] = useState<AgentConnection | null>(null);
  const [savedDevices, setSavedDevices] = useState<SavedDevice[]>([]);
  const [threadSidebarPrefs, setThreadSidebarPrefs] = useState<Record<string, ThreadSidebarPrefs>>({});
  const [projectSidebarPrefs, setProjectSidebarPrefs] = useState<Record<string, ProjectSidebarPrefs>>({});
  const [devicePresence, setDevicePresence] = useState<Record<string, DevicePresenceState>>({});
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [deviceName, setDeviceName] = useState("");
  const [relayBootstrap, setRelayBootstrap] = useState<RelayBootstrapConfig | null>(null);
  const [activeSheet, setActiveSheet] = useState<ActiveSheet>(null);
  const [activeMenu, setActiveMenu] = useState<ActiveMenu>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [sidebarResizing, setSidebarResizing] = useState(false);
  const [threadHoverPreview, setThreadHoverPreview] = useState<ThreadHoverPreview | null>(null);
  const [deviceWorkspaces, setDeviceWorkspaces] = useState<Record<string, DeviceWorkspace>>({});
  const [model, setModel] = useState("gpt-5.5");
  const [reasoningEffort, setReasoningEffort] = useState<LocalReasoningEffort>("xhigh");
  const [permissionMode, setPermissionMode] = useState<LocalPermissionMode>("request-approval");
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<AttachmentDraft[]>([]);
  const [planModeEnabled, setPlanModeEnabled] = useState(false);
  const [goalComposerMode, setGoalComposerMode] = useState(false);
  const [initialGoal, setInitialGoal] = useState("");
  const [initialTokenBudget, setInitialTokenBudget] = useState("");
  const [goalObjective, setGoalObjective] = useState("");
  const [goalTokenBudget, setGoalTokenBudget] = useState("");

  const streamRefs = useRef(new Map<string, ManagedEventStream>());
  const pendingDeviceStreamIds = useRef(new Set<string>());
  const selectedDeviceIdRef = useRef<string | null>(null);
  const eventFrameRefs = useRef(new Map<string, number>());
  const queuedEventsRef = useRef(new Map<string, LocalEvent[]>());
  const queuedSelectRef = useRef(new Map<string, boolean>());
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const historyDetailCacheRef = useRef(new Map<string, LocalCodexHistoryDetailResponse>());
  const pendingHistoryHydrationsRef = useRef(new Set<string>());
  const desktopFrameRef = useRef<HTMLDivElement | null>(null);
  const sessionSidebarRef = useRef<HTMLElement | null>(null);
  const sidebarResizeCleanupRef = useRef<(() => void) | null>(null);
  const previousSessionIdRef = useRef<string | null | undefined>(undefined);

  const activeWorkspace = selectedDeviceId ? deviceWorkspaces[selectedDeviceId] ?? null : null;
  const selectedSavedDevice =
    selectedDeviceId
      ? savedDevices.find((device) => device.id === selectedDeviceId) ?? null
      : null;
  const connection: AgentConnection =
    activeWorkspace?.connection ??
    (selectedSavedDevice
      ? connectionFromSavedDevice(selectedSavedDevice)
      : { mode: "direct", agentUrl, token });
  const healthStatus = activeWorkspace?.healthStatus ?? null;
  const streamStatus = activeWorkspace?.streamStatus ?? "disconnected";
  const events = activeWorkspace?.events ?? [];
  const sessions = activeWorkspace?.sessions ?? [];
  const codexHistory = activeWorkspace?.codexHistory ?? [];
  const currentSessionId = activeWorkspace?.currentSessionId ?? null;
  const selectedHistoryKey = activeWorkspace?.selectedHistoryKey ?? null;
  const sessionHistoryOrigins = activeWorkspace?.sessionHistoryOrigins ?? {};
  const pendingApprovals = activeWorkspace?.pendingApprovals ?? [];
  const chatItems = activeWorkspace?.chatItems ?? [];
  const cwd = activeWorkspace?.cwd ?? "";
  const directoryList = activeWorkspace?.directoryList ?? null;
  const directoryError = activeWorkspace?.directoryError ?? null;
  const directoryLoading = activeWorkspace?.directoryLoading ?? false;
  const resumeStates = activeWorkspace?.resumeStates ?? {};
  const historyLoadingKey = activeWorkspace?.historyLoadingKey ?? null;
  const currentSession = currentSessionId
    ? sessions.find((session) => session.sessionId === currentSessionId) ?? null
    : null;
  const visibleChatItems = currentSession
    ? chatItems.filter((item) => item.sessionId === currentSession.sessionId)
    : [];
  const currentResumeState = currentSession ? resumeStates[currentSession.sessionId] ?? null : null;
  const selectedHistoryEntry = selectedHistoryKey
    ? codexHistory.find((entry) => codexHistoryKey(entry) === selectedHistoryKey) ?? null
    : null;
  const connected = Boolean(
    healthStatus?.ok &&
      streamStatus !== "disconnected" &&
      streamStatus !== "error"
  );
  const activeTurn = Boolean(currentSession?.activeTurnId);
  const currentGoal = currentSession?.goal ?? null;
  const hasCurrentGoal = Boolean(currentGoal?.objective?.trim());
  const selectedModel = modelOptions.find((option) => option.value === model) ?? modelOptions[0]!;
  const selectedReasoning =
    reasoningOptions.find((option) => option.value === reasoningEffort) ?? reasoningOptions[3]!;
  const selectedPermission =
    permissionOptions.find((option) => option.mode === permissionMode) ?? permissionOptions[0]!;
  const activeThreadPrefs = getThreadSidebarPrefs(threadSidebarPrefs, agentUrl);
  const activeProjectPrefs = getProjectSidebarPrefs(projectSidebarPrefs, agentUrl);
  const relayEnabled =
    RELAY_CONFIGURED ||
    Boolean(relayBootstrap) ||
    connection.mode === "relay" ||
    savedDevices.some((device) => device.mode === "relay");
  const relayConnectionInfo = relayBootstrap
    ? {
        accessToken: relayBootstrap.accessToken,
        relayUrl: relayBootstrap.relayUrl
      }
    : connection.mode === "relay"
      ? {
          accessToken: connection.ownerToken,
          relayUrl: connection.relayUrl
        }
      : null;
  const desktopFrameStyle = useMemo(
    () => ({ "--cn-sidebar-width": `${clampSidebarWidth(sidebarWidth)}px` }) as CSSProperties,
    [sidebarWidth]
  );
  const deviceDisplayName =
    deviceName ||
    healthStatus?.device?.defaultName ||
    (relayEnabled && !selectedSavedDevice ? "CodexNext relay" : defaultDeviceName(agentUrl));
  const projectGroups = groupProjectThreads(
    sessions,
    codexHistory,
    chatItems,
    activeThreadPrefs,
    activeProjectPrefs,
    currentSessionId,
    selectedHistoryKey
  );
  const firstApproval = pendingApprovals[0] ?? null;

  const patchDeviceWorkspace = useCallback(
    (deviceId: string, updater: (workspace: DeviceWorkspace) => DeviceWorkspace) => {
      setDeviceWorkspaces((previous) => {
        const device = savedDevices.find((item) => item.id === deviceId);
        const current =
          previous[deviceId] ??
          createDeviceWorkspace(
            device
              ? connectionFromSavedDevice(device)
              : { mode: "direct", agentUrl, token }
          );
        return {
          ...previous,
          [deviceId]: updater(current)
        };
      });
    },
    [agentUrl, savedDevices, token]
  );

  const patchActiveWorkspace = useCallback(
    (updater: (workspace: DeviceWorkspace) => DeviceWorkspace) => {
      if (!selectedDeviceIdRef.current) {
        return;
      }
      patchDeviceWorkspace(selectedDeviceIdRef.current, updater);
    },
    [patchDeviceWorkspace]
  );

  const ensureSessionHistoryHydrated = useCallback(
    async (sessionId: string) => {
      const deviceId = selectedDeviceIdRef.current;
      if (!deviceId) {
        return;
      }
      const workspace = deviceWorkspaces[deviceId];
      if (!workspace) {
        return;
      }
      const session = workspace.sessions.find((item) => item.sessionId === sessionId) ?? null;
      if (!session) {
        return;
      }
      const historyThreadId = workspace.sessionHistoryOrigins[sessionId];
      if (!historyThreadId) {
        return;
      }
      const alreadyHydrated = workspace.chatItems.some(
        (item) =>
          item.sessionId === sessionId &&
          item.id.startsWith(`history-${sessionId}-`)
      );
      if (alreadyHydrated) {
        return;
      }

      const hydrationKey = `${deviceId}:${sessionId}`;
      if (pendingHistoryHydrationsRef.current.has(hydrationKey)) {
        return;
      }
      pendingHistoryHydrationsRef.current.add(hydrationKey);

      try {
        const entry =
          workspace.codexHistory.find(
            (item) => item.id === historyThreadId && item.cwd === session.cwd
          ) ??
          workspace.codexHistory.find((item) => item.id === historyThreadId) ??
          null;
        const cacheKey = entry ? codexHistoryKey(entry) : `${historyThreadId}::${session.cwd}`;
        const detail =
          historyDetailCacheRef.current.get(cacheKey) ??
          (await getCodexHistoryDetail(workspace.connection, {
            id: historyThreadId,
            cwd: entry?.cwd ?? session.cwd
          }));
        historyDetailCacheRef.current.set(cacheKey, detail);
        patchDeviceWorkspace(deviceId, (currentWorkspace) => {
          const hasHistory = currentWorkspace.chatItems.some(
            (item) =>
              item.sessionId === sessionId &&
              item.id.startsWith(`history-${sessionId}-`)
          );
          if (hasHistory) {
            return currentWorkspace;
          }
          return hydrateSessionFromHistory(currentWorkspace, sessionId, detail.messages);
        });
      } catch {
        return;
      } finally {
        pendingHistoryHydrationsRef.current.delete(hydrationKey);
      }
    },
    [deviceWorkspaces, patchDeviceWorkspace]
  );

  useEffect(() => {
    selectedDeviceIdRef.current = selectedDeviceId;
  }, [selectedDeviceId]);

  useEffect(() => {
    if (!currentSessionId || !sessionHistoryOrigins[currentSessionId]) {
      return;
    }
    void ensureSessionHistoryHydrated(currentSessionId);
  }, [currentSessionId, ensureSessionHistoryHydrated, sessionHistoryOrigins]);

  useEffect(() => {
    const storedDevices = readSavedDevices();
    const storedSidebarWidth = readSidebarWidth(clampSidebarWidth);
    const storedThreadPrefs = readThreadSidebarPrefs();
    const storedProjectPrefs = readProjectSidebarPrefs();
    setSavedDevices(storedDevices);
    if (storedSidebarWidth !== null) {
      setSidebarWidth(storedSidebarWidth);
    }
    setThreadSidebarPrefs(storedThreadPrefs);
    setProjectSidebarPrefs(storedProjectPrefs);
    setDeviceWorkspaces((previous) => {
      const next = { ...previous };
      for (const device of storedDevices) {
        next[device.id] =
          next[device.id] ??
          createDeviceWorkspace(connectionFromSavedDevice(device));
      }
      return next;
    });

    const params = new URLSearchParams(window.location.search);
    const queryAgent = params.get("agent");
    const queryToken = params.get("token");
    const queryRelay = params.get("relay");
    const queryOwnerToken = params.get("ownerToken");
    const queryDeviceId = params.get("deviceId");
    const storedOwnerToken =
      window.localStorage.getItem(relayAccessTokenStorageKey) ??
      window.localStorage.getItem(legacyRelayOwnerTokenStorageKey);
    const querySessionToken = params.get("sessionToken");
    if (queryAgent) {
      setAgentUrl(queryAgent);
    }
    if (queryToken) {
      setToken(queryToken);
    }
    if (queryAgent) {
      const matchedDevice = findSavedDevice(storedDevices, queryAgent, queryToken ?? "");
      if (matchedDevice) {
        setSelectedDeviceId(matchedDevice.id);
        setDeviceName(matchedDevice.name);
      } else {
        setDeviceName(
          window.localStorage.getItem(deviceNameStorageKey(queryAgent)) ??
            defaultDeviceName(queryAgent)
        );
      }
    } else {
      const preferredDevice = [...storedDevices].sort(
        (a, b) => (b.lastConnectedAt ?? 0) - (a.lastConnectedAt ?? 0)
      )[0];
      if (preferredDevice) {
        setSelectedDeviceId(preferredDevice.id);
        if (preferredDevice.mode === "direct") {
          setAgentUrl(preferredDevice.agentUrl);
          setToken(preferredDevice.token);
        }
        setDeviceName(preferredDevice.name);
      }
    }
    if (queryAgent && queryToken) {
      setAutoConnect({ mode: "direct", agentUrl: queryAgent, token: queryToken });
    }

    const bootstrapAccessToken =
      querySessionToken || queryOwnerToken || storedOwnerToken || "";
    const hasExplicitBootstrapToken = Boolean(
      querySessionToken || queryOwnerToken
    );
    const bootstrapRelayUrl =
      queryRelay || (!queryAgent ? resolveDefaultRelayUrl() : "");
    if (bootstrapAccessToken && bootstrapRelayUrl) {
      window.localStorage.setItem(relayAccessTokenStorageKey, bootstrapAccessToken);
      setRelayBootstrap({
        accessToken: bootstrapAccessToken,
        relayUrl: normalizeAgentUrl(bootstrapRelayUrl)
      });
      if (queryDeviceId) {
        setSelectedDeviceId(queryDeviceId);
      }
      if (hasExplicitBootstrapToken) {
        return;
      }
      void requestRelaySession()
        .then((session) => {
          if (!session) {
            return;
          }
          window.localStorage.setItem(
            relayAccessTokenStorageKey,
            session.sessionToken
          );
          setRelayBootstrap({
            accessToken: session.sessionToken,
            relayUrl: normalizeAgentUrl(session.relayUrl)
          });
        })
        .catch(() => {
          return;
        });
      return;
    }

    if (!bootstrapRelayUrl) {
      return;
    }

    void requestRelaySession()
      .then((session) => {
        if (!session) {
          return;
        }
        window.localStorage.setItem(
          relayAccessTokenStorageKey,
          session.sessionToken
        );
        setRelayBootstrap({
          accessToken: session.sessionToken,
          relayUrl: normalizeAgentUrl(session.relayUrl)
        });
        if (queryDeviceId) {
          setSelectedDeviceId(queryDeviceId);
        }
      })
      .catch((sessionError) => {
        setError(formatError(sessionError));
      });
  }, []);

  useEffect(() => {
    if (!autoConnect) {
      return;
    }
    setAutoConnect(null);
    const label = autoConnect.mode === "direct" ? autoConnect.agentUrl : autoConnect.relayUrl;
    void connect(autoConnect).catch((err) => setError(formatConnectionError(err, label)));
  }, [autoConnect]);

  const refreshRelayDevices = useCallback(async () => {
    if (!relayBootstrap) {
      return [] as SavedDevice[];
    }
    const devices = await listRelayDevices(
      relayBootstrap.relayUrl,
      relayBootstrap.accessToken
    );
    const relaySavedDevices = devices.map((device) => ({
      id: device.deviceId,
      name: device.deviceName,
      mode: "relay" as const,
      relayUrl: relayBootstrap.relayUrl,
      ownerToken: relayBootstrap.accessToken,
      deviceId: device.deviceId,
      hostname: device.hostname,
      online: device.online,
      codexVersion: device.codexVersion ?? null,
      lastConnectedAt: device.lastSeenAt
    }));

    const directDevices = readSavedDevices().filter((device) => device.mode === "direct");
    persistDevices([...relaySavedDevices, ...directDevices]);
    setDeviceWorkspaces((previous) => {
      const next = { ...previous };
      for (const device of relaySavedDevices) {
        next[device.id] =
          next[device.id] ?? createDeviceWorkspace(connectionFromSavedDevice(device));
      }
      return next;
    });
    if (!selectedDeviceIdRef.current) {
      const preferred = relaySavedDevices.find((device) => device.online) ?? relaySavedDevices[0];
      if (preferred) {
        setSelectedDeviceId(preferred.id);
        setDeviceName(preferred.name);
      }
    }
    return relaySavedDevices;
  }, [relayBootstrap]);

  useEffect(() => {
    if (!relayBootstrap) {
      return;
    }
    let cancelled = false;

    const syncRelayDevices = async () => {
      try {
        await refreshRelayDevices();
      } catch (error) {
        if (!cancelled) {
          setError(formatError(error));
        }
      }
    };

    void syncRelayDevices();
    const interval = window.setInterval(() => void syncRelayDevices(), 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [refreshRelayDevices, relayBootstrap]);

  useEffect(() => {
    if (currentSession?.goal?.objective) {
      setGoalObjective(currentSession.goal.objective);
      setGoalTokenBudget(currentSession.goal.tokenBudget ? String(currentSession.goal.tokenBudget) : "");
      return;
    }
    setGoalObjective("");
    setGoalTokenBudget("");
  }, [currentSession?.goal]);

  useEffect(() => {
    if (
      previousSessionIdRef.current !== undefined &&
      previousSessionIdRef.current !== currentSessionId
    ) {
      setGoalComposerMode(false);
    }
    previousSessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  useEffect(() => {
    const selectedDevice = savedDevices.find((device) => device.id === selectedDeviceId);
    if (selectedDevice && isSameAgentConnection(connectionFromSavedDevice(selectedDevice), connection)) {
      setDeviceName(selectedDevice.name);
      return;
    }
    const matchingDevice = findSavedDevice(savedDevices, connection);
    if (matchingDevice) {
      setSelectedDeviceId(matchingDevice.id);
      setDeviceName(matchingDevice.name);
      return;
    }
    setDeviceName(window.localStorage.getItem(deviceNameStorageKey(agentUrl)) ?? "");
  }, [agentUrl, savedDevices, selectedDeviceId, token]);

  useEffect(() => {
    if (!sidebarCollapsed && !sidebarResizing) {
      return;
    }
    setThreadHoverPreview(null);
  }, [sidebarCollapsed, sidebarResizing]);

  useEffect(
    () => () => {
      sidebarResizeCleanupRef.current?.();
      for (const frame of eventFrameRefs.current.values()) {
        cancelAnimationFrame(frame);
      }
      for (const stream of streamRefs.current.values()) {
        stream.close();
      }
      eventFrameRefs.current.clear();
      streamRefs.current.clear();
    },
    []
  );

  useEffect(() => {
    if (savedDevices.length === 0) {
      setDevicePresence({});
      return;
    }
    let cancelled = false;
    const savedDeviceIds = new Set(savedDevices.map((device) => device.id));

    const refreshPresence = async () => {
      setDevicePresence((previous) => {
        const next: Record<string, DevicePresenceState> = {};
        for (const device of savedDevices) {
          next[device.id] = previous[device.id] ?? {
            checkedAt: Date.now(),
            codexVersion: device.codexVersion ?? null,
            status: "checking"
          };
        }
        return next;
      });

      const results = await Promise.all(
        savedDevices.map(async (device) => {
          try {
            const status = await health(connectionFromSavedDevice(device));
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
            closeDeviceStream(device.id);
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
  }, [savedDevices, patchDeviceWorkspace]);

  function persistDevices(nextDevices: SavedDevice[]) {
    const sortedDevices = [...nextDevices].sort(
      (a, b) => (b.lastConnectedAt ?? 0) - (a.lastConnectedAt ?? 0)
    );
    setSavedDevices(sortedDevices);
    window.localStorage.setItem(savedDevicesStorageKey, JSON.stringify(sortedDevices));
  }

  function persistThreadSidebarPrefs(
    updater: Record<string, ThreadSidebarPrefs> | ((previous: Record<string, ThreadSidebarPrefs>) => Record<string, ThreadSidebarPrefs>)
  ) {
    setThreadSidebarPrefs((previous) => {
      const next = resolveStateUpdater(previous, updater);
      window.localStorage.setItem(threadSidebarPrefsStorageKey, JSON.stringify(next));
      return next;
    });
  }

  function persistProjectSidebarPrefs(
    updater:
      | Record<string, ProjectSidebarPrefs>
      | ((previous: Record<string, ProjectSidebarPrefs>) => Record<string, ProjectSidebarPrefs>)
  ) {
    setProjectSidebarPrefs((previous) => {
      const next = resolveStateUpdater(previous, updater);
      window.localStorage.setItem(projectSidebarPrefsStorageKey, JSON.stringify(next));
      return next;
    });
  }

  function updateThreadSidebarPrefs(
    scopeAgentUrl: string,
    updater: (prefs: ThreadSidebarPrefs) => ThreadSidebarPrefs
  ) {
    const scope = threadPrefsScope(scopeAgentUrl);
    persistThreadSidebarPrefs((previous) => ({
      ...previous,
      [scope]: sanitizeThreadSidebarPrefs(updater(getThreadSidebarPrefs(previous, scopeAgentUrl)))
    }));
  }

  function updateProjectSidebarPrefs(
    scopeAgentUrl: string,
    updater: (prefs: ProjectSidebarPrefs) => ProjectSidebarPrefs
  ) {
    const scope = threadPrefsScope(scopeAgentUrl);
    persistProjectSidebarPrefs((previous) => ({
      ...previous,
      [scope]: sanitizeProjectSidebarPrefs(updater(getProjectSidebarPrefs(previous, scopeAgentUrl)))
    }));
  }

  function togglePinnedThread(threadId: string) {
    updateThreadSidebarPrefs(agentUrl, (prefs) => ({
      ...prefs,
      pinned: prefs.pinned.includes(threadId)
        ? prefs.pinned.filter((value) => value !== threadId)
        : [threadId, ...prefs.pinned.filter((value) => value !== threadId)]
    }));
  }

  function archiveThread(item: ThreadListItem) {
    updateThreadSidebarPrefs(agentUrl, (prefs) => ({
      pinned: prefs.pinned.filter((value) => value !== item.threadId),
      archived: [item.threadId, ...prefs.archived.filter((value) => value !== item.threadId)]
    }));
    if (item.kind === "session") {
      if (currentSessionId === item.id) {
        patchActiveWorkspace((workspace) => ({ ...workspace, currentSessionId: null }));
      }
      patchActiveWorkspace((workspace) => ({
        ...workspace,
        sessions: workspace.sessions.filter((session) => session.sessionId !== item.id)
      }));
      return;
    }
    if (selectedHistoryKey === item.id) {
      patchActiveWorkspace((workspace) => ({
        ...workspace,
        currentSessionId: null,
        selectedHistoryKey: null
      }));
    }
  }

  function startProjectSession(projectCwd: string) {
    patchActiveWorkspace((workspace) => ({
      ...workspace,
      cwd: projectCwd,
      currentSessionId: null,
      selectedHistoryKey: null,
      sessions: workspace.sessions.filter((session) => !isHistoryPreviewSessionId(session.sessionId))
    }));
    setDraft("");
    setAttachments([]);
    setActiveSheet(null);
    setActiveMenu(null);
    revealMainOnMobile();
  }

  function togglePinnedProject(projectCwd: string) {
    updateProjectSidebarPrefs(agentUrl, (prefs) => ({
      ...prefs,
      pinned: prefs.pinned.includes(projectCwd)
        ? prefs.pinned.filter((value) => value !== projectCwd)
        : [projectCwd, ...prefs.pinned.filter((value) => value !== projectCwd)]
    }));
  }

  function renameProject(group: ProjectThreadGroupData) {
    const nextName = window.prompt("重命名项目", group.name);
    if (nextName === null) {
      return;
    }
    const trimmed = nextName.trim();
    updateProjectSidebarPrefs(agentUrl, (prefs) => {
      const renamed = { ...prefs.renamed };
      if (!trimmed || trimmed === shortPath(group.cwd)) {
        delete renamed[group.cwd];
      } else {
        renamed[group.cwd] = trimmed;
      }
      return {
        ...prefs,
        renamed
      };
    });
  }

  function archiveProject(group: ProjectThreadGroupData) {
    const threadIds = group.items.map((item) => item.threadId);
    const sessionIds = new Set(group.sessions.map((session) => session.sessionId));
    const historyPreviewIds = new Set(group.entries.map(historyPreviewSessionId));
    const clearsSelection = group.items.some((item) => item.selected);

    updateThreadSidebarPrefs(agentUrl, (prefs) => ({
      pinned: prefs.pinned.filter((value) => !threadIds.includes(value)),
      archived: [...new Set([...threadIds, ...prefs.archived])]
    }));

    patchActiveWorkspace((workspace) => ({
      ...workspace,
      currentSessionId:
        clearsSelection && workspace.currentSessionId && sessionIds.has(workspace.currentSessionId)
          ? null
          : workspace.currentSessionId && historyPreviewIds.has(workspace.currentSessionId)
            ? null
            : workspace.currentSessionId,
      selectedHistoryKey:
        clearsSelection && group.entries.some((entry) => codexHistoryKey(entry) === workspace.selectedHistoryKey)
          ? null
          : workspace.selectedHistoryKey,
      sessions: workspace.sessions.filter(
        (session) =>
          !sessionIds.has(session.sessionId) && !historyPreviewIds.has(session.sessionId)
      )
    }));
  }

  function removeProject(group: ProjectThreadGroupData) {
    const sessionIds = new Set(group.sessions.map((session) => session.sessionId));
    const historyPreviewIds = new Set(group.entries.map(historyPreviewSessionId));
    const containsSelectedHistory = group.entries.some(
      (entry) => codexHistoryKey(entry) === selectedHistoryKey
    );
    const containsSelectedSession = group.sessions.some(
      (session) => session.sessionId === currentSessionId
    );

    updateProjectSidebarPrefs(agentUrl, (prefs) => {
      const renamed = { ...prefs.renamed };
      delete renamed[group.cwd];
      return {
        hidden: [group.cwd, ...prefs.hidden.filter((value) => value !== group.cwd)],
        pinned: prefs.pinned.filter((value) => value !== group.cwd),
        renamed
      };
    });

    patchActiveWorkspace((workspace) => ({
      ...workspace,
      cwd: workspace.cwd === group.cwd ? "" : workspace.cwd,
      currentSessionId:
        containsSelectedSession ||
        (workspace.currentSessionId ? historyPreviewIds.has(workspace.currentSessionId) : false)
          ? null
          : workspace.currentSessionId,
      selectedHistoryKey: containsSelectedHistory ? null : workspace.selectedHistoryKey,
      sessions: workspace.sessions.filter(
        (session) =>
          !sessionIds.has(session.sessionId) && !historyPreviewIds.has(session.sessionId)
      )
    }));
  }

  const clearThreadHoverPreview = useCallback(() => setThreadHoverPreview(null), []);

  const showThreadHoverPreview = useCallback((target: HTMLElement, title: string) => {
    if (typeof window === "undefined" || window.matchMedia("(hover: none)").matches) {
      return;
    }
    const titleNode = target.querySelector(".cn-thread-title");
    if (!(titleNode instanceof HTMLElement) || titleNode.scrollWidth <= titleNode.clientWidth + 1) {
      setThreadHoverPreview(null);
      return;
    }
    const frameRect = desktopFrameRef.current?.getBoundingClientRect();
    const rowRect = target.getBoundingClientRect();
    if (!frameRect) {
      return;
    }
    const desiredLeft = rowRect.right - frameRect.left + 14;
    const desiredTop = rowRect.top - frameRect.top + rowRect.height / 2;
    const maxWidth = Math.min(420, Math.max(220, frameRect.width - desiredLeft - 20));
    setThreadHoverPreview({
      left: Math.min(desiredLeft, frameRect.width - maxWidth - 20),
      maxWidth,
      title,
      top: Math.max(18, Math.min(frameRect.height - 18, desiredTop))
    });
  }, []);

  const resetSidebarWidth = useCallback(() => {
    setSidebarWidth(DEFAULT_SIDEBAR_WIDTH);
    window.localStorage.setItem(sidebarWidthStorageKey, String(DEFAULT_SIDEBAR_WIDTH));
  }, []);

  const startSidebarResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth =
        sessionSidebarRef.current?.getBoundingClientRect().width ?? clampSidebarWidth(sidebarWidth);
      let nextWidth = startWidth;

      setSidebarResizing(true);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      clearThreadHoverPreview();

      const finish = () => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", finish);
        window.removeEventListener("pointercancel", finish);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.localStorage.setItem(sidebarWidthStorageKey, String(nextWidth));
        setSidebarResizing(false);
        sidebarResizeCleanupRef.current = null;
      };

      const handleMove = (moveEvent: PointerEvent) => {
        nextWidth = clampSidebarWidth(startWidth + moveEvent.clientX - startX);
        setSidebarWidth(nextWidth);
      };

      sidebarResizeCleanupRef.current = finish;
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", finish);
      window.addEventListener("pointercancel", finish);
    },
    [clearThreadHoverPreview, sidebarWidth]
  );

  function enqueueDeviceEvents(
    deviceId: string,
    incoming: LocalEvent[],
    options: { selectSessions: boolean }
  ) {
    const queued = queuedEventsRef.current.get(deviceId) ?? [];
    queuedEventsRef.current.set(deviceId, [...queued, ...incoming]);
    queuedSelectRef.current.set(
      deviceId,
      Boolean(queuedSelectRef.current.get(deviceId)) || options.selectSessions
    );
    if (eventFrameRefs.current.has(deviceId)) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      eventFrameRefs.current.delete(deviceId);
      const queuedEvents = queuedEventsRef.current.get(deviceId) ?? [];
      const selectSessions = queuedSelectRef.current.get(deviceId) ?? true;
      queuedEventsRef.current.delete(deviceId);
      queuedSelectRef.current.delete(deviceId);
      patchDeviceWorkspace(deviceId, (workspace) =>
        ingestEventsIntoWorkspace(workspace, queuedEvents, { selectSessions })
      );
      if (selectedDeviceIdRef.current === deviceId) {
        const errorEvent = queuedEvents.find(
          (item) => item.type === "agent.error" || item.type === "codex.error"
        );
        if (errorEvent) {
          setError(
            errorEvent.type === "agent.error" && isRecord(errorEvent.payload)
              ? readString(errorEvent.payload, "message") ?? JSON.stringify(errorEvent.payload)
              : JSON.stringify(errorEvent.payload)
          );
        }
      }
    });
    eventFrameRefs.current.set(deviceId, frame);
  }

  function closeDeviceStream(deviceId: string) {
    streamRefs.current.get(deviceId)?.close();
    streamRefs.current.delete(deviceId);
    pendingDeviceStreamIds.current.delete(deviceId);
  }

  function openDeviceStream(
    deviceId: string,
    deviceConnection: AgentConnection,
    after: number,
    status: LocalHealthResponse | null
  ) {
    closeDeviceStream(deviceId);
    const stream = openManagedEventStream({
      connection: deviceConnection,
      after,
      onReplay: (events) => enqueueDeviceEvents(deviceId, events, { selectSessions: true }),
      onEvent: (event) => enqueueDeviceEvents(deviceId, [event], { selectSessions: true }),
      onStatus: (nextStatus) => {
        patchDeviceWorkspace(deviceId, (workspace) => ({
          ...workspace,
          streamStatus: nextStatus
        }));
        if (nextStatus === "connected") {
          setDevicePresence((previous) => ({
            ...previous,
            [deviceId]: {
              checkedAt: Date.now(),
              codexVersion: status?.codex?.version ?? previous[deviceId]?.codexVersion ?? null,
              status: "online"
            }
          }));
        }
      },
      onError: (streamError) => {
        if (selectedDeviceIdRef.current === deviceId) {
          setError(formatError(streamError));
        }
      }
    });
    streamRefs.current.set(deviceId, stream);
  }

  async function hydrateConnectedDevice(
    device: SavedDevice,
    status: LocalHealthResponse,
    options?: { selectDevice?: boolean }
  ) {
    const deviceConnection = connectionFromSavedDevice(device);
    if (options?.selectDevice) {
      setSelectedDeviceId(device.id);
      if (device.mode === "direct") {
        setAgentUrl(device.agentUrl);
        setToken(device.token);
      }
      setDeviceName(device.name);
    }
    patchDeviceWorkspace(device.id, (workspace) => ({
      ...workspace,
      connection: deviceConnection,
      healthStatus: status,
      streamStatus: "connecting"
    }));

    const replay = await replayEvents(deviceConnection, 0);
    patchDeviceWorkspace(device.id, (workspace) =>
      ingestEventsIntoWorkspace(workspace, replay.events, { selectSessions: false })
    );

    const [loadedSessions, history] = await Promise.all([
      listSessions(deviceConnection),
      listCodexHistory(deviceConnection)
    ]);
    const latestSession = [...loadedSessions.sessions].sort((a, b) => b.updatedAt - a.updatedAt)[0];

    patchDeviceWorkspace(device.id, (workspace) => ({
      ...workspace,
      codexHistory: history.entries,
      currentSessionId: workspace.currentSessionId ?? latestSession?.sessionId ?? null,
      cwd: workspace.cwd || latestSession?.cwd || "",
      directoryError: null,
      directoryLoading: true,
      sessions: loadedSessions.sessions
    }));

    const directoryPath = activeWorkspace?.cwd || latestSession?.cwd || undefined;
    try {
      const directories = await listDirectories(deviceConnection, directoryPath);
      patchDeviceWorkspace(device.id, (workspace) => ({
        ...workspace,
        directoryList: directories
      }));
    } catch (err) {
      patchDeviceWorkspace(device.id, (workspace) => ({
        ...workspace,
        directoryError: formatError(err)
      }));
    } finally {
      patchDeviceWorkspace(device.id, (workspace) => ({
        ...workspace,
        directoryLoading: false
      }));
    }

    openDeviceStream(device.id, deviceConnection, replay.events.at(-1)?.seq ?? 0, status);
  }

  async function connect(
    nextConnection: AgentConnection = connection,
    options?: { deviceId?: string | null; deviceName?: string }
  ) {
    setError(null);
    const status = await health(nextConnection);
    const connectedDevice = upsertConnectedDevice(nextConnection, status, options);
    await hydrateConnectedDevice(connectedDevice, status, { selectDevice: true });
  }

  async function attachSavedDeviceStream(device: SavedDevice, initialHealthStatus?: LocalHealthResponse) {
    if (streamRefs.current.has(device.id) || pendingDeviceStreamIds.current.has(device.id)) {
      return;
    }
    pendingDeviceStreamIds.current.add(device.id);
    try {
      const status = initialHealthStatus ?? (await health(connectionFromSavedDevice(device)));
      await hydrateConnectedDevice(device, status);
    } catch (err) {
      closeDeviceStream(device.id);
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

  function upsertConnectedDevice(
    nextConnection: AgentConnection,
    status: LocalHealthResponse,
    options?: { deviceId?: string | null; deviceName?: string }
  ): SavedDevice {
    const existingBySelection = options?.deviceId
      ? savedDevices.find((device) => device.id === options.deviceId) ?? null
      : null;
    const existingByEndpoint = findSavedDevice(savedDevices, nextConnection);
    const existingDevice = existingBySelection ?? existingByEndpoint ?? null;
    const nextDevice: SavedDevice =
      nextConnection.mode === "relay"
        ? {
            id: existingDevice?.id ?? nextConnection.deviceId,
            name:
              options?.deviceName?.trim() ||
              deviceName.trim() ||
              existingDevice?.name ||
              status.device?.defaultName ||
              nextConnection.deviceId,
            mode: "relay",
            relayUrl: normalizeAgentUrl(nextConnection.relayUrl),
            ownerToken: nextConnection.ownerToken,
            deviceId: nextConnection.deviceId,
            online: true,
            codexVersion: status.codex?.version ?? null,
            lastConnectedAt: Date.now(),
            ...((status.device?.hostname ??
              (existingDevice?.mode === "relay" ? existingDevice.hostname : null)) !==
            undefined
              ? {
                  hostname:
                    status.device?.hostname ??
                    (existingDevice?.mode === "relay"
                      ? existingDevice.hostname ?? null
                      : null)
                }
              : {})
          }
        : {
            id: existingDevice?.id ?? createSavedDeviceId(),
            name:
              options?.deviceName?.trim() ||
              deviceName.trim() ||
              existingDevice?.name ||
              status.device?.defaultName ||
              defaultDeviceName(nextConnection.agentUrl),
            mode: "direct",
            agentUrl: normalizeAgentUrl(nextConnection.agentUrl),
            token: nextConnection.token,
            codexVersion: status.codex?.version ?? null,
            lastConnectedAt: Date.now()
          };
    persistDevices([
      nextDevice,
      ...savedDevices.filter(
        (device) =>
          device.id !== nextDevice.id &&
          !isSameAgentConnection(connectionFromSavedDevice(device), connectionFromSavedDevice(nextDevice))
      )
    ]);
    if (nextDevice.mode === "direct") {
      window.localStorage.setItem(deviceNameStorageKey(nextDevice.agentUrl), nextDevice.name);
    }
    return nextDevice;
  }

  function deleteSavedDevice(deviceId: string) {
    persistDevices(savedDevices.filter((device) => device.id !== deviceId));
    closeDeviceStream(deviceId);
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
    patchActiveWorkspace((workspace) => ({
      ...workspace,
      directoryLoading: true,
      directoryError: null
    }));
    try {
      const result = await listDirectories(connection, path || cwd || undefined);
      patchActiveWorkspace((workspace) => ({
        ...workspace,
        directoryList: result
      }));
    } catch (err) {
      patchActiveWorkspace((workspace) => ({
        ...workspace,
        directoryError: formatError(err)
      }));
    } finally {
      patchActiveWorkspace((workspace) => ({
        ...workspace,
        directoryLoading: false
      }));
    }
  }

  async function selectHistory(entry: LocalCodexHistoryEntry) {
    if (!connected) {
      setActiveSheet("device");
      return;
    }
    const key = codexHistoryKey(entry);
    const previewSession = makeHistoryPreviewSession(entry);
    setError(null);
    patchActiveWorkspace((workspace) =>
      upsertSessionInWorkspace(
        {
          ...workspace,
          selectedHistoryKey: key,
          historyLoadingKey: key,
          currentSessionId: previewSession.sessionId,
          cwd: entry.cwd,
          resumeStates: {
            ...workspace.resumeStates,
            [previewSession.sessionId]: isPreviewOnlyHistoryEntry(entry) ? "missing" : "history"
          }
        },
        previewSession
      )
    );
    setActiveSheet(null);
    revealMainOnMobile();
    try {
      const cachedDetail = historyDetailCacheRef.current.get(key);
      const detail =
        cachedDetail ?? (await getCodexHistoryDetail(connection, { id: entry.id, cwd: entry.cwd }));
      historyDetailCacheRef.current.set(key, detail);
      patchActiveWorkspace((workspace) =>
        hydrateSessionFromHistory(
          {
            ...workspace,
            historyLoadingKey: null,
            resumeStates: {
              ...workspace.resumeStates,
              [previewSession.sessionId]: isPreviewOnlyHistoryEntry(detail.entry) ? "missing" : "history"
            }
          },
          previewSession.sessionId,
          detail.messages
        )
      );
    } catch (err) {
      patchActiveWorkspace((workspace) => ({
        ...workspace,
        historyLoadingKey: null,
        resumeStates: {
          ...workspace.resumeStates,
          [previewSession.sessionId]: isMissingHistoryCwdError(err) ? "missing" : "failed"
        }
      }));
      setError(formatError(err));
    }
  }

  async function resumeHistorySessionForMessage(
    entry: LocalCodexHistoryEntry,
    previewSession: LocalSessionSummary,
    message: string,
    clientMessageId: string
  ) {
    if (isPreviewOnlyHistoryEntry(entry)) {
      patchActiveWorkspace((workspace) => ({
        ...workspace,
        resumeStates: {
          ...workspace.resumeStates,
          [previewSession.sessionId]: "missing"
        }
      }));
      throw new Error("原项目已不存在。");
    }

    patchActiveWorkspace((workspace) => ({
      ...workspace,
      resumeStates: {
        ...workspace.resumeStates,
        [previewSession.sessionId]: "resuming"
      }
    }));

    try {
      const result = await resumeCodexHistory(connection, {
        id: entry.id,
        cwd: entry.cwd,
        model,
        permissionMode,
        reasoningEffort
      });
      patchActiveWorkspace((workspace) => {
        let next = upsertSessionInWorkspace(workspace, result.session);
        next = rememberSessionHistoryOrigin(
          next,
          result.session.sessionId,
          result.history.entry.id
        );
        next = reassignSessionChatItems(next, previewSession.sessionId, result.session.sessionId);
        next = hydrateSessionFromHistory(next, result.session.sessionId, result.history.messages);
        return {
          ...next,
          currentSessionId: result.session.sessionId,
          cwd: result.session.cwd,
          selectedHistoryKey: null,
          sessions: next.sessions.filter(
            (session) =>
              session.sessionId !== previewSession.sessionId ||
              session.sessionId === result.session.sessionId
          ),
          resumeStates: Object.fromEntries(
            Object.entries(next.resumeStates).filter(
              ([sessionId]) =>
                sessionId !== previewSession.sessionId && sessionId !== result.session.sessionId
            )
          )
        };
      });

      const sent = await sendSessionMessage(connection, result.session.sessionId, {
        text: message,
        clientMessageId
      });
      patchActiveWorkspace((workspace) =>
        markOptimisticMessageSent(workspace, clientMessageId, {
          sessionId: result.session.sessionId,
          turnId: sent.turnId
        })
      );
    } catch (err) {
      patchActiveWorkspace((workspace) =>
        markOptimisticMessageFailed(
          {
            ...workspace,
            resumeStates: {
              ...workspace.resumeStates,
              [previewSession.sessionId]: isMissingHistoryCwdError(err) ? "missing" : "failed"
            }
          },
          clientMessageId,
          formatError(err)
        )
      );
      throw err;
    }
  }

  async function resumeHistorySessionForGoal(
    entry: LocalCodexHistoryEntry,
    previewSession: LocalSessionSummary,
    objective: string
  ) {
    if (isPreviewOnlyHistoryEntry(entry)) {
      patchActiveWorkspace((workspace) => ({
        ...workspace,
        resumeStates: {
          ...workspace.resumeStates,
          [previewSession.sessionId]: "missing"
        }
      }));
      throw new Error("原项目已不存在。");
    }

    patchActiveWorkspace((workspace) => ({
      ...workspace,
      resumeStates: {
        ...workspace.resumeStates,
        [previewSession.sessionId]: "resuming"
      }
    }));

    try {
      const result = await resumeCodexHistory(connection, {
        id: entry.id,
        cwd: entry.cwd,
        model,
        permissionMode,
        reasoningEffort
      });
      patchActiveWorkspace((workspace) => {
        let next = upsertSessionInWorkspace(workspace, result.session);
        next = rememberSessionHistoryOrigin(
          next,
          result.session.sessionId,
          result.history.entry.id
        );
        next = reassignSessionChatItems(next, previewSession.sessionId, result.session.sessionId);
        next = hydrateSessionFromHistory(next, result.session.sessionId, result.history.messages);
        return {
          ...next,
          currentSessionId: result.session.sessionId,
          cwd: result.session.cwd,
          selectedHistoryKey: null,
          sessions: next.sessions.filter(
            (session) =>
              session.sessionId !== previewSession.sessionId ||
              session.sessionId === result.session.sessionId
          ),
          resumeStates: Object.fromEntries(
            Object.entries(next.resumeStates).filter(
              ([sessionId]) =>
                sessionId !== previewSession.sessionId && sessionId !== result.session.sessionId
            )
          )
        };
      });

      await setGoalForSession(result.session.sessionId, {
        objective,
        status: "active",
        tokenBudget: result.session.goal?.tokenBudget ?? null
      });
    } catch (err) {
      patchActiveWorkspace((workspace) => ({
        ...workspace,
        resumeStates: {
          ...workspace.resumeStates,
          [previewSession.sessionId]: isMissingHistoryCwdError(err) ? "missing" : "failed"
        }
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
    if (currentResumeState === "resuming") {
      setError("稍等，正在恢复。");
      return;
    }
    if (currentResumeState === "failed") {
      setError("这条记录暂时不能继续发送。");
      return;
    }
    if (currentResumeState === "missing") {
      setError("原项目已不存在，请新建对话。");
      return;
    }
    if (!currentSession && !cwd.trim()) {
      setActiveSheet("session");
      await loadDirectories(undefined);
      return;
    }

    if (goalComposerMode) {
      setDraft("");
      setAttachments([]);
      setActiveMenu(null);
      setError(null);

      try {
        if (currentSession) {
          if (isHistoryPreviewSessionId(currentSession.sessionId)) {
            const historyEntry =
              selectedHistoryEntry ??
              codexHistory.find(
                (entry) => historyPreviewSessionId(entry) === currentSession.sessionId
              ) ??
              null;
            if (!historyEntry) {
              throw new Error("这条记录暂时不可用，请刷新后重试。");
            }
            await resumeHistorySessionForGoal(historyEntry, currentSession, text);
          } else {
            await setGoalForSession(currentSession.sessionId, {
              objective: text,
              status: "active",
              tokenBudget: currentSession.goal?.tokenBudget ?? null
            });
          }
          setGoalComposerMode(false);
          return;
        }

        const result = await createSession(connection, {
          cwd: cwd.trim(),
          model,
          reasoningEffort,
          permissionMode,
          tokenBudget: initialTokenBudget ? Number(initialTokenBudget) : null,
          initialGoal: text,
          initialMessage: null
        });

        patchActiveWorkspace((workspace) => {
          const next = upsertSessionInWorkspace(workspace, result.session);
          return {
            ...next,
            currentSessionId: result.session.sessionId,
            selectedHistoryKey: null,
            cwd: result.session.cwd
          };
        });
        setGoalComposerMode(false);
        setActiveSheet(null);
        return;
      } catch (err) {
        setError(formatError(err));
        return;
      }
    }

    const message = buildMessageWithAttachments(text, attachments);
    const clientMessageId = crypto.randomUUID();
    const targetSessionId = currentSession?.sessionId ?? pendingSessionId(clientMessageId);
    const optimisticTurnId = currentSession?.activeTurnId ?? undefined;

    patchActiveWorkspace((workspace) =>
      addOptimisticUserMessage(workspace, {
        sessionId: targetSessionId,
        ...(optimisticTurnId ? { turnId: optimisticTurnId } : {}),
        clientMessageId,
        text: message
      })
    );
    setDraft("");
    setAttachments([]);
    setError(null);

    try {
      if (currentSession) {
        if (isHistoryPreviewSessionId(currentSession.sessionId)) {
          const historyEntry =
            selectedHistoryEntry ??
            codexHistory.find(
              (entry) => historyPreviewSessionId(entry) === currentSession.sessionId
            ) ??
            null;
          if (!historyEntry) {
            throw new Error("这条记录暂时不可用，请刷新后重试。");
          }
          await resumeHistorySessionForMessage(historyEntry, currentSession, message, clientMessageId);
          return;
        }
        const result = await sendSessionMessage(connection, currentSession.sessionId, {
          text: message,
          clientMessageId
        });
        patchActiveWorkspace((workspace) =>
          markOptimisticMessageSent(workspace, clientMessageId, {
            sessionId: currentSession.sessionId,
            turnId: result.turnId
          })
        );
        return;
      }

      const pendingSession = makePendingSession({
        sessionId: targetSessionId,
        cwd: cwd.trim(),
        model,
        permissionMode,
        reasoningEffort
      });
      patchActiveWorkspace((workspace) =>
        upsertSessionInWorkspace(
          {
            ...workspace,
            currentSessionId: pendingSession.sessionId,
            selectedHistoryKey: null,
            cwd: pendingSession.cwd
          },
          pendingSession
        )
      );

      const result = await createSession(connection, {
        cwd: cwd.trim(),
        model,
        reasoningEffort,
        permissionMode,
        tokenBudget: initialTokenBudget ? Number(initialTokenBudget) : null,
        initialGoal: initialGoal.trim() || null,
        initialMessage: message,
        clientMessageId
      });

      patchActiveWorkspace((workspace) => {
        let next = reassignSessionChatItems(workspace, pendingSession.sessionId, result.session.sessionId);
        next = markOptimisticMessageSent(next, clientMessageId, { sessionId: result.session.sessionId });
        next = upsertSessionInWorkspace(next, result.session);
        return {
          ...next,
          currentSessionId: result.session.sessionId,
          selectedHistoryKey: null,
          sessions: next.sessions.filter(
            (session) =>
              session.sessionId !== pendingSession.sessionId ||
              session.sessionId === result.session.sessionId
          )
        };
      });
      setActiveSheet(null);
    } catch (err) {
      patchActiveWorkspace((workspace) =>
        markOptimisticMessageFailed(workspace, clientMessageId, formatError(err))
      );
      setError(formatError(err));
    }
  }

  async function interrupt() {
    if (!currentSession?.activeTurnId) {
      return;
    }
    await interruptSessionTurn(connection, currentSession.sessionId, currentSession.activeTurnId);
  }

  async function setGoalForSession(
    sessionId: string,
    input: { objective?: string | null; status?: string | null; tokenBudget?: number | null }
  ) {
    const result = await agentFetch<{ goal: ThreadGoal }>(
      connection,
      `/api/sessions/${sessionId}/goal`,
      { method: "POST", body: JSON.stringify(input) }
    );
    patchActiveWorkspace((workspace) => ({
      ...workspace,
      sessions: workspace.sessions.map((session) =>
        session.sessionId === sessionId ? { ...session, goal: result.goal } : session
      )
    }));
  }

  async function setGoal(input: { objective?: string | null; status?: string | null; tokenBudget?: number | null }) {
    if (!currentSession) {
      setError("请先选择对话。");
      return;
    }
    await setGoalForSession(currentSession.sessionId, input);
  }

  async function clearGoal() {
    if (!currentSession) {
      return;
    }
    await agentFetch(connection, `/api/sessions/${currentSession.sessionId}/goal`, {
      method: "DELETE"
    });
    patchActiveWorkspace((workspace) => ({
      ...workspace,
      sessions: workspace.sessions.map((session) =>
        session.sessionId === currentSession.sessionId ? { ...session, goal: null } : session
      )
    }));
  }

  async function refreshGoal() {
    if (!currentSession) {
      return;
    }
    const result = await agentFetch<{ goal: ThreadGoal | null }>(
      connection,
      `/api/sessions/${currentSession.sessionId}/goal`
    );
    patchActiveWorkspace((workspace) => ({
      ...workspace,
      sessions: workspace.sessions.map((session) =>
        session.sessionId === currentSession.sessionId ? { ...session, goal: result.goal } : session
      )
    }));
  }

  async function decideApproval(approvalId: string, decision: LocalApprovalDecision) {
    const approval = pendingApprovals.find((item) => item.approvalId === approvalId);
    if (!approval) {
      return;
    }
    patchActiveWorkspace((workspace) => ({
      ...workspace,
      pendingApprovals: workspace.pendingApprovals.filter((item) => item.approvalId !== approvalId)
    }));
    try {
      await resolveApproval(connection, approvalId, decision);
    } catch (err) {
      patchActiveWorkspace((workspace) => ({
        ...workspace,
        pendingApprovals: [
          ...workspace.pendingApprovals.filter((item) => item.approvalId !== approvalId),
          approval
        ]
      }));
      throw err;
    }
  }

  async function attachFiles(files: FileList | null) {
    if (!files?.length) {
      return;
    }
    const next: AttachmentDraft[] = [];
    for (const file of Array.from(files).slice(0, 4)) {
      const textLike =
        file.type.startsWith("text/") ||
        /\.(css|go|html|java|js|jsx|json|md|py|rs|toml|ts|tsx|txt|yaml|yml)$/i.test(file.name);
      next.push({
        name: file.name,
        type: file.type || "unknown",
        size: file.size,
        content: textLike ? (await file.text()).slice(0, 24_000) : null
      });
    }
    setAttachments((previous) => [...previous, ...next].slice(0, 4));
  }

  function selectSession(sessionId: string) {
    patchActiveWorkspace((workspace) => ({
      ...workspace,
      currentSessionId: sessionId,
      selectedHistoryKey: null,
      sessions: workspace.sessions.filter(
        (session) => !isHistoryPreviewSessionId(session.sessionId) || session.sessionId === sessionId
      )
    }));
    revealMainOnMobile();
    void ensureSessionHistoryHydrated(sessionId);
  }

  function revealMainOnMobile() {
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 900px)").matches) {
      setSidebarCollapsed(true);
    }
  }

  function openDeviceSheet() {
    revealMainOnMobile();
    setActiveSheet("device");
  }

  function openSummarySheet() {
    revealMainOnMobile();
    setActiveSheet("summary");
  }

  function openGoalSheet() {
    revealMainOnMobile();
    setActiveSheet("goal");
  }

  function openNewSessionSetup() {
    patchActiveWorkspace((workspace) => ({
      ...workspace,
      currentSessionId: null,
      selectedHistoryKey: null,
      sessions: workspace.sessions.filter((session) => !isHistoryPreviewSessionId(session.sessionId))
    }));
    setDraft("");
    revealMainOnMobile();
    setActiveSheet("session");
    void loadDirectories(undefined);
  }

  function closeActiveSheet() {
    setActiveSheet(null);
  }

  function selectCwd(nextCwd: string) {
    patchActiveWorkspace((workspace) => ({
      ...workspace,
      cwd: nextCwd,
      currentSessionId: null,
      selectedHistoryKey: null,
      sessions: workspace.sessions.filter((session) => !isHistoryPreviewSessionId(session.sessionId))
    }));
    setActiveSheet(null);
    revealMainOnMobile();
  }

  async function handleConnect(
    nextConnection: AgentConnection,
    nextDeviceName?: string,
    nextDeviceId?: string | null
  ) {
    try {
      await connect(nextConnection, {
        ...(nextDeviceId !== undefined ? { deviceId: nextDeviceId } : {}),
        ...(nextDeviceName !== undefined ? { deviceName: nextDeviceName } : {})
      });
      setActiveSheet(null);
    } catch (err) {
      setError(
        formatConnectionError(
          err,
          nextConnection.mode === "direct"
            ? nextConnection.agentUrl
            : nextConnection.relayUrl
        )
      );
    }
  }

  async function handleAttachFiles(files: FileList | null) {
    try {
      await attachFiles(files);
    } catch (err) {
      setError(formatError(err));
    }
  }

  async function handleLoadDirectories(path?: string) {
    try {
      await loadDirectories(path);
    } catch (err) {
      setError(formatError(err));
    }
  }

  async function handleInterrupt() {
    try {
      await interrupt();
    } catch (err) {
      setError(formatError(err));
    }
  }

  async function handleApprovalDecision(approvalId: string, decision: LocalApprovalDecision) {
    try {
      await decideApproval(approvalId, decision);
    } catch (err) {
      setError(formatError(err));
    }
  }

  async function handleClearGoal() {
    try {
      await clearGoal();
      setGoalComposerMode(false);
    } catch (err) {
      setError(formatError(err));
    }
  }

  async function handleRefreshGoal() {
    try {
      await refreshGoal();
    } catch (err) {
      setError(formatError(err));
    }
  }

  async function handlePauseGoal() {
    try {
      await setGoal({ status: "paused" });
    } catch (err) {
      setError(formatError(err));
    }
  }

  async function handleResumeGoal() {
    try {
      await setGoal({ status: "active" });
    } catch (err) {
      setError(formatError(err));
    }
  }

  async function handleSetGoal() {
    try {
      await setGoal({
        objective: goalObjective.trim(),
        status: "active",
        tokenBudget: goalTokenBudget ? Number(goalTokenBudget) : null
      });
    } catch (err) {
      setError(formatError(err));
    }
  }

  function handleTogglePlanMode() {
    setPlanModeEnabled((previous) => !previous);
    setActiveMenu(null);
  }

  function handleActivateGoalComposer() {
    if (currentSession?.goal?.objective && !draft.trim()) {
      setDraft(currentSession.goal.objective);
    }
    setGoalComposerMode(true);
    setActiveMenu(null);
    setError(null);
  }

  function handleDismissComposerGoal() {
    setGoalComposerMode(false);
    setActiveMenu(null);
    setDraft("");
  }

  function handleRemoveAttachment(attachment: AttachmentDraft) {
    setAttachments((previous) => previous.filter((item) => item !== attachment));
  }

  return {
    activeMenu,
    activeSheet,
    activeTurn,
    agentUrl,
    attachments,
    chatItems,
    clearThreadHoverPreview,
    closeActiveSheet,
    connection,
    connected,
    codexHistory,
    currentResumeState,
    currentSession,
    currentGoal,
    cwd,
    desktopFrameRef,
    desktopFrameStyle,
    deviceDisplayName,
    deviceName,
    devicePresence,
    directoryError,
    directoryList,
    directoryLoading,
    draft,
    error,
    events,
    fileInputRef,
    firstApproval,
    goalObjective,
    goalTokenBudget,
    goalComposerMode,
    handleApprovalDecision,
    handleActivateGoalComposer,
    handleAttachFiles,
    handleClearGoal,
    handleConnect,
    handleDismissComposerGoal,
    handleInterrupt,
    handleLoadDirectories,
    handlePauseGoal,
    handleRefreshGoal,
    handleRemoveAttachment,
    handleResumeGoal,
    handleSetGoal,
    handleTogglePlanMode,
    hasCurrentGoal,
    healthStatus,
    historyLoadingKey,
    initialGoal,
    initialTokenBudget,
    model,
    openDeviceSheet,
    openSummarySheet,
    openGoalSheet,
    openNewSessionSetup,
    pendingApprovals,
    permissionMode,
    permissionOptions,
    planModeEnabled,
    projectGroups,
    reasoningEffort,
    reasoningOptions,
    relayEnabled,
    relayConnectionInfo,
    resetSidebarWidth,
    savedDevices,
    refreshRelayDevices,
    startProjectSession,
    selectCwd,
    selectHistory,
    selectSession,
    selectedDeviceId,
    selectedHistoryEntry,
    selectedModel,
    selectedPermission,
    selectedReasoning,
    sessionSidebarRef,
    setActiveMenu,
    setDraft,
    setGoalObjective,
    setGoalTokenBudget,
    setInitialGoal,
    setInitialTokenBudget,
    setModel,
    setPermissionMode,
    setReasoningEffort,
    setSidebarCollapsed,
    showThreadHoverPreview,
    sidebarCollapsed,
    sidebarResizing,
    startSidebarResize,
    streamStatus,
    submitComposer,
    threadHoverPreview,
    token,
    togglePinnedProject,
    togglePinnedThread,
    renameProject,
    archiveProject,
    removeProject,
    archiveThread,
    deleteSavedDevice,
    visibleChatItems
  };
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

function clampSidebarWidth(value: number): number {
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, Math.round(value)));
}

function isMissingHistoryCwdError(error: unknown): boolean {
  return formatError(error).includes("cwd does not exist:");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, key: string): string | null {
  return typeof record[key] === "string" ? record[key] : null;
}
