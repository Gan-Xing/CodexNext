import { appendFileSync, chmodSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { TraceFields } from "./dev-trace";

const SENSITIVE_KEYS = new Set([
  "authorization",
  "body",
  "command",
  "content",
  "delta",
  "diff",
  "input",
  "output",
  "password",
  "prompt",
  "secret",
  "text",
  "token"
]);

export function writeServerDevTrace(entry: {
  at?: string;
  event: string;
  fields?: TraceFields;
  source?: string;
}): void {
  if (process.env.NODE_ENV === "production") {
    return;
  }

  mkdirSync(traceDirectory(), { recursive: true, mode: 0o700 });
  appendFileSync(
    tracePath(),
    `${JSON.stringify({
      at: entry.at ?? new Date().toISOString(),
      source: sanitizeString(entry.source ?? "web"),
      event: sanitizeString(entry.event),
      fields: sanitizeTraceValue(entry.fields ?? {})
    })}\n`,
    {
      encoding: "utf8",
      mode: 0o600
    }
  );
  chmodSync(tracePath(), 0o600);
}

function traceDirectory(): string {
  return path.join(os.homedir(), ".codexnext");
}

function tracePath(): string {
  return path.join(traceDirectory(), "web-dev-trace.log");
}

function sanitizeTraceValue(value: unknown, key = ""): unknown {
  if (isSensitiveTraceKey(key)) {
    return redactValue(value);
  }
  if (typeof value === "string") {
    return sanitizeString(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeTraceValue(item, key));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        sanitizeTraceValue(childValue, childKey)
      ])
    );
  }
  return value;
}

function sanitizeString(value: string): string {
  return value.length > 180 ? `${value.slice(0, 180)}...` : value;
}

function isSensitiveTraceKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return (
    SENSITIVE_KEYS.has(normalized) ||
    normalized.endsWith("password") ||
    normalized.endsWith("secret") ||
    normalized.endsWith("token") ||
    normalized.includes("authorization")
  );
}

function redactValue(value: unknown): string {
  if (typeof value === "string") {
    return `[redacted:${value.length}]`;
  }
  if (Array.isArray(value)) {
    return `[redacted-array:${value.length}]`;
  }
  if (value && typeof value === "object") {
    return "[redacted-object]";
  }
  return "[redacted]";
}
