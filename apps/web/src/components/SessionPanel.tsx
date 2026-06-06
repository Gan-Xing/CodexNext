import { useRef, useState } from "react";
import type {
  LocalDirectoryListResponse,
  LocalPermissionMode,
  LocalSessionSummary
} from "../lib/types";

type ReasoningEffort = "low" | "medium" | "high" | "xhigh";

interface AttachmentDraft {
  name: string;
  type: string;
  size: number;
  content: string | null;
}

const modelOptions = [
  { label: "GPT-5.5", value: "gpt-5.5" },
  { label: "GPT-5.4", value: "gpt-5.4" },
  { label: "GPT-5.4 Mini", value: "gpt-5.4-mini" },
  { label: "GPT-5.3 Codex Spark", value: "gpt-5.3-codex-spark" }
];

const reasoningOptions: Array<{ label: string; value: ReasoningEffort }> = [
  { label: "低", value: "low" },
  { label: "中", value: "medium" },
  { label: "高", value: "high" },
  { label: "超高", value: "xhigh" }
];

const permissionOptions: Array<{
  mode: LocalPermissionMode;
  label: string;
  description: string;
}> = [
  {
    mode: "request-approval",
    label: "请求批准",
    description: "编辑外部文件和使用互联网时始终询问"
  },
  {
    mode: "auto-approve",
    label: "替我审批",
    description: "仅对检测到的风险操作请求批准"
  },
  {
    mode: "full-access",
    label: "完全访问权限",
    description: "不受限制地访问互联网和电脑上的文件"
  },
  {
    mode: "custom-config",
    label: "自定义 config.toml",
    description: "使用 config.toml 中定义的权限"
  }
];

export function SessionPanel(props: {
  currentSession: LocalSessionSummary | null;
  canBrowse: boolean;
  deviceName: string;
  streamStatus: string;
  onOpenDeviceSetup: () => void;
  onBrowseDirectories: (path?: string) => Promise<LocalDirectoryListResponse>;
  onStart: (input: {
    cwd: string;
    model?: string | null;
    reasoningEffort?: ReasoningEffort | null;
    tokenBudget?: number | null;
    permissionMode: LocalPermissionMode;
    initialGoal?: string | null;
    initialMessage?: string | null;
  }) => void;
}) {
  const [cwd, setCwd] = useState("");
  const [model, setModel] = useState("gpt-5.5");
  const [reasoningEffort, setReasoningEffort] =
    useState<ReasoningEffort>("xhigh");
  const [permissionMode, setPermissionMode] =
    useState<LocalPermissionMode>("request-approval");
  const [prompt, setPrompt] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeMenu, setActiveMenu] =
    useState<"model" | "permission" | null>(null);
  const [attachments, setAttachments] = useState<AttachmentDraft[]>([]);
  const [directoryList, setDirectoryList] =
    useState<LocalDirectoryListResponse | null>(null);
  const [directoryError, setDirectoryError] = useState<string | null>(null);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const selectedModel = modelOptions.find((option) => option.value === model);
  const selectedReasoning = reasoningOptions.find(
    (option) => option.value === reasoningEffort
  );
  const selectedPermission = permissionOptions.find(
    (option) => option.mode === permissionMode
  );
  const canSubmit = Boolean(prompt.trim());

  async function loadDirectories(path?: string) {
    if (!props.canBrowse) {
      props.onOpenDeviceSetup();
      return;
    }
    setSettingsOpen(true);
    setDirectoryLoading(true);
    setDirectoryError(null);
    try {
      const result = await props.onBrowseDirectories(path || cwd || undefined);
      setDirectoryList(result);
    } catch (error) {
      setDirectoryError(error instanceof Error ? error.message : String(error));
    } finally {
      setDirectoryLoading(false);
    }
  }

  async function attachFiles(files: FileList | null) {
    if (!files?.length) {
      return;
    }
    const next: AttachmentDraft[] = [];
    for (const file of Array.from(files).slice(0, 4)) {
      const textLike =
        file.type.startsWith("text/") ||
        /\.(md|txt|json|ts|tsx|js|jsx|css|html|py|go|rs|java|toml|yaml|yml)$/i.test(
          file.name
        );
      next.push({
        name: file.name,
        type: file.type || "unknown",
        size: file.size,
        content: textLike ? (await file.text()).slice(0, 24_000) : null
      });
    }
    setAttachments((previous) => [...previous, ...next].slice(0, 4));
  }

  function startSession() {
    if (!canSubmit) {
      return;
    }
    if (!props.canBrowse || !cwd.trim()) {
      setSettingsOpen(true);
      if (!props.canBrowse) {
        props.onOpenDeviceSetup();
      }
      return;
    }

    props.onStart({
      cwd: cwd.trim(),
      model,
      reasoningEffort,
      permissionMode,
      tokenBudget: null,
      initialGoal: null,
      initialMessage: buildInitialMessage(prompt.trim(), attachments)
    });
    setPrompt("");
    setAttachments([]);
  }

  return (
    <section className="new-session happy-new-session">
      <header className="happy-session-header">
        <button
          className="config-pill"
          type="button"
          onClick={() => setSettingsOpen(true)}
        >
          <span>{cwd ? shortPath(cwd) : "新会话设置"}</span>
          <small>{props.deviceName} · {connectionLabel(props.streamStatus)}</small>
        </button>
      </header>

      <div className="happy-session-spacer" />

      <div className="happy-composer">
        <textarea
          className="happy-prompt-input"
          placeholder="要在 CodexNext 中构建什么？"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              startSession();
            }
          }}
        />
        {attachments.length ? (
          <div className="attachment-row">
            {attachments.map((attachment) => (
              <button
                key={`${attachment.name}-${attachment.size}`}
                className="attachment-chip"
                type="button"
                onClick={() =>
                  setAttachments((previous) =>
                    previous.filter((item) => item !== attachment)
                  )
                }
              >
                {attachment.name} ×
              </button>
            ))}
          </div>
        ) : null}
        <div className="happy-composer-toolbar">
          <input
            ref={fileInputRef}
            className="visually-hidden"
            multiple
            type="file"
            onChange={(event) => void attachFiles(event.target.files)}
          />
          <button
            className="composer-icon-button"
            type="button"
            title="Attach files"
            onClick={() => fileInputRef.current?.click()}
          >
            +
          </button>
          <button
            className="composer-pill project-pill"
            type="button"
            onClick={() => setSettingsOpen(true)}
          >
            {cwd ? shortPath(cwd) : "选择项目"}⌄
          </button>
          <button
            className="composer-pill"
            type="button"
            onClick={() =>
              setActiveMenu(activeMenu === "model" ? null : "model")
            }
          >
            {model.replace("gpt-", "")} {selectedReasoning?.label}⌄
          </button>
          <button
            className="composer-pill"
            type="button"
            onClick={() =>
              setActiveMenu(activeMenu === "permission" ? null : "permission")
            }
          >
            {selectedPermission?.label}⌄
          </button>
          <button
            className="composer-send"
            type="button"
            disabled={!canSubmit}
            onClick={startSession}
            title="Start session"
          >
            ↑
          </button>
        </div>

        {activeMenu === "model" ? (
          <div className="composer-popover model-popover">
            <div className="popover-title">推理</div>
            {reasoningOptions.map((option) => (
              <button
                key={option.value}
                className="popover-option"
                type="button"
                onClick={() => setReasoningEffort(option.value)}
              >
                <span>{option.label}</span>
                {reasoningEffort === option.value ? <strong>✓</strong> : null}
              </button>
            ))}
            <div className="popover-divider" />
            {modelOptions.map((option) => (
              <button
                key={option.value}
                className="popover-option"
                type="button"
                onClick={() => setModel(option.value)}
              >
                <span>{option.label}</span>
                {model === option.value ? <strong>›</strong> : null}
              </button>
            ))}
          </div>
        ) : null}

        {activeMenu === "permission" ? (
          <div className="composer-popover permission-popover">
            <div className="popover-title">应如何批准 Codex 操作？</div>
            {permissionOptions.map((option) => (
              <button
                key={option.mode}
                className="popover-option tall"
                type="button"
                onClick={() => {
                  setPermissionMode(option.mode);
                  setActiveMenu(null);
                }}
              >
                <span>
                  <strong>{option.label}</strong>
                  <small>{option.description}</small>
                </span>
                {permissionMode === option.mode ? <strong>✓</strong> : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {settingsOpen ? (
        <div className="settings-backdrop" role="presentation">
          <section className="session-settings" role="dialog" aria-label="New session settings">
            <div className="device-modal-header">
              <div>
                <p className="eyebrow">Session Settings</p>
                <h2>新会话设置</h2>
              </div>
              <button
                className="ghost-button"
                type="button"
                onClick={() => setSettingsOpen(false)}
              >
                Close
              </button>
            </div>

            <div className="settings-section">
              <button className="settings-row" type="button" onClick={props.onOpenDeviceSetup}>
                <span>设备</span>
                <strong>{props.deviceName}</strong>
                <small>{connectionLabel(props.streamStatus)}</small>
              </button>
              <button
                className="settings-row"
                type="button"
                onClick={() => void loadDirectories(cwd || undefined)}
              >
                <span>项目</span>
                <strong>{cwd ? shortPath(cwd) : "选择项目文件夹"}</strong>
                <small>{cwd || "Codex will run in this cwd"}</small>
              </button>
            </div>

            <div className="settings-section">
              <div className="selected-project-display">
                <span>当前项目</span>
                <strong>{cwd || "尚未选择文件夹"}</strong>
              </div>
              <div className="folder-picker-actions">
                <button
                  className="secondary"
                  type="button"
                  onClick={() => void loadDirectories(directoryList?.homePath)}
                >
                  Home
                </button>
                <button
                  className="secondary"
                  type="button"
                  disabled={!directoryList?.parentPath}
                  onClick={() => void loadDirectories(directoryList?.parentPath ?? undefined)}
                >
                  Up
                </button>
                <button
                  className="secondary"
                  type="button"
                  onClick={() => void loadDirectories(cwd || undefined)}
                >
                  Browse
                </button>
              </div>
              {directoryError ? <div className="error-strip">{directoryError}</div> : null}
              {directoryLoading ? <div className="meta">Loading folders...</div> : null}
              {directoryList ? (
                <div className="settings-folder-list">
                  {directoryList.entries.map((entry) => (
                    <button
                      key={entry.path}
                      className="folder-row"
                      type="button"
                      onClick={() => void loadDirectories(entry.path)}
                    >
                      <span>{entry.name}</span>
                      <small>{entry.path}</small>
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      setCwd(directoryList.path);
                      setSettingsOpen(false);
                    }}
                  >
                    Use this folder
                  </button>
                </div>
              ) : null}
            </div>

            <div className="settings-grid">
              <label>
                Model
                <select value={model} onChange={(event) => setModel(event.target.value)}>
                  {modelOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Reasoning
                <select
                  value={reasoningEffort}
                  onChange={(event) =>
                    setReasoningEffort(event.target.value as ReasoningEffort)
                  }
                >
                  {reasoningOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="settings-section">
              <div className="permission-menu-title">权限模式</div>
              <div className="settings-permission-list">
                {permissionOptions.map((option) => (
                  <button
                    key={option.mode}
                    className={
                      permissionMode === option.mode
                        ? "permission-card selected"
                        : "permission-card"
                    }
                    type="button"
                    onClick={() => setPermissionMode(option.mode)}
                  >
                    <span>{option.label}</span>
                    <small>{option.description}</small>
                  </button>
                ))}
              </div>
            </div>

            <div className="device-modal-actions">
              <button className="secondary" type="button" onClick={() => setSettingsOpen(false)}>
                Done
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function buildInitialMessage(prompt: string, attachments: AttachmentDraft[]): string {
  if (!attachments.length) {
    return prompt;
  }
  const blocks = attachments.map((attachment) => {
    if (!attachment.content) {
      return `\n\n[Attached file: ${attachment.name}; ${attachment.type}; ${attachment.size} bytes; content not embedded because it is not a text file.]`;
    }
    return `\n\n[Attached file: ${attachment.name}]\n${attachment.content}`;
  });
  return `${prompt}${blocks.join("")}`;
}

function shortPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts.at(-1) ?? path;
}

function connectionLabel(status: string): string {
  if (status === "connected") {
    return "online";
  }
  if (status === "reconnecting") {
    return "reconnecting";
  }
  if (status === "connecting") {
    return "connecting";
  }
  return "offline";
}
