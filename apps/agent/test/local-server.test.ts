import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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
    expect(fake.threadResumeParams[0]).toMatchObject({
      threadId: "history_1",
      cwd: process.cwd(),
      model: "gpt-5.5"
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

  it("returns Codex history details from the local sessions store", async () => {
    const originalHome = process.env.HOME;
    const tempHome = await mkdtemp(path.join(os.tmpdir(), "codexnext-home-"));
    process.env.HOME = tempHome;
    const sessionDir = path.join(tempHome, ".codex", "sessions", "2026", "06", "06");
    await mkdir(sessionDir, { recursive: true });
    const sessionFile = path.join(
      sessionDir,
      "rollout-2026-06-06T00-00-00-history_1.jsonl"
    );
    await writeFile(
      sessionFile,
      [
        JSON.stringify({
          timestamp: "2026-06-06T00:00:00.000Z",
          type: "session_meta",
          payload: {
            id: "history_1",
            cwd: "/tmp/project",
            timestamp: "2026-06-06T00:00:00.000Z",
            originator: "Codex Desktop"
          }
        }),
        JSON.stringify({
          timestamp: "2026-06-06T00:00:00.500Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: [
              "# AGENTS.md instructions for /tmp/project",
              "",
              "<INSTRUCTIONS>",
              "# CodexBridge Global Instructions",
              "These are injected instructions and should not become a title.",
              "</INSTRUCTIONS>",
              "",
              "<environment_context>",
              "<cwd>/tmp/project</cwd>",
              "</environment_context>"
            ].join("\n")
          }
        }),
        JSON.stringify({
          timestamp: "2026-06-06T00:00:01.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: [
              "检查这个项目",
              "",
              "Based on this message, call functions.happy__change_title to change chat session title that would represent the current task."
            ].join("\n")
          }
        }),
        JSON.stringify({
          timestamp: "2026-06-06T00:00:02.000Z",
          type: "event_msg",
          payload: { type: "agent_message", message: "我会先查看文件结构。" }
        })
      ].join("\n")
    );
    await writeFile(
      path.join(sessionDir, "rollout-2026-06-06T01-00-00-probe_1.jsonl"),
      [
        JSON.stringify({
          timestamp: "2026-06-06T01:00:00.000Z",
          type: "session_meta",
          payload: {
            id: "probe_1",
            cwd: "/tmp/codex-goal-probe-hidden",
            timestamp: "2026-06-06T01:00:00.000Z",
            originator: "Codex Desktop"
          }
        }),
        JSON.stringify({
          timestamp: "2026-06-06T01:00:01.000Z",
          type: "event_msg",
          payload: { type: "user_message", message: "Goal A" }
        })
      ].join("\n")
    );
    await writeFile(
      path.join(sessionDir, "rollout-2026-06-06T02-00-00-empty_1.jsonl"),
      [
        JSON.stringify({
          timestamp: "2026-06-06T02:00:00.000Z",
          type: "session_meta",
          payload: {
            id: "empty_1",
            cwd: "/tmp/CodexBridge",
            timestamp: "2026-06-06T02:00:00.000Z",
            originator: "codexbridge"
          }
        }),
        JSON.stringify({
          timestamp: "2026-06-06T02:00:01.000Z",
          type: "event_msg",
          payload: { type: "task_complete" }
        })
      ].join("\n")
    );
    await writeFile(
      path.join(sessionDir, "rollout-2026-06-06T03-00-00-mission_1.jsonl"),
      [
        JSON.stringify({
          timestamp: "2026-06-06T03:00:00.000Z",
          type: "session_meta",
          payload: {
            id: "mission_1",
            cwd: "/tmp/CodexBridge",
            timestamp: "2026-06-06T03:00:00.000Z",
            originator: "codexbridge"
          }
        }),
        JSON.stringify({
          timestamp: "2026-06-06T03:00:01.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: [
              "你正在执行 CodexBridge 后台 Agent 任务。",
              "Mission ID: 123",
              "Mission title: 实现稳定的 package API",
              "Workspace: /tmp/CodexBridge"
            ].join("\n")
          }
        })
      ].join("\n")
    );
    await writeFile(
      path.join(sessionDir, "rollout-2026-06-06T04-00-00-loop_1.jsonl"),
      [
        JSON.stringify({
          timestamp: "2026-06-06T04:00:00.000Z",
          type: "session_meta",
          payload: {
            id: "loop_1",
            cwd: "/tmp/CodexBridge",
            timestamp: "2026-06-06T04:00:00.000Z",
            originator: "codex_exec"
          }
        }),
        JSON.stringify({
          timestamp: "2026-06-06T04:00:01.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "# Codex Native API Loop Prompt\n请继续推进自动化循环。"
          }
        })
      ].join("\n")
    );

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

    try {
      const list = await fetch(`${base}/api/codex-history?token=secret`);
      const listBody = await list.json() as {
        entries: Array<{
          cwdExists?: boolean;
          filePath: string;
          id: string;
          cwd: string;
          title: string;
        }>;
      };
      expect(listBody.entries.find((entry) => entry.id === "history_1")).toMatchObject({
        id: "history_1",
        cwd: "/tmp/project",
        cwdExists: false,
        title: "检查这个项目",
        filePath: sessionFile
      });
      expect(listBody.entries).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ id: "probe_1" })])
      );
      expect(listBody.entries).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ id: "empty_1" })])
      );
      expect(listBody.entries).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ id: "loop_1" })])
      );
      expect(listBody.entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "mission_1",
            title: "实现稳定的 package API"
          })
        ])
      );

      const detailQuery = new URLSearchParams({
        token: "secret",
        id: "history_1",
        cwd: "/tmp/project",
        filePath: sessionFile
      });
      const detail = await fetch(
        `${base}/api/codex-history/detail?${detailQuery.toString()}`
      );
      const detailBody = await detail.json() as {
        messages: Array<{ role: string; text: string }>;
      };
      expect(detail.status).toBe(200);
      expect(detailBody.messages).toMatchObject([
        { role: "user", text: "检查这个项目" },
        { role: "assistant", text: "我会先查看文件结构。" }
      ]);

      const outsideFile = path.join(tempHome, "outside.jsonl");
      await writeFile(outsideFile, "");
      const outsideQuery = new URLSearchParams({
        token: "secret",
        id: "history_1",
        cwd: "/tmp/project",
        filePath: outsideFile
      });
      const outside = await fetch(
        `${base}/api/codex-history/detail?${outsideQuery.toString()}`
      );
      const outsideBody = await outside.json() as { error?: string };
      expect(outside.status).toBe(400);
      expect(outsideBody.error).toContain("outside the sessions store");
    } finally {
      await handle.close();
      if (originalHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = originalHome;
      }
      await rm(tempHome, { recursive: true, force: true });
    }
  });

  it("resumes Codex history records through the local HTTP API", async () => {
    const originalHome = process.env.HOME;
    const tempHome = await mkdtemp(path.join(os.tmpdir(), "codexnext-home-"));
    const projectDir = path.join(tempHome, "project");
    process.env.HOME = tempHome;
    await mkdir(projectDir, { recursive: true });
    const sessionDir = path.join(tempHome, ".codex", "sessions", "2026", "06", "06");
    await mkdir(sessionDir, { recursive: true });
    const sessionFile = path.join(
      sessionDir,
      "rollout-2026-06-06T00-00-00-history_1.jsonl"
    );
    await writeFile(
      sessionFile,
      [
        JSON.stringify({
          timestamp: "2026-06-06T00:00:00.000Z",
          type: "session_meta",
          payload: {
            id: "history_1",
            cwd: projectDir,
            timestamp: "2026-06-06T00:00:00.000Z",
            originator: "Codex Desktop"
          }
        }),
        JSON.stringify({
          timestamp: "2026-06-06T00:00:01.000Z",
          type: "event_msg",
          payload: { type: "user_message", message: "继续这个项目" }
        })
      ].join("\n")
    );

    const fake = new FakeCodexClient();
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
      const response = await fetch(`${base}/api/codex-history/resume?token=secret`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "history_1",
          cwd: projectDir,
          filePath: sessionFile,
          permissionMode: "request-approval"
        })
      });
      const body = await response.json() as {
        session: { threadId: string };
        history: { messages: Array<{ text: string }> };
      };

      expect(response.status).toBe(201);
      expect(body.session.threadId).toBe("history_1");
      expect(body.history.messages[0]?.text).toBe("继续这个项目");
      expect(fake.threadResumeParams[0]).toMatchObject({
        threadId: "history_1",
        cwd: projectDir
      });
    } finally {
      await handle.close();
      if (originalHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = originalHome;
      }
      await rm(tempHome, { recursive: true, force: true });
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
  public threadStartParams: unknown[] = [];
  public threadResumeParams: unknown[] = [];
  public threadUnarchiveParams: unknown[] = [];
  public failNextResumeAsArchived = false;

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
      cwd: params.cwd ?? process.cwd()
    };
  };

  public threadUnarchive = async (
    params: Parameters<ManagedCodexClient["threadUnarchive"]>[0]
  ) => {
    this.threadUnarchiveParams.push(params);
    return {};
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
