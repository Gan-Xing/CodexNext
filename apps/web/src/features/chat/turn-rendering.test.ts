import { describe, expect, it } from "vitest";
import type { TurnGroup, TurnGroupItem } from "./chat-state";
import { deriveChatRenderRows, type ChatRenderItem } from "./turn-rendering";

describe("turn rendering", () => {
  it("uses fallback chat items when turn groups are not available", () => {
    const fallback = [renderItem("msg_1", "assistant", "hello")];

    expect(
      deriveChatRenderRows({
        expandedProcessTurnIds: new Set(),
        fallbackItems: fallback,
        turnGroups: undefined
      })
    ).toEqual([
      {
        id: "msg_1",
        item: fallback[0],
        kind: "item"
      }
    ]);
  });

  it("folds completed process items while keeping the final answer expanded", () => {
    const group = turnGroup({
      durationMs: 358_000,
      items: [
        turnItem("user_1", "user", "user", "查一下"),
        turnItem("cmd_1", "process", "command", "$ pnpm test\nok"),
        turnItem("answer_1", "answer", "assistant", "测试通过。")
      ],
      status: "complete"
    });

    const rows = deriveChatRenderRows({
      expandedProcessTurnIds: new Set(),
      fallbackItems: [],
      turnGroups: [group]
    });

    expect(rows.map((row) => row.kind)).toEqual(["item", "processSummary", "item"]);
    expect(rows[1]).toMatchObject({
      expandable: true,
      expanded: false,
      label: "已处理 5m 58s",
      turnId: "turn_1"
    });
    expect(rows[2]).toMatchObject({
      item: expect.objectContaining({
        role: "assistant",
        text: "测试通过。"
      })
    });
  });

  it("expands completed process details only when the turn is opened", () => {
    const group = turnGroup({
      items: [
        turnItem("user_1", "user", "user", "查一下"),
        turnItem("cmd_1", "process", "command", "$ pnpm test\nok"),
        turnItem("answer_1", "answer", "assistant", "测试通过。")
      ],
      status: "complete"
    });

    const rows = deriveChatRenderRows({
      expandedProcessTurnIds: new Set(["turn_1"]),
      fallbackItems: [],
      turnGroups: [group]
    });

    expect(rows.map((row) => row.kind)).toEqual([
      "item",
      "processSummary",
      "item",
      "item"
    ]);
    expect(rows[2]).toMatchObject({
      item: expect.objectContaining({
        role: "command"
      })
    });
    expect(rows[3]).toMatchObject({
      item: expect.objectContaining({
        role: "assistant"
      })
    });
  });

  it("keeps running process details visible", () => {
    const group = turnGroup({
      items: [
        turnItem("user_1", "user", "user", "查一下"),
        turnItem("cmd_1", "process", "command", "$ pnpm test")
      ],
      status: "streaming"
    });

    const rows = deriveChatRenderRows({
      expandedProcessTurnIds: new Set(),
      fallbackItems: [],
      turnGroups: [group]
    });

    expect(rows.map((row) => row.kind)).toEqual(["item", "item"]);
    expect(rows[1]).toMatchObject({
      item: expect.objectContaining({
        role: "command"
      })
    });
  });

  it("does not hide failed process or error rows", () => {
    const group = turnGroup({
      error: { message: "failed" },
      items: [
        turnItem("user_1", "user", "user", "查一下"),
        turnItem("cmd_1", "process", "command", "$ pnpm test", {
          status: "failed"
        }),
        turnItem("err_1", "metadata", "system", "执行失败", {
          metaKind: "error",
          status: "failed"
        })
      ],
      status: "failed"
    });

    const rows = deriveChatRenderRows({
      expandedProcessTurnIds: new Set(),
      fallbackItems: [],
      turnGroups: [group]
    });

    expect(rows.map((row) => row.kind)).toEqual(["item", "item", "item"]);
    expect(rows.map((row) => (row.kind === "item" ? row.item.text : row.label))).toEqual([
      "查一下",
      "$ pnpm test",
      "执行失败"
    ]);
  });
});

function turnGroup(input: {
  durationMs?: number | null;
  error?: unknown | null;
  items: TurnGroupItem[];
  status: TurnGroup["status"];
}): TurnGroup {
  return {
    id: "turn_1",
    status: input.status,
    startedAt: 1_000,
    completedAt: input.status === "complete" ? 2_000 : null,
    durationMs: input.durationMs ?? null,
    error: input.error ?? null,
    items: input.items,
    userItems: input.items.filter((item) => item.kind === "user"),
    processItems: input.items.filter((item) => item.kind === "process"),
    answerItems: input.items.filter((item) => item.kind === "answer"),
    metadataItems: input.items.filter((item) => item.kind === "metadata")
  };
}

function turnItem(
  id: string,
  kind: TurnGroupItem["kind"],
  role: TurnGroupItem["role"],
  text: string,
  input: Partial<TurnGroupItem> = {}
): TurnGroupItem {
  return {
    id,
    kind,
    type:
      kind === "user"
        ? "userMessage"
        : kind === "answer"
          ? "agentMessage"
          : kind === "process"
            ? "commandExecution"
            : "local.error",
    role,
    text,
    status: input.status ?? "complete",
    turnStatus: input.turnStatus ?? "completed",
    ...input
  };
}

function renderItem(
  id: string,
  role: ChatRenderItem["role"],
  text: string,
  status: ChatRenderItem["status"] = "complete"
): ChatRenderItem {
  return {
    id,
    itemId: id,
    kind: role === "user" ? "user" : role === "assistant" ? "answer" : "metadata",
    role,
    text,
    status,
    turnId: "turn_1",
    type: "legacy"
  };
}
