import type {
  LocalCodexHistoryDetailResponse,
  LocalCodexHistoryEntry,
  LocalPermissionMode,
  LocalReasoningEffort,
  LocalSessionSummary
} from "../../lib/types";
import type { ChatItem } from "../../lib/types";
import { normalizeAgentUrl } from "../devices/device-utils";

export interface ThreadSidebarPrefs {
  archived: string[];
  pinned: string[];
}

export interface ProjectSidebarPrefs {
  hidden: string[];
  pinned: string[];
  renamed: Record<string, string>;
}

export interface ThreadListItem {
  entry?: LocalCodexHistoryEntry;
  id: string;
  kind: "history" | "session";
  pinned: boolean;
  selected: boolean;
  threadId: string;
  timeLabel: string;
  timestamp: number;
  title: string;
}

export interface ProjectThreadGroupData {
  cwd: string;
  items: ThreadListItem[];
  name: string;
  pinned: boolean;
  updatedAt: number;
  sessions: LocalSessionSummary[];
  entries: LocalCodexHistoryEntry[];
}

export const threadSidebarPrefsStorageKey = "codexnext.threadSidebarPrefs.v1";
export const projectSidebarPrefsStorageKey = "codexnext.projectSidebarPrefs.v1";

export function groupProjectThreads(
  sessions: LocalSessionSummary[],
  entries: LocalCodexHistoryEntry[],
  chatItems: ChatItem[],
  threadPrefs: ThreadSidebarPrefs,
  projectPrefs: ProjectSidebarPrefs,
  activeSessionId: string | null,
  selectedHistoryKey: string | null
): ProjectThreadGroupData[] {
  const groups = new Map<string, ProjectThreadGroupData>();
  const pinned = new Set(threadPrefs.pinned);
  const archived = new Set(threadPrefs.archived);
  const pinnedProjects = new Set(projectPrefs.pinned);
  const hiddenProjects = new Set(projectPrefs.hidden);
  const sessionThreadIds = new Set(
    sessions
      .filter((session) => !isHistoryPreviewSessionId(session.sessionId))
      .map((session) => session.threadId)
  );

  for (const session of sessions) {
    if (isHistoryPreviewSessionId(session.sessionId)) {
      continue;
    }
    if (archived.has(threadKeyForSession(session))) {
      continue;
    }
    const existing = groups.get(session.cwd);
    if (existing) {
      existing.sessions.push(session);
      existing.updatedAt = Math.max(existing.updatedAt, session.updatedAt);
    } else {
      groups.set(session.cwd, {
        cwd: session.cwd,
        items: [],
        name: shortPath(session.cwd),
        pinned: false,
        updatedAt: session.updatedAt,
        sessions: [session],
        entries: []
      });
    }
  }

  const seen = new Set<string>();
  for (const entry of entries) {
    const uniqueKey = codexHistoryKey(entry);
    if (
      seen.has(uniqueKey) ||
      archived.has(threadKeyForHistory(entry)) ||
      sessionThreadIds.has(entry.id)
    ) {
      continue;
    }
    seen.add(uniqueKey);
    const existing = groups.get(entry.cwd);
    const updatedAt = parseHistoryTimestamp(entry.updatedAt, entry.createdAt);
    if (existing) {
      existing.entries.push(entry);
      existing.updatedAt = Math.max(existing.updatedAt, updatedAt);
    } else {
      groups.set(entry.cwd, {
        cwd: entry.cwd,
        items: [],
        name: shortPath(entry.cwd),
        pinned: false,
        updatedAt,
        sessions: [],
        entries: [entry]
      });
    }
  }

  return [...groups.values()]
    .filter((group) => !hiddenProjects.has(group.cwd))
    .map((group) => {
      const items: ThreadListItem[] = [
        ...group.sessions.map((session) => ({
          id: session.sessionId,
          kind: "session" as const,
          pinned: pinned.has(threadKeyForSession(session)),
          selected: activeSessionId === session.sessionId,
          threadId: threadKeyForSession(session),
          timeLabel: formatRelativeThreadTime(session.updatedAt),
          timestamp: session.updatedAt,
          title: sessionTitle(session, chatItems, entries)
        })),
        ...group.entries.map((entry) => {
          const timestamp = parseHistoryTimestamp(entry.updatedAt, entry.createdAt);
          return {
            entry,
            id: codexHistoryKey(entry),
            kind: "history" as const,
            pinned: pinned.has(threadKeyForHistory(entry)),
            selected: selectedHistoryKey === codexHistoryKey(entry),
            threadId: threadKeyForHistory(entry),
            timeLabel: formatRelativeThreadTime(timestamp),
            timestamp,
            title: entry.title
          };
        })
      ]
        .sort((left, right) => {
          if (left.pinned !== right.pinned) {
            return left.pinned ? -1 : 1;
          }
          return right.timestamp - left.timestamp;
        });

      return {
        ...group,
        name: projectName(group.cwd, projectPrefs.renamed[group.cwd]),
        pinned: pinnedProjects.has(group.cwd),
        items,
        sessions: group.sessions.sort((a, b) => b.updatedAt - a.updatedAt),
        entries: group.entries.sort(
          (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
        )
      };
    })
    .sort((a, b) => {
      if (a.pinned !== b.pinned) {
        return a.pinned ? -1 : 1;
      }
      return b.updatedAt - a.updatedAt;
    });
}

export function parseHistoryTimestamp(updatedAt: string, createdAt?: string): number {
  const updated = Date.parse(updatedAt);
  if (Number.isFinite(updated)) {
    return updated;
  }
  const created = createdAt ? Date.parse(createdAt) : Number.NaN;
  if (Number.isFinite(created)) {
    return created;
  }
  return Date.now();
}

export function codexHistoryKey(entry: LocalCodexHistoryEntry): string {
  return `${entry.id}::${entry.cwd}`;
}

export function isPreviewOnlyHistoryEntry(entry: LocalCodexHistoryEntry): boolean {
  return entry.cwdExists === false;
}

export function historyPreviewSessionId(entry: LocalCodexHistoryEntry): string {
  return `history-preview:${codexHistoryKey(entry)}`;
}

export function pendingSessionId(clientMessageId: string): string {
  return `pending-session:${clientMessageId}`;
}

export function isHistoryPreviewSessionId(sessionId: string): boolean {
  return sessionId.startsWith("history-preview:");
}

export function isPendingSessionId(sessionId: string): boolean {
  return sessionId.startsWith("pending-session:");
}

export function makeHistoryPreviewSession(
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

export function makePendingSession(input: {
  sessionId: string;
  cwd: string;
  model?: string | null;
  permissionMode: LocalPermissionMode;
  reasoningEffort?: LocalReasoningEffort | null;
}): LocalSessionSummary {
  const now = Date.now();
  return {
    sessionId: input.sessionId,
    threadId: input.sessionId,
    status: "running",
    cwd: input.cwd,
    model: input.model ?? null,
    reasoningEffort: input.reasoningEffort ?? null,
    permissionMode: input.permissionMode,
    approvalPolicy: null,
    approvalsReviewer: null,
    sandbox: null,
    goal: null,
    createdAt: now,
    updatedAt: now
  };
}

export function historyMessageToChatItem(
  sessionId: string,
  message: LocalCodexHistoryDetailResponse["messages"][number]
): ChatItem {
  return {
    id: `history-${sessionId}-${message.id}`,
    role: message.role,
    text: message.text,
    sessionId,
    status: "complete",
    createdAt: parseHistoryTimestamp(message.ts)
  };
}

export function sessionTitle(
  session: LocalSessionSummary,
  chatItems: ChatItem[],
  historyEntries: LocalCodexHistoryEntry[] = []
): string {
  const historyTitle = historyEntries.find((entry) => entry.id === session.threadId)?.title?.trim();
  if (historyTitle) {
    return historyTitle;
  }
  if (session.goal?.objective) {
    return session.goal.objective.slice(0, 80);
  }
  return shortPath(session.cwd);
}

export function sessionSubtitle(session: LocalSessionSummary): string {
  const model = session.model ? session.model.replace("gpt-", "") : "default model";
  return `${shortPath(session.cwd)} · ${model} · ${reasoningLabel(session.reasoningEffort)} · ${permissionLabel(session.permissionMode)}`;
}

export function historySubtitle(entry: LocalCodexHistoryEntry): string {
  return `${shortPath(entry.cwd)} · Codex history · ${formatRelativeTime(entry.updatedAt)}`;
}

export function formatRelativeTime(input: string): string {
  const timestamp = Date.parse(input);
  if (!Number.isFinite(timestamp)) {
    return "Codex history";
  }
  return formatRelativeThreadTime(timestamp);
}

export function formatRelativeThreadTime(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  const hour = 60 * 60_000;
  const day = 24 * hour;
  const week = 7 * day;
  if (diffMs < day) {
    return `${Math.max(1, Math.floor(diffMs / hour) || 1)} 小时`;
  }
  if (diffMs < week) {
    return `${Math.max(1, Math.floor(diffMs / day))} 天`;
  }
  return `${Math.max(1, Math.floor(diffMs / week))} 周`;
}

export function reasoningLabel(value: LocalReasoningEffort | null | undefined): string {
  if (value === "low") {
    return "低";
  }
  if (value === "medium") {
    return "中";
  }
  if (value === "high") {
    return "高";
  }
  if (value === "xhigh") {
    return "超高";
  }
  return "默认推理";
}

export function permissionLabel(value: LocalPermissionMode): string {
  if (value === "auto-approve") {
    return "替我审批";
  }
  if (value === "full-access") {
    return "完全访问权限";
  }
  if (value === "custom-config") {
    return "自定义 config.toml";
  }
  return "请求批准";
}

export function shortPath(input: string): string {
  const parts = input.split("/").filter(Boolean);
  return parts.at(-1) ?? input;
}

export function statusLabel(status: string): string {
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

export function readThreadSidebarPrefs(): Record<string, ThreadSidebarPrefs> {
  try {
    const raw = window.localStorage.getItem(threadSidebarPrefsStorageKey);
    if (!raw) {
      return {};
    }
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed).map(([scope, value]) => [
        scope,
        sanitizeThreadSidebarPrefs(value)
      ])
    );
  } catch {
    return {};
  }
}

export function readProjectSidebarPrefs(): Record<string, ProjectSidebarPrefs> {
  try {
    const raw = window.localStorage.getItem(projectSidebarPrefsStorageKey);
    if (!raw) {
      return {};
    }
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed).map(([scope, value]) => [
        scope,
        sanitizeProjectSidebarPrefs(value)
      ])
    );
  } catch {
    return {};
  }
}

export function sanitizeThreadSidebarPrefs(value: unknown): ThreadSidebarPrefs {
  if (!isRecord(value)) {
    return { archived: [], pinned: [] };
  }
  const pinned = Array.isArray(value.pinned)
    ? value.pinned.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
  const archived = Array.isArray(value.archived)
    ? value.archived.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
  return {
    archived: [...new Set(archived)],
    pinned: [...new Set(pinned)]
  };
}

export function sanitizeProjectSidebarPrefs(value: unknown): ProjectSidebarPrefs {
  if (!isRecord(value)) {
    return { hidden: [], pinned: [], renamed: {} };
  }
  const pinned = Array.isArray(value.pinned)
    ? value.pinned.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
  const hidden = Array.isArray(value.hidden)
    ? value.hidden.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
  const renamed = isRecord(value.renamed)
    ? Object.fromEntries(
        Object.entries(value.renamed)
          .filter(
            (entry): entry is [string, string] =>
              typeof entry[0] === "string" && typeof entry[1] === "string"
          )
          .map(([cwd, name]) => [cwd, name.trim()] as const)
          .filter((entry) => entry[1].length > 0)
      )
    : {};
  return {
    hidden: [...new Set(hidden)],
    pinned: [...new Set(pinned)],
    renamed
  };
}

export function threadPrefsScope(agentUrl: string): string {
  return normalizeAgentUrl(agentUrl);
}

export function getThreadSidebarPrefs(
  prefsByScope: Record<string, ThreadSidebarPrefs>,
  agentUrl: string
): ThreadSidebarPrefs {
  return prefsByScope[threadPrefsScope(agentUrl)] ?? { archived: [], pinned: [] };
}

export function getProjectSidebarPrefs(
  prefsByScope: Record<string, ProjectSidebarPrefs>,
  agentUrl: string
): ProjectSidebarPrefs {
  return prefsByScope[threadPrefsScope(agentUrl)] ?? {
    hidden: [],
    pinned: [],
    renamed: {}
  };
}

export function threadKeyForHistory(entry: LocalCodexHistoryEntry): string {
  return entry.id;
}

export function threadKeyForSession(session: LocalSessionSummary): string {
  return session.threadId || session.sessionId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function projectName(cwd: string, renamed: string | undefined): string {
  return renamed?.trim() || shortPath(cwd);
}
