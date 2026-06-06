import http, {
  type IncomingMessage,
  type Server,
  type ServerResponse
} from "node:http";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import type { AddressInfo } from "node:net";
import type {
  LocalCodexHistoryDetailResponse,
  LocalCodexHistoryEntry,
  LocalCodexHistoryMessage,
  LocalCodexHistoryResponse,
  LocalDirectoryListResponse,
  LocalEvent
} from "@codexnext/protocol";
import {
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
        sendJson(response, 200, await listCodexHistory(url));
        return;
      case "codex-history.detail":
        sendJson(response, 200, await readCodexHistoryDetail(url));
        return;
      case "codex-history.resume": {
        const body = LocalResumeSessionSchema.parse(await readJson(request));
        const history = await readCodexHistoryDetailById({
          id: body.id,
          cwd: body.cwd,
          ...(body.filePath ? { filePath: body.filePath } : {})
        });
        const session = await services.sessionManager.resumeSession({
          ...body,
          threadId: history.entry.id,
          cwd: history.entry.cwd
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

async function listCodexHistory(url: URL): Promise<LocalCodexHistoryResponse> {
  const root = path.join(os.homedir(), ".codex", "sessions");
  const limit = Math.max(
    1,
    Math.min(200, Number(url.searchParams.get("limit") ?? "80") || 80)
  );
  const files = await collectCodexSessionFiles(root, limit * 3);
  const entries: LocalCodexHistoryEntry[] = [];

  for (const filePath of files) {
    const entry = await readCodexHistoryEntry(filePath);
    if (entry && !isHiddenCodexHistoryEntry(entry)) {
      entries.push(entry);
    }
    if (entries.length >= limit) {
      break;
    }
  }

  return { root, entries: dedupeCodexHistoryEntries(entries) };
}

async function readCodexHistoryDetail(
  url: URL
): Promise<LocalCodexHistoryDetailResponse> {
  const id = url.searchParams.get("id")?.trim();
  const cwd = url.searchParams.get("cwd")?.trim();
  const filePath = url.searchParams.get("filePath")?.trim();
  if (!id || !cwd) {
    throw new Error("Missing codex history id or cwd");
  }

  return readCodexHistoryDetailById({
    id,
    cwd,
    ...(filePath ? { filePath } : {})
  });
}

async function readCodexHistoryDetailById(input: {
  id: string;
  cwd: string;
  filePath?: string;
}): Promise<LocalCodexHistoryDetailResponse> {
  const { filePath, id, cwd } = input;

  const root = path.join(os.homedir(), ".codex", "sessions");
  if (filePath) {
    const resolvedFilePath = path.resolve(filePath);
    if (!isPathInside(root, resolvedFilePath)) {
      throw new Error("Codex history filePath is outside the sessions store");
    }
    const entry = await readCodexHistoryEntry(resolvedFilePath);
    if (entry?.id === id && entry.cwd === cwd) {
      return {
        entry,
        messages: await readCodexHistoryMessages(resolvedFilePath)
      };
    }
  }

  const files = await collectCodexSessionFiles(root, 800);
  for (const filePath of files) {
    const entry = await readCodexHistoryEntry(filePath);
    if (!entry || entry.id !== id || entry.cwd !== cwd) {
      continue;
    }
    return {
      entry,
      messages: await readCodexHistoryMessages(filePath)
    };
  }

  throw new Error(`Codex history entry not found: ${id}`);
}

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function dedupeCodexHistoryEntries(
  entries: LocalCodexHistoryEntry[]
): LocalCodexHistoryEntry[] {
  const seen = new Set<string>();
  const unique: LocalCodexHistoryEntry[] = [];
  for (const entry of entries) {
    const key = `${entry.id}::${entry.cwd}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(entry);
  }
  return unique;
}

async function collectCodexSessionFiles(
  root: string,
  limit: number
): Promise<string[]> {
  const files: string[] = [];

  async function walk(currentPath: string, depth: number): Promise<void> {
    if (files.length >= limit || depth > 4) {
      return;
    }

    let entries;
    try {
      entries = await readdir(currentPath, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((a, b) => b.name.localeCompare(a.name));

    for (const entry of entries) {
      if (files.length >= limit) {
        return;
      }
      const entryPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath, depth + 1);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        files.push(entryPath);
      }
    }
  }

  await walk(root, 0);
  return files;
}

async function readCodexHistoryEntry(
  filePath: string
): Promise<LocalCodexHistoryEntry | null> {
  let id = "";
  let cwd = "";
  let title = "";
  let createdAt = "";
  let updatedAt = "";
  let source = "Codex";
  let lineCount = 0;
  let hasUsefulHistoryContent = false;
  const stream = createReadStream(filePath, { encoding: "utf8" });
  const reader = createInterface({ input: stream, crlfDelay: Infinity });

  try {
    for await (const line of reader) {
      lineCount += 1;
      if (lineCount > 300) {
        break;
      }

      let record: unknown;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      if (!isPlainRecord(record)) {
        continue;
      }

      const timestamp = readString(record, "timestamp");
      if (timestamp) {
        updatedAt = timestamp;
      }

      if (record.type === "session_meta" && isPlainRecord(record.payload)) {
        id = readString(record.payload, "id") ?? id;
        cwd = readString(record.payload, "cwd") ?? cwd;
        createdAt = readString(record.payload, "timestamp") ?? createdAt;
        source =
          readString(record.payload, "originator") ??
          readString(record.payload, "source") ??
          source;
      }

      title = title || extractHistoryTitle(record);
      if (!hasUsefulHistoryContent && hasUsefulHistoryMessage(record, timestamp ?? "")) {
        hasUsefulHistoryContent = true;
      }

      if (id && cwd && title) {
        break;
      }
    }
  } finally {
    reader.close();
    stream.destroy();
  }

  if (!id) {
    id = path.basename(filePath, ".jsonl").replace(/^rollout-[^-]+-/, "");
  }
  if (!cwd) {
    return null;
  }
  if (!title || !hasUsefulHistoryContent) {
    return null;
  }
  const cwdExists = await directoryExists(cwd);

  return {
    id,
    cwd,
    cwdExists,
    title: compactTitle(title),
    createdAt: createdAt || updatedAt || new Date().toISOString(),
    updatedAt: updatedAt || createdAt || new Date().toISOString(),
    source,
    filePath
  };
}

async function directoryExists(candidatePath: string): Promise<boolean> {
  try {
    return (await stat(candidatePath)).isDirectory();
  } catch {
    return false;
  }
}

function isHiddenCodexHistoryEntry(entry: LocalCodexHistoryEntry): boolean {
  const basename = path.basename(entry.cwd);
  return entry.cwd.startsWith("/tmp/codex-goal-probe-") ||
    basename.startsWith("codex-goal-probe-") ||
    isAutomationPromptTitle(entry.title);
}

async function readCodexHistoryMessages(
  filePath: string
): Promise<LocalCodexHistoryMessage[]> {
  const messages: LocalCodexHistoryMessage[] = [];
  const seen = new Set<string>();
  let lineCount = 0;
  const stream = createReadStream(filePath, { encoding: "utf8" });
  const reader = createInterface({ input: stream, crlfDelay: Infinity });

  try {
    for await (const line of reader) {
      lineCount += 1;
      if (lineCount > 2_500) {
        break;
      }

      let record: unknown;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      if (!isPlainRecord(record)) {
        continue;
      }

      const ts = readString(record, "timestamp") ?? "";
      const extracted = extractHistoryMessage(record, ts);
      if (!extracted) {
        continue;
      }
      const historyText = normalizeHistoryUserText(extracted.text);
      const text = compactMessageText(historyText);
      if (!text || !isUsableHistoryMessage(text)) {
        continue;
      }
      const duplicateKey = `${extracted.role}:${text}`;
      if (seen.has(duplicateKey)) {
        continue;
      }
      seen.add(duplicateKey);
      messages.push({
        id: `${path.basename(filePath, ".jsonl")}-${lineCount}`,
        role: extracted.role,
        text,
        ts
      });
      if (messages.length >= 160) {
        break;
      }
    }
  } finally {
    reader.close();
    stream.destroy();
  }

  return messages;
}

function extractHistoryMessage(
  record: Record<string, unknown>,
  ts: string
): { role: LocalCodexHistoryMessage["role"]; text: string; ts: string } | null {
  if (record.type === "event_msg" && isPlainRecord(record.payload)) {
    const eventType = readString(record.payload, "type");
    if (eventType === "user_message") {
      return {
        role: "user",
        text: readString(record.payload, "message") ?? "",
        ts
      };
    }
    if (eventType === "agent_message") {
      return {
        role: "assistant",
        text: readString(record.payload, "message") ?? "",
        ts
      };
    }
    if (eventType === "command_output") {
      return {
        role: "command",
        text: readString(record.payload, "output") ?? "",
        ts
      };
    }
  }

  if (record.type !== "response_item" || !isPlainRecord(record.payload)) {
    return null;
  }
  if (record.payload.type !== "message") {
    return null;
  }
  const role = record.payload.role;
  if (role !== "user" && role !== "assistant") {
    return null;
  }
  return {
    role,
    text: extractMessageContent(record.payload.content),
    ts
  };
}

function extractMessageContent(content: unknown): string {
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((item) => {
      if (!isPlainRecord(item)) {
        return "";
      }
      return (
        readString(item, "text") ??
        readString(item, "input_text") ??
        readString(item, "output_text") ??
        ""
      );
    })
    .filter(Boolean)
    .join("\n\n");
}

function extractHistoryTitle(record: Record<string, unknown>): string {
  if (record.type === "event_msg" && isPlainRecord(record.payload)) {
    const eventType = readString(record.payload, "type");
    if (eventType === "user_message") {
      const message = readString(record.payload, "message") ?? "";
      const title = normalizeHistoryUserText(message);
      return isUsableHistoryTitle(title) ? title : "";
    }
  }

  if (record.type !== "response_item" || !isPlainRecord(record.payload)) {
    return "";
  }
  if (record.payload.type !== "message" || record.payload.role !== "user") {
    return "";
  }
  const content = record.payload.content;
  if (!Array.isArray(content)) {
    return "";
  }
  for (const item of content) {
    if (!isPlainRecord(item)) {
      continue;
    }
    const text = readString(item, "text") ?? readString(item, "input_text");
    const title = normalizeHistoryUserText(text ?? "");
    if (title && isUsableHistoryTitle(title)) {
      return title;
    }
  }
  return "";
}

function normalizeHistoryUserText(input: string): string {
  const trimmed = stripSyntheticTitleInstruction(input).trim();
  if (!trimmed) {
    return "";
  }
  const missionTitle = extractMissionTitle(trimmed);
  if (missionTitle) {
    return missionTitle;
  }
  const explicitRequest = extractMarkedUserRequest(trimmed);
  if (explicitRequest) {
    return explicitRequest;
  }
  if (isCodexInjectedContext(trimmed)) {
    return "";
  }
  return trimmed;
}

function stripSyntheticTitleInstruction(input: string): string {
  const markers = [
    "\n\nBased on this message, call functions.happy__change_title",
    "Based on this message, call functions.happy__change_title"
  ];
  for (const marker of markers) {
    const index = input.indexOf(marker);
    if (index !== -1) {
      return input.slice(0, index);
    }
  }
  return input;
}

function extractMissionTitle(input: string): string {
  const match = input.match(/^Mission title:\s*(.+)$/im);
  return match ? match[1]?.trim() ?? "" : "";
}

function extractMarkedUserRequest(input: string): string {
  const markers = [
    "## My request for Codex:",
    "# My request for Codex:",
    "My request for Codex:",
    "## 用户请求:",
    "用户请求:"
  ];
  for (const marker of markers) {
    const index = input.indexOf(marker);
    if (index === -1) {
      continue;
    }
    return input.slice(index + marker.length).trim();
  }
  return "";
}

function isCodexInjectedContext(input: string): boolean {
  const normalized = input.replace(/\r\n/g, "\n").trim();
  const lower = normalized.toLowerCase();
  return (
    normalized.startsWith("# AGENTS.md instructions for ") ||
    normalized.startsWith("<environment_context>") ||
    normalized.startsWith("<INSTRUCTIONS>") ||
    lower.includes("codexbridge global instructions") ||
    lower.includes("<environment_context>") ||
    lower.includes("</instructions>")
  );
}

function isUsableHistoryTitle(input: string): boolean {
  const trimmed = input.trim();
  return Boolean(trimmed) && !trimmed.startsWith("<");
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

function compactTitle(input: string): string {
  return input.replace(/\s+/g, " ").trim().slice(0, 120);
}

function compactMessageText(input: string): string {
  return input.replace(/\n{3,}/g, "\n\n").trim().slice(0, 16_000);
}

function hasUsefulHistoryMessage(
  record: Record<string, unknown>,
  ts: string
): boolean {
  const extracted = extractHistoryMessage(record, ts);
  if (!extracted) {
    return false;
  }
  const text =
    extracted.role === "user"
      ? normalizeHistoryUserText(extracted.text)
      : extracted.text;
  return Boolean(compactMessageText(text)) && isUsableHistoryMessage(text);
}

function isUsableHistoryMessage(input: string): boolean {
  const trimmed = input.trim();
  return Boolean(trimmed) && !trimmed.startsWith("<");
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, key: string): string | null {
  return typeof record[key] === "string" ? record[key] : null;
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
