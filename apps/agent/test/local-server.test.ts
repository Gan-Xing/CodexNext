import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type {
  AppServerNotification,
  ApprovalResponse,
  JsonRpcRequest,
  LocalApprovalDecision
} from "@codexnext/protocol";
import {
  CodexServerRequestMethod,
  LocalEventType
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
  public threadStartParams: unknown[] = [];

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
    return { turn: { id: "turn_1", status: "inProgress" as const } };
  };

  public turnSteer = async () => {
    this.turnSteerCalls += 1;
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
