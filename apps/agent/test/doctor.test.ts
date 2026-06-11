import { describe, expect, it } from "vitest";
import { __doctorTestInternals } from "../src/commands/doctor.js";

describe("doctor redaction helpers", () => {
  it("formats relay URLs without credentials, query strings, or fragments", () => {
    expect(
      __doctorTestInternals.safeUrlLabel(
        "https://user:pass@relay.example/control?token=secret#section"
      )
    ).toBe("https://relay.example/control");
    expect(__doctorTestInternals.safeUrlLabel("not a url")).toBe("<invalid-url>");
  });

  it("accepts minimal non-sensitive health payloads", () => {
    expect(
      __doctorTestInternals.isSafeHealthPayload({
        ok: true,
        onlineDevices: 0,
        uptimeSeconds: 12
      })
    ).toBe(true);
  });

  it("rejects health payloads that include sensitive diagnostic fields", () => {
    for (const key of [
      "sessionToken",
      "ownerSecret",
      "prompt",
      "assistantContent",
      "commandOutput"
    ]) {
      expect(
        __doctorTestInternals.isSafeHealthPayload({
          ok: true,
          [key]: "must-not-be-rendered"
        })
      ).toBe(false);
    }
  });
});
