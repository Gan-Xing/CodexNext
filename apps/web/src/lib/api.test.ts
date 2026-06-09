import { describe, expect, it } from "vitest";
import { resolveAgentUrl } from "./api";

describe("relay api url mapping", () => {
  const relayConnection = {
    mode: "relay" as const,
    relayUrl: "http://127.0.0.1:3002",
    sessionToken: "session",
    deviceId: "device_1"
  };

  it("maps health to relay device health", () => {
    expect(resolveAgentUrl(relayConnection, "/api/health").toString()).toBe(
      "http://127.0.0.1:3002/api/relay/devices/device_1/health"
    );
  });

  it("maps sessions and history endpoints to relay device routes", () => {
    expect(resolveAgentUrl(relayConnection, "/api/sessions").toString()).toBe(
      "http://127.0.0.1:3002/api/relay/devices/device_1/sessions"
    );
    expect(
      resolveAgentUrl(
        relayConnection,
        "/api/codex-history/detail?id=thread_1&cwd=%2Ftmp"
      ).toString()
    ).toBe(
      "http://127.0.0.1:3002/api/relay/devices/device_1/codex-history/detail?id=thread_1&cwd=%2Ftmp"
    );
    expect(
      resolveAgentUrl(
        relayConnection,
        "/api/codex-history/turns?id=thread_1&cursor=older"
      ).toString()
    ).toBe(
      "http://127.0.0.1:3002/api/relay/devices/device_1/codex-history/turns?id=thread_1&cursor=older"
    );
    expect(
      resolveAgentUrl(relayConnection, "/api/codex-history/loaded").toString()
    ).toBe(
      "http://127.0.0.1:3002/api/relay/devices/device_1/codex-history/loaded"
    );
    expect(
      resolveAgentUrl(relayConnection, "/api/codex-history/archive").toString()
    ).toBe(
      "http://127.0.0.1:3002/api/relay/devices/device_1/codex-history/archive"
    );
  });

  it("maps approval and goal paths without changing the tail segments", () => {
    expect(
      resolveAgentUrl(
        relayConnection,
        "/api/approvals/appr_1/decision"
      ).toString()
    ).toBe(
      "http://127.0.0.1:3002/api/relay/devices/device_1/approvals/appr_1/decision"
    );
    expect(
      resolveAgentUrl(
        relayConnection,
        "/api/sessions/session_1/goal"
      ).toString()
    ).toBe(
      "http://127.0.0.1:3002/api/relay/devices/device_1/sessions/session_1/goal"
    );
  });
});
