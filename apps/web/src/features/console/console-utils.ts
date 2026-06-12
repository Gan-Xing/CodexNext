import type { LocalPermissionMode } from "../../lib/types";
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
  return formatRelaySessionError(error) ?? formatError(error);
}

export function formatConsoleConnectionError(
  error: unknown,
  relayUrl: string
): string {
  return formatRelaySessionError(error) ?? formatConnectionError(error, relayUrl);
}

export function resolveComposerResumeBlock(
  resumeState: ResumeState | null
): string | null {
  if (resumeState === "missing") {
    return "原项目已不存在，无法继续这条历史。";
  }
  return null;
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
