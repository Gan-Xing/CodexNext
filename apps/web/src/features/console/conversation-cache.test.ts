import { describe, expect, it } from "vitest";
import { sanitizeConversationCacheEntryForStorage } from "./conversation-cache";

describe("conversation cache storage", () => {
  it("keeps normalized turns even when projection items are empty", () => {
    const entry = sanitizeConversationCacheEntryForStorage({
      conversationKey: "thread_1",
      items: [],
      latestSeq: 9,
      sessionIds: ["session_1"],
      threadId: "thread_1",
      turnOrder: ["turn_1"],
      turns: {
        turn_1: {
          id: "turn_1",
          itemOrder: ["item_user", "item_agent"],
          items: {
            item_user: {
              id: "item_user",
              type: "userMessage",
              kind: "user",
              role: "user",
              text: "你好",
              status: "complete",
              updatedAt: 1
            },
            item_agent: {
              id: "item_agent",
              type: "agentMessage",
              kind: "assistant",
              role: "assistant",
              text: "你好。",
              status: "complete",
              updatedAt: 2
            }
          },
          itemsView: "full",
          status: "completed",
          error: null,
          startedAt: 1,
          completedAt: 2,
          durationMs: 1_000,
          latestSeq: 9
        }
      },
      updatedAt: 3
    });

    expect(entry).toMatchObject({
      conversationKey: "thread_1",
      items: [],
      turnOrder: ["turn_1"],
      turns: {
        turn_1: {
          itemsView: "full",
          status: "completed"
        }
      }
    });
    expect(entry?.turns?.turn_1?.items.item_agent).toMatchObject({
      kind: "assistant",
      role: "assistant",
      text: "你好。"
    });
  });

  it("drops invalid turn ids instead of persisting broken turn order", () => {
    const entry = sanitizeConversationCacheEntryForStorage({
      conversationKey: "thread_1",
      items: [],
      latestSeq: null,
      sessionIds: [],
      threadId: "thread_1",
      turnOrder: ["missing"],
      turns: {},
      updatedAt: 3
    });

    expect(entry).toBeNull();
  });

  it("drops in-progress turns from persistent cache restore", () => {
    const entry = sanitizeConversationCacheEntryForStorage({
      conversationKey: "thread_1",
      items: [],
      latestSeq: null,
      sessionIds: [],
      threadId: "thread_1",
      turnOrder: ["turn_1"],
      turns: {
        turn_1: {
          id: "turn_1",
          itemOrder: ["item_user"],
          items: {
            item_user: {
              id: "item_user",
              type: "userMessage",
              kind: "user",
              role: "user",
              text: "还在执行",
              status: "pending",
              updatedAt: 1
            }
          },
          itemsView: "full",
          status: "inProgress",
          error: null,
          startedAt: 1,
          completedAt: null,
          durationMs: null,
          latestSeq: null
        }
      },
      updatedAt: 3
    });

    expect(entry).toBeNull();
  });
});
