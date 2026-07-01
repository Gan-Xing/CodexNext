import { beforeEach, describe, expect, it } from "vitest";
import {
  hasRelayOnlyMigrationNoticeSeen,
  readWorkspaceSidebarSnapshotsStorage,
  sessionSelectionStorageKey,
  writeConsoleStorageItem,
  writeProjectSidebarPrefsStorage,
  writeRelayOnlyMigrationNoticeSeen,
  writeSavedDevicesStorage,
  writeSessionSelectionStorage,
  writeSidebarWidthStorage,
  workspaceSidebarSnapshotStorageKey,
  writeThreadSidebarPrefsStorage,
  writeWorkspaceSidebarSnapshotsStorage
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
    Object.defineProperty(globalThis, "window", {
      value: { localStorage: storage },
      configurable: true
    });
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

  it("round-trips and sanitizes persisted session selections", () => {
    writeSessionSelectionStorage(storage, {
      "relay|http://relay.local|device_1": {
        currentSessionId: "session_1",
        selectedHistoryKey: "thread_1::/repo"
      },
      "relay|http://relay.local|device_2": {
        currentSessionId: "session-token-must-not-persist",
        selectedHistoryKey: "thread_2::/repo"
      }
    });

    expect(storage.getItem(sessionSelectionStorageKey)).toBe(
      JSON.stringify({
        "relay|http://relay.local|device_1": {
          currentSessionId: "session_1",
          selectedHistoryKey: "thread_1::/repo"
        },
        "relay|http://relay.local|device_2": {
          currentSessionId: null,
          selectedHistoryKey: "thread_2::/repo"
        }
      })
    );
  });

  it("persists sidebar snapshots for instant workspace restore", () => {
    writeWorkspaceSidebarSnapshotsStorage(storage, {
      device_1: {
        codexHistory: [
          {
            id: "thread_1",
            cwd: "/repo",
            title: "优化首页体验",
            createdAt: "2026-06-12T10:00:00.000Z",
            updatedAt: "2026-06-12T10:05:00.000Z",
            source: "history",
            loaded: true
          }
        ],
        currentSessionId: "history-preview:thread_1::/repo",
        cwd: "/repo",
        loadedThreadIds: ["thread_1", "" as never],
        model: "gpt-5.5",
        permissionMode: "auto-approve",
        providerSelection: {
          apiKeyEnv: "OPENROUTER_API_KEY",
          baseUrl: "https://openrouter.ai/api/v1",
          label: "OpenRouter",
          model: "deepseek/deepseek-chat-v3-0324",
          profileId: "openrouter"
        },
        reasoningEffort: "low",
        selectedHistoryKey: "thread_1::/repo",
        serviceTier: "priority",
        sessionHistoryOrigins: {
          "history-preview:thread_1::/repo": "thread_1",
          "": "ignored"
        },
        sessions: [
          {
            sessionId: "history-preview:thread_1::/repo",
            threadId: "thread_1",
            status: "idle",
            cwd: "/repo",
            title: "优化首页体验",
            model: "gpt-5.5",
            providerProfileId: null,
            provider: null,
            serviceTier: null,
            reasoningEffort: "high",
            permissionMode: "request-approval",
            approvalPolicy: "on-request",
            approvalsReviewer: "user",
            sandbox: "workspace-write",
            queuedMessages: [],
            goal: {
              objective: "should not persist",
              status: "active"
            } as never,
            createdAt: 1,
            updatedAt: 2
          }
        ]
      }
    });

    expect(readWorkspaceSidebarSnapshotsStorage()).toEqual({
      device_1: {
        codexHistory: [
          {
            id: "thread_1",
            cwd: "/repo",
            title: "优化首页体验",
            createdAt: "2026-06-12T10:00:00.000Z",
            updatedAt: "2026-06-12T10:05:00.000Z",
            source: "history",
            loaded: true
          }
        ],
        currentSessionId: "history-preview:thread_1::/repo",
        cwd: "/repo",
        loadedThreadIds: ["thread_1"],
        model: "gpt-5.5",
        permissionMode: "auto-approve",
        providerSelection: {
          apiKeyEnv: "OPENROUTER_API_KEY",
          baseUrl: "https://openrouter.ai/api/v1",
          label: "OpenRouter",
          model: "deepseek/deepseek-chat-v3-0324",
          profileId: "openrouter"
        },
        reasoningEffort: "low",
        selectedHistoryKey: "thread_1::/repo",
        serviceTier: "priority",
        sessionHistoryOrigins: {
          "history-preview:thread_1::/repo": "thread_1"
        },
        sessions: [
          {
            sessionId: "history-preview:thread_1::/repo",
            threadId: "thread_1",
            status: "idle",
            cwd: "/repo",
            title: "优化首页体验",
            model: "gpt-5.5",
            providerProfileId: null,
            provider: null,
            serviceTier: null,
            reasoningEffort: "high",
            permissionMode: "request-approval",
            approvalPolicy: "on-request",
            approvalsReviewer: "user",
            sandbox: "workspace-write",
            queuedMessages: [],
            goal: null,
            createdAt: 1,
            updatedAt: 2
          }
        ]
      }
    });
  });

  it("keeps workspace service tiers scoped by saved device", () => {
    writeWorkspaceSidebarSnapshotsStorage(storage, {
      device_fast: {
        codexHistory: [],
        currentSessionId: null,
        cwd: "/repo-fast",
        loadedThreadIds: [],
        model: "gpt-5.5",
        permissionMode: "auto-approve",
        providerSelection: {
          apiKeyEnv: "OPENROUTER_API_KEY",
          baseUrl: "https://openrouter.ai/api/v1",
          label: "OpenRouter",
          model: "deepseek/deepseek-chat-v3-0324",
          profileId: "openrouter"
        },
        reasoningEffort: "low",
        selectedHistoryKey: null,
        serviceTier: "priority",
        sessionHistoryOrigins: {},
        sessions: []
      },
      device_default: {
        codexHistory: [],
        currentSessionId: null,
        cwd: "/repo-default",
        loadedThreadIds: [],
        model: "gpt-5.5",
        permissionMode: "request-approval",
        providerSelection: {
          apiKeyEnv: "",
          baseUrl: "",
          label: "",
          model: "",
          profileId: ""
        },
        reasoningEffort: "xhigh",
        selectedHistoryKey: null,
        serviceTier: null,
        sessionHistoryOrigins: {},
        sessions: []
      }
    });

    expect(readWorkspaceSidebarSnapshotsStorage()).toMatchObject({
      device_fast: {
        cwd: "/repo-fast",
        model: "gpt-5.5",
        permissionMode: "auto-approve",
        providerSelection: {
          apiKeyEnv: "OPENROUTER_API_KEY",
          baseUrl: "https://openrouter.ai/api/v1",
          label: "OpenRouter",
          model: "deepseek/deepseek-chat-v3-0324",
          profileId: "openrouter"
        },
        reasoningEffort: "low",
        serviceTier: "priority"
      },
      device_default: {
        cwd: "/repo-default",
        model: "gpt-5.5",
        permissionMode: "request-approval",
        providerSelection: {
          apiKeyEnv: "",
          baseUrl: "",
          label: "",
          model: "",
          profileId: ""
        },
        reasoningEffort: "xhigh",
        serviceTier: null
      }
    });
  });

  it("drops raw Provider API keys when restoring workspace snapshots", () => {
    storage.setItem(
      workspaceSidebarSnapshotStorageKey,
      JSON.stringify({
        device_1: {
          codexHistory: [],
          currentSessionId: null,
          cwd: "/repo",
          loadedThreadIds: [],
          model: "gpt-5.5",
          permissionMode: "request-approval",
          providerSelection: {
            apiKey: "sk-direct-token-must-not-restore",
            apiKeyEnv: "OPENROUTER_API_KEY",
            baseUrl: "https://openrouter.ai/api/v1",
            label: "OpenRouter",
            model: "deepseek/deepseek-chat-v3-0324",
            profileId: "openrouter"
          },
          reasoningEffort: "xhigh",
          selectedHistoryKey: null,
          serviceTier: null,
          sessionHistoryOrigins: {},
          sessions: []
        }
      })
    );

    const restored = readWorkspaceSidebarSnapshotsStorage();

    expect(JSON.stringify(restored)).not.toContain("sk-direct-token");
    expect(restored.device_1?.providerSelection).toEqual({
      apiKeyEnv: "OPENROUTER_API_KEY",
      baseUrl: "https://openrouter.ai/api/v1",
      label: "OpenRouter",
      model: "deepseek/deepseek-chat-v3-0324",
      profileId: "openrouter"
    });
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
