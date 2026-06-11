import { describe, expect, it } from "vitest";
import {
  createBrowserSessionToken,
  hashBrowserSessionToken,
  issueBrowserSession,
  pruneBrowserSessions,
  resolveBrowserSessionAccess,
  revokeBrowserSession,
  type BrowserSessionRecord
} from "../src/browser-session.js";

describe("browser session helpers", () => {
  it("hashes session tokens and issues hash-only records", () => {
    const sessions = new Map<string, BrowserSessionRecord>();
    const token = issueBrowserSession(sessions, "owner-token", 1_000, 100, "session-token");
    const tokenHash = hashBrowserSessionToken("owner-token", "session-token");

    expect(token).toBe("session-token");
    expect(hashBrowserSessionToken("owner-token", "session-token")).toBe(tokenHash);
    expect(hashBrowserSessionToken("other-owner", "session-token")).not.toBe(tokenHash);
    expect(tokenHash).not.toBe("session-token");
    expect(tokenHash).not.toContain("session-token");
    expect([...sessions.keys()]).toEqual([tokenHash]);
    expect(sessions.get(tokenHash)).toEqual({
      tokenHash,
      createdAt: 100,
      lastUsedAt: 100,
      expiresAt: 1_100,
      revokedAt: null
    });
  });

  it("creates high-entropy bearer tokens with a URL-safe shape", () => {
    const token = createBrowserSessionToken();

    expect(token.length).toBeGreaterThanOrEqual(32);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("resolves access and preserves dev-only owner token bypass", () => {
    const sessions = new Map<string, BrowserSessionRecord>();
    issueBrowserSession(sessions, "owner-token", 1_000, 100, "session-token");
    const tokenHash = hashBrowserSessionToken("owner-token", "session-token");

    expect(
      resolveBrowserSessionAccess(sessions, {
        ownerToken: "owner-token",
        token: undefined,
        production: false,
        idleTimeoutMs: 500,
        now: 150
      })
    ).toEqual({ status: "missing", tokenHash: null });
    expect(
      resolveBrowserSessionAccess(sessions, {
        ownerToken: "owner-token",
        token: "owner-token",
        production: false,
        idleTimeoutMs: 500,
        now: 150
      })
    ).toEqual({ status: "owner-bypass", tokenHash: null });
    expect(
      resolveBrowserSessionAccess(sessions, {
        ownerToken: "owner-token",
        token: "owner-token",
        production: true,
        idleTimeoutMs: 500,
        now: 150
      })
    ).toEqual({ status: "invalid", tokenHash: null });

    expect(
      resolveBrowserSessionAccess(sessions, {
        ownerToken: "owner-token",
        token: "session-token",
        production: true,
        idleTimeoutMs: 500,
        now: 150
      })
    ).toEqual({ status: "valid", tokenHash });
    expect(sessions.get(tokenHash)?.lastUsedAt).toBe(150);
  });

  it("revokes sessions without accepting the owner token as a browser session", () => {
    const sessions = new Map<string, BrowserSessionRecord>();
    issueBrowserSession(sessions, "owner-token", 1_000, 100, "session-token");
    const tokenHash = hashBrowserSessionToken("owner-token", "session-token");

    expect(revokeBrowserSession(sessions, "owner-token", "owner-token", 200)).toBeNull();
    expect(revokeBrowserSession(sessions, "owner-token", "missing", 200)).toBeNull();
    expect(revokeBrowserSession(sessions, "owner-token", "session-token", 200)).toBe(
      tokenHash
    );
    expect(sessions.has(tokenHash)).toBe(false);
  });

  it("expires invalid sessions during access checks and pruning", () => {
    const ttlHash = hashBrowserSessionToken("owner-token", "ttl-token");
    const idleHash = hashBrowserSessionToken("owner-token", "idle-token");
    const revokedHash = hashBrowserSessionToken("owner-token", "revoked-token");
    const accessSessions = new Map<string, BrowserSessionRecord>([
      [ttlHash, sessionRecord({ tokenHash: ttlHash, expiresAt: 200 })],
      [idleHash, sessionRecord({ tokenHash: idleHash, lastUsedAt: 100, expiresAt: 1_000 })],
      [revokedHash, sessionRecord({ tokenHash: revokedHash, revokedAt: 150 })]
    ]);

    expect(
      resolveBrowserSessionAccess(accessSessions, {
        ownerToken: "owner-token",
        token: "ttl-token",
        production: true,
        idleTimeoutMs: 100,
        now: 200
      })
    ).toEqual({ status: "expired", tokenHash: ttlHash });
    expect(
      resolveBrowserSessionAccess(accessSessions, {
        ownerToken: "owner-token",
        token: "idle-token",
        production: true,
        idleTimeoutMs: 100,
        now: 200
      })
    ).toEqual({ status: "expired", tokenHash: idleHash });
    expect(
      resolveBrowserSessionAccess(accessSessions, {
        ownerToken: "owner-token",
        token: "revoked-token",
        production: true,
        idleTimeoutMs: 100,
        now: 200
      })
    ).toEqual({ status: "expired", tokenHash: revokedHash });
    expect(accessSessions.size).toBe(0);

    const pruneSessions = new Map<string, BrowserSessionRecord>([
      ["valid", sessionRecord({ tokenHash: "valid", lastUsedAt: 950, expiresAt: 2_000 })],
      ["ttl", sessionRecord({ tokenHash: "ttl", expiresAt: 1_000 })],
      ["idle", sessionRecord({ tokenHash: "idle", lastUsedAt: 800, expiresAt: 2_000 })],
      ["revoked", sessionRecord({ tokenHash: "revoked", revokedAt: 900 })]
    ]);

    expect(pruneBrowserSessions(pruneSessions, 100, 1_000)).toEqual([
      "ttl",
      "idle",
      "revoked"
    ]);
    expect([...pruneSessions.keys()]).toEqual(["valid"]);
  });
});

function sessionRecord(
  overrides: Partial<BrowserSessionRecord> = {}
): BrowserSessionRecord {
  return {
    tokenHash: "hash",
    createdAt: 0,
    lastUsedAt: 0,
    expiresAt: 1_000,
    revokedAt: null,
    ...overrides
  };
}
