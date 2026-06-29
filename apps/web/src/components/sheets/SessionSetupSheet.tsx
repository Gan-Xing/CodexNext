import type {
  LocalDirectoryListResponse,
  LocalPermissionMode,
  LocalProviderPreset,
  LocalReasoningEffort
} from "../../lib/types";
import type { CodexIconName } from "../DesignLab";
import { CodexIcon } from "../DesignLab";

interface ModelOption {
  label: string;
  value: string;
}

interface ReasoningOption {
  label: string;
  value: LocalReasoningEffort;
}

interface PermissionOption {
  description: string;
  icon: CodexIconName;
  label: string;
  mode: LocalPermissionMode;
}

interface ProviderOption {
  label: string;
  preset: LocalProviderPreset | null;
  value: string;
}

export function SessionSetupSheet(props: {
  connected: boolean;
  cwd: string;
  deviceName: string;
  directoryError: string | null;
  directoryList: LocalDirectoryListResponse | null;
  directoryLoading: boolean;
  initialGoal: string;
  initialTokenBudget: string;
  model: string;
  modelOptions: ModelOption[];
  permissionMode: LocalPermissionMode;
  permissionOptions: PermissionOption[];
  providerApiKey: string;
  providerApiKeyEnv: string;
  providerAvailable: boolean;
  providerBaseUrl: string;
  providerCatalogLoading: boolean;
  providerLabel: string;
  providerModel: string;
  providerModelOptions: ModelOption[];
  providerOptions: ProviderOption[];
  providerProfileId: string;
  providerStatusMessage: string | null;
  reasoningEffort: LocalReasoningEffort;
  reasoningOptions: ReasoningOption[];
  streamStatus: string;
  onClose: () => void;
  onInitialGoalChange: (value: string) => void;
  onInitialTokenBudgetChange: (value: string) => void;
  onLoadDirectories: (path?: string) => void;
  onOpenDevice: () => void;
  onSelectCwd: (value: string) => void;
  onSelectModel: (value: string) => void;
  onSelectPermission: (value: LocalPermissionMode) => void;
  onSelectProviderProfile: (value: string) => void;
  onProviderApiKeyChange: (value: string) => void;
  onProviderApiKeyEnvChange: (value: string) => void;
  onProviderBaseUrlChange: (value: string) => void;
  onProviderLabelChange: (value: string) => void;
  onProviderModelChange: (value: string) => void;
  onSelectReasoning: (value: LocalReasoningEffort) => void;
}) {
  const providerEnabled = props.providerProfileId.length > 0;
  const customProvider = props.providerProfileId === "custom";
  return (
    <div className="cn-overlay-panel project cn-live-overlay">
      <div className="cn-project-card cn-live-session-sheet">
        <button className="cn-close-button cn-sticky-close" type="button" onClick={props.onClose}>
          <CodexIcon name="x" />
        </button>
        <h2>新对话</h2>

        <button className="cn-settings-row" type="button" onClick={props.onOpenDevice}>
          <span>设备</span>
          <strong>{props.deviceName}</strong>
        </button>

        <div className="cn-project-search">
          <CodexIcon name="search" />
          {props.directoryList?.path || props.cwd || "选择文件夹"}
        </div>

        <div className="cn-folder-picker-actions">
          <button
            className="cn-soft-button"
            type="button"
            disabled={!props.connected}
            onClick={() => props.onLoadDirectories(props.directoryList?.homePath)}
          >
            主目录
          </button>
          <button
            className="cn-soft-button"
            type="button"
            disabled={!props.directoryList?.parentPath}
            onClick={() => props.onLoadDirectories(props.directoryList?.parentPath ?? undefined)}
          >
            上级
          </button>
          <button
            className="cn-soft-button"
            type="button"
            disabled={!props.connected}
            onClick={() => props.onLoadDirectories(props.cwd || undefined)}
          >
            浏览
          </button>
        </div>

        {props.directoryError ? <div className="cn-live-error inline">{props.directoryError}</div> : null}
        {props.directoryLoading ? <div className="cn-muted-line">读取中...</div> : null}

        {props.directoryList ? (
          <>
            <div className="cn-path-label">{props.directoryList.path}</div>
            <div className="cn-folder-list cn-real-folder-list">
              {props.directoryList.entries.map((entry) => (
                <button
                  key={entry.path}
                  className="cn-folder-row"
                  type="button"
                  onClick={() => props.onLoadDirectories(entry.path)}
                  title={entry.path}
                >
                  <CodexIcon name="folder" />
                  <span>{entry.name}</span>
                </button>
              ))}
            </div>
            <button
              className="cn-primary-button cn-use-folder-button"
              type="button"
              onClick={() => props.onSelectCwd(props.directoryList!.path)}
            >
              使用此文件夹
            </button>
          </>
        ) : null}

        <div className="cn-session-settings-grid">
          <label>
            模型
            <select
              name="session_model"
              value={props.model}
              onChange={(event) => props.onSelectModel(event.target.value)}
            >
              {props.modelOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            推理
            <select
              name="session_reasoning_effort"
              value={props.reasoningEffort}
              onChange={(event) =>
                props.onSelectReasoning(event.target.value as LocalReasoningEffort)
              }
            >
              {props.reasoningOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Provider
            <select
              name="session_provider"
              disabled={!props.providerAvailable}
              value={props.providerProfileId}
              onChange={(event) => props.onSelectProviderProfile(event.target.value)}
            >
              {props.providerOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {props.providerStatusMessage ? (
            <div className="cn-live-error inline" role="status">
              {props.providerStatusMessage}
            </div>
          ) : props.providerCatalogLoading ? (
            <div className="cn-muted-line">正在读取当前设备的 Provider 能力...</div>
          ) : null}
          {providerEnabled ? (
            <>
              <label>
                Provider 模型
                {customProvider || props.providerModelOptions.length === 0 ? (
                  <input
                    name="session_provider_model"
                    value={props.providerModel}
                    onChange={(event) => props.onProviderModelChange(event.target.value)}
                    placeholder="deepseek/deepseek-chat"
                  />
                ) : (
                  <select
                    name="session_provider_model"
                    value={props.providerModel}
                    onChange={(event) => props.onProviderModelChange(event.target.value)}
                  >
                    {props.providerModelOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                )}
              </label>
              <details className="cn-goal-advanced">
                <summary>Provider 高级设置</summary>
                <label>
                  Base URL
                  <input
                    name="session_provider_base_url"
                    value={props.providerBaseUrl}
                    onChange={(event) => props.onProviderBaseUrlChange(event.target.value)}
                    placeholder={customProvider ? "https://api.example.com/v1" : "默认"}
                  />
                </label>
                <label>
                  Provider Label
                  <input
                    name="session_provider_label"
                    value={props.providerLabel}
                    onChange={(event) => props.onProviderLabelChange(event.target.value)}
                    placeholder={customProvider ? "custom" : "默认"}
                  />
                </label>
                <label>
                  API Key
                  <input
                    name="session_provider_api_key"
                    type="password"
                    value={props.providerApiKey}
                    onChange={(event) => props.onProviderApiKeyChange(event.target.value)}
                    autoComplete="off"
                  />
                </label>
                <label>
                  API Key Env
                  <input
                    name="session_provider_api_key_env"
                    value={props.providerApiKeyEnv}
                    onChange={(event) => props.onProviderApiKeyEnvChange(event.target.value)}
                    placeholder="OPENROUTER_API_KEY"
                  />
                </label>
              </details>
            </>
          ) : null}
        </div>

        <div className="cn-permission-list-real">
          {props.permissionOptions.map((option) => (
            <button
              key={option.mode}
              className={
                props.permissionMode === option.mode
                  ? "cn-menu-row with-icon selected"
                  : "cn-menu-row with-icon"
              }
              type="button"
              onClick={() => props.onSelectPermission(option.mode)}
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

        <details className="cn-goal-advanced">
          <summary>Goal（可选）</summary>
          <label>
            Objective
            <textarea
              name="session_initial_goal"
              value={props.initialGoal}
              onChange={(event) => props.onInitialGoalChange(event.target.value)}
              placeholder="目标"
            />
          </label>
          <label>
            Token Budget
            <input
              inputMode="numeric"
              name="session_initial_token_budget"
              value={props.initialTokenBudget}
              onChange={(event) => props.onInitialTokenBudgetChange(event.target.value)}
              placeholder="可选"
            />
          </label>
        </details>
      </div>
    </div>
  );
}
