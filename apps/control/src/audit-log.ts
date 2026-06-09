import { appendFileSync, chmodSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface AuditLogEntry {
  action: string;
  at: number;
  deviceId?: string;
  method?: string;
  outcome?: "success" | "failure" | "denied";
  reason?: string;
  meta?: Record<string, unknown>;
}

const auditDirectory = path.join(os.homedir(), ".codexnext");
const auditPath = path.join(auditDirectory, "control-audit.log");

export class AuditLogger {
  public write(entry: AuditLogEntry): void {
    mkdirSync(auditDirectory, { recursive: true, mode: 0o700 });
    appendFileSync(auditPath, `${JSON.stringify(entry)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
    chmodSync(auditPath, 0o600);
  }
}
