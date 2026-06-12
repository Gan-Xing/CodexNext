import type { LocalCodexHistoryMessage, LocalSessionSummary } from "../../lib/types";

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
  messages: LocalCodexHistoryMessage[];
  request: MessageReconciliationFingerprint;
  session: LocalSessionSummary;
}): MessageHistoryReconciliationDecision {
  const orderedMessages = orderHistoryMessagesByTime(input.messages);
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
  messages: LocalCodexHistoryMessage[],
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
    const timestamp = Date.parse(message.ts);
    if (Number.isFinite(timestamp) && timestamp < minMessageTs) {
      continue;
    }
    return index;
  }
  return -1;
}

function isRenderableResponseMessage(message: LocalCodexHistoryMessage): boolean {
  return (
    (message.role === "assistant" || message.role === "command") &&
    normalizeRenderableText(message.text).length > 0
  );
}

function orderHistoryMessagesByTime(
  messages: LocalCodexHistoryMessage[]
): LocalCodexHistoryMessage[] {
  return messages
    .map((message, index) => ({
      index,
      message,
      timestamp: Date.parse(message.ts)
    }))
    .sort((left, right) => {
      const leftTs = Number.isFinite(left.timestamp) ? left.timestamp : 0;
      const rightTs = Number.isFinite(right.timestamp) ? right.timestamp : 0;
      return leftTs === rightTs ? left.index - right.index : leftTs - rightTs;
    })
    .map((entry) => entry.message);
}

function normalizeRenderableText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}
