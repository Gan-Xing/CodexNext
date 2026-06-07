import { stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  CodexAppServerClient,
  type ApprovalRequest
} from "@codexnext/codex-client";
import type {
  AppServerNotification,
  ApprovalResponse,
  AskForApproval,
  ApprovalsReviewer,
  LocalSendMessageInput,
  LocalPermissionMode,
  LocalResumeSessionInput,
  LocalReasoningEffort,
  LocalSessionSummary,
  LocalSessionStatus,
  LocalSetGoalInput,
  LocalStartSessionInput,
  SandboxMode,
  ThreadGoal,
  ThreadGoalSetResponse,
  ThreadListParams,
  ThreadListResponse,
  ThreadReadParams,
  ThreadReadResponse,
  ThreadResumeResponse,
  ThreadStartResponse,
  TurnStartResponse
} from "@codexnext/protocol";
import {
  CodexNotificationMethod,
  LocalEventType,
  makeTextInput,
  isRecord
} from "@codexnext/protocol";
import type { ApprovalBridge } from "./approval-bridge.js";
import type { EventStore } from "./event-store.js";

export interface ManagedCodexClient {
  initialize: CodexAppServerClient["initialize"];
  initialized: CodexAppServerClient["initialized"];
  threadStart: CodexAppServerClient["threadStart"];
  threadResume: CodexAppServerClient["threadResume"];
  threadUnarchive: CodexAppServerClient["threadUnarchive"];
  threadList: CodexAppServerClient["threadList"];
  threadRead: CodexAppServerClient["threadRead"];
  setGoal: CodexAppServerClient["setGoal"];
  getGoal: CodexAppServerClient["getGoal"];
  clearGoal: CodexAppServerClient["clearGoal"];
  turnStart: CodexAppServerClient["turnStart"];
  turnSteer: CodexAppServerClient["turnSteer"];
  turnInterrupt: CodexAppServerClient["turnInterrupt"];
  onNotification: CodexAppServerClient["onNotification"];
  close: CodexAppServerClient["close"];
}

export type CodexClientFactory = (input: {
  cwd: string;
  codexBin: string;
  reasoningEffort?: LocalReasoningEffort | null;
  onApprovalRequest: (request: ApprovalRequest) => Promise<ApprovalResponse>;
}) => ManagedCodexClient;

export interface SessionManagerOptions {
  eventStore: EventStore;
  approvalBridge: ApprovalBridge;
  codexBin: string;
  defaultTimeoutMs?: number;
  clientFactory?: CodexClientFactory | undefined;
}

interface LocalSession {
  sessionId: string;
  threadId: string;
  currentTurnId?: string | undefined;
  activeTurnId?: string | undefined;
  status: LocalSessionStatus;
  cwd: string;
  model?: string | null;
  reasoningEffort?: LocalReasoningEffort | null;
  permissionMode: LocalPermissionMode;
  approvalPolicy: AskForApproval | null;
  approvalsReviewer: ApprovalsReviewer | null;
  sandbox: SandboxMode | null;
  goal?: ThreadGoal | null;
  createdAt: number;
  updatedAt: number;
  client: ManagedCodexClient;
  removeNotificationListener: () => void;
}

type PermissionInput = Pick<
  LocalStartSessionInput,
  | "approvalPolicy"
  | "approvalsReviewer"
  | "permissionMode"
  | "sandbox"
>;

type ResumeSessionInput = Omit<LocalResumeSessionInput, "id" | "cwd"> & {
  threadId: string;
  cwd: string;
};

export class SessionManager {
  private readonly sessions = new Map<string, LocalSession>();
  private readonly clientFactory: CodexClientFactory;

  public constructor(private readonly options: SessionManagerOptions) {
    this.clientFactory =
      options.clientFactory ??
      ((input) =>
        CodexAppServerClient.connectStdio(
          {
            command: input.codexBin,
            args: appServerArgs(input.reasoningEffort),
            cwd: input.cwd,
            stderr: process.env.LOG_LEVEL === "debug" ? "emit" : "ignore"
          },
          {
            defaultTimeoutMs: options.defaultTimeoutMs ?? 60_000,
            onApprovalRequest: input.onApprovalRequest
          }
        ));
  }

  public summaries(): LocalSessionSummary[] {
    return [...this.sessions.values()].map(toSummary);
  }

  public get(sessionId: string): LocalSessionSummary {
    return toSummary(this.requireSession(sessionId));
  }

  public async listThreads(
    params: ThreadListParams
  ): Promise<ThreadListResponse> {
    return this.withTemporaryClient((client) => client.threadList(params));
  }

  public async readThread(
    params: ThreadReadParams
  ): Promise<ThreadReadResponse> {
    return this.withTemporaryClient((client) => client.threadRead(params));
  }

  public async startSession(
    input: LocalStartSessionInput
  ): Promise<LocalSessionSummary> {
    const cwd = path.resolve(input.cwd);
    await assertDirectory(cwd);
    const permissions = resolvePermissions(input);

    const sessionId = randomUUID();
    const now = Date.now();
    let session: LocalSession | undefined;

    const client = this.clientFactory({
      cwd,
      codexBin: this.options.codexBin,
      reasoningEffort: input.reasoningEffort ?? null,
      onApprovalRequest: (request) =>
        this.options.approvalBridge.requestApproval({
          sessionId,
          method: request.method,
          params: request.params
        })
    });

    const removeNotificationListener = client.onNotification((notification) => {
      if (!session) {
        return;
      }
      this.handleNotification(session, notification);
    });

    try {
      await client.initialize();
      await client.initialized();

      const thread = await client.threadStart({
        cwd,
        runtimeWorkspaceRoots: [cwd],
        model: input.model ?? null,
        ...permissions.threadParams,
        ephemeral: false,
        serviceName: "codexnext"
      });

      const threadId = extractThreadId(thread);
      session = {
        sessionId,
        threadId,
        status: "idle",
        cwd,
        model: input.model ?? null,
        reasoningEffort: input.reasoningEffort ?? null,
        permissionMode: permissions.permissionMode,
        approvalPolicy: permissions.approvalPolicy,
        approvalsReviewer: permissions.approvalsReviewer,
        sandbox: permissions.sandbox,
        createdAt: now,
        updatedAt: now,
        client,
        removeNotificationListener
      };
      this.sessions.set(sessionId, session);

      this.options.eventStore.append({
        type: LocalEventType.SessionCreated,
        sessionId,
        threadId,
        payload: toSummary(session)
      });

      const initialGoal = input.initialGoal?.trim();
      if (initialGoal) {
        await this.setGoal(sessionId, {
          objective: initialGoal,
          status: "active",
          tokenBudget: input.tokenBudget ?? null
        });
      }

      const initialMessage = input.initialMessage?.trim();
      if (initialMessage) {
        await this.startTurn(sessionId, { text: initialMessage });
      }

      return toSummary(session);
    } catch (error) {
      removeNotificationListener();
      await client.close();
      this.options.eventStore.append({
        type: LocalEventType.AgentError,
        sessionId,
        payload: {
          message: error instanceof Error ? error.message : String(error)
        }
      });
      throw error;
    }
  }

  public async resumeSession(
    input: ResumeSessionInput
  ): Promise<LocalSessionSummary> {
    const cwd = path.resolve(input.cwd);
    await assertDirectory(cwd);
    const permissions = resolvePermissions(input);

    const sessionId = randomUUID();
    const now = Date.now();
    let session: LocalSession | undefined;

    const client = this.clientFactory({
      cwd,
      codexBin: this.options.codexBin,
      reasoningEffort: input.reasoningEffort ?? null,
      onApprovalRequest: (request) =>
        this.options.approvalBridge.requestApproval({
          sessionId,
          method: request.method,
          params: request.params
        })
    });

    const removeNotificationListener = client.onNotification((notification) => {
      if (!session) {
        return;
      }
      this.handleNotification(session, notification);
    });

    try {
      await client.initialize();
      await client.initialized();

      const resumeParams = {
        threadId: input.threadId,
        cwd,
        model: input.model ?? null,
        ...permissions.threadParams
      };
      let thread: ThreadResumeResponse;
      try {
        thread = await client.threadResume(resumeParams);
      } catch (error) {
        if (!isArchivedThreadError(error)) {
          throw error;
        }
        await client.threadUnarchive({ threadId: input.threadId });
        thread = await client.threadResume(resumeParams);
      }

      const threadId = extractThreadId(thread);
      session = {
        sessionId,
        threadId,
        status: "idle",
        cwd: extractThreadCwd(thread) ?? cwd,
        model: thread.model ?? input.model ?? null,
        reasoningEffort: input.reasoningEffort ?? null,
        permissionMode: permissions.permissionMode,
        approvalPolicy: permissions.approvalPolicy,
        approvalsReviewer: permissions.approvalsReviewer,
        sandbox: permissions.sandbox,
        createdAt: now,
        updatedAt: now,
        client,
        removeNotificationListener
      };
      this.sessions.set(sessionId, session);

      this.options.eventStore.append({
        type: LocalEventType.SessionCreated,
        sessionId,
        threadId,
        payload: { ...toSummary(session), resumedFrom: input.threadId }
      });

      return toSummary(session);
    } catch (error) {
      removeNotificationListener();
      await client.close();
      this.options.eventStore.append({
        type: LocalEventType.AgentError,
        sessionId,
        payload: {
          message: error instanceof Error ? error.message : String(error)
        }
      });
      throw error;
    }
  }

  public async sendMessage(
    sessionId: string,
    input: LocalSendMessageInput
  ): Promise<{ mode: "turn-start" | "steer"; turnId: string }> {
    const session = this.requireSession(sessionId);

    if (session.activeTurnId) {
      await session.client.turnSteer({
        threadId: session.threadId,
        expectedTurnId: session.activeTurnId,
        input: [makeTextInput(input.text)]
      });
      touch(session, "running");
      this.options.eventStore.append({
        type: LocalEventType.ChatUser,
        sessionId,
        threadId: session.threadId,
        turnId: session.activeTurnId,
        payload: { text: input.text, mode: "steer" }
      });
      this.options.eventStore.append({
        type: LocalEventType.TurnSteerAccepted,
        sessionId,
        threadId: session.threadId,
        turnId: session.activeTurnId,
        payload: { text: input.text }
      });
      return { mode: "steer", turnId: session.activeTurnId };
    }

    const turnId = await this.startTurn(sessionId, input);
    return { mode: "turn-start", turnId };
  }

  public async startTurn(
    sessionId: string,
    input: LocalSendMessageInput
  ): Promise<string> {
    const session = this.requireSession(sessionId);
    if (session.activeTurnId) {
      throw new Error(`Session ${sessionId} already has an active turn`);
    }

    this.options.eventStore.append({
      type: LocalEventType.ChatUser,
      sessionId,
      threadId: session.threadId,
      payload: { text: input.text, mode: "turn-start" }
    });

    const response = await session.client.turnStart({
      threadId: session.threadId,
      input: [makeTextInput(input.text)],
      cwd: session.cwd,
      runtimeWorkspaceRoots: [session.cwd],
      model: session.model ?? null,
      ...(session.approvalPolicy ? { approvalPolicy: session.approvalPolicy } : {}),
      ...(session.approvalsReviewer
        ? { approvalsReviewer: session.approvalsReviewer }
        : {})
    });

    const responseTurnId = extractTurnId(response);
    if (!session.activeTurnId) {
      session.activeTurnId = responseTurnId;
      session.currentTurnId = responseTurnId;
      touch(session, "running");
    }
    this.emitSessionUpdated(session);
    return session.activeTurnId;
  }

  public async steerTurn(
    sessionId: string,
    turnId: string,
    input: LocalSendMessageInput
  ): Promise<{ mode: "steer"; turnId: string }> {
    const session = this.requireSession(sessionId);
    if (!session.activeTurnId || session.activeTurnId !== turnId) {
      throw new Error(`Turn ${turnId} is not active`);
    }
    await session.client.turnSteer({
      threadId: session.threadId,
      expectedTurnId: turnId,
      input: [makeTextInput(input.text)]
    });
    this.options.eventStore.append({
      type: LocalEventType.ChatUser,
      sessionId,
      threadId: session.threadId,
      turnId,
      payload: { text: input.text, mode: "steer" }
    });
    this.options.eventStore.append({
      type: LocalEventType.TurnSteerAccepted,
      sessionId,
      threadId: session.threadId,
      turnId,
      payload: { text: input.text }
    });
    return { mode: "steer", turnId };
  }

  public async interruptTurn(
    sessionId: string,
    turnId: string
  ): Promise<{ turnId: string }> {
    const session = this.requireSession(sessionId);
    await session.client.turnInterrupt({
      threadId: session.threadId,
      turnId
    });
    touch(session, "interrupted");
    this.options.eventStore.append({
      type: LocalEventType.TurnInterruptRequested,
      sessionId,
      threadId: session.threadId,
      turnId,
      payload: { turnId }
    });
    this.emitSessionUpdated(session);
    return { turnId };
  }

  public async setGoal(
    sessionId: string,
    input: LocalSetGoalInput
  ): Promise<ThreadGoalSetResponse> {
    const session = this.requireSession(sessionId);
    const response = await session.client.setGoal({
      threadId: session.threadId,
      objective: input.objective ?? null,
      status: input.status ?? null,
      tokenBudget: input.tokenBudget ?? null
    });
    session.goal = response.goal;
    touch(session);
    this.options.eventStore.append({
      type: LocalEventType.GoalUpdated,
      sessionId,
      threadId: session.threadId,
      turnId: session.currentTurnId,
      payload: response.goal
    });
    this.emitSessionUpdated(session);
    return response;
  }

  public async getGoal(sessionId: string): Promise<{ goal: ThreadGoal | null }> {
    const session = this.requireSession(sessionId);
    const response = await session.client.getGoal({ threadId: session.threadId });
    session.goal = response.goal;
    touch(session);
    return response;
  }

  public async clearGoal(
    sessionId: string
  ): Promise<{ goal?: ThreadGoal | null }> {
    const session = this.requireSession(sessionId);
    const response = await session.client.clearGoal({ threadId: session.threadId });
    session.goal = null;
    touch(session);
    this.options.eventStore.append({
      type: LocalEventType.GoalCleared,
      sessionId,
      threadId: session.threadId,
      turnId: session.currentTurnId,
      payload: response
    });
    this.emitSessionUpdated(session);
    return response;
  }

  public async closeAll(): Promise<void> {
    await Promise.all(
      [...this.sessions.values()].map(async (session) => {
        session.removeNotificationListener();
        await session.client.close();
        this.options.eventStore.append({
          type: LocalEventType.SessionClosed,
          sessionId: session.sessionId,
          threadId: session.threadId,
          payload: toSummary(session)
        });
      })
    );
    this.sessions.clear();
  }

  private requireSession(sessionId: string): LocalSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Unknown session ${sessionId}`);
    }
    return session;
  }

  private async withTemporaryClient<T>(
    operation: (client: ManagedCodexClient) => Promise<T>
  ): Promise<T> {
    const client = this.clientFactory({
      cwd: os.homedir(),
      codexBin: this.options.codexBin,
      reasoningEffort: null,
      onApprovalRequest: async () => ({ decision: "decline" })
    });
    try {
      await client.initialize();
      await client.initialized();
      return await operation(client);
    } finally {
      await client.close();
    }
  }

  private handleNotification(
    session: LocalSession,
    notification: AppServerNotification
  ): void {
    const ids = extractNotificationIds(notification);
    const threadId = ids.threadId ?? session.threadId;
    const turnId = ids.turnId ?? session.activeTurnId ?? session.currentTurnId;

    this.options.eventStore.append({
      type: LocalEventType.CodexNotification,
      sessionId: session.sessionId,
      threadId,
      turnId,
      payload: notification
    });

    switch (notification.method) {
      case CodexNotificationMethod.TurnStarted:
        if (ids.turnId) {
          session.activeTurnId = ids.turnId;
          session.currentTurnId = ids.turnId;
        }
        touch(session, "running");
        this.options.eventStore.append({
          type: LocalEventType.TurnStarted,
          sessionId: session.sessionId,
          threadId,
          turnId: ids.turnId,
          payload: notification.params
        });
        this.emitSessionUpdated(session);
        return;
      case CodexNotificationMethod.TurnCompleted: {
        const status = extractTurnStatus(notification.params);
        if (ids.turnId && ids.turnId === session.activeTurnId) {
          session.activeTurnId = undefined;
        }
        if (ids.turnId) {
          session.currentTurnId = ids.turnId;
        }
        touch(session, mapTurnStatus(status));
        this.options.eventStore.append({
          type: LocalEventType.TurnCompleted,
          sessionId: session.sessionId,
          threadId,
          turnId: ids.turnId,
          payload: notification.params
        });
        this.emitSessionUpdated(session);
        return;
      }
      case CodexNotificationMethod.ThreadGoalUpdated:
        if (isRecord(notification.params) && isRecord(notification.params.goal)) {
          session.goal = notification.params.goal as unknown as ThreadGoal;
        }
        touch(session);
        this.options.eventStore.append({
          type: LocalEventType.GoalUpdated,
          sessionId: session.sessionId,
          threadId,
          turnId,
          payload: notification.params
        });
        this.emitSessionUpdated(session);
        return;
      case CodexNotificationMethod.ThreadGoalCleared:
        session.goal = null;
        touch(session);
        this.options.eventStore.append({
          type: LocalEventType.GoalCleared,
          sessionId: session.sessionId,
          threadId,
          turnId,
          payload: notification.params
        });
        this.emitSessionUpdated(session);
        return;
      case CodexNotificationMethod.AgentMessageDelta:
        this.options.eventStore.append({
          type: LocalEventType.ChatAssistantDelta,
          sessionId: session.sessionId,
          threadId,
          turnId,
          payload: { text: readStringField(notification.params, "delta") ?? "" }
        });
        return;
      case CodexNotificationMethod.CommandExecutionOutputDelta:
      case CodexNotificationMethod.FileChangeOutputDelta:
        this.options.eventStore.append({
          type: LocalEventType.CommandOutputDelta,
          sessionId: session.sessionId,
          threadId,
          turnId,
          payload: { text: readStringField(notification.params, "delta") ?? "" }
        });
        return;
      case CodexNotificationMethod.CommandExecOutputDelta:
        this.options.eventStore.append({
          type: LocalEventType.CommandOutputDelta,
          sessionId: session.sessionId,
          threadId,
          turnId,
          payload: { text: decodeCommandExecOutput(notification.params) }
        });
        return;
      case CodexNotificationMethod.TurnDiffUpdated:
        this.options.eventStore.append({
          type: LocalEventType.DiffUpdated,
          sessionId: session.sessionId,
          threadId,
          turnId,
          payload: { diff: readStringField(notification.params, "diff") ?? "" }
        });
        return;
      case CodexNotificationMethod.TurnPlanUpdated:
      case CodexNotificationMethod.PlanDelta:
        this.options.eventStore.append({
          type: LocalEventType.PlanUpdated,
          sessionId: session.sessionId,
          threadId,
          turnId,
          payload: notification.params
        });
        return;
      case CodexNotificationMethod.Error:
        touch(session, "error");
        this.options.eventStore.append({
          type: LocalEventType.CodexError,
          sessionId: session.sessionId,
          threadId,
          turnId,
          payload: notification.params
        });
        this.emitSessionUpdated(session);
        return;
      default:
        return;
    }
  }

  private emitSessionUpdated(session: LocalSession): void {
    this.options.eventStore.append({
      type: LocalEventType.SessionUpdated,
      sessionId: session.sessionId,
      threadId: session.threadId,
      turnId: session.currentTurnId,
      payload: toSummary(session)
    });
  }
}

async function assertDirectory(cwd: string): Promise<void> {
  let stats;
  try {
    stats = await stat(cwd);
  } catch {
    throw new Error(`cwd does not exist: ${cwd}`);
  }

  if (!stats.isDirectory()) {
    throw new Error(`cwd is not a directory: ${cwd}`);
  }
}

function extractThreadId(response: ThreadStartResponse | ThreadResumeResponse): string {
  if (typeof response.thread?.id === "string") {
    return response.thread.id;
  }
  throw new Error("thread response did not include thread.id");
}

function extractThreadCwd(response: ThreadResumeResponse): string | undefined {
  if (typeof response.cwd === "string") {
    return response.cwd;
  }
  if (typeof response.thread?.cwd === "string") {
    return response.thread.cwd;
  }
  return undefined;
}

function isArchivedThreadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(" is archived") || message.includes("codex unarchive");
}

function extractTurnId(response: TurnStartResponse): string {
  if (typeof response.turn?.id === "string") {
    return response.turn.id;
  }
  throw new Error("turn/start response did not include turn.id");
}

function extractNotificationIds(notification: AppServerNotification): {
  threadId?: string;
  turnId?: string;
} {
  const params = notification.params;
  if (!isRecord(params)) {
    return {};
  }
  const turn = isRecord(params.turn) ? params.turn : undefined;
  const threadId = typeof params.threadId === "string" ? params.threadId : undefined;
  const turnId =
    typeof params.turnId === "string"
      ? params.turnId
      : typeof turn?.id === "string"
        ? turn.id
        : undefined;
  return {
    ...(threadId ? { threadId } : {}),
    ...(turnId ? { turnId } : {})
  };
}

function extractTurnStatus(params: unknown): string | undefined {
  if (!isRecord(params) || !isRecord(params.turn)) {
    return undefined;
  }
  return typeof params.turn.status === "string" ? params.turn.status : undefined;
}

function mapTurnStatus(status: string | undefined): LocalSessionStatus {
  if (status === "completed") {
    return "completed";
  }
  if (status === "interrupted") {
    return "interrupted";
  }
  if (status === "failed") {
    return "failed";
  }
  return "idle";
}

function touch(session: LocalSession, status?: LocalSessionStatus): void {
  if (status) {
    session.status = status;
  }
  session.updatedAt = Date.now();
}

function toSummary(session: LocalSession): LocalSessionSummary {
  return {
    sessionId: session.sessionId,
    threadId: session.threadId,
    ...(session.currentTurnId ? { currentTurnId: session.currentTurnId } : {}),
    ...(session.activeTurnId ? { activeTurnId: session.activeTurnId } : {}),
    status: session.status,
    cwd: session.cwd,
    model: session.model ?? null,
    reasoningEffort: session.reasoningEffort ?? null,
    permissionMode: session.permissionMode,
    approvalPolicy: session.approvalPolicy,
    approvalsReviewer: session.approvalsReviewer,
    sandbox: session.sandbox,
    goal: session.goal ?? null,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt
  };
}

function appServerArgs(reasoningEffort?: LocalReasoningEffort | null): string[] {
  const args = ["app-server"];
  if (reasoningEffort) {
    args.push("-c", `model_reasoning_effort="${reasoningEffort}"`);
  }
  args.push("--stdio");
  return args;
}

function resolvePermissions(input: PermissionInput): {
  permissionMode: LocalPermissionMode;
  approvalPolicy: AskForApproval | null;
  approvalsReviewer: ApprovalsReviewer | null;
  sandbox: SandboxMode | null;
  threadParams: {
    approvalPolicy?: AskForApproval;
    approvalsReviewer?: ApprovalsReviewer;
    sandbox?: SandboxMode;
  };
} {
  const legacyMode: LocalPermissionMode =
    input.approvalPolicy || input.sandbox || input.approvalsReviewer
      ? "custom-config"
      : input.permissionMode;

  if (legacyMode === "custom-config") {
    return {
      permissionMode: "custom-config",
      approvalPolicy: input.approvalPolicy ?? null,
      approvalsReviewer: input.approvalsReviewer ?? null,
      sandbox: input.sandbox ?? null,
      threadParams: {
        ...(input.approvalPolicy ? { approvalPolicy: input.approvalPolicy } : {}),
        ...(input.approvalsReviewer
          ? { approvalsReviewer: input.approvalsReviewer }
          : {}),
        ...(input.sandbox ? { sandbox: input.sandbox } : {})
      }
    };
  }

  if (legacyMode === "auto-approve") {
    return {
      permissionMode: "auto-approve",
      approvalPolicy: "on-request",
      approvalsReviewer: "auto_review",
      sandbox: "workspace-write",
      threadParams: {
        approvalPolicy: "on-request",
        approvalsReviewer: "auto_review",
        sandbox: "workspace-write"
      }
    };
  }

  if (legacyMode === "full-access") {
    return {
      permissionMode: "full-access",
      approvalPolicy: "never",
      approvalsReviewer: "user",
      sandbox: "danger-full-access",
      threadParams: {
        approvalPolicy: "never",
        approvalsReviewer: "user",
        sandbox: "danger-full-access"
      }
    };
  }

  return {
    permissionMode: "request-approval",
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    sandbox: "workspace-write",
    threadParams: {
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      sandbox: "workspace-write"
    }
  };
}

function readStringField(params: unknown, field: string): string | undefined {
  if (!isRecord(params)) {
    return undefined;
  }
  return typeof params[field] === "string" ? params[field] : undefined;
}

function decodeCommandExecOutput(params: unknown): string {
  if (!isRecord(params) || typeof params.deltaBase64 !== "string") {
    return "";
  }
  return Buffer.from(params.deltaBase64, "base64").toString("utf8");
}
