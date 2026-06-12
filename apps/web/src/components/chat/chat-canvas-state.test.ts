import { describe, expect, it } from "vitest";
import { resolveThreadEmptyState } from "./chat-canvas-state";

describe("resolveThreadEmptyState", () => {
  it("keeps the restoring copy only while history is still loading", () => {
    expect(
      resolveThreadEmptyState({
        historyLoading: true,
        historyPreview: true,
        resumeState: "history"
      })
    ).toEqual({
      title: "正在恢复这条会话",
      detail: "侧栏已经恢复，消息内容会在后台继续同步，不需要重新点一次。"
    });
  });

  it("explains empty history previews once loading has finished", () => {
    expect(
      resolveThreadEmptyState({
        historyLoading: false,
        historyPreview: true,
        resumeState: "history"
      })
    ).toEqual({
      title: "这条历史里还没有正文",
      detail:
        "这不是卡住了。这个线程没有保存出可显示的历史消息，你可以直接继续输入，发送后会从这里接着恢复。"
    });
  });

  it("shows the missing-project state before the generic history-preview copy", () => {
    expect(
      resolveThreadEmptyState({
        historyLoading: false,
        historyPreview: true,
        resumeState: "missing"
      })
    ).toEqual({
      title: "原项目已不存在",
      detail: "这条历史对应的目录已经不在当前设备上了，请新建对话继续。"
    });
  });
});
