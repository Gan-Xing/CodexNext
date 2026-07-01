import { NextResponse } from "next/server";
import { configuredControlUrl } from "../../../../lib/server-auth";

export async function GET() {
  const controlUrl = configuredControlUrl();
  if (!controlUrl) {
    return NextResponse.json(
      { error: "CodexNext relay is not configured." },
      { status: 503 }
    );
  }

  let response: Response;
  try {
    response = await fetch(new URL("/api/control/health", controlUrl), {
      cache: "no-store"
    });
  } catch {
    return NextResponse.json(
      { error: "CodexNext control health is unreachable." },
      { status: 502 }
    );
  }

  if (!response.ok) {
    return NextResponse.json(
      { error: "CodexNext control health check failed." },
      { status: response.status }
    );
  }

  const payload = (await response.json().catch(() => null)) as unknown;
  if (!isSafeControlHealthPayload(payload)) {
    return NextResponse.json(
      { error: "CodexNext control health payload is invalid." },
      { status: 502 }
    );
  }

  return NextResponse.json(payload);
}

function isSafeControlHealthPayload(value: unknown): value is { ok: true } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (record.ok !== true) {
    return false;
  }
  return Object.keys(record).every(
    (key) => !/(token|secret|password|prompt|assistant|command|output|content)/i.test(key)
  );
}
