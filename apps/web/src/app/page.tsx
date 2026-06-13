import { cookies } from "next/headers";
import { WebConsole } from "../components/WebConsole";
import { requireLogin, webLoginEnabled } from "../lib/server-auth";

/*
 * Home entry guardrails:
 * - Chat UI state must come from the normalized conversation store.
 * - Message send must stay optimistic with persisted outbox recovery.
 * - History/replay may reconcile turns but must not replace live state or switch selection.
 * - Cold thread switching must not wait on network history before showing local UI.
 * See README.md "Conversation State Guardrails" and "Conversation Performance Guardrails".
 */
export default async function Page() {
  if (webLoginEnabled()) {
    const cookieStore = await cookies();
    requireLogin(cookieStore, "/");
  }
  return <WebConsole />;
}
