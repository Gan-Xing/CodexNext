import os from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import type {
  PairingCreateResponse,
  PairingPollResponse
} from "@codexnext/protocol";
import {
  PairingCreateResponseSchema,
  PairingPollResponseSchema
} from "@codexnext/protocol";
import { codexVersion } from "../local-server/local-agent.js";
import { printLine, printSection } from "../output.js";
import { readOrCreateDeviceIdentity } from "../relay/device-identity.js";
import { normalizeRelayUrl, runConnect, type ConnectOptions } from "./connect.js";

export interface PairOptions {
  relay: string;
  deviceName?: string;
  approvalTimeoutMs: number;
  codexBin: string;
}

export interface PairRuntimeDependencies {
  codexVersion?: typeof codexVersion;
  connect?: (options: ConnectOptions) => Promise<void>;
  fetch?: typeof fetch;
  printLine?: typeof printLine;
  printSection?: typeof printSection;
  readOrCreateDeviceIdentity?: typeof readOrCreateDeviceIdentity;
  sleep?: (ms: number) => Promise<void>;
}

export async function runPair(
  options: PairOptions,
  dependencies: PairRuntimeDependencies = {}
): Promise<void> {
  const codexVersionFn = dependencies.codexVersion ?? codexVersion;
  const connectFn = dependencies.connect ?? runConnect;
  const fetchFn = dependencies.fetch ?? fetch;
  const printLineFn = dependencies.printLine ?? printLine;
  const printSectionFn = dependencies.printSection ?? printSection;
  const readOrCreateDeviceIdentityFn =
    dependencies.readOrCreateDeviceIdentity ?? readOrCreateDeviceIdentity;
  const sleepFn = dependencies.sleep ?? sleep;
  const relayUrl = normalizeRelayUrl(options.relay);
  const identity = await readOrCreateDeviceIdentityFn({
    ...(options.deviceName ? { deviceName: options.deviceName } : {}),
    relayUrl
  });
  const codex = await codexVersionFn(options.codexBin);
  const create = await fetchFn(new URL("/api/pairings/device", relayUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      deviceId: identity.deviceId,
      deviceToken: identity.deviceToken,
      deviceName: identity.deviceName,
      hostname: os.hostname(),
      platform: process.platform,
      arch: process.arch,
      agentVersion: "0.1.0",
      codexVersion: codex.version ?? null,
      relayUrl
    })
  });
  if (!create.ok) {
    const text = await create.text();
    throw new Error(text || `Pairing failed: ${create.status}`);
  }
  const pairing = parsePairingCreateResponse(await create.json());

  printSectionFn("codexnext pair", "pair this device");
  printLineFn(`Code: ${pairing.code}`);
  printLineFn(`Expires: ${new Date(pairing.expiresAt).toLocaleString()}`);
  if (pairing.approveUrl) {
    printLineFn(`Open: ${pairing.approveUrl}`);
  } else {
    printLineFn(`Open your CodexNext Web page and visit /pair?code=${pairing.codeDigits}`);
  }

  while (true) {
    await sleepFn(2_000);
    const poll = await fetchFn(
      new URL(
        `/api/pairings/device/${encodeURIComponent(pairing.requestId)}?pollToken=${encodeURIComponent(pairing.pollToken)}`,
        relayUrl
      )
    );
    if (!poll.ok) {
      const text = await poll.text();
      throw new Error(text || `Pairing poll failed: ${poll.status}`);
    }
    const status = parsePairingPollResponse(await poll.json());
    if (status.status === "pending") {
      continue;
    }
    if (status.status === "rejected") {
      throw new Error("配对请求已被拒绝。");
    }
    if (status.status === "expired") {
      throw new Error("配对码已过期。");
    }
    printLineFn("");
    printSectionFn("paired", "device approved, connecting to relay");
    await connectFn({
      relay: relayUrl,
      deviceName: identity.deviceName,
      approvalTimeoutMs: options.approvalTimeoutMs,
      codexBin: options.codexBin
    });
    return;
  }
}

function parsePairingCreateResponse(payload: unknown): PairingCreateResponse {
  const parsed = PairingCreateResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error("Invalid pairing response: create");
  }
  return parsed.data as PairingCreateResponse;
}

function parsePairingPollResponse(payload: unknown): PairingPollResponse {
  const parsed = PairingPollResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error("Invalid pairing response: poll");
  }
  return parsed.data as PairingPollResponse;
}
