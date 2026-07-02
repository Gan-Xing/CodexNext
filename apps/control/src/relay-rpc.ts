import type { RelayMethod } from "@codexnext/protocol";
import { RelayMethod as RelayMethodValue } from "@codexnext/protocol";

export const SLOW_RELAY_RPC_TIMEOUT_MS = 90_000;

export interface RelayRpcResultSchema {
  safeParse(value: unknown): { success: true; data: unknown } | { success: false };
}

export interface RelayRpcErrorClassification {
  message: string;
  reason:
    | "relay_rpc_timeout"
    | "payload_too_large"
    | "device_offline"
    | "not_found"
    | "relay_rpc_protocol_error"
    | "relay_rpc_error";
  statusCode: 400 | 404 | 413 | 502 | 503 | 504;
}

export function validateRelayRpcResult(
  schema: RelayRpcResultSchema,
  result: unknown,
  method: RelayMethod
): unknown {
  const parsed = schema.safeParse(result);
  if (!parsed.success) {
    throw new Error(`Invalid relay RPC result for ${method}`);
  }
  return parsed.data;
}

export function routeRpcTimeout(
  method: RelayMethod,
  defaultTimeoutMs: number
): number {
  switch (method) {
    case RelayMethodValue.SessionsCreate:
    case RelayMethodValue.SessionsRuntimeUpdate:
    case RelayMethodValue.CodexHistoryDetail:
    case RelayMethodValue.CodexHistoryTurns:
    case RelayMethodValue.CodexHistoryResume:
      return Math.max(defaultTimeoutMs, SLOW_RELAY_RPC_TIMEOUT_MS);
    default:
      return defaultTimeoutMs;
  }
}

export function classifyRelayRpcError(error: unknown): RelayRpcErrorClassification {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  if (normalized.includes("payload_too_large")) {
    return { message, reason: "payload_too_large", statusCode: 413 };
  }
  if (normalized.includes("timeout")) {
    return { message, reason: "relay_rpc_timeout", statusCode: 504 };
  }
  if (normalized.includes("not connected") || normalized.includes("offline")) {
    return { message, reason: "device_offline", statusCode: 503 };
  }
  if (normalized.includes("not found") || normalized.includes("no pending approval")) {
    return { message, reason: "not_found", statusCode: 404 };
  }
  if (normalized.includes("invalid relay rpc result")) {
    return { message, reason: "relay_rpc_protocol_error", statusCode: 502 };
  }
  return { message, reason: "relay_rpc_error", statusCode: 400 };
}
