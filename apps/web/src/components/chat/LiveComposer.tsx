"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject
} from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import type {
  LocalPermissionMode,
  LocalQueuedMessage,
  LocalReasoningEffort
} from "../../lib/types";
import type { AttachmentDraft } from "../../features/chat/chat-state";
import { CodexIcon, type CodexIconName } from "../DesignLab";

interface ReasoningOption {
  label: string;
  value: LocalReasoningEffort;
}

interface ModelOption {
  label: string;
  shortLabel: string;
  value: string;
}

interface PermissionOption {
  description: string;
  icon: CodexIconName;
  label: string;
  mode: LocalPermissionMode;
}

type ComposerMenu = "plus" | "model" | "permission";

export function LiveComposer(props: {
  activeMenu: ComposerMenu | null;
  activeTurn: boolean;
  attachments: AttachmentDraft[];
  disabledReason?: string | null;
  draft: string;
  fileInputRef: RefObject<HTMLInputElement | null>;
  goalMode: boolean;
  hasGoal: boolean;
  modelOptions: ModelOption[];
  permissionMode: LocalPermissionMode;
  permissionOptions: PermissionOption[];
  planMode: boolean;
  reasoningEffort: LocalReasoningEffort;
  reasoningOptions: ReasoningOption[];
  queuedMessages: LocalQueuedMessage[];
  selectedModel: ModelOption;
  selectedPermission: PermissionOption;
  selectedReasoning: ReasoningOption;
  onActivateGoalMode: () => void;
  onAttachFiles: (files: FileList | null) => void;
  onClearGoal: () => void;
  onCloseMenu: () => void;
  onDismissGoalMode: () => void;
  onDraftChange: (value: string) => void;
  onInterrupt: () => void;
  onOpenMenu: (menu: ComposerMenu) => void;
  onRemoveAttachment: (attachment: AttachmentDraft) => void;
  onQueuedMessageDelete: (clientMessageId: string) => void;
  onQueuedMessageEdit: (clientMessageId: string, text: string) => void;
  onQueuedMessageReorder: (clientMessageIds: string[]) => void;
  onQueuedMessageSteer: (clientMessageId: string) => void;
  onQueuedMessagesClear: () => void;
  onSelectModel: (value: string) => void;
  onSelectPermission: (value: LocalPermissionMode) => void;
  onSelectReasoning: (value: LocalReasoningEffort) => void;
  onSubmit: () => void;
  onSubmitGuide: () => void;
  onTogglePlanMode: () => void;
}) {
  const footerRef = useRef<HTMLElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const menuPanelRef = useRef<HTMLDivElement | null>(null);
  const plusButtonRef = useRef<HTMLButtonElement | null>(null);
  const permissionButtonRef = useRef<HTMLButtonElement | null>(null);
  const modelButtonRef = useRef<HTMLButtonElement | null>(null);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>();
  const [draggingQueuedId, setDraggingQueuedId] = useState<string | null>(null);
  const [editingQueuedId, setEditingQueuedId] = useState<string | null>(null);
  const [editingQueuedText, setEditingQueuedText] = useState("");
  const [queuedMenuId, setQueuedMenuId] = useState<string | null>(null);
  const composerDisabled = Boolean(props.disabledReason);
  const hasDraft = props.draft.trim().length > 0;
  const showInterrupt = props.activeTurn && !hasDraft && !composerDisabled;
  const showGuideSubmit = props.activeTurn && hasDraft && !composerDisabled && !props.goalMode;
  const showGoalPill = props.goalMode || props.hasGoal;
  const showQueuedMessages = props.queuedMessages.length > 0;
  const placeholder = props.disabledReason
    ? props.disabledReason
    : props.goalMode
    ? "Codex 应继续朝哪个目标努力？"
    : props.activeTurn
      ? "继续输入..."
      : props.planMode
        ? "先描述你想让我规划什么"
        : "发消息...";

  function closeMenuAfterSelect() {
    props.onCloseMenu();
  }

  function focusTextarea() {
    window.setTimeout(() => {
      textareaRef.current?.focus();
    }, 0);
  }

  function selectReasoning(value: LocalReasoningEffort) {
    props.onSelectReasoning(value);
    closeMenuAfterSelect();
  }

  function selectModel(value: string) {
    props.onSelectModel(value);
    closeMenuAfterSelect();
  }

  function selectPermission(value: LocalPermissionMode) {
    props.onSelectPermission(value);
    closeMenuAfterSelect();
  }

  function openFilePicker() {
    closeMenuAfterSelect();
    props.fileInputRef.current?.click();
  }

  function reorderQueuedMessage(sourceId: string, targetId: string) {
    if (sourceId === targetId) {
      return;
    }
    const ids = props.queuedMessages.map((message) => message.clientMessageId);
    const sourceIndex = ids.indexOf(sourceId);
    const targetIndex = ids.indexOf(targetId);
    if (sourceIndex < 0 || targetIndex < 0) {
      return;
    }
    ids.splice(sourceIndex, 1);
    ids.splice(targetIndex, 0, sourceId);
    props.onQueuedMessageReorder(ids);
  }

  function beginEditQueuedMessage(message: LocalQueuedMessage) {
    setQueuedMenuId(null);
    setEditingQueuedId(message.clientMessageId);
    setEditingQueuedText(message.text);
  }

  function commitQueuedMessageEdit() {
    if (!editingQueuedId) {
      return;
    }
    const text = editingQueuedText.trim();
    const id = editingQueuedId;
    setEditingQueuedId(null);
    setEditingQueuedText("");
    if (text) {
      props.onQueuedMessageEdit(id, text);
    }
  }

  function cancelQueuedMessageEdit() {
    setEditingQueuedId(null);
    setEditingQueuedText("");
  }

  function togglePlanMode() {
    props.onTogglePlanMode();
    focusTextarea();
  }

  function activateGoalMode() {
    props.onActivateGoalMode();
    focusTextarea();
  }

  function handleMenuPointerAction(
    event: ReactPointerEvent<HTMLButtonElement>,
    action: () => void
  ) {
    event.preventDefault();
    action();
  }

  function handleMenuKeyboardClick(
    event: ReactMouseEvent<HTMLButtonElement>,
    action: () => void
  ) {
    if (event.detail !== 0) {
      return;
    }
    event.preventDefault();
    action();
  }

  function resolveMenuStyle(menu: ComposerMenu): CSSProperties | undefined {
    if (typeof window === "undefined" || window.innerWidth <= 900) {
      return undefined;
    }

    const footer = footerRef.current;
    const trigger =
      menu === "plus"
        ? plusButtonRef.current
        : menu === "permission"
          ? permissionButtonRef.current
          : modelButtonRef.current;

    if (!footer || !trigger) {
      return undefined;
    }

    const footerRect = footer.getBoundingClientRect();
    const triggerRect = trigger.getBoundingClientRect();
    const widthCap = menu === "permission" ? 560 : menu === "model" ? 360 : 300;
    const width = Math.min(widthCap, Math.max(footerRect.width - 24, 220));
    const maxLeft = Math.max(footerRect.width - width, 0);
    const maxHeight = Math.max(220, triggerRect.top - 22);
    let left =
      menu === "model"
        ? triggerRect.right - footerRect.left - width
        : triggerRect.left - footerRect.left;
    left = Math.min(Math.max(left, 0), maxLeft);
    const bottom = Math.max(footerRect.bottom - triggerRect.top + 10, 56);

    return {
      bottom: `${bottom}px`,
      left: `${left}px`,
      maxHeight: `${maxHeight}px`,
      right: "auto",
      width: `${width}px`
    };
  }

  useLayoutEffect(() => {
    if (!props.activeMenu) {
      setMenuStyle(undefined);
      return;
    }

    let frame = 0;
    const update = () => setMenuStyle(resolveMenuStyle(props.activeMenu!));
    const schedule = () => {
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
      frame = window.requestAnimationFrame(update);
    };

    schedule();
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    return () => {
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
    };
  }, [props.activeMenu, props.goalMode, props.hasGoal, props.planMode]);

  useEffect(() => {
    if (!props.activeMenu) {
      return;
    }

    const handlePointerDown = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        props.onCloseMenu();
        return;
      }

      const clickedTrigger =
        plusButtonRef.current?.contains(target) ||
        permissionButtonRef.current?.contains(target) ||
        modelButtonRef.current?.contains(target);
      const clickedMenu = menuPanelRef.current?.contains(target);

      if (clickedTrigger || clickedMenu) {
        return;
      }
      props.onCloseMenu();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        props.onCloseMenu();
      }
    };

    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("mousedown", handlePointerDown, true);
    window.addEventListener("touchstart", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("mousedown", handlePointerDown, true);
      window.removeEventListener("touchstart", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [props.activeMenu, props.onCloseMenu]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || typeof window === "undefined") {
      return;
    }

    const styles = window.getComputedStyle(textarea);
    const lineHeight = Number.parseFloat(styles.lineHeight) || 22;
    const paddingTop = Number.parseFloat(styles.paddingTop) || 0;
    const paddingBottom = Number.parseFloat(styles.paddingBottom) || 0;
    const maxHeight = lineHeight * 8 + paddingTop + paddingBottom;

    textarea.style.height = "auto";
    const nextHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [props.draft, props.goalMode, props.planMode]);

  return (
    <footer
      ref={footerRef}
      className={
        [
          "cn-desktop-composer cn-live-composer",
          props.activeTurn ? "steer" : "",
          composerDisabled ? "disabled" : ""
        ]
          .filter(Boolean)
          .join(" ")
      }
    >
      {showQueuedMessages ? (
        <div className="cn-queued-composer-list" aria-label="排队消息">
          {props.queuedMessages.map((message) => {
            const editing = editingQueuedId === message.clientMessageId;
            const menuOpen = queuedMenuId === message.clientMessageId;
            return (
              <div
                key={message.clientMessageId}
                className={[
                  "cn-queued-composer-item",
                  draggingQueuedId === message.clientMessageId ? "dragging" : ""
                ]
                  .filter(Boolean)
                  .join(" ")}
                onDragOver={(event) => {
                  event.preventDefault();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const sourceId =
                    event.dataTransfer.getData("text/plain") || draggingQueuedId;
                  if (sourceId) {
                    reorderQueuedMessage(sourceId, message.clientMessageId);
                  }
                  setDraggingQueuedId(null);
                }}
              >
                <button
                  className="cn-queued-drag-handle"
                  type="button"
                  title="拖动排序"
                  draggable
                  onDragStart={(event) => {
                    setDraggingQueuedId(message.clientMessageId);
                    event.dataTransfer.setData("text/plain", message.clientMessageId);
                    event.dataTransfer.effectAllowed = "move";
                  }}
                  onDragEnd={() => setDraggingQueuedId(null)}
                >
                  <CodexIcon name="drag" />
                  <CodexIcon name="queued" />
                </button>
                {editing ? (
                  <input
                    className="cn-queued-edit-input"
                    value={editingQueuedText}
                    autoFocus
                    onChange={(event) => setEditingQueuedText(event.target.value)}
                    onBlur={commitQueuedMessageEdit}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        commitQueuedMessageEdit();
                      }
                      if (event.key === "Escape") {
                        cancelQueuedMessageEdit();
                      }
                    }}
                  />
                ) : (
                  <span className="cn-queued-message-text">{message.text}</span>
                )}
                <div className="cn-queued-actions">
                  <button
                    className="cn-queued-action guide"
                    type="button"
                    title="引导当前回复"
                    onClick={() => props.onQueuedMessageSteer(message.clientMessageId)}
                  >
                    <CodexIcon name="guide" />
                    <span>引导</span>
                  </button>
                  <button
                    className="cn-queued-action"
                    type="button"
                    title="删除这条排队消息"
                    onClick={() => props.onQueuedMessageDelete(message.clientMessageId)}
                  >
                    <CodexIcon name="trash" />
                  </button>
                  <button
                    className="cn-queued-action more"
                    type="button"
                    title="更多"
                    onClick={() =>
                      setQueuedMenuId(menuOpen ? null : message.clientMessageId)
                    }
                  >
                    <CodexIcon name="more" />
                  </button>
                  {menuOpen ? (
                    <div className="cn-queued-menu">
                      <button
                        type="button"
                        onClick={() => beginEditQueuedMessage(message)}
                      >
                        <CodexIcon name="edit" />
                        编辑消息
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setQueuedMenuId(null);
                          props.onQueuedMessagesClear();
                        }}
                      >
                        <CodexIcon name="queued" />
                        关闭排队
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
      {props.disabledReason ? (
        <div className="cn-history-locked-composer" role="status">
          <div>
            <strong>无法发送消息</strong>
            <span>{props.disabledReason}</span>
          </div>
        </div>
      ) : null}
      <textarea
        ref={textareaRef}
        aria-label="CodexNext 输入框"
        disabled={composerDisabled}
        name="composer_message"
        placeholder={placeholder}
        value={props.draft}
        onChange={(event) => props.onDraftChange(event.target.value)}
        onKeyDown={(event) => {
          if (
            !composerDisabled &&
            (event.metaKey || event.ctrlKey) &&
            event.key === "Enter" &&
            hasDraft
          ) {
            props.onSubmit();
          }
        }}
      />
      {props.attachments.length > 0 ? (
        <div className="cn-attachment-row">
          {props.attachments.map((attachment) => (
            <button
              key={`${attachment.name}-${attachment.size}`}
              className="cn-attachment-chip"
              type="button"
              onClick={() => props.onRemoveAttachment(attachment)}
              title="移除附件"
            >
              {attachment.name}
              <span>×</span>
            </button>
          ))}
        </div>
      ) : null}
      <div className="cn-composer-toolbar">
        <input
          ref={props.fileInputRef}
          className="cn-hidden-file"
          disabled={composerDisabled}
          multiple
          name="composer_attachments"
          type="file"
          onChange={(event) => props.onAttachFiles(event.target.files)}
        />
        <button
          ref={plusButtonRef}
          className="cn-icon-button"
          type="button"
          title="更多操作"
          disabled={composerDisabled}
          onClick={() => props.onOpenMenu("plus")}
        >
          <CodexIcon name="plus" />
        </button>
        <button
          ref={permissionButtonRef}
          className="cn-composer-pill"
          type="button"
          disabled={composerDisabled}
          onClick={() => props.onOpenMenu("permission")}
        >
          {props.selectedPermission.label}
          <CodexIcon name="chevronDown" />
        </button>
        {props.planMode ? (
          <ComposerModePill
            icon="tasks"
            label="计划模式"
            onClear={props.onTogglePlanMode}
          />
        ) : null}
        {showGoalPill ? (
          <ComposerModePill
            icon="goal"
            label="目标"
            onClear={props.goalMode ? props.onDismissGoalMode : props.onClearGoal}
            onClick={activateGoalMode}
          />
        ) : null}
        {showGuideSubmit ? (
          <button
            className="cn-composer-pill cn-guide-submit-pill"
            type="button"
            title="把这条消息发送到当前正在回复的对话中"
            onClick={props.onSubmitGuide}
          >
            <CodexIcon name="guide" />
            引导对话
          </button>
        ) : null}
        <button
          ref={modelButtonRef}
          className="cn-composer-pill cn-composer-pill-model"
          type="button"
          disabled={composerDisabled}
          onClick={() => props.onOpenMenu("model")}
        >
          {props.selectedModel.shortLabel} {props.selectedReasoning.label}
          <CodexIcon name="chevronDown" />
        </button>
        <button
          className={showInterrupt ? "cn-send-button interrupt" : "cn-send-button"}
          type="button"
          disabled={composerDisabled || (!hasDraft && !showInterrupt)}
          onClick={showInterrupt ? props.onInterrupt : props.onSubmit}
          title={props.disabledReason ?? (showInterrupt ? "打断当前运行" : props.activeTurn ? "排队发送" : "发送")}
        >
          <CodexIcon name={showInterrupt ? "stop" : "arrowUp"} />
        </button>
      </div>

      {props.activeMenu === "plus" ? (
        <div ref={menuPanelRef} className="cn-popover plus cn-live-popover" style={menuStyle}>
          <button
            className="cn-menu-row with-icon compact"
            type="button"
            onPointerDown={(event) => handleMenuPointerAction(event, openFilePicker)}
            onClick={(event) => handleMenuKeyboardClick(event, openFilePicker)}
          >
            <CodexIcon name="imageSquare" />
            <span>
              <strong>添加照片和文件</strong>
            </span>
          </button>
          <div className="cn-menu-divider" />
          <button
            className="cn-menu-row with-icon compact"
            type="button"
            onPointerDown={(event) => handleMenuPointerAction(event, togglePlanMode)}
            onClick={(event) => handleMenuKeyboardClick(event, togglePlanMode)}
          >
            <CodexIcon name="tasks" />
            <span>
              <strong>计划模式</strong>
            </span>
            <ComposerMenuSwitch checked={props.planMode} />
          </button>
          <button
            className="cn-menu-row with-icon compact"
            type="button"
            onPointerDown={(event) => handleMenuPointerAction(event, activateGoalMode)}
            onClick={(event) => handleMenuKeyboardClick(event, activateGoalMode)}
          >
            <CodexIcon name="goal" />
            <span>
              <strong>追求目标</strong>
            </span>
            <ComposerMenuSwitch checked={props.goalMode || props.hasGoal} />
          </button>
        </div>
      ) : null}

      {props.activeMenu === "model" ? (
        <div ref={menuPanelRef} className="cn-popover model cn-live-popover" style={menuStyle}>
          <div className="cn-menu-column">
            <p>推理</p>
            {props.reasoningOptions.map((option) => (
              <button
                key={option.value}
                className={
                  props.reasoningEffort === option.value
                    ? "cn-menu-row selected compact"
                    : "cn-menu-row compact"
                }
                type="button"
                onClick={() => selectReasoning(option.value)}
              >
                <strong>{option.label}</strong>
                {props.reasoningEffort === option.value ? (
                  <em>
                    <CodexIcon name="check" />
                  </em>
                ) : null}
              </button>
            ))}
          </div>
          <div className="cn-menu-divider" />
          <div className="cn-menu-column">
            <p>模型</p>
            {props.modelOptions.map((option) => (
              <button
                key={option.value}
                className={
                  props.selectedModel.value === option.value
                    ? "cn-menu-row selected compact"
                    : "cn-menu-row compact"
                }
                type="button"
                onClick={() => selectModel(option.value)}
              >
                <strong>{option.label}</strong>
                {props.selectedModel.value === option.value ? (
                  <em>
                    <CodexIcon name="check" />
                  </em>
                ) : null}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {props.activeMenu === "permission" ? (
        <div ref={menuPanelRef} className="cn-popover permission cn-live-popover" style={menuStyle}>
          {props.permissionOptions.map((option) => (
            <button
              key={option.mode}
              className={
                props.permissionMode === option.mode
                  ? "cn-menu-row with-icon selected"
                  : "cn-menu-row with-icon"
              }
              type="button"
              onClick={() => selectPermission(option.mode)}
            >
              <CodexIcon name={option.icon} />
              <span>
                <strong>{option.label}</strong>
              </span>
              {props.permissionMode === option.mode ? (
                <em>
                  <CodexIcon name="check" />
                </em>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </footer>
  );
}

function ComposerModePill(props: {
  icon: CodexIconName;
  label: string;
  onClear: () => void;
  onClick?: () => void;
}) {
  return (
    <div className="cn-composer-mode-pill">
      <button
        className="cn-composer-mode-main"
        type="button"
        onClick={props.onClick}
      >
        <CodexIcon name={props.icon} />
        <span>{props.label}</span>
      </button>
      <button
        className="cn-composer-mode-clear"
        type="button"
        aria-label={`移除${props.label}`}
        onClick={props.onClear}
      >
        <CodexIcon name="x" />
      </button>
    </div>
  );
}

function ComposerMenuSwitch(props: { checked: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={props.checked ? "cn-menu-switch checked" : "cn-menu-switch"}
    >
      <span />
    </span>
  );
}
