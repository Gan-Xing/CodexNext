import {
  CodexThreadItemType,
  type CodexThreadItem,
  type CodexThreadTurn
} from "@codexnext/protocol";
import type { LocalSessionSummary } from "../../lib/types";

export interface MessageReconciliationFingerprint {
  messageText: string;
  startedAt: number;
  turnId?: string | undefined;
}

export interface MessageHistoryReconciliationDecision {
  hasSubmittedMessage: boolean;
  hasResponseAfterMessage: boolean;
  isTerminalSession: boolean;
  shouldApplyHistory: boolean;
  shouldStopReconciliation: boolean;
}

const TERMINAL_SESSION_STATUSES = new Set<LocalSessionSummary["status"]>([
  "idle",
  "completed",
  "failed",
  "interrupted",
  "error"
]);

export function decideMessageHistoryReconciliation(input: {
  turns: CodexThreadTurn[];
  request: MessageReconciliationFingerprint;
  session: LocalSessionSummary;
}): MessageHistoryReconciliationDecision {
  const orderedMessages = orderHistoryTurnsByTime(input.turns);
  const submittedMessageIndex = findSubmittedMessageIndex(
    orderedMessages,
    input.request.messageText,
    input.request.startedAt
  );
  const hasSubmittedMessage = submittedMessageIndex >= 0;
  const hasResponseAfterMessage =
    submittedMessageIndex >= 0 &&
    orderedMessages.slice(submittedMessageIndex + 1).some(isRenderableResponseMessage);
  const isTerminalSession = isReconciledTerminalSession(input.session, input.request);

  return {
    hasSubmittedMessage,
    hasResponseAfterMessage,
    isTerminalSession,
    shouldApplyHistory: hasResponseAfterMessage || (isTerminalSession && hasSubmittedMessage),
    shouldStopReconciliation: hasResponseAfterMessage || (isTerminalSession && hasSubmittedMessage)
  };
}

export function isReconciledTerminalSession(
  session: LocalSessionSummary,
  request: MessageReconciliationFingerprint
): boolean {
  return (
    TERMINAL_SESSION_STATUSES.has(session.status) &&
    !session.activeTurnId &&
    sessionBelongsToReconciledTurn(session, request)
  );
}

function sessionBelongsToReconciledTurn(
  session: LocalSessionSummary,
  request: MessageReconciliationFingerprint
): boolean {
  if (request.turnId) {
    return session.currentTurnId === request.turnId || session.activeTurnId === request.turnId;
  }
  return session.updatedAt >= request.startedAt - 30_000;
}

function findSubmittedMessageIndex(
  messages: ReconciliationMessage[],
  messageText: string,
  startedAt: number
): number {
  const normalizedMessage = normalizeRenderableText(messageText);
  const minMessageTs = startedAt - 30_000;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== "user") {
      continue;
    }
    if (normalizeRenderableText(message.text) !== normalizedMessage) {
      continue;
    }
    if (message.timestamp !== null && message.timestamp < minMessageTs) {
      continue;
    }
    return index;
  }
  return -1;
}

function isRenderableResponseMessage(message: ReconciliationMessage): boolean {
  return (
    (message.role === "assistant" || message.role === "command") &&
    normalizeRenderableText(message.text).length > 0
  );
}

interface ReconciliationMessage {
  role: "user" | "assistant" | "command" | "diff" | "system";
  text: string;
  timestamp: number | null;
}

function orderHistoryTurnsByTime(turns: CodexThreadTurn[]): ReconciliationMessage[] {
  return turns
    .flatMap((turn, turnIndex) =>
      turn.items.flatMap((item, itemIndex) => {
        const message = turnItemToReconciliationMessage(turn, item);
        return message
          ? [{
              index: turnIndex * 1_000 + itemIndex,
              message,
              timestamp: message.timestamp ?? 0
            }]
          : [];
      })
    )
    .sort((left, right) => {
      const leftTs = Number.isFinite(left.timestamp) ? left.timestamp : 0;
      const rightTs = Number.isFinite(right.timestamp) ? right.timestamp : 0;
      return leftTs === rightTs ? left.index - right.index : leftTs - rightTs;
    })
    .map((entry) => entry.message);
}

function turnItemToReconciliationMessage(
  turn: CodexThreadTurn,
  item: CodexThreadItem
): ReconciliationMessage | null {
  const timestamp = turnTimestampMs(turn);
  switch (item.type) {
    case CodexThreadItemType.UserMessage:
      return {
        role: "user",
        text: userMessageText(item.content),
        timestamp
      };
    case CodexThreadItemType.AgentMessage:
      return {
        role: "assistant",
        text: typeof item.text === "string" ? item.text : "",
        timestamp
      };
    case CodexThreadItemType.CommandExecution:
      return {
        role: "command",
        text: typeof item.aggregatedOutput === "string" ? item.aggregatedOutput : "",
        timestamp
      };
    case CodexThreadItemType.FileChange:
      return {
        role: "diff",
        text: typeof item.text === "string" ? item.text : "",
        timestamp
      };
    default:
      return null;
  }
}

function turnTimestampMs(turn: CodexThreadTurn): number | null {
  const timestamp = turn.completedAt ?? turn.startedAt;
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) {
    return null;
  }
  return timestamp > 10_000_000_000 ? timestamp : timestamp * 1000;
}

function userMessageText(content: unknown): string {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeRenderableText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}
