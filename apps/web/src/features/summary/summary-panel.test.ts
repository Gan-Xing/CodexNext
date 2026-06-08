import { describe, expect, it } from "vitest";
import type { ChatItem, LocalEvent, PendingApprovalView } from "../../lib/types";
import { buildSummaryPanelData, summaryVisibleRows } from "./summary-panel";

function makeChatItem(input: Partial<ChatItem> & Pick<ChatItem, "id" | "role" | "text">): ChatItem {
  return {
    id: input.id,
    role: input.role,
    text: input.text,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.turnId ? { turnId: input.turnId } : {}),
    ...(input.status ? { status: input.status } : {})
  };
}

function makeEvent(input: Partial<LocalEvent> & Pick<LocalEvent, "id" | "seq" | "type">): LocalEvent {
  return {
    id: input.id,
    seq: input.seq,
    ts: input.ts ?? input.seq,
    type: input.type,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.turnId ? { turnId: input.turnId } : {}),
    ...(input.payload !== undefined ? { payload: input.payload } : {})
  };
}

function makeApproval(
  input: Partial<PendingApprovalView> & Pick<PendingApprovalView, "approvalId" | "sessionId" | "method" | "params">
): PendingApprovalView {
  return {
    approvalId: input.approvalId,
    sessionId: input.sessionId,
    method: input.method,
    params: input.params,
    createdAt: input.createdAt ?? 1,
    expiresAt: input.expiresAt ?? 2
  };
}

describe("buildSummaryPanelData", () => {
  it("extracts referenced local files as outputs from non-user messages", () => {
    const summary = buildSummaryPanelData({
      chatItems: [
        makeChatItem({
          id: "user-1",
          role: "user",
          text: "请看一下 /Users/demo/repo/PRIVATE_NOTES.md"
        }),
        makeChatItem({
          id: "assistant-1",
          role: "assistant",
          text: [
            "先看这几个文件：",
            "[README.md](/Users/demo/repo/README.md:1)",
            "[ARCHITECTURE.md](/Users/demo/repo/docs/ARCHITECTURE.md:12)"
          ].join("\n")
        })
      ],
      events: [],
      pendingApprovals: []
    });

    expect(summary.outputs).toEqual([
      {
        key: "/Users/demo/repo/README.md",
        title: "README.md",
        detail: "/Users/demo/repo/README.md"
      },
      {
        key: "/Users/demo/repo/docs/ARCHITECTURE.md",
        title: "ARCHITECTURE.md",
        detail: "/Users/demo/repo/docs/ARCHITECTURE.md"
      }
    ]);
  });

  it("extracts tasks from command-like event payloads and approvals", () => {
    const summary = buildSummaryPanelData({
      chatItems: [],
      events: [
        makeEvent({
          id: "turn-complete-1",
          seq: 2,
          type: "turn.completed",
          payload: {
            turn: {
              items: [
                { type: "command", command: "pnpm --filter @codexnext/web dev" },
                { type: "command", command: "pnpm --filter @codexnext/agent dev" }
              ]
            }
          }
        })
      ],
      pendingApprovals: [
        makeApproval({
          approvalId: "approval-1",
          sessionId: "session-1",
          method: "item/commandExecution/requestApproval",
          params: { command: "git push origin main" }
        })
      ]
    });

    expect(summary.tasks.map((item) => item.title)).toEqual([
      "git push origin main",
      "pnpm --filter @codexnext/web dev",
      "pnpm --filter @codexnext/agent dev"
    ]);
    expect(summary.tasks[0]?.detail).toBe("等待批准");
  });

  it("extracts source badges from session evidence", () => {
    const summary = buildSummaryPanelData({
      chatItems: [
        makeChatItem({
          id: "assistant-2",
          role: "assistant",
          text: "主要来源：Context7、Figma、Playwright 和 https://github.com/openai/codex"
        })
      ],
      events: [
        makeEvent({
          id: "event-1",
          seq: 1,
          type: "codex.notification",
          payload: {
            tool: "browser-use",
            source: "mcp"
          }
        })
      ],
      pendingApprovals: []
    });

    expect(summary.sources).toEqual([
      { key: "context7", label: "Context7", icon: "plug" },
      { key: "figma", label: "Figma", icon: "plug" },
      { key: "browser-mcp", label: "Browser MCP", icon: "browserUse" },
      { key: "playwright", label: "Playwright", icon: "browserUse" },
      { key: "github", label: "GitHub", icon: "github" }
    ]);
  });

  it("uses six rows as the default collapsed summary size", () => {
    expect(summaryVisibleRows()).toBe(6);
  });
});
