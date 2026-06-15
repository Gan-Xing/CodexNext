import type { AgentConnection } from "../../lib/api";
import type { CodexThreadItem, CodexThreadTurn } from "@codexnext/protocol";
import {
  CodexNotificationMethod,
  CodexThreadItemType,
  codexThreadItemRenderKind
} from "@codexnext/protocol";
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
  turnOrder: string[];
  turns: Record<string, NormalizedConversationTurn>;
  updatedAt: number;
}

export interface ConversationCacheEntry {
  conversationKey: ConversationKey;
  items: ChatItem[];
  latestSeq: number | null;
  sessionIds: string[];
  threadId: string | null;
  turnOrder?: string[] | undefined;
  turns?: Record<string, NormalizedConversationTurn> | undefined;
  updatedAt: number;
}

export interface NormalizedConversationTurn {
  completedAt: number | null;
  durationMs: number | null;
  error: unknown | null;
  id: string;
  itemOrder: string[];
  items: Record<string, NormalizedConversationTurnItem>;
  itemsView: "notLoaded" | "summary" | "full";
  latestSeq: number | null;
  startedAt: number | null;
  status: "completed" | "interrupted" | "failed" | "inProgress";
}

export interface NormalizedConversationTurnItem {
  aggregatedOutput?: string | null | undefined;
  changes?: unknown[] | undefined;
  clientMessageId?: string | undefined;
  completedAtMs?: number | undefined;
  content?: unknown;
  createdAt?: number | undefined;
  error?: string | undefined;
  id: string;
  kind: "user" | "assistant" | "process" | "metadata";
  metaKind?: "thinking" | "error" | "legacy" | undefined;
  role: ChatItem["role"] | null;
  startedAtMs?: number | undefined;
  status?: unknown;
  text: string;
  type: string;
  updatedAt: number;
}

export type TurnGroupStatus = "pending" | "sent" | "streaming" | "complete" | "failed";
export type TurnGroupItemKind = "user" | "process" | "answer" | "metadata";

export interface TurnGroupItem {
  chatItem: ChatItem | null;
  clientMessageId?: string | undefined;
  id: string;
  kind: TurnGroupItemKind;
  role: ChatItem["role"] | null;
  status: ChatItem["status"];
  text: string;
  type: string;
}

export interface TurnGroup {
  answerItems: TurnGroupItem[];
  completedAt: number | null;
  durationMs: number | null;
  error: unknown | null;
  id: string;
  items: TurnGroupItem[];
  metadataItems: TurnGroupItem[];
  processItems: TurnGroupItem[];
  startedAt: number | null;
  status: TurnGroupStatus;
  userItems: TurnGroupItem[];
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
const LOCAL_THREAD_ITEM_TYPE = {
  Thinking: "local.thinking",
  Error: "local.error"
} as const;
const CHAT_ITEM_STATUSES = new Set<ChatItem["status"]>([
  "pending",
  "sending",
  "sent",
  "failed",
  "streaming",
  "complete"
]);

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

export function selectConversationTurnGroups(
  workspace: DeviceWorkspace | null,
  input: {
    pendingClientId?: string | undefined;
    sessionId?: string | undefined;
    threadId?: string | undefined;
  } | null
): TurnGroup[] {
  if (!workspace || !input) {
    return [];
  }
  const key = findConversationKey(workspace, input);
  if (!key) {
    return [];
  }
  const canonicalKey = canonicalConversationKey(workspace, key);
  const conversation = workspace.conversations[canonicalKey];
  if (!conversation) {
    return [];
  }
  return projectConversationToTurnGroups(conversation, {
    sessionId: input.sessionId,
    threadId: input.threadId ?? conversation.threadId
  });
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
    next = setOutboxEntry(next, entry);
    next = upsertLocalTurnItems(next, {
      key: conversationKey,
      sessionId: entry.sessionId,
      threadId: entry.threadId,
      turnId: entry.turnId ?? pendingTurnIdForClientMessage(entry.clientMessageId),
      items: [
        localUserTurnItem({
          clientMessageId: entry.clientMessageId,
          text: entry.text,
          status: entry.status === "pending" ? "pending" : entry.status,
          ...(entry.error ? { error: entry.error } : {}),
          createdAt: entry.createdAt
        }),
        entry.status === "failed"
          ? localErrorTurnItem({
              clientMessageId: entry.clientMessageId,
              text: entry.error ?? "消息发送失败",
              createdAt: entry.createdAt
            })
          : localThinkingTurnItem({
              clientMessageId: entry.clientMessageId,
              createdAt: entry.createdAt
            })
      ],
      turnStatus: entry.status === "failed" ? "failed" : "inProgress"
    });
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
    if (entry.turns && entry.turnOrder) {
      next = upsertNormalizedTurns(next, finalKey, {
        turnOrder: entry.turnOrder,
        turns: entry.turns
      }, { latestSeq: entry.latestSeq });
    }
  }
  return materializeWorkspace(next);
}

export function buildConversationCacheEntries(
  workspace: DeviceWorkspace
): ConversationCacheEntry[] {
  const entries: ConversationCacheEntry[] = [];
  for (const conversation of Object.values(workspace.conversations)) {
    const items = conversation.items
      .filter(shouldPersistChatItem)
      .slice(-CONVERSATION_CACHE_MESSAGE_LIMIT);
    if (items.length === 0) {
      continue;
    }
    entries.push({
      conversationKey: conversation.key,
      items,
      latestSeq: conversation.latestSeq,
      sessionIds: conversation.sessionIds,
      threadId: conversation.threadId,
      turnOrder: conversation.turnOrder,
      turns: conversation.turns,
      updatedAt: conversation.updatedAt
    });
  }
  return entries
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
          turnOrder: [],
          turns: {},
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
    turnOrder: mergeTurnOrder(preferred.turnOrder, alias.turnOrder),
    turns: mergeNormalizedTurns(preferred.turns, alias.turns),
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
    turnOrder: [],
    turns: {},
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

interface NormalizedTurnCollection {
  turnOrder: string[];
  turns: Record<string, NormalizedConversationTurn>;
}

function upsertNormalizedTurns(
  workspace: DeviceWorkspace,
  key: ConversationKey,
  incoming: NormalizedTurnCollection,
  options: {
    latestSeq?: number | null;
    order?: "existing-first" | "incoming-first";
  } = {}
): DeviceWorkspace {
  const canonicalKey = canonicalConversationKey(workspace, key);
  const conversation = workspace.conversations[canonicalKey] ?? emptyConversation(canonicalKey);
  const turns = mergeNormalizedTurns(conversation.turns, incoming.turns);
  const turnOrder =
    options.order === "incoming-first"
      ? mergeTurnOrder(incoming.turnOrder, conversation.turnOrder)
      : mergeTurnOrder(conversation.turnOrder, incoming.turnOrder);
  return materializeWorkspace({
    ...workspace,
    conversations: {
      ...workspace.conversations,
      [canonicalKey]: {
        ...conversation,
        latestSeq:
          options.latestSeq !== undefined
            ? Math.max(conversation.latestSeq ?? 0, options.latestSeq ?? 0) || null
            : conversation.latestSeq,
        turnOrder,
        turns,
        updatedAt: Date.now()
      }
    }
  });
}

function normalizeCodexTurns(
  turns: CodexThreadTurn[],
  input: { latestSeq: number | null; source: "history" | "live" }
): NormalizedTurnCollection {
  const normalizedTurns = turns.map((turn) =>
    normalizeCodexTurn(turn, {
      latestSeq: input.latestSeq,
      source: input.source
    })
  );
  return {
    turnOrder: normalizedTurns.map((turn) => turn.id),
    turns: Object.fromEntries(normalizedTurns.map((turn) => [turn.id, turn]))
  };
}

function normalizeCodexTurn(
  turn: CodexThreadTurn,
  input: { latestSeq: number | null; source: "history" | "live" }
): NormalizedConversationTurn {
  const items = turn.items.map((item) =>
    normalizeCodexThreadItem(item, {
      defaultStatus: turn.status,
      latestSeq: input.latestSeq,
      source: input.source,
      turnStartedAt: turn.startedAt
    })
  );
  return {
    id: turn.id,
    itemOrder: items.map((item) => item.id),
    items: Object.fromEntries(items.map((item) => [item.id, item])),
    itemsView: turn.itemsView,
    status: turn.status,
    error: turn.error,
    startedAt: turn.startedAt,
    completedAt: turn.completedAt,
    durationMs: turn.durationMs,
    latestSeq: input.latestSeq
  };
}

function normalizeCodexThreadItem(
  item: CodexThreadItem,
  input: {
    defaultStatus: NormalizedConversationTurn["status"];
    latestSeq: number | null;
    source: "history" | "live";
    turnStartedAt: number | null;
  }
): NormalizedConversationTurnItem {
  const kind = codexThreadItemRenderKind(item);
  const role = codexThreadItemRole(item);
  return {
    id: item.id,
    type: item.type,
    kind,
    role,
    text: codexThreadItemText(item),
    ...(typeof item.clientId === "string" ? { clientMessageId: item.clientId } : {}),
    content: item.content,
    ...(typeof item.aggregatedOutput === "string" || item.aggregatedOutput === null
      ? { aggregatedOutput: item.aggregatedOutput }
      : {}),
    ...(Array.isArray(item.changes) ? { changes: item.changes } : {}),
    status: item.status ?? input.defaultStatus,
    createdAt: timestampSecondsToMs(input.turnStartedAt),
    updatedAt: Date.now()
  };
}

function mergeTurnOrder(left: string[], right: string[]): string[] {
  return [...new Set([...left, ...right])];
}

function mergeNormalizedTurns(
  existing: Record<string, NormalizedConversationTurn>,
  incoming: Record<string, NormalizedConversationTurn>
): Record<string, NormalizedConversationTurn> {
  const next = { ...existing };
  for (const [turnId, incomingTurn] of Object.entries(incoming)) {
    const current = next[turnId];
    next[turnId] = current ? mergeNormalizedTurn(current, incomingTurn) : incomingTurn;
  }
  return next;
}

function mergeNormalizedTurn(
  current: NormalizedConversationTurn,
  incoming: NormalizedConversationTurn
): NormalizedConversationTurn {
  const incomingIsHistory = incoming.latestSeq === null;
  const currentHasLiveEvents = current.latestSeq !== null;
  const preferExistingText = incomingIsHistory && currentHasLiveEvents;
  const status =
    current.status === "completed" || incoming.status === "completed"
      ? "completed"
      : preferExistingText
        ? current.status
        : incoming.status;
  return {
    ...current,
    ...incoming,
    ...mergeNormalizedTurnItemsWithOrder(current, incoming, {
      preferExistingText
    }),
    status,
    startedAt: incoming.startedAt ?? current.startedAt,
    completedAt: incoming.completedAt ?? current.completedAt,
    durationMs: incoming.durationMs ?? current.durationMs,
    error: incoming.error ?? current.error,
    latestSeq: Math.max(current.latestSeq ?? 0, incoming.latestSeq ?? 0) || null
  };
}

function mergeNormalizedTurnItems(
  existing: Record<string, NormalizedConversationTurnItem>,
  incoming: Record<string, NormalizedConversationTurnItem>,
  options: { preferExistingText?: boolean } = {}
): Record<string, NormalizedConversationTurnItem> {
  return mergeNormalizedTurnItemsWithOrder(
    {
      itemOrder: Object.keys(existing),
      items: existing
    },
    {
      itemOrder: Object.keys(incoming),
      items: incoming
    },
    options
  ).items;
}

function mergeNormalizedTurnItemsWithOrder(
  current: Pick<NormalizedConversationTurn, "itemOrder" | "items">,
  incoming: Pick<NormalizedConversationTurn, "itemOrder" | "items">,
  options: { preferExistingText?: boolean } = {}
): Pick<NormalizedConversationTurn, "itemOrder" | "items"> {
  const next = { ...current.items };
  let itemOrder = [...current.itemOrder];
  for (const [itemId, incomingItem] of Object.entries(incoming.items)) {
    const semanticId = findSemanticTurnItemId(next, itemOrder, incomingItem);
    const targetId = semanticId ?? itemId;
    const currentItem = next[targetId];
    const mergedItem = currentItem
      ? mergeNormalizedTurnItem(currentItem, incomingItem, targetId, options)
      : { ...incomingItem, id: targetId };
    if (semanticId && semanticId !== itemId) {
      delete next[semanticId];
      itemOrder = itemOrder.map((id) => (id === semanticId ? itemId : id));
      next[itemId] = {
        ...mergedItem,
        id: itemId
      };
      continue;
    }
    next[targetId] = mergedItem;
    itemOrder = mergeTurnOrder(itemOrder, [targetId]);
  }
  return {
    itemOrder,
    items: next
  };
}

function mergeNormalizedTurnItem(
  current: NormalizedConversationTurnItem,
  incoming: NormalizedConversationTurnItem,
  id: string,
  options: { preferExistingText?: boolean } = {}
): NormalizedConversationTurnItem {
  return {
    ...current,
    ...incoming,
    id,
    text: mergeNormalizedItemText(current.text, incoming.text, options),
    aggregatedOutput:
      incoming.aggregatedOutput !== undefined
        ? mergeNormalizedItemText(
            current.aggregatedOutput ?? "",
            incoming.aggregatedOutput ?? "",
            options
          )
        : current.aggregatedOutput,
    updatedAt: Date.now()
  };
}

function findSemanticTurnItemId(
  items: Record<string, NormalizedConversationTurnItem>,
  itemOrder: string[],
  incoming: NormalizedConversationTurnItem
): string | null {
  const incomingKey = semanticTurnItemKey(incoming);
  if (!incomingKey) {
    return null;
  }
  return itemOrder.find((itemId) => semanticTurnItemKey(items[itemId]) === incomingKey) ?? null;
}

function semanticTurnItemKey(
  item: NormalizedConversationTurnItem | undefined
): string | null {
  if (!item?.clientMessageId || !item.role) {
    return null;
  }
  return `${item.role}:${item.clientMessageId}`;
}

function mergeNormalizedItemText(
  current: string,
  incoming: string,
  options: { preferExistingText?: boolean } = {}
): string {
  if (!incoming) {
    return current;
  }
  if (!current) {
    return incoming;
  }
  if (options.preferExistingText && current.length > incoming.length) {
    return current;
  }
  return incoming;
}

function projectNormalizedTurnsToChatItems(
  collection: NormalizedTurnCollection,
  input: { sessionId?: string | undefined; threadId?: string | null | undefined }
): ChatItem[] {
  return collection.turnOrder
    .map((turnId) => collection.turns[turnId])
    .filter((turn): turn is NormalizedConversationTurn => Boolean(turn))
    .flatMap((turn) =>
      turn.itemOrder
        .map((itemId) => turn.items[itemId])
        .filter((item): item is NormalizedConversationTurnItem => Boolean(item))
        .filter((item) => shouldProjectTurnItem(turn, item))
        .map((item) => normalizedTurnItemToChatItem(turn, item, input.sessionId))
        .filter((item): item is ChatItem => Boolean(item))
    );
}

function projectConversationToTurnGroups(
  conversation: Pick<ConversationRecord, "threadId" | "turnOrder" | "turns">,
  input: { sessionId?: string | undefined; threadId?: string | null | undefined }
): TurnGroup[] {
  return conversation.turnOrder
    .map((turnId) => conversation.turns[turnId])
    .filter((turn): turn is NormalizedConversationTurn => Boolean(turn))
    .map((turn) => projectTurnToTurnGroup(turn, input));
}

function projectTurnToTurnGroup(
  turn: NormalizedConversationTurn,
  input: { sessionId?: string | undefined; threadId?: string | null | undefined }
): TurnGroup {
  const items = turn.itemOrder
    .map((itemId) => turn.items[itemId])
    .filter((item): item is NormalizedConversationTurnItem => Boolean(item))
    .map((item) => normalizedTurnItemToTurnGroupItem(turn, item, input.sessionId));
  return {
    id: turn.id,
    status: turnGroupStatus(turn, items),
    startedAt: timestampSecondsToMs(turn.startedAt) ?? null,
    completedAt: timestampSecondsToMs(turn.completedAt) ?? null,
    durationMs: turn.durationMs,
    error: turn.error,
    items,
    userItems: items.filter((item) => item.kind === "user"),
    processItems: items.filter((item) => item.kind === "process"),
    answerItems: items.filter((item) => item.kind === "answer"),
    metadataItems: items.filter((item) => item.kind === "metadata")
  };
}

function normalizedTurnItemToTurnGroupItem(
  turn: NormalizedConversationTurn,
  item: NormalizedConversationTurnItem,
  sessionId: string | undefined
): TurnGroupItem {
  return {
    id: item.id,
    type: item.type,
    kind: turnGroupItemKind(item),
    role: item.role,
    text: item.text,
    ...(item.clientMessageId ? { clientMessageId: item.clientMessageId } : {}),
    status: chatStatusForTurnItem(turn, item),
    chatItem: shouldProjectTurnItem(turn, item)
      ? normalizedTurnItemToChatItem(turn, item, sessionId)
      : null
  };
}

function turnGroupItemKind(item: NormalizedConversationTurnItem): TurnGroupItemKind {
  if (item.kind === "user") {
    return "user";
  }
  if (item.kind === "assistant") {
    return "answer";
  }
  if (item.kind === "process") {
    return "process";
  }
  return "metadata";
}

function turnGroupStatus(
  turn: NormalizedConversationTurn,
  items: TurnGroupItem[]
): TurnGroupStatus {
  if (turn.status === "failed" || items.some((item) => item.status === "failed")) {
    return "failed";
  }
  if (turn.status === "completed") {
    return "complete";
  }
  if (items.some((item) => item.status === "streaming")) {
    return "streaming";
  }
  if (items.some((item) => item.status === "sent")) {
    return "sent";
  }
  return "pending";
}

function normalizedTurnItemToChatItem(
  turn: NormalizedConversationTurn,
  item: NormalizedConversationTurnItem,
  sessionId: string | undefined
): ChatItem | null {
  if (!item.role || item.text.trim().length === 0) {
    return null;
  }
  const status = chatStatusForTurnItem(turn, item);
  return {
    id: `turn-${turn.id}-${item.id}`,
    role: item.role,
    text: item.text,
    ...(sessionId ? { sessionId } : {}),
    turnId: turn.id,
    ...(item.clientMessageId ? { clientMessageId: item.clientMessageId } : {}),
    status,
    ...(item.error ? { error: item.error } : {}),
    createdAt:
      item.createdAt ??
      timestampSecondsToMs(turn.startedAt) ??
      timestampSecondsToMs(turn.completedAt) ??
      Date.now(),
    meta: {
      appServerItemId: item.id,
      appServerItemType: item.type,
      source: "turn-store",
      ...(item.clientMessageId ? { clientMessageId: item.clientMessageId } : {}),
      ...(item.metaKind ? { kind: item.metaKind } : {})
    }
  };
}

function shouldProjectTurnItem(
  turn: NormalizedConversationTurn,
  item: NormalizedConversationTurnItem
): boolean {
  if (item.metaKind !== "thinking") {
    return true;
  }
  return !turnHasRenderableResponse(turn);
}

function turnHasRenderableResponse(turn: NormalizedConversationTurn): boolean {
  return turn.itemOrder.some((itemId) => {
    const item = turn.items[itemId];
    return Boolean(
      item &&
        (item.role === "assistant" || item.role === "command" || item.role === "diff") &&
        item.text.trim().length > 0 &&
        item.metaKind !== "error"
    );
  });
}

function chatStatusForTurnItem(
  turn: NormalizedConversationTurn,
  item: NormalizedConversationTurnItem
): ChatItem["status"] {
  const itemStatus = normalizeChatStatus(item.status);
  if (itemStatus) {
    return itemStatus;
  }
  if (turn.status === "completed") {
    return "complete";
  }
  if (turn.status === "failed") {
    return "failed";
  }
  return "streaming";
}

function normalizeChatStatus(value: unknown): ChatItem["status"] | null {
  return typeof value === "string" && CHAT_ITEM_STATUSES.has(value as ChatItem["status"])
    ? (value as ChatItem["status"])
    : null;
}

function codexThreadItemRole(item: CodexThreadItem): ChatItem["role"] | null {
  switch (item.type) {
    case CodexThreadItemType.UserMessage:
      return "user";
    case CodexThreadItemType.AgentMessage:
      return "assistant";
    case CodexThreadItemType.CommandExecution:
      return "command";
    case CodexThreadItemType.FileChange:
      return "diff";
    default:
      return null;
  }
}

function codexThreadItemText(item: CodexThreadItem): string {
  switch (item.type) {
    case CodexThreadItemType.UserMessage:
      return userInputText(item.content);
    case CodexThreadItemType.AgentMessage:
      return typeof item.text === "string" ? item.text : "";
    case CodexThreadItemType.CommandExecution:
      return commandExecutionText(item);
    case CodexThreadItemType.FileChange:
      return fileChangeText(item);
    default:
      return typeof item.text === "string" ? item.text : "";
  }
}

function userInputText(content: unknown): string {
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((part) =>
      isRecord(part) && part.type === "text" && typeof part.text === "string"
        ? part.text
        : ""
    )
    .filter(Boolean)
    .join("\n");
}

function commandExecutionText(item: CodexThreadItem): string {
  const command = typeof item.command === "string" ? item.command.trim() : "";
  const output =
    typeof item.aggregatedOutput === "string"
      ? stripAnsi(item.aggregatedOutput).trim()
      : "";
  return [command ? `$ ${command}` : "", output].filter(Boolean).join("\n");
}

function fileChangeText(item: CodexThreadItem): string {
  if (typeof item.text === "string") {
    return item.text;
  }
  if (Array.isArray(item.changes) && item.changes.length > 0) {
    return JSON.stringify(item.changes, null, 2);
  }
  return "";
}

function timestampSecondsToMs(value: number | null | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return value > 10_000_000_000 ? value : value * 1000;
}

function historyMessagesToSyntheticTurns(
  _sessionId: string,
  messages: LocalCodexHistoryMessage[]
): CodexThreadTurn[] {
  return messages.map((message, index) => {
    const tsMs = Date.parse(message.ts);
    const ts = Number.isFinite(tsMs) ? tsMs / 1000 : null;
    return {
      id: `synthetic-${message.id || index}`,
      items: [historyMessageToSyntheticThreadItem(message, index)],
      itemsView: "full",
      status: "completed",
      error: null,
      startedAt: ts,
      completedAt: ts,
      durationMs: null
    };
  });
}

function historyMessageToSyntheticThreadItem(
  message: LocalCodexHistoryMessage,
  index: number
): CodexThreadItem {
  const id = message.id || `message-${index}`;
  switch (message.role) {
    case "user":
      return {
        id,
        type: CodexThreadItemType.UserMessage,
        content: [{ type: "text", text: message.text, text_elements: [] }]
      };
    case "assistant":
      return {
        id,
        type: CodexThreadItemType.AgentMessage,
        text: message.text
      };
    case "command":
      return {
        id,
        type: CodexThreadItemType.CommandExecution,
        command: "",
        aggregatedOutput: message.text
      };
    case "diff":
      return {
        id,
        type: CodexThreadItemType.FileChange,
        text: message.text,
        changes: []
      };
    default:
      return {
        id,
        type: CodexThreadItemType.ContextCompaction
      };
  }
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
        (!isTurnStoreProjectedItem(item) &&
          !isTurnStoreProjectedItem(current) &&
          item.turnId !== undefined &&
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

function pendingTurnIdForClientMessage(clientMessageId: string): string {
  return `local-turn:${clientMessageId}`;
}

function localUserTurnItem(input: {
  clientMessageId: string;
  createdAt: number;
  error?: string | undefined;
  id?: string | undefined;
  status: ChatItem["status"];
  text: string;
}): NormalizedConversationTurnItem {
  return {
    id: input.id ?? `local-user:${input.clientMessageId}`,
    type: CodexThreadItemType.UserMessage,
    kind: "user",
    role: "user",
    text: input.text,
    clientMessageId: input.clientMessageId,
    status: input.status,
    ...(input.error ? { error: input.error } : {}),
    createdAt: input.createdAt,
    updatedAt: Date.now()
  };
}

function localThinkingTurnItem(input: {
  clientMessageId: string;
  createdAt: number;
}): NormalizedConversationTurnItem {
  return {
    id: `local-thinking:${input.clientMessageId}`,
    type: LOCAL_THREAD_ITEM_TYPE.Thinking,
    kind: "metadata",
    role: "system",
    text: THINKING_TEXT,
    clientMessageId: input.clientMessageId,
    metaKind: "thinking",
    status: "streaming",
    createdAt: input.createdAt,
    updatedAt: Date.now()
  };
}

function localErrorTurnItem(input: {
  clientMessageId?: string | undefined;
  createdAt: number;
  id?: string | undefined;
  text: string;
}): NormalizedConversationTurnItem {
  const id = input.id ?? `local-error:${input.clientMessageId ?? input.createdAt}`;
  return {
    id,
    type: LOCAL_THREAD_ITEM_TYPE.Error,
    kind: "metadata",
    role: "system",
    text: input.text,
    ...(input.clientMessageId ? { clientMessageId: input.clientMessageId } : {}),
    metaKind: "error",
    status: "failed",
    error: input.text,
    createdAt: input.createdAt,
    updatedAt: Date.now()
  };
}

function upsertLocalTurnItems(
  workspace: DeviceWorkspace,
  input: {
    key: ConversationKey;
    items: NormalizedConversationTurnItem[];
    latestSeq?: number | null | undefined;
    sessionId?: string | undefined;
    threadId?: string | undefined;
    turnId: string;
    turnStatus: NormalizedConversationTurn["status"];
  }
): DeviceWorkspace {
  let next = ensureConversation(workspace, {
    conversationKey: input.key,
    sessionId: input.sessionId,
    threadId: input.threadId
  });
  const canonicalKey = canonicalConversationKey(next, input.key);
  const conversation = next.conversations[canonicalKey] ?? emptyConversation(canonicalKey);
  const currentTurn = conversation.turns[input.turnId] ?? emptyLocalTurn(input.turnId, input);
  const mergedItems = mergeNormalizedTurnItemsWithOrder(currentTurn, {
    itemOrder: input.items.map((item) => item.id),
    items: Object.fromEntries(input.items.map((item) => [item.id, item]))
  });
  const incomingTurn: NormalizedConversationTurn = {
    ...currentTurn,
    itemOrder: mergedItems.itemOrder,
    items: mergedItems.items,
    latestSeq:
      input.latestSeq !== undefined
        ? Math.max(currentTurn.latestSeq ?? 0, input.latestSeq ?? 0) || null
        : currentTurn.latestSeq,
    status: input.turnStatus
  };
  next = upsertNormalizedTurns(
    next,
    canonicalKey,
    {
      turnOrder: [input.turnId],
      turns: {
        [input.turnId]: incomingTurn
      }
    },
    input.latestSeq !== undefined ? { latestSeq: input.latestSeq } : {}
  );
  return syncConversationProjection(next, canonicalKey, {
    sessionId: input.sessionId,
    threadId: input.threadId
  });
}

function emptyLocalTurn(
  turnId: string,
  input: {
    latestSeq?: number | null | undefined;
    turnStatus: NormalizedConversationTurn["status"];
  }
): NormalizedConversationTurn {
  return {
    id: turnId,
    itemOrder: [],
    items: {},
    itemsView: "full",
    status: input.turnStatus,
    error: null,
    startedAt: Date.now() / 1000,
    completedAt: null,
    durationMs: null,
    latestSeq: input.latestSeq ?? null
  };
}

function remapPendingTurnToServerTurn(
  workspace: DeviceWorkspace,
  key: ConversationKey,
  clientMessageId: string,
  serverTurnId: string
): DeviceWorkspace {
  const pendingTurnId = pendingTurnIdForClientMessage(clientMessageId);
  if (pendingTurnId === serverTurnId) {
    return workspace;
  }
  const canonicalKey = canonicalConversationKey(workspace, key);
  const conversation = workspace.conversations[canonicalKey];
  const pendingTurn = conversation?.turns[pendingTurnId];
  if (!conversation || !pendingTurn) {
    return workspace;
  }
  const currentServerTurn = conversation.turns[serverTurnId] ?? {
    ...pendingTurn,
    id: serverTurnId,
    itemOrder: [],
    items: {}
  };
  const mergedServerTurn = mergeNormalizedTurn(currentServerTurn, {
    ...pendingTurn,
    id: serverTurnId
  });
  const turns = { ...conversation.turns };
  delete turns[pendingTurnId];
  turns[serverTurnId] = mergedServerTurn;
  const turnOrder = conversation.turnOrder.map((turnId) =>
    turnId === pendingTurnId ? serverTurnId : turnId
  );
  return materializeWorkspace({
    ...workspace,
    conversations: {
      ...workspace.conversations,
      [canonicalKey]: {
        ...conversation,
        turnOrder: [...new Set(turnOrder)],
        turns,
        updatedAt: Date.now()
      }
    }
  });
}

function findTurnItemByClientMessageId(
  turn: NormalizedConversationTurn | undefined,
  clientMessageId: string,
  role: ChatItem["role"]
): NormalizedConversationTurnItem | null {
  return (
    turn?.itemOrder
      .map((itemId) => turn.items[itemId])
      .find((item) => item?.clientMessageId === clientMessageId && item.role === role) ??
    null
  );
}

function readTurnItemText(
  workspace: DeviceWorkspace,
  key: ConversationKey,
  turnId: string,
  itemId: string
): string {
  const canonicalKey = canonicalConversationKey(workspace, key);
  return workspace.conversations[canonicalKey]?.turns[turnId]?.items[itemId]?.text ?? "";
}

export interface OptimisticUserMessageInput {
  clientMessageId: string;
  sessionId: string;
  text: string;
  turnId?: string;
}

export function addOptimisticUserMessage(
  workspace: DeviceWorkspace,
  input: OptimisticUserMessageInput
): DeviceWorkspace {
  const createdAt = Date.now();
  const turnId = input.turnId ?? pendingTurnIdForClientMessage(input.clientMessageId);
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
  return upsertLocalTurnItems(next, {
    key,
    sessionId: input.sessionId,
    turnId,
    items: [
      localUserTurnItem({
        clientMessageId: input.clientMessageId,
        text: input.text,
        status: "pending",
        createdAt
      }),
      localThinkingTurnItem({
        clientMessageId: input.clientMessageId,
        createdAt
      })
    ],
    turnStatus: "inProgress"
  });
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
  if (input?.turnId) {
    next = remapPendingTurnToServerTurn(next, finalKey, clientMessageId, input.turnId);
  }
  const turnId = input?.turnId ?? outboxEntry?.turnId ?? pendingTurnIdForClientMessage(clientMessageId);
  const conversation = next.conversations[canonicalConversationKey(next, finalKey)];
  const existingUser = findTurnItemByClientMessageId(
    conversation?.turns[turnId],
    clientMessageId,
    "user"
  );
  next = upsertLocalTurnItems(next, {
    key: finalKey,
    sessionId: input?.sessionId ?? outboxEntry?.sessionId,
    threadId: input?.threadId ?? outboxEntry?.threadId,
    turnId,
    items: [
      localUserTurnItem({
        id: input?.eventId ?? existingUser?.id,
        clientMessageId,
        text: existingUser?.text ?? outboxEntry?.text ?? "",
        status: "sent",
        createdAt: existingUser?.createdAt ?? outboxEntry?.createdAt ?? Date.now()
      }),
      localThinkingTurnItem({
        clientMessageId,
        createdAt: outboxEntry?.createdAt ?? Date.now()
      })
    ],
    turnStatus: "inProgress"
  });
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
  const outboxEntry = workspace.outbox[clientMessageId];
  const turnId = outboxEntry?.turnId ?? pendingTurnIdForClientMessage(clientMessageId);
  const conversation = workspace.conversations[canonicalConversationKey(workspace, key)];
  const existingUser = findTurnItemByClientMessageId(
    conversation?.turns[turnId],
    clientMessageId,
    "user"
  );
  let next = upsertLocalTurnItems(workspace, {
    key,
    sessionId: outboxEntry?.sessionId,
    threadId: outboxEntry?.threadId,
    turnId,
    items: [
      localUserTurnItem({
        id: existingUser?.id,
        clientMessageId,
        text: existingUser?.text ?? outboxEntry?.text ?? "",
        status: "failed",
        error,
        createdAt: existingUser?.createdAt ?? outboxEntry?.createdAt ?? Date.now()
      }),
      localErrorTurnItem({
        clientMessageId,
        text: error,
        createdAt: Date.now()
      })
    ],
    turnStatus: "failed"
  });
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
  return hydrateSessionFromTurns(
    workspace,
    sessionId,
    historyMessagesToSyntheticTurns(sessionId, messages)
  );
}

export function hydrateSessionFromTurns(
  workspace: DeviceWorkspace,
  sessionId: string,
  turns: CodexThreadTurn[]
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
  const normalizedTurns = normalizeCodexTurns(turns, {
    latestSeq: null,
    source: "history"
  });
  const incomingHistoryItems = projectNormalizedTurnsToChatItems(
    normalizedTurns,
    { sessionId, threadId }
  );
  const conversationItems =
    next.conversations[canonicalKey]?.items ??
    workspace.chatItems.filter((item) => item.sessionId === sessionId);
  next = upsertNormalizedTurns(next, canonicalKey, normalizedTurns, {
    order: "incoming-first"
  });
  next = removeHistoryConfirmedLocalTurns(next, canonicalKey, incomingHistoryItems);
  const mergedConversation = next.conversations[canonicalKey] ?? emptyConversation(canonicalKey);
  const projectedItems = projectNormalizedTurnsToChatItems(mergedConversation, {
    sessionId,
    threadId
  });
  const preservedSessionItems = conversationItems
    .filter((item) => item.sessionId === sessionId)
    .filter((item) =>
      shouldPreserveAfterProjection(item, projectedItems, incomingHistoryItems, conversationItems)
    );
  const overlap = findHistoryOverlap(projectedItems, preservedSessionItems);
  next = updateConversationItems(next, canonicalKey, () =>
    [
      ...projectedItems,
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
  return prependSessionHistoryTurns(
    workspace,
    sessionId,
    historyMessagesToSyntheticTurns(sessionId, messages)
  );
}

export function prependSessionHistoryTurns(
  workspace: DeviceWorkspace,
  sessionId: string,
  turns: CodexThreadTurn[]
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
  const normalizedTurns = normalizeCodexTurns(turns, {
    latestSeq: null,
    source: "history"
  });
  const incomingHistoryItems = projectNormalizedTurnsToChatItems(
    normalizedTurns,
    { sessionId, threadId }
  );
  const sessionItems =
    next.conversations[canonicalKey]?.items ??
    workspace.chatItems.filter((item) => item.sessionId === sessionId);

  next = upsertNormalizedTurns(next, canonicalKey, normalizedTurns, {
    order: "incoming-first"
  });
  next = removeHistoryConfirmedLocalTurns(next, canonicalKey, incomingHistoryItems);
  const mergedConversation = next.conversations[canonicalKey] ?? emptyConversation(canonicalKey);
  const projectedItems = projectNormalizedTurnsToChatItems(mergedConversation, {
    sessionId,
    threadId
  });
  const preservedSessionItems = sessionItems.filter((item) =>
    shouldPreserveAfterProjection(item, projectedItems, incomingHistoryItems, sessionItems)
  );
  const overlap = findHistoryOverlap(projectedItems, preservedSessionItems);
  next = updateConversationItems(next, canonicalKey, () =>
    [
      ...projectedItems,
      ...preservedSessionItems.slice(overlap)
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
    case "codex.notification":
      return applyCodexNotificationToWorkspace(workspace, event);
    case "app-server.item.started":
      return applyAppServerItemLifecycleEvent(workspace, event, "started");
    case "app-server.item.completed":
      return applyAppServerItemLifecycleEvent(workspace, event, "completed");
    case "app-server.reasoning.delta":
      return applyAppServerReasoningDelta(workspace, event);
    case "chat.user":
      return applyServerChatUser(workspace, event);
    case "chat.assistant.delta":
      if (hasTurnStoreRenderableText(workspace, event.sessionId, event.threadId, event.turnId, "assistant")) {
        return setConversationLatestSeqForEvent(workspace, event);
      }
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
      if (hasTurnStoreRenderableText(workspace, event.sessionId, event.threadId, event.turnId, "command")) {
        return setConversationLatestSeqForEvent(workspace, event);
      }
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
      return upsertEventScopedTurnItem(workspace, event, {
        id: event.id,
        type: CodexThreadItemType.FileChange,
        role: "diff",
        text: readDiff(event.payload),
        status: "streaming",
        latestSeq: event.seq
      });
    case "plan.updated":
      return workspace;
    case "turn.completed":
      return applyTurnCompletedEvent(workspace, event);
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
  const turnId = event.turnId ?? `event-turn:${event.id}`;
  return upsertEventScopedTurnItem(workspace, { ...event, turnId }, {
    id: event.id,
    type: CodexThreadItemType.UserMessage,
    role: "user",
    text,
    ...(clientMessageId ? { clientMessageId } : {}),
    status: "sent",
    latestSeq: event.seq
  });
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
  const turnId = event.turnId ?? `event-turn:${event.id}`;
  return upsertLocalTurnItems(workspace, {
    key:
      findConversationKeyForTurn(workspace, event.sessionId, event.threadId, turnId) ??
      conversationKeyFor({ sessionId: event.sessionId, threadId: event.threadId }),
    sessionId: event.sessionId,
    threadId: event.threadId,
    turnId,
    items: [
      localErrorTurnItem({
        id: event.id,
        text: message,
        createdAt: event.ts
      })
    ],
    latestSeq: event.seq,
    turnStatus: "failed"
  });
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

function applyCodexNotificationToWorkspace(
  workspace: DeviceWorkspace,
  event: LocalEvent
): DeviceWorkspace {
  const notification = isRecord(event.payload) ? event.payload : null;
  const method = typeof notification?.method === "string" ? notification.method : null;
  const params = isRecord(notification?.params) ? notification.params : null;
  if (!method || !params) {
    return workspace;
  }

  switch (method) {
    case CodexNotificationMethod.ItemStarted:
      return applyAppServerItemLifecycleParams(workspace, event, params, "started");
    case CodexNotificationMethod.ItemCompleted:
      return applyAppServerItemLifecycleParams(workspace, event, params, "completed");
    case CodexNotificationMethod.AgentMessageDelta:
      return applyAppServerItemDelta(workspace, event, params, {
        type: CodexThreadItemType.AgentMessage,
        target: "text"
      });
    case CodexNotificationMethod.CommandExecutionOutputDelta:
      return applyAppServerItemDelta(workspace, event, params, {
        type: CodexThreadItemType.CommandExecution,
        target: "aggregatedOutput"
      });
    case CodexNotificationMethod.FileChangeOutputDelta:
      return applyAppServerItemDelta(workspace, event, params, {
        type: CodexThreadItemType.FileChange,
        target: "text"
      });
    case CodexNotificationMethod.ReasoningSummaryTextDelta:
    case CodexNotificationMethod.ReasoningTextDelta:
      return applyAppServerReasoningDeltaParams(workspace, event, params);
    case CodexNotificationMethod.TurnCompleted:
      return applyTurnPayloadToTurnStore(workspace, event, params);
    default:
      return workspace;
  }
}

function applyAppServerItemLifecycleEvent(
  workspace: DeviceWorkspace,
  event: LocalEvent,
  phase: "started" | "completed"
): DeviceWorkspace {
  const params = isRecord(event.payload) ? event.payload : null;
  return params
    ? applyAppServerItemLifecycleParams(workspace, event, params, phase)
    : workspace;
}

function applyAppServerItemLifecycleParams(
  workspace: DeviceWorkspace,
  event: LocalEvent,
  params: Record<string, unknown>,
  phase: "started" | "completed"
): DeviceWorkspace {
  const item = readCodexThreadItem(params.item);
  const turnId = readTurnId(event, params);
  if (!item || !turnId) {
    return workspace;
  }
  const normalizedItem = normalizeCodexThreadItem(item, {
    defaultStatus: phase === "completed" ? "completed" : "inProgress",
    latestSeq: event.seq,
    source: "live",
    turnStartedAt: event.ts / 1000
  });
  const startedAtMs = readNumber(params, "startedAtMs");
  const completedAtMs = readNumber(params, "completedAtMs");
  return upsertLiveTurnItems(workspace, event, turnId, [
    {
      ...normalizedItem,
      ...(startedAtMs !== null ? { startedAtMs } : {}),
      ...(completedAtMs !== null ? { completedAtMs } : {})
    }
  ]);
}

function applyAppServerReasoningDelta(
  workspace: DeviceWorkspace,
  event: LocalEvent
): DeviceWorkspace {
  const params = isRecord(event.payload) ? event.payload : null;
  return params ? applyAppServerReasoningDeltaParams(workspace, event, params) : workspace;
}

function applyAppServerReasoningDeltaParams(
  workspace: DeviceWorkspace,
  event: LocalEvent,
  params: Record<string, unknown>
): DeviceWorkspace {
  const turnId = readTurnId(event, params);
  const itemId = readString(params, "itemId");
  const delta = readString(params, "delta") ?? "";
  if (!turnId || !itemId || !delta) {
    return workspace;
  }
  return appendLiveTurnItemText(workspace, event, turnId, itemId, {
    type: CodexThreadItemType.Reasoning,
    role: null,
    target: "text",
    delta
  });
}

function applyAppServerItemDelta(
  workspace: DeviceWorkspace,
  event: LocalEvent,
  params: Record<string, unknown>,
  input: {
    type: string;
    target: "text" | "aggregatedOutput";
  }
): DeviceWorkspace {
  const turnId = readTurnId(event, params);
  const itemId = readString(params, "itemId");
  const delta = readString(params, "delta") ?? "";
  if (!turnId || !itemId || !delta) {
    return workspace;
  }
  return appendLiveTurnItemText(workspace, event, turnId, itemId, {
    type: input.type,
    role: codexThreadItemRole({ id: itemId, type: input.type }),
    target: input.target,
    delta: input.target === "aggregatedOutput" ? stripAnsi(delta) : delta
  });
}

function appendLiveTurnItemText(
  workspace: DeviceWorkspace,
  event: LocalEvent,
  turnId: string,
  itemId: string,
  input: {
    delta: string;
    role: ChatItem["role"] | null;
    target: "text" | "aggregatedOutput";
    type: string;
  }
): DeviceWorkspace {
  const key = liveConversationKey(workspace, event, turnId);
  let next = ensureConversation(workspace, {
    conversationKey: key,
    sessionId: event.sessionId,
    threadId: event.threadId
  });
  const canonicalKey = canonicalConversationKey(next, key);
  const conversation = next.conversations[canonicalKey] ?? emptyConversation(canonicalKey);
  const currentTurn = conversation.turns[turnId] ?? emptyLiveTurn(turnId, event);
  const currentItem = currentTurn.items[itemId] ?? emptyLiveTurnItem(itemId, input.type, input.role, event);
  const nextItem: NormalizedConversationTurnItem =
    input.target === "aggregatedOutput"
      ? {
          ...currentItem,
          type: input.type,
          role: input.role,
          aggregatedOutput: `${currentItem.aggregatedOutput ?? ""}${input.delta}`,
          text: commandExecutionText({
            id: itemId,
            type: input.type,
            aggregatedOutput: `${currentItem.aggregatedOutput ?? ""}${input.delta}`
          }),
          updatedAt: Date.now()
        }
      : {
          ...currentItem,
          type: input.type,
          role: input.role,
          text: `${currentItem.text}${input.delta}`,
          updatedAt: Date.now()
        };
  next = upsertLiveTurnItems(next, event, turnId, [nextItem]);
  return syncConversationProjection(next, canonicalKey, {
    sessionId: event.sessionId,
    threadId: event.threadId
  });
}

function applyTurnCompletedEvent(
  workspace: DeviceWorkspace,
  event: LocalEvent
): DeviceWorkspace {
  const params = isRecord(event.payload) ? event.payload : null;
  const withTurn = params
    ? applyTurnPayloadToTurnStore(workspace, event, params)
    : workspace;
  return markTurnItemsComplete(withTurn, event.turnId);
}

function applyTurnPayloadToTurnStore(
  workspace: DeviceWorkspace,
  event: LocalEvent,
  params: Record<string, unknown>
): DeviceWorkspace {
  const turn = readCodexTurn(params.turn);
  if (!turn) {
    return workspace;
  }
  const key = liveConversationKey(workspace, event, turn.id);
  let next = ensureConversation(workspace, {
    conversationKey: key,
    sessionId: event.sessionId,
    threadId: event.threadId ?? readString(params, "threadId") ?? undefined
  });
  const canonicalKey = canonicalConversationKey(next, key);
  next = upsertNormalizedTurns(
    next,
    canonicalKey,
    normalizeCodexTurns([turn], {
      latestSeq: event.seq,
      source: "live"
    }),
    { latestSeq: event.seq }
  );
  return syncConversationProjection(next, canonicalKey, {
    sessionId: event.sessionId,
    threadId: event.threadId ?? readString(params, "threadId")
  });
}

function upsertLiveTurnItems(
  workspace: DeviceWorkspace,
  event: LocalEvent,
  turnId: string,
  items: NormalizedConversationTurnItem[]
): DeviceWorkspace {
  let next = remapPendingTurnsForLiveItems(workspace, event, turnId, items);
  const key = liveConversationKey(next, event, turnId);
  next = ensureConversation(next, {
    conversationKey: key,
    sessionId: event.sessionId,
    threadId: event.threadId
  });
  const canonicalKey = canonicalConversationKey(next, key);
  const conversation = next.conversations[canonicalKey] ?? emptyConversation(canonicalKey);
  const currentTurn = conversation.turns[turnId] ?? emptyLiveTurn(turnId, event);
  const incomingTurn: NormalizedConversationTurn = {
    ...currentTurn,
    itemOrder: mergeTurnOrder(currentTurn.itemOrder, items.map((item) => item.id)),
    items: mergeNormalizedTurnItems(
      currentTurn.items,
      Object.fromEntries(items.map((item) => [item.id, item]))
    ),
    latestSeq: Math.max(currentTurn.latestSeq ?? 0, event.seq) || null,
    status: currentTurn.status === "completed" ? "completed" : "inProgress"
  };
  next = upsertNormalizedTurns(
    next,
    canonicalKey,
    {
      turnOrder: [turnId],
      turns: {
        [turnId]: incomingTurn
      }
    },
    { latestSeq: event.seq }
  );
  return syncConversationProjection(next, canonicalKey, {
    sessionId: event.sessionId,
    threadId: event.threadId
  });
}

function remapPendingTurnsForLiveItems(
  workspace: DeviceWorkspace,
  event: LocalEvent,
  turnId: string,
  items: NormalizedConversationTurnItem[]
): DeviceWorkspace {
  let next = workspace;
  for (const item of items) {
    if (!item.clientMessageId) {
      continue;
    }
    const key =
      findConversationKey(next, {
        pendingClientId: item.clientMessageId,
        sessionId: event.sessionId,
        threadId: event.threadId
      }) ?? liveConversationKey(next, event, turnId);
    next = remapPendingTurnToServerTurn(next, key, item.clientMessageId, turnId);
    next = updateOutboxEntry(next, item.clientMessageId, (entry) => ({
      ...entry,
      ...(event.sessionId ? { sessionId: event.sessionId } : {}),
      ...(event.threadId ? { threadId: event.threadId } : {}),
      turnId,
      status: entry.status === "pending" ? "sent" : entry.status,
      updatedAt: Date.now()
    }));
  }
  return next;
}

function syncConversationProjection(
  workspace: DeviceWorkspace,
  key: ConversationKey,
  input: { sessionId?: string | undefined; threadId?: string | null | undefined }
): DeviceWorkspace {
  const canonicalKey = canonicalConversationKey(workspace, key);
  const conversation = workspace.conversations[canonicalKey];
  if (!conversation) {
    return workspace;
  }
  const projected = projectNormalizedTurnsToChatItems(conversation, input);
  return updateConversationItems(workspace, canonicalKey, (items) => [
    ...projected,
    ...items.filter((item) => {
      if (isTurnStoreProjectedItem(item)) {
        return false;
      }
      return shouldPreserveAfterProjection(item, projected, projected, items);
    })
  ]);
}

function setConversationLatestSeqForEvent(
  workspace: DeviceWorkspace,
  event: LocalEvent
): DeviceWorkspace {
  const key = findConversationKeyForTurn(
    workspace,
    event.sessionId,
    event.threadId,
    event.turnId
  );
  return key ? setConversationLatestSeq(workspace, key, event.seq) : workspace;
}

function hasTurnStoreRenderableText(
  workspace: DeviceWorkspace,
  sessionId: string | undefined,
  threadId: string | undefined,
  turnId: string | undefined,
  role: ChatItem["role"]
): boolean {
  const key = findConversationKeyForTurn(workspace, sessionId, threadId, turnId);
  if (!key || !turnId) {
    return false;
  }
  const turn = workspace.conversations[canonicalConversationKey(workspace, key)]?.turns[turnId];
  return Boolean(
    turn?.itemOrder.some((itemId) => {
      const item = turn.items[itemId];
      return item?.role === role && item.metaKind !== "legacy" && item.text.trim().length > 0;
    })
  );
}

function isTurnStoreProjectedItem(item: ChatItem): boolean {
  return item.meta?.source === "turn-store";
}

function liveConversationKey(
  workspace: DeviceWorkspace,
  event: LocalEvent,
  turnId: string
): ConversationKey {
  return (
    findConversationKeyForTurn(workspace, event.sessionId, event.threadId, turnId) ??
    conversationKeyFor({ sessionId: event.sessionId, threadId: event.threadId })
  );
}

function emptyLiveTurn(turnId: string, event: LocalEvent): NormalizedConversationTurn {
  return {
    id: turnId,
    itemOrder: [],
    items: {},
    itemsView: "full",
    status: "inProgress",
    error: null,
    startedAt: event.ts / 1000,
    completedAt: null,
    durationMs: null,
    latestSeq: event.seq
  };
}

function emptyLiveTurnItem(
  itemId: string,
  type: string,
  role: ChatItem["role"] | null,
  event: LocalEvent
): NormalizedConversationTurnItem {
  return {
    id: itemId,
    type,
    kind: codexThreadItemRenderKind({ type }),
    role,
    text: "",
    createdAt: event.ts,
    updatedAt: Date.now()
  };
}

function readCodexThreadItem(value: unknown): CodexThreadItem | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.type !== "string") {
    return null;
  }
  return value as unknown as CodexThreadItem;
}

function readCodexTurn(value: unknown): CodexThreadTurn | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !Array.isArray(value.items) ||
    typeof value.itemsView !== "string" ||
    typeof value.status !== "string"
  ) {
    return null;
  }
  return value as unknown as CodexThreadTurn;
}

function readTurnId(event: LocalEvent, params: Record<string, unknown>): string | null {
  return event.turnId ?? readString(params, "turnId");
}

function readString(record: Record<string, unknown>, field: string): string | null {
  const value = record[field];
  return typeof value === "string" ? value : null;
}

function readNumber(record: Record<string, unknown>, field: string): number | null {
  const value = record[field];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function upsertEventScopedTurnItem(
  workspace: DeviceWorkspace,
  event: LocalEvent,
  item: {
    clientMessageId?: string | undefined;
    id: string;
    latestSeq?: number | null | undefined;
    role: ChatItem["role"];
    status: ChatItem["status"];
    text: string;
    type: string;
  }
): DeviceWorkspace {
  const turnId = event.turnId ?? `event-turn:${event.id}`;
  const key =
    findConversationKeyForTurn(workspace, event.sessionId, event.threadId, turnId) ??
    conversationKeyFor({ sessionId: event.sessionId, threadId: event.threadId });
  return upsertLocalTurnItems(workspace, {
    key,
    sessionId: event.sessionId,
    threadId: event.threadId,
    turnId,
    items: [{
      id: item.id,
      type: item.type,
      kind: codexThreadItemRenderKind({ type: item.type }),
      role: item.role,
      text: item.text,
      ...(item.clientMessageId ? { clientMessageId: item.clientMessageId } : {}),
      status: item.status,
      metaKind: "legacy",
      createdAt: event.ts,
      updatedAt: Date.now()
    }],
    latestSeq: item.latestSeq,
    turnStatus: item.status === "failed" ? "failed" : "inProgress"
  });
}

function markTurnItemsComplete(
  workspace: DeviceWorkspace,
  turnId: string | undefined
): DeviceWorkspace {
  if (!turnId) {
    return workspace;
  }
  const now = Date.now();
  const next = {
    ...workspace,
    conversations: Object.fromEntries(
      Object.entries(workspace.conversations).map(([key, conversation]) => {
        const turn = conversation.turns[turnId];
        if (!turn) {
          return [key, conversation] as const;
        }
        const completedTurn: NormalizedConversationTurn = {
          ...turn,
          status: "completed",
          completedAt: turn.completedAt ?? now / 1000,
          durationMs:
            turn.durationMs ??
            (turn.startedAt ? Math.max(0, now - timestampSecondsToMs(turn.startedAt)!) : null),
          items: Object.fromEntries(
            Object.entries(turn.items)
              .filter(([, item]) => item.metaKind !== "thinking")
              .map(([itemId, item]) => [
                itemId,
                {
                  ...item,
                  status:
                    item.status === "failed"
                      ? "failed"
                      : normalizeChatStatus(item.status)
                        ? "complete"
                        : item.status,
                  updatedAt: now
                }
              ])
          ),
          itemOrder: turn.itemOrder.filter(
            (itemId) => turn.items[itemId]?.metaKind !== "thinking"
          )
        };
        const updatedConversation: ConversationRecord = {
          ...conversation,
          turns: {
            ...conversation.turns,
            [turnId]: completedTurn
          },
          updatedAt: now
        };
        return [
          key,
          {
            ...updatedConversation,
            items: projectNormalizedTurnsToChatItems(updatedConversation, {
              sessionId: updatedConversation.sessionIds[0],
              threadId: updatedConversation.threadId
            })
          }
        ] as const;
      })
    ),
    outbox: updateOutboxStatusByTurn(workspace.outbox, turnId, "complete")
  };
  return materializeWorkspace(next);
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

function removeHistoryConfirmedLocalTurns(
  workspace: DeviceWorkspace,
  key: ConversationKey,
  historyItems: ChatItem[]
): DeviceWorkspace {
  const canonicalKey = canonicalConversationKey(workspace, key);
  const conversation = workspace.conversations[canonicalKey];
  if (!conversation) {
    return workspace;
  }
  const turns = { ...conversation.turns };
  let removed = false;
  for (const turnId of conversation.turnOrder) {
    if (!turnId.startsWith("local-turn:")) {
      continue;
    }
    const turn = turns[turnId];
    const userItem = turn
      ? projectNormalizedTurnsToChatItems(
          {
            turnOrder: [turnId],
            turns: { [turnId]: turn }
          },
          { sessionId: conversation.sessionIds[0], threadId: conversation.threadId }
        ).find((item) => item.role === "user")
      : null;
    if (historyConfirmsUserTurn(userItem, historyItems)) {
      delete turns[turnId];
      removed = true;
    }
  }
  if (!removed) {
    return workspace;
  }
  const nextConversation: ConversationRecord = {
    ...conversation,
    turnOrder: conversation.turnOrder.filter((turnId) => turns[turnId]),
    turns,
    updatedAt: Date.now()
  };
  return materializeWorkspace({
    ...workspace,
    conversations: {
      ...workspace.conversations,
      [canonicalKey]: {
        ...nextConversation,
        items: projectNormalizedTurnsToChatItems(nextConversation, {
          sessionId: nextConversation.sessionIds[0],
          threadId: nextConversation.threadId
        })
      }
    }
  });
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

function shouldPreserveAfterProjection(
  item: ChatItem,
  projectedItems: ChatItem[],
  incomingHistoryItems: ChatItem[],
  liveItems: ChatItem[]
): boolean {
  if (isTurnStoreProjectedItem(item)) {
    return false;
  }
  if (matchesProjectedClientMessage(item, projectedItems)) {
    return false;
  }
  if (matchesProjectedRenderableMessage(item, projectedItems)) {
    return false;
  }
  if (
    isOptimisticThinkingItem(item) &&
    item.turnId &&
    projectedHasResponseForTurn(projectedItems, item.turnId)
  ) {
    return false;
  }
  return shouldPreserveAfterHistoryHydration(item, incomingHistoryItems, liveItems);
}

function matchesProjectedClientMessage(item: ChatItem, projectedItems: ChatItem[]): boolean {
  return Boolean(
    item.clientMessageId &&
      projectedItems.some(
        (projected) =>
          projected.clientMessageId === item.clientMessageId &&
          projected.role === item.role
      )
  );
}

function matchesProjectedRenderableMessage(item: ChatItem, projectedItems: ChatItem[]): boolean {
  if (!item.turnId) {
    return false;
  }
  return projectedItems.some(
    (projected) =>
      projected.turnId === item.turnId &&
      projected.role === item.role &&
      sameRenderableMessage(projected, item)
  );
}

function projectedHasResponseForTurn(projectedItems: ChatItem[], turnId: string): boolean {
  return projectedItems.some(
    (projected) =>
      projected.turnId === turnId &&
      (projected.role === "assistant" ||
        projected.role === "command" ||
        projected.role === "diff") &&
      projected.text.trim().length > 0
  );
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
  const resolvedTurnId = turnId ?? `event-turn:${fallbackId}`;
  const key =
    findConversationKeyForTurn(workspace, sessionId, threadId, resolvedTurnId) ??
    conversationKeyFor({ sessionId, threadId });
  const event: LocalEvent = {
    id: fallbackId,
    seq: latestSeq ?? 0,
    ts: Date.now(),
    type: role === "assistant" ? "chat.assistant.delta" : "command.output.delta",
    ...(sessionId ? { sessionId } : {}),
    ...(threadId ? { threadId } : {}),
    turnId: resolvedTurnId,
    payload: { text }
  };
  const itemId = `legacy-${role}:${resolvedTurnId}`;
  const existingText = readTurnItemText(workspace, key, resolvedTurnId, itemId);
  let next = upsertEventScopedTurnItem(workspace, event, {
    id: itemId,
    type:
      role === "assistant"
        ? CodexThreadItemType.AgentMessage
        : CodexThreadItemType.CommandExecution,
    role,
    text: `${existingText}${text}`,
    status: "streaming",
    latestSeq
  });
  next = {
    ...next,
    outbox: updateOutboxStatusByTurn(next.outbox, resolvedTurnId, "streaming")
  };
  return next;
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
