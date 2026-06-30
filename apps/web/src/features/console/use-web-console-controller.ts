"use client";

import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import type { LocalMessageSubmitMode, LocalReasoningEffort, ThreadGoal } from "@codexnext/protocol";
import {
  agentFetch,
  archiveCodexHistory,
  createSession,
  getLoadedCodexThreads,
  getCodexHistoryTurns,
  getRelaySidebarPrefs,
  health,
  interruptSessionTurn,
  listCodexHistory,
  listDirectories,
  listProviderCatalog,
  listRelayDevices,
  listSessions,
  replayEvents,
  resolveApproval,
  resumeCodexHistory,
  sendSessionMessage,
  updateSessionQueue,
  updateRelaySidebarPrefs,
  type AgentConnection
} from "../../lib/api";
import { openManagedEventStream, type ManagedEventStream } from "../../lib/event-stream";
import { formatError } from "../../lib/format/text";
import { createClientId } from "../../lib/random-id";
import {
  traceDurationMs,
  webDevTrace,
  webErrorSummary
} from "../../lib/dev-trace";
import {
  FAST_SERVICE_TIER,
  resolveSubmittedSlashCommand,
  type SlashCommandId
} from "../../lib/slash-commands";
import {
  requestRelaySession,
  resolveDefaultRelayUrl
} from "../../lib/relay";
import type {
  ChatItem,
  LocalApprovalDecision,
  LocalCodexHistoryEntry,
  LocalCodexHistoryPageResponse,
  LocalEvent,
  LocalHealthResponse,
  LocalPermissionMode,
  LocalProviderCatalogResponse,
  LocalProviderConfig,
  LocalProviderPreset,
  LocalQueueActionInput,
  LocalSessionSummary,
  PendingApprovalView
} from "../../lib/types";
import {
  buildConversationCacheEntries,
  addOptimisticUserMessage,
  createDeviceWorkspace,
  hydrateSessionFromTurns,
  ingestEventsIntoWorkspace,
  markOptimisticMessageComplete,
  markOptimisticMessageFailed,
  markOptimisticMessageQueued,
  markOptimisticMessageSent,
  reassignSessionChatItems,
  rememberSessionHistoryOrigin,
  restoreConversationCacheEntries,
  restoreOutboxEntries,
  resolveStateUpdater,
  selectConversationChatItems,
  selectConversationRenderSnapshot,
  selectConversationTurnGroups,
  selectSessionHistoryHydrated,
  selectTurnHasCompletionEvidence,
  setLoadedThreadIds,
  setSessionHistoryPageState,
  type AttachmentDraft,
  type ConversationCacheEntry,
  type DeviceWorkspace,
  type OutboxEntry,
  type TurnGroup,
  type ResumeState,
  type WorkspaceProviderSelection,
  upsertSessionInWorkspace
} from "../chat/chat-state";
import {
  coerceRelayPermissionMode,
  availableRelayPermissionOptions,
  formatConsoleConnectionError,
  formatConsoleError,
  formatMissingHistoryFolderMessage,
  formatMissingHistoryFolderShortMessage,
  mergeDevicePresenceResults,
  resolveComposerResumeBlock,
  seedSavedDevicePresence
} from "./console-utils";
import {
  hasRelayOnlyMigrationNoticeSeen,
  readConversationOutboxStorage,
  readSessionSelectionStorage,
  readWorkspaceSidebarSnapshotsStorage,
  writeConversationOutboxStorage,
  writeSessionSelectionStorage,
  writeProjectSidebarPrefsStorage,
  writeRelayOnlyMigrationNoticeSeen,
  writeSavedDevicesStorage,
  writeSidebarWidthStorage,
  writeThreadSidebarPrefsStorage,
  writeWorkspaceSidebarSnapshotsStorage,
  type WorkspaceSidebarSnapshot
} from "./console-storage";
import {
  mergeLiveHistoryIntoWorkspace,
  mergeLiveSessionsIntoWorkspace,
  mergeSelectedHistoryPreviewSession,
  resolvePreferredWorkspaceCwd,
  resolveHistoryPreviewEntryToHydrate,
  type SavedSessionSelection
} from "./console-hydration";
import {
  readConversationCacheStorage,
  writeConversationCacheStorage
} from "./conversation-cache";
import {
  createSavedDeviceId,
  connectionFromSavedDevice,
  findSavedDevice,
  isSameAgentConnection,
  isSameSavedDeviceConnection,
  normalizeAgentUrl,
  readSavedDevicesState,
  readSidebarWidth,
  type DevicePresenceState,
  type SavedDevice
} from "../devices/device-utils";
import {
  codexHistoryKey,
  filterRestorableHistoryEntries,
  getProjectSidebarPrefs,
  getThreadSidebarPrefs,
  groupProjectThreads,
  historyPreviewSessionId,
  historySubtitle,
  isHistoryPreviewSessionId,
  isPendingSessionId,
  isPreviewOnlyHistoryEntry,
  isRestorableHistoryEntry,
  makeHistoryPreviewSession,
  makePendingSession,
  pendingSessionId,
  relayThreadPrefsScope,
  readProjectSidebarPrefs,
  readThreadSidebarPrefs,
  sanitizeProjectSidebarPrefs,
  sanitizeThreadSidebarPrefs,
  sessionSubtitle,
  sessionTitleFromTurnGroups,
  type ProjectSidebarPrefs,
  type ProjectThreadGroupData,
  type ThreadListItem,
  type ThreadSidebarNotice,
  type ThreadSidebarPrefs
} from "../sessions/session-utils";
import {
  decideMessageHistoryReconciliation,
  isReconciledTerminalSession
} from "./message-reconciliation";
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

export const providerOptions: Array<{
  label: string;
  preset: LocalProviderPreset | null;
  value: string;
}> = [
  { label: "Codex 默认", preset: null, value: "" },
  { label: "OpenRouter", preset: "openrouter", value: "openrouter" },
  { label: "DeepSeek", preset: "deepseek", value: "deepseek" },
  { label: "Qwen", preset: "dashscope-qwen", value: "dashscope-qwen" },
  { label: "SiliconFlow", preset: "siliconflow", value: "siliconflow" },
  { label: "MiniMax", preset: "minimax", value: "minimax" },
  { label: "Kimi", preset: "moonshot-kimi", value: "moonshot-kimi" },
  { label: "自定义", preset: "custom", value: "custom" }
];

const EMPTY_PROVIDER_SELECTION: WorkspaceProviderSelection = {
  apiKey: "",
  apiKeyEnv: "",
  baseUrl: "",
  label: "",
  model: "",
  profileId: ""
};

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
    icon: "shieldCode",
    label: "替我审批",
    mode: "auto-approve"
  },
  {
    description: "只在信任的设备和工作区使用；CodexNext 不会再为高风险操作额外拦截",
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
const HISTORY_PAGE_CACHE_TTL_MS = 15_000;
const HISTORY_AUTO_COMPLETE_PAGE_LIMIT = 100;
const HISTORY_AUTO_COMPLETE_MAX_PAGES = 500;
const HISTORY_PREFETCH_CONCURRENCY = 1;
const MESSAGE_RECONCILE_INITIAL_DELAY_MS = 1_200;
const MESSAGE_RECONCILE_INTERVAL_MS = 2_500;
const MESSAGE_RECONCILE_MAX_ATTEMPTS = 720;
const RELAY_CONFIGURED = Boolean(process.env.NEXT_PUBLIC_CODEXNEXT_RELAY_URL);
const RELAY_FULL_ACCESS_ENABLED =
  process.env.NEXT_PUBLIC_CODEXNEXT_DISABLE_RELAY_FULL_ACCESS !== "1";

interface RelayBootstrapConfig {
  sessionToken: string;
  relayUrl: string;
}

interface HistoryPrefetchTask {
  connection: AgentConnection;
  entry: LocalCodexHistoryEntry;
  key: string;
}

interface HistoryAutoCompletionInput {
  connection: AgentConnection;
  cursor: string;
  cwd: string;
  deviceId: string;
  sessionId: string;
  sourceKey: string;
  threadId: string;
}

interface MessageReconciliationRequest {
  attempt: number;
  clientMessageId: string;
  connection: AgentConnection;
  deviceId: string;
  messageText: string;
  sessionId: string;
  startedAt: number;
  submitTraceId?: string | undefined;
  turnId?: string | undefined;
}

interface SubmitTraceContext {
  clientMessageId: string;
  deviceId: string | null;
  kind: "goal" | "message";
  sessionId: string;
  startedAt: number;
  submitTraceId: string;
  textLength: number;
  turnId?: string | undefined;
}

interface PendingSessionQueuedMessage {
  clientMessageId: string;
  context: SubmitTraceContext;
  message: string;
  serviceTier?: string | null;
  submitMode?: LocalMessageSubmitMode | undefined;
}

function applyLoadedThreadState(
  entries: LocalCodexHistoryEntry[],
  threadIds: string[]
): LocalCodexHistoryEntry[] {
  const loadedSet = new Set(threadIds);
  return entries.map((entry) => ({
    ...entry,
    loaded: entry.loaded || loadedSet.has(entry.id),
    threadStatus:
      entry.threadStatus ??
      (loadedSet.has(entry.id) ? "loaded" : "notLoaded")
  }));
}

function removeArchivedThreadFromWorkspace(
  workspace: DeviceWorkspace,
  item: ThreadListItem
): DeviceWorkspace {
  const nextSessions = workspace.sessions.filter(
    (session) => session.threadId !== item.threadId
  );
  const nextHistory = workspace.codexHistory.filter((entry) => entry.id !== item.threadId);
  const nextHistoryPages = { ...workspace.historyPages };
  const nextOrigins = { ...workspace.sessionHistoryOrigins };

  for (const session of workspace.sessions) {
    if (session.threadId !== item.threadId) {
      continue;
    }
    delete nextHistoryPages[session.sessionId];
    delete nextOrigins[session.sessionId];
  }

  const selectedSessionMatches = workspace.sessions.some(
    (session) =>
      session.sessionId === workspace.currentSessionId &&
      session.threadId === item.threadId
  );

  return {
    ...workspace,
    currentSessionId: selectedSessionMatches ? null : workspace.currentSessionId,
    selectedHistoryKey:
      workspace.selectedHistoryKey === item.id ? null : workspace.selectedHistoryKey,
    sessions: nextSessions,
    codexHistory: nextHistory,
    historyPages: nextHistoryPages,
    sessionHistoryOrigins: nextOrigins,
    loadedThreadIds: workspace.loadedThreadIds.filter((value) => value !== item.threadId)
  };
}

function restoreWorkspaceFromSidebarSnapshot(
  connection: AgentConnection,
  snapshot: WorkspaceSidebarSnapshot
): DeviceWorkspace {
  const restorableHistory = filterRestorableHistoryEntries(snapshot.codexHistory);
  const missingHistoryCwds = new Set(
    snapshot.codexHistory
      .filter((entry) => !isRestorableHistoryEntry(entry))
      .map((entry) => entry.cwd)
  );
  const snapshotCwd = missingHistoryCwds.has(snapshot.cwd) ? "" : snapshot.cwd;
  const restorablePreviewSessionIds = new Set(
    restorableHistory.map(historyPreviewSessionId)
  );
  const restorableSessions = snapshot.sessions.filter(
    (session) =>
      !missingHistoryCwds.has(session.cwd) &&
      (!isHistoryPreviewSessionId(session.sessionId) ||
        restorablePreviewSessionIds.has(session.sessionId))
  );
  const restoredSessionIds = new Set(
    restorableSessions.map((session) => session.sessionId)
  );
  const restoredHistoryKeys = new Set(
    restorableHistory.map((entry) => codexHistoryKey(entry))
  );
  const restorableThreadIds = new Set([
    ...restorableHistory.map((entry) => entry.id),
    ...restorableSessions
      .filter((session) => !isHistoryPreviewSessionId(session.sessionId))
      .map((session) => session.threadId)
  ]);
  const loadedThreadIds = snapshot.loadedThreadIds.filter((threadId) =>
    restorableThreadIds.has(threadId)
  );
  const sessionHistoryOrigins = Object.fromEntries(
    Object.entries(snapshot.sessionHistoryOrigins).filter(([sessionId]) =>
      restoredSessionIds.has(sessionId)
    )
  );
  const resumeStates = Object.fromEntries(
    Object.keys(sessionHistoryOrigins)
      .filter((sessionId) => restoredSessionIds.has(sessionId))
      .map((sessionId) => [
        sessionId,
        sessionId.startsWith("history-preview:") ? "history" : "resuming"
      ] as const)
  ) as Record<string, ResumeState>;

  const nextWorkspace = {
    ...createDeviceWorkspace(connection),
    codexHistory: applyLoadedThreadState(
      restorableHistory,
      loadedThreadIds
    ),
    currentSessionId:
      snapshot.currentSessionId &&
      restoredSessionIds.has(snapshot.currentSessionId)
        ? snapshot.currentSessionId
        : null,
    loadedThreadIds,
    missingHistoryCwds: [...missingHistoryCwds],
    resumeStates,
    selectedHistoryKey:
      snapshot.selectedHistoryKey &&
      restoredHistoryKeys.has(snapshot.selectedHistoryKey)
        ? snapshot.selectedHistoryKey
        : null,
    sessionHistoryOrigins,
    sessions: restorableSessions
  };

  return {
    ...nextWorkspace,
    cwd: resolvePreferredWorkspaceCwd({
      ...nextWorkspace,
      cwd: snapshotCwd
    }),
    resumeStates: Object.fromEntries(
      Object.keys(nextWorkspace.sessionHistoryOrigins)
        .filter((sessionId) =>
          nextWorkspace.sessions.some((session) => session.sessionId === sessionId)
        )
        .map((sessionId) => {
          const previewEntry = nextWorkspace.codexHistory.find(
            (entry) => historyPreviewSessionId(entry) === sessionId
          );
          const resumeState: ResumeState =
            previewEntry && isPreviewOnlyHistoryEntry(previewEntry)
              ? "missing"
              : sessionId.startsWith("history-preview:")
                ? "history"
                : "resuming";
          return [sessionId, resumeState] as const;
        })
    ) as Record<string, ResumeState>
  };
}

function buildWorkspaceSidebarSnapshots(
  savedDevices: SavedDevice[],
  deviceWorkspaces: Record<string, DeviceWorkspace>
): Record<string, WorkspaceSidebarSnapshot> {
  return Object.fromEntries(
    savedDevices
      .map((device) => {
        const workspace = deviceWorkspaces[device.id];
        if (!workspace) {
          return null;
        }
        const restorableHistory = filterRestorableHistoryEntries(workspace.codexHistory);
        const missingHistoryCwds = new Set([
          ...workspace.missingHistoryCwds,
          ...workspace.codexHistory
            .filter((entry) => !isRestorableHistoryEntry(entry))
            .map((entry) => entry.cwd)
        ]);
        const cwd = missingHistoryCwds.has(workspace.cwd) ? "" : workspace.cwd;
        const restorablePreviewSessionIds = new Set(
          restorableHistory.map(historyPreviewSessionId)
        );
        const restorableSessions = workspace.sessions.filter(
          (session) =>
            !missingHistoryCwds.has(session.cwd) &&
            (!isHistoryPreviewSessionId(session.sessionId) ||
              restorablePreviewSessionIds.has(session.sessionId))
        );
        const restorableHistoryKeys = new Set(
          restorableHistory.map((entry) => codexHistoryKey(entry))
        );
        const restorableSessionIds = new Set(
          restorableSessions.map((session) => session.sessionId)
        );
        const currentSessionId =
          workspace.currentSessionId && restorableSessionIds.has(workspace.currentSessionId)
            ? workspace.currentSessionId
            : null;
        const selectedHistoryKey =
          workspace.selectedHistoryKey &&
          restorableHistoryKeys.has(workspace.selectedHistoryKey)
            ? workspace.selectedHistoryKey
            : null;
        const sessionHistoryOrigins = Object.fromEntries(
          Object.entries(workspace.sessionHistoryOrigins).filter(([sessionId]) =>
            restorableSessionIds.has(sessionId)
          )
        );
        const restorableThreadIds = new Set([
          ...restorableHistory.map((entry) => entry.id),
          ...restorableSessions
            .filter((session) => !isHistoryPreviewSessionId(session.sessionId))
            .map((session) => session.threadId)
        ]);
        const loadedThreadIds = workspace.loadedThreadIds.filter((threadId) =>
          restorableThreadIds.has(threadId)
        );
        const snapshotWorkspace = {
          ...workspace,
          codexHistory: restorableHistory,
          currentSessionId,
          cwd,
          loadedThreadIds,
          selectedHistoryKey,
          sessionHistoryOrigins,
          sessions: restorableSessions
        };
        const hasSidebarState =
          restorableSessions.length > 0 ||
          restorableHistory.length > 0 ||
          loadedThreadIds.length > 0 ||
          currentSessionId !== null ||
          selectedHistoryKey !== null ||
          Object.keys(sessionHistoryOrigins).length > 0 ||
          resolvePreferredWorkspaceCwd(snapshotWorkspace).trim().length > 0;
        if (!hasSidebarState) {
          return null;
        }
        return [
          device.id,
          {
            codexHistory: restorableHistory,
            currentSessionId,
            cwd: resolvePreferredWorkspaceCwd(snapshotWorkspace),
            loadedThreadIds,
            selectedHistoryKey,
            sessionHistoryOrigins,
            sessions: restorableSessions
          }
        ] as const;
      })
      .filter((entry): entry is readonly [string, WorkspaceSidebarSnapshot] => Boolean(entry))
  );
}

export function useWebConsoleController() {
  const [error, setError] = useState<string | null>(null);
  const [migrationNotice, setMigrationNotice] = useState<string | null>(null);
  const [savedDevices, setSavedDevices] = useState<SavedDevice[]>([]);
  const [threadSidebarPrefs, setThreadSidebarPrefs] = useState<Record<string, ThreadSidebarPrefs>>({});
  const [projectSidebarPrefs, setProjectSidebarPrefs] = useState<Record<string, ProjectSidebarPrefs>>({});
  const [sessionSelections, setSessionSelections] = useState<
    Record<string, { currentSessionId: string | null; selectedHistoryKey: string | null }>
  >({});
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
  const [localStorageReady, setLocalStorageReady] = useState(false);
  const [serviceTier, setServiceTier] = useState<string | null>(null);
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
  const messageReconcileTimersRef = useRef(new Map<string, number>());
  const submitTraceByClientMessageRef = useRef(new Map<string, SubmitTraceContext>());
  const submitTraceByTurnRef = useRef(new Map<string, SubmitTraceContext>());
  const pendingSessionMessageQueuesRef = useRef(
    new Map<string, PendingSessionQueuedMessage[]>()
  );
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const historyPageCacheRef = useRef(
    new Map<string, { fetchedAt: number; page: LocalCodexHistoryPageResponse }>()
  );
  const activeHistoryLoadKeyRef = useRef<string | null>(null);
  const historyPrefetchQueueRef = useRef<HistoryPrefetchTask[]>([]);
  const activeHistoryPrefetchCountRef = useRef(0);
  const prefetchingHistoryKeysRef = useRef(new Set<string>());
  const refreshingHistoryKeysRef = useRef(new Set<string>());
  const historyAutoCompletionRef = useRef<{
    cursor: string;
    taskId: string;
    version: number;
  } | null>(null);
  const historyAutoCompletionVersionRef = useRef(0);
  const deviceHydrationVersionsRef = useRef(new Map<string, number>());
  const pendingHistoryHydrationsRef = useRef(new Set<string>());
  const desktopFrameRef = useRef<HTMLDivElement | null>(null);
  const sessionSidebarRef = useRef<HTMLElement | null>(null);
  const sidebarResizeCleanupRef = useRef<(() => void) | null>(null);
  const previousSessionIdRef = useRef<string | null | undefined>(undefined);
  const latestThreadSidebarPrefsRef = useRef(threadSidebarPrefs);
  const latestProjectSidebarPrefsRef = useRef(projectSidebarPrefs);
  const latestDeviceWorkspacesRef = useRef(deviceWorkspaces);
  const latestWorkspaceSidebarSnapshotRef = useRef("");
  const latestConversationCacheSnapshotRef = useRef("");
  const latestConversationOutboxSnapshotRef = useRef("");
  const selectedConversationRenderTraceRef = useRef("");

  const activeWorkspace = selectedDeviceId ? deviceWorkspaces[selectedDeviceId] ?? null : null;
  const selectedSavedDevice =
    selectedDeviceId
      ? savedDevices.find((device) => device.id === selectedDeviceId) ?? null
      : null;
  const selectedSavedDeviceConnection = selectedSavedDevice
    ? connectionFromSavedDevice(selectedSavedDevice, relayBootstrap?.sessionToken ?? null)
    : null;
  const connection: AgentConnection =
    activeWorkspace?.connection ??
    selectedSavedDeviceConnection ?? {
      mode: "relay",
      relayUrl: relayBootstrap?.relayUrl ?? resolveDefaultRelayUrl(),
      sessionToken: relayBootstrap?.sessionToken ?? "",
      deviceId: selectedSavedDevice?.deviceId ?? ""
    };
  const healthStatus = activeWorkspace?.healthStatus ?? null;
  const providerCatalog = activeWorkspace?.providerCatalog ?? null;
  const providerCatalogLoading = activeWorkspace?.providerCatalogLoading ?? false;
  const providerSelection = activeWorkspace?.providerSelection ?? EMPTY_PROVIDER_SELECTION;
  const providerApiKey = providerSelection.apiKey;
  const providerApiKeyEnv = providerSelection.apiKeyEnv;
  const providerBaseUrl = providerSelection.baseUrl;
  const providerLabel = providerSelection.label;
  const providerModel = providerSelection.model;
  const providerProfileId = providerSelection.profileId;
  const model = activeWorkspace?.model ?? modelOptions[0]!.value;
  const streamStatus = activeWorkspace?.streamStatus ?? "disconnected";
  const events = activeWorkspace?.events ?? [];
  const sessions = activeWorkspace?.sessions ?? [];
  const codexHistory = activeWorkspace?.codexHistory ?? [];
  const currentSessionId = activeWorkspace?.currentSessionId ?? null;
  const selectedHistoryKey = activeWorkspace?.selectedHistoryKey ?? null;
  const sessionHistoryOrigins = activeWorkspace?.sessionHistoryOrigins ?? {};
  const pendingApprovals = activeWorkspace?.pendingApprovals ?? [];
  const cwd = activeWorkspace?.cwd ?? "";
  const directoryList = activeWorkspace?.directoryList ?? null;
  const directoryError = activeWorkspace?.directoryError ?? null;
  const directoryLoading = activeWorkspace?.directoryLoading ?? false;
  const resumeStates = activeWorkspace?.resumeStates ?? {};
  const sessionSyncState = activeWorkspace?.sessionSyncState ?? "idle";
  const historySyncState = activeWorkspace?.historySyncState ?? "idle";
  const historyLoadingKey = activeWorkspace?.historyLoadingKey ?? null;
  const historyPages = activeWorkspace?.historyPages ?? {};
  const loadedThreadIds = activeWorkspace?.loadedThreadIds ?? [];
  const currentSession = currentSessionId
    ? sessions.find((session) => session.sessionId === currentSessionId) ?? null
    : null;
  const selectedConversationInput = currentSession
    ? {
        sessionId: currentSession.sessionId,
        ...(currentSession.threadId ? { threadId: currentSession.threadId } : {})
      }
    : null;
  const visibleChatItems = selectConversationChatItems(
    activeWorkspace,
    selectedConversationInput
  );
  const visibleTurnGroups = selectConversationTurnGroups(
    activeWorkspace,
    selectedConversationInput
  );
  const selectedConversationRenderSnapshot = selectConversationRenderSnapshot(
    activeWorkspace,
    selectedConversationInput
  );
  const currentHistoryPageState = currentSession
    ? historyPages[currentSession.sessionId] ?? null
    : null;
  const currentResumeState = currentSession ? resumeStates[currentSession.sessionId] ?? null : null;
  const initialHistoryLoading = Boolean(
    currentSession &&
      selectedConversationRenderSnapshot.messageCount === 0 &&
      currentResumeState !== "missing" &&
      currentResumeState !== "failed" &&
      (historyLoadingKey === selectedHistoryKey ||
        Boolean(
          currentSessionId &&
            sessionHistoryOrigins[currentSessionId] &&
            !currentHistoryPageState
        ))
  );
  const selectedHistoryEntry = selectedHistoryKey
    ? codexHistory.find((entry) => codexHistoryKey(entry) === selectedHistoryKey) ?? null
    : null;
  const connected = Boolean(
    healthStatus?.ok &&
      streamStatus !== "disconnected" &&
      streamStatus !== "error"
  );
  const codexProviderStatus =
    providerCatalog
      ? {
          available: providerCatalog.available,
          error: providerCatalog.error ?? null
        }
      : healthStatus?.codexProvider ?? null;
  const sidebarPrefsScopeKey = relayThreadPrefsScope(
    connection.relayUrl,
    connection.deviceId || "unbound"
  );
  const activeTurn = Boolean(currentSession?.activeTurnId);
  const currentGoal = currentSession?.goal ?? null;
  const hasCurrentGoal = Boolean(currentGoal?.objective?.trim());
  const selectedModel = modelOptions.find((option) => option.value === model) ?? modelOptions[0]!;
  const catalogProviderOptions = useMemo(
    () =>
      providerCatalog?.available
        ? [
            providerOptions[0]!,
            ...providerCatalog.providers.map((provider) => ({
              label: provider.label,
              preset: provider.preset,
              value: provider.preset
            })),
            providerOptions[providerOptions.length - 1]!
          ]
        : [providerOptions[0]!],
    [providerCatalog]
  );
  const selectedProviderOption =
    catalogProviderOptions.find((option) => option.value === providerProfileId) ?? catalogProviderOptions[0]!;
  const selectedProviderCatalog =
    providerCatalog?.available
      ? providerCatalog.providers.find((provider) => provider.preset === providerProfileId) ?? null
      : null;
  const providerAvailable = Boolean(providerCatalog?.available);
  const providerStatusMessage =
    connected && codexProviderStatus && !codexProviderStatus.available
      ? `当前设备未启用 CodexProvider：${codexProviderStatus.error ?? "请安装 codex-provider 或配置 CODEXNEXT_CODEX_PROVIDER_MODULE。"}`
      : connected && providerCatalog?.available === false
        ? `当前设备未启用 CodexProvider：${providerCatalog.error ?? "请安装 codex-provider 或配置 CODEXNEXT_CODEX_PROVIDER_MODULE。"}`
        : null;
  const providerModelOptions = selectedProviderCatalog?.models.map((entry) => ({
    label: entry.label,
    shortLabel: shortModelLabel(entry.label, entry.id),
    value: entry.id
  })) ?? [];
  const selectedProviderModel =
    providerModelOptions.find((option) => option.value === providerModel) ??
    providerModelOptions.find((option) => option.value === selectedProviderCatalog?.defaultModel) ??
    null;
  const currentSessionModelLabel = currentSession
    ? sessionActiveModelLabel(currentSession, providerCatalog)
    : null;
  const activeModelLabel =
    currentSessionModelLabel ??
    (selectedProviderOption.preset
      ? `${selectedProviderOption.label} · ${selectedProviderModel?.label ?? providerModel ?? selectedProviderCatalog?.defaultModel ?? "模型"}`
      : selectedModel.label);
  const activeReasoningEffort = currentSession?.reasoningEffort ?? reasoningEffort;
  const providerSessionRequest = useMemo(
    () =>
      buildProviderSessionRequest({
        apiKey: providerApiKey,
        apiKeyEnv: providerApiKeyEnv,
        baseUrl: providerBaseUrl,
        label: providerLabel,
        model: providerModel,
        option: selectedProviderOption
      }),
    [
      providerApiKey,
      providerApiKeyEnv,
      providerBaseUrl,
      providerLabel,
      providerModel,
      selectedProviderOption
    ]
  );
  const selectedReasoning =
    reasoningOptions.find((option) => option.value === activeReasoningEffort) ?? reasoningOptions[3]!;
  const activeThreadPrefs = getThreadSidebarPrefs(threadSidebarPrefs, sidebarPrefsScopeKey);
  const activeProjectPrefs = getProjectSidebarPrefs(projectSidebarPrefs, sidebarPrefsScopeKey);
  const relayEnabled =
    RELAY_CONFIGURED || Boolean(relayBootstrap) || savedDevices.length > 0;
  const sidebarSyncing =
    sessionSyncState === "loading" || historySyncState === "loading";
  const availablePermissionOptions = useMemo(
    () =>
      availableRelayPermissionOptions(permissionOptions, {
        relayEnabled,
        relayFullAccessEnabled: RELAY_FULL_ACCESS_ENABLED
      }),
    [relayEnabled]
  );

  useEffect(() => {
    if (!connected || !selectedDeviceId) {
      return;
    }
    let cancelled = false;
    const deviceId = selectedDeviceId;
    setDeviceWorkspaces((previous) => {
      const workspace = previous[deviceId];
      if (!workspace) {
        return previous;
      }
      return {
        ...previous,
        [deviceId]: {
          ...workspace,
          providerCatalogLoading: true
        }
      };
    });
    void listProviderCatalog(connection)
      .then((catalog) => {
        if (cancelled) {
          return;
        }
        setDeviceWorkspaces((previous) => {
          const workspace = previous[deviceId];
          if (!workspace) {
            return previous;
          }
          return {
            ...previous,
            [deviceId]: {
              ...workspace,
              providerCatalog: catalog,
              providerCatalogLoading: false
            }
          };
        });
      })
      .catch((err) => {
        webDevTrace("console.providers.catalog.error", webErrorSummary(err));
        if (cancelled) {
          return;
        }
        setDeviceWorkspaces((previous) => {
          const workspace = previous[deviceId];
          if (!workspace) {
            return previous;
          }
          return {
            ...previous,
            [deviceId]: {
              ...workspace,
              providerCatalog: {
                available: false,
                error: formatError(err),
                providers: []
              },
              providerCatalogLoading: false
            }
          };
        });
      });
    return () => {
      cancelled = true;
    };
  }, [connected, connection.deviceId, connection.relayUrl, connection.sessionToken, selectedDeviceId]);

  useEffect(() => {
    if (!selectedDeviceId || !providerProfileId || !providerCatalog) {
      return;
    }
    const providerStillAvailable =
      providerCatalog.available &&
      (providerProfileId === "custom" ||
        providerCatalog.providers.some((provider) => provider.preset === providerProfileId));
    if (providerStillAvailable) {
      return;
    }
    setDeviceWorkspaces((previous) => {
      const workspace = previous[selectedDeviceId];
      if (!workspace) {
        return previous;
      }
      return {
        ...previous,
        [selectedDeviceId]: {
          ...workspace,
          providerSelection: EMPTY_PROVIDER_SELECTION
        }
      };
    });
  }, [providerCatalog, providerProfileId, selectedDeviceId]);

  useEffect(() => {
    if (!selectedProviderCatalog || providerModel) {
      return;
    }
    updateProviderSelection({
      apiKeyEnv: providerApiKeyEnv || selectedProviderCatalog.apiKeyEnv,
      model: selectedProviderCatalog.defaultModel
    });
  }, [providerApiKeyEnv, providerModel, selectedProviderCatalog]);
  const selectedPermission =
    availablePermissionOptions.find((option) => option.mode === permissionMode) ??
    availablePermissionOptions[0]!;
  const relayConnectionInfo = relayBootstrap
    ? {
        accessToken: relayBootstrap.sessionToken,
        relayUrl: relayBootstrap.relayUrl
      }
    : connection.mode === "relay"
      ? {
          accessToken: connection.sessionToken,
          relayUrl: connection.relayUrl
        }
      : null;
  const relaySessionToken =
    relayBootstrap?.sessionToken ??
    (connection.mode === "relay" ? connection.sessionToken : null);
  const connectionForSavedDevice = useCallback(
    (device: SavedDevice): AgentConnection | null =>
      connectionFromSavedDevice(device, relaySessionToken),
    [relaySessionToken]
  );
  const desktopFrameStyle = useMemo(
    () => ({ "--cn-sidebar-width": `${clampSidebarWidth(sidebarWidth)}px` }) as CSSProperties,
    [sidebarWidth]
  );
  const deviceDisplayName =
    deviceName || healthStatus?.device?.defaultName || "CodexNext relay";
  const threadNoticesByItemId = useMemo<Record<string, ThreadSidebarNotice>>(() => {
    if (selectedHistoryEntry && currentResumeState === "missing") {
      return {
        [codexHistoryKey(selectedHistoryEntry)]: {
          text: formatMissingHistoryFolderShortMessage(selectedHistoryEntry.cwd),
          tone: "danger"
        }
      };
    }
    if (selectedHistoryEntry && currentResumeState === "failed") {
      return {
        [codexHistoryKey(selectedHistoryEntry)]: {
          text: "这条记录暂时打不开",
          tone: "danger"
        }
      };
    }
    if (currentSession?.status === "failed" || currentSession?.status === "error") {
      return {
        [currentSession.sessionId]: {
          text: "本轮执行失败",
          tone: "danger"
        }
      };
    }
    return {};
  }, [currentResumeState, currentSession, selectedHistoryEntry]);
  const sessionTitlesById = useMemo(() => {
    const titles: Record<string, string> = {};
    for (const session of sessions) {
      titles[session.sessionId] = sessionTitleFromTurnGroups(
        session,
        selectConversationTurnGroups(activeWorkspace, {
          sessionId: session.sessionId,
          ...(session.threadId ? { threadId: session.threadId } : {})
        }),
        codexHistory
      );
    }
    return titles;
  }, [activeWorkspace, codexHistory, sessions]);
  const projectGroups = groupProjectThreads(
    sessions,
    codexHistory,
    sessionTitlesById,
    activeThreadPrefs,
    activeProjectPrefs,
    currentSessionId,
    selectedHistoryKey,
    threadNoticesByItemId
  );
  const pinnedThreadItems = useMemo(
    () =>
      projectGroups
        .flatMap((group) => group.items.filter((item) => item.pinned))
        .sort((left, right) => right.timestamp - left.timestamp),
    [projectGroups]
  );
  const visibleProjectGroups = useMemo(
    () =>
      projectGroups
        .map((group) => ({
          ...group,
          items: group.items.filter((item) => !item.pinned)
        }))
        .filter((group) => group.items.length > 0),
    [projectGroups]
  );
  const firstApproval = pendingApprovals[0] ?? null;

  const patchDeviceWorkspace = useCallback(
    (deviceId: string, updater: (workspace: DeviceWorkspace) => DeviceWorkspace) => {
      setDeviceWorkspaces((previous) => {
        const device = savedDevices.find((item) => item.id === deviceId);
        const current =
          previous[deviceId] ??
          createDeviceWorkspace(
            (device ? connectionForSavedDevice(device) : null) ?? {
              mode: "relay",
              relayUrl: relayBootstrap?.relayUrl ?? resolveDefaultRelayUrl(),
              sessionToken: relayBootstrap?.sessionToken ?? "",
              deviceId: device?.deviceId ?? ""
            }
          );
        return {
          ...previous,
          [deviceId]: updater(current)
        };
      });
    },
    [connectionForSavedDevice, relayBootstrap, savedDevices]
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

  function updateProviderSelection(updates: Partial<WorkspaceProviderSelection>) {
    const deviceId = selectedDeviceId ?? selectedDeviceIdRef.current;
    if (!deviceId) {
      return;
    }
    setDeviceWorkspaces((previous) => {
      const workspace = previous[deviceId];
      if (!workspace) {
        return previous;
      }
      return {
        ...previous,
        [deviceId]: {
          ...workspace,
          providerSelection: {
            ...workspace.providerSelection,
            ...updates
          }
        }
      };
    });
  }

  function setModel(value: string) {
    const deviceId = selectedDeviceId ?? selectedDeviceIdRef.current;
    if (!deviceId) {
      return;
    }
    setDeviceWorkspaces((previous) => {
      const workspace = previous[deviceId];
      if (!workspace) {
        return previous;
      }
      return {
        ...previous,
        [deviceId]: {
          ...workspace,
          model: value
        }
      };
    });
  }

  function selectProviderProfile(value: string) {
    const catalogEntry = providerCatalog?.available
      ? providerCatalog.providers.find((provider) => provider.preset === value) ?? null
      : null;
    updateProviderSelection({
      apiKeyEnv: catalogEntry?.apiKeyEnv ?? "",
      baseUrl: "",
      label: "",
      model: catalogEntry?.defaultModel ?? "",
      profileId: value
    });
  }

  function setProviderModel(value: string) {
    updateProviderSelection({ model: value });
  }

  function setProviderBaseUrl(value: string) {
    updateProviderSelection({ baseUrl: value });
  }

  function setProviderLabel(value: string) {
    updateProviderSelection({ label: value });
  }

  function setProviderApiKey(value: string) {
    updateProviderSelection({ apiKey: value });
  }

  function setProviderApiKeyEnv(value: string) {
    updateProviderSelection({ apiKeyEnv: value });
  }

  function historyAutoCompletionTaskId(deviceId: string, sessionId: string): string {
    return `${deviceId}:${sessionId}`;
  }

  function isCurrentHistoryAutoCompletion(taskId: string, version: number): boolean {
    const active = historyAutoCompletionRef.current;
    return Boolean(active && active.taskId === taskId && active.version === version);
  }

  function isHistoryAutoCompletionSelectionCurrent(input: HistoryAutoCompletionInput): boolean {
    const workspace = latestDeviceWorkspacesRef.current[input.deviceId];
    return Boolean(
      workspace &&
        workspace.currentSessionId === input.sessionId &&
        isSameAgentConnection(workspace.connection, input.connection)
    );
  }

  function mergeHistoryItemsById<T extends { id: string }>(items: T[]): T[] {
    const seen = new Set<string>();
    const merged: T[] = [];
    for (const item of items) {
      if (seen.has(item.id)) {
        continue;
      }
      seen.add(item.id);
      merged.push(item);
    }
    return merged;
  }

  function prependHistoryPageCache(
    sourceKey: string,
    page: LocalCodexHistoryPageResponse
  ): LocalCodexHistoryPageResponse {
    const existing = historyPageCacheRef.current.get(sourceKey)?.page ?? null;
    const merged: LocalCodexHistoryPageResponse = existing
      ? {
          entry: page.entry,
          messages: mergeHistoryItemsById([...page.messages, ...existing.messages]),
          turns: mergeHistoryItemsById([...page.turns, ...existing.turns]),
          nextCursor: page.nextCursor,
          backwardsCursor: existing.backwardsCursor ?? page.backwardsCursor
        }
      : page;
    historyPageCacheRef.current.set(sourceKey, {
      fetchedAt: Date.now(),
      page: merged
    });
    return merged;
  }

  function writeFreshHistoryPageCache(
    sourceKey: string,
    page: LocalCodexHistoryPageResponse
  ): LocalCodexHistoryPageResponse {
    const existing = historyPageCacheRef.current.get(sourceKey)?.page ?? null;
    const freshMessageIds = new Set(page.messages.map((item) => item.id));
    const freshTurnIds = new Set(page.turns.map((item) => item.id));
    const merged: LocalCodexHistoryPageResponse = existing
      ? {
          entry: page.entry,
          messages: [
            ...existing.messages.filter((item) => !freshMessageIds.has(item.id)),
            ...page.messages
          ],
          turns: [
            ...existing.turns.filter((item) => !freshTurnIds.has(item.id)),
            ...page.turns
          ],
          nextCursor: existing.nextCursor,
          backwardsCursor: page.backwardsCursor ?? existing.backwardsCursor
        }
      : page;
    historyPageCacheRef.current.set(sourceKey, {
      fetchedAt: Date.now(),
      page: merged
    });
    return merged;
  }

  function cancelHistoryAutoCompletion(reason: string) {
    const active = historyAutoCompletionRef.current;
    if (!active) {
      return;
    }
    historyAutoCompletionVersionRef.current += 1;
    historyAutoCompletionRef.current = null;
    if (activeHistoryLoadKeyRef.current?.startsWith("auto:")) {
      activeHistoryLoadKeyRef.current = null;
    }
    webDevTrace("console.history.auto_complete.cancel", {
      reason,
      taskId: active.taskId
    });
    pumpHistoryPrefetchQueue();
  }

  function startHistoryAutoCompletion(input: HistoryAutoCompletionInput) {
    const cachedRecord = historyPageCacheRef.current.get(input.sourceKey) ?? null;
    const cachedCursor = cachedRecord ? cachedRecord.page.nextCursor : input.cursor;
    if (!cachedCursor) {
      return;
    }
    if (input.connection.mode === "relay" && !input.connection.sessionToken) {
      return;
    }
    if (!isHistoryAutoCompletionSelectionCurrent(input)) {
      return;
    }
    const taskId = historyAutoCompletionTaskId(input.deviceId, input.sessionId);
    const active = historyAutoCompletionRef.current;
    if (active?.taskId === taskId) {
      return;
    }
    if (active) {
      cancelHistoryAutoCompletion("superseded");
    }
    const version = historyAutoCompletionVersionRef.current + 1;
    historyAutoCompletionVersionRef.current = version;
    historyAutoCompletionRef.current = {
      cursor: cachedCursor,
      taskId,
      version
    };
    activeHistoryLoadKeyRef.current = `auto:${input.sourceKey}`;
    historyPrefetchQueueRef.current = [];
    void runHistoryAutoCompletion({
      ...input,
      cursor: cachedCursor,
      taskId,
      version
    });
  }

  async function runHistoryAutoCompletion(
    input: HistoryAutoCompletionInput & { taskId: string; version: number }
  ) {
    let cursor: string | null = input.cursor;
    let pageCount = 0;
    let turnCount = 0;
    let failedCursor: string | null = null;
    let stoppedByLimit = false;
    webDevTrace("console.history.auto_complete.begin", {
      deviceId: input.deviceId,
      sessionId: input.sessionId,
      threadId: input.threadId,
      cwd: input.cwd,
      cursorPresent: Boolean(cursor)
    });

    try {
      while (
        cursor &&
        isCurrentHistoryAutoCompletion(input.taskId, input.version) &&
        isHistoryAutoCompletionSelectionCurrent(input)
      ) {
        if (pageCount >= HISTORY_AUTO_COMPLETE_MAX_PAGES) {
          webDevTrace("console.history.auto_complete.limit", {
            deviceId: input.deviceId,
            sessionId: input.sessionId,
            threadId: input.threadId,
            pageCount,
            remainingCursor: cursor
          });
          stoppedByLimit = true;
          break;
        }

        const page = await getCodexHistoryTurns(input.connection, {
          id: input.threadId,
          cwd: input.cwd,
          cursor,
          limit: HISTORY_AUTO_COMPLETE_PAGE_LIMIT
        });
        if (!isHistoryAutoCompletionSelectionCurrent(input)) {
          webDevTrace("console.history.auto_complete.stale_selection", {
            deviceId: input.deviceId,
            sessionId: input.sessionId,
            threadId: input.threadId
          });
          break;
        }
        if (!isCurrentHistoryAutoCompletion(input.taskId, input.version)) {
          webDevTrace("console.history.auto_complete.stale_page", {
            deviceId: input.deviceId,
            sessionId: input.sessionId,
            threadId: input.threadId
          });
          break;
        }

        pageCount += 1;
        turnCount += page.turns.length;
        const cachedPage = prependHistoryPageCache(input.sourceKey, page);
        cursor = cachedPage.nextCursor;
        webDevTrace("console.history.auto_complete.page", {
          deviceId: input.deviceId,
          sessionId: input.sessionId,
          threadId: input.threadId,
          pageCount,
          cachedTurnCount: cachedPage.turns.length,
          pageTurnCount: page.turns.length,
          hasNextCursor: Boolean(page.nextCursor)
        });

        await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      }
    } catch (err) {
      if (isCurrentHistoryAutoCompletion(input.taskId, input.version)) {
        failedCursor = cursor;
        webDevTrace("console.history.auto_complete.error", {
          deviceId: input.deviceId,
          sessionId: input.sessionId,
          threadId: input.threadId,
          pageCount,
          ...webErrorSummary(err)
        });
      }
    } finally {
      if (isCurrentHistoryAutoCompletion(input.taskId, input.version)) {
        historyAutoCompletionRef.current = null;
        if (activeHistoryLoadKeyRef.current === `auto:${input.sourceKey}`) {
          activeHistoryLoadKeyRef.current = null;
        }
        webDevTrace("console.history.auto_complete.end", {
          deviceId: input.deviceId,
          sessionId: input.sessionId,
          threadId: input.threadId,
          failedCursor: failedCursor ?? (stoppedByLimit ? cursor : null),
          pageCount,
          turnCount,
          complete: cursor === null
        });
        pumpHistoryPrefetchQueue();
      }
    }
  }

  function rememberSubmitTrace(context: SubmitTraceContext) {
    submitTraceByClientMessageRef.current.set(context.clientMessageId, context);
    if (context.turnId) {
      submitTraceByTurnRef.current.set(context.turnId, context);
    }
  }

  function updateSubmitTrace(
    clientMessageId: string,
    updates: Partial<Pick<SubmitTraceContext, "deviceId" | "sessionId" | "turnId">>
  ) {
    const current = submitTraceByClientMessageRef.current.get(clientMessageId);
    if (!current) {
      return null;
    }
    const next = { ...current, ...updates };
    submitTraceByClientMessageRef.current.set(clientMessageId, next);
    if (next.turnId) {
      submitTraceByTurnRef.current.set(next.turnId, next);
    }
    return next;
  }

  function forgetSubmitTrace(clientMessageId: string) {
    const current = submitTraceByClientMessageRef.current.get(clientMessageId);
    submitTraceByClientMessageRef.current.delete(clientMessageId);
    if (current?.turnId) {
      submitTraceByTurnRef.current.delete(current.turnId);
    }
  }

  function traceSubmitStep(
    event: string,
    context: SubmitTraceContext,
    fields: Record<string, unknown> = {}
  ) {
    webDevTrace(event, {
      submitTraceId: context.submitTraceId,
      clientMessageId: context.clientMessageId,
      deviceId: context.deviceId,
      kind: context.kind,
      sessionId: context.sessionId,
      turnId: context.turnId,
      textLength: context.textLength,
      ageMs: Date.now() - context.startedAt,
      ...fields
    });
  }

  function traceSubmitFailed(
    context: SubmitTraceContext,
    fields: Record<string, unknown> = {}
  ) {
    traceSubmitStep("console.submit.failed", context, fields);
    forgetSubmitTrace(context.clientMessageId);
  }

  function traceSubmitReconciled(
    context: SubmitTraceContext,
    fields: Record<string, unknown> = {}
  ) {
    traceSubmitStep("console.submit.reconciled", context, fields);
    forgetSubmitTrace(context.clientMessageId);
  }

  function traceSubmitStreamEvents(deviceId: string, events: LocalEvent[]) {
    for (const event of events) {
      const eventClientMessageId = readEventClientMessageId(event);
      const context =
        (eventClientMessageId
          ? submitTraceByClientMessageRef.current.get(eventClientMessageId)
          : null) ??
        (event.turnId ? submitTraceByTurnRef.current.get(event.turnId) : null);
      if (!context) {
        continue;
      }
      const nextContext = updateSubmitTrace(context.clientMessageId, {
        deviceId,
        ...(event.sessionId ? { sessionId: event.sessionId } : {}),
        ...(event.turnId ? { turnId: event.turnId } : {})
      }) ?? context;
      traceSubmitStep("console.submit.stream_seen", nextContext, {
        eventId: event.id,
        eventType: event.type,
        eventSeq: event.seq,
        eventClientMessageId,
        eventSessionId: event.sessionId,
        eventThreadId: event.threadId,
        eventTurnId: event.turnId
      });
      if (event.type === "agent.error" || event.type === "codex.error") {
        traceSubmitFailed(nextContext, {
          source: "stream_error",
          eventId: event.id,
          eventSeq: event.seq,
          eventType: event.type
        });
      }
    }
  }

  function enqueuePendingSessionMessage(
    pendingSessionIdValue: string,
    queuedMessage: PendingSessionQueuedMessage
  ) {
    const queued = pendingSessionMessageQueuesRef.current.get(pendingSessionIdValue) ?? [];
    pendingSessionMessageQueuesRef.current.set(pendingSessionIdValue, [
      ...queued,
      queuedMessage
    ]);
    traceSubmitStep("console.submit.pending_session_queued", queuedMessage.context, {
      pendingSessionId: pendingSessionIdValue,
      queuePosition: queued.length + 1
    });
  }

  function updatePendingSessionMessageQueue(
    pendingSessionIdValue: string,
    input: LocalQueueActionInput
  ) {
    const queued = pendingSessionMessageQueuesRef.current.get(pendingSessionIdValue) ?? [];
    if (queued.length === 0) {
      return;
    }
    if (input.action === "clear") {
      pendingSessionMessageQueuesRef.current.delete(pendingSessionIdValue);
      return;
    }
    if (input.action === "reorder") {
      const byId = new Map(queued.map((message) => [message.clientMessageId, message]));
      const ordered = [
        ...input.clientMessageIds.flatMap((clientMessageId) => {
          const message = byId.get(clientMessageId);
          return message ? [message] : [];
        }),
        ...queued.filter(
          (message) => !input.clientMessageIds.includes(message.clientMessageId)
        )
      ];
      pendingSessionMessageQueuesRef.current.set(pendingSessionIdValue, ordered);
      return;
    }
    if (input.action === "delete") {
      const remaining = queued.filter(
        (message) => message.clientMessageId !== input.clientMessageId
      );
      if (remaining.length) {
        pendingSessionMessageQueuesRef.current.set(pendingSessionIdValue, remaining);
      } else {
        pendingSessionMessageQueuesRef.current.delete(pendingSessionIdValue);
      }
      return;
    }
    if (input.action === "edit") {
      pendingSessionMessageQueuesRef.current.set(
        pendingSessionIdValue,
        queued.map((message) =>
          message.clientMessageId === input.clientMessageId
            ? {
                ...message,
                context: {
                  ...message.context,
                  textLength: input.text.length
                },
                message: input.text
              }
            : message
        )
      );
      return;
    }
    const selected = queued.find(
      (message) => message.clientMessageId === input.clientMessageId
    );
    if (!selected) {
      return;
    }
    pendingSessionMessageQueuesRef.current.set(pendingSessionIdValue, [
      { ...selected, submitMode: "steer" },
      ...queued.filter((message) => message.clientMessageId !== input.clientMessageId)
    ]);
  }

  function failPendingSessionMessageQueue(
    pendingSessionIdValue: string,
    error: unknown
  ) {
    const queued = pendingSessionMessageQueuesRef.current.get(pendingSessionIdValue) ?? [];
    pendingSessionMessageQueuesRef.current.delete(pendingSessionIdValue);
    if (queued.length === 0) {
      return;
    }
    const message = formatError(error);
    patchActiveWorkspace((workspace) => {
      let next = workspace;
      for (const queuedMessage of queued) {
        next = markOptimisticMessageFailed(next, queuedMessage.clientMessageId, message);
      }
      return next;
    });
    for (const queuedMessage of queued) {
      traceSubmitFailed(queuedMessage.context, {
        source: "pending_session_create_failed",
        pendingSessionId: pendingSessionIdValue,
        ...webErrorSummary(error)
      });
    }
  }

  async function drainPendingSessionMessageQueue(input: {
    connection: AgentConnection;
    pendingSessionIdValue: string;
    sessionId: string;
    threadId?: string | null | undefined;
  }) {
    while (true) {
      const queued =
        pendingSessionMessageQueuesRef.current.get(input.pendingSessionIdValue) ?? [];
      pendingSessionMessageQueuesRef.current.delete(input.pendingSessionIdValue);
      if (queued.length === 0) {
        return;
      }
      webDevTrace("console.submit.pending_session_drain.begin", {
        pendingSessionId: input.pendingSessionIdValue,
        sessionId: input.sessionId,
        threadId: input.threadId ?? null,
        count: queued.length
      });
      for (const queuedMessage of queued) {
        const pendingSubmitMode = queuedMessage.submitMode ?? "queue";
        const context =
          updateSubmitTrace(queuedMessage.clientMessageId, {
            sessionId: input.sessionId
          }) ?? queuedMessage.context;
        traceSubmitStep("console.submit.rpc_start", context, {
          operation: "drain_pending_session_message",
          pendingSessionId: input.pendingSessionIdValue,
          sessionId: input.sessionId,
          threadId: input.threadId ?? null,
          activeSubmitMode: pendingSubmitMode
        });
        try {
          const result = await sendSessionMessage(input.connection, input.sessionId, {
            text: queuedMessage.message,
            clientMessageId: queuedMessage.clientMessageId,
            serviceTier: queuedMessage.serviceTier ?? serviceTier,
            submitMode: pendingSubmitMode
          });
          if (result.mode === "queued") {
            traceSubmitStep("console.submit.ack", context, {
              operation: "drain_pending_session_message",
              mode: result.mode,
              queuePosition: result.queuePosition,
              sessionId: input.sessionId
            });
            patchActiveWorkspace((workspace) =>
              markOptimisticMessageQueued(workspace, queuedMessage.clientMessageId, {
                sessionId: input.sessionId,
                ...(input.threadId ? { threadId: input.threadId } : {})
              })
            );
            continue;
          }
          const sentContext =
            updateSubmitTrace(queuedMessage.clientMessageId, {
              sessionId: input.sessionId,
              turnId: result.turnId
            }) ?? context;
          traceSubmitStep("console.submit.ack", sentContext, {
            operation: "drain_pending_session_message",
            mode: result.mode,
            sessionId: input.sessionId,
            turnId: result.turnId
          });
          patchActiveWorkspace((workspace) =>
            markOptimisticMessageSent(workspace, queuedMessage.clientMessageId, {
              sessionId: input.sessionId,
              ...(input.threadId ? { threadId: input.threadId } : {}),
              turnId: result.turnId
            })
          );
          const selectedDeviceId = selectedDeviceIdRef.current;
          if (selectedDeviceId) {
            scheduleMessageReconciliation({
              clientMessageId: queuedMessage.clientMessageId,
              connection: input.connection,
              deviceId: selectedDeviceId,
              messageText: queuedMessage.message,
              sessionId: input.sessionId,
              submitTraceId: sentContext.submitTraceId,
              turnId: result.turnId
            });
          }
        } catch (error) {
          traceSubmitFailed(context, {
            operation: "drain_pending_session_message",
            sessionId: input.sessionId,
            pendingSessionId: input.pendingSessionIdValue,
            ...webErrorSummary(error)
          });
          patchActiveWorkspace((workspace) =>
            markOptimisticMessageFailed(
              workspace,
              queuedMessage.clientMessageId,
              formatError(error)
            )
          );
        }
      }
    }
  }

  const beginDeviceHydration = useCallback((deviceId: string) => {
    const nextVersion = (deviceHydrationVersionsRef.current.get(deviceId) ?? 0) + 1;
    deviceHydrationVersionsRef.current.set(deviceId, nextVersion);
    return nextVersion;
  }, []);

  const isCurrentDeviceHydration = useCallback((deviceId: string, version: number) => {
    return deviceHydrationVersionsRef.current.get(deviceId) === version;
  }, []);

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
      if (workspace.connection.mode === "relay" && !workspace.connection.sessionToken) {
        return;
      }
      const session = workspace.sessions.find((item) => item.sessionId === sessionId) ?? null;
      if (!session) {
        return;
      }
      if (isHistoryPreviewSessionId(sessionId)) {
        return;
      }
      const historyThreadId = workspace.sessionHistoryOrigins[sessionId];
      if (!historyThreadId) {
        return;
      }
      if (workspace.missingHistoryCwds.includes(session.cwd)) {
        patchDeviceWorkspace(deviceId, (currentWorkspace) => {
          const nextOrigins = { ...currentWorkspace.sessionHistoryOrigins };
          delete nextOrigins[sessionId];
          return {
            ...currentWorkspace,
            sessionHistoryOrigins: nextOrigins
          };
        });
        return;
      }
      const alreadyHydrated = selectSessionHistoryHydrated(workspace, sessionId);
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
        const page = await getCodexHistoryTurns(workspace.connection, {
          id: historyThreadId,
          cwd: entry?.cwd ?? session.cwd
        });
        writeFreshHistoryPageCache(cacheKey, page);
        patchDeviceWorkspace(deviceId, (currentWorkspace) => {
          const hasHistory = selectSessionHistoryHydrated(currentWorkspace, sessionId);
          if (hasHistory) {
            return currentWorkspace;
          }
          return setSessionHistoryPageState(
            hydrateSessionFromTurns(currentWorkspace, sessionId, page.turns),
            sessionId,
            {
              autoCompleteFailedCursor: null,
              loadingOlder: false,
              olderCursor: page.nextCursor,
              sourceKey: cacheKey
            }
          );
        });
        if (page.nextCursor) {
          startHistoryAutoCompletion({
            connection: workspace.connection,
            cursor: page.nextCursor,
            cwd: entry?.cwd ?? session.cwd,
            deviceId,
            sessionId,
            sourceKey: cacheKey,
            threadId: historyThreadId
          });
        }
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
    latestDeviceWorkspacesRef.current = deviceWorkspaces;
  }, [deviceWorkspaces]);

  useEffect(() => {
    if (!currentSessionId || !sessionHistoryOrigins[currentSessionId]) {
      return;
    }
    void ensureSessionHistoryHydrated(currentSessionId);
  }, [currentSessionId, ensureSessionHistoryHydrated, sessionHistoryOrigins]);

  useEffect(() => {
    if (!selectedDeviceId || !currentSession || !currentHistoryPageState?.olderCursor) {
      return;
    }
    if (
      currentHistoryPageState.autoCompleteFailedCursor ===
      currentHistoryPageState.olderCursor
    ) {
      return;
    }
    const threadId =
      currentSession.threadId ?? sessionHistoryOrigins[currentSession.sessionId] ?? null;
    if (!threadId) {
      return;
    }
    startHistoryAutoCompletion({
      connection,
      cursor: currentHistoryPageState.olderCursor,
      cwd: currentSession.cwd,
      deviceId: selectedDeviceId,
      sessionId: currentSession.sessionId,
      sourceKey:
        currentHistoryPageState.sourceKey ?? `${threadId}::${currentSession.cwd}`,
      threadId
    });
  }, [
    connection,
    currentHistoryPageState?.autoCompleteFailedCursor,
    currentHistoryPageState?.olderCursor,
    currentHistoryPageState?.sourceKey,
    currentSession,
    selectedDeviceId,
    sessionHistoryOrigins
  ]);

  useEffect(() => {
    const signature = JSON.stringify({
      deviceId: selectedDeviceId,
      selectedHistoryKey,
      sessionId: currentSession?.sessionId ?? null,
      key: selectedConversationRenderSnapshot.key,
      latestSeq: selectedConversationRenderSnapshot.latestSeq,
      messageCount: selectedConversationRenderSnapshot.messageCount,
      statusSignature: selectedConversationRenderSnapshot.statusSignature
    });
    if (signature === selectedConversationRenderTraceRef.current) {
      return;
    }
    selectedConversationRenderTraceRef.current = signature;
    const statusCounts = summarizeTurnGroupStatusCounts(visibleTurnGroups);
    const latestItem = latestTurnGroupItemSummary(visibleTurnGroups);
    webDevTrace("console.render.selected_conversation", {
      deviceId: selectedDeviceId,
      selectedHistoryKey,
      sessionId: currentSession?.sessionId ?? null,
      threadId: currentSession?.threadId ?? null,
      conversationKey: selectedConversationRenderSnapshot.key,
      latestSeq: selectedConversationRenderSnapshot.latestSeq,
      messageCount: selectedConversationRenderSnapshot.messageCount,
      statusCounts,
      latestItem
    });
  }, [
    currentSession?.sessionId,
    currentSession?.threadId,
    selectedConversationRenderSnapshot.key,
    selectedConversationRenderSnapshot.latestSeq,
    selectedConversationRenderSnapshot.messageCount,
    selectedConversationRenderSnapshot.statusSignature,
    selectedDeviceId,
    selectedHistoryKey,
    visibleTurnGroups
  ]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { devices: storedDevices, droppedLegacyDirectDevices } = readSavedDevicesState();
      const storedSidebarWidth = readSidebarWidth(clampSidebarWidth);
      const storedThreadPrefs = readThreadSidebarPrefs();
      const storedProjectPrefs = readProjectSidebarPrefs();
      const storedSessionSelections = readSessionSelectionStorage();
      const storedWorkspaceSnapshots = readWorkspaceSidebarSnapshotsStorage();
      const storedConversationOutbox = readConversationOutboxStorage();
      const storedConversationCache = await readConversationCacheStorage();
      if (cancelled) {
        return;
      }
      const params = new URLSearchParams(window.location.search);
      const queryDeviceId = params.get("deviceId");

      setSavedDevices(storedDevices);
      setDeviceWorkspaces(
        Object.fromEntries(
          storedDevices
            .map((device) => {
              const snapshot = storedWorkspaceSnapshots[device.id];
              const outboxEntries = storedConversationOutbox[device.id] ?? [];
              const cacheEntries = storedConversationCache[device.id] ?? [];
              if (!snapshot && outboxEntries.length === 0 && cacheEntries.length === 0) {
                return null;
              }
              const deviceConnection: AgentConnection = {
                mode: "relay",
                relayUrl: device.relayUrl,
                sessionToken: "",
                deviceId: device.deviceId
              };
              const restored = snapshot
                ? restoreWorkspaceFromSidebarSnapshot(deviceConnection, snapshot)
                : createDeviceWorkspace(deviceConnection);
              return [
                device.id,
                restoreOutboxEntries(
                  restoreConversationCacheEntries(restored, cacheEntries),
                  outboxEntries
                )
              ] as const;
            })
            .filter((entry): entry is readonly [string, DeviceWorkspace] => Boolean(entry))
        )
      );
      if (storedSidebarWidth !== null) {
        setSidebarWidth(storedSidebarWidth);
      }
      setThreadSidebarPrefs(storedThreadPrefs);
      setProjectSidebarPrefs(storedProjectPrefs);
      setSessionSelections(storedSessionSelections);
      latestWorkspaceSidebarSnapshotRef.current = JSON.stringify(storedWorkspaceSnapshots);
      latestConversationOutboxSnapshotRef.current = JSON.stringify(storedConversationOutbox);
      latestConversationCacheSnapshotRef.current = conversationCacheSignature(storedConversationCache);
      setLocalStorageReady(true);

      if (droppedLegacyDirectDevices > 0) {
        const noticeSeen = hasRelayOnlyMigrationNoticeSeen(window.localStorage);
        if (!noticeSeen) {
          writeRelayOnlyMigrationNoticeSeen(window.localStorage);
          setMigrationNotice(
            `已移除 ${droppedLegacyDirectDevices} 个旧版直连设备。现在请通过“接入设备”完成配对。`
          );
        }
      }

      const preferredDevice = queryDeviceId
        ? storedDevices.find((device) => device.id === queryDeviceId || device.deviceId === queryDeviceId) ?? null
        : [...storedDevices].sort((a, b) => (b.lastConnectedAt ?? 0) - (a.lastConnectedAt ?? 0))[0] ?? null;

      if (preferredDevice) {
        setSelectedDeviceId(preferredDevice.id);
        setDeviceName(preferredDevice.name);
      }

      if (!resolveDefaultRelayUrl()) {
        return;
      }

      void requestRelaySession()
        .then((session) => {
          if (!session || cancelled) {
            return;
          }
          setRelayBootstrap({
            sessionToken: session.sessionToken,
            relayUrl: normalizeAgentUrl(session.relayUrl)
          });
          if (queryDeviceId) {
            setSelectedDeviceId(queryDeviceId);
          }
        })
        .catch((sessionError) => {
          if (!cancelled) {
            setError(formatConsoleError(sessionError));
          }
        });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!localStorageReady) {
      return;
    }
    const snapshots = buildWorkspaceSidebarSnapshots(savedDevices, deviceWorkspaces);
    const serialized = JSON.stringify(snapshots);
    if (serialized === latestWorkspaceSidebarSnapshotRef.current) {
      return;
    }
    latestWorkspaceSidebarSnapshotRef.current = serialized;
    try {
      writeWorkspaceSidebarSnapshotsStorage(window.localStorage, snapshots);
    } catch {
      // Ignore local snapshot persistence failures; live data remains authoritative.
    }
  }, [deviceWorkspaces, localStorageReady, savedDevices]);

  useEffect(() => {
    if (!localStorageReady) {
      return;
    }
    const now = Date.now();
    const outboxByDeviceId = Object.fromEntries(
      savedDevices
        .map((device) => {
          const workspace = deviceWorkspaces[device.id];
          if (!workspace) {
            return null;
          }
          const entries = Object.values(workspace.outbox)
            .filter(
              (entry) =>
                entry.status !== "complete" &&
                (entry.status !== "failed" || now - entry.updatedAt < 60 * 60_000)
            )
            .sort((left, right) => left.createdAt - right.createdAt)
            .slice(-50);
          return entries.length > 0 ? ([device.id, entries] as const) : null;
        })
        .filter((entry): entry is readonly [string, OutboxEntry[]] => Boolean(entry))
    );
    const serialized = JSON.stringify(outboxByDeviceId);
    if (serialized === latestConversationOutboxSnapshotRef.current) {
      return;
    }
    latestConversationOutboxSnapshotRef.current = serialized;
    try {
      writeConversationOutboxStorage(window.localStorage, outboxByDeviceId);
    } catch {
      // Outbox persistence is a recovery layer; live state remains in memory.
    }
  }, [deviceWorkspaces, localStorageReady, savedDevices]);

  useEffect(() => {
    if (!localStorageReady) {
      return;
    }
    const entriesByDeviceId = Object.fromEntries(
      savedDevices.map((device) => [
        device.id,
        deviceWorkspaces[device.id]
          ? buildConversationCacheEntries(deviceWorkspaces[device.id]!)
          : []
      ])
    );
    const serialized = conversationCacheSignature(entriesByDeviceId);
    if (serialized === latestConversationCacheSnapshotRef.current) {
      return;
    }
    latestConversationCacheSnapshotRef.current = serialized;
    const timeoutId = window.setTimeout(() => {
      void writeConversationCacheStorage(entriesByDeviceId).catch(() => {
        // Conversation cache is a performance layer; normalized live state remains authoritative.
      });
    }, 350);
    return () => window.clearTimeout(timeoutId);
  }, [deviceWorkspaces, localStorageReady, savedDevices]);

  useEffect(() => {
    if (!connected || !selectedDeviceId) {
      return;
    }
    const candidates = [
      ...pinnedThreadItems,
      ...visibleProjectGroups.flatMap((group) => group.items.slice(0, 4))
    ]
      .map((item) => item.entry ?? null)
      .filter((entry): entry is LocalCodexHistoryEntry => Boolean(entry))
      .filter(isRestorableHistoryEntry);
    const deduped = Array.from(
      new Map(candidates.map((entry) => [codexHistoryKey(entry), entry])).values()
    ).slice(0, 6);
    if (deduped.length === 0) {
      return;
    }
    const idleWindow = window as Window & {
      cancelIdleCallback?: (handle: number) => void;
      requestIdleCallback?: (
        callback: () => void,
        options?: { timeout?: number }
      ) => number;
    };
    const run = () => {
      for (const entry of deduped) {
        prefetchHistoryEntry(entry, connection);
      }
    };
    if (idleWindow.requestIdleCallback) {
      const handle = idleWindow.requestIdleCallback(run, { timeout: 1_500 });
      return () => idleWindow.cancelIdleCallback?.(handle);
    }
    const timeoutId = window.setTimeout(run, 450);
    return () => window.clearTimeout(timeoutId);
  }, [
    connected,
    connection,
    pinnedThreadItems,
    selectedDeviceId,
    visibleProjectGroups
  ]);

  const refreshRelayDevices = useCallback(async () => {
    if (!relayBootstrap) {
      return [] as SavedDevice[];
    }
    const devices = await listRelayDevices(
      relayBootstrap.relayUrl,
      relayBootstrap.sessionToken
    );
    const relaySavedDevices = devices.map((device) => ({
      id: device.deviceId,
      name: device.deviceName,
      mode: "relay" as const,
      relayUrl: relayBootstrap.relayUrl,
      deviceId: device.deviceId,
      hostname: device.hostname,
      online: device.online,
      codexVersion: device.codexVersion ?? null,
      lastConnectedAt: device.lastSeenAt
    }));

    persistDevices(relaySavedDevices);
    setDeviceWorkspaces((previous) => {
      const next = { ...previous };
      for (const device of relaySavedDevices) {
        const deviceConnection = connectionFromSavedDevice(
          device,
          relayBootstrap.sessionToken
        );
        if (!deviceConnection) {
          continue;
        }
        next[device.id] =
          next[device.id] ?? createDeviceWorkspace(deviceConnection);
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
    if (!relayBootstrap || savedDevices.length > 0) {
      return;
    }
    let cancelled = false;
    void refreshRelayDevices().catch((err) => {
      if (!cancelled) {
        setError(formatConsoleError(err));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [refreshRelayDevices, relayBootstrap, savedDevices.length]);

  useEffect(() => {
    latestThreadSidebarPrefsRef.current = threadSidebarPrefs;
  }, [threadSidebarPrefs]);

  useEffect(() => {
    latestProjectSidebarPrefsRef.current = projectSidebarPrefs;
  }, [projectSidebarPrefs]);

  const syncRelaySidebarPrefs = useCallback(
    async (deviceConnection: Extract<AgentConnection, { mode: "relay" }>, scopeKey: string) => {
      const localThreadPrefs = getThreadSidebarPrefs(
        latestThreadSidebarPrefsRef.current,
        scopeKey
      );
      const localProjectPrefs = getProjectSidebarPrefs(
        latestProjectSidebarPrefsRef.current,
        scopeKey
      );
      const remotePrefs = await getRelaySidebarPrefs(
        deviceConnection.relayUrl,
        deviceConnection.sessionToken,
        deviceConnection.deviceId
      );
      const normalizedRemoteThread = sanitizeThreadSidebarPrefs(remotePrefs.thread);
      const normalizedRemoteProject = sanitizeProjectSidebarPrefs(remotePrefs.project);
      const remoteEmpty =
        normalizedRemoteThread.pinned.length === 0 &&
        normalizedRemoteProject.pinned.length === 0 &&
        normalizedRemoteProject.hidden.length === 0 &&
        Object.keys(normalizedRemoteProject.renamed).length === 0;
      const localHasData =
        localThreadPrefs.pinned.length > 0 ||
        localProjectPrefs.pinned.length > 0 ||
        localProjectPrefs.hidden.length > 0 ||
        Object.keys(localProjectPrefs.renamed).length > 0;

      const nextThreadPrefs =
        remoteEmpty && localHasData ? localThreadPrefs : normalizedRemoteThread;
      const nextProjectPrefs =
        remoteEmpty && localHasData ? localProjectPrefs : normalizedRemoteProject;

      if (remoteEmpty && localHasData) {
        await updateRelaySidebarPrefs(
          deviceConnection.relayUrl,
          deviceConnection.sessionToken,
          deviceConnection.deviceId,
          {
            thread: nextThreadPrefs,
            project: nextProjectPrefs
          }
        );
      }

      persistThreadSidebarPrefs((previous) => ({
        ...previous,
        [scopeKey]: nextThreadPrefs
      }));
      persistProjectSidebarPrefs((previous) => ({
        ...previous,
        [scopeKey]: nextProjectPrefs
      }));
    },
    []
  );

  const pushRelaySidebarPrefs = useCallback(
    async (threadPrefs: ThreadSidebarPrefs, projectPrefs: ProjectSidebarPrefs) => {
      if (connection.mode !== "relay") {
        return;
      }
      await updateRelaySidebarPrefs(
        connection.relayUrl,
        connection.sessionToken,
        connection.deviceId,
        {
          thread: threadPrefs,
          project: projectPrefs
        }
      );
    },
    [connection]
  );

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
          setError(formatConsoleError(error));
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
    if (!connection.deviceId) {
      return;
    }
    const nextSelection = {
      currentSessionId:
        currentSessionId && !isHistoryPreviewSessionId(currentSessionId)
          ? currentSessionId
          : null,
      selectedHistoryKey
    };
    const existing = sessionSelections[sidebarPrefsScopeKey];
    if (
      existing?.currentSessionId === nextSelection.currentSessionId &&
      existing?.selectedHistoryKey === nextSelection.selectedHistoryKey
    ) {
      return;
    }
    persistSessionSelections((previous) => ({
      ...previous,
      [sidebarPrefsScopeKey]: nextSelection
    }));
  }, [
    connection.deviceId,
    currentSessionId,
    selectedHistoryKey,
    sessionSelections,
    sidebarPrefsScopeKey
  ]);

  useEffect(() => {
    if (!connection.deviceId || !connection.sessionToken) {
      return;
    }
    let cancelled = false;
    void syncRelaySidebarPrefs(connection, sidebarPrefsScopeKey).catch((syncError) => {
      if (!cancelled) {
        setError(formatConsoleError(syncError));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [
    connection.relayUrl,
    connection.sessionToken,
    connection.deviceId,
    sidebarPrefsScopeKey,
    syncRelaySidebarPrefs
  ]);

  useEffect(() => {
    const nextMode = coerceRelayPermissionMode(
      permissionMode,
      availablePermissionOptions
    );
    if (nextMode !== permissionMode) {
      setPermissionMode(nextMode);
    }
  }, [availablePermissionOptions, permissionMode]);

  useEffect(() => {
    const selectedDevice = savedDevices.find((device) => device.id === selectedDeviceId) ?? null;
    const selectedConnection =
      selectedDevice ? connectionForSavedDevice(selectedDevice) : null;
    if (selectedDevice && selectedConnection && isSameAgentConnection(selectedConnection, connection)) {
      setDeviceName(selectedDevice.name);
      return;
    }
    const matchingDevice = connection.deviceId
      ? findSavedDevice(savedDevices, connection)
      : null;
    if (matchingDevice) {
      setSelectedDeviceId(matchingDevice.id);
      setDeviceName(matchingDevice.name);
      return;
    }
    if (selectedDevice) {
      setDeviceName(selectedDevice.name);
      return;
    }
    setDeviceName("");
  }, [connection, connectionForSavedDevice, savedDevices, selectedDeviceId]);

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
      for (const timer of messageReconcileTimersRef.current.values()) {
        window.clearTimeout(timer);
      }
      eventFrameRefs.current.clear();
      streamRefs.current.clear();
      messageReconcileTimersRef.current.clear();
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
        return seedSavedDevicePresence(previous, savedDevices);
      });

      const results = await Promise.all(
        savedDevices.map(async (device) => {
          const deviceConnection = connectionForSavedDevice(device);
          if (!deviceConnection) {
            return {
              id: device.id,
              presence: {
                checkedAt: Date.now(),
                codexVersion: device.codexVersion ?? null,
                status: "checking" as const
              }
            };
          }
          try {
            const status = await health(deviceConnection);
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
      setDevicePresence((previous) =>
        mergeDevicePresenceResults(previous, savedDeviceIds, results)
      );
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
    const safeDevices = writeSavedDevicesStorage(window.localStorage, sortedDevices);
    setSavedDevices(safeDevices);
  }

  function persistThreadSidebarPrefs(
    updater: Record<string, ThreadSidebarPrefs> | ((previous: Record<string, ThreadSidebarPrefs>) => Record<string, ThreadSidebarPrefs>)
  ) {
    setThreadSidebarPrefs((previous) => {
      const next = resolveStateUpdater(previous, updater);
      return writeThreadSidebarPrefsStorage(window.localStorage, next);
    });
  }

  function persistProjectSidebarPrefs(
    updater:
      | Record<string, ProjectSidebarPrefs>
      | ((previous: Record<string, ProjectSidebarPrefs>) => Record<string, ProjectSidebarPrefs>)
  ) {
    setProjectSidebarPrefs((previous) => {
      const next = resolveStateUpdater(previous, updater);
      return writeProjectSidebarPrefsStorage(window.localStorage, next);
    });
  }

  function persistSessionSelections(
    updater:
      | Record<string, { currentSessionId: string | null; selectedHistoryKey: string | null }>
      | ((
          previous: Record<string, { currentSessionId: string | null; selectedHistoryKey: string | null }>
        ) => Record<string, { currentSessionId: string | null; selectedHistoryKey: string | null }>)
  ) {
    setSessionSelections((previous) => {
      const next = resolveStateUpdater(previous, updater);
      return writeSessionSelectionStorage(window.localStorage, next);
    });
  }

  function togglePinnedThread(threadId: string) {
    const nextThreadPrefs = sanitizeThreadSidebarPrefs({
      ...activeThreadPrefs,
      pinned: activeThreadPrefs.pinned.includes(threadId)
        ? activeThreadPrefs.pinned.filter((value) => value !== threadId)
        : [threadId, ...activeThreadPrefs.pinned.filter((value) => value !== threadId)]
    });
    persistThreadSidebarPrefs((previous) => ({
      ...previous,
      [sidebarPrefsScopeKey]: nextThreadPrefs
    }));
    if (connection.mode === "relay") {
      void pushRelaySidebarPrefs(nextThreadPrefs, activeProjectPrefs).catch((syncError) =>
        setError(formatConsoleError(syncError))
      );
    }
  }

  async function archiveThread(item: ThreadListItem) {
    setError(null);
    historyPageCacheRef.current.delete(item.id);
    patchActiveWorkspace((workspace) => removeArchivedThreadFromWorkspace(workspace, item));

    try {
      await archiveCodexHistory(connection, { id: item.threadId });
      const nextThreadPrefs = sanitizeThreadSidebarPrefs({
        pinned: activeThreadPrefs.pinned.filter((value) => value !== item.threadId)
      });
      persistThreadSidebarPrefs((previous) => ({
        ...previous,
        [sidebarPrefsScopeKey]: nextThreadPrefs
      }));
      if (connection.mode === "relay") {
        void pushRelaySidebarPrefs(nextThreadPrefs, activeProjectPrefs).catch((syncError) =>
          setError(formatConsoleError(syncError))
        );
      }
    } catch (archiveError) {
      try {
        const { historyThreadIds, sessionThreadIds } = await refreshActiveWorkspaceThreads();
        if (!historyThreadIds.has(item.threadId) && !sessionThreadIds.has(item.threadId)) {
          setError(null);
          return;
        }
      } catch (refreshError) {
        setError(formatConsoleError(refreshError));
        return;
      }
      setError(formatConsoleError(archiveError));
    }
  }

  function togglePinnedProject(projectCwd: string) {
    const nextProjectPrefs = sanitizeProjectSidebarPrefs({
      ...activeProjectPrefs,
      pinned: activeProjectPrefs.pinned.includes(projectCwd)
        ? activeProjectPrefs.pinned.filter((value) => value !== projectCwd)
        : [projectCwd, ...activeProjectPrefs.pinned.filter((value) => value !== projectCwd)]
    });
    persistProjectSidebarPrefs((previous) => ({
      ...previous,
      [sidebarPrefsScopeKey]: nextProjectPrefs
    }));
    if (connection.mode === "relay") {
      void pushRelaySidebarPrefs(activeThreadPrefs, nextProjectPrefs).catch((syncError) =>
        setError(formatConsoleError(syncError))
      );
    }
  }

  function renameProject(group: ProjectThreadGroupData) {
    const nextName = window.prompt("重命名项目", group.name);
    if (nextName === null) {
      return;
    }
    const trimmed = nextName.trim();
    const renamed = { ...activeProjectPrefs.renamed };
    if (!trimmed || trimmed === group.cwd.split("/").filter(Boolean).at(-1)) {
      delete renamed[group.cwd];
    } else {
      renamed[group.cwd] = trimmed;
    }
    const nextProjectPrefs = sanitizeProjectSidebarPrefs({
      ...activeProjectPrefs,
      renamed
    });
    persistProjectSidebarPrefs((previous) => ({
      ...previous,
      [sidebarPrefsScopeKey]: nextProjectPrefs
    }));
    if (connection.mode === "relay") {
      void pushRelaySidebarPrefs(activeThreadPrefs, nextProjectPrefs).catch((syncError) =>
        setError(formatConsoleError(syncError))
      );
    }
  }

  async function archiveProject(group: ProjectThreadGroupData) {
    const threadIds = [...new Set(group.items.map((item) => item.threadId))];
    if (!threadIds.length) {
      return;
    }
    try {
      await Promise.all(threadIds.map((threadId) => archiveCodexHistory(connection, { id: threadId })));
      for (const item of group.items) {
        historyPageCacheRef.current.delete(item.id);
      }
      const threadIdSet = new Set(threadIds);
      patchActiveWorkspace((workspace) => {
        const nextSessions = workspace.sessions.filter(
          (session) => !session.threadId || !threadIdSet.has(session.threadId)
        );
        const nextHistory = workspace.codexHistory.filter((entry) => !threadIdSet.has(entry.id));
        const nextHistoryPages = { ...workspace.historyPages };
        const nextOrigins = { ...workspace.sessionHistoryOrigins };

        for (const session of workspace.sessions) {
          if (!session.threadId || !threadIdSet.has(session.threadId)) {
            continue;
          }
          delete nextHistoryPages[session.sessionId];
          delete nextOrigins[session.sessionId];
        }

        const selectedSessionMatches = workspace.sessions.some(
          (session) => {
            const threadId = session.threadId;
            return (
              session.sessionId === workspace.currentSessionId &&
              typeof threadId === "string" &&
              threadIdSet.has(threadId)
            );
          }
        );
        const selectedHistoryEntry = workspace.selectedHistoryKey
          ? workspace.codexHistory.find(
              (entry) => codexHistoryKey(entry) === workspace.selectedHistoryKey
            ) ?? null
          : null;

        return {
          ...workspace,
          currentSessionId: selectedSessionMatches ? null : workspace.currentSessionId,
          selectedHistoryKey:
            selectedHistoryEntry && threadIdSet.has(selectedHistoryEntry.id)
              ? null
              : workspace.selectedHistoryKey,
          sessions: nextSessions,
          codexHistory: nextHistory,
          historyPages: nextHistoryPages,
          sessionHistoryOrigins: nextOrigins,
          loadedThreadIds: workspace.loadedThreadIds.filter((value) => !threadIdSet.has(value))
        };
      });
      const nextThreadPrefs = sanitizeThreadSidebarPrefs({
        pinned: activeThreadPrefs.pinned.filter((value) => !threadIdSet.has(value))
      });
      persistThreadSidebarPrefs((previous) => ({
        ...previous,
        [sidebarPrefsScopeKey]: nextThreadPrefs
      }));
      if (connection.mode === "relay") {
        void pushRelaySidebarPrefs(nextThreadPrefs, activeProjectPrefs).catch((syncError) =>
          setError(formatConsoleError(syncError))
        );
      }
    } catch (archiveError) {
      setError(formatConsoleError(archiveError));
    }
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

    const renamed = { ...activeProjectPrefs.renamed };
    delete renamed[group.cwd];
    const nextProjectPrefs = sanitizeProjectSidebarPrefs({
      hidden: [group.cwd, ...activeProjectPrefs.hidden.filter((value) => value !== group.cwd)],
      pinned: activeProjectPrefs.pinned.filter((value) => value !== group.cwd),
      renamed
    });
    persistProjectSidebarPrefs((previous) => ({
      ...previous,
      [sidebarPrefsScopeKey]: nextProjectPrefs
    }));
    if (connection.mode === "relay") {
      void pushRelaySidebarPrefs(activeThreadPrefs, nextProjectPrefs).catch((syncError) =>
        setError(formatConsoleError(syncError))
      );
    }

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
    writeSidebarWidthStorage(window.localStorage, DEFAULT_SIDEBAR_WIDTH);
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
        writeSidebarWidthStorage(window.localStorage, nextWidth);
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
    traceSubmitStreamEvents(deviceId, incoming);
    webDevTrace("console.events.enqueue", {
      deviceId,
      incomingCount: incoming.length,
      selectSessions: options.selectSessions,
      eventTypes: summarizeLocalEventTypes(incoming),
      seqSummary: summarizeLocalEventSeqs(incoming),
      sessionIds: summarizeLocalEventField(incoming, "sessionId"),
      threadIds: summarizeLocalEventField(incoming, "threadId"),
      turnIds: summarizeLocalEventField(incoming, "turnId")
    });
    const queued = queuedEventsRef.current.get(deviceId) ?? [];
    queuedEventsRef.current.set(deviceId, [...queued, ...incoming]);
    queuedSelectRef.current.set(
      deviceId,
      Boolean(queuedSelectRef.current.get(deviceId)) || options.selectSessions
    );
    if (eventFrameRefs.current.has(deviceId)) {
      webDevTrace("console.events.coalesced", {
        deviceId,
        queuedCount: queued.length + incoming.length
      });
      return;
    }
    const frame = requestAnimationFrame(() => {
      eventFrameRefs.current.delete(deviceId);
      const queuedEvents = queuedEventsRef.current.get(deviceId) ?? [];
      const selectSessions = queuedSelectRef.current.get(deviceId) ?? true;
      queuedEventsRef.current.delete(deviceId);
      queuedSelectRef.current.delete(deviceId);
      webDevTrace("console.events.flush.begin", {
        deviceId,
        count: queuedEvents.length,
        selectSessions,
        eventTypes: summarizeLocalEventTypes(queuedEvents),
        seqSummary: summarizeLocalEventSeqs(queuedEvents)
      });
      patchDeviceWorkspace(deviceId, (workspace) => {
        const before = summarizeReducerWorkspaceState(workspace);
        const next = ingestEventsIntoWorkspace(workspace, queuedEvents, { selectSessions });
        const after = summarizeReducerWorkspaceState(next);
        webDevTrace("console.reducer.apply", {
          deviceId,
          selectSessions,
          count: queuedEvents.length,
          eventTypes: summarizeLocalEventTypes(queuedEvents),
          seqSummary: summarizeLocalEventSeqs(queuedEvents),
          before,
          after,
          selectionChanged:
            before.currentSessionId !== after.currentSessionId ||
            before.selectedHistoryKey !== after.selectedHistoryKey
        });
        return next;
      });
      webDevTrace("console.events.flush.end", {
        deviceId,
        count: queuedEvents.length,
        selectedDeviceId: selectedDeviceIdRef.current
      });
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
    webDevTrace("console.stream.close", { deviceId });
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
    webDevTrace("console.stream.open.begin", {
      deviceId,
      after,
      relayUrl: deviceConnection.relayUrl,
      connectionDeviceId: deviceConnection.deviceId,
      hasHealth: Boolean(status)
    });
    closeDeviceStream(deviceId);
    const stream = openManagedEventStream({
      connection: deviceConnection,
      after,
      onReplay: (events) => {
        webDevTrace("console.stream.replay.received", {
          deviceId,
          count: events.length,
          eventTypes: summarizeLocalEventTypes(events)
        });
        enqueueDeviceEvents(deviceId, events, { selectSessions: false });
      },
      onEvent: (event) => {
        webDevTrace("console.stream.event.received", {
          deviceId,
          seq: event.seq,
          type: event.type,
          sessionId: event.sessionId,
          threadId: event.threadId,
          turnId: event.turnId
        });
        enqueueDeviceEvents(deviceId, [event], { selectSessions: false });
      },
      onStatus: (nextStatus) => {
        webDevTrace("console.stream.status", {
          deviceId,
          status: nextStatus
        });
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
        webDevTrace("console.stream.error", {
          deviceId,
          ...webErrorSummary(streamError)
        });
        if (selectedDeviceIdRef.current === deviceId) {
          setError(formatConsoleError(streamError));
        }
      }
    });
    streamRefs.current.set(deviceId, stream);
    webDevTrace("console.stream.open.end", { deviceId });
  }

  async function hydrateConnectedDevice(
    device: SavedDevice,
    status: LocalHealthResponse,
    options?: { selectDevice?: boolean }
  ) {
    const deviceConnection = connectionForSavedDevice(device);
    if (!deviceConnection) {
      throw new Error("当前浏览器还没有可用的 relay 会话。");
    }
    if (options?.selectDevice) {
      setSelectedDeviceId(device.id);
      setDeviceName(device.name);
    }
    const selectionScopeKey = relayThreadPrefsScope(
      deviceConnection.relayUrl,
      deviceConnection.deviceId || "unbound"
    );
    const savedSelection: SavedSessionSelection | null =
      sessionSelections[selectionScopeKey] ?? null;
    const hydrationVersion = beginDeviceHydration(device.id);
    const restoredWorkspace = deviceWorkspaces[device.id] ?? null;
    const directoryPathHint = restoredWorkspace
      ? resolvePreferredWorkspaceCwd(restoredWorkspace) || undefined
      : undefined;
    const replayAfter = restoredWorkspace?.events.at(-1)?.seq ?? 0;

    startTransition(() => {
      patchDeviceWorkspace(device.id, (workspace) => ({
        ...workspace,
        connection: deviceConnection,
        directoryError: null,
        directoryLoading: true,
        healthStatus: status,
        historySyncState: "loading",
        sessionSyncState: "loading",
        streamStatus: "connecting"
      }));
    });

    const replayPromise = replayEvents(deviceConnection, replayAfter).then((replay) => {
      if (!isCurrentDeviceHydration(device.id, hydrationVersion)) {
        return replay;
      }
      startTransition(() => {
        patchDeviceWorkspace(device.id, (workspace) => {
          const before = summarizeReducerWorkspaceState(workspace);
          const next = ingestEventsIntoWorkspace(workspace, replay.events, {
            selectSessions: false
          });
          const after = summarizeReducerWorkspaceState(next);
          webDevTrace("console.reducer.apply", {
            deviceId: device.id,
            source: "initial_replay",
            selectSessions: false,
            count: replay.events.length,
            eventTypes: summarizeLocalEventTypes(replay.events),
            seqSummary: summarizeLocalEventSeqs(replay.events),
            before,
            after,
            selectionChanged:
              before.currentSessionId !== after.currentSessionId ||
              before.selectedHistoryKey !== after.selectedHistoryKey
          });
          return next;
        });
      });
      openDeviceStream(device.id, deviceConnection, replay.events.at(-1)?.seq ?? replayAfter, status);
      return replay;
    });

    const sessionsPromise = listSessions(deviceConnection)
      .then((loadedSessions) => {
        if (!isCurrentDeviceHydration(device.id, hydrationVersion)) {
          return loadedSessions;
        }
        startTransition(() => {
          patchDeviceWorkspace(device.id, (workspace) => ({
            ...mergeLiveSessionsIntoWorkspace(
              workspace,
              loadedSessions.sessions,
              savedSelection
            ),
            sessionSyncState: "ready"
          }));
        });
        return loadedSessions;
      })
      .catch((err) => {
        if (isCurrentDeviceHydration(device.id, hydrationVersion)) {
          patchDeviceWorkspace(device.id, (workspace) => ({
            ...workspace,
            sessionSyncState: "error"
          }));
          if (selectedDeviceIdRef.current === device.id) {
            setError(formatConsoleError(err));
          }
        }
        return null;
      });

    const historyPromise = listCodexHistory(deviceConnection)
      .then((history) => {
        if (!isCurrentDeviceHydration(device.id, hydrationVersion)) {
          return history;
        }
        const previewEntry = resolveHistoryPreviewEntryToHydrate(
          restoredWorkspace ?? createDeviceWorkspace(deviceConnection),
          history.entries,
          savedSelection
        );
        startTransition(() => {
          patchDeviceWorkspace(device.id, (workspace) => ({
            ...mergeLiveHistoryIntoWorkspace(
              workspace,
              history.entries,
              savedSelection
            ),
            historySyncState: "ready"
          }));
        });
        if (previewEntry) {
          void hydrateHistorySelection(previewEntry, {
            deviceId: device.id,
            deviceConnection,
            revealMain: false
          });
        }
        return history;
      })
      .catch((err) => {
        if (isCurrentDeviceHydration(device.id, hydrationVersion)) {
          patchDeviceWorkspace(device.id, (workspace) => ({
            ...workspace,
            historySyncState: "error"
          }));
          if (selectedDeviceIdRef.current === device.id) {
            setError(formatConsoleError(err));
          }
        }
        return null;
      });

    const loadedThreadsPromise = getLoadedCodexThreads(deviceConnection)
      .then((loadedThreads) => {
        if (!isCurrentDeviceHydration(device.id, hydrationVersion)) {
          return loadedThreads;
        }
        startTransition(() => {
          patchDeviceWorkspace(device.id, (workspace) =>
            setLoadedThreadIds(
              {
                ...workspace,
                codexHistory: applyLoadedThreadState(
                  workspace.codexHistory,
                  loadedThreads.threadIds
                )
              },
              loadedThreads.threadIds
            )
          );
        });
        return loadedThreads;
      })
      .catch(() => {
        // Older app-server builds may not expose thread/loaded/list yet.
        return null;
      });

    const directoriesPromise = listDirectories(deviceConnection, directoryPathHint)
      .then((directories) => {
        if (!isCurrentDeviceHydration(device.id, hydrationVersion)) {
          return directories;
        }
        patchDeviceWorkspace(device.id, (workspace) => ({
          ...workspace,
          directoryList: directories
        }));
        return directories;
      })
      .catch((err) => {
        if (isCurrentDeviceHydration(device.id, hydrationVersion)) {
          patchDeviceWorkspace(device.id, (workspace) => ({
            ...workspace,
            directoryError: formatError(err)
          }));
        }
        return null;
      })
      .finally(() => {
        if (isCurrentDeviceHydration(device.id, hydrationVersion)) {
          patchDeviceWorkspace(device.id, (workspace) => ({
            ...workspace,
            directoryLoading: false
          }));
        }
      });

    void Promise.allSettled([
      sessionsPromise,
      historyPromise,
      loadedThreadsPromise,
      directoriesPromise
    ]);
    await replayPromise;
  }

  async function refreshActiveWorkspaceThreads() {
    const deviceId = selectedDeviceIdRef.current;
    if (!deviceId) {
      return {
        historyThreadIds: new Set<string>(),
        sessionThreadIds: new Set<string>()
      };
    }

    const deviceConnection = deviceWorkspaces[deviceId]?.connection ?? connection;
    const selectionScopeKey = relayThreadPrefsScope(
      deviceConnection.relayUrl,
      deviceConnection.deviceId || "unbound"
    );
    const savedSelection: SavedSessionSelection | null =
      sessionSelections[selectionScopeKey] ?? null;
    const sessionsPromise = listSessions(deviceConnection)
      .then((loadedSessions) => {
        startTransition(() => {
          patchDeviceWorkspace(deviceId, (workspace) =>
            mergeLiveSessionsIntoWorkspace(
              workspace,
              loadedSessions.sessions,
              savedSelection
            )
          );
        });
        return new Set(
          loadedSessions.sessions
            .map((session) => session.threadId)
            .filter((threadId): threadId is string => Boolean(threadId))
        );
      })
      .catch(() => new Set<string>());
    const historyPromise = listCodexHistory(deviceConnection)
      .then((history) => {
        startTransition(() => {
          patchDeviceWorkspace(deviceId, (workspace) =>
            mergeLiveHistoryIntoWorkspace(
              workspace,
              history.entries,
              savedSelection
            )
          );
        });
        return new Set(history.entries.map((entry) => entry.id));
      })
      .catch(() => new Set<string>());

    void getLoadedCodexThreads(deviceConnection)
      .then((loadedThreads) => {
        patchDeviceWorkspace(deviceId, (workspace) =>
          setLoadedThreadIds(
            {
              ...workspace,
              codexHistory: applyLoadedThreadState(
                workspace.codexHistory,
                loadedThreads.threadIds
              )
            },
            loadedThreads.threadIds
          )
        );
      })
      .catch(() => {
        // Older app-server builds may not expose thread/loaded/list yet.
      });

    const [sessionThreadIds, historyThreadIds] = await Promise.all([
      sessionsPromise,
      historyPromise
    ]);

    return { historyThreadIds, sessionThreadIds };
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
      const deviceConnection = connectionForSavedDevice(device);
      if (!deviceConnection) {
        throw new Error("当前浏览器还没有可用的 relay 会话。");
      }
      const status = initialHealthStatus ?? (await health(deviceConnection));
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
    const nextDevice: SavedDevice = {
      id: existingDevice?.id ?? createSavedDeviceId(),
      name:
        options?.deviceName?.trim() ||
        deviceName.trim() ||
        existingDevice?.name ||
        status.device?.defaultName ||
        nextConnection.deviceId,
      mode: "relay",
      relayUrl: normalizeAgentUrl(nextConnection.relayUrl),
      deviceId: nextConnection.deviceId,
      hostname: status.device?.hostname ?? existingDevice?.hostname ?? null,
      online: true,
      codexVersion: status.codex?.version ?? null,
      lastConnectedAt: Date.now()
    };
    persistDevices([
      nextDevice,
      ...savedDevices.filter(
        (device) =>
          device.id !== nextDevice.id &&
          !isSameSavedDeviceConnection(device, nextDevice)
      )
    ]);
    return nextDevice;
  }

  function deleteSavedDevice(deviceId: string) {
    deviceHydrationVersionsRef.current.delete(deviceId);
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

  async function hydrateHistorySelection(
    entry: LocalCodexHistoryEntry,
    input?: {
      deviceConnection?: AgentConnection;
      deviceId?: string | null;
      revealMain?: boolean;
    }
  ) {
    const deviceId = input?.deviceId ?? selectedDeviceIdRef.current;
    const deviceConnection = input?.deviceConnection ?? connection;
    if (!deviceId) {
      return;
    }
    cancelHistoryAutoCompletion("select_history");
    if (!isRestorableHistoryEntry(entry)) {
      setError(formatMissingHistoryFolderMessage(entry.cwd));
      return;
    }
    const key = codexHistoryKey(entry);
    activeHistoryLoadKeyRef.current = key;
    historyPrefetchQueueRef.current = [];
    const previewSession = makeHistoryPreviewSession(entry);
    const workspace = deviceWorkspaces[deviceId];
    const threadIsLoaded = entry.loaded || workspace?.loadedThreadIds.includes(entry.id) || false;
    setError(null);
    patchDeviceWorkspace(deviceId, (currentWorkspace) =>
      {
        const nextWorkspace = rememberSessionHistoryOrigin(
          upsertSessionInWorkspace(
            {
              ...currentWorkspace,
              selectedHistoryKey: key,
              historyLoadingKey: threadIsLoaded ? null : key,
              currentSessionId: previewSession.sessionId,
              cwd: isPreviewOnlyHistoryEntry(entry) ? currentWorkspace.cwd : entry.cwd,
              resumeStates: {
                ...currentWorkspace.resumeStates,
                [previewSession.sessionId]: isPreviewOnlyHistoryEntry(entry)
                  ? "missing"
                  : "history"
              }
            },
            previewSession
          ),
          previewSession.sessionId,
          entry.id
        );
        return {
          ...nextWorkspace,
          cwd: resolvePreferredWorkspaceCwd(nextWorkspace)
        };
      }
    );
    if (input?.revealMain ?? true) {
      setActiveSheet(null);
      revealMainOnMobile();
    }
    let showedCachedPage = false;
    let startedRefresh = false;
    try {
      const cachedRecord = historyPageCacheRef.current.get(key) ?? null;
      const hasFreshCache =
        cachedRecord !== null && Date.now() - cachedRecord.fetchedAt < HISTORY_PAGE_CACHE_TTL_MS;

      if (cachedRecord) {
        showedCachedPage = true;
        webDevTrace("console.history.hydrate.input", {
          historyKey: key,
          threadId: entry.id,
          cwd: entry.cwd,
          source: "cache",
          ...summarizeHistoryPageCounts(cachedRecord.page)
        });
        patchDeviceWorkspace(deviceId, (currentWorkspace) => {
          const hydratedWorkspace = hydrateSessionFromTurns(
            {
              ...currentWorkspace,
              historyLoadingKey:
                currentWorkspace.historyLoadingKey === key
                  ? null
                  : currentWorkspace.historyLoadingKey,
              resumeStates: {
                ...currentWorkspace.resumeStates,
                [previewSession.sessionId]: isPreviewOnlyHistoryEntry(cachedRecord.page.entry)
                  ? "missing"
                  : "history"
              }
            },
            previewSession.sessionId,
            cachedRecord.page.turns
          );
          const nextWorkspace = setSessionHistoryPageState(
            hydratedWorkspace,
            previewSession.sessionId,
            {
              autoCompleteFailedCursor: null,
              loadingOlder: false,
              olderCursor: cachedRecord.page.nextCursor,
              sourceKey: key
            }
          );
          webDevTrace("console.history.hydrate.applied", {
            historyKey: key,
            threadId: entry.id,
            cwd: entry.cwd,
            source: "cache",
            ...summarizeHydratedConversation(
              nextWorkspace,
              previewSession.sessionId,
              entry.id
            )
          });
          return nextWorkspace;
        });
        if (cachedRecord.page.nextCursor) {
          startHistoryAutoCompletion({
            connection: deviceConnection,
            cursor: cachedRecord.page.nextCursor,
            cwd: cachedRecord.page.entry.cwd,
            deviceId,
            sessionId: previewSession.sessionId,
            sourceKey: key,
            threadId: cachedRecord.page.entry.id
          });
        }
      }

      if (hasFreshCache && refreshingHistoryKeysRef.current.has(key)) {
        return;
      }

      refreshingHistoryKeysRef.current.add(key);
      startedRefresh = true;
      const page = await getCodexHistoryTurns(deviceConnection, {
        cacheMode: "bypass",
        id: entry.id,
        cwd: entry.cwd,
        limit: 40
      });
      writeFreshHistoryPageCache(key, page);
      webDevTrace("console.history.fetch.end", {
        historyKey: key,
        threadId: entry.id,
        cwd: entry.cwd,
        source: "network",
        ...summarizeHistoryPageCounts(page)
      });
      webDevTrace("console.history.hydrate.input", {
        historyKey: key,
        threadId: entry.id,
        cwd: entry.cwd,
        source: "network",
        ...summarizeHistoryPageCounts(page)
      });
      patchDeviceWorkspace(deviceId, (currentWorkspace) => {
        const hydratedWorkspace = hydrateSessionFromTurns(
          {
            ...currentWorkspace,
            historyLoadingKey:
              currentWorkspace.historyLoadingKey === key
                ? null
                : currentWorkspace.historyLoadingKey,
            resumeStates: {
              ...currentWorkspace.resumeStates,
              [previewSession.sessionId]: isPreviewOnlyHistoryEntry(page.entry)
                ? "missing"
                : "history"
            }
          },
          previewSession.sessionId,
          page.turns
        );
        const nextWorkspace = setSessionHistoryPageState(
          hydratedWorkspace,
          previewSession.sessionId,
          {
            autoCompleteFailedCursor: null,
            loadingOlder: false,
            olderCursor: page.nextCursor,
            sourceKey: key
          }
        );
        webDevTrace("console.history.hydrate.applied", {
          historyKey: key,
          threadId: entry.id,
          cwd: entry.cwd,
          source: "network",
          ...summarizeHydratedConversation(nextWorkspace, previewSession.sessionId, entry.id)
        });
        return nextWorkspace;
      });
      if (page.nextCursor) {
        startHistoryAutoCompletion({
          connection: deviceConnection,
          cursor: page.nextCursor,
          cwd: page.entry.cwd,
          deviceId,
          sessionId: previewSession.sessionId,
          sourceKey: key,
          threadId: page.entry.id
        });
      }
    } catch (err) {
      patchDeviceWorkspace(deviceId, (currentWorkspace) =>
        showedCachedPage
          ? {
              ...currentWorkspace,
              historyLoadingKey:
                currentWorkspace.historyLoadingKey === key
                  ? null
                  : currentWorkspace.historyLoadingKey
            }
          : {
              ...currentWorkspace,
              historyLoadingKey:
                currentWorkspace.historyLoadingKey === key
                  ? null
                  : currentWorkspace.historyLoadingKey,
              resumeStates: {
                ...currentWorkspace.resumeStates,
                [previewSession.sessionId]: isMissingHistoryCwdError(err) ? "missing" : "failed"
              }
            }
      );
      if (!showedCachedPage) {
        setError(formatConsoleError(err));
      }
    } finally {
      if (startedRefresh) {
        refreshingHistoryKeysRef.current.delete(key);
      }
      if (activeHistoryLoadKeyRef.current === key) {
        activeHistoryLoadKeyRef.current = null;
      }
      pumpHistoryPrefetchQueue();
    }
  }

  function prefetchHistoryEntry(
    entry: LocalCodexHistoryEntry,
    deviceConnection: AgentConnection
  ) {
    const key = codexHistoryKey(entry);
    const cachedRecord = historyPageCacheRef.current.get(key) ?? null;
    if (
      cachedRecord &&
      Date.now() - cachedRecord.fetchedAt < HISTORY_PAGE_CACHE_TTL_MS
    ) {
      return;
    }
    if (prefetchingHistoryKeysRef.current.has(key)) {
      return;
    }
    if (historyPrefetchQueueRef.current.some((task) => task.key === key)) {
      return;
    }
    historyPrefetchQueueRef.current.push({
      connection: deviceConnection,
      entry,
      key
    });
    pumpHistoryPrefetchQueue();
  }

  function pumpHistoryPrefetchQueue() {
    if (activeHistoryLoadKeyRef.current) {
      return;
    }
    while (
      activeHistoryPrefetchCountRef.current < HISTORY_PREFETCH_CONCURRENCY &&
      historyPrefetchQueueRef.current.length > 0
    ) {
      const task = historyPrefetchQueueRef.current.shift();
      if (!task) {
        return;
      }
      if (prefetchingHistoryKeysRef.current.has(task.key)) {
        continue;
      }
      runHistoryPrefetch(task);
    }
  }

  function runHistoryPrefetch(task: HistoryPrefetchTask) {
    const { connection: taskConnection, entry, key } = task;
    prefetchingHistoryKeysRef.current.add(key);
    activeHistoryPrefetchCountRef.current += 1;
    webDevTrace("console.history.prefetch.begin", {
      historyKey: key,
      threadId: entry.id,
      cwd: entry.cwd
    });
    void getCodexHistoryTurns(taskConnection, {
      id: entry.id,
      cwd: entry.cwd,
      limit: 40
    })
      .then((page) => {
        writeFreshHistoryPageCache(key, page);
        webDevTrace("console.history.prefetch.end", {
          historyKey: key,
          threadId: entry.id,
          cwd: entry.cwd,
          ...summarizeHistoryPageCounts(page)
        });
      })
      .catch((err) => {
        webDevTrace("console.history.prefetch.error", {
          historyKey: key,
          threadId: entry.id,
          cwd: entry.cwd,
          error: webErrorSummary(err)
        });
      })
      .finally(() => {
        prefetchingHistoryKeysRef.current.delete(key);
        activeHistoryPrefetchCountRef.current = Math.max(
          0,
          activeHistoryPrefetchCountRef.current - 1
        );
        pumpHistoryPrefetchQueue();
      });
  }

  function selectHistory(entry: LocalCodexHistoryEntry) {
    if (!connected) {
      setActiveSheet("device");
      return;
    }
    void hydrateHistorySelection(entry, { revealMain: true });
  }

  function clearMessageReconciliation(
    request: Pick<
      MessageReconciliationRequest,
      "clientMessageId" | "deviceId" | "sessionId"
    >
  ) {
    const key = messageReconciliationKey(request);
    const timer = messageReconcileTimersRef.current.get(key);
    if (timer !== undefined) {
      webDevTrace("console.reconcile.timer.clear", {
        key,
        deviceId: request.deviceId,
        sessionId: request.sessionId,
        clientMessageId: request.clientMessageId,
        submitTraceId: "submitTraceId" in request ? request.submitTraceId : undefined
      });
      window.clearTimeout(timer);
      messageReconcileTimersRef.current.delete(key);
    }
  }

  function scheduleMessageReconciliation(
    input: Omit<MessageReconciliationRequest, "attempt" | "startedAt">
  ) {
    const request: MessageReconciliationRequest = {
      ...input,
      attempt: 0,
      startedAt: Date.now()
    };
    webDevTrace("console.reconcile.schedule", {
      deviceId: request.deviceId,
      sessionId: request.sessionId,
      turnId: request.turnId,
      clientMessageId: request.clientMessageId,
      submitTraceId: request.submitTraceId,
      messageLength: request.messageText.length,
      delayMs: MESSAGE_RECONCILE_INITIAL_DELAY_MS
    });
    scheduleMessageReconciliationAttempt(request, MESSAGE_RECONCILE_INITIAL_DELAY_MS);
  }

  function scheduleMessageReconciliationAttempt(
    request: MessageReconciliationRequest,
    delayMs: number
  ) {
    clearMessageReconciliation(request);
    const key = messageReconciliationKey(request);
    webDevTrace("console.reconcile.timer.set", {
      key,
      deviceId: request.deviceId,
      sessionId: request.sessionId,
      turnId: request.turnId,
      clientMessageId: request.clientMessageId,
      submitTraceId: request.submitTraceId,
      attempt: request.attempt,
      delayMs
    });
    const timer = window.setTimeout(() => {
      messageReconcileTimersRef.current.delete(key);
      void reconcileSentMessage(request);
    }, delayMs);
    messageReconcileTimersRef.current.set(key, timer);
  }

  async function reconcileSentMessage(request: MessageReconciliationRequest) {
    const startedAt = Date.now();
    webDevTrace("console.reconcile.attempt.begin", {
      deviceId: request.deviceId,
      sessionId: request.sessionId,
      turnId: request.turnId,
      clientMessageId: request.clientMessageId,
      submitTraceId: request.submitTraceId,
      attempt: request.attempt,
      ageMs: Date.now() - request.startedAt
    });
    const workspace = latestDeviceWorkspacesRef.current[request.deviceId];
    if (!workspace || !isSameAgentConnection(workspace.connection, request.connection)) {
      webDevTrace("console.reconcile.attempt.skip", {
        deviceId: request.deviceId,
        sessionId: request.sessionId,
        clientMessageId: request.clientMessageId,
        submitTraceId: request.submitTraceId,
        reason: !workspace ? "missing_workspace" : "connection_changed"
      });
      return;
    }
    if (hasLiveCompletionEvidence(workspace, request)) {
      patchDeviceWorkspace(request.deviceId, (currentWorkspace) =>
        markOptimisticMessageComplete(currentWorkspace, request.clientMessageId, {
          sessionId: request.sessionId,
          ...(request.turnId ? { turnId: request.turnId } : {})
        })
      );
      webDevTrace("console.reconcile.live_evidence", {
        deviceId: request.deviceId,
        sessionId: request.sessionId,
        turnId: request.turnId,
        clientMessageId: request.clientMessageId,
        submitTraceId: request.submitTraceId,
        attempt: request.attempt,
        durationMs: traceDurationMs(startedAt)
      });
      const context = submitTraceByClientMessageRef.current.get(request.clientMessageId);
      if (context) {
        traceSubmitReconciled(context, {
          source: "live_completion",
          attempt: request.attempt,
          durationMs: traceDurationMs(startedAt)
        });
      }
      clearMessageReconciliation(request);
      return;
    }
    if (request.attempt >= MESSAGE_RECONCILE_MAX_ATTEMPTS) {
      webDevTrace("console.reconcile.max_attempts", {
        deviceId: request.deviceId,
        sessionId: request.sessionId,
        turnId: request.turnId,
        clientMessageId: request.clientMessageId,
        submitTraceId: request.submitTraceId,
        attempt: request.attempt,
        ageMs: Date.now() - request.startedAt
      });
      const context = submitTraceByClientMessageRef.current.get(request.clientMessageId);
      if (context) {
        traceSubmitFailed(context, {
          source: "reconcile_max_attempts",
          attempt: request.attempt,
          ageMs: Date.now() - request.startedAt
        });
      }
      patchDeviceWorkspace(request.deviceId, (currentWorkspace) =>
        markOptimisticMessageFailed(
          currentWorkspace,
          request.clientMessageId,
          "消息已发送，但长时间没有收到 Codex 的实时或历史确认。"
        )
      );
      return;
    }

    try {
      const loadedSessions = await listSessions(request.connection);
      const selectionScopeKey = relayThreadPrefsScope(
        request.connection.relayUrl,
        request.connection.deviceId || "unbound"
      );
      const savedSelection: SavedSessionSelection | null =
        sessionSelections[selectionScopeKey] ?? null;
      const targetSession =
        loadedSessions.sessions.find((session) => session.sessionId === request.sessionId) ??
        null;
      webDevTrace("console.reconcile.sessions.loaded", {
        deviceId: request.deviceId,
        sessionId: request.sessionId,
        clientMessageId: request.clientMessageId,
        submitTraceId: request.submitTraceId,
        attempt: request.attempt,
        count: loadedSessions.sessions.length,
        targetFound: Boolean(targetSession)
      });

      patchDeviceWorkspace(request.deviceId, (currentWorkspace) =>
        mergeLiveSessionsIntoWorkspace(
          currentWorkspace,
          loadedSessions.sessions,
          savedSelection
        )
      );

      if (!targetSession) {
        webDevTrace("console.reconcile.target_missing", {
          deviceId: request.deviceId,
          sessionId: request.sessionId,
          clientMessageId: request.clientMessageId,
          submitTraceId: request.submitTraceId,
          attempt: request.attempt,
          delayMs: MESSAGE_RECONCILE_INTERVAL_MS
        });
        scheduleMessageReconciliationAttempt(
          {
            ...request,
            attempt: request.attempt + 1
          },
          MESSAGE_RECONCILE_INTERVAL_MS
        );
        return;
      }

      let shouldStopReconciliation = false;
      if (targetSession.threadId) {
        const page = await getCodexHistoryTurns(request.connection, {
          cacheMode: "bypass",
          id: targetSession.threadId,
          cwd: targetSession.cwd,
          limit: 40
        });
        const pageKey = codexHistoryKey(page.entry);
        const historyDecision = decideMessageHistoryReconciliation({
          request,
          session: targetSession,
          turns: page.turns
        });
        const historyItemCount = page.turns.reduce(
          (count, turn) => count + turn.items.length,
          0
        );
        webDevTrace("console.reconcile.history.decision", {
          deviceId: request.deviceId,
          sessionId: request.sessionId,
          threadId: targetSession.threadId,
          turnId: request.turnId,
          clientMessageId: request.clientMessageId,
          submitTraceId: request.submitTraceId,
          attempt: request.attempt,
          turnCount: page.turns.length,
          itemCount: historyItemCount,
          shouldApplyHistory: historyDecision.shouldApplyHistory,
          shouldStopReconciliation: historyDecision.shouldStopReconciliation
        });
        shouldStopReconciliation = historyDecision.shouldStopReconciliation;
        writeFreshHistoryPageCache(pageKey, page);
        patchDeviceWorkspace(request.deviceId, (currentWorkspace) => {
          let next = upsertSessionInWorkspace(currentWorkspace, targetSession);
          next = rememberSessionHistoryOrigin(next, targetSession.sessionId, page.entry.id);
          if (historyDecision.shouldApplyHistory) {
            next = hydrateSessionFromTurns(next, targetSession.sessionId, page.turns);
            next = setSessionHistoryPageState(next, targetSession.sessionId, {
              autoCompleteFailedCursor: null,
              loadingOlder: false,
              olderCursor: page.nextCursor,
              sourceKey: pageKey
            });
          }
          const turnId =
            targetSession.currentTurnId ?? targetSession.activeTurnId ?? request.turnId;
          const markOptimisticMessage = historyDecision.shouldStopReconciliation
            ? markOptimisticMessageComplete
            : markOptimisticMessageSent;
          return markOptimisticMessage(next, request.clientMessageId, {
            sessionId: targetSession.sessionId,
            ...(targetSession.threadId ? { threadId: targetSession.threadId } : {}),
            ...(turnId ? { turnId } : {})
          });
        });
      } else {
        patchDeviceWorkspace(request.deviceId, (currentWorkspace) => {
          const turnId =
            targetSession.currentTurnId ?? targetSession.activeTurnId ?? request.turnId;
          const markOptimisticMessage = isReconciledTerminalSession(targetSession, request)
            ? markOptimisticMessageComplete
            : markOptimisticMessageSent;
          return markOptimisticMessage(
            upsertSessionInWorkspace(currentWorkspace, targetSession),
            request.clientMessageId,
            {
              sessionId: targetSession.sessionId,
              ...(targetSession.threadId ? { threadId: targetSession.threadId } : {}),
              ...(turnId ? { turnId } : {})
            }
          );
        });
        shouldStopReconciliation = isReconciledTerminalSession(targetSession, request);
      }

      if (shouldStopReconciliation) {
        webDevTrace("console.reconcile.stop", {
          deviceId: request.deviceId,
          sessionId: request.sessionId,
          turnId: request.turnId,
          clientMessageId: request.clientMessageId,
          submitTraceId: request.submitTraceId,
          attempt: request.attempt,
          durationMs: traceDurationMs(startedAt)
        });
        const context = submitTraceByClientMessageRef.current.get(request.clientMessageId);
        if (context) {
          traceSubmitReconciled(context, {
            source: "history_or_terminal_session",
            attempt: request.attempt,
            durationMs: traceDurationMs(startedAt)
          });
        }
        clearMessageReconciliation(request);
        return;
      }
      webDevTrace("console.reconcile.reschedule", {
        deviceId: request.deviceId,
        sessionId: request.sessionId,
        turnId: request.turnId,
        clientMessageId: request.clientMessageId,
        submitTraceId: request.submitTraceId,
        attempt: request.attempt + 1,
        durationMs: traceDurationMs(startedAt),
        delayMs: MESSAGE_RECONCILE_INTERVAL_MS
      });
      scheduleMessageReconciliationAttempt(
        {
          ...request,
          attempt: request.attempt + 1
        },
        MESSAGE_RECONCILE_INTERVAL_MS
      );
    } catch (error) {
      webDevTrace("console.reconcile.error", {
        deviceId: request.deviceId,
        sessionId: request.sessionId,
        turnId: request.turnId,
        clientMessageId: request.clientMessageId,
        submitTraceId: request.submitTraceId,
        attempt: request.attempt,
        durationMs: traceDurationMs(startedAt),
        ...webErrorSummary(error)
      });
      scheduleMessageReconciliationAttempt(
        {
          ...request,
          attempt: request.attempt + 1
        },
        MESSAGE_RECONCILE_INTERVAL_MS
      );
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
      throw new Error(formatMissingHistoryFolderMessage(entry.cwd));
    }

    patchActiveWorkspace((workspace) => ({
      ...workspace,
      resumeStates: {
        ...workspace.resumeStates,
        [previewSession.sessionId]: "resuming"
      }
    }));

    try {
      const submitContext = submitTraceByClientMessageRef.current.get(clientMessageId);
      if (submitContext) {
        traceSubmitStep("console.submit.rpc_start", submitContext, {
          operation: "resume_history",
          historyId: entry.id,
          previewSessionId: previewSession.sessionId
        });
      }
      const result = await resumeCodexHistory(connection, {
        id: entry.id,
        cwd: entry.cwd,
        model,
        ...(providerSessionRequest ?? {}),
        serviceTier,
        permissionMode,
        reasoningEffort
      });
      const resumedContext =
        updateSubmitTrace(clientMessageId, {
          sessionId: result.session.sessionId,
          turnId: result.session.currentTurnId ?? result.session.activeTurnId
        }) ?? submitContext;
      if (resumedContext) {
        traceSubmitStep("console.submit.ack", resumedContext, {
          operation: "resume_history",
          sessionId: result.session.sessionId,
          threadId: result.session.threadId
        });
      }
      writeFreshHistoryPageCache(codexHistoryKey(result.history.entry), result.history);
      patchActiveWorkspace((workspace) => {
        let next = upsertSessionInWorkspace(workspace, result.session);
        next = rememberSessionHistoryOrigin(
          next,
          result.session.sessionId,
          result.history.entry.id
        );
        next = reassignSessionChatItems(next, previewSession.sessionId, result.session.sessionId);
        next = hydrateSessionFromTurns(next, result.session.sessionId, result.history.turns);
        next = setSessionHistoryPageState(next, result.session.sessionId, {
          autoCompleteFailedCursor: null,
          loadingOlder: false,
          olderCursor: result.history.nextCursor,
          sourceKey: codexHistoryKey(result.history.entry)
        });
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

      const sendContext = submitTraceByClientMessageRef.current.get(clientMessageId);
      if (sendContext) {
        traceSubmitStep("console.submit.rpc_start", sendContext, {
          operation: "send_after_resume",
          sessionId: result.session.sessionId,
          threadId: result.session.threadId
        });
      }
      const sent = await sendSessionMessage(connection, result.session.sessionId, {
        text: message,
        clientMessageId,
        serviceTier
      });
      if (sent.mode === "queued") {
        throw new Error("恢复会话后消息被排队，请稍后重试。");
      }
      const sentContext =
        updateSubmitTrace(clientMessageId, {
          sessionId: result.session.sessionId,
          turnId: sent.turnId
        }) ?? sendContext;
      if (sentContext) {
        traceSubmitStep("console.submit.ack", sentContext, {
          operation: "send_after_resume",
          sessionId: result.session.sessionId,
          turnId: sent.turnId,
          mode: sent.mode
        });
      }
      patchActiveWorkspace((workspace) =>
        markOptimisticMessageSent(workspace, clientMessageId, {
          sessionId: result.session.sessionId,
          ...(result.session.threadId ? { threadId: result.session.threadId } : {}),
          turnId: sent.turnId
        })
      );
      const selectedDeviceId = selectedDeviceIdRef.current;
      if (selectedDeviceId) {
        scheduleMessageReconciliation({
          clientMessageId,
          connection,
          deviceId: selectedDeviceId,
          messageText: message,
          sessionId: result.session.sessionId,
          submitTraceId: submitTraceByClientMessageRef.current.get(clientMessageId)?.submitTraceId,
          turnId: sent.turnId
        });
      } else if (sentContext) {
        traceSubmitFailed(sentContext, {
          source: "missing_selected_device_for_reconcile",
          messageDelivery: "ack_success",
          operation: "send_after_resume"
        });
      }
    } catch (err) {
      const submitContext = submitTraceByClientMessageRef.current.get(clientMessageId);
      if (submitContext) {
        traceSubmitFailed(submitContext, {
          source: "resume_history_message",
          ...webErrorSummary(err)
        });
      }
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
    objective: string,
    clientMessageId?: string
  ) {
    if (isPreviewOnlyHistoryEntry(entry)) {
      patchActiveWorkspace((workspace) => ({
        ...workspace,
        resumeStates: {
          ...workspace.resumeStates,
          [previewSession.sessionId]: "missing"
        }
      }));
      throw new Error(formatMissingHistoryFolderMessage(entry.cwd));
    }

    patchActiveWorkspace((workspace) => ({
      ...workspace,
      resumeStates: {
        ...workspace.resumeStates,
        [previewSession.sessionId]: "resuming"
      }
    }));

    try {
      const submitContext = clientMessageId
        ? submitTraceByClientMessageRef.current.get(clientMessageId)
        : null;
      if (submitContext) {
        traceSubmitStep("console.submit.rpc_start", submitContext, {
          operation: "resume_history",
          historyId: entry.id,
          previewSessionId: previewSession.sessionId
        });
      }
      const result = await resumeCodexHistory(connection, {
        id: entry.id,
        cwd: entry.cwd,
        model,
        ...(providerSessionRequest ?? {}),
        serviceTier,
        permissionMode,
        reasoningEffort
      });
      const resumedContext = clientMessageId
        ? updateSubmitTrace(clientMessageId, {
            sessionId: result.session.sessionId,
            turnId: result.session.currentTurnId ?? result.session.activeTurnId
          }) ?? submitContext
        : submitContext;
      if (resumedContext) {
        traceSubmitStep("console.submit.ack", resumedContext, {
          operation: "resume_history",
          sessionId: result.session.sessionId,
          threadId: result.session.threadId
        });
      }
      writeFreshHistoryPageCache(codexHistoryKey(result.history.entry), result.history);
      patchActiveWorkspace((workspace) => {
        let next = upsertSessionInWorkspace(workspace, result.session);
        next = rememberSessionHistoryOrigin(
          next,
          result.session.sessionId,
          result.history.entry.id
        );
        next = reassignSessionChatItems(next, previewSession.sessionId, result.session.sessionId);
        next = hydrateSessionFromTurns(next, result.session.sessionId, result.history.turns);
        next = setSessionHistoryPageState(next, result.session.sessionId, {
          autoCompleteFailedCursor: null,
          loadingOlder: false,
          olderCursor: result.history.nextCursor,
          sourceKey: codexHistoryKey(result.history.entry)
        });
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

      if (resumedContext) {
        traceSubmitStep("console.submit.rpc_start", resumedContext, {
          operation: "set_goal_after_resume",
          sessionId: result.session.sessionId
        });
      }
      await setGoalForSession(result.session.sessionId, {
        objective,
        status: "active",
        tokenBudget: result.session.goal?.tokenBudget ?? null
      });
      if (resumedContext) {
        traceSubmitStep("console.submit.ack", resumedContext, {
          operation: "set_goal_after_resume",
          sessionId: result.session.sessionId
        });
        traceSubmitReconciled(resumedContext, {
          source: "goal_ack",
          operation: "set_goal_after_resume",
          sessionId: result.session.sessionId
        });
      }
      if (clientMessageId) {
        patchActiveWorkspace((workspace) =>
          markOptimisticMessageSent(workspace, clientMessageId, {
            sessionId: result.session.sessionId,
            ...(result.session.threadId ? { threadId: result.session.threadId } : {})
          })
        );
      }
    } catch (err) {
      const submitContext = clientMessageId
        ? submitTraceByClientMessageRef.current.get(clientMessageId)
        : null;
      if (submitContext) {
        traceSubmitFailed(submitContext, {
          source: "resume_history_goal",
          ...webErrorSummary(err)
        });
      }
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

  function runSlashCommand(commandId: SlashCommandId) {
    if (commandId !== "fast") {
      return;
    }

    setServiceTier(FAST_SERVICE_TIER);
    setDraft("");
    setActiveMenu(null);
    setError(null);
    webDevTrace("console.slash_command.applied", {
      commandId,
      serviceTier: FAST_SERVICE_TIER
    });
  }

  function clearServiceTier() {
    setServiceTier(null);
  }

  async function submitComposer(submitMode?: LocalMessageSubmitMode) {
    const submitStartedAt = Date.now();
    const submitTraceId = createClientId("submit");
    const text = draft.trim();
    const submitIntentFields = {
      submitTraceId,
      draftLength: draft.length,
      textLength: text.length,
      connected,
      hasCurrentSession: Boolean(currentSession),
      currentSessionId: currentSession?.sessionId,
      currentThreadId: currentSession?.threadId,
      goalComposerMode,
      attachmentCount: attachments.length
    };
    webDevTrace("console.submit.intent", submitIntentFields);
    webDevTrace("console.submit.begin", submitIntentFields);
    if (!text) {
      webDevTrace("console.submit.failed", {
        submitTraceId,
        reason: "empty_text",
        durationMs: traceDurationMs(submitStartedAt)
      });
      webDevTrace("console.submit.skip", {
        reason: "empty_text",
        durationMs: traceDurationMs(submitStartedAt)
      });
      return;
    }
    const submittedSlashCommand = resolveSubmittedSlashCommand(draft);
    if (submittedSlashCommand) {
      webDevTrace("console.submit.slash_command", {
        submitTraceId,
        commandId: submittedSlashCommand.id,
        durationMs: traceDurationMs(submitStartedAt)
      });
      runSlashCommand(submittedSlashCommand.id);
      return;
    }
    if (!connected) {
      webDevTrace("console.submit.failed", {
        submitTraceId,
        reason: "not_connected",
        durationMs: traceDurationMs(submitStartedAt)
      });
      webDevTrace("console.submit.skip", {
        reason: "not_connected",
        durationMs: traceDurationMs(submitStartedAt)
      });
      setActiveSheet("device");
      return;
    }
    const resumeBlockMessage = resolveComposerResumeBlock(
      currentResumeState,
      selectedHistoryEntry?.cwd ?? currentSession?.cwd ?? cwd
    );
    if (resumeBlockMessage) {
      webDevTrace("console.submit.failed", {
        submitTraceId,
        reason: "resume_blocked",
        messageLength: resumeBlockMessage.length,
        durationMs: traceDurationMs(submitStartedAt)
      });
      webDevTrace("console.submit.skip", {
        reason: "resume_blocked",
        messageLength: resumeBlockMessage.length,
        durationMs: traceDurationMs(submitStartedAt)
      });
      setError(resumeBlockMessage);
      return;
    }
    if (!currentSession && !cwd.trim()) {
      webDevTrace("console.submit.failed", {
        submitTraceId,
        reason: "missing_cwd",
        durationMs: traceDurationMs(submitStartedAt)
      });
      webDevTrace("console.submit.skip", {
        reason: "missing_cwd",
        durationMs: traceDurationMs(submitStartedAt)
      });
      setActiveSheet("session");
      await loadDirectories(undefined);
      return;
    }
    if (!currentSession || isHistoryPreviewSessionId(currentSession.sessionId)) {
      const providerValidationError = validateProviderSessionRequest({
        catalog: providerCatalog,
        loading: providerCatalogLoading,
        request: providerSessionRequest,
        status: codexProviderStatus
      });
      if (providerValidationError) {
        webDevTrace("console.submit.failed", {
          submitTraceId,
          reason: "invalid_provider_config",
          durationMs: traceDurationMs(submitStartedAt)
        });
        setError(providerValidationError);
        setActiveSheet("session");
        return;
      }
    }

    if (goalComposerMode) {
      const clientMessageId = createClientId("goal");
      const targetSessionId = currentSession?.sessionId ?? pendingSessionId(clientMessageId);
      const submitContext: SubmitTraceContext = {
        clientMessageId,
        deviceId: selectedDeviceIdRef.current,
        kind: "goal",
        sessionId: targetSessionId,
        startedAt: submitStartedAt,
        submitTraceId,
        textLength: text.length
      };
      rememberSubmitTrace(submitContext);
      webDevTrace("console.submit.goal.begin", {
        submitTraceId,
        clientMessageId,
        targetSessionId,
        hasCurrentSession: Boolean(currentSession),
        textLength: text.length
      });

      patchActiveWorkspace((workspace) =>
        addOptimisticUserMessage(workspace, {
          sessionId: targetSessionId,
          clientMessageId,
          text
        })
      );
      traceSubmitStep("console.submit.queued", submitContext, {
        targetSessionId,
        hasCurrentSession: Boolean(currentSession)
      });
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
              webDevTrace("console.submit.goal.error", {
                submitTraceId,
                clientMessageId,
                reason: "missing_history_entry"
              });
              throw new Error("这条记录暂时不可用，请刷新后重试。");
            }
            webDevTrace("console.submit.goal.resume_history", {
              submitTraceId,
              clientMessageId,
              previewSessionId: currentSession.sessionId,
              historyId: historyEntry.id
            });
            await resumeHistorySessionForGoal(
              historyEntry,
              currentSession,
              text,
              clientMessageId
            );
          } else {
            webDevTrace("console.submit.goal.set_existing", {
              submitTraceId,
              clientMessageId,
              sessionId: currentSession.sessionId
            });
            traceSubmitStep("console.submit.rpc_start", submitContext, {
              operation: "set_goal",
              sessionId: currentSession.sessionId
            });
            await setGoalForSession(currentSession.sessionId, {
              objective: text,
              status: "active",
              tokenBudget: currentSession.goal?.tokenBudget ?? null
            });
            const sentContext =
              updateSubmitTrace(clientMessageId, {
                sessionId: currentSession.sessionId
              }) ?? submitContext;
            traceSubmitStep("console.submit.ack", sentContext, {
              operation: "set_goal",
              sessionId: currentSession.sessionId
            });
            traceSubmitReconciled(sentContext, {
              source: "goal_ack",
              operation: "set_goal",
              sessionId: currentSession.sessionId
            });
            patchActiveWorkspace((workspace) =>
              markOptimisticMessageSent(workspace, clientMessageId, {
                sessionId: currentSession.sessionId,
                ...(currentSession.threadId ? { threadId: currentSession.threadId } : {})
              })
            );
          }
          setGoalComposerMode(false);
          webDevTrace("console.submit.goal.end", {
            submitTraceId,
            clientMessageId,
            durationMs: traceDurationMs(submitStartedAt)
          });
          return;
        }

        const pendingSession = makePendingSession({
          sessionId: targetSessionId,
          cwd: cwd.trim(),
          model,
          permissionMode,
          serviceTier,
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

        webDevTrace("console.submit.goal.create_session", {
          submitTraceId,
          clientMessageId,
          pendingSessionId: pendingSession.sessionId,
          cwd: cwd.trim(),
          model,
          permissionMode,
          reasoningEffort
        });
        traceSubmitStep("console.submit.rpc_start", submitContext, {
          operation: "create_session_with_goal",
          pendingSessionId: pendingSession.sessionId
        });
        const result = await createSession(connection, {
          cwd: cwd.trim(),
          model,
          ...(providerSessionRequest ?? {}),
          serviceTier,
          reasoningEffort,
          permissionMode,
          tokenBudget: initialTokenBudget ? Number(initialTokenBudget) : null,
          initialGoal: text,
          initialMessage: null
        });
        const sentContext =
          updateSubmitTrace(clientMessageId, {
            sessionId: result.session.sessionId,
            turnId: result.session.currentTurnId ?? result.session.activeTurnId
          }) ?? submitContext;
        traceSubmitStep("console.submit.ack", sentContext, {
          operation: "create_session_with_goal",
          sessionId: result.session.sessionId,
          threadId: result.session.threadId
        });

        patchActiveWorkspace((workspace) => {
          let next = reassignSessionChatItems(
            workspace,
            pendingSession.sessionId,
            result.session.sessionId
          );
          next = markOptimisticMessageSent(next, clientMessageId, {
            sessionId: result.session.sessionId,
            ...(result.session.threadId ? { threadId: result.session.threadId } : {})
          });
          next = upsertSessionInWorkspace(next, result.session);
          return {
            ...next,
            currentSessionId: result.session.sessionId,
            selectedHistoryKey: null,
            cwd: result.session.cwd,
            sessions: next.sessions.filter(
              (session) =>
                session.sessionId !== pendingSession.sessionId ||
                session.sessionId === result.session.sessionId
            )
          };
        });
        setGoalComposerMode(false);
        setActiveSheet(null);
        traceSubmitReconciled(sentContext, {
          source: "goal_ack",
          operation: "create_session_with_goal",
          sessionId: result.session.sessionId,
          threadId: result.session.threadId
        });
        webDevTrace("console.submit.goal.end", {
          submitTraceId,
          clientMessageId,
          sessionId: result.session.sessionId,
          threadId: result.session.threadId,
          durationMs: traceDurationMs(submitStartedAt)
        });
        return;
      } catch (err) {
        webDevTrace("console.submit.goal.error", {
          submitTraceId,
          clientMessageId,
          durationMs: traceDurationMs(submitStartedAt),
          ...webErrorSummary(err)
        });
        traceSubmitFailed(submitContext, {
          durationMs: traceDurationMs(submitStartedAt),
          ...webErrorSummary(err)
        });
        patchActiveWorkspace((workspace) =>
          markOptimisticMessageFailed(workspace, clientMessageId, formatError(err))
        );
        setError(formatConsoleError(err));
        return;
      }
    }

    const message = buildMessageWithAttachments(text, attachments);
    const clientMessageId = createClientId("message");
    const pendingCurrentSessionId =
      currentSession && isPendingSessionId(currentSession.sessionId)
        ? currentSession.sessionId
        : null;
    const realCurrentSession = pendingCurrentSessionId ? null : currentSession;
    const targetSessionId =
      realCurrentSession?.sessionId ?? pendingCurrentSessionId ?? pendingSessionId(clientMessageId);
    const activeSubmitMode: LocalMessageSubmitMode | undefined =
      realCurrentSession?.activeTurnId ? (submitMode ?? "queue") : undefined;
    const submitContext: SubmitTraceContext = {
      clientMessageId,
      deviceId: selectedDeviceIdRef.current,
      kind: "message",
      sessionId: targetSessionId,
      startedAt: submitStartedAt,
      submitTraceId,
      textLength: message.length
    };
    rememberSubmitTrace(submitContext);
    webDevTrace("console.submit.message.begin", {
      submitTraceId,
      clientMessageId,
      targetSessionId,
      messageLength: message.length,
      attachmentCount: attachments.length,
      hasCurrentSession: Boolean(realCurrentSession),
      pendingCurrentSessionId,
      activeSubmitMode: activeSubmitMode ?? null
    });

    // The active turn belongs to the backend's current run; new user input stays local
    // until the RPC ack returns the authoritative turnId.
    patchActiveWorkspace((workspace) => {
      let next = addOptimisticUserMessage(workspace, {
        sessionId: targetSessionId,
        clientMessageId,
        text: message,
        ...(activeSubmitMode === "queue" || pendingCurrentSessionId
          ? {
              status: "queued",
              includeThinking: true
            }
          : {})
      });
      if (activeSubmitMode === "queue" && realCurrentSession) {
        const queuedMessages = realCurrentSession.queuedMessages ?? [];
        next = upsertSessionInWorkspace(next, {
          ...realCurrentSession,
          queuedMessages: [
            ...queuedMessages.filter((item) => item.clientMessageId !== clientMessageId),
            {
              clientMessageId,
              createdAt: submitStartedAt,
              order: queuedMessages.length + 1,
              serviceTier,
              text: message,
              updatedAt: submitStartedAt
            }
          ]
        });
      } else if (pendingCurrentSessionId && currentSession) {
        const queuedMessages = currentSession.queuedMessages ?? [];
        next = upsertSessionInWorkspace(next, {
          ...currentSession,
          queuedMessages: [
            ...queuedMessages.filter((item) => item.clientMessageId !== clientMessageId),
            {
              clientMessageId,
              createdAt: submitStartedAt,
              order: queuedMessages.length + 1,
              serviceTier,
              text: message,
              updatedAt: submitStartedAt
            }
          ]
        });
      }
      return next;
    });
    traceSubmitStep("console.submit.queued", submitContext, {
      targetSessionId,
      hasCurrentSession: Boolean(realCurrentSession),
      pendingCurrentSessionId
    });
    setDraft("");
    setAttachments([]);
    setError(null);

    try {
      if (pendingCurrentSessionId) {
        enqueuePendingSessionMessage(pendingCurrentSessionId, {
          clientMessageId,
          context: submitContext,
          message,
          serviceTier
        });
        webDevTrace("console.submit.message.end", {
          submitTraceId,
          clientMessageId,
          mode: "pending_session_queue",
          pendingSessionId: pendingCurrentSessionId,
          durationMs: traceDurationMs(submitStartedAt)
        });
        return;
      }

      if (realCurrentSession) {
        if (isHistoryPreviewSessionId(realCurrentSession.sessionId)) {
          const historyEntry =
            selectedHistoryEntry ??
            codexHistory.find(
              (entry) => historyPreviewSessionId(entry) === realCurrentSession.sessionId
            ) ??
            null;
          if (!historyEntry) {
            webDevTrace("console.submit.message.error", {
              submitTraceId,
              clientMessageId,
              reason: "missing_history_entry"
            });
            throw new Error("这条记录暂时不可用，请刷新后重试。");
          }
          webDevTrace("console.submit.message.resume_history", {
            submitTraceId,
            clientMessageId,
            previewSessionId: realCurrentSession.sessionId,
            historyId: historyEntry.id
          });
          await resumeHistorySessionForMessage(historyEntry, realCurrentSession, message, clientMessageId);
          webDevTrace("console.submit.message.end", {
            submitTraceId,
            clientMessageId,
            mode: "resume_history",
            durationMs: traceDurationMs(submitStartedAt)
          });
          return;
        }
        webDevTrace("console.submit.message.send_existing", {
          submitTraceId,
          clientMessageId,
          sessionId: realCurrentSession.sessionId,
          threadId: realCurrentSession.threadId,
          activeTurnId: realCurrentSession.activeTurnId,
          activeSubmitMode: activeSubmitMode ?? null
        });
        traceSubmitStep("console.submit.rpc_start", submitContext, {
          operation: "send_existing",
          sessionId: realCurrentSession.sessionId,
          threadId: realCurrentSession.threadId,
          activeTurnId: realCurrentSession.activeTurnId,
          activeSubmitMode: activeSubmitMode ?? null
        });
        const result = await sendSessionMessage(connection, realCurrentSession.sessionId, {
          text: message,
          clientMessageId,
          serviceTier,
          ...(activeSubmitMode ? { submitMode: activeSubmitMode } : {})
        });
        if (result.mode === "queued") {
          const queuedContext =
            updateSubmitTrace(clientMessageId, {
              sessionId: realCurrentSession.sessionId
            }) ?? submitContext;
          traceSubmitStep("console.submit.ack", queuedContext, {
            operation: "send_existing",
            sessionId: realCurrentSession.sessionId,
            mode: result.mode,
            queuePosition: result.queuePosition
          });
          patchActiveWorkspace((workspace) =>
            markOptimisticMessageQueued(workspace, clientMessageId, {
              sessionId: realCurrentSession.sessionId,
              ...(realCurrentSession.threadId ? { threadId: realCurrentSession.threadId } : {})
            })
          );
          webDevTrace("console.submit.message.end", {
            submitTraceId,
            clientMessageId,
            sessionId: realCurrentSession.sessionId,
            mode: result.mode,
            queuePosition: result.queuePosition,
            durationMs: traceDurationMs(submitStartedAt)
          });
          return;
        }
        const sentContext =
          updateSubmitTrace(clientMessageId, {
            sessionId: realCurrentSession.sessionId,
            turnId: result.turnId
          }) ?? submitContext;
        traceSubmitStep("console.submit.ack", sentContext, {
          operation: "send_existing",
          sessionId: realCurrentSession.sessionId,
          turnId: result.turnId,
          mode: result.mode
        });
        patchActiveWorkspace((workspace) =>
          markOptimisticMessageSent(workspace, clientMessageId, {
            sessionId: realCurrentSession.sessionId,
            ...(realCurrentSession.threadId ? { threadId: realCurrentSession.threadId } : {}),
            turnId: result.turnId
          })
        );
        const selectedDeviceId = selectedDeviceIdRef.current;
        if (selectedDeviceId) {
          scheduleMessageReconciliation({
            clientMessageId,
            connection,
            deviceId: selectedDeviceId,
            messageText: message,
            sessionId: realCurrentSession.sessionId,
            submitTraceId,
            turnId: result.turnId
          });
        } else {
          traceSubmitFailed(sentContext, {
            source: "missing_selected_device_for_reconcile",
            messageDelivery: "ack_success",
            operation: "send_existing"
          });
        }
        webDevTrace("console.submit.message.end", {
          submitTraceId,
          clientMessageId,
          sessionId: realCurrentSession.sessionId,
          turnId: result.turnId,
          mode: result.mode,
          durationMs: traceDurationMs(submitStartedAt)
        });
        return;
      }

      const pendingSession = makePendingSession({
        sessionId: targetSessionId,
        cwd: cwd.trim(),
        model,
        permissionMode,
        serviceTier,
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

      webDevTrace("console.submit.message.create_session", {
        submitTraceId,
        clientMessageId,
        pendingSessionId: pendingSession.sessionId,
        cwd: cwd.trim(),
        model,
        permissionMode,
        reasoningEffort,
        initialGoalLength: initialGoal.trim().length
      });
      traceSubmitStep("console.submit.rpc_start", submitContext, {
        operation: "create_session_with_message",
        pendingSessionId: pendingSession.sessionId
      });
      const result = await createSession(connection, {
        cwd: cwd.trim(),
        model,
        ...(providerSessionRequest ?? {}),
        serviceTier,
        reasoningEffort,
        permissionMode,
        tokenBudget: initialTokenBudget ? Number(initialTokenBudget) : null,
        initialGoal: initialGoal.trim() || null,
        initialMessage: message,
        clientMessageId
      });
      const sentContext =
        updateSubmitTrace(clientMessageId, {
          sessionId: result.session.sessionId,
          turnId: result.session.currentTurnId ?? result.session.activeTurnId
        }) ?? submitContext;
      traceSubmitStep("console.submit.ack", sentContext, {
        operation: "create_session_with_message",
        sessionId: result.session.sessionId,
        threadId: result.session.threadId,
        turnId: result.session.currentTurnId ?? result.session.activeTurnId
      });

      patchActiveWorkspace((workspace) => {
        const pendingQueuedMessages =
          workspace.sessions.find((session) => session.sessionId === pendingSession.sessionId)
            ?.queuedMessages ?? [];
        let next = reassignSessionChatItems(workspace, pendingSession.sessionId, result.session.sessionId);
        next = markOptimisticMessageSent(next, clientMessageId, {
          sessionId: result.session.sessionId,
          ...(result.session.threadId ? { threadId: result.session.threadId } : {}),
          ...(result.session.currentTurnId ?? result.session.activeTurnId
            ? { turnId: result.session.currentTurnId ?? result.session.activeTurnId }
            : {})
        });
        const serverQueuedMessageIds = new Set(
          result.session.queuedMessages.map((message) => message.clientMessageId)
        );
        next = upsertSessionInWorkspace(next, {
          ...result.session,
          queuedMessages: [
            ...result.session.queuedMessages,
            ...pendingQueuedMessages.filter(
              (message) => !serverQueuedMessageIds.has(message.clientMessageId)
            )
          ].map((message, index) => ({
            ...message,
            order: index + 1
          }))
        });
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
      const selectedDeviceId = selectedDeviceIdRef.current;
      if (selectedDeviceId) {
        scheduleMessageReconciliation({
          clientMessageId,
          connection,
          deviceId: selectedDeviceId,
          messageText: message,
          sessionId: result.session.sessionId,
          submitTraceId,
          turnId: result.session.currentTurnId ?? result.session.activeTurnId
        });
      } else {
        traceSubmitFailed(sentContext, {
          source: "missing_selected_device_for_reconcile",
          messageDelivery: "ack_success",
          operation: "create_session_with_message"
        });
      }
      void drainPendingSessionMessageQueue({
        connection,
        pendingSessionIdValue: pendingSession.sessionId,
        sessionId: result.session.sessionId,
        threadId: result.session.threadId
      });
      setActiveSheet(null);
      webDevTrace("console.submit.message.end", {
        submitTraceId,
        clientMessageId,
        sessionId: result.session.sessionId,
        threadId: result.session.threadId,
        mode: "create_session",
        durationMs: traceDurationMs(submitStartedAt)
      });
    } catch (err) {
      webDevTrace("console.submit.message.error", {
        submitTraceId,
        clientMessageId,
        durationMs: traceDurationMs(submitStartedAt),
        ...webErrorSummary(err)
      });
      traceSubmitFailed(submitContext, {
        durationMs: traceDurationMs(submitStartedAt),
        ...webErrorSummary(err)
      });
      patchActiveWorkspace((workspace) =>
        markOptimisticMessageFailed(workspace, clientMessageId, formatError(err))
      );
      if (isPendingSessionId(targetSessionId)) {
        failPendingSessionMessageQueue(targetSessionId, err);
      }
      setError(formatConsoleError(err));
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
    cancelHistoryAutoCompletion("select_session");
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

  function startNewSessionDraft() {
    cancelHistoryAutoCompletion("new_session");
    patchActiveWorkspace((workspace) => ({
      ...workspace,
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

  function openNewSessionSetup() {
    startNewSessionDraft();
    setActiveSheet("session");
    void loadDirectories(undefined);
  }

  function closeActiveSheet() {
    setActiveSheet(null);
  }

  function selectCwd(nextCwd: string) {
    cancelHistoryAutoCompletion("select_cwd");
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
      setError(formatConsoleConnectionError(err, nextConnection.relayUrl));
    }
  }

  async function handleAttachFiles(files: FileList | null) {
    try {
      await attachFiles(files);
    } catch (err) {
      setError(formatConsoleError(err));
    }
  }

  async function handleLoadDirectories(path?: string) {
    try {
      await loadDirectories(path);
    } catch (err) {
      setError(formatConsoleError(err));
    }
  }

  async function handleInterrupt() {
    try {
      await interrupt();
    } catch (err) {
      setError(formatConsoleError(err));
    }
  }

  async function handleApprovalDecision(approvalId: string, decision: LocalApprovalDecision) {
    try {
      await decideApproval(approvalId, decision);
    } catch (err) {
      setError(formatConsoleError(err));
    }
  }

  async function handleClearGoal() {
    try {
      await clearGoal();
      setGoalComposerMode(false);
    } catch (err) {
      setError(formatConsoleError(err));
    }
  }

  async function handleRefreshGoal() {
    try {
      await refreshGoal();
    } catch (err) {
      setError(formatConsoleError(err));
    }
  }

  async function handlePauseGoal() {
    try {
      await setGoal({ status: "paused" });
    } catch (err) {
      setError(formatConsoleError(err));
    }
  }

  async function handleResumeGoal() {
    try {
      await setGoal({ status: "active" });
    } catch (err) {
      setError(formatConsoleError(err));
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
      setError(formatConsoleError(err));
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

  function queuedMessageClientId(input: LocalQueueActionInput): string | null {
    return "clientMessageId" in input ? input.clientMessageId : null;
  }

  function findQueuedMessageOwner(input: LocalQueueActionInput): LocalSessionSummary | null {
    const clientMessageId = queuedMessageClientId(input);
    if (clientMessageId) {
      return (
        sessions.find((session) =>
          session.queuedMessages.some((message) => message.clientMessageId === clientMessageId)
        ) ?? currentSession
      );
    }
    if (currentSession?.queuedMessages.length) {
      return currentSession;
    }
    return currentSession;
  }

  function applyOptimisticQueueAction(
    session: LocalSessionSummary,
    input: LocalQueueActionInput
  ): LocalSessionSummary {
    const now = Date.now();
    const reorder = (messages: LocalSessionSummary["queuedMessages"]) =>
      messages.map((message, index) => ({
        ...message,
        order: index + 1
      }));
    if (input.action === "clear") {
      return { ...session, queuedMessages: [] };
    }
    if (input.action === "reorder") {
      const byId = new Map(
        session.queuedMessages.map((message) => [message.clientMessageId, message])
      );
      return {
        ...session,
        queuedMessages: reorder([
          ...input.clientMessageIds.flatMap((clientMessageId) => {
            const message = byId.get(clientMessageId);
            return message ? [message] : [];
          }),
          ...session.queuedMessages.filter(
            (message) => !input.clientMessageIds.includes(message.clientMessageId)
          )
        ])
      };
    }
    if (input.action === "delete" || input.action === "steer") {
      return {
        ...session,
        queuedMessages: reorder(
          session.queuedMessages.filter(
            (message) => message.clientMessageId !== input.clientMessageId
          )
        )
      };
    }
    return {
      ...session,
      queuedMessages: reorder(
        session.queuedMessages.map((message) =>
          message.clientMessageId === input.clientMessageId
            ? {
                ...message,
                text: input.text,
                updatedAt: now
              }
            : message
        )
      )
    };
  }

  async function updateCurrentSessionQueue(input: LocalQueueActionInput) {
    const ownerSession = findQueuedMessageOwner(input);
    if (!connection || !ownerSession) {
      return;
    }
    patchActiveWorkspace((workspace) =>
      upsertSessionInWorkspace(workspace, applyOptimisticQueueAction(ownerSession, input))
    );
    if (isPendingSessionId(ownerSession.sessionId)) {
      updatePendingSessionMessageQueue(ownerSession.sessionId, input);
      webDevTrace("console.queue.action.skipped", {
        action: input.action,
        reason: "pending_session",
        sessionId: ownerSession.sessionId,
        clientMessageId: queuedMessageClientId(input)
      });
      return;
    }
    try {
      const result = await updateSessionQueue(connection, ownerSession.sessionId, input);
      patchActiveWorkspace((workspace) => upsertSessionInWorkspace(workspace, result.session));
    } catch (err) {
      setError(formatConsoleError(err));
    }
  }

  function handleQueuedMessageDelete(clientMessageId: string) {
    void updateCurrentSessionQueue({ action: "delete", clientMessageId });
  }

  function handleQueuedMessageEdit(clientMessageId: string, text: string) {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }
    void updateCurrentSessionQueue({ action: "edit", clientMessageId, text: trimmed });
  }

  function handleQueuedMessageReorder(clientMessageIds: string[]) {
    void updateCurrentSessionQueue({ action: "reorder", clientMessageIds });
  }

  function handleQueuedMessageSteer(clientMessageId: string) {
    void updateCurrentSessionQueue({ action: "steer", clientMessageId });
  }

  function handleQueuedMessagesClear() {
    void updateCurrentSessionQueue({ action: "clear" });
  }

  function dismissMigrationNotice() {
    setMigrationNotice(null);
  }

  return {
    activeMenu,
    activeSheet,
    activeTurn,
    attachments,
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
    dismissMigrationNotice,
    handleInterrupt,
    handleLoadDirectories,
    handlePauseGoal,
    handleRefreshGoal,
    handleRemoveAttachment,
    handleQueuedMessageDelete,
    handleQueuedMessageEdit,
    handleQueuedMessageReorder,
    handleQueuedMessageSteer,
    handleQueuedMessagesClear,
    clearServiceTier,
    handleResumeGoal,
    handleSetGoal,
    handleTogglePlanMode,
    hasCurrentGoal,
    healthStatus,
    historyLoadingKey,
    migrationNotice,
    initialHistoryLoading,
    initialGoal,
    initialTokenBudget,
    model,
    providerApiKey,
    providerApiKeyEnv,
    providerAvailable,
    providerBaseUrl,
    providerCatalog,
    providerCatalogLoading,
    providerLabel,
    providerModel,
    providerModelOptions,
    providerOptions: catalogProviderOptions,
    providerProfileId,
    providerStatusMessage,
    openDeviceSheet,
    openSummarySheet,
    openGoalSheet,
    openNewSessionSetup,
    startNewSessionDraft,
    pendingApprovals,
    permissionMode,
    permissionOptions: availablePermissionOptions,
    planModeEnabled,
    pinnedThreadItems,
    projectGroups: visibleProjectGroups,
    togglePinnedProject,
    renameProject,
    archiveProject,
    removeProject,
    reasoningEffort,
    reasoningOptions,
    relayEnabled,
    relayConnectionInfo,
    resetSidebarWidth,
    runSlashCommand,
    savedDevices,
    refreshRelayDevices,
    startProjectSession,
    serviceTier,
    selectCwd,
    selectHistory,
    selectSession,
    selectedDeviceId,
    selectedHistoryEntry,
    activeModelLabel,
    selectedModel,
    selectedPermission,
    selectedProviderModel,
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
    setProviderApiKey,
    setProviderApiKeyEnv,
    setProviderBaseUrl,
    setProviderLabel,
    setProviderModel,
    setProviderProfileId: selectProviderProfile,
    setReasoningEffort,
    setSidebarCollapsed,
    showThreadHoverPreview,
    sidebarSyncing,
    sidebarCollapsed,
    sidebarResizing,
    startSidebarResize,
    streamStatus,
    submitComposer,
    threadHoverPreview,
    togglePinnedThread,
    archiveThread,
    deleteSavedDevice,
    visibleChatItems,
    visibleTurnGroups
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

function messageReconciliationKey(
  request: Pick<
    MessageReconciliationRequest,
    "clientMessageId" | "deviceId" | "sessionId"
  >
): string {
  return `${request.deviceId}:${request.sessionId}:${request.clientMessageId}`;
}

function hasLiveCompletionEvidence(
  workspace: DeviceWorkspace,
  request: MessageReconciliationRequest
): boolean {
  return Boolean(
    request.turnId &&
      selectTurnHasCompletionEvidence(workspace, {
        sessionId: request.sessionId,
        turnId: request.turnId
      })
  );
}

function summarizeTurnGroupStatusCounts(turnGroups: TurnGroup[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const group of turnGroups) {
    const turnKey = `turn:${group.status}`;
    counts[turnKey] = (counts[turnKey] ?? 0) + 1;
    for (const item of group.items) {
      const itemKey = `${item.kind}:${item.status ?? "unset"}`;
      counts[itemKey] = (counts[itemKey] ?? 0) + 1;
    }
  }
  return counts;
}

function latestTurnGroupItemSummary(turnGroups: TurnGroup[]): Record<string, unknown> | null {
  for (let groupIndex = turnGroups.length - 1; groupIndex >= 0; groupIndex -= 1) {
    const group = turnGroups[groupIndex];
    if (!group) {
      continue;
    }
    const item = group.items.at(-1);
    if (!item) {
      continue;
    }
    return {
      id: item.id,
      kind: item.kind,
      role: item.role,
      status: item.status ?? null,
      turnId: group.id,
      clientMessageId: item.clientMessageId ?? null,
      textLength: item.text.length
    };
  }
  return null;
}

function summarizeReducerWorkspaceState(workspace: DeviceWorkspace): Record<string, unknown> {
  return {
    currentSessionId: workspace.currentSessionId,
    selectedHistoryKey: workspace.selectedHistoryKey,
    conversationItemCount: Object.values(workspace.conversations).reduce(
      (total, conversation) => total + conversation.items.length,
      0
    ),
    conversationCount: Object.keys(workspace.conversations).length,
    latestSeq: workspace.events.at(-1)?.seq ?? null,
    outbox: summarizeOutboxStatuses(workspace.outbox)
  };
}

function summarizeHistoryPageCounts(page: LocalCodexHistoryPageResponse): Record<string, unknown> {
  return {
    messageCount: page.messages.length,
    turnCount: page.turns.length,
    turnItemCount: page.turns.reduce((total, turn) => total + turn.items.length, 0),
    hasNextCursor: Boolean(page.nextCursor),
    hasBackwardsCursor: Boolean(page.backwardsCursor)
  };
}

function summarizeHydratedConversation(
  workspace: DeviceWorkspace,
  sessionId: string,
  threadId?: string | undefined
): Record<string, unknown> {
  const input = {
    sessionId,
    ...(threadId ? { threadId } : {})
  };
  const snapshot = selectConversationRenderSnapshot(workspace, input);
  const turnGroups = selectConversationTurnGroups(workspace, input);
  return {
    conversationKey: snapshot.key,
    conversationMessageCount: snapshot.messageCount,
    conversationLatestSeq: snapshot.latestSeq,
    turnGroupCount: turnGroups.length,
    turnGroupItemCount: turnGroups.reduce((total, group) => total + group.items.length, 0),
    statusCounts: summarizeTurnGroupStatusCounts(turnGroups),
    latestItem: latestTurnGroupItemSummary(turnGroups)
  };
}

function summarizeOutboxStatuses(outbox: Record<string, OutboxEntry>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of Object.values(outbox)) {
    counts[entry.status] = (counts[entry.status] ?? 0) + 1;
  }
  return counts;
}

function conversationCacheSignature(
  entriesByDeviceId: Record<string, ConversationCacheEntry[]>
): string {
  return JSON.stringify(
    Object.entries(entriesByDeviceId)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([deviceId, entries]) => [
        deviceId,
        entries.map((entry) => {
          const latestItem = entry.items.at(-1) ?? null;
          const latestTurnId = entry.turnOrder?.at(-1) ?? null;
          const latestTurn = latestTurnId ? entry.turns?.[latestTurnId] ?? null : null;
          const latestTurnItemId = latestTurn?.itemOrder.at(-1) ?? null;
          const latestTurnItem =
            latestTurn && latestTurnItemId ? latestTurn.items[latestTurnItemId] ?? null : null;
          return {
            key: entry.conversationKey,
            latestSeq: entry.latestSeq,
            messageCount: entry.items.length,
            sessionIds: entry.sessionIds,
            threadId: entry.threadId,
            turnCount: entry.turnOrder?.length ?? 0,
            updatedAt: entry.updatedAt,
            latestItem: latestItem
              ? {
                  id: latestItem.id,
                  role: latestItem.role,
                  status: latestItem.status ?? null,
                  textLength: latestItem.text.length,
                  createdAt: latestItem.createdAt ?? null
                }
              : null,
            latestTurn: latestTurn
              ? {
                  id: latestTurn.id,
                  status: latestTurn.status,
                  itemCount: latestTurn.itemOrder.length,
                  latestItem: latestTurnItem
                    ? {
                        id: latestTurnItem.id,
                        status: latestTurnItem.status ?? null,
                        textLength: latestTurnItem.text.length,
                        updatedAt: latestTurnItem.updatedAt
                      }
                    : null
                }
              : null
          };
        })
      ])
  );
}

function summarizeLocalEventTypes(events: LocalEvent[]): string[] {
  return [...new Set(events.map((event) => event.type))].sort();
}

function summarizeLocalEventSeqs(events: LocalEvent[]): {
  count: number;
  first: number | null;
  last: number | null;
  values?: number[];
  sample?: number[];
} {
  const seqs = events.map((event) => event.seq);
  if (seqs.length <= 20) {
    return {
      count: seqs.length,
      first: seqs[0] ?? null,
      last: seqs.at(-1) ?? null,
      values: seqs
    };
  }
  return {
    count: seqs.length,
    first: seqs[0] ?? null,
    last: seqs.at(-1) ?? null,
    sample: [...seqs.slice(0, 10), ...seqs.slice(-10)]
  };
}

function summarizeLocalEventField(
  events: LocalEvent[],
  field: "sessionId" | "threadId" | "turnId"
): string[] {
  return [
    ...new Set(
      events
        .map((event) => event[field])
        .filter((value): value is string => typeof value === "string" && value.length > 0)
    )
  ].sort();
}

function buildProviderSessionRequest(input: {
  apiKey: string;
  apiKeyEnv: string;
  baseUrl: string;
  label: string;
  model: string;
  option: {
    preset: LocalProviderPreset | null;
    value: string;
  };
}): { providerProfileId: string; provider: LocalProviderConfig } | null {
  if (!input.option.value || !input.option.preset) {
    return null;
  }
  const provider = compactProviderConfig({
    preset: input.option.preset,
    providerLabel: input.label,
    baseUrl: input.baseUrl,
    apiKey: input.apiKey,
    apiKeyEnv: input.apiKeyEnv,
    model: input.model
  });
  return {
    providerProfileId: input.option.value,
    provider
  };
}

function validateProviderSessionRequest(input: {
  catalog: LocalProviderCatalogResponse | null;
  loading: boolean;
  request: ReturnType<typeof buildProviderSessionRequest>;
  status: LocalHealthResponse["codexProvider"] | null;
}): string | null {
  const request = input.request;
  if (!request) {
    return null;
  }

  if (input.loading && !input.catalog) {
    return "正在读取当前设备的 Provider 能力，请稍后再试。";
  }
  if (input.status && !input.status.available) {
    return `当前设备未启用 CodexProvider：${input.status.error ?? "请安装 codex-provider 或配置 CODEXNEXT_CODEX_PROVIDER_MODULE。"}`;
  }
  if (!input.catalog) {
    return "还没有读取到当前设备的 Provider 能力，请稍后再试。";
  }
  if (!input.catalog.available) {
    return `当前设备未启用 CodexProvider：${input.catalog.error ?? "请安装 codex-provider 或配置 CODEXNEXT_CODEX_PROVIDER_MODULE。"}`;
  }

  if (request.provider.preset === "custom") {
    if (!request.provider.baseUrl?.trim()) {
      return "请填写自定义 Provider 的 Base URL";
    }
    if (!request.provider.model?.trim()) {
      return "请填写自定义 Provider 的模型";
    }
    if (!request.provider.apiKey?.trim() && !request.provider.apiKeyEnv?.trim()) {
      return "请填写自定义 Provider 的 API Key 或 API Key Env";
    }
    return null;
  }

  const catalogEntry = input.catalog.providers.find(
    (provider) => provider.preset === request.providerProfileId
  );
  if (!catalogEntry) {
    return "当前设备不支持这个 Provider，请重新选择。";
  }
  if (!request.provider.model?.trim() && !catalogEntry.defaultModel.trim()) {
    return "请选择 Provider 模型。";
  }
  if (!request.provider.apiKey?.trim() && !catalogEntry.apiKeyConfigured) {
    return `当前设备没有配置 ${catalogEntry.apiKeyEnv}，请在设备环境变量中设置，或直接填写 API Key。`;
  }
  return null;
}

function shortModelLabel(label: string, fallback: string): string {
  const trimmed = label.trim() || fallback.trim();
  return trimmed.replace(/^DeepSeek /u, "DS ");
}

function sessionActiveModelLabel(
  session: LocalSessionSummary,
  catalog: LocalProviderCatalogResponse | null
): string {
  const model = session.provider?.model ?? session.model ?? "model";
  const provider = session.provider?.providerLabel ?? session.providerProfileId ?? "";
  if (!provider) {
    return model;
  }
  const catalogProvider = catalog?.providers.find(
    (entry) => entry.preset === session.providerProfileId || entry.providerLabel === provider
  );
  const modelLabel =
    catalogProvider?.models.find((entry) => entry.id === model)?.label ?? model;
  return `${catalogProvider?.label ?? provider} · ${modelLabel}`;
}

function compactProviderConfig(
  input: Record<string, string | LocalProviderPreset | null>
): LocalProviderConfig {
  return Object.fromEntries(
    Object.entries(input)
      .map(([key, value]) => [
        key,
        typeof value === "string" ? value.trim() : value
      ])
      .filter(([, value]) => value !== null && value !== "")
  ) as LocalProviderConfig;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, key: string): string | null {
  return typeof record[key] === "string" ? record[key] : null;
}

function readEventClientMessageId(event: LocalEvent): string | null {
  return isRecord(event.payload) ? readString(event.payload, "clientMessageId") : null;
}
