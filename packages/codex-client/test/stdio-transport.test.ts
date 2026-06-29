import { once } from "node:events";
import { describe, expect, it } from "vitest";
import {
  StdioCodexTransport,
  redactCommandArgs
} from "../src/stdio-transport.js";

describe("StdioCodexTransport", () => {
  it("redacts token-like app-server config args before tracing", () => {
    expect(
      redactCommandArgs([
        "app-server",
        "-c",
        "model_providers.openrouter.experimental_bearer_token=\"secret-token\"",
        "-c",
        "provider.api_key=sk-secret",
        "-c",
        "provider.password='pw-secret'",
        "--stdio"
      ])
    ).toEqual([
      "app-server",
      "-c",
      "model_providers.openrouter.experimental_bearer_token=[redacted]",
      "-c",
      "provider.api_key=[redacted]",
      "-c",
      "provider.password=[redacted]",
      "--stdio"
    ]);
  });

  it("parses stdout JSON messages and forwards stderr when configured", async () => {
    const transport = new StdioCodexTransport({
      command: process.execPath,
      args: [
        "-e",
        "console.log(JSON.stringify({ id: 1, result: 'ok' })); console.error('warn-line'); setTimeout(() => {}, 50);"
      ],
      stderr: "emit",
      closeGraceMs: 20
    });
    const message = once(transport, "message");
    const stderr = once(transport, "stderr");

    transport.start();

    await expect(message).resolves.toEqual([{ id: 1, result: "ok" }]);
    const [stderrText] = await stderr;
    expect(stderrText).toContain("warn-line");
    await transport.close();
  });

  it("emits an error for invalid stdout JSON lines", async () => {
    const transport = new StdioCodexTransport({
      command: process.execPath,
      args: ["-e", "console.log('not-json'); setTimeout(() => {}, 50);"],
      closeGraceMs: 20
    });
    const error = once(transport, "error");

    transport.start();

    const [emitted] = await error;
    expect(emitted).toBeInstanceOf(Error);
    expect((emitted as Error).message).toContain(
      "Failed to parse app-server JSON line: not-json"
    );
    await transport.close();
  });

  it("closes a child process that does not exit immediately", async () => {
    const transport = new StdioCodexTransport({
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000);"],
      closeGraceMs: 20
    });

    transport.start();

    await expect(transport.close()).resolves.toBeUndefined();
  });
});
