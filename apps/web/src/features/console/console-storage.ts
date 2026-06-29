import {
  normalizeAgentUrl,
  relayOnlyMigrationNoticeStorageKey,
  savedDevicesStorageKey,
  sidebarWidthStorageKey,
  type SavedDevice
} from "../devices/device-utils";
import type {
  LocalCodexHistoryEntry,
  LocalQueuedMessage,
  LocalSessionSummary
} from "../../lib/types";
import type { OutboxEntry, OutboxStatus } from "../chat/chat-state";
import {
  projectSidebarPrefsStorageKey,
  sanitizeProjectSidebarPrefs,
  sanitizeThreadSidebarPrefs,
  threadSidebarPrefsStorageKey,
  type ProjectSidebarPrefs,
  type ThreadSidebarPrefs
} from "../sessions/session-utils";

export const sessionSelectionStorageKey = "codexnext.sessionSelection.v1";
export const workspaceSidebarSnapshotStorageKey =
  "codexnext.workspaceSidebarSnapshots.v1";
export const conversationOutboxStorageKey = "codexnext.conversationOutbox.v1";

export interface SessionSelectionState {
  currentSessionId: string | null;
  selectedHistoryKey: string | null;
}

export interface WorkspaceSidebarSnapshot {
  codexHistory: LocalCodexHistoryEntry[];
  currentSessionId: string | null;
  cwd: string;
  loadedThreadIds: string[];
  selectedHistoryKey: string | null;
  sessionHistoryOrigins: Record<string, string>;
  sessions: LocalSessionSummary[];
}

export const consoleLocalStorageKeys = [
  savedDevicesStorageKey,
  threadSidebarPrefsStorageKey,
  projectSidebarPrefsStorageKey,
  sessionSelectionStorageKey,
  workspaceSidebarSnapshotStorageKey,
  conversationOutboxStorageKey,
  sidebarWidthStorageKey,
  relayOnlyMigrationNoticeStorageKey
] as const;

export type ConsoleLocalStorageKey = (typeof consoleLocalStorageKeys)[number];

export function hasRelayOnlyMigrationNoticeSeen(storage: Storage): boolean {
  return storage.getItem(relayOnlyMigrationNoticeStorageKey) === "1";
}

export function writeRelayOnlyMigrationNoticeSeen(storage: Storage): void {
  writeConsoleStorageItem(storage, relayOnlyMigrationNoticeStorageKey, "1");
}

export function writeSidebarWidthStorage(storage: Storage, width: number): void {
  if (!Number.isFinite(width)) {
    return;
  }
  writeConsoleStorageItem(storage, sidebarWidthStorageKey, String(Math.round(width)));
}

export function writeSavedDevicesStorage(
  storage: Storage,
  devices: SavedDevice[]
): SavedDevice[] {
  const safeDevices = devices
    .map(sanitizeSavedDeviceForStorage)
    .filter((device): device is SavedDevice => Boolean(device));
  writeConsoleStorageItem(storage, savedDevicesStorageKey, JSON.stringify(safeDevices));
  return safeDevices;
}

export function writeThreadSidebarPrefsStorage(
  storage: Storage,
  prefsByScope: Record<string, ThreadSidebarPrefs>
): Record<string, ThreadSidebarPrefs> {
  const safePrefs = Object.fromEntries(
    Object.entries(prefsByScope)
      .filter(([scope]) => isSafePreferenceString(scope))
      .map(([scope, prefs]) => {
        const sanitized = sanitizeThreadSidebarPrefs(prefs);
        return [
          scope,
          {
            pinned: sanitized.pinned.filter(isSafePreferenceString)
          }
        ] as const;
      })
  );
  writeConsoleStorageItem(
    storage,
    threadSidebarPrefsStorageKey,
    JSON.stringify(safePrefs)
  );
  return safePrefs;
}

export function writeProjectSidebarPrefsStorage(
  storage: Storage,
  prefsByScope: Record<string, ProjectSidebarPrefs>
): Record<string, ProjectSidebarPrefs> {
  const safePrefs = Object.fromEntries(
    Object.entries(prefsByScope)
      .filter(([scope]) => isSafePreferenceString(scope))
      .map(([scope, prefs]) => {
        const sanitized = sanitizeProjectSidebarPrefs(prefs);
        return [
          scope,
          {
            hidden: sanitized.hidden.filter(isSafePreferenceString),
            pinned: sanitized.pinned.filter(isSafePreferenceString),
            renamed: Object.fromEntries(
              Object.entries(sanitized.renamed).filter(
                ([key, value]) =>
                  isSafePreferenceString(key) && isSafePreferenceString(value)
              )
            )
          }
        ] as const;
      })
  );
  writeConsoleStorageItem(
    storage,
    projectSidebarPrefsStorageKey,
    JSON.stringify(safePrefs)
  );
  return safePrefs;
}

export function readSessionSelectionStorage(): Record<string, SessionSelectionState> {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(sessionSelectionStorageKey);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([scope, value]) => isSafePreferenceString(scope) && isRecord(value))
        .map(([scope, value]) => {
          const record = value as Record<string, unknown>;
          const currentSessionId =
            typeof record.currentSessionId === "string" &&
            isSafePreferenceString(record.currentSessionId)
              ? record.currentSessionId
              : null;
          const selectedHistoryKey =
            typeof record.selectedHistoryKey === "string" &&
            isSafePreferenceString(record.selectedHistoryKey)
              ? record.selectedHistoryKey
              : null;
          return [scope, { currentSessionId, selectedHistoryKey }] as const;
        })
    );
  } catch {
    return {};
  }
}

export function writeSessionSelectionStorage(
  storage: Storage,
  selectionsByScope: Record<string, SessionSelectionState>
): Record<string, SessionSelectionState> {
  const safeSelections = Object.fromEntries(
    Object.entries(selectionsByScope)
      .filter(([scope]) => isSafePreferenceString(scope))
      .map(([scope, selection]) => [
        scope,
        {
          currentSessionId:
            typeof selection.currentSessionId === "string" &&
            isSafePreferenceString(selection.currentSessionId)
              ? selection.currentSessionId
              : null,
          selectedHistoryKey:
            typeof selection.selectedHistoryKey === "string" &&
            isSafePreferenceString(selection.selectedHistoryKey)
              ? selection.selectedHistoryKey
              : null
        }
      ])
  );
  writeConsoleStorageItem(
    storage,
    sessionSelectionStorageKey,
    JSON.stringify(safeSelections)
  );
  return safeSelections;
}

export function readWorkspaceSidebarSnapshotsStorage(): Record<
  string,
  WorkspaceSidebarSnapshot
> {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(workspaceSidebarSnapshotStorageKey);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([deviceId, value]) => isSafePreferenceString(deviceId) && isRecord(value))
        .map(([deviceId, value]) => {
          const snapshot = sanitizeWorkspaceSidebarSnapshot(value);
          return snapshot ? ([deviceId, snapshot] as const) : null;
        })
        .filter((entry): entry is readonly [string, WorkspaceSidebarSnapshot] => Boolean(entry))
    );
  } catch {
    return {};
  }
}

export function writeWorkspaceSidebarSnapshotsStorage(
  storage: Storage,
  snapshotsByDeviceId: Record<string, WorkspaceSidebarSnapshot>
): Record<string, WorkspaceSidebarSnapshot> {
  const safeSnapshots = Object.fromEntries(
    Object.entries(snapshotsByDeviceId)
      .filter(([deviceId]) => isSafePreferenceString(deviceId))
      .map(([deviceId, snapshot]) => {
        const sanitized = sanitizeWorkspaceSidebarSnapshot(snapshot);
        return sanitized ? ([deviceId, sanitized] as const) : null;
      })
      .filter((entry): entry is readonly [string, WorkspaceSidebarSnapshot] => Boolean(entry))
  );
  // Snapshot text and cwd values are ordinary user content; the generic secret-word
  // scanner is too aggressive here and would drop benign workspace names.
  storage.setItem(
    workspaceSidebarSnapshotStorageKey,
    JSON.stringify(safeSnapshots)
  );
  return safeSnapshots;
}

export function readConversationOutboxStorage(): Record<string, OutboxEntry[]> {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(conversationOutboxStorageKey);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([deviceId, entries]) => isSafePreferenceString(deviceId) && Array.isArray(entries))
        .map(([deviceId, entries]) => [
          deviceId,
          (entries as unknown[])
            .map(sanitizeOutboxEntryForStorage)
            .filter((entry): entry is OutboxEntry => Boolean(entry))
            .slice(-50)
        ])
    );
  } catch {
    return {};
  }
}

export function writeConversationOutboxStorage(
  storage: Storage,
  entriesByDeviceId: Record<string, OutboxEntry[]>
): Record<string, OutboxEntry[]> {
  const safeEntries = Object.fromEntries(
    Object.entries(entriesByDeviceId)
      .filter(([deviceId]) => isSafePreferenceString(deviceId))
      .map(([deviceId, entries]) => [
        deviceId,
        entries
          .map(sanitizeOutboxEntryForStorage)
          .filter((entry): entry is OutboxEntry => Boolean(entry))
          .slice(-50)
      ])
  );
  // Outbox text is user-authored message content required to restore pending UI after reload.
  storage.setItem(conversationOutboxStorageKey, JSON.stringify(safeEntries));
  return safeEntries;
}

export function writeConsoleStorageItem(
  storage: Storage,
  key: string,
  value: string
): void {
  if (!isConsoleLocalStorageKey(key)) {
    throw new Error(`Refusing to write unsupported localStorage key "${key}"`);
  }
  if (containsSensitiveStorageMarker(value)) {
    throw new Error(`Refusing to write sensitive value to localStorage key "${key}"`);
  }
  storage.setItem(key, value);
}

export function isConsoleLocalStorageKey(key: string): key is ConsoleLocalStorageKey {
  return consoleLocalStorageKeys.includes(key as ConsoleLocalStorageKey);
}

function sanitizeSavedDeviceForStorage(device: SavedDevice): SavedDevice | null {
  if (
    device.mode !== "relay" ||
    !isSafePreferenceString(device.id) ||
    !isSafePreferenceString(device.deviceId)
  ) {
    return null;
  }

  const relayUrl = normalizeAgentUrl(device.relayUrl);
  if (!isSafePreferenceString(relayUrl)) {
    return null;
  }

  const name =
    safeOptionalString(device.name) ?? safeOptionalString(device.deviceId) ?? "Relay device";
  const hostname = safeOptionalString(device.hostname);
  const codexVersion = safeOptionalString(device.codexVersion);

  return {
    id: device.id,
    name,
    mode: "relay",
    relayUrl,
    deviceId: device.deviceId,
    ...(hostname !== undefined ? { hostname } : {}),
    ...(typeof device.online === "boolean" ? { online: device.online } : {}),
    ...(codexVersion !== undefined ? { codexVersion } : {}),
    ...(typeof device.lastConnectedAt === "number" ||
    device.lastConnectedAt === null
      ? { lastConnectedAt: device.lastConnectedAt }
      : {})
  };
}

function safeOptionalString(value: string | null | undefined): string | null | undefined {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  return isSafePreferenceString(value) ? value : undefined;
}

function isSafePreferenceString(value: string): boolean {
  return value.trim().length > 0 && !containsSensitiveStorageMarker(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function containsSensitiveStorageMarker(value: string): boolean {
  return /\b(?:owner|session|device|direct)[-_\s]?(?:token|secret|password)\b/i.test(
    value
  ) || /\bbearer\s+[a-z0-9._-]+/i.test(value);
}

function sanitizeWorkspaceSidebarSnapshot(
  value: unknown
): WorkspaceSidebarSnapshot | null {
  if (!isRecord(value)) {
    return null;
  }
  const sessions = Array.isArray(value.sessions)
    ? value.sessions
        .map((session) =>
          isRecord(session) ? sanitizeSessionSummaryForStorage(session) : null
        )
        .filter((session): session is LocalSessionSummary => Boolean(session))
    : [];
  const codexHistory = Array.isArray(value.codexHistory)
    ? value.codexHistory
        .map((entry) =>
          isRecord(entry) ? sanitizeHistoryEntryForStorage(entry) : null
        )
        .filter((entry): entry is LocalCodexHistoryEntry => Boolean(entry))
    : [];
  const cwd =
    safeSnapshotText(value.cwd) ??
    sessions[0]?.cwd ??
    codexHistory[0]?.cwd ??
    null;

  if (!cwd) {
    return null;
  }

  const currentSessionId = safeSnapshotText(value.currentSessionId) ?? null;
  const selectedHistoryKey = safeSnapshotText(value.selectedHistoryKey) ?? null;
  const loadedThreadIds = Array.isArray(value.loadedThreadIds)
    ? value.loadedThreadIds
        .map(safeSnapshotText)
        .filter((threadId): threadId is string => Boolean(threadId))
    : [];
  const sessionHistoryOrigins = isRecord(value.sessionHistoryOrigins)
    ? Object.fromEntries(
        Object.entries(value.sessionHistoryOrigins)
          .map(([sessionId, threadId]) => {
            const safeSessionId = safeSnapshotText(sessionId);
            const safeThreadId = safeSnapshotText(threadId);
            return safeSessionId && safeThreadId
              ? ([safeSessionId, safeThreadId] as const)
              : null;
          })
          .filter((entry): entry is readonly [string, string] => Boolean(entry))
      )
    : {};

  return {
    codexHistory,
    currentSessionId:
      currentSessionId &&
      sessions.some((session) => session.sessionId === currentSessionId)
        ? currentSessionId
        : null,
    cwd,
    loadedThreadIds: [...new Set(loadedThreadIds)],
    selectedHistoryKey:
      selectedHistoryKey &&
      codexHistory.some(
        (entry) => `${entry.id}::${entry.cwd}` === selectedHistoryKey
      )
        ? selectedHistoryKey
        : null,
    sessionHistoryOrigins,
    sessions
  };
}

function sanitizeOutboxEntryForStorage(value: unknown): OutboxEntry | null {
  if (!isRecord(value)) {
    return null;
  }
  const clientMessageId = safeSnapshotText(value.clientMessageId);
  const conversationKey = safeSnapshotText(value.conversationKey);
  const text = typeof value.text === "string" ? value.text.slice(0, 24_000) : null;
  const status = isOutboxStatus(value.status) ? value.status : null;
  if (!clientMessageId || !conversationKey || text === null || !status) {
    return null;
  }
  const createdAt = finiteTimestamp(value.createdAt) ?? Date.now();
  const updatedAt = finiteTimestamp(value.updatedAt) ?? createdAt;
  return {
    clientMessageId,
    conversationKey,
    createdAt,
    ...(typeof value.error === "string" ? { error: value.error.slice(0, 2_000) } : {}),
    ...(safeSnapshotText(value.sessionId) ? { sessionId: safeSnapshotText(value.sessionId)! } : {}),
    status,
    text,
    ...(safeSnapshotText(value.threadId) ? { threadId: safeSnapshotText(value.threadId)! } : {}),
    ...(safeSnapshotText(value.turnId) ? { turnId: safeSnapshotText(value.turnId)! } : {}),
    updatedAt
  };
}

function isOutboxStatus(value: unknown): value is OutboxStatus {
  return (
    value === "pending" ||
    value === "queued" ||
    value === "sent" ||
    value === "streaming" ||
    value === "complete" ||
    value === "failed"
  );
}

function sanitizeSessionSummaryForStorage(
  value: Record<string, unknown>
): LocalSessionSummary | null {
  const sessionId = safeSnapshotText(value.sessionId);
  const cwd = safeSnapshotText(value.cwd);
  if (!sessionId || !cwd) {
    return null;
  }

  const createdAt = finiteTimestamp(value.createdAt);
  const updatedAt = finiteTimestamp(value.updatedAt) ?? createdAt ?? Date.now();

  return {
    sessionId,
    ...(safeSnapshotText(value.threadId) ? { threadId: safeSnapshotText(value.threadId)! } : {}),
    ...(safeSnapshotText(value.currentTurnId)
      ? { currentTurnId: safeSnapshotText(value.currentTurnId)! }
      : {}),
    ...(safeSnapshotText(value.activeTurnId)
      ? { activeTurnId: safeSnapshotText(value.activeTurnId)! }
      : {}),
    status: isSessionStatus(value.status) ? value.status : "idle",
    cwd,
    ...(typeof value.title === "string" ? { title: value.title } : {}),
    ...(typeof value.model === "string" ? { model: value.model } : {}),
    ...(typeof value.serviceTier === "string"
      ? { serviceTier: value.serviceTier }
      : { serviceTier: null }),
    ...(isReasoningEffort(value.reasoningEffort)
      ? { reasoningEffort: value.reasoningEffort }
      : { reasoningEffort: null }),
    permissionMode: isPermissionMode(value.permissionMode)
      ? value.permissionMode
      : "request-approval",
    approvalPolicy: isApprovalPolicy(value.approvalPolicy)
      ? value.approvalPolicy
      : null,
    approvalsReviewer: isApprovalsReviewer(value.approvalsReviewer)
      ? value.approvalsReviewer
      : null,
    sandbox: isSandboxMode(value.sandbox) ? value.sandbox : null,
    queuedMessages: sanitizeQueuedMessages(value.queuedMessages),
    goal: null,
    createdAt: createdAt ?? updatedAt,
    updatedAt
  };
}

function sanitizeQueuedMessages(value: unknown): LocalQueuedMessage[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item, index): LocalQueuedMessage | null => {
      if (!isRecord(item)) {
        return null;
      }
      const clientMessageId = safeSnapshotText(item.clientMessageId);
      const text = typeof item.text === "string" ? item.text.slice(0, 24_000) : null;
      if (!clientMessageId || text === null) {
        return null;
      }
      const createdAt = finiteTimestamp(item.createdAt) ?? Date.now();
      return {
        clientMessageId,
        createdAt,
        order: Math.max(1, Math.trunc(finiteTimestamp(item.order) ?? index + 1)),
        ...(typeof item.serviceTier === "string"
          ? { serviceTier: item.serviceTier }
          : {}),
        text,
        updatedAt: finiteTimestamp(item.updatedAt) ?? createdAt
      };
    })
    .filter((item): item is LocalQueuedMessage => Boolean(item))
    .sort((a, b) => a.order - b.order);
}

function sanitizeHistoryEntryForStorage(
  value: Record<string, unknown>
): LocalCodexHistoryEntry | null {
  const id = safeSnapshotText(value.id);
  const cwd = safeSnapshotText(value.cwd);
  if (!id || !cwd) {
    return null;
  }
  return {
    id,
    cwd,
    ...(typeof value.cwdExists === "boolean" ? { cwdExists: value.cwdExists } : {}),
    title:
      typeof value.title === "string" && value.title.trim().length > 0
        ? value.title
        : "未命名对话",
    createdAt:
      typeof value.createdAt === "string"
        ? value.createdAt
        : new Date().toISOString(),
    updatedAt:
      typeof value.updatedAt === "string"
        ? value.updatedAt
        : new Date().toISOString(),
    source:
      typeof value.source === "string" && value.source.trim().length > 0
        ? value.source
        : "history",
    ...(typeof value.loaded === "boolean" ? { loaded: value.loaded } : {}),
    ...(typeof value.threadStatus === "string" || value.threadStatus === null
      ? { threadStatus: value.threadStatus }
      : {})
  };
}

function safeSnapshotText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function finiteTimestamp(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isSessionStatus(
  value: unknown
): value is LocalSessionSummary["status"] {
  return (
    value === "idle" ||
    value === "running" ||
    value === "waiting_approval" ||
    value === "completed" ||
    value === "failed" ||
    value === "interrupted" ||
    value === "error"
  );
}

function isReasoningEffort(
  value: unknown
): value is NonNullable<LocalSessionSummary["reasoningEffort"]> {
  return value === "low" || value === "medium" || value === "high" || value === "xhigh";
}

function isPermissionMode(
  value: unknown
): value is LocalSessionSummary["permissionMode"] {
  return (
    value === "request-approval" ||
    value === "auto-approve" ||
    value === "full-access" ||
    value === "custom-config"
  );
}

function isApprovalPolicy(
  value: unknown
): value is NonNullable<LocalSessionSummary["approvalPolicy"]> {
  return (
    value === "untrusted" ||
    value === "on-failure" ||
    value === "on-request" ||
    value === "never"
  );
}

function isApprovalsReviewer(
  value: unknown
): value is NonNullable<LocalSessionSummary["approvalsReviewer"]> {
  return (
    value === "user" ||
    value === "auto_review" ||
    value === "guardian_subagent"
  );
}

function isSandboxMode(
  value: unknown
): value is NonNullable<LocalSessionSummary["sandbox"]> {
  return (
    value === "read-only" ||
    value === "workspace-write" ||
    value === "danger-full-access"
  );
}
