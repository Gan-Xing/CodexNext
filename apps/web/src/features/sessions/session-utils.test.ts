import { describe, expect, it } from "vitest";
import type { LocalCodexHistoryEntry, LocalSessionSummary } from "../../lib/types";
import type { TurnGroup } from "../chat/chat-state";
import {
  groupProjectThreads,
  makeHistoryPreviewSession,
  sessionTitleFromTurnGroups
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
    queuedMessages: [],
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

function makeTurnGroup(userText: string): TurnGroup {
  return {
    id: "turn_1",
    status: "complete",
    startedAt: 1,
    completedAt: 2,
    durationMs: 1000,
    error: null,
    userItems: [
      {
        id: "user_1",
        kind: "user",
        role: "user",
        status: "sent",
        text: userText,
        turnStatus: "completed",
        type: "userMessage"
      }
    ],
    processItems: [],
    answerItems: [],
    metadataItems: [],
    items: []
  };
}

describe("session sidebar titles", () => {
  it("prefers the live session title when present", () => {
    expect(
      sessionTitleFromTurnGroups(
        makeSession({ title: "实时会话标题" }),
        [makeTurnGroup("当前 TurnGroup 标题")],
        [makeHistoryEntry()]
      )
    ).toBe("实时会话标题");
  });

  it("falls back to the matching history title", () => {
    expect(sessionTitleFromTurnGroups(makeSession(), [], [makeHistoryEntry()])).toBe(
      "官方 Codex 标题"
    );
  });

  it("uses selected turn groups before falling back to cwd", () => {
    expect(
      sessionTitleFromTurnGroups(
        makeSession({ threadId: "thread_missing" }),
        [makeTurnGroup("这是当前 TurnGroup 的标题")],
        []
      )
    ).toBe("这是当前 TurnGroup 的标题");
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
      {},
      { pinned: [] },
      { hidden: [], pinned: [], renamed: {} },
      null,
      null
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.items.map((item) => item.id)).toEqual(["session_2"]);
  });

  it("uses precomputed turn-group titles for session rows", () => {
    const groups = groupProjectThreads(
      [makeSession({ title: null, threadId: "thread_missing" })],
      [],
      { session_1: "TurnGroup 派生标题" },
      { pinned: [] },
      { hidden: [], pinned: [], renamed: {} },
      null,
      null
    );

    expect(groups[0]?.items[0]?.title).toBe("TurnGroup 派生标题");
  });

  it("attaches sidebar notices to the matching thread item", () => {
    const entry = makeHistoryEntry({ id: "thread_notice" });
    const groups = groupProjectThreads(
      [],
      [entry],
      {},
      { pinned: [] },
      { hidden: [], pinned: [], renamed: {} },
      null,
      `${entry.id}::${entry.cwd}`,
      {
        [`${entry.id}::${entry.cwd}`]: {
          text: "文件夹不存在：/tmp/codexnext",
          tone: "danger"
        }
      }
    );

    expect(groups[0]?.items[0]).toMatchObject({
      id: `${entry.id}::${entry.cwd}`,
      note: "文件夹不存在：/tmp/codexnext",
      noteTone: "danger"
    });
  });

  it("uses readable sidebar titles instead of raw terminal logs", () => {
    const logEntry = makeHistoryEntry({
      title: [
        "> daily-work@0.1.0 build /Users/ganxing/Desktop/Dev/dailywork",
        "> prisma generate && next build",
        "Environment variables loaded from .env",
        " ✓ Creating an optimized production build",
        "Failed to compile.",
        "ganxing@mac-mini dailywork % 修复bug"
      ].join("\n")
    });

    const groups = groupProjectThreads(
      [],
      [logEntry],
      {},
      { pinned: [] },
      { hidden: [], pinned: [], renamed: {} },
      null,
      null
    );

    expect(groups[0]?.items[0]?.title).toBe("修复bug");
  });

  it("keeps diagnostic titles concise when no prompt input exists", () => {
    const logEntry = makeHistoryEntry({
      title: [
        " ✓ Compiled successfully",
        "   Linting and checking validity of types  ..Failed to compile.",
        "Type error: Property 'sideLabel' does not exist on type Segment."
      ].join("\n")
    });

    const groups = groupProjectThreads(
      [],
      [logEntry],
      {},
      { pinned: [] },
      { hidden: [], pinned: [], renamed: {} },
      null,
      null
    );

    expect(groups[0]?.items[0]?.title).toBe(
      "Type error: Property 'sideLabel' does not exist on type Seg…"
    );
  });

  it("excludes history entries whose folders no longer exist", () => {
    const missingEntry = makeHistoryEntry({
      id: "thread_missing_folder",
      cwd: "/missing/repo",
      cwdExists: false
    });
    const validEntry = makeHistoryEntry({
      id: "thread_valid",
      cwd: "/repo",
      cwdExists: true
    });

    const groups = groupProjectThreads(
      [],
      [missingEntry, validEntry],
      {},
      { pinned: [] },
      { hidden: [], pinned: [], renamed: {} },
      null,
      `${missingEntry.id}::${missingEntry.cwd}`
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.cwd).toBe("/repo");
    expect(groups[0]?.items.map((item) => item.id)).toEqual([
      `${validEntry.id}::${validEntry.cwd}`
    ]);
  });
});
