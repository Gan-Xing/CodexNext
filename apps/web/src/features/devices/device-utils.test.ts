import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  connectionFromSavedDevice,
  readSavedDevicesState,
  savedDevicesStorageKey
} from "./device-utils";

describe("device utils", () => {
  let localStorage: MemoryStorage;

  beforeEach(() => {
    localStorage = new MemoryStorage();
    vi.stubGlobal("window", {
      localStorage
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("drops direct devices and strips token-like fields from saved relay devices", () => {
    localStorage.setItem(
      savedDevicesStorageKey,
      JSON.stringify([
        {
          id: "legacy_direct",
          name: "Legacy Direct",
          mode: "direct",
          agentUrl: "http://127.0.0.1:17361",
          token: "direct-token"
        },
        {
          id: "relay_device",
          name: "Relay Device",
          mode: "relay",
          relayUrl: "http://relay.local////?token=leak",
          deviceId: "device_1",
          sessionToken: "session-token-must-not-persist",
          ownerToken: "owner-token-must-not-persist",
          deviceToken: "device-token-must-not-persist"
        }
      ])
    );

    const state = readSavedDevicesState();
    expect(state.droppedLegacyDirectDevices).toBe(1);
    expect(state.devices).toEqual([
      {
        id: "relay_device",
        name: "Relay Device",
        mode: "relay",
        relayUrl: "http://relay.local",
        deviceId: "device_1"
      }
    ]);
    expect(localStorage.getItem(savedDevicesStorageKey)).not.toMatch(
      /session-token|owner-token|device-token|direct-token/
    );
  });

  it("requires an in-memory relay session token to build a connection", () => {
    const device = {
      id: "relay_device",
      name: "Relay Device",
      mode: "relay" as const,
      relayUrl: "http://relay.local",
      deviceId: "device_1"
    };

    expect(connectionFromSavedDevice(device, null)).toBeNull();
    expect(connectionFromSavedDevice(device, "session-token")).toEqual({
      mode: "relay",
      relayUrl: "http://relay.local",
      sessionToken: "session-token",
      deviceId: "device_1"
    });
  });
});

class MemoryStorage {
  private readonly values = new Map<string, string>();

  public getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  public setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}
