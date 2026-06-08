import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface RegisteredMachineRecord {
  deviceId: string;
  deviceToken: string;
  deviceName: string;
  hostname: string;
  platform: string;
  arch: string;
  agentVersion: string;
  codexVersion?: string | null;
  relayUrl?: string | null;
  createdAt: number;
  updatedAt: number;
}

interface PersistedRegistry {
  version: 1;
  devices: RegisteredMachineRecord[];
}

const registryDirectory = path.join(os.homedir(), ".codexnext");
const registryPath = path.join(registryDirectory, "control-devices.json");

export class DeviceRegistry {
  private readonly devices = new Map<string, RegisteredMachineRecord>();

  public constructor() {
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
    return this.devices.get(deviceId)?.deviceToken === deviceToken;
  }

  public upsert(record: RegisteredMachineRecord): RegisteredMachineRecord {
    const existing = this.devices.get(record.deviceId);
    const next: RegisteredMachineRecord = {
      ...record,
      createdAt: existing?.createdAt ?? record.createdAt,
      updatedAt: record.updatedAt
    };
    this.devices.set(record.deviceId, next);
    this.save();
    return next;
  }

  private load(): void {
    try {
      const raw = readFileSync(registryPath, "utf8");
      const parsed = JSON.parse(raw) as PersistedRegistry;
      if (parsed.version !== 1 || !Array.isArray(parsed.devices)) {
        return;
      }
      for (const device of parsed.devices) {
        if (isRegisteredMachineRecord(device)) {
          this.devices.set(device.deviceId, device);
        }
      }
    } catch {
      return;
    }
  }

  private save(): void {
    mkdirSync(registryDirectory, { recursive: true });
    const payload: PersistedRegistry = {
      version: 1,
      devices: this.all()
    };
    writeFileSync(registryPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }
}

function isRegisteredMachineRecord(value: unknown): value is RegisteredMachineRecord {
  return (
    isRecord(value) &&
    typeof value.deviceId === "string" &&
    typeof value.deviceToken === "string" &&
    typeof value.deviceName === "string" &&
    typeof value.hostname === "string" &&
    typeof value.platform === "string" &&
    typeof value.arch === "string" &&
    typeof value.agentVersion === "string" &&
    typeof value.createdAt === "number" &&
    typeof value.updatedAt === "number"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
