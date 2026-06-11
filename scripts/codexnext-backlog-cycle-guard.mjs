#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const VERSION = 1;
const DEFAULT_STATE_PATH = "docs/handoff/CodexNext_BACKLOG_CYCLE_STATE.json";
const DEFAULT_LOG_PATH = "docs/handoff/CodexNext_BACKLOG_CYCLE_LOG.md";
const DEFAULT_REPORT_DIR = "docs/handoff/iteration-reports";
const DEFAULT_BACKLOG_PATH = "docs/handoff/CodexNext_CYCLE01_PHASE1_TO_PHASE5_BACKLOG.md";
const FIXED_MAX_CYCLES = 20;

// London time: 2026-06-11 05:30 Europe/London.
// On 2026-06-11 London is BST (UTC+1), so the UTC instant is 04:30Z.
const DEFAULT_DEADLINE_UTC = "2026-06-11T04:30:00.000Z";
const DEADLINE_LABEL = "2026-06-11 05:30 Europe/London";

const argv = process.argv.slice(2);
const command = argv[0] ?? "help";
const options = parseOptions(argv.slice(1));
const root = process.cwd();

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});

async function main() {
  switch (command) {
    case "init":
      return initState();
    case "status":
      return printStatus();
    case "audit":
      return runAudit();
    case "validate-complete":
      return validateComplete({ runVerification: !options["no-verify"] });
    case "complete-cycle":
      return completeCycle();
    case "new-cycle":
      return createNextCycleBacklog();
    case "set-backlog":
      return setBacklog();
    case "help":
    case "--help":
    case "-h":
      return printHelp();
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
}

function parseOptions(items) {
  const parsed = {};
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!item.startsWith("--")) {
      if (!parsed._) parsed._ = [];
      parsed._.push(item);
      continue;
    }
    const eq = item.indexOf("=");
    if (eq >= 0) {
      parsed[item.slice(2, eq)] = item.slice(eq + 1);
      continue;
    }
    const key = item.slice(2);
    const next = items[index + 1];
    if (next && !next.startsWith("--")) {
      parsed[key] = next;
      index += 1;
    } else {
      parsed[key] = true;
    }
  }
  return parsed;
}

function initState() {
  const statePath = stateFilePath();
  if (existsSync(statePath) && !options.force) {
    throw new Error(`${relative(statePath)} already exists. Use --force to overwrite.`);
  }

  const backlogPath = normalizeRepoRelativePath(
    String(options.backlog ?? process.env.CODEXNEXT_ACTIVE_BACKLOG ?? DEFAULT_BACKLOG_PATH)
  );
  const state = defaultState(backlogPath);
  writeJson(statePath, state);
  appendLog(`Initialized backlog cycle state. Active backlog: ${backlogPath}`);
  console.log(`Initialized ${relative(statePath)}`);
  console.log(`Active backlog: ${backlogPath}`);
}

function printStatus() {
  const state = loadStateOrDefault();
  const status = buildStatus(state);
  console.log(JSON.stringify(status, null, 2));
  if (!status.canContinue) {
    console.log(`\nSTOP: ${status.stopReasons.join("; ")}`);
  }
}

function runAudit() {
  const state = loadStateOrDefault();
  const status = buildStatus(state);
  if (!status.canContinue) {
    console.log(JSON.stringify(status, null, 2));
    throw new Error(`Cannot audit because stop condition is active: ${status.stopReasons.join("; ")}`);
  }

  ensureDir(resolveRepo(DEFAULT_REPORT_DIR));
  const label = sanitizeFilePart(String(options.label ?? `cycle-${state.completedCycles + 1}-audit`));
  const timestamp = timestampForFile(new Date());
  const reportPath = resolveRepo(`${DEFAULT_REPORT_DIR}/${timestamp}-${label}.json`);

  const commands = options.quick
    ? []
    : [
        ["pnpm", ["typecheck"]],
        ["pnpm", ["test"]],
        ["pnpm", ["--filter", "@codexnext/agent", "dev", "--", "doctor"]]
      ];

  const report = {
    version: VERSION,
    generatedAt: new Date().toISOString(),
    cycleNumber: state.completedCycles + 1,
    completedCycles: state.completedCycles,
    activeBacklogPath: state.activeBacklogPath,
    deadlineUtc: state.deadlineUtc,
    deadlineLondon: state.deadlineLondon,
    maxCycles: state.maxCycles,
    backlog: state.activeBacklogPath ? scanBacklog(resolveRepo(state.activeBacklogPath)) : null,
    git: collectGitInfo(),
    commands: commands.map(([cmd, args]) => runCommand(cmd, args, { allowFailure: true }))
  };

  writeJson(reportPath, report);
  appendLog(`Audit report written: ${relative(reportPath)}. Pending backlog items: ${report.backlog?.pendingCount ?? "n/a"}.`);
  console.log(`Audit report written: ${relative(reportPath)}`);
  if (report.commands.some((entry) => entry.exitCode !== 0)) {
    process.exitCode = 1;
  }
}

function validateComplete({ runVerification }) {
  const state = loadStateOrDefault();
  const status = buildStatus(state);

  if (!state.activeBacklogPath) {
    throw new Error("No active backlog is set. Use set-backlog or new-cycle first.");
  }
  if (!status.canContinue) {
    throw new Error(`Stop condition is active: ${status.stopReasons.join("; ")}`);
  }

  const backlog = scanBacklog(resolveRepo(state.activeBacklogPath));
  if (backlog.pendingCount > 0) {
    console.error(`Backlog is not complete: ${backlog.pendingCount} unchecked checkbox item(s) remain.`);
    for (const item of backlog.pending.slice(0, 30)) {
      console.error(`  ${relative(resolveRepo(state.activeBacklogPath))}:${item.lineNumber} ${item.text}`);
    }
    process.exit(2);
  }

  if (runVerification) {
    const failures = runVerificationCommands();
    if (failures.length > 0) {
      throw new Error(`Verification failed: ${failures.map((item) => item.commandLine).join(", ")}`);
    }
  }

  console.log("Backlog completion validation passed.");
}

function completeCycle() {
  const state = loadStateOrDefault();
  if (!state.activeBacklogPath) {
    throw new Error("No active backlog is set. Cannot complete a cycle without an active backlog.");
  }

  const status = buildStatus(state);
  if (!status.canContinue) {
    throw new Error(`Cannot complete cycle because stop condition is active: ${status.stopReasons.join("; ")}`);
  }

  const activeBacklogAbs = resolveRepo(state.activeBacklogPath);
  const backlog = scanBacklog(activeBacklogAbs);
  if (backlog.pendingCount > 0) {
    console.error(`Cannot increment count. Active backlog still has ${backlog.pendingCount} unchecked item(s).`);
    for (const item of backlog.pending.slice(0, 40)) {
      console.error(`  ${state.activeBacklogPath}:${item.lineNumber} ${item.text}`);
    }
    process.exit(2);
  }

  if (!options["no-verify"]) {
    const failures = runVerificationCommands();
    if (failures.length > 0) {
      throw new Error(`Cannot complete cycle. Verification failed: ${failures.map((item) => item.commandLine).join(", ")}`);
    }
  }

  const now = new Date();
  const nextCompletedCycles = state.completedCycles + 1;
  const record = {
    cycleNumber: nextCompletedCycles,
    completedAt: now.toISOString(),
    backlogPath: state.activeBacklogPath,
    backlogHash: hashFile(activeBacklogAbs),
    git: collectGitInfo()
  };

  state.completedCycles = nextCompletedCycles;
  state.activeBacklogPath = null;
  state.cycles.push(record);
  state.updatedAt = now.toISOString();
  writeJson(stateFilePath(), state);

  appendLog(
    `Completed cycle ${record.cycleNumber}. Count is now ${state.completedCycles}/${state.maxCycles}. Backlog: ${record.backlogPath}. Commit: ${record.git.head ?? "unknown"}.`
  );

  console.log(`Cycle completed. Count: ${state.completedCycles}/${state.maxCycles}`);
  if (state.completedCycles >= state.maxCycles) {
    console.log("Maximum cycle count reached. Stop.");
  } else if (Date.now() >= new Date(state.deadlineUtc).getTime()) {
    console.log("Deadline reached. Stop.");
  } else {
    console.log("Generate the next backlog with: node scripts/codexnext-backlog-cycle-guard.mjs new-cycle");
  }
}

function createNextCycleBacklog() {
  const state = loadStateOrDefault();
  const status = buildStatus(state);

  if (!status.canContinue) {
    throw new Error(`Cannot create next backlog because stop condition is active: ${status.stopReasons.join("; ")}`);
  }
  if (state.activeBacklogPath) {
    const backlog = scanBacklog(resolveRepo(state.activeBacklogPath));
    if (backlog.pendingCount > 0) {
      throw new Error(
        `Active backlog is not complete (${backlog.pendingCount} unchecked item(s)): ${state.activeBacklogPath}`
      );
    }
    throw new Error(
      `Active backlog is already complete but cycle has not been counted. Run complete-cycle first: ${state.activeBacklogPath}`
    );
  }

  const nextCycle = state.completedCycles + 1;
  const defaultPath = `docs/handoff/CodexNext_CYCLE${String(nextCycle).padStart(2, "0")}_PHASE1_TO_PHASE5_BACKLOG.md`;
  const backlogPath = normalizeRepoRelativePath(String(options.backlog ?? defaultPath));
  const backlogAbs = resolveRepo(backlogPath);
  if (existsSync(backlogAbs) && !options.force) {
    throw new Error(`${backlogPath} already exists. Use --force to overwrite or --backlog <path>.`);
  }

  const template = nextBacklogTemplate(nextCycle, state);
  ensureDir(path.dirname(backlogAbs));
  writeFileSync(backlogAbs, template, "utf8");
  state.activeBacklogPath = backlogPath;
  state.updatedAt = new Date().toISOString();
  writeJson(stateFilePath(), state);
  appendLog(`Created next cycle backlog template: ${backlogPath}. Codex must replace template tasks with a freshly audited backlog before implementation.`);
  console.log(`Created next backlog template: ${backlogPath}`);
  console.log("Important: replace the template with a freshly audited Phase 1–5 backlog before marking anything complete.");
}

function setBacklog() {
  const state = loadStateOrDefault();
  const backlogArg = options.backlog ?? options._?.[0];
  if (!backlogArg) {
    throw new Error("set-backlog requires --backlog <path> or a positional path.");
  }
  const backlogPath = normalizeRepoRelativePath(String(backlogArg));
  const backlogAbs = resolveRepo(backlogPath);
  if (!existsSync(backlogAbs)) {
    throw new Error(`Backlog file does not exist: ${backlogPath}`);
  }
  state.activeBacklogPath = backlogPath;
  state.updatedAt = new Date().toISOString();
  writeJson(stateFilePath(), state);
  appendLog(`Active backlog set to ${backlogPath}.`);
  console.log(`Active backlog set to ${backlogPath}`);
}

function runVerificationCommands() {
  const commands = [
    ["pnpm", ["install"]],
    ["pnpm", ["typecheck"]],
    ["pnpm", ["test"]],
    ["pnpm", ["test:guard"]],
    ["pnpm", ["test:winsw"]],
    ["pnpm", ["--filter", "@codexnext/agent", "dev", "--", "doctor"]]
  ];
  const results = commands.map(([cmd, args]) => runCommand(cmd, args, { allowFailure: true }));
  const failures = results.filter((item) => item.exitCode !== 0);
  const reportPath = resolveRepo(`${DEFAULT_REPORT_DIR}/${timestampForFile(new Date())}-verification.json`);
  ensureDir(path.dirname(reportPath));
  writeJson(reportPath, {
    generatedAt: new Date().toISOString(),
    results
  });
  appendLog(`Verification report written: ${relative(reportPath)}. Failures: ${failures.length}.`);
  return failures;
}

function runCommand(commandName, args, { allowFailure }) {
  const commandLine = [commandName, ...args].join(" ");
  console.log(`\n$ ${commandLine}`);
  const startedAt = new Date();
  if (process.env.CODEXNEXT_BACKLOG_GUARD_FAKE_COMMANDS === "1") {
    const finishedAt = new Date();
    return {
      commandLine,
      exitCode: 0,
      signal: null,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      error: null,
      fake: true
    };
  }
  const result = spawnSync(commandName, args, {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env
  });
  const finishedAt = new Date();
  const entry = {
    commandLine,
    exitCode: typeof result.status === "number" ? result.status : result.error ? 1 : 0,
    signal: result.signal ?? null,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    error: result.error ? String(result.error.message ?? result.error) : null
  };
  if (entry.exitCode !== 0 && !allowFailure) {
    throw new Error(`${commandLine} failed with exit code ${entry.exitCode}`);
  }
  return entry;
}

function buildStatus(state) {
  const now = new Date();
  const deadline = new Date(state.deadlineUtc);
  const backlog = state.activeBacklogPath && existsSync(resolveRepo(state.activeBacklogPath))
    ? scanBacklog(resolveRepo(state.activeBacklogPath))
    : null;
  const stopReasons = [];
  if (state.completedCycles >= state.maxCycles) {
    stopReasons.push(`completedCycles ${state.completedCycles} >= maxCycles ${state.maxCycles}`);
  }
  if (now.getTime() >= deadline.getTime()) {
    stopReasons.push(`current time ${now.toISOString()} >= deadline ${state.deadlineUtc}`);
  }
  return {
    version: VERSION,
    nowUtc: now.toISOString(),
    nowLondon: formatLondon(now),
    deadlineUtc: state.deadlineUtc,
    deadlineLondon: state.deadlineLondon,
    completedCycles: state.completedCycles,
    maxCycles: state.maxCycles,
    activeBacklogPath: state.activeBacklogPath,
    activeBacklogExists: state.activeBacklogPath ? existsSync(resolveRepo(state.activeBacklogPath)) : false,
    backlogCheckboxes: backlog
      ? {
          total: backlog.totalCount,
          completed: backlog.completedCount,
          pending: backlog.pendingCount
        }
      : null,
    canContinue: stopReasons.length === 0,
    stopReasons
  };
}

function scanBacklog(backlogAbs) {
  const content = readFileSync(backlogAbs, "utf8");
  const lines = content.split(/\r?\n/);
  const pending = [];
  const completed = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.includes("codexnext-ignore-checkbox")) continue;
    const match = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.*)$/);
    if (!match) continue;
    const item = {
      lineNumber: index + 1,
      text: match[2].trim()
    };
    if (match[1].toLowerCase() === "x") {
      completed.push(item);
    } else {
      pending.push(item);
    }
  }
  return {
    path: relative(backlogAbs),
    totalCount: pending.length + completed.length,
    pendingCount: pending.length,
    completedCount: completed.length,
    pending,
    completed
  };
}

function loadStateOrDefault() {
  const file = stateFilePath();
  if (!existsSync(file)) {
    return defaultState(normalizeRepoRelativePath(String(options.backlog ?? DEFAULT_BACKLOG_PATH)));
  }
  const state = JSON.parse(readFileSync(file, "utf8"));
  return normalizeState(state);
}

function defaultState(activeBacklogPath) {
  return normalizeState({
    version: VERSION,
    project: "CodexNext",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedCycles: 0,
    maxCycles: FIXED_MAX_CYCLES,
    deadlineUtc: String(options.deadlineUtc ?? process.env.CODEXNEXT_BACKLOG_DEADLINE_UTC ?? DEFAULT_DEADLINE_UTC),
    deadlineLondon: DEADLINE_LABEL,
    activeBacklogPath,
    cycles: []
  });
}

function normalizeState(state) {
  const maxCycles = FIXED_MAX_CYCLES;
  return {
    version: VERSION,
    project: "CodexNext",
    createdAt: state.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedCycles: Number.isInteger(state.completedCycles) ? state.completedCycles : 0,
    maxCycles: Number.isFinite(maxCycles) && maxCycles > 0 ? Math.floor(maxCycles) : FIXED_MAX_CYCLES,
    deadlineUtc: String(options.deadlineUtc ?? process.env.CODEXNEXT_BACKLOG_DEADLINE_UTC ?? state.deadlineUtc ?? DEFAULT_DEADLINE_UTC),
    deadlineLondon: state.deadlineLondon ?? DEADLINE_LABEL,
    activeBacklogPath: state.activeBacklogPath ?? null,
    cycles: Array.isArray(state.cycles) ? state.cycles : []
  };
}

function collectGitInfo() {
  return {
    head: git(["rev-parse", "HEAD"]),
    branch: git(["rev-parse", "--abbrev-ref", "HEAD"]),
    statusShort: git(["status", "--short"]),
    diffStat: git(["diff", "--stat"])
  };
}

function git(args) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    shell: process.platform === "win32"
  });
  if (result.status !== 0) return null;
  return result.stdout.trim();
}

function nextBacklogTemplate(cycleNumber, state) {
  return `# CodexNext Cycle ${String(cycleNumber).padStart(2, "0")} Phase 1–5 Backlog\n\n` +
`This file is a generated placeholder. Replace it with a freshly audited backlog before implementation.\n\n` +
`Rules:\n\n` +
`- The cycle count must not increment until every checkbox in this active backlog is complete.\n` +
`- Do not copy the previous backlog mechanically. Audit code, tests, docs, commits, and prior progress again.\n` +
`- Cover Phase 1, Phase 2, Phase 3, Phase 4, and Phase 5. Weight by current risk.\n` +
`- Include implementation steps, tests, docs, and acceptance criteria.\n` +
`- Avoid shallow/simple implementation. Each item must be verifiable.\n\n` +
`Current count: ${state.completedCycles}/${state.maxCycles}. Deadline: ${state.deadlineLondon}.\n\n` +
`## Fresh Audit Summary\n\n` +
`Replace this section after reading the repository.\n\n` +
`## Backlog\n\n` +
`- [ ] Replace this placeholder with the real next-cycle backlog generated from a fresh audit.\n\n` +
`## Progress Log\n\n` +
`Codex must update this section continuously.\n`;
}

function stateFilePath() {
  return resolveRepo(String(options.state ?? process.env.CODEXNEXT_BACKLOG_STATE ?? DEFAULT_STATE_PATH));
}

function appendLog(message) {
  const file = resolveRepo(String(options.log ?? DEFAULT_LOG_PATH));
  ensureDir(path.dirname(file));
  const line = `- ${new Date().toISOString()} ${message}\n`;
  if (!existsSync(file)) {
    writeFileSync(file, `# CodexNext Backlog Cycle Log\n\n`, "utf8");
  }
  writeFileSync(file, readFileSync(file, "utf8") + line, "utf8");
}

function writeJson(file, value) {
  ensureDir(path.dirname(file));
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function hashFile(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function resolveRepo(relativeOrAbsolute) {
  return path.isAbsolute(relativeOrAbsolute) ? relativeOrAbsolute : path.resolve(root, relativeOrAbsolute);
}

function normalizeRepoRelativePath(input) {
  const absolute = resolveRepo(input);
  const relativePath = path.relative(root, absolute).replaceAll(path.sep, "/");
  if (relativePath.startsWith("..")) {
    throw new Error(`Path must be inside repository: ${input}`);
  }
  return relativePath;
}

function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

function relative(file) {
  return path.relative(root, file).replaceAll(path.sep, "/");
}

function sanitizeFilePart(value) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "report";
}

function timestampForFile(date) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function formatLondon(date) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(date);
}

function printHelp() {
  console.log(`CodexNext backlog cycle guard\n\n` +
`Count semantics:\n` +
`  complete-cycle increments count only when the active backlog has zero unchecked checkbox items\n` +
`  and verification passes. It does not count per task, per phase, or per test run.\n\n` +
`Commands:\n` +
`  init --backlog <path> [--force]\n` +
`  status\n` +
`  audit [--label name] [--quick]\n` +
`  validate-complete [--no-verify]\n` +
`  complete-cycle [--no-verify]\n` +
`  new-cycle [--backlog <path>] [--force]\n` +
`  set-backlog --backlog <path>\n\n` +
`Defaults:\n` +
`  state: ${DEFAULT_STATE_PATH}\n` +
`  first backlog: ${DEFAULT_BACKLOG_PATH}\n` +
`  max cycles: ${FIXED_MAX_CYCLES} (fixed)\n` +
`  deadline: ${DEADLINE_LABEL} (${DEFAULT_DEADLINE_UTC})\n\n` +
`Examples:\n` +
`  node scripts/codexnext-backlog-cycle-guard.mjs init --backlog docs/handoff/CodexNext_CYCLE01_PHASE1_TO_PHASE5_BACKLOG.md\n` +
`  node scripts/codexnext-backlog-cycle-guard.mjs status\n` +
`  node scripts/codexnext-backlog-cycle-guard.mjs audit --label cycle-01-initial\n` +
`  node scripts/codexnext-backlog-cycle-guard.mjs complete-cycle\n` +
`  node scripts/codexnext-backlog-cycle-guard.mjs new-cycle\n`);
}
