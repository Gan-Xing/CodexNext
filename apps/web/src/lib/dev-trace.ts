export type TraceFields = Record<string, unknown>;

interface WebTracePayload {
  at: string;
  source: "web";
  event: string;
  fields: TraceFields;
}

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

export function webDevTrace(event: string, fields: TraceFields = {}): void {
  if (!isWebDevTraceEnabled()) {
    return;
  }

  const payload: WebTracePayload = {
    at: new Date().toISOString(),
    source: "web",
    event,
    fields: sanitizeTraceValue(fields) as TraceFields
  };

  console.debug("[codexnext:trace]", {
    at: payload.at,
    source: payload.source,
    event: payload.event,
    ...payload.fields
  });
  writeWebDevTraceFile(payload);
}

export function traceDurationMs(startedAt: number): number {
  return Date.now() - startedAt;
}

export function webErrorSummary(error: unknown): TraceFields {
  return {
    errorName: error instanceof Error ? error.name : typeof error,
    errorMessage: error instanceof Error ? error.message : String(error)
  };
}

export function summarizeRequestBody(body: BodyInit | null | undefined): TraceFields {
  if (typeof body !== "string") {
    return { bodyType: body === undefined ? "undefined" : typeof body };
  }
  try {
    const parsed = JSON.parse(body) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { bodyBytes: body.length, bodyType: typeof parsed };
    }
    const record = parsed as Record<string, unknown>;
    return {
      bodyBytes: body.length,
      bodyKeys: Object.keys(record).sort(),
      clientMessageId:
        typeof record.clientMessageId === "string" ? record.clientMessageId : undefined,
      textLength: typeof record.text === "string" ? record.text.length : undefined
    };
  } catch {
    return { bodyBytes: body.length, bodyParseError: true };
  }
}

function isWebDevTraceEnabled(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.NEXT_PUBLIC_CODEXNEXT_TRACE !== "0"
  );
}

function writeWebDevTraceFile(payload: WebTracePayload): void {
  if (typeof window === "undefined") {
    return;
  }

  const body = JSON.stringify(payload);
  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: "application/json" });
      if (navigator.sendBeacon("/api/dev/trace", blob)) {
        return;
      }
    }
    void fetch("/api/dev/trace", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true
    }).catch(() => undefined);
  } catch {
    // Tracing must never affect the product path.
  }
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
