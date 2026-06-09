import { io, type Socket } from "socket.io-client";
import { RelayNamespace, RelaySocketPath } from "@codexnext/protocol";
import type { AgentConnection, DeviceEventPayload, LocalEvent } from "./types";
import { isDirectConnection, replayEvents } from "./api";

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
  if (!isDirectConnection(input.connection)) {
    return openManagedRelayStream({
      ...input,
      connection: input.connection
    });
  }
  const directConnection = input.connection;

  let source: EventSource | null = null;
  let reconnectTimer: number | null = null;
  let lastSeq = input.after;
  let closed = false;
  let reconnectAttempt = 0;

  const clearReconnectTimer = () => {
    if (reconnectTimer !== null) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const open = () => {
    if (closed) {
      return;
    }

    input.onStatus(reconnectAttempt > 0 ? "reconnecting" : "connecting");
    const url = new URL("/api/events/stream", directConnection.agentUrl);
    url.searchParams.set("token", directConnection.token);
    url.searchParams.set("after", String(lastSeq));

    source = new EventSource(url);
    source.onopen = () => {
      reconnectAttempt = 0;
      input.onStatus("connected");
    };
    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as LocalEvent;
      if (typeof event.seq === "number" && event.seq > lastSeq) {
        lastSeq = event.seq;
      }
      input.onEvent(event);
    };
    source.onerror = () => {
      if (closed) {
        return;
      }
      source?.close();
      source = null;
      void reconnect();
    };
  };

  const reconnect = async () => {
    if (closed) {
      return;
    }
    input.onStatus("reconnecting");
    try {
      const replay = await replayEvents(directConnection, lastSeq);
      if (replay.events.length > 0) {
        const replayTail = replay.events.at(-1);
        if (replayTail && replayTail.seq > lastSeq) {
          lastSeq = replayTail.seq;
        }
        input.onReplay(replay.events);
      }
    } catch (error) {
      input.onStatus("error");
      input.onError(error);
    }

    const delay = Math.min(5_000, 350 * 2 ** reconnectAttempt);
    reconnectAttempt += 1;
    clearReconnectTimer();
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      open();
    }, delay);
  };

  open();

  return {
    close() {
      closed = true;
      clearReconnectTimer();
      source?.close();
      source = null;
      input.onStatus("closed");
    }
  };
}

function openManagedRelayStream(input: {
  connection: Extract<AgentConnection, { mode: "relay" }>;
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
