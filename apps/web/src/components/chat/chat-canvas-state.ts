import type { ResumeState } from "../../features/chat/chat-state";

export interface ThreadEmptyState {
  detail: string;
  title: string;
}

export function resolveThreadEmptyState(input: {
  historyLoading: boolean;
  historyPreview: boolean;
  resumeState: ResumeState | null;
}): ThreadEmptyState {
  if (input.resumeState === "missing") {
    return {
      title: "原项目已不存在",
      detail: "这条历史对应的目录已经不在当前设备上了，请新建对话继续。"
    };
  }

  if (input.historyLoading) {
    return {
      title: "正在恢复这条会话",
      detail: "侧栏已经恢复，消息内容会在后台继续同步，不需要重新点一次。"
    };
  }

  if (input.historyPreview) {
    return {
      title: "这条历史里还没有正文",
      detail:
        "这不是卡住了。这个线程没有保存出可显示的历史消息，你可以直接继续输入，发送后会从这里接着恢复。"
    };
  }

  if (input.resumeState === "failed") {
    return {
      title: "这条会话暂时打不开",
      detail: "可以再试一次；如果还是不行，直接新建一条对话更稳。"
    };
  }

  return {
    title: "还没有消息",
    detail: "直接在下面输入，第一条消息发出去后这里就会出现正文。"
  };
}
