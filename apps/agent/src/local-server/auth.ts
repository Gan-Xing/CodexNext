import type { IncomingMessage } from "node:http";

export interface AuthConfig {
  token: string;
  webOrigin: string;
}

export function requestToken(url: URL, request: IncomingMessage): string | null {
  const queryToken = url.searchParams.get("token");
  if (queryToken) {
    return queryToken;
  }

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

export function isAuthorized(
  url: URL,
  request: IncomingMessage,
  config: AuthConfig
): boolean {
  return requestToken(url, request) === config.token;
}

export function isAllowedOrigin(
  request: IncomingMessage,
  webOrigin: string
): boolean {
  const origin = request.headers.origin;
  if (!origin) {
    return true;
  }
  return allowedOrigins(webOrigin).includes(origin);
}

export function allowedOrigins(webOrigin: string): string[] {
  return webOrigin
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}
