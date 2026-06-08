import { randomBytes, randomUUID } from "node:crypto";
import cors from "@fastify/cors";
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest
} from "fastify";
import type { Server as HttpServer } from "node:http";
import { Server as SocketIoServer, type Socket } from "socket.io";
import type {
  DeviceEventPayload,
  MachineEventPayload,
  MachineHeartbeatPayload,
  MachineHelloAck,
  MachineHelloPayload,
  PairingApproveResponse,
  PairingCreateResponse,
  PairingPollResponse,
  PairingRequestPayload,
  PairingRequestView,
  RelayDeviceRecord,
  RelayErrorAck,
  RelayMethod,
  RelayRpcRequest,
  RelayRpcResponse,
  RelaySessionResponse,
  RelayUserAuth
} from "@codexnext/protocol";
import {
  RelayMethod as RelayMethodValue,
  RelayNamespace,
  RelaySocketPath
} from "@codexnext/protocol";
import { requestAccessToken } from "./auth.js";
import { DeviceEventStore } from "./device-event-store.js";
import {
  DeviceRegistry,
  type RegisteredMachineRecord
} from "./device-registry.js";

interface RegisteredDevice {
  info: RelayDeviceRecord;
  socket: Socket | null;
  store: DeviceEventStore;
}

interface BrowserSession {
  token: string;
  createdAt: number;
  lastUsedAt: number;
}

interface PairingRequestRecord extends PairingRequestView {
  code: string;
  deviceToken: string;
  pollToken: string;
}

export interface ControlServerOptions {
  host: string;
  port: number;
  ownerToken: string;
  eventLimit?: number;
  heartbeatIntervalMs?: number;
  rpcTimeoutMs?: number;
}

export interface ControlServerHandle {
  app: FastifyInstance;
  io: SocketIoServer;
  close(): Promise<void>;
}

export function createControlServer(
  options: ControlServerOptions
): ControlServerHandle {
  const app = Fastify({
    logger: false
  });
  void app.register(cors, {
    origin: true,
    credentials: false,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type"]
  });
  const io = new SocketIoServer(app.server as HttpServer, {
    path: RelaySocketPath,
    cors: {
      origin: true,
      credentials: false
    }
  });
  const devices = new Map<string, RegisteredDevice>();
  const registry = new DeviceRegistry();
  const browserSessions = new Map<string, BrowserSession>();
  const pairings = new Map<string, PairingRequestRecord>();
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? 15_000;
  const rpcTimeoutMs = options.rpcTimeoutMs ?? 30_000;

  const userNamespace = io.of(RelayNamespace.User);
  const machineNamespace = io.of(RelayNamespace.Machine);
  const issueBrowserSession = () => {
    const token = randomBytes(24).toString("base64url");
    browserSessions.set(token, {
      token,
      createdAt: Date.now(),
      lastUsedAt: Date.now()
    });
    return token;
  };
  const isUserAccessToken = (token: string | null | undefined) => {
    if (!token) {
      return false;
    }
    if (token === options.ownerToken) {
      return true;
    }
    const session = browserSessions.get(token);
    if (!session) {
      return false;
    }
    session.lastUsedAt = Date.now();
    return true;
  };
  const requireUserAccess = (request: FastifyRequest, reply: FastifyReply) => {
    if (isUserAccessToken(requestAccessToken(request))) {
      return true;
    }
    reply.code(401);
    return false;
  };
  const pairingForCode = (code: string) =>
    [...pairings.values()].find((pairing) => pairing.codeDigits === normalizePairCode(code)) ?? null;

  userNamespace.use((socket, next) => {
    const auth = socket.handshake.auth as
      | (Partial<RelayUserAuth> & { sessionToken?: string })
      | undefined;
    const accessToken = auth?.sessionToken ?? auth?.ownerToken;
    if (!auth || auth.clientType !== "user" || !isUserAccessToken(accessToken)) {
      next(new Error("unauthorized"));
      return;
    }
    next();
  });

  machineNamespace.use((socket, next) => {
    const auth = socket.handshake.auth as {
      clientType?: string;
      ownerToken?: string;
      deviceId?: string;
      deviceToken?: string;
    };
    if (
      auth?.clientType !== "machine" ||
      typeof auth.deviceId !== "string" ||
      !auth.deviceId
    ) {
      next(new Error("unauthorized"));
      return;
    }
    const ownerAuthorized = auth.ownerToken === options.ownerToken;
    const deviceAuthorized = registry.isAuthorized(auth.deviceId, auth.deviceToken);
    if (!ownerAuthorized && !deviceAuthorized) {
      next(new Error("unauthorized"));
      return;
    }
    next();
  });

  userNamespace.on("connection", (socket) => {
    const auth = socket.handshake.auth as RelayUserAuth | undefined;
    const lastSeqByDevice = auth?.lastSeqByDevice ?? {};

    for (const device of sortedDevices(devices)) {
      socket.emit("device:upsert", device.info);
      const after = Number.isFinite(lastSeqByDevice[device.info.deviceId] ?? NaN)
        ? Math.max(0, Number(lastSeqByDevice[device.info.deviceId]))
        : 0;
      for (const event of device.store.after(after)) {
        const payload: DeviceEventPayload = {
          deviceId: device.info.deviceId,
          event
        };
        socket.emit("device:event", payload);
      }
    }
  });

  machineNamespace.on("connection", (socket) => {
    let registeredDeviceId: string | null = null;

    socket.on("machine:hello", (payload: MachineHelloPayload, ack?: (response: MachineHelloAck | RelayErrorAck) => void) => {
      const deviceId = payload?.deviceId || registeredDeviceId;
      if (!deviceId || typeof ack !== "function") {
        ack?.({ ok: false, error: "invalid machine hello" });
        return;
      }
      registeredDeviceId = deviceId;
      const existing = devices.get(deviceId);
      const registryRecord = registry.get(deviceId);
      const nextInfo: RelayDeviceRecord = {
        deviceId,
        deviceName: payload.deviceName,
        hostname: payload.hostname,
        platform: payload.platform,
        arch: payload.arch,
        agentVersion: payload.agentVersion,
        codexVersion: payload.codexVersion ?? null,
        startedAt: payload.startedAt,
        online: true,
        lastSeenAt: Date.now(),
        socketId: socket.id,
        activeSessions: existing?.info.activeSessions ?? 0
      };
      const next: RegisteredDevice = {
        info: nextInfo,
        socket,
        store:
          existing?.store ??
          new DeviceEventStore(
            options.eventLimit !== undefined ? { limit: options.eventLimit } : {}
          )
      };
      devices.set(deviceId, next);
      if (registryRecord) {
        registry.upsert({
          ...registryRecord,
          deviceName: payload.deviceName,
          hostname: payload.hostname,
          platform: payload.platform,
          arch: payload.arch,
          agentVersion: payload.agentVersion,
          codexVersion: payload.codexVersion ?? null,
          relayUrl: registryRecord.relayUrl ?? null,
          updatedAt: Date.now()
        });
      }
      broadcastUpsert(userNamespace, next.info);
      ack({
        ok: true,
        serverTime: Date.now(),
        heartbeatIntervalMs
      });
    });

    socket.on("machine:heartbeat", (payload: MachineHeartbeatPayload) => {
      if (!payload?.deviceId) {
        return;
      }
      const device = devices.get(payload.deviceId);
      if (!device) {
        return;
      }
      device.info = {
        ...device.info,
        online: true,
        lastSeenAt: payload.at || Date.now(),
        socketId: socket.id,
        activeSessions: payload.activeSessions
      };
      device.socket = socket;
      userNamespace.emit("device:presence", {
        deviceId: device.info.deviceId,
        online: true,
        lastSeenAt: device.info.lastSeenAt,
        socketId: socket.id,
        activeSessions: payload.activeSessions
      });
    });

    socket.on("machine:event", (payload: MachineEventPayload) => {
      if (!payload?.deviceId || !payload.event) {
        return;
      }
      const device =
        devices.get(payload.deviceId) ??
        registerEventOnlyDevice(devices, payload.deviceId, socket, options.eventLimit);
      device.store.append(payload.event);
      device.info = {
        ...device.info,
        lastSeenAt: Date.now(),
        online: true,
        socketId: socket.id
      };
      userNamespace.emit("device:event", payload satisfies DeviceEventPayload);
    });

    socket.on("disconnect", () => {
      if (!registeredDeviceId) {
        return;
      }
      const device = devices.get(registeredDeviceId);
      if (!device) {
        return;
      }
      device.socket = null;
      device.info = {
        ...device.info,
        online: false,
        lastSeenAt: Date.now()
      };
      userNamespace.emit("device:offline", {
        deviceId: device.info.deviceId,
        lastSeenAt: device.info.lastSeenAt
      });
    });
  });

  app.get("/api/control/health", async () => ({
    ok: true,
    devices: [...devices.values()].filter((device) => device.info.online).length
  }));

  app.post("/api/auth/session", async (request, reply) => {
    if (requestAccessToken(request) !== options.ownerToken) {
      reply.code(401);
      return { error: "Missing or invalid owner token" };
    }
    return {
      ok: true,
      sessionToken: issueBrowserSession()
    } satisfies RelaySessionResponse;
  });

  app.post("/api/pairings/device", async (request, reply) => {
    const body = request.body as PairingRequestPayload;
    if (
      !body ||
      typeof body.deviceId !== "string" ||
      typeof body.deviceToken !== "string" ||
      typeof body.deviceName !== "string" ||
      typeof body.hostname !== "string" ||
      typeof body.platform !== "string" ||
      typeof body.arch !== "string" ||
      typeof body.agentVersion !== "string"
    ) {
      reply.code(400);
      return { error: "Invalid pairing payload" };
    }

    const codeDigits = randomDigits(6);
    const requestId = randomUUID();
    const record: PairingRequestRecord = {
      requestId,
      code: `${codeDigits.slice(0, 3)}-${codeDigits.slice(3)}`,
      codeDigits,
      deviceId: body.deviceId,
      deviceToken: body.deviceToken,
      deviceName: body.deviceName,
      hostname: body.hostname,
      platform: body.platform,
      arch: body.arch,
      agentVersion: body.agentVersion,
      ...(body.codexVersion !== undefined ? { codexVersion: body.codexVersion } : {}),
      ...(body.relayUrl !== undefined ? { relayUrl: body.relayUrl } : {}),
      createdAt: Date.now(),
      expiresAt: Date.now() + 5 * 60_000,
      status: "pending",
      pollToken: randomBytes(18).toString("base64url")
    };
    pairings.set(record.requestId, record);
    return {
      requestId: record.requestId,
      pollToken: record.pollToken,
      code: record.code,
      codeDigits: record.codeDigits,
      expiresAt: record.expiresAt
    } satisfies PairingCreateResponse;
  });

  app.get("/api/pairings/device/:requestId", async (request, reply) => {
    const params = request.params as { requestId: string };
    const query = request.query as { pollToken?: string };
    const pairing = pairings.get(params.requestId);
    if (!pairing || query.pollToken !== pairing.pollToken) {
      reply.code(404);
      return { error: "Pairing request not found" };
    }
    const status = resolvePairingStatus(pairing);
    pairing.status = status;
    return {
      ok: true,
      status,
      deviceId: pairing.deviceId,
      expiresAt: pairing.expiresAt
    } satisfies PairingPollResponse;
  });

  app.get("/api/pairings/requests/:code", async (request, reply) => {
    const params = request.params as { code: string };
    const pairing = pairingForCode(params.code);
    if (!pairing) {
      reply.code(404);
      return { error: "Pairing request not found" };
    }
    const status = resolvePairingStatus(pairing);
    pairing.status = status;
    return toPairingView(pairing);
  });

  app.post("/api/pairings/requests/:code/approve", async (request, reply) => {
    if (!requireUserAccess(request, reply)) {
      return { error: "Missing or invalid user token" };
    }
    const params = request.params as { code: string };
    const pairing = pairingForCode(params.code);
    if (!pairing) {
      reply.code(404);
      return { error: "Pairing request not found" };
    }
    const status = resolvePairingStatus(pairing);
    if (status !== "pending") {
      reply.code(status === "expired" ? 410 : 409);
      return { error: `Pairing request is ${status}` };
    }
    pairing.status = "approved";
    registry.upsert({
      deviceId: pairing.deviceId,
      deviceToken: pairing.deviceToken,
      deviceName: pairing.deviceName,
      hostname: pairing.hostname,
      platform: pairing.platform,
      arch: pairing.arch,
      agentVersion: pairing.agentVersion,
      codexVersion: pairing.codexVersion ?? null,
      relayUrl: pairing.relayUrl ?? null,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
    const sessionToken = issueBrowserSession();
    return {
      ok: true,
      deviceId: pairing.deviceId,
      sessionToken
    } satisfies PairingApproveResponse;
  });

  app.get("/api/devices", async (request, reply) => {
    if (!requireUserAccess(request, reply)) {
      return { error: "Missing or invalid user token" };
    }
    return {
      devices: sortedDevices(devices).map((device) => device.info)
    };
  });

  app.get("/api/relay/devices/:deviceId/events", async (request, reply) => {
    if (!requireUserAccess(request, reply)) {
      return { error: "Missing or invalid user token" };
    }
    const params = request.params as { deviceId: string };
    const device = devices.get(params.deviceId);
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

  app.get("/api/relay/devices/:deviceId/health", async (request, reply) =>
    handleRpcRequest(request, reply, devices, isUserAccessToken, RelayMethodValue.AgentHealth, undefined, rpcTimeoutMs)
  );

  app.get("/api/relay/devices/:deviceId/sessions", async (request, reply) =>
    handleRpcRequest(request, reply, devices, isUserAccessToken, RelayMethodValue.SessionsList, undefined, rpcTimeoutMs)
  );

  app.post("/api/relay/devices/:deviceId/sessions", async (request, reply) =>
    handleRpcRequest(request, reply, devices, isUserAccessToken, RelayMethodValue.SessionsCreate, request.body, rpcTimeoutMs)
  );

  app.post("/api/relay/devices/:deviceId/sessions/:sessionId/messages", async (request, reply) => {
    const params = request.params as { sessionId: string };
    return handleRpcRequest(
      request,
      reply,
      devices,
      isUserAccessToken,
      RelayMethodValue.SessionsMessage,
      { sessionId: params.sessionId, body: request.body },
      rpcTimeoutMs
    );
  });

  app.get("/api/relay/devices/:deviceId/sessions/:sessionId/goal", async (request, reply) => {
    const params = request.params as { sessionId: string };
    return handleRpcRequest(
      request,
      reply,
      devices,
      isUserAccessToken,
      RelayMethodValue.SessionsGoalGet,
      { sessionId: params.sessionId },
      rpcTimeoutMs
    );
  });

  app.post("/api/relay/devices/:deviceId/sessions/:sessionId/goal", async (request, reply) => {
    const params = request.params as { sessionId: string };
    return handleRpcRequest(
      request,
      reply,
      devices,
      isUserAccessToken,
      RelayMethodValue.SessionsGoalSet,
      { sessionId: params.sessionId, body: request.body },
      rpcTimeoutMs
    );
  });

  app.delete("/api/relay/devices/:deviceId/sessions/:sessionId/goal", async (request, reply) => {
    const params = request.params as { sessionId: string };
    return handleRpcRequest(
      request,
      reply,
      devices,
      isUserAccessToken,
      RelayMethodValue.SessionsGoalClear,
      { sessionId: params.sessionId },
      rpcTimeoutMs
    );
  });

  app.post(
    "/api/relay/devices/:deviceId/sessions/:sessionId/turns/:turnId/interrupt",
    async (request, reply) => {
      const params = request.params as { sessionId: string; turnId: string };
      return handleRpcRequest(
        request,
        reply,
        devices,
        isUserAccessToken,
        RelayMethodValue.TurnInterrupt,
        { sessionId: params.sessionId, turnId: params.turnId },
        rpcTimeoutMs
      );
    }
  );

  app.post("/api/relay/devices/:deviceId/approvals/:approvalId/decision", async (request, reply) => {
    const params = request.params as { approvalId: string };
    return handleRpcRequest(
      request,
      reply,
      devices,
      isUserAccessToken,
      RelayMethodValue.ApprovalDecision,
      { approvalId: params.approvalId, body: request.body },
      rpcTimeoutMs
    );
  });

  app.get("/api/relay/devices/:deviceId/directories", async (request, reply) => {
    const query = request.query as { path?: string };
    return handleRpcRequest(
      request,
      reply,
      devices,
      isUserAccessToken,
      RelayMethodValue.DirectoriesList,
      { path: query.path },
      rpcTimeoutMs
    );
  });

  app.get("/api/relay/devices/:deviceId/codex-history", async (request, reply) => {
    const query = request.query as { limit?: string; search?: string };
    return handleRpcRequest(
      request,
      reply,
      devices,
      isUserAccessToken,
      RelayMethodValue.CodexHistoryList,
      {
        limit: query.limit ? Number(query.limit) : undefined,
        search: query.search
      },
      rpcTimeoutMs
    );
  });

  app.get("/api/relay/devices/:deviceId/codex-history/detail", async (request, reply) => {
    const query = request.query as { id?: string; cwd?: string };
    return handleRpcRequest(
      request,
      reply,
      devices,
      isUserAccessToken,
      RelayMethodValue.CodexHistoryDetail,
      {
        id: query.id,
        cwd: query.cwd
      },
      rpcTimeoutMs
    );
  });

  app.post("/api/relay/devices/:deviceId/codex-history/resume", async (request, reply) =>
    handleRpcRequest(request, reply, devices, isUserAccessToken, RelayMethodValue.CodexHistoryResume, request.body, rpcTimeoutMs)
  );

  return {
    app,
    io,
    close: async () => {
      await io.close();
      await app.close();
    }
  };
}

async function handleRpcRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  devices: Map<string, RegisteredDevice>,
  isUserAccessToken: (token: string | null | undefined) => boolean,
  method: RelayMethod,
  params: unknown,
  timeoutMs: number
): Promise<unknown> {
  const accessToken = requestAccessToken(request);
  if (!isUserAccessToken(accessToken)) {
    reply.code(401);
    return { error: "Missing or invalid user token" };
  }
  const { deviceId } = request.params as { deviceId: string };
  try {
    return await invokeMachineRpc(devices, deviceId, method, params, timeoutMs);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const statusCode =
      message.includes("timeout")
        ? 504
        : message.includes("not connected") || message.includes("offline")
          ? 503
          : message.includes("not found")
            ? 404
            : 400;
    reply.code(statusCode);
    return { error: message };
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
    throw new Error(`relay rpc timeout: ${error instanceof Error ? error.message : String(error)}`);
  });

  if (!response.ok) {
    throw new Error(response.error.message);
  }
  return response.result;
}

function registerEventOnlyDevice(
  devices: Map<string, RegisteredDevice>,
  deviceId: string,
  socket: Socket,
  limit?: number
): RegisteredDevice {
  const created: RegisteredDevice = {
    info: {
      deviceId,
      deviceName: deviceId,
      hostname: "",
      platform: "unknown",
      arch: "unknown",
      agentVersion: "0.1.0",
      codexVersion: null,
      startedAt: Date.now(),
      online: true,
      lastSeenAt: Date.now(),
      socketId: socket.id,
      activeSessions: 0
    },
    socket,
    store: new DeviceEventStore(limit !== undefined ? { limit } : {})
  };
  devices.set(deviceId, created);
  return created;
}

function resolvePairingStatus(pairing: PairingRequestRecord): PairingRequestRecord["status"] {
  if (pairing.status === "approved") {
    return "approved";
  }
  if (Date.now() >= pairing.expiresAt) {
    return "expired";
  }
  return "pending";
}

function toPairingView(pairing: PairingRequestRecord): PairingRequestView {
  return {
    requestId: pairing.requestId,
    codeDigits: pairing.codeDigits,
    deviceId: pairing.deviceId,
    deviceName: pairing.deviceName,
    hostname: pairing.hostname,
    platform: pairing.platform,
    arch: pairing.arch,
    agentVersion: pairing.agentVersion,
    ...(pairing.codexVersion !== undefined ? { codexVersion: pairing.codexVersion } : {}),
    ...(pairing.relayUrl !== undefined ? { relayUrl: pairing.relayUrl } : {}),
    createdAt: pairing.createdAt,
    expiresAt: pairing.expiresAt,
    status: resolvePairingStatus(pairing)
  };
}

function normalizePairCode(code: string): string {
  return code.replace(/\D+/g, "").trim();
}

function randomDigits(length: number): string {
  return Array.from({ length }, () => Math.floor(Math.random() * 10).toString()).join("");
}

function sortedDevices(
  devices: Map<string, RegisteredDevice>
): RegisteredDevice[] {
  return [...devices.values()].sort((left, right) => {
    if (left.info.online !== right.info.online) {
      return left.info.online ? -1 : 1;
    }
    return right.info.lastSeenAt - left.info.lastSeenAt;
  });
}

function broadcastUpsert(
  namespace: ReturnType<SocketIoServer["of"]>,
  info: RelayDeviceRecord
): void {
  namespace.emit("device:upsert", info);
}
