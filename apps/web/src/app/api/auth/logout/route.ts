import { NextResponse } from "next/server";
import { writeWebAudit } from "../../../../lib/audit-log";
import {
  clearLoginCookieOptions,
  webSessionCookieName
} from "../../../../lib/server-auth";

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const response = NextResponse.json({ ok: true });
  response.cookies.set(webSessionCookieName(), "", clearLoginCookieOptions());
  writeWebAudit({
    action: "web.logout",
    outcome: "success",
    ip
  });
  return response;
}
