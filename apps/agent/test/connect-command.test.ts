import { EventEmitter } from "node:events";
import { describe, expect, it, vi, type Mock } from "vitest";
import {
  LocalEventType,
  RelayMethod,
  RelayNamespace,
  RelaySocketPath,
  type LocalEvent,
  type RelayRpcRequest,
  type RelayRpcResponse
} from "@codexnext/protocol";
import {
  startConnectAgent,
  type ConnectRuntimeDependencies,
  type ConnectSocket
} from "../src/commands/connect.js";
import type { LocalAgentRuntime } from "../src/local-server/local-agent.js";

const baseOptions = {
  approvalTimeoutMs: 1000,
  codexBin: "codex",
  ownerToken: "owner-token",
  relay: "https://relay.example/control?token=secret#section"
};

const identity = {
  version: 1 as const,
  deviceId: "device_1",
  deviceName: "MacBook",
  deviceToken: "device-token",
  createdAt: 1,
  relayUrl: "https://relay.example"
};

describe("startConnectAgent", () => {
  it("sends machine hello, starts heartbeat, and prints ready output", async () => {
    const socket = new FakeSocket();
    socket.queueAck({
      ok: true,
      serverTime: 2,
      heartbeatIntervalMs: 1234
    });
    const runtime = createFakeRuntime();
    const deps = createDeps(socket, runtime);

    const handle = await startConnectAgent(baseOptions, deps.dependencies);
    socket.triggerConnect();
    await flushAsync();

    expect(deps.ioCalls).toEqual([
      {
        uri: `https://relay.example${RelayNamespace.Machine}`,
        options: expect.objectContaining({
          path: RelaySocketPath,
          auth: {
            clientType: "machine",
            deviceId: "device_1",
            deviceToken: "device-token",
            ownerToken: "owner-token"
          }
        })
      }
    ]);
    expect(socket.emitted.find((entry) => entry.event === "machine:hello")).toMatchObject({
      payload: {
        agentRunId: "agent_run_1",
        agentVersion: "0.1.0",
        codexVersion: "codex 0.1.0",
        deviceId: "device_1",
        deviceName: "MacBook",
        startedAt: 100
      },
      timeoutMs: 10_000
    });
    expect(socket.emitted.find((entry) => entry.event === "machine:heartbeat")).toEqual({
      event: "machine:heartbeat",
      payload: {
        activeSessions: 2,
        at: 100,
        deviceId: "device_1"
      }
    });
    expect(deps.intervals).toEqual([{ ms: 1234 }]);
    expect(deps.sections).toEqual([
      ["codexnext connect", "relay agent is connected"]
    ]);
    expect(deps.lines).toContain("Relay: https://relay.example");

    await handle.close();
  });

  it("reconnects after rejected machine hello", async () => {
    const socket = new FakeSocket();
    socket.queueAck({ ok: false, error: "denied" });
    socket.queueAck({
      ok: true,
      serverTime: 3,
      heartbeatIntervalMs: 2000
    });
    const runtime = createFakeRuntime();
    const deps = createDeps(socket, runtime);

    const handle = await startConnectAgent(baseOptions, deps.dependencies);
    socket.triggerConnect();
    await flushAsync();

    const helloEmits = socket.emitted.filter((entry) => entry.event === "machine:hello");
    expect(helloEmits).toHaveLength(2);
    expect(socket.disconnectCalls).toBe(1);
    expect(socket.connectCalls).toBe(1);
    expect(socket.connectAuthSnapshots).toEqual([
      {
        clientType: "machine",
        deviceId: "device_1",
        deviceToken: "device-token",
        ownerToken: "owner-token"
      }
    ]);
    expect(deps.sleeps).toEqual([1000]);
    expect(deps.lines).toContain("relay handshake failed: denied");

    await handle.close();
  });

  it("forwards local events only while connected", async () => {
    const socket = new FakeSocket();
    socket.queueAck({
      ok: true,
      serverTime: 2,
      heartbeatIntervalMs: 1234
    });
    const runtime = createFakeRuntime();
    const deps = createDeps(socket, runtime);
    const event: LocalEvent = {
      id: "evt_1",
      seq: 1,
      ts: 100,
      type: LocalEventType.AgentHealth
    };

    const handle = await startConnectAgent(baseOptions, deps.dependencies);
    runtime.emitEvent(event);
    expect(socket.emitted.some((entry) => entry.event === "machine:event")).toBe(false);

    socket.triggerConnect();
    await flushAsync();
    runtime.emitEvent(event);
    expect(socket.emitted.find((entry) => entry.event === "machine:event")).toEqual({
      event: "machine:event",
      payload: {
        agentRunId: "agent_run_1",
        deviceId: "device_1",
        event
      }
    });

    socket.triggerDisconnect();
    runtime.emitEvent({ ...event, id: "evt_2", seq: 2 });
    expect(socket.emitted.filter((entry) => entry.event === "machine:event")).toHaveLength(1);

    await handle.close();
  });

  it("acks rpc requests with success and error responses", async () => {
    const socket = new FakeSocket();
    const runtime = createFakeRuntime();
    const deps = createDeps(socket, runtime);
    const responses: RelayRpcResponse[] = [];

    runtime.invoke.mockResolvedValueOnce({ sessions: [] });
    const handle = await startConnectAgent(baseOptions, deps.dependencies);
    socket.triggerRpc(
      { requestId: "rpc_1", method: RelayMethod.SessionsList },
      (response) => responses.push(response)
    );
    await flushAsync();

    runtime.invoke.mockRejectedValueOnce(new Error("boom"));
    socket.triggerRpc(
      { requestId: "rpc_2", method: RelayMethod.SessionsCreate },
      (response) => responses.push(response)
    );
    await flushAsync();

    expect(responses).toEqual([
      { ok: true, result: { sessions: [] } },
      { ok: false, error: { message: "boom" } }
    ]);

    await handle.close();
  });

  it("close handle stops heartbeat and closes socket/runtime", async () => {
    const socket = new FakeSocket();
    socket.queueAck({
      ok: true,
      serverTime: 2,
      heartbeatIntervalMs: 1234
    });
    const runtime = createFakeRuntime();
    const deps = createDeps(socket, runtime);

    const handle = await startConnectAgent(baseOptions, deps.dependencies);
    socket.triggerConnect();
    await flushAsync();
    await handle.close();

    expect(deps.clearedIntervals).toHaveLength(1);
    expect(socket.closed).toBe(true);
    expect(runtime.close).toHaveBeenCalledTimes(1);
  });
});

class FakeSocket implements ConnectSocket {
  public auth: unknown;
  public closed = false;
  public connected = false;
  public connectAuthSnapshots: unknown[] = [];
  public connectCalls = 0;
  public disconnectCalls = 0;
  public readonly emitted: Array<{
    event: string;
    payload: unknown;
    timeoutMs?: number;
  }> = [];
  public readonly io = {
    on: (event: string, listener: (...args: any[]) => void) => {
      this.ioEmitter.on(event, listener);
      return this.io;
    }
  };

  private readonly acks: Array<{ error: Error | null; response: unknown }> = [];
  private readonly emitter = new EventEmitter();
  private readonly ioEmitter = new EventEmitter();

  public close(): this {
    this.closed = true;
    this.connected = false;
    return this;
  }

  public connect(): this {
    this.connectCalls += 1;
    this.connected = true;
    this.connectAuthSnapshots.push(this.auth);
    this.emitter.emit("connect");
    return this;
  }

  public disconnect(): this {
    this.disconnectCalls += 1;
    this.connected = false;
    this.emitter.emit("disconnect");
    return this;
  }

  public emit(event: string, payload: unknown): this {
    this.emitted.push({ event, payload });
    return this;
  }

  public on(event: string, listener: (...args: any[]) => void): this {
    this.emitter.on(event, listener);
    return this;
  }

  public queueAck(response: unknown): void {
    this.acks.push({ error: null, response });
  }

  public timeout(timeoutMs: number): ReturnType<ConnectSocket["timeout"]> {
    return {
      emit: <T>(
        event: string,
        payload: unknown,
        callback: (error: Error | null, response: T) => void
      ) => {
        this.emitted.push({ event, payload, timeoutMs });
        const ack = this.acks.shift();
        if (!ack) {
          throw new Error("Unexpected timeout emit without queued ack");
        }
        callback(ack.error, ack.response as T);
        return this;
      }
    };
  }

  public triggerConnect(): void {
    this.connected = true;
    this.emitter.emit("connect");
  }

  public triggerDisconnect(): void {
    this.connected = false;
    this.emitter.emit("disconnect");
  }

  public triggerRpc(
    request: RelayRpcRequest,
    ack: (response: RelayRpcResponse) => void
  ): void {
    this.emitter.emit("rpc:request", request, ack);
  }
}

function createDeps(socket: FakeSocket, runtime: FakeRuntime) {
  const clearedIntervals: unknown[] = [];
  const intervals: Array<{ ms: number }> = [];
  const ioCalls: Array<{
    options: Parameters<NonNullable<ConnectRuntimeDependencies["io"]>>[1];
    uri: string;
  }> = [];
  const lines: string[] = [];
  const sections: Array<[string, string]> = [];
  const sleeps: number[] = [];
  const timer = { timer: true } as unknown as NodeJS.Timeout;

  const dependencies: ConnectRuntimeDependencies = {
    activeSessionCount: () => 2,
    clearInterval: ((value: NodeJS.Timeout) => {
      clearedIntervals.push(value);
    }) as typeof clearInterval,
    codexVersion: async () => ({ available: true, version: "codex 0.1.0" }),
    createAgentRunId: () => "agent_run_1",
    createLocalAgentRuntime: () => runtime,
    io: (uri, options) => {
      ioCalls.push({ uri, options });
      return socket;
    },
    now: () => 100,
    printLine: (line) => {
      lines.push(line ?? "");
    },
    printSection: (title, body) => {
      sections.push([title, body ?? ""]);
    },
    readOrCreateDeviceIdentity: async () => identity,
    setInterval: ((_callback: () => void, ms: number) => {
      intervals.push({ ms });
      return timer;
    }) as typeof setInterval,
    sleep: async (ms) => {
      sleeps.push(ms);
    }
  };

  return {
    clearedIntervals,
    dependencies,
    intervals,
    ioCalls,
    lines,
    sections,
    sleeps
  };
}

interface FakeRuntime extends LocalAgentRuntime {
  close: Mock<() => Promise<void>>;
  emitEvent(event: LocalEvent): void;
  invoke: Mock<(method: RelayMethod, params?: unknown) => Promise<unknown>>;
}

function createFakeRuntime(): FakeRuntime {
  const emitter = new EventEmitter();
  const runtime = {
    approvalBridge: {},
    close: vi.fn(async () => {}),
    directories: vi.fn(async () => ({ entries: [] })),
    emitEvent: (event: LocalEvent) => {
      emitter.emit("event", event);
    },
    eventStore: {
      after: vi.fn(() => []),
      all: vi.fn(() => []),
      append: vi.fn(),
      lastSeq: () => 1,
      off: (event: string, listener: (...args: any[]) => void) => {
        emitter.off(event, listener);
        return runtime.eventStore;
      },
      on: (event: string, listener: (...args: any[]) => void) => {
        emitter.on(event, listener);
        return runtime.eventStore;
      }
    },
    health: vi.fn(async () => ({
      ok: true,
      version: "0.1.0",
      pid: 1,
      uptimeSeconds: 1,
      host: "relay",
      port: 0
    })),
    invoke: vi.fn(async () => ({})),
    replayEvents: vi.fn(() => ({ events: [] })),
    sessionManager: {
      summaries: () => []
    },
  } as unknown as FakeRuntime;
  return runtime;
}

async function flushAsync(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}
