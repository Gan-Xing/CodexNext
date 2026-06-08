import type {
  PairingApproveResponse,
  PairingRequestView
} from "./types";

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

export function normalizeRelayPairCode(code: string): string {
  return code.replace(/\D+/g, "").slice(0, 6);
}

export function formatRelayPairCode(code: string): string {
  const normalized = normalizeRelayPairCode(code);
  if (normalized.length <= 3) {
    return normalized;
  }
  return `${normalized.slice(0, 3)}-${normalized.slice(3)}`;
}

export async function getRelayPairingRequest(
  relayUrl: string,
  code: string
): Promise<PairingRequestView> {
  const normalized = normalizeRelayPairCode(code);
  const response = await fetch(
    new URL(`/api/pairings/requests/${encodeURIComponent(normalized)}`, relayUrl)
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Pairing request lookup failed: ${response.status}`);
  }
  return (await response.json()) as PairingRequestView;
}

export async function approveRelayPairingRequest(
  relayUrl: string,
  code: string,
  accessToken: string
): Promise<PairingApproveResponse> {
  const normalized = normalizeRelayPairCode(code);
  const response = await fetch(
    new URL(
      `/api/pairings/requests/${encodeURIComponent(normalized)}/approve`,
      relayUrl
    ),
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    }
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Pairing request approval failed: ${response.status}`);
  }
  return (await response.json()) as PairingApproveResponse;
}
