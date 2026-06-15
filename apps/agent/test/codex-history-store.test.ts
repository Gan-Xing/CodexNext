import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import type { LocalCodexHistoryEntry } from "@codexnext/protocol";
import { CodexHistoryStore } from "../src/local-server/codex-history-store.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
  );
});

describe("CodexHistoryStore", () => {
  it("hides metadata-only empty threads and derives titles from rollout messages", async () => {
    const fixture = await createFixture();
    const store = new CodexHistoryStore({
      sessionsRoot: fixture.sessionsRoot,
      stateDbPath: fixture.stateDbPath
    });

    const entries = await store.listEntries({ limit: 10 });

    expect(entries).toEqual([
      expect.objectContaining({
        id: "thread_rollout_title",
        title: "从 rollout 恢复标题"
      }),
      expect.objectContaining({
        id: "thread_saved_title",
        title: "已有标题"
      })
    ]);
    expect(entries?.map((entry: LocalCodexHistoryEntry) => entry.id)).not.toContain(
      "thread_empty"
    );
  });

  it("returns an explicit empty detail for metadata-only threads instead of falling back", async () => {
    const fixture = await createFixture();
    const store = new CodexHistoryStore({
      sessionsRoot: fixture.sessionsRoot,
      stateDbPath: fixture.stateDbPath
    });

    const detail = await store.readDetail("thread_empty");

    expect(detail).toEqual({
      entry: expect.objectContaining({
        id: "thread_empty",
        title: "Untitled Codex thread"
      }),
      messages: [],
      turns: []
    });
  });
});

async function createFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-history-store-"));
  tempDirs.push(root);
  const sessionsRoot = path.join(root, "sessions");
  const cwd = path.join(root, "workspace");
  await mkdir(sessionsRoot, { recursive: true });
  await mkdir(cwd, { recursive: true });
  const stateDbPath = path.join(root, "state.sqlite");
  const database = new DatabaseSync(stateDbPath);
  database.exec(`
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      rollout_path TEXT NOT NULL,
      cwd TEXT NOT NULL,
      title TEXT,
      source TEXT,
      first_user_message TEXT,
      preview TEXT,
      created_at INTEGER,
      updated_at INTEGER,
      created_at_ms INTEGER,
      updated_at_ms INTEGER,
      archived INTEGER NOT NULL DEFAULT 0
    );
  `);

  await writeRollout(
    sessionsRoot,
    "empty.jsonl",
    [
      {
        timestamp: "2026-02-17T11:34:09.484Z",
        type: "session_meta",
        payload: {
          id: "thread_empty",
          cwd
        }
      }
    ]
  );
  await writeRollout(
    sessionsRoot,
    "rollout-title.jsonl",
    [
      {
        timestamp: "2026-02-17T11:34:10.000Z",
        type: "event_msg",
        payload: {
          type: "user_message",
          message: "从 rollout 恢复标题"
        }
      }
    ]
  );

  const insert = database.prepare(`
    INSERT INTO threads (
      id,
      rollout_path,
      cwd,
      title,
      source,
      first_user_message,
      preview,
      created_at,
      updated_at,
      created_at_ms,
      updated_at_ms,
      archived
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
  `);
  insert.run(
    "thread_empty",
    "empty.jsonl",
    cwd,
    "",
    "cli",
    "",
    "",
    1_739_792_049,
    1_739_792_052,
    1_739_792_049_000,
    1_739_792_052_000
  );
  insert.run(
    "thread_rollout_title",
    "rollout-title.jsonl",
    cwd,
    "",
    "cli",
    "",
    "",
    1_739_792_049,
    1_739_792_060,
    1_739_792_049_000,
    1_739_792_060_000
  );
  insert.run(
    "thread_saved_title",
    "saved-title.jsonl",
    cwd,
    "已有标题",
    "cli",
    "",
    "",
    1_739_792_049,
    1_739_792_040,
    1_739_792_049_000,
    1_739_792_040_000
  );
  database.close();

  return { sessionsRoot, stateDbPath };
}

async function writeRollout(
  sessionsRoot: string,
  relativePath: string,
  records: Array<Record<string, unknown>>
) {
  const fullPath = path.join(sessionsRoot, relativePath);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(
    fullPath,
    `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
    "utf8"
  );
}
