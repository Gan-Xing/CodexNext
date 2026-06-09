import os from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import type {
  PairingCreateResponse,
  PairingPollResponse
} from "@codexnext/protocol";
import { codexVersion } from "../local-server/local-agent.js";
import { printLine, printSection } from "../output.js";
import { readOrCreateDeviceIdentity } from "../relay/device-identity.js";
import { normalizeRelayUrl, runConnect } from "./connect.js";

export interface PairOptions {
  relay: string;
  deviceName?: string;
  approvalTimeoutMs: number;
  codexBin: string;
}

export async function runPair(options: PairOptions): Promise<void> {
  const relayUrl = normalizeRelayUrl(options.relay);
  const identity = await readOrCreateDeviceIdentity({
    ...(options.deviceName ? { deviceName: options.deviceName } : {}),
    relayUrl
  });
  const codex = await codexVersion(options.codexBin);
  const create = await fetch(new URL("/api/pairings/device", relayUrl), {
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
  const pairing = (await create.json()) as PairingCreateResponse;
  const pairUrl = `${relayUrl}/pair?code=${encodeURIComponent(pairing.codeDigits)}`;

  printSection("codexnext pair", "pair this device");
  printLine(`Code: ${pairing.code}`);
  printLine(`Expires: ${new Date(pairing.expiresAt).toLocaleString()}`);
  printLine(`Open: ${pairUrl}`);

  while (true) {
    await sleep(2_000);
    const poll = await fetch(
      new URL(
        `/api/pairings/device/${encodeURIComponent(pairing.requestId)}?pollToken=${encodeURIComponent(pairing.pollToken)}`,
        relayUrl
      )
    );
    if (!poll.ok) {
      const text = await poll.text();
      throw new Error(text || `Pairing poll failed: ${poll.status}`);
    }
    const status = (await poll.json()) as PairingPollResponse;
    if (status.status === "pending") {
      continue;
    }
    if (status.status === "rejected") {
      throw new Error("配对请求已被拒绝。");
    }
    if (status.status === "expired") {
      throw new Error("配对码已过期。");
    }
    printLine("");
    printSection("paired", "device approved, connecting to relay");
    await runConnect({
      relay: relayUrl,
      deviceName: identity.deviceName,
      approvalTimeoutMs: options.approvalTimeoutMs,
      codexBin: options.codexBin
    });
    return;
  }
}
