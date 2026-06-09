import { NextResponse } from "next/server";
import { writeWebAudit } from "../../../../lib/audit-log";
import {
  clearLoginFailures,
  issueWebSessionCookieValue,
  loginCookieOptions,
  loginRateLimitStatus,
  recordLoginFailure,
  verifyPassword,
  webLoginEnabled,
  webSessionCookieName
} from "../../../../lib/server-auth";

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rateLimit = loginRateLimitStatus(ip);
  if (!rateLimit.allowed) {
    writeWebAudit({
      action: "web.login",
      outcome: "failure",
      ip,
      reason: "rate_limited"
    });
    return NextResponse.json(
      { error: "登录失败，请稍后再试。" },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(rateLimit.retryAfterMs / 1000))
        }
      }
    );
  }

  const body = (await request.json().catch(() => ({}))) as { password?: unknown };
  const password = typeof body.password === "string" ? body.password : "";

  if (!webLoginEnabled() || !verifyPassword(password)) {
    const next = recordLoginFailure(ip);
    writeWebAudit({
      action: "web.login",
      outcome: "failure",
      ip,
      reason: next.blocked ? "invalid_credentials_blocked" : "invalid_credentials"
    });
    return NextResponse.json(
      { error: "登录失败，请检查凭据。" },
      {
        status: next.blocked ? 429 : 401,
        ...(next.blocked
          ? {
              headers: {
                "Retry-After": String(Math.ceil(next.retryAfterMs / 1000))
              }
            }
          : {})
      }
    );
  }

  clearLoginFailures(ip);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(
    webSessionCookieName(),
    issueWebSessionCookieValue(),
    loginCookieOptions()
  );
  writeWebAudit({
    action: "web.login",
    outcome: "success",
    ip
  });
  return response;
}
