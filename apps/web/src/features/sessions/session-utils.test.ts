import { describe, expect, it } from "vitest";
import type { ChatItem, LocalCodexHistoryEntry, LocalSessionSummary } from "../../lib/types";
import {
  groupProjectThreads,
  makeHistoryPreviewSession,
  sessionTitle
} from "./session-utils";

function makeSession(overrides: Partial<LocalSessionSummary> = {}): LocalSessionSummary {
  return {
    sessionId: "session_1",
    threadId: "thread_1",
    status: "idle",
    cwd: "/tmp/codexnext",
    title: null,
    model: null,
    reasoningEffort: null,
    permissionMode: "request-approval",
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    sandbox: "workspace-write",
    goal: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  };
}

function makeHistoryEntry(overrides: Partial<LocalCodexHistoryEntry> = {}): LocalCodexHistoryEntry {
  return {
    id: "thread_1",
    cwd: "/tmp/codexnext",
    title: "官方 Codex 标题",
    createdAt: new Date(1).toISOString(),
    updatedAt: new Date(1).toISOString(),
    source: "appServer",
    ...overrides
  };
}

describe("session sidebar titles", () => {
  it("prefers the live session title when present", () => {
    expect(
      sessionTitle(makeSession({ title: "实时会话标题" }), [], [makeHistoryEntry()])
    ).toBe("实时会话标题");
  });

  it("falls back to the matching history title", () => {
    expect(sessionTitle(makeSession(), [], [makeHistoryEntry()])).toBe("官方 Codex 标题");
  });

  it("falls back to the first user message before using cwd", () => {
    const items: ChatItem[] = [
      {
        id: "message_1",
        role: "user",
        text: "请帮我把这个会话标题逻辑改成和原生 Codex 一样",
        sessionId: "session_1",
        status: "sending"
      }
    ];

    expect(sessionTitle(makeSession({ threadId: "thread_missing" }), items, [])).toBe(
      "请帮我把这个会话标题逻辑改成和原生 Codex 一样"
    );
  });

  it("hydrates history preview sessions with the history title", () => {
    const entry = makeHistoryEntry({ title: "从历史线程恢复的标题" });
    expect(makeHistoryPreviewSession(entry).title).toBe("从历史线程恢复的标题");
  });

  it("excludes pending sessions from sidebar groups", () => {
    const groups = groupProjectThreads(
      [
        makeSession({
          sessionId: "pending-session:msg_1",
          threadId: "pending-session:msg_1",
          updatedAt: 10
        }),
        makeSession({
          sessionId: "session_2",
          threadId: "thread_2",
          updatedAt: 20,
          cwd: "/tmp/codexnext"
        })
      ],
      [],
      [],
      { pinned: [] },
      { hidden: [], pinned: [], renamed: {} },
      null,
      null
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.items.map((item) => item.id)).toEqual(["session_2"]);
  });

  it("attaches sidebar notices to the matching thread item", () => {
    const entry = makeHistoryEntry({ id: "thread_notice" });
    const groups = groupProjectThreads(
      [],
      [entry],
      [],
      { pinned: [] },
      { hidden: [], pinned: [], renamed: {} },
      null,
      `${entry.id}::${entry.cwd}`,
      {
        [`${entry.id}::${entry.cwd}`]: {
          text: "原项目不存在",
          tone: "danger"
        }
      }
    );

    expect(groups[0]?.items[0]).toMatchObject({
      id: `${entry.id}::${entry.cwd}`,
      note: "原项目不存在",
      noteTone: "danger"
    });
  });
});
