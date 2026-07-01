#!/usr/bin/env node
import { Command, InvalidArgumentError } from "commander";
import { runConnect } from "./commands/connect.js";
import { runDoctor } from "./commands/doctor.js";
import { runGoalSmoke } from "./commands/goal-smoke.js";
import { runPair } from "./commands/pair.js";
import { runServe } from "./commands/serve.js";

const program = new Command();

program
  .name("codexnext")
  .description("CodexNext - Your personal Codex control plane.")
  .version("0.1.0");

program
  .command("doctor")
  .description("Check Node, pnpm, Codex CLI, relay health, and deployment diagnostics.")
  .option("--relay <url>", "Optional control relay URL to probe with /api/control/health.")
  .option("--web <url>", "Optional public Web origin to probe with /api/auth/status and same-origin routes.")
  .option("--device-id <id>", "Optional relay device id for Agent and Provider runtime checks.")
  .option(
    "--require-agent",
    "Fail unless doctor can authenticate to relay and verify an online Agent."
  )
  .option(
    "--require-provider",
    "Fail unless doctor can authenticate to relay and verify CodexProvider runtime and catalog."
  )
  .option(
    "--require-same-origin",
    "Fail when the checked Web and relay URLs do not share the same public origin."
  )
  .option(
    "--expect-closed <host:port>",
    "Assert a public TCP endpoint is not directly reachable. Can be repeated.",
    collectValues,
    []
  )
  .action(async (options: {
    deviceId?: string;
    expectClosed: string[];
    relay?: string;
    requireAgent?: boolean;
    requireProvider?: boolean;
    requireSameOrigin?: boolean;
    web?: string;
  }) => {
    await runDoctor(options);
  });

program
  .command("goal-smoke")
  .description("Run a local Codex app-server Goal smoke test over stdio.")
  .requiredOption("--cwd <path>", "Repository or project directory for Codex.")
  .requiredOption("--goal <text>", "Goal objective to set on the Codex thread.")
  .option("--model <model>", "Optional Codex model override.")
  .option(
    "--token-budget <number>",
    "Optional Goal token budget.",
    parsePositiveInteger
  )
  .action(async (options: {
    cwd: string;
    goal: string;
    model?: string;
    tokenBudget?: number;
  }) => {
    await runGoalSmoke(options);
  });

program
  .command("connect")
  .description("Connect this machine to a remote CodexNext control server over Socket.IO.")
  .requiredOption("--relay <url>", "Control server URL.")
  .option("--owner-token <token>", "Owner token for the control server.")
  .option("--device-name <name>", "Override device display name.")
  .option(
    "--approval-timeout-ms <number>",
    "Approval request timeout in milliseconds.",
    parsePositiveInteger,
    300_000
  )
  .option("--codex-bin <path>", "Codex binary path.", "codex")
  .action(
    async (options: {
      relay: string;
      ownerToken?: string;
      deviceName?: string;
      approvalTimeoutMs: number;
      codexBin: string;
    }) => {
      await runConnect(options);
    }
  );

program
  .command("pair")
  .description("Request a one-time pairing code and bind this machine to a control server.")
  .requiredOption("--relay <url>", "Control server URL.")
  .option("--device-name <name>", "Override device display name.")
  .option(
    "--approval-timeout-ms <number>",
    "Approval request timeout in milliseconds.",
    parsePositiveInteger,
    300_000
  )
  .option("--codex-bin <path>", "Codex binary path.", "codex")
  .action(
    async (options: {
      relay: string;
      deviceName?: string;
      approvalTimeoutMs: number;
      codexBin: string;
    }) => {
      await runPair(options);
    }
  );

program
  .command("dev-serve")
  .description("Dev-only direct agent API for local troubleshooting.")
  .option("--host <host>", "Host to bind.", "127.0.0.1")
  .option("--port <port>", "Port to bind.", parsePositiveInteger, 17361)
  .option(
    "--web-origin <origin>",
    "Allowed Web Console origin.",
    "http://127.0.0.1:3000"
  )
  .option(
    "--allow-remote-direct",
    "Explicitly allow direct mode to bind beyond loopback."
  )
  .option("--token <token>", "Local API token. Generated if omitted.")
  .option(
    "--approval-timeout-ms <number>",
    "Approval request timeout in milliseconds.",
    parsePositiveInteger,
    300_000
  )
  .option("--codex-bin <path>", "Codex binary path.", "codex")
  .action(
    async (options: {
      host: string;
      port: number;
      webOrigin: string;
      allowRemoteDirect?: boolean;
      token?: string;
      approvalTimeoutMs: number;
      codexBin: string;
    }) => {
      await runServe(options);
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

function collectValues(value: string, previous: string[]): string[] {
  return [...previous, value];
}
