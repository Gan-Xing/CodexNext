import { createHash, randomBytes } from "node:crypto";

export interface BrowserSessionRecord {
  tokenHash: string;
  createdAt: number;
  expiresAt: number;
  lastUsedAt: number;
  revokedAt: number | null;
}

export type BrowserSessionAccessResult =
  | { status: "missing" | "invalid" | "owner-bypass"; tokenHash: null }
  | { status: "valid" | "expired"; tokenHash: string };

export function createBrowserSessionToken(): string {
  return randomBytes(24).toString("base64url");
}

export function issueBrowserSession(
  sessions: Map<string, BrowserSessionRecord>,
  ownerToken: string,
  ttlMs: number,
  now = Date.now(),
  token = createBrowserSessionToken()
): string {
  const tokenHash = hashBrowserSessionToken(ownerToken, token);
  sessions.set(tokenHash, {
    tokenHash,
    createdAt: now,
    lastUsedAt: now,
    expiresAt: now + ttlMs,
    revokedAt: null
  });
  return token;
}

export function resolveBrowserSessionAccess(
  sessions: Map<string, BrowserSessionRecord>,
  input: {
    ownerToken: string;
    token: string | null | undefined;
    production: boolean;
    idleTimeoutMs: number;
    now?: number;
  }
): BrowserSessionAccessResult {
  const token = input.token;
  if (!token) {
    return { status: "missing", tokenHash: null };
  }
  if (!input.production && token === input.ownerToken) {
    return { status: "owner-bypass", tokenHash: null };
  }
  const tokenHash = hashBrowserSessionToken(input.ownerToken, token);
  const session = sessions.get(tokenHash);
  if (!session) {
    return { status: "invalid", tokenHash: null };
  }
  const now = input.now ?? Date.now();
  if (isBrowserSessionExpired(session, input.idleTimeoutMs, now)) {
    sessions.delete(tokenHash);
    return { status: "expired", tokenHash };
  }
  session.lastUsedAt = now;
  return { status: "valid", tokenHash };
}

export function revokeBrowserSession(
  sessions: Map<string, BrowserSessionRecord>,
  ownerToken: string,
  token: string | null | undefined,
  now = Date.now()
): string | null {
  if (!token || token === ownerToken) {
    return null;
  }
  const tokenHash = hashBrowserSessionToken(ownerToken, token);
  const session = sessions.get(tokenHash);
  if (!session) {
    return null;
  }
  session.revokedAt = now;
  sessions.delete(tokenHash);
  return tokenHash;
}

export function pruneBrowserSessions(
  sessions: Map<string, BrowserSessionRecord>,
  idleTimeoutMs: number,
  now = Date.now()
): string[] {
  const prunedTokenHashes: string[] = [];
  for (const [tokenHash, session] of sessions.entries()) {
    if (isBrowserSessionExpired(session, idleTimeoutMs, now)) {
      sessions.delete(tokenHash);
      prunedTokenHashes.push(tokenHash);
    }
  }
  return prunedTokenHashes;
}

export function hashBrowserSessionToken(ownerToken: string, token: string): string {
  return createHash("sha256")
    .update(ownerToken)
    .update(":browser-session:")
    .update(token)
    .digest("base64url");
}

function isBrowserSessionExpired(
  session: BrowserSessionRecord,
  idleTimeoutMs: number,
  now: number
): boolean {
  return (
    session.revokedAt !== null ||
    session.expiresAt <= now ||
    session.lastUsedAt + idleTimeoutMs <= now
  );
}
