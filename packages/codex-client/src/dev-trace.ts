import { appendFileSync, chmodSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

type TraceFields = Record<string, unknown>;

const TRACE_FILE = "codex-rpc-trace.log";
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

export function devTrace(event: string, fields: TraceFields = {}): void {
  if (!isDevTraceEnabled()) {
    return;
  }

  const entry = {
    at: new Date().toISOString(),
    source: "codex-client",
    event,
    ...(sanitizeTraceValue(fields) as TraceFields)
  };

  try {
    mkdirSync(traceDirectory(), { recursive: true, mode: 0o700 });
    appendFileSync(tracePath(), `${JSON.stringify(entry)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
    chmodSync(tracePath(), 0o600);
  } catch {
    // Trace logging must never change product behavior.
  }
}

export function durationMs(startedAt: number): number {
  return Date.now() - startedAt;
}

export function errorSummary(error: unknown): TraceFields {
  return {
    errorName: error instanceof Error ? error.name : typeof error,
    errorMessage: error instanceof Error ? error.message : String(error)
  };
}

export function payloadSummary(value: unknown): TraceFields {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { payloadType: typeof value };
  }
  const record = value as Record<string, unknown>;
  return {
    payloadKeys: Object.keys(record).sort(),
    id:
      typeof record.id === "string" || typeof record.id === "number"
        ? record.id
        : undefined,
    method: typeof record.method === "string" ? record.method : undefined,
    threadId: typeof record.threadId === "string" ? record.threadId : undefined,
    turnId: typeof record.turnId === "string" ? record.turnId : undefined,
    inputCount: Array.isArray(record.input) ? record.input.length : undefined
  };
}

function isDevTraceEnabled(): boolean {
  const trace = process.env.CODEXNEXT_TRACE;
  return (
    (trace === "1" || trace === "true") &&
    process.env.NODE_ENV !== "production" &&
    process.env.CODEXNEXT_PRODUCTION !== "1"
  );
}

function sanitizeTraceValue(value: unknown, key = ""): unknown {
  if (isSensitiveTraceKey(key)) {
    return redactValue(value);
  }
  if (typeof value === "string") {
    return value.length > 180 ? `${value.slice(0, 180)}...` : value;
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

function traceDirectory(): string {
  return path.join(os.homedir(), ".codexnext", "logs");
}

function tracePath(): string {
  return path.join(traceDirectory(), TRACE_FILE);
}
