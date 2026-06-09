import {
  chmodSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";

export interface StoredThreadSidebarPrefs {
  pinned: string[];
}

export interface StoredProjectSidebarPrefs {
  hidden: string[];
  pinned: string[];
  renamed: Record<string, string>;
}

export interface DeviceSidebarPrefsRecord {
  deviceId: string;
  thread: StoredThreadSidebarPrefs;
  project: StoredProjectSidebarPrefs;
  updatedAt: number;
}

interface PersistedSidebarPrefsV1 {
  version: 1;
  devices: DeviceSidebarPrefsRecord[];
}

const emptyThreadPrefs = (): StoredThreadSidebarPrefs => ({ pinned: [] });
const emptyProjectPrefs = (): StoredProjectSidebarPrefs => ({
  hidden: [],
  pinned: [],
  renamed: {}
});

export class SidebarPrefsStore {
  private readonly devices = new Map<string, DeviceSidebarPrefsRecord>();

  public constructor() {
    this.load();
  }

  public get(deviceId: string): DeviceSidebarPrefsRecord {
    return (
      this.devices.get(deviceId) ?? {
        deviceId,
        thread: emptyThreadPrefs(),
        project: emptyProjectPrefs(),
        updatedAt: 0
      }
    );
  }

  public upsert(
    deviceId: string,
    input: Partial<Pick<DeviceSidebarPrefsRecord, "thread" | "project">>,
    updatedAt = Date.now()
  ): DeviceSidebarPrefsRecord {
    const existing = this.get(deviceId);
    const next: DeviceSidebarPrefsRecord = {
      deviceId,
      thread: input.thread ? sanitizeThreadPrefs(input.thread) : existing.thread,
      project: input.project ? sanitizeProjectPrefs(input.project) : existing.project,
      updatedAt
    };
    this.devices.set(deviceId, next);
    this.save();
    return next;
  }

  private load(): void {
    try {
      const raw = readFileSync(sidebarPrefsPath(), "utf8");
      const parsed = JSON.parse(raw) as PersistedSidebarPrefsV1;
      if (parsed.version !== 1 || !Array.isArray(parsed.devices)) {
        return;
      }
      for (const record of parsed.devices) {
        const normalized = normalizeRecord(record);
        if (!normalized) {
          continue;
        }
        this.devices.set(normalized.deviceId, normalized);
      }
    } catch {
      return;
    }
  }

  private save(): void {
    mkdirSync(sidebarPrefsDirectory(), { recursive: true, mode: 0o700 });
    const payload: PersistedSidebarPrefsV1 = {
      version: 1,
      devices: [...this.devices.values()]
    };
    writeFileSync(sidebarPrefsPath(), `${JSON.stringify(payload, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
    chmodSync(sidebarPrefsPath(), 0o600);
  }
}

function normalizeRecord(value: unknown): DeviceSidebarPrefsRecord | null {
  if (!isRecord(value) || typeof value.deviceId !== "string") {
    return null;
  }
  return {
    deviceId: value.deviceId,
    thread: sanitizeThreadPrefs(value.thread),
    project: sanitizeProjectPrefs(value.project),
    updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : 0
  };
}

function sanitizeThreadPrefs(value: unknown): StoredThreadSidebarPrefs {
  if (!isRecord(value)) {
    return emptyThreadPrefs();
  }
  const pinned = Array.isArray(value.pinned)
    ? value.pinned.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
  return {
    pinned: [...new Set(pinned)]
  };
}

function sanitizeProjectPrefs(value: unknown): StoredProjectSidebarPrefs {
  if (!isRecord(value)) {
    return emptyProjectPrefs();
  }
  const pinned = Array.isArray(value.pinned)
    ? value.pinned.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
  const hidden = Array.isArray(value.hidden)
    ? value.hidden.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
  const renamed = isRecord(value.renamed)
    ? Object.fromEntries(
        Object.entries(value.renamed)
          .filter(
            (entry): entry is [string, string] =>
              typeof entry[0] === "string" && typeof entry[1] === "string"
          )
          .map(([cwd, name]) => [cwd, name.trim()] as const)
          .filter((entry) => entry[1].length > 0)
      )
    : {};
  return {
    hidden: [...new Set(hidden)],
    pinned: [...new Set(pinned)],
    renamed
  };
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sidebarPrefsDirectory(): string {
  return path.join(os.homedir(), ".codexnext");
}

function sidebarPrefsPath(): string {
  return path.join(sidebarPrefsDirectory(), "control-sidebar-prefs.json");
}
