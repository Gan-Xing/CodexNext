import cors from "@fastify/cors";
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest
} from "fastify";
import type { Server as HttpServer } from "node:http";
import { Server as SocketIoServer, type Namespace, type Socket } from "socket.io";
import type {
  DeviceEventPayload,
  MachineEventPayload,
  MachineHeartbeatPayload,
  MachineHelloAck,
  MachineHelloPayload,
  RelayDeviceRecord,
  RelayErrorAck,
  RelayUserAuth
} from "@codexnext/protocol";
import {
  RelayNamespace,
  RelaySocketPath
} from "@codexnext/protocol";
import { requestAccessToken } from "./auth.js";
import { registerAuthRoutes } from "./auth-routes.js";
import { AuditLogger } from "./audit-log.js";
import { DeviceEventStore } from "./device-event-store.js";
import type {
  CachedHistoryPageRecord,
  HistoryPageCacheParams,
  RegisteredDevice
} from "./device-state.js";
import {
  DeviceRegistry,
  type RegisteredMachineRecord
} from "./device-registry.js";
import { SidebarPrefsStore } from "./sidebar-prefs-store.js";
import { registerDeviceRoutes } from "./device-routes.js";
import { registerPairingRoutes } from "./pairing-routes.js";
import {
  issueBrowserSession as issueBrowserSessionToken,
  pruneBrowserSessions,
  resolveBrowserSessionAccess,
  revokeBrowserSession as revokeBrowserSessionToken,
  type BrowserSessionRecord
} from "./browser-session.js";
import {
  consumeRateLimit,
  createOriginMatcher,
  pruneRateLimits,
  resolveRelayFullAccessSetting,
  type RateLimitRecord
} from "./control-policy.js";
import { registerRelayRoutes } from "./relay-routes.js";
import {
  resolvePairingStatus,
  type PairingRequestRecord
} from "./pairing.js";
import { devTrace } from "./dev-trace.js";

export { classifyRelayRpcError } from "./relay-rpc.js";

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
  staleDeviceTimeoutMs?: number;
  recentHistoryCacheTtlMs?: number;
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
const DEFAULT_SOCKET_MAX_PAYLOAD_BYTES = 8 * 1024 * 1024;
const DEFAULT_RECENT_HISTORY_CACHE_TTL_MS = 30_000;
const DEFAULT_STALE_HEARTBEAT_MULTIPLIER = 4;

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
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
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
  const sidebarPrefs = new SidebarPrefsStore();
  const browserSessions = new Map<string, BrowserSessionRecord>();
  const userSocketsByTokenHash = new Map<string, Set<Socket>>();
  const pairings = new Map<string, PairingRequestRecord>();
  const rateLimits = new Map<string, RateLimitRecord>();
  const heartbeatIntervalMs = options.heartbeatIntervalMs;
  const rpcTimeoutMs = options.rpcTimeoutMs;

  const userNamespace = io.of(RelayNamespace.User);
  const machineNamespace = io.of(RelayNamespace.Machine);

  const pruneTimer = setInterval(() => {
    const now = Date.now();
    for (const tokenHash of pruneBrowserSessions(
      browserSessions,
      options.browserSessionIdleMs,
      now
    )) {
      disconnectUserSocketsForTokenHash(tokenHash);
      audit.write({
        action: "relay.session.prune",
        at: now,
        outcome: "success"
      });
    }
    prunePairings(pairings, audit);
    pruneRateLimits(rateLimits);
    markStaleDevices(devices, userNamespace, audit, options.staleDeviceTimeoutMs);
  }, options.pruneIntervalMs);

  const issueBrowserSession = () => {
    return issueBrowserSessionToken(
      browserSessions,
      options.ownerToken,
      options.browserSessionTtlMs
    );
  };

  const revokeBrowserSession = (token: string | null | undefined): boolean => {
    const tokenHash = revokeBrowserSessionToken(
      browserSessions,
      options.ownerToken,
      token
    );
    if (!tokenHash) {
      return false;
    }
    disconnectUserSocketsForTokenHash(tokenHash);
    return true;
  };

  const resolveBrowserSessionAccessForToken = (token: string | null | undefined) => {
    const now = Date.now();
    const result = resolveBrowserSessionAccess(browserSessions, {
      ownerToken: options.ownerToken,
      token,
      production: options.production,
      idleTimeoutMs: options.browserSessionIdleMs,
      now
    });
    if (result.status === "expired") {
      disconnectUserSocketsForTokenHash(result.tokenHash);
      audit.write({
        action: "relay.session.expired",
        at: now,
        outcome: "denied"
      });
    }
    return result;
  };

  const isUserAccessToken = (token: string | null | undefined) => {
    const result = resolveBrowserSessionAccessForToken(token);
    return result.status === "owner-bypass" || result.status === "valid";
  };

  const disconnectUserSocketsForTokenHash = (tokenHash: string): void => {
    const sockets = userSocketsByTokenHash.get(tokenHash);
    if (!sockets) {
      return;
    }
    userSocketsByTokenHash.delete(tokenHash);
    for (const socket of sockets) {
      socket.disconnect(true);
    }
  };

  const trackUserSocket = (socket: Socket, tokenHash: string | null): void => {
    if (!tokenHash) {
      return;
    }
    const sockets = userSocketsByTokenHash.get(tokenHash) ?? new Set<Socket>();
    sockets.add(socket);
    userSocketsByTokenHash.set(tokenHash, sockets);
    socket.once("disconnect", () => {
      sockets.delete(socket);
      if (sockets.size === 0) {
        userSocketsByTokenHash.delete(tokenHash);
      }
    });
  };

  const authorizeUserSocket = (socket: Socket): boolean => {
    const auth = socket.handshake.auth as
      | (Partial<RelayUserAuth> & { sessionToken?: string })
      | undefined;
    const accessToken = auth?.sessionToken;
    if (!auth || auth.clientType !== "user") {
      return false;
    }
    const result = resolveBrowserSessionAccessForToken(accessToken);
    if (result.status === "owner-bypass") {
      socket.data.browserSessionTokenHash = null;
      return true;
    }
    if (result.status !== "valid") {
      return false;
    }
    socket.data.browserSessionTokenHash = result.tokenHash;
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
    if (!authorizeUserSocket(socket)) {
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
    trackUserSocket(
      socket,
      typeof socket.data.browserSessionTokenHash === "string"
        ? socket.data.browserSessionTokenHash
        : null
    );
    const lastSeqByDevice = auth?.lastSeqByDevice ?? {};
    const replayBatch: DeviceEventPayload[] = [];
    devTrace("user.socket.connected", {
      socketId: socket.id,
      requestedDevices: Object.keys(lastSeqByDevice).length
    });
    for (const device of sortedDevices(devices)) {
      socket.emit("device:upsert", device.info);
      const after = Number.isFinite(lastSeqByDevice[device.info.deviceId] ?? NaN)
        ? Math.max(0, Number(lastSeqByDevice[device.info.deviceId]))
        : 0;
      for (const event of device.store.after(after)) {
        replayBatch.push({
          deviceId: device.info.deviceId,
          event
        } satisfies DeviceEventPayload);
      }
    }
    if (replayBatch.length > 0) {
      devTrace("user.socket.replay", {
        socketId: socket.id,
        count: replayBatch.length,
        devices: [...new Set(replayBatch.map((item) => item.deviceId))].sort()
      });
      socket.emit("device:replay", replayBatch);
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
          agentRunId: payload.agentRunId,
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
        devTrace("machine.hello", {
          deviceId,
          socketId: socket.id,
          agentRunId: payload.agentRunId,
          codexVersion: payload.codexVersion ?? null
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
      if (!payload?.deviceId || !payload.agentRunId || !payload.event) {
        return;
      }
      const device =
        devices.get(payload.deviceId) ??
        registerEventOnlyDevice(
          devices,
          payload.deviceId,
          payload.agentRunId,
          socket,
          options.eventLimit
        );
      const appendResult = device.store.appendMachineEvent({
        agentRunId: payload.agentRunId,
        event: payload.event
      });
      if (appendResult.duplicate) {
        devTrace("machine.event.duplicate", {
          deviceId: payload.deviceId,
          agentRunId: payload.agentRunId,
          sourceSeq: payload.event.seq,
          type: payload.event.type
        });
        audit.write({
          action: "device.event.duplicate",
          at: Date.now(),
          deviceId: payload.deviceId,
          outcome: "denied",
          meta: {
            agentRunId: payload.agentRunId,
            sourceSeq: payload.event.seq
          }
        });
        return;
      }
      applyMachineEventState(device, appendResult.event);
      device.info = {
        ...device.info,
        agentRunId: payload.agentRunId,
        lastSeenAt: Date.now(),
        online: true,
        socketId: socket.id
      };
      userNamespace.emit("device:event", {
        deviceId: payload.deviceId,
        event: appendResult.event
      } satisfies DeviceEventPayload);
      devTrace("machine.event.forwarded", {
        deviceId: payload.deviceId,
        agentRunId: payload.agentRunId,
        seq: appendResult.event.seq,
        sourceSeq: payload.event.seq,
        type: appendResult.event.type,
        sessionId: appendResult.event.sessionId,
        threadId: appendResult.event.threadId,
        turnId: appendResult.event.turnId
      });
    });

    socket.on("disconnect", () => {
      if (!registeredDeviceId) {
        return;
      }
      const device = devices.get(registeredDeviceId);
      if (!device) {
        return;
      }
      const wasOnline = device.info.online;
      device.socket = null;
      const nextInfo = {
        ...device.info,
        online: false,
        lastSeenAt: Date.now()
      };
      delete nextInfo.socketId;
      device.info = nextInfo;
      audit.write({
        action: "device.disconnect",
        at: device.info.lastSeenAt,
        deviceId: registeredDeviceId,
        outcome: "success"
      });
      devTrace("machine.disconnected", {
        deviceId: registeredDeviceId,
        socketId: socket.id
      });
      if (wasOnline) {
        userNamespace.emit("device:offline", {
          deviceId: device.info.deviceId,
          lastSeenAt: device.info.lastSeenAt
        });
      }
    });
  });

  app.get("/api/control/health", async () => ({
    ok: true,
    onlineDevices: [...devices.values()].filter((device) => device.info.online).length,
    knownDevices: devices.size,
    registeredDevices: registry.all().length,
    uptimeSeconds: Math.floor(process.uptime()),
    version: "0.1.0",
    production: options.production
  }));

  registerAuthRoutes({
    app,
    audit,
    ownerToken: options.ownerToken,
    rateLimits,
    issueBrowserSession,
    revokeBrowserSession,
    isUserAccessToken
  });

  registerPairingRoutes({
    allowedOrigins,
    app,
    audit,
    issueBrowserSession,
    pairings,
    publicWebOrigin: options.publicWebOrigin ?? "",
    rateLimits,
    registry,
    requireUserAccess
  });

  registerDeviceRoutes({
    app,
    audit,
    devices,
    registry,
    requireUserAccess,
    sidebarPrefs,
    userNamespace
  });

  registerRelayRoutes({
    allowRelayFullAccess: options.allowRelayFullAccess,
    app,
    audit,
    devices,
    dropCachedHistoryPagesForThread,
    readCachedHistoryPage,
    recentHistoryCacheTtlMs: options.recentHistoryCacheTtlMs,
    requireUserAccess,
    rpcTimeoutMs,
    writeCachedHistoryPage
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
    staleDeviceTimeoutMs:
      options.staleDeviceTimeoutMs ??
      (options.heartbeatIntervalMs ?? 15_000) * DEFAULT_STALE_HEARTBEAT_MULTIPLIER,
    recentHistoryCacheTtlMs:
      options.recentHistoryCacheTtlMs ?? DEFAULT_RECENT_HISTORY_CACHE_TTL_MS,
    allowedOrigins: normalizedOrigins,
    production: options.production ?? false,
    allowMachineOwnerToken:
      options.allowMachineOwnerToken ?? !(options.production ?? false),
    allowRelayFullAccess: resolveRelayFullAccessSetting(options.allowRelayFullAccess)
  };
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
  params: HistoryPageCacheParams,
  ttlMs: number
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
  if (Date.now() - record.fetchedAt > ttlMs) {
    device.recentHistoryPages.delete(cacheKey);
    return null;
  }
  return record;
}

function writeCachedHistoryPage(
  device: RegisteredDevice | null,
  params: HistoryPageCacheParams,
  page: CachedHistoryPageRecord["page"]
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

function buildRecentHistoryPageCacheKey(params: HistoryPageCacheParams): string | null {
  if (!params.id) {
    return null;
  }
  const limit =
    typeof params.limit === "number" && Number.isFinite(params.limit)
      ? Math.max(1, Math.floor(params.limit))
      : 40;
  const sortDirection = params.sortDirection === "asc" ? "asc" : "desc";
  const itemsView = params.itemsView === "full" ? "full" : "summary";
  const cwd = params.cwd?.trim() || "";
  const cursor = params.cursor?.trim() || "latest";
  return `${params.id}::${cwd}::${sortDirection}::${itemsView}::${limit}::${cursor}`;
}

function dropCachedHistoryPagesForThread(device: RegisteredDevice, threadId: string): void {
  for (const key of device.recentHistoryPages.keys()) {
    if (key.startsWith(`${threadId}::`)) {
      device.recentHistoryPages.delete(key);
    }
  }
}

function markStaleDevices(
  devices: Map<string, RegisteredDevice>,
  userNamespace: Namespace,
  audit: AuditLogger,
  staleDeviceTimeoutMs: number
): void {
  const now = Date.now();
  for (const device of devices.values()) {
    if (!device.info.online || now - device.info.lastSeenAt <= staleDeviceTimeoutMs) {
      continue;
    }
    device.socket = null;
    const nextInfo = {
      ...device.info,
      online: false,
      lastSeenAt: now
    };
    delete nextInfo.socketId;
    device.info = nextInfo;
    audit.write({
      action: "device.presence.stale",
      at: now,
      deviceId: device.info.deviceId,
      outcome: "success"
    });
    userNamespace.emit("device:offline", {
      deviceId: device.info.deviceId,
      lastSeenAt: device.info.lastSeenAt
    });
  }
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function registerEventOnlyDevice(
  devices: Map<string, RegisteredDevice>,
  deviceId: string,
  agentRunId: string,
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
      agentRunId,
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
