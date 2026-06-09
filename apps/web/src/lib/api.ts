import type {
  AgentConnection,
  LocalApprovalDecision,
  LocalCodexHistoryDetailResponse,
  LocalCodexHistoryPageResponse,
  LocalCodexHistoryResponse,
  LocalLoadedThreadsResponse,
  LocalDirectoryListResponse,
  LocalEvent,
  LocalHealthResponse,
  LocalPermissionMode,
  LocalReasoningEffort,
  LocalResumeSessionResponse,
  LocalSendMessageInput,
  LocalStartSessionInput,
  LocalSessionSummary,
  SidebarPrefsResponse,
  RelayDeviceRecord,
  RelayDevicesResponse
} from "./types";

export type { AgentConnection };

export async function agentFetch<T>(
  connection: AgentConnection,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const url = resolveAgentUrl(connection, path);

  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...relayAuthHeaders(connection),
      ...(init.headers ?? {})
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `${response.status} ${response.statusText}`);
  }

  return (await response.json()) as T;
}

export async function listRelayDevices(
  relayUrl: string,
  accessToken: string
): Promise<RelayDeviceRecord[]> {
  const url = new URL("/api/devices", relayUrl);
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `${response.status} ${response.statusText}`);
  }
  const payload = (await response.json()) as RelayDevicesResponse;
  return payload.devices;
}

export async function getRelaySidebarPrefs(
  relayUrl: string,
  accessToken: string,
  deviceId: string
): Promise<SidebarPrefsResponse> {
  const url = new URL(`/api/devices/${encodeURIComponent(deviceId)}/sidebar-prefs`, relayUrl);
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `${response.status} ${response.statusText}`);
  }
  return (await response.json()) as SidebarPrefsResponse;
}

export async function updateRelaySidebarPrefs(
  relayUrl: string,
  accessToken: string,
  deviceId: string,
  prefs: SidebarPrefsResponse
): Promise<SidebarPrefsResponse> {
  const url = new URL(`/api/devices/${encodeURIComponent(deviceId)}/sidebar-prefs`, relayUrl);
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(prefs)
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `${response.status} ${response.statusText}`);
  }
  return (await response.json()) as SidebarPrefsResponse;
}

export function health(connection: AgentConnection): Promise<LocalHealthResponse> {
  return agentFetch<LocalHealthResponse>(connection, "/api/health");
}

export function replayEvents(
  connection: AgentConnection,
  after = 0
): Promise<{ events: LocalEvent[] }> {
  return agentFetch(connection, `/api/events?after=${after}`);
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

export function getLoadedCodexThreads(
  connection: AgentConnection
): Promise<LocalLoadedThreadsResponse> {
  return agentFetch(connection, "/api/codex-history/loaded");
}

export function getCodexHistoryDetail(
  connection: AgentConnection,
  input: { id: string; cwd?: string }
): Promise<LocalCodexHistoryDetailResponse> {
  const query = new URLSearchParams({
    id: input.id
  });
  if (input.cwd) {
    query.set("cwd", input.cwd);
  }
  return agentFetch(connection, `/api/codex-history/detail?${query.toString()}`);
}

export function getCodexHistoryTurns(
  connection: AgentConnection,
  input: {
    id: string;
    cwd?: string;
    cursor?: string | null;
    limit?: number;
  }
): Promise<LocalCodexHistoryPageResponse> {
  const query = new URLSearchParams({
    id: input.id
  });
  if (input.cwd) {
    query.set("cwd", input.cwd);
  }
  if (input.cursor) {
    query.set("cursor", input.cursor);
  }
  if (typeof input.limit === "number" && Number.isFinite(input.limit)) {
    query.set("limit", String(Math.floor(input.limit)));
  }
  query.set("sortDirection", "desc");
  query.set("itemsView", "summary");
  return agentFetch(connection, `/api/codex-history/turns?${query.toString()}`);
}

export function archiveCodexHistory(
  connection: AgentConnection,
  input: { id: string }
): Promise<Record<string, never>> {
  return agentFetch(connection, "/api/codex-history/archive", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function resumeCodexHistory(
  connection: AgentConnection,
  input: {
    id: string;
    cwd?: string;
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

export function createSession(
  connection: AgentConnection,
  input: LocalStartSessionInput
): Promise<{ session: LocalSessionSummary }> {
  return agentFetch(connection, "/api/sessions", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function sendSessionMessage(
  connection: AgentConnection,
  sessionId: string,
  input: LocalSendMessageInput
): Promise<{ mode: "turn-start" | "steer"; turnId: string }> {
  return agentFetch(connection, `/api/sessions/${sessionId}/messages`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function interruptSessionTurn(
  connection: AgentConnection,
  sessionId: string,
  turnId: string
): Promise<{ turnId: string }> {
  return agentFetch(connection, `/api/sessions/${sessionId}/turns/${turnId}/interrupt`, {
    method: "POST",
    body: "{}"
  });
}

export function resolveApproval(
  connection: AgentConnection,
  approvalId: string,
  decision: LocalApprovalDecision
): Promise<unknown> {
  return agentFetch(connection, `/api/approvals/${approvalId}/decision`, {
    method: "POST",
    body: JSON.stringify({ decision })
  });
}

export function isDirectConnection(
  connection: AgentConnection
): connection is Extract<AgentConnection, { mode: "direct" }> {
  return connection.mode === "direct";
}

export function resolveAgentUrl(connection: AgentConnection, path: string): URL {
  if (isDirectConnection(connection)) {
    const url = new URL(path, connection.agentUrl);
    url.searchParams.set("token", connection.token);
    return url;
  }

  const base = new URL(path, connection.relayUrl);
  const prefix = `/api/relay/devices/${encodeURIComponent(connection.deviceId)}`;
  if (base.pathname === "/api/health") {
    base.pathname = `${prefix}/health`;
    return base;
  }
  if (base.pathname === "/api/events") {
    base.pathname = `${prefix}/events`;
    return base;
  }
  if (base.pathname === "/api/directories") {
    base.pathname = `${prefix}/directories`;
    return base;
  }
  if (base.pathname === "/api/codex-history") {
    base.pathname = `${prefix}/codex-history`;
    return base;
  }
  if (base.pathname === "/api/codex-history/loaded") {
    base.pathname = `${prefix}/codex-history/loaded`;
    return base;
  }
  if (base.pathname === "/api/codex-history/detail") {
    base.pathname = `${prefix}/codex-history/detail`;
    return base;
  }
  if (base.pathname === "/api/codex-history/turns") {
    base.pathname = `${prefix}/codex-history/turns`;
    return base;
  }
  if (base.pathname === "/api/codex-history/archive") {
    base.pathname = `${prefix}/codex-history/archive`;
    return base;
  }
  if (base.pathname === "/api/codex-history/resume") {
    base.pathname = `${prefix}/codex-history/resume`;
    return base;
  }
  if (base.pathname === "/api/sessions") {
    base.pathname = `${prefix}/sessions`;
    return base;
  }
  if (base.pathname.startsWith("/api/sessions/")) {
    base.pathname = `${prefix}${base.pathname.slice("/api".length)}`;
    return base;
  }
  if (base.pathname.startsWith("/api/approvals/")) {
    base.pathname = `${prefix}${base.pathname.slice("/api".length)}`;
    return base;
  }
  return base;
}

function relayAuthHeaders(connection: AgentConnection): Record<string, string> {
  if (isDirectConnection(connection)) {
    return {};
  }
  return {
    Authorization: `Bearer ${connection.sessionToken}`
  };
}
