import type { FastifyRequest } from "fastify";

export function readOwnerToken(request: FastifyRequest): string | null {
  return readBearerToken(request);
}

export function readBearerToken(request: FastifyRequest): string | null {
  const authorization = request.headers.authorization;
  if (!authorization) {
    return null;
  }
  const [scheme, token] = authorization.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return null;
  }
  return token;
}

export function assertOwnerToken(
  request: FastifyRequest,
  expectedOwnerToken: string
): boolean {
  return readOwnerToken(request) === expectedOwnerToken;
}

export function requestAccessToken(request: FastifyRequest): string | null {
  return readBearerToken(request);
}
