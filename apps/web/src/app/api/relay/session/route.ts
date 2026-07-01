import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { RelaySessionResponse } from "@codexnext/protocol";
import {
  clearRelaySessionCookieOptions,
  configuredControlUrl,
  configuredOwnerToken,
  configuredRelayUrl,
  isLoggedIn,
  relaySessionCookieName,
  relaySessionCookieOptions,
  webLoginEnabled
} from "../../../../lib/server-auth";

export async function POST() {
  const relayUrl = configuredRelayUrl();
  const controlUrl = configuredControlUrl();
  const ownerToken = configuredOwnerToken();
  if (!relayUrl || !controlUrl || !ownerToken) {
    return new NextResponse(null, { status: 204 });
  }
  const cookieStore = await cookies();
  if (webLoginEnabled()) {
    if (!isLoggedIn(cookieStore)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const cachedSessionToken = cookieStore.get(relaySessionCookieName())?.value ?? null;
  if (cachedSessionToken && (await isRelaySessionUsable(controlUrl, cachedSessionToken))) {
    const response = NextResponse.json({
      relayUrl,
      sessionToken: cachedSessionToken
    });
    response.cookies.set(
      relaySessionCookieName(),
      cachedSessionToken,
      relaySessionCookieOptions()
    );
    return response;
  }

  const response = await fetch(new URL("/api/auth/session", controlUrl), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ownerToken}`
    },
    cache: "no-store"
  });

  if (!response.ok) {
    const errorMessage = await readRelaySessionError(response);
    const failure = NextResponse.json(
      { error: formatRelaySessionError(errorMessage, response.status) },
      { status: response.status }
    );
    if (cachedSessionToken) {
      failure.cookies.set(
        relaySessionCookieName(),
        "",
        clearRelaySessionCookieOptions()
      );
    }
    return failure;
  }

  const payload = (await response.json()) as RelaySessionResponse;
  const result = NextResponse.json({
    relayUrl,
    sessionToken: payload.sessionToken
  });
  result.cookies.set(
    relaySessionCookieName(),
    payload.sessionToken,
    relaySessionCookieOptions()
  );
  return result;
}

async function isRelaySessionUsable(
  controlUrl: string,
  sessionToken: string
): Promise<boolean> {
  const response = await fetch(new URL("/api/devices", controlUrl), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${sessionToken}`
    },
    cache: "no-store"
  }).catch(() => null);
  return Boolean(response?.ok);
}

async function readRelaySessionError(response: Response): Promise<string> {
  const text = await response.text();
  if (!text) {
    return "Failed to bootstrap relay session.";
  }
  try {
    const parsed = JSON.parse(text) as { error?: unknown };
    if (typeof parsed.error === "string" && parsed.error.trim()) {
      return parsed.error;
    }
  } catch {
    // Fall through to the raw text below.
  }
  return text;
}

function formatRelaySessionError(message: string, status: number): string {
  if (status === 429) {
    return "Relay session bootstrap is temporarily rate limited. Please wait a moment and retry.";
  }
  return message;
}
