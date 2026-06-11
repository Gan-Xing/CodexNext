import { describe, expect, it } from "vitest";
import { RelayMethod } from "@codexnext/protocol";
import {
  SLOW_RELAY_RPC_TIMEOUT_MS,
  routeRpcTimeout,
  validateRelayRpcResult
} from "../src/relay-rpc.js";
import { classifyRelayRpcError } from "../src/server.js";

describe("classifyRelayRpcError", () => {
  it("maps timeout, offline, not-found, and generic relay RPC failures", () => {
    expect(classifyRelayRpcError(new Error("relay rpc timeout: operation timed out"))).toEqual({
      message: "relay rpc timeout: operation timed out",
      reason: "relay_rpc_timeout",
      statusCode: 504
    });
    expect(classifyRelayRpcError(new Error("Device offline: device_1"))).toEqual({
      message: "Device offline: device_1",
      reason: "device_offline",
      statusCode: 503
    });
    expect(classifyRelayRpcError(new Error("Device not found: device_1"))).toEqual({
      message: "Device not found: device_1",
      reason: "not_found",
      statusCode: 404
    });
    expect(classifyRelayRpcError(new Error("No pending approval for id approval_1"))).toEqual({
      message: "No pending approval for id approval_1",
      reason: "not_found",
      statusCode: 404
    });
    expect(classifyRelayRpcError(new Error("Invalid relay RPC result for agent.health"))).toEqual({
      message: "Invalid relay RPC result for agent.health",
      reason: "relay_rpc_protocol_error",
      statusCode: 502
    });
    expect(classifyRelayRpcError("unexpected ack shape")).toEqual({
      message: "unexpected ack shape",
      reason: "relay_rpc_error",
      statusCode: 400
    });
  });
});

describe("routeRpcTimeout", () => {
  it("uses slow timeouts for long-running relay RPC routes", () => {
    expect(routeRpcTimeout(RelayMethod.AgentHealth, 30_000)).toBe(30_000);
    expect(routeRpcTimeout(RelayMethod.SessionsCreate, 30_000)).toBe(
      SLOW_RELAY_RPC_TIMEOUT_MS
    );
    expect(routeRpcTimeout(RelayMethod.CodexHistoryDetail, 30_000)).toBe(
      SLOW_RELAY_RPC_TIMEOUT_MS
    );
    expect(routeRpcTimeout(RelayMethod.CodexHistoryTurns, 120_000)).toBe(
      120_000
    );
    expect(routeRpcTimeout(RelayMethod.CodexHistoryResume, 30_000)).toBe(
      SLOW_RELAY_RPC_TIMEOUT_MS
    );
  });
});

describe("validateRelayRpcResult", () => {
  it("returns parsed relay RPC results", () => {
    expect(
      validateRelayRpcResult(
        {
          safeParse: (value) => ({
            success: true,
            data: { parsed: value }
          })
        },
        { ok: true },
        RelayMethod.AgentHealth
      )
    ).toEqual({ parsed: { ok: true } });
  });

  it("throws method-specific errors for malformed relay RPC results", () => {
    expect(() =>
      validateRelayRpcResult(
        {
          safeParse: () => ({ success: false })
        },
        { ok: true },
        RelayMethod.AgentHealth
      )
    ).toThrow("Invalid relay RPC result for agent.health");
  });
});
