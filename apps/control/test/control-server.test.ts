import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { io, type Socket } from "socket.io-client";
import type {
  DeviceEventPayload,
  MachineHelloAck,
  PairingApproveResponse,
  PairingCreateResponse,
  PairingRequestView,
  RelayDeviceRecord,
  RelayErrorAck,
  RelayRpcRequest
} from "@codexnext/protocol";
import {
  RelayMethod as RelayMethodValue,
  RelayNamespace,
  RelaySocketPath
} from "@codexnext/protocol";
import { DeviceRegistry } from "../src/device-registry.js";
import { createControlServer, type ControlServerHandle } from "../src/server.js";

const ownerToken = "owner-token";
const handles = new Set<ControlServerHandle>();
const sockets = new Set<Socket>();
const originalHome = process.env.HOME;
const originalDisableRelayFullAccess = process.env.CODEXNEXT_DISABLE_RELAY_FULL_ACCESS;
const originalRpcResponseMaxBytes = process.env.CODEXNEXT_RPC_RESPONSE_MAX_BYTES;

afterEach(async () => {
  for (const socket of sockets) {
    socket.close();
  }
  sockets.clear();
  for (const handle of handles) {
    await handle.close();
  }
  handles.clear();
  process.env.HOME = originalHome;
  if (originalDisableRelayFullAccess === undefined) {
    delete process.env.CODEXNEXT_DISABLE_RELAY_FULL_ACCESS;
  } else {
    process.env.CODEXNEXT_DISABLE_RELAY_FULL_ACCESS = originalDisableRelayFullAccess;
  }
  if (originalRpcResponseMaxBytes === undefined) {
    delete process.env.CODEXNEXT_RPC_RESPONSE_MAX_BYTES;
  } else {
    process.env.CODEXNEXT_RPC_RESPONSE_MAX_BYTES = originalRpcResponseMaxBytes;
  }
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("control server relay", () => {
  it("rejects missing owner token on device list", async () => {
    const { baseUrl } = await startServer();
    const response = await fetch(`${baseUrl}/api/devices`);
    expect(response.status).toBe(401);
  });

  it("registers machine hello and updates heartbeat presence", async () => {
    const { baseUrl } = await startServer();
    const machine = createMachineSocket(baseUrl, "device_1", {
      ownerToken
    });
    const hello = await waitForConnect(machine, () =>
      emitAck<MachineHelloAck | RelayErrorAck>(machine, "machine:hello", {
        deviceId: "device_1",
        deviceName: "MacBook Pro",
        hostname: "macbook-pro.local",
        platform: "darwin",
        arch: "arm64",
        agentVersion: "0.1.0",
        agentRunId: "agent_run_1",
        codexVersion: "codex-cli 0.1",
        startedAt: Date.now()
      })
    );
    expect(hello.ok).toBe(true);

    machine.emit("machine:heartbeat", {
      deviceId: "device_1",
      at: Date.now(),
      activeSessions: 2
    });

    const response = await authorizedFetch(`${baseUrl}/api/devices`);
    const payload = (await response.json()) as { devices: RelayDeviceRecord[] };
    expect(payload.devices[0]).toMatchObject({
      deviceId: "device_1",
      deviceName: "MacBook Pro",
      online: true,
      activeSessions: 2
    });
  });

  it("marks stale devices offline without removing device state", async () => {
    const { baseUrl } = await startServer({
      pruneIntervalMs: 10,
      staleDeviceTimeoutMs: 25
    });
    const session = await fetch(`${baseUrl}/api/auth/session`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ownerToken}`
      }
    });
    const sessionPayload = (await session.json()) as { sessionToken: string };
    const browser = createUserSocket(baseUrl, {}, sessionPayload.sessionToken);
    await waitForConnect(browser, async () => undefined);
    const offline = waitForDeviceOffline(browser);

    const machine = createMachineSocket(baseUrl, "device_stale", {
      ownerToken
    });
    await waitForConnect(machine, () =>
      emitAck<MachineHelloAck | RelayErrorAck>(machine, "machine:hello", {
        deviceId: "device_stale",
        deviceName: "Stale Device",
        hostname: "stale-device.local",
        platform: "darwin",
        arch: "arm64",
        agentVersion: "0.1.0",
        agentRunId: "agent_run_1",
        startedAt: Date.now()
      })
    );
    await expect(offline).resolves.toMatchObject({
      deviceId: "device_stale"
    });

    const response = await authorizedFetch(`${baseUrl}/api/devices`, sessionPayload.sessionToken);
    const payload = (await response.json()) as { devices: RelayDeviceRecord[] };
    expect(payload.devices).toHaveLength(1);
    expect(payload.devices[0]).toMatchObject({
      deviceId: "device_stale",
      online: false
    });
  });

  it("requires auth for sidebar prefs endpoints", async () => {
    const { baseUrl } = await startServer();
    const response = await fetch(`${baseUrl}/api/devices/device_1/sidebar-prefs`);
    expect(response.status).toBe(401);
  });

  it("returns not found for sidebar prefs on unknown devices", async () => {
    const { baseUrl } = await startServer();
    const response = await authorizedFetch(
      `${baseUrl}/api/devices/missing-device/sidebar-prefs`
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Device not found"
    });
  });

  it("stores relay sidebar prefs per device", async () => {
    const tempHome = mkdtempSync(path.join(os.tmpdir(), "codexnext-sidebar-prefs-"));
    process.env.HOME = tempHome;
    const { baseUrl } = await startServer();
    const machine = createMachineSocket(baseUrl, "device_1", {
      ownerToken
    });
    await waitForConnect(machine, () =>
      emitAck(machine, "machine:hello", {
        deviceId: "device_1",
        deviceName: "MacBook Pro",
        hostname: "macbook-pro.local",
        platform: "darwin",
        arch: "arm64",
        agentVersion: "0.1.0",
        agentRunId: "agent_run_1",
        startedAt: Date.now()
      })
    );

    const defaultsResponse = await authorizedFetch(
      `${baseUrl}/api/devices/device_1/sidebar-prefs`
    );
    expect(defaultsResponse.status).toBe(200);
    expect(await defaultsResponse.json()).toEqual({
      project: {
        hidden: [],
        pinned: [],
        renamed: {}
      },
      thread: {
        pinned: []
      }
    });

    const updateResponse = await fetch(`${baseUrl}/api/devices/device_1/sidebar-prefs`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${ownerToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        project: {
          hidden: ["/tmp/dev"],
          pinned: ["/tmp/dev"],
          renamed: {
            "/tmp/dev": "dev"
          }
        },
        thread: {
          pinned: ["thread_hot"]
        }
      })
    });
    expect(updateResponse.status).toBe(200);
    expect(await updateResponse.json()).toEqual({
      project: {
        hidden: ["/tmp/dev"],
        pinned: ["/tmp/dev"],
        renamed: {
          "/tmp/dev": "dev"
        }
      },
      thread: {
        pinned: ["thread_hot"]
      }
    });

    const rereadResponse = await authorizedFetch(
      `${baseUrl}/api/devices/device_1/sidebar-prefs`
    );
    expect(rereadResponse.status).toBe(200);
    expect(await rereadResponse.json()).toEqual({
      project: {
        hidden: ["/tmp/dev"],
        pinned: ["/tmp/dev"],
        renamed: {
          "/tmp/dev": "dev"
        }
      },
      thread: {
        pinned: ["thread_hot"]
      }
    });

    const persisted = readFileSync(
      path.join(tempHome, ".codexnext", "control-sidebar-prefs.json"),
      "utf8"
    );
    expect(persisted).toContain("\"deviceId\": \"device_1\"");
    expect(persisted).toContain("\"thread_hot\"");
    expect(persisted).toContain("\"/tmp/dev\"");
  });

  it("returns relay rpc ack results over HTTP", async () => {
    const { baseUrl } = await startServer();
    const machine = createMachineSocket(baseUrl, "device_1", {
      ownerToken
    });
    await waitForConnect(machine, () =>
      emitAck(machine, "machine:hello", {
        deviceId: "device_1",
        deviceName: "MacBook Pro",
        hostname: "macbook-pro.local",
        platform: "darwin",
        arch: "arm64",
        agentVersion: "0.1.0",
        agentRunId: "agent_run_1",
        startedAt: Date.now()
      })
    );

    machine.on("rpc:request", (request: RelayRpcRequest, ack: (response: unknown) => void) => {
      if (request.method === "agent.health") {
        ack({
          ok: true,
          result: {
            ok: true,
            version: "0.1.0",
            pid: 123,
            uptimeSeconds: 1,
            host: "relay",
            port: 0,
            device: {
              defaultName: "MacBook Pro",
              hostname: "macbook-pro.local",
              platform: "darwin"
            },
            codex: {
              available: true,
              version: "codex-cli 0.1"
            }
          }
        });
      }
    });

    const response = await authorizedFetch(
      `${baseUrl}/api/relay/devices/device_1/health`
    );
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
      ok: true,
      codex: { available: true }
    });
  });

  it("rejects malformed successful relay rpc results over HTTP", async () => {
    const { baseUrl } = await startServer();
    const machine = createMachineSocket(baseUrl, "device_1", {
      ownerToken
    });
    await waitForConnect(machine, () =>
      emitAck(machine, "machine:hello", {
        deviceId: "device_1",
        deviceName: "MacBook Pro",
        hostname: "macbook-pro.local",
        platform: "darwin",
        arch: "arm64",
        agentVersion: "0.1.0",
        agentRunId: "agent_run_1",
        startedAt: Date.now()
      })
    );

    machine.on("rpc:request", (request: RelayRpcRequest, ack: (response: unknown) => void) => {
      if (request.method === "agent.health") {
        ack({
          ok: true,
          result: {
            ok: true,
            version: "0.1.0",
            pid: "not-a-number",
            uptimeSeconds: 1,
            host: "relay",
            port: 0
          }
        });
      }
    });

    const response = await authorizedFetch(
      `${baseUrl}/api/relay/devices/device_1/health`
    );
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid relay RPC result for agent.health"
    });
  });

  it("maps stale approval decisions from the machine to deterministic HTTP errors", async () => {
    const { baseUrl } = await startServer();
    const machine = createMachineSocket(baseUrl, "device_1", {
      ownerToken
    });
    await waitForConnect(machine, () =>
      emitAck(machine, "machine:hello", {
        deviceId: "device_1",
        deviceName: "MacBook Pro",
        hostname: "macbook-pro.local",
        platform: "darwin",
        arch: "arm64",
        agentVersion: "0.1.0",
        agentRunId: "agent_run_1",
        startedAt: Date.now()
      })
    );

    const resolvedApprovals = new Set<string>();
    machine.on("rpc:request", (request: RelayRpcRequest, ack: (response: unknown) => void) => {
      if (request.method !== RelayMethodValue.ApprovalDecision) {
        return;
      }
      const params = request.params as { approvalId?: string };
      const approvalId = params.approvalId ?? "";
      if (resolvedApprovals.has(approvalId)) {
        ack({
          ok: false,
          error: {
            message: `No pending approval for id ${approvalId}`,
            code: "not_found"
          }
        });
        return;
      }
      resolvedApprovals.add(approvalId);
      ack({
        ok: true,
        result: { decision: "accept" }
      });
    });

    const first = await fetch(
      `${baseUrl}/api/relay/devices/device_1/approvals/approval_1/decision`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ownerToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ decision: "accept" })
      }
    );
    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toEqual({ decision: "accept" });

    const second = await fetch(
      `${baseUrl}/api/relay/devices/device_1/approvals/approval_1/decision`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ownerToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ decision: "decline" })
      }
    );
    expect(second.status).toBe(404);
    await expect(second.json()).resolves.toEqual({
      error: "No pending approval for id approval_1"
    });
  });

  it("returns loaded thread ids over relay HTTP", async () => {
    const { baseUrl } = await startServer();
    const machine = createMachineSocket(baseUrl, "device_1", {
      ownerToken
    });
    await waitForConnect(machine, () =>
      emitAck(machine, "machine:hello", {
        deviceId: "device_1",
        deviceName: "MacBook Pro",
        hostname: "macbook-pro.local",
        platform: "darwin",
        arch: "arm64",
        agentVersion: "0.1.0",
        agentRunId: "agent_run_1",
        startedAt: Date.now()
      })
    );

    machine.on("rpc:request", (request, ack) => {
      if (request.method !== RelayMethodValue.CodexHistoryLoaded) {
        return;
      }
      ack({
        ok: true,
        result: {
          threadIds: ["thread_hot", "thread_warm"]
        }
      });
    });

    const response = await authorizedFetch(
      `${baseUrl}/api/relay/devices/device_1/codex-history/loaded`
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { threadIds: string[] };
    expect(payload.threadIds).toEqual(["thread_hot", "thread_warm"]);
  });

  it("rejects malformed loaded history results before updating control state", async () => {
    const { baseUrl } = await startServer();
    const machine = createMachineSocket(baseUrl, "device_1", {
      ownerToken
    });
    await waitForConnect(machine, () =>
      emitAck(machine, "machine:hello", {
        deviceId: "device_1",
        deviceName: "MacBook Pro",
        hostname: "macbook-pro.local",
        platform: "darwin",
        arch: "arm64",
        agentVersion: "0.1.0",
        agentRunId: "agent_run_1",
        startedAt: Date.now()
      })
    );

    machine.on("rpc:request", (request, ack) => {
      if (request.method !== RelayMethodValue.CodexHistoryLoaded) {
        return;
      }
      ack({
        ok: true,
        result: {
          threadIds: [""]
        }
      });
    });

    const response = await authorizedFetch(
      `${baseUrl}/api/relay/devices/device_1/codex-history/loaded`
    );
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid relay RPC result for codexHistory.loaded"
    });
  });

  it("returns 504-style errors when relay rpc times out", async () => {
    const { baseUrl } = await startServer({ rpcTimeoutMs: 50 });
    const machine = createMachineSocket(baseUrl, "device_1", {
      ownerToken
    });
    await waitForConnect(machine, () =>
      emitAck(machine, "machine:hello", {
        deviceId: "device_1",
        deviceName: "MacBook Pro",
        hostname: "macbook-pro.local",
        platform: "darwin",
        arch: "arm64",
        agentVersion: "0.1.0",
        agentRunId: "agent_run_1",
        startedAt: Date.now()
      })
    );

    machine.on("rpc:request", () => {
      // Intentionally never ack.
    });

    const response = await authorizedFetch(
      `${baseUrl}/api/relay/devices/device_1/health`
    );
    expect(response.status).toBe(504);
  });

  it("allows longer timeout for slow history detail rpc", async () => {
    const { baseUrl } = await startServer({ rpcTimeoutMs: 50 });
    const machine = createMachineSocket(baseUrl, "device_1", {
      ownerToken
    });
    await waitForConnect(machine, () =>
      emitAck(machine, "machine:hello", {
        deviceId: "device_1",
        deviceName: "MacBook Pro",
        hostname: "macbook-pro.local",
        platform: "darwin",
        arch: "arm64",
        agentVersion: "0.1.0",
        agentRunId: "agent_run_1",
        startedAt: Date.now()
      })
    );

    machine.on("rpc:request", (payload, ack) => {
      if (payload.method !== RelayMethodValue.CodexHistoryDetail) {
        return;
      }
      setTimeout(() => {
        ack({
          ok: true,
          result: {
            entry: {
              id: "thread_1",
              cwd: "/tmp",
              title: "Thread",
              createdAt: "",
              updatedAt: "",
              source: "cli"
            },
            messages: []
          }
        });
      }, 80);
    });

    const response = await authorizedFetch(
      `${baseUrl}/api/relay/devices/device_1/codex-history/detail?id=thread_1`
    );
    expect(response.status).toBe(200);
  });

  it("relays paged history turns over HTTP", async () => {
    const { baseUrl } = await startServer({ rpcTimeoutMs: 50 });
    const machine = createMachineSocket(baseUrl, "device_1", {
      ownerToken
    });
    await waitForConnect(machine, () =>
      emitAck(machine, "machine:hello", {
        deviceId: "device_1",
        deviceName: "MacBook Pro",
        hostname: "macbook-pro.local",
        platform: "darwin",
        arch: "arm64",
        agentVersion: "0.1.0",
        agentRunId: "agent_run_1",
        startedAt: Date.now()
      })
    );

    let callCount = 0;
    machine.on("rpc:request", (payload, ack) => {
      if (payload.method !== RelayMethodValue.CodexHistoryTurns) {
        return;
      }
      callCount += 1;
      setTimeout(() => {
        ack({
          ok: true,
          result: {
            entry: {
              id: "thread_1",
              cwd: "/tmp",
              cwdExists: true,
              title: "Thread",
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
              source: "cli"
            },
            messages: [
              {
                id: "msg_1",
                role: "assistant",
                text: "recent page",
                ts: "2026-01-01T00:00:00.000Z"
              }
            ],
            nextCursor: "cursor_older",
            backwardsCursor: null
          }
        });
      }, 80);
    });

    const response = await authorizedFetch(
      `${baseUrl}/api/relay/devices/device_1/codex-history/turns?id=thread_1&limit=20`
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      messages: Array<{ text: string }>;
      nextCursor: string | null;
    };
    expect(payload.messages[0]?.text).toBe("recent page");
    expect(payload.nextCursor).toBe("cursor_older");

    const cachedResponse = await authorizedFetch(
      `${baseUrl}/api/relay/devices/device_1/codex-history/turns?id=thread_1&limit=20`
    );
    expect(cachedResponse.status).toBe(200);
    expect(callCount).toBe(1);
  });

  it("caches cursor history pages independently", async () => {
    const { baseUrl } = await startServer({ rpcTimeoutMs: 50 });
    const machine = createMachineSocket(baseUrl, "device_1", {
      ownerToken
    });
    await waitForConnect(machine, () =>
      emitAck(machine, "machine:hello", {
        deviceId: "device_1",
        deviceName: "MacBook Pro",
        hostname: "macbook-pro.local",
        platform: "darwin",
        arch: "arm64",
        agentVersion: "0.1.0",
        agentRunId: "agent_run_1",
        startedAt: Date.now()
      })
    );

    let callCount = 0;
    machine.on("rpc:request", (payload, ack) => {
      if (payload.method !== RelayMethodValue.CodexHistoryTurns) {
        return;
      }
      callCount += 1;
      const cursor =
        typeof payload.params === "object" &&
        payload.params !== null &&
        "cursor" in payload.params &&
        typeof payload.params.cursor === "string"
          ? payload.params.cursor
          : "latest";
      ack({
        ok: true,
        result: {
          entry: {
            id: "thread_1",
            cwd: "/tmp",
            cwdExists: true,
            title: "Thread",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            source: "cli"
          },
          messages: [
            {
              id: `msg_${cursor}`,
              role: "assistant",
              text: `page ${cursor}`,
              ts: "2026-01-01T00:00:00.000Z"
            }
          ],
          nextCursor: cursor === "latest" ? "older" : null,
          backwardsCursor: null
        }
      });
    });

    const latest = await authorizedFetch(
      `${baseUrl}/api/relay/devices/device_1/codex-history/turns?id=thread_1&limit=20`
    );
    expect(latest.status).toBe(200);
    await expect(latest.json()).resolves.toMatchObject({
      messages: [{ text: "page latest" }]
    });

    const older = await authorizedFetch(
      `${baseUrl}/api/relay/devices/device_1/codex-history/turns?id=thread_1&cursor=older&limit=20`
    );
    expect(older.status).toBe(200);
    await expect(older.json()).resolves.toMatchObject({
      messages: [{ text: "page older" }]
    });

    const cachedOlder = await authorizedFetch(
      `${baseUrl}/api/relay/devices/device_1/codex-history/turns?id=thread_1&cursor=older&limit=20`
    );
    expect(cachedOlder.status).toBe(200);
    await expect(cachedOlder.json()).resolves.toMatchObject({
      messages: [{ text: "page older" }]
    });

    expect(callCount).toBe(2);
  });

  it("bypasses recent history page cache when explicitly requested", async () => {
    const { baseUrl } = await startServer({ rpcTimeoutMs: 50 });
    const machine = createMachineSocket(baseUrl, "device_1", {
      ownerToken
    });
    await waitForConnect(machine, () =>
      emitAck(machine, "machine:hello", {
        deviceId: "device_1",
        deviceName: "MacBook Pro",
        hostname: "macbook-pro.local",
        platform: "darwin",
        arch: "arm64",
        agentVersion: "0.1.0",
        agentRunId: "agent_run_1",
        startedAt: Date.now()
      })
    );

    let callCount = 0;
    machine.on("rpc:request", (payload, ack) => {
      if (payload.method !== RelayMethodValue.CodexHistoryTurns) {
        return;
      }
      callCount += 1;
      ack({
        ok: true,
        result: {
          entry: {
            id: "thread_1",
            cwd: "/tmp",
            cwdExists: true,
            title: "Thread",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            source: "cli"
          },
          messages: [
            {
              id: `msg_${callCount}`,
              role: "assistant",
              text: `page ${callCount}`,
              ts: "2026-01-01T00:00:00.000Z"
            }
          ],
          nextCursor: null,
          backwardsCursor: null
        }
      });
    });

    const first = await authorizedFetch(
      `${baseUrl}/api/relay/devices/device_1/codex-history/turns?id=thread_1&limit=20`
    );
    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toMatchObject({
      messages: [{ text: "page 1" }]
    });

    const cached = await authorizedFetch(
      `${baseUrl}/api/relay/devices/device_1/codex-history/turns?id=thread_1&limit=20`
    );
    expect(cached.status).toBe(200);
    await expect(cached.json()).resolves.toMatchObject({
      messages: [{ text: "page 1" }]
    });
    expect(callCount).toBe(1);

    const bypassed = await authorizedFetch(
      `${baseUrl}/api/relay/devices/device_1/codex-history/turns?id=thread_1&limit=20&cacheMode=bypass`
    );
    expect(bypassed.status).toBe(200);
    await expect(bypassed.json()).resolves.toMatchObject({
      messages: [{ text: "page 2" }]
    });
    expect(callCount).toBe(2);

    const refreshedCache = await authorizedFetch(
      `${baseUrl}/api/relay/devices/device_1/codex-history/turns?id=thread_1&limit=20`
    );
    expect(refreshedCache.status).toBe(200);
    await expect(refreshedCache.json()).resolves.toMatchObject({
      messages: [{ text: "page 2" }]
    });
    expect(callCount).toBe(2);
  });

  it("rejects malformed history turns without caching the bad page", async () => {
    const { baseUrl } = await startServer({ rpcTimeoutMs: 50 });
    const machine = createMachineSocket(baseUrl, "device_1", {
      ownerToken
    });
    await waitForConnect(machine, () =>
      emitAck(machine, "machine:hello", {
        deviceId: "device_1",
        deviceName: "MacBook Pro",
        hostname: "macbook-pro.local",
        platform: "darwin",
        arch: "arm64",
        agentVersion: "0.1.0",
        agentRunId: "agent_run_1",
        startedAt: Date.now()
      })
    );

    let callCount = 0;
    machine.on("rpc:request", (payload, ack) => {
      if (payload.method !== RelayMethodValue.CodexHistoryTurns) {
        return;
      }
      callCount += 1;
      if (callCount === 1) {
        ack({
          ok: true,
          result: {
            entry: {
              id: "thread_1",
              cwd: "/tmp",
              title: "Thread",
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z"
            },
            messages: [],
            nextCursor: null,
            backwardsCursor: null
          }
        });
        return;
      }
      ack({
        ok: true,
        result: {
          entry: {
            id: "thread_1",
            cwd: "/tmp",
            cwdExists: true,
            title: "Thread",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            source: "cli"
          },
          messages: [
            {
              id: "msg_2",
              role: "assistant",
              text: "valid page",
              ts: "2026-01-01T00:00:00.000Z"
            }
          ],
          nextCursor: null,
          backwardsCursor: null
        }
      });
    });

    const first = await authorizedFetch(
      `${baseUrl}/api/relay/devices/device_1/codex-history/turns?id=thread_1&limit=20`
    );
    expect(first.status).toBe(502);

    const second = await authorizedFetch(
      `${baseUrl}/api/relay/devices/device_1/codex-history/turns?id=thread_1&limit=20`
    );
    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toMatchObject({
      messages: [{ text: "valid page" }]
    });
    expect(callCount).toBe(2);
  });

  it("rejects oversized history pages without caching the bad page", async () => {
    process.env.CODEXNEXT_RPC_RESPONSE_MAX_BYTES = "1024";
    const { baseUrl } = await startServer({ rpcTimeoutMs: 50 });
    const machine = createMachineSocket(baseUrl, "device_1", {
      ownerToken
    });
    await waitForConnect(machine, () =>
      emitAck(machine, "machine:hello", {
        deviceId: "device_1",
        deviceName: "MacBook Pro",
        hostname: "macbook-pro.local",
        platform: "darwin",
        arch: "arm64",
        agentVersion: "0.1.0",
        agentRunId: "agent_run_1",
        startedAt: Date.now()
      })
    );

    let callCount = 0;
    machine.on("rpc:request", (payload, ack) => {
      if (payload.method !== RelayMethodValue.CodexHistoryTurns) {
        return;
      }
      callCount += 1;
      ack({
        ok: true,
        result: {
          entry: {
            id: "thread_1",
            cwd: "/tmp",
            cwdExists: true,
            title: "Thread",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            source: "cli"
          },
          messages: [
            {
              id: `msg_${callCount}`,
              role: "assistant",
              text: callCount === 1 ? "x".repeat(2_000) : "valid page",
              ts: "2026-01-01T00:00:00.000Z"
            }
          ],
          turns: [],
          nextCursor: null,
          backwardsCursor: null
        }
      });
    });

    const first = await authorizedFetch(
      `${baseUrl}/api/relay/devices/device_1/codex-history/turns?id=thread_1&limit=20`
    );
    expect(first.status).toBe(413);
    await expect(first.json()).resolves.toMatchObject({
      error: expect.stringContaining("payload_too_large")
    });

    process.env.CODEXNEXT_RPC_RESPONSE_MAX_BYTES = "100000";
    const second = await authorizedFetch(
      `${baseUrl}/api/relay/devices/device_1/codex-history/turns?id=thread_1&limit=20`
    );
    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toMatchObject({
      messages: [{ text: "valid page" }]
    });
    expect(callCount).toBe(2);
  });

  it("expires recent history page cache by ttl", async () => {
    const { baseUrl } = await startServer({
      recentHistoryCacheTtlMs: 1,
      rpcTimeoutMs: 50
    });
    const machine = createMachineSocket(baseUrl, "device_1", {
      ownerToken
    });
    await waitForConnect(machine, () =>
      emitAck(machine, "machine:hello", {
        deviceId: "device_1",
        deviceName: "MacBook Pro",
        hostname: "macbook-pro.local",
        platform: "darwin",
        arch: "arm64",
        agentVersion: "0.1.0",
        agentRunId: "agent_run_1",
        startedAt: Date.now()
      })
    );

    let callCount = 0;
    machine.on("rpc:request", (payload, ack) => {
      if (payload.method !== RelayMethodValue.CodexHistoryTurns) {
        return;
      }
      callCount += 1;
      ack({
        ok: true,
        result: {
          entry: {
            id: "thread_1",
            cwd: "/tmp",
            cwdExists: true,
            title: "Thread",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            source: "cli"
          },
          messages: [
            {
              id: `msg_${callCount}`,
              role: "assistant",
              text: `page ${callCount}`,
              ts: "2026-01-01T00:00:00.000Z"
            }
          ],
          nextCursor: null,
          backwardsCursor: null
        }
      });
    });

    const first = await authorizedFetch(
      `${baseUrl}/api/relay/devices/device_1/codex-history/turns?id=thread_1&limit=20`
    );
    expect(first.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await authorizedFetch(
      `${baseUrl}/api/relay/devices/device_1/codex-history/turns?id=thread_1&limit=20`
    );
    expect(second.status).toBe(200);
    expect(callCount).toBe(2);
  });

  it("caches resumed history pages for subsequent turns requests", async () => {
    const { baseUrl } = await startServer({ rpcTimeoutMs: 50 });
    const machine = createMachineSocket(baseUrl, "device_1", {
      ownerToken
    });
    await waitForConnect(machine, () =>
      emitAck(machine, "machine:hello", {
        deviceId: "device_1",
        deviceName: "MacBook Pro",
        hostname: "macbook-pro.local",
        platform: "darwin",
        arch: "arm64",
        agentVersion: "0.1.0",
        agentRunId: "agent_run_1",
        startedAt: Date.now()
      })
    );

    let resumeCallCount = 0;
    let turnsCallCount = 0;
    machine.on("rpc:request", (payload, ack) => {
      if (payload.method === RelayMethodValue.CodexHistoryResume) {
        resumeCallCount += 1;
        ack({
          ok: true,
          result: {
            session: {
              sessionId: "session_resume",
              threadId: "thread_resume",
              status: "idle",
              cwd: "/tmp",
              permissionMode: "request-approval",
              approvalPolicy: null,
              approvalsReviewer: null,
              sandbox: null,
              createdAt: 1,
              updatedAt: 2
            },
            history: {
              entry: {
                id: "thread_resume",
                cwd: "/tmp",
                cwdExists: true,
                title: "Resumed Thread",
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
                source: "cli"
              },
              messages: [
                {
                  id: "msg_resume",
                  role: "assistant",
                  text: "resumed page",
                  ts: "2026-01-01T00:00:00.000Z"
                }
              ],
              nextCursor: null,
              backwardsCursor: null
            }
          }
        });
      }
      if (payload.method === RelayMethodValue.CodexHistoryTurns) {
        turnsCallCount += 1;
        ack({
          ok: true,
          result: {
            entry: {
              id: "thread_resume",
              cwd: "/tmp",
              cwdExists: true,
              title: "Uncached Thread",
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
              source: "cli"
            },
            messages: [
              {
                id: "msg_uncached",
                role: "assistant",
                text: "uncached page",
                ts: "2026-01-01T00:00:00.000Z"
              }
            ],
            nextCursor: null,
            backwardsCursor: null
          }
        });
      }
    });

    const resume = await fetch(
      `${baseUrl}/api/relay/devices/device_1/codex-history/resume`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ownerToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ id: "thread_resume", cwd: "/tmp" })
      }
    );
    expect(resume.status).toBe(200);

    const cached = await authorizedFetch(
      `${baseUrl}/api/relay/devices/device_1/codex-history/turns?id=thread_resume&cwd=%2Ftmp&limit=40&sortDirection=desc&itemsView=summary`
    );
    expect(cached.status).toBe(200);
    await expect(cached.json()).resolves.toMatchObject({
      messages: [{ text: "resumed page" }]
    });
    expect(resumeCallCount).toBe(1);
    expect(turnsCallCount).toBe(0);
  });

  it("invalidates recent history cache when a thread is archived", async () => {
    const { baseUrl } = await startServer({ rpcTimeoutMs: 50 });
    const machine = createMachineSocket(baseUrl, "device_1", {
      ownerToken
    });
    await waitForConnect(machine, () =>
      emitAck(machine, "machine:hello", {
        deviceId: "device_1",
        deviceName: "MacBook Pro",
        hostname: "macbook-pro.local",
        platform: "darwin",
        arch: "arm64",
        agentVersion: "0.1.0",
        agentRunId: "agent_run_1",
        startedAt: Date.now()
      })
    );

    let turnsCallCount = 0;
    machine.on("rpc:request", (payload, ack) => {
      if (payload.method === RelayMethodValue.CodexHistoryTurns) {
        turnsCallCount += 1;
        ack({
          ok: true,
          result: {
            entry: {
              id: "thread_1",
              cwd: "/tmp",
              cwdExists: true,
              title: "Thread",
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
              source: "cli"
            },
            messages: [
              {
                id: `msg_${turnsCallCount}`,
                role: "assistant",
                text: `page ${turnsCallCount}`,
                ts: "2026-01-01T00:00:00.000Z"
              }
            ],
            nextCursor: null,
            backwardsCursor: null
          }
        });
      }
      if (payload.method === RelayMethodValue.CodexHistoryArchive) {
        ack({
          ok: true,
          result: {}
        });
      }
    });

    const first = await authorizedFetch(
      `${baseUrl}/api/relay/devices/device_1/codex-history/turns?id=thread_1&limit=20`
    );
    expect(first.status).toBe(200);
    const cached = await authorizedFetch(
      `${baseUrl}/api/relay/devices/device_1/codex-history/turns?id=thread_1&limit=20`
    );
    expect(cached.status).toBe(200);
    expect(turnsCallCount).toBe(1);

    const archive = await fetch(
      `${baseUrl}/api/relay/devices/device_1/codex-history/archive`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ownerToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ id: "thread_1" })
      }
    );
    expect(archive.status).toBe(200);

    const afterArchive = await authorizedFetch(
      `${baseUrl}/api/relay/devices/device_1/codex-history/turns?id=thread_1&limit=20`
    );
    expect(afterArchive.status).toBe(200);
    expect(turnsCallCount).toBe(2);
  });

  it("archives a thread over relay HTTP", async () => {
    const { baseUrl } = await startServer();
    const machine = createMachineSocket(baseUrl, "device_1", {
      ownerToken
    });
    await waitForConnect(machine, () =>
      emitAck(machine, "machine:hello", {
        deviceId: "device_1",
        deviceName: "MacBook Pro",
        hostname: "macbook-pro.local",
        platform: "darwin",
        arch: "arm64",
        agentVersion: "0.1.0",
        agentRunId: "agent_run_1",
        startedAt: Date.now()
      })
    );

    machine.on("rpc:request", (payload, ack) => {
      if (payload.method !== RelayMethodValue.CodexHistoryArchive) {
        return;
      }
      expect(payload.params).toEqual({ id: "thread_1" });
      ack({
        ok: true,
        result: {}
      });
    });

    const response = await fetch(
      `${baseUrl}/api/relay/devices/device_1/codex-history/archive`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ownerToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ id: "thread_1" })
      }
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({});
  });

  it("accepts large relay rpc payloads for history detail", async () => {
    const { baseUrl } = await startServer();
    const machine = createMachineSocket(baseUrl, "device_1", {
      ownerToken
    });
    await waitForConnect(machine, () =>
      emitAck(machine, "machine:hello", {
        deviceId: "device_1",
        deviceName: "MacBook Pro",
        hostname: "macbook-pro.local",
        platform: "darwin",
        arch: "arm64",
        agentVersion: "0.1.0",
        agentRunId: "agent_run_1",
        startedAt: Date.now()
      })
    );

    const largeText = "x".repeat(2 * 1024 * 1024);
    machine.on("rpc:request", (payload, ack) => {
      if (payload.method !== RelayMethodValue.CodexHistoryDetail) {
        return;
      }
      ack({
        ok: true,
        result: {
          entry: {
            id: "thread_big",
            cwd: "/tmp",
            cwdExists: true,
            title: "Big Thread",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            source: "cli"
          },
          messages: [
            {
              id: "msg_big",
              role: "assistant",
              text: largeText,
              ts: "2026-01-01T00:00:00.000Z"
            }
          ]
        }
      });
    });

    const response = await authorizedFetch(
      `${baseUrl}/api/relay/devices/device_1/codex-history/detail?id=thread_big`
    );
    expect(response.status).toBe(200);
    const payload = await response.json() as {
      messages: Array<{ text: string }>;
    };
    expect(payload.messages[0]?.text.length).toBe(largeText.length);
  });

  it("stores machine events and replays them to browser clients after seq", async () => {
    const { baseUrl } = await startServer();
    const machine = createMachineSocket(baseUrl, "device_1", {
      ownerToken
    });
    await waitForConnect(machine, () =>
      emitAck(machine, "machine:hello", {
        deviceId: "device_1",
        deviceName: "MacBook Pro",
        hostname: "macbook-pro.local",
        platform: "darwin",
        arch: "arm64",
        agentVersion: "0.1.0",
        agentRunId: "agent_run_1",
        startedAt: Date.now()
      })
    );

    machine.emit("machine:event", {
      deviceId: "device_1",
      agentRunId: "agent_run_1",
      event: {
        id: "evt_1",
        seq: 1,
        ts: Date.now(),
        type: "chat.user",
        payload: { text: "hello" }
      }
    });

    const session = await fetch(`${baseUrl}/api/auth/session`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ownerToken}`
      }
    });
    const sessionPayload = (await session.json()) as { sessionToken: string };
    const browser = createUserSocket(
      baseUrl,
      {
        device_1: 0
      },
      sessionPayload.sessionToken,
      false
    );
    const replayPromise = waitForDeviceReplay(browser);
    browser.connect();
    await waitForConnect(browser, async () => undefined);
    const replayed = await replayPromise;
    expect(replayed).toHaveLength(1);
    expect(replayed[0]).toMatchObject({
      deviceId: "device_1",
      event: {
        id: "evt_1",
        seq: 1
      }
    });

    const replayResponse = await authorizedFetch(
      `${baseUrl}/api/relay/devices/device_1/events?after=0`
    );
    const replayPayload = (await replayResponse.json()) as { events: Array<{ seq: number }> };
    expect(replayPayload.events.map((event) => event.seq)).toEqual([1]);
  });

  it("replays only missing events after last seq and does not emit duplicate live events", async () => {
    const { baseUrl } = await startServer();
    const machine = createMachineSocket(baseUrl, "device_1", {
      ownerToken
    });
    await waitForConnect(machine, () =>
      emitAck(machine, "machine:hello", {
        deviceId: "device_1",
        deviceName: "MacBook Pro",
        hostname: "macbook-pro.local",
        platform: "darwin",
        arch: "arm64",
        agentVersion: "0.1.0",
        agentRunId: "agent_run_1",
        startedAt: Date.now()
      })
    );

    machine.emit("machine:event", {
      deviceId: "device_1",
      agentRunId: "agent_run_1",
      event: {
        id: "evt_1",
        seq: 1,
        ts: Date.now(),
        type: "chat.user",
        payload: { text: "already-seen" }
      }
    });
    machine.emit("machine:event", {
      deviceId: "device_1",
      agentRunId: "agent_run_1",
      event: {
        id: "evt_2",
        seq: 2,
        ts: Date.now(),
        type: "chat.assistant.delta",
        payload: { text: "missing" }
      }
    });

    const session = await fetch(`${baseUrl}/api/auth/session`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ownerToken}`
      }
    });
    const sessionPayload = (await session.json()) as { sessionToken: string };
    const browser = createUserSocket(
      baseUrl,
      {
        device_1: 1
      },
      sessionPayload.sessionToken,
      false
    );
    const replayPromise = waitForDeviceReplay(browser);
    browser.connect();
    await waitForConnect(browser, async () => undefined);
    const replayed = await replayPromise;
    expect(replayed.map((payload) => payload.event.seq)).toEqual([2]);

    const livePromise = waitForDeviceEvent(browser);
    machine.emit("machine:event", {
      deviceId: "device_1",
      agentRunId: "agent_run_1",
      event: {
        id: "evt_2_duplicate",
        seq: 2,
        ts: Date.now(),
        type: "chat.assistant.delta",
        payload: { text: "duplicate" }
      }
    });
    machine.emit("machine:event", {
      deviceId: "device_1",
      agentRunId: "agent_run_1",
      event: {
        id: "evt_3",
        seq: 3,
        ts: Date.now(),
        type: "chat.assistant.delta",
        payload: { text: "live" }
      }
    });
    const live = await livePromise;
    expect(live.event.seq).toBe(3);
  });

  it("converges replay and live events across two user clients", async () => {
    const { baseUrl } = await startServer();
    const machine = createMachineSocket(baseUrl, "device_1", {
      ownerToken
    });
    await waitForConnect(machine, () =>
      emitAck(machine, "machine:hello", {
        deviceId: "device_1",
        deviceName: "MacBook Pro",
        hostname: "macbook-pro.local",
        platform: "darwin",
        arch: "arm64",
        agentVersion: "0.1.0",
        agentRunId: "agent_run_1",
        startedAt: Date.now()
      })
    );

    machine.emit("machine:event", {
      deviceId: "device_1",
      agentRunId: "agent_run_1",
      event: {
        id: "evt_1",
        seq: 1,
        ts: Date.now(),
        type: "chat.user",
        payload: { text: "first" }
      }
    });
    machine.emit("machine:event", {
      deviceId: "device_1",
      agentRunId: "agent_run_1",
      event: {
        id: "evt_2",
        seq: 2,
        ts: Date.now(),
        type: "chat.assistant.delta",
        payload: { text: "second" }
      }
    });

    const firstSession = await fetch(`${baseUrl}/api/auth/session`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ownerToken}` }
    });
    const secondSession = await fetch(`${baseUrl}/api/auth/session`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ownerToken}` }
    });
    const firstToken = ((await firstSession.json()) as { sessionToken: string }).sessionToken;
    const secondToken = ((await secondSession.json()) as { sessionToken: string }).sessionToken;

    const firstBrowser = createUserSocket(baseUrl, { device_1: 0 }, firstToken, false);
    const secondBrowser = createUserSocket(baseUrl, { device_1: 1 }, secondToken, false);
    const firstReplay = waitForDeviceReplay(firstBrowser);
    const secondReplay = waitForDeviceReplay(secondBrowser);
    firstBrowser.connect();
    secondBrowser.connect();
    await waitForConnect(firstBrowser, async () => undefined);
    await waitForConnect(secondBrowser, async () => undefined);

    await expect(firstReplay).resolves.toMatchObject([
      { deviceId: "device_1", event: { seq: 1 } },
      { deviceId: "device_1", event: { seq: 2 } }
    ]);
    await expect(secondReplay).resolves.toMatchObject([
      { deviceId: "device_1", event: { seq: 2 } }
    ]);

    const observedLiveEvents: DeviceEventPayload[] = [];
    firstBrowser.on("device:event", (payload: DeviceEventPayload) =>
      observedLiveEvents.push(payload)
    );
    secondBrowser.on("device:event", (payload: DeviceEventPayload) =>
      observedLiveEvents.push(payload)
    );
    const firstLive = waitForDeviceEvent(firstBrowser);
    const secondLive = waitForDeviceEvent(secondBrowser);
    machine.emit("machine:event", {
      deviceId: "device_1",
      agentRunId: "agent_run_1",
      event: {
        id: "evt_3",
        seq: 3,
        ts: Date.now(),
        type: "chat.assistant.delta",
        payload: { text: "live" }
      }
    });
    await expect(firstLive).resolves.toMatchObject({
      deviceId: "device_1",
      event: { seq: 3 }
    });
    await expect(secondLive).resolves.toMatchObject({
      deviceId: "device_1",
      event: { seq: 3 }
    });

    const eventCountBeforeDuplicate = observedLiveEvents.length;
    machine.emit("machine:event", {
      deviceId: "device_1",
      agentRunId: "agent_run_1",
      event: {
        id: "evt_3_duplicate",
        seq: 3,
        ts: Date.now(),
        type: "chat.assistant.delta",
        payload: { text: "duplicate" }
      }
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(
      observedLiveEvents
        .slice(eventCountBeforeDuplicate)
        .filter((payload) => payload.event.id === "evt_3_duplicate")
    ).toEqual([]);
  });

  it("keeps replay cursors isolated across multiple devices for reconnecting user clients", async () => {
    const { baseUrl } = await startServer();
    const firstMachine = createMachineSocket(baseUrl, "device_1", {
      ownerToken
    });
    const secondMachine = createMachineSocket(baseUrl, "device_2", {
      ownerToken
    });
    await waitForConnect(firstMachine, () =>
      emitAck(firstMachine, "machine:hello", {
        deviceId: "device_1",
        deviceName: "MacBook Pro",
        hostname: "macbook-pro.local",
        platform: "darwin",
        arch: "arm64",
        agentVersion: "0.1.0",
        agentRunId: "agent_run_1",
        startedAt: Date.now()
      })
    );
    await waitForConnect(secondMachine, () =>
      emitAck(secondMachine, "machine:hello", {
        deviceId: "device_2",
        deviceName: "Ubuntu Workstation",
        hostname: "ubuntu.local",
        platform: "linux",
        arch: "x64",
        agentVersion: "0.1.0",
        agentRunId: "agent_run_2",
        startedAt: Date.now()
      })
    );

    firstMachine.emit("machine:event", {
      deviceId: "device_1",
      agentRunId: "agent_run_1",
      event: {
        id: "device_1_evt_1",
        seq: 1,
        ts: Date.now(),
        type: "chat.user",
        payload: { text: "device 1 already seen" }
      }
    });
    firstMachine.emit("machine:event", {
      deviceId: "device_1",
      agentRunId: "agent_run_1",
      event: {
        id: "device_1_evt_2",
        seq: 2,
        ts: Date.now(),
        type: "chat.assistant.delta",
        payload: { text: "device 1 missing" }
      }
    });
    secondMachine.emit("machine:event", {
      deviceId: "device_2",
      agentRunId: "agent_run_2",
      event: {
        id: "device_2_evt_1",
        seq: 1,
        ts: Date.now(),
        type: "chat.user",
        payload: { text: "device 2 first" }
      }
    });
    secondMachine.emit("machine:event", {
      deviceId: "device_2",
      agentRunId: "agent_run_2",
      event: {
        id: "device_2_evt_2",
        seq: 2,
        ts: Date.now(),
        type: "chat.assistant.delta",
        payload: { text: "device 2 second" }
      }
    });

    const session = await fetch(`${baseUrl}/api/auth/session`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ownerToken}` }
    });
    const token = ((await session.json()) as { sessionToken: string }).sessionToken;
    const browser = createUserSocket(
      baseUrl,
      {
        device_1: 1,
        device_2: 0
      },
      token,
      false
    );
    const replayPromise = waitForDeviceReplay(browser);
    browser.connect();
    await waitForConnect(browser, async () => undefined);

    const replayed = await replayPromise;
    expect(replayed.map(deviceEventKey).sort()).toEqual([
      "device_1:device_1_evt_2:2",
      "device_2:device_2_evt_1:1",
      "device_2:device_2_evt_2:2"
    ]);

    const liveEventsPromise = waitForDeviceEventIds(browser, [
      "device_1_evt_3",
      "device_2_evt_3"
    ]);
    firstMachine.emit("machine:event", {
      deviceId: "device_1",
      agentRunId: "agent_run_1",
      event: {
        id: "device_1_evt_3",
        seq: 3,
        ts: Date.now(),
        type: "chat.assistant.delta",
        payload: { text: "device 1 live" }
      }
    });
    secondMachine.emit("machine:event", {
      deviceId: "device_2",
      agentRunId: "agent_run_2",
      event: {
        id: "device_2_evt_3",
        seq: 3,
        ts: Date.now(),
        type: "chat.assistant.delta",
        payload: { text: "device 2 live" }
      }
    });

    const liveEvents = await liveEventsPromise;
    expect(liveEvents.map(deviceEventKey).sort()).toEqual([
      "device_1:device_1_evt_3:3",
      "device_2:device_2_evt_3:3"
    ]);
  });

  it("broadcasts events from a restarted agent run even when local seq restarts", async () => {
    const { baseUrl } = await startServer();
    const machine = createMachineSocket(baseUrl, "device_1", {
      ownerToken
    });
    await waitForConnect(machine, () =>
      emitAck(machine, "machine:hello", {
        deviceId: "device_1",
        deviceName: "MacBook Pro",
        hostname: "macbook-pro.local",
        platform: "darwin",
        arch: "arm64",
        agentVersion: "0.1.0",
        agentRunId: "agent_run_1",
        startedAt: Date.now()
      })
    );

    machine.emit("machine:event", {
      deviceId: "device_1",
      agentRunId: "agent_run_1",
      event: {
        id: "run_1_evt_1",
        seq: 1,
        ts: Date.now(),
        type: "chat.user",
        payload: { text: "first run" }
      }
    });

    const session = await fetch(`${baseUrl}/api/auth/session`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ownerToken}` }
    });
    const sessionPayload = (await session.json()) as { sessionToken: string };
    const browser = createUserSocket(baseUrl, { device_1: 1 }, sessionPayload.sessionToken, false);
    browser.connect();
    await waitForConnect(browser, async () => undefined);

    await emitAck(machine, "machine:hello", {
      deviceId: "device_1",
      deviceName: "MacBook Pro",
      hostname: "macbook-pro.local",
      platform: "darwin",
      arch: "arm64",
      agentVersion: "0.1.0",
      agentRunId: "agent_run_2",
      startedAt: Date.now()
    });

    const livePromise = waitForDeviceEvent(browser);
    machine.emit("machine:event", {
      deviceId: "device_1",
      agentRunId: "agent_run_2",
      event: {
        id: "run_2_evt_1",
        seq: 1,
        ts: Date.now(),
        type: "chat.assistant.delta",
        payload: { text: "second run" }
      }
    });

    await expect(livePromise).resolves.toMatchObject({
      deviceId: "device_1",
      event: {
        id: "run_2_evt_1",
        seq: 2
      }
    });

    const replayResponse = await authorizedFetch(
      `${baseUrl}/api/relay/devices/device_1/events?after=0`
    );
    const replayPayload = (await replayResponse.json()) as {
      events: Array<{ id: string; seq: number }>;
    };
    expect(replayPayload.events.map((event) => [event.id, event.seq])).toEqual([
      ["run_1_evt_1", 1],
      ["run_2_evt_1", 2]
    ]);
  });

  it("broadcasts the same presence state to two user clients", async () => {
    const { baseUrl } = await startServer();
    const machine = createMachineSocket(baseUrl, "device_1", {
      ownerToken
    });
    await waitForConnect(machine, () =>
      emitAck(machine, "machine:hello", {
        deviceId: "device_1",
        deviceName: "MacBook Pro",
        hostname: "macbook-pro.local",
        platform: "darwin",
        arch: "arm64",
        agentVersion: "0.1.0",
        agentRunId: "agent_run_1",
        startedAt: Date.now()
      })
    );

    const firstSession = await fetch(`${baseUrl}/api/auth/session`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ownerToken}` }
    });
    const secondSession = await fetch(`${baseUrl}/api/auth/session`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ownerToken}` }
    });
    const firstToken = ((await firstSession.json()) as { sessionToken: string }).sessionToken;
    const secondToken = ((await secondSession.json()) as { sessionToken: string }).sessionToken;
    const firstBrowser = createUserSocket(baseUrl, { device_1: 0 }, firstToken);
    const secondBrowser = createUserSocket(baseUrl, { device_1: 0 }, secondToken);
    await waitForConnect(firstBrowser, async () => undefined);
    await waitForConnect(secondBrowser, async () => undefined);

    const firstPresence = waitForDevicePresence(firstBrowser);
    const secondPresence = waitForDevicePresence(secondBrowser);
    machine.emit("machine:heartbeat", {
      deviceId: "device_1",
      at: 123,
      activeSessions: 2
    });

    await expect(firstPresence).resolves.toMatchObject({
      deviceId: "device_1",
      online: true,
      lastSeenAt: 123,
      activeSessions: 2
    });
    await expect(secondPresence).resolves.toMatchObject({
      deviceId: "device_1",
      online: true,
      lastSeenAt: 123,
      activeSessions: 2
    });
  });

  it("rejects invalid pairing create payloads", async () => {
    const { baseUrl } = await startServer();
    const response = await fetch(`${baseUrl}/api/pairings/device`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        deviceId: "device_invalid"
      })
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid pairing payload"
    });
  });

  it("approves a pairing request and authorizes machine connect without owner token", async () => {
    const { baseUrl } = await startServer({
      production: true,
      allowedOrigins: ["http://example.com"],
      allowMachineOwnerToken: false
    });
    const createResponse = await fetch(`${baseUrl}/api/pairings/device`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        deviceId: "device_paired",
        deviceToken: "device-token",
        deviceName: "MacBook Air",
        hostname: "macbook-air.local",
        platform: "darwin",
        arch: "arm64",
        agentVersion: "0.1.0",
        relayUrl: baseUrl
      })
    });
    expect(createResponse.status).toBe(200);
    const pairing = (await createResponse.json()) as PairingCreateResponse;

    const requestResponse = await fetch(
      `${baseUrl}/api/pairings/requests/${pairing.codeDigits}`
    );
    expect(requestResponse.status).toBe(200);
    const request = (await requestResponse.json()) as PairingRequestView;
    expect(request.deviceId).toBe("device_paired");

    const sessionIssue = await fetch(`${baseUrl}/api/auth/session`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ownerToken}`
      }
    });
    const issuedSession = (await sessionIssue.json()) as { sessionToken: string };

    const approveResponse = await fetch(
      `${baseUrl}/api/pairings/requests/${pairing.codeDigits}/approve`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${issuedSession.sessionToken}`
        }
      }
    );
    expect(approveResponse.status).toBe(200);
    const approved = (await approveResponse.json()) as PairingApproveResponse;
    expect(approved.ok).toBe(true);

    const machine = createMachineSocket(baseUrl, "device_paired", {
      deviceToken: "device-token"
    });
    const hello = await waitForConnect(machine, () =>
      emitAck<MachineHelloAck | RelayErrorAck>(machine, "machine:hello", {
        deviceId: "device_paired",
        deviceName: "MacBook Air",
        hostname: "macbook-air.local",
        platform: "darwin",
        arch: "arm64",
        agentVersion: "0.1.0",
        agentRunId: "agent_run_1",
        startedAt: Date.now()
      })
    );
    expect(hello.ok).toBe(true);

    const response = await authorizedFetch(
      `${baseUrl}/api/devices`,
      approved.sessionToken
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { devices: RelayDeviceRecord[] };
    expect(payload.devices[0]?.deviceId).toBe("device_paired");
  });

  it("requires user access to approve a pairing request", async () => {
    const { baseUrl } = await startServer();
    const createResponse = await fetch(`${baseUrl}/api/pairings/device`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        deviceId: "device_locked",
        deviceToken: "device-token",
        deviceName: "Locked Device",
        hostname: "locked-device.local",
        platform: "darwin",
        arch: "arm64",
        agentVersion: "0.1.0"
      })
    });
    const pairing = (await createResponse.json()) as PairingCreateResponse;

    const approveResponse = await fetch(
      `${baseUrl}/api/pairings/requests/${pairing.codeDigits}/approve`,
      { method: "POST" }
    );
    expect(approveResponse.status).toBe(401);
  });

  it("mints browser session tokens from owner auth", async () => {
    const { baseUrl } = await startServer();
    const response = await fetch(`${baseUrl}/api/auth/session`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ownerToken}`
      }
    });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      ok: true;
      sessionToken: string;
    };
    expect(payload.ok).toBe(true);
    expect(typeof payload.sessionToken).toBe("string");
    expect(payload.sessionToken.length).toBeGreaterThan(12);
  });

  it("requires owner auth to mint relay browser sessions", async () => {
    const { baseUrl } = await startServer({ production: true, allowedOrigins: ["http://example.com"] });
    const response = await fetch(`${baseUrl}/api/auth/session`, {
      method: "POST"
    });
    expect(response.status).toBe(401);
  });

  it("rate limits browser session mint attempts", async () => {
    const { baseUrl } = await startServer();
    let lastStatus = 200;
    for (let attempt = 0; attempt < 13; attempt += 1) {
      const response = await fetch(`${baseUrl}/api/auth/session`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ownerToken}`
        }
      });
      lastStatus = response.status;
    }
    expect(lastStatus).toBe(429);
  });

  it("requires explicit allowed origins in production", () => {
    expect(() =>
      createControlServer({
        host: "127.0.0.1",
        port: 0,
        ownerToken,
        production: true
      })
    ).toThrow(/explicit allowed origin/i);
  });

  it("does not accept owner token as browser user access in production", async () => {
    const { baseUrl } = await startServer({
      production: true,
      allowedOrigins: ["http://example.com"]
    });
    const response = await authorizedFetch(`${baseUrl}/api/devices`);
    expect(response.status).toBe(401);
  });

  it("does not allow machine owner-token bootstrap by default in production", async () => {
    const { baseUrl } = await startServer({
      production: true,
      allowedOrigins: ["http://example.com"]
    });
    const machine = createMachineSocket(
      baseUrl,
      "device_prod_owner_bootstrap",
      {
        ownerToken
      },
      false
    );
    const connectError = waitForConnectError(machine);
    machine.connect();
    await expect(connectError).resolves.toMatchObject({
      message: expect.stringMatching(/unauthorized/i)
    });
  });

  it("keeps production CORS restricted to the explicit allowlist", async () => {
    const { baseUrl } = await startServer({
      production: true,
      allowedOrigins: ["http://web.example"]
    });
    const denied = await fetch(`${baseUrl}/api/control/health`, {
      headers: {
        Origin: "http://evil.example"
      }
    });
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();

    const allowed = await fetch(`${baseUrl}/api/control/health`, {
      headers: {
        Origin: "http://web.example"
      }
    });
    expect(allowed.headers.get("access-control-allow-origin")).toBe("http://web.example");
  });

  it("allows PUT preflight for sidebar prefs from an allowed browser origin", async () => {
    const { baseUrl } = await startServer({
      production: true,
      allowedOrigins: ["http://web.example"]
    });
    const response = await fetch(`${baseUrl}/api/devices/device_1/sidebar-prefs`, {
      method: "OPTIONS",
      headers: {
        Origin: "http://web.example",
        "Access-Control-Request-Method": "PUT",
        "Access-Control-Request-Headers": "authorization,content-type"
      }
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://web.example");
    expect(response.headers.get("access-control-allow-methods")).toContain("PUT");
  });

  it("revokes browser sessions on logout", async () => {
    const { baseUrl } = await startServer();
    const issue = await fetch(`${baseUrl}/api/auth/session`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ownerToken}`
      }
    });
    const payload = (await issue.json()) as { sessionToken: string };
    const browser = createUserSocket(baseUrl, {}, payload.sessionToken);
    await waitForConnect(browser, async () => undefined);
    const disconnected = waitForDisconnect(browser);

    const logout = await fetch(`${baseUrl}/api/auth/logout`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${payload.sessionToken}`
      }
    });
    expect(logout.status).toBe(200);
    await expect(disconnected).resolves.toBeUndefined();

    const list = await authorizedFetch(`${baseUrl}/api/devices`, payload.sessionToken);
    expect(list.status).toBe(401);
  });

  it("expires idle browser sessions", async () => {
    const { baseUrl } = await startServer({
      browserSessionIdleMs: 1
    });
    const issue = await fetch(`${baseUrl}/api/auth/session`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ownerToken}`
      }
    });
    const payload = (await issue.json()) as { sessionToken: string };
    await new Promise((resolve) => setTimeout(resolve, 5));
    const list = await authorizedFetch(`${baseUrl}/api/devices`, payload.sessionToken);
    expect(list.status).toBe(401);
  });

  it("expires browser sessions when ttl elapses", async () => {
    const { baseUrl } = await startServer({
      browserSessionTtlMs: 1
    });
    const issue = await fetch(`${baseUrl}/api/auth/session`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ownerToken}`
      }
    });
    const payload = (await issue.json()) as { sessionToken: string };
    await new Promise((resolve) => setTimeout(resolve, 5));
    const list = await authorizedFetch(`${baseUrl}/api/devices`, payload.sessionToken);
    expect(list.status).toBe(401);
  });

  it("rejects Socket.IO user connections after relay session expiry", async () => {
    const { baseUrl } = await startServer({
      browserSessionTtlMs: 1
    });
    const issue = await fetch(`${baseUrl}/api/auth/session`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ownerToken}`
      }
    });
    const payload = (await issue.json()) as { sessionToken: string };
    await new Promise((resolve) => setTimeout(resolve, 5));
    const browser = createUserSocket(baseUrl, {}, payload.sessionToken, false);
    const connectError = waitForConnectError(browser);
    browser.connect();
    await expect(connectError).resolves.toMatchObject({
      message: expect.stringMatching(/unauthorized/i)
    });
  });

  it("disconnects connected user sockets when relay sessions expire during pruning", async () => {
    const now = Date.parse("2026-01-01T00:00:00.000Z");
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(now);
    const { baseUrl } = await startServer({
      browserSessionTtlMs: 1_000,
      pruneIntervalMs: 5
    });
    const issue = await fetch(`${baseUrl}/api/auth/session`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ownerToken}`
      }
    });
    const payload = (await issue.json()) as { sessionToken: string };
    const browser = createUserSocket(baseUrl, {}, payload.sessionToken);
    await waitForConnect(browser, async () => undefined);

    dateNow.mockReturnValue(now + 1_001);
    await expect(waitForDisconnect(browser)).resolves.toBeUndefined();
  });

  it("stores hashed device tokens instead of plaintext", async () => {
    const tempHome = mkdtempSync(path.join(os.tmpdir(), "codexnext-control-"));
    process.env.HOME = tempHome;
    const { baseUrl } = await startServer();

    const createResponse = await fetch(`${baseUrl}/api/pairings/device`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        deviceId: "device_hashed",
        deviceToken: "super-secret-device-token",
        deviceName: "MacBook Air",
        hostname: "macbook-air.local",
        platform: "darwin",
        arch: "arm64",
        agentVersion: "0.1.0"
      })
    });
    const pairing = (await createResponse.json()) as PairingCreateResponse;
    await fetch(`${baseUrl}/api/pairings/requests/${pairing.codeDigits}/approve`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ownerToken}`
      }
    });

    const persisted = readFileSync(
      path.join(tempHome, ".codexnext", "control-devices.json"),
      "utf8"
    );
    expect(persisted).toContain("\"deviceTokenHash\"");
    expect(persisted).not.toContain("super-secret-device-token");
    expect(statSync(path.join(tempHome, ".codexnext", "control-devices.json")).mode & 0o777).toBe(0o600);
  });

  it("migrates legacy plaintext device tokens to v2 hashes", () => {
    const tempHome = mkdtempSync(path.join(os.tmpdir(), "codexnext-legacy-registry-"));
    process.env.HOME = tempHome;
    const registryDir = path.join(tempHome, ".codexnext");
    mkdirSync(registryDir, { recursive: true });
    writeFileSync(
      path.join(registryDir, "control-devices.json"),
      `${JSON.stringify(
        {
          version: 1,
          devices: [
            {
              deviceId: "device_legacy",
              deviceToken: "legacy-device-token",
              deviceName: "Legacy Device",
              hostname: "legacy.local",
              platform: "darwin",
              arch: "arm64",
              agentVersion: "0.1.0",
              createdAt: 1,
              updatedAt: 1
            }
          ]
        },
        null,
        2
      )}\n`
    );

    const registry = new DeviceRegistry(ownerToken);
    expect(registry.isAuthorized("device_legacy", "legacy-device-token")).toBe(true);
    expect(registry.isAuthorized("device_legacy", "wrong-token")).toBe(false);

    const persisted = readFileSync(
      path.join(registryDir, "control-devices.json"),
      "utf8"
    );
    expect(persisted).toContain("\"version\": 2");
    expect(persisted).toContain("\"deviceTokenHash\"");
    expect(persisted).not.toContain("legacy-device-token");
  });

  it("denies revoked device tokens", async () => {
    const tempHome = mkdtempSync(path.join(os.tmpdir(), "codexnext-revoke-"));
    process.env.HOME = tempHome;
    const registry = new DeviceRegistry(ownerToken);
    registry.upsert({
      deviceId: "device_revoked",
      deviceToken: "device-token",
      deviceName: "MacBook Air",
      hostname: "macbook-air.local",
      platform: "darwin",
      arch: "arm64",
      agentVersion: "0.1.0",
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
    expect(registry.isAuthorized("device_revoked", "device-token")).toBe(true);
    registry.revoke("device_revoked");
    expect(registry.isAuthorized("device_revoked", "device-token")).toBe(false);
  });

  it("rate limits pairing create", async () => {
    const { baseUrl } = await startServer();
    let lastStatus = 200;
    for (let attempt = 0; attempt < 9; attempt += 1) {
      const response = await fetch(`${baseUrl}/api/pairings/device`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          deviceId: `device_rate_${attempt}`,
          deviceToken: `device-token-${attempt}`,
          deviceName: "Rate Device",
          hostname: "rate-device.local",
          platform: "darwin",
          arch: "arm64",
          agentVersion: "0.1.0"
        })
      });
      lastStatus = response.status;
    }
    expect(lastStatus).toBe(429);
  });

  it("requires auth for reject pairing", async () => {
    const { baseUrl } = await startServer();
    const createResponse = await fetch(`${baseUrl}/api/pairings/device`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        deviceId: "device_reject",
        deviceToken: "device-token-reject",
        deviceName: "Reject Device",
        hostname: "reject-device.local",
        platform: "darwin",
        arch: "arm64",
        agentVersion: "0.1.0"
      })
    });
    const pairing = (await createResponse.json()) as PairingCreateResponse;
    const reject = await fetch(
      `${baseUrl}/api/pairings/requests/${pairing.codeDigits}/reject`,
      { method: "POST" }
    );
    expect(reject.status).toBe(401);
  });

  it("returns safe pairing views and enforces one-time approval", async () => {
    const { baseUrl } = await startServer();
    const createResponse = await fetch(`${baseUrl}/api/pairings/device`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        deviceId: "device_once",
        deviceToken: "device-token-once",
        deviceName: "Once Device",
        hostname: "once-device.local",
        platform: "darwin",
        arch: "arm64",
        agentVersion: "0.1.0"
      })
    });
    const pairing = (await createResponse.json()) as PairingCreateResponse;
    const viewResponse = await fetch(
      `${baseUrl}/api/pairings/requests/${pairing.codeDigits}`
    );
    expect(viewResponse.status).toBe(200);
    const viewText = await viewResponse.text();
    expect(viewText).toContain("shortFingerprint");
    expect(viewText).not.toContain("device-token-once");

    const approve = await fetch(
      `${baseUrl}/api/pairings/requests/${pairing.codeDigits}/approve`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ownerToken}`
        }
      }
    );
    expect(approve.status).toBe(200);

    const secondApprove = await fetch(
      `${baseUrl}/api/pairings/requests/${pairing.codeDigits}/approve`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ownerToken}`
        }
      }
    );
    expect(secondApprove.status).toBe(409);
  });

  it("polls rejected pairings without exposing device token", async () => {
    const { baseUrl } = await startServer();
    const createResponse = await fetch(`${baseUrl}/api/pairings/device`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        deviceId: "device_rejected",
        deviceToken: "device-token-hidden",
        deviceName: "Rejected Device",
        hostname: "rejected-device.local",
        platform: "darwin",
        arch: "arm64",
        agentVersion: "0.1.0"
      })
    });
    const pairing = (await createResponse.json()) as PairingCreateResponse;
    const reject = await fetch(
      `${baseUrl}/api/pairings/requests/${pairing.codeDigits}/reject`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ownerToken}`
        }
      }
    );
    expect(reject.status).toBe(200);

    const poll = await fetch(
      `${baseUrl}/api/pairings/device/${pairing.requestId}?pollToken=${pairing.pollToken}`
    );
    const pollText = await poll.text();
    expect(poll.status).toBe(200);
    expect(pollText).toContain("\"status\":\"rejected\"");
    expect(pollText).not.toContain("device-token-hidden");
  });

  it("expires pairing requests after the documented ttl", async () => {
    const now = Date.parse("2026-01-01T00:00:00.000Z");
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(now);
    const { baseUrl } = await startServer({ pruneIntervalMs: 60_000 });
    const createResponse = await fetch(`${baseUrl}/api/pairings/device`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        deviceId: "device_expired",
        deviceToken: "device-token-expired",
        deviceName: "Expired Device",
        hostname: "expired-device.local",
        platform: "darwin",
        arch: "arm64",
        agentVersion: "0.1.0"
      })
    });
    const pairing = (await createResponse.json()) as PairingCreateResponse;
    expect(pairing.expiresAt - now).toBe(15 * 60_000);
    dateNow.mockReturnValue(now + 15 * 60_000 + 1);

    const view = await fetch(`${baseUrl}/api/pairings/requests/${pairing.codeDigits}`);
    expect(view.status).toBe(200);
    expect((await view.json()) as PairingRequestView).toMatchObject({
      status: "expired"
    });

    const approve = await fetch(
      `${baseUrl}/api/pairings/requests/${pairing.codeDigits}/approve`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ownerToken}`
        }
      }
    );
    expect(approve.status).toBe(410);
  });

  it("rate limits pairing lookup attempts", async () => {
    const { baseUrl } = await startServer();
    let lastStatus = 404;
    for (let attempt = 0; attempt < 31; attempt += 1) {
      const response = await fetch(`${baseUrl}/api/pairings/requests/000000`);
      lastStatus = response.status;
    }
    expect(lastStatus).toBe(429);
  });

  it("rate limits pairing decision attempts", async () => {
    const { baseUrl } = await startServer();
    let lastStatus = 404;
    for (let attempt = 0; attempt < 21; attempt += 1) {
      const response = await fetch(
        `${baseUrl}/api/pairings/requests/000000/approve`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${ownerToken}`
          }
        }
      );
      lastStatus = response.status;
    }
    expect(lastStatus).toBe(429);
  });

  it("revokes a connected device, disconnects the socket, and blocks reconnect", async () => {
    const tempHome = mkdtempSync(path.join(os.tmpdir(), "codexnext-device-revoke-"));
    process.env.HOME = tempHome;
    const { baseUrl } = await startServer({
      production: true,
      allowedOrigins: ["http://example.com"],
      allowMachineOwnerToken: false
    });
    const createResponse = await fetch(`${baseUrl}/api/pairings/device`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        deviceId: "device_revoke_live",
        deviceToken: "device-token-live",
        deviceName: "Live Device",
        hostname: "live-device.local",
        platform: "darwin",
        arch: "arm64",
        agentVersion: "0.1.0"
      })
    });
    const pairing = (await createResponse.json()) as PairingCreateResponse;
    const sessionIssue = await fetch(`${baseUrl}/api/auth/session`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ownerToken}`
      }
    });
    const issuedSession = (await sessionIssue.json()) as { sessionToken: string };
    await fetch(`${baseUrl}/api/pairings/requests/${pairing.codeDigits}/approve`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${issuedSession.sessionToken}`
      }
    });

    const machine = createMachineSocket(baseUrl, "device_revoke_live", {
      deviceToken: "device-token-live"
    });
    await waitForConnect(machine, () =>
      emitAck(machine, "machine:hello", {
        deviceId: "device_revoke_live",
        deviceName: "Live Device",
        hostname: "live-device.local",
        platform: "darwin",
        arch: "arm64",
        agentVersion: "0.1.0",
        agentRunId: "agent_run_1",
        startedAt: Date.now()
      })
    );

    const browser = createUserSocket(baseUrl, {}, issuedSession.sessionToken);
    await waitForConnect(browser, async () => undefined);
    const offline = waitForDeviceOffline(browser);
    const disconnected = waitForDisconnect(machine);
    const revoke = await fetch(`${baseUrl}/api/devices/device_revoke_live`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${issuedSession.sessionToken}`
      }
    });
    expect(revoke.status).toBe(200);
    await expect(disconnected).resolves.toBeUndefined();
    await expect(offline).resolves.toMatchObject({
      deviceId: "device_revoke_live"
    });

    const registry = new DeviceRegistry(ownerToken);
    expect(registry.get("device_revoke_live")?.revokedAt).toEqual(expect.any(Number));
    expect(registry.isAuthorized("device_revoke_live", "device-token-live")).toBe(false);

    const reconnect = createMachineSocket(
      baseUrl,
      "device_revoke_live",
      {
        deviceToken: "device-token-live"
      },
      false
    );
    const connectError = waitForConnectError(reconnect);
    reconnect.connect();
    await expect(connectError).resolves.toMatchObject({
      message: expect.stringMatching(/unauthorized/i)
    });
  });

  it("broadcasts device revoke offline state to two user clients", async () => {
    const tempHome = mkdtempSync(path.join(os.tmpdir(), "codexnext-device-revoke-two-users-"));
    process.env.HOME = tempHome;
    const { baseUrl } = await startServer();
    const createResponse = await fetch(`${baseUrl}/api/pairings/device`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        deviceId: "device_revoke_two_users",
        deviceToken: "device-token-live",
        deviceName: "Live Device",
        hostname: "live-device.local",
        platform: "darwin",
        arch: "arm64",
        agentVersion: "0.1.0"
      })
    });
    const pairing = (await createResponse.json()) as PairingCreateResponse;
    const approveResponse = await fetch(
      `${baseUrl}/api/pairings/requests/${pairing.codeDigits}/approve`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ownerToken}`
        }
      }
    );
    const approved = (await approveResponse.json()) as PairingApproveResponse;

    const secondSession = await fetch(`${baseUrl}/api/auth/session`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ownerToken}` }
    });
    const secondToken = ((await secondSession.json()) as { sessionToken: string }).sessionToken;

    const machine = createMachineSocket(baseUrl, "device_revoke_two_users", {
      deviceToken: "device-token-live"
    });
    await waitForConnect(machine, () =>
      emitAck(machine, "machine:hello", {
        deviceId: "device_revoke_two_users",
        deviceName: "Live Device",
        hostname: "live-device.local",
        platform: "darwin",
        arch: "arm64",
        agentVersion: "0.1.0",
        agentRunId: "agent_run_1",
        startedAt: Date.now()
      })
    );

    const firstBrowser = createUserSocket(baseUrl, {}, approved.sessionToken);
    const secondBrowser = createUserSocket(baseUrl, {}, secondToken);
    await waitForConnect(firstBrowser, async () => undefined);
    await waitForConnect(secondBrowser, async () => undefined);
    const firstOffline = waitForDeviceOffline(firstBrowser);
    const secondOffline = waitForDeviceOffline(secondBrowser);

    const revoke = await fetch(`${baseUrl}/api/devices/device_revoke_two_users`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${approved.sessionToken}`
      }
    });
    expect(revoke.status).toBe(200);
    await expect(firstOffline).resolves.toMatchObject({
      deviceId: "device_revoke_two_users"
    });
    await expect(secondOffline).resolves.toMatchObject({
      deviceId: "device_revoke_two_users"
    });
  });

  it("bounds an in-flight relay rpc when its device is revoked", async () => {
    const tempHome = mkdtempSync(path.join(os.tmpdir(), "codexnext-device-revoke-rpc-"));
    process.env.HOME = tempHome;
    const { baseUrl } = await startServer({
      production: true,
      allowedOrigins: ["http://example.com"],
      allowMachineOwnerToken: false,
      rpcTimeoutMs: 100
    });
    const createResponse = await fetch(`${baseUrl}/api/pairings/device`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        deviceId: "device_revoke_rpc",
        deviceToken: "device-token-rpc",
        deviceName: "RPC Device",
        hostname: "rpc-device.local",
        platform: "darwin",
        arch: "arm64",
        agentVersion: "0.1.0"
      })
    });
    const pairing = (await createResponse.json()) as PairingCreateResponse;
    const sessionIssue = await fetch(`${baseUrl}/api/auth/session`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ownerToken}`
      }
    });
    const issuedSession = (await sessionIssue.json()) as { sessionToken: string };
    await fetch(`${baseUrl}/api/pairings/requests/${pairing.codeDigits}/approve`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${issuedSession.sessionToken}`
      }
    });

    const machine = createMachineSocket(baseUrl, "device_revoke_rpc", {
      deviceToken: "device-token-rpc"
    });
    await waitForConnect(machine, () =>
      emitAck(machine, "machine:hello", {
        deviceId: "device_revoke_rpc",
        deviceName: "RPC Device",
        hostname: "rpc-device.local",
        platform: "darwin",
        arch: "arm64",
        agentVersion: "0.1.0",
        agentRunId: "agent_run_1",
        startedAt: Date.now()
      })
    );

    let sawRpc: (() => void) | undefined;
    const rpcStarted = new Promise<void>((resolve) => {
      sawRpc = resolve;
    });
    machine.on("rpc:request", () => {
      sawRpc?.();
      // Intentionally leave the in-flight RPC unresolved until revoke closes the socket.
    });

    const inFlight = authorizedFetch(
      `${baseUrl}/api/relay/devices/device_revoke_rpc/health`,
      issuedSession.sessionToken
    );
    await rpcStarted;

    const disconnected = waitForDisconnect(machine);
    const revoke = await fetch(`${baseUrl}/api/devices/device_revoke_rpc`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${issuedSession.sessionToken}`
      }
    });
    expect(revoke.status).toBe(200);
    await expect(disconnected).resolves.toBeUndefined();

    const response = await inFlight;
    expect([503, 504]).toContain(response.status);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringMatching(/timeout|offline|not connected/i)
    });
  });

  it("allows relay full-access by default", async () => {
    const { baseUrl } = await startServer();
    const session = await fetch(`${baseUrl}/api/auth/session`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ownerToken}`
      }
    });
    const payload = (await session.json()) as { sessionToken: string };
    const response = await fetch(`${baseUrl}/api/relay/devices/device_1/sessions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${payload.sessionToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        cwd: "/tmp",
        permissionMode: "full-access"
      })
    });
    expect(response.status).not.toBe(403);
  });

  it("allows relay full-access when explicitly enabled", async () => {
    const { baseUrl } = await startServer({
      allowRelayFullAccess: true
    });
    const session = await fetch(`${baseUrl}/api/auth/session`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ownerToken}`
      }
    });
    const payload = (await session.json()) as { sessionToken: string };
    const response = await fetch(`${baseUrl}/api/relay/devices/device_1/sessions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${payload.sessionToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        cwd: "/tmp",
        permissionMode: "full-access"
      })
    });
    expect(response.status).not.toBe(403);
  });

  it("blocks relay full-access when explicitly disabled", async () => {
    const { baseUrl } = await startServer({
      allowRelayFullAccess: false
    });
    const session = await fetch(`${baseUrl}/api/auth/session`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ownerToken}`
      }
    });
    const payload = (await session.json()) as { sessionToken: string };
    const response = await fetch(`${baseUrl}/api/relay/devices/device_1/sessions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${payload.sessionToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        cwd: "/tmp",
        permissionMode: "full-access"
      })
    });
    expect(response.status).toBe(403);
  });

  it("blocks relay full-access when disabled by env", async () => {
    process.env.CODEXNEXT_DISABLE_RELAY_FULL_ACCESS = "1";
    const { baseUrl } = await startServer();
    const session = await fetch(`${baseUrl}/api/auth/session`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ownerToken}`
      }
    });
    const payload = (await session.json()) as { sessionToken: string };
    const response = await fetch(`${baseUrl}/api/relay/devices/device_1/sessions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${payload.sessionToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        cwd: "/tmp",
        sandbox: "danger-full-access",
        approvalPolicy: "never"
      })
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "Relay full-access is disabled by operator policy."
    });
  });

  it("returns safe control health without relay secrets or content", async () => {
    const tempHome = mkdtempSync(path.join(os.tmpdir(), "codexnext-health-"));
    process.env.HOME = tempHome;
    const { baseUrl } = await startServer({
      production: true,
      allowedOrigins: ["http://example.com"]
    });
    const response = await fetch(`${baseUrl}/api/control/health`);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
      ok: true,
      onlineDevices: 0,
      knownDevices: 0,
      registeredDevices: 0,
      production: true
    });
    const text = JSON.stringify(payload);
    expect(text).not.toMatch(/ownerToken|sessionToken|deviceToken|prompt|assistant|command|output/i);
  });

  it("redacts sensitive content from control audit logs", async () => {
    const tempHome = mkdtempSync(path.join(os.tmpdir(), "codexnext-audit-"));
    process.env.HOME = tempHome;
    const { baseUrl } = await startServer({
      allowRelayFullAccess: false
    });
    const machine = createMachineSocket(baseUrl, "device_audit", {
      ownerToken
    });
    await waitForConnect(machine, () =>
      emitAck(machine, "machine:hello", {
        deviceId: "device_audit",
        deviceName: "Audit Device",
        hostname: "audit-device.local",
        platform: "darwin",
        arch: "arm64",
        agentVersion: "0.1.0",
        agentRunId: "agent_run_1",
        startedAt: Date.now()
      })
    );
    machine.on("rpc:request", (_request, ack) => {
      ack({
        ok: false,
        error: {
          message:
            "owner-token session-secret device-token prompt text assistant content full command output"
        }
      });
    });

    const session = await fetch(`${baseUrl}/api/auth/session`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ownerToken}`
      }
    });
    const payload = (await session.json()) as { sessionToken: string };
    const denied = await fetch(`${baseUrl}/api/relay/devices/device_audit/sessions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${payload.sessionToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        cwd: "/tmp",
        permissionMode: "full-access",
        prompt: "do not log this prompt"
      })
    });
    expect(denied.status).toBe(403);

    const failure = await authorizedFetch(
      `${baseUrl}/api/relay/devices/device_audit/health`,
      payload.sessionToken
    );
    expect(failure.status).toBe(400);

    const audit = readFileSync(
      path.join(tempHome, ".codexnext", "control-audit.log"),
      "utf8"
    );
    expect(audit).toContain("relay_full_access_disabled");
    expect(audit).toContain("relay_rpc_error");
    expect(audit).not.toContain("session-secret");
    expect(audit).not.toContain("device-token");
    expect(audit).not.toContain("do not log this prompt");
    expect(audit).not.toContain("assistant content");
    expect(audit).not.toContain("full command output");
  });
});

async function startServer(overrides: Partial<Parameters<typeof createControlServer>[0]> = {}) {
  const handle = createControlServer({
    host: "127.0.0.1",
    port: 0,
    ownerToken,
    ...overrides
  });
  handles.add(handle);
  await handle.app.listen({ host: "127.0.0.1", port: 0 });
  const address = handle.app.server.address() as AddressInfo;
  return {
    handle,
    baseUrl: `http://127.0.0.1:${address.port}`
  };
}

function createMachineSocket(
  baseUrl: string,
  deviceId: string,
  overrides: Partial<{
    deviceToken: string;
    ownerToken: string;
  }> = {},
  autoConnect = true
): Socket {
  const socket = io(`${baseUrl}${RelayNamespace.Machine}`, {
    path: RelaySocketPath,
    autoConnect,
    auth: {
      clientType: "machine",
      ...(overrides.ownerToken !== undefined ? { ownerToken: overrides.ownerToken } : {}),
      ...(overrides.deviceToken ? { deviceToken: overrides.deviceToken } : {}),
      deviceId
    }
  });
  sockets.add(socket);
  return socket;
}

function createUserSocket(
  baseUrl: string,
  lastSeqByDevice: Record<string, number>,
  sessionToken: string,
  autoConnect = true
): Socket {
  const socket = io(`${baseUrl}${RelayNamespace.User}`, {
    path: RelaySocketPath,
    autoConnect,
    auth: {
      clientType: "user",
      sessionToken,
      lastSeqByDevice
    }
  });
  sockets.add(socket);
  return socket;
}

async function waitForConnect<T>(socket: Socket, afterConnect: () => Promise<T>): Promise<T> {
  if (socket.connected) {
    return afterConnect();
  }
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", () => resolve());
    socket.once("connect_error", reject);
  });
  return afterConnect();
}

async function waitForConnectError(socket: Socket): Promise<Error> {
  return new Promise<Error>((resolve) => {
    socket.once("connect_error", (error) => resolve(error));
  });
}

async function waitForDisconnect(socket: Socket): Promise<void> {
  return new Promise<void>((resolve) => {
    socket.once("disconnect", () => resolve());
  });
}

async function emitAck<T>(socket: Socket, event: string, payload: unknown): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    socket.timeout(3_000).emit(event, payload, (error: Error | null, response: T) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(response);
    });
  });
}

async function waitForDeviceEvent(socket: Socket): Promise<DeviceEventPayload> {
  return new Promise<DeviceEventPayload>((resolve) => {
    socket.once("device:event", (payload: DeviceEventPayload) => resolve(payload));
  });
}

async function waitForDeviceEventIds(
  socket: Socket,
  eventIds: string[]
): Promise<DeviceEventPayload[]> {
  return new Promise<DeviceEventPayload[]>((resolve, reject) => {
    const expected = new Set(eventIds);
    const payloadsByEventId = new Map<string, DeviceEventPayload>();
    const timeout = setTimeout(() => {
      socket.off("device:event", handleEvent);
      reject(
        new Error(
          `Timed out waiting for device events: ${eventIds
            .filter((eventId) => !payloadsByEventId.has(eventId))
            .join(", ")}`
        )
      );
    }, 3_000);
    const handleEvent = (payload: DeviceEventPayload) => {
      if (!expected.has(payload.event.id)) {
        return;
      }
      payloadsByEventId.set(payload.event.id, payload);
      if (payloadsByEventId.size === expected.size) {
        clearTimeout(timeout);
        socket.off("device:event", handleEvent);
        resolve(eventIds.map((eventId) => payloadsByEventId.get(eventId)!));
      }
    };
    socket.on("device:event", handleEvent);
  });
}

async function waitForDeviceReplay(socket: Socket): Promise<DeviceEventPayload[]> {
  return new Promise<DeviceEventPayload[]>((resolve) => {
    socket.once("device:replay", (payload: DeviceEventPayload[]) => resolve(payload));
  });
}

async function waitForDeviceOffline(socket: Socket): Promise<{ deviceId: string; lastSeenAt: number }> {
  return new Promise<{ deviceId: string; lastSeenAt: number }>((resolve) => {
    socket.once("device:offline", (payload: { deviceId: string; lastSeenAt: number }) =>
      resolve(payload)
    );
  });
}

async function waitForDevicePresence(socket: Socket): Promise<{
  activeSessions?: number;
  deviceId: string;
  lastSeenAt: number;
  online: boolean;
  socketId?: string;
}> {
  return new Promise((resolve) => {
    socket.once(
      "device:presence",
      (payload: {
        activeSessions?: number;
        deviceId: string;
        lastSeenAt: number;
        online: boolean;
        socketId?: string;
      }) => resolve(payload)
    );
  });
}

async function authorizedFetch(url: string, token = ownerToken): Promise<Response> {
  return fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
}

function deviceEventKey(payload: DeviceEventPayload): string {
  return `${payload.deviceId}:${payload.event.id}:${payload.event.seq}`;
}
