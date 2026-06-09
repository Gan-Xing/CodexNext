import { cookies } from "next/headers";
import { PairPageClient } from "../../components/PairPageClient";
import { requireLogin, webLoginEnabled } from "../../lib/server-auth";

export default async function PairPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const searchParams = await props.searchParams;
  const code = firstValue(searchParams.code) ?? "";
  const relay = firstValue(searchParams.relay) ?? "";
  if (webLoginEnabled()) {
    const cookieStore = await cookies();
    requireLogin(
      cookieStore,
      `/pair?code=${encodeURIComponent(code)}${relay ? `&relay=${encodeURIComponent(relay)}` : ""}`
    );
  }
  return <PairPageClient code={code} initialRelayUrl={relay} />;
}

function firstValue(value: string | string[] | undefined): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value) && typeof value[0] === "string") {
    return value[0];
  }
  return null;
}
