import { describe, expect, it } from "vitest";
import type { LocalEvent, LocalSessionSummary } from "../../lib/types";
import type { CodexThreadTurn } from "@codexnext/protocol";
import { CodexNotificationMethod } from "@codexnext/protocol";
import {
  addOptimisticUserMessage,
  buildConversationCacheEntries,
  createDeviceWorkspace,
  hydrateSessionFromTurns,
  ingestEventsIntoWorkspace,
  markOptimisticMessageFailed,
  markOptimisticMessageSent,
  mergeLocalEvents,
  reassignSessionChatItems,
  restoreConversationCacheEntries,
  selectConversationRenderSnapshot,
  selectSessionHistoryHydrated,
  selectTurnHasCompletionEvidence,
  setSessionHistoryPageState,
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
    queuedMessages: input.queuedMessages ?? [],
    goal: input.goal ?? null,
    createdAt: input.createdAt ?? 1,
    updatedAt: input.updatedAt ?? 2
  };
}

function makeHistoryTurns(
  messages: Array<{
    id: string;
    role: "user" | "assistant" | "command" | "system" | "diff";
    text: string;
    ts: string;
  }>
): CodexThreadTurn[] {
  return messages.map((message, index) => {
    const tsMs = Date.parse(message.ts);
    const ts = Number.isFinite(tsMs) ? tsMs / 1000 : null;
    return {
      id: `history-${message.id || index}`,
      items: [makeHistoryTurnItem(message, index)],
      itemsView: "full",
      status: "completed",
      error: null,
      startedAt: ts,
      completedAt: ts,
      durationMs: null
    };
  });
}

function makeHistoryTurnItem(
  message: {
    id: string;
    role: "user" | "assistant" | "command" | "system" | "diff";
    text: string;
  },
  index: number
): CodexThreadTurn["items"][number] {
  const id = message.id || `message-${index}`;
  if (message.role === "user") {
    return {
      id,
      type: "userMessage",
      content: [{ type: "text", text: message.text, text_elements: [] }]
    };
  }
  if (message.role === "assistant") {
    return {
      id,
      type: "agentMessage",
      text: message.text
    };
  }
  if (message.role === "command") {
    return {
      id,
      type: "commandExecution",
      command: "",
      aggregatedOutput: message.text
    };
  }
  if (message.role === "diff") {
    return {
      id,
      type: "fileChange",
      text: message.text,
      changes: []
    };
  }
  return {
    id,
    type: "contextCompaction"
  };
}

describe("chat state", () => {
  it("starts each device workspace with isolated session request settings", () => {
    const workspace = makeWorkspace();

    expect(workspace.serviceTier).toBeNull();
    expect(workspace.permissionMode).toBe("request-approval");
    expect(workspace.reasoningEffort).toBe("xhigh");
  });

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

  it("tracks hydrated session history from page state instead of chat item ids", () => {
    const workspace = makeWorkspace();
    expect(selectSessionHistoryHydrated(workspace, "session_1")).toBe(false);

    const loading = setSessionHistoryPageState(workspace, "session_1", {
      loadingOlder: true,
      olderCursor: null,
      sourceKey: null
    });
    expect(selectSessionHistoryHydrated(loading, "session_1")).toBe(false);

    const hydrated = setSessionHistoryPageState(loading, "session_1", {
      loadingOlder: false,
      olderCursor: "cursor_2",
      sourceKey: "thread_1::/tmp/codexnext"
    });
    expect(selectSessionHistoryHydrated(hydrated, "session_1")).toBe(true);
  });

  it("detects turn completion evidence from normalized turn items", () => {
    const workspace = hydrateSessionFromTurns(
      upsertSessionInWorkspace(makeWorkspace(), makeSession()),
      "session_1",
      makeHistoryTurns([
        {
          id: "assistant_1",
          role: "assistant",
          text: "done",
          ts: "2026-06-15T00:00:00.000Z"
        }
      ])
    );

    expect(
      selectTurnHasCompletionEvidence(workspace, {
        sessionId: "session_1",
        turnId: "history-assistant_1"
      })
    ).toBe(true);
    expect(
      selectTurnHasCompletionEvidence(workspace, {
        sessionId: "session_1",
        turnId: "missing"
      })
    ).toBe(false);
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

  it("keeps queued chat.user echoes out of rendered turn items", () => {
    const workspace = addOptimisticUserMessage(makeWorkspace(), {
      sessionId: "session_1",
      clientMessageId: "msg_queued",
      text: "second",
      status: "queued"
    });

    const next = ingestEventsIntoWorkspace(
      workspace,
      [
        makeEvent({
          seq: 1,
          type: "chat.user",
          sessionId: "session_1",
          threadId: "thread_1",
          payload: {
            text: "second",
            clientMessageId: "msg_queued",
            mode: "queued"
          }
        })
      ],
      { selectSessions: true }
    );

    const normalizedItems = Object.values(next.conversations).flatMap((conversation) =>
      Object.values(conversation.turns).flatMap((turn) => Object.values(turn.items))
    );
    expect(normalizedItems.some((item) => item.clientMessageId === "msg_queued")).toBe(false);
    expect(next.outbox.msg_queued).toMatchObject({
      status: "queued",
      text: "second"
    });
    expect(next.chatItems.filter((item) => item.role === "user")).toHaveLength(0);
    expect(next.chatItems.some((item) => item.meta?.kind === "queued")).toBe(false);
  });

  it("renders a queued message once after it drains into a real turn", () => {
    const workspace = addOptimisticUserMessage(makeWorkspace(), {
      sessionId: "session_1",
      clientMessageId: "msg_queued",
      text: "second",
      status: "queued"
    });

    const next = ingestEventsIntoWorkspace(
      workspace,
      [
        makeEvent({
          seq: 1,
          type: "chat.user",
          sessionId: "session_1",
          threadId: "thread_1",
          payload: {
            text: "second",
            clientMessageId: "msg_queued",
            mode: "queued"
          }
        }),
        makeEvent({
          seq: 2,
          type: "chat.user",
          sessionId: "session_1",
          threadId: "thread_1",
          turnId: "turn_drained",
          payload: {
            text: "second",
            clientMessageId: "msg_queued",
            mode: "turn-start"
          }
        })
      ],
      { selectSessions: true }
    );

    const users = next.chatItems.filter(
      (item) => item.role === "user" && item.clientMessageId === "msg_queued"
    );
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({
      status: "sent",
      text: "second",
      turnId: "turn_drained"
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
    const hydrated = hydrateSessionFromTurns(workspace, "session_1", makeHistoryTurns([
      { id: "item-1", role: "user", text: "你好", ts: new Date(1).toISOString() },
      {
        id: "item-2",
        role: "assistant",
        text: "你好！",
        ts: new Date(2).toISOString()
      }
    ]));

    const cache = buildConversationCacheEntries(hydrated);
    const restored = restoreConversationCacheEntries(makeWorkspace(), cache);

    expect(selectConversationChatItems(restored, { threadId: "thread_1" }).map((item) => item.text))
      .toEqual(["你好", "你好！"]);
    expect(selectConversationChatItems(restored, { sessionId: "session_1" }).map((item) => item.text))
      .toEqual(["你好", "你好！"]);
  });

  it("persists full normalized turns in the conversation cache", () => {
    const turn: CodexThreadTurn = {
      id: "turn_1",
      items: [
        {
          id: "item_user",
          type: "userMessage",
          content: [{ type: "text", text: "查日志", text_elements: [] }]
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
          text: "通过。"
        }
      ],
      itemsView: "full",
      status: "completed",
      error: null,
      startedAt: 10,
      completedAt: 12,
      durationMs: 2_000
    };
    const workspace = hydrateSessionFromTurns(
      upsertSessionInWorkspace(makeWorkspace(), makeSession()),
      "session_1",
      [turn]
    );

    const cache = buildConversationCacheEntries(workspace);
    expect(cache[0]?.items).toEqual([]);
    expect(cache[0]?.turnOrder).toEqual(["turn_1"]);
    expect(cache[0]?.turns?.turn_1?.items.item_command).toMatchObject({
      role: "command",
      text: "$ pnpm test\nok",
      type: "commandExecution"
    });

    const restored = restoreConversationCacheEntries(makeWorkspace(), cache);
    const groups = selectConversationTurnGroups(restored, {
      sessionId: "session_1",
      threadId: "thread_1"
    });
    expect(groups[0]?.processItems[0]).toMatchObject({
      role: "command",
      text: "$ pnpm test\nok"
    });
    expect(groups[0]?.answerItems[0]?.text).toBe("通过。");
  });

  it("restores turn cache without replaying stale flat chat items", () => {
    const turn: CodexThreadTurn = {
      id: "turn_1",
      items: [
        {
          id: "item_user",
          type: "userMessage",
          clientId: "msg_1",
          content: [{ type: "text", text: "测试8", text_elements: [] }]
        },
        {
          id: "item_agent",
          type: "agentMessage",
          text: "测试8收到。"
        }
      ],
      itemsView: "full",
      status: "completed",
      error: null,
      startedAt: 10,
      completedAt: 12,
      durationMs: 2_000
    };
    const workspace = hydrateSessionFromTurns(
      upsertSessionInWorkspace(makeWorkspace(), makeSession()),
      "session_1",
      [turn]
    );
    const cache = buildConversationCacheEntries(workspace);
    const dirtyCache = [{
      ...cache[0]!,
      items: [
        {
          id: "stale_user",
          role: "user" as const,
          text: "测试8",
          sessionId: "session_1",
          clientMessageId: "msg_1",
          status: "sent" as const,
          createdAt: 1
        }
      ]
    }];

    const restored = restoreConversationCacheEntries(makeWorkspace(), dirtyCache);
    const users = selectConversationChatItems(restored, { threadId: "thread_1" })
      .filter((item) => item.role === "user");

    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({
      clientMessageId: "msg_1",
      text: "测试8",
      turnId: "turn_1",
      meta: {
        source: "turn-store"
      }
    });
  });

  it("does not persist in-flight optimistic turns into the conversation cache", () => {
    const workspace = addOptimisticUserMessage(makeWorkspace(), {
      sessionId: "session_1",
      clientMessageId: "msg_1",
      text: "还在执行"
    });

    expect(buildConversationCacheEntries(workspace)).toEqual([]);
  });

  it("does not persist local transport errors into the conversation cache", () => {
    const workspace = addOptimisticUserMessage(makeWorkspace(), {
      sessionId: "session_1",
      clientMessageId: "msg_1",
      text: "测试超时"
    });

    const failed = markOptimisticMessageFailed(
      workspace,
      "msg_1",
      "{\"error\":\"relay rpc timeout: operation has timed out\"}"
    );

    expect(buildConversationCacheEntries(failed)).toEqual([]);
  });

  it("strips local error items when persisting mixed normalized turns", () => {
    const turn: CodexThreadTurn = {
      id: "turn_1",
      items: [
        {
          id: "item_agent",
          type: "agentMessage",
          text: "已经完成。"
        }
      ],
      itemsView: "full",
      status: "completed",
      error: null,
      startedAt: 10,
      completedAt: 12,
      durationMs: 2_000
    };
    const history = hydrateSessionFromTurns(
      upsertSessionInWorkspace(makeWorkspace(), makeSession()),
      "session_1",
      [turn]
    );
    const withLocalError = ingestEventsIntoWorkspace(
      history,
      [
        makeEvent({
          seq: 1,
          type: "agent.error",
          sessionId: "session_1",
          threadId: "thread_1",
          turnId: "turn_1",
          payload: {
            message: "{\"error\":\"relay rpc timeout: operation has timed out\"}"
          }
        })
      ],
      { selectSessions: true }
    );

    const cache = buildConversationCacheEntries(withLocalError);
    const cachedTurn = cache[0]?.turns?.turn_1;

    expect(cachedTurn?.itemOrder).toEqual(["item_agent"]);
    expect(Object.values(cachedTurn?.items ?? {}).some((item) => item.metaKind === "error")).toBe(false);
    expect(JSON.stringify(cache)).not.toContain("relay rpc timeout");
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

  it("keeps resumed history turns above a newly typed optimistic message", () => {
    const preview = hydrateSessionFromTurns(makeWorkspace(), "history-preview:1", makeHistoryTurns([
      { id: "item-1", role: "user", text: "你好", ts: new Date(1).toISOString() },
      {
        id: "item-2",
        role: "assistant",
        text: "你好！有什么我可以帮你的。",
        ts: new Date(2).toISOString()
      }
    ]));

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

    const resumed = hydrateSessionFromTurns(
      reassigned,
      "session_1",
      makeHistoryTurns([
        { id: "item-1", role: "user", text: "你好", ts: new Date(1).toISOString() },
        {
          id: "item-2",
          role: "assistant",
          text: "你好！有什么我可以帮你的。",
          ts: new Date(2).toISOString()
        }
      ])
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

    const hydrated = hydrateSessionFromTurns(workspace, "session_1", makeHistoryTurns([
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
    ]));

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

    const hydrated = hydrateSessionFromTurns(workspace, "session_1", makeHistoryTurns([
      { id: "item-1", role: "user", text: "你好", ts: new Date(1).toISOString() },
      {
        id: "item-2",
        role: "assistant",
        text: "你好！有什么可以帮你？",
        ts: new Date(2).toISOString()
      }
    ]));

    expect(hydrated.chatItems.map((item) => item.id)).toEqual([
      "turn-history-item-1-item-1",
      "turn-history-item-2-item-2"
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
    expect(groups[0]?.processItems[1]).toMatchObject({
      role: "command",
      text: "$ pnpm test\nok"
    });
  });

  it("keeps the chat render projection bounded for large normalized histories", () => {
    const turns: CodexThreadTurn[] = Array.from({ length: 620 }, (_, index) => ({
      id: `turn_${index}`,
      items: [
        {
          id: `item_${index}`,
          type: "agentMessage",
          text: `reply ${index}`
        }
      ],
      itemsView: "full",
      status: "completed",
      error: null,
      startedAt: index,
      completedAt: index,
      durationMs: null
    }));
    let workspace = hydrateSessionFromTurns(
      upsertSessionInWorkspace(makeWorkspace(), makeSession()),
      "session_1",
      turns
    );

    expect(selectConversationRenderSnapshot(workspace, { threadId: "thread_1" }).messageCount)
      .toBe(500);
    expect(selectConversationChatItems(workspace, { threadId: "thread_1" })).toHaveLength(500);
    expect(selectConversationTurnGroups(workspace, { threadId: "thread_1" })).toHaveLength(500);

    workspace = ingestEventsIntoWorkspace(
      workspace,
      [
        makeEvent({
          seq: 10_000,
          type: "turn.completed",
          sessionId: "session_1",
          threadId: "thread_1",
          turnId: "turn_619"
        })
      ],
      { selectSessions: false }
    );

    const chatItems = selectConversationChatItems(workspace, { threadId: "thread_1" });
    expect(selectConversationRenderSnapshot(workspace, { threadId: "thread_1" }).messageCount)
      .toBe(500);
    expect(chatItems).toHaveLength(500);
    expect(selectConversationTurnGroups(workspace, { threadId: "thread_1" })).toHaveLength(500);
    expect(chatItems.at(-1)?.text).toBe("reply 619");
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

  it("replaces confirmed live turns with split history turns instead of duplicating them", () => {
    const live = ingestEventsIntoWorkspace(
      upsertSessionInWorkspace(makeWorkspace(), makeSession()),
      [
        makeEvent({
          seq: 1,
          type: "codex.notification",
          sessionId: "session_1",
          threadId: "thread_1",
          turnId: "live_turn_1",
          payload: {
            method: CodexNotificationMethod.TurnCompleted,
            params: {
              threadId: "thread_1",
              turnId: "live_turn_1",
              turn: {
                id: "live_turn_1",
                items: [
                  {
                    id: "live_user_1",
                    type: "userMessage",
                    clientId: "msg_1",
                    content: [{ type: "text", text: "你好测试", text_elements: [] }]
                  },
                  {
                    id: "live_agent_1",
                    type: "agentMessage",
                    text: "你好，我在。"
                  }
                ],
                itemsView: "full",
                status: "completed",
                error: null,
                startedAt: 1,
                completedAt: 2,
                durationMs: 1_000
              }
            }
          }
        }),
        makeEvent({
          seq: 2,
          type: "codex.notification",
          sessionId: "session_1",
          threadId: "thread_1",
          turnId: "live_turn_2",
          payload: {
            method: CodexNotificationMethod.TurnCompleted,
            params: {
              threadId: "thread_1",
              turnId: "live_turn_2",
              turn: {
                id: "live_turn_2",
                items: [
                  {
                    id: "live_user_2",
                    type: "userMessage",
                    clientId: "msg_2",
                    content: [{ type: "text", text: "再次测试", text_elements: [] }]
                  },
                  {
                    id: "live_agent_2",
                    type: "agentMessage",
                    text: "收到，再次测试正常。"
                  }
                ],
                itemsView: "full",
                status: "completed",
                error: null,
                startedAt: 3,
                completedAt: 4,
                durationMs: 1_000
              }
            }
          }
        })
      ],
      { selectSessions: true }
    );
    const historyTurns: CodexThreadTurn[] = [
      {
        id: "history_user_1",
        items: [
          {
            id: "history_item_user_1",
            type: "userMessage",
            clientId: "msg_1",
            content: [{ type: "text", text: "你好测试", text_elements: [] }]
          }
        ],
        itemsView: "full",
        status: "completed",
        error: null,
        startedAt: 1,
        completedAt: 1,
        durationMs: null
      },
      {
        id: "history_agent_1",
        items: [
          {
            id: "history_item_agent_1",
            type: "agentMessage",
            text: "你好，我在。"
          }
        ],
        itemsView: "full",
        status: "completed",
        error: null,
        startedAt: 2,
        completedAt: 2,
        durationMs: null
      },
      {
        id: "history_user_2",
        items: [
          {
            id: "history_item_user_2",
            type: "userMessage",
            clientId: "msg_2",
            content: [{ type: "text", text: "再次测试", text_elements: [] }]
          }
        ],
        itemsView: "full",
        status: "completed",
        error: null,
        startedAt: 3,
        completedAt: 3,
        durationMs: null
      },
      {
        id: "history_agent_2",
        items: [
          {
            id: "history_item_agent_2",
            type: "agentMessage",
            text: "收到，再次测试正常。"
          }
        ],
        itemsView: "full",
        status: "completed",
        error: null,
        startedAt: 4,
        completedAt: 4,
        durationMs: null
      }
    ];

    const hydrated = hydrateSessionFromTurns(live, "session_1", historyTurns);

    expect(hydrated.chatItems.map((item) => item.text)).toEqual([
      "你好测试",
      "你好，我在。",
      "再次测试",
      "收到，再次测试正常。"
    ]);
    expect(hydrated.chatItems.map((item) => item.turnId)).toEqual([
      "history_user_1",
      "history_agent_1",
      "history_user_2",
      "history_agent_2"
    ]);
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

  it("dedupes canonical user items without clientId by the acknowledged turn", () => {
    const optimistic = addOptimisticUserMessage(
      upsertSessionInWorkspace(makeWorkspace(), makeSession()),
      {
        sessionId: "session_1",
        clientMessageId: "msg_1",
        text: "hello"
      }
    );
    const acknowledged = markOptimisticMessageSent(optimistic, "msg_1", {
      sessionId: "session_1",
      threadId: "thread_1",
      turnId: "turn_1"
    });

    const afterUserProjection = ingestEventsIntoWorkspace(
      acknowledged,
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
                content: [{ type: "text", text: "hello", text_elements: [] }]
              }
            }
          }
        })
      ],
      { selectSessions: true }
    );

    expect(afterUserProjection.chatItems.filter((item) => item.role === "user"))
      .toHaveLength(1);
    expect(afterUserProjection.chatItems[0]).toMatchObject({
      clientMessageId: "msg_1",
      text: "hello",
      turnId: "turn_1",
      meta: {
        appServerItemId: "item_user",
        source: "turn-store"
      }
    });
  });

  it("dedupes when canonical user item arrives before the RPC ack", () => {
    const optimistic = addOptimisticUserMessage(
      upsertSessionInWorkspace(makeWorkspace(), makeSession()),
      {
        sessionId: "session_1",
        clientMessageId: "msg_1",
        text: "hello"
      }
    );
    const projectedBeforeAck = ingestEventsIntoWorkspace(
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
                content: [{ type: "text", text: "hello", text_elements: [] }]
              }
            }
          }
        })
      ],
      { selectSessions: true }
    );

    const acknowledged = markOptimisticMessageSent(projectedBeforeAck, "msg_1", {
      sessionId: "session_1",
      threadId: "thread_1",
      turnId: "turn_1"
    });

    const users = acknowledged.chatItems.filter((item) => item.role === "user");
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({
      clientMessageId: "msg_1",
      text: "hello",
      turnId: "turn_1"
    });
  });

  it("keeps one user message when chat.user echo arrives before the RPC ack", () => {
    const optimistic = addOptimisticUserMessage(
      upsertSessionInWorkspace(makeWorkspace(), makeSession()),
      {
        sessionId: "session_1",
        clientMessageId: "msg_1",
        text: "测试8"
      }
    );

    const afterEcho = ingestEventsIntoWorkspace(
      optimistic,
      [
        makeEvent({
          id: "event_chat_user",
          seq: 1,
          type: "chat.user",
          sessionId: "session_1",
          threadId: "thread_1",
          payload: {
            clientMessageId: "msg_1",
            text: "测试8"
          }
        })
      ],
      { selectSessions: true }
    );
    const echoUsers = afterEcho.chatItems.filter((item) => item.role === "user");
    expect(echoUsers).toHaveLength(1);
    expect(echoUsers[0]).toMatchObject({
      clientMessageId: "msg_1",
      status: "sent",
      turnId: "local-turn:msg_1"
    });

    const acknowledged = markOptimisticMessageSent(afterEcho, "msg_1", {
      sessionId: "session_1",
      threadId: "thread_1",
      turnId: "turn_1"
    });
    const afterProjection = ingestEventsIntoWorkspace(
      acknowledged,
      [
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
              item: {
                id: "item_user",
                type: "userMessage",
                content: [{ type: "text", text: "测试8", text_elements: [] }]
              }
            }
          }
        })
      ],
      { selectSessions: true }
    );

    const users = afterProjection.chatItems.filter((item) => item.role === "user");
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({
      clientMessageId: "msg_1",
      text: "测试8",
      turnId: "turn_1"
    });
  });

  it("clears local thinking when the app-server turn completes", () => {
    let workspace = upsertSessionInWorkspace(makeWorkspace(), makeSession());
    workspace = addOptimisticUserMessage(workspace, {
      sessionId: "session_1",
      clientMessageId: "msg_1",
      text: "测试"
    });
    workspace = markOptimisticMessageSent(workspace, "msg_1", {
      sessionId: "session_1",
      threadId: "thread_1",
      turnId: "turn_1"
    });

    const next = ingestEventsIntoWorkspace(
      workspace,
      [
        makeEvent({
          seq: 1,
          type: "codex.notification",
          sessionId: "session_1",
          threadId: "thread_1",
          turnId: "turn_1",
          payload: {
            method: CodexNotificationMethod.TurnCompleted,
            params: {
              threadId: "thread_1",
              turnId: "turn_1",
              turn: {
                id: "turn_1",
                items: [
                  {
                    id: "item_user",
                    type: "userMessage",
                    content: [{ type: "text", text: "测试", text_elements: [] }]
                  },
                  {
                    id: "item_agent",
                    type: "agentMessage",
                    text: "测试收到。"
                  }
                ],
                itemsView: "full",
                status: "completed",
                error: null,
                startedAt: 1,
                completedAt: 2,
                durationMs: 1000
              }
            }
          }
        })
      ],
      { selectSessions: true }
    );

    expect(next.chatItems.filter((item) => item.meta?.kind === "thinking"))
      .toHaveLength(0);
    expect(next.chatItems.filter((item) => item.role === "user"))
      .toHaveLength(1);
    expect(next.chatItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "assistant",
          text: "测试收到。",
          status: "complete"
        })
      ])
    );
  });

  it("does not reinsert local thinking when a late ack follows a completed turn", () => {
    let workspace = upsertSessionInWorkspace(makeWorkspace(), makeSession());
    workspace = addOptimisticUserMessage(workspace, {
      sessionId: "session_1",
      clientMessageId: "msg_1",
      text: "测试"
    });
    workspace = markOptimisticMessageSent(workspace, "msg_1", {
      sessionId: "session_1",
      threadId: "thread_1",
      turnId: "turn_1"
    });
    workspace = ingestEventsIntoWorkspace(
      workspace,
      [
        makeEvent({
          seq: 1,
          type: "turn.completed",
          sessionId: "session_1",
          threadId: "thread_1",
          turnId: "turn_1",
          payload: {
            threadId: "thread_1",
            turnId: "turn_1"
          }
        })
      ],
      { selectSessions: true }
    );

    const lateAck = markOptimisticMessageSent(workspace, "msg_1", {
      sessionId: "session_1",
      threadId: "thread_1",
      turnId: "turn_1"
    });

    expect(lateAck.chatItems.filter((item) => item.meta?.kind === "thinking"))
      .toHaveLength(0);
    expect(lateAck.chatItems.filter((item) => item.role === "user"))
      .toHaveLength(1);
    expect(lateAck.chatItems.find((item) => item.role === "user")?.status)
      .toBe("complete");
  });

  it("keeps repeated identical user text as separate sends across turns", () => {
    let workspace = upsertSessionInWorkspace(makeWorkspace(), makeSession());
    workspace = addOptimisticUserMessage(workspace, {
      sessionId: "session_1",
      clientMessageId: "msg_1",
      text: "测试"
    });
    workspace = markOptimisticMessageSent(workspace, "msg_1", {
      sessionId: "session_1",
      threadId: "thread_1",
      turnId: "turn_1"
    });
    workspace = addOptimisticUserMessage(workspace, {
      sessionId: "session_1",
      clientMessageId: "msg_2",
      text: "测试"
    });
    workspace = markOptimisticMessageSent(workspace, "msg_2", {
      sessionId: "session_1",
      threadId: "thread_1",
      turnId: "turn_2"
    });

    const next = ingestEventsIntoWorkspace(
      workspace,
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
                id: "item_user_1",
                type: "userMessage",
                content: [{ type: "text", text: "测试", text_elements: [] }]
              }
            }
          }
        }),
        makeEvent({
          seq: 2,
          type: "codex.notification",
          sessionId: "session_1",
          threadId: "thread_1",
          turnId: "turn_2",
          payload: {
            method: CodexNotificationMethod.ItemStarted,
            params: {
              threadId: "thread_1",
              turnId: "turn_2",
              item: {
                id: "item_user_2",
                type: "userMessage",
                content: [{ type: "text", text: "测试", text_elements: [] }]
              }
            }
          }
        })
      ],
      { selectSessions: true }
    );

    const users = next.chatItems.filter((item) => item.role === "user");
    expect(users).toHaveLength(2);
    expect(users.map((item) => item.clientMessageId)).toEqual(["msg_1", "msg_2"]);
    expect(users.map((item) => item.turnId)).toEqual(["turn_1", "turn_2"]);
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
