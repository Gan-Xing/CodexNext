import type { RelaySessionResponse } from "@codexnext/protocol";
import type { FastifyInstance } from "fastify";
import { readBearerToken, requestAccessToken } from "./auth.js";
import type { AuditLogger } from "./audit-log.js";
import { consumeRateLimit, type RateLimitRecord } from "./control-policy.js";

export interface AuthRouteDependencies {
  app: FastifyInstance;
  audit: AuditLogger;
  ownerToken: string;
  rateLimits: Map<string, RateLimitRecord>;
  issueBrowserSession: () => string;
  revokeBrowserSession: (token: string | null | undefined) => boolean;
  isUserAccessToken: (token: string | null | undefined) => boolean;
}

export function registerAuthRoutes(input: AuthRouteDependencies): void {
  input.app.post("/api/auth/session", async (request, reply) => {
    if (!consumeRateLimit(input.rateLimits, `auth-session:${request.ip}`, 12, 5 * 60_000)) {
      reply.code(429);
      return { error: "Rate limit exceeded" };
    }
    if (readBearerToken(request) !== input.ownerToken) {
      input.audit.write({
        action: "relay.session.issue",
        at: Date.now(),
        outcome: "failure",
        reason: "invalid_owner_token",
        meta: { ip: request.ip }
      });
      reply.code(401);
      return { error: "Missing or invalid owner token" };
    }
    const sessionToken = input.issueBrowserSession();
    input.audit.write({
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

  input.app.post("/api/auth/logout", async (request, reply) => {
    const accessToken = requestAccessToken(request);
    if (!input.isUserAccessToken(accessToken)) {
      reply.code(401);
      return { error: "Missing or invalid user token" };
    }
    if (accessToken) {
      input.revokeBrowserSession(accessToken);
    }
    input.audit.write({
      action: "relay.session.revoke",
      at: Date.now(),
      outcome: "success",
      meta: { ip: request.ip }
    });
    return { ok: true };
  });
}
