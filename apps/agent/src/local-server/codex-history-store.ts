import os from "node:os";
import path from "node:path";
import { readFile, readdir, stat } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import type {
  CodexThreadItem,
  CodexThreadTurn,
  LocalCodexHistoryDetailResponse,
  LocalCodexHistoryEntry,
  LocalCodexHistoryMessage,
  LocalCodexHistoryPageResponse
} from "@codexnext/protocol";

interface CodexHistoryStoreOptions {
  sessionsRoot?: string;
  stateDbPath?: string;
}

interface HistoryThreadRow {
  id: string;
  rolloutPath: string;
  cwd: string;
  title: string;
  source: string;
  firstUserMessage: string;
  preview: string;
  createdAt: number | null;
  updatedAt: number | null;
  createdAtMs: number | null;
  updatedAtMs: number | null;
}

type HistoryMessagePresence = "unknown" | "empty" | "hasMessages";

interface HistoryRowDisplayInfo {
  messages: LocalCodexHistoryMessage[] | null;
  presence: HistoryMessagePresence;
  title: string | null;
}

type HistoryPageSortDirection = "asc" | "desc";

export class CodexHistoryStore {
  private database: DatabaseSync | null = null;
  private resolvedStateDbPath: string | null | undefined;

  public constructor(private readonly options: CodexHistoryStoreOptions = {}) {}

  public async listEntries(input: {
    limit: number;
    searchTerm?: string | null;
    loadedThreadIds?: Set<string>;
  }): Promise<LocalCodexHistoryEntry[] | null> {
    const database = await this.getDatabase();
    if (!database) {
      return null;
    }

    const normalizedLimit = Math.max(1, Math.min(200, Math.floor(input.limit)));
    const normalizedSearch = normalizeSearchTerm(input.searchTerm);
    const params: Array<string | number> = [];
    let query = `
      SELECT
        id,
        rollout_path AS rolloutPath,
        cwd,
        title,
        source,
        first_user_message AS firstUserMessage,
        preview,
        created_at AS createdAt,
        updated_at AS updatedAt,
        created_at_ms AS createdAtMs,
        updated_at_ms AS updatedAtMs
      FROM threads
      WHERE archived = 0
    `;

    if (normalizedSearch) {
      const searchValue = `%${escapeLikePattern(normalizedSearch.toLowerCase())}%`;
      query += `
        AND (
          LOWER(title) LIKE ? ESCAPE '\\'
          OR LOWER(first_user_message) LIKE ? ESCAPE '\\'
          OR LOWER(preview) LIKE ? ESCAPE '\\'
          OR LOWER(cwd) LIKE ? ESCAPE '\\'
        )
      `;
      params.push(searchValue, searchValue, searchValue, searchValue);
    }

    query += `
      ORDER BY COALESCE(updated_at_ms, updated_at * 1000) DESC, id DESC
      LIMIT ?
    `;
    params.push(normalizedLimit);

    const rows = database.prepare(query).all(...params) as unknown as HistoryThreadRow[];
    const cwdExistsCache = new Map<string, Promise<boolean>>();
    const entries = await Promise.all(
      rows.map(async (row) => {
        const display = await this.inspectRowDisplay(row);
        if (display.presence === "empty") {
          return null;
        }
        return rowToHistoryEntry(row, input.loadedThreadIds, cwdExistsCache, display.title);
      })
    );
    return entries.filter((entry): entry is LocalCodexHistoryEntry => entry !== null);
  }

  public async readEntry(
    threadId: string,
    loadedThreadIds?: Set<string>
  ): Promise<LocalCodexHistoryEntry | null> {
    const database = await this.getDatabase();
    if (!database) {
      return null;
    }
    const row = database
      .prepare(
        `
          SELECT
            id,
            rollout_path AS rolloutPath,
            cwd,
            title,
            source,
            first_user_message AS firstUserMessage,
            preview,
            created_at AS createdAt,
            updated_at AS updatedAt,
            created_at_ms AS createdAtMs,
            updated_at_ms AS updatedAtMs
          FROM threads
          WHERE id = ?
          LIMIT 1
        `
      )
      .get(threadId) as HistoryThreadRow | undefined;
    if (!row) {
      return null;
    }
    const display = await this.inspectRowDisplay(row);
    return rowToHistoryEntry(row, loadedThreadIds, undefined, display.title);
  }

  public async readDetail(
    threadId: string,
    loadedThreadIds?: Set<string>
  ): Promise<LocalCodexHistoryDetailResponse | null> {
    const database = await this.getDatabase();
    if (!database) {
      return null;
    }
    const row = database
      .prepare(
        `
          SELECT
            id,
            rollout_path AS rolloutPath,
            cwd,
            title,
            source,
            first_user_message AS firstUserMessage,
            preview,
            created_at AS createdAt,
            updated_at AS updatedAt,
            created_at_ms AS createdAtMs,
            updated_at_ms AS updatedAtMs
          FROM threads
          WHERE id = ?
          LIMIT 1
        `
      )
      .get(threadId) as HistoryThreadRow | undefined;
    if (!row) {
      return null;
    }

    const display = await this.inspectRowDisplay(row, {
      includeRolloutMessages: true
    });
    const entry = await rowToHistoryEntry(
      row,
      loadedThreadIds,
      undefined,
      display.title
    );
    if (display.presence === "unknown") {
      return null;
    }

    return {
      entry,
      messages: display.messages ?? [],
      turns: historyMessagesToSyntheticTurns(row.id, display.messages ?? [])
    };
  }

  public async readPage(input: {
    threadId: string;
    cursor?: string | null;
    limit: number;
    loadedThreadIds?: Set<string>;
    sortDirection?: HistoryPageSortDirection;
  }): Promise<LocalCodexHistoryPageResponse | null> {
    const database = await this.getDatabase();
    if (!database) {
      return null;
    }
    const row = database
      .prepare(
        `
          SELECT
            id,
            rollout_path AS rolloutPath,
            cwd,
            title,
            source,
            first_user_message AS firstUserMessage,
            preview,
            created_at AS createdAt,
            updated_at AS updatedAt,
            created_at_ms AS createdAtMs,
            updated_at_ms AS updatedAtMs
          FROM threads
          WHERE id = ?
          LIMIT 1
        `
      )
      .get(input.threadId) as HistoryThreadRow | undefined;
    if (!row) {
      return null;
    }

    const display = await this.inspectRowDisplay(row, {
      includeRolloutMessages: true
    });
    if (display.presence === "unknown") {
      return null;
    }

    const entry = await rowToHistoryEntry(
      row,
      input.loadedThreadIds,
      undefined,
      display.title
    );
    const messages = display.messages ?? [];
    const page = sliceHistoryMessagesPage(messages, {
      cursor: input.cursor ?? null,
      limit: input.limit,
      sortDirection: input.sortDirection ?? "desc",
      threadId: row.id
    });

    return {
      entry,
      messages: page.messages,
      turns: historyMessagesToSyntheticTurns(row.id, page.messages),
      nextCursor: page.nextCursor,
      backwardsCursor: page.backwardsCursor
    };
  }

  public close(): void {
    this.database?.close();
    this.database = null;
  }

  private async getDatabase(): Promise<DatabaseSync | null> {
    if (this.database) {
      return this.database;
    }
    const stateDbPath = await this.resolveStateDbPath();
    if (!stateDbPath) {
      return null;
    }
    this.database = new DatabaseSync(stateDbPath, { readOnly: true });
    return this.database;
  }

  private async resolveStateDbPath(): Promise<string | null> {
    if (this.resolvedStateDbPath !== undefined) {
      return this.resolvedStateDbPath;
    }

    if (this.options.stateDbPath) {
      this.resolvedStateDbPath = await fileExists(this.options.stateDbPath)
        ? this.options.stateDbPath
        : null;
      return this.resolvedStateDbPath;
    }

    const codexHome = path.join(os.homedir(), ".codex");
    try {
      const entries = await readdir(codexHome, { withFileTypes: true });
      const candidates = entries
        .filter(
          (entry) => entry.isFile() && /^state_(\d+)\.sqlite$/.test(entry.name)
        )
        .map((entry) => {
          const match = entry.name.match(/^state_(\d+)\.sqlite$/);
          return {
            version: Number(match?.[1] ?? 0),
            fullPath: path.join(codexHome, entry.name)
          };
        })
        .sort((left, right) => right.version - left.version);
      this.resolvedStateDbPath = candidates[0]?.fullPath ?? null;
    } catch {
      this.resolvedStateDbPath = null;
    }

    return this.resolvedStateDbPath;
  }

  private async readRolloutMessages(
    row: HistoryThreadRow
  ): Promise<LocalCodexHistoryMessage[] | null> {
    const rolloutPath = path.isAbsolute(row.rolloutPath)
      ? row.rolloutPath
      : path.join(
          this.options.sessionsRoot ?? path.join(os.homedir(), ".codex", "sessions"),
          row.rolloutPath
        );
    if (!(await fileExists(rolloutPath))) {
      return null;
    }

    const contents = await readFile(rolloutPath, "utf8");
    const lines = contents.split(/\r?\n/);
    const messages: LocalCodexHistoryMessage[] = [];

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]?.trim();
      if (!line) {
        continue;
      }

      let record: Record<string, unknown>;
      try {
        record = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }

      if (record.type !== "event_msg" || !isRecord(record.payload)) {
        continue;
      }

      const timestamp = normalizeIsoTimestamp(record.timestamp, row.updatedAtMs, row.updatedAt);
      switch (record.payload.type) {
        case "user_message": {
          const text = typeof record.payload.message === "string" ? record.payload.message : "";
          const message = makeHistoryMessage(`rollout-user-${index}`, "user", text, timestamp);
          if (message) {
            messages.push(message);
          }
          break;
        }
        case "agent_message": {
          const text = typeof record.payload.message === "string" ? record.payload.message : "";
          const message = makeHistoryMessage(
            `rollout-assistant-${index}`,
            "assistant",
            text,
            timestamp
          );
          if (message) {
            messages.push(message);
          }
          break;
        }
        case "patch_apply_end": {
          const diffText = formatPatchApplyDiff(record.payload);
          const message = makeHistoryMessage(`rollout-diff-${index}`, "diff", diffText, timestamp);
          if (message) {
            messages.push(message);
          }
          break;
        }
        default:
          break;
      }
    }

    return messages;
  }

  private async inspectRowDisplay(
    row: HistoryThreadRow,
    input?: { includeRolloutMessages?: boolean }
  ): Promise<HistoryRowDisplayInfo> {
    const metadataTitle =
      normalizeNonEmpty(row.title) ??
      normalizeNonEmpty(row.firstUserMessage) ??
      normalizeNonEmpty(row.preview);
    if (metadataTitle && !input?.includeRolloutMessages) {
      return {
        title: metadataTitle,
        messages: null,
        presence: "unknown"
      };
    }

    const rolloutMessages = await this.readRolloutMessages(row);
    if (rolloutMessages === null) {
      return {
        title: null,
        messages: null,
        presence: "unknown"
      };
    }

    return {
      title: metadataTitle ?? deriveHistoryTitleFromMessages(rolloutMessages),
      messages: rolloutMessages,
      presence: rolloutMessages.length > 0 ? "hasMessages" : "empty"
    };
  }
}

async function rowToHistoryEntry(
  row: HistoryThreadRow,
  loadedThreadIds?: Set<string>,
  cwdExistsCache?: Map<string, Promise<boolean>>,
  titleOverride?: string | null
): Promise<LocalCodexHistoryEntry> {
  const cwdExists =
    cwdExistsCache?.get(row.cwd) ??
    directoryExists(row.cwd);
  if (cwdExistsCache && !cwdExistsCache.has(row.cwd)) {
    cwdExistsCache.set(row.cwd, cwdExists);
  }

  const loaded = loadedThreadIds?.has(row.id) ?? false;
  return {
    id: row.id,
    cwd: row.cwd,
    cwdExists: await cwdExists,
    title: titleOverride ?? "Untitled Codex thread",
    createdAt: normalizeIsoTimestamp(undefined, row.createdAtMs, row.createdAt),
    updatedAt: normalizeIsoTimestamp(undefined, row.updatedAtMs, row.updatedAt),
    source: normalizeNonEmpty(row.source) ?? "unknown",
    loaded,
    threadStatus: loaded ? "idle" : "notLoaded"
  };
}

function normalizeIsoTimestamp(
  rawTimestamp: unknown,
  timestampMs?: number | null,
  timestampSeconds?: number | null
): string {
  if (typeof rawTimestamp === "string") {
    const parsed = Date.parse(rawTimestamp);
    if (Number.isFinite(parsed)) {
      return new Date(parsed).toISOString();
    }
  }
  if (typeof timestampMs === "number" && Number.isFinite(timestampMs) && timestampMs > 0) {
    return new Date(timestampMs).toISOString();
  }
  if (
    typeof timestampSeconds === "number" &&
    Number.isFinite(timestampSeconds) &&
    timestampSeconds > 0
  ) {
    return new Date(timestampSeconds * 1000).toISOString();
  }
  return new Date().toISOString();
}

function normalizeNonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function deriveHistoryTitleFromMessages(
  messages: LocalCodexHistoryMessage[]
): string | null {
  for (const role of ["user", "assistant", "command", "diff"] as const) {
    const match = messages.find((message) => message.role === role);
    const line = normalizeNonEmpty(match?.text?.split(/\r?\n/)[0] ?? null);
    if (!line) {
      continue;
    }
    return line.length > 140 ? `${line.slice(0, 137)}...` : line;
  }
  return null;
}

function normalizeSearchTerm(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatPatchApplyDiff(payload: Record<string, unknown>): string {
  if (isRecord(payload.changes) && Object.keys(payload.changes).length > 0) {
    return JSON.stringify(payload.changes, null, 2);
  }
  if (typeof payload.stdout === "string" && payload.stdout.trim()) {
    return payload.stdout;
  }
  return "";
}

function makeHistoryMessage(
  id: string,
  role: LocalCodexHistoryMessage["role"],
  text: string,
  ts: string
): LocalCodexHistoryMessage | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  return {
    id,
    role,
    text: trimmed.slice(0, 16_000),
    ts
  };
}

function sliceHistoryMessagesPage(
  messages: LocalCodexHistoryMessage[],
  input: {
    cursor?: string | null;
    limit: number;
    sortDirection: HistoryPageSortDirection;
    threadId: string;
  }
): {
  messages: LocalCodexHistoryMessage[];
  nextCursor: string | null;
  backwardsCursor: string | null;
} {
  const normalizedLimit = Math.max(1, Math.min(100, Math.floor(input.limit)));
  if (messages.length === 0) {
    return {
      messages: [],
      nextCursor: null,
      backwardsCursor: null
    };
  }

  if (input.sortDirection === "asc") {
    const start = parseHistoryCursor(input.cursor, input.threadId) ?? 0;
    const safeStart = Math.max(0, Math.min(messages.length, start));
    const end = Math.min(messages.length, safeStart + normalizedLimit);
    return {
      messages: messages.slice(safeStart, end),
      nextCursor:
        end < messages.length ? formatHistoryCursor(input.threadId, end) : null,
      backwardsCursor:
        safeStart > 0 ? formatHistoryCursor(input.threadId, Math.max(0, safeStart - normalizedLimit)) : null
    };
  }

  const cursorEnd = parseHistoryCursor(input.cursor, input.threadId);
  const end =
    cursorEnd === null
      ? messages.length
      : Math.max(0, Math.min(messages.length, cursorEnd));
  const start = Math.max(0, end - normalizedLimit);
  return {
    messages: messages.slice(start, end),
    nextCursor: start > 0 ? formatHistoryCursor(input.threadId, start) : null,
    backwardsCursor:
      end < messages.length ? formatHistoryCursor(input.threadId, end) : null
  };
}

function parseHistoryCursor(
  cursor: string | null | undefined,
  threadId: string
): number | null {
  if (typeof cursor !== "string" || !cursor.trim()) {
    return null;
  }
  const parts = cursor.split(":");
  if (parts.length !== 3 || parts[0] !== "state-page" || parts[1] !== threadId) {
    return null;
  }
  const offset = Number(parts[2]);
  return Number.isInteger(offset) && offset >= 0 ? offset : null;
}

function formatHistoryCursor(threadId: string, offset: number): string {
  return `state-page:${threadId}:${Math.max(0, Math.floor(offset))}`;
}

function historyMessagesToSyntheticTurns(
  threadId: string,
  messages: LocalCodexHistoryMessage[]
): CodexThreadTurn[] {
  return messages.map((message, index) => {
    const tsMs = Date.parse(message.ts);
    const ts = Number.isFinite(tsMs) ? tsMs / 1000 : null;
    return {
      id: `synthetic-${threadId}-${message.id || index}`,
      items: [historyMessageToSyntheticThreadItem(message, index)],
      itemsView: "full",
      status: "completed",
      error: null,
      startedAt: ts,
      completedAt: ts,
      durationMs: null
    };
  });
}

function historyMessageToSyntheticThreadItem(
  message: LocalCodexHistoryMessage,
  index: number
): CodexThreadItem {
  const id = message.id || `message-${index}`;
  switch (message.role) {
    case "user":
      return {
        id,
        type: "userMessage",
        content: [{ type: "text", text: message.text, text_elements: [] }]
      };
    case "assistant":
      return {
        id,
        type: "agentMessage",
        text: message.text
      };
    case "command":
      return {
        id,
        type: "commandExecution",
        command: "",
        aggregatedOutput: message.text
      };
    case "diff":
      return {
        id,
        type: "fileChange",
        text: message.text,
        changes: []
      };
    default:
      return {
        id,
        type: "contextCompaction"
      };
  }
}

async function directoryExists(candidatePath: string): Promise<boolean> {
  try {
    return (await stat(candidatePath)).isDirectory();
  } catch {
    return false;
  }
}

async function fileExists(candidatePath: string): Promise<boolean> {
  try {
    return (await stat(candidatePath)).isFile();
  } catch {
    return false;
  }
}
