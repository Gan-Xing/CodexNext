import { describe, expect, it } from "vitest";
import type { LocalCodexHistoryMessage, LocalSessionSummary } from "../../lib/types";
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
    createdAt: startedAt - 60_000,
    updatedAt: startedAt,
    ...input
  };
}

function makeMessage(
  input: Pick<LocalCodexHistoryMessage, "id" | "role" | "text"> & {
    tsOffsetMs: number;
  }
): LocalCodexHistoryMessage {
  return {
    id: input.id,
    role: input.role,
    text: input.text,
    ts: new Date(startedAt + input.tsOffsetMs).toISOString()
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
      messages: [
        makeMessage({ id: "user_1", role: "user", text: "你好", tsOffsetMs: 100 })
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
      messages: [
        makeMessage({ id: "old_user", role: "user", text: "旧消息", tsOffsetMs: -1_000 })
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
      messages: [
        makeMessage({ id: "user_1", role: "user", text: "你好", tsOffsetMs: 100 })
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
      messages: [
        makeMessage({ id: "user_1", role: "user", text: "你好", tsOffsetMs: 100 }),
        makeMessage({ id: "assistant_1", role: "assistant", text: "收到", tsOffsetMs: 200 })
      ]
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
      messages: [
        makeMessage({ id: "assistant_1", role: "assistant", text: "收到", tsOffsetMs: 200 }),
        makeMessage({ id: "user_1", role: "user", text: "CNQA-1", tsOffsetMs: 100 })
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
      messages: [
        makeMessage({ id: "old_user", role: "user", text: "你好", tsOffsetMs: -40_000 }),
        makeMessage({ id: "old_assistant", role: "assistant", text: "旧回复", tsOffsetMs: -39_000 })
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
