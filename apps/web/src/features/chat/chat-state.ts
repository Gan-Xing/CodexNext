import type { AgentConnection } from "../../lib/api";
import type {
  ChatItem,
  LocalCodexHistoryDetailResponse,
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
export type StateUpdater<T> = T | ((previous: T) => T);

export interface DeviceWorkspace {
  chatItems: ChatItem[];
  codexHistory: LocalCodexHistoryEntryLike[];
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
  sessionHistoryOrigins: Record<string, string>;
  sessions: LocalSessionSummary[];
  streamStatus: string;
}

type LocalCodexHistoryEntryLike = LocalCodexHistoryDetailResponse["entry"];

export function createDeviceWorkspace(connection: AgentConnection): DeviceWorkspace {
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
    sessionHistoryOrigins: {},
    sessions: [],
    streamStatus: "disconnected"
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
    status: "sending",
    createdAt: Date.now()
  };
}

export function addOptimisticUserMessage(
  workspace: DeviceWorkspace,
  input: Parameters<typeof createOptimisticUserMessage>[0]
): DeviceWorkspace {
  const message = createOptimisticUserMessage(input);
  const existingIndex = workspace.chatItems.findIndex(
    (item) => item.clientMessageId === input.clientMessageId
  );
  if (existingIndex >= 0) {
    return {
      ...workspace,
      chatItems: workspace.chatItems.map((item, index) =>
        index === existingIndex ? message : item
      )
    };
  }
  return addChatItemToWorkspace(workspace, message);
}

export function markOptimisticMessageSent(
  workspace: DeviceWorkspace,
  clientMessageId: string,
  input?: {
    eventId?: string;
    sessionId?: string;
    turnId?: string;
  }
): DeviceWorkspace {
  return {
    ...workspace,
    chatItems: workspace.chatItems.map((item) =>
      item.clientMessageId === clientMessageId
        ? {
            ...item,
            ...(input?.eventId ? { id: input.eventId } : {}),
            ...(input?.sessionId ? { sessionId: input.sessionId } : {}),
            ...(input?.turnId ? { turnId: input.turnId } : {}),
            error: undefined,
            status: "sent"
          }
        : item
    )
  };
}

export function markOptimisticMessageFailed(
  workspace: DeviceWorkspace,
  clientMessageId: string,
  error: string
): DeviceWorkspace {
  return {
    ...workspace,
    chatItems: workspace.chatItems.map((item) =>
      item.clientMessageId === clientMessageId
        ? {
            ...item,
            error,
            status: "failed"
          }
        : item
    )
  };
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
  return {
    ...workspace,
    chatItems: workspace.chatItems.map((item) =>
      item.sessionId === fromSessionId
        ? {
            ...item,
            id: item.id.replace(fromSessionId, toSessionId),
            sessionId: toSessionId
          }
        : item
    ),
    sessionHistoryOrigins: nextHistoryOrigins
  };
}

export function rememberSessionHistoryOrigin(
  workspace: DeviceWorkspace,
  sessionId: string,
  threadId: string
): DeviceWorkspace {
  return {
    ...workspace,
    sessionHistoryOrigins: {
      ...workspace.sessionHistoryOrigins,
      [sessionId]: threadId
    }
  };
}

export function hydrateSessionFromHistory(
  workspace: DeviceWorkspace,
  sessionId: string,
  messages: LocalCodexHistoryDetailResponse["messages"]
): DeviceWorkspace {
  const historyItems = dedupeChatItemsById(
    messages
      .filter((message) => isRenderableHistoryRole(message.role))
      .map((message) => historyMessageToChatItem(sessionId, message))
  );
  const preservedSessionItems = workspace.chatItems.filter(
    (item) =>
      item.sessionId === sessionId &&
      !item.id.startsWith(`history-${sessionId}-`)
  );
  const otherItems = workspace.chatItems.filter((item) => item.sessionId !== sessionId);
  const overlap = findHistoryOverlap(historyItems, preservedSessionItems);
  return {
    ...workspace,
    chatItems: [
      ...otherItems,
      ...historyItems,
      ...preservedSessionItems.slice(overlap)
    ].slice(-500)
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
  options: { selectSessions: boolean }
): DeviceWorkspace {
  switch (event.type) {
    case "session.created":
    case "session.updated":
      if (!isSessionSummary(event.payload)) {
        return workspace;
      }
      const nextWorkspace = upsertSessionInWorkspace(workspace, event.payload);
      const resumedFrom = readResumedFrom(event.payload);
      return {
        ...(resumedFrom
          ? rememberSessionHistoryOrigin(
              nextWorkspace,
              event.payload.sessionId,
              resumedFrom
            )
          : nextWorkspace),
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
      return applyServerChatUser(workspace, event);
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
        stripAnsi(readText(event.payload)),
        event.id
      );
    case "diff.updated":
      return upsertTurnScopedItem(workspace, {
        id: event.id,
        role: "diff",
        sessionId: event.sessionId,
        turnId: event.turnId,
        text: readDiff(event.payload),
        status: "streaming",
        meta: {
          kind: "diff"
        }
      });
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
    const match = workspace.chatItems.find(
      (item) => item.clientMessageId === clientMessageId
    );
    if (match) {
      return markOptimisticMessageSent(workspace, clientMessageId, {
        eventId: event.id,
        ...(event.sessionId ? { sessionId: event.sessionId } : {}),
        ...(event.turnId ? { turnId: event.turnId } : {})
      });
    }
  }
  return addChatItemToWorkspace(workspace, {
    id: event.id,
    role: "user",
    text,
    ...(event.sessionId ? { sessionId: event.sessionId } : {}),
    ...(event.turnId ? { turnId: event.turnId } : {}),
    ...(clientMessageId ? { clientMessageId } : {}),
    status: "sent",
    createdAt: event.ts
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
  return addChatItemToWorkspace(workspace, {
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
  });
}

function upsertTurnScopedItem(
  workspace: DeviceWorkspace,
  item: ChatItem
): DeviceWorkspace {
  const existingIndex = [...workspace.chatItems]
    .reverse()
    .findIndex(
      (current) =>
        current.role === item.role &&
        current.turnId === item.turnId &&
        current.sessionId === item.sessionId
    );
  if (existingIndex >= 0) {
    const index = workspace.chatItems.length - 1 - existingIndex;
    return {
      ...workspace,
      chatItems: workspace.chatItems.map((current, currentIndex) =>
        currentIndex === index
          ? {
              ...current,
              ...item
            }
          : current
      )
    };
  }
  return addChatItemToWorkspace(workspace, item);
}

function markTurnItemsComplete(
  workspace: DeviceWorkspace,
  turnId: string | undefined
): DeviceWorkspace {
  if (!turnId) {
    return workspace;
  }
  return {
    ...workspace,
    chatItems: workspace.chatItems.map((item) =>
      item.turnId === turnId &&
      (item.status === "streaming" || item.status === "sent" || item.status === "sending")
        ? { ...item, status: "complete" }
        : item
    )
  };
}

export function upsertSessionInWorkspace(
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
  const existingIndex = workspace.chatItems.findIndex(
    (current) =>
      current.id === item.id ||
      (item.clientMessageId !== undefined &&
        current.clientMessageId === item.clientMessageId)
  );
  if (existingIndex >= 0) {
    return {
      ...workspace,
      chatItems: workspace.chatItems.map((current, index) =>
        index === existingIndex
          ? {
              ...current,
              ...item
            }
          : current
      )
    };
  }
  return {
    ...workspace,
    chatItems: [...workspace.chatItems, item].slice(-500)
  };
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
  if (
    last?.role === role &&
    last.turnId === turnId &&
    last.sessionId === sessionId &&
    last.status !== "failed"
  ) {
    return {
      ...workspace,
      chatItems: [
        ...workspace.chatItems.slice(0, -1),
        {
          ...last,
          text: `${last.text}${text}`,
          status: "streaming"
        }
      ]
    };
  }
  return addChatItemToWorkspace(workspace, {
    id: fallbackId,
    role,
    text,
    ...(sessionId ? { sessionId } : {}),
    ...(turnId ? { turnId } : {}),
    status: "streaming",
    createdAt: Date.now()
  });
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
