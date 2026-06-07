import type { AgentConnection } from "../../lib/api";

export interface SavedDevice {
  id: string;
  name: string;
  agentUrl: string;
  token: string;
  codexVersion?: string | null;
  lastConnectedAt?: number | null;
}

export interface DeviceDraftState {
  selectedDeviceId: string | null;
  name: string;
  agentUrl: string;
  token: string;
}

export interface DevicePresenceState {
  checkedAt: number;
  codexVersion?: string | null;
  error?: string | null;
  status: "checking" | "offline" | "online";
}

export const savedDevicesStorageKey = "codexnext.savedDevices.v1";
export const sidebarWidthStorageKey = "codexnext.sidebarWidth.v1";

export function deviceNameStorageKey(agentUrl: string): string {
  return `codexnext.deviceName.${agentUrl}`;
}

export function readSavedDevices(): SavedDevice[] {
  try {
    const raw = window.localStorage.getItem(savedDevicesStorageKey);
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter(isSavedDevice)
      .map((device) => ({
        ...device,
        agentUrl: normalizeAgentUrl(device.agentUrl)
      }));
  } catch {
    return [];
  }
}

export function readSidebarWidth(
  clampSidebarWidth: (value: number) => number
): number | null {
  try {
    const raw = window.localStorage.getItem(sidebarWidthStorageKey);
    if (!raw) {
      return null;
    }
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      return null;
    }
    return clampSidebarWidth(value);
  } catch {
    return null;
  }
}

export function findSavedDevice(
  devices: SavedDevice[],
  agentUrl: string,
  token: string
): SavedDevice | null {
  const normalizedAgentUrl = normalizeAgentUrl(agentUrl);
  return (
    devices.find((device) =>
      isSameDeviceEndpoint(device, normalizedAgentUrl, token)
    ) ?? null
  );
}

export function isSameDeviceEndpoint(
  device: SavedDevice,
  agentUrl: string,
  token: string
): boolean {
  return normalizeAgentUrl(device.agentUrl) === normalizeAgentUrl(agentUrl) &&
    device.token === token;
}

export function isSameAgentConnection(
  left: AgentConnection,
  right: AgentConnection
): boolean {
  return normalizeAgentUrl(left.agentUrl) === normalizeAgentUrl(right.agentUrl) &&
    left.token === right.token;
}

export function normalizeAgentUrl(agentUrl: string): string {
  const trimmed = agentUrl.trim();
  try {
    const url = new URL(trimmed);
    url.pathname = url.pathname.replace(/\/+$/, "");
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return trimmed.replace(/\/+$/, "");
  }
}

export function createSavedDeviceId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `device_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

export function shortAgentUrl(agentUrl: string): string {
  try {
    const url = new URL(agentUrl);
    return `${url.hostname}:${url.port || (url.protocol === "https:" ? "443" : "80")}`;
  } catch {
    return agentUrl;
  }
}

export function defaultDeviceName(agentUrl: string): string {
  try {
    const url = new URL(agentUrl);
    return `Codex agent @ ${url.hostname}`;
  } catch {
    return "Codex agent";
  }
}

function isSavedDevice(value: unknown): value is SavedDevice {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.agentUrl === "string" &&
    typeof value.token === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
