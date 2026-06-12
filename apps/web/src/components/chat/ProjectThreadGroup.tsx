"use client";

import { useEffect, useRef, useState } from "react";
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
        <span className="cn-thread-copy">
          <span className="cn-thread-title">{props.item.title}</span>
          {props.item.note ? (
            <span
              className={
                props.item.noteTone === "danger"
                  ? "cn-thread-note danger"
                  : "cn-thread-note"
              }
            >
              {props.item.note}
            </span>
          ) : null}
        </span>
        {pinnedVariant ? null : (
          <span className="cn-thread-time">
            {props.item.timeLabel}
          </span>
        )}
      </button>
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
  onArchiveProject: (group: ProjectThreadGroupData) => void | Promise<void>;
  historyLoadingKey: string | null;
  onArchiveThread: (item: ThreadListItem) => void;
  onHideThreadPreview: () => void;
  onRemoveProject: (group: ProjectThreadGroupData) => void;
  onRenameProject: (group: ProjectThreadGroupData) => void;
  onShowThreadPreview: (target: HTMLElement, title: string) => void;
  onStartProjectSession: (cwd: string) => void;
  onTogglePinnedProject: (cwd: string) => void;
  onTogglePinnedThread: (threadId: string) => void;
  onSelectHistory: (entry: LocalCodexHistoryEntry) => void;
  onSelectSession: (sessionId: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [expandedItems, setExpandedItems] = useState(false);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const projectMenuRef = useRef<HTMLDivElement | null>(null);
  const visibleItems = expandedItems ? props.group.items : props.group.items.slice(0, 5);
  const hiddenCount = Math.max(0, props.group.items.length - visibleItems.length);
  const projectPinLabel = props.group.pinned ? "取消置顶项目" : "置顶项目";

  useEffect(() => {
    if (!projectMenuOpen) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      if (
        projectMenuRef.current &&
        event.target instanceof Node &&
        projectMenuRef.current.contains(event.target)
      ) {
        return;
      }
      setProjectMenuOpen(false);
    };
    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [projectMenuOpen]);

  return (
    <div className="cn-project-group">
      <div
        ref={projectMenuRef}
        className={projectMenuOpen ? "cn-project-header menu-open" : "cn-project-header"}
      >
        <button
          className="cn-project-name"
          title={props.group.cwd}
          type="button"
          onClick={() => {
            props.onHideThreadPreview();
            setProjectMenuOpen(false);
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
            className="cn-project-header-action cn-project-header-action-menu"
            type="button"
            aria-label="更多"
            aria-expanded={projectMenuOpen}
            onClick={(event) => {
              event.stopPropagation();
              props.onHideThreadPreview();
              setProjectMenuOpen((value) => !value);
            }}
          >
            <CodexIcon name="more" />
          </button>
          <button
            className="cn-project-header-action"
            type="button"
            aria-label="新建会话"
            onClick={(event) => {
              event.stopPropagation();
              props.onHideThreadPreview();
              setProjectMenuOpen(false);
              props.onStartProjectSession(props.group.cwd);
            }}
          >
            <CodexIcon name="compose" />
          </button>
        </div>
        {projectMenuOpen ? (
          <div className="cn-project-menu" role="menu" aria-label={`${props.group.name} 项目菜单`}>
            <button
              className="cn-project-menu-item"
              type="button"
              role="menuitem"
              onClick={() => {
                setProjectMenuOpen(false);
                props.onTogglePinnedProject(props.group.cwd);
              }}
            >
              <CodexIcon name="pin" />
              <span>{projectPinLabel}</span>
            </button>
            <button
              className="cn-project-menu-item"
              type="button"
              role="menuitem"
              onClick={() => {
                setProjectMenuOpen(false);
                props.onRenameProject(props.group);
              }}
            >
              <CodexIcon name="edit" />
              <span>重命名项目</span>
            </button>
            <button
              className="cn-project-menu-item"
              type="button"
              role="menuitem"
              onClick={() => {
                setProjectMenuOpen(false);
                void props.onArchiveProject(props.group);
              }}
            >
              <CodexIcon name="archive" />
              <span>归档对话</span>
            </button>
            <button
              className="cn-project-menu-item"
              type="button"
              role="menuitem"
              onClick={() => {
                setProjectMenuOpen(false);
                props.onRemoveProject(props.group);
              }}
            >
              <CodexIcon name="x" />
              <span>移除</span>
            </button>
          </div>
        ) : null}
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
              <span className="cn-thread-list-toggle-label">
                {expandedItems ? "折叠显示" : "展开显示"}
                {!expandedItems && hiddenCount > 0 ? ` · ${hiddenCount}` : ""}
              </span>
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
