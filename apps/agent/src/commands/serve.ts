import { randomBytes } from "node:crypto";
import pino from "pino";
import {
  createLocalServer,
  listen
} from "../local-server/create-local-server.js";
import { printLine, printSection } from "../output.js";

export interface ServeOptions {
  host: string;
  port: number;
  webOrigin: string;
  token?: string;
  allowRemoteDirect?: boolean;
  approvalTimeoutMs: number;
  codexBin: string;
}

export async function runServe(options: ServeOptions): Promise<void> {
  assertDevDirectEnabled();
  assertAllowedDirectHost(options.host, options.allowRemoteDirect ?? false);
  const token = options.token ?? randomBytes(24).toString("base64url");
  const logger = pino({
    name: "codexnext-agent-serve",
    level: process.env.LOG_LEVEL ?? "warn"
  });

  const handle = createLocalServer({
    host: options.host,
    port: options.port,
    webOrigin: options.webOrigin,
    token,
    approvalTimeoutMs: options.approvalTimeoutMs,
    codexBin: options.codexBin
  });

  const address = await listen(handle, options.host, options.port);
  const apiUrl = `http://${address.address}:${address.port}`;

  printSection("codexnext dev-serve", "hidden direct-mode agent is listening");
  printLine(`API: ${apiUrl}`);
  printLine("");
  printLine("Direct mode is dev-only and no token URL is printed.");
  printLine("Pass --token explicitly if you need to test a local client.");
  printLine("Press Ctrl+C to stop the local agent.");

  const shutdown = async () => {
    printLine("");
    printSection("shutdown", "closing sessions and local server");
    await handle.close();
    process.exit(0);
  };

  process.once("SIGINT", () => {
    void shutdown();
  });
  process.once("SIGTERM", () => {
    void shutdown();
  });

  logger.debug({ apiUrl }, "local dev-only direct agent started");
}

export function assertDevDirectEnabled(): void {
  if (process.env.CODEXNEXT_ENABLE_DEV_DIRECT === "1") {
    return;
  }
  throw new Error(
    "Direct mode is disabled. Set CODEXNEXT_ENABLE_DEV_DIRECT=1 to use codexnext serve for local development."
  );
}

export function assertAllowedDirectHost(host: string, allowRemoteDirect: boolean): void {
  if (allowRemoteDirect || isLoopbackHost(host)) {
    return;
  }
  throw new Error(
    `Refusing remote direct mode on host ${host}. Pass --allow-remote-direct to expose direct mode beyond loopback.`
  );
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return normalized === "127.0.0.1" || normalized === "::1" || normalized === "localhost";
}
