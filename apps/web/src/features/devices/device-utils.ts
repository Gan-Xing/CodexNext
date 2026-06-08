import type { AgentConnection } from "../../lib/api";

export interface DirectSavedDevice {
  id: string;
  name: string;
  mode: "direct";
  agentUrl: string;
  token: string;
  codexVersion?: string | null;
  lastConnectedAt?: number | null;
}

export interface RelaySavedDevice {
  id: string;
  name: string;
  mode: "relay";
  relayUrl: string;
  ownerToken: string;
  deviceId: string;
  hostname?: string | null;
  online?: boolean;
  codexVersion?: string | null;
  lastConnectedAt?: number | null;
}

export type SavedDevice = DirectSavedDevice | RelaySavedDevice;

export interface DeviceDraftState {
  selectedDeviceId: string | null;
  mode: "direct" | "relay";
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
      .map((device) =>
        device.mode === "relay"
          ? {
              ...device,
              relayUrl: normalizeAgentUrl(device.relayUrl)
            }
          : {
              ...device,
              mode: "direct" as const,
              agentUrl: normalizeAgentUrl(device.agentUrl)
            }
      );
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
  connectionOrAgentUrl: AgentConnection | string,
  token?: string
): SavedDevice | null {
  const connection =
    typeof connectionOrAgentUrl === "string"
      ? ({
          mode: "direct",
          agentUrl: connectionOrAgentUrl,
          token: token ?? ""
        } satisfies AgentConnection)
      : connectionOrAgentUrl;
  return devices.find((device) => isSameAgentConnection(connectionFromSavedDevice(device), connection)) ?? null;
}

export function isSameDeviceEndpoint(
  device: SavedDevice,
  agentUrl: string,
  token: string
): boolean {
  return device.mode === "direct" &&
    normalizeAgentUrl(device.agentUrl) === normalizeAgentUrl(agentUrl) &&
    device.token === token;
}

export function isSameAgentConnection(
  left: AgentConnection,
  right: AgentConnection
): boolean {
  if (left.mode !== right.mode) {
    return false;
  }
  if (left.mode === "direct" && right.mode === "direct") {
    return normalizeAgentUrl(left.agentUrl) === normalizeAgentUrl(right.agentUrl) &&
      left.token === right.token;
  }
  return left.mode === "relay" &&
    right.mode === "relay" &&
    normalizeAgentUrl(left.relayUrl) === normalizeAgentUrl(right.relayUrl) &&
    left.ownerToken === right.ownerToken &&
    left.deviceId === right.deviceId;
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

export function connectionFromSavedDevice(device: SavedDevice): AgentConnection {
  if (device.mode === "relay") {
    return {
      mode: "relay",
      relayUrl: device.relayUrl,
      ownerToken: device.ownerToken,
      deviceId: device.deviceId
    };
  }
  return {
    mode: "direct",
    agentUrl: device.agentUrl,
    token: device.token
  };
}

export function savedDeviceAddressLabel(device: SavedDevice): string {
  if (device.mode === "relay") {
    return device.hostname?.trim() || device.deviceId;
  }
  return shortAgentUrl(device.agentUrl);
}

function isSavedDevice(value: unknown): value is SavedDevice {
  if (!isRecord(value)) {
    return false;
  }
  if (value.mode === "relay") {
    return (
      typeof value.id === "string" &&
      typeof value.name === "string" &&
      typeof value.relayUrl === "string" &&
      typeof value.ownerToken === "string" &&
      typeof value.deviceId === "string"
    );
  }
  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    (value.mode === "direct" || value.mode === undefined) &&
    typeof value.agentUrl === "string" &&
    typeof value.token === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
