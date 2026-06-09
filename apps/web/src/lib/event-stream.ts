import { io, type Socket } from "socket.io-client";
import { RelayNamespace, RelaySocketPath } from "@codexnext/protocol";
import type { AgentConnection, DeviceEventPayload, LocalEvent } from "./types";

export interface ManagedEventStream {
  close(): void;
}

export type ManagedEventStreamStatus =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "closed"
  | "error";

export function openManagedEventStream(input: {
  connection: AgentConnection;
  after: number;
  onReplay: (events: LocalEvent[]) => void;
  onEvent: (event: LocalEvent) => void;
  onStatus: (status: ManagedEventStreamStatus) => void;
  onError: (error: unknown) => void;
}): ManagedEventStream {
  let closed = false;
  let lastSeq = input.after;

  const socket: Socket = io(`${input.connection.relayUrl}${RelayNamespace.User}`, {
    path: RelaySocketPath,
    reconnection: true,
    reconnectionDelay: 350,
    reconnectionDelayMax: 5_000,
    auth: {
      clientType: "user",
      sessionToken: input.connection.sessionToken,
      lastSeqByDevice: {
        [input.connection.deviceId]: lastSeq
      }
    }
  });

  const refreshAuth = () => {
    socket.auth = {
      clientType: "user",
      sessionToken: input.connection.sessionToken,
      lastSeqByDevice: {
        [input.connection.deviceId]: lastSeq
      }
    };
  };

  input.onStatus("connecting");

  socket.on("connect", () => {
    input.onStatus("connected");
  });

  socket.on("disconnect", () => {
    if (!closed) {
      input.onStatus("reconnecting");
    }
  });

  socket.io.on("reconnect_attempt", refreshAuth);
  socket.on("connect_error", (error) => {
    if (closed) {
      return;
    }
    input.onStatus("error");
    input.onError(error);
  });

  socket.on("device:replay", (payload: DeviceEventPayload[]) => {
    const events = payload
      .filter((item) => item.deviceId === input.connection.deviceId)
      .map((item) => item.event)
      .sort((left, right) => left.seq - right.seq);
    if (events.length === 0) {
      return;
    }
    const replayTail = events.at(-1);
    if (replayTail && replayTail.seq > lastSeq) {
      lastSeq = replayTail.seq;
    }
    input.onReplay(events);
  });

  socket.on("device:event", (payload: DeviceEventPayload) => {
    if (payload.deviceId !== input.connection.deviceId) {
      return;
    }
    if (payload.event.seq > lastSeq) {
      lastSeq = payload.event.seq;
    }
    input.onEvent(payload.event);
  });

  socket.on("device:upsert", refreshAuth);
  socket.on("device:presence", refreshAuth);

  return {
    close() {
      closed = true;
      socket.close();
      input.onStatus("closed");
    }
  };
}
