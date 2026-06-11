import { randomBytes, randomUUID } from "node:crypto";
import type {
  PairingApproveResponse,
  PairingCreateResponse,
  PairingPollResponse,
  PairingRequestPayload
} from "@codexnext/protocol";
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest
} from "fastify";
import type { AuditLogger } from "./audit-log.js";
import type { DeviceRegistry } from "./device-registry.js";
import { consumeRateLimit, type RateLimitRecord } from "./control-policy.js";
import {
  buildShortFingerprint,
  pairingForCode,
  randomDigits,
  resolvePairingStatus,
  toPairingView,
  type PairingRequestRecord
} from "./pairing.js";

const DEFAULT_PAIRING_TTL_MS = 15 * 60_000;

export interface PairingRouteDependencies {
  allowedOrigins: string[];
  app: FastifyInstance;
  audit: AuditLogger;
  issueBrowserSession: () => string;
  pairings: Map<string, PairingRequestRecord>;
  publicWebOrigin: string;
  rateLimits: Map<string, RateLimitRecord>;
  registry: DeviceRegistry;
  requireUserAccess: (request: FastifyRequest, reply: FastifyReply) => boolean;
}

export function registerPairingRoutes(input: PairingRouteDependencies): void {
  input.app.post("/api/pairings/device", async (request, reply) => {
    const body = request.body as PairingRequestPayload;
    if (!consumeRateLimit(input.rateLimits, `pairing:create:ip:${request.ip}`, 8, 5 * 60_000)) {
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
    if (
      !consumeRateLimit(
        input.rateLimits,
        `pairing:create:device:${body.deviceId}`,
        4,
        5 * 60_000
      )
    ) {
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
      shortFingerprint: buildShortFingerprint(
        body.deviceId,
        body.hostname,
        body.platform,
        body.arch
      ),
      createdAt,
      expiresAt: createdAt + DEFAULT_PAIRING_TTL_MS,
      status: "pending",
      pollToken: randomBytes(18).toString("base64url"),
      consumedAt: null
    };
    input.pairings.set(record.requestId, record);
    input.audit.write({
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
        input.publicWebOrigin,
        input.allowedOrigins,
        record.codeDigits
      )
    } satisfies PairingCreateResponse;
  });

  input.app.get("/api/pairings/device/:requestId", async (request, reply) => {
    const params = request.params as { requestId: string };
    const query = request.query as { pollToken?: string };
    const pairing = input.pairings.get(params.requestId);
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

  input.app.get("/api/pairings/requests/:code", async (request, reply) => {
    if (!consumeRateLimit(input.rateLimits, `pairing:lookup:ip:${request.ip}`, 30, 5 * 60_000)) {
      reply.code(429);
      return { error: "Rate limit exceeded" };
    }
    const params = request.params as { code: string };
    const pairing = pairingForCode(input.pairings, params.code);
    if (!pairing) {
      reply.code(404);
      return { error: "Pairing request not found" };
    }
    const status = resolvePairingStatus(pairing);
    pairing.status = status;
    return toPairingView(pairing);
  });

  input.app.post("/api/pairings/requests/:code/approve", async (request, reply) => {
    if (
      !consumeRateLimit(input.rateLimits, `pairing:decision:ip:${request.ip}`, 20, 5 * 60_000)
    ) {
      reply.code(429);
      return { error: "Rate limit exceeded" };
    }
    if (!input.requireUserAccess(request, reply)) {
      return { error: "Missing or invalid user token" };
    }
    const params = request.params as { code: string };
    const pairing = pairingForCode(input.pairings, params.code);
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
    input.registry.upsert({
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
    input.audit.write({
      action: "pairing.approve",
      at: now,
      deviceId: pairing.deviceId,
      outcome: "success",
      meta: { shortFingerprint: pairing.shortFingerprint }
    });
    return {
      ok: true,
      deviceId: pairing.deviceId,
      sessionToken: input.issueBrowserSession()
    } satisfies PairingApproveResponse;
  });

  input.app.post("/api/pairings/requests/:code/reject", async (request, reply) => {
    if (
      !consumeRateLimit(input.rateLimits, `pairing:decision:ip:${request.ip}`, 20, 5 * 60_000)
    ) {
      reply.code(429);
      return { error: "Rate limit exceeded" };
    }
    if (!input.requireUserAccess(request, reply)) {
      return { error: "Missing or invalid user token" };
    }
    const params = request.params as { code: string };
    const pairing = pairingForCode(input.pairings, params.code);
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
    input.audit.write({
      action: "pairing.reject",
      at: pairing.consumedAt,
      deviceId: pairing.deviceId,
      outcome: "success",
      meta: { shortFingerprint: pairing.shortFingerprint }
    });
    return { ok: true };
  });
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
