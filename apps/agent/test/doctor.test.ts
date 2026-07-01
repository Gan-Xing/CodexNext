import { describe, expect, it } from "vitest";
import type { RelayDeviceRecord } from "@codexnext/protocol";
import { __doctorTestInternals } from "../src/commands/doctor.js";

describe("doctor redaction helpers", () => {
  it("formats relay URLs without credentials, query strings, or fragments", () => {
    expect(
      __doctorTestInternals.safeUrlLabel(
        "https://user:pass@relay.example/control?token=secret#section"
      )
    ).toBe("https://relay.example/control");
    expect(__doctorTestInternals.safeUrlLabel("not a url")).toBe("<invalid-url>");
  });

  it("accepts minimal non-sensitive health payloads", () => {
    expect(
      __doctorTestInternals.isSafeHealthPayload({
        ok: true,
        onlineDevices: 0,
        uptimeSeconds: 12
      })
    ).toBe(true);
  });

  it("rejects health payloads that include sensitive diagnostic fields", () => {
    for (const key of [
      "sessionToken",
      "ownerSecret",
      "prompt",
      "assistantContent",
      "commandOutput"
    ]) {
      expect(
        __doctorTestInternals.isSafeHealthPayload({
          ok: true,
          [key]: "must-not-be-rendered"
        })
      ).toBe(false);
    }
  });

  it("accepts safe Web auth status payloads only", () => {
    expect(
      __doctorTestInternals.isWebAuthStatusPayload({
        authenticated: false,
        loginRequired: true
      })
    ).toBe(true);
    expect(
      __doctorTestInternals.isWebAuthStatusPayload({
        authenticated: true,
        loginRequired: true,
        sessionToken: "must-not-be-rendered"
      })
    ).toBe(false);
  });

  it("accepts relay session bootstrap payloads without owner or device credentials", () => {
    expect(
      __doctorTestInternals.isSafeRelaySessionBootstrapPayload({
        relayUrl: "https://codexnext.example",
        sessionToken: "relay-session-token"
      })
    ).toBe(true);
    expect(
      __doctorTestInternals.isSafeRelaySessionBootstrapPayload({
        relayUrl: "https://codexnext.example",
        sessionToken: "relay-session-token",
        ownerToken: "must-not-leak"
      })
    ).toBe(false);
    expect(
      __doctorTestInternals.isSafeRelaySessionBootstrapPayload({
        relayUrl: "https://codexnext.example",
        sessionToken: "relay-session-token",
        deviceToken: "must-not-leak"
      })
    ).toBe(false);
  });

  it("normalizes origins for same-origin deployment checks", () => {
    expect(
      __doctorTestInternals.safeOriginLabel("https://codexnext.example/path?token=secret")
    ).toBe("https://codexnext.example");
    expect(__doctorTestInternals.safeOriginLabel("not a url")).toBeNull();
  });

  it("parses expected closed public endpoints without preserving URL secrets", () => {
    expect(__doctorTestInternals.parseExpectedClosedEndpoint("144.217.243.161:3002")).toEqual({
      host: "144.217.243.161",
      label: "144.217.243.161:3002",
      port: 3002
    });
    expect(
      __doctorTestInternals.parseExpectedClosedEndpoint(
        "https://user:pass@example.com:3922/path?token=secret"
      )
    ).toEqual({
      host: "example.com",
      label: "example.com:3922",
      port: 3922
    });
    expect(__doctorTestInternals.parseExpectedClosedEndpoint("missing-port")).toBeNull();
  });

  it("selects the requested online device for runtime checks", () => {
    const devices = [
      device("device_offline", false),
      device("device_online", true)
    ];

    expect(
      __doctorTestInternals.selectDoctorDevice(devices, "device_online").device?.deviceId
    ).toBe("device_online");
    expect(
      __doctorTestInternals.selectDoctorDevice(devices, "device_offline").device
    ).toBeNull();
    expect(
      __doctorTestInternals.selectDoctorDevice(devices, "device_missing").device
    ).toBeNull();
  });

  it("defaults runtime checks to the first online device", () => {
    const devices = [
      device("device_offline", false),
      device("device_online", true)
    ];

    expect(__doctorTestInternals.selectDoctorDevice(devices).device?.deviceId).toBe(
      "device_online"
    );
    expect(__doctorTestInternals.summarizeDoctorDevices(devices)).toBe(
      "1/2 devices online."
    );
  });
});

function device(deviceId: string, online: boolean): RelayDeviceRecord {
  return {
    activeSessions: 0,
    agentRunId: `run_${deviceId}`,
    agentVersion: "0.1.0",
    arch: "x64",
    deviceId,
    deviceName: deviceId,
    hostname: `${deviceId}.local`,
    lastSeenAt: 1,
    online,
    platform: "linux",
    startedAt: 1
  };
}
