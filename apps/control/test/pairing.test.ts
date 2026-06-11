import { describe, expect, it } from "vitest";
import {
  buildShortFingerprint,
  normalizePairCode,
  pairingForCode,
  randomDigits,
  resolvePairingStatus,
  toPairingView,
  type PairingRequestRecord
} from "../src/pairing.js";

describe("pairing helpers", () => {
  it("normalizes pairing codes and finds records by normalized code", () => {
    const record = pairingRecord({ codeDigits: "123456" });
    const pairings = new Map([[record.requestId, record]]);

    expect(normalizePairCode(" 123-456 ")).toBe("123456");
    expect(normalizePairCode("12 34\n56")).toBe("123456");
    expect(pairingForCode(pairings, "123-456")).toBe(record);
    expect(pairingForCode(pairings, "000-000")).toBeNull();
  });

  it("resolves pending, expired, approved, and rejected statuses", () => {
    expect(
      resolvePairingStatus(pairingRecord({ expiresAt: 200, status: "pending" }), 100)
    ).toBe("pending");
    expect(
      resolvePairingStatus(pairingRecord({ expiresAt: 100, status: "pending" }), 100)
    ).toBe("expired");
    expect(
      resolvePairingStatus(pairingRecord({ expiresAt: 100, status: "approved" }), 200)
    ).toBe("approved");
    expect(
      resolvePairingStatus(pairingRecord({ expiresAt: 100, status: "rejected" }), 200)
    ).toBe("rejected");
  });

  it("creates safe pairing views without token material or raw dashed codes", () => {
    const view = toPairingView(
      pairingRecord({
        code: "123-456",
        deviceToken: "device-token",
        pollToken: "poll-token"
      }),
      100
    );

    expect(view).toMatchObject({
      codeDigits: "123456",
      deviceId: "device_1",
      shortFingerprint: "abc123def456",
      status: "pending"
    });
    expect("code" in view).toBe(false);
    expect("deviceToken" in view).toBe(false);
    expect("pollToken" in view).toBe(false);
  });

  it("builds stable fingerprints and deterministic digit strings", () => {
    expect(buildShortFingerprint("device_1", "host", "darwin", "arm64")).toBe(
      buildShortFingerprint("device_1", "host", "darwin", "arm64")
    );
    expect(buildShortFingerprint("device_1", "host", "darwin", "arm64")).toHaveLength(12);
    expect(buildShortFingerprint("device_2", "host", "darwin", "arm64")).not.toBe(
      buildShortFingerprint("device_1", "host", "darwin", "arm64")
    );

    const values = [0, 0.19, 0.99];
    expect(randomDigits(3, () => values.shift() ?? 0)).toBe("019");
  });
});

function pairingRecord(
  overrides: Partial<PairingRequestRecord> = {}
): PairingRequestRecord {
  return {
    requestId: "pair_1",
    code: "123-456",
    codeDigits: "123456",
    deviceId: "device_1",
    deviceToken: "device-token",
    deviceName: "MacBook",
    hostname: "host",
    platform: "darwin",
    arch: "arm64",
    agentVersion: "0.1.0",
    codexVersion: null,
    relayUrl: null,
    shortFingerprint: "abc123def456",
    createdAt: 1,
    expiresAt: 200,
    status: "pending",
    pollToken: "poll-token",
    consumedAt: null,
    ...overrides
  };
}
