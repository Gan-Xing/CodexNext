import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual
} from "node:crypto";
import { redirect } from "next/navigation";

const SESSION_COOKIE_NAME = "codexnext_web_session";
const RELAY_SESSION_COOKIE_NAME = "codexnext_relay_session";
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const RELAY_SESSION_TTL_SECONDS = 60 * 60;
const LOGIN_WINDOW_MS = 10 * 60_000;
const LOGIN_MAX_FAILURES = 5;
const DUMMY_SALT = Buffer.alloc(16, 7);
const DUMMY_HASH = Buffer.alloc(64, 11);

type LoginRecord = {
  count: number;
  resetAt: number;
  blockedUntil: number;
};

const loginAttempts = new Map<string, LoginRecord>();

interface WebSessionPayload {
  exp: number;
  iat: number;
  nonce: string;
  sub: "codexnext-web";
}

export function relayConfigured(): boolean {
  return Boolean(configuredRelayUrl() && configuredOwnerToken());
}

export function configuredRelayUrl(): string | null {
  return process.env.CODEXNEXT_RELAY_URL || process.env.NEXT_PUBLIC_CODEXNEXT_RELAY_URL || null;
}

export function configuredControlUrl(): string | null {
  return process.env.CODEXNEXT_CONTROL_URL || configuredRelayUrl();
}

export function configuredOwnerToken(): string | null {
  return process.env.CODEXNEXT_OWNER_TOKEN || null;
}

export function webLoginEnabled(): boolean {
  return relayConfigured() && Boolean(passwordHashConfig()) && Boolean(sessionSecret());
}

export function passwordHashConfig(): string | null {
  return process.env.CODEXNEXT_WEB_AUTH_PASSWORD_HASH || null;
}

export function sessionSecret(): string | null {
  return process.env.CODEXNEXT_WEB_SESSION_SECRET || null;
}

export function webSessionCookieName(): string {
  return SESSION_COOKIE_NAME;
}

export function relaySessionCookieName(): string {
  return RELAY_SESSION_COOKIE_NAME;
}

export function issueWebSessionCookieValue(now = Date.now()): string {
  const secret = sessionSecret();
  if (!secret) {
    throw new Error("Missing CODEXNEXT_WEB_SESSION_SECRET");
  }
  const payload: WebSessionPayload = {
    sub: "codexnext-web",
    iat: Math.floor(now / 1000),
    exp: Math.floor(now / 1000) + SESSION_TTL_SECONDS,
    nonce: randomBytes(18).toString("base64url")
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

export function verifyWebSessionCookieValue(
  value: string | null | undefined,
  now = Date.now()
): WebSessionPayload | null {
  if (!value) {
    return null;
  }
  const secret = sessionSecret();
  if (!secret) {
    return null;
  }
  const [encoded, signature] = value.split(".");
  if (!encoded || !signature) {
    return null;
  }
  const expected = createHmac("sha256", secret).update(encoded).digest("base64url");
  if (!safeEqual(signature, expected)) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as WebSessionPayload;
    if (
      payload.sub !== "codexnext-web" ||
      typeof payload.iat !== "number" ||
      typeof payload.exp !== "number" ||
      typeof payload.nonce !== "string"
    ) {
      return null;
    }
    if (payload.exp * 1000 <= now) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export function isLoggedIn(cookies: ReadonlyRequestCookies): boolean {
  if (!webLoginEnabled()) {
    return true;
  }
  return Boolean(
    verifyWebSessionCookieValue(cookies.get(webSessionCookieName())?.value ?? null)
  );
}

export function redirectToLogin(nextPath = "/"): never {
  redirect(`/login?next=${encodeURIComponent(nextPath)}`);
}

export function requireLogin(cookies: ReadonlyRequestCookies, nextPath = "/"): void {
  if (!isLoggedIn(cookies)) {
    redirectToLogin(nextPath);
  }
}

export function loginCookieOptions() {
  const secure = isSecureCookieRequired();
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: "/",
    maxAge: SESSION_TTL_SECONDS
  };
}

export function clearLoginCookieOptions() {
  return {
    ...loginCookieOptions(),
    maxAge: 0
  };
}

export function relaySessionCookieOptions() {
  return {
    ...loginCookieOptions(),
    maxAge: RELAY_SESSION_TTL_SECONDS
  };
}

export function clearRelaySessionCookieOptions() {
  return {
    ...relaySessionCookieOptions(),
    maxAge: 0
  };
}

export function verifyPassword(input: string): boolean {
  const configured = passwordHashConfig();
  if (!configured) {
    verifyAgainstDummyHash(input);
    return false;
  }
  const [scheme, saltValue, hashValue] = configured.split("$");
  if (scheme !== "scrypt" || !saltValue || !hashValue) {
    verifyAgainstDummyHash(input);
    return false;
  }
  const salt = safeBase64Buffer(saltValue) ?? DUMMY_SALT;
  const expected = safeBase64Buffer(hashValue) ?? DUMMY_HASH;
  const actual = scryptSync(input, salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function loginRateLimitStatus(key: string, now = Date.now()): {
  allowed: boolean;
  retryAfterMs: number;
} {
  pruneLoginAttempts(now);
  const entry = loginAttempts.get(key);
  if (!entry) {
    return { allowed: true, retryAfterMs: 0 };
  }
  if (entry.blockedUntil > now) {
    return { allowed: false, retryAfterMs: entry.blockedUntil - now };
  }
  return { allowed: true, retryAfterMs: 0 };
}

export function recordLoginFailure(key: string, now = Date.now()): {
  blocked: boolean;
  retryAfterMs: number;
} {
  const current = loginAttempts.get(key);
  const base =
    current && current.resetAt > now
      ? current
      : { count: 0, resetAt: now + LOGIN_WINDOW_MS, blockedUntil: 0 };
  base.count += 1;
  if (base.count >= LOGIN_MAX_FAILURES) {
    base.blockedUntil = now + LOGIN_WINDOW_MS;
  }
  loginAttempts.set(key, base);
  return {
    blocked: base.blockedUntil > now,
    retryAfterMs: Math.max(0, base.blockedUntil - now)
  };
}

export function clearLoginFailures(key: string): void {
  loginAttempts.delete(key);
}

function pruneLoginAttempts(now: number): void {
  for (const [key, value] of loginAttempts.entries()) {
    if (value.resetAt <= now && value.blockedUntil <= now) {
      loginAttempts.delete(key);
    }
  }
}

function verifyAgainstDummyHash(input: string): void {
  scryptSync(input, DUMMY_SALT, DUMMY_HASH.length);
}

function safeBase64Buffer(value: string): Buffer | null {
  try {
    return Buffer.from(value, "base64url");
  } catch {
    return null;
  }
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function isSecureCookieRequired(): boolean {
  const publicOrigin = process.env.CODEXNEXT_PUBLIC_ORIGIN;
  if (!publicOrigin) {
    return process.env.NODE_ENV === "production";
  }
  try {
    return new URL(publicOrigin).protocol === "https:";
  } catch {
    return process.env.NODE_ENV === "production";
  }
}

interface ReadonlyRequestCookies {
  get(name: string): { value: string } | undefined;
}
