import { describe, expect, it } from "vitest";
import {
  consumeRateLimit,
  createOriginMatcher,
  pruneRateLimits,
  resolveRelayFullAccessSetting,
  type RateLimitRecord
} from "../src/control-policy.js";

describe("control policy helpers", () => {
  it("counts requests within a rate-limit window and resets after expiry", () => {
    const rateLimits = new Map<string, RateLimitRecord>();

    expect(consumeRateLimit(rateLimits, "pairing:create:ip:127.0.0.1", 2, 100, 1_000)).toBe(
      true
    );
    expect(consumeRateLimit(rateLimits, "pairing:create:ip:127.0.0.1", 2, 100, 1_010)).toBe(
      true
    );
    expect(consumeRateLimit(rateLimits, "pairing:create:ip:127.0.0.1", 2, 100, 1_020)).toBe(
      false
    );
    expect(rateLimits.get("pairing:create:ip:127.0.0.1")).toEqual({
      count: 3,
      resetAt: 1_100
    });

    expect(consumeRateLimit(rateLimits, "pairing:create:ip:127.0.0.1", 2, 100, 1_100)).toBe(
      true
    );
    expect(rateLimits.get("pairing:create:ip:127.0.0.1")).toEqual({
      count: 1,
      resetAt: 1_200
    });
  });

  it("prunes expired rate-limit buckets and keeps active buckets", () => {
    const rateLimits = new Map<string, RateLimitRecord>([
      ["expired", { count: 3, resetAt: 100 }],
      ["active", { count: 1, resetAt: 101 }]
    ]);

    expect(pruneRateLimits(rateLimits, 100)).toEqual(["expired"]);
    expect([...rateLimits.keys()]).toEqual(["active"]);
  });

  it("matches request origins according to production and development policy", () => {
    const productionMatcher = createOriginMatcher(["https://web.example"], true);
    const openDevMatcher = createOriginMatcher([], false);
    const allowlistedDevMatcher = createOriginMatcher(["http://localhost:3000"], false);

    expect(productionMatcher(undefined)).toBe(true);
    expect(productionMatcher("https://web.example")).toBe(true);
    expect(productionMatcher("https://evil.example")).toBe(false);

    expect(openDevMatcher("http://localhost:5173")).toBe(true);
    expect(allowlistedDevMatcher("http://localhost:3000")).toBe(true);
    expect(allowlistedDevMatcher("http://localhost:5173")).toBe(false);
  });

  it("resolves relay full-access setting from explicit config, env, and defaults", () => {
    expect(
      resolveRelayFullAccessSetting(true, {
        CODEXNEXT_DISABLE_RELAY_FULL_ACCESS: "1"
      })
    ).toBe(true);
    expect(resolveRelayFullAccessSetting(false, {})).toBe(false);
    expect(
      resolveRelayFullAccessSetting(undefined, {
        CODEXNEXT_DISABLE_RELAY_FULL_ACCESS: "1"
      })
    ).toBe(false);
    expect(
      resolveRelayFullAccessSetting(undefined, {
        CODEXNEXT_DISABLE_RELAY_FULL_ACCESS: "0"
      })
    ).toBe(true);
    expect(resolveRelayFullAccessSetting(undefined, {})).toBe(true);
  });
});
