import { mkdtempSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertAllowedDirectHost, assertDevDirectEnabled } from "../src/commands/serve.js";
import { readOrCreateDeviceIdentity } from "../src/relay/device-identity.js";

const originalHome = process.env.HOME;

afterEach(() => {
  process.env.HOME = originalHome;
});

describe("agent security guards", () => {
  it("rejects remote direct mode without explicit opt-in", () => {
    expect(() => assertAllowedDirectHost("0.0.0.0", false)).toThrow(
      /allow-remote-direct/
    );
    expect(() => assertAllowedDirectHost("127.0.0.1", false)).not.toThrow();
  });

  it("requires an explicit env opt-in for direct dev mode", () => {
    delete process.env.CODEXNEXT_ENABLE_DEV_DIRECT;
    expect(() => assertDevDirectEnabled()).toThrow(/CODEXNEXT_ENABLE_DEV_DIRECT=1/);
    process.env.CODEXNEXT_ENABLE_DEV_DIRECT = "1";
    expect(() => assertDevDirectEnabled()).not.toThrow();
  });

  it("writes device identity with restrictive permissions", async () => {
    const tempHome = mkdtempSync(path.join(os.tmpdir(), "codexnext-agent-"));
    process.env.HOME = tempHome;
    const identity = await readOrCreateDeviceIdentity({
      deviceName: "Test Device",
      relayUrl: "http://relay.local"
    });
    expect(identity.deviceId).toBeTruthy();
    const stats = statSync(path.join(tempHome, ".codexnext", "device.json"));
    expect(stats.mode & 0o777).toBe(0o600);
  });
});
