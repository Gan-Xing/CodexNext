"use client";

import { useRef, type RefObject } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import type { LocalPermissionMode, LocalReasoningEffort } from "../../lib/types";
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

export function LiveComposer(props: {
  activeMenu: "plus" | "model" | "permission" | null;
  activeTurn: boolean;
  attachments: AttachmentDraft[];
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
  onOpenMenu: (menu: "plus" | "model" | "permission") => void;
  onRemoveAttachment: (attachment: AttachmentDraft) => void;
  onSelectModel: (value: string) => void;
  onSelectPermission: (value: LocalPermissionMode) => void;
  onSelectReasoning: (value: LocalReasoningEffort) => void;
  onSubmit: () => void;
  onTogglePlanMode: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const hasDraft = props.draft.trim().length > 0;
  const showInterrupt = props.activeTurn && !hasDraft;
  const showGoalPill = props.goalMode || props.hasGoal;
  const placeholder = props.goalMode
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

  return (
    <footer className={props.activeTurn ? "cn-desktop-composer cn-live-composer steer" : "cn-desktop-composer cn-live-composer"}>
      <textarea
        ref={textareaRef}
        aria-label="CodexNext 输入框"
        name="composer_message"
        placeholder={placeholder}
        value={props.draft}
        onChange={(event) => props.onDraftChange(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && hasDraft) {
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
          multiple
          name="composer_attachments"
          type="file"
          onChange={(event) => props.onAttachFiles(event.target.files)}
        />
        <button
          className="cn-icon-button"
          type="button"
          title="更多操作"
          onClick={() => props.onOpenMenu("plus")}
        >
          <CodexIcon name="plus" />
        </button>
        <button
          className="cn-composer-pill"
          type="button"
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
        <button
          className="cn-composer-pill cn-composer-pill-model"
          type="button"
          onClick={() => props.onOpenMenu("model")}
        >
          {props.selectedModel.shortLabel} {props.selectedReasoning.label}
          <CodexIcon name="chevronDown" />
        </button>
        <button
          className={showInterrupt ? "cn-send-button interrupt" : "cn-send-button"}
          type="button"
          disabled={!hasDraft && !showInterrupt}
          onClick={showInterrupt ? props.onInterrupt : props.onSubmit}
          title={showInterrupt ? "打断当前运行" : "发送"}
        >
          <CodexIcon name={showInterrupt ? "stop" : "arrowUp"} />
        </button>
      </div>

      {props.activeMenu === "plus" ? (
        <div className="cn-popover plus cn-live-popover">
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
        <div className="cn-popover model cn-live-popover">
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
        <div className="cn-popover permission cn-live-popover">
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
