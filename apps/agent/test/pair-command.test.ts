import { describe, expect, it } from "vitest";
import type { ConnectOptions } from "../src/commands/connect.js";
import { formatError, normalizeRelayUrl } from "../src/commands/connect.js";
import { runPair } from "../src/commands/pair.js";

const baseOptions = {
  approvalTimeoutMs: 1000,
  codexBin: "codex",
  relay: "https://relay.example/control?token=secret#section"
};

const identity = {
  version: 1 as const,
  deviceId: "device_1",
  deviceName: "MacBook",
  deviceToken: "device-token",
  createdAt: 1,
  relayUrl: "https://relay.example"
};

describe("runPair", () => {
  it("throws response text for pairing create HTTP failures", async () => {
    await expect(
      runPair(baseOptions, testDeps([fakeResponse({ ok: false, status: 500, text: "create failed" })]))
    ).rejects.toThrow("create failed");
  });

  it("rejects malformed pairing create responses", async () => {
    await expect(
      runPair(
        baseOptions,
        testDeps([
          fakeResponse({
            json: {
              code: "123-456",
              pollToken: "poll-token"
            }
          })
        ])
      )
    ).rejects.toThrow("Invalid pairing response: create");
  });

  it("throws response text for pairing poll HTTP failures", async () => {
    await expect(
      runPair(
        baseOptions,
        testDeps([
          fakeResponse({ json: validCreateResponse() }),
          fakeResponse({ ok: false, status: 502, text: "poll failed" })
        ])
      )
    ).rejects.toThrow("poll failed");
  });

  it("rejects malformed pairing poll responses", async () => {
    await expect(
      runPair(
        baseOptions,
        testDeps([
          fakeResponse({ json: validCreateResponse() }),
          fakeResponse({ json: { ok: true, status: "approved" } })
        ])
      )
    ).rejects.toThrow("Invalid pairing response: poll");
  });

  it("surfaces rejected and expired pairing statuses", async () => {
    await expect(
      runPair(
        baseOptions,
        testDeps([
          fakeResponse({ json: validCreateResponse() }),
          fakeResponse({ json: validPollResponse("rejected") })
        ])
      )
    ).rejects.toThrow("配对请求已被拒绝。");

    await expect(
      runPair(
        baseOptions,
        testDeps([
          fakeResponse({ json: validCreateResponse() }),
          fakeResponse({ json: validPollResponse("expired") })
        ])
      )
    ).rejects.toThrow("配对码已过期。");
  });

  it("delegates approved pairings to connect with normalized relay options", async () => {
    const connectCalls: ConnectOptions[] = [];
    const fetchCalls: Array<{ input: Parameters<typeof fetch>[0]; init?: RequestInit }> = [];

    await runPair(
      { ...baseOptions, deviceName: "Studio" },
      testDeps(
        [
          fakeResponse({ json: validCreateResponse() }),
          fakeResponse({ json: validPollResponse("approved") })
        ],
        {
          connect: async (options) => {
            connectCalls.push(options);
          },
          fetchCalls
        }
      )
    );

    expect(connectCalls).toEqual([
      {
        approvalTimeoutMs: 1000,
        codexBin: "codex",
        deviceName: "MacBook",
        relay: "https://relay.example"
      }
    ]);
    expect(String(fetchCalls[0]?.input)).toBe(
      "https://relay.example/api/pairings/device"
    );
    expect(JSON.parse(String(fetchCalls[0]?.init?.body))).toMatchObject({
      deviceId: "device_1",
      deviceName: "MacBook",
      deviceToken: "device-token",
      relayUrl: "https://relay.example"
    });
    expect(String(fetchCalls[1]?.input)).toBe(
      "https://relay.example/api/pairings/device/pair_1?pollToken=poll-token"
    );
  });
});

describe("connect command helpers", () => {
  it("normalizes relay URLs without path, query, or fragment", () => {
    expect(normalizeRelayUrl(" https://relay.example/control?token=secret#top ")).toBe(
      "https://relay.example"
    );
  });

  it("formats unknown errors deterministically", () => {
    expect(formatError(new Error("boom"))).toBe("boom");
    expect(formatError("plain failure")).toBe("plain failure");
  });
});

function testDeps(
  responses: Response[],
  options: {
    connect?: (options: ConnectOptions) => Promise<void>;
    fetchCalls?: Array<{ input: Parameters<typeof fetch>[0]; init?: RequestInit }>;
  } = {}
): Parameters<typeof runPair>[1] {
  const queue = [...responses];
  return {
    codexVersion: async () => ({ available: true, version: "codex 0.1.0" }),
    connect: options.connect ?? (async () => {}),
    fetch: async (input, init) => {
      options.fetchCalls?.push(init === undefined ? { input } : { input, init });
      const response = queue.shift();
      if (!response) {
        throw new Error("Unexpected fetch call");
      }
      return response;
    },
    printLine: () => {},
    printSection: () => {},
    readOrCreateDeviceIdentity: async () => identity,
    sleep: async () => {}
  };
}

function fakeResponse(input: {
  json?: unknown;
  ok?: boolean;
  status?: number;
  text?: string;
}): Response {
  return {
    ok: input.ok ?? true,
    status: input.status ?? 200,
    json: async () => input.json,
    text: async () => input.text ?? ""
  } as Response;
}

function validCreateResponse() {
  return {
    requestId: "pair_1",
    pollToken: "poll-token",
    code: "123-456",
    codeDigits: "123456",
    expiresAt: 2,
    approveUrl: null
  };
}

function validPollResponse(status: "approved" | "expired" | "rejected") {
  return {
    ok: true,
    status,
    deviceId: "device_1",
    expiresAt: 2
  };
}
