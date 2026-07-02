import type {
  DeviceEventPayload,
  LocalApprovalDecision,
  LocalCodexHistoryArchiveResponse,
  LocalCodexHistoryDetailResponse,
  LocalCodexHistoryPageResponse,
  LocalCodexHistoryResponse,
  LocalCreateSessionResponse,
  LocalEvent,
  LocalHealthResponse,
  LocalInterruptResponse,
  LocalLoadedThreadsResponse,
  LocalProviderCatalogResponse,
  LocalQueueActionResponse,
  LocalResumeSessionResponse,
  LocalSendMessageResponse,
  LocalSessionsResponse,
  LocalUpdateSessionRuntimeResponse,
  RelayDeviceRecord,
  SidebarPrefsResponse,
  RelayUserAuth
} from "@codexnext/protocol";
import {
  LocalCodexHistoryArchiveResponseSchema,
  LocalCodexHistoryDetailResponseSchema,
  LocalCodexHistoryPageResponseSchema,
  LocalCodexHistoryResponseSchema,
  LocalCreateSessionResponseSchema,
  LocalEventReplayResponseSchema,
  LocalHealthResponseSchema,
  LocalInterruptResponseSchema,
  LocalLoadedThreadsResponseSchema,
  LocalProviderCatalogResponseSchema,
  LocalQueueActionResponseSchema,
  LocalResumeSessionResponseSchema,
  LocalSendMessageResponseSchema,
  LocalSessionsResponseSchema,
  LocalUpdateSessionRuntimeResponseSchema,
  RelayDevicesResponseSchema,
  SidebarPrefsResponseSchema
} from "@codexnext/protocol";

export interface RelayClientConnection {
  deviceId: string;
  relayUrl: string;
  sessionToken: string;
}

export function normalizeRelayUrl(value: string): string {
  const trimmed = value.trim();
  const url = new URL(trimmed);
  url.search = "";
  url.hash = "";
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}

export function buildUserRelayAuth(
  connection: Pick<RelayClientConnection, "deviceId" | "sessionToken">,
  lastSeq: number
): RelayUserAuth {
  return {
    clientType: "user",
    sessionToken: connection.sessionToken,
    lastSeqByDevice: {
      [connection.deviceId]: normalizeSeq(lastSeq)
    }
  };
}

export function buildRelayAuthorizationHeaders(
  sessionToken: string
): Record<string, string> {
  return {
    Authorization: `Bearer ${sessionToken}`
  };
}

export function buildRelayDevicesUrl(relayUrl: string): URL {
  return new URL("/api/devices", normalizeRelayUrl(relayUrl));
}

export function buildDeviceSidebarPrefsUrl(
  relayUrl: string,
  deviceId: string
): URL {
  return new URL(
    `/api/devices/${encodeURIComponent(deviceId)}/sidebar-prefs`,
    normalizeRelayUrl(relayUrl)
  );
}

export function buildDeviceHealthUrl(
  connection: Pick<RelayClientConnection, "deviceId" | "relayUrl">
): URL {
  return buildRelayDeviceApiUrl(connection, "/health");
}

export function buildDeviceSessionsUrl(
  connection: Pick<RelayClientConnection, "deviceId" | "relayUrl">
): URL {
  return buildRelayDeviceApiUrl(connection, "/sessions");
}

export function buildSessionMessageUrl(
  connection: Pick<RelayClientConnection, "deviceId" | "relayUrl">,
  sessionId: string
): URL {
  return buildRelayDeviceApiUrl(
    connection,
    `/sessions/${encodeURIComponent(sessionId)}/messages`
  );
}

export function buildSessionQueueUrl(
  connection: Pick<RelayClientConnection, "deviceId" | "relayUrl">,
  sessionId: string
): URL {
  return buildRelayDeviceApiUrl(
    connection,
    `/sessions/${encodeURIComponent(sessionId)}/queue`
  );
}

export function buildSessionRuntimeUrl(
  connection: Pick<RelayClientConnection, "deviceId" | "relayUrl">,
  sessionId: string
): URL {
  return buildRelayDeviceApiUrl(
    connection,
    `/sessions/${encodeURIComponent(sessionId)}/runtime`
  );
}

export function buildTurnInterruptUrl(
  connection: Pick<RelayClientConnection, "deviceId" | "relayUrl">,
  sessionId: string,
  turnId: string
): URL {
  return buildRelayDeviceApiUrl(
    connection,
    `/sessions/${encodeURIComponent(sessionId)}/turns/${encodeURIComponent(turnId)}/interrupt`
  );
}

export function buildCodexHistoryUrl(
  connection: Pick<RelayClientConnection, "deviceId" | "relayUrl">,
  limit = 80
): URL {
  const url = buildRelayDeviceApiUrl(connection, "/codex-history");
  url.searchParams.set("limit", String(normalizeSeq(limit)));
  return url;
}

export function buildLoadedCodexHistoryUrl(
  connection: Pick<RelayClientConnection, "deviceId" | "relayUrl">
): URL {
  return buildRelayDeviceApiUrl(connection, "/codex-history/loaded");
}

export function buildCodexHistoryDetailUrl(
  connection: Pick<RelayClientConnection, "deviceId" | "relayUrl">,
  input: { id: string; cwd?: string }
): URL {
  const url = buildRelayDeviceApiUrl(connection, "/codex-history/detail");
  url.searchParams.set("id", input.id);
  if (input.cwd) {
    url.searchParams.set("cwd", input.cwd);
  }
  return url;
}

export function buildCodexHistoryTurnsUrl(
  connection: Pick<RelayClientConnection, "deviceId" | "relayUrl">,
  input: {
    cacheMode?: "bypass";
    id: string;
    cwd?: string;
    cursor?: string | null;
    limit?: number;
  }
): URL {
  const url = buildRelayDeviceApiUrl(connection, "/codex-history/turns");
  url.searchParams.set("id", input.id);
  if (input.cwd) {
    url.searchParams.set("cwd", input.cwd);
  }
  if (input.cursor) {
    url.searchParams.set("cursor", input.cursor);
  }
  if (typeof input.limit === "number" && Number.isFinite(input.limit)) {
    url.searchParams.set("limit", String(normalizeSeq(input.limit)));
  }
  if (input.cacheMode === "bypass") {
    url.searchParams.set("cacheMode", "bypass");
  }
  url.searchParams.set("sortDirection", "desc");
  url.searchParams.set("itemsView", "summary");
  return url;
}

export function buildCodexHistoryArchiveUrl(
  connection: Pick<RelayClientConnection, "deviceId" | "relayUrl">
): URL {
  return buildRelayDeviceApiUrl(connection, "/codex-history/archive");
}

export function buildCodexHistoryResumeUrl(
  connection: Pick<RelayClientConnection, "deviceId" | "relayUrl">
): URL {
  return buildRelayDeviceApiUrl(connection, "/codex-history/resume");
}

export function buildDeviceEventReplayUrl(
  connection: Pick<RelayClientConnection, "deviceId" | "relayUrl">,
  afterSeq = 0
): URL {
  const url = buildRelayDeviceApiUrl(connection, "/events");
  url.searchParams.set("after", String(normalizeSeq(afterSeq)));
  return url;
}

export function buildApprovalDecisionUrl(
  connection: Pick<RelayClientConnection, "deviceId" | "relayUrl">,
  approvalId: string
): URL {
  return buildRelayDeviceApiUrl(
    connection,
    `/approvals/${encodeURIComponent(approvalId)}/decision`
  );
}

export function buildApprovalDecisionBody(
  decision: LocalApprovalDecision
): string {
  return JSON.stringify({ decision });
}

export function filterReplayEvents(
  payload: DeviceEventPayload[],
  deviceId: string,
  afterSeq: number
): LocalEvent[] {
  const minimumSeq = normalizeSeq(afterSeq);
  const bySeq = new Map<number, LocalEvent>();
  for (const item of payload) {
    if (item.deviceId !== deviceId || item.event.seq <= minimumSeq) {
      continue;
    }
    bySeq.set(item.event.seq, item.event);
  }
  return [...bySeq.values()].sort((left, right) => left.seq - right.seq);
}

export function parseRelayDevicesResponse(payload: unknown): RelayDeviceRecord[] {
  return parseRelayResponse(
    RelayDevicesResponseSchema,
    payload,
    "device list"
  ).devices as RelayDeviceRecord[];
}

export function parseSidebarPrefsResponse(payload: unknown): SidebarPrefsResponse {
  return parseRelayResponse(
    SidebarPrefsResponseSchema,
    payload,
    "sidebar preferences"
  );
}

export function parseLocalHealthResponse(payload: unknown): LocalHealthResponse {
  return parseRelayResponse(LocalHealthResponseSchema, payload, "health") as LocalHealthResponse;
}

export function parseLocalProviderCatalogResponse(
  payload: unknown
): LocalProviderCatalogResponse {
  return parseRelayResponse(
    LocalProviderCatalogResponseSchema,
    payload,
    "provider catalog"
  ) as LocalProviderCatalogResponse;
}

export function parseLocalSessionsResponse(payload: unknown): LocalSessionsResponse {
  return parseRelayResponse(LocalSessionsResponseSchema, payload, "sessions") as LocalSessionsResponse;
}

export function parseLocalCreateSessionResponse(
  payload: unknown
): LocalCreateSessionResponse {
  return parseRelayResponse(
    LocalCreateSessionResponseSchema,
    payload,
    "session create"
  ) as LocalCreateSessionResponse;
}

export function parseLocalSendMessageResponse(
  payload: unknown
): LocalSendMessageResponse {
  return parseRelayResponse(
    LocalSendMessageResponseSchema,
    payload,
    "session message"
  ) as LocalSendMessageResponse;
}

export function parseLocalInterruptResponse(
  payload: unknown
): LocalInterruptResponse {
  return parseRelayResponse(
    LocalInterruptResponseSchema,
    payload,
    "turn interrupt"
  ) as LocalInterruptResponse;
}

export function parseLocalQueueActionResponse(
  payload: unknown
): LocalQueueActionResponse {
  return parseRelayResponse(
    LocalQueueActionResponseSchema,
    payload,
    "session queue action"
  ) as LocalQueueActionResponse;
}

export function parseLocalUpdateSessionRuntimeResponse(
  payload: unknown
): LocalUpdateSessionRuntimeResponse {
  return parseRelayResponse(
    LocalUpdateSessionRuntimeResponseSchema,
    payload,
    "session runtime update"
  ) as LocalUpdateSessionRuntimeResponse;
}

export function parseCodexHistoryResponse(
  payload: unknown
): LocalCodexHistoryResponse {
  return parseRelayResponse(
    LocalCodexHistoryResponseSchema,
    payload,
    "codex history"
  ) as LocalCodexHistoryResponse;
}

export function parseLoadedCodexHistoryResponse(
  payload: unknown
): LocalLoadedThreadsResponse {
  return parseRelayResponse(
    LocalLoadedThreadsResponseSchema,
    payload,
    "loaded codex history"
  ) as LocalLoadedThreadsResponse;
}

export function parseCodexHistoryDetailResponse(
  payload: unknown
): LocalCodexHistoryDetailResponse {
  return parseRelayResponse(
    LocalCodexHistoryDetailResponseSchema,
    payload,
    "codex history detail"
  ) as LocalCodexHistoryDetailResponse;
}

export function parseCodexHistoryPageResponse(
  payload: unknown
): LocalCodexHistoryPageResponse {
  return parseRelayResponse(
    LocalCodexHistoryPageResponseSchema,
    payload,
    "codex history page"
  ) as LocalCodexHistoryPageResponse;
}

export function parseCodexHistoryArchiveResponse(
  payload: unknown
): LocalCodexHistoryArchiveResponse {
  return parseRelayResponse(
    LocalCodexHistoryArchiveResponseSchema,
    payload,
    "codex history archive"
  ) as LocalCodexHistoryArchiveResponse;
}

export function parseResumeSessionResponse(
  payload: unknown
): LocalResumeSessionResponse {
  return parseRelayResponse(
    LocalResumeSessionResponseSchema,
    payload,
    "codex history resume"
  ) as LocalResumeSessionResponse;
}

export function parseLocalEventReplayResponse(
  payload: unknown,
  afterSeq = 0
): LocalEvent[] {
  const minimumSeq = normalizeSeq(afterSeq);
  const parsed = parseRelayResponse(
    LocalEventReplayResponseSchema,
    payload,
    "event replay"
  );
  const bySeq = new Map<number, LocalEvent>();
  for (const event of parsed.events) {
    if (event.seq <= minimumSeq) {
      continue;
    }
    bySeq.set(event.seq, event as LocalEvent);
  }
  return [...bySeq.values()].sort((left, right) => left.seq - right.seq);
}

export function acceptLiveEvent(
  payload: DeviceEventPayload,
  deviceId: string,
  lastSeq: number
): LocalEvent | null {
  if (payload.deviceId !== deviceId) {
    return null;
  }
  return payload.event.seq > normalizeSeq(lastSeq) ? payload.event : null;
}

export function nextSeqAfterEvents(currentSeq: number, events: LocalEvent[]): number {
  return events.reduce(
    (highest, event) => Math.max(highest, normalizeSeq(event.seq)),
    normalizeSeq(currentSeq)
  );
}

function normalizeSeq(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

interface RelayResponseSchema<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

function parseRelayResponse<T>(
  schema: RelayResponseSchema<T>,
  payload: unknown,
  name: string
): T {
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new Error(`Invalid relay response: ${name}`);
  }
  return result.data;
}

function buildRelayDeviceApiUrl(
  connection: Pick<RelayClientConnection, "deviceId" | "relayUrl">,
  path: string
): URL {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return new URL(
    `/api/relay/devices/${encodeURIComponent(connection.deviceId)}${normalizedPath}`,
    normalizeRelayUrl(connection.relayUrl)
  );
}
