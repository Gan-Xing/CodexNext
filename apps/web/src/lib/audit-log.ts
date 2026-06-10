import { appendFileSync, chmodSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export function writeWebAudit(entry: {
  action: string;
  at?: number;
  outcome: "success" | "failure";
  ip?: string | null;
  reason?: string;
}): void {
  mkdirSync(auditDirectory(), { recursive: true, mode: 0o700 });
  appendFileSync(
    auditPath(),
    `${JSON.stringify({
      ...entry,
      at: entry.at ?? Date.now(),
      ...(entry.reason ? { reason: sanitizeReason(entry.reason) } : {})
    })}\n`,
    {
      encoding: "utf8",
      mode: 0o600
    }
  );
  chmodSync(auditPath(), 0o600);
}

const safeReasonPattern = /^[a-z0-9_.:-]{1,80}$/i;

function sanitizeReason(reason: string): string {
  return safeReasonPattern.test(reason) ? reason : "redacted";
}

function auditDirectory(): string {
  return path.join(os.homedir(), ".codexnext");
}

function auditPath(): string {
  return path.join(auditDirectory(), "web-audit.log");
}
