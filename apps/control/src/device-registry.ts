import {
  createHmac,
  timingSafeEqual
} from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";

export interface RegisteredMachineRecord {
  deviceId: string;
  deviceTokenHash: string;
  deviceName: string;
  hostname: string;
  platform: string;
  arch: string;
  agentVersion: string;
  codexVersion?: string | null;
  relayUrl?: string | null;
  createdAt: number;
  updatedAt: number;
  revokedAt?: number | null;
}

interface LegacyRegisteredMachineRecord extends Omit<RegisteredMachineRecord, "deviceTokenHash"> {
  deviceToken: string;
}

interface PersistedRegistryV2 {
  version: 2;
  devices: RegisteredMachineRecord[];
}

interface PersistedRegistryV1 {
  version: 1;
  devices: Array<RegisteredMachineRecord | LegacyRegisteredMachineRecord>;
}

export interface UpsertDeviceInput {
  deviceId: string;
  deviceToken?: string;
  deviceTokenHash?: string;
  deviceName: string;
  hostname: string;
  platform: string;
  arch: string;
  agentVersion: string;
  codexVersion?: string | null;
  relayUrl?: string | null;
  createdAt: number;
  updatedAt: number;
  revokedAt?: number | null;
}

export class DeviceRegistry {
  private readonly devices = new Map<string, RegisteredMachineRecord>();

  public constructor(private readonly secret: string) {
    this.load();
  }

  public all(): RegisteredMachineRecord[] {
    return [...this.devices.values()];
  }

  public get(deviceId: string): RegisteredMachineRecord | null {
    return this.devices.get(deviceId) ?? null;
  }

  public isAuthorized(deviceId: string, deviceToken: string | undefined): boolean {
    if (!deviceToken) {
      return false;
    }
    const record = this.devices.get(deviceId);
    if (!record || record.revokedAt) {
      return false;
    }
    return safeEqual(record.deviceTokenHash, this.hashDeviceToken(deviceToken));
  }

  public upsert(input: UpsertDeviceInput): RegisteredMachineRecord {
    const existing = this.devices.get(input.deviceId);
    const next: RegisteredMachineRecord = {
      deviceId: input.deviceId,
      deviceTokenHash:
        input.deviceTokenHash ??
        (input.deviceToken ? this.hashDeviceToken(input.deviceToken) : existing?.deviceTokenHash ?? ""),
      deviceName: input.deviceName,
      hostname: input.hostname,
      platform: input.platform,
      arch: input.arch,
      agentVersion: input.agentVersion,
      codexVersion: input.codexVersion ?? null,
      relayUrl: input.relayUrl ?? null,
      createdAt: existing?.createdAt ?? input.createdAt,
      updatedAt: input.updatedAt,
      revokedAt: input.revokedAt ?? existing?.revokedAt ?? null
    };
    if (!next.deviceTokenHash) {
      throw new Error(`Missing device token hash for ${input.deviceId}`);
    }
    this.devices.set(input.deviceId, next);
    this.save();
    return next;
  }

  public revoke(deviceId: string, revokedAt = Date.now()): RegisteredMachineRecord | null {
    const existing = this.devices.get(deviceId);
    if (!existing) {
      return null;
    }
    const next: RegisteredMachineRecord = {
      ...existing,
      revokedAt,
      updatedAt: revokedAt
    };
    this.devices.set(deviceId, next);
    this.save();
    return next;
  }

  public hashForToken(deviceToken: string): string {
    return this.hashDeviceToken(deviceToken);
  }

  private load(): void {
    try {
      const raw = readFileSync(registryPath(), "utf8");
      const parsed = JSON.parse(raw) as PersistedRegistryV1 | PersistedRegistryV2;
      if (
        (parsed.version !== 1 && parsed.version !== 2) ||
        !Array.isArray(parsed.devices)
      ) {
        return;
      }

      let migrated = false;
      for (const device of parsed.devices) {
        const normalized = this.normalizeRecord(device);
        if (!normalized) {
          continue;
        }
        if ("deviceToken" in (device as unknown as Record<string, unknown>)) {
          migrated = true;
        }
        this.devices.set(normalized.deviceId, normalized);
      }
      if (migrated || parsed.version !== 2) {
        this.save();
      }
    } catch {
      return;
    }
  }

  private normalizeRecord(
    value: RegisteredMachineRecord | LegacyRegisteredMachineRecord | unknown
  ): RegisteredMachineRecord | null {
    if (!isRecord(value)) {
      return null;
    }
    const deviceTokenHash =
      typeof value.deviceTokenHash === "string" && value.deviceTokenHash
        ? value.deviceTokenHash
        : typeof value.deviceToken === "string" && value.deviceToken
          ? this.hashDeviceToken(value.deviceToken)
          : null;
    if (
      typeof value.deviceId !== "string" ||
      !deviceTokenHash ||
      typeof value.deviceName !== "string" ||
      typeof value.hostname !== "string" ||
      typeof value.platform !== "string" ||
      typeof value.arch !== "string" ||
      typeof value.agentVersion !== "string" ||
      typeof value.createdAt !== "number" ||
      typeof value.updatedAt !== "number"
    ) {
      return null;
    }
    return {
      deviceId: value.deviceId,
      deviceTokenHash,
      deviceName: value.deviceName,
      hostname: value.hostname,
      platform: value.platform,
      arch: value.arch,
      agentVersion: value.agentVersion,
      codexVersion: typeof value.codexVersion === "string" ? value.codexVersion : null,
      relayUrl: typeof value.relayUrl === "string" ? value.relayUrl : null,
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
      revokedAt: typeof value.revokedAt === "number" ? value.revokedAt : null
    };
  }

  private save(): void {
    mkdirSync(registryDirectory(), { recursive: true, mode: 0o700 });
    const payload: PersistedRegistryV2 = {
      version: 2,
      devices: this.all()
    };
    writeFileSync(registryPath(), `${JSON.stringify(payload, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
    chmodSync(registryPath(), 0o600);
  }

  private hashDeviceToken(deviceToken: string): string {
    return createHmac("sha256", this.secret)
      .update(deviceToken)
      .digest("base64url");
  }
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function registryDirectory(): string {
  return path.join(os.homedir(), ".codexnext");
}

function registryPath(): string {
  return path.join(registryDirectory(), "control-devices.json");
}
