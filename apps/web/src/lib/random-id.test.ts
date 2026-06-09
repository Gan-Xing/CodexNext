import { afterEach, describe, expect, it, vi } from "vitest";
import { createClientId } from "./random-id";

const originalCrypto = globalThis.crypto;

afterEach(() => {
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: originalCrypto
  });
  vi.restoreAllMocks();
});

describe("createClientId", () => {
  it("uses randomUUID when available", () => {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: {
        randomUUID: () => "uuid-123"
      }
    });

    expect(createClientId("message")).toBe("uuid-123");
  });

  it("falls back when randomUUID is unavailable", () => {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: undefined
    });
    vi.spyOn(Date, "now").mockReturnValue(1710000000000);
    vi.spyOn(Math, "random").mockReturnValue(0.123456789);

    expect(createClientId("message")).toMatch(/^message_[a-z0-9]+_4fzzzxjy$/);
  });
});
