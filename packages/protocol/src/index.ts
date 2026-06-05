import { z } from "zod";

export type JsonPrimitive = string | number | boolean | null;
export type JsonObject = { [key: string]: JsonValue | undefined };
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type RequestId = number | string;

export const RequestIdSchema = z.union([z.number(), z.string()]);

export const JsonRpcErrorSchema = z
  .object({
    code: z.number(),
    message: z.string(),
    data: z.unknown().optional()
  })
  .passthrough();

export type JsonRpcErrorPayload = z.infer<typeof JsonRpcErrorSchema>;

export interface JsonRpcRequest {
  id: RequestId;
  method: string;
  params?: unknown;
  jsonrpc?: "2.0";
}

export interface JsonRpcNotification {
  method: string;
  params?: unknown;
  jsonrpc?: "2.0";
}

export interface JsonRpcResponse {
  id: RequestId;
  result?: unknown;
  error?: JsonRpcErrorPayload;
  jsonrpc?: "2.0";
}

export type JsonRpcInboundMessage =
  | JsonRpcRequest
  | JsonRpcNotification
  | JsonRpcResponse;

export type JsonRpcOutboundMessage =
  | JsonRpcRequest
  | JsonRpcNotification
  | JsonRpcResponse;

export const CodexClientMethod = {
  Initialize: "initialize",
  Initialized: "initialized",
  ThreadStart: "thread/start",
  ThreadGoalSet: "thread/goal/set",
  ThreadGoalGet: "thread/goal/get",
  ThreadGoalClear: "thread/goal/clear",
  TurnStart: "turn/start",
  TurnSteer: "turn/steer",
  TurnInterrupt: "turn/interrupt"
} as const;

export type CodexClientMethod =
  (typeof CodexClientMethod)[keyof typeof CodexClientMethod];

export const CodexNotificationMethod = {
  Error: "error",
  Warning: "warning",
  ThreadStarted: "thread/started",
  ThreadStatusChanged: "thread/status/changed",
  ThreadGoalUpdated: "thread/goal/updated",
  ThreadGoalCleared: "thread/goal/cleared",
  TurnStarted: "turn/started",
  TurnPlanUpdated: "turn/plan/updated",
  PlanDelta: "item/plan/delta",
  AgentMessageDelta: "item/agentMessage/delta",
  CommandExecOutputDelta: "command/exec/outputDelta",
  CommandExecutionOutputDelta: "item/commandExecution/outputDelta",
  FileChangeOutputDelta: "item/fileChange/outputDelta",
  FileChangePatchUpdated: "item/fileChange/patchUpdated",
  TurnDiffUpdated: "turn/diff/updated",
  TurnCompleted: "turn/completed",
  ServerRequestResolved: "serverRequest/resolved"
} as const;

export type CodexNotificationMethod =
  (typeof CodexNotificationMethod)[keyof typeof CodexNotificationMethod];

export const CodexServerRequestMethod = {
  CommandExecutionRequestApproval: "item/commandExecution/requestApproval",
  FileChangeRequestApproval: "item/fileChange/requestApproval",
  PermissionsRequestApproval: "item/permissions/requestApproval",
  ToolRequestUserInput: "item/tool/requestUserInput",
  McpElicitationRequest: "mcpServer/elicitation/request",
  LegacyExecCommandApproval: "execCommandApproval",
  LegacyApplyPatchApproval: "applyPatchApproval"
} as const;

export type CodexServerRequestMethod =
  (typeof CodexServerRequestMethod)[keyof typeof CodexServerRequestMethod];

export const ClientInfoSchema = z.object({
  name: z.string().min(1),
  title: z.string().min(1),
  version: z.string().min(1)
});

export type ClientInfo = z.infer<typeof ClientInfoSchema>;

export const InitializeCapabilitiesSchema = z.object({
  experimentalApi: z.boolean(),
  requestAttestation: z.boolean(),
  optOutNotificationMethods: z.array(z.string()).nullish()
});

export type InitializeCapabilities = z.infer<
  typeof InitializeCapabilitiesSchema
>;

export const InitializeParamsSchema = z.object({
  clientInfo: ClientInfoSchema,
  capabilities: InitializeCapabilitiesSchema.nullable()
});

export type InitializeParams = z.infer<typeof InitializeParamsSchema>;

export interface InitializeResponse {
  userAgent: string;
  codexHome: string;
  platformFamily: string;
  platformOs: string;
}

export type ThreadGoalStatus =
  | "active"
  | "paused"
  | "blocked"
  | "usageLimited"
  | "budgetLimited"
  | "complete";

export interface ThreadGoal {
  threadId: string;
  objective: string;
  status: ThreadGoalStatus;
  tokenBudget: number | null;
  tokensUsed: number;
  timeUsedSeconds: number;
  createdAt: number;
  updatedAt: number;
}

export interface ThreadGoalSetParams {
  threadId: string;
  objective?: string | null;
  status?: ThreadGoalStatus | null;
  tokenBudget?: number | null;
}

export interface ThreadGoalGetParams {
  threadId: string;
}

export interface ThreadGoalClearParams {
  threadId: string;
}

export interface ThreadGoalSetResponse {
  goal: ThreadGoal;
}

export interface ThreadGoalGetResponse {
  goal: ThreadGoal | null;
}

export interface ThreadGoalClearResponse {
  goal?: ThreadGoal | null;
}

export type AskForApproval =
  | "untrusted"
  | "on-failure"
  | "on-request"
  | "never";

export type ApprovalsReviewer = "user" | "auto_review" | "guardian_subagent";
export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";

export interface ThreadStartParams {
  model?: string | null;
  modelProvider?: string | null;
  cwd?: string | null;
  runtimeWorkspaceRoots?: string[] | null;
  approvalPolicy?: AskForApproval | null;
  approvalsReviewer?: ApprovalsReviewer | null;
  sandbox?: SandboxMode | null;
  ephemeral?: boolean | null;
  serviceName?: string | null;
}

export interface ThreadStartResponse {
  thread: {
    id: string;
    status?: unknown;
    cwd?: string;
    [key: string]: unknown;
  };
}

export type UserInput =
  | {
      type: "text";
      text: string;
      text_elements: unknown[];
    }
  | {
      type: "image";
      detail?: "auto" | "low" | "high";
      url: string;
    }
  | {
      type: "localImage";
      detail?: "auto" | "low" | "high";
      path: string;
    };

export function makeTextInput(text: string): UserInput {
  return { type: "text", text, text_elements: [] };
}

export interface TurnStartParams {
  threadId: string;
  input: UserInput[];
  cwd?: string | null;
  runtimeWorkspaceRoots?: string[] | null;
  approvalPolicy?: AskForApproval | null;
  approvalsReviewer?: ApprovalsReviewer | null;
  model?: string | null;
}

export interface Turn {
  id: string;
  status?: "completed" | "interrupted" | "failed" | "inProgress";
  [key: string]: unknown;
}

export interface TurnStartResponse {
  turn: Turn;
}

export interface TurnSteerParams {
  threadId: string;
  expectedTurnId: string;
  input: UserInput[];
}

export interface TurnInterruptParams {
  threadId: string;
  turnId: string;
}

export type CommandExecutionApprovalDecision =
  | "accept"
  | "acceptForSession"
  | "decline"
  | "cancel"
  | JsonObject;

export type FileChangeApprovalDecision =
  | "accept"
  | "acceptForSession"
  | "decline"
  | "cancel";

export interface CommandExecutionRequestApprovalResponse {
  decision: CommandExecutionApprovalDecision;
}

export interface FileChangeRequestApprovalResponse {
  decision: FileChangeApprovalDecision;
}

export type LegacyReviewDecision =
  | "approved"
  | "approved_for_session"
  | "denied"
  | "timed_out"
  | "abort"
  | JsonObject;

export interface LegacyApprovalResponse {
  decision: LegacyReviewDecision;
}

export type ApprovalResponse =
  | CommandExecutionRequestApprovalResponse
  | FileChangeRequestApprovalResponse
  | LegacyApprovalResponse;

export interface AppServerNotification {
  method: string;
  params?: unknown;
}

export const GoalSmokeOptionsSchema = z.object({
  cwd: z.string().min(1),
  goal: z.string().min(1),
  model: z.string().min(1).optional(),
  tokenBudget: z.number().int().positive().optional()
});

export type GoalSmokeOptions = z.infer<typeof GoalSmokeOptionsSchema>;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

