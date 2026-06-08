import http, {
  type IncomingMessage,
  type Server,
  type ServerResponse
} from "node:http";
import { spawn } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type {
  CodexThread,
  CodexThreadItem,
  LocalCodexHistoryDetailResponse,
  LocalCodexHistoryEntry,
  LocalCodexHistoryMessage,
  LocalCodexHistoryResponse,
  LocalDirectoryListResponse,
  LocalEvent
} from "@codexnext/protocol";
import {
  deriveCodexConversationTitle,
  deriveCodexGeneratedTitle,
  LocalApprovalDecisionSchema,
  LocalResumeSessionSchema,
  LocalSendMessageSchema,
  LocalSetGoalSchema,
  LocalStartSessionSchema
} from "@codexnext/protocol";
import { ApprovalBridge } from "./approval-bridge.js";
import { allowedOrigins, isAllowedOrigin, isAuthorized } from "./auth.js";
import { EventStore } from "./event-store.js";
import {
  SessionManager,
  type CodexClientFactory
} from "./session-manager.js";

export interface LocalServerOptions {
  host: string;
  port: number;
  webOrigin: string;
  token: string;
  approvalTimeoutMs: number;
  codexBin: string;
  eventLimit?: number;
  clientFactory?: CodexClientFactory;
}

export interface LocalServerHandle {
  server: Server;
  eventStore: EventStore;
  sessionManager: SessionManager;
  approvalBridge: ApprovalBridge;
  close(): Promise<void>;
}

export function createLocalServer(options: LocalServerOptions): LocalServerHandle {
  const eventStore = new EventStore({ limit: options.eventLimit });
  const approvalBridge = new ApprovalBridge({
    timeoutMs: options.approvalTimeoutMs,
    eventStore
  });
  const sessionManager = new SessionManager({
    eventStore,
    approvalBridge,
    codexBin: options.codexBin,
    clientFactory: options.clientFactory
  });

  const server = http.createServer((request, response) => {
    void handleRequest(request, response, options, {
      eventStore,
      sessionManager,
      approvalBridge
    });
  });

  return {
    server,
    eventStore,
    sessionManager,
    approvalBridge,
    close: async () => {
      await sessionManager.closeAll();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  };
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: LocalServerOptions,
  services: {
    eventStore: EventStore;
    sessionManager: SessionManager;
    approvalBridge: ApprovalBridge;
  }
): Promise<void> {
  const url = new URL(request.url ?? "/", `http://${options.host}:${options.port}`);
  setCorsHeaders(response, options.webOrigin, request);

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  if (!isAllowedOrigin(request, options.webOrigin)) {
    sendJson(response, 403, { error: "Unexpected Origin" });
    return;
  }

  const route = matchRoute(request.method ?? "GET", url.pathname);

  if (!route) {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  if (!route.public && !isAuthorized(url, request, options)) {
    sendJson(response, 401, { error: "Missing or invalid token" });
    return;
  }

  try {
    switch (route.name) {
      case "health":
        sendJson(response, 200, await health(options));
        return;
      case "sessions.list":
        sendJson(response, 200, { sessions: services.sessionManager.summaries() });
        return;
      case "directories.list":
        sendJson(response, 200, await listDirectories(url));
        return;
      case "codex-history.list":
        sendJson(
          response,
          200,
          await listCodexHistory(url, services.sessionManager)
        );
        return;
      case "codex-history.detail":
        sendJson(
          response,
          200,
          await readCodexHistoryDetail(url, services.sessionManager)
        );
        return;
      case "codex-history.resume": {
        const body = LocalResumeSessionSchema.parse(await readJson(request));
        const history = await readCodexHistoryDetailById(
          body.id,
          services.sessionManager
        );
        const session = await services.sessionManager.resumeSession({
          ...body,
          threadId: history.entry.id,
          cwd: history.entry.cwd,
          title: history.entry.title
        });
        sendJson(response, 201, { session, history });
        return;
      }
      case "sessions.create": {
        const body = LocalStartSessionSchema.parse(await readJson(request));
        const session = await services.sessionManager.startSession(body);
        sendJson(response, 201, { session });
        return;
      }
      case "sessions.message": {
        const body = LocalSendMessageSchema.parse(await readJson(request));
        const result = await services.sessionManager.sendMessage(
          route.params.sessionId,
          body
        );
        sendJson(response, 200, result);
        return;
      }
      case "sessions.turn.create": {
        const body = LocalSendMessageSchema.parse(await readJson(request));
        const turnId = await services.sessionManager.startTurn(
          route.params.sessionId,
          body
        );
        sendJson(response, 201, { mode: "turn-start", turnId });
        return;
      }
      case "sessions.turn.steer": {
        const body = LocalSendMessageSchema.parse(await readJson(request));
        const result = await services.sessionManager.steerTurn(
          route.params.sessionId,
          route.params.turnId,
          body
        );
        sendJson(response, 200, result);
        return;
      }
      case "sessions.turn.interrupt": {
        const result = await services.sessionManager.interruptTurn(
          route.params.sessionId,
          route.params.turnId
        );
        sendJson(response, 200, result);
        return;
      }
      case "sessions.goal.get": {
        const result = await services.sessionManager.getGoal(route.params.sessionId);
        sendJson(response, 200, result);
        return;
      }
      case "sessions.goal.set": {
        const body = LocalSetGoalSchema.parse(await readJson(request));
        const result = await services.sessionManager.setGoal(
          route.params.sessionId,
          body
        );
        sendJson(response, 200, result);
        return;
      }
      case "sessions.goal.clear": {
        const result = await services.sessionManager.clearGoal(
          route.params.sessionId
        );
        sendJson(response, 200, result);
        return;
      }
      case "approvals.decision": {
        const body = LocalApprovalDecisionSchema.parse(await readJson(request));
        const result = services.approvalBridge.resolveDecision(
          route.params.approvalId,
          body.decision
        );
        sendJson(response, 200, result);
        return;
      }
      case "events.replay": {
        const after = Number(url.searchParams.get("after") ?? "0");
        sendJson(response, 200, {
          events: services.eventStore.after(Number.isFinite(after) ? after : 0)
        });
        return;
      }
      case "events.stream":
        streamEvents(response, services.eventStore, url);
        return;
    }
  } catch (error) {
    sendJson(response, 400, {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

type Route =
  | { name: "health"; public: true; params: Record<string, never> }
  | { name: "directories.list"; public: false; params: Record<string, never> }
  | { name: "codex-history.list"; public: false; params: Record<string, never> }
  | { name: "codex-history.detail"; public: false; params: Record<string, never> }
  | { name: "codex-history.resume"; public: false; params: Record<string, never> }
  | { name: "sessions.list"; public: false; params: Record<string, never> }
  | { name: "sessions.create"; public: false; params: Record<string, never> }
  | { name: "sessions.message"; public: false; params: { sessionId: string } }
  | { name: "sessions.turn.create"; public: false; params: { sessionId: string } }
  | {
      name: "sessions.turn.steer";
      public: false;
      params: { sessionId: string; turnId: string };
    }
  | {
      name: "sessions.turn.interrupt";
      public: false;
      params: { sessionId: string; turnId: string };
    }
  | { name: "sessions.goal.get"; public: false; params: { sessionId: string } }
  | { name: "sessions.goal.set"; public: false; params: { sessionId: string } }
  | {
      name: "sessions.goal.clear";
      public: false;
      params: { sessionId: string };
    }
  | {
      name: "approvals.decision";
      public: false;
      params: { approvalId: string };
    }
  | { name: "events.replay"; public: false; params: Record<string, never> }
  | { name: "events.stream"; public: false; params: Record<string, never> };

function matchRoute(method: string, pathname: string): Route | null {
  const parts = pathname.split("/").filter(Boolean);

  if (method === "GET" && pathname === "/api/health") {
    return { name: "health", public: true, params: {} };
  }
  if (method === "GET" && pathname === "/api/sessions") {
    return { name: "sessions.list", public: false, params: {} };
  }
  if (method === "GET" && pathname === "/api/directories") {
    return { name: "directories.list", public: false, params: {} };
  }
  if (method === "GET" && pathname === "/api/codex-history") {
    return { name: "codex-history.list", public: false, params: {} };
  }
  if (method === "GET" && pathname === "/api/codex-history/detail") {
    return { name: "codex-history.detail", public: false, params: {} };
  }
  if (method === "POST" && pathname === "/api/codex-history/resume") {
    return { name: "codex-history.resume", public: false, params: {} };
  }
  if (method === "POST" && pathname === "/api/sessions") {
    return { name: "sessions.create", public: false, params: {} };
  }
  if (method === "GET" && pathname === "/api/events") {
    return { name: "events.replay", public: false, params: {} };
  }
  if (method === "GET" && pathname === "/api/events/stream") {
    return { name: "events.stream", public: false, params: {} };
  }
  if (
    method === "POST" &&
    parts.length === 4 &&
    parts[0] === "api" &&
    parts[1] === "approvals" &&
    parts[3] === "decision"
  ) {
    return {
      name: "approvals.decision",
      public: false,
      params: { approvalId: decodeURIComponent(parts[2] ?? "") }
    };
  }
  if (
    parts.length >= 4 &&
    parts[0] === "api" &&
    parts[1] === "sessions"
  ) {
    const sessionId = decodeURIComponent(parts[2] ?? "");
    if (method === "POST" && parts.length === 4 && parts[3] === "messages") {
      return { name: "sessions.message", public: false, params: { sessionId } };
    }
    if (parts.length === 4 && parts[3] === "goal") {
      if (method === "GET") {
        return { name: "sessions.goal.get", public: false, params: { sessionId } };
      }
      if (method === "POST") {
        return { name: "sessions.goal.set", public: false, params: { sessionId } };
      }
      if (method === "DELETE") {
        return {
          name: "sessions.goal.clear",
          public: false,
          params: { sessionId }
        };
      }
    }
    if (method === "POST" && parts.length === 4 && parts[3] === "turns") {
      return {
        name: "sessions.turn.create",
        public: false,
        params: { sessionId }
      };
    }
    if (
      method === "POST" &&
      parts.length === 6 &&
      parts[3] === "turns" &&
      parts[5] === "steer"
    ) {
      return {
        name: "sessions.turn.steer",
        public: false,
        params: { sessionId, turnId: decodeURIComponent(parts[4] ?? "") }
      };
    }
    if (
      method === "POST" &&
      parts.length === 6 &&
      parts[3] === "turns" &&
      parts[5] === "interrupt"
    ) {
      return {
        name: "sessions.turn.interrupt",
        public: false,
        params: { sessionId, turnId: decodeURIComponent(parts[4] ?? "") }
      };
    }
  }

  return null;
}

function streamEvents(
  response: ServerResponse,
  eventStore: EventStore,
  url: URL
): void {
  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive"
  });

  const after = Number(url.searchParams.get("after") ?? "0");
  for (const event of eventStore.after(Number.isFinite(after) ? after : 0)) {
    writeSse(response, event);
  }

  const listener = (event: LocalEvent) => {
    writeSse(response, event);
  };
  eventStore.on("event", listener);

  response.on("close", () => {
    eventStore.off("event", listener);
  });
}

function writeSse(response: ServerResponse, event: LocalEvent): void {
  response.write(`data: ${JSON.stringify(event)}\n\n`);
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  payload: unknown
): void {
  response.writeHead(statusCode, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
}

function setCorsHeaders(
  response: ServerResponse,
  webOrigin: string,
  request: IncomingMessage
): void {
  const origins = allowedOrigins(webOrigin);
  const requestOrigin = request.headers.origin;
  const responseOrigin =
    requestOrigin && origins.includes(requestOrigin)
      ? requestOrigin
      : origins[0] ?? webOrigin;
  response.setHeader("Access-Control-Allow-Origin", responseOrigin);
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  response.setHeader(
    "Access-Control-Allow-Headers",
    "Authorization,Content-Type"
  );
}

async function listDirectories(url: URL): Promise<LocalDirectoryListResponse> {
  const homePath = os.homedir();
  const requestedPath = url.searchParams.get("path") || homePath;
  const resolvedPath = path.resolve(requestedPath);
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
    .sort((a, b) => a.name.localeCompare(b.name));

  const parentPath = path.dirname(resolvedPath);

  return {
    path: resolvedPath,
    parentPath: parentPath === resolvedPath ? null : parentPath,
    homePath,
    entries
  };
}

async function listCodexHistory(
  url: URL,
  sessionManager: SessionManager
): Promise<LocalCodexHistoryResponse> {
  const limit = Math.max(
    1,
    Math.min(200, Number(url.searchParams.get("limit") ?? "80") || 80)
  );
  const response = await sessionManager.listThreads({
    limit,
    sortKey: "updated_at",
    sortDirection: "desc",
    archived: false,
    useStateDbOnly: true,
    searchTerm: url.searchParams.get("search")?.trim() || null
  });
  const entries = await Promise.all(
    response.data.map((thread) => threadToHistoryEntry(thread, response.data))
  );
  return { root: "codex app-server thread/list", entries };
}

async function readCodexHistoryDetail(
  url: URL,
  sessionManager: SessionManager
): Promise<LocalCodexHistoryDetailResponse> {
  const id = url.searchParams.get("id")?.trim();
  if (!id) {
    throw new Error("Missing codex thread id");
  }
  return readCodexHistoryDetailById(id, sessionManager);
}

async function readCodexHistoryDetailById(
  id: string,
  sessionManager: SessionManager
): Promise<LocalCodexHistoryDetailResponse> {
  const response = await sessionManager.readThread({
    threadId: id,
    includeTurns: true
  });
  return {
    entry: await threadToHistoryEntry(response.thread),
    messages: threadToHistoryMessages(response.thread)
  };
}

async function threadToHistoryEntry(
  thread: CodexThread,
  contextThreads?: CodexThread[]
): Promise<LocalCodexHistoryEntry> {
  const title =
    deriveCodexConversationTitle(thread, contextThreads) ??
    deriveCodexGeneratedTitle(thread.preview) ??
    "Untitled Codex thread";
  return {
    id: thread.id,
    cwd: thread.cwd,
    cwdExists: await directoryExists(thread.cwd),
    title,
    createdAt: timestampToIso(thread.createdAt),
    updatedAt: timestampToIso(thread.updatedAt),
    source: formatThreadSource(thread.source)
  };
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

async function health(options: LocalServerOptions): Promise<{
  ok: boolean;
  version: string;
  pid: number;
  uptimeSeconds: number;
  host: string;
  port: number;
  device: { defaultName: string; hostname: string; platform: string };
  codex: { available: boolean; version?: string };
}> {
  const codex = await codexVersion(options.codexBin);
  const hostname = os.hostname();
  return {
    ok: true,
    version: "0.1.0",
    pid: process.pid,
    uptimeSeconds: Math.floor(process.uptime()),
    host: options.host,
    port: effectivePort(options),
    device: {
      defaultName: hostname || "Codex agent",
      hostname,
      platform: process.platform
    },
    codex
  };
}

function effectivePort(options: LocalServerOptions): number {
  return options.port;
}

function codexVersion(
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

export function listen(
  handle: LocalServerHandle,
  host: string,
  port: number
): Promise<AddressInfo> {
  return new Promise((resolve, reject) => {
    handle.server.once("error", reject);
    handle.server.listen(port, host, () => {
      handle.server.off("error", reject);
      const address = handle.server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not resolve local server address"));
        return;
      }
      resolve(address);
    });
  });
}
