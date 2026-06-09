import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  isLoggedIn,
  webLoginEnabled
} from "../../../../lib/server-auth";

export async function GET() {
  const cookieStore = await cookies();
  return NextResponse.json({
    authenticated: isLoggedIn(cookieStore),
    loginRequired: webLoginEnabled()
  });
}
