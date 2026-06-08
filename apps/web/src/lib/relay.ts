export const relayAccessTokenStorageKey = "codexnext.relayAccessToken.v1";
export const legacyRelayOwnerTokenStorageKey = "codexnext.relayOwnerToken.v1";

export function resolveDefaultRelayUrl(): string {
  return process.env.NEXT_PUBLIC_CODEXNEXT_RELAY_URL || window.location.origin;
}

export interface RelaySessionBootstrap {
  relayUrl: string;
  sessionToken: string;
}

export async function requestRelaySession(): Promise<RelaySessionBootstrap | null> {
  const response = await fetch("/api/relay/session", {
    method: "POST"
  });
  if (response.status === 204 || response.status === 404) {
    return null;
  }
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Relay session bootstrap failed: ${response.status}`);
  }
  return (await response.json()) as RelaySessionBootstrap;
}
