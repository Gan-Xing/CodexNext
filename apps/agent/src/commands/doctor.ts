import { spawn } from "node:child_process";
import { printLine } from "../output.js";

interface CommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  error?: Error;
}

interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
  fix?: string | undefined;
}

export async function runDoctor(): Promise<void> {
  const checks: DoctorCheck[] = [];

  checks.push(checkNodeVersion());

  const pnpm = await runCommand("pnpm", ["--version"]);
  checks.push({
    name: "pnpm",
    ok: pnpm.ok,
    detail: pnpm.ok
      ? `pnpm ${pnpm.stdout.trim()}`
      : "pnpm was not found on PATH.",
    fix: pnpm.ok
      ? undefined
      : "Enable Corepack and install pnpm: corepack enable && corepack prepare pnpm@latest --activate"
  });

  const codex = await runCommand("codex", ["--version"]);
  checks.push({
    name: "codex",
    ok: codex.ok,
    detail: codex.ok
      ? `codex --version: ${codex.stdout.trim()}`
      : "codex was not found on PATH.",
    fix: codex.ok
      ? undefined
      : "Install the Codex CLI, then make sure `codex` is available on PATH. Restart this terminal or Codex app if PATH was updated."
  });

  printLine("CodexNext doctor");
  printLine("");

  for (const check of checks) {
    printLine(`${check.ok ? "[ok]" : "[fail]"} ${check.name}: ${check.detail}`);
    if (!check.ok && check.fix) {
      printLine(`      fix: ${check.fix}`);
    }
  }

  const failed = checks.filter((check) => !check.ok);
  if (failed.length > 0) {
    printLine("");
    throw new Error(
      `Doctor found ${failed.length} problem${failed.length === 1 ? "" : "s"}.`
    );
  }
}

function checkNodeVersion(): DoctorCheck {
  const nodeVersion = process.versions.node;
  const major = Number(nodeVersion.split(".")[0]);
  const ok = Number.isFinite(major) && major >= 20;

  return {
    name: "node",
    ok,
    detail: `Node ${nodeVersion}`,
    fix: ok
      ? undefined
      : "Install Node >= 20. Recommended: use fnm, nvm, Volta, or the official Node installer."
  };
}

function runCommand(command: string, args: string[]): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      resolve({ ok: false, stdout, stderr, error });
    });

    child.on("close", (code) => {
      resolve({ ok: code === 0, stdout, stderr });
    });
  });
}
