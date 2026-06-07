"use client";

import { useState } from "react";
import type { LocalCodexHistoryEntry } from "../../lib/types";
import { CodexIcon } from "../DesignLab";
import type {
  ProjectThreadGroupData,
  ThreadListItem
} from "../../features/sessions/session-utils";

export function ProjectThreadGroup(props: {
  group: ProjectThreadGroupData;
  historyLoadingKey: string | null;
  onArchiveThread: (item: ThreadListItem) => void;
  onHideThreadPreview: () => void;
  onShowThreadPreview: (target: HTMLElement, title: string) => void;
  onTogglePinnedThread: (threadId: string) => void;
  onSelectHistory: (entry: LocalCodexHistoryEntry) => void;
  onSelectSession: (sessionId: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [expandedItems, setExpandedItems] = useState(false);
  const visibleItems = expandedItems ? props.group.items : props.group.items.slice(0, 5);
  const hiddenCount = Math.max(0, props.group.items.length - visibleItems.length);

  return (
    <div className="cn-project-group">
      <button
        className="cn-project-name"
        title={props.group.cwd}
        type="button"
        onClick={() => setCollapsed((value) => !value)}
      >
        <span className="cn-project-heading-copy">
          <CodexIcon name="folder" className="cn-project-icon" />
          <strong>{props.group.name}</strong>
        </span>
        <CodexIcon
          name={collapsed ? "chevronRight" : "chevronDown"}
          className="cn-project-collapse-icon"
        />
      </button>

      {collapsed ? null : (
        <div className="cn-thread-list">
          {visibleItems.map((item) => {
            const loading =
              item.kind === "history" && props.historyLoadingKey === item.id;
            return (
              <article
                key={item.id}
                className={
                  item.selected
                    ? "cn-thread-row selected"
                    : item.pinned
                      ? "cn-thread-row pinned"
                      : "cn-thread-row"
                }
                title={item.title}
                onBlur={(event) => {
                  if (event.relatedTarget instanceof Node) {
                    if (event.currentTarget.contains(event.relatedTarget)) {
                      return;
                    }
                  }
                  props.onHideThreadPreview();
                }}
                onFocus={(event) =>
                  props.onShowThreadPreview(event.currentTarget, item.title)
                }
                onMouseEnter={(event) =>
                  props.onShowThreadPreview(event.currentTarget, item.title)
                }
                onMouseLeave={props.onHideThreadPreview}
              >
                <button
                  className="cn-thread-main"
                  type="button"
                  onClick={() => {
                    props.onHideThreadPreview();
                    if (item.kind === "session") {
                      props.onSelectSession(item.id);
                      return;
                    }
                    if (item.entry) {
                      props.onSelectHistory(item.entry);
                    }
                  }}
                >
                  <span className="cn-thread-title">{item.title}</span>
                  <span className="cn-thread-time">
                    {loading ? "读取中" : item.timeLabel}
                  </span>
                </button>
                <div className="cn-thread-actions">
                  <button
                    className={item.pinned ? "cn-thread-action active" : "cn-thread-action"}
                    type="button"
                    aria-label={item.pinned ? "取消置顶" : "置顶"}
                    onClick={() => {
                      props.onHideThreadPreview();
                      props.onTogglePinnedThread(item.threadId);
                    }}
                  >
                    <CodexIcon name="pin" />
                  </button>
                  <button
                    className="cn-thread-action"
                    type="button"
                    aria-label="归档"
                    onClick={() => {
                      props.onHideThreadPreview();
                      props.onArchiveThread(item);
                    }}
                  >
                    <CodexIcon name="archive" />
                  </button>
                </div>
              </article>
            );
          })}
          {props.group.items.length > 5 ? (
            <button
              className="cn-thread-list-toggle"
              type="button"
              onClick={() => setExpandedItems((value) => !value)}
            >
              {expandedItems ? "折叠显示" : "展开显示"}
              {!expandedItems && hiddenCount > 0 ? ` · ${hiddenCount}` : ""}
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
