import { scryptSync, randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cookiesMock = vi.fn();

vi.mock("next/headers", () => ({
  cookies: cookiesMock
}));

describe("relay session bootstrap route", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env.HOME = mkdtempSync(path.join(os.tmpdir(), "codexnext-web-route-"));
    process.env.CODEXNEXT_RELAY_URL = "http://relay.local";
    process.env.CODEXNEXT_OWNER_TOKEN = "owner-token";
    process.env.CODEXNEXT_WEB_AUTH_PASSWORD_HASH = "scrypt$c2FsdA$YWJj";
    process.env.CODEXNEXT_WEB_SESSION_SECRET = "very-secret-session-key";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    cookiesMock.mockReset();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns 204 when relay is not configured", async () => {
    delete process.env.CODEXNEXT_RELAY_URL;
    cookiesMock.mockResolvedValue({
      get() {
        return undefined;
      }
    });
    const { POST } = await import("./route");
    const response = await POST();
    expect(response.status).toBe(204);
  });

  it("returns 401 when login cookie is missing", async () => {
    cookiesMock.mockResolvedValue({
      get() {
        return undefined;
      }
    });
    const { POST } = await import("./route");
    const response = await POST();
    expect(response.status).toBe(401);
  });

  it("returns relay url and session token after login without exposing owner token", async () => {
    const { issueWebSessionCookieValue, relaySessionCookieName, webSessionCookieName } = await import("../../../../lib/server-auth");
    const cookieValue = issueWebSessionCookieValue();
    cookiesMock.mockResolvedValue({
      get(name: string) {
        return name === webSessionCookieName() ? { value: cookieValue } : undefined;
      }
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          sessionToken: "relay-session-token",
          ownerToken: "must-not-leak"
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await import("./route");
    const response = await POST();
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({
      relayUrl: "http://relay.local",
      sessionToken: "relay-session-token"
    });
    expect(text).not.toContain("ownerToken");
    expect(response.headers.get("set-cookie") ?? "").toContain(
      `${relaySessionCookieName()}=relay-session-token`
    );
    expect(fetchMock).toHaveBeenCalledWith(new URL("/api/auth/session", "http://relay.local"), {
      method: "POST",
      headers: {
        Authorization: "Bearer owner-token"
      },
      cache: "no-store"
    });
  });

  it("reuses a cached relay session cookie after validating it with control", async () => {
    const { issueWebSessionCookieValue, relaySessionCookieName, webSessionCookieName } = await import("../../../../lib/server-auth");
    const cookieValue = issueWebSessionCookieValue();
    cookiesMock.mockResolvedValue({
      get(name: string) {
        if (name === webSessionCookieName()) {
          return { value: cookieValue };
        }
        if (name === relaySessionCookieName()) {
          return { value: "cached-relay-session-token" };
        }
        return undefined;
      }
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ devices: [] }), {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await import("./route");
    const response = await POST();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      relayUrl: "http://relay.local",
      sessionToken: "cached-relay-session-token"
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(new URL("/api/devices", "http://relay.local"), {
      method: "GET",
      headers: {
        Authorization: "Bearer cached-relay-session-token"
      },
      cache: "no-store"
    });
    expect(response.headers.get("set-cookie") ?? "").toContain(
      `${relaySessionCookieName()}=cached-relay-session-token`
    );
  });

  it("normalizes upstream relay session rate-limit errors", async () => {
    const { issueWebSessionCookieValue, webSessionCookieName } = await import("../../../../lib/server-auth");
    const cookieValue = issueWebSessionCookieValue();
    cookiesMock.mockResolvedValue({
      get(name: string) {
        return name === webSessionCookieName() ? { value: cookieValue } : undefined;
      }
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
        status: 429,
        headers: {
          "Content-Type": "application/json"
        }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await import("./route");
    const response = await POST();

    expect(response.status).toBe(429);
    const text = await response.text();
    expect(text).toContain("temporarily rate limited");
    expect(text).not.toContain("{\\\"error\\\"");
  });

  it("uses an internal control URL for server-side relay session bootstrap", async () => {
    process.env.CODEXNEXT_RELAY_URL = "https://codexnext.example";
    process.env.CODEXNEXT_CONTROL_URL = "http://100.125.203.64:3922";
    const { issueWebSessionCookieValue, webSessionCookieName } = await import("../../../../lib/server-auth");
    const cookieValue = issueWebSessionCookieValue();
    cookiesMock.mockResolvedValue({
      get(name: string) {
        return name === webSessionCookieName() ? { value: cookieValue } : undefined;
      }
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          sessionToken: "relay-session-token"
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await import("./route");
    const response = await POST();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      relayUrl: "https://codexnext.example",
      sessionToken: "relay-session-token"
    });
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("/api/auth/session", "http://100.125.203.64:3922"),
      {
        method: "POST",
        headers: {
          Authorization: "Bearer owner-token"
        },
        cache: "no-store"
      }
    );
  });

  it("sets an HttpOnly login cookie for a valid password", async () => {
    process.env.CODEXNEXT_WEB_AUTH_PASSWORD_HASH = makePasswordHash("correct-password");
    const { POST } = await import("../../auth/login/route");
    const response = await POST(
      new Request("http://web.local/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": "203.0.113.10"
        },
        body: JSON.stringify({ password: "correct-password" })
      })
    );
    expect(response.status).toBe(200);
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("codexnext_web_session=");
    expect(setCookie).toContain("HttpOnly");
  });

  it("clears the login cookie on logout", async () => {
    const { relaySessionCookieName } = await import("../../../../lib/server-auth");
    const { POST } = await import("../../auth/logout/route");
    const response = await POST(
      new Request("http://web.local/api/auth/logout", {
        method: "POST",
        headers: {
          "x-forwarded-for": "203.0.113.10"
        }
      })
    );
    expect(response.status).toBe(200);
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("codexnext_web_session=");
    expect(setCookie).toContain(`${relaySessionCookieName()}=`);
    expect(setCookie).toMatch(/Max-Age=0/i);
  });

  it("rate limits repeated invalid login attempts", async () => {
    process.env.CODEXNEXT_WEB_AUTH_PASSWORD_HASH = makePasswordHash("correct-password");
    const { POST } = await import("../../auth/login/route");
    let status = 0;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await POST(
        new Request("http://web.local/api/auth/login", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-forwarded-for": "203.0.113.11"
          },
          body: JSON.stringify({ password: "wrong-password" })
        })
      );
      status = response.status;
    }
    expect(status).toBe(429);
  });

  it("does not leak malformed password hash configuration state", async () => {
    process.env.CODEXNEXT_WEB_AUTH_PASSWORD_HASH = "not-a-valid-hash";
    const { POST } = await import("../../auth/login/route");
    const response = await POST(
      new Request("http://web.local/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": "203.0.113.12"
        },
        body: JSON.stringify({ password: "anything" })
      })
    );
    expect(response.status).toBe(401);
    const text = await response.text();
    expect(text).not.toMatch(/scrypt|hash|config|secret/i);
  });
});

function makePasswordHash(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}
