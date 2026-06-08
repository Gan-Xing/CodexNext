"use client";

import { useEffect, useRef, useState } from "react";
import type { LocalCodexHistoryEntry } from "../../lib/types";
import { CodexIcon } from "../DesignLab";
import type {
  ProjectThreadGroupData,
  ThreadListItem
} from "../../features/sessions/session-utils";

export function ProjectThreadGroup(props: {
  group: ProjectThreadGroupData;
  onArchiveProject: (group: ProjectThreadGroupData) => void;
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
          <CodexIcon
            name={collapsed ? "chevronRight" : "chevronDown"}
            className="cn-project-collapse-icon"
          />
        </button>
        <div className="cn-project-header-actions">
          <button
            className="cn-project-header-action"
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
                props.onArchiveProject(props.group);
              }}
            >
              <CodexIcon name="archive" />
              <span>归档对话</span>
            </button>
            <button
              className="cn-project-menu-item danger"
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
