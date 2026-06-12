import {
  normalizeAgentUrl,
  relayOnlyMigrationNoticeStorageKey,
  savedDevicesStorageKey,
  sidebarWidthStorageKey,
  type SavedDevice
} from "../devices/device-utils";
import {
  projectSidebarPrefsStorageKey,
  sanitizeProjectSidebarPrefs,
  sanitizeThreadSidebarPrefs,
  threadSidebarPrefsStorageKey,
  type ProjectSidebarPrefs,
  type ThreadSidebarPrefs
} from "../sessions/session-utils";

export const sessionSelectionStorageKey = "codexnext.sessionSelection.v1";

export interface SessionSelectionState {
  currentSessionId: string | null;
  selectedHistoryKey: string | null;
}

export const consoleLocalStorageKeys = [
  savedDevicesStorageKey,
  threadSidebarPrefsStorageKey,
  projectSidebarPrefsStorageKey,
  sessionSelectionStorageKey,
  sidebarWidthStorageKey,
  relayOnlyMigrationNoticeStorageKey
] as const;

export type ConsoleLocalStorageKey = (typeof consoleLocalStorageKeys)[number];

export function hasRelayOnlyMigrationNoticeSeen(storage: Storage): boolean {
  return storage.getItem(relayOnlyMigrationNoticeStorageKey) === "1";
}

export function writeRelayOnlyMigrationNoticeSeen(storage: Storage): void {
  writeConsoleStorageItem(storage, relayOnlyMigrationNoticeStorageKey, "1");
}

export function writeSidebarWidthStorage(storage: Storage, width: number): void {
  if (!Number.isFinite(width)) {
    return;
  }
  writeConsoleStorageItem(storage, sidebarWidthStorageKey, String(Math.round(width)));
}

export function writeSavedDevicesStorage(
  storage: Storage,
  devices: SavedDevice[]
): SavedDevice[] {
  const safeDevices = devices
    .map(sanitizeSavedDeviceForStorage)
    .filter((device): device is SavedDevice => Boolean(device));
  writeConsoleStorageItem(storage, savedDevicesStorageKey, JSON.stringify(safeDevices));
  return safeDevices;
}

export function writeThreadSidebarPrefsStorage(
  storage: Storage,
  prefsByScope: Record<string, ThreadSidebarPrefs>
): Record<string, ThreadSidebarPrefs> {
  const safePrefs = Object.fromEntries(
    Object.entries(prefsByScope)
      .filter(([scope]) => isSafePreferenceString(scope))
      .map(([scope, prefs]) => {
        const sanitized = sanitizeThreadSidebarPrefs(prefs);
        return [
          scope,
          {
            pinned: sanitized.pinned.filter(isSafePreferenceString)
          }
        ] as const;
      })
  );
  writeConsoleStorageItem(
    storage,
    threadSidebarPrefsStorageKey,
    JSON.stringify(safePrefs)
  );
  return safePrefs;
}

export function writeProjectSidebarPrefsStorage(
  storage: Storage,
  prefsByScope: Record<string, ProjectSidebarPrefs>
): Record<string, ProjectSidebarPrefs> {
  const safePrefs = Object.fromEntries(
    Object.entries(prefsByScope)
      .filter(([scope]) => isSafePreferenceString(scope))
      .map(([scope, prefs]) => {
        const sanitized = sanitizeProjectSidebarPrefs(prefs);
        return [
          scope,
          {
            hidden: sanitized.hidden.filter(isSafePreferenceString),
            pinned: sanitized.pinned.filter(isSafePreferenceString),
            renamed: Object.fromEntries(
              Object.entries(sanitized.renamed).filter(
                ([key, value]) =>
                  isSafePreferenceString(key) && isSafePreferenceString(value)
              )
            )
          }
        ] as const;
      })
  );
  writeConsoleStorageItem(
    storage,
    projectSidebarPrefsStorageKey,
    JSON.stringify(safePrefs)
  );
  return safePrefs;
}

export function readSessionSelectionStorage(): Record<string, SessionSelectionState> {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(sessionSelectionStorageKey);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([scope, value]) => isSafePreferenceString(scope) && isRecord(value))
        .map(([scope, value]) => {
          const record = value as Record<string, unknown>;
          const currentSessionId =
            typeof record.currentSessionId === "string" &&
            isSafePreferenceString(record.currentSessionId)
              ? record.currentSessionId
              : null;
          const selectedHistoryKey =
            typeof record.selectedHistoryKey === "string" &&
            isSafePreferenceString(record.selectedHistoryKey)
              ? record.selectedHistoryKey
              : null;
          return [scope, { currentSessionId, selectedHistoryKey }] as const;
        })
    );
  } catch {
    return {};
  }
}

export function writeSessionSelectionStorage(
  storage: Storage,
  selectionsByScope: Record<string, SessionSelectionState>
): Record<string, SessionSelectionState> {
  const safeSelections = Object.fromEntries(
    Object.entries(selectionsByScope)
      .filter(([scope]) => isSafePreferenceString(scope))
      .map(([scope, selection]) => [
        scope,
        {
          currentSessionId:
            typeof selection.currentSessionId === "string" &&
            isSafePreferenceString(selection.currentSessionId)
              ? selection.currentSessionId
              : null,
          selectedHistoryKey:
            typeof selection.selectedHistoryKey === "string" &&
            isSafePreferenceString(selection.selectedHistoryKey)
              ? selection.selectedHistoryKey
              : null
        }
      ])
  );
  writeConsoleStorageItem(
    storage,
    sessionSelectionStorageKey,
    JSON.stringify(safeSelections)
  );
  return safeSelections;
}

export function writeConsoleStorageItem(
  storage: Storage,
  key: string,
  value: string
): void {
  if (!isConsoleLocalStorageKey(key)) {
    throw new Error(`Refusing to write unsupported localStorage key "${key}"`);
  }
  if (containsSensitiveStorageMarker(value)) {
    throw new Error(`Refusing to write sensitive value to localStorage key "${key}"`);
  }
  storage.setItem(key, value);
}

export function isConsoleLocalStorageKey(key: string): key is ConsoleLocalStorageKey {
  return consoleLocalStorageKeys.includes(key as ConsoleLocalStorageKey);
}

function sanitizeSavedDeviceForStorage(device: SavedDevice): SavedDevice | null {
  if (
    device.mode !== "relay" ||
    !isSafePreferenceString(device.id) ||
    !isSafePreferenceString(device.deviceId)
  ) {
    return null;
  }

  const relayUrl = normalizeAgentUrl(device.relayUrl);
  if (!isSafePreferenceString(relayUrl)) {
    return null;
  }

  const name =
    safeOptionalString(device.name) ?? safeOptionalString(device.deviceId) ?? "Relay device";
  const hostname = safeOptionalString(device.hostname);
  const codexVersion = safeOptionalString(device.codexVersion);

  return {
    id: device.id,
    name,
    mode: "relay",
    relayUrl,
    deviceId: device.deviceId,
    ...(hostname !== undefined ? { hostname } : {}),
    ...(typeof device.online === "boolean" ? { online: device.online } : {}),
    ...(codexVersion !== undefined ? { codexVersion } : {}),
    ...(typeof device.lastConnectedAt === "number" ||
    device.lastConnectedAt === null
      ? { lastConnectedAt: device.lastConnectedAt }
      : {})
  };
}

function safeOptionalString(value: string | null | undefined): string | null | undefined {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  return isSafePreferenceString(value) ? value : undefined;
}

function isSafePreferenceString(value: string): boolean {
  return value.trim().length > 0 && !containsSensitiveStorageMarker(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function containsSensitiveStorageMarker(value: string): boolean {
  return /\b(?:owner|session|device|direct)[-_\s]?(?:token|secret|password)\b/i.test(
    value
  ) || /\bbearer\s+[a-z0-9._-]+/i.test(value);
}
