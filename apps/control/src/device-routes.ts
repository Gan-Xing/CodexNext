import type { RelayDeviceRecord } from "@codexnext/protocol";
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest
} from "fastify";
import type { Namespace, Socket } from "socket.io";
import type { AuditLogger } from "./audit-log.js";
import type { DeviceRegistry } from "./device-registry.js";
import {
  SidebarPrefsStore,
  type StoredProjectSidebarPrefs,
  type StoredThreadSidebarPrefs
} from "./sidebar-prefs-store.js";

export interface DeviceRouteRecord {
  info: RelayDeviceRecord;
  socket: Socket | null;
}

export interface DeviceRouteDependencies {
  app: FastifyInstance;
  audit: AuditLogger;
  devices: Map<string, DeviceRouteRecord>;
  registry: DeviceRegistry;
  requireUserAccess: (request: FastifyRequest, reply: FastifyReply) => boolean;
  sidebarPrefs: SidebarPrefsStore;
  userNamespace: Namespace;
}

export function registerDeviceRoutes(input: DeviceRouteDependencies): void {
  input.app.get("/api/devices", async (request, reply) => {
    if (!input.requireUserAccess(request, reply)) {
      return { error: "Missing or invalid user token" };
    }
    return {
      devices: sortedDevices(input.devices).map((device) => device.info)
    };
  });

  input.app.delete("/api/devices/:deviceId", async (request, reply) => {
    if (!input.requireUserAccess(request, reply)) {
      return { error: "Missing or invalid user token" };
    }
    const params = request.params as { deviceId: string };
    const revoked = input.registry.revoke(params.deviceId);
    if (!revoked) {
      reply.code(404);
      return { error: "Device not found" };
    }
    const connected = input.devices.get(params.deviceId);
    if (connected?.socket) {
      connected.socket.disconnect(true);
    }
    if (connected) {
      connected.info = {
        ...connected.info,
        online: false,
        lastSeenAt: Date.now()
      };
      input.userNamespace.emit("device:offline", {
        deviceId: connected.info.deviceId,
        lastSeenAt: connected.info.lastSeenAt
      });
      input.devices.delete(params.deviceId);
    }
    input.audit.write({
      action: "device.revoke",
      at: Date.now(),
      deviceId: params.deviceId,
      outcome: "success"
    });
    return { ok: true };
  });

  input.app.get("/api/devices/:deviceId/sidebar-prefs", async (request, reply) => {
    if (!input.requireUserAccess(request, reply)) {
      return { error: "Missing or invalid user token" };
    }
    const params = request.params as { deviceId: string };
    if (!input.registry.get(params.deviceId) && !input.devices.has(params.deviceId)) {
      reply.code(404);
      return { error: "Device not found" };
    }
    const prefs = input.sidebarPrefs.get(params.deviceId);
    input.audit.write({
      action: "sidebar-prefs.read",
      at: Date.now(),
      deviceId: params.deviceId,
      outcome: "success"
    });
    return {
      project: prefs.project,
      thread: prefs.thread
    };
  });

  input.app.put("/api/devices/:deviceId/sidebar-prefs", async (request, reply) => {
    if (!input.requireUserAccess(request, reply)) {
      return { error: "Missing or invalid user token" };
    }
    const params = request.params as { deviceId: string };
    if (!input.registry.get(params.deviceId) && !input.devices.has(params.deviceId)) {
      reply.code(404);
      return { error: "Device not found" };
    }
    const body = (request.body ?? {}) as {
      project?: unknown;
      thread?: unknown;
    };
    const prefs = input.sidebarPrefs.upsert(params.deviceId, {
      ...(body.project !== undefined
        ? { project: body.project as StoredProjectSidebarPrefs }
        : {}),
      ...(body.thread !== undefined
        ? { thread: body.thread as StoredThreadSidebarPrefs }
        : {})
    });
    input.audit.write({
      action: "sidebar-prefs.write",
      at: Date.now(),
      deviceId: params.deviceId,
      outcome: "success"
    });
    return {
      project: prefs.project,
      thread: prefs.thread
    };
  });
}

function sortedDevices(
  devices: Map<string, DeviceRouteRecord>
): DeviceRouteRecord[] {
  return [...devices.values()].sort((left, right) => {
    if (left.info.online !== right.info.online) {
      return left.info.online ? -1 : 1;
    }
    return right.info.lastSeenAt - left.info.lastSeenAt;
  });
}
