import type {
  LocalCodexHistoryEntry,
  LocalPermissionMode,
  LocalReasoningEffort,
  LocalSessionSummary
} from "../../lib/types";
import type { ChatItem } from "../../lib/types";
import { deriveCodexGeneratedTitle } from "@codexnext/protocol";
import type { TurnGroup } from "../chat/chat-state";
import { normalizeAgentUrl } from "../devices/device-utils";

export interface ThreadSidebarPrefs {
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
  note?: string;
  noteTone?: "danger" | "muted";
  pinned: boolean;
  selected: boolean;
  threadId: string;
  timeLabel: string;
  timestamp: number;
  title: string;
}

export interface ThreadSidebarNotice {
  text: string;
  tone: "danger" | "muted";
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
  selectedHistoryKey: string | null,
  noticesByItemId: Record<string, ThreadSidebarNotice> = {}
): ProjectThreadGroupData[] {
  const groups = new Map<string, ProjectThreadGroupData>();
  const pinned = new Set(threadPrefs.pinned);
  const pinnedProjects = new Set(projectPrefs.pinned);
  const hiddenProjects = new Set(projectPrefs.hidden);
  const sessionThreadIds = new Set(
    sessions
      .filter(
        (session) =>
          !isHistoryPreviewSessionId(session.sessionId) &&
          !isPendingSessionId(session.sessionId)
      )
      .map((session) => session.threadId)
  );

  for (const session of sessions) {
    if (
      isHistoryPreviewSessionId(session.sessionId) ||
      isPendingSessionId(session.sessionId)
    ) {
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
    if (!isRestorableHistoryEntry(entry)) {
      continue;
    }
    const uniqueKey = codexHistoryKey(entry);
    if (
      seen.has(uniqueKey) ||
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
          ...(noticesByItemId[session.sessionId]
            ? {
                note: noticesByItemId[session.sessionId]!.text,
                noteTone: noticesByItemId[session.sessionId]!.tone
              }
            : {}),
          pinned: pinned.has(threadKeyForSession(session)),
          selected: activeSessionId === session.sessionId,
          threadId: threadKeyForSession(session),
          timeLabel: formatRelativeThreadTime(session.updatedAt),
          timestamp: session.updatedAt,
          title: sidebarThreadTitle(sessionTitle(session, chatItems, entries))
        })),
        ...group.entries.map((entry) => {
          const timestamp = parseHistoryTimestamp(entry.updatedAt, entry.createdAt);
          return {
            entry,
            id: codexHistoryKey(entry),
            kind: "history" as const,
            ...(noticesByItemId[codexHistoryKey(entry)]
              ? {
                  note: noticesByItemId[codexHistoryKey(entry)]!.text,
                  noteTone: noticesByItemId[codexHistoryKey(entry)]!.tone
                }
              : {}),
            pinned: pinned.has(threadKeyForHistory(entry)),
            selected: selectedHistoryKey === codexHistoryKey(entry),
            threadId: threadKeyForHistory(entry),
            timeLabel: formatRelativeThreadTime(timestamp),
            timestamp,
            title: sidebarThreadTitle(entry.title)
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

export function isRestorableHistoryEntry(entry: LocalCodexHistoryEntry): boolean {
  return entry.cwdExists !== false;
}

export function filterRestorableHistoryEntries(
  entries: LocalCodexHistoryEntry[]
): LocalCodexHistoryEntry[] {
  return entries.filter(isRestorableHistoryEntry);
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
    title: entry.title,
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
    title: null,
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

export function sessionTitle(
  session: LocalSessionSummary,
  chatItems: ChatItem[],
  historyEntries: LocalCodexHistoryEntry[] = []
): string {
  const explicitTitle = session.title?.trim();
  if (explicitTitle) {
    return explicitTitle;
  }
  const historyTitle = historyEntries.find((entry) => entry.id === session.threadId)?.title?.trim();
  if (historyTitle) {
    return historyTitle;
  }
  const firstUserTitle = deriveSessionChatFallbackTitle(session, chatItems);
  if (firstUserTitle) {
    return firstUserTitle;
  }
  return shortPath(session.cwd);
}

export function sessionTitleFromTurnGroups(
  session: LocalSessionSummary,
  turnGroups: TurnGroup[],
  historyEntries: LocalCodexHistoryEntry[] = [],
  fallbackChatItems: ChatItem[] = []
): string {
  const explicitTitle = session.title?.trim();
  if (explicitTitle) {
    return explicitTitle;
  }
  const historyTitle = historyEntries.find((entry) => entry.id === session.threadId)?.title?.trim();
  if (historyTitle) {
    return historyTitle;
  }
  const firstTurnGroupTitle = deriveSessionTurnGroupFallbackTitle(turnGroups);
  if (firstTurnGroupTitle) {
    return firstTurnGroupTitle;
  }
  const firstUserTitle = deriveSessionChatFallbackTitle(session, fallbackChatItems);
  if (firstUserTitle) {
    return firstUserTitle;
  }
  return shortPath(session.cwd);
}

function sidebarThreadTitle(input: string): string {
  const terminalPromptInput = extractTerminalPromptInput(input);
  if (terminalPromptInput) {
    return deriveCodexGeneratedTitle(terminalPromptInput) ?? terminalPromptInput;
  }

  const diagnosticLine = extractDiagnosticTitleLine(input);
  if (diagnosticLine) {
    return deriveCodexGeneratedTitle(diagnosticLine) ?? diagnosticLine;
  }

  const meaningfulLine = extractMeaningfulTitleLine(input);
  if (meaningfulLine) {
    return deriveCodexGeneratedTitle(meaningfulLine) ?? meaningfulLine;
  }

  return deriveCodexGeneratedTitle(input) ?? shortLogTitle(input) ?? "未命名会话";
}

function extractTerminalPromptInput(input: string): string | null {
  for (const line of splitTitleLines(input)) {
    const match = line.match(/^(?:[\w.-]+@[\w.-]+)(?::[^$#%>]*)?\s+[^$#%>]*[$#%>]\s+(.+)$/);
    const command = match?.[1]?.trim();
    if (command && !isShellNoiseLine(command)) {
      return command;
    }
  }
  return null;
}

function extractDiagnosticTitleLine(input: string): string | null {
  for (const line of splitTitleLines(input)) {
    if (
      /^(Type error|Error|Failed to compile|Command .* not found|Cannot find module|Module not found)\b/i.test(
        line
      )
    ) {
      return line;
    }
  }
  return null;
}

function extractMeaningfulTitleLine(input: string): string | null {
  for (const line of splitTitleLines(input)) {
    if (!isShellNoiseLine(line)) {
      return line;
    }
  }
  return null;
}

function splitTitleLines(input: string): string[] {
  return input
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function isShellNoiseLine(line: string): boolean {
  return (
    line.length === 0 ||
    /^>? ?(?:npm|pnpm|yarn|node|npx|bun|prisma|next)\b/i.test(line) ||
    /^[-┌└│✓✔●·\s]+$/.test(line) ||
    /^[✓✔]\s/.test(line) ||
    /^[┌└│]/.test(line) ||
    /^\d+\s*\|/.test(line) ||
    /^at\s.+\(.+\)$/.test(line) ||
    /^(Environment variables loaded|Prisma schema loaded|Start by importing|Tip:|Update available|Run the following|Linting and checking|Creating an optimized|Compiled successfully)\b/i.test(
      line
    ) ||
    /^ganxing@|^ubuntu@|^root@/i.test(line) ||
    /^>?\s*[\w.-]+@[\w.-]+\s/.test(line) ||
    /^ ?ELIFECYCLE\b/i.test(line)
  );
}

function shortLogTitle(input: string): string | null {
  const line = splitTitleLines(input)[0];
  if (!line) {
    return null;
  }
  const normalized = deriveCodexGeneratedTitle(line);
  return normalized || null;
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
    return { pinned: [] };
  }
  const pinned = Array.isArray(value.pinned)
    ? value.pinned.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
  return {
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

export function relayThreadPrefsScope(relayUrl: string, deviceId: string): string {
  return `relay|${normalizeAgentUrl(relayUrl)}|${deviceId.trim()}`;
}

export function getThreadSidebarPrefs(
  prefsByScope: Record<string, ThreadSidebarPrefs>,
  agentUrl: string
): ThreadSidebarPrefs {
  return prefsByScope[threadPrefsScope(agentUrl)] ?? { pinned: [] };
}

export function getProjectSidebarPrefs(
  prefsByScope: Record<string, ProjectSidebarPrefs>,
  scopeKey: string
): ProjectSidebarPrefs {
  return prefsByScope[threadPrefsScope(scopeKey)] ?? {
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

function deriveSessionChatFallbackTitle(
  session: LocalSessionSummary,
  chatItems: ChatItem[]
): string | null {
  const firstUserMessage = chatItems.find(
    (item) =>
      item.sessionId === session.sessionId &&
      item.role === "user" &&
      item.text.trim().length > 0
  );
  if (!firstUserMessage) {
    return null;
  }
  return deriveCodexGeneratedTitle(firstUserMessage.text);
}

function deriveSessionTurnGroupFallbackTitle(turnGroups: TurnGroup[]): string | null {
  for (const group of turnGroups) {
    for (const item of group.userItems) {
      const text = item.text.trim();
      if (!text) {
        continue;
      }
      return deriveCodexGeneratedTitle(text);
    }
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function projectName(cwd: string, renamed: string | undefined): string {
  return renamed?.trim() || shortPath(cwd);
}
