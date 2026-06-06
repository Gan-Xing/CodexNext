import { stat } from "node:fs/promises";
import path from "node:path";
import pino from "pino";
import {
  CodexAppServerClient,
  JsonRpcResponseError,
  JsonRpcTimeoutError
} from "@codexnext/codex-client";
import {
  CodexNotificationMethod,
  GoalSmokeOptionsSchema,
  makeTextInput,
  type AppServerNotification,
  type ApprovalResponse,
  type GoalSmokeOptions,
  type ThreadStartResponse,
  type TurnStartResponse
} from "@codexnext/protocol";
import {
  printError,
  printJson,
  printLine,
  printSection,
  safeJson
} from "../output.js";

export async function runGoalSmoke(rawOptions: GoalSmokeOptions): Promise<void> {
  const options = GoalSmokeOptionsSchema.parse(rawOptions);
  const cwd = path.resolve(options.cwd);
  await assertDirectory(cwd);

  const logger = pino({
    name: "codexnext-agent",
    level: process.env.LOG_LEVEL ?? "warn"
  });

  let threadId: string | undefined;
  let turnId: string | undefined;
  let finalTurnStatus: string | undefined;
  let interrupting = false;
  let resolveTurnCompleted: (() => void) | undefined;
  const turnCompleted = new Promise<void>((resolve) => {
    resolveTurnCompleted = resolve;
  });

  const appServer = CodexAppServerClient.connectStdio(
    {
      command: "codex",
      args: ["app-server", "--stdio"],
      cwd,
      stderr: process.env.LOG_LEVEL === "debug" ? "emit" : "ignore"
    },
    {
      defaultTimeoutMs: 60_000,
      onApprovalRequest: async (request): Promise<ApprovalResponse | undefined> => {
        printSection("approval request", request.method);
        printLine("Default phase-1 decision: decline.");
        printJson("approval payload", request.params);
        return undefined;
      }
    }
  );

  const removeNotificationListener = appServer.onNotification((notification) => {
    const notificationTurnId = extractNotificationTurnId(notification);
    if (
      notification.method === CodexNotificationMethod.TurnStarted &&
      notificationTurnId
    ) {
      turnId = notificationTurnId;
    }
    handleNotification(notification, {
      getThreadId: () => threadId,
      getTurnId: () => turnId,
      onTurnCompleted: (status) => {
        finalTurnStatus = status;
        resolveTurnCompleted?.();
      }
    });
  });

  const removeSigint = installSigintHandler(async () => {
    if (interrupting) {
      return;
    }
    interrupting = true;
    printLine("");
    printSection("interrupt", "Ctrl+C received.");

    if (threadId && turnId) {
      try {
        await appServer.turnInterrupt({ threadId, turnId });
        printSection("interrupt", `turn/interrupt sent for ${turnId}`);
      } catch (error) {
        printError(`Failed to interrupt turn: ${formatError(error)}`);
      }
    }

    await appServer.close();
    process.exit(130);
  });

  try {
    printSection("connect", "starting codex app-server over stdio");

    const initialized = await appServer.initialize();
    logger.debug({ initialized }, "codex app-server initialized");
    printSection(
      "initialize",
      `${initialized.userAgent} (${initialized.platformFamily}/${initialized.platformOs})`
    );

    await appServer.initialized();
    printSection("initialized", "notification sent");

    const thread = await appServer.threadStart({
      cwd,
      runtimeWorkspaceRoots: [cwd],
      model: options.model ?? null,
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      sandbox: "workspace-write",
      ephemeral: false,
      serviceName: "codexnext"
    });
    threadId = extractThreadId(thread);
    printSection("thread/start", threadId);

    const goal = await appServer.setGoal({
      threadId,
      objective: options.goal,
      status: "active",
      tokenBudget: options.tokenBudget ?? null
    });
    printSection(
      "thread/goal/set",
      `${goal.goal.status}: ${goal.goal.objective}`
    );

    const turn = await appServer.turnStart({
      threadId,
      input: [makeTextInput(options.goal)],
      cwd,
      runtimeWorkspaceRoots: [cwd],
      model: options.model ?? null,
      approvalPolicy: "on-request",
      approvalsReviewer: "user"
    });
    const responseTurnId = extractTurnId(turn);
    if (!turnId) {
      turnId = responseTurnId;
    }
    printSection(
      "turn/start",
      turnId === responseTurnId
        ? responseTurnId
        : `response ${responseTurnId}; active ${turnId}`
    );

    await turnCompleted;
    const exitCode = goalSmokeExitCode(finalTurnStatus);
    if (exitCode !== 0) {
      process.exitCode = exitCode;
      throw new Error(
        `goal-smoke finished with non-completed turn status: ${
          finalTurnStatus ?? "unknown"
        }`
      );
    }
  } catch (error) {
    throw new Error(formatGoalSmokeError(error));
  } finally {
    removeNotificationListener();
    removeSigint();
    await appServer.close();
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

function extractThreadId(response: ThreadStartResponse): string {
  if (typeof response.thread?.id === "string") {
    return response.thread.id;
  }
  throw new Error(`thread/start response did not include thread.id: ${safeJson(response)}`);
}

function extractTurnId(response: TurnStartResponse): string {
  if (typeof response.turn?.id === "string") {
    return response.turn.id;
  }
  throw new Error(`turn/start response did not include turn.id: ${safeJson(response)}`);
}

function extractNotificationTurnId(notification: AppServerNotification): string | undefined {
  const params = notification.params;
  if (!isRecord(params) || !isRecord(params.turn)) {
    return undefined;
  }
  return typeof params.turn.id === "string" ? params.turn.id : undefined;
}

function handleNotification(
  notification: AppServerNotification,
  context: {
    getThreadId: () => string | undefined;
    getTurnId: () => string | undefined;
    onTurnCompleted: (status: string | undefined) => void;
  }
): void {
  const params = notification.params;

  switch (notification.method) {
    case CodexNotificationMethod.ThreadStatusChanged:
      printSection("thread status", summarizeThreadStatus(params));
      return;
    case CodexNotificationMethod.ThreadGoalUpdated:
      printSection("goal updated", summarizeGoal(params));
      return;
    case CodexNotificationMethod.ThreadGoalCleared:
      printSection("goal cleared", safeJson(params));
      return;
    case CodexNotificationMethod.TurnStarted:
      printSection("turn started", summarizeTurnStarted(params));
      return;
    case CodexNotificationMethod.TurnPlanUpdated:
      printSection("plan updated", summarizePlan(params));
      return;
    case CodexNotificationMethod.PlanDelta:
      printSection("plan delta", readStringField(params, "delta") ?? safeJson(params));
      return;
    case CodexNotificationMethod.AgentMessageDelta:
      process.stdout.write(readStringField(params, "delta") ?? "");
      return;
    case CodexNotificationMethod.CommandExecOutputDelta:
      process.stdout.write(decodeCommandExecOutput(params));
      return;
    case CodexNotificationMethod.CommandExecutionOutputDelta:
      process.stdout.write(readStringField(params, "delta") ?? "");
      return;
    case CodexNotificationMethod.FileChangeOutputDelta:
      process.stdout.write(readStringField(params, "delta") ?? "");
      return;
    case CodexNotificationMethod.FileChangePatchUpdated:
      printSection("file patch updated", safeJson(params));
      return;
    case CodexNotificationMethod.TurnDiffUpdated:
      printSection("diff updated", readStringField(params, "diff") ?? safeJson(params));
      return;
    case CodexNotificationMethod.TurnCompleted:
      printLine("");
      printSection("turn completed", summarizeTurnCompleted(params));
      if (matchesTurn(params, context.getThreadId(), context.getTurnId())) {
        context.onTurnCompleted(extractTurnStatus(params));
      }
      return;
    case CodexNotificationMethod.ServerRequestResolved:
      printSection("approval resolved", safeJson(params));
      return;
    case CodexNotificationMethod.Error:
    case CodexNotificationMethod.Warning:
      printSection(notification.method, safeJson(params));
      return;
    default:
      printSection("event", notification.method);
  }
}

function summarizeThreadStatus(params: unknown): string {
  if (!isRecord(params)) {
    return safeJson(params);
  }
  return `${String(params.threadId ?? "unknown")} ${safeJson(params.status)}`;
}

function summarizeGoal(params: unknown): string {
  if (!isRecord(params) || !isRecord(params.goal)) {
    return safeJson(params);
  }
  const goal = params.goal;
  return `${String(goal.status ?? "unknown")}: ${String(goal.objective ?? "")}`;
}

function summarizeTurnStarted(params: unknown): string {
  if (!isRecord(params) || !isRecord(params.turn)) {
    return safeJson(params);
  }
  const turn = params.turn;
  return `${String(turn.id ?? "unknown")} ${String(turn.status ?? "")}`.trim();
}

function summarizePlan(params: unknown): string {
  if (!isRecord(params)) {
    return safeJson(params);
  }
  const explanation =
    typeof params.explanation === "string" ? `${params.explanation}\n` : "";
  const plan = Array.isArray(params.plan)
    ? params.plan
        .map((step, index) => {
          if (!isRecord(step)) {
            return `${index + 1}. ${safeJson(step)}`;
          }
          return `${index + 1}. [${String(step.status ?? "unknown")}] ${String(
            step.step ?? ""
          )}`;
        })
        .join("\n")
    : safeJson(params.plan);
  return `${explanation}${plan}`;
}

function summarizeTurnCompleted(params: unknown): string {
  if (!isRecord(params) || !isRecord(params.turn)) {
    return safeJson(params);
  }
  const turn = params.turn;
  return `${String(turn.id ?? "unknown")} ${String(turn.status ?? "unknown")}`;
}

function extractTurnStatus(params: unknown): string | undefined {
  if (!isRecord(params) || !isRecord(params.turn)) {
    return undefined;
  }
  return typeof params.turn.status === "string" ? params.turn.status : undefined;
}

export function goalSmokeExitCode(status: string | undefined): number {
  return status === "completed" ? 0 : 1;
}

function matchesTurn(
  params: unknown,
  threadId: string | undefined,
  turnId: string | undefined
): boolean {
  if (!isRecord(params)) {
    return false;
  }
  const turn = isRecord(params.turn) ? params.turn : undefined;
  const incomingThreadId = typeof params.threadId === "string" ? params.threadId : undefined;
  const incomingTurnId = typeof turn?.id === "string" ? turn.id : undefined;

  return (
    (!threadId || incomingThreadId === threadId) &&
    (!turnId || incomingTurnId === turnId)
  );
}

function decodeCommandExecOutput(params: unknown): string {
  if (!isRecord(params) || typeof params.deltaBase64 !== "string") {
    return safeJson(params);
  }
  return Buffer.from(params.deltaBase64, "base64").toString("utf8");
}

function readStringField(params: unknown, field: string): string | undefined {
  if (!isRecord(params)) {
    return undefined;
  }
  return typeof params[field] === "string" ? params[field] : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function installSigintHandler(onSigint: () => Promise<void>): () => void {
  const handler = () => {
    void onSigint();
  };
  process.once("SIGINT", handler);
  return () => process.off("SIGINT", handler);
}

function formatGoalSmokeError(error: unknown): string {
  if (error instanceof JsonRpcTimeoutError) {
    return `${error.message}\nFix: make sure codex app-server is responsive, Codex is logged in, and the selected cwd is accessible.`;
  }
  if (error instanceof JsonRpcResponseError) {
    return `codex app-server returned an error for ${error.method ?? "request"}: ${error.message}\nFix: check Codex login state, model access, cwd permissions, and app-server compatibility.`;
  }
  return formatError(error);
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
