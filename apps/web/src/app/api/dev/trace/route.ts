import { writeServerDevTrace } from "../../../../lib/server-dev-trace";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  if (process.env.NODE_ENV === "production") {
    return new Response(null, { status: 204 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return new Response(null, { status: 400 });
  }

  if (!isRecord(payload) || typeof payload.event !== "string") {
    return new Response(null, { status: 400 });
  }

  writeServerDevTrace({
    event: payload.event,
    fields: isRecord(payload.fields) ? payload.fields : {},
    source: typeof payload.source === "string" ? payload.source : "web",
    ...(typeof payload.at === "string" ? { at: payload.at } : {})
  });
  return new Response(null, { status: 204 });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
