import { io, type Socket } from "socket.io-client";
import { RelayNamespace, RelaySocketPath } from "@codexnext/protocol";
import {
  acceptLiveEvent,
  buildUserRelayAuth,
  filterReplayEvents,
  nextSeqAfterEvents
} from "@codexnext/relay-client";
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
    auth: buildUserRelayAuth(input.connection, lastSeq)
  });

  const refreshAuth = () => {
    if (closed) {
      return;
    }
    socket.auth = buildUserRelayAuth(input.connection, lastSeq);
  };

  input.onStatus("connecting");

  socket.on("connect", () => {
    if (closed) {
      return;
    }
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
    if (closed) {
      return;
    }
    const events = filterReplayEvents(payload, input.connection.deviceId, lastSeq);
    if (events.length === 0) {
      return;
    }
    lastSeq = nextSeqAfterEvents(lastSeq, events);
    input.onReplay(events);
  });

  socket.on("device:event", (payload: DeviceEventPayload) => {
    if (closed) {
      return;
    }
    const event = acceptLiveEvent(payload, input.connection.deviceId, lastSeq);
    if (!event) {
      return;
    }
    lastSeq = nextSeqAfterEvents(lastSeq, [event]);
    input.onEvent(event);
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
