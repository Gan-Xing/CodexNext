import type {
  LocalCodexHistoryEntry,
  LocalSessionSummary
} from "../../lib/types";
import type { DeviceWorkspace } from "../chat/chat-state";
import {
  codexHistoryKey,
  filterRestorableHistoryEntries,
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
  const restorableHistoryEntries = filterRestorableHistoryEntries(historyEntries);
  const restorablePreviewSessionIds = new Set(
    restorableHistoryEntries.map(historyPreviewSessionId)
  );
  const baseSessions = sessions.filter(
    (session) =>
      !isHistoryPreviewSessionId(session.sessionId) ||
      restorablePreviewSessionIds.has(session.sessionId)
  );
  const previewSessionId = workspace.currentSessionId;
  if (
    !previewSessionId ||
    !isHistoryPreviewSessionId(previewSessionId) ||
    !workspace.selectedHistoryKey
  ) {
    return baseSessions;
  }
  const entry =
    restorableHistoryEntries.find(
      (historyEntry) => codexHistoryKey(historyEntry) === workspace.selectedHistoryKey
    ) ?? null;
  if (!entry) {
    return baseSessions;
  }
  const previewSession =
    workspace.sessions.find((session) => session.sessionId === previewSessionId) ??
    makeHistoryPreviewSession(entry);
  return [
    previewSession,
    ...baseSessions.filter((session) => session.sessionId !== previewSession.sessionId)
  ];
}

export function mergeLiveSessionsIntoWorkspace(
  workspace: DeviceWorkspace,
  sessions: LocalSessionSummary[],
  savedSelection: SavedSessionSelection | null
): DeviceWorkspace {
  const missingHistoryCwdSet = new Set(workspace.missingHistoryCwds);
  const restorableSessions = sessions.filter(
    (session) => !missingHistoryCwdSet.has(session.cwd)
  );
  const nextSessions = mergeSelectedHistoryPreviewSession(
    restorableSessions,
    workspace.codexHistory,
    workspace
  );
  const nextSessionIds = new Set(nextSessions.map((session) => session.sessionId));
  const latestSession =
    [...restorableSessions].sort((left, right) => right.updatedAt - left.updatedAt)[0] ?? null;
  const restoredSessionId =
    savedSelection?.currentSessionId &&
    nextSessionIds.has(savedSelection.currentSessionId)
      ? savedSelection.currentSessionId
      : null;
  const nextCurrentSessionId =
    workspace.currentSessionId && nextSessionIds.has(workspace.currentSessionId)
      ? workspace.currentSessionId
      : restoredSessionId ?? latestSession?.sessionId ?? null;

  const nextWorkspace = {
    ...workspace,
    currentSessionId: nextCurrentSessionId,
    selectedHistoryKey:
      nextCurrentSessionId && isHistoryPreviewSessionId(nextCurrentSessionId)
        ? workspace.selectedHistoryKey
        : null,
    sessions: nextSessions
  };

  return {
    ...nextWorkspace,
    cwd: resolvePreferredWorkspaceCwd(nextWorkspace)
  };
}

export function mergeLiveHistoryIntoWorkspace(
  workspace: DeviceWorkspace,
  historyEntries: LocalCodexHistoryEntry[],
  savedSelection: SavedSessionSelection | null
): DeviceWorkspace {
  const missingHistoryCwds = [
    ...new Set(
      historyEntries
        .filter((entry) => entry.cwdExists === false)
        .map((entry) => entry.cwd)
    )
  ];
  const missingHistoryCwdSet = new Set(missingHistoryCwds);
  const restorableHistoryEntries = filterRestorableHistoryEntries(historyEntries);
  const restorableSessions = workspace.sessions.filter(
    (session) => !missingHistoryCwdSet.has(session.cwd)
  );
  const currentRealSessionSelected =
    Boolean(workspace.currentSessionId) &&
    !isHistoryPreviewSessionId(workspace.currentSessionId ?? "") &&
    restorableSessions.some((session) => session.sessionId === workspace.currentSessionId);
  const currentSelectedHistoryEntry = currentRealSessionSelected
    ? null
    : findHistoryEntryByKey(restorableHistoryEntries, workspace.selectedHistoryKey);
  const restoredSelectedHistoryEntry = currentRealSessionSelected
    ? null
    : findHistoryEntryByKey(
        restorableHistoryEntries,
        savedSelection?.selectedHistoryKey ?? null
      );
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
    codexHistory: restorableHistoryEntries,
    currentSessionId: nextCurrentSessionId,
    missingHistoryCwds,
    sessionHistoryOrigins: filterSessionHistoryOrigins(
      workspace.sessionHistoryOrigins,
      restorableSessions
    ),
    selectedHistoryKey: nextSelectedHistoryKey,
    sessions: restorableSessions
  };

  return {
    ...nextWorkspace,
    cwd: resolvePreferredWorkspaceCwd(nextWorkspace),
    sessions: mergeSelectedHistoryPreviewSession(
      restorableSessions,
      restorableHistoryEntries,
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

  const restorableHistoryEntries = filterRestorableHistoryEntries(historyEntries);
  return (
    findHistoryEntryByKey(restorableHistoryEntries, workspace.selectedHistoryKey) ??
    findHistoryEntryByKey(
      restorableHistoryEntries,
      savedSelection?.selectedHistoryKey ?? null
    ) ??
    null
  );
}

export function resolvePreferredWorkspaceCwd(
  workspace: Pick<
    DeviceWorkspace,
    "codexHistory" | "currentSessionId" | "cwd" | "selectedHistoryKey" | "sessions"
  >
): string {
  const activeLiveSession =
    workspace.currentSessionId &&
    !isHistoryPreviewSessionId(workspace.currentSessionId)
      ? workspace.sessions.find(
          (session) => session.sessionId === workspace.currentSessionId
        ) ?? null
      : null;
  if (activeLiveSession?.cwd) {
    return activeLiveSession.cwd;
  }

  const selectedHistoryEntry = findHistoryEntryByKey(
    workspace.codexHistory,
    workspace.selectedHistoryKey
  );
  const selectedHistoryCwdMissing =
    selectedHistoryEntry?.cwdExists === false &&
    selectedHistoryEntry.cwd === workspace.cwd;
  if (workspace.cwd.trim().length > 0 && !selectedHistoryCwdMissing) {
    return workspace.cwd;
  }

  const liveSessionFallback =
    workspace.sessions.find(
      (session) =>
        !isHistoryPreviewSessionId(session.sessionId) && session.cwd.trim().length > 0
    )?.cwd ?? null;
  if (liveSessionFallback) {
    return liveSessionFallback;
  }

  if (selectedHistoryEntry && selectedHistoryEntry.cwdExists !== false) {
    return selectedHistoryEntry.cwd;
  }

  return (
    workspace.codexHistory.find((entry) => entry.cwdExists !== false)?.cwd ?? ""
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

function filterSessionHistoryOrigins(
  origins: Record<string, string>,
  sessions: LocalSessionSummary[]
): Record<string, string> {
  const sessionIds = new Set(sessions.map((session) => session.sessionId));
  return Object.fromEntries(
    Object.entries(origins).filter(([sessionId]) => sessionIds.has(sessionId))
  );
}
