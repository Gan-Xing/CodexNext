#!/usr/bin/env node
import { Command, InvalidArgumentError } from "commander";
import { createControlServer } from "./server.js";

const program = new Command();

program
  .name("codexnext-control")
  .description("CodexNext control server")
  .version("0.1.0");

program
  .requiredOption("--owner-token <token>", "Owner token used by web and machine clients.")
  .option("--host <host>", "Host to bind.", "127.0.0.1")
  .option("--port <port>", "Port to bind.", parsePositiveInteger, 3002)
  .option(
    "--heartbeat-interval-ms <number>",
    "Heartbeat interval returned to machines.",
    parsePositiveInteger,
    15_000
  )
  .option(
    "--rpc-timeout-ms <number>",
    "Default relay RPC timeout.",
    parsePositiveInteger,
    30_000
  )
  .action(
    async (options: {
      ownerToken: string;
      host: string;
      port: number;
      heartbeatIntervalMs: number;
      rpcTimeoutMs: number;
    }) => {
      const handle = createControlServer({
        ownerToken: options.ownerToken,
        host: options.host,
        port: options.port,
        heartbeatIntervalMs: options.heartbeatIntervalMs,
        rpcTimeoutMs: options.rpcTimeoutMs
      });
      await handle.app.listen({
        host: options.host,
        port: options.port
      });
      process.stdout.write(
        `codexnext control listening on http://${options.host}:${options.port}\n`
      );

      const shutdown = async () => {
        await handle.close();
        process.exit(0);
      };
      process.once("SIGINT", () => {
        void shutdown();
      });
      process.once("SIGTERM", () => {
        void shutdown();
      });
    }
  );

program.parseAsync(normalizeArgv(process.argv)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});

function normalizeArgv(argv: string[]): string[] {
  if (argv[2] !== "--") {
    return argv;
  }
  return [...argv.slice(0, 2), ...argv.slice(3)];
}

function parsePositiveInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new InvalidArgumentError("Expected a positive integer.");
  }
  return parsed;
}
