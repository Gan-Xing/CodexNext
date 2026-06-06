import type { AgentConnection } from "./api";
import type { LocalEvent } from "./types";

export function openEventStream(
  connection: AgentConnection,
  after: number,
  onEvent: (event: LocalEvent) => void,
  onError: (error: Event) => void
): EventSource {
  const url = new URL("/api/events/stream", connection.agentUrl);
  url.searchParams.set("token", connection.token);
  url.searchParams.set("after", String(after));

  const source = new EventSource(url);
  source.onmessage = (message) => {
    onEvent(JSON.parse(message.data) as LocalEvent);
  };
  source.onerror = onError;
  return source;
}

