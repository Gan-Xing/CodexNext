import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DeviceSheet } from "./sheets/DeviceSheet";

const noop = () => {};

type DeviceSheetProps = Parameters<typeof DeviceSheet>[0];

function renderDeviceSheet(overrides: Partial<DeviceSheetProps> = {}): string {
  const props: DeviceSheetProps = {
    connected: false,
    connection: {
      deviceId: "",
      mode: "relay",
      relayUrl: "https://codexnext.byganxing.com",
      sessionToken: ""
    },
    deviceName: "",
    devicePresence: {},
    healthStatus: null,
    migrationNotice: null,
    relayConnectionInfo: {
      accessToken: "relay-session-token-secret",
      relayUrl: "https://codexnext.byganxing.com"
    },
    savedDevices: [],
    selectedDeviceId: null,
    streamStatus: "disconnected",
    onClose: noop,
    onConnect: async () => undefined,
    onDeleteDevice: noop,
    onDismissMigrationNotice: noop,
    onRefreshRelayDevices: async () => []
  };
  return renderToStaticMarkup(
    createElement(DeviceSheet, {
      ...props,
      ...overrides
    })
  );
}

describe("DeviceSheet rendering", () => {
  it("renders relay pairing without direct connection fields or browser tokens", () => {
    const markup = renderDeviceSheet({
      savedDevices: [],
      selectedDeviceId: null
    });

    expect(markup).toContain("连接设备");
    expect(markup).toContain("codexnext pair --relay https://codexnext.byganxing.com");
    expect(markup).toContain('aria-label="配对码"');
    expect(markup).toContain("查找配对码");
    expect(markup).not.toContain("relay-session-token-secret");
    expect(markup).not.toContain("Access Token");
    expect(markup).not.toContain("Agent URL");
    expect(markup).not.toContain("144.217.243.161:3002");
  });

  it("renders saved relay devices with online state and no pair command by default", () => {
    const markup = renderDeviceSheet({
      connected: true,
      connection: {
        deviceId: "device_1",
        mode: "relay",
        relayUrl: "https://codexnext.byganxing.com",
        sessionToken: "relay-session-token-secret"
      },
      devicePresence: {
        device_saved_1: {
          checkedAt: 1,
          codexVersion: "codex-cli 0.142.3",
          status: "online"
        },
        device_saved_2: {
          checkedAt: 1,
          status: "offline"
        }
      },
      savedDevices: [
        {
          deviceId: "device_1",
          hostname: "linux-workstation.local",
          id: "device_saved_1",
          mode: "relay",
          name: "Linux Workstation",
          relayUrl: "https://codexnext.byganxing.com"
        },
        {
          deviceId: "device_2",
          hostname: "macbook.local",
          id: "device_saved_2",
          mode: "relay",
          name: "MacBook",
          relayUrl: "https://codexnext.byganxing.com"
        }
      ],
      selectedDeviceId: "device_saved_1",
      streamStatus: "connected"
    });

    expect(markup).toContain('aria-label="已接入设备"');
    expect(markup).toContain('aria-label="当前设备"');
    expect(markup).toContain("2 台设备 · 1 在线");
    expect(markup).toContain("Linux Workstation");
    expect(markup).toContain("linux-workstation.local");
    expect(markup).toContain("codex-cli 0.142.3");
    expect(markup).toContain("重新连接");
    expect(markup).not.toContain("codexnext pair --relay");
    expect(markup).not.toContain("relay-session-token-secret");
  });
});
