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
  approvalTimeoutMs: number;
  codexBin: string;
}

export async function runServe(options: ServeOptions): Promise<void> {
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
  const primaryWebOrigin = options.webOrigin.split(",")[0]?.trim() ?? options.webOrigin;
  const webUrl = `${primaryWebOrigin}?agent=${encodeURIComponent(
    apiUrl
  )}&token=${encodeURIComponent(token)}`;

  printSection("codexnext serve", "local agent is listening");
  printLine(`API: ${apiUrl}`);
  printLine(`Token: ${token}`);
  printLine(`Web: ${webUrl}`);
  printLine("");
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

  logger.debug({ apiUrl, webUrl }, "local agent started");
}
