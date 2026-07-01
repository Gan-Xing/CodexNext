import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProjectThreadGroup } from "./chat/ProjectThreadGroup";
import type {
  ProjectThreadGroupData,
  ThreadListItem
} from "../features/sessions/session-utils";

const noop = () => {};

function renderProjectThreadGroup(group: ProjectThreadGroupData): string {
  return renderToStaticMarkup(
    createElement(ProjectThreadGroup, {
      group,
      historyLoadingKey: null,
      onArchiveProject: noop,
      onArchiveThread: noop,
      onHideThreadPreview: noop,
      onRemoveProject: noop,
      onRenameProject: noop,
      onSelectHistory: noop,
      onSelectSession: noop,
      onShowThreadPreview: noop,
      onStartProjectSession: noop,
      onTogglePinnedProject: noop,
      onTogglePinnedThread: noop
    })
  );
}

describe("ProjectThreadGroup rendering", () => {
  it("keeps long mobile sidebar project and thread labels in truncation containers", () => {
    const longProjectName =
      "非常非常长的项目名称 /home/ubuntu/projects/customer-contract-renewal-analysis-with-extra-long-path";
    const longThreadTitle =
      "整理 2026 年所有供应商报价单并比对历史合同条款差异以及生成复核清单";
    const group: ProjectThreadGroupData = {
      cwd: "/home/ubuntu/projects/customer-contract-renewal-analysis-with-extra-long-path",
      entries: [],
      items: [
        threadItem({
          id: "session_selected",
          selected: true,
          title: longThreadTitle
        }),
        threadItem({
          id: "session_missing",
          note: "文件夹不存在：/missing/repo-with-a-very-long-name",
          noteTone: "danger",
          title: "恢复一个路径已经不存在的历史对话"
        }),
        threadItem({ id: "session_3", title: "第三个对话" }),
        threadItem({ id: "session_4", title: "第四个对话" }),
        threadItem({ id: "session_5", title: "第五个对话" }),
        threadItem({ id: "session_6", title: "第六个对话" }),
        threadItem({ id: "session_7", title: "第七个对话" })
      ],
      name: longProjectName,
      pinned: false,
      sessions: [],
      updatedAt: 2
    };

    const markup = renderProjectThreadGroup(group);

    expect(markup).toContain("cn-project-heading-copy");
    expect(markup).toContain(longProjectName);
    expect(markup).toContain(`title="${group.cwd}"`);
    expect(markup).toContain("cn-thread-title");
    expect(markup).toContain(`title="${longThreadTitle}"`);
    expect(markup).toContain("cn-thread-note danger");
    expect(markup).toContain("文件夹不存在");
    expect(markup).toContain("展开显示 · 2");
    expect(markup).not.toContain("第六个对话");
    expect(markup).not.toContain("第七个对话");
  });
});

function threadItem(input: {
  id: string;
  note?: string;
  noteTone?: "danger" | "muted";
  selected?: boolean;
  title: string;
}): ThreadListItem {
  return {
    id: input.id,
    kind: "session",
    ...(input.note ? { note: input.note } : {}),
    ...(input.noteTone ? { noteTone: input.noteTone } : {}),
    pinned: false,
    selected: input.selected ?? false,
    threadId: input.id,
    timeLabel: "刚刚",
    timestamp: 1,
    title: input.title
  };
}
