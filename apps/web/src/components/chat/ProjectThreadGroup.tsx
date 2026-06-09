"use client";

import { useState } from "react";
import type { LocalCodexHistoryEntry } from "../../lib/types";
import { CodexIcon } from "../DesignLab";
import type {
  ProjectThreadGroupData,
  ThreadListItem
} from "../../features/sessions/session-utils";

interface ThreadRowHandlers {
  historyLoadingKey: string | null;
  onArchiveThread: (item: ThreadListItem) => void;
  onHideThreadPreview: () => void;
  onShowThreadPreview: (target: HTMLElement, title: string) => void;
  onTogglePinnedThread: (threadId: string) => void;
  onSelectHistory: (entry: LocalCodexHistoryEntry) => void;
  onSelectSession: (sessionId: string) => void;
}

function selectThread(
  item: ThreadListItem,
  handlers: Pick<ThreadRowHandlers, "onSelectHistory" | "onSelectSession">
) {
  if (item.kind === "session") {
    handlers.onSelectSession(item.id);
    return;
  }
  if (item.entry) {
    handlers.onSelectHistory(item.entry);
  }
}

function SidebarThreadRow(
  props: ThreadRowHandlers & {
    item: ThreadListItem;
    variant?: "default" | "pinned";
  }
) {
  const loading =
    props.item.kind === "history" && props.historyLoadingKey === props.item.id;
  const pinnedVariant = props.variant === "pinned";

  return (
    <article
      key={props.item.id}
      className={
        props.item.selected
          ? pinnedVariant
            ? "cn-thread-row cn-pinned-thread-row selected"
            : "cn-thread-row selected"
          : props.item.pinned
            ? pinnedVariant
              ? "cn-thread-row cn-pinned-thread-row pinned"
              : "cn-thread-row pinned"
            : pinnedVariant
              ? "cn-thread-row cn-pinned-thread-row"
              : "cn-thread-row"
      }
      title={props.item.title}
      onBlur={(event) => {
        if (event.relatedTarget instanceof Node) {
          if (event.currentTarget.contains(event.relatedTarget)) {
            return;
          }
        }
        props.onHideThreadPreview();
      }}
      onFocus={(event) =>
        props.onShowThreadPreview(event.currentTarget, props.item.title)
      }
      onMouseEnter={(event) =>
        props.onShowThreadPreview(event.currentTarget, props.item.title)
      }
      onMouseLeave={props.onHideThreadPreview}
    >
      <button
        className={pinnedVariant ? "cn-thread-main cn-pinned-thread-main" : "cn-thread-main"}
        type="button"
        onClick={() => {
          props.onHideThreadPreview();
          selectThread(props.item, props);
        }}
      >
        <span className="cn-thread-title">{props.item.title}</span>
        {pinnedVariant ? null : (
          <span className="cn-thread-time">
            {loading ? "读取中" : props.item.timeLabel}
          </span>
        )}
      </button>
      {pinnedVariant ? (
        <button
          className="cn-thread-pin-inline"
          type="button"
          aria-label={props.item.pinned ? "取消置顶" : "置顶"}
          onClick={() => {
            props.onHideThreadPreview();
            props.onTogglePinnedThread(props.item.threadId);
          }}
        >
          <CodexIcon name="pin" />
        </button>
      ) : (
        <div className="cn-thread-actions">
          <button
            className={props.item.pinned ? "cn-thread-action active" : "cn-thread-action"}
            type="button"
            aria-label={props.item.pinned ? "取消置顶" : "置顶"}
            onClick={() => {
              props.onHideThreadPreview();
              props.onTogglePinnedThread(props.item.threadId);
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
              props.onArchiveThread(props.item);
            }}
          >
            <CodexIcon name="archive" />
          </button>
        </div>
      )}
    </article>
  );
}

export function PinnedThreadSection(
  props: ThreadRowHandlers & {
    items: ThreadListItem[];
  }
) {
  const [collapsed, setCollapsed] = useState(false);

  if (!props.items.length) {
    return null;
  }

  return (
    <div className="cn-pinned-section">
      <button
        className="cn-pinned-header"
        type="button"
        onClick={() => setCollapsed((value) => !value)}
      >
        <span>置顶</span>
        <CodexIcon name={collapsed ? "chevronRight" : "chevronDown"} />
      </button>
      {collapsed ? null : (
        <div className="cn-thread-list cn-pinned-thread-list">
          {props.items.map((item) => (
            <SidebarThreadRow key={item.id} {...props} item={item} variant="pinned" />
          ))}
        </div>
      )}
    </div>
  );
}

export function ProjectThreadGroup(props: {
  group: ProjectThreadGroupData;
  historyLoadingKey: string | null;
  onArchiveThread: (item: ThreadListItem) => void;
  onHideThreadPreview: () => void;
  onShowThreadPreview: (target: HTMLElement, title: string) => void;
  onStartProjectSession: (cwd: string) => void;
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
      <div className="cn-project-header">
        <button
          className="cn-project-name"
          title={props.group.cwd}
          type="button"
          onClick={() => {
            props.onHideThreadPreview();
            setCollapsed((value) => !value);
          }}
        >
          <span className="cn-project-heading-copy">
            <CodexIcon name="folder" className="cn-project-icon" />
            <strong>{props.group.name}</strong>
          </span>
        </button>
        <div className="cn-project-header-actions">
          <button
            className="cn-project-header-action"
            type="button"
            aria-label="新建会话"
            onClick={(event) => {
              event.stopPropagation();
              props.onHideThreadPreview();
              props.onStartProjectSession(props.group.cwd);
            }}
          >
            <CodexIcon name="compose" />
          </button>
        </div>
      </div>

      {collapsed ? null : (
        <div className="cn-thread-list">
          {visibleItems.map((item) => {
            return (
              <SidebarThreadRow
                key={item.id}
                {...props}
                item={item}
              />
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
