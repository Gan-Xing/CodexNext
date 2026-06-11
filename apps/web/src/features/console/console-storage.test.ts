import { beforeEach, describe, expect, it } from "vitest";
import {
  hasRelayOnlyMigrationNoticeSeen,
  writeConsoleStorageItem,
  writeProjectSidebarPrefsStorage,
  writeRelayOnlyMigrationNoticeSeen,
  writeSavedDevicesStorage,
  writeSidebarWidthStorage,
  writeThreadSidebarPrefsStorage
} from "./console-storage";
import {
  relayOnlyMigrationNoticeStorageKey,
  savedDevicesStorageKey,
  sidebarWidthStorageKey
} from "../devices/device-utils";
import {
  projectSidebarPrefsStorageKey,
  threadSidebarPrefsStorageKey
} from "../sessions/session-utils";

describe("console localStorage helpers", () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  it("only writes allowlisted console preference keys", () => {
    writeConsoleStorageItem(storage, relayOnlyMigrationNoticeStorageKey, "1");
    expect(storage.getItem(relayOnlyMigrationNoticeStorageKey)).toBe("1");

    expect(() =>
      writeConsoleStorageItem(storage, "codexnext.ownerToken", "1")
    ).toThrow(/unsupported localStorage key/);
  });

  it("sanitizes saved relay devices before writing", () => {
    const written = writeSavedDevicesStorage(storage, [
      {
        id: "device_saved",
        name: "session-token-must-not-persist",
        mode: "relay",
        relayUrl: "http://relay.local////?token=leak",
        deviceId: "device_1",
        sessionToken: "session-token-must-not-persist",
        ownerToken: "owner-token-must-not-persist",
        deviceToken: "device-token-must-not-persist"
      } as never
    ]);

    expect(written).toEqual([
      {
        id: "device_saved",
        name: "device_1",
        mode: "relay",
        relayUrl: "http://relay.local",
        deviceId: "device_1"
      }
    ]);
    expect(storage.getItem(savedDevicesStorageKey)).not.toMatch(
      /session-token|owner-token|device-token|token=leak/
    );
  });

  it("sanitizes sidebar preference writes and stores width/migration flags only", () => {
    writeThreadSidebarPrefsStorage(storage, {
      "relay|http://relay.local|device_1": {
        pinned: ["thread_1", "session-token-must-not-persist"]
      }
    });
    writeProjectSidebarPrefsStorage(storage, {
      "relay|http://relay.local|device_1": {
        hidden: ["project_1", "owner-token-must-not-persist"],
        pinned: ["project_2", "device-token-must-not-persist"],
        renamed: {
          "/repo": "Repo",
          "/secret": "bearer abc123"
        }
      }
    });
    writeSidebarWidthStorage(storage, 311.4);
    writeRelayOnlyMigrationNoticeSeen(storage);

    expect(storage.getItem(threadSidebarPrefsStorageKey)).toBe(
      JSON.stringify({
        "relay|http://relay.local|device_1": { pinned: ["thread_1"] }
      })
    );
    expect(storage.getItem(projectSidebarPrefsStorageKey)).toBe(
      JSON.stringify({
        "relay|http://relay.local|device_1": {
          hidden: ["project_1"],
          pinned: ["project_2"],
          renamed: { "/repo": "Repo" }
        }
      })
    );
    expect(storage.getItem(sidebarWidthStorageKey)).toBe("311");
    expect(hasRelayOnlyMigrationNoticeSeen(storage)).toBe(true);
  });
});

class MemoryStorage implements Storage {
  public readonly length = 0;
  private readonly values = new Map<string, string>();

  public clear(): void {
    this.values.clear();
  }

  public getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  public key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  public removeItem(key: string): void {
    this.values.delete(key);
  }

  public setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}
