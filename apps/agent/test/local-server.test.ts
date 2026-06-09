import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type {
  AppServerNotification,
  ApprovalResponse,
  JsonRpcRequest,
  LocalApprovalDecision,
  LocalEvent,
  LocalSendMessageInput
} from "@codexnext/protocol";
import {
  CodexServerRequestMethod,
  LocalEventType,
  LocalSendMessageSchema
} from "@codexnext/protocol";
import { isAllowedOrigin, isAuthorized } from "../src/local-server/auth.js";
import { ApprovalBridge } from "../src/local-server/approval-bridge.js";
import { createLocalServer, listen } from "../src/local-server/create-local-server.js";
import { EventStore } from "../src/local-server/event-store.js";
import { SessionManager, type ManagedCodexClient } from "../src/local-server/session-manager.js";
import { goalSmokeExitCode } from "../src/commands/goal-smoke.js";

describe("local auth helpers", () => {
  it("rejects missing token", () => {
    const request = mockRequest();
    const url = new URL("http://127.0.0.1/api/sessions");
    expect(isAuthorized(url, request, { token: "secret", webOrigin: "x" })).toBe(false);
  });

  it("rejects wrong token", () => {
    const request = mockRequest();
    const url = new URL("http://127.0.0.1/api/sessions?token=wrong");
    expect(isAuthorized(url, request, { token: "secret", webOrigin: "x" })).toBe(false);
  });

  it("accepts correct token", () => {
    const request = mockRequest();
    const url = new URL("http://127.0.0.1/api/sessions?token=secret");
    expect(isAuthorized(url, request, { token: "secret", webOrigin: "x" })).toBe(true);
  });

  it("rejects unexpected browser origin", () => {
    const request = mockRequest({ origin: "http://evil.local" });
    expect(isAllowedOrigin(request, "http://127.0.0.1:3000")).toBe(false);
  });
});

describe("EventStore", () => {
  it("assigns monotonic seq and replays after a seq", () => {
    const store = new EventStore();
    const first = store.append({ type: LocalEventType.AgentHealth });
    const second = store.append({ type: LocalEventType.SessionCreated });

    expect(first.seq).toBe(1);
    expect(second.seq).toBe(2);
    expect(store.after(1)).toEqual([second]);
  });

  it("trims old events with ring buffer limit", () => {
    const store = new EventStore({ limit: 2 });
    store.append({ type: LocalEventType.AgentHealth });
    const second = store.append({ type: LocalEventType.SessionCreated });
    const third = store.append({ type: LocalEventType.SessionUpdated });

    expect(store.all()).toEqual([second, third]);
  });
});

describe("ApprovalBridge", () => {
  it("resolves user decision", async () => {
    const store = new EventStore();
    const bridge = new ApprovalBridge({ eventStore: store, timeoutMs: 1_000 });
    const pending = bridge.requestApproval({
      sessionId: "session_1",
      method: CodexServerRequestMethod.CommandExecutionRequestApproval,
      params: { threadId: "thread_1", turnId: "turn_1" }
    });
    const approval = bridge.listPending()[0];
    expect(approval?.approvalId).toBeTruthy();

    bridge.resolveDecision(approval?.approvalId ?? "", "acceptForSession");

    await expect(pending).resolves.toEqual({ decision: "acceptForSession" });
  });

  it("timeout returns decline", async () => {
    vi.useFakeTimers();
    const store = new EventStore();
    const bridge = new ApprovalBridge({ eventStore: store, timeoutMs: 50 });
    const pending = bridge.requestApproval({
      sessionId: "session_1",
      method: CodexServerRequestMethod.FileChangeRequestApproval,
      params: {}
    });

    await vi.advanceTimersByTimeAsync(51);

    await expect(pending).resolves.toEqual({ decision: "decline" });
    vi.useRealTimers();
  });

  it("maps legacy cancel to abort", async () => {
    const store = new EventStore();
    const bridge = new ApprovalBridge({ eventStore: store, timeoutMs: 1_000 });
    const pending = bridge.requestApproval({
      sessionId: "session_1",
      method: CodexServerRequestMethod.LegacyExecCommandApproval,
      params: {}
    });
    const approval = bridge.listPending()[0];
    bridge.resolveDecision(approval?.approvalId ?? "", "cancel");

    await expect(pending).resolves.toEqual({ decision: "abort" });
  });
});

describe("SessionManager messages", () => {
  it("starts a turn when idle and steers when active", async () => {
    const store = new EventStore();
    const bridge = new ApprovalBridge({ eventStore: store, timeoutMs: 1_000 });
    const fake = new FakeCodexClient();
    const manager = new SessionManager({
      eventStore: store,
      approvalBridge: bridge,
      codexBin: "codex",
      clientFactory: () => fake
    });

    const session = await manager.startSession({
      cwd: process.cwd(),
      permissionMode: "request-approval",
      approvalPolicy: "on-request"
    });
    const first = await manager.sendMessage(session.sessionId, { text: "hello" });
    const second = await manager.sendMessage(session.sessionId, { text: "steer" });

    expect(first.mode).toBe("turn-start");
    expect(second.mode).toBe("steer");
    expect(fake.turnStartCalls).toBe(1);
    expect(fake.turnSteerCalls).toBe(1);
  });

  it("accepts clientMessageId in the local send schema", () => {
    const parsed = LocalSendMessageSchema.parse({
      text: "hello",
      clientMessageId: "client_123"
    });

    expect(parsed).toEqual({
      text: "hello",
      clientMessageId: "client_123"
    });
  });

  it("echoes clientMessageId on chat.user and steer accepted events", async () => {
    const store = new EventStore();
    const bridge = new ApprovalBridge({ eventStore: store, timeoutMs: 1_000 });
    const fake = new FakeCodexClient();
    const manager = new SessionManager({
      eventStore: store,
      approvalBridge: bridge,
      codexBin: "codex",
      clientFactory: () => fake
    });

    const session = await manager.startSession({
      cwd: process.cwd(),
      permissionMode: "request-approval"
    });

    await manager.startTurn(session.sessionId, {
      text: "first",
      clientMessageId: "msg_turn_start"
    });
    await manager.steerTurn(session.sessionId, "turn_1", {
      text: "second",
      clientMessageId: "msg_steer"
    });

    const chatUserEvents = store
      .all()
      .filter((event) => event.type === LocalEventType.ChatUser);
    const steerAccepted = store
      .all()
      .find((event) => event.type === LocalEventType.TurnSteerAccepted);

    expect(eventPayload(chatUserEvents[0])).toMatchObject({
      text: "first",
      clientMessageId: "msg_turn_start"
    });
    expect(eventPayload(chatUserEvents[1])).toMatchObject({
      text: "second",
      clientMessageId: "msg_steer"
    });
    expect(eventPayload(steerAccepted)).toMatchObject({
      text: "second",
      clientMessageId: "msg_steer"
    });
  });

  it("emits agent.error with clientMessageId when turn/steer fails", async () => {
    const store = new EventStore();
    const bridge = new ApprovalBridge({ eventStore: store, timeoutMs: 1_000 });
    const fake = new FakeCodexClient();
    fake.failNextTurnSteer = new Error("steer failed");
    const manager = new SessionManager({
      eventStore: store,
      approvalBridge: bridge,
      codexBin: "codex",
      clientFactory: () => fake
    });

    const session = await manager.startSession({
      cwd: process.cwd(),
      permissionMode: "request-approval"
    });
    await manager.startTurn(session.sessionId, {
      text: "first",
      clientMessageId: "msg_first"
    });

    await expect(
      manager.steerTurn(session.sessionId, "turn_1", {
        text: "broken",
        clientMessageId: "msg_failed"
      })
    ).rejects.toThrow("steer failed");

    const errorEvent = store
      .all()
      .find((event) => event.type === LocalEventType.AgentError);

    expect(eventPayload(errorEvent)).toMatchObject({
      message: "steer failed",
      clientMessageId: "msg_failed"
    });
  });

  it("maps Codex permission modes to thread/start params", async () => {
    const store = new EventStore();
    const bridge = new ApprovalBridge({ eventStore: store, timeoutMs: 1_000 });
    const fake = new FakeCodexClient();
    const manager = new SessionManager({
      eventStore: store,
      approvalBridge: bridge,
      codexBin: "codex",
      clientFactory: () => fake
    });

    await manager.startSession({
      cwd: process.cwd(),
      permissionMode: "full-access"
    });

    expect(fake.threadStartParams[0]).toMatchObject({
      approvalPolicy: "never",
      approvalsReviewer: "user",
      sandbox: "danger-full-access"
    });
  });

  it("resumes an existing Codex thread by id", async () => {
    const store = new EventStore();
    const bridge = new ApprovalBridge({ eventStore: store, timeoutMs: 1_000 });
    const fake = new FakeCodexClient();
    const manager = new SessionManager({
      eventStore: store,
      approvalBridge: bridge,
      codexBin: "codex",
      clientFactory: () => fake
    });

    const session = await manager.resumeSession({
      threadId: "history_1",
      cwd: process.cwd(),
      permissionMode: "request-approval",
      model: "gpt-5.5",
      reasoningEffort: "high"
    });

    expect(session.threadId).toBe("history_1");
    expect(session.title).toBeNull();
    expect(fake.threadResumeParams[0]).toMatchObject({
      threadId: "history_1",
      cwd: process.cwd(),
      model: "gpt-5.5",
      excludeTurns: true,
      initialTurnsPage: {
        limit: 40,
        sortDirection: "desc",
        itemsView: "summary"
      }
    });
    expect(fake.threadReadParams[0]).toEqual({
      threadId: "history_1",
      includeTurns: true
    });
  });

  it("unarchives a Codex thread before retrying resume", async () => {
    const store = new EventStore();
    const bridge = new ApprovalBridge({ eventStore: store, timeoutMs: 1_000 });
    const fake = new FakeCodexClient();
    fake.failNextResumeAsArchived = true;
    const manager = new SessionManager({
      eventStore: store,
      approvalBridge: bridge,
      codexBin: "codex",
      clientFactory: () => fake
    });

    const session = await manager.resumeSession({
      threadId: "history_1",
      cwd: process.cwd(),
      permissionMode: "request-approval"
    });

    expect(session.threadId).toBe("history_1");
    expect(fake.threadUnarchiveParams).toEqual([{ threadId: "history_1" }]);
    expect(fake.threadResumeParams).toHaveLength(2);
  });

  it("uses native-like titles for resumed and newly started sessions", async () => {
    const store = new EventStore();
    const bridge = new ApprovalBridge({ eventStore: store, timeoutMs: 1_000 });
    const fake = new FakeCodexClient();
    fake.threadReadResponse = {
      thread: {
        id: "history_1",
        sessionId: "session_1",
        preview: "",
        createdAt: 1,
        updatedAt: 1,
        cwd: process.cwd(),
        turns: [
          {
            id: "turn_1",
            items: [],
            params: {
              input: [{ type: "text", text: "继续检查 sidebar title 为什么和原生 Codex 不一致" }]
            }
          }
        ]
      }
    };
    const manager = new SessionManager({
      eventStore: store,
      approvalBridge: bridge,
      codexBin: "codex",
      clientFactory: () => fake
    });

    const resumed = await manager.resumeSession({
      threadId: "history_1",
      cwd: process.cwd(),
      permissionMode: "request-approval"
    });
    const started = await manager.startSession({
      cwd: process.cwd(),
      permissionMode: "request-approval",
      initialMessage: "请按原生 Codex 的标题逻辑修复这个问题"
    });

    expect(resumed.title).toBe("继续检查 sidebar title 为什么和原生 Codex 不一致");
    expect(started.title).toBe("请按原生 Codex 的标题逻辑修复这个问题");
  });
});

describe("local HTTP server guards", () => {
  it("rejects missing and wrong token, accepts correct token, and rejects bad Origin", async () => {
    const handle = createLocalServer({
      host: "127.0.0.1",
      port: 0,
      webOrigin: "http://127.0.0.1:3000",
      token: "secret",
      approvalTimeoutMs: 1_000,
      codexBin: "codex",
      clientFactory: () => new FakeCodexClient()
    });
    const address = await listen(handle, "127.0.0.1", 0);
    const base = `http://${address.address}:${address.port}`;

    const missing = await fetch(`${base}/api/sessions`);
    const wrong = await fetch(`${base}/api/sessions?token=wrong`);
    const good = await fetch(`${base}/api/sessions?token=secret`);
    const badOrigin = await fetch(`${base}/api/sessions?token=secret`, {
      headers: { Origin: "http://evil.local" }
    });

    expect(missing.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(good.status).toBe(200);
    expect(badOrigin.status).toBe(403);

    await handle.close();
  });

  it("lists local directories without returning file contents", async () => {
    const handle = createLocalServer({
      host: "127.0.0.1",
      port: 0,
      webOrigin: "http://127.0.0.1:3000",
      token: "secret",
      approvalTimeoutMs: 1_000,
      codexBin: "codex",
      clientFactory: () => new FakeCodexClient()
    });
    const address = await listen(handle, "127.0.0.1", 0);
    const base = `http://${address.address}:${address.port}`;

    const response = await fetch(
      `${base}/api/directories?token=secret&path=${encodeURIComponent(process.cwd())}`
    );
    const body = await response.json() as { path: string; entries: unknown[] };

    expect(response.status).toBe(200);
    expect(body.path).toBe(process.cwd());
    expect(Array.isArray(body.entries)).toBe(true);

    await handle.close();
  });

  it("lists Codex threads through app-server thread/list", async () => {
    const fake = new FakeCodexClient();
    fake.threadListResponse = {
      data: [
        {
          id: "thread_1",
          sessionId: "session_1",
          preview: "检查这个项目",
          createdAt: 1_786_000_000,
          updatedAt: 1_786_000_060,
          cwd: process.cwd(),
          source: "cli",
          name: "官方 Codex 标题",
          turns: []
        },
        {
          id: "thread_probe",
          sessionId: "session_probe",
          preview: "# Codex Native API Loop Prompt",
          createdAt: 1_786_000_061,
          updatedAt: 1_786_000_062,
          cwd: "/tmp/codex-goal-probe-123",
          source: "cli",
          name: "# Codex Native API Loop Prompt",
          turns: []
        }
      ],
      nextCursor: null,
      backwardsCursor: null
    };
    fake.threadLoadedListResponse = {
      data: [
        {
          id: "thread_1",
          sessionId: "session_1",
          preview: "检查这个项目",
          createdAt: 1_786_000_000,
          updatedAt: 1_786_000_060,
          cwd: process.cwd(),
          status: { type: "idle" },
          source: "cli",
          name: "官方 Codex 标题",
          turns: []
        }
      ]
    };

    const handle = createLocalServer({
      host: "127.0.0.1",
      port: 0,
      webOrigin: "http://127.0.0.1:3000",
      token: "secret",
      approvalTimeoutMs: 1_000,
      codexBin: "codex",
      clientFactory: () => fake
    });
    const address = await listen(handle, "127.0.0.1", 0);
    const base = `http://${address.address}:${address.port}`;

    try {
      const list = await fetch(`${base}/api/codex-history?token=secret`);
      const listBody = await list.json() as {
        entries: Array<{
          cwdExists?: boolean;
          id: string;
          cwd: string;
          title: string;
        }>;
      };
      expect(fake.threadListParams[0]).toMatchObject({
        archived: false,
        sortDirection: "desc",
        sortKey: "updated_at",
        useStateDbOnly: true
      });
      expect(listBody.entries).toEqual([
        expect.objectContaining({
          id: "thread_1",
          cwd: process.cwd(),
          cwdExists: true,
          title: "官方 Codex 标题",
          loaded: true
        })
      ]);
      expect(listBody.entries).toHaveLength(1);

      const loaded = await fetch(`${base}/api/codex-history/loaded?token=secret`);
      const loadedBody = await loaded.json() as { threadIds: string[] };
      expect(loaded.status).toBe(200);
      expect(fake.threadLoadedListCalls).toBe(2);
      expect(loadedBody.threadIds).toEqual(["thread_1"]);
    } finally {
      await handle.close();
    }
  });

  it("reads and resumes Codex threads through app-server thread APIs", async () => {
    const fake = new FakeCodexClient();
    fake.threadReadResponse = {
      thread: {
        id: "thread_1",
        sessionId: "session_1",
        preview: "继续这个项目",
        createdAt: 1_786_000_000,
        updatedAt: 1_786_000_060,
        cwd: process.cwd(),
        source: "cli",
        name: "官方 Codex 标题",
        turns: [
          {
            id: "turn_1",
            startedAt: 1_786_000_010,
            completedAt: 1_786_000_020,
            items: [
              {
                id: "item_user",
                type: "userMessage",
                content: [{ type: "text", text: "继续这个项目" }]
              },
              {
                id: "item_agent",
                type: "agentMessage",
                text: "我会先查看文件结构。"
              }
            ]
          }
        ]
      }
    };
    fake.threadTurnsListResponse = {
      data: [
        {
          id: "turn_1",
          startedAt: 1_786_000_010,
          completedAt: 1_786_000_020,
          items: [
            {
              id: "item_user",
              type: "userMessage",
              content: [{ type: "text", text: "继续这个项目" }]
            },
            {
              id: "item_agent",
              type: "agentMessage",
              text: "我会先查看文件结构。"
            }
          ]
        }
      ],
      nextCursor: "cursor_older",
      backwardsCursor: null
    };
    const handle = createLocalServer({
      host: "127.0.0.1",
      port: 0,
      webOrigin: "http://127.0.0.1:3000",
      token: "secret",
      approvalTimeoutMs: 1_000,
      codexBin: "codex",
      clientFactory: () => fake
    });
    const address = await listen(handle, "127.0.0.1", 0);
    const base = `http://${address.address}:${address.port}`;

    try {
      const detailQuery = new URLSearchParams({
        token: "secret",
        id: "thread_1"
      });
      const detail = await fetch(
        `${base}/api/codex-history/detail?${detailQuery.toString()}`
      );
      const detailBody = await detail.json() as {
        messages: Array<{ role: string; text: string }>;
      };
      expect(detail.status).toBe(200);
      expect(fake.threadReadParams[0]).toEqual({
        threadId: "thread_1",
        includeTurns: true
      });
      expect(detailBody.messages).toMatchObject([
        { role: "user", text: "继续这个项目" },
        { role: "assistant", text: "我会先查看文件结构。" }
      ]);

      const turns = await fetch(
        `${base}/api/codex-history/turns?token=secret&id=thread_1&limit=20&sortDirection=desc&itemsView=summary`
      );
      const turnsBody = await turns.json() as {
        messages: Array<{ role: string; text: string }>;
        nextCursor: string | null;
      };
      expect(turns.status).toBe(200);
      expect(fake.threadTurnsListParams[0]).toEqual({
        threadId: "thread_1",
        cursor: null,
        limit: 20,
        sortDirection: "desc",
        itemsView: "summary"
      });
      expect(turnsBody.messages).toMatchObject([
        { role: "user", text: "继续这个项目" },
        { role: "assistant", text: "我会先查看文件结构。" }
      ]);
      expect(turnsBody.nextCursor).toBe("cursor_older");

      const response = await fetch(`${base}/api/codex-history/resume?token=secret`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "thread_1",
          permissionMode: "request-approval"
        })
      });
      const body = await response.json() as {
        session: { threadId: string };
        history: { messages: Array<{ text: string }> };
      };

      expect(response.status).toBe(201);
      expect(body.session.threadId).toBe("thread_1");
      expect(body.history.messages[0]?.text).toBe("继续这个项目");
      expect(body.history.nextCursor).toBe("cursor_older");
      expect(fake.threadResumeParams[0]).toMatchObject({
        threadId: "thread_1",
        cwd: process.cwd(),
        excludeTurns: true,
        initialTurnsPage: {
          limit: 40,
          sortDirection: "desc",
          itemsView: "summary"
        }
      });
    } finally {
      await handle.close();
    }
  });
});

describe("goal-smoke hardening", () => {
  it("returns non-zero for non-completed final turn status", () => {
    expect(goalSmokeExitCode("completed")).toBe(0);
    expect(goalSmokeExitCode("failed")).toBe(1);
    expect(goalSmokeExitCode("interrupted")).toBe(1);
    expect(goalSmokeExitCode(undefined)).toBe(1);
  });
});

class FakeCodexClient extends EventEmitter implements ManagedCodexClient {
  public turnStartCalls = 0;
  public turnSteerCalls = 0;
  public lastTurnStartInput: LocalSendMessageInput | null = null;
  public threadStartParams: unknown[] = [];
  public threadResumeParams: unknown[] = [];
  public threadArchiveParams: unknown[] = [];
  public threadUnarchiveParams: unknown[] = [];
  public threadListParams: unknown[] = [];
  public threadLoadedListCalls = 0;
  public threadReadParams: unknown[] = [];
  public threadTurnsListParams: unknown[] = [];
  public failNextResumeAsArchived = false;
  public failNextTurnStart: Error | null = null;
  public failNextTurnSteer: Error | null = null;
  public threadListResponse: Awaited<ReturnType<ManagedCodexClient["threadList"]>> = {
    data: [],
    nextCursor: null,
    backwardsCursor: null
  };
  public threadReadResponse: Awaited<ReturnType<ManagedCodexClient["threadRead"]>> = {
    thread: {
      id: "thread_1",
      sessionId: "session_1",
      preview: "",
      createdAt: 1,
      updatedAt: 1,
      cwd: process.cwd(),
      turns: []
    }
  };
  public threadTurnsListResponse: Awaited<ReturnType<ManagedCodexClient["threadTurnsList"]>> = {
    data: [],
    nextCursor: null,
    backwardsCursor: null
  };
  public threadLoadedListResponse: Awaited<ReturnType<ManagedCodexClient["threadLoadedList"]>> = {
    data: []
  };

  public initialize = async () => ({
    userAgent: "fake",
    codexHome: "/tmp",
    platformFamily: "unix",
    platformOs: "macos"
  });

  public initialized = async () => undefined;

  public threadStart = async (
    params?: Parameters<ManagedCodexClient["threadStart"]>[0]
  ) => {
    this.threadStartParams.push(params);
    return {
      thread: { id: "thread_1" }
    };
  };

  public threadResume = async (
    params: Parameters<ManagedCodexClient["threadResume"]>[0]
  ) => {
    this.threadResumeParams.push(params);
    if (this.failNextResumeAsArchived) {
      this.failNextResumeAsArchived = false;
      throw new Error(
        `session ${params.threadId} is archived. Run \`codex unarchive ${params.threadId}\` to unarchive it first.`
      );
    }
    return {
      thread: { id: params.threadId },
      model: params.model ?? "gpt-5.5",
      modelProvider: "openai",
      cwd: params.cwd ?? process.cwd(),
      initialTurnsPage:
        params.initialTurnsPage == null ? null : this.threadTurnsListResponse
    };
  };

  public threadUnarchive = async (
    params: Parameters<ManagedCodexClient["threadUnarchive"]>[0]
  ) => {
    this.threadUnarchiveParams.push(params);
    return {};
  };

  public threadArchive = async (
    params: Parameters<ManagedCodexClient["threadArchive"]>[0]
  ) => {
    this.threadArchiveParams.push(params);
    return {};
  };

  public threadList = async (
    params: Parameters<ManagedCodexClient["threadList"]>[0]
  ) => {
    this.threadListParams.push(params);
    return this.threadListResponse;
  };

  public threadLoadedList = async () => {
    this.threadLoadedListCalls += 1;
    return this.threadLoadedListResponse;
  };

  public threadRead = async (
    params: Parameters<ManagedCodexClient["threadRead"]>[0]
  ) => {
    this.threadReadParams.push(params);
    return this.threadReadResponse;
  };

  public threadTurnsList = async (
    params: Parameters<ManagedCodexClient["threadTurnsList"]>[0]
  ) => {
    this.threadTurnsListParams.push(params);
    return this.threadTurnsListResponse;
  };

  public setGoal = async () => ({
    goal: {
      threadId: "thread_1",
      objective: "goal",
      status: "active" as const,
      tokenBudget: null,
      tokensUsed: 0,
      timeUsedSeconds: 0,
      createdAt: 1,
      updatedAt: 1
    }
  });

  public getGoal = async () => ({ goal: null });

  public clearGoal = async () => ({ goal: null });

  public turnStart = async () => {
    this.turnStartCalls += 1;
    if (this.failNextTurnStart) {
      const error = this.failNextTurnStart;
      this.failNextTurnStart = null;
      throw error;
    }
    return { turn: { id: "turn_1", status: "inProgress" as const } };
  };

  public turnSteer = async () => {
    this.turnSteerCalls += 1;
    if (this.failNextTurnSteer) {
      const error = this.failNextTurnSteer;
      this.failNextTurnSteer = null;
      throw error;
    }
    return {};
  };

  public turnInterrupt = async () => ({});

  public onNotification = (
    listener: (notification: AppServerNotification) => void
  ) => {
    this.on("notification", listener);
    return () => this.off("notification", listener);
  };

  public close = async () => undefined;
}

function mockRequest(headers: Record<string, string> = {}) {
  return { headers } as unknown as Parameters<typeof isAuthorized>[1];
}

function eventPayload(event: LocalEvent | undefined): Record<string, unknown> {
  expect(event?.payload).toBeTruthy();
  return event?.payload as Record<string, unknown>;
}
