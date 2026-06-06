import type {
  LocalCodexHistoryResponse,
  LocalDirectoryListResponse,
  LocalHealthResponse,
  LocalSessionSummary
} from "./types";

export interface AgentConnection {
  agentUrl: string;
  token: string;
}

export async function agentFetch<T>(
  connection: AgentConnection,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const url = new URL(path, connection.agentUrl);
  url.searchParams.set("token", connection.token);

  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {})
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `${response.status} ${response.statusText}`);
  }

  return (await response.json()) as T;
}

export function health(connection: AgentConnection): Promise<LocalHealthResponse> {
  return agentFetch<LocalHealthResponse>(connection, "/api/health");
}

export function listSessions(
  connection: AgentConnection
): Promise<{ sessions: LocalSessionSummary[] }> {
  return agentFetch(connection, "/api/sessions");
}

export function listDirectories(
  connection: AgentConnection,
  path?: string
): Promise<LocalDirectoryListResponse> {
  const query = path ? `?path=${encodeURIComponent(path)}` : "";
  return agentFetch(connection, `/api/directories${query}`);
}

export function listCodexHistory(
  connection: AgentConnection,
  limit = 80
): Promise<LocalCodexHistoryResponse> {
  return agentFetch(connection, `/api/codex-history?limit=${limit}`);
}
