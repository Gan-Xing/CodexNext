import { NextResponse } from "next/server";
import type { RelaySessionResponse } from "@codexnext/protocol";

function configuredRelayUrl(): string | null {
  return (
    process.env.CODEXNEXT_RELAY_URL ||
    process.env.NEXT_PUBLIC_CODEXNEXT_RELAY_URL ||
    null
  );
}

function configuredOwnerToken(): string | null {
  return process.env.CODEXNEXT_OWNER_TOKEN || null;
}

export async function POST() {
  const relayUrl = configuredRelayUrl();
  const ownerToken = configuredOwnerToken();
  if (!relayUrl || !ownerToken) {
    return new NextResponse(null, { status: 204 });
  }

  const response = await fetch(new URL("/api/auth/session", relayUrl), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ownerToken}`
    },
    cache: "no-store"
  });

  if (!response.ok) {
    const text = await response.text();
    return NextResponse.json(
      { error: text || "Failed to bootstrap relay session." },
      { status: response.status }
    );
  }

  const payload = (await response.json()) as RelaySessionResponse;
  return NextResponse.json({
    relayUrl,
    sessionToken: payload.sessionToken
  });
}
