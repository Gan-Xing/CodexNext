import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import {
  CodexClientMethod,
  CodexNotificationMethod,
  CodexServerRequestMethod,
  makeTextInput,
  type JsonRpcOutboundMessage
} from "@codexnext/protocol";
import { CodexAppServerClient } from "../src/codex-app-server-client.js";
import { JsonRpcClient, type JsonRpcTransport } from "../src/json-rpc.js";

class FakeTransport extends EventEmitter implements JsonRpcTransport {
  public readonly sent: JsonRpcOutboundMessage[] = [];

  public send(message: JsonRpcOutboundMessage): void {
    this.sent.push(message);
  }

  public close(): Promise<void> {
    this.emit("close");
    return Promise.resolve();
  }

  public emitServerRequest(
    id: number,
    method: string,
    params: unknown = {}
  ): void {
    this.emit("message", { id, method, params });
  }

  public emitResponse(id: number, result: unknown): void {
    this.emit("message", { id, result });
  }

  public emitNotification(method: string, params?: unknown): void {
    this.emit(
      "message",
      params === undefined ? { method } : { method, params }
    );
  }
}

function createClient(options: ConstructorParameters<typeof CodexAppServerClient>[1] = {}) {
  const transport = new FakeTransport();
  const rpc = new JsonRpcClient(transport);
  const client = new CodexAppServerClient(rpc, options);
  return { client, transport };
}

async function flushServerRequest(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

describe("CodexAppServerClient approval handling", () => {
  it("declines modern command and file approval requests by default", async () => {
    const { client, transport } = createClient();

    transport.emitServerRequest(
      1,
      CodexServerRequestMethod.CommandExecutionRequestApproval,
      { command: "pnpm test" }
    );
    transport.emitServerRequest(
      2,
      CodexServerRequestMethod.FileChangeRequestApproval,
      { path: "src/index.ts" }
    );
    await flushServerRequest();

    expect(transport.sent).toEqual([
      { id: 1, result: { decision: "decline" } },
      { id: 2, result: { decision: "decline" } }
    ]);
    await client.close();
  });

  it("denies legacy approval requests by default", async () => {
    const { client, transport } = createClient();

    transport.emitServerRequest(
      3,
      CodexServerRequestMethod.LegacyExecCommandApproval,
      { command: "pnpm test" }
    );
    transport.emitServerRequest(
      4,
      CodexServerRequestMethod.LegacyApplyPatchApproval,
      { patch: "*** Begin Patch" }
    );
    await flushServerRequest();

    expect(transport.sent).toEqual([
      { id: 3, result: { decision: "denied" } },
      { id: 4, result: { decision: "denied" } }
    ]);
    await client.close();
  });

  it("uses the approval callback result when provided", async () => {
    const { client, transport } = createClient({
      onApprovalRequest: (request) => ({
        decision:
          request.method === CodexServerRequestMethod.LegacyExecCommandApproval
            ? "approved"
            : "accept"
      })
    });

    transport.emitServerRequest(
      5,
      CodexServerRequestMethod.CommandExecutionRequestApproval,
      { command: "pnpm test" }
    );
    transport.emitServerRequest(
      6,
      CodexServerRequestMethod.LegacyExecCommandApproval,
      { command: "pnpm test" }
    );
    await flushServerRequest();

    expect(transport.sent).toEqual([
      { id: 5, result: { decision: "accept" } },
      { id: 6, result: { decision: "approved" } }
    ]);
    await client.close();
  });

  it("passes validated approval request params to callbacks", async () => {
    const requests: unknown[] = [];
    const { client, transport } = createClient({
      onApprovalRequest: (request) => {
        requests.push(request.params);
        return { decision: "accept" };
      }
    });

    transport.emitServerRequest(
      11,
      CodexServerRequestMethod.CommandExecutionRequestApproval,
      {
        requestId: "approval_1",
        threadId: "thread_1",
        turnId: "turn_1",
        command: ["pnpm", "test"],
        appServerSpecificField: true
      }
    );
    await flushServerRequest();

    expect(requests).toEqual([
      {
        requestId: "approval_1",
        threadId: "thread_1",
        turnId: "turn_1",
        command: ["pnpm", "test"],
        appServerSpecificField: true
      }
    ]);
    expect(transport.sent).toEqual([
      { id: 11, result: { decision: "accept" } }
    ]);
    await client.close();
  });

  it("fails closed and skips callbacks for malformed approval params", async () => {
    let callbackCalls = 0;
    const { client, transport } = createClient({
      onApprovalRequest: () => {
        callbackCalls += 1;
        return { decision: "accept" };
      }
    });

    transport.emitServerRequest(
      12,
      CodexServerRequestMethod.CommandExecutionRequestApproval,
      { threadId: "" }
    );
    transport.emitServerRequest(
      13,
      CodexServerRequestMethod.LegacyApplyPatchApproval,
      "not-an-object"
    );
    await flushServerRequest();

    expect(callbackCalls).toBe(0);
    expect(transport.sent).toEqual([
      { id: 12, result: { decision: "decline" } },
      { id: 13, result: { decision: "denied" } }
    ]);
    await client.close();
  });

  it("falls back to safe defaults for malformed approval callback results", async () => {
    const { client, transport } = createClient({
      onApprovalRequest: (request) => {
        if (request.method === CodexServerRequestMethod.LegacyExecCommandApproval) {
          return { decision: "accept" } as never;
        }
        return { decision: "approved" } as never;
      }
    });

    transport.emitServerRequest(
      7,
      CodexServerRequestMethod.CommandExecutionRequestApproval,
      { command: "pnpm test" }
    );
    transport.emitServerRequest(
      8,
      CodexServerRequestMethod.LegacyExecCommandApproval,
      { command: "pnpm test" }
    );
    await flushServerRequest();

    expect(transport.sent).toEqual([
      { id: 7, result: { decision: "decline" } },
      { id: 8, result: { decision: "denied" } }
    ]);
    await client.close();
  });

  it("falls back to safe defaults when approval callbacks throw", async () => {
    const { client, transport } = createClient({
      onApprovalRequest: async () => {
        throw new Error("approval callback failed");
      }
    });

    transport.emitServerRequest(
      9,
      CodexServerRequestMethod.FileChangeRequestApproval,
      { path: "src/index.ts" }
    );
    transport.emitServerRequest(
      10,
      CodexServerRequestMethod.LegacyApplyPatchApproval,
      { patch: "*** Begin Patch" }
    );
    await flushServerRequest();

    expect(transport.sent).toEqual([
      { id: 9, result: { decision: "decline" } },
      { id: 10, result: { decision: "denied" } }
    ]);
    await client.close();
  });
});

describe("CodexAppServerClient notification validation", () => {
  it("delivers parsed known notifications and skips malformed known notifications", async () => {
    const { client, transport } = createClient();
    const notifications: unknown[] = [];

    const unsubscribe = client.onNotification((notification) => {
      notifications.push(notification);
    });

    transport.emitNotification(CodexNotificationMethod.AgentMessageDelta, {
      threadId: "thread_1",
      turnId: "turn_1",
      delta: "hello",
      extra: true
    });
    transport.emitNotification(CodexNotificationMethod.AgentMessageDelta, {
      delta: 123
    });
    transport.emitNotification("vendor/custom", {
      delta: 123,
      anyShape: true
    });
    await flushServerRequest();

    expect(notifications).toEqual([
      {
        method: CodexNotificationMethod.AgentMessageDelta,
        params: {
          threadId: "thread_1",
          turnId: "turn_1",
          delta: "hello",
          extra: true
        }
      },
      {
        method: "vendor/custom",
        params: {
          delta: 123,
          anyShape: true
        }
      }
    ]);

    unsubscribe();
    await client.close();
  });

  it("validates method-specific notification listeners", async () => {
    const { client, transport } = createClient();
    const calls: Array<{ params: unknown; method: string }> = [];

    client.onNotificationMethod(
      CodexNotificationMethod.TurnCompleted,
      (params, notification) => {
        calls.push({ params, method: notification.method });
      }
    );

    transport.emitNotification(CodexNotificationMethod.TurnCompleted, {
      threadId: "thread_1",
      turn: { id: "turn_1", status: "completed" }
    });
    transport.emitNotification(CodexNotificationMethod.TurnCompleted, {
      turn: { id: "" }
    });
    await flushServerRequest();

    expect(calls).toEqual([
      {
        method: CodexNotificationMethod.TurnCompleted,
        params: {
          threadId: "thread_1",
          turn: { id: "turn_1", status: "completed" }
        }
      }
    ]);

    await client.close();
  });

  it("keeps unknown method-specific notifications passthrough", async () => {
    const { client, transport } = createClient();
    const paramsSeen: unknown[] = [];

    client.onNotificationMethod("vendor/custom", (params) => {
      paramsSeen.push(params);
    });

    transport.emitNotification("vendor/custom", {
      delta: 123,
      nested: { ok: true }
    });
    await flushServerRequest();

    expect(paramsSeen).toEqual([
      {
        delta: 123,
        nested: { ok: true }
      }
    ]);

    await client.close();
  });
});

describe("CodexAppServerClient app-server request validation", () => {
  it("validates outbound params before sending JSON-RPC requests", async () => {
    const { client, transport } = createClient();

    await expect(client.threadRead({ threadId: "" })).rejects.toThrow(
      "Invalid app-server request params: thread/read"
    );
    await expect(client.threadList({ limit: 0 })).rejects.toThrow(
      "Invalid app-server request params: thread/list"
    );
    await expect(
      client.turnStart({ threadId: "thread_1", input: [] })
    ).rejects.toThrow("Invalid app-server request params: turn/start");

    expect(transport.sent).toEqual([]);
    await client.close();
  });

  it("sends valid parsed params unchanged", async () => {
    const { client, transport } = createClient();

    const pending = client.turnStart({
      threadId: "thread_1",
      input: [makeTextInput("continue")]
    });

    expect(transport.sent).toEqual([
      {
        id: 0,
        method: CodexClientMethod.TurnStart,
        params: {
          threadId: "thread_1",
          input: [makeTextInput("continue")]
        }
      }
    ]);

    transport.emitResponse(0, { turn: { id: "turn_1" } });
    await expect(pending).resolves.toEqual({ turn: { id: "turn_1" } });
    await client.close();
  });
});

describe("CodexAppServerClient app-server response validation", () => {
  it("validates lower-level thread responses before returning them", async () => {
    const { client, transport } = createClient();
    const turn = codexTurn();
    const thread = codexThread();

    const start = client.threadStart({ cwd: "/repo" });
    transport.emitResponse(0, { thread: { id: "thread_1", cwd: "/repo" } });
    await expect(start).resolves.toMatchObject({ thread: { id: "thread_1" } });

    const resume = client.threadResume({ threadId: "thread_1" });
    transport.emitResponse(1, {
      thread: { id: "thread_1", cwd: "/repo" },
      initialTurnsPage: {
        data: [turn],
        nextCursor: null,
        backwardsCursor: null
      }
    });
    await expect(resume).resolves.toMatchObject({ thread: { id: "thread_1" } });

    const archive = client.threadArchive({ threadId: "thread_1" });
    transport.emitResponse(2, {});
    await expect(archive).resolves.toEqual({});

    const unarchive = client.threadUnarchive({ threadId: "thread_1" });
    transport.emitResponse(3, {});
    await expect(unarchive).resolves.toEqual({});

    const list = client.threadList({ limit: 1 });
    transport.emitResponse(4, {
      data: [thread],
      nextCursor: null,
      backwardsCursor: null
    });
    await expect(list).resolves.toMatchObject({ data: [{ id: "thread_1" }] });

    const loaded = client.threadLoadedList();
    transport.emitResponse(5, { data: [thread] });
    await expect(loaded).resolves.toMatchObject({ data: [{ id: "thread_1" }] });

    const read = client.threadRead({ threadId: "thread_1" });
    transport.emitResponse(6, { thread });
    await expect(read).resolves.toMatchObject({ thread: { id: "thread_1" } });

    const turns = client.threadTurnsList({ threadId: "thread_1" });
    transport.emitResponse(7, {
      data: [turn],
      nextCursor: null,
      backwardsCursor: null
    });
    await expect(turns).resolves.toMatchObject({ data: [{ id: "turn_1" }] });

    const setGoal = client.setGoal({
      threadId: "thread_1",
      objective: "ship it"
    });
    transport.emitResponse(8, { goal: threadGoal() });
    await expect(setGoal).resolves.toMatchObject({
      goal: { threadId: "thread_1" }
    });

    const getGoal = client.getGoal({ threadId: "thread_1" });
    transport.emitResponse(9, { goal: null });
    await expect(getGoal).resolves.toEqual({ goal: null });

    const clearGoal = client.clearGoal({ threadId: "thread_1" });
    transport.emitResponse(10, {});
    await expect(clearGoal).resolves.toEqual({});

    const startTurn = client.turnStart({
      threadId: "thread_1",
      input: [makeTextInput("continue")]
    });
    transport.emitResponse(11, {
      turn: { id: "turn_2", status: "inProgress" }
    });
    await expect(startTurn).resolves.toMatchObject({
      turn: { id: "turn_2" }
    });

    await client.close();
  });

  it("rejects malformed lower-level thread responses", async () => {
    const { client, transport } = createClient();

    const list = client.threadList();
    transport.emitResponse(0, {
      data: [{ ...codexThread(), id: "" }],
      nextCursor: null,
      backwardsCursor: null
    });

    await expect(list).rejects.toThrow("Invalid app-server response: thread/list");
    await client.close();
  });

  it("rejects malformed goal and turn-start responses", async () => {
    const { client, transport } = createClient();

    const setGoal = client.setGoal({
      threadId: "thread_1",
      objective: "ship it"
    });
    transport.emitResponse(0, {
      goal: { ...threadGoal(), threadId: "" }
    });
    await expect(setGoal).rejects.toThrow(
      "Invalid app-server response: thread/goal/set"
    );

    const turnStart = client.turnStart({
      threadId: "thread_1",
      input: [makeTextInput("continue")]
    });
    transport.emitResponse(1, { turn: { id: "" } });
    await expect(turnStart).rejects.toThrow(
      "Invalid app-server response: turn/start"
    );

    await client.close();
  });
});

function codexThread() {
  return {
    id: "thread_1",
    sessionId: "session_1",
    preview: "Implement feature",
    createdAt: 1,
    updatedAt: 2,
    status: { type: "loaded" },
    cwd: "/repo",
    cliVersion: "0.1.0",
    source: { kind: "cli" },
    title: "Implement feature",
    turns: [codexTurn()]
  };
}

function codexTurn() {
  return {
    id: "turn_1",
    items: [
      {
        id: "item_1",
        type: "assistant_message",
        text: "done"
      }
    ],
    startedAt: 1,
    completedAt: 2
  };
}

function threadGoal() {
  return {
    threadId: "thread_1",
    objective: "ship it",
    status: "active",
    tokenBudget: null,
    tokensUsed: 10,
    timeUsedSeconds: 2,
    createdAt: 1,
    updatedAt: 2
  };
}
