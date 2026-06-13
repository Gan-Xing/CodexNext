import type { AgentConnection } from "../../lib/api";
import type {
  ChatItem,
  LocalCodexHistoryDetailResponse,
  LocalCodexHistoryMessage,
  LocalDirectoryListResponse,
  LocalEvent,
  LocalHealthResponse,
  LocalSessionSummary,
  PendingApprovalView
} from "../../lib/types";
import { stripAnsi } from "../../lib/format/diff";
import { isRecord } from "../../lib/format/text";
import { historyMessageToChatItem } from "../sessions/session-utils";

export interface AttachmentDraft {
  name: string;
  type: string;
  size: number;
  content: string | null;
}

export type ResumeState = "history" | "resuming" | "failed" | "missing";
export type WorkspaceSyncState = "idle" | "loading" | "ready" | "error";
export type StateUpdater<T> = T | ((previous: T) => T);
export type ConversationKey = string;
export type OutboxStatus = "pending" | "sent" | "streaming" | "complete" | "failed";

export interface ConversationRecord {
  items: ChatItem[];
  key: ConversationKey;
  latestSeq: number | null;
  pendingClientIds: string[];
  sessionIds: string[];
  threadId: string | null;
  updatedAt: number;
}

export interface ConversationCacheEntry {
  conversationKey: ConversationKey;
  items: ChatItem[];
  latestSeq: number | null;
  sessionIds: string[];
  threadId: string | null;
  updatedAt: number;
}

export interface OutboxEntry {
  clientMessageId: string;
  conversationKey: ConversationKey;
  createdAt: number;
  error?: string | undefined;
  sessionId?: string | undefined;
  status: OutboxStatus;
  text: string;
  threadId?: string | undefined;
  turnId?: string | undefined;
  updatedAt: number;
}

export interface DeviceWorkspace {
  chatItems: ChatItem[];
  codexHistory: LocalCodexHistoryEntryLike[];
  conversationAliases: Record<ConversationKey, ConversationKey>;
  conversations: Record<ConversationKey, ConversationRecord>;
  connection: AgentConnection;
  currentSessionId: string | null;
  cwd: string;
  directoryError: string | null;
  directoryList: LocalDirectoryListResponse | null;
  directoryLoading: boolean;
  events: LocalEvent[];
  healthStatus: LocalHealthResponse | null;
  historySyncState: WorkspaceSyncState;
  historyLoadingKey: string | null;
  historyPages: Record<string, SessionHistoryPageState>;
  loadedThreadIds: string[];
  missingHistoryCwds: string[];
  outbox: Record<string, OutboxEntry>;
  pendingApprovals: PendingApprovalView[];
  resumeStates: Record<string, ResumeState>;
  selectedHistoryKey: string | null;
  sessionSyncState: WorkspaceSyncState;
  sessionHistoryOrigins: Record<string, string>;
  sessionConversationKeys: Record<string, ConversationKey>;
  sessions: LocalSessionSummary[];
  streamStatus: string;
  threadConversationKeys: Record<string, ConversationKey>;
}

type LocalCodexHistoryEntryLike = LocalCodexHistoryDetailResponse["entry"];
const THINKING_TEXT = "正在思考";
const CONVERSATION_CACHE_THREAD_LIMIT = 120;
const CONVERSATION_CACHE_MESSAGE_LIMIT = 100;

export interface SessionHistoryPageState {
  loadingOlder: boolean;
  olderCursor: string | null;
  sourceKey: string | null;
}

export function createDeviceWorkspace(connection: AgentConnection): DeviceWorkspace {
  return {
    chatItems: [],
    codexHistory: [],
    conversationAliases: {},
    conversations: {},
    connection,
    currentSessionId: null,
    cwd: "",
    directoryError: null,
    directoryList: null,
    directoryLoading: false,
    events: [],
    healthStatus: null,
    historySyncState: "idle",
    historyLoadingKey: null,
    historyPages: {},
    loadedThreadIds: [],
    missingHistoryCwds: [],
    outbox: {},
    pendingApprovals: [],
    resumeStates: {},
    selectedHistoryKey: null,
    sessionSyncState: "idle",
    sessionHistoryOrigins: {},
    sessionConversationKeys: {},
    sessions: [],
    streamStatus: "disconnected",
    threadConversationKeys: {}
  };
}

export function resolveStateUpdater<T>(previous: T, updater: StateUpdater<T>): T {
  return typeof updater === "function"
    ? (updater as (value: T) => T)(previous)
    : updater;
}

export function mergeLocalEvents(
  existing: LocalEvent[],
  incoming: LocalEvent[]
): LocalEvent[] {
  const bySeq = new Map(existing.map((event) => [event.seq, event]));
  for (const event of incoming) {
    bySeq.set(event.seq, event);
  }
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq).slice(-500);
}

export function conversationKeyFor(input: {
  pendingClientId?: string | undefined;
  sessionId?: string | undefined;
  threadId?: string | undefined;
}): ConversationKey {
  return input.threadId ?? input.sessionId ?? input.pendingClientId ?? "conversation:empty";
}

export function selectConversationChatItems(
  workspace: DeviceWorkspace | null,
  input: {
    pendingClientId?: string | undefined;
    sessionId?: string | undefined;
    threadId?: string | undefined;
  } | null
): ChatItem[] {
  if (!workspace || !input) {
    return [];
  }
  const key = findConversationKey(workspace, input);
  if (!key) {
    return [];
  }
  return workspace.conversations[canonicalConversationKey(workspace, key)]?.items ?? [];
}

export function selectConversationRenderSnapshot(
  workspace: DeviceWorkspace | null,
  input: {
    pendingClientId?: string | undefined;
    sessionId?: string | undefined;
    threadId?: string | undefined;
  } | null
): {
  key: ConversationKey | null;
  latestSeq: number | null;
  messageCount: number;
  statusSignature: string;
} {
  if (!workspace || !input) {
    return {
      key: null,
      latestSeq: null,
      messageCount: 0,
      statusSignature: ""
    };
  }
  const key = findConversationKey(workspace, input);
  if (!key) {
    return {
      key: null,
      latestSeq: null,
      messageCount: 0,
      statusSignature: ""
    };
  }
  const canonicalKey = canonicalConversationKey(workspace, key);
  const conversation = workspace.conversations[canonicalKey];
  if (!conversation) {
    return {
      key: canonicalKey,
      latestSeq: null,
      messageCount: 0,
      statusSignature: ""
    };
  }
  return {
    key: canonicalKey,
    latestSeq: conversation.latestSeq,
    messageCount: conversation.items.length,
    statusSignature: buildConversationStatusSignature(conversation)
  };
}

export function restoreOutboxEntries(
  workspace: DeviceWorkspace,
  entries: OutboxEntry[]
): DeviceWorkspace {
  let next = workspace;
  for (const entry of entries) {
    if (
      entry.status === "complete" ||
      next.outbox[entry.clientMessageId]
    ) {
      continue;
    }
    const conversationKey = canonicalConversationKey(next, entry.conversationKey);
    next = ensureConversation(next, {
      conversationKey,
      sessionId: entry.sessionId,
      threadId: entry.threadId,
      pendingClientId: entry.clientMessageId
    });
    const itemStatus: ChatItem["status"] =
      entry.status === "pending" ? "pending" : entry.status;
    const userItem: ChatItem = {
        id: `optimistic:${entry.clientMessageId}`,
        role: "user",
        text: entry.text,
        ...(entry.sessionId ? { sessionId: entry.sessionId } : {}),
        ...(entry.turnId ? { turnId: entry.turnId } : {}),
        clientMessageId: entry.clientMessageId,
        status: itemStatus,
        createdAt: entry.createdAt
      };
    const feedbackItem: ChatItem = {
        id: `optimistic-thinking:${entry.clientMessageId}`,
        role: "system",
        text: entry.status === "failed" ? entry.error ?? "消息发送失败" : THINKING_TEXT,
        ...(entry.sessionId ? { sessionId: entry.sessionId } : {}),
        ...(entry.turnId ? { turnId: entry.turnId } : {}),
        status: entry.status === "failed" ? "failed" : "streaming",
        createdAt: entry.createdAt,
        meta: {
          clientMessageId: entry.clientMessageId,
          kind: entry.status === "failed" ? "error" : "thinking"
        }
      };
    next = upsertConversationItems(next, conversationKey, [userItem, feedbackItem]);
    next = setOutboxEntry(next, entry);
  }
  return materializeWorkspace(next);
}

export function restoreConversationCacheEntries(
  workspace: DeviceWorkspace,
  entries: ConversationCacheEntry[]
): DeviceWorkspace {
  let next = workspace;
  for (const entry of entries
    .filter((item) => item.items.length > 0)
    .sort((left, right) => left.updatedAt - right.updatedAt)) {
    next = ensureConversation(next, {
      conversationKey: entry.conversationKey,
      ...(entry.threadId ? { threadId: entry.threadId } : {})
    });
    for (const sessionId of entry.sessionIds) {
      next = ensureConversation(next, {
        conversationKey: entry.conversationKey,
        sessionId,
        ...(entry.threadId ? { threadId: entry.threadId } : {})
      });
    }
    const finalKey = canonicalConversationKey(
      next,
      entry.threadId ?? entry.sessionIds[0] ?? entry.conversationKey
    );
    next = upsertConversationItems(
      next,
      finalKey,
      entry.items.map(sanitizeCachedChatItem).filter((item): item is ChatItem => Boolean(item)),
      { latestSeq: entry.latestSeq }
    );
  }
  return materializeWorkspace(next);
}

export function buildConversationCacheEntries(
  workspace: DeviceWorkspace
): ConversationCacheEntry[] {
  return Object.values(workspace.conversations)
    .map((conversation) => {
      const items = conversation.items
        .filter(shouldPersistChatItem)
        .slice(-CONVERSATION_CACHE_MESSAGE_LIMIT);
      if (items.length === 0) {
        return null;
      }
      return {
        conversationKey: conversation.key,
        items,
        latestSeq: conversation.latestSeq,
        sessionIds: conversation.sessionIds,
        threadId: conversation.threadId,
        updatedAt: conversation.updatedAt
      } satisfies ConversationCacheEntry;
    })
    .filter((entry): entry is ConversationCacheEntry => Boolean(entry))
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, CONVERSATION_CACHE_THREAD_LIMIT);
}

function findConversationKey(
  workspace: DeviceWorkspace,
  input: {
    pendingClientId?: string | undefined;
    sessionId?: string | undefined;
    threadId?: string | undefined;
  }
): ConversationKey | null {
  if (input.threadId && workspace.threadConversationKeys[input.threadId]) {
    return workspace.threadConversationKeys[input.threadId]!;
  }
  if (input.sessionId && workspace.sessionConversationKeys[input.sessionId]) {
    return workspace.sessionConversationKeys[input.sessionId]!;
  }
  if (input.pendingClientId && workspace.outbox[input.pendingClientId]) {
    return workspace.outbox[input.pendingClientId]!.conversationKey;
  }
  const fallback = conversationKeyFor(input);
  return workspace.conversations[canonicalConversationKey(workspace, fallback)]
    ? fallback
    : null;
}

function ensureConversation(
  workspace: DeviceWorkspace,
  input: {
    conversationKey?: ConversationKey | undefined;
    pendingClientId?: string | undefined;
    sessionId?: string | undefined;
    threadId?: string | undefined;
  }
): DeviceWorkspace {
  const preferredKey = canonicalConversationKey(
    workspace,
    input.conversationKey ?? conversationKeyFor(input)
  );
  let next = workspace;
  if (!next.conversations[preferredKey]) {
    next = {
      ...next,
      conversations: {
        ...next.conversations,
        [preferredKey]: {
          items: [],
          key: preferredKey,
          latestSeq: null,
          pendingClientIds: [],
          sessionIds: [],
          threadId: input.threadId ?? null,
          updatedAt: Date.now()
        }
      }
    };
  }
  next = associateConversation(next, preferredKey, input);
  return next;
}

function associateConversation(
  workspace: DeviceWorkspace,
  key: ConversationKey,
  input: {
    pendingClientId?: string | undefined;
    sessionId?: string | undefined;
    threadId?: string | undefined;
  }
): DeviceWorkspace {
  const canonicalKey = canonicalConversationKey(workspace, key);
  let next = workspace;
  if (input.threadId) {
    next = mergeConversationKeys(
      next,
      canonicalKey,
      canonicalConversationKey(
        next,
        next.threadConversationKeys[input.threadId] ?? input.threadId
      )
    );
  }
  if (input.sessionId) {
    next = mergeConversationKeys(
      next,
      canonicalConversationKey(next, input.threadId ?? canonicalKey),
      canonicalConversationKey(
        next,
        next.sessionConversationKeys[input.sessionId] ?? input.sessionId
      )
    );
  }

  const finalKey = canonicalConversationKey(next, input.threadId ?? input.sessionId ?? canonicalKey);
  const conversation = next.conversations[finalKey];
  if (!conversation) {
    return next;
  }
  const nextConversation: ConversationRecord = {
    ...conversation,
    pendingClientIds: input.pendingClientId
      ? [...new Set([...conversation.pendingClientIds, input.pendingClientId])]
      : conversation.pendingClientIds,
    sessionIds: input.sessionId
      ? [...new Set([...conversation.sessionIds, input.sessionId])]
      : conversation.sessionIds,
    threadId: input.threadId ?? conversation.threadId,
    updatedAt: Date.now()
  };
  return {
    ...next,
    conversationAliases: {
      ...next.conversationAliases,
      ...(input.pendingClientId ? { [input.pendingClientId]: finalKey } : {}),
      ...(input.sessionId ? { [input.sessionId]: finalKey } : {}),
      ...(input.threadId ? { [input.threadId]: finalKey } : {})
    },
    conversations: {
      ...next.conversations,
      [finalKey]: nextConversation
    },
    sessionConversationKeys: input.sessionId
      ? {
          ...next.sessionConversationKeys,
          [input.sessionId]: finalKey
        }
      : next.sessionConversationKeys,
    threadConversationKeys: input.threadId
      ? {
          ...next.threadConversationKeys,
          [input.threadId]: finalKey
        }
      : next.threadConversationKeys
  };
}

function mergeConversationKeys(
  workspace: DeviceWorkspace,
  preferredKey: ConversationKey,
  aliasKey: ConversationKey
): DeviceWorkspace {
  const canonicalPreferred = canonicalConversationKey(workspace, preferredKey);
  const canonicalAlias = canonicalConversationKey(workspace, aliasKey);
  if (canonicalPreferred === canonicalAlias) {
    return workspace;
  }
  const preferred =
    workspace.conversations[canonicalPreferred] ??
    emptyConversation(canonicalPreferred);
  const alias = workspace.conversations[canonicalAlias];
  if (!alias) {
    return {
      ...workspace,
      conversationAliases: {
        ...workspace.conversationAliases,
        [canonicalAlias]: canonicalPreferred
      }
    };
  }
  const nextConversations = { ...workspace.conversations };
  delete nextConversations[canonicalAlias];
  nextConversations[canonicalPreferred] = {
    ...preferred,
    items: mergeConversationItems(preferred.items, alias.items),
    latestSeq: Math.max(preferred.latestSeq ?? 0, alias.latestSeq ?? 0) || null,
    pendingClientIds: [...new Set([...preferred.pendingClientIds, ...alias.pendingClientIds])],
    sessionIds: [...new Set([...preferred.sessionIds, ...alias.sessionIds])],
    threadId: preferred.threadId ?? alias.threadId,
    updatedAt: Math.max(preferred.updatedAt, alias.updatedAt, Date.now())
  };
  const remapRecord = (record: Record<string, string>) =>
    Object.fromEntries(
      Object.entries(record).map(([id, key]) => [
        id,
        canonicalConversationKey(
          { ...workspace, conversationAliases: { ...workspace.conversationAliases, [canonicalAlias]: canonicalPreferred } },
          key
        )
      ])
    );
  return {
    ...workspace,
    conversationAliases: {
      ...workspace.conversationAliases,
      [canonicalAlias]: canonicalPreferred
    },
    conversations: nextConversations,
    outbox: Object.fromEntries(
      Object.entries(workspace.outbox).map(([clientMessageId, entry]) => [
        clientMessageId,
        {
          ...entry,
          conversationKey:
            canonicalConversationKey(workspace, entry.conversationKey) === canonicalAlias
              ? canonicalPreferred
              : canonicalConversationKey(workspace, entry.conversationKey)
        }
      ])
    ),
    sessionConversationKeys: remapRecord(workspace.sessionConversationKeys),
    threadConversationKeys: remapRecord(workspace.threadConversationKeys)
  };
}

function emptyConversation(key: ConversationKey): ConversationRecord {
  return {
    items: [],
    key,
    latestSeq: null,
    pendingClientIds: [],
    sessionIds: [],
    threadId: null,
    updatedAt: Date.now()
  };
}

function canonicalConversationKey(
  workspace: Pick<DeviceWorkspace, "conversationAliases">,
  key: ConversationKey
): ConversationKey {
  let current = key;
  const seen = new Set<string>();
  while (workspace.conversationAliases[current] && !seen.has(current)) {
    seen.add(current);
    current = workspace.conversationAliases[current]!;
  }
  return current;
}

function upsertConversationItems(
  workspace: DeviceWorkspace,
  key: ConversationKey,
  items: ChatItem[],
  options: { latestSeq?: number | null } = {}
): DeviceWorkspace {
  const canonicalKey = canonicalConversationKey(workspace, key);
  const conversation = workspace.conversations[canonicalKey] ?? emptyConversation(canonicalKey);
  const nextItems = mergeConversationItems(conversation.items, items);
  return materializeWorkspace({
    ...workspace,
    conversations: {
      ...workspace.conversations,
      [canonicalKey]: {
        ...conversation,
        items: nextItems,
        latestSeq:
          options.latestSeq !== undefined
            ? Math.max(conversation.latestSeq ?? 0, options.latestSeq ?? 0) || null
            : conversation.latestSeq,
        updatedAt: Date.now()
      }
    }
  });
}

function updateConversationItems(
  workspace: DeviceWorkspace,
  key: ConversationKey,
  updater: (items: ChatItem[]) => ChatItem[]
): DeviceWorkspace {
  const canonicalKey = canonicalConversationKey(workspace, key);
  const conversation = workspace.conversations[canonicalKey] ?? emptyConversation(canonicalKey);
  return materializeWorkspace({
    ...workspace,
    conversations: {
      ...workspace.conversations,
      [canonicalKey]: {
        ...conversation,
        items: updater(conversation.items).slice(-500),
        updatedAt: Date.now()
      }
    }
  });
}

function setOutboxEntry(workspace: DeviceWorkspace, entry: OutboxEntry): DeviceWorkspace {
  return {
    ...workspace,
    outbox: {
      ...workspace.outbox,
      [entry.clientMessageId]: entry
    }
  };
}

function updateOutboxEntry(
  workspace: DeviceWorkspace,
  clientMessageId: string,
  updater: (entry: OutboxEntry) => OutboxEntry
): DeviceWorkspace {
  const current = workspace.outbox[clientMessageId];
  if (!current) {
    return workspace;
  }
  return setOutboxEntry(workspace, updater(current));
}

function mergeConversationItems(existing: ChatItem[], incoming: ChatItem[]): ChatItem[] {
  let next = [...existing];
  for (const item of incoming) {
    const existingIndex = next.findIndex(
      (current) =>
        current.id === item.id ||
        (item.clientMessageId !== undefined &&
          current.clientMessageId === item.clientMessageId &&
          current.role === item.role) ||
        (item.turnId !== undefined &&
          current.turnId === item.turnId &&
          current.sessionId === item.sessionId &&
          current.role === item.role)
    );
    if (existingIndex >= 0) {
      next = next.map((current, index) =>
        index === existingIndex
          ? {
              ...current,
              ...item,
              text:
                item.id === current.id || item.clientMessageId === current.clientMessageId
                  ? item.text
                  : current.text
            }
          : current
      );
    } else {
      next.push(item);
    }
  }
  return next
    .sort((left, right) => (left.createdAt ?? 0) - (right.createdAt ?? 0))
    .slice(-500);
}

function shouldPersistChatItem(item: ChatItem): boolean {
  if (item.text.trim().length === 0) {
    return false;
  }
  if (item.status === "pending" || item.status === "failed") {
    return false;
  }
  const metaKind = typeof item.meta?.kind === "string" ? item.meta.kind : null;
  if (metaKind === "thinking" || metaKind === "error") {
    return false;
  }
  return true;
}

function buildConversationStatusSignature(conversation: ConversationRecord): string {
  const statusCounts = conversation.items.reduce<Record<string, number>>((counts, item) => {
    const key = `${item.role}:${item.status ?? "unset"}`;
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
  const tail = conversation.items
    .slice(-6)
    .map((item) => `${item.id}:${item.status ?? "unset"}:${item.text.length}`)
    .join("|");
  return `${conversation.items.length}|${conversation.latestSeq ?? "none"}|${Object.entries(statusCounts)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, count]) => `${key}=${count}`)
    .join(",")}|${tail}`;
}

function sanitizeCachedChatItem(item: ChatItem): ChatItem | null {
  if (!shouldPersistChatItem(item)) {
    return null;
  }
  return {
    id: item.id,
    role: item.role,
    text: item.text.slice(0, 120_000),
    ...(item.sessionId ? { sessionId: item.sessionId } : {}),
    ...(item.turnId ? { turnId: item.turnId } : {}),
    ...(item.clientMessageId ? { clientMessageId: item.clientMessageId } : {}),
    ...(item.status ? { status: item.status } : {}),
    ...(typeof item.createdAt === "number" ? { createdAt: item.createdAt } : {}),
    ...(item.error ? { error: item.error.slice(0, 4_000) } : {}),
    ...(item.meta ? { meta: item.meta } : {})
  };
}

function materializeWorkspace(workspace: DeviceWorkspace): DeviceWorkspace {
  const conversations = Object.values(workspace.conversations).sort(
    (left, right) => left.updatedAt - right.updatedAt
  );
  return {
    ...workspace,
    chatItems: conversations.flatMap((conversation) => conversation.items).slice(-500)
  };
}

function setConversationLatestSeq(
  workspace: DeviceWorkspace,
  key: ConversationKey,
  latestSeq: number | null
): DeviceWorkspace {
  if (latestSeq === null) {
    return materializeWorkspace(workspace);
  }
  const canonicalKey = canonicalConversationKey(workspace, key);
  const conversation = workspace.conversations[canonicalKey];
  if (!conversation) {
    return materializeWorkspace(workspace);
  }
  return materializeWorkspace({
    ...workspace,
    conversations: {
      ...workspace.conversations,
      [canonicalKey]: {
        ...conversation,
        latestSeq: Math.max(conversation.latestSeq ?? 0, latestSeq),
        updatedAt: Date.now()
      }
    }
  });
}

function findConversationKeyForTurn(
  workspace: DeviceWorkspace,
  sessionId: string | undefined,
  threadId: string | undefined,
  turnId: string | undefined
): ConversationKey | null {
  const direct = findConversationKey(workspace, {
    sessionId,
    threadId
  });
  if (direct) {
    return direct;
  }
  if (!turnId) {
    return null;
  }
  const outboxEntry = Object.values(workspace.outbox).find(
    (entry) => entry.turnId === turnId
  );
  if (outboxEntry) {
    return outboxEntry.conversationKey;
  }
  const conversation = Object.values(workspace.conversations).find((record) =>
    record.items.some((item) => item.turnId === turnId)
  );
  return conversation?.key ?? null;
}

function updateOutboxStatusByTurn(
  outbox: Record<string, OutboxEntry>,
  turnId: string | undefined,
  status: OutboxStatus
): Record<string, OutboxEntry> {
  if (!turnId) {
    return outbox;
  }
  return Object.fromEntries(
    Object.entries(outbox).map(([clientMessageId, entry]) => {
      if (entry.turnId !== turnId || entry.status === "failed" || entry.status === "complete") {
        return [clientMessageId, entry] as const;
      }
      return [
        clientMessageId,
        {
          ...entry,
          status,
          updatedAt: Date.now()
        }
      ] as const;
    })
  );
}

export function createOptimisticUserMessage(input: {
  clientMessageId: string;
  sessionId: string;
  text: string;
  turnId?: string;
}): ChatItem {
  return {
    id: `optimistic:${input.clientMessageId}`,
    role: "user",
    text: input.text,
    sessionId: input.sessionId,
    ...(input.turnId ? { turnId: input.turnId } : {}),
    clientMessageId: input.clientMessageId,
    status: "pending",
    createdAt: Date.now()
  };
}

function createOptimisticThinkingItem(input: {
  clientMessageId: string;
  sessionId: string;
  turnId?: string;
}): ChatItem {
  return {
    id: `optimistic-thinking:${input.clientMessageId}`,
    role: "system",
    text: THINKING_TEXT,
    sessionId: input.sessionId,
    ...(input.turnId ? { turnId: input.turnId } : {}),
    status: "streaming",
    createdAt: Date.now(),
    meta: {
      clientMessageId: input.clientMessageId,
      kind: "thinking"
    }
  };
}

export function addOptimisticUserMessage(
  workspace: DeviceWorkspace,
  input: Parameters<typeof createOptimisticUserMessage>[0]
): DeviceWorkspace {
  const message = createOptimisticUserMessage(input);
  const thinking = createOptimisticThinkingItem(input);
  const createdAt = message.createdAt ?? Date.now();
  const key = conversationKeyFor({
    pendingClientId: input.clientMessageId,
    sessionId: input.sessionId
  });
  let next = ensureConversation(workspace, {
    conversationKey: key,
    pendingClientId: input.clientMessageId,
    sessionId: input.sessionId
  });
  next = setOutboxEntry(next, {
    clientMessageId: input.clientMessageId,
    conversationKey: canonicalConversationKey(next, key),
    createdAt,
    sessionId: input.sessionId,
    status: "pending",
    text: input.text,
    ...(input.turnId ? { turnId: input.turnId } : {}),
    updatedAt: createdAt
  });
  next = updateConversationItems(next, key, (items) => [
    ...items.filter(
      (item) =>
        item.clientMessageId !== input.clientMessageId &&
        !isOptimisticFeedbackItem(item, input.clientMessageId)
    ),
    message,
    thinking
  ]);
  return materializeWorkspace(next);
}

export function markOptimisticMessageSent(
  workspace: DeviceWorkspace,
  clientMessageId: string,
  input?: {
    eventId?: string;
    sessionId?: string;
    threadId?: string;
    turnId?: string;
  }
): DeviceWorkspace {
  const outboxEntry = workspace.outbox[clientMessageId];
  const key =
    outboxEntry?.conversationKey ??
    findConversationKey(workspace, {
      pendingClientId: clientMessageId,
      sessionId: input?.sessionId,
      threadId: input?.threadId
    }) ??
    conversationKeyFor({
      pendingClientId: clientMessageId,
      sessionId: input?.sessionId,
      threadId: input?.threadId
    });
  let next = ensureConversation(workspace, {
    conversationKey: key,
    pendingClientId: clientMessageId,
    sessionId: input?.sessionId,
    threadId: input?.threadId
  });
  const finalKey = canonicalConversationKey(next, input?.threadId ?? input?.sessionId ?? key);
  next = updateConversationItems(next, finalKey, (items) =>
    items.map((item) =>
      item.clientMessageId === clientMessageId
        ? {
            ...item,
            ...(input?.eventId ? { id: input.eventId } : {}),
            ...(input?.sessionId ? { sessionId: input.sessionId } : {}),
            ...(input?.turnId ? { turnId: input.turnId } : {}),
            error: undefined,
            status: "sent"
          }
        : isOptimisticFeedbackItem(item, clientMessageId)
          ? {
              ...item,
              ...(input?.sessionId ? { sessionId: input.sessionId } : {}),
              ...(input?.turnId ? { turnId: input.turnId } : {})
            }
        : item
    )
  );
  next = updateOutboxEntry(next, clientMessageId, (entry) => ({
    ...entry,
    conversationKey: finalKey,
    ...(input?.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input?.threadId ? { threadId: input.threadId } : {}),
    ...(input?.turnId ? { turnId: input.turnId } : {}),
    status: entry.status === "complete" ? "complete" : "sent",
    updatedAt: Date.now()
  }));
  return materializeWorkspace(next);
}

export function markOptimisticMessageFailed(
  workspace: DeviceWorkspace,
  clientMessageId: string,
  error: string
): DeviceWorkspace {
  const key =
    workspace.outbox[clientMessageId]?.conversationKey ??
    findConversationKey(workspace, { pendingClientId: clientMessageId });
  if (!key) {
    return workspace;
  }
  let next = updateConversationItems(workspace, key, (items) =>
    items.map((item) =>
      item.clientMessageId === clientMessageId
        ? {
            ...item,
            error,
            status: "failed"
          }
        : isOptimisticFeedbackItem(item, clientMessageId)
          ? {
              ...item,
              meta: {
                ...item.meta,
                clientMessageId,
                kind: "error"
              },
              status: "failed",
              text: error
            }
        : item
    )
  );
  next = updateOutboxEntry(next, clientMessageId, (entry) => ({
    ...entry,
    error,
    status: "failed",
    updatedAt: Date.now()
  }));
  return materializeWorkspace(next);
}

export function reassignSessionChatItems(
  workspace: DeviceWorkspace,
  fromSessionId: string,
  toSessionId: string
): DeviceWorkspace {
  const nextHistoryOrigins =
    workspace.sessionHistoryOrigins[fromSessionId] !== undefined
      ? {
          ...Object.fromEntries(
            Object.entries(workspace.sessionHistoryOrigins).filter(
              ([sessionId]) => sessionId !== fromSessionId
            )
          ),
          [toSessionId]: workspace.sessionHistoryOrigins[fromSessionId]!
        }
      : workspace.sessionHistoryOrigins;
  const fromKey =
    workspace.sessionConversationKeys[fromSessionId] ??
    findConversationKey(workspace, { sessionId: fromSessionId }) ??
    fromSessionId;
  let next = ensureConversation(workspace, {
    conversationKey: fromKey,
    sessionId: fromSessionId
  });
  next = associateConversation(next, canonicalConversationKey(next, fromKey), {
    sessionId: toSessionId
  });
  const finalKey = canonicalConversationKey(next, toSessionId);
  next = updateConversationItems(next, finalKey, (items) =>
    items.map((item) =>
      item.sessionId === fromSessionId
        ? {
            ...item,
            id: item.id.replace(fromSessionId, toSessionId),
            sessionId: toSessionId
          }
        : item
    )
  );
  next = {
    ...next,
    outbox: Object.fromEntries(
      Object.entries(next.outbox).map(([clientMessageId, entry]) => [
        clientMessageId,
        entry.sessionId === fromSessionId
          ? {
              ...entry,
              conversationKey: finalKey,
              sessionId: toSessionId,
              updatedAt: Date.now()
            }
          : entry
      ])
    )
  };
  return materializeWorkspace({
    ...next,
    historyPages: reassignHistoryPageState(
      workspace.historyPages,
      fromSessionId,
      toSessionId
    ),
    sessionHistoryOrigins: nextHistoryOrigins
  });
}

export function rememberSessionHistoryOrigin(
  workspace: DeviceWorkspace,
  sessionId: string,
  threadId: string
): DeviceWorkspace {
  const next = ensureConversation(workspace, {
    sessionId,
    threadId
  });
  return {
    ...next,
    sessionHistoryOrigins: {
      ...next.sessionHistoryOrigins,
      [sessionId]: threadId
    }
  };
}

export function hydrateSessionFromHistory(
  workspace: DeviceWorkspace,
  sessionId: string,
  messages: LocalCodexHistoryMessage[]
): DeviceWorkspace {
  const session = workspace.sessions.find((item) => item.sessionId === sessionId);
  const threadId = session?.threadId ?? workspace.sessionHistoryOrigins[sessionId];
  let next = ensureConversation(workspace, {
    sessionId,
    ...(threadId ? { threadId } : {})
  });
  const conversationKey =
    findConversationKey(next, { sessionId, ...(threadId ? { threadId } : {}) }) ??
    sessionId;
  const canonicalKey = canonicalConversationKey(next, conversationKey);
  const historyItems = dedupeChatItemsById(
    messages
      .filter((message) => isRenderableHistoryRole(message.role))
      .map((message) => historyMessageToChatItem(sessionId, message))
  );
  const conversationItems =
    next.conversations[canonicalKey]?.items ??
    workspace.chatItems.filter((item) => item.sessionId === sessionId);
  const preservedSessionItems = conversationItems
    .filter(
      (item) =>
        item.sessionId === sessionId &&
        !item.id.startsWith(`history-${sessionId}-`)
    )
    .filter((item) =>
      shouldPreserveAfterHistoryHydration(item, historyItems, conversationItems)
    );
  const overlap = findHistoryOverlap(historyItems, preservedSessionItems);
  next = updateConversationItems(next, canonicalKey, () =>
    [
      ...historyItems,
      ...preservedSessionItems.slice(overlap)
    ].slice(-500)
  );
  return materializeWorkspace(next);
}

export function prependSessionHistoryMessages(
  workspace: DeviceWorkspace,
  sessionId: string,
  messages: LocalCodexHistoryMessage[]
): DeviceWorkspace {
  const session = workspace.sessions.find((item) => item.sessionId === sessionId);
  const threadId = session?.threadId ?? workspace.sessionHistoryOrigins[sessionId];
  let next = ensureConversation(workspace, {
    sessionId,
    ...(threadId ? { threadId } : {})
  });
  const conversationKey =
    findConversationKey(next, { sessionId, ...(threadId ? { threadId } : {}) }) ??
    sessionId;
  const canonicalKey = canonicalConversationKey(next, conversationKey);
  const olderHistoryItems = dedupeChatItemsById(
    messages
      .filter((message) => isRenderableHistoryRole(message.role))
      .map((message) => historyMessageToChatItem(sessionId, message))
  );
  const sessionItems =
    next.conversations[canonicalKey]?.items ??
    workspace.chatItems.filter((item) => item.sessionId === sessionId);
  const existingHistoryItems = sessionItems.filter((item) =>
    item.id.startsWith(`history-${sessionId}-`)
  );
  const preservedSessionItems = sessionItems.filter(
    (item) => !item.id.startsWith(`history-${sessionId}-`)
  );

  next = updateConversationItems(next, canonicalKey, () =>
    [
      ...dedupeChatItemsById([...olderHistoryItems, ...existingHistoryItems]),
      ...preservedSessionItems
    ].slice(-500)
  );
  return materializeWorkspace(next);
}

export function setSessionHistoryPageState(
  workspace: DeviceWorkspace,
  sessionId: string,
  state: Partial<SessionHistoryPageState> | null
): DeviceWorkspace {
  const nextPages = { ...workspace.historyPages };
  if (state === null) {
    delete nextPages[sessionId];
  } else {
    nextPages[sessionId] = {
      loadingOlder: false,
      olderCursor: null,
      sourceKey: null,
      ...(workspace.historyPages[sessionId] ?? {}),
      ...state
    };
  }
  return {
    ...workspace,
    historyPages: nextPages
  };
}

export function setLoadedThreadIds(
  workspace: DeviceWorkspace,
  threadIds: string[]
): DeviceWorkspace {
  return {
    ...workspace,
    loadedThreadIds: [...new Set(threadIds.filter(Boolean))].sort()
  };
}

export function ingestEventsIntoWorkspace(
  workspace: DeviceWorkspace,
  incoming: LocalEvent[],
  options: { selectSessions: boolean }
): DeviceWorkspace {
  const appliedSeqs = new Set(workspace.events.map((event) => event.seq));
  const seenIncomingSeqs = new Set<number>();
  let next = {
    ...workspace,
    events: mergeLocalEvents(workspace.events, incoming)
  };
  for (const event of incoming) {
    if (appliedSeqs.has(event.seq) || seenIncomingSeqs.has(event.seq)) {
      continue;
    }
    seenIncomingSeqs.add(event.seq);
    next = applyEventToWorkspace(next, event, options);
  }
  return next;
}

function applyEventToWorkspace(
  workspace: DeviceWorkspace,
  event: LocalEvent,
  _options: { selectSessions: boolean }
): DeviceWorkspace {
  switch (event.type) {
    case "session.created":
    case "session.updated":
      if (!isSessionSummary(event.payload)) {
        return workspace;
      }
      const nextWorkspace = upsertSessionInWorkspace(workspace, event.payload);
      const resumedFrom = readResumedFrom(event.payload);
      return resumedFrom
        ? rememberSessionHistoryOrigin(
            nextWorkspace,
            event.payload.sessionId,
            resumedFrom
          )
        : nextWorkspace;
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
    case "thread.status.changed":
      return applyThreadStatusChanged(workspace, event);
    case "chat.user":
      return applyServerChatUser(workspace, event);
    case "chat.assistant.delta":
      return appendStreamingItemToWorkspace(
        workspace,
        "assistant",
        event.sessionId,
        event.threadId,
        event.turnId,
        readText(event.payload),
        event.id,
        event.seq
      );
    case "command.output.delta":
      return appendStreamingItemToWorkspace(
        workspace,
        "command",
        event.sessionId,
        event.threadId,
        event.turnId,
        stripAnsi(readText(event.payload)),
        event.id,
        event.seq
      );
    case "diff.updated":
      return upsertTurnScopedItem(
        removeThinkingForTurn(workspace, event.sessionId, event.threadId, event.turnId),
        {
        id: event.id,
        role: "diff",
        sessionId: event.sessionId,
        turnId: event.turnId,
        text: readDiff(event.payload),
        status: "streaming",
        meta: {
          kind: "diff"
        }
        },
        { threadId: event.threadId, latestSeq: event.seq }
      );
    case "plan.updated":
      return workspace;
    case "turn.completed":
      return markTurnItemsComplete(workspace, event.turnId);
    case "agent.error":
      return applyAgentError(workspace, event);
    default:
      return workspace;
  }
}

function applyServerChatUser(
  workspace: DeviceWorkspace,
  event: LocalEvent
): DeviceWorkspace {
  const text = readText(event.payload);
  const clientMessageId = readClientMessageId(event.payload);
  if (clientMessageId) {
    if (workspace.outbox[clientMessageId]) {
      return markOptimisticMessageSent(workspace, clientMessageId, {
        eventId: event.id,
        ...(event.sessionId ? { sessionId: event.sessionId } : {}),
        ...(event.threadId ? { threadId: event.threadId } : {}),
        ...(event.turnId ? { turnId: event.turnId } : {})
      });
    }
  }
  return addChatItemToWorkspace(
    workspace,
    {
      id: event.id,
      role: "user",
      text,
      ...(event.sessionId ? { sessionId: event.sessionId } : {}),
      ...(event.turnId ? { turnId: event.turnId } : {}),
      ...(clientMessageId ? { clientMessageId } : {}),
      status: "sent",
      createdAt: event.ts
    },
    { threadId: event.threadId, latestSeq: event.seq }
  );
}

function applyAgentError(
  workspace: DeviceWorkspace,
  event: LocalEvent
): DeviceWorkspace {
  const clientMessageId = readClientMessageId(event.payload);
  const message = readErrorMessage(event.payload);
  if (clientMessageId) {
    return markOptimisticMessageFailed(workspace, clientMessageId, message);
  }
  return addChatItemToWorkspace(
    workspace,
    {
      id: event.id,
      role: "system",
      text: message,
      ...(event.sessionId ? { sessionId: event.sessionId } : {}),
      ...(event.turnId ? { turnId: event.turnId } : {}),
      status: "complete",
      createdAt: event.ts,
      meta: {
        kind: "error"
      }
    },
    { threadId: event.threadId, latestSeq: event.seq }
  );
}

function applyThreadStatusChanged(
  workspace: DeviceWorkspace,
  event: LocalEvent
): DeviceWorkspace {
  const payload = isRecord(event.payload) ? event.payload : null;
  const threadId =
    typeof payload?.threadId === "string"
      ? payload.threadId
      : typeof event.threadId === "string"
        ? event.threadId
        : null;
  if (!threadId) {
    return workspace;
  }
  const loaded = payload?.loaded !== false;
  const next = new Set(workspace.loadedThreadIds);
  if (loaded) {
    next.add(threadId);
  } else {
    next.delete(threadId);
  }
  return {
    ...workspace,
    loadedThreadIds: [...next].sort()
  };
}

function upsertTurnScopedItem(
  workspace: DeviceWorkspace,
  item: ChatItem,
  options: { latestSeq?: number | null; threadId?: string | undefined } = {}
): DeviceWorkspace {
  const key =
    findConversationKeyForTurn(workspace, item.sessionId, options.threadId, item.turnId) ??
    conversationKeyFor({ sessionId: item.sessionId, threadId: options.threadId });
  let next = ensureConversation(workspace, {
    conversationKey: key,
    sessionId: item.sessionId,
    threadId: options.threadId
  });
  const canonicalKey = canonicalConversationKey(next, key);
  next = updateConversationItems(next, canonicalKey, (items) => {
    const existingIndex = [...items]
      .reverse()
      .findIndex(
        (current) =>
          current.role === item.role &&
          current.turnId === item.turnId &&
          current.sessionId === item.sessionId
      );
    if (existingIndex < 0) {
      return [...items, item];
    }
    const index = items.length - 1 - existingIndex;
    return items.map((current, currentIndex) =>
      currentIndex === index
        ? {
            ...current,
            ...item
          }
        : current
    );
  });
  return setConversationLatestSeq(next, canonicalKey, options.latestSeq ?? null);
}

function markTurnItemsComplete(
  workspace: DeviceWorkspace,
  turnId: string | undefined
): DeviceWorkspace {
  if (!turnId) {
    return workspace;
  }
  let next = removeThinkingForTurn(workspace, undefined, undefined, turnId);
  next = materializeWorkspace({
    ...next,
    conversations: Object.fromEntries(
      Object.entries(next.conversations).map(([key, conversation]) => [
        key,
        {
          ...conversation,
          items: conversation.items.map((item) =>
            item.turnId === turnId &&
            (
              item.status === "pending" ||
              item.status === "streaming" ||
              item.status === "sent" ||
              item.status === "sending"
            )
              ? { ...item, status: "complete" }
              : item
          ),
          updatedAt: conversation.items.some((item) => item.turnId === turnId)
            ? Date.now()
            : conversation.updatedAt
        }
      ])
    ),
    outbox: updateOutboxStatusByTurn(next.outbox, turnId, "complete")
  });
  return next;
}

export function upsertSessionInWorkspace(
  workspace: DeviceWorkspace,
  session: LocalSessionSummary
): DeviceWorkspace {
  const next = ensureConversation(workspace, {
    sessionId: session.sessionId,
    ...(session.threadId ? { threadId: session.threadId } : {})
  });
  return materializeWorkspace({
    ...next,
    sessions: [
      session,
      ...next.sessions.filter((item) => item.sessionId !== session.sessionId)
    ]
  });
}

function addChatItemToWorkspace(
  workspace: DeviceWorkspace,
  item: ChatItem,
  options: { latestSeq?: number | null; threadId?: string | undefined } = {}
): DeviceWorkspace {
  const key =
    findConversationKeyForTurn(workspace, item.sessionId, options.threadId, item.turnId) ??
    conversationKeyFor({ sessionId: item.sessionId, threadId: options.threadId });
  let next = ensureConversation(workspace, {
    conversationKey: key,
    sessionId: item.sessionId,
    threadId: options.threadId
  });
  next = upsertConversationItems(next, canonicalConversationKey(next, key), [item], {
    latestSeq: options.latestSeq ?? null
  });
  return materializeWorkspace(next);
}

function dedupeChatItemsById(items: ChatItem[]): ChatItem[] {
  const seen = new Set<string>();
  const next: ChatItem[] = [];
  for (const item of items) {
    if (seen.has(item.id)) {
      continue;
    }
    seen.add(item.id);
    next.push(item);
  }
  return next;
}

function reassignHistoryPageState(
  pages: Record<string, SessionHistoryPageState>,
  fromSessionId: string,
  toSessionId: string
): Record<string, SessionHistoryPageState> {
  if (!(fromSessionId in pages)) {
    return pages;
  }
  const next = { ...pages };
  next[toSessionId] = pages[fromSessionId]!;
  delete next[fromSessionId];
  return next;
}

function findHistoryOverlap(historyItems: ChatItem[], preservedItems: ChatItem[]): number {
  const maxOverlap = Math.min(historyItems.length, preservedItems.length);
  for (let size = maxOverlap; size > 0; size -= 1) {
    let matches = true;
    for (let index = 0; index < size; index += 1) {
      const historyItem = historyItems[historyItems.length - size + index];
      const preservedItem = preservedItems[index];
      if (!historyItem || !preservedItem || !sameRenderableMessage(historyItem, preservedItem)) {
        matches = false;
        break;
      }
    }
    if (matches) {
      return size;
    }
  }
  return 0;
}

function sameRenderableMessage(left: ChatItem, right: ChatItem): boolean {
  return left.role === right.role && left.text.trim() === right.text.trim();
}

function shouldPreserveAfterHistoryHydration(
  item: ChatItem,
  historyItems: ChatItem[],
  liveItems: ChatItem[]
): boolean {
  if (isOptimisticFeedbackItem(item)) {
    const clientMessageId =
      typeof item.meta?.clientMessageId === "string" ? item.meta.clientMessageId : null;
    const userItem = clientMessageId
      ? liveItems.find(
          (liveItem) =>
            liveItem.role === "user" && liveItem.clientMessageId === clientMessageId
        )
      : null;
    return !historyConfirmsUserTurn(userItem, historyItems);
  }
  if (item.status === "failed") {
    return true;
  }
  if (!isHistoryReplaceableRole(item.role)) {
    return true;
  }
  return !historyItems.some((historyItem) => sameRenderableMessage(historyItem, item));
}

function historyConfirmsUserTurn(
  userItem: ChatItem | null | undefined,
  historyItems: ChatItem[]
): boolean {
  if (!userItem) {
    return false;
  }
  const userIndex = historyItems.findIndex((historyItem) =>
    sameRenderableMessage(historyItem, userItem)
  );
  if (userIndex < 0) {
    return false;
  }
  return historyItems
    .slice(userIndex + 1)
    .some(
      (historyItem) =>
        historyItem.role === "assistant" && historyItem.text.trim().length > 0
    );
}

function isHistoryReplaceableRole(role: ChatItem["role"]): boolean {
  return role === "user" || role === "assistant" || role === "command";
}

function appendStreamingItemToWorkspace(
  workspace: DeviceWorkspace,
  role: "assistant" | "command",
  sessionId: string | undefined,
  threadId: string | undefined,
  turnId: string | undefined,
  text: string,
  fallbackId: string,
  latestSeq: number | null
): DeviceWorkspace {
  if (!text) {
    return workspace;
  }
  let next = removeThinkingForTurn(workspace, sessionId, threadId, turnId);
  const key =
    findConversationKeyForTurn(next, sessionId, threadId, turnId) ??
    conversationKeyFor({ sessionId, threadId });
  next = ensureConversation(next, {
    conversationKey: key,
    sessionId,
    threadId
  });
  const canonicalKey = canonicalConversationKey(next, key);
  next = updateConversationItems(next, canonicalKey, (items) => {
    const lastIndex = [...items]
      .reverse()
      .findIndex(
        (item) =>
          item.role === role &&
          item.turnId === turnId &&
          item.sessionId === sessionId &&
          item.status !== "failed"
      );
    if (lastIndex >= 0) {
      const index = items.length - 1 - lastIndex;
      return items.map((item, itemIndex) =>
        itemIndex === index
          ? {
              ...item,
              text: `${item.text}${text}`,
              status: "streaming"
            }
          : item
      );
    }
    return [
      ...items,
      {
        id: fallbackId,
        role,
        text,
        ...(sessionId ? { sessionId } : {}),
        ...(turnId ? { turnId } : {}),
        status: "streaming",
        createdAt: Date.now()
      }
    ];
  });
  next = {
    ...next,
    outbox: updateOutboxStatusByTurn(next.outbox, turnId, "streaming")
  };
  return setConversationLatestSeq(next, canonicalKey, latestSeq);
}

function removeThinkingForTurn(
  workspace: DeviceWorkspace,
  sessionId: string | undefined,
  threadId: string | undefined,
  turnId: string | undefined
): DeviceWorkspace {
  const key = findConversationKeyForTurn(workspace, sessionId, threadId, turnId);
  if (key) {
    return updateConversationItems(workspace, key, (items) =>
      items.filter(
        (item) =>
          !(
            isOptimisticThinkingItem(item) &&
            feedbackMatchesTurn(item, sessionId, turnId)
          )
      )
    );
  }
  return materializeWorkspace({
    ...workspace,
    conversations: Object.fromEntries(
      Object.entries(workspace.conversations).map(([conversationKey, conversation]) => [
        conversationKey,
        {
          ...conversation,
          items: conversation.items.filter(
            (item) =>
              !(
                isOptimisticThinkingItem(item) &&
                feedbackMatchesTurn(item, sessionId, turnId)
              )
          )
        }
      ])
    )
  });
}

function isOptimisticFeedbackItem(
  item: ChatItem,
  clientMessageId?: string
): boolean {
  const kind = item.meta?.kind;
  const itemClientMessageId = item.meta?.clientMessageId;
  const feedback = item.role === "system" && (kind === "thinking" || kind === "error");
  if (!feedback) {
    return false;
  }
  return clientMessageId === undefined || itemClientMessageId === clientMessageId;
}

function isOptimisticThinkingItem(item: ChatItem): boolean {
  return item.role === "system" && item.meta?.kind === "thinking";
}

function feedbackMatchesTurn(
  item: ChatItem,
  sessionId: string | undefined,
  turnId: string | undefined
): boolean {
  if (turnId && item.turnId === turnId) {
    return true;
  }
  if (sessionId && item.sessionId === sessionId && !item.turnId) {
    return true;
  }
  return !sessionId && !item.sessionId && Boolean(turnId);
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

function readClientMessageId(payload: unknown): string | null {
  if (!isRecord(payload) || typeof payload.clientMessageId !== "string") {
    return null;
  }
  return payload.clientMessageId;
}

function readResumedFrom(payload: unknown): string | null {
  if (!isRecord(payload) || typeof payload.resumedFrom !== "string") {
    return null;
  }
  return payload.resumedFrom;
}

function readErrorMessage(payload: unknown): string {
  if (!isRecord(payload) || typeof payload.message !== "string") {
    return "Agent error";
  }
  return payload.message;
}

function isRenderableHistoryRole(
  role: LocalCodexHistoryDetailResponse["messages"][number]["role"]
): boolean {
  return role !== "system";
}
