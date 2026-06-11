import os from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { io } from "socket.io-client";
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
  createLocalAgentRuntime,
  type LocalAgentRuntime
} from "../local-server/local-agent.js";
import { readOrCreateDeviceIdentity } from "../relay/device-identity.js";

export interface ConnectOptions {
  relay: string;
  ownerToken?: string;
  deviceName?: string;
  approvalTimeoutMs: number;
  codexBin: string;
}

export interface ConnectRuntimeDependencies {
  activeSessionCount?: typeof activeSessionCount;
  codexVersion?: typeof codexVersion;
  createLocalAgentRuntime?: typeof createLocalAgentRuntime;
  clearInterval?: typeof clearInterval;
  io?: (uri: string, options: Parameters<typeof io>[1]) => ConnectSocket;
  now?: () => number;
  printLine?: typeof printLine;
  printSection?: typeof printSection;
  readOrCreateDeviceIdentity?: typeof readOrCreateDeviceIdentity;
  setInterval?: typeof setInterval;
  sleep?: (ms: number) => Promise<void>;
}

export interface ConnectAgentHandle {
  close(): Promise<void>;
  runtime: LocalAgentRuntime;
  socket: ConnectSocket;
}

export interface ConnectSocket {
  auth: unknown;
  connected: boolean;
  io: {
    on(event: "reconnect_attempt", listener: () => void): unknown;
    on(event: string, listener: (...args: any[]) => void): unknown;
  };
  close(): unknown;
  connect(): unknown;
  disconnect(): unknown;
  emit(event: string, payload: unknown): unknown;
  on(event: "connect", listener: () => void): unknown;
  on(event: "disconnect", listener: () => void): unknown;
  on(event: "connect_error", listener: (error: Error) => void): unknown;
  on(
    event: "rpc:request",
    listener: (
      request: RelayRpcRequest,
      ack?: (response: RelayRpcResponse) => void
    ) => void
  ): unknown;
  on(event: string, listener: (...args: any[]) => void): unknown;
  timeout(timeoutMs: number): {
    emit<T>(
      event: string,
      payload: unknown,
      callback: (error: Error | null, response: T) => void
    ): unknown;
  };
}

export async function startConnectAgent(
  options: ConnectOptions,
  dependencies: ConnectRuntimeDependencies = {}
): Promise<ConnectAgentHandle> {
  const activeSessionCountFn =
    dependencies.activeSessionCount ?? activeSessionCount;
  const clearIntervalFn = dependencies.clearInterval ?? clearInterval;
  const codexVersionFn = dependencies.codexVersion ?? codexVersion;
  const createLocalAgentRuntimeFn =
    dependencies.createLocalAgentRuntime ?? createLocalAgentRuntime;
  const ioFn = dependencies.io ?? io;
  const nowFn = dependencies.now ?? Date.now;
  const printLineFn = dependencies.printLine ?? printLine;
  const printSectionFn = dependencies.printSection ?? printSection;
  const readOrCreateDeviceIdentityFn =
    dependencies.readOrCreateDeviceIdentity ?? readOrCreateDeviceIdentity;
  const setIntervalFn = dependencies.setInterval ?? setInterval;
  const sleepFn = dependencies.sleep ?? sleep;
  const relayUrl = normalizeRelayUrl(options.relay);
  const identity = await readOrCreateDeviceIdentityFn({
    ...(options.deviceName ? { deviceName: options.deviceName } : {}),
    relayUrl
  });
  const runtime = createLocalAgentRuntimeFn({
    host: "relay",
    port: 0,
    approvalTimeoutMs: options.approvalTimeoutMs,
    codexBin: options.codexBin
  });
  const codex = await codexVersionFn(options.codexBin);
  const startedAt = nowFn();

  const socket: ConnectSocket = ioFn(`${relayUrl}${RelayNamespace.Machine}`, {
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
      clearIntervalFn(heartbeatTimer);
      heartbeatTimer = null;
    }
  };

  const emitHeartbeat = () => {
    if (!socket.connected) {
      return;
    }
    socket.emit("machine:heartbeat", {
      deviceId: identity.deviceId,
      at: nowFn(),
      activeSessions: activeSessionCountFn(runtime.sessionManager.summaries())
    });
  };

  const startHeartbeat = () => {
    stopHeartbeat();
    heartbeatTimer = setIntervalFn(emitHeartbeat, heartbeatIntervalMs);
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
        printSectionFn("codexnext connect", "relay agent is connected");
        printLineFn(`Relay: ${relayUrl}`);
        printLineFn(`Device: ${identity.deviceName} (${identity.deviceId})`);
        printLineFn("Press Ctrl+C to stop the relay agent.");
      }
    } catch (error) {
      printLineFn(`relay handshake failed: ${formatError(error)}`);
      socket.disconnect();
      await sleepFn(1_000);
      updateAuth();
      socket.connect();
    }
  });

  socket.on("disconnect", () => {
    stopHeartbeat();
  });

  socket.io.on("reconnect_attempt", updateAuth);
  socket.on("connect_error", (error: Error) => {
    printLineFn(`relay connect error: ${formatError(error)}`);
  });

  socket.on(
    "rpc:request",
    async (
      request: RelayRpcRequest,
      ack?: (response: RelayRpcResponse) => void
    ) => {
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
    }
  );

  return {
    close: async () => {
      stopHeartbeat();
      socket.close();
      await runtime.close();
    },
    runtime,
    socket
  };
}

export async function runConnect(options: ConnectOptions): Promise<void> {
  const handle = await startConnectAgent(options);

  const shutdown = async () => {
    await handle.close();
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
  socket: ConnectSocket,
  event: string,
  payload: unknown,
  timeoutMs: number
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    socket
      .timeout(timeoutMs)
      .emit(event, payload, (error: Error | null, response: T) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(response);
      }
    );
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
