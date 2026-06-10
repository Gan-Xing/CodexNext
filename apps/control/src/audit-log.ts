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

export class AuditLogger {
  public write(entry: AuditLogEntry): void {
    mkdirSync(auditDirectory(), { recursive: true, mode: 0o700 });
    appendFileSync(auditPath(), `${JSON.stringify(sanitizeAuditEntry(entry))}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
    chmodSync(auditPath(), 0o600);
  }
}

const sensitiveAuditKeyPattern =
  /(token|password|secret|prompt|assistant|content|output|command)/i;
const safeReasonPattern = /^[a-z0-9_.:-]{1,80}$/i;

function sanitizeAuditEntry(entry: AuditLogEntry): AuditLogEntry {
  return {
    ...entry,
    ...(entry.reason !== undefined ? { reason: sanitizeReason(entry.reason) } : {}),
    ...(entry.meta !== undefined
      ? { meta: sanitizeAuditValue(entry.meta) as Record<string, unknown> }
      : {})
  };
}

function sanitizeReason(reason: string): string {
  return safeReasonPattern.test(reason) ? reason : "redacted";
}

function sanitizeAuditValue(value: unknown, key = ""): unknown {
  if (sensitiveAuditKeyPattern.test(key)) {
    return "[redacted]";
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeAuditValue(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        sanitizeAuditValue(childValue, childKey)
      ])
    );
  }
  return value;
}

function auditDirectory(): string {
  return path.join(os.homedir(), ".codexnext");
}

function auditPath(): string {
  return path.join(auditDirectory(), "control-audit.log");
}
