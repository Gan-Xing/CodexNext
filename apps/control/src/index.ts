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
    "--public-web-origin <origin>",
    "Public Web origin used to build approval links shown to users."
  )
  .option(
    "--allow-origin <origin>",
    "Allowed browser origin. Repeat for multiple origins.",
    collectString,
    []
  )
  .option("--production", "Enable production security checks.")
  .option(
    "--allow-machine-owner-token",
    "Allow machine bootstrap with owner token. Disabled by default in production."
  )
  .option(
    "--allow-relay-full-access",
    "Allow relay requests to ask for full-access. Usually not needed because relay full-access is enabled by default."
  )
  .option(
    "--disable-relay-full-access",
    "Disable relay requests from asking for full-access even though the product default is enabled."
  )
  .option(
    "--heartbeat-interval-ms <number>",
    "Heartbeat interval returned to machines.",
    parsePositiveInteger,
    15_000
  )
  .option(
    "--stale-device-timeout-ms <number>",
    "Mark devices offline after this many milliseconds without heartbeat. Defaults to 4x heartbeat interval.",
    parsePositiveInteger
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
      publicWebOrigin?: string;
      allowOrigin: string[];
      production?: boolean;
      allowMachineOwnerToken?: boolean;
      allowRelayFullAccess?: boolean;
      disableRelayFullAccess?: boolean;
      heartbeatIntervalMs: number;
      staleDeviceTimeoutMs?: number;
      rpcTimeoutMs: number;
    }) => {
      const handle = createControlServer({
        ownerToken: options.ownerToken,
        host: options.host,
        port: options.port,
        ...(options.publicWebOrigin
          ? { publicWebOrigin: options.publicWebOrigin }
          : {}),
        allowedOrigins: options.allowOrigin,
        ...(options.production !== undefined ? { production: options.production } : {}),
        ...(options.allowMachineOwnerToken !== undefined
          ? { allowMachineOwnerToken: options.allowMachineOwnerToken }
          : {}),
        ...(
          options.disableRelayFullAccess
            ? { allowRelayFullAccess: false }
            : options.allowRelayFullAccess !== undefined
              ? { allowRelayFullAccess: options.allowRelayFullAccess }
              : {}
        ),
        heartbeatIntervalMs: options.heartbeatIntervalMs,
        ...(options.staleDeviceTimeoutMs !== undefined
          ? { staleDeviceTimeoutMs: options.staleDeviceTimeoutMs }
          : {}),
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

function collectString(value: string, previous: string[]): string[] {
  return [...previous, value];
}
