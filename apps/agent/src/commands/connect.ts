import os from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { io, type Socket } from "socket.io-client";
import type {
  MachineHelloAck,
  MachineHelloPayload,
  RelayErrorAck,
  RelayRpcRequest,
  RelayRpcResponse
} from "@codexnext/protocol";
import {
  RelayNamespace,
  RelaySocketPath
} from "@codexnext/protocol";
import { printLine, printSection } from "../output.js";
import {
  activeSessionCount,
  codexVersion,
  createLocalAgentRuntime
} from "../local-server/local-agent.js";
import { readOrCreateDeviceIdentity } from "../relay/device-identity.js";

export interface ConnectOptions {
  relay: string;
  ownerToken?: string;
  deviceName?: string;
  approvalTimeoutMs: number;
  codexBin: string;
}

export async function runConnect(options: ConnectOptions): Promise<void> {
  const relayUrl = normalizeRelayUrl(options.relay);
  const identity = await readOrCreateDeviceIdentity({
    ...(options.deviceName ? { deviceName: options.deviceName } : {}),
    relayUrl
  });
  const runtime = createLocalAgentRuntime({
    host: "relay",
    port: 0,
    approvalTimeoutMs: options.approvalTimeoutMs,
    codexBin: options.codexBin
  });
  const codex = await codexVersion(options.codexBin);
  const startedAt = Date.now();

  const socket = io(`${relayUrl}${RelayNamespace.Machine}`, {
    path: RelaySocketPath,
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionDelayMax: 5_000,
    auth: {
      clientType: "machine",
      deviceId: identity.deviceId,
      deviceToken: identity.deviceToken,
      lastSeq: runtime.eventStore.lastSeq(),
      ...(options.ownerToken ? { ownerToken: options.ownerToken } : {})
    }
  });

  let heartbeatIntervalMs = 15_000;
  let heartbeatTimer: NodeJS.Timeout | null = null;
  let announcedReady = false;

  const updateAuth = () => {
    socket.auth = {
      clientType: "machine",
      deviceId: identity.deviceId,
      deviceToken: identity.deviceToken,
      lastSeq: runtime.eventStore.lastSeq(),
      ...(options.ownerToken ? { ownerToken: options.ownerToken } : {})
    };
  };

  const stopHeartbeat = () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  };

  const emitHeartbeat = () => {
    if (!socket.connected) {
      return;
    }
    socket.emit("machine:heartbeat", {
      deviceId: identity.deviceId,
      at: Date.now(),
      activeSessions: activeSessionCount(runtime.sessionManager.summaries())
    });
  };

  const startHeartbeat = () => {
    stopHeartbeat();
    heartbeatTimer = setInterval(emitHeartbeat, heartbeatIntervalMs);
    emitHeartbeat();
  };

  runtime.eventStore.on("event", (event) => {
    if (!socket.connected) {
      return;
    }
    socket.emit("machine:event", {
      deviceId: identity.deviceId,
      event
    });
  });

  socket.on("connect", async () => {
    updateAuth();
    const hello: MachineHelloPayload = {
      deviceId: identity.deviceId,
      deviceName: identity.deviceName,
      hostname: os.hostname(),
      platform: process.platform,
      arch: process.arch,
      agentVersion: "0.1.0",
      codexVersion: codex.version ?? null,
      startedAt
    };

    try {
      const ack = await emitWithAck<MachineHelloAck | RelayErrorAck>(
        socket,
        "machine:hello",
        hello,
        10_000
      );
      if (!ack || ack.ok !== true) {
        throw new Error(ack?.error ?? "machine hello rejected");
      }
      heartbeatIntervalMs = ack.heartbeatIntervalMs;
      startHeartbeat();
      if (!announcedReady) {
        announcedReady = true;
        printSection("codexnext connect", "relay agent is connected");
        printLine(`Relay: ${relayUrl}`);
        printLine(`Device: ${identity.deviceName} (${identity.deviceId})`);
        printLine("Press Ctrl+C to stop the relay agent.");
      }
    } catch (error) {
      printLine(`relay handshake failed: ${formatError(error)}`);
      socket.disconnect();
      await sleep(1_000);
      updateAuth();
      socket.connect();
    }
  });

  socket.on("disconnect", () => {
    stopHeartbeat();
  });

  socket.io.on("reconnect_attempt", updateAuth);
  socket.on("connect_error", (error) => {
    printLine(`relay connect error: ${formatError(error)}`);
  });

  socket.on("rpc:request", async (request: RelayRpcRequest, ack?: (response: RelayRpcResponse) => void) => {
    if (typeof ack !== "function") {
      return;
    }
    try {
      const result = await runtime.invoke(request.method, request.params);
      ack({ ok: true, result });
    } catch (error) {
      ack({
        ok: false,
        error: {
          message: formatError(error)
        }
      });
    }
  });

  const shutdown = async () => {
    stopHeartbeat();
    socket.close();
    await runtime.close();
    process.exit(0);
  };

  process.once("SIGINT", () => {
    void shutdown();
  });
  process.once("SIGTERM", () => {
    void shutdown();
  });

  await new Promise<void>(() => undefined);
}

async function emitWithAck<T>(
  socket: Socket,
  event: string,
  payload: unknown,
  timeoutMs: number
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    socket.timeout(timeoutMs).emit(event, payload, (error: Error | null, response: T) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(response);
    });
  });
}

export function normalizeRelayUrl(value: string): string {
  const url = new URL(value.trim());
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
