import type {
  LocalCodexHistoryEntry,
  LocalSessionSummary
} from "../../lib/types";
import type { DeviceWorkspace } from "../chat/chat-state";
import {
  codexHistoryKey,
  historyPreviewSessionId,
  isHistoryPreviewSessionId,
  makeHistoryPreviewSession
} from "../sessions/session-utils";

export interface SavedSessionSelection {
  currentSessionId: string | null;
  selectedHistoryKey: string | null;
}

export function mergeSelectedHistoryPreviewSession(
  sessions: LocalSessionSummary[],
  historyEntries: LocalCodexHistoryEntry[],
  workspace: Pick<DeviceWorkspace, "currentSessionId" | "selectedHistoryKey" | "sessions">
): LocalSessionSummary[] {
  const previewSessionId = workspace.currentSessionId;
  if (
    !previewSessionId ||
    !isHistoryPreviewSessionId(previewSessionId) ||
    !workspace.selectedHistoryKey
  ) {
    return sessions;
  }
  const entry =
    historyEntries.find(
      (historyEntry) => codexHistoryKey(historyEntry) === workspace.selectedHistoryKey
    ) ?? null;
  if (!entry) {
    return sessions;
  }
  const previewSession =
    workspace.sessions.find((session) => session.sessionId === previewSessionId) ??
    makeHistoryPreviewSession(entry);
  return [
    previewSession,
    ...sessions.filter((session) => session.sessionId !== previewSession.sessionId)
  ];
}

export function mergeLiveSessionsIntoWorkspace(
  workspace: DeviceWorkspace,
  sessions: LocalSessionSummary[],
  savedSelection: SavedSessionSelection | null
): DeviceWorkspace {
  const nextSessions = mergeSelectedHistoryPreviewSession(
    sessions,
    workspace.codexHistory,
    workspace
  );
  const nextSessionIds = new Set(nextSessions.map((session) => session.sessionId));
  const latestSession =
    [...sessions].sort((left, right) => right.updatedAt - left.updatedAt)[0] ?? null;
  const restoredSessionId =
    savedSelection?.currentSessionId &&
    nextSessionIds.has(savedSelection.currentSessionId)
      ? savedSelection.currentSessionId
      : null;
  const nextCurrentSessionId =
    workspace.currentSessionId && nextSessionIds.has(workspace.currentSessionId)
      ? workspace.currentSessionId
      : restoredSessionId ?? latestSession?.sessionId ?? null;

  return {
    ...workspace,
    currentSessionId: nextCurrentSessionId,
    cwd: workspace.cwd || latestSession?.cwd || "",
    selectedHistoryKey:
      nextCurrentSessionId && !isHistoryPreviewSessionId(nextCurrentSessionId)
        ? null
        : workspace.selectedHistoryKey,
    sessions: nextSessions
  };
}

export function mergeLiveHistoryIntoWorkspace(
  workspace: DeviceWorkspace,
  historyEntries: LocalCodexHistoryEntry[],
  savedSelection: SavedSessionSelection | null
): DeviceWorkspace {
  const currentRealSessionSelected =
    Boolean(workspace.currentSessionId) &&
    !isHistoryPreviewSessionId(workspace.currentSessionId ?? "");
  const currentSelectedHistoryEntry = currentRealSessionSelected
    ? null
    : findHistoryEntryByKey(historyEntries, workspace.selectedHistoryKey);
  const restoredSelectedHistoryEntry = currentRealSessionSelected
    ? null
    : findHistoryEntryByKey(historyEntries, savedSelection?.selectedHistoryKey ?? null);
  const nextSelectedHistoryEntry =
    currentSelectedHistoryEntry ?? restoredSelectedHistoryEntry;
  const nextSelectedHistoryKey = nextSelectedHistoryEntry
    ? codexHistoryKey(nextSelectedHistoryEntry)
    : null;
  const nextCurrentSessionId = currentRealSessionSelected
    ? workspace.currentSessionId
    : nextSelectedHistoryEntry
      ? historyPreviewSessionId(nextSelectedHistoryEntry)
      : null;
  const nextWorkspace = {
    ...workspace,
    codexHistory: historyEntries,
    currentSessionId: nextCurrentSessionId,
    cwd: workspace.cwd || nextSelectedHistoryEntry?.cwd || "",
    selectedHistoryKey: nextSelectedHistoryKey
  };

  return {
    ...nextWorkspace,
    sessions: mergeSelectedHistoryPreviewSession(
      nextWorkspace.sessions,
      historyEntries,
      nextWorkspace
    )
  };
}

export function resolveHistoryPreviewEntryToHydrate(
  workspace: Pick<DeviceWorkspace, "currentSessionId" | "selectedHistoryKey">,
  historyEntries: LocalCodexHistoryEntry[],
  savedSelection: SavedSessionSelection | null
): LocalCodexHistoryEntry | null {
  if (
    workspace.currentSessionId &&
    !isHistoryPreviewSessionId(workspace.currentSessionId)
  ) {
    return null;
  }

  return (
    findHistoryEntryByKey(historyEntries, workspace.selectedHistoryKey) ??
    findHistoryEntryByKey(historyEntries, savedSelection?.selectedHistoryKey ?? null) ??
    null
  );
}

function findHistoryEntryByKey(
  entries: LocalCodexHistoryEntry[],
  key: string | null
): LocalCodexHistoryEntry | null {
  if (!key) {
    return null;
  }
  return entries.find((entry) => codexHistoryKey(entry) === key) ?? null;
}
