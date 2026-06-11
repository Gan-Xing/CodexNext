import { afterEach, describe, expect, it, vi } from "vitest";
import { openManagedEventStream } from "./event-stream";
import type { DeviceEventPayload, LocalEvent } from "./types";

const socketMock = vi.hoisted(() => {
  class FakeSocket {
    public auth: unknown;
    public readonly close = vi.fn();
    public readonly io = {
      on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
        const existing = this.managerHandlers.get(event) ?? [];
        existing.push(listener);
        this.managerHandlers.set(event, existing);
        return this.io;
      })
    };
    private readonly handlers = new Map<string, Array<(...args: unknown[]) => void>>();
    private readonly managerHandlers = new Map<string, Array<(...args: unknown[]) => void>>();

    public constructor(
      public readonly url: string,
      public readonly options: { auth?: unknown }
    ) {
      this.auth = options.auth;
    }

    public on(event: string, listener: (...args: unknown[]) => void): this {
      const existing = this.handlers.get(event) ?? [];
      existing.push(listener);
      this.handlers.set(event, existing);
      return this;
    }

    public emitIncoming(event: string, ...args: unknown[]): void {
      for (const listener of this.handlers.get(event) ?? []) {
        listener(...args);
      }
    }

    public emitManager(event: string, ...args: unknown[]): void {
      for (const listener of this.managerHandlers.get(event) ?? []) {
        listener(...args);
      }
    }
  }

  const state: { latest: FakeSocket | null } = { latest: null };
  const io = vi.fn((url: string, options: { auth?: unknown }) => {
    const socket = new FakeSocket(url, options);
    state.latest = socket;
    return socket;
  });

  return { io, state };
});

vi.mock("socket.io-client", () => ({
  io: socketMock.io
}));

function event(seq: number): LocalEvent {
  return {
    id: `evt_${seq}`,
    seq,
    ts: seq,
    type: "chat.user"
  };
}

function payload(deviceId: string, seq: number): DeviceEventPayload {
  return {
    deviceId,
    event: event(seq)
  };
}

afterEach(() => {
  socketMock.io.mockClear();
  socketMock.state.latest = null;
});

describe("openManagedEventStream", () => {
  it("uses replay/live event sequencing to refresh reconnect auth", () => {
    const replays: LocalEvent[][] = [];
    const liveEvents: LocalEvent[] = [];
    const statuses: string[] = [];
    const errors: unknown[] = [];

    const stream = openManagedEventStream({
      connection: {
        mode: "relay",
        relayUrl: "http://relay.local",
        sessionToken: "relay-session-token",
        deviceId: "device_1"
      },
      after: 1,
      onReplay: (events) => replays.push(events),
      onEvent: (incoming) => liveEvents.push(incoming),
      onStatus: (status) => statuses.push(status),
      onError: (error) => errors.push(error)
    });

    const socket = socketMock.state.latest;
    expect(socket).not.toBeNull();
    expect(socketMock.io).toHaveBeenCalledWith(
      "http://relay.local/user",
      expect.objectContaining({
        auth: {
          clientType: "user",
          sessionToken: "relay-session-token",
          lastSeqByDevice: {
            device_1: 1
          }
        }
      })
    );

    socket?.emitIncoming("device:replay", [
      payload("other_device", 9),
      payload("device_1", 3),
      payload("device_1", 2),
      payload("device_1", 1)
    ]);
    expect(replays.map((batch) => batch.map((item) => item.seq))).toEqual([[2, 3]]);

    socket?.emitManager("reconnect_attempt");
    expect(socket?.auth).toEqual({
      clientType: "user",
      sessionToken: "relay-session-token",
      lastSeqByDevice: {
        device_1: 3
      }
    });

    socket?.emitIncoming("device:event", payload("other_device", 10));
    socket?.emitIncoming("device:event", payload("device_1", 3));
    socket?.emitIncoming("device:event", payload("device_1", 4));
    expect(liveEvents.map((item) => item.seq)).toEqual([4]);

    socket?.emitIncoming("device:upsert");
    expect(socket?.auth).toEqual({
      clientType: "user",
      sessionToken: "relay-session-token",
      lastSeqByDevice: {
        device_1: 4
      }
    });
    expect(statuses).toEqual(["connecting"]);
    expect(errors).toEqual([]);

    stream.close();
    expect(socket?.close).toHaveBeenCalled();
    expect(statuses).toEqual(["connecting", "closed"]);
  });

  it("ignores stale socket activity after close while replacement streams keep current auth", () => {
    const firstStatuses: string[] = [];
    const firstEvents: LocalEvent[] = [];
    const firstErrors: unknown[] = [];

    const firstStream = openManagedEventStream({
      connection: {
        mode: "relay",
        relayUrl: "http://relay.local",
        sessionToken: "relay-session-token-1",
        deviceId: "device_1"
      },
      after: 0,
      onReplay: () => undefined,
      onEvent: (incoming) => firstEvents.push(incoming),
      onStatus: (status) => firstStatuses.push(status),
      onError: (error) => firstErrors.push(error)
    });
    const firstSocket = socketMock.state.latest;
    firstStream.close();

    firstSocket?.emitIncoming("connect");
    firstSocket?.emitIncoming("disconnect");
    firstSocket?.emitIncoming("connect_error", new Error("401 Unauthorized"));
    firstSocket?.emitIncoming("device:event", payload("device_1", 1));
    firstSocket?.emitManager("reconnect_attempt");

    expect(firstStatuses).toEqual(["connecting", "closed"]);
    expect(firstEvents).toEqual([]);
    expect(firstErrors).toEqual([]);
    expect(firstSocket?.auth).toEqual({
      clientType: "user",
      sessionToken: "relay-session-token-1",
      lastSeqByDevice: {
        device_1: 0
      }
    });

    const secondStatuses: string[] = [];
    const secondEvents: LocalEvent[] = [];
    const secondStream = openManagedEventStream({
      connection: {
        mode: "relay",
        relayUrl: "http://relay.local",
        sessionToken: "relay-session-token-2",
        deviceId: "device_2"
      },
      after: 7,
      onReplay: () => undefined,
      onEvent: (incoming) => secondEvents.push(incoming),
      onStatus: (status) => secondStatuses.push(status),
      onError: () => undefined
    });
    const secondSocket = socketMock.state.latest;

    secondSocket?.emitIncoming("device:event", payload("device_2", 8));
    secondSocket?.emitManager("reconnect_attempt");

    expect(secondEvents.map((item) => item.seq)).toEqual([8]);
    expect(secondSocket?.auth).toEqual({
      clientType: "user",
      sessionToken: "relay-session-token-2",
      lastSeqByDevice: {
        device_2: 8
      }
    });
    expect(secondStatuses).toEqual(["connecting"]);

    secondStream.close();
  });
});
