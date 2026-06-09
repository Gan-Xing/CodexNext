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
  ThreadResume: "thread/resume",
  ThreadUnarchive: "thread/unarchive",
  ThreadList: "thread/list",
  ThreadRead: "thread/read",
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
export type LocalPermissionMode =
  | "request-approval"
  | "auto-approve"
  | "full-access"
  | "custom-config";
export type LocalReasoningEffort = "low" | "medium" | "high" | "xhigh";

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

export interface ThreadResumeParams {
  threadId: string;
  model?: string | null;
  modelProvider?: string | null;
  serviceTier?: string | null;
  cwd?: string | null;
  approvalPolicy?: AskForApproval | null;
  approvalsReviewer?: ApprovalsReviewer | null;
  sandbox?: SandboxMode | null;
  config?: JsonObject | null;
  baseInstructions?: string | null;
  developerInstructions?: string | null;
  personality?: JsonObject | null;
}

export interface ThreadResumeResponse extends ThreadStartResponse {
  model?: string;
  modelProvider?: string;
  serviceTier?: string | null;
  cwd?: string;
  approvalPolicy?: AskForApproval;
  approvalsReviewer?: ApprovalsReviewer;
  reasoningEffort?: LocalReasoningEffort | "none" | "minimal" | null;
  instructionSources?: string[];
}

export interface ThreadUnarchiveParams {
  threadId: string;
}

export type ThreadUnarchiveResponse = Record<string, never>;

export type ThreadSortKey = "created_at" | "updated_at";
export type SortDirection = "asc" | "desc";

export type ThreadSourceKind =
  | "cli"
  | "vscode"
  | "exec"
  | "appServer"
  | "mcp"
  | "custom"
  | "subAgent"
  | "unknown";

export interface ThreadListParams {
  cursor?: string | null;
  limit?: number | null;
  sortKey?: ThreadSortKey | null;
  sortDirection?: SortDirection | null;
  modelProviders?: string[] | null;
  sourceKinds?: ThreadSourceKind[] | null;
  archived?: boolean | null;
  cwd?: string | string[] | null;
  useStateDbOnly?: boolean;
  searchTerm?: string | null;
}

export interface CodexThread {
  id: string;
  sessionId?: string;
  preview: string;
  createdAt: number;
  updatedAt: number;
  status?: unknown;
  cwd: string;
  cliVersion?: string;
  source?: unknown;
  title?: string | null;
  name?: string | null;
  path?: string | null;
  turns?: CodexThreadTurn[];
  [key: string]: unknown;
}

export interface CodexThreadTurn {
  id: string;
  items: CodexThreadItem[];
  params?: unknown;
  status?: unknown;
  startedAt?: number | null;
  completedAt?: number | null;
  [key: string]: unknown;
}

export type CodexThreadItem = {
  id?: string;
  type?: string;
  content?: unknown;
  text?: string;
  summary?: string[];
  command?: string;
  aggregatedOutput?: string | null;
  changes?: unknown[];
  [key: string]: unknown;
};

export interface ThreadListResponse {
  data: CodexThread[];
  nextCursor: string | null;
  backwardsCursor: string | null;
}

export interface ThreadReadParams {
  threadId: string;
  includeTurns?: boolean;
}

export interface ThreadReadResponse {
  thread: CodexThread;
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

export const LocalEventType = {
  AgentHealth: "agent.health",
  AgentError: "agent.error",
  SessionCreated: "session.created",
  SessionUpdated: "session.updated",
  SessionClosed: "session.closed",
  GoalUpdated: "goal.updated",
  GoalCleared: "goal.cleared",
  TurnStarted: "turn.started",
  TurnCompleted: "turn.completed",
  TurnSteerAccepted: "turn.steer.accepted",
  TurnInterruptRequested: "turn.interrupt.requested",
  ApprovalRequested: "approval.requested",
  ApprovalResolved: "approval.resolved",
  CodexNotification: "codex.notification",
  CodexError: "codex.error",
  ChatUser: "chat.user",
  ChatAssistantDelta: "chat.assistant.delta",
  CommandOutputDelta: "command.output.delta",
  DiffUpdated: "diff.updated",
  PlanUpdated: "plan.updated"
} as const;

export type LocalEventType =
  (typeof LocalEventType)[keyof typeof LocalEventType];

export interface LocalEvent {
  id: string;
  seq: number;
  type: LocalEventType;
  ts: number;
  sessionId?: string;
  threadId?: string;
  turnId?: string;
  payload?: unknown;
}

export type LocalSessionStatus =
  | "idle"
  | "running"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "interrupted"
  | "error";

export interface LocalSessionSummary {
  sessionId: string;
  threadId?: string;
  currentTurnId?: string;
  activeTurnId?: string;
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
}

export const LocalApprovalDecisionSchema = z.object({
  decision: z.enum(["accept", "acceptForSession", "decline", "cancel"])
});

export type LocalApprovalDecision = z.infer<
  typeof LocalApprovalDecisionSchema
>["decision"];

export const LocalStartSessionSchema = z.object({
  cwd: z.string().min(1),
  model: z.string().min(1).nullable().optional(),
  permissionMode: z
    .enum(["request-approval", "auto-approve", "full-access", "custom-config"])
    .default("request-approval"),
  approvalPolicy: z
    .enum(["untrusted", "on-failure", "on-request", "never"])
    .nullable()
    .optional(),
  reasoningEffort: z
    .enum(["low", "medium", "high", "xhigh"])
    .nullable()
    .optional(),
  approvalsReviewer: z
    .enum(["user", "auto_review", "guardian_subagent"])
    .nullable()
    .optional(),
  sandbox: z
    .enum(["read-only", "workspace-write", "danger-full-access"])
    .nullable()
    .optional(),
  tokenBudget: z.number().int().positive().nullable().optional(),
  initialGoal: z.string().nullable().optional(),
  initialMessage: z.string().nullable().optional(),
  clientMessageId: z.string().min(1).optional()
});

export type LocalStartSessionInput = z.infer<typeof LocalStartSessionSchema>;

export const LocalResumeSessionSchema = z.object({
  id: z.string().min(1),
  cwd: z.string().min(1).optional(),
  model: z.string().min(1).nullable().optional(),
  permissionMode: z
    .enum(["request-approval", "auto-approve", "full-access", "custom-config"])
    .default("request-approval"),
  approvalPolicy: z
    .enum(["untrusted", "on-failure", "on-request", "never"])
    .nullable()
    .optional(),
  reasoningEffort: z
    .enum(["low", "medium", "high", "xhigh"])
    .nullable()
    .optional(),
  approvalsReviewer: z
    .enum(["user", "auto_review", "guardian_subagent"])
    .nullable()
    .optional(),
  sandbox: z
    .enum(["read-only", "workspace-write", "danger-full-access"])
    .nullable()
    .optional()
});

export type LocalResumeSessionInput = z.infer<typeof LocalResumeSessionSchema>;

export const LocalSendMessageSchema = z.object({
  text: z.string().min(1),
  clientMessageId: z.string().min(1).optional()
});

export type LocalSendMessageInput = z.infer<typeof LocalSendMessageSchema>;

export interface LocalDirectoryEntry {
  name: string;
  path: string;
}

export interface LocalDirectoryListResponse {
  path: string;
  parentPath: string | null;
  homePath: string;
  entries: LocalDirectoryEntry[];
}

export interface LocalCodexHistoryEntry {
  id: string;
  cwd: string;
  cwdExists?: boolean;
  title: string;
  createdAt: string;
  updatedAt: string;
  source: string;
}

export type LocalCodexHistoryMessageRole =
  | "user"
  | "assistant"
  | "command"
  | "system"
  | "diff";

export interface LocalCodexHistoryMessage {
  id: string;
  role: LocalCodexHistoryMessageRole;
  text: string;
  ts: string;
}

export interface LocalCodexHistoryResponse {
  root: string;
  entries: LocalCodexHistoryEntry[];
}

export interface LocalCodexHistoryDetailResponse {
  entry: LocalCodexHistoryEntry;
  messages: LocalCodexHistoryMessage[];
}

export interface LocalResumeSessionResponse {
  session: LocalSessionSummary;
  history: LocalCodexHistoryDetailResponse;
}

export const LocalSetGoalSchema = z.object({
  objective: z.string().nullable().optional(),
  status: z
    .enum([
      "active",
      "paused",
      "blocked",
      "usageLimited",
      "budgetLimited",
      "complete"
    ])
    .nullable()
    .optional(),
  tokenBudget: z.number().int().positive().nullable().optional()
});

export type LocalSetGoalInput = z.infer<typeof LocalSetGoalSchema>;

export interface LocalHealthResponse {
  ok: boolean;
  version: string;
  pid: number;
  uptimeSeconds: number;
  host: string;
  port: number;
  device?: {
    defaultName: string;
    hostname: string;
    platform: string;
  };
  codex?: {
    available: boolean;
    version?: string;
  };
}

export const RelaySocketPath = "/socket.io/codexnext";

export const RelayNamespace = {
  User: "/user",
  Machine: "/machine"
} as const;

export type RelayNamespace =
  (typeof RelayNamespace)[keyof typeof RelayNamespace];

export type AgentConnection =
  | {
      mode: "direct";
      agentUrl: string;
      token: string;
    }
  | {
      mode: "relay";
      relayUrl: string;
      sessionToken: string;
      deviceId: string;
    };

export interface RelayUserAuth {
  clientType: "user";
  sessionToken: string;
  lastSeqByDevice?: Record<string, number>;
}

export interface RelayMachineAuth {
  clientType: "machine";
  ownerToken?: string;
  deviceId: string;
  deviceToken?: string;
  devicePublicKey?: string;
  lastSeq?: number;
}

export interface DeviceIdentityFile {
  version: 1;
  deviceId: string;
  deviceName: string;
  devicePrivateKey?: string;
  devicePublicKey?: string;
  deviceToken?: string;
  createdAt: number;
  relayUrl?: string;
}

export interface MachineHelloPayload {
  deviceId: string;
  deviceName: string;
  hostname: string;
  platform: string;
  arch: string;
  agentVersion: string;
  codexVersion?: string | null;
  startedAt: number;
}

export interface MachineHelloAck {
  ok: true;
  serverTime: number;
  heartbeatIntervalMs: number;
}

export interface RelayErrorAck {
  ok: false;
  error: string;
}

export interface MachineHeartbeatPayload {
  deviceId: string;
  at: number;
  activeSessions: number;
}

export interface DevicePresence {
  deviceId: string;
  online: boolean;
  lastSeenAt: number;
  socketId?: string;
  activeSessions?: number;
}

export interface RelayDeviceRecord extends DevicePresence {
  deviceName: string;
  hostname: string;
  platform: string;
  arch: string;
  agentVersion: string;
  codexVersion?: string | null;
  startedAt: number;
}

export interface RelayDevicesResponse {
  devices: RelayDeviceRecord[];
}

export interface RelaySessionResponse {
  ok: true;
  sessionToken: string;
}

export const RelayMethod = {
  AgentHealth: "agent.health",
  SessionsList: "sessions.list",
  SessionsCreate: "sessions.create",
  SessionsMessage: "sessions.message",
  SessionsGoalGet: "sessions.goal.get",
  SessionsGoalSet: "sessions.goal.set",
  SessionsGoalClear: "sessions.goal.clear",
  TurnInterrupt: "turn.interrupt",
  ApprovalDecision: "approval.decision",
  DirectoriesList: "directories.list",
  CodexHistoryList: "codexHistory.list",
  CodexHistoryDetail: "codexHistory.detail",
  CodexHistoryResume: "codexHistory.resume"
} as const;

export type RelayMethod = (typeof RelayMethod)[keyof typeof RelayMethod];

export interface RelayRpcRequest {
  requestId: string;
  method: RelayMethod;
  params?: unknown;
  deadlineMs?: number;
}

export type RelayRpcResponse =
  | { ok: true; result?: unknown }
  | {
      ok: false;
      error: {
        message: string;
        code?: string;
        data?: unknown;
      };
    };

export interface MachineEventPayload {
  deviceId: string;
  event: LocalEvent;
}

export interface DeviceEventPayload {
  deviceId: string;
  event: LocalEvent;
}

export interface PairingRequestPayload {
  deviceId: string;
  deviceToken: string;
  deviceName: string;
  hostname: string;
  platform: string;
  arch: string;
  agentVersion: string;
  codexVersion?: string | null;
  relayUrl?: string | null;
}

export interface PairingCreateResponse {
  requestId: string;
  pollToken: string;
  code: string;
  codeDigits: string;
  expiresAt: number;
}

export interface PairingRequestView {
  requestId: string;
  codeDigits: string;
  deviceId: string;
  deviceName: string;
  hostname: string;
  platform: string;
  arch: string;
  agentVersion: string;
  codexVersion?: string | null;
  relayUrl?: string | null;
  shortFingerprint: string;
  createdAt: number;
  expiresAt: number;
  status: "pending" | "approved" | "rejected" | "expired";
}

export interface PairingPollResponse {
  ok: boolean;
  status: "pending" | "approved" | "rejected" | "expired";
  deviceId: string;
  expiresAt: number;
}

export interface PairingApproveResponse {
  ok: true;
  deviceId: string;
  sessionToken: string;
}

export {
  deriveCodexConversationTitle,
  deriveCodexGeneratedTitle,
  normalizeCodexConversationTitle,
  truncateCodexGeneratedTitle
} from "./conversation-titles.ts";
