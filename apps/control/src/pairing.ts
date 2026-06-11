import { createHash } from "node:crypto";
import type { PairingRequestView } from "@codexnext/protocol";

export interface PairingRequestRecord extends Omit<PairingRequestView, "status"> {
  code: string;
  deviceToken: string;
  pollToken: string;
  status: PairingRequestView["status"];
  consumedAt: number | null;
}

export function pairingForCode(
  pairings: Map<string, PairingRequestRecord>,
  code: string
): PairingRequestRecord | null {
  return (
    [...pairings.values()].find(
      (pairing) => pairing.codeDigits === normalizePairCode(code)
    ) ?? null
  );
}

export function resolvePairingStatus(
  pairing: PairingRequestRecord,
  now = Date.now()
): PairingRequestRecord["status"] {
  if (pairing.status === "approved" || pairing.status === "rejected") {
    return pairing.status;
  }
  if (now >= pairing.expiresAt) {
    return "expired";
  }
  return "pending";
}

export function toPairingView(
  pairing: PairingRequestRecord,
  now = Date.now()
): PairingRequestView {
  return {
    requestId: pairing.requestId,
    codeDigits: pairing.codeDigits,
    deviceId: pairing.deviceId,
    deviceName: pairing.deviceName,
    hostname: pairing.hostname,
    platform: pairing.platform,
    arch: pairing.arch,
    agentVersion: pairing.agentVersion,
    codexVersion: pairing.codexVersion ?? null,
    relayUrl: pairing.relayUrl ?? null,
    shortFingerprint: pairing.shortFingerprint,
    createdAt: pairing.createdAt,
    expiresAt: pairing.expiresAt,
    status: resolvePairingStatus(pairing, now)
  };
}

export function buildShortFingerprint(
  deviceId: string,
  hostname: string,
  platform: string,
  arch: string
): string {
  const digest = createHash("sha256")
    .update(`${deviceId}:${hostname}:${platform}:${arch}`)
    .digest("hex");
  return digest.slice(0, 12);
}

export function normalizePairCode(code: string): string {
  return code.replace(/\D+/g, "").trim();
}

export function randomDigits(
  length: number,
  random: () => number = Math.random
): string {
  return Array.from({ length }, () => Math.floor(random() * 10).toString()).join("");
}
