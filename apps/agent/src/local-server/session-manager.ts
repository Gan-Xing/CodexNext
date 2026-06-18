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
  CodexThread,
  CodexThreadItem,
  CodexThreadTurn,
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
  ThreadLoadedListResponse,
  ThreadListParams,
  ThreadListResponse,
  ThreadReadParams,
  ThreadReadResponse,
  ThreadTurnsListParams,
  ThreadTurnsListResponse,
  ThreadResumeResponse,
  ThreadStartResponse,
  TurnStartResponse
} from "@codexnext/protocol";
import {
  CodexNotificationMethod,
  codexThreadItemRenderKind,
  deriveCodexConversationTitle,
  deriveCodexGeneratedTitle,
  LocalEventType,
  makeTextInput,
  isRecord
} from "@codexnext/protocol";
import type { ApprovalBridge } from "./approval-bridge.js";
import type { EventStore } from "./event-store.js";
import { devTrace, durationMs, errorSummary, payloadSummary } from "../dev-trace.js";

export interface ManagedCodexClient {
  initialize: CodexAppServerClient["initialize"];
  initialized: CodexAppServerClient["initialized"];
  threadStart: CodexAppServerClient["threadStart"];
  threadResume: CodexAppServerClient["threadResume"];
  threadArchive: CodexAppServerClient["threadArchive"];
  threadUnarchive: CodexAppServerClient["threadUnarchive"];
  threadList: CodexAppServerClient["threadList"];
  threadLoadedList: CodexAppServerClient["threadLoadedList"];
  threadRead: CodexAppServerClient["threadRead"];
  threadTurnsList: CodexAppServerClient["threadTurnsList"];
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
  title?: string | null;
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
  pendingUserInputs: PendingUserInputRecord[];
  userItemClientIds: Record<string, string>;
  nextUserInputOrder: number;
}

interface PendingUserInputRecord {
  clientMessageId: string;
  itemId?: string | undefined;
  mode: "turn-start" | "steer";
  order: number;
  text: string;
  turnId?: string | undefined;
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
  title?: string | null;
};

export class SessionManager {
  private readonly sessions = new Map<string, LocalSession>();
  private readonly clientFactory: CodexClientFactory;
  private metadataClientPromise: Promise<ManagedCodexClient> | null = null;
  private metadataClientQueue: Promise<void> = Promise.resolve();

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
    const summaries = [...this.sessions.values()].map(toSummary);
    devTrace("session.summaries", {
      count: summaries.length,
      sessions: summaries.map(sessionSummaryTraceFields)
    });
    return summaries;
  }

  public get(sessionId: string): LocalSessionSummary {
    const startedAt = Date.now();
    devTrace("session.get.begin", {
      sessionId,
      knownSessions: this.sessions.size
    });
    try {
      const summary = toSummary(this.requireSession(sessionId));
      devTrace("session.get.end", {
        sessionId,
        durationMs: durationMs(startedAt),
        ...sessionSummaryTraceFields(summary)
      });
      return summary;
    } catch (error) {
      devTrace("session.get.error", {
        sessionId,
        durationMs: durationMs(startedAt),
        ...errorSummary(error)
      });
      throw error;
    }
  }

  public async listThreads(
    params: ThreadListParams
  ): Promise<ThreadListResponse> {
    const startedAt = Date.now();
    devTrace("session.thread.list.begin", {
      ...threadListParamsTraceFields(params)
    });
    try {
      const response = await this.withTemporaryClient(
        "thread.list",
        (client) => client.threadList(params),
        threadListParamsTraceFields(params)
      );
      devTrace("session.thread.list.end", {
        durationMs: durationMs(startedAt),
        count: response.data.length,
        nextCursor: response.nextCursor,
        backwardsCursor: response.backwardsCursor
      });
      return response;
    } catch (error) {
      devTrace("session.thread.list.error", {
        durationMs: durationMs(startedAt),
        ...threadListParamsTraceFields(params),
        ...errorSummary(error)
      });
      throw error;
    }
  }

  public async listLoadedThreads(): Promise<ThreadLoadedListResponse> {
    const startedAt = Date.now();
    devTrace("session.thread.loaded.begin");
    try {
      const response = await this.withTemporaryClient(
        "thread.loaded",
        (client) => client.threadLoadedList()
      );
      devTrace("session.thread.loaded.end", {
        durationMs: durationMs(startedAt),
        count: response.data.length
      });
      return response;
    } catch (error) {
      devTrace("session.thread.loaded.error", {
        durationMs: durationMs(startedAt),
        ...errorSummary(error)
      });
      throw error;
    }
  }

  public async readThread(
    params: ThreadReadParams
  ): Promise<ThreadReadResponse> {
    const startedAt = Date.now();
    devTrace("session.thread.read.begin", {
      threadId: params.threadId,
      includeTurns: params.includeTurns ?? false
    });
    try {
      const response = await this.withTemporaryClient(
        "thread.read",
        (client) => client.threadRead(params),
        {
          threadId: params.threadId,
          includeTurns: params.includeTurns ?? false
        }
      );
      const decoratedResponse = this.decorateThreadReadResponse(response);
      devTrace("session.thread.read.end", {
        durationMs: durationMs(startedAt),
        threadId: decoratedResponse.thread.id,
        cwd: decoratedResponse.thread.cwd,
        turnCount: decoratedResponse.thread.turns?.length ?? 0
      });
      return decoratedResponse;
    } catch (error) {
      devTrace("session.thread.read.error", {
        durationMs: durationMs(startedAt),
        threadId: params.threadId,
        includeTurns: params.includeTurns ?? false,
        ...errorSummary(error)
      });
      throw error;
    }
  }

  public async listThreadTurns(
    params: ThreadTurnsListParams
  ): Promise<ThreadTurnsListResponse> {
    const startedAt = Date.now();
    const traceFields = threadTurnsParamsTraceFields(params);
    devTrace("session.thread.turns.begin", traceFields);
    try {
      const response = await this.withTemporaryClient(
        "thread.turns",
        (client) => client.threadTurnsList(params),
        traceFields
      );
      const decoratedResponse = this.decorateThreadTurnsResponse(
        params.threadId,
        response
      );
      devTrace("session.thread.turns.end", {
        durationMs: durationMs(startedAt),
        ...traceFields,
        count: decoratedResponse.data.length,
        nextCursor: decoratedResponse.nextCursor,
        backwardsCursor: decoratedResponse.backwardsCursor,
        itemCounts: decoratedResponse.data.map((turn) => turn.items.length)
      });
      return decoratedResponse;
    } catch (error) {
      devTrace("session.thread.turns.error", {
        durationMs: durationMs(startedAt),
        ...traceFields,
        ...errorSummary(error)
      });
      throw error;
    }
  }

  public async archiveThread(threadId: string): Promise<void> {
    const normalizedThreadId = threadId.trim();
    const startedAt = Date.now();
    devTrace("session.thread.archive.begin", {
      threadId: normalizedThreadId,
      matchingOpenSessions: [...this.sessions.values()].filter(
        (session) => session.threadId === normalizedThreadId
      ).length
    });
    if (!normalizedThreadId) {
      devTrace("session.thread.archive.error", {
        durationMs: durationMs(startedAt),
        reason: "missing_thread_id"
      });
      throw new Error("Missing thread id");
    }

    try {
      await this.withTemporaryClient(
        "thread.archive",
        async (client) => {
          try {
            await client.threadArchive({ threadId: normalizedThreadId });
            devTrace("session.thread.archive.codex_archived", {
              threadId: normalizedThreadId
            });
          } catch (error) {
            if (!isMissingRolloutThreadError(error)) {
              throw error;
            }
            devTrace("session.thread.archive.recover_missing_rollout", {
              threadId: normalizedThreadId
            });
            const response = await client.threadRead({
              threadId: normalizedThreadId,
              includeTurns: false
            });
            await client.threadResume({
              threadId: normalizedThreadId,
              cwd: extractThreadReadCwd(response) ?? process.cwd(),
              excludeTurns: true
            });
            await client.threadArchive({ threadId: normalizedThreadId });
            devTrace("session.thread.archive.recovered_and_archived", {
              threadId: normalizedThreadId
            });
          }
        },
        { threadId: normalizedThreadId }
      );

      const matchingSessions = [...this.sessions.values()].filter(
        (session) => session.threadId === normalizedThreadId
      );
      devTrace("session.thread.archive.close_matching.begin", {
        threadId: normalizedThreadId,
        count: matchingSessions.length,
        sessionIds: matchingSessions.map((session) => session.sessionId)
      });
      await Promise.all(matchingSessions.map((session) => this.closeSession(session)));
      devTrace("session.thread.archive.end", {
        threadId: normalizedThreadId,
        durationMs: durationMs(startedAt),
        closedSessions: matchingSessions.length
      });
    } catch (error) {
      devTrace("session.thread.archive.error", {
        threadId: normalizedThreadId,
        durationMs: durationMs(startedAt),
        ...errorSummary(error)
      });
      throw error;
    }
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
    const startedAt = Date.now();
    devTrace("session.start.begin", {
      sessionId,
      cwd,
      model: input.model ?? null,
      reasoningEffort: input.reasoningEffort ?? null,
      permissionMode: input.permissionMode,
      hasInitialMessage: Boolean(input.initialMessage?.trim()),
      clientMessageId: input.clientMessageId
    });

    devTrace("session.client.create", {
      sessionId,
      cwd,
      codexBin: this.options.codexBin,
      reasoningEffort: input.reasoningEffort ?? null
    });
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
      devTrace("session.start.initialize.begin", { sessionId });
      await client.initialize();
      devTrace("session.start.initialize.end", {
        sessionId,
        durationMs: durationMs(startedAt)
      });
      await client.initialized();
      devTrace("session.start.initialized_notification_sent", { sessionId });

      devTrace("session.start.thread_start.begin", {
        sessionId,
        cwd,
        permissionMode: permissions.permissionMode,
        approvalPolicy: permissions.approvalPolicy,
        approvalsReviewer: permissions.approvalsReviewer,
        sandbox: permissions.sandbox,
        model: input.model ?? null
      });
      const thread = await client.threadStart({
        cwd,
        runtimeWorkspaceRoots: [cwd],
        model: input.model ?? null,
        ...permissions.threadParams,
        ephemeral: false,
        serviceName: "codexnext"
      });

      const threadId = extractThreadId(thread);
      devTrace("session.start.thread_start.end", {
        sessionId,
        threadId,
        durationMs: durationMs(startedAt),
        ...payloadSummary(thread)
      });
      const initialMessage = input.initialMessage?.trim() || null;
      session = {
        sessionId,
        threadId,
        status: "idle",
        cwd,
        title:
          deriveCodexGeneratedTitle(initialMessage) ??
          deriveCodexConversationTitle(asCodexThread(thread.thread, cwd)),
        model: input.model ?? null,
        reasoningEffort: input.reasoningEffort ?? null,
        permissionMode: permissions.permissionMode,
        approvalPolicy: permissions.approvalPolicy,
        approvalsReviewer: permissions.approvalsReviewer,
        sandbox: permissions.sandbox,
        createdAt: now,
        updatedAt: now,
        client,
        removeNotificationListener,
        pendingUserInputs: [],
        userItemClientIds: {},
        nextUserInputOrder: 0
      };
      this.sessions.set(sessionId, session);

      this.options.eventStore.append({
        type: LocalEventType.SessionCreated,
        sessionId,
        threadId,
        payload: toSummary(session)
      });
      devTrace("session.start.created", {
        sessionId,
        threadId,
        durationMs: durationMs(startedAt)
      });

      try {
        const initialGoal = input.initialGoal?.trim();
        if (initialGoal) {
          devTrace("session.start.initial_goal.begin", {
            sessionId,
            threadId,
            objectiveLength: initialGoal.length,
            tokenBudget: input.tokenBudget ?? null
          });
          await this.setGoal(sessionId, {
            objective: initialGoal,
            status: "active",
            tokenBudget: input.tokenBudget ?? null
          });
          devTrace("session.start.initial_goal.end", {
            sessionId,
            threadId
          });
        }

        if (initialMessage) {
          devTrace("session.start.initial_message.begin", {
            sessionId,
            threadId,
            clientMessageId: input.clientMessageId,
            textLength: initialMessage.length
          });
          await this.startTurn(sessionId, {
            text: initialMessage,
            clientMessageId: input.clientMessageId
          });
          devTrace("session.start.initial_message.end", {
            sessionId,
            threadId,
            clientMessageId: input.clientMessageId
          });
        }
      } catch (error) {
        this.emitAgentError(session, {
          message: error instanceof Error ? error.message : String(error),
          ...(input.clientMessageId
            ? { clientMessageId: input.clientMessageId }
            : {})
        });
        throw error;
      }

      devTrace("session.start.end", {
        sessionId,
        threadId,
        durationMs: durationMs(startedAt),
        ...localSessionTraceFields(session)
      });
      return toSummary(session);
    } catch (error) {
      devTrace("session.start.error", {
        sessionId,
        durationMs: durationMs(startedAt),
        ...errorSummary(error)
      });
      if (!session) {
        removeNotificationListener();
        await client.close();
        this.options.eventStore.append({
          type: LocalEventType.AgentError,
          sessionId,
          payload: {
            message: error instanceof Error ? error.message : String(error),
            ...(input.clientMessageId
              ? { clientMessageId: input.clientMessageId }
              : {})
          }
        });
      }
      throw error;
    }
  }

  public async resumeSession(
    input: ResumeSessionInput
  ): Promise<LocalSessionSummary> {
    const startedAt = Date.now();
    devTrace("session.resume.summary.begin", {
      threadId: input.threadId,
      cwd: input.cwd
    });
    try {
      const result = await this.resumeSessionWithInitialTurns(input);
      devTrace("session.resume.summary.end", {
        sessionId: result.session.sessionId,
        threadId: result.session.threadId,
        durationMs: durationMs(startedAt)
      });
      return result.session;
    } catch (error) {
      devTrace("session.resume.summary.error", {
        threadId: input.threadId,
        durationMs: durationMs(startedAt),
        ...errorSummary(error)
      });
      throw error;
    }
  }

  public async resumeSessionWithInitialTurns(
    input: ResumeSessionInput
  ): Promise<{
    session: LocalSessionSummary;
    initialTurnsPage: ThreadTurnsListResponse | null;
  }> {
    const cwd = path.resolve(input.cwd);
    await assertDirectory(cwd);
    const permissions = resolvePermissions(input);

    const sessionId = randomUUID();
    const now = Date.now();
    let session: LocalSession | undefined;
    const startedAt = Date.now();
    devTrace("session.resume.begin", {
      sessionId,
      threadId: input.threadId,
      cwd,
      model: input.model ?? null,
      reasoningEffort: input.reasoningEffort ?? null,
      permissionMode: input.permissionMode
    });

    devTrace("session.client.create", {
      sessionId,
      cwd,
      codexBin: this.options.codexBin,
      reasoningEffort: input.reasoningEffort ?? null
    });
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
      devTrace("session.resume.initialize.begin", { sessionId });
      await client.initialize();
      devTrace("session.resume.initialize.end", {
        sessionId,
        durationMs: durationMs(startedAt)
      });
      await client.initialized();
      devTrace("session.resume.initialized_notification_sent", { sessionId });

      const resumeParams = {
        threadId: input.threadId,
        cwd,
        excludeTurns: true,
        initialTurnsPage: {
          limit: 40,
          sortDirection: "desc" as const,
          itemsView: "summary" as const
        },
        model: input.model ?? null,
        ...permissions.threadParams
      };
      let thread: ThreadResumeResponse;
      try {
        devTrace("session.resume.thread_resume.begin", {
          sessionId,
          threadId: input.threadId,
          cwd,
          permissionMode: permissions.permissionMode,
          approvalPolicy: permissions.approvalPolicy,
          approvalsReviewer: permissions.approvalsReviewer,
          sandbox: permissions.sandbox,
          model: input.model ?? null
        });
        thread = await client.threadResume(resumeParams);
      } catch (error) {
        if (!isArchivedThreadError(error)) {
          throw error;
        }
        devTrace("session.resume.thread_archived_unarchive.begin", {
          sessionId,
          threadId: input.threadId
        });
        await client.threadUnarchive({ threadId: input.threadId });
        devTrace("session.resume.thread_archived_unarchive.end", {
          sessionId,
          threadId: input.threadId
        });
        thread = await client.threadResume(resumeParams);
      }

      const threadId = extractThreadId(thread);
      devTrace("session.resume.thread_resume.end", {
        sessionId,
        threadId,
        durationMs: durationMs(startedAt),
        initialTurnCount: thread.initialTurnsPage?.data.length ?? 0,
        ...payloadSummary(thread)
      });
      const sessionTitle =
        normalizeTitle(input.title) ??
        deriveCodexConversationTitle(
          asCodexThread(thread.thread, extractThreadCwd(thread) ?? cwd)
        ) ??
        (await readThreadTitle(client, threadId));
      session = {
        sessionId,
        threadId,
        status: "idle",
        cwd: extractThreadCwd(thread) ?? cwd,
        title: sessionTitle,
        model: thread.model ?? input.model ?? null,
        reasoningEffort: input.reasoningEffort ?? null,
        permissionMode: permissions.permissionMode,
        approvalPolicy: permissions.approvalPolicy,
        approvalsReviewer: permissions.approvalsReviewer,
        sandbox: permissions.sandbox,
        createdAt: now,
        updatedAt: now,
        client,
        removeNotificationListener,
        pendingUserInputs: [],
        userItemClientIds: {},
        nextUserInputOrder: 0
      };
      this.sessions.set(sessionId, session);

      this.options.eventStore.append({
        type: LocalEventType.SessionCreated,
        sessionId,
        threadId,
        payload: { ...toSummary(session), resumedFrom: input.threadId }
      });
      devTrace("session.resume.created", {
        sessionId,
        threadId,
        durationMs: durationMs(startedAt),
        initialTurnCount: thread.initialTurnsPage?.data.length ?? 0
      });

      devTrace("session.resume.end", {
        sessionId,
        threadId,
        durationMs: durationMs(startedAt),
        ...localSessionTraceFields(session)
      });
      return {
        session: toSummary(session),
        initialTurnsPage: thread.initialTurnsPage ?? null
      };
    } catch (error) {
      devTrace("session.resume.error", {
        sessionId,
        threadId: input.threadId,
        durationMs: durationMs(startedAt),
        ...errorSummary(error)
      });
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
    const startedAt = Date.now();
    devTrace("session.message.begin", {
      sessionId,
      clientMessageId: input.clientMessageId,
      textLength: input.text.length
    });
    try {
      const session = this.requireSession(sessionId);
      if (session.activeTurnId) {
        devTrace("session.message.route", {
          sessionId,
          threadId: session.threadId,
          mode: "steer",
          turnId: session.activeTurnId,
          clientMessageId: input.clientMessageId
        });
        const result = await this.steerTurn(sessionId, session.activeTurnId, input);
        devTrace("session.message.end", {
          sessionId,
          threadId: session.threadId,
          mode: result.mode,
          turnId: result.turnId,
          durationMs: durationMs(startedAt)
        });
        return result;
      }

      devTrace("session.message.route", {
        sessionId,
        threadId: session.threadId,
        mode: "turn-start",
        clientMessageId: input.clientMessageId
      });
      const turnId = await this.startTurn(sessionId, input);
      devTrace("session.message.end", {
        sessionId,
        threadId: session.threadId,
        mode: "turn-start",
        turnId,
        durationMs: durationMs(startedAt)
      });
      return { mode: "turn-start", turnId };
    } catch (error) {
      devTrace("session.message.error", {
        sessionId,
        clientMessageId: input.clientMessageId,
        durationMs: durationMs(startedAt),
        ...errorSummary(error)
      });
      throw error;
    }
  }

  public async startTurn(
    sessionId: string,
    input: LocalSendMessageInput
  ): Promise<string> {
    const startedAt = Date.now();
    devTrace("session.turn.start.request", {
      sessionId,
      clientMessageId: input.clientMessageId,
      textLength: input.text.length
    });
    const session = this.requireSession(sessionId);
    if (session.activeTurnId) {
      devTrace("session.turn.start.rejected", {
        sessionId,
        threadId: session.threadId,
        activeTurnId: session.activeTurnId,
        reason: "active_turn_exists",
        durationMs: durationMs(startedAt)
      });
      throw new Error(`Session ${sessionId} already has an active turn`);
    }

    if (!normalizeTitle(session.title)) {
      session.title = deriveCodexGeneratedTitle(input.text);
    }
    devTrace("session.turn.start.begin", {
      sessionId,
      threadId: session.threadId,
      clientMessageId: input.clientMessageId,
      textLength: input.text.length,
      model: session.model ?? null
    });
    recordUserInput(session, {
      text: input.text,
      mode: "turn-start",
      clientMessageId: input.clientMessageId
    });

    this.emitChatUser(session, {
      text: input.text,
      mode: "turn-start",
      ...(input.clientMessageId
        ? { clientMessageId: input.clientMessageId }
        : {})
    });

    try {
      devTrace("session.turn.start.codex_request", {
        sessionId,
        threadId: session.threadId,
        clientMessageId: input.clientMessageId,
        cwd: session.cwd,
        model: session.model ?? null,
        approvalPolicy: session.approvalPolicy,
        approvalsReviewer: session.approvalsReviewer
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
      devTrace("session.turn.start.accepted", {
        sessionId,
        threadId: session.threadId,
        turnId: responseTurnId,
        clientMessageId: input.clientMessageId,
        durationMs: durationMs(startedAt),
        ...payloadSummary(response)
      });
      bindUserInputTurn(session, input.clientMessageId, responseTurnId);
      if (!session.activeTurnId) {
        session.activeTurnId = responseTurnId;
        session.currentTurnId = responseTurnId;
        touch(session, "running");
      }
      this.emitSessionUpdated(session);
      return session.activeTurnId;
    } catch (error) {
      devTrace("session.turn.start.error", {
        sessionId,
        threadId: session.threadId,
        clientMessageId: input.clientMessageId,
        durationMs: durationMs(startedAt),
        ...errorSummary(error)
      });
      this.emitAgentError(session, {
        message: error instanceof Error ? error.message : String(error),
        ...(input.clientMessageId
          ? { clientMessageId: input.clientMessageId }
          : {})
      });
      throw error;
    }
  }

  public async steerTurn(
    sessionId: string,
    turnId: string,
    input: LocalSendMessageInput
  ): Promise<{ mode: "steer"; turnId: string }> {
    const startedAt = Date.now();
    devTrace("session.turn.steer.request", {
      sessionId,
      turnId,
      clientMessageId: input.clientMessageId,
      textLength: input.text.length
    });
    const session = this.requireSession(sessionId);
    if (!session.activeTurnId || session.activeTurnId !== turnId) {
      devTrace("session.turn.steer.rejected", {
        sessionId,
        threadId: session.threadId,
        turnId,
        activeTurnId: session.activeTurnId,
        reason: "turn_not_active",
        durationMs: durationMs(startedAt)
      });
      throw new Error(`Turn ${turnId} is not active`);
    }

    recordUserInput(session, {
      text: input.text,
      mode: "steer",
      clientMessageId: input.clientMessageId,
      turnId
    });
    this.emitChatUser(session, {
      text: input.text,
      mode: "steer",
      ...(input.clientMessageId
        ? { clientMessageId: input.clientMessageId }
        : {}),
      turnId
    });
    devTrace("session.turn.steer.begin", {
      sessionId,
      threadId: session.threadId,
      turnId,
      clientMessageId: input.clientMessageId,
      textLength: input.text.length
    });

    try {
      devTrace("session.turn.steer.codex_request", {
        sessionId,
        threadId: session.threadId,
        turnId,
        clientMessageId: input.clientMessageId
      });
      await session.client.turnSteer({
        threadId: session.threadId,
        expectedTurnId: turnId,
        input: [makeTextInput(input.text)]
      });
      touch(session, "running");
      this.options.eventStore.append({
        type: LocalEventType.TurnSteerAccepted,
        sessionId,
        threadId: session.threadId,
        turnId,
        payload: {
          text: input.text,
          ...(input.clientMessageId
            ? { clientMessageId: input.clientMessageId }
            : {})
        }
      });
      devTrace("session.turn.steer.accepted", {
        sessionId,
        threadId: session.threadId,
        turnId,
        clientMessageId: input.clientMessageId,
        durationMs: durationMs(startedAt)
      });
      this.emitSessionUpdated(session);
      return { mode: "steer", turnId };
    } catch (error) {
      devTrace("session.turn.steer.error", {
        sessionId,
        threadId: session.threadId,
        turnId,
        clientMessageId: input.clientMessageId,
        durationMs: durationMs(startedAt),
        ...errorSummary(error)
      });
      this.emitAgentError(session, {
        message: error instanceof Error ? error.message : String(error),
        ...(input.clientMessageId
          ? { clientMessageId: input.clientMessageId }
          : {}),
        turnId
      });
      throw error;
    }
  }

  public async interruptTurn(
    sessionId: string,
    turnId: string
  ): Promise<{ turnId: string }> {
    const startedAt = Date.now();
    devTrace("session.turn.interrupt.begin", {
      sessionId,
      turnId
    });
    try {
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
      devTrace("session.turn.interrupt.end", {
        sessionId,
        threadId: session.threadId,
        turnId,
        durationMs: durationMs(startedAt)
      });
      return { turnId };
    } catch (error) {
      devTrace("session.turn.interrupt.error", {
        sessionId,
        turnId,
        durationMs: durationMs(startedAt),
        ...errorSummary(error)
      });
      throw error;
    }
  }

  public async setGoal(
    sessionId: string,
    input: LocalSetGoalInput
  ): Promise<ThreadGoalSetResponse> {
    const startedAt = Date.now();
    devTrace("session.goal.set.begin", {
      sessionId,
      objectiveLength: input.objective?.length ?? 0,
      status: input.status ?? null,
      tokenBudget: input.tokenBudget ?? null
    });
    try {
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
      devTrace("session.goal.set.end", {
        sessionId,
        threadId: session.threadId,
        turnId: session.currentTurnId,
        hasGoal: Boolean(response.goal),
        durationMs: durationMs(startedAt)
      });
      return response;
    } catch (error) {
      devTrace("session.goal.set.error", {
        sessionId,
        durationMs: durationMs(startedAt),
        ...errorSummary(error)
      });
      throw error;
    }
  }

  public async getGoal(sessionId: string): Promise<{ goal: ThreadGoal | null }> {
    const startedAt = Date.now();
    devTrace("session.goal.get.begin", { sessionId });
    try {
      const session = this.requireSession(sessionId);
      const response = await session.client.getGoal({ threadId: session.threadId });
      session.goal = response.goal;
      touch(session);
      devTrace("session.goal.get.end", {
        sessionId,
        threadId: session.threadId,
        hasGoal: Boolean(response.goal),
        durationMs: durationMs(startedAt)
      });
      return response;
    } catch (error) {
      devTrace("session.goal.get.error", {
        sessionId,
        durationMs: durationMs(startedAt),
        ...errorSummary(error)
      });
      throw error;
    }
  }

  public async clearGoal(
    sessionId: string
  ): Promise<{ goal?: ThreadGoal | null }> {
    const startedAt = Date.now();
    devTrace("session.goal.clear.begin", { sessionId });
    try {
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
      devTrace("session.goal.clear.end", {
        sessionId,
        threadId: session.threadId,
        durationMs: durationMs(startedAt)
      });
      return response;
    } catch (error) {
      devTrace("session.goal.clear.error", {
        sessionId,
        durationMs: durationMs(startedAt),
        ...errorSummary(error)
      });
      throw error;
    }
  }

  public async closeAll(): Promise<void> {
    const startedAt = Date.now();
    const sessions = [...this.sessions.values()];
    devTrace("session.close_all.begin", {
      count: sessions.length,
      sessionIds: sessions.map((session) => session.sessionId),
      hasMetadataClient: Boolean(this.metadataClientPromise)
    });
    try {
      await Promise.all(sessions.map((session) => this.closeSession(session)));
      await this.closeMetadataClient();
      devTrace("session.close_all.end", {
        count: sessions.length,
        durationMs: durationMs(startedAt)
      });
    } catch (error) {
      devTrace("session.close_all.error", {
        count: sessions.length,
        durationMs: durationMs(startedAt),
        ...errorSummary(error)
      });
      throw error;
    }
  }

  private requireSession(sessionId: string): LocalSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      devTrace("session.require.missing", {
        sessionId,
        knownSessions: this.sessions.size,
        knownSessionIds: [...this.sessions.keys()]
      });
      throw new Error(`Unknown session ${sessionId}`);
    }
    devTrace("session.require.hit", {
      sessionId,
      ...localSessionTraceFields(session)
    });
    return session;
  }

  private async withTemporaryClient<T>(
    operationName: string,
    operation: (client: ManagedCodexClient) => Promise<T>,
    fields: Record<string, unknown> = {}
  ): Promise<T> {
    const queuedAt = Date.now();
    devTrace("session.metadata.queue", {
      operationName,
      hasMetadataClient: Boolean(this.metadataClientPromise),
      ...fields
    });
    const run = async () => {
      const startedAt = Date.now();
      devTrace("session.metadata.run.begin", {
        operationName,
        queuedMs: durationMs(queuedAt),
        hasMetadataClient: Boolean(this.metadataClientPromise),
        ...fields
      });
      try {
        const client = await this.getMetadataClient();
        devTrace("session.metadata.client.ready", {
          operationName,
          readyMs: durationMs(startedAt),
          ...fields
        });
        const result = await operation(client);
        devTrace("session.metadata.run.end", {
          operationName,
          durationMs: durationMs(startedAt),
          ...fields
        });
        return result;
      } catch (error) {
        devTrace("session.metadata.run.error", {
          operationName,
          durationMs: durationMs(startedAt),
          ...fields,
          ...errorSummary(error)
        });
        throw error;
      }
    };
    const result = this.metadataClientQueue.then(run, run);
    this.metadataClientQueue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  private async getMetadataClient(): Promise<ManagedCodexClient> {
    if (!this.metadataClientPromise) {
      const startedAt = Date.now();
      devTrace("session.metadata.client.create.begin", {
        cwd: os.homedir(),
        codexBin: this.options.codexBin
      });
      const client = this.clientFactory({
        cwd: os.homedir(),
        codexBin: this.options.codexBin,
        reasoningEffort: null,
        onApprovalRequest: async () => ({ decision: "decline" })
      });
      this.metadataClientPromise = (async () => {
        try {
          await client.initialize();
          devTrace("session.metadata.client.initialized_rpc", {
            durationMs: durationMs(startedAt)
          });
          await client.initialized();
          devTrace("session.metadata.client.create.end", {
            durationMs: durationMs(startedAt)
          });
          return client;
        } catch (error) {
          this.metadataClientPromise = null;
          devTrace("session.metadata.client.create.error", {
            durationMs: durationMs(startedAt),
            ...errorSummary(error)
          });
          await client.close().catch(() => undefined);
          throw error;
        }
      })();
    } else {
      devTrace("session.metadata.client.reuse");
    }
    return this.metadataClientPromise;
  }

  private async closeMetadataClient(): Promise<void> {
    const startedAt = Date.now();
    const metadataClientPromise = this.metadataClientPromise;
    this.metadataClientPromise = null;
    if (!metadataClientPromise) {
      devTrace("session.metadata.client.close.skip", {
        reason: "missing_client"
      });
      return;
    }
    try {
      devTrace("session.metadata.client.close.begin");
      const client = await metadataClientPromise;
      await client.close();
      devTrace("session.metadata.client.close.end", {
        durationMs: durationMs(startedAt)
      });
    } catch {
      devTrace("session.metadata.client.close.error", {
        durationMs: durationMs(startedAt)
      });
      // Ignore teardown failures while shutting down the shared metadata client.
    }
  }

  private async closeSession(session: LocalSession): Promise<void> {
    const startedAt = Date.now();
    devTrace("session.close.begin", {
      ...localSessionTraceFields(session)
    });
    try {
      this.sessions.delete(session.sessionId);
      session.removeNotificationListener();
      await session.client.close();
      this.options.eventStore.append({
        type: LocalEventType.SessionClosed,
        sessionId: session.sessionId,
        threadId: session.threadId,
        payload: toSummary(session)
      });
      devTrace("session.close.end", {
        sessionId: session.sessionId,
        threadId: session.threadId,
        durationMs: durationMs(startedAt),
        remainingSessions: this.sessions.size
      });
    } catch (error) {
      devTrace("session.close.error", {
        sessionId: session.sessionId,
        threadId: session.threadId,
        durationMs: durationMs(startedAt),
        ...errorSummary(error)
      });
      throw error;
    }
  }

  private handleNotification(
    session: LocalSession,
    notification: AppServerNotification
  ): void {
    notification = decorateAppServerNotification(session, notification);
    const ids = extractNotificationIds(notification);
    const threadId = ids.threadId ?? session.threadId;
    const turnId = ids.turnId ?? session.activeTurnId ?? session.currentTurnId;
    devTrace("codex.notification", {
      method: notification.method,
      sessionId: session.sessionId,
      threadId,
      turnId,
      ...payloadSummary(notification.params)
    });

    this.options.eventStore.append({
      type: LocalEventType.CodexNotification,
      sessionId: session.sessionId,
      threadId,
      turnId,
      payload: notification
    });

    switch (notification.method) {
      case CodexNotificationMethod.ThreadStatusChanged: {
        const statusType = extractThreadStatusType(notification.params);
        devTrace("codex.notification.thread_status", {
          sessionId: session.sessionId,
          threadId,
          turnId,
          statusType
        });
        this.options.eventStore.append({
          type: LocalEventType.ThreadStatusChanged,
          sessionId: session.sessionId,
          threadId,
          turnId,
          payload: {
            threadId,
            statusType,
            loaded: statusType !== "notLoaded"
          }
        });
        return;
      }
      case CodexNotificationMethod.TurnStarted:
        devTrace("codex.notification.turn_started", {
          sessionId: session.sessionId,
          threadId,
          turnId: ids.turnId,
          previousActiveTurnId: session.activeTurnId,
          previousCurrentTurnId: session.currentTurnId
        });
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
        devTrace("codex.notification.turn_completed", {
          sessionId: session.sessionId,
          threadId,
          turnId: ids.turnId,
          status,
          previousActiveTurnId: session.activeTurnId,
          previousCurrentTurnId: session.currentTurnId
        });
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
      case CodexNotificationMethod.ItemStarted:
        devTrace("codex.notification.item_started", {
          sessionId: session.sessionId,
          threadId,
          turnId,
          ...threadItemTraceFields(notification.params)
        });
        this.options.eventStore.append({
          type: LocalEventType.AppServerItemStarted,
          sessionId: session.sessionId,
          threadId,
          turnId,
          payload: notification.params
        });
        return;
      case CodexNotificationMethod.ItemCompleted:
        devTrace("codex.notification.item_completed", {
          sessionId: session.sessionId,
          threadId,
          turnId,
          ...threadItemTraceFields(notification.params)
        });
        this.options.eventStore.append({
          type: LocalEventType.AppServerItemCompleted,
          sessionId: session.sessionId,
          threadId,
          turnId,
          payload: notification.params
        });
        return;
      case CodexNotificationMethod.ThreadGoalUpdated:
        devTrace("codex.notification.goal_updated", {
          sessionId: session.sessionId,
          threadId,
          turnId,
          hasGoal:
            isRecord(notification.params) && isRecord(notification.params.goal)
        });
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
        devTrace("codex.notification.goal_cleared", {
          sessionId: session.sessionId,
          threadId,
          turnId
        });
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
      case CodexNotificationMethod.AgentMessageDelta: {
        const delta = readStringField(notification.params, "delta") ?? "";
        devTrace("codex.notification.assistant_delta", {
          sessionId: session.sessionId,
          threadId,
          turnId,
          deltaLength: delta.length
        });
        this.options.eventStore.append({
          type: LocalEventType.ChatAssistantDelta,
          sessionId: session.sessionId,
          threadId,
          turnId,
          payload: { text: delta }
        });
        return;
      }
      case CodexNotificationMethod.CommandExecutionOutputDelta:
      case CodexNotificationMethod.FileChangeOutputDelta: {
        const delta = readStringField(notification.params, "delta") ?? "";
        devTrace("codex.notification.command_output_delta", {
          sessionId: session.sessionId,
          threadId,
          turnId,
          method: notification.method,
          deltaLength: delta.length
        });
        this.options.eventStore.append({
          type: LocalEventType.CommandOutputDelta,
          sessionId: session.sessionId,
          threadId,
          turnId,
          payload: { text: delta }
        });
        return;
      }
      case CodexNotificationMethod.CommandExecOutputDelta: {
        const output = decodeCommandExecOutput(notification.params);
        devTrace("codex.notification.command_exec_output_delta", {
          sessionId: session.sessionId,
          threadId,
          turnId,
          outputLength: output.length
        });
        this.options.eventStore.append({
          type: LocalEventType.CommandOutputDelta,
          sessionId: session.sessionId,
          threadId,
          turnId,
          payload: { text: output }
        });
        return;
      }
      case CodexNotificationMethod.ProcessOutputDelta: {
        const output = decodeBase64Field(notification.params, "deltaBase64");
        devTrace("codex.notification.process_output_delta", {
          sessionId: session.sessionId,
          threadId,
          turnId,
          processHandle: readStringField(notification.params, "processHandle"),
          outputLength: output.length
        });
        this.options.eventStore.append({
          type: LocalEventType.AppServerProcessOutput,
          sessionId: session.sessionId,
          threadId,
          turnId,
          payload: {
            ...recordPayload(notification.params),
            text: output
          }
        });
        return;
      }
      case CodexNotificationMethod.ProcessExited:
        devTrace("codex.notification.process_exited", {
          sessionId: session.sessionId,
          threadId,
          turnId,
          processHandle: readStringField(notification.params, "processHandle"),
          exitCode: readNumberField(notification.params, "exitCode")
        });
        this.options.eventStore.append({
          type: LocalEventType.AppServerProcessExited,
          sessionId: session.sessionId,
          threadId,
          turnId,
          payload: notification.params
        });
        return;
      case CodexNotificationMethod.TurnDiffUpdated: {
        const diff = readStringField(notification.params, "diff") ?? "";
        devTrace("codex.notification.diff_updated", {
          sessionId: session.sessionId,
          threadId,
          turnId,
          diffLength: diff.length
        });
        this.options.eventStore.append({
          type: LocalEventType.DiffUpdated,
          sessionId: session.sessionId,
          threadId,
          turnId,
          payload: { diff }
        });
        return;
      }
      case CodexNotificationMethod.TurnPlanUpdated:
      case CodexNotificationMethod.PlanDelta:
        devTrace("codex.notification.plan_updated", {
          sessionId: session.sessionId,
          threadId,
          turnId,
          method: notification.method,
          ...payloadSummary(notification.params)
        });
        this.options.eventStore.append({
          type: LocalEventType.PlanUpdated,
          sessionId: session.sessionId,
          threadId,
          turnId,
          payload: notification.params
        });
        return;
      case CodexNotificationMethod.ReasoningSummaryTextDelta:
      case CodexNotificationMethod.ReasoningSummaryPartAdded:
      case CodexNotificationMethod.ReasoningTextDelta:
        devTrace("codex.notification.reasoning_delta", {
          sessionId: session.sessionId,
          threadId,
          turnId,
          method: notification.method,
          itemId: readStringField(notification.params, "itemId"),
          deltaLength: readStringField(notification.params, "delta")?.length ?? 0
        });
        this.options.eventStore.append({
          type: LocalEventType.AppServerReasoningDelta,
          sessionId: session.sessionId,
          threadId,
          turnId,
          payload: notification.params
        });
        return;
      case CodexNotificationMethod.McpToolCallProgress:
        devTrace("codex.notification.mcp_progress", {
          sessionId: session.sessionId,
          threadId,
          turnId,
          itemId: readStringField(notification.params, "itemId"),
          messageLength: readStringField(notification.params, "message")?.length ?? 0
        });
        this.options.eventStore.append({
          type: LocalEventType.AppServerMcpProgress,
          sessionId: session.sessionId,
          threadId,
          turnId,
          payload: notification.params
        });
        return;
      case CodexNotificationMethod.Error:
        devTrace("codex.notification.error", {
          sessionId: session.sessionId,
          threadId,
          turnId,
          ...payloadSummary(notification.params)
        });
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

  private decorateThreadReadResponse(
    response: ThreadReadResponse
  ): ThreadReadResponse {
    const session = this.findSessionForThread(response.thread.id);
    if (!session) {
      return response;
    }
    const thread = decorateCodexThreadForSession(session, response.thread);
    return thread === response.thread ? response : { ...response, thread };
  }

  private decorateThreadTurnsResponse(
    threadId: string,
    response: ThreadTurnsListResponse
  ): ThreadTurnsListResponse {
    const session = this.findSessionForThread(threadId);
    if (!session) {
      return response;
    }
    const turns = decorateCodexTurnsForSession(session, response.data);
    return turns === response.data ? response : { ...response, data: turns };
  }

  private findSessionForThread(threadId: string): LocalSession | null {
    return (
      [...this.sessions.values()].find((session) => session.threadId === threadId) ??
      null
    );
  }

  private emitSessionUpdated(session: LocalSession): void {
    devTrace("session.emit.updated", {
      ...localSessionTraceFields(session)
    });
    this.options.eventStore.append({
      type: LocalEventType.SessionUpdated,
      sessionId: session.sessionId,
      threadId: session.threadId,
      turnId: session.currentTurnId,
      payload: toSummary(session)
    });
  }

  private emitChatUser(
    session: LocalSession,
    input: {
      text: string;
      mode: "turn-start" | "steer";
      clientMessageId?: string;
      turnId?: string;
    }
  ): void {
    devTrace("session.emit.chat_user", {
      sessionId: session.sessionId,
      threadId: session.threadId,
      turnId: input.turnId,
      mode: input.mode,
      clientMessageId: input.clientMessageId,
      textLength: input.text.length
    });
    this.options.eventStore.append({
      type: LocalEventType.ChatUser,
      sessionId: session.sessionId,
      threadId: session.threadId,
      ...(input.turnId ? { turnId: input.turnId } : {}),
      payload: {
        text: input.text,
        mode: input.mode,
        ...(input.clientMessageId
          ? { clientMessageId: input.clientMessageId }
          : {})
      }
    });
  }

  private emitAgentError(
    session: LocalSession,
    input: {
      message: string;
      clientMessageId?: string;
      turnId?: string;
    }
  ): void {
    devTrace("session.emit.agent_error", {
      sessionId: session.sessionId,
      threadId: session.threadId,
      turnId: input.turnId,
      clientMessageId: input.clientMessageId,
      messageLength: input.message.length
    });
    this.options.eventStore.append({
      type: LocalEventType.AgentError,
      sessionId: session.sessionId,
      threadId: session.threadId,
      ...(input.turnId ? { turnId: input.turnId } : {}),
      payload: {
        message: input.message,
        ...(input.clientMessageId
          ? { clientMessageId: input.clientMessageId }
          : {})
      }
    });
  }
}

const MAX_PENDING_USER_INPUTS = 200;

function recordUserInput(
  session: LocalSession,
  input: {
    text: string;
    mode: PendingUserInputRecord["mode"];
    clientMessageId?: string | undefined;
    turnId?: string | undefined;
  }
): void {
  if (!input.clientMessageId) {
    return;
  }
  const record: PendingUserInputRecord = {
    clientMessageId: input.clientMessageId,
    mode: input.mode,
    order: session.nextUserInputOrder,
    text: input.text
  };
  session.nextUserInputOrder += 1;
  if (input.turnId) {
    record.turnId = input.turnId;
  }
  session.pendingUserInputs.push(record);
  if (session.pendingUserInputs.length > MAX_PENDING_USER_INPUTS) {
    session.pendingUserInputs.splice(
      0,
      session.pendingUserInputs.length - MAX_PENDING_USER_INPUTS
    );
  }
}

function bindUserInputTurn(
  session: LocalSession,
  clientMessageId: string | undefined,
  turnId: string
): void {
  if (!clientMessageId) {
    return;
  }
  const record = [...session.pendingUserInputs]
    .reverse()
    .find((item) => item.clientMessageId === clientMessageId);
  if (record && !record.turnId) {
    record.turnId = turnId;
  }
}

function decorateAppServerNotification(
  session: LocalSession,
  notification: AppServerNotification
): AppServerNotification {
  if (!isRecord(notification.params)) {
    return notification;
  }
  switch (notification.method) {
    case CodexNotificationMethod.ItemStarted:
    case CodexNotificationMethod.ItemCompleted: {
      const params = decorateItemLifecycleParams(session, notification.params);
      return params === notification.params ? notification : { ...notification, params };
    }
    case CodexNotificationMethod.TurnStarted:
    case CodexNotificationMethod.TurnCompleted: {
      const params = decorateTurnNotificationParams(session, notification.params);
      return params === notification.params ? notification : { ...notification, params };
    }
    default:
      return notification;
  }
}

function decorateItemLifecycleParams(
  session: LocalSession,
  params: Record<string, unknown>
): Record<string, unknown> {
  if (!isRecord(params.item)) {
    return params;
  }
  const turnId = typeof params.turnId === "string" ? params.turnId : undefined;
  const item = params.item as unknown as CodexThreadItem;
  const decoratedItem = decorateCodexThreadItemForSession(session, turnId, item);
  return decoratedItem === item ? params : { ...params, item: decoratedItem };
}

function decorateTurnNotificationParams(
  session: LocalSession,
  params: Record<string, unknown>
): Record<string, unknown> {
  if (!isRecord(params.turn)) {
    return params;
  }
  const turn = params.turn as unknown as CodexThreadTurn;
  const decoratedTurn = decorateCodexTurnForSession(session, turn);
  return decoratedTurn === turn ? params : { ...params, turn: decoratedTurn };
}

function decorateCodexThreadForSession(
  session: LocalSession,
  thread: CodexThread
): CodexThread {
  if (!Array.isArray(thread.turns)) {
    return thread;
  }
  const turns = decorateCodexTurnsForSession(session, thread.turns);
  return turns === thread.turns ? thread : { ...thread, turns };
}

function decorateCodexTurnsForSession(
  session: LocalSession,
  turns: CodexThreadTurn[]
): CodexThreadTurn[] {
  let changed = false;
  const decoratedTurns = turns.map((turn) => {
    const decoratedTurn = decorateCodexTurnForSession(session, turn);
    if (decoratedTurn !== turn) {
      changed = true;
    }
    return decoratedTurn;
  });
  return changed ? decoratedTurns : turns;
}

function decorateCodexTurnForSession(
  session: LocalSession,
  turn: CodexThreadTurn
): CodexThreadTurn {
  if (!Array.isArray(turn.items)) {
    return turn;
  }
  let changed = false;
  const items = turn.items.map((item) => {
    const decoratedItem = decorateCodexThreadItemForSession(session, turn.id, item);
    if (decoratedItem !== item) {
      changed = true;
    }
    return decoratedItem;
  });
  return changed ? { ...turn, items } : turn;
}

function decorateCodexThreadItemForSession(
  session: LocalSession,
  turnId: string | undefined,
  item: CodexThreadItem
): CodexThreadItem {
  if (item.type !== "userMessage") {
    return item;
  }
  if (typeof item.clientId === "string" && item.clientId.trim()) {
    session.userItemClientIds[item.id] = item.clientId;
    return item;
  }
  const mappedClientId = session.userItemClientIds[item.id];
  if (mappedClientId) {
    return { ...item, clientId: mappedClientId };
  }

  const record = findUserInputRecordForItem(session, turnId, item);
  if (!record) {
    return item;
  }
  record.itemId = item.id;
  if (turnId && !record.turnId) {
    record.turnId = turnId;
  }
  session.userItemClientIds[item.id] = record.clientMessageId;
  devTrace("session.input.client_id.decorated", {
    sessionId: session.sessionId,
    threadId: session.threadId,
    turnId,
    itemId: item.id,
    clientMessageId: record.clientMessageId,
    mode: record.mode
  });
  return { ...item, clientId: record.clientMessageId };
}

function findUserInputRecordForItem(
  session: LocalSession,
  turnId: string | undefined,
  item: CodexThreadItem
): PendingUserInputRecord | null {
  const itemText = normalizeUserInputText(readUserMessageText(item));
  const candidates = session.pendingUserInputs
    .filter((record) => !record.itemId || record.itemId === item.id)
    .filter((record) => !turnId || !record.turnId || record.turnId === turnId)
    .sort((left, right) => left.order - right.order);

  if (itemText) {
    return (
      candidates.find(
        (record) => normalizeUserInputText(record.text) === itemText
      ) ?? null
    );
  }

  return candidates.length === 1 ? candidates[0] ?? null : null;
}

function readUserMessageText(item: CodexThreadItem): string {
  if (Array.isArray(item.content)) {
    return item.content
      .map((part) =>
        isRecord(part) && part.type === "text" && typeof part.text === "string"
          ? part.text
          : ""
      )
      .filter(Boolean)
      .join("\n");
  }
  return typeof item.text === "string" ? item.text : "";
}

function normalizeUserInputText(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
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

function extractThreadReadCwd(response: ThreadReadResponse): string | undefined {
  if (typeof response.thread?.cwd === "string") {
    return response.thread.cwd;
  }
  return undefined;
}

async function readThreadTitle(
  client: ManagedCodexClient,
  threadId: string
): Promise<string | null> {
  try {
    const response = await client.threadRead({
      threadId,
      includeTurns: true
    });
    return deriveCodexConversationTitle(response.thread);
  } catch {
    return null;
  }
}

function isArchivedThreadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(" is archived") || message.includes("codex unarchive");
}

function isMissingRolloutThreadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("no rollout found for thread id");
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

function extractThreadStatusType(params: unknown): string | null {
  if (!isRecord(params)) {
    return null;
  }
  const status =
    isRecord(params.status)
      ? params.status
      : isRecord(params.thread) && isRecord(params.thread.status)
        ? params.thread.status
        : null;
  if (status && typeof status.type === "string") {
    return status.type;
  }
  if (typeof params.status === "string") {
    return params.status;
  }
  return null;
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
  const previousStatus = session.status;
  const previousUpdatedAt = session.updatedAt;
  if (status) {
    session.status = status;
  }
  session.updatedAt = Date.now();
  devTrace("session.touch", {
    sessionId: session.sessionId,
    threadId: session.threadId,
    previousStatus,
    nextStatus: session.status,
    statusChanged: previousStatus !== session.status,
    previousUpdatedAt,
    nextUpdatedAt: session.updatedAt,
    activeTurnId: session.activeTurnId,
    currentTurnId: session.currentTurnId
  });
}

function normalizeTitle(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toSummary(session: LocalSession): LocalSessionSummary {
  return {
    sessionId: session.sessionId,
    threadId: session.threadId,
    ...(session.currentTurnId ? { currentTurnId: session.currentTurnId } : {}),
    ...(session.activeTurnId ? { activeTurnId: session.activeTurnId } : {}),
    status: session.status,
    cwd: session.cwd,
    title: session.title ?? null,
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

function localSessionTraceFields(session: LocalSession): Record<string, unknown> {
  return {
    sessionId: session.sessionId,
    threadId: session.threadId,
    currentTurnId: session.currentTurnId,
    activeTurnId: session.activeTurnId,
    status: session.status,
    cwd: session.cwd,
    model: session.model ?? null,
    reasoningEffort: session.reasoningEffort ?? null,
    permissionMode: session.permissionMode,
    approvalPolicy: session.approvalPolicy,
    approvalsReviewer: session.approvalsReviewer,
    sandbox: session.sandbox,
    hasGoal: Boolean(session.goal),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt
  };
}

function sessionSummaryTraceFields(
  session: LocalSessionSummary
): Record<string, unknown> {
  return {
    sessionId: session.sessionId,
    threadId: session.threadId,
    currentTurnId: session.currentTurnId,
    activeTurnId: session.activeTurnId,
    status: session.status,
    cwd: session.cwd,
    model: session.model ?? null,
    reasoningEffort: session.reasoningEffort ?? null,
    permissionMode: session.permissionMode,
    hasGoal: Boolean(session.goal),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt
  };
}

function threadListParamsTraceFields(
  params: ThreadListParams
): Record<string, unknown> {
  return {
    cursorPresent: Boolean(params.cursor),
    limit: params.limit ?? null,
    sortKey: params.sortKey ?? null,
    sortDirection: params.sortDirection ?? null,
    modelProviderCount: params.modelProviders?.length ?? 0,
    sourceKinds: params.sourceKinds ?? null,
    archived: params.archived ?? null,
    cwd:
      Array.isArray(params.cwd)
        ? { count: params.cwd.length, values: params.cwd }
        : params.cwd ?? null,
    useStateDbOnly: params.useStateDbOnly ?? false,
    searchLength: params.searchTerm?.length ?? 0
  };
}

function threadTurnsParamsTraceFields(
  params: ThreadTurnsListParams
): Record<string, unknown> {
  return {
    threadId: params.threadId,
    cursorPresent: Boolean(params.cursor),
    limit: params.limit ?? null,
    sortDirection: params.sortDirection ?? null,
    itemsView: params.itemsView ?? null
  };
}

function asCodexThread(
  thread: ThreadStartResponse["thread"],
  cwd: string
): CodexThread {
  const next: CodexThread = {
    id: typeof thread.id === "string" ? thread.id : "unknown-thread",
    preview: "",
    createdAt: 0,
    updatedAt: 0,
    cwd: typeof thread.cwd === "string" ? thread.cwd : cwd
  };
  if (typeof thread.title === "string") {
    next.title = thread.title;
  }
  if (typeof thread.name === "string") {
    next.name = thread.name;
  }
  if (Array.isArray(thread.turns)) {
    next.turns = thread.turns as NonNullable<CodexThread["turns"]>;
  }
  return next;
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

function readNumberField(params: unknown, field: string): number | undefined {
  if (!isRecord(params)) {
    return undefined;
  }
  return typeof params[field] === "number" ? params[field] : undefined;
}

function recordPayload(params: unknown): Record<string, unknown> {
  return isRecord(params) ? params : {};
}

function threadItemTraceFields(params: unknown): Record<string, unknown> {
  if (!isRecord(params) || !isRecord(params.item)) {
    return {
      itemId: null,
      itemType: null,
      renderKind: "metadata"
    };
  }
  const itemId = typeof params.item.id === "string" ? params.item.id : null;
  const itemType = typeof params.item.type === "string" ? params.item.type : null;
  return {
    itemId,
    itemType,
    renderKind: itemType
      ? codexThreadItemRenderKind({ type: itemType })
      : "metadata"
  };
}

function decodeCommandExecOutput(params: unknown): string {
  return decodeBase64Field(params, "deltaBase64");
}

function decodeBase64Field(params: unknown, field: string): string {
  const encoded = readStringField(params, field);
  if (!encoded) {
    return "";
  }
  return Buffer.from(encoded, "base64").toString("utf8");
}
