import http, {
  type IncomingMessage,
  type Server,
  type ServerResponse
} from "node:http";
import type { AddressInfo } from "node:net";
import type {
  LocalEvent
} from "@codexnext/protocol";
import {
  LocalApprovalDecisionSchema,
  LocalResumeSessionSchema,
  LocalSendMessageSchema,
  LocalSetGoalSchema,
  LocalStartSessionSchema,
  RelayMethod
} from "@codexnext/protocol";
import { allowedOrigins, isAllowedOrigin, isAuthorized } from "./auth.js";
import { EventStore } from "./event-store.js";
import {
  createLocalAgentRuntime,
  type LocalAgentRuntime
} from "./local-agent.js";
import type { CodexClientFactory } from "./session-manager.js";

export interface LocalServerOptions {
  host: string;
  port: number;
  webOrigin: string;
  token: string;
  approvalTimeoutMs: number;
  codexBin: string;
  eventLimit?: number;
  clientFactory?: CodexClientFactory;
  historySource?: "auto" | "disabled";
  historySessionsRoot?: string;
  historyStateDbPath?: string;
}

export interface LocalServerHandle {
  server: Server;
  eventStore: LocalAgentRuntime["eventStore"];
  sessionManager: LocalAgentRuntime["sessionManager"];
  approvalBridge: LocalAgentRuntime["approvalBridge"];
  close(): Promise<void>;
}

export function createLocalServer(options: LocalServerOptions): LocalServerHandle {
  const runtime = createLocalAgentRuntime({
    host: options.host,
    port: options.port,
    approvalTimeoutMs: options.approvalTimeoutMs,
    codexBin: options.codexBin,
    ...(options.eventLimit !== undefined ? { eventLimit: options.eventLimit } : {}),
    ...(options.clientFactory ? { clientFactory: options.clientFactory } : {}),
    ...(options.historySource ? { historySource: options.historySource } : {}),
    ...(options.historySessionsRoot
      ? { historySessionsRoot: options.historySessionsRoot }
      : {}),
    ...(options.historyStateDbPath ? { historyStateDbPath: options.historyStateDbPath } : {})
  });

  const server = http.createServer((request, response) => {
    void handleRequest(request, response, options, runtime);
  });

  return {
    server,
    eventStore: runtime.eventStore,
    sessionManager: runtime.sessionManager,
    approvalBridge: runtime.approvalBridge,
    close: async () => {
      await runtime.close();
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
  runtime: LocalAgentRuntime
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
        sendJson(response, 200, await runtime.health());
        return;
      case "sessions.list":
        sendJson(response, 200, await runtime.invoke(RelayMethod.SessionsList));
        return;
      case "directories.list":
        sendJson(
          response,
          200,
          await runtime.invoke(RelayMethod.DirectoriesList, {
            path: url.searchParams.get("path") ?? undefined
          })
        );
        return;
      case "codex-history.list":
        sendJson(response, 200, await runtime.invoke(RelayMethod.CodexHistoryList, {
          limit: Number(url.searchParams.get("limit") ?? "80") || 80,
          search: url.searchParams.get("search")?.trim() || null
        }));
        return;
      case "codex-history.loaded":
        sendJson(response, 200, await runtime.invoke(RelayMethod.CodexHistoryLoaded));
        return;
      case "codex-history.detail":
        sendJson(response, 200, await runtime.invoke(RelayMethod.CodexHistoryDetail, {
          id: url.searchParams.get("id")?.trim(),
          cwd: url.searchParams.get("cwd")?.trim() || undefined
        }));
        return;
      case "codex-history.turns":
        sendJson(response, 200, await runtime.invoke(RelayMethod.CodexHistoryTurns, {
          id: url.searchParams.get("id")?.trim(),
          cwd: url.searchParams.get("cwd")?.trim() || undefined,
          cursor: url.searchParams.get("cursor")?.trim() || undefined,
          limit: Number(url.searchParams.get("limit") ?? "40") || 40,
          sortDirection: url.searchParams.get("sortDirection")?.trim() || undefined,
          itemsView: url.searchParams.get("itemsView")?.trim() || undefined
        }));
        return;
      case "codex-history.archive": {
        const body = await readJson(request);
        sendJson(response, 200, await runtime.invoke(RelayMethod.CodexHistoryArchive, body));
        return;
      }
      case "codex-history.resume": {
        const body = LocalResumeSessionSchema.parse(await readJson(request));
        sendJson(response, 201, await runtime.invoke(RelayMethod.CodexHistoryResume, body));
        return;
      }
      case "sessions.create": {
        const body = LocalStartSessionSchema.parse(await readJson(request));
        sendJson(response, 201, await runtime.invoke(RelayMethod.SessionsCreate, body));
        return;
      }
      case "sessions.message": {
        const body = LocalSendMessageSchema.parse(await readJson(request));
        const result = await runtime.invoke(RelayMethod.SessionsMessage, {
          sessionId: route.params.sessionId,
          body
        });
        sendJson(response, 200, result);
        return;
      }
      case "sessions.turn.create": {
        const body = LocalSendMessageSchema.parse(await readJson(request));
        const turnId = await runtime.sessionManager.startTurn(
          route.params.sessionId,
          body
        );
        sendJson(response, 201, { mode: "turn-start", turnId });
        return;
      }
      case "sessions.turn.steer": {
        const body = LocalSendMessageSchema.parse(await readJson(request));
        const result = await runtime.sessionManager.steerTurn(
          route.params.sessionId,
          route.params.turnId,
          body
        );
        sendJson(response, 200, result);
        return;
      }
      case "sessions.turn.interrupt": {
        const result = await runtime.invoke(RelayMethod.TurnInterrupt, {
          sessionId: route.params.sessionId,
          turnId: route.params.turnId
        });
        sendJson(response, 200, result);
        return;
      }
      case "sessions.goal.get": {
        const result = await runtime.invoke(RelayMethod.SessionsGoalGet, {
          sessionId: route.params.sessionId
        });
        sendJson(response, 200, result);
        return;
      }
      case "sessions.goal.set": {
        const body = LocalSetGoalSchema.parse(await readJson(request));
        const result = await runtime.invoke(RelayMethod.SessionsGoalSet, {
          sessionId: route.params.sessionId,
          body
        });
        sendJson(response, 200, result);
        return;
      }
      case "sessions.goal.clear": {
        const result = await runtime.invoke(RelayMethod.SessionsGoalClear, {
          sessionId: route.params.sessionId
        });
        sendJson(response, 200, result);
        return;
      }
      case "approvals.decision": {
        const body = LocalApprovalDecisionSchema.parse(await readJson(request));
        const result = await runtime.invoke(RelayMethod.ApprovalDecision, {
          approvalId: route.params.approvalId,
          body
        });
        sendJson(response, 200, result);
        return;
      }
      case "events.replay": {
        const after = Number(url.searchParams.get("after") ?? "0");
        sendJson(response, 200, runtime.replayEvents(after));
        return;
      }
      case "events.stream":
        streamEvents(response, runtime.eventStore, url);
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
  | { name: "codex-history.loaded"; public: false; params: Record<string, never> }
  | { name: "codex-history.detail"; public: false; params: Record<string, never> }
  | { name: "codex-history.turns"; public: false; params: Record<string, never> }
  | { name: "codex-history.archive"; public: false; params: Record<string, never> }
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
  if (method === "GET" && pathname === "/api/codex-history/loaded") {
    return { name: "codex-history.loaded", public: false, params: {} };
  }
  if (method === "GET" && pathname === "/api/codex-history/detail") {
    return { name: "codex-history.detail", public: false, params: {} };
  }
  if (method === "GET" && pathname === "/api/codex-history/turns") {
    return { name: "codex-history.turns", public: false, params: {} };
  }
  if (method === "POST" && pathname === "/api/codex-history/archive") {
    return { name: "codex-history.archive", public: false, params: {} };
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
