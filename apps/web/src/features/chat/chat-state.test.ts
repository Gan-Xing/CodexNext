import { describe, expect, it } from "vitest";
import type { LocalEvent, LocalSessionSummary } from "../../lib/types";
import type { CodexThreadTurn } from "@codexnext/protocol";
import { CodexNotificationMethod } from "@codexnext/protocol";
import {
  addOptimisticUserMessage,
  buildConversationCacheEntries,
  createDeviceWorkspace,
  hydrateSessionFromHistory,
  hydrateSessionFromTurns,
  ingestEventsIntoWorkspace,
  markOptimisticMessageFailed,
  mergeLocalEvents,
  reassignSessionChatItems,
  restoreConversationCacheEntries,
  upsertSessionInWorkspace,
  selectConversationChatItems,
  selectConversationTurnGroups
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
    ...(input.threadId ? { threadId: input.threadId } : {}),
    ...(input.turnId ? { turnId: input.turnId } : {}),
    ...(input.payload !== undefined ? { payload: input.payload } : {})
  };
}

function makeSession(input: Partial<LocalSessionSummary> = {}): LocalSessionSummary {
  return {
    sessionId: input.sessionId ?? "session_1",
    threadId: input.threadId ?? "thread_1",
    status: input.status ?? "idle",
    cwd: input.cwd ?? "/repo",
    title: input.title ?? null,
    model: input.model ?? null,
    reasoningEffort: input.reasoningEffort ?? null,
    permissionMode: input.permissionMode ?? "request-approval",
    approvalPolicy: input.approvalPolicy ?? "on-request",
    approvalsReviewer: input.approvalsReviewer ?? "user",
    sandbox: input.sandbox ?? "workspace-write",
    goal: input.goal ?? null,
    createdAt: input.createdAt ?? 1,
    updatedAt: input.updatedAt ?? 2
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

  it("adds optimistic user messages and thinking feedback immediately", () => {
    const workspace = addOptimisticUserMessage(makeWorkspace(), {
      sessionId: "session_1",
      clientMessageId: "msg_1",
      text: "hello"
    });

    expect(workspace.chatItems).toHaveLength(2);
    expect(workspace.chatItems[0]).toMatchObject({
      role: "user",
      status: "pending",
      clientMessageId: "msg_1",
      text: "hello"
    });
    expect(workspace.chatItems[1]).toMatchObject({
      role: "system",
      sessionId: "session_1",
      status: "streaming",
      text: "正在思考",
      meta: {
        clientMessageId: "msg_1",
        kind: "thinking"
      }
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

    expect(next.chatItems).toHaveLength(2);
    expect(next.chatItems[0]).toMatchObject({
      sessionId: "session_1",
      turnId: "turn_1",
      status: "sent",
      meta: {
        appServerItemId: "event_1",
        source: "turn-store"
      }
    });
    expect(next.chatItems[1]).toMatchObject({
      role: "system",
      sessionId: "session_1",
      turnId: "turn_1",
      text: "正在思考",
      meta: {
        clientMessageId: "msg_1",
        kind: "thinking"
      }
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
    expect(second.chatItems[0]).toMatchObject({
      meta: {
        appServerItemId: event.id,
        source: "turn-store"
      }
    });
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

  it("does not switch the selected session from replay or live events", () => {
    const workspace = {
      ...makeWorkspace(),
      currentSessionId: "session_selected",
      selectedHistoryKey: null
    };

    const next = ingestEventsIntoWorkspace(
      workspace,
      [
        makeEvent({
          seq: 1,
          type: "session.updated",
          sessionId: "session_other",
          payload: {
            sessionId: "session_other",
            threadId: "thread_other",
            status: "running",
            cwd: "/tmp/other",
            permissionMode: "request-approval",
            approvalPolicy: "on-request",
            approvalsReviewer: "user",
            sandbox: "workspace-write",
            createdAt: 1,
            updatedAt: 2
          }
        })
      ],
      { selectSessions: true }
    );

    expect(next.currentSessionId).toBe("session_selected");
    expect(next.selectedHistoryKey).toBeNull();
  });

  it("remaps optimistic conversation aliases after ack", () => {
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
          threadId: "thread_1",
          turnId: "turn_1",
          payload: {
            text: "hello",
            clientMessageId: "msg_1"
          }
        })
      ],
      { selectSessions: false }
    );

    expect(selectConversationChatItems(next, { threadId: "thread_1" })).toHaveLength(2);
    expect(selectConversationChatItems(next, { sessionId: "session_1" })[0]).toMatchObject({
      clientMessageId: "msg_1",
      status: "sent",
      turnId: "turn_1"
    });
  });

  it("restores persisted conversation cache into normalized aliases", () => {
    const workspace = upsertSessionInWorkspace(
      makeWorkspace(),
      makeSession({ sessionId: "session_1", threadId: "thread_1" })
    );
    const hydrated = hydrateSessionFromHistory(workspace, "session_1", [
      { id: "item-1", role: "user", text: "你好", ts: new Date(1).toISOString() },
      {
        id: "item-2",
        role: "assistant",
        text: "你好！",
        ts: new Date(2).toISOString()
      }
    ]);

    const cache = buildConversationCacheEntries(hydrated);
    const restored = restoreConversationCacheEntries(makeWorkspace(), cache);

    expect(selectConversationChatItems(restored, { threadId: "thread_1" }).map((item) => item.text))
      .toEqual(["你好", "你好！"]);
    expect(selectConversationChatItems(restored, { sessionId: "session_1" }).map((item) => item.text))
      .toEqual(["你好", "你好！"]);
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
    expect(next.chatItems[1]).toMatchObject({
      role: "system",
      status: "failed",
      text: "boom",
      meta: {
        clientMessageId: "msg_1",
        kind: "error"
      }
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
      "测试一下功能",
      "正在思考"
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
      "turn-synthetic-item-1-item-1",
      "turn-synthetic-item-2-item-2"
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

  it("replaces thinking feedback with the first assistant delta", () => {
    const workspace = ingestEventsIntoWorkspace(
      addOptimisticUserMessage(makeWorkspace(), {
        sessionId: "session_1",
        turnId: "turn_1",
        clientMessageId: "msg_1",
        text: "hello"
      }),
      [
        makeEvent({
          seq: 1,
          type: "chat.assistant.delta",
          sessionId: "session_1",
          turnId: "turn_1",
          payload: { text: "hi" }
        })
      ],
      { selectSessions: true }
    );

    expect(workspace.chatItems.map((item) => item.text)).toEqual(["hello", "hi"]);
    expect(workspace.chatItems.some((item) => item.meta?.kind === "thinking")).toBe(false);
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

  it("projects historical turns and realtime app-server notifications through the same turn store", () => {
    const turn: CodexThreadTurn = {
      id: "turn_1",
      items: [
        {
          id: "item_user",
          type: "userMessage",
          clientId: "msg_1",
          content: [{ type: "text", text: "你好", text_elements: [] }]
        },
        {
          id: "item_agent",
          type: "agentMessage",
          text: "你好！"
        }
      ],
      itemsView: "full",
      status: "completed",
      error: null,
      startedAt: 1,
      completedAt: 2,
      durationMs: 1_000
    };

    const historical = hydrateSessionFromTurns(
      upsertSessionInWorkspace(makeWorkspace(), makeSession()),
      "session_1",
      [turn]
    );
    const realtime = ingestEventsIntoWorkspace(
      upsertSessionInWorkspace(makeWorkspace(), makeSession()),
      [
        makeEvent({
          seq: 1,
          type: "codex.notification",
          sessionId: "session_1",
          threadId: "thread_1",
          turnId: "turn_1",
          payload: {
            method: CodexNotificationMethod.ItemStarted,
            params: {
              threadId: "thread_1",
              turnId: "turn_1",
              startedAtMs: 1_000,
              item: turn.items[0]
            }
          }
        }),
        makeEvent({
          seq: 2,
          type: "codex.notification",
          sessionId: "session_1",
          threadId: "thread_1",
          turnId: "turn_1",
          payload: {
            method: CodexNotificationMethod.ItemStarted,
            params: {
              threadId: "thread_1",
              turnId: "turn_1",
              startedAtMs: 1_000,
              item: {
                id: "item_agent",
                type: "agentMessage",
                text: ""
              }
            }
          }
        }),
        makeEvent({
          seq: 3,
          type: "codex.notification",
          sessionId: "session_1",
          threadId: "thread_1",
          turnId: "turn_1",
          payload: {
            method: CodexNotificationMethod.AgentMessageDelta,
            params: {
              threadId: "thread_1",
              turnId: "turn_1",
              itemId: "item_agent",
              delta: "你好！"
            }
          }
        }),
        makeEvent({
          seq: 4,
          type: "turn.completed",
          sessionId: "session_1",
          threadId: "thread_1",
          turnId: "turn_1",
          payload: {
            threadId: "thread_1",
            turn
          }
        })
      ],
      { selectSessions: true }
    );

    expect(realtime.chatItems.map(({ role, text, status }) => ({ role, text, status })))
      .toEqual(historical.chatItems.map(({ role, text, status }) => ({ role, text, status })));
    expect(realtime.chatItems.map((item) => item.meta?.source)).toEqual([
      "turn-store",
      "turn-store"
    ]);
  });

  it("derives read-only turn groups from normalized turn items", () => {
    const turn: CodexThreadTurn = {
      id: "turn_1",
      items: [
        {
          id: "item_user",
          type: "userMessage",
          content: [{ type: "text", text: "检查日志", text_elements: [] }]
        },
        {
          id: "item_reasoning",
          type: "reasoning",
          summary: ["read logs"]
        },
        {
          id: "item_command",
          type: "commandExecution",
          command: "pnpm test",
          aggregatedOutput: "ok"
        },
        {
          id: "item_agent",
          type: "agentMessage",
          text: "测试通过。"
        },
        {
          id: "item_meta",
          type: "contextCompaction"
        }
      ],
      itemsView: "full",
      status: "completed",
      error: null,
      startedAt: 10,
      completedAt: 13,
      durationMs: 3_000
    };
    const workspace = hydrateSessionFromTurns(
      upsertSessionInWorkspace(makeWorkspace(), makeSession()),
      "session_1",
      [turn]
    );

    const groups = selectConversationTurnGroups(workspace, {
      sessionId: "session_1",
      threadId: "thread_1"
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      id: "turn_1",
      status: "complete",
      startedAt: 10_000,
      completedAt: 13_000,
      durationMs: 3_000
    });
    expect(groups[0]?.userItems.map((item) => item.text)).toEqual(["检查日志"]);
    expect(groups[0]?.processItems.map((item) => item.type)).toEqual([
      "reasoning",
      "commandExecution",
      "contextCompaction"
    ]);
    expect(groups[0]?.answerItems.map((item) => item.text)).toEqual(["测试通过。"]);
    expect(groups[0]?.metadataItems).toEqual([]);
    expect(groups[0]?.processItems[1]?.chatItem).toMatchObject({
      role: "command",
      text: "$ pnpm test\nok"
    });
  });

  it("does not let stale history overwrite a live turn-store stream", () => {
    const live = ingestEventsIntoWorkspace(
      upsertSessionInWorkspace(makeWorkspace(), makeSession()),
      [
        makeEvent({
          seq: 1,
          type: "codex.notification",
          sessionId: "session_1",
          threadId: "thread_1",
          turnId: "turn_1",
          payload: {
            method: CodexNotificationMethod.ItemStarted,
            params: {
              threadId: "thread_1",
              turnId: "turn_1",
              item: {
                id: "item_agent",
                type: "agentMessage",
                text: ""
              }
            }
          }
        }),
        makeEvent({
          seq: 2,
          type: "codex.notification",
          sessionId: "session_1",
          threadId: "thread_1",
          turnId: "turn_1",
          payload: {
            method: CodexNotificationMethod.AgentMessageDelta,
            params: {
              threadId: "thread_1",
              turnId: "turn_1",
              itemId: "item_agent",
              delta: "hello world"
            }
          }
        })
      ],
      { selectSessions: true }
    );

    const staleHistory: CodexThreadTurn = {
      id: "turn_1",
      items: [
        {
          id: "item_agent",
          type: "agentMessage",
          text: "hello"
        }
      ],
      itemsView: "full",
      status: "completed",
      error: null,
      startedAt: 1,
      completedAt: 2,
      durationMs: 1_000
    };
    const hydrated = hydrateSessionFromTurns(live, "session_1", [staleHistory]);

    expect(hydrated.chatItems).toHaveLength(1);
    expect(hydrated.chatItems[0]).toMatchObject({
      role: "assistant",
      text: "hello world",
      status: "complete",
      meta: {
        source: "turn-store"
      }
    });
  });

  it("dedupes optimistic user messages after app-server projection and keeps thinking until a response", () => {
    const optimistic = addOptimisticUserMessage(
      upsertSessionInWorkspace(makeWorkspace(), makeSession()),
      {
        sessionId: "session_1",
        clientMessageId: "msg_1",
        text: "hello"
      }
    );

    const afterUserProjection = ingestEventsIntoWorkspace(
      optimistic,
      [
        makeEvent({
          seq: 1,
          type: "codex.notification",
          sessionId: "session_1",
          threadId: "thread_1",
          turnId: "turn_1",
          payload: {
            method: CodexNotificationMethod.ItemStarted,
            params: {
              threadId: "thread_1",
              turnId: "turn_1",
              item: {
                id: "item_user",
                type: "userMessage",
                clientId: "msg_1",
                content: [{ type: "text", text: "hello", text_elements: [] }]
              }
            }
          }
        })
      ],
      { selectSessions: true }
    );

    expect(afterUserProjection.chatItems.map((item) => item.role)).toEqual([
      "user",
      "system"
    ]);
    expect(afterUserProjection.chatItems[0]).toMatchObject({
      clientMessageId: "msg_1",
      text: "hello",
      meta: {
        source: "turn-store"
      }
    });
    expect(afterUserProjection.chatItems[1]).toMatchObject({
      role: "system",
      text: "正在思考"
    });

    const afterAssistantProjection = ingestEventsIntoWorkspace(
      afterUserProjection,
      [
        makeEvent({
          seq: 2,
          type: "codex.notification",
          sessionId: "session_1",
          threadId: "thread_1",
          turnId: "turn_1",
          payload: {
            method: CodexNotificationMethod.AgentMessageDelta,
            params: {
              threadId: "thread_1",
              turnId: "turn_1",
              itemId: "item_agent",
              delta: "hi"
            }
          }
        })
      ],
      { selectSessions: true }
    );

    expect(afterAssistantProjection.chatItems.map((item) => item.role)).toEqual([
      "user",
      "assistant"
    ]);
    expect(afterAssistantProjection.chatItems[1]).toMatchObject({
      text: "hi",
      meta: {
        source: "turn-store"
      }
    });
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
