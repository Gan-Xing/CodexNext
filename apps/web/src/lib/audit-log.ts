import { appendFileSync, chmodSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const auditDirectory = path.join(os.homedir(), ".codexnext");
const auditPath = path.join(auditDirectory, "web-audit.log");

export function writeWebAudit(entry: {
  action: string;
  at?: number;
  outcome: "success" | "failure";
  ip?: string | null;
  reason?: string;
}): void {
  mkdirSync(auditDirectory, { recursive: true, mode: 0o700 });
  appendFileSync(
    auditPath,
    `${JSON.stringify({ ...entry, at: entry.at ?? Date.now() })}\n`,
    {
      encoding: "utf8",
      mode: 0o600
    }
  );
  chmodSync(auditPath, 0o600);
}
