import { createHash, randomBytes, randomUUID } from "node:crypto";
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
  LocalCodexHistoryPageResponse,
  LocalLoadedThreadsResponse,
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
import { readBearerToken, requestAccessToken } from "./auth.js";
import { AuditLogger } from "./audit-log.js";
import { DeviceEventStore } from "./device-event-store.js";
import {
  DeviceRegistry,
  type RegisteredMachineRecord
} from "./device-registry.js";

interface RegisteredDevice {
  info: RelayDeviceRecord;
  socket: Socket | null;
  store: DeviceEventStore;
  loadedThreadIds: Set<string>;
  recentHistoryPages: Map<string, CachedHistoryPageRecord>;
}

interface CachedHistoryPageRecord {
  fetchedAt: number;
  page: LocalCodexHistoryPageResponse;
}

interface BrowserSessionRecord {
  tokenHash: string;
  createdAt: number;
  expiresAt: number;
  lastUsedAt: number;
  revokedAt: number | null;
}

interface PairingRequestRecord extends Omit<PairingRequestView, "status"> {
  code: string;
  deviceToken: string;
  pollToken: string;
  status: PairingRequestView["status"];
  consumedAt: number | null;
}

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

export interface ControlServerOptions {
  host: string;
  port: number;
  ownerToken: string;
  publicWebOrigin?: string | null;
  eventLimit?: number;
  heartbeatIntervalMs?: number;
  rpcTimeoutMs?: number;
  browserSessionTtlMs?: number;
  browserSessionIdleMs?: number;
  pruneIntervalMs?: number;
  allowedOrigins?: string[];
  production?: boolean;
  allowMachineOwnerToken?: boolean;
  allowRelayFullAccess?: boolean;
}

export interface ControlServerHandle {
  app: FastifyInstance;
  io: SocketIoServer;
  close(): Promise<void>;
}

const DEFAULT_BROWSER_SESSION_TTL_MS = 8 * 60 * 60_000;
const DEFAULT_BROWSER_SESSION_IDLE_MS = 2 * 60 * 60_000;
const DEFAULT_PRUNE_INTERVAL_MS = 60_000;
const DEFAULT_PAIRING_TTL_MS = 15 * 60_000;
const DEFAULT_SLOW_RPC_TIMEOUT_MS = 90_000;
const DEFAULT_SOCKET_MAX_PAYLOAD_BYTES = 8 * 1024 * 1024;
const DEFAULT_RECENT_HISTORY_CACHE_TTL_MS = 30_000;

export function createControlServer(
  input: ControlServerOptions
): ControlServerHandle {
  const options = normalizeControlOptions(input);
  const app = Fastify({ logger: false });
  const allowedOrigins = options.allowedOrigins;
  const allowOrigin = createOriginMatcher(allowedOrigins, options.production);
  void app.register(cors, {
    origin(origin, callback) {
      callback(null, allowOrigin(origin));
    },
    credentials: false,
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type"]
  });
  const io = new SocketIoServer(app.server as HttpServer, {
    path: RelaySocketPath,
    maxHttpBufferSize: DEFAULT_SOCKET_MAX_PAYLOAD_BYTES,
    cors: {
      origin(origin, callback) {
        callback(null, allowOrigin(origin));
      },
      credentials: false
    }
  });

  const audit = new AuditLogger();
  const devices = new Map<string, RegisteredDevice>();
  const registry = new DeviceRegistry(options.ownerToken);
  const browserSessions = new Map<string, BrowserSessionRecord>();
  const pairings = new Map<string, PairingRequestRecord>();
  const rateLimits = new Map<string, RateLimitRecord>();
  const heartbeatIntervalMs = options.heartbeatIntervalMs;
  const rpcTimeoutMs = options.rpcTimeoutMs;

  const userNamespace = io.of(RelayNamespace.User);
  const machineNamespace = io.of(RelayNamespace.Machine);

  const pruneTimer = setInterval(() => {
    pruneBrowserSessions(browserSessions, audit, options.browserSessionIdleMs);
    prunePairings(pairings, audit);
    pruneRateLimits(rateLimits);
  }, options.pruneIntervalMs);

  const issueBrowserSession = () => {
    const token = randomBytes(24).toString("base64url");
    const now = Date.now();
    browserSessions.set(hashBrowserSessionToken(options.ownerToken, token), {
      tokenHash: hashBrowserSessionToken(options.ownerToken, token),
      createdAt: now,
      lastUsedAt: now,
      expiresAt: now + options.browserSessionTtlMs,
      revokedAt: null
    });
    return token;
  };

  const revokeBrowserSession = (token: string | null | undefined): boolean => {
    if (!token || token === options.ownerToken) {
      return false;
    }
    const tokenHash = hashBrowserSessionToken(options.ownerToken, token);
    const session = browserSessions.get(tokenHash);
    if (!session) {
      return false;
    }
    session.revokedAt = Date.now();
    browserSessions.delete(tokenHash);
    return true;
  };

  const isUserAccessToken = (token: string | null | undefined) => {
    if (!token) {
      return false;
    }
    if (!options.production && token === options.ownerToken) {
      return true;
    }
    const tokenHash = hashBrowserSessionToken(options.ownerToken, token);
    const session = browserSessions.get(tokenHash);
    if (!session) {
      return false;
    }
    const now = Date.now();
    if (
      session.revokedAt ||
      session.expiresAt <= now ||
      session.lastUsedAt + options.browserSessionIdleMs <= now
    ) {
      browserSessions.delete(tokenHash);
      audit.write({
        action: "relay.session.expired",
        at: now,
        outcome: "denied"
      });
      return false;
    }
    session.lastUsedAt = now;
    return true;
  };

  const requireUserAccess = (request: FastifyRequest, reply: FastifyReply) => {
    if (isUserAccessToken(requestAccessToken(request))) {
      return true;
    }
    audit.write({
      action: "relay.auth.failure",
      at: Date.now(),
      outcome: "failure",
      reason: "missing_or_invalid_user_token",
      meta: { ip: request.ip }
    });
    reply.code(401);
    return false;
  };

  userNamespace.use((socket, next) => {
    const auth = socket.handshake.auth as
      | (Partial<RelayUserAuth> & { sessionToken?: string })
      | undefined;
    const accessToken = auth?.sessionToken;
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
    const ownerAuthorized =
      options.allowMachineOwnerToken && auth.ownerToken === options.ownerToken;
    const deviceAuthorized = registry.isAuthorized(auth.deviceId, auth.deviceToken);
    if (!ownerAuthorized && !deviceAuthorized) {
      audit.write({
        action: "device.connect",
        at: Date.now(),
        deviceId: auth.deviceId,
        outcome: "denied",
        reason: "device_not_authorized"
      });
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
        socket.emit("device:event", {
          deviceId: device.info.deviceId,
          event
        } satisfies DeviceEventPayload);
      }
    }
  });

  machineNamespace.on("connection", (socket) => {
    let registeredDeviceId: string | null = null;

    socket.on(
      "machine:hello",
      (payload: MachineHelloPayload, ack?: (response: MachineHelloAck | RelayErrorAck) => void) => {
        const deviceId = payload?.deviceId || registeredDeviceId;
        if (!deviceId || typeof ack !== "function") {
          ack?.({ ok: false, error: "invalid machine hello" });
          return;
        }
        const registryRecord = registry.get(deviceId);
        if (registryRecord?.revokedAt) {
          audit.write({
            action: "device.connect",
            at: Date.now(),
            deviceId,
            outcome: "denied",
            reason: "device_revoked"
          });
          ack({ ok: false, error: "device revoked" });
          socket.disconnect(true);
          return;
        }
        registeredDeviceId = deviceId;
        const existing = devices.get(deviceId);
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
            ),
          loadedThreadIds: existing?.loadedThreadIds ?? new Set<string>(),
          recentHistoryPages: existing?.recentHistoryPages ?? new Map<string, CachedHistoryPageRecord>()
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
        audit.write({
          action: "device.connect",
          at: Date.now(),
          deviceId,
          outcome: "success",
          meta: {
            hostname: payload.hostname,
            platform: payload.platform,
            arch: payload.arch
          }
        });
        broadcastUpsert(userNamespace, next.info);
        ack({
          ok: true,
          serverTime: Date.now(),
          heartbeatIntervalMs
        });
      }
    );

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
      applyMachineEventState(device, payload.event);
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
      audit.write({
        action: "device.disconnect",
        at: device.info.lastSeenAt,
        deviceId: registeredDeviceId,
        outcome: "success"
      });
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
    if (!consumeRateLimit(rateLimits, `auth-session:${request.ip}`, 12, 5 * 60_000)) {
      reply.code(429);
      return { error: "Rate limit exceeded" };
    }
    if (readBearerToken(request) !== options.ownerToken) {
      audit.write({
        action: "relay.session.issue",
        at: Date.now(),
        outcome: "failure",
        reason: "invalid_owner_token",
        meta: { ip: request.ip }
      });
      reply.code(401);
      return { error: "Missing or invalid owner token" };
    }
    const sessionToken = issueBrowserSession();
    audit.write({
      action: "relay.session.issue",
      at: Date.now(),
      outcome: "success",
      meta: { ip: request.ip }
    });
    return {
      ok: true,
      sessionToken
    } satisfies RelaySessionResponse;
  });

  app.post("/api/auth/logout", async (request, reply) => {
    const accessToken = requestAccessToken(request);
    if (!isUserAccessToken(accessToken)) {
      reply.code(401);
      return { error: "Missing or invalid user token" };
    }
    if (accessToken) {
      revokeBrowserSession(accessToken);
    }
    audit.write({
      action: "relay.session.revoke",
      at: Date.now(),
      outcome: "success",
      meta: { ip: request.ip }
    });
    return { ok: true };
  });

  app.post("/api/pairings/device", async (request, reply) => {
    const body = request.body as PairingRequestPayload;
    if (!consumeRateLimit(rateLimits, `pairing:create:ip:${request.ip}`, 8, 5 * 60_000)) {
      reply.code(429);
      return { error: "Rate limit exceeded" };
    }
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
    if (!consumeRateLimit(rateLimits, `pairing:create:device:${body.deviceId}`, 4, 5 * 60_000)) {
      reply.code(429);
      return { error: "Rate limit exceeded" };
    }

    const codeDigits = randomDigits(6);
    const requestId = randomUUID();
    const createdAt = Date.now();
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
      codexVersion: body.codexVersion ?? null,
      relayUrl: body.relayUrl ?? null,
      shortFingerprint: buildShortFingerprint(body.deviceId, body.hostname, body.platform, body.arch),
      createdAt,
      expiresAt: createdAt + DEFAULT_PAIRING_TTL_MS,
      status: "pending",
      pollToken: randomBytes(18).toString("base64url"),
      consumedAt: null
    };
    pairings.set(record.requestId, record);
    audit.write({
      action: "pairing.create",
      at: createdAt,
      deviceId: record.deviceId,
      outcome: "success",
      meta: {
        hostname: record.hostname,
        shortFingerprint: record.shortFingerprint
      }
    });
    return {
      requestId: record.requestId,
      pollToken: record.pollToken,
      code: record.code,
      codeDigits: record.codeDigits,
      expiresAt: record.expiresAt,
      approveUrl: buildPairApproveUrl(
        options.publicWebOrigin ?? "",
        allowedOrigins,
        record.codeDigits
      )
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
    if (status !== "pending" && pairing.consumedAt === null) {
      pairing.consumedAt = Date.now();
    }
    return {
      ok: true,
      status,
      deviceId: pairing.deviceId,
      expiresAt: pairing.expiresAt
    } satisfies PairingPollResponse;
  });

  app.get("/api/pairings/requests/:code", async (request, reply) => {
    if (!consumeRateLimit(rateLimits, `pairing:lookup:ip:${request.ip}`, 30, 5 * 60_000)) {
      reply.code(429);
      return { error: "Rate limit exceeded" };
    }
    const params = request.params as { code: string };
    const pairing = pairingForCode(pairings, params.code);
    if (!pairing) {
      reply.code(404);
      return { error: "Pairing request not found" };
    }
    const status = resolvePairingStatus(pairing);
    pairing.status = status;
    return toPairingView(pairing);
  });

  app.post("/api/pairings/requests/:code/approve", async (request, reply) => {
    if (!consumeRateLimit(rateLimits, `pairing:decision:ip:${request.ip}`, 20, 5 * 60_000)) {
      reply.code(429);
      return { error: "Rate limit exceeded" };
    }
    if (!requireUserAccess(request, reply)) {
      return { error: "Missing or invalid user token" };
    }
    const params = request.params as { code: string };
    const pairing = pairingForCode(pairings, params.code);
    if (!pairing) {
      reply.code(404);
      return { error: "Pairing request not found" };
    }
    const status = resolvePairingStatus(pairing);
    if (status !== "pending") {
      reply.code(status === "expired" ? 410 : 409);
      return { error: `Pairing request is ${status}` };
    }
    const now = Date.now();
    pairing.status = "approved";
    pairing.consumedAt = now;
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
      createdAt: now,
      updatedAt: now,
      revokedAt: null
    });
    audit.write({
      action: "pairing.approve",
      at: now,
      deviceId: pairing.deviceId,
      outcome: "success",
      meta: { shortFingerprint: pairing.shortFingerprint }
    });
    return {
      ok: true,
      deviceId: pairing.deviceId,
      sessionToken: issueBrowserSession()
    } satisfies PairingApproveResponse;
  });

  app.post("/api/pairings/requests/:code/reject", async (request, reply) => {
    if (!consumeRateLimit(rateLimits, `pairing:decision:ip:${request.ip}`, 20, 5 * 60_000)) {
      reply.code(429);
      return { error: "Rate limit exceeded" };
    }
    if (!requireUserAccess(request, reply)) {
      return { error: "Missing or invalid user token" };
    }
    const params = request.params as { code: string };
    const pairing = pairingForCode(pairings, params.code);
    if (!pairing) {
      reply.code(404);
      return { error: "Pairing request not found" };
    }
    const status = resolvePairingStatus(pairing);
    if (status !== "pending") {
      reply.code(status === "expired" ? 410 : 409);
      return { error: `Pairing request is ${status}` };
    }
    pairing.status = "rejected";
    pairing.consumedAt = Date.now();
    audit.write({
      action: "pairing.reject",
      at: pairing.consumedAt,
      deviceId: pairing.deviceId,
      outcome: "success",
      meta: { shortFingerprint: pairing.shortFingerprint }
    });
    return { ok: true };
  });

  app.get("/api/devices", async (request, reply) => {
    if (!requireUserAccess(request, reply)) {
      return { error: "Missing or invalid user token" };
    }
    return {
      devices: sortedDevices(devices).map((device) => device.info)
    };
  });

  app.delete("/api/devices/:deviceId", async (request, reply) => {
    if (!requireUserAccess(request, reply)) {
      return { error: "Missing or invalid user token" };
    }
    const params = request.params as { deviceId: string };
    const revoked = registry.revoke(params.deviceId);
    if (!revoked) {
      reply.code(404);
      return { error: "Device not found" };
    }
    const connected = devices.get(params.deviceId);
    if (connected?.socket) {
      connected.socket.disconnect(true);
    }
    if (connected) {
      connected.info = {
        ...connected.info,
        online: false,
        lastSeenAt: Date.now()
      };
      userNamespace.emit("device:offline", {
        deviceId: connected.info.deviceId,
        lastSeenAt: connected.info.lastSeenAt
      });
      devices.delete(params.deviceId);
    }
    audit.write({
      action: "device.revoke",
      at: Date.now(),
      deviceId: params.deviceId,
      outcome: "success"
    });
    return { ok: true };
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
    handleRpcRequest(request, reply, {
      devices,
      isUserAccessToken,
      method: RelayMethodValue.AgentHealth,
      params: undefined,
      timeoutMs: rpcTimeoutMs,
      audit,
      allowRelayFullAccess: options.allowRelayFullAccess
    })
  );

  app.get("/api/relay/devices/:deviceId/sessions", async (request, reply) =>
    handleRpcRequest(request, reply, {
      devices,
      isUserAccessToken,
      method: RelayMethodValue.SessionsList,
      params: undefined,
      timeoutMs: rpcTimeoutMs,
      audit,
      allowRelayFullAccess: options.allowRelayFullAccess
    })
  );

  app.post("/api/relay/devices/:deviceId/sessions", async (request, reply) =>
    handleRpcRequest(request, reply, {
      devices,
      isUserAccessToken,
      method: RelayMethodValue.SessionsCreate,
      params: request.body,
      timeoutMs: routeRpcTimeout(RelayMethodValue.SessionsCreate, rpcTimeoutMs),
      audit,
      allowRelayFullAccess: options.allowRelayFullAccess
    })
  );

  app.post("/api/relay/devices/:deviceId/sessions/:sessionId/messages", async (request, reply) => {
    const params = request.params as { sessionId: string };
    return handleRpcRequest(request, reply, {
      devices,
      isUserAccessToken,
      method: RelayMethodValue.SessionsMessage,
      params: { sessionId: params.sessionId, body: request.body },
      timeoutMs: rpcTimeoutMs,
      audit,
      allowRelayFullAccess: options.allowRelayFullAccess
    });
  });

  app.get("/api/relay/devices/:deviceId/sessions/:sessionId/goal", async (request, reply) => {
    const params = request.params as { sessionId: string };
    return handleRpcRequest(request, reply, {
      devices,
      isUserAccessToken,
      method: RelayMethodValue.SessionsGoalGet,
      params: { sessionId: params.sessionId },
      timeoutMs: rpcTimeoutMs,
      audit,
      allowRelayFullAccess: options.allowRelayFullAccess
    });
  });

  app.post("/api/relay/devices/:deviceId/sessions/:sessionId/goal", async (request, reply) => {
    const params = request.params as { sessionId: string };
    return handleRpcRequest(request, reply, {
      devices,
      isUserAccessToken,
      method: RelayMethodValue.SessionsGoalSet,
      params: { sessionId: params.sessionId, body: request.body },
      timeoutMs: rpcTimeoutMs,
      audit,
      allowRelayFullAccess: options.allowRelayFullAccess
    });
  });

  app.delete("/api/relay/devices/:deviceId/sessions/:sessionId/goal", async (request, reply) => {
    const params = request.params as { sessionId: string };
    return handleRpcRequest(request, reply, {
      devices,
      isUserAccessToken,
      method: RelayMethodValue.SessionsGoalClear,
      params: { sessionId: params.sessionId },
      timeoutMs: rpcTimeoutMs,
      audit,
      allowRelayFullAccess: options.allowRelayFullAccess
    });
  });

  app.post(
    "/api/relay/devices/:deviceId/sessions/:sessionId/turns/:turnId/interrupt",
    async (request, reply) => {
      const params = request.params as { sessionId: string; turnId: string };
      return handleRpcRequest(request, reply, {
        devices,
        isUserAccessToken,
        method: RelayMethodValue.TurnInterrupt,
        params: { sessionId: params.sessionId, turnId: params.turnId },
        timeoutMs: rpcTimeoutMs,
        audit,
        allowRelayFullAccess: options.allowRelayFullAccess
      });
    }
  );

  app.post("/api/relay/devices/:deviceId/approvals/:approvalId/decision", async (request, reply) => {
    const params = request.params as { approvalId: string };
    return handleRpcRequest(request, reply, {
      devices,
      isUserAccessToken,
      method: RelayMethodValue.ApprovalDecision,
      params: { approvalId: params.approvalId, body: request.body },
      timeoutMs: rpcTimeoutMs,
      audit,
      allowRelayFullAccess: options.allowRelayFullAccess
    });
  });

  app.get("/api/relay/devices/:deviceId/directories", async (request, reply) => {
    const query = request.query as { path?: string };
    return handleRpcRequest(request, reply, {
      devices,
      isUserAccessToken,
      method: RelayMethodValue.DirectoriesList,
      params: { path: query.path },
      timeoutMs: rpcTimeoutMs,
      audit,
      allowRelayFullAccess: options.allowRelayFullAccess
    });
  });

  app.get("/api/relay/devices/:deviceId/codex-history", async (request, reply) => {
    const query = request.query as { limit?: string; search?: string };
    return handleRpcRequest(request, reply, {
      devices,
      isUserAccessToken,
      method: RelayMethodValue.CodexHistoryList,
      params: {
        limit: query.limit ? Number(query.limit) : undefined,
        search: query.search
      },
      timeoutMs: rpcTimeoutMs,
      audit,
      allowRelayFullAccess: options.allowRelayFullAccess
    });
  });

  app.get("/api/relay/devices/:deviceId/codex-history/loaded", async (request, reply) => {
    if (!requireUserAccess(request, reply)) {
      return { error: "Missing or invalid user token" };
    }
    const { deviceId } = request.params as { deviceId: string };
    try {
      const result = (await invokeMachineRpc(
        devices,
        deviceId,
        RelayMethodValue.CodexHistoryLoaded,
        undefined,
        rpcTimeoutMs
      )) as LocalLoadedThreadsResponse;
      const device = devices.get(deviceId);
      if (device) {
        device.loadedThreadIds = new Set(result.threadIds);
      }
      audit.write({
        action: "relay.rpc",
        at: Date.now(),
        deviceId,
        method: RelayMethodValue.CodexHistoryLoaded,
        outcome: "success"
      });
      return result;
    } catch (error) {
      return replyWithRpcError(reply, audit, deviceId, RelayMethodValue.CodexHistoryLoaded, error);
    }
  });

  app.get("/api/relay/devices/:deviceId/codex-history/detail", async (request, reply) => {
    const query = request.query as { id?: string; cwd?: string };
    return handleRpcRequest(request, reply, {
      devices,
      isUserAccessToken,
      method: RelayMethodValue.CodexHistoryDetail,
      params: {
        id: query.id,
        cwd: query.cwd
      },
      timeoutMs: routeRpcTimeout(RelayMethodValue.CodexHistoryDetail, rpcTimeoutMs),
      audit,
      allowRelayFullAccess: options.allowRelayFullAccess
    });
  });

  app.get("/api/relay/devices/:deviceId/codex-history/turns", async (request, reply) => {
    const query = request.query as {
      id?: string;
      cwd?: string;
      cursor?: string;
      limit?: string;
      sortDirection?: string;
      itemsView?: string;
    };
    if (!requireUserAccess(request, reply)) {
      return { error: "Missing or invalid user token" };
    }
    const { deviceId } = request.params as { deviceId: string };
    const params = {
      id: query.id,
      cwd: query.cwd,
      cursor: query.cursor,
      limit: query.limit ? Number(query.limit) : undefined,
      sortDirection: query.sortDirection,
      itemsView: query.itemsView
    };
    try {
      const cached = readCachedHistoryPage(devices.get(deviceId) ?? null, params);
      if (cached) {
        audit.write({
          action: "relay.rpc.cache_hit",
          at: Date.now(),
          deviceId,
          method: RelayMethodValue.CodexHistoryTurns,
          outcome: "success"
        });
        return cached.page;
      }
      const result = (await invokeMachineRpc(
        devices,
        deviceId,
        RelayMethodValue.CodexHistoryTurns,
        params,
        routeRpcTimeout(RelayMethodValue.CodexHistoryTurns, rpcTimeoutMs)
      )) as LocalCodexHistoryPageResponse;
      writeCachedHistoryPage(devices.get(deviceId) ?? null, params, result);
      audit.write({
        action: "relay.rpc",
        at: Date.now(),
        deviceId,
        method: RelayMethodValue.CodexHistoryTurns,
        outcome: "success"
      });
      return result;
    } catch (error) {
      return replyWithRpcError(reply, audit, deviceId, RelayMethodValue.CodexHistoryTurns, error);
    }
  });

  app.post("/api/relay/devices/:deviceId/codex-history/archive", async (request, reply) => {
    if (!requireUserAccess(request, reply)) {
      return { error: "Missing or invalid user token" };
    }
    const { deviceId } = request.params as { deviceId: string };
    const body = isRecordLike(request.body) ? request.body : {};
    try {
      const result = await invokeMachineRpc(
        devices,
        deviceId,
        RelayMethodValue.CodexHistoryArchive,
        body,
        rpcTimeoutMs
      );
      const threadId = typeof body.id === "string" ? body.id.trim() : "";
      const device = devices.get(deviceId);
      if (device && threadId) {
        device.loadedThreadIds.delete(threadId);
        dropCachedHistoryPagesForThread(device, threadId);
      }
      audit.write({
        action: "relay.rpc",
        at: Date.now(),
        deviceId,
        method: RelayMethodValue.CodexHistoryArchive,
        outcome: "success"
      });
      return result;
    } catch (error) {
      return replyWithRpcError(reply, audit, deviceId, RelayMethodValue.CodexHistoryArchive, error);
    }
  });

  app.post("/api/relay/devices/:deviceId/codex-history/resume", async (request, reply) => {
    if (!requireUserAccess(request, reply)) {
      return { error: "Missing or invalid user token" };
    }
    if (!options.allowRelayFullAccess && requestsRelayFullAccess(RelayMethodValue.CodexHistoryResume, request.body)) {
      audit.write({
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
      const result = await invokeMachineRpc(
        devices,
        deviceId,
        RelayMethodValue.CodexHistoryResume,
        request.body,
        routeRpcTimeout(RelayMethodValue.CodexHistoryResume, rpcTimeoutMs)
      );
      if (isHistoryResumeResult(result)) {
        writeCachedHistoryPage(
          devices.get(deviceId) ?? null,
          {
            id: result.history.entry.id,
            cwd: result.history.entry.cwd,
            limit: 40,
            sortDirection: "desc",
            itemsView: "summary"
          },
          result.history
        );
        const device = devices.get(deviceId);
        if (device) {
          device.loadedThreadIds.add(result.history.entry.id);
        }
      }
      audit.write({
        action: "relay.rpc",
        at: Date.now(),
        deviceId,
        method: RelayMethodValue.CodexHistoryResume,
        outcome: "success"
      });
      return result;
    } catch (error) {
      return replyWithRpcError(reply, audit, deviceId, RelayMethodValue.CodexHistoryResume, error);
    }
  });

  return {
    app,
    io,
    close: async () => {
      clearInterval(pruneTimer);
      await io.close();
      await app.close();
    }
  };
}

async function handleRpcRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  input: {
    devices: Map<string, RegisteredDevice>;
    isUserAccessToken: (token: string | null | undefined) => boolean;
    method: RelayMethod;
    params: unknown;
    timeoutMs: number;
    audit: AuditLogger;
    allowRelayFullAccess: boolean;
  }
): Promise<unknown> {
  const accessToken = requestAccessToken(request);
  if (!input.isUserAccessToken(accessToken)) {
    reply.code(401);
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
    input.audit.write({
      action:
        input.method === RelayMethodValue.ApprovalDecision
          ? "approval.decision"
          : "relay.rpc",
      at: Date.now(),
      deviceId,
      method: input.method,
      outcome: "success",
      ...(approvalDecisionMeta(input.method, input.params)
        ? { meta: approvalDecisionMeta(input.method, input.params)! }
        : {})
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    input.audit.write({
      action: "relay.rpc",
      at: Date.now(),
      deviceId,
      method: input.method,
      outcome: "failure",
      reason: message
    });
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
    throw new Error(
      `relay rpc timeout: ${error instanceof Error ? error.message : String(error)}`
    );
  });

  if (!response.ok) {
    throw new Error(response.error.message);
  }
  return response.result;
}

function normalizeControlOptions(options: ControlServerOptions) {
  const normalizedOrigins =
    options.allowedOrigins?.map((origin) => origin.trim()).filter(Boolean) ?? [];
  const publicWebOrigin = options.publicWebOrigin?.trim() || "";
  if (options.production && normalizedOrigins.length === 0) {
    throw new Error("Production relay requires at least one explicit allowed origin.");
  }
  return {
    ...options,
    publicWebOrigin,
    heartbeatIntervalMs: options.heartbeatIntervalMs ?? 15_000,
    rpcTimeoutMs: options.rpcTimeoutMs ?? 30_000,
    browserSessionTtlMs: options.browserSessionTtlMs ?? DEFAULT_BROWSER_SESSION_TTL_MS,
    browserSessionIdleMs: options.browserSessionIdleMs ?? DEFAULT_BROWSER_SESSION_IDLE_MS,
    pruneIntervalMs: options.pruneIntervalMs ?? DEFAULT_PRUNE_INTERVAL_MS,
    allowedOrigins: normalizedOrigins,
    production: options.production ?? false,
    allowMachineOwnerToken:
      options.allowMachineOwnerToken ?? !(options.production ?? false),
    allowRelayFullAccess: resolveRelayFullAccessSetting(options.allowRelayFullAccess)
  };
}

function routeRpcTimeout(
  method: RelayMethod,
  defaultTimeoutMs: number
): number {
  switch (method) {
    case RelayMethodValue.SessionsCreate:
    case RelayMethodValue.CodexHistoryDetail:
    case RelayMethodValue.CodexHistoryTurns:
    case RelayMethodValue.CodexHistoryResume:
      return Math.max(defaultTimeoutMs, DEFAULT_SLOW_RPC_TIMEOUT_MS);
    default:
      return defaultTimeoutMs;
  }
}

function buildPairApproveUrl(
  publicWebOrigin: string,
  allowedOrigins: string[],
  codeDigits: string
): string | null {
  const baseOrigin = publicWebOrigin || allowedOrigins[0] || "";
  if (!baseOrigin) {
    return null;
  }
  try {
    const url = new URL("/pair", baseOrigin);
    url.searchParams.set("code", codeDigits);
    return url.toString();
  } catch {
    return null;
  }
}

function resolveRelayFullAccessSetting(
  explicit: boolean | undefined
): boolean {
  if (explicit !== undefined) {
    return explicit;
  }
  if (process.env.CODEXNEXT_DISABLE_RELAY_FULL_ACCESS === "1") {
    return false;
  }
  if (process.env.CODEXNEXT_ALLOW_RELAY_FULL_ACCESS === "0") {
    return false;
  }
  return true;
}

function pruneBrowserSessions(
  sessions: Map<string, BrowserSessionRecord>,
  audit: AuditLogger,
  idleTimeoutMs: number
): void {
  const now = Date.now();
  for (const [tokenHash, session] of sessions.entries()) {
    if (
      session.revokedAt ||
      session.expiresAt <= now ||
      session.lastUsedAt + idleTimeoutMs <= now
    ) {
      sessions.delete(tokenHash);
      audit.write({
        action: "relay.session.prune",
        at: now,
        outcome: "success"
      });
    }
  }
}

function prunePairings(
  pairings: Map<string, PairingRequestRecord>,
  audit: AuditLogger
): void {
  const now = Date.now();
  for (const [requestId, pairing] of pairings.entries()) {
    const status = resolvePairingStatus(pairing);
    pairing.status = status;
    if (status === "expired" && pairing.consumedAt === null) {
      pairing.consumedAt = now;
      audit.write({
        action: "pairing.expire",
        at: now,
        deviceId: pairing.deviceId,
        outcome: "success",
        meta: { shortFingerprint: pairing.shortFingerprint }
      });
    }
    if (
      pairing.consumedAt !== null &&
      now - pairing.consumedAt >= 60_000
    ) {
      pairings.delete(requestId);
    }
  }
}

function pruneRateLimits(rateLimits: Map<string, RateLimitRecord>): void {
  const now = Date.now();
  for (const [key, value] of rateLimits.entries()) {
    if (value.resetAt <= now) {
      rateLimits.delete(key);
    }
  }
}

function consumeRateLimit(
  rateLimits: Map<string, RateLimitRecord>,
  key: string,
  limit: number,
  windowMs: number
): boolean {
  const now = Date.now();
  const existing = rateLimits.get(key);
  const current =
    existing && existing.resetAt > now
      ? existing
      : { count: 0, resetAt: now + windowMs };
  current.count += 1;
  rateLimits.set(key, current);
  return current.count <= limit;
}

function hashBrowserSessionToken(ownerToken: string, token: string): string {
  return createHash("sha256")
    .update(ownerToken)
    .update(":browser-session:")
    .update(token)
    .digest("base64url");
}

function createOriginMatcher(allowedOrigins: string[], production: boolean) {
  return (origin: string | undefined): boolean => {
    if (!origin) {
      return true;
    }
    if (allowedOrigins.includes(origin)) {
      return true;
    }
    return !production && allowedOrigins.length === 0;
  };
}

function pairingForCode(
  pairings: Map<string, PairingRequestRecord>,
  code: string
): PairingRequestRecord | null {
  return (
    [...pairings.values()].find(
      (pairing) => pairing.codeDigits === normalizePairCode(code)
    ) ?? null
  );
}

function requestsRelayFullAccess(method: RelayMethod, params: unknown): boolean {
  if (
    method !== RelayMethodValue.SessionsCreate &&
    method !== RelayMethodValue.CodexHistoryResume
  ) {
    return false;
  }
  if (!isRecord(params)) {
    return false;
  }
  return (
    params.permissionMode === "full-access" ||
    (params.sandbox === "danger-full-access" && params.approvalPolicy === "never")
  );
}

function approvalDecisionMeta(method: RelayMethod, params: unknown): Record<string, unknown> | undefined {
  if (method !== RelayMethodValue.ApprovalDecision || !isRecord(params) || !isRecord(params.body)) {
    return undefined;
  }
  if (typeof params.body.decision !== "string") {
    return undefined;
  }
  return { decision: params.body.decision };
}

function applyMachineEventState(device: RegisteredDevice, event: { type?: string; threadId?: string; payload?: unknown }): void {
  if (event.type !== "thread.status.changed") {
    return;
  }
  const payload = isRecordLike(event.payload) ? event.payload : null;
  const threadId =
    typeof payload?.threadId === "string"
      ? payload.threadId
      : typeof event.threadId === "string"
        ? event.threadId
        : null;
  if (!threadId) {
    return;
  }
  const loaded = payload?.loaded !== false;
  if (loaded) {
    device.loadedThreadIds.add(threadId);
  } else {
    device.loadedThreadIds.delete(threadId);
    dropCachedHistoryPagesForThread(device, threadId);
  }
}

function readCachedHistoryPage(
  device: RegisteredDevice | null,
  params: {
    id?: string;
    cwd?: string;
    cursor?: string;
    limit?: number;
    sortDirection?: string;
    itemsView?: string;
  }
): CachedHistoryPageRecord | null {
  if (!device) {
    return null;
  }
  const cacheKey = buildRecentHistoryPageCacheKey(params);
  if (!cacheKey) {
    return null;
  }
  const record = device.recentHistoryPages.get(cacheKey) ?? null;
  if (!record) {
    return null;
  }
  if (Date.now() - record.fetchedAt > DEFAULT_RECENT_HISTORY_CACHE_TTL_MS) {
    device.recentHistoryPages.delete(cacheKey);
    return null;
  }
  return record;
}

function writeCachedHistoryPage(
  device: RegisteredDevice | null,
  params: {
    id?: string;
    cwd?: string;
    cursor?: string;
    limit?: number;
    sortDirection?: string;
    itemsView?: string;
  },
  page: LocalCodexHistoryPageResponse
): void {
  if (!device) {
    return;
  }
  const cacheKey = buildRecentHistoryPageCacheKey(params);
  if (!cacheKey) {
    return;
  }
  device.recentHistoryPages.set(cacheKey, {
    fetchedAt: Date.now(),
    page
  });
}

function buildRecentHistoryPageCacheKey(params: {
  id?: string;
  cwd?: string;
  cursor?: string;
  limit?: number;
  sortDirection?: string;
  itemsView?: string;
}): string | null {
  if (!params.id || (params.cursor && params.cursor.trim())) {
    return null;
  }
  const limit =
    typeof params.limit === "number" && Number.isFinite(params.limit)
      ? Math.max(1, Math.floor(params.limit))
      : 40;
  const sortDirection = params.sortDirection === "asc" ? "asc" : "desc";
  const itemsView = params.itemsView === "full" ? "full" : "summary";
  const cwd = params.cwd?.trim() || "";
  return `${params.id}::${cwd}::${sortDirection}::${itemsView}::${limit}`;
}

function dropCachedHistoryPagesForThread(device: RegisteredDevice, threadId: string): void {
  for (const key of device.recentHistoryPages.keys()) {
    if (key.startsWith(`${threadId}::`)) {
      device.recentHistoryPages.delete(key);
    }
  }
}

function replyWithRpcError(
  reply: FastifyReply,
  audit: AuditLogger,
  deviceId: string,
  method: RelayMethod,
  error: unknown
) {
  const message = error instanceof Error ? error.message : String(error);
  audit.write({
    action: "relay.rpc",
    at: Date.now(),
    deviceId,
    method,
    outcome: "failure",
    reason: message
  });
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

function isHistoryResumeResult(value: unknown): value is { history: LocalCodexHistoryPageResponse } {
  return (
    isRecordLike(value) &&
    isRecordLike(value.history) &&
    Array.isArray(value.history.messages) &&
    isRecordLike(value.history.entry)
  );
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
    store: new DeviceEventStore(limit !== undefined ? { limit } : {}),
    loadedThreadIds: new Set<string>(),
    recentHistoryPages: new Map<string, CachedHistoryPageRecord>()
  };
  devices.set(deviceId, created);
  return created;
}

function resolvePairingStatus(
  pairing: PairingRequestRecord
): PairingRequestRecord["status"] {
  if (pairing.status === "approved" || pairing.status === "rejected") {
    return pairing.status;
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
    codexVersion: pairing.codexVersion ?? null,
    relayUrl: pairing.relayUrl ?? null,
    shortFingerprint: pairing.shortFingerprint,
    createdAt: pairing.createdAt,
    expiresAt: pairing.expiresAt,
    status: resolvePairingStatus(pairing)
  };
}

function buildShortFingerprint(
  deviceId: string,
  hostname: string,
  platform: string,
  arch: string
): string {
  const digest = createHash("sha256")
    .update(`${deviceId}:${hostname}:${platform}:${arch}`)
    .digest("hex");
  return digest.slice(0, 12);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
