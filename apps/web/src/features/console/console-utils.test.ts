import { describe, expect, it } from "vitest";
import {
  availableRelayPermissionOptions,
  classifyRelaySessionError,
  coerceRelayPermissionMode,
  formatConsoleConnectionError,
  formatConsoleError,
  formatRelaySessionError,
  mergeDevicePresenceResults,
  seedSavedDevicePresence
} from "./console-utils";

const options = [
  { label: "request", mode: "request-approval" as const },
  { label: "auto", mode: "auto-approve" as const },
  { label: "full", mode: "full-access" as const },
  { label: "custom", mode: "custom-config" as const }
];

describe("console permission helpers", () => {
  it("hides full access only when relay is enabled and relay full access is disabled", () => {
    expect(
      availableRelayPermissionOptions(options, {
        relayEnabled: true,
        relayFullAccessEnabled: false
      }).map((option) => option.mode)
    ).toEqual(["request-approval", "auto-approve", "custom-config"]);

    expect(
      availableRelayPermissionOptions(options, {
        relayEnabled: false,
        relayFullAccessEnabled: false
      }).map((option) => option.mode)
    ).toContain("full-access");

    expect(
      availableRelayPermissionOptions(options, {
        relayEnabled: true,
        relayFullAccessEnabled: true
      }).map((option) => option.mode)
    ).toContain("full-access");
  });

  it("coerces a selected mode when the available options no longer contain it", () => {
    const filtered = availableRelayPermissionOptions(options, {
      relayEnabled: true,
      relayFullAccessEnabled: false
    });
    expect(coerceRelayPermissionMode("full-access", filtered)).toBe(
      "request-approval"
    );
    expect(coerceRelayPermissionMode("auto-approve", filtered)).toBe(
      "auto-approve"
    );
  });
});

describe("relay session error classification", () => {
  it("classifies clear HTTP and socket session expiry errors", () => {
    expect(classifyRelaySessionError(new Error("401 Unauthorized"))).toBe(
      "expired"
    );
    expect(classifyRelaySessionError({ data: { status: 410 } })).toBe(
      "expired"
    );
    const socketError = new Error("connect_error") as Error & {
      data?: { status: number };
    };
    socketError.data = { status: 401 };
    expect(classifyRelaySessionError(socketError)).toBe("expired");
    expect(classifyRelaySessionError(new Error("session revoked"))).toBe(
      "expired"
    );
  });

  it("formats expired relay sessions without leaking the raw transport message", () => {
    expect(formatRelaySessionError(new Error("Unauthorized token abc123"))).toBe(
      "登录会话已过期，请重新登录后再试。"
    );
    expect(formatRelaySessionError(new Error("socket hang up"))).toBeNull();
    expect(formatRelaySessionError({ data: { status: 500 } })).toBeNull();
    expect(formatRelaySessionError(new Error("not authorized for device"))).toBeNull();
  });

  it("formats controller-facing errors with relay expiry override", () => {
    expect(formatConsoleError(new Error("Unauthorized token abc123"))).toBe(
      "登录会话已过期，请重新登录后再试。"
    );
    expect(formatConsoleError(new Error("socket hang up"))).toBe(
      "socket hang up"
    );
  });

  it("formats controller connection errors with relay expiry override", () => {
    expect(
      formatConsoleConnectionError(
        new Error("Unauthorized token abc123"),
        "https://relay.example"
      )
    ).toBe("登录会话已过期，请重新登录后再试。");
    expect(
      formatConsoleConnectionError(
        new Error("socket hang up"),
        "https://relay.example"
      )
    ).toBe("socket hang up");
  });
});

describe("device presence helpers", () => {
  it("seeds saved devices as checking while preserving existing presence", () => {
    expect(
      seedSavedDevicePresence(
        {
          device_1: {
            checkedAt: 1,
            codexVersion: "codex 0.1.0",
            status: "online"
          },
          removed: {
            checkedAt: 1,
            status: "offline"
          }
        },
        [
          { id: "device_1", codexVersion: "codex 0.1.0" },
          { id: "device_2", codexVersion: null }
        ],
        10
      )
    ).toEqual({
      device_1: {
        checkedAt: 1,
        codexVersion: "codex 0.1.0",
        status: "online"
      },
      device_2: {
        checkedAt: 10,
        codexVersion: null,
        status: "checking"
      }
    });
  });

  it("merges presence results only for saved devices", () => {
    expect(
      mergeDevicePresenceResults(
        {
          device_1: {
            checkedAt: 1,
            status: "checking"
          },
          device_removed: {
            checkedAt: 1,
            status: "offline"
          }
        },
        new Set(["device_1", "device_2"]),
        [
          {
            id: "device_2",
            presence: {
              checkedAt: 2,
              codexVersion: "codex 0.2.0",
              status: "online"
            }
          },
          {
            id: "device_removed",
            presence: {
              checkedAt: 2,
              status: "online"
            }
          }
        ]
      )
    ).toEqual({
      device_1: {
        checkedAt: 1,
        status: "checking"
      },
      device_2: {
        checkedAt: 2,
        codexVersion: "codex 0.2.0",
        status: "online"
      }
    });
  });
});
