import type {
  AgentConnection,
  LocalApprovalDecision,
  LocalCodexHistoryArchiveResponse,
  LocalCreateSessionResponse,
  LocalCodexHistoryDetailResponse,
  LocalCodexHistoryPageResponse,
  LocalCodexHistoryResponse,
  LocalLoadedThreadsResponse,
  LocalDirectoryListResponse,
  LocalEvent,
  LocalHealthResponse,
  LocalInterruptResponse,
  LocalPermissionMode,
  LocalReasoningEffort,
  LocalResumeSessionResponse,
  LocalSendMessageResponse,
  LocalSendMessageInput,
  LocalStartSessionInput,
  LocalSessionsResponse,
  SidebarPrefsResponse,
  RelayDeviceRecord
} from "./types";
import {
  buildApprovalDecisionBody,
  buildApprovalDecisionUrl,
  buildCodexHistoryArchiveUrl,
  buildCodexHistoryDetailUrl,
  buildCodexHistoryResumeUrl,
  buildCodexHistoryTurnsUrl,
  buildCodexHistoryUrl,
  buildDeviceHealthUrl,
  buildDeviceEventReplayUrl,
  buildDeviceSessionsUrl,
  buildDeviceSidebarPrefsUrl,
  buildRelayAuthorizationHeaders,
  buildRelayDevicesUrl,
  buildSessionMessageUrl,
  buildTurnInterruptUrl,
  buildLoadedCodexHistoryUrl,
  parseCodexHistoryArchiveResponse,
  parseCodexHistoryDetailResponse,
  parseCodexHistoryPageResponse,
  parseCodexHistoryResponse,
  parseLoadedCodexHistoryResponse,
  parseLocalCreateSessionResponse,
  parseLocalEventReplayResponse,
  parseLocalHealthResponse,
  parseLocalInterruptResponse,
  parseResumeSessionResponse,
  parseLocalSendMessageResponse,
  parseLocalSessionsResponse,
  parseRelayDevicesResponse,
  parseSidebarPrefsResponse
} from "@codexnext/relay-client";
import {
  summarizeRequestBody,
  traceDurationMs,
  webDevTrace,
  webErrorSummary
} from "./dev-trace";

export type { AgentConnection };

export async function agentFetch<T>(
  connection: AgentConnection,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  return (await agentFetchJson(connection, path, init)) as T;
}

async function agentFetchJson(
  connection: AgentConnection,
  path: string,
  init: RequestInit = {}
): Promise<unknown> {
  const url = resolveAgentUrl(connection, path);
  const startedAt = Date.now();
  const method = init.method ?? "GET";
  const requestTrace = {
    method,
    path,
    urlPath: url.pathname,
    deviceId: connection.deviceId,
    ...summarizeRequestBody(init.body)
  };

  webDevTrace("agent.fetch.start", requestTrace);

  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...buildRelayAuthorizationHeaders(connection.sessionToken),
        ...(init.headers ?? {})
      }
    });
  } catch (error) {
    webDevTrace("agent.fetch.error", {
      ...requestTrace,
      durationMs: traceDurationMs(startedAt),
      ...webErrorSummary(error)
    });
    throw error;
  }

  if (!response.ok) {
    const text = await response.text();
    webDevTrace("agent.fetch.error", {
      ...requestTrace,
      status: response.status,
      durationMs: traceDurationMs(startedAt),
      errorMessageLength: text.length
    });
    throw new Error(text || `${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  webDevTrace("agent.fetch.end", {
    ...requestTrace,
    status: response.status,
    durationMs: traceDurationMs(startedAt)
  });
  return payload;
}

export async function listRelayDevices(
  relayUrl: string,
  accessToken: string
): Promise<RelayDeviceRecord[]> {
  const url = buildRelayDevicesUrl(relayUrl);
  const response = await fetch(url, {
    headers: buildRelayAuthorizationHeaders(accessToken)
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `${response.status} ${response.statusText}`);
  }
  return parseRelayDevicesResponse(await response.json());
}

export async function getRelaySidebarPrefs(
  relayUrl: string,
  accessToken: string,
  deviceId: string
): Promise<SidebarPrefsResponse> {
  const url = buildDeviceSidebarPrefsUrl(relayUrl, deviceId);
  const response = await fetch(url, {
    headers: buildRelayAuthorizationHeaders(accessToken)
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `${response.status} ${response.statusText}`);
  }
  return parseSidebarPrefsResponse(await response.json());
}

export async function updateRelaySidebarPrefs(
  relayUrl: string,
  accessToken: string,
  deviceId: string,
  prefs: SidebarPrefsResponse
): Promise<SidebarPrefsResponse> {
  const url = buildDeviceSidebarPrefsUrl(relayUrl, deviceId);
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      ...buildRelayAuthorizationHeaders(accessToken),
      "Content-Type": "application/json"
    },
    body: JSON.stringify(prefs)
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `${response.status} ${response.statusText}`);
  }
  return parseSidebarPrefsResponse(await response.json());
}

export function health(connection: AgentConnection): Promise<LocalHealthResponse> {
  return agentFetchJson(connection, "/api/health").then(parseLocalHealthResponse);
}

export function replayEvents(
  connection: AgentConnection,
  after = 0
): Promise<{ events: LocalEvent[] }> {
  return agentFetchJson(connection, `/api/events?after=${after}`).then((payload) => ({
    events: parseLocalEventReplayResponse(payload, after)
  }));
}

export function listSessions(
  connection: AgentConnection
): Promise<LocalSessionsResponse> {
  return agentFetchJson(connection, "/api/sessions").then(parseLocalSessionsResponse);
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
  return agentFetchJson(
    connection,
    pathAndSearch(buildCodexHistoryUrl(connection, limit))
  ).then(parseCodexHistoryResponse);
}

export function getLoadedCodexThreads(
  connection: AgentConnection
): Promise<LocalLoadedThreadsResponse> {
  return agentFetchJson(
    connection,
    pathAndSearch(buildLoadedCodexHistoryUrl(connection))
  ).then(parseLoadedCodexHistoryResponse);
}

export function getCodexHistoryDetail(
  connection: AgentConnection,
  input: { id: string; cwd?: string }
): Promise<LocalCodexHistoryDetailResponse> {
  return agentFetchJson(
    connection,
    pathAndSearch(buildCodexHistoryDetailUrl(connection, input))
  ).then(parseCodexHistoryDetailResponse);
}

export function getCodexHistoryTurns(
  connection: AgentConnection,
  input: {
    cacheMode?: "bypass";
    id: string;
    cwd?: string;
    cursor?: string | null;
    limit?: number;
  }
): Promise<LocalCodexHistoryPageResponse> {
  return agentFetchJson(
    connection,
    pathAndSearch(buildCodexHistoryTurnsUrl(connection, input))
  ).then(parseCodexHistoryPageResponse);
}

export function archiveCodexHistory(
  connection: AgentConnection,
  input: { id: string }
): Promise<LocalCodexHistoryArchiveResponse> {
  return agentFetchJson(connection, pathAndSearch(buildCodexHistoryArchiveUrl(connection)), {
    method: "POST",
    body: JSON.stringify(input)
  }).then(parseCodexHistoryArchiveResponse);
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
  return agentFetchJson(connection, pathAndSearch(buildCodexHistoryResumeUrl(connection)), {
    method: "POST",
    body: JSON.stringify(input)
  }).then(parseResumeSessionResponse);
}

export function createSession(
  connection: AgentConnection,
  input: LocalStartSessionInput
): Promise<LocalCreateSessionResponse> {
  return agentFetchJson(connection, "/api/sessions", {
    method: "POST",
    body: JSON.stringify(input)
  }).then(parseLocalCreateSessionResponse);
}

export function sendSessionMessage(
  connection: AgentConnection,
  sessionId: string,
  input: LocalSendMessageInput
): Promise<LocalSendMessageResponse> {
  return agentFetchJson(connection, `/api/sessions/${sessionId}/messages`, {
    method: "POST",
    body: JSON.stringify(input)
  }).then(parseLocalSendMessageResponse);
}

export function interruptSessionTurn(
  connection: AgentConnection,
  sessionId: string,
  turnId: string
): Promise<LocalInterruptResponse> {
  return agentFetchJson(connection, `/api/sessions/${sessionId}/turns/${turnId}/interrupt`, {
    method: "POST",
    body: "{}"
  }).then(parseLocalInterruptResponse);
}

export function resolveApproval(
  connection: AgentConnection,
  approvalId: string,
  decision: LocalApprovalDecision
): Promise<unknown> {
  return agentFetch(connection, buildApprovalDecisionUrl(connection, approvalId).pathname, {
    method: "POST",
    body: buildApprovalDecisionBody(decision)
  });
}

export function resolveAgentUrl(connection: AgentConnection, path: string): URL {
  const base = new URL(path, connection.relayUrl);
  const prefix = `/api/relay/devices/${encodeURIComponent(connection.deviceId)}`;
  if (base.pathname === "/api/health") {
    return buildDeviceHealthUrl(connection);
  }
  if (base.pathname === "/api/events") {
    return buildDeviceEventReplayUrl(
      connection,
      Number(base.searchParams.get("after") ?? 0)
    );
  }
  if (base.pathname === "/api/directories") {
    base.pathname = `${prefix}/directories`;
    return base;
  }
  if (base.pathname === "/api/codex-history") {
    return buildCodexHistoryUrl(
      connection,
      Number(base.searchParams.get("limit") ?? 80)
    );
  }
  if (base.pathname === "/api/codex-history/loaded") {
    return buildLoadedCodexHistoryUrl(connection);
  }
  if (base.pathname === "/api/codex-history/detail") {
    return buildCodexHistoryDetailUrl(connection, {
      id: base.searchParams.get("id") ?? "",
      ...(base.searchParams.has("cwd")
        ? { cwd: base.searchParams.get("cwd") ?? "" }
        : {})
    });
  }
  if (base.pathname === "/api/codex-history/turns") {
    return buildCodexHistoryTurnsUrl(connection, {
      id: base.searchParams.get("id") ?? "",
      ...(base.searchParams.get("cacheMode") === "bypass"
        ? { cacheMode: "bypass" }
        : {}),
      ...(base.searchParams.has("cwd")
        ? { cwd: base.searchParams.get("cwd") ?? "" }
        : {}),
      ...(base.searchParams.has("cursor")
        ? { cursor: base.searchParams.get("cursor") }
        : {}),
      ...(base.searchParams.has("limit")
        ? { limit: Number(base.searchParams.get("limit")) }
        : {})
    });
  }
  if (base.pathname === "/api/codex-history/archive") {
    return buildCodexHistoryArchiveUrl(connection);
  }
  if (base.pathname === "/api/codex-history/resume") {
    return buildCodexHistoryResumeUrl(connection);
  }
  if (base.pathname === "/api/sessions") {
    return buildDeviceSessionsUrl(connection);
  }
  if (base.pathname.startsWith("/api/sessions/")) {
    const messageMatch = base.pathname.match(/^\/api\/sessions\/(.+)\/messages$/);
    if (messageMatch) {
      return buildSessionMessageUrl(
        connection,
        decodeURIComponent(messageMatch[1] ?? "")
      );
    }
    const interruptMatch = base.pathname.match(
      /^\/api\/sessions\/(.+)\/turns\/(.+)\/interrupt$/
    );
    if (interruptMatch) {
      return buildTurnInterruptUrl(
        connection,
        decodeURIComponent(interruptMatch[1] ?? ""),
        decodeURIComponent(interruptMatch[2] ?? "")
      );
    }
    base.pathname = `${prefix}${base.pathname.slice("/api".length)}`;
    return base;
  }
  if (base.pathname.startsWith("/api/approvals/")) {
    const approvalMatch = base.pathname.match(/^\/api\/approvals\/(.+)\/decision$/);
    if (approvalMatch) {
      return buildApprovalDecisionUrl(
        connection,
        decodeURIComponent(approvalMatch[1] ?? "")
      );
    }
    base.pathname = `${prefix}${base.pathname.slice("/api".length)}`;
    return base;
  }
  return base;
}

function pathAndSearch(url: URL): string {
  return `${url.pathname}${url.search}`;
}
