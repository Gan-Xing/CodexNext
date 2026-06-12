import { describe, expect, it } from "vitest";
import type { LocalEvent } from "../../lib/types";
import {
  addOptimisticUserMessage,
  createDeviceWorkspace,
  hydrateSessionFromHistory,
  ingestEventsIntoWorkspace,
  markOptimisticMessageFailed,
  mergeLocalEvents,
  reassignSessionChatItems
} from "./chat-state";

function makeWorkspace() {
  return createDeviceWorkspace({
    mode: "relay",
    relayUrl: "http://127.0.0.1:3922",
    sessionToken: "session-token",
    deviceId: "device_linux"
  });
}

function makeEvent(input: Partial<LocalEvent> & Pick<LocalEvent, "seq" | "type">): LocalEvent {
  return {
    id: input.id ?? `event_${input.seq}`,
    seq: input.seq,
    ts: input.ts ?? input.seq,
    type: input.type,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.turnId ? { turnId: input.turnId } : {}),
    ...(input.payload !== undefined ? { payload: input.payload } : {})
  };
}

describe("chat state", () => {
  it("merges local events by seq and keeps them sorted", () => {
    const merged = mergeLocalEvents(
      [
        makeEvent({ seq: 2, type: "session.updated" }),
        makeEvent({ seq: 1, type: "session.created" })
      ],
      [makeEvent({ seq: 2, type: "session.updated", id: "replacement" })]
    );

    expect(merged.map((event) => event.seq)).toEqual([1, 2]);
    expect(merged[1]?.id).toBe("replacement");
  });

  it("adds optimistic user messages immediately", () => {
    const workspace = addOptimisticUserMessage(makeWorkspace(), {
      sessionId: "session_1",
      clientMessageId: "msg_1",
      text: "hello"
    });

    expect(workspace.chatItems[0]).toMatchObject({
      role: "user",
      status: "sending",
      clientMessageId: "msg_1",
      text: "hello"
    });
  });

  it("dedupes server chat.user echo by clientMessageId", () => {
    const workspace = addOptimisticUserMessage(makeWorkspace(), {
      sessionId: "pending-session:msg_1",
      clientMessageId: "msg_1",
      text: "hello"
    });

    const next = ingestEventsIntoWorkspace(
      workspace,
      [
        makeEvent({
          seq: 1,
          type: "chat.user",
          sessionId: "session_1",
          turnId: "turn_1",
          payload: {
            text: "hello",
            clientMessageId: "msg_1"
          }
        })
      ],
      { selectSessions: true }
    );

    expect(next.chatItems).toHaveLength(1);
    expect(next.chatItems[0]).toMatchObject({
      id: "event_1",
      sessionId: "session_1",
      turnId: "turn_1",
      status: "sent"
    });
  });

  it("does not re-apply the same chat.user event twice", () => {
    const event = makeEvent({
      seq: 1,
      type: "chat.user",
      sessionId: "session_1",
      turnId: "turn_1",
      payload: { text: "hello" }
    });

    const first = ingestEventsIntoWorkspace(makeWorkspace(), [event], {
      selectSessions: true
    });
    const second = ingestEventsIntoWorkspace(first, [event], {
      selectSessions: true
    });

    expect(second.chatItems).toHaveLength(1);
    expect(second.chatItems[0]?.id).toBe(event.id);
  });

  it("remembers resumed history origin from session.created replay", () => {
    const next = ingestEventsIntoWorkspace(
      makeWorkspace(),
      [
        makeEvent({
          seq: 1,
          type: "session.created",
          sessionId: "session_1",
          payload: {
            sessionId: "session_1",
            threadId: "thread_1",
            status: "idle",
            cwd: "/tmp/demo",
            permissionMode: "request-approval",
            approvalPolicy: "on-request",
            approvalsReviewer: "user",
            sandbox: "workspace-write",
            createdAt: 1,
            updatedAt: 1,
            resumedFrom: "thread_1"
          }
        })
      ],
      { selectSessions: true }
    );

    expect(next.sessionHistoryOrigins).toEqual({
      session_1: "thread_1"
    });
  });

  it("marks failed optimistic messages", () => {
    const workspace = addOptimisticUserMessage(makeWorkspace(), {
      sessionId: "session_1",
      clientMessageId: "msg_1",
      text: "hello"
    });

    const next = markOptimisticMessageFailed(workspace, "msg_1", "boom");
    expect(next.chatItems[0]).toMatchObject({
      status: "failed",
      error: "boom"
    });
  });

  it("keeps resumed history messages above a newly typed optimistic message", () => {
    const preview = hydrateSessionFromHistory(makeWorkspace(), "history-preview:1", [
      { id: "item-1", role: "user", text: "你好", ts: new Date(1).toISOString() },
      {
        id: "item-2",
        role: "assistant",
        text: "你好！有什么我可以帮你的。",
        ts: new Date(2).toISOString()
      }
    ]);

    const withOptimistic = addOptimisticUserMessage(preview, {
      sessionId: "history-preview:1",
      clientMessageId: "msg_1",
      text: "测试一下功能"
    });

    const reassigned = reassignSessionChatItems(
      withOptimistic,
      "history-preview:1",
      "session_1"
    );

    const resumed = hydrateSessionFromHistory(
      reassigned,
      "session_1",
      [
        { id: "item-1", role: "user", text: "你好", ts: new Date(1).toISOString() },
        {
          id: "item-2",
          role: "assistant",
          text: "你好！有什么我可以帮你的。",
          ts: new Date(2).toISOString()
        }
      ]
    );

    expect(resumed.chatItems.map((item) => item.text)).toEqual([
      "你好",
      "你好！有什么我可以帮你的。",
      "测试一下功能"
    ]);
  });

  it("filters system history rows and removes overlapped live tail messages", () => {
    const workspace = {
      ...makeWorkspace(),
      chatItems: [
        {
          id: "live-user",
          role: "user" as const,
          text: "测试一下功能",
          sessionId: "session_1",
          status: "sent" as const
        },
        {
          id: "live-assistant",
          role: "assistant" as const,
          text: "可以。请说明要测试哪一项功能。",
          sessionId: "session_1",
          status: "complete" as const
        }
      ]
    };

    const hydrated = hydrateSessionFromHistory(workspace, "session_1", [
      { id: "item-1", role: "user", text: "你好", ts: new Date(1).toISOString() },
      {
        id: "item-2",
        role: "system",
        text: "**Preparing greeting in Chinese**",
        ts: new Date(2).toISOString()
      },
      {
        id: "item-3",
        role: "assistant",
        text: "你好！有什么我可以帮你的。",
        ts: new Date(3).toISOString()
      },
      {
        id: "item-4",
        role: "user",
        text: "测试一下功能",
        ts: new Date(4).toISOString()
      },
      {
        id: "item-5",
        role: "assistant",
        text: "可以。请说明要测试哪一项功能。",
        ts: new Date(5).toISOString()
      }
    ]);

    expect(hydrated.chatItems.map((item) => item.text)).toEqual([
      "你好",
      "你好！有什么我可以帮你的。",
      "测试一下功能",
      "可以。请说明要测试哪一项功能。"
    ]);
  });

  it("removes an optimistic user message once canonical history contains it", () => {
    const workspace = addOptimisticUserMessage(makeWorkspace(), {
      sessionId: "session_1",
      clientMessageId: "msg_1",
      text: "你好"
    });

    const hydrated = hydrateSessionFromHistory(workspace, "session_1", [
      { id: "item-1", role: "user", text: "你好", ts: new Date(1).toISOString() },
      {
        id: "item-2",
        role: "assistant",
        text: "你好！有什么可以帮你？",
        ts: new Date(2).toISOString()
      }
    ]);

    expect(hydrated.chatItems.map((item) => item.id)).toEqual([
      "history-session_1-item-1",
      "history-session_1-item-2"
    ]);
    expect(hydrated.chatItems.map((item) => item.text)).toEqual([
      "你好",
      "你好！有什么可以帮你？"
    ]);
  });

  it("merges assistant deltas into one streaming item", () => {
    const next = ingestEventsIntoWorkspace(
      makeWorkspace(),
      [
        makeEvent({
          seq: 1,
          type: "chat.assistant.delta",
          sessionId: "session_1",
          turnId: "turn_1",
          payload: { text: "hel" }
        }),
        makeEvent({
          seq: 2,
          type: "chat.assistant.delta",
          sessionId: "session_1",
          turnId: "turn_1",
          payload: { text: "lo" }
        })
      ],
      { selectSessions: true }
    );

    expect(next.chatItems).toHaveLength(1);
    expect(next.chatItems[0]).toMatchObject({
      role: "assistant",
      status: "streaming",
      text: "hello"
    });
  });

  it("does not duplicate assistant text when a delta event replays", () => {
    const first = ingestEventsIntoWorkspace(
      makeWorkspace(),
      [
        makeEvent({
          seq: 1,
          type: "chat.assistant.delta",
          sessionId: "session_1",
          turnId: "turn_1",
          payload: { text: "hel" }
        }),
        makeEvent({
          seq: 2,
          type: "chat.assistant.delta",
          sessionId: "session_1",
          turnId: "turn_1",
          payload: { text: "lo" }
        })
      ],
      { selectSessions: true }
    );

    const second = ingestEventsIntoWorkspace(
      first,
      [
        makeEvent({
          seq: 2,
          type: "chat.assistant.delta",
          sessionId: "session_1",
          turnId: "turn_1",
          payload: { text: "lo" }
        })
      ],
      { selectSessions: true }
    );

    expect(second.chatItems).toHaveLength(1);
    expect(second.chatItems[0]?.text).toBe("hello");
  });

  it("keeps plan.updated out of the main chat stream", () => {
    const next = ingestEventsIntoWorkspace(
      makeWorkspace(),
      [
        makeEvent({
          seq: 1,
          type: "plan.updated",
          sessionId: "session_1",
          turnId: "turn_1",
          payload: {
            explanation: "Focus on validation",
            plan: [{ step: "Write tests", status: "in_progress" }]
          }
        })
      ],
      { selectSessions: true }
    );

    expect(next.chatItems).toHaveLength(0);
  });
});
