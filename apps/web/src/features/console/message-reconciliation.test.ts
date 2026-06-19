import { describe, expect, it } from "vitest";
import type { CodexThreadTurn } from "@codexnext/protocol";
import type { LocalSessionSummary } from "../../lib/types";
import {
  decideMessageHistoryReconciliation,
  isReconciledTerminalSession
} from "./message-reconciliation";

const startedAt = Date.parse("2026-06-12T12:00:00.000Z");

function makeSession(input: Partial<LocalSessionSummary> = {}): LocalSessionSummary {
  return {
    sessionId: "session_1",
    threadId: "thread_1",
    currentTurnId: "turn_1",
    status: "running",
    cwd: "/tmp/demo",
    permissionMode: "request-approval",
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    sandbox: "workspace-write",
    queuedMessages: [],
    createdAt: startedAt - 60_000,
    updatedAt: startedAt,
    ...input
  };
}

function makeTurn(
  input: {
    id: string;
    role: "user" | "assistant" | "command";
    text: string;
    tsOffsetMs: number;
  }
): CodexThreadTurn {
  const timestamp = (startedAt + input.tsOffsetMs) / 1000;
  return {
    id: input.id,
    items: [
      input.role === "user"
        ? {
            id: `${input.id}_item`,
            type: "userMessage",
            content: [{ type: "text", text: input.text, text_elements: [] }]
          }
        : input.role === "assistant"
          ? {
              id: `${input.id}_item`,
              type: "agentMessage",
              text: input.text
            }
          : {
              id: `${input.id}_item`,
              type: "commandExecution",
              command: "",
              aggregatedOutput: input.text
            }
    ],
    itemsView: "full",
    status: "completed",
    error: null,
    startedAt: timestamp,
    completedAt: timestamp,
    durationMs: null
  };
}

function makeConversationTurn(): CodexThreadTurn {
  const timestamp = (startedAt + 200) / 1000;
  return {
    id: "turn_1",
    items: [
      {
        id: "item_user",
        type: "userMessage",
        content: [{ type: "text", text: "你好", text_elements: [] }]
      },
      {
        id: "item_command",
        type: "commandExecution",
        command: "echo ok",
        aggregatedOutput: "ok"
      },
      {
        id: "item_agent",
        type: "agentMessage",
        text: "收到"
      }
    ],
    itemsView: "full",
    status: "completed",
    error: null,
    startedAt: timestamp,
    completedAt: timestamp,
    durationMs: null
  };
}

describe("message reconciliation", () => {
  it("does not apply a partial running history page that only echoes the submitted user message", () => {
    const decision = decideMessageHistoryReconciliation({
      session: makeSession(),
      request: {
        messageText: "你好",
        startedAt,
        turnId: "turn_1"
      },
      turns: [
        makeTurn({ id: "user_1", role: "user", text: "你好", tsOffsetMs: 100 })
      ]
    });

    expect(decision).toMatchObject({
      hasSubmittedMessage: true,
      hasResponseAfterMessage: false,
      isTerminalSession: false,
      shouldApplyHistory: false,
      shouldStopReconciliation: false
    });
  });

  it("does not stop on a terminal session until history contains the submitted message", () => {
    const session = makeSession({
      status: "completed",
      updatedAt: startedAt + 1_000
    });

    expect(isReconciledTerminalSession(session, {
      messageText: "你好",
      startedAt,
      turnId: "turn_1"
    })).toBe(true);

    const decision = decideMessageHistoryReconciliation({
      session,
      request: {
        messageText: "你好",
        startedAt,
        turnId: "turn_1"
      },
      turns: [
        makeTurn({ id: "old_user", role: "user", text: "旧消息", tsOffsetMs: -1_000 })
      ]
    });

    expect(decision).toMatchObject({
      hasSubmittedMessage: false,
      hasResponseAfterMessage: false,
      isTerminalSession: true,
      shouldApplyHistory: false,
      shouldStopReconciliation: false
    });
  });

  it("applies terminal history when the submitted message is present even if there is no assistant output", () => {
    const decision = decideMessageHistoryReconciliation({
      session: makeSession({
        status: "completed",
        updatedAt: startedAt + 1_000
      }),
      request: {
        messageText: "你好",
        startedAt,
        turnId: "turn_1"
      },
      turns: [
        makeTurn({ id: "user_1", role: "user", text: "你好", tsOffsetMs: 100 })
      ]
    });

    expect(decision).toMatchObject({
      hasSubmittedMessage: true,
      hasResponseAfterMessage: false,
      isTerminalSession: true,
      shouldApplyHistory: true,
      shouldStopReconciliation: true
    });
  });

  it("applies history as soon as a response appears after the submitted message", () => {
    const decision = decideMessageHistoryReconciliation({
      session: makeSession(),
      request: {
        messageText: "你好",
        startedAt,
        turnId: "turn_1"
      },
      turns: [
        makeTurn({ id: "user_1", role: "user", text: "你好", tsOffsetMs: 100 }),
        makeTurn({ id: "assistant_1", role: "assistant", text: "收到", tsOffsetMs: 200 })
      ]
    });

    expect(decision).toMatchObject({
      hasSubmittedMessage: true,
      hasResponseAfterMessage: true,
      shouldApplyHistory: true,
      shouldStopReconciliation: true
    });
  });

  it("applies history when the submitted message and answer are in the same turn", () => {
    const decision = decideMessageHistoryReconciliation({
      session: makeSession(),
      request: {
        messageText: "你好",
        startedAt,
        turnId: "turn_1"
      },
      turns: [makeConversationTurn()]
    });

    expect(decision).toMatchObject({
      hasSubmittedMessage: true,
      hasResponseAfterMessage: true,
      shouldApplyHistory: true,
      shouldStopReconciliation: true
    });
  });

  it("normalizes descending history pages before checking response order", () => {
    const decision = decideMessageHistoryReconciliation({
      session: makeSession(),
      request: {
        messageText: "CNQA-1",
        startedAt,
        turnId: "turn_1"
      },
      turns: [
        makeTurn({ id: "assistant_1", role: "assistant", text: "收到", tsOffsetMs: 200 }),
        makeTurn({ id: "user_1", role: "user", text: "CNQA-1", tsOffsetMs: 100 })
      ]
    });

    expect(decision.hasResponseAfterMessage).toBe(true);
    expect(decision.shouldApplyHistory).toBe(true);
  });

  it("ignores stale duplicate user messages from before the current send", () => {
    const decision = decideMessageHistoryReconciliation({
      session: makeSession(),
      request: {
        messageText: "你好",
        startedAt,
        turnId: "turn_1"
      },
      turns: [
        makeTurn({ id: "old_user", role: "user", text: "你好", tsOffsetMs: -40_000 }),
        makeTurn({ id: "old_assistant", role: "assistant", text: "旧回复", tsOffsetMs: -39_000 })
      ]
    });

    expect(decision).toMatchObject({
      hasSubmittedMessage: false,
      hasResponseAfterMessage: false,
      shouldApplyHistory: false,
      shouldStopReconciliation: false
    });
  });
});
