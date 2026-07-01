#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const guard = path.join(root, "scripts/codexnext-backlog-cycle-guard.mjs");
const tempRoot = path.join(root, "tmp");
const testDeadlineUtc = "2999-01-01T00:00:00.000Z";
mkdirSync(tempRoot, { recursive: true });
const tempDir = mkdtempSync(path.join(tempRoot, "guard-test-"));

try {
  const statePath = path.join(tempDir, "state.json");
  const logPath = path.join(tempDir, "log.md");
  const backlogPath = path.join(tempDir, "backlog.md");
  const doneBacklogPath = path.join(tempDir, "done-backlog.md");

  writeFileSync(backlogPath, "# Test Backlog\n\n- [ ] Pending item\n", "utf8");
  writeFileSync(doneBacklogPath, "# Done Backlog\n\n- [x] Done item\n", "utf8");

  const noStateStatus = runGuard([
    "status",
    "--state",
    statePath,
    "--log",
    logPath,
    "--backlog",
    backlogPath
  ]);
  assert.equal(noStateStatus.status, 0);
  const noState = parseStatus(noStateStatus.stdout);
  assert.equal(noState.completedCycles, 0);
  assert.equal(noState.maxCycles, 20);
  assert.equal(noState.backlogCheckboxes.pending, 1);
  assert.equal(noState.canContinue, true);

  const init = runGuard([
    "init",
    "--state",
    statePath,
    "--log",
    logPath,
    "--backlog",
    backlogPath
  ]);
  assert.equal(init.status, 0);

  const initAgain = runGuard([
    "init",
    "--state",
    statePath,
    "--log",
    logPath,
    "--backlog",
    backlogPath
  ]);
  assert.notEqual(initAgain.status, 0);
  assert.match(initAgain.stderr, /already exists/);

  const pendingComplete = runGuard([
    "complete-cycle",
    "--no-verify",
    "--state",
    statePath,
    "--log",
    logPath
  ]);
  assert.equal(pendingComplete.status, 2);
  assert.match(pendingComplete.stderr, /unchecked item/);

  const setDone = runGuard([
    "set-backlog",
    "--state",
    statePath,
    "--log",
    logPath,
    "--backlog",
    doneBacklogPath
  ]);
  assert.equal(setDone.status, 0);

  const fakeVerified = runGuard(
    [
      "validate-complete",
      "--state",
      statePath,
      "--log",
      logPath
    ],
    { CODEXNEXT_BACKLOG_GUARD_FAKE_COMMANDS: "1" }
  );
  assert.equal(fakeVerified.status, 0);
  assert.match(fakeVerified.stdout, /\$ pnpm install/);
  assert.match(fakeVerified.stdout, /\$ pnpm typecheck/);
  assert.match(fakeVerified.stdout, /\$ pnpm test/);
  assert.match(fakeVerified.stdout, /\$ pnpm test:guard/);
  assert.match(fakeVerified.stdout, /\$ pnpm test:winsw/);
  assert.match(fakeVerified.stdout, /\$ pnpm --filter @codexnext\/agent dev -- doctor/);

  const complete = runGuard([
    "complete-cycle",
    "--no-verify",
    "--state",
    statePath,
    "--log",
    logPath
  ]);
  assert.equal(complete.status, 0);
  assert.match(complete.stdout, /Count: 1\/20/);

  writeFileSync(
    statePath,
    JSON.stringify(
      {
        completedCycles: 20,
        maxCycles: 99,
        deadlineUtc: "2999-01-01T00:00:00.000Z",
        activeBacklogPath: repoRelative(doneBacklogPath),
        cycles: []
      },
      null,
      2
    ),
    "utf8"
  );
  const maxStatus = runGuard(["status", "--state", statePath, "--log", logPath]);
  assert.equal(maxStatus.status, 0);
  const max = parseStatus(maxStatus.stdout);
  assert.equal(max.maxCycles, 20);
  assert.equal(max.canContinue, false);
  assert.match(max.stopReasons.join("\n"), /completedCycles 20 >= maxCycles 20/);

  writeFileSync(
    statePath,
    JSON.stringify(
      {
        completedCycles: 0,
        maxCycles: 20,
        deadlineUtc: "2999-01-01T00:00:00.000Z",
        activeBacklogPath: repoRelative(doneBacklogPath),
        cycles: []
      },
      null,
      2
    ),
    "utf8"
  );
  const deadlineStatus = runGuard([
    "status",
    "--state",
    statePath,
    "--log",
    logPath,
    "--deadlineUtc",
    "2000-01-01T00:00:00.000Z"
  ]);
  assert.equal(deadlineStatus.status, 0);
  const deadline = parseStatus(deadlineStatus.stdout);
  assert.equal(deadline.canContinue, false);
  assert.match(deadline.stopReasons.join("\n"), /deadline 2000-01-01T00:00:00.000Z/);

  console.log("codexnext-backlog-cycle-guard smoke tests passed");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

function runGuard(args, extraEnv = {}) {
  return spawnSync(process.execPath, [guard, ...args], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      CODEXNEXT_BACKLOG_DEADLINE_UTC: testDeadlineUtc,
      ...extraEnv
    }
  });
}

function parseStatus(stdout) {
  const start = stdout.indexOf("{");
  const stopFooter = stdout.indexOf("\n\nSTOP:");
  const end = stopFooter >= 0 ? stopFooter : stdout.lastIndexOf("}") + 1;
  assert.ok(start >= 0 && end > start, `No JSON status found in output:\n${stdout}`);
  return JSON.parse(stdout.slice(start, end));
}

function repoRelative(file) {
  return path.relative(root, file).replaceAll(path.sep, "/");
}
