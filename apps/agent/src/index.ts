#!/usr/bin/env node
import { Command, InvalidArgumentError } from "commander";
import { runDoctor } from "./commands/doctor.js";
import { runGoalSmoke } from "./commands/goal-smoke.js";

const program = new Command();

program
  .name("codexnext")
  .description("CodexNext - Your personal Codex control plane.")
  .version("0.1.0");

program
  .command("doctor")
  .description("Check Node, pnpm, and Codex app-server prerequisites.")
  .action(async () => {
    await runDoctor();
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
