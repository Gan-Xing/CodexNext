import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import type { DeviceIdentityFile } from "@codexnext/protocol";

export async function readOrCreateDeviceIdentity(input?: {
  deviceName?: string;
  relayUrl?: string;
}): Promise<DeviceIdentityFile> {
  await mkdir(deviceDirectory(), { recursive: true, mode: 0o700 });
  const existing = await readIdentityFile();
  if (existing) {
    const nextName = input?.deviceName?.trim();
    const nextRelayUrl = input?.relayUrl?.trim();
    const nextToken =
      typeof existing.deviceToken === "string" && existing.deviceToken
        ? existing.deviceToken
        : randomBytes(24).toString("base64url");
    if (
      (nextName && nextName !== existing.deviceName) ||
      (nextRelayUrl && nextRelayUrl !== existing.relayUrl) ||
      nextToken !== existing.deviceToken
    ) {
      const updated: DeviceIdentityFile = {
        ...existing,
        deviceToken: nextToken,
        ...(nextName ? { deviceName: nextName } : {}),
        ...(nextRelayUrl ? { relayUrl: nextRelayUrl } : {})
      };
      await writeIdentityFile(updated);
      return updated;
    }
    return existing;
  }

    const created: DeviceIdentityFile = {
    version: 1,
    deviceId: randomUUID(),
    deviceName: input?.deviceName?.trim() || os.hostname() || "CodexNext device",
    deviceToken: randomBytes(24).toString("base64url"),
    createdAt: Date.now(),
    ...(input?.relayUrl?.trim() ? { relayUrl: input.relayUrl.trim() } : {})
  };
  await writeIdentityFile(created);
  return created;
}

async function readIdentityFile(): Promise<DeviceIdentityFile | null> {
  try {
    const raw = await readFile(identityPath(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isDeviceIdentityFile(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function writeIdentityFile(identity: DeviceIdentityFile): Promise<void> {
  await writeFile(identityPath(), `${JSON.stringify(identity, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  await chmod(identityPath(), 0o600);
}

function isDeviceIdentityFile(value: unknown): value is DeviceIdentityFile {
  return (
    isRecord(value) &&
    value.version === 1 &&
    typeof value.deviceId === "string" &&
    typeof value.deviceName === "string" &&
    typeof value.createdAt === "number"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deviceDirectory(): string {
  return path.join(os.homedir(), ".codexnext");
}

function identityPath(): string {
  return path.join(deviceDirectory(), "device.json");
}
