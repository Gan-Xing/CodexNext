import { randomUUID } from "node:crypto";
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest
} from "fastify";
import type {
  LocalCodexHistoryArchiveResponse,
  LocalCodexHistoryPageResponse,
  LocalLoadedThreadsResponse,
  LocalResumeSessionResponse,
  RelayMethod,
  RelayRpcRequest,
  RelayRpcResponse
} from "@codexnext/protocol";
import {
  LocalCodexHistoryArchiveResponseSchema,
  LocalCodexHistoryDetailResponseSchema,
  LocalCodexHistoryPageResponseSchema,
  LocalCodexHistoryResponseSchema,
  LocalCreateSessionResponseSchema,
  LocalHealthResponseSchema,
  LocalInterruptResponseSchema,
  LocalLoadedThreadsResponseSchema,
  LocalResumeSessionResponseSchema,
  LocalSendMessageResponseSchema,
  LocalSessionsResponseSchema,
  RelayMethod as RelayMethodValue
} from "@codexnext/protocol";
import type { AuditLogger } from "./audit-log.js";
import type {
  CachedHistoryPageRecord,
  HistoryPageCacheParams,
  RegisteredDevice
} from "./device-state.js";
import {
  classifyRelayRpcError,
  routeRpcTimeout,
  validateRelayRpcResult,
  type RelayRpcResultSchema
} from "./relay-rpc.js";

export interface RelayRouteDependencies {
  allowRelayFullAccess: boolean;
  app: FastifyInstance;
  audit: AuditLogger;
  devices: Map<string, RegisteredDevice>;
  dropCachedHistoryPagesForThread: (device: RegisteredDevice, threadId: string) => void;
  readCachedHistoryPage: (
    device: RegisteredDevice | null,
    params: HistoryPageCacheParams,
    ttlMs: number
  ) => CachedHistoryPageRecord | null;
  recentHistoryCacheTtlMs: number;
  requireUserAccess: (request: FastifyRequest, reply: FastifyReply) => boolean;
  rpcTimeoutMs: number;
  writeCachedHistoryPage: (
    device: RegisteredDevice | null,
    params: HistoryPageCacheParams,
    page: LocalCodexHistoryPageResponse
  ) => void;
}

export function registerRelayRoutes(input: RelayRouteDependencies): void {
  input.app.get("/api/relay/devices/:deviceId/events", async (request, reply) => {
    if (!input.requireUserAccess(request, reply)) {
      return { error: "Missing or invalid user token" };
    }
    const params = request.params as { deviceId: string };
    const device = input.devices.get(params.deviceId);
    if (!device) {
      reply.code(404);
      return { error: "Device not found" };
    }
    const query = request.query as { after?: string };
    const after = Number(query.after ?? "0");
    return {
      events: device.store.after(Number.isFinite(after) ? after : 0)
    };
  });

  input.app.get("/api/relay/devices/:deviceId/health", async (request, reply) =>
    handleRpcRequest(request, reply, {
      ...input,
      method: RelayMethodValue.AgentHealth,
      params: undefined,
      resultSchema: LocalHealthResponseSchema,
      timeoutMs: input.rpcTimeoutMs
    })
  );

  input.app.get("/api/relay/devices/:deviceId/sessions", async (request, reply) =>
    handleRpcRequest(request, reply, {
      ...input,
      method: RelayMethodValue.SessionsList,
      params: undefined,
      resultSchema: LocalSessionsResponseSchema,
      timeoutMs: input.rpcTimeoutMs
    })
  );

  input.app.post("/api/relay/devices/:deviceId/sessions", async (request, reply) =>
    handleRpcRequest(request, reply, {
      ...input,
      method: RelayMethodValue.SessionsCreate,
      params: request.body,
      resultSchema: LocalCreateSessionResponseSchema,
      timeoutMs: routeRpcTimeout(RelayMethodValue.SessionsCreate, input.rpcTimeoutMs)
    })
  );

  input.app.post(
    "/api/relay/devices/:deviceId/sessions/:sessionId/messages",
    async (request, reply) => {
      const params = request.params as { sessionId: string };
      return handleRpcRequest(request, reply, {
        ...input,
        method: RelayMethodValue.SessionsMessage,
        params: { sessionId: params.sessionId, body: request.body },
        resultSchema: LocalSendMessageResponseSchema,
        timeoutMs: input.rpcTimeoutMs
      });
    }
  );

  input.app.get("/api/relay/devices/:deviceId/sessions/:sessionId/goal", async (request, reply) => {
    const params = request.params as { sessionId: string };
    return handleRpcRequest(request, reply, {
      ...input,
      method: RelayMethodValue.SessionsGoalGet,
      params: { sessionId: params.sessionId },
      timeoutMs: input.rpcTimeoutMs
    });
  });

  input.app.post("/api/relay/devices/:deviceId/sessions/:sessionId/goal", async (request, reply) => {
    const params = request.params as { sessionId: string };
    return handleRpcRequest(request, reply, {
      ...input,
      method: RelayMethodValue.SessionsGoalSet,
      params: { sessionId: params.sessionId, body: request.body },
      timeoutMs: input.rpcTimeoutMs
    });
  });

  input.app.delete("/api/relay/devices/:deviceId/sessions/:sessionId/goal", async (request, reply) => {
    const params = request.params as { sessionId: string };
    return handleRpcRequest(request, reply, {
      ...input,
      method: RelayMethodValue.SessionsGoalClear,
      params: { sessionId: params.sessionId },
      timeoutMs: input.rpcTimeoutMs
    });
  });

  input.app.post(
    "/api/relay/devices/:deviceId/sessions/:sessionId/turns/:turnId/interrupt",
    async (request, reply) => {
      const params = request.params as { sessionId: string; turnId: string };
      return handleRpcRequest(request, reply, {
        ...input,
        method: RelayMethodValue.TurnInterrupt,
        params: { sessionId: params.sessionId, turnId: params.turnId },
        resultSchema: LocalInterruptResponseSchema,
        timeoutMs: input.rpcTimeoutMs
      });
    }
  );

  input.app.post("/api/relay/devices/:deviceId/approvals/:approvalId/decision", async (request, reply) => {
    const params = request.params as { approvalId: string };
    return handleRpcRequest(request, reply, {
      ...input,
      method: RelayMethodValue.ApprovalDecision,
      params: { approvalId: params.approvalId, body: request.body },
      timeoutMs: input.rpcTimeoutMs
    });
  });

  input.app.get("/api/relay/devices/:deviceId/directories", async (request, reply) => {
    const query = request.query as { path?: string };
    return handleRpcRequest(request, reply, {
      ...input,
      method: RelayMethodValue.DirectoriesList,
      params: { path: query.path },
      timeoutMs: input.rpcTimeoutMs
    });
  });

  input.app.get("/api/relay/devices/:deviceId/codex-history", async (request, reply) => {
    const query = request.query as { limit?: string; search?: string };
    return handleRpcRequest(request, reply, {
      ...input,
      method: RelayMethodValue.CodexHistoryList,
      params: {
        limit: query.limit ? Number(query.limit) : undefined,
        search: query.search
      },
      resultSchema: LocalCodexHistoryResponseSchema,
      timeoutMs: input.rpcTimeoutMs
    });
  });

  input.app.get("/api/relay/devices/:deviceId/codex-history/loaded", async (request, reply) => {
    if (!input.requireUserAccess(request, reply)) {
      return { error: "Missing or invalid user token" };
    }
    const { deviceId } = request.params as { deviceId: string };
    try {
      const rawResult = await invokeMachineRpc(
        input.devices,
        deviceId,
        RelayMethodValue.CodexHistoryLoaded,
        undefined,
        input.rpcTimeoutMs
      );
      const result = validateRelayRpcResult(
        LocalLoadedThreadsResponseSchema,
        rawResult,
        RelayMethodValue.CodexHistoryLoaded
      ) as LocalLoadedThreadsResponse;
      const device = input.devices.get(deviceId);
      if (device) {
        device.loadedThreadIds = new Set(result.threadIds);
      }
      input.audit.write({
        action: "relay.rpc",
        at: Date.now(),
        deviceId,
        method: RelayMethodValue.CodexHistoryLoaded,
        outcome: "success"
      });
      return result;
    } catch (error) {
      return replyWithRpcError(
        reply,
        input.audit,
        deviceId,
        RelayMethodValue.CodexHistoryLoaded,
        error
      );
    }
  });

  input.app.get("/api/relay/devices/:deviceId/codex-history/detail", async (request, reply) => {
    const query = request.query as { id?: string; cwd?: string };
    return handleRpcRequest(request, reply, {
      ...input,
      method: RelayMethodValue.CodexHistoryDetail,
      params: {
        id: query.id,
        cwd: query.cwd
      },
      resultSchema: LocalCodexHistoryDetailResponseSchema,
      timeoutMs: routeRpcTimeout(RelayMethodValue.CodexHistoryDetail, input.rpcTimeoutMs)
    });
  });

  input.app.get("/api/relay/devices/:deviceId/codex-history/turns", async (request, reply) => {
    const query = request.query as {
      id?: string;
      cwd?: string;
      cursor?: string;
      limit?: string;
      sortDirection?: string;
      itemsView?: string;
    };
    if (!input.requireUserAccess(request, reply)) {
      return { error: "Missing or invalid user token" };
    }
    const { deviceId } = request.params as { deviceId: string };
    const params = {
      ...(query.id ? { id: query.id } : {}),
      ...(query.cwd ? { cwd: query.cwd } : {}),
      ...(query.cursor ? { cursor: query.cursor } : {}),
      ...(query.limit ? { limit: Number(query.limit) } : {}),
      ...(query.sortDirection ? { sortDirection: query.sortDirection } : {}),
      ...(query.itemsView ? { itemsView: query.itemsView } : {})
    };
    try {
      const cached = input.readCachedHistoryPage(
        input.devices.get(deviceId) ?? null,
        params,
        input.recentHistoryCacheTtlMs
      );
      if (cached) {
        input.audit.write({
          action: "relay.rpc.cache_hit",
          at: Date.now(),
          deviceId,
          method: RelayMethodValue.CodexHistoryTurns,
          outcome: "success"
        });
        return cached.page;
      }
      const rawResult = await invokeMachineRpc(
        input.devices,
        deviceId,
        RelayMethodValue.CodexHistoryTurns,
        params,
        routeRpcTimeout(RelayMethodValue.CodexHistoryTurns, input.rpcTimeoutMs)
      );
      const result = validateRelayRpcResult(
        LocalCodexHistoryPageResponseSchema,
        rawResult,
        RelayMethodValue.CodexHistoryTurns
      ) as LocalCodexHistoryPageResponse;
      input.writeCachedHistoryPage(input.devices.get(deviceId) ?? null, params, result);
      input.audit.write({
        action: "relay.rpc",
        at: Date.now(),
        deviceId,
        method: RelayMethodValue.CodexHistoryTurns,
        outcome: "success"
      });
      return result;
    } catch (error) {
      return replyWithRpcError(
        reply,
        input.audit,
        deviceId,
        RelayMethodValue.CodexHistoryTurns,
        error
      );
    }
  });

  input.app.post("/api/relay/devices/:deviceId/codex-history/archive", async (request, reply) => {
    if (!input.requireUserAccess(request, reply)) {
      return { error: "Missing or invalid user token" };
    }
    const { deviceId } = request.params as { deviceId: string };
    const body = isRecordLike(request.body) ? request.body : {};
    try {
      const rawResult = await invokeMachineRpc(
        input.devices,
        deviceId,
        RelayMethodValue.CodexHistoryArchive,
        body,
        input.rpcTimeoutMs
      );
      const result = validateRelayRpcResult(
        LocalCodexHistoryArchiveResponseSchema,
        rawResult,
        RelayMethodValue.CodexHistoryArchive
      ) as LocalCodexHistoryArchiveResponse;
      const threadId = typeof body.id === "string" ? body.id.trim() : "";
      const device = input.devices.get(deviceId);
      if (device && threadId) {
        device.loadedThreadIds.delete(threadId);
        input.dropCachedHistoryPagesForThread(device, threadId);
      }
      input.audit.write({
        action: "relay.rpc",
        at: Date.now(),
        deviceId,
        method: RelayMethodValue.CodexHistoryArchive,
        outcome: "success"
      });
      return result;
    } catch (error) {
      return replyWithRpcError(
        reply,
        input.audit,
        deviceId,
        RelayMethodValue.CodexHistoryArchive,
        error
      );
    }
  });

  input.app.post("/api/relay/devices/:deviceId/codex-history/resume", async (request, reply) => {
    if (!input.requireUserAccess(request, reply)) {
      return { error: "Missing or invalid user token" };
    }
    if (
      !input.allowRelayFullAccess &&
      requestsRelayFullAccess(RelayMethodValue.CodexHistoryResume, request.body)
    ) {
      input.audit.write({
        action: "relay.rpc",
        at: Date.now(),
        method: RelayMethodValue.CodexHistoryResume,
        outcome: "denied",
        reason: "relay_full_access_disabled"
      });
      reply.code(403);
      return { error: "Relay full-access is disabled by operator policy." };
    }
    const { deviceId } = request.params as { deviceId: string };
    try {
      const rawResult = await invokeMachineRpc(
        input.devices,
        deviceId,
        RelayMethodValue.CodexHistoryResume,
        request.body,
        routeRpcTimeout(RelayMethodValue.CodexHistoryResume, input.rpcTimeoutMs)
      );
      const result = validateRelayRpcResult(
        LocalResumeSessionResponseSchema,
        rawResult,
        RelayMethodValue.CodexHistoryResume
      ) as LocalResumeSessionResponse;
      input.writeCachedHistoryPage(
        input.devices.get(deviceId) ?? null,
        {
          id: result.history.entry.id,
          cwd: result.history.entry.cwd,
          limit: 40,
          sortDirection: "desc",
          itemsView: "summary"
        },
        result.history
      );
      const device = input.devices.get(deviceId);
      if (device) {
        device.loadedThreadIds.add(result.history.entry.id);
      }
      input.audit.write({
        action: "relay.rpc",
        at: Date.now(),
        deviceId,
        method: RelayMethodValue.CodexHistoryResume,
        outcome: "success"
      });
      return result;
    } catch (error) {
      return replyWithRpcError(
        reply,
        input.audit,
        deviceId,
        RelayMethodValue.CodexHistoryResume,
        error
      );
    }
  });
}

async function handleRpcRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  input: RelayRouteDependencies & {
    method: RelayMethod;
    params: unknown;
    resultSchema?: RelayRpcResultSchema;
    timeoutMs: number;
  }
): Promise<unknown> {
  if (!input.requireUserAccess(request, reply)) {
    return { error: "Missing or invalid user token" };
  }
  if (!input.allowRelayFullAccess && requestsRelayFullAccess(input.method, input.params)) {
    input.audit.write({
      action: "relay.rpc",
      at: Date.now(),
      method: input.method,
      outcome: "denied",
      reason: "relay_full_access_disabled"
    });
    reply.code(403);
    return { error: "Relay full-access is disabled by operator policy." };
  }
  const { deviceId } = request.params as { deviceId: string };
  try {
    const result = await invokeMachineRpc(
      input.devices,
      deviceId,
      input.method,
      input.params,
      input.timeoutMs
    );
    const validatedResult = input.resultSchema
      ? validateRelayRpcResult(input.resultSchema, result, input.method)
      : result;
    const meta = approvalDecisionMeta(input.method, input.params);
    input.audit.write({
      action:
        input.method === RelayMethodValue.ApprovalDecision
          ? "approval.decision"
          : "relay.rpc",
      at: Date.now(),
      deviceId,
      method: input.method,
      outcome: "success",
      ...(meta ? { meta } : {})
    });
    return validatedResult;
  } catch (error) {
    return replyWithRpcError(reply, input.audit, deviceId, input.method, error);
  }
}

async function invokeMachineRpc(
  devices: Map<string, RegisteredDevice>,
  deviceId: string,
  method: RelayMethod,
  params: unknown,
  timeoutMs: number
): Promise<unknown> {
  const device = devices.get(deviceId);
  if (!device) {
    throw new Error(`Device not found: ${deviceId}`);
  }
  if (!device.socket || !device.info.online) {
    throw new Error(`Device offline: ${deviceId}`);
  }

  const request: RelayRpcRequest = {
    requestId: randomUUID(),
    method,
    ...(params !== undefined ? { params } : {}),
    deadlineMs: timeoutMs
  };

  const response = await new Promise<RelayRpcResponse>((resolve, reject) => {
    device.socket
      ?.timeout(timeoutMs)
      .emit("rpc:request", request, (error: Error | null, payload: RelayRpcResponse) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(payload);
      });
  }).catch((error: unknown) => {
    throw new Error(
      `relay rpc timeout: ${error instanceof Error ? error.message : String(error)}`
    );
  });

  if (!response.ok) {
    throw new Error(response.error.message);
  }
  return response.result;
}

function requestsRelayFullAccess(method: RelayMethod, params: unknown): boolean {
  if (
    method !== RelayMethodValue.SessionsCreate &&
    method !== RelayMethodValue.CodexHistoryResume
  ) {
    return false;
  }
  if (!isRecordLike(params)) {
    return false;
  }
  return (
    params.permissionMode === "full-access" ||
    (params.sandbox === "danger-full-access" && params.approvalPolicy === "never")
  );
}

function approvalDecisionMeta(
  method: RelayMethod,
  params: unknown
): Record<string, unknown> | undefined {
  if (method !== RelayMethodValue.ApprovalDecision || !isRecordLike(params) || !isRecordLike(params.body)) {
    return undefined;
  }
  if (typeof params.body.decision !== "string") {
    return undefined;
  }
  return { decision: params.body.decision };
}

function replyWithRpcError(
  reply: FastifyReply,
  audit: AuditLogger,
  deviceId: string,
  method: RelayMethod,
  error: unknown
) {
  const classification = classifyRelayRpcError(error);
  audit.write({
    action: "relay.rpc",
    at: Date.now(),
    deviceId,
    method,
    outcome: "failure",
    reason: classification.reason
  });
  reply.code(classification.statusCode);
  return { error: classification.message };
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
