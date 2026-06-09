import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { RelaySessionResponse } from "@codexnext/protocol";
import {
  configuredOwnerToken,
  configuredRelayUrl,
  isLoggedIn,
  webLoginEnabled
} from "../../../../lib/server-auth";

export async function POST() {
  const relayUrl = configuredRelayUrl();
  const ownerToken = configuredOwnerToken();
  if (!relayUrl || !ownerToken) {
    return new NextResponse(null, { status: 204 });
  }
  if (webLoginEnabled()) {
    const cookieStore = await cookies();
    if (!isLoggedIn(cookieStore)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
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
