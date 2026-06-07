import type { AgentConnection } from "./api";
import { replayEvents } from "./api";
import type { LocalEvent } from "./types";

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
    const url = new URL("/api/events/stream", input.connection.agentUrl);
    url.searchParams.set("token", input.connection.token);
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
      const replay = await replayEvents(input.connection, lastSeq);
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
