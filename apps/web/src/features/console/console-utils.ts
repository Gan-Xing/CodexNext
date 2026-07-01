import type {
  LocalHealthResponse,
  LocalPermissionMode,
  LocalProviderCatalogResponse,
  LocalProviderConfig,
  LocalProviderPreset,
  LocalSessionSummary
} from "../../lib/types";
import type { ResumeState } from "../chat/chat-state";
import type { DevicePresenceState, SavedDevice } from "../devices/device-utils";
import { formatConnectionError, formatError } from "../../lib/format/text";

export interface PermissionOptionLike {
  mode: LocalPermissionMode;
}

export function availableRelayPermissionOptions<T extends PermissionOptionLike>(
  options: T[],
  input: {
    relayEnabled: boolean;
    relayFullAccessEnabled: boolean;
  }
): T[] {
  if (input.relayEnabled && !input.relayFullAccessEnabled) {
    return options.filter((option) => option.mode !== "full-access");
  }
  return options;
}

export function coerceRelayPermissionMode(
  mode: LocalPermissionMode,
  options: PermissionOptionLike[],
  fallback: LocalPermissionMode = "request-approval"
): LocalPermissionMode {
  return options.some((option) => option.mode === mode) ? mode : fallback;
}

export type RelaySessionErrorKind = "expired";

export function classifyRelaySessionError(error: unknown): RelaySessionErrorKind | null {
  const status = readErrorStatus(error);
  if (status === 401 || status === 410) {
    return "expired";
  }

  const message = formatUnknownError(error).toLowerCase();
  if (
    /\b(401|410)\b/.test(message) ||
    message.includes("unauthorized") ||
    message.includes("session expired") ||
    message.includes("login required") ||
    message.includes("session revoked")
  ) {
    return "expired";
  }
  return null;
}

export function formatRelaySessionError(error: unknown): string | null {
  if (classifyRelaySessionError(error) !== "expired") {
    return null;
  }
  return "登录会话已过期，请重新登录后再试。";
}

export function formatConsoleError(error: unknown): string {
  const relayError = formatRelaySessionError(error);
  if (relayError) {
    return relayError;
  }

  const message = formatError(error);
  const missingCwd = readMissingCwdFromMessage(message);
  if (missingCwd !== null) {
    return formatMissingHistoryFolderMessage(missingCwd);
  }
  return message;
}

export function formatConsoleConnectionError(
  error: unknown,
  relayUrl: string
): string {
  return formatRelaySessionError(error) ?? formatConnectionError(error, relayUrl);
}

export function resolveComposerResumeBlock(
  resumeState: ResumeState | null,
  cwd?: string | null
): string | null {
  if (resumeState === "missing") {
    return formatMissingHistoryFolderMessage(cwd);
  }
  return null;
}

export function formatMissingHistoryFolderMessage(cwd?: string | null): string {
  const normalizedCwd = cwd?.trim();
  return normalizedCwd
    ? `无法继续这个对话，因为这个文件夹不存在：${normalizedCwd}`
    : "无法继续这个对话，因为原来的文件夹不存在。";
}

export function formatMissingHistoryFolderShortMessage(cwd?: string | null): string {
  const normalizedCwd = cwd?.trim();
  return normalizedCwd ? `文件夹不存在：${normalizedCwd}` : "文件夹不存在";
}

function readMissingCwdFromMessage(message: string): string | null {
  const marker = "cwd does not exist:";
  const markerIndex = message.indexOf(marker);
  if (markerIndex === -1) {
    return null;
  }
  const cwd = message.slice(markerIndex + marker.length).split(/\r?\n/)[0]?.trim();
  return cwd || null;
}

export interface PresenceRefreshResult {
  id: string;
  presence: DevicePresenceState;
}

export function seedSavedDevicePresence(
  previous: Record<string, DevicePresenceState>,
  savedDevices: Array<Pick<SavedDevice, "codexVersion" | "id">>,
  now = Date.now()
): Record<string, DevicePresenceState> {
  const next: Record<string, DevicePresenceState> = {};
  for (const device of savedDevices) {
    next[device.id] = previous[device.id] ?? {
      checkedAt: now,
      codexVersion: device.codexVersion ?? null,
      status: "checking"
    };
  }
  return next;
}

export function mergeDevicePresenceResults(
  previous: Record<string, DevicePresenceState>,
  savedDeviceIds: Set<string>,
  results: PresenceRefreshResult[]
): Record<string, DevicePresenceState> {
  const next: Record<string, DevicePresenceState> = {};
  for (const [deviceId, presence] of Object.entries(previous)) {
    if (savedDeviceIds.has(deviceId)) {
      next[deviceId] = presence;
    }
  }
  for (const result of results) {
    if (savedDeviceIds.has(result.id)) {
      next[result.id] = result.presence;
    }
  }
  return next;
}

export interface ProviderSelectionOption {
  preset: LocalProviderPreset | null;
  value: string;
}

export interface ProviderSessionRequest {
  providerProfileId: string;
  provider: LocalProviderConfig;
}

export function buildProviderSessionRequest(input: {
  apiKey: string;
  apiKeyEnv: string;
  baseUrl: string;
  label: string;
  model: string;
  option: ProviderSelectionOption;
}): ProviderSessionRequest | null {
  if (!input.option.value || !input.option.preset) {
    return null;
  }
  const provider = compactProviderConfig({
    preset: input.option.preset,
    providerLabel: input.label,
    baseUrl: input.baseUrl,
    apiKey: input.apiKey,
    apiKeyEnv: input.apiKeyEnv,
    model: input.model
  });
  return {
    providerProfileId: input.option.value,
    provider
  };
}

export function validateProviderSessionRequest(input: {
  catalog: LocalProviderCatalogResponse | null;
  loading: boolean;
  request: ProviderSessionRequest | null;
  status: LocalHealthResponse["codexProvider"] | null;
}): string | null {
  const request = input.request;
  if (!request) {
    return null;
  }

  if (input.loading && !input.catalog) {
    return "正在读取当前设备的 Provider 能力，请稍后再试。";
  }
  if (input.status && !input.status.available) {
    return `当前设备未启用 CodexProvider：${input.status.error ?? "请安装 codex-provider 或配置 CODEXNEXT_CODEX_PROVIDER_MODULE。"}`;
  }
  if (!input.catalog) {
    return "还没有读取到当前设备的 Provider 能力，请稍后再试。";
  }
  if (!input.catalog.available) {
    return `当前设备未启用 CodexProvider：${input.catalog.error ?? "请安装 codex-provider 或配置 CODEXNEXT_CODEX_PROVIDER_MODULE。"}`;
  }

  if (request.provider.preset === "custom") {
    if (!request.provider.baseUrl?.trim()) {
      return "请填写自定义 Provider 的 Base URL";
    }
    if (!request.provider.model?.trim()) {
      return "请填写自定义 Provider 的模型";
    }
    if (!request.provider.apiKey?.trim() && !request.provider.apiKeyEnv?.trim()) {
      return "请填写自定义 Provider 的 API Key 或 API Key Env";
    }
    return null;
  }

  const catalogEntry = input.catalog.providers.find(
    (provider) => provider.preset === request.providerProfileId
  );
  if (!catalogEntry) {
    return "当前设备不支持这个 Provider，请重新选择。";
  }
  if (!request.provider.model?.trim() && !catalogEntry.defaultModel.trim()) {
    return "请选择 Provider 模型。";
  }
  if (!request.provider.apiKey?.trim() && !catalogEntry.apiKeyConfigured) {
    return `当前设备没有配置 ${catalogEntry.apiKeyEnv}，请在设备环境变量中设置，或直接填写 API Key。`;
  }
  return null;
}

export function shortModelLabel(label: string, fallback: string): string {
  const trimmed = label.trim() || fallback.trim();
  return trimmed.replace(/^DeepSeek /u, "DS ");
}

export function sessionActiveModelLabel(
  session: LocalSessionSummary,
  catalog: LocalProviderCatalogResponse | null
): string {
  const model = session.provider?.model ?? session.model ?? "model";
  const provider = session.provider?.providerLabel ?? session.providerProfileId ?? "";
  if (!provider) {
    return model;
  }
  const catalogProvider = catalog?.providers.find(
    (entry) => entry.preset === session.providerProfileId || entry.providerLabel === provider
  );
  const modelLabel =
    catalogProvider?.models.find((entry) => entry.id === model)?.label ?? model;
  return `${catalogProvider?.label ?? provider} · ${modelLabel}`;
}

function readErrorStatus(error: unknown): number | null {
  if (!isRecord(error)) {
    return null;
  }
  if (typeof error.status === "number") {
    return error.status;
  }
  if (isRecord(error.data) && typeof error.data.status === "number") {
    return error.data.status;
  }
  return null;
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compactProviderConfig(
  input: Record<string, string | LocalProviderPreset | null>
): LocalProviderConfig {
  return Object.fromEntries(
    Object.entries(input)
      .map(([key, value]) => [
        key,
        typeof value === "string" ? value.trim() : value
      ])
      .filter(([, value]) => value !== null && value !== "")
  ) as LocalProviderConfig;
}
