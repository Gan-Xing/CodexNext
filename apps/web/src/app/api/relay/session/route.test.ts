import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cookiesMock = vi.fn();

vi.mock("next/headers", () => ({
  cookies: cookiesMock
}));

describe("relay session bootstrap route", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env.CODEXNEXT_RELAY_URL = "http://relay.local";
    process.env.CODEXNEXT_OWNER_TOKEN = "owner-token";
    process.env.CODEXNEXT_WEB_AUTH_PASSWORD_HASH = "scrypt$c2FsdA$YWJj";
    process.env.CODEXNEXT_WEB_SESSION_SECRET = "very-secret-session-key";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    cookiesMock.mockReset();
    vi.restoreAllMocks();
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
});
