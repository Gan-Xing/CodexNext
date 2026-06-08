import { describe, expect, it } from "vitest";
import type { CodexThread } from "../src/index.js";
import {
  deriveCodexConversationTitle,
  deriveCodexGeneratedTitle,
  normalizeCodexConversationTitle
} from "../src/index.js";

function makeThread(input: Partial<CodexThread> & Pick<CodexThread, "id" | "cwd">): CodexThread {
  return {
    preview: "",
    createdAt: 1,
    updatedAt: 1,
    turns: [],
    ...input
  };
}

describe("Codex conversation titles", () => {
  it("prefers explicit titles without generated truncation", () => {
    const title = deriveCodexConversationTitle(
      makeThread({
        id: "thread_1",
        cwd: "/tmp/demo",
        title: "## 这是一个明确标题，会保留完整长度而不是裁成六十字符"
      })
    );

    expect(title).toBe("这是一个明确标题，会保留完整长度而不是裁成六十字符");
  });

  it("derives generated titles from the first turn input", () => {
    const title = deriveCodexConversationTitle(
      makeThread({
        id: "thread_1",
        cwd: "/tmp/demo",
        turns: [
          {
            id: "turn_1",
            items: [],
            params: {
              input: [
                {
                  type: "text",
                  text: "请帮我检查这个项目里所有跟 sidebar title 相关的逻辑，并给出一个更接近原生 Codex 的修复方案，同时把 agent 和 web 的标题链路一起统一掉，避免多端再次分叉。"
                }
              ]
            }
          }
        ]
      })
    );

    expect(title).toBe(
      "请帮我检查这个项目里所有跟 sidebar title 相关的逻辑，并给出一个更接近原生 Codex 的修复方案，同时…"
    );
  });

  it("falls back to the first comment body when text input is absent", () => {
    const title = deriveCodexConversationTitle(
      makeThread({
        id: "thread_1",
        cwd: "/tmp/demo",
        turns: [
          {
            id: "turn_1",
            items: [],
            params: {
              commentAttachments: [{ body: "  只根据评论正文来生成标题  " }]
            }
          }
        ]
      })
    );

    expect(title).toBe("只根据评论正文来生成标题");
  });

  it("falls back to a collab prompt when the thread is a side conversation", () => {
    const child = makeThread({
      id: "thread_child",
      cwd: "/tmp/demo",
      turns: []
    });
    const parent = makeThread({
      id: "thread_parent",
      cwd: "/tmp/demo",
      turns: [
        {
          id: "turn_1",
          items: [
            {
              type: "collabAgentToolCall",
              receiverThreadIds: ["thread_child"],
              prompt: "继续调查这个构建错误的根因，并确认是不是 hydration mismatch。"
            }
          ]
        }
      ]
    });

    expect(deriveCodexConversationTitle(child, [parent, child])).toBe(
      "继续调查这个构建错误的根因，并确认是不是 hydration mismatch。"
    );
  });

  it("normalizes markdown and generated preview text like native Codex", () => {
    expect(
      normalizeCodexConversationTitle("  - [x] **检查** [sidebar](https://example.com)  标题  ")
    ).toBe("检查 sidebar 标题");
    expect(
      deriveCodexGeneratedTitle(
        "  这个 preview 会被压成单行，并且如果超长就会按照原生 Codex 的方式裁切到六十个字符以内展示给用户看，同时避免多端看到不同标题这种体验偏差  "
      )
    ).toBe(
      "这个 preview 会被压成单行，并且如果超长就会按照原生 Codex 的方式裁切到六十个字符以内展示给用户看，同时…"
    );
  });
});
