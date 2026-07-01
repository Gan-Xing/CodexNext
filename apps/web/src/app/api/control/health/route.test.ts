import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("control health facade route", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env.CODEXNEXT_RELAY_URL = "http://relay.local";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns 503 when relay is not configured", async () => {
    delete process.env.CODEXNEXT_RELAY_URL;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { GET } = await import("./route");
    const response = await GET();

    expect(response.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards safe control health without requiring a browser login cookie", async () => {
    process.env.CODEXNEXT_RELAY_URL = "https://codexnext.example";
    process.env.CODEXNEXT_CONTROL_URL = "http://100.125.203.64:3922";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          onlineDevices: 1,
          knownDevices: 2,
          uptimeSeconds: 12
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

    const { GET } = await import("./route");
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      onlineDevices: 1,
      knownDevices: 2,
      uptimeSeconds: 12
    });
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("/api/control/health", "http://100.125.203.64:3922"),
      {
        cache: "no-store"
      }
    );
  });

  it("rejects sensitive control health payloads", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          sessionToken: "must-not-leak"
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

    const { GET } = await import("./route");
    const response = await GET();

    expect(response.status).toBe(502);
    const text = await response.text();
    expect(text).not.toContain("must-not-leak");
  });
});
