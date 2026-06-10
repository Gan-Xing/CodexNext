import type { AgentConnection } from "../../lib/api";
import { createClientId } from "../../lib/random-id";

export interface SavedDevice {
  id: string;
  name: string;
  mode: "relay";
  relayUrl: string;
  deviceId: string;
  hostname?: string | null;
  online?: boolean;
  codexVersion?: string | null;
  lastConnectedAt?: number | null;
}

export interface DeviceDraftState {
  selectedDeviceId: string | null;
  name: string;
}

export interface DevicePresenceState {
  checkedAt: number;
  codexVersion?: string | null;
  error?: string | null;
  status: "checking" | "offline" | "online";
}

export interface SavedDevicesReadResult {
  devices: SavedDevice[];
  droppedLegacyDirectDevices: number;
}

export const savedDevicesStorageKey = "codexnext.savedDevices.v1";
export const sidebarWidthStorageKey = "codexnext.sidebarWidth.v1";
export const relayOnlyMigrationNoticeStorageKey =
  "codexnext.relayOnlyMigrationNotice.v1";

export function readSavedDevices(): SavedDevice[] {
  return readSavedDevicesState().devices;
}

export function readSavedDevicesState(): SavedDevicesReadResult {
  try {
    const raw = window.localStorage.getItem(savedDevicesStorageKey);
    if (!raw) {
      return { devices: [], droppedLegacyDirectDevices: 0 };
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return { devices: [], droppedLegacyDirectDevices: 0 };
    }

    const relayDevices = parsed.filter(isRelaySavedDevice).map((device) =>
      sanitizeRelaySavedDevice(device)
    );
    const droppedLegacyDirectDevices = parsed.length - relayDevices.length;

    if (droppedLegacyDirectDevices > 0) {
      window.localStorage.setItem(savedDevicesStorageKey, JSON.stringify(relayDevices));
    }

    return {
      devices: relayDevices,
      droppedLegacyDirectDevices
    };
  } catch {
    return { devices: [], droppedLegacyDirectDevices: 0 };
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
  connectionOrDeviceId: AgentConnection | string
): SavedDevice | null {
  if (typeof connectionOrDeviceId === "string") {
    return devices.find((device) => device.deviceId === connectionOrDeviceId) ?? null;
  }
  return (
    devices.find((device) => isSameSavedDeviceConnection(device, connectionOrDeviceId)) ??
    null
  );
}

export function isSameAgentConnection(
  left: AgentConnection,
  right: AgentConnection
): boolean {
  return (
    normalizeAgentUrl(left.relayUrl) === normalizeAgentUrl(right.relayUrl) &&
    left.deviceId === right.deviceId
  );
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
  return createClientId("device");
}

export function connectionFromSavedDevice(
  device: SavedDevice,
  relaySessionToken?: string | null
): AgentConnection | null {
  if (!relaySessionToken) {
    return null;
  }
  return {
    mode: "relay",
    relayUrl: device.relayUrl,
    sessionToken: relaySessionToken,
    deviceId: device.deviceId
  };
}

export function savedDeviceAddressLabel(device: SavedDevice): string {
  return device.hostname?.trim() || device.deviceId;
}

function isRelaySavedDevice(value: unknown): value is SavedDevice {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    (value.mode === "relay" || value.mode === undefined) &&
    typeof value.relayUrl === "string" &&
    typeof value.deviceId === "string"
  );
}

function sanitizeRelaySavedDevice(device: SavedDevice): SavedDevice {
  return {
    id: device.id,
    name: device.name,
    mode: "relay",
    relayUrl: normalizeAgentUrl(device.relayUrl),
    deviceId: device.deviceId,
    ...(typeof device.hostname === "string" || device.hostname === null
      ? { hostname: device.hostname }
      : {}),
    ...(typeof device.online === "boolean" ? { online: device.online } : {}),
    ...(typeof device.codexVersion === "string" || device.codexVersion === null
      ? { codexVersion: device.codexVersion }
      : {}),
    ...(typeof device.lastConnectedAt === "number" || device.lastConnectedAt === null
      ? { lastConnectedAt: device.lastConnectedAt }
      : {})
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isSameSavedDeviceConnection(
  device: SavedDevice,
  connection: AgentConnection | SavedDevice
): boolean {
  return (
    normalizeAgentUrl(device.relayUrl) ===
      normalizeAgentUrl(connection.mode === "relay" ? connection.relayUrl : "") &&
    device.deviceId === connection.deviceId
  );
}
