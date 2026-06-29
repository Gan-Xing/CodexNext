import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readdir } from "node:fs/promises";
import type {
  CodexThreadTurn,
  CodexThread,
  CodexThreadItem,
  LocalCodexHistoryDetailResponse,
  LocalCodexHistoryEntry,
  LocalCodexHistoryMessage,
  LocalCodexHistoryPageResponse,
  LocalCodexHistoryResponse,
  LocalDirectoryListResponse,
  LocalEvent,
  LocalHealthResponse,
  LocalLoadedThreadsResponse,
  LocalProviderCatalogResponse,
  LocalResumeSessionResponse,
  LocalSessionSummary,
  RelayMethod,
  ThreadGoal
} from "@codexnext/protocol";
import {
  deriveCodexConversationTitle,
  deriveCodexGeneratedTitle,
  LocalApprovalDecisionSchema,
  LocalQueueActionSchema,
  LocalResumeSessionSchema,
  LocalSendMessageSchema,
  LocalSetGoalSchema,
  LocalStartSessionSchema,
  RelayMethod as RelayMethodValue
} from "@codexnext/protocol";
import { ApprovalBridge } from "./approval-bridge.js";
import { CodexHistoryStore } from "./codex-history-store.js";
import { EventStore } from "./event-store.js";
import {
  SessionManager,
  type CodexClientFactory
} from "./session-manager.js";
import type { ProviderRuntimeManager } from "./provider-runtime-manager.js";
import { devTrace, durationMs, errorSummary, payloadSummary } from "../dev-trace.js";

export interface LocalAgentRuntimeOptions {
  host: string;
  port: number;
  approvalTimeoutMs: number;
  codexBin: string;
  eventLimit?: number;
  clientFactory?: CodexClientFactory;
  providerRuntimeManager?: ProviderRuntimeManager;
  historySource?: "auto" | "disabled";
  historySessionsRoot?: string;
  historyStateDbPath?: string;
}

export interface LocalAgentRuntime {
  approvalBridge: ApprovalBridge;
  eventStore: EventStore;
  sessionManager: SessionManager;
  close(): Promise<void>;
  directories(path?: string): Promise<LocalDirectoryListResponse>;
  health(): Promise<LocalHealthResponse>;
  invoke(method: RelayMethod, params?: unknown): Promise<unknown>;
  providers(): Promise<LocalProviderCatalogResponse>;
  replayEvents(after?: number): { events: LocalEvent[] };
}

export function createLocalAgentRuntime(
  options: LocalAgentRuntimeOptions
): LocalAgentRuntime {
  const eventStore = new EventStore({ limit: options.eventLimit });
  const approvalBridge = new ApprovalBridge({
    timeoutMs: options.approvalTimeoutMs,
    eventStore
  });
  const historyStore =
    options.historySource === "disabled"
      ? null
      : new CodexHistoryStore({
          ...(options.historySessionsRoot
            ? { sessionsRoot: options.historySessionsRoot }
            : {}),
          ...(options.historyStateDbPath
            ? { stateDbPath: options.historyStateDbPath }
            : {})
        });
  const sessionManager = new SessionManager({
    eventStore,
    approvalBridge,
    codexBin: options.codexBin,
    clientFactory: options.clientFactory,
    providerRuntimeManager: options.providerRuntimeManager
  });

  return {
    approvalBridge,
    eventStore,
    sessionManager,
    close: async () => {
      await sessionManager.closeAll();
      historyStore?.close();
    },
    directories: (requestedPath?: string) => listDirectories(requestedPath),
    health: async () => health(options),
    providers: async () => sessionManager.providerCatalog(),
    invoke: async (method, params) =>
      traceRuntimeInvoke(method, params, async () => {
        switch (method) {
          case RelayMethodValue.AgentHealth:
            return health(options);
          case RelayMethodValue.ProviderCatalog:
            return sessionManager.providerCatalog();
          case RelayMethodValue.SessionsList:
            return { sessions: sessionManager.summaries() };
          case RelayMethodValue.SessionsCreate: {
            const body = LocalStartSessionSchema.parse(params ?? {});
            const session = await sessionManager.startSession(body);
            return { session };
          }
          case RelayMethodValue.SessionsMessage: {
            const payload = parseSessionScopedParams(params);
            const body = LocalSendMessageSchema.parse(payload.body);
            return sessionManager.sendMessage(payload.sessionId, body);
          }
          case RelayMethodValue.SessionsQueueAction: {
            const payload = parseSessionScopedParams(params);
            const body = LocalQueueActionSchema.parse(payload.body);
            return sessionManager.updateQueuedMessages(payload.sessionId, body);
          }
          case RelayMethodValue.SessionsGoalGet: {
            const payload = parseSessionScopedParams(params);
            return sessionManager.getGoal(payload.sessionId);
          }
          case RelayMethodValue.SessionsGoalSet: {
            const payload = parseSessionScopedParams(params);
            const body = LocalSetGoalSchema.parse(payload.body);
            return sessionManager.setGoal(payload.sessionId, body);
          }
          case RelayMethodValue.SessionsGoalClear: {
            const payload = parseSessionScopedParams(params);
            return sessionManager.clearGoal(payload.sessionId);
          }
          case RelayMethodValue.TurnInterrupt: {
            const payload = parseTurnScopedParams(params);
            return sessionManager.interruptTurn(payload.sessionId, payload.turnId);
          }
          case RelayMethodValue.ApprovalDecision: {
            const payload = parseApprovalScopedParams(params);
            const body = LocalApprovalDecisionSchema.parse(payload.body ?? {});
            return approvalBridge.resolveDecision(payload.approvalId, body.decision);
          }
          case RelayMethodValue.DirectoriesList:
            return listDirectories(readOptionalPath(params));
          case RelayMethodValue.CodexHistoryList:
            return listCodexHistory(params, sessionManager, historyStore);
          case RelayMethodValue.CodexHistoryLoaded:
            return listLoadedCodexHistoryThreads(sessionManager);
          case RelayMethodValue.CodexHistoryDetail:
            return readCodexHistoryDetail(params, sessionManager, historyStore);
          case RelayMethodValue.CodexHistoryTurns:
            return listCodexHistoryTurns(params, sessionManager, historyStore);
          case RelayMethodValue.CodexHistoryArchive:
            return archiveCodexHistoryThread(params, sessionManager);
          case RelayMethodValue.CodexHistoryResume: {
            const body = LocalResumeSessionSchema.parse(params ?? {});
            const historyEntry = await readCodexHistoryEntryById(
              body.id,
              sessionManager,
              historyStore
            );
            const resumed = await sessionManager.resumeSessionWithInitialTurns({
              ...body,
              threadId: historyEntry.id,
              cwd: body.cwd ?? historyEntry.cwd,
              title: body.title ?? historyEntry.title
            });
            const history = historyPageFromTurns({
              entry: historyEntry,
              turnsPage: resumed.initialTurnsPage
            });
            return {
              session: resumed.session,
              history
            } satisfies LocalResumeSessionResponse;
          }
          default:
            throw new Error(`Unsupported relay method: ${String(method)}`);
        }
      }),
    replayEvents: (after = 0) => ({
      events: eventStore.after(Number.isFinite(after) ? after : 0)
    })
  };
}

async function traceRuntimeInvoke<T>(
  method: RelayMethod,
  params: unknown,
  operation: () => Promise<T>
): Promise<T> {
  const startedAt = Date.now();
  devTrace("runtime.invoke.start", {
    method,
    ...payloadSummary(params)
  });
  try {
    const result = await operation();
    devTrace("runtime.invoke.end", {
      method,
      durationMs: durationMs(startedAt)
    });
    return result;
  } catch (error) {
    devTrace("runtime.invoke.error", {
      method,
      durationMs: durationMs(startedAt),
      ...errorSummary(error)
    });
    throw error;
  }
}

function parseSessionScopedParams(params: unknown): {
  sessionId: string;
  body?: unknown;
} {
  if (!isPlainObject(params) || typeof params.sessionId !== "string") {
    throw new Error("Missing sessionId");
  }
  return {
    sessionId: params.sessionId,
    ...(Object.prototype.hasOwnProperty.call(params, "body")
      ? { body: params.body }
      : {})
  };
}

function parseTurnScopedParams(params: unknown): {
  sessionId: string;
  turnId: string;
} {
  if (
    !isPlainObject(params) ||
    typeof params.sessionId !== "string" ||
    typeof params.turnId !== "string"
  ) {
    throw new Error("Missing sessionId or turnId");
  }
  return {
    sessionId: params.sessionId,
    turnId: params.turnId
  };
}

function parseApprovalScopedParams(params: unknown): {
  approvalId: string;
  body?: unknown;
} {
  if (!isPlainObject(params) || typeof params.approvalId !== "string") {
    throw new Error("Missing approvalId");
  }
  return {
    approvalId: params.approvalId,
    ...(Object.prototype.hasOwnProperty.call(params, "body")
      ? { body: params.body }
      : {})
  };
}

function readOptionalPath(params: unknown): string | undefined {
  if (!isPlainObject(params) || typeof params.path !== "string" || !params.path.trim()) {
    return undefined;
  }
  return params.path;
}

async function listDirectories(
  requestedPath?: string
): Promise<LocalDirectoryListResponse> {
  const homePath = os.homedir();
  const resolvedPath = path.resolve(requestedPath || homePath);
  const stats = await stat(resolvedPath);

  if (!stats.isDirectory()) {
    throw new Error(`path is not a directory: ${resolvedPath}`);
  }

  const dirents = await readdir(resolvedPath, { withFileTypes: true });
  const entries = dirents
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => ({
      name: entry.name,
      path: path.join(resolvedPath, entry.name)
    }))
    .sort((left, right) => left.name.localeCompare(right.name));

  const parentPath = path.dirname(resolvedPath);

  return {
    path: resolvedPath,
    parentPath: parentPath === resolvedPath ? null : parentPath,
    homePath,
    entries
  };
}

async function listCodexHistory(
  params: unknown,
  sessionManager: SessionManager,
  historyStore: CodexHistoryStore | null
): Promise<LocalCodexHistoryResponse> {
  const limit =
    isPlainObject(params) && typeof params.limit === "number"
      ? Math.max(1, Math.min(200, Math.floor(params.limit)))
      : 80;
  const searchTerm =
    isPlainObject(params) && typeof params.search === "string"
      ? params.search.trim() || null
      : null;
  const loadedThreadIds = loadedHistoryThreadIds(sessionManager);
  if (historyStore) {
    const directEntries = await historyStore.listEntries({
      limit,
      searchTerm,
      loadedThreadIds
    });
    if (directEntries) {
      return {
        root: "local codex state db",
        entries: directEntries.filter((entry) => !isHiddenCodexHistoryEntry(entry))
      };
    }
  }
  const response = await sessionManager.listThreads({
    limit,
    sortKey: "updated_at",
    sortDirection: "desc",
    archived: false,
    useStateDbOnly: true,
    searchTerm
  });
  const cwdExistsCache = new Map<string, Promise<boolean>>();
  const entries = await Promise.all(
    response.data.map((thread) =>
      threadToHistoryEntry(thread, response.data, cwdExistsCache)
    )
  );
  const visibleEntries = entries.filter((entry) => !isHiddenCodexHistoryEntry(entry));
  return { root: "codex app-server thread/list", entries: visibleEntries };
}

async function listLoadedCodexHistoryThreads(
  sessionManager: SessionManager
): Promise<LocalLoadedThreadsResponse> {
  return {
    threadIds: [...loadedHistoryThreadIds(sessionManager)]
  };
}

async function readCodexHistoryDetail(
  params: unknown,
  sessionManager: SessionManager,
  historyStore: CodexHistoryStore | null
): Promise<LocalCodexHistoryDetailResponse> {
  if (!isPlainObject(params) || typeof params.id !== "string" || !params.id.trim()) {
    throw new Error("Missing codex thread id");
  }
  return readCodexHistoryDetailById(params.id, sessionManager, historyStore);
}

async function listCodexHistoryTurns(
  params: unknown,
  sessionManager: SessionManager,
  historyStore: CodexHistoryStore | null
): Promise<LocalCodexHistoryPageResponse> {
  if (!isPlainObject(params) || typeof params.id !== "string" || !params.id.trim()) {
    throw new Error("Missing codex thread id");
  }

  const limit =
    typeof params.limit === "number"
      ? Math.max(1, Math.min(100, Math.floor(params.limit)))
      : 40;
  const sortDirection = params.sortDirection === "asc" ? "asc" : "desc";
  const itemsView = params.itemsView === "full" ? "full" : "summary";

  if (historyStore) {
    const page = await historyStore.readPage({
      threadId: params.id,
      cursor: typeof params.cursor === "string" && params.cursor.trim() ? params.cursor : null,
      limit,
      loadedThreadIds: loadedHistoryThreadIds(sessionManager),
      sortDirection
    });
    if (page) {
      return historyPageWithGuaranteedTurns(params.id, page, "state-db-page");
    }
  }

  const entry = await readCodexHistoryEntryById(params.id, sessionManager, historyStore);
  const turnsPage = await sessionManager.listThreadTurns({
    threadId: params.id,
    cursor: typeof params.cursor === "string" && params.cursor.trim() ? params.cursor : null,
    limit,
    sortDirection,
    itemsView
  });

  return historyPageWithGuaranteedTurns(
    params.id,
    historyPageFromTurns({ entry, turnsPage, sortDirection }),
    "paged-turns"
  );
}

async function archiveCodexHistoryThread(
  params: unknown,
  sessionManager: SessionManager
): Promise<Record<string, never>> {
  if (!isPlainObject(params) || typeof params.id !== "string" || !params.id.trim()) {
    throw new Error("Missing codex thread id");
  }
  await sessionManager.archiveThread(params.id);
  return {};
}

async function readCodexHistoryDetailById(
  id: string,
  sessionManager: SessionManager,
  historyStore: CodexHistoryStore | null
): Promise<LocalCodexHistoryDetailResponse> {
  const loadedThreadIds = loadedHistoryThreadIds(sessionManager);
  if (historyStore) {
    const detail = await historyStore.readDetail(id, loadedThreadIds);
    if (detail) {
      return historyDetailWithGuaranteedTurns(id, detail, "state-db");
    }
  }
  const response = await sessionManager.readThread({
    threadId: id,
    includeTurns: true
  });
  return historyDetailWithGuaranteedTurns(id, {
    entry: await threadToHistoryEntry(response.thread),
    messages: threadToHistoryMessages(response.thread),
    turns: response.thread.turns ?? []
  }, "app-server");
}

async function readCodexHistoryEntryById(
  id: string,
  sessionManager: SessionManager,
  historyStore: CodexHistoryStore | null
): Promise<LocalCodexHistoryEntry> {
  const loadedThreadIds = loadedHistoryThreadIds(sessionManager);
  if (historyStore) {
    const entry = await historyStore.readEntry(id, loadedThreadIds);
    if (entry) {
      return entry;
    }
  }
  const response = await sessionManager.readThread({
    threadId: id,
    includeTurns: false
  });
  return threadToHistoryEntry(response.thread);
}

function loadedHistoryThreadIds(sessionManager: SessionManager): Set<string> {
  return new Set(
    sessionManager
      .summaries()
      .map((session) => session.threadId)
      .filter((threadId): threadId is string => Boolean(threadId))
  );
}

async function threadToHistoryEntry(
  thread: CodexThread,
  contextThreads?: CodexThread[],
  cwdExistsCache?: Map<string, Promise<boolean>>
): Promise<LocalCodexHistoryEntry> {
  const title =
    deriveCodexConversationTitle(thread, contextThreads) ??
    deriveCodexGeneratedTitle(thread.preview) ??
    "Untitled Codex thread";
  const cwdExists =
    cwdExistsCache?.get(thread.cwd) ??
    directoryExists(thread.cwd);
  if (cwdExistsCache && !cwdExistsCache.has(thread.cwd)) {
    cwdExistsCache.set(thread.cwd, cwdExists);
  }
  return {
    id: thread.id,
    cwd: thread.cwd,
    cwdExists: await cwdExists,
    title,
    createdAt: timestampToIso(thread.createdAt),
    updatedAt: timestampToIso(thread.updatedAt),
    source: formatThreadSource(thread.source),
    loaded: isLoadedThreadStatus(thread.status),
    threadStatus: readThreadStatusType(thread.status)
  };
}

function isHiddenCodexHistoryEntry(entry: LocalCodexHistoryEntry): boolean {
  const basename = path.basename(entry.cwd);
  return (
    entry.cwd.startsWith("/tmp/codex-goal-probe-") ||
    basename.startsWith("codex-goal-probe-") ||
    isAutomationPromptTitle(entry.title)
  );
}

function isAutomationPromptTitle(title: string): boolean {
  const trimmed = title.trim();
  return (
    trimmed.startsWith("# Codex Native API Loop Prompt") ||
    trimmed.startsWith("# Codex Gateway Loop Prompt") ||
    trimmed.startsWith("# CodexBridge Loop Prompt") ||
    trimmed.startsWith("你正在执行 CodexBridge 后台 Agent 任务")
  );
}

function threadToHistoryMessages(
  thread: CodexThread
): LocalCodexHistoryMessage[] {
  const messages: LocalCodexHistoryMessage[] = [];
  for (const turn of thread.turns ?? []) {
    const ts = timestampToIso(
      turn.completedAt ?? turn.startedAt ?? thread.updatedAt ?? thread.createdAt
    );
    turn.items.forEach((item, index) => {
      const message = threadItemToHistoryMessage(item, ts, `${turn.id}-${index}`);
      if (message) {
        messages.push(message);
      }
    });
  }
  return messages;
}

function historyPageFromTurns(input: {
  entry: LocalCodexHistoryEntry;
  turnsPage: { data: CodexThread["turns"]; nextCursor: string | null; backwardsCursor: string | null } | null | undefined;
  sortDirection?: "asc" | "desc";
}): LocalCodexHistoryPageResponse {
  const turns = input.turnsPage?.data ?? [];
  const orderedTurns =
    input.sortDirection === "asc" ? turns : [...turns].reverse();

  return {
    entry: input.entry,
    messages: turnsToHistoryMessages(orderedTurns),
    turns: orderedTurns,
    nextCursor: input.turnsPage?.nextCursor ?? null,
    backwardsCursor: input.turnsPage?.backwardsCursor ?? null
  };
}

function historyDetailWithGuaranteedTurns(
  threadId: string,
  detail: LocalCodexHistoryDetailResponse,
  source: string
): LocalCodexHistoryDetailResponse {
  const turns = guaranteeHistoryTurns(threadId, detail.messages, detail.turns);
  devTrace("agent.history.detail.counts", {
    threadId,
    historySource: source,
    messageCount: detail.messages.length,
    originalTurnCount: detail.turns.length,
    turnCount: turns.length,
    syntheticTurnCount: Math.max(0, turns.length - detail.turns.length)
  });
  return {
    ...detail,
    turns
  };
}

function historyPageWithGuaranteedTurns(
  threadId: string,
  page: LocalCodexHistoryPageResponse,
  source: string
): LocalCodexHistoryPageResponse {
  const turns = guaranteeHistoryTurns(threadId, page.messages, page.turns);
  devTrace("agent.history.turns.counts", {
    threadId,
    historySource: source,
    messageCount: page.messages.length,
    originalTurnCount: page.turns.length,
    turnCount: turns.length,
    responseBytes: jsonByteLength({ ...page, turns }),
    syntheticTurnCount: Math.max(0, turns.length - page.turns.length),
    hasNextCursor: Boolean(page.nextCursor),
    hasBackwardsCursor: Boolean(page.backwardsCursor)
  });
  return {
    ...page,
    turns
  };
}

function jsonByteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value));
}

function guaranteeHistoryTurns(
  threadId: string,
  messages: LocalCodexHistoryMessage[],
  turns: CodexThreadTurn[]
): CodexThreadTurn[] {
  if (turns.length > 0 || messages.length === 0) {
    return turns;
  }
  return historyMessagesToSyntheticTurns(threadId, messages);
}

function turnsToHistoryMessages(
  turns: CodexThread["turns"] = []
): LocalCodexHistoryMessage[] {
  const messages: LocalCodexHistoryMessage[] = [];
  for (const turn of turns) {
    if (!turn) {
      continue;
    }
    const ts = timestampToIso(turn.completedAt ?? turn.startedAt ?? Date.now());
    turn.items.forEach((item, index) => {
      const message = threadItemToHistoryMessage(item, ts, `${turn.id}-${index}`);
      if (message) {
        messages.push(message);
      }
    });
  }
  return messages;
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

function threadItemToHistoryMessage(
  item: CodexThreadItem,
  ts: string,
  generatedId: string
): LocalCodexHistoryMessage | null {
  const id = typeof item.id === "string" ? item.id : generatedId;
  switch (item.type) {
    case "userMessage":
      return historyMessage(id, "user", extractUserMessageText(item.content), ts);
    case "agentMessage":
      return historyMessage(id, "assistant", item.text ?? "", ts);
    case "commandExecution": {
      const output = item.aggregatedOutput ? `\n\n${item.aggregatedOutput}` : "";
      return historyMessage(id, "command", `$ ${item.command ?? ""}${output}`, ts);
    }
    case "fileChange":
      return historyMessage(
        id,
        "diff",
        JSON.stringify(item.changes ?? [], null, 2),
        ts
      );
    default:
      return null;
  }
}

function historyMessage(
  id: string,
  role: LocalCodexHistoryMessage["role"],
  text: string,
  ts: string
): LocalCodexHistoryMessage | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  return { id, role, text: trimmed.slice(0, 16_000), ts };
}

function readThreadStatusType(status: unknown): string | null {
  if (isPlainObject(status) && typeof status.type === "string") {
    return status.type;
  }
  if (typeof status === "string") {
    return status;
  }
  return null;
}

function isLoadedThreadStatus(status: unknown): boolean {
  const type = readThreadStatusType(status);
  return type !== null && type !== "notLoaded";
}

function extractUserMessageText(content: unknown): string {
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((item) => {
      if (!isPlainObject(item)) {
        return "";
      }
      if (typeof item.text === "string") {
        return item.text;
      }
      if (typeof item.path === "string") {
        return `[image] ${item.path}`;
      }
      if (typeof item.url === "string") {
        return `[image] ${item.url}`;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n\n");
}

function timestampToIso(timestampSeconds: number | null | undefined): string {
  if (typeof timestampSeconds !== "number" || !Number.isFinite(timestampSeconds)) {
    return new Date().toISOString();
  }
  return new Date(timestampSeconds * 1000).toISOString();
}

async function directoryExists(candidatePath: string): Promise<boolean> {
  try {
    return (await stat(candidatePath)).isDirectory();
  } catch {
    return false;
  }
}

function formatThreadSource(source: unknown): string {
  if (typeof source === "string") {
    return source;
  }
  if (isPlainObject(source)) {
    return Object.keys(source)[0] ?? "unknown";
  }
  return "unknown";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function health(
  options: LocalAgentRuntimeOptions
): Promise<LocalHealthResponse> {
  const codex = await codexVersion(options.codexBin);
  const hostname = os.hostname();
  return {
    ok: true,
    version: "0.1.0",
    pid: process.pid,
    uptimeSeconds: Math.floor(process.uptime()),
    host: options.host,
    port: options.port,
    device: {
      defaultName: hostname || "Codex agent",
      hostname,
      platform: process.platform
    },
    codex
  };
}

export function activeSessionCount(summaries: LocalSessionSummary[]): number {
  return summaries.filter((session) => Boolean(session.activeTurnId)).length;
}

export async function codexVersion(
  codexBin: string
): Promise<{ available: boolean; version?: string }> {
  return new Promise((resolve) => {
    const child = spawn(codexBin, ["--version"], {
      stdio: ["ignore", "pipe", "ignore"]
    });
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.on("error", () => {
      resolve({ available: false });
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ available: true, version: stdout.trim() });
        return;
      }
      resolve({ available: false });
    });
  });
}
