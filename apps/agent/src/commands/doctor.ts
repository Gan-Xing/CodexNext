import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { printLine } from "../output.js";

interface CommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  error?: Error;
}

interface DoctorCheck {
  name: string;
  status: "ok" | "warn" | "fail";
  detail: string;
  fix?: string | undefined;
}

export interface DoctorOptions {
  relay?: string;
}

export async function runDoctor(options: DoctorOptions = {}): Promise<void> {
  const checks: DoctorCheck[] = [];

  checks.push(checkNodeVersion());

  const pnpm = await runCommand("pnpm", ["--version"]);
  checks.push({
    name: "pnpm",
    status: pnpm.ok ? "ok" : "fail",
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
    status: codex.ok ? "ok" : "fail",
    detail: codex.ok
      ? `codex --version: ${codex.stdout.trim()}`
      : "codex was not found on PATH.",
    fix: codex.ok
      ? undefined
      : "Install the Codex CLI, then make sure `codex` is available on PATH. Restart this terminal or Codex app if PATH was updated."
  });

  checks.push(await checkDeviceIdentity());
  checks.push(...checkDeploymentEnv());

  const relayUrl = options.relay ?? process.env.CODEXNEXT_RELAY_URL ?? "";
  if (relayUrl) {
    checks.push(await checkRelayHealth(relayUrl));
  } else {
    checks.push({
      name: "relay health",
      status: "warn",
      detail: "No relay URL was supplied. Pass --relay <url> or set CODEXNEXT_RELAY_URL to probe control health."
    });
  }

  printLine("CodexNext doctor");
  printLine("");

  for (const check of checks) {
    printLine(`[${check.status}] ${check.name}: ${check.detail}`);
    if (check.status !== "ok" && check.fix) {
      printLine(`      fix: ${check.fix}`);
    }
  }

  const failed = checks.filter((check) => check.status === "fail");
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
    status: ok ? "ok" : "fail",
    detail: `Node ${nodeVersion}`,
    fix: ok
      ? undefined
      : "Install Node >= 20. Recommended: use fnm, nvm, Volta, or the official Node installer."
  };
}

async function checkDeviceIdentity(): Promise<DoctorCheck> {
  const filePath = path.join(os.homedir(), ".codexnext", "device.json");
  try {
    const info = await stat(filePath);
    const mode = info.mode & 0o777;
    const strict = (mode & 0o077) === 0;
    return {
      name: "device identity",
      status: strict ? "ok" : "warn",
      detail: strict
        ? "Device identity file exists with restricted permissions."
        : `Device identity file exists but permissions are ${mode.toString(8)}.`,
      fix: strict
        ? undefined
        : "Run: chmod 600 ~/.codexnext/device.json"
    };
  } catch {
    return {
      name: "device identity",
      status: "warn",
      detail: "No device identity file found yet.",
      fix: "Run `codexnext pair --relay <url>` on this machine before starting the long-running relay agent."
    };
  }
}

function checkDeploymentEnv(): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  const production = process.env.CODEXNEXT_PRODUCTION === "1" || process.env.NODE_ENV === "production";

  checks.push({
    name: "owner token env",
    status:
      process.env.CODEXNEXT_OWNER_TOKEN && process.env.CODEXNEXT_OWNER_TOKEN.length < 32
        ? "warn"
        : "ok",
    detail: process.env.CODEXNEXT_OWNER_TOKEN
      ? process.env.CODEXNEXT_OWNER_TOKEN.length < 32
        ? "CODEXNEXT_OWNER_TOKEN is set but looks short for production."
        : "CODEXNEXT_OWNER_TOKEN is set."
      : "CODEXNEXT_OWNER_TOKEN is not set in this process; this is fine for agent-only diagnostics."
  });

  const webEnvSet = [
    "CODEXNEXT_WEB_AUTH_PASSWORD_HASH",
    "CODEXNEXT_WEB_SESSION_SECRET",
    "CODEXNEXT_PUBLIC_ORIGIN"
  ].filter((key) => Boolean(process.env[key]));
  checks.push({
    name: "web login env",
    status: webEnvSet.length === 0 || webEnvSet.length === 3 ? "ok" : "warn",
    detail:
      webEnvSet.length === 3
        ? "Web login env is present."
        : webEnvSet.length === 0
          ? "Web login env is not set in this process; this is fine for agent-only diagnostics."
          : "Web login env is partially configured.",
    fix:
      webEnvSet.length === 0 || webEnvSet.length === 3
        ? undefined
        : "Set CODEXNEXT_WEB_AUTH_PASSWORD_HASH, CODEXNEXT_WEB_SESSION_SECRET, and CODEXNEXT_PUBLIC_ORIGIN together."
  });

  checks.push(checkPublicOrigin());

  checks.push({
    name: "production origins",
    status:
      production && !process.env.CODEXNEXT_ALLOWED_ORIGINS
        ? "warn"
        : "ok",
    detail:
      production && !process.env.CODEXNEXT_ALLOWED_ORIGINS
        ? "Production mode is active but CODEXNEXT_ALLOWED_ORIGINS is not set in this process."
        : "Production origin configuration does not show an obvious missing allowlist.",
    fix:
      production && !process.env.CODEXNEXT_ALLOWED_ORIGINS
        ? "Set CODEXNEXT_ALLOWED_ORIGINS to the exact Web origin when running control in production."
        : undefined
  });

  checks.push({
    name: "direct mode env",
    status: process.env.CODEXNEXT_ENABLE_DEV_DIRECT === "1" ? "warn" : "ok",
    detail:
      process.env.CODEXNEXT_ENABLE_DEV_DIRECT === "1"
        ? "Hidden dev-only direct mode is enabled in this process."
        : "Hidden dev-only direct mode is not enabled.",
    fix:
      process.env.CODEXNEXT_ENABLE_DEV_DIRECT === "1"
        ? "Unset CODEXNEXT_ENABLE_DEV_DIRECT outside local troubleshooting."
        : undefined
  });

  return checks;
}

function checkPublicOrigin(): DoctorCheck {
  const raw = process.env.CODEXNEXT_PUBLIC_ORIGIN;
  if (!raw) {
    return {
      name: "public origin",
      status: "ok",
      detail: "CODEXNEXT_PUBLIC_ORIGIN is not set in this process."
    };
  }
  try {
    const url = new URL(raw);
    const local =
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "::1";
    const safe = url.protocol === "https:" || local;
    return {
      name: "public origin",
      status: safe ? "ok" : "warn",
      detail: safe
        ? `Public origin is ${safeUrlLabel(raw)}.`
        : `Public origin is ${safeUrlLabel(raw)} and is not HTTPS.`,
      fix: safe
        ? undefined
        : "Use HTTPS behind a reverse proxy for public production Web access."
    };
  } catch {
    return {
      name: "public origin",
      status: "warn",
      detail: "CODEXNEXT_PUBLIC_ORIGIN is not a valid URL.",
      fix: "Set CODEXNEXT_PUBLIC_ORIGIN to the exact Web origin, for example https://codexnext.example."
    };
  }
}

async function checkRelayHealth(relayUrl: string): Promise<DoctorCheck> {
  try {
    const response = await fetch(new URL("/api/control/health", relayUrl), {
      signal: AbortSignal.timeout(3_000)
    });
    if (!response.ok) {
      return {
        name: "relay health",
        status: "fail",
        detail: `Relay ${safeUrlLabel(relayUrl)} returned HTTP ${response.status}.`,
        fix: "Start the control service and verify the relay URL points to the control port."
      };
    }
    const payload = (await response.json().catch(() => null)) as unknown;
    if (!isSafeHealthPayload(payload)) {
      return {
        name: "relay health",
        status: "fail",
        detail: `Relay ${safeUrlLabel(relayUrl)} returned an invalid health payload.`,
        fix: "Check that the URL points to CodexNext control, not Web or an agent."
      };
    }
    return {
      name: "relay health",
      status: "ok",
      detail: `Relay ${safeUrlLabel(relayUrl)} is healthy.`
    };
  } catch (error) {
    return {
      name: "relay health",
      status: "fail",
      detail: `Relay ${safeUrlLabel(relayUrl)} is unreachable: ${formatError(error)}`,
      fix: "Verify networking, reverse proxy, firewall, and that /api/control/health is reachable on the control service."
    };
  }
}

function isSafeHealthPayload(value: unknown): value is { ok: true } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (record.ok !== true) {
    return false;
  }
  return Object.keys(record).every(
    (key) => !/(token|secret|password|prompt|assistant|command|output|content)/i.test(key)
  );
}

function safeUrlLabel(raw: string): string {
  try {
    const url = new URL(raw);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "<invalid-url>";
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

export const __doctorTestInternals = {
  isSafeHealthPayload,
  safeUrlLabel
};
