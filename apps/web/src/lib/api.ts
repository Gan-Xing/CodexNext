import type {
  LocalCodexHistoryDetailResponse,
  LocalCodexHistoryResponse,
  LocalDirectoryListResponse,
  LocalHealthResponse,
  LocalPermissionMode,
  LocalReasoningEffort,
  LocalResumeSessionResponse,
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

export function getCodexHistoryDetail(
  connection: AgentConnection,
  input: { id: string; cwd: string; filePath?: string }
): Promise<LocalCodexHistoryDetailResponse> {
  const query = new URLSearchParams({
    id: input.id,
    cwd: input.cwd
  });
  if (input.filePath) {
    query.set("filePath", input.filePath);
  }
  return agentFetch(connection, `/api/codex-history/detail?${query.toString()}`);
}

export function resumeCodexHistory(
  connection: AgentConnection,
  input: {
    id: string;
    cwd: string;
    filePath?: string;
    model?: string | null;
    permissionMode: LocalPermissionMode;
    reasoningEffort?: LocalReasoningEffort | null;
  }
): Promise<LocalResumeSessionResponse> {
  return agentFetch(connection, "/api/codex-history/resume", {
    method: "POST",
    body: JSON.stringify(input)
  });
}
