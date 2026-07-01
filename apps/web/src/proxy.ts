import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE_NAME = "codexnext_web_session";

export async function proxy(request: NextRequest) {
  if (!webLoginEnabled()) {
    return NextResponse.next();
  }

  const { pathname, search } = request.nextUrl;
  if (
    pathname === "/login" ||
    pathname.startsWith("/api/auth/login") ||
    pathname.startsWith("/api/auth/logout") ||
    pathname.startsWith("/api/auth/status") ||
    pathname.startsWith("/api/control/health") ||
    isDevTracePath(pathname) ||
    pathname.startsWith("/api/relay/session") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  const cookieValue = request.cookies.get(SESSION_COOKIE_NAME)?.value ?? null;
  if (cookieValue && (await verifyCookie(cookieValue))) {
    return NextResponse.next();
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(loginUrl);
}

function isDevTracePath(pathname: string): boolean {
  return process.env.NODE_ENV !== "production" && pathname.startsWith("/api/dev/trace");
}

export const config = {
  matcher: [
    "/((?!api/auth/login|api/auth/logout|api/auth/status|api/control/health|api/relay/session|_next|favicon.ico).*)"
  ]
};

function webLoginEnabled(): boolean {
  return Boolean(
    process.env.CODEXNEXT_RELAY_URL &&
      process.env.CODEXNEXT_OWNER_TOKEN &&
      process.env.CODEXNEXT_WEB_AUTH_PASSWORD_HASH &&
      process.env.CODEXNEXT_WEB_SESSION_SECRET
  );
}

async function verifyCookie(value: string): Promise<boolean> {
  const secret = process.env.CODEXNEXT_WEB_SESSION_SECRET;
  if (!secret) {
    return false;
  }
  const [encoded, signature] = value.split(".");
  if (!encoded || !signature) {
    return false;
  }
  const expected = await hmacSha256Base64Url(secret, encoded);
  if (expected !== signature) {
    return false;
  }
  try {
    const payload = JSON.parse(decodeBase64Url(encoded)) as {
      exp?: number;
      sub?: string;
    };
    return (
      payload.sub === "codexnext-web" &&
      typeof payload.exp === "number" &&
      payload.exp * 1000 > Date.now()
    );
  } catch {
    return false;
  }
}

async function hmacSha256Base64Url(secret: string, input: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(input)
  );
  return encodeBase64Url(new Uint8Array(signature));
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function decodeBase64Url(value: string): string {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = `${base64}${"=".repeat((4 - (base64.length % 4)) % 4)}`;
  return atob(padded);
}
