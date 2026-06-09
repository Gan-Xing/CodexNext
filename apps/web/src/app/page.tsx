import { cookies } from "next/headers";
import { WebConsole } from "../components/WebConsole";
import { requireLogin, webLoginEnabled } from "../lib/server-auth";

export default async function Page() {
  if (webLoginEnabled()) {
    const cookieStore = await cookies();
    requireLogin(cookieStore, "/");
  }
  return <WebConsole />;
}
