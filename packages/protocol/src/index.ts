import { z } from "zod";

export type JsonPrimitive = string | number | boolean | null;
export type JsonObject = { [key: string]: JsonValue | undefined };
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type RequestId = number | string;

const JsonPrimitiveSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null()
]);

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    JsonPrimitiveSchema,
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema)
  ])
);

export const JsonObjectSchema: z.ZodType<JsonObject> = z.record(
  z.string(),
  JsonValueSchema
);

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
  ThreadArchive: "thread/archive",
  ThreadUnarchive: "thread/unarchive",
  ThreadList: "thread/list",
  ThreadLoadedList: "thread/loaded/list",
  ThreadTurnsList: "thread/turns/list",
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
  ThreadArchived: "thread/archived",
  ThreadUnarchived: "thread/unarchived",
  ThreadClosed: "thread/closed",
  ThreadNameUpdated: "thread/name/updated",
  ThreadGoalUpdated: "thread/goal/updated",
  ThreadGoalCleared: "thread/goal/cleared",
  ThreadSettingsUpdated: "thread/settings/updated",
  ThreadTokenUsageUpdated: "thread/tokenUsage/updated",
  TurnStarted: "turn/started",
  TurnPlanUpdated: "turn/plan/updated",
  ItemStarted: "item/started",
  ItemCompleted: "item/completed",
  RawResponseItemCompleted: "rawResponseItem/completed",
  ReasoningSummaryTextDelta: "item/reasoning/summaryTextDelta",
  ReasoningSummaryPartAdded: "item/reasoning/summaryPartAdded",
  ReasoningTextDelta: "item/reasoning/textDelta",
  McpToolCallProgress: "item/mcpToolCall/progress",
  PlanDelta: "item/plan/delta",
  AgentMessageDelta: "item/agentMessage/delta",
  CommandExecOutputDelta: "command/exec/outputDelta",
  ProcessOutputDelta: "process/outputDelta",
  ProcessExited: "process/exited",
  CommandExecutionOutputDelta: "item/commandExecution/outputDelta",
  TerminalInteraction: "item/commandExecution/terminalInteraction",
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

export const ThreadGoalStatusSchema = z.enum([
  "active",
  "paused",
  "blocked",
  "usageLimited",
  "budgetLimited",
  "complete"
]);

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

export const ThreadGoalSchema = z.object({
  threadId: z.string().min(1),
  objective: z.string(),
  status: ThreadGoalStatusSchema,
  tokenBudget: z.number().int().positive().nullable(),
  tokensUsed: z.number().nonnegative(),
  timeUsedSeconds: z.number().nonnegative(),
  createdAt: z.number(),
  updatedAt: z.number()
});

export interface ThreadGoalSetParams {
  threadId: string;
  objective?: string | null;
  status?: ThreadGoalStatus | null;
  tokenBudget?: number | null;
}

export const ThreadGoalSetParamsSchema = z
  .object({
    threadId: z.string().min(1),
    objective: z.string().nullable().optional(),
    status: ThreadGoalStatusSchema.nullable().optional(),
    tokenBudget: z.number().int().positive().nullable().optional()
  })
  .strict();

export interface ThreadGoalGetParams {
  threadId: string;
}

export const ThreadGoalGetParamsSchema = z
  .object({
    threadId: z.string().min(1)
  })
  .strict();

export interface ThreadGoalClearParams {
  threadId: string;
}

export const ThreadGoalClearParamsSchema = ThreadGoalGetParamsSchema;

export interface ThreadGoalSetResponse {
  goal: ThreadGoal;
}

export const ThreadGoalSetResponseSchema = z.object({
  goal: ThreadGoalSchema
});

export interface ThreadGoalGetResponse {
  goal: ThreadGoal | null;
}

export const ThreadGoalGetResponseSchema = z.object({
  goal: ThreadGoalSchema.nullable()
});

export interface ThreadGoalClearResponse {
  goal?: ThreadGoal | null;
}

export const ThreadGoalClearResponseSchema = z.object({
  goal: ThreadGoalSchema.nullable().optional()
});

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

export const AskForApprovalSchema = z.enum([
  "untrusted",
  "on-failure",
  "on-request",
  "never"
]);

export const ApprovalsReviewerSchema = z.enum([
  "user",
  "auto_review",
  "guardian_subagent"
]);

export const SandboxModeSchema = z.enum([
  "read-only",
  "workspace-write",
  "danger-full-access"
]);

export const LocalPermissionModeSchema = z.enum([
  "request-approval",
  "auto-approve",
  "full-access",
  "custom-config"
]);

export const LocalReasoningEffortSchema = z.enum([
  "low",
  "medium",
  "high",
  "xhigh"
]);

export const LocalProviderPresetSchema = z.enum([
  "openrouter",
  "deepseek",
  "dashscope-qwen",
  "siliconflow",
  "minimax",
  "moonshot-kimi",
  "custom"
]);

export type LocalProviderPreset = z.infer<typeof LocalProviderPresetSchema>;

export const LocalProviderConfigSchema = z
  .object({
    preset: LocalProviderPresetSchema.nullable().optional(),
    providerLabel: z.string().min(1).nullable().optional(),
    providerName: z.string().min(1).nullable().optional(),
    baseUrl: z.string().min(1).nullable().optional(),
    apiKey: z.string().min(1).nullable().optional(),
    apiKeyEnv: z.string().min(1).nullable().optional(),
    model: z.string().min(1).nullable().optional()
  })
  .strict();

export type LocalProviderConfig = z.infer<typeof LocalProviderConfigSchema>;

export const LocalProviderSummarySchema = z
  .object({
    preset: LocalProviderPresetSchema.nullable().optional(),
    providerLabel: z.string().min(1),
    providerName: z.string().min(1).nullable().optional(),
    baseUrl: z.string().min(1).nullable().optional(),
    model: z.string().min(1).nullable().optional(),
    profileMode: z.enum(["official", "mixed", "pure-api"]).nullable().optional(),
    toolStrategy: z.string().min(1).nullable().optional()
  })
  .strict();

export type LocalProviderSummary = z.infer<typeof LocalProviderSummarySchema>;

export const LocalProviderCatalogModelSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    isDefault: z.boolean().optional(),
    supportedReasoningEfforts: z.array(z.string().min(1)).default([]),
    defaultReasoningEffort: z.string().min(1).nullable().optional()
  })
  .strict();

export type LocalProviderCatalogModel = z.infer<
  typeof LocalProviderCatalogModelSchema
>;

export const LocalProviderCatalogEntrySchema = z
  .object({
    preset: LocalProviderPresetSchema,
    label: z.string().min(1),
    providerLabel: z.string().min(1),
    providerName: z.string().min(1).nullable().optional(),
    baseUrl: z.string().min(1),
    apiKeyEnv: z.string().min(1),
    defaultModel: z.string().min(1),
    models: z.array(LocalProviderCatalogModelSchema)
  })
  .strict();

export type LocalProviderCatalogEntry = z.infer<
  typeof LocalProviderCatalogEntrySchema
>;

export const LocalProviderCatalogResponseSchema = z.object({
  providers: z.array(LocalProviderCatalogEntrySchema)
});

export interface LocalProviderCatalogResponse {
  providers: LocalProviderCatalogEntry[];
}

export interface ThreadStartParams {
  model?: string | null;
  modelProvider?: string | null;
  serviceTier?: string | null;
  cwd?: string | null;
  runtimeWorkspaceRoots?: string[] | null;
  approvalPolicy?: AskForApproval | null;
  approvalsReviewer?: ApprovalsReviewer | null;
  sandbox?: SandboxMode | null;
  ephemeral?: boolean | null;
  serviceName?: string | null;
}

export const ThreadStartParamsSchema = z
  .object({
    model: z.string().nullable().optional(),
    modelProvider: z.string().nullable().optional(),
    serviceTier: z.string().nullable().optional(),
    cwd: z.string().nullable().optional(),
    runtimeWorkspaceRoots: z.array(z.string()).nullable().optional(),
    approvalPolicy: AskForApprovalSchema.nullable().optional(),
    approvalsReviewer: ApprovalsReviewerSchema.nullable().optional(),
    sandbox: SandboxModeSchema.nullable().optional(),
    ephemeral: z.boolean().nullable().optional(),
    serviceName: z.string().nullable().optional()
  })
  .strict();

export interface ThreadStartResponse {
  thread: {
    id: string;
    status?: unknown;
    cwd?: string;
    [key: string]: unknown;
  };
  model?: string;
  modelProvider?: string;
  serviceTier?: string | null;
  cwd?: string;
}

export const ThreadStartResponseSchema = z.object({
  thread: z.object({
    id: z.string().min(1),
    status: z.unknown().optional(),
    cwd: z.string().optional()
  }).passthrough(),
  model: z.string().optional(),
  modelProvider: z.string().optional(),
  serviceTier: z.string().nullable().optional(),
  cwd: z.string().optional()
});

export interface ThreadResumeParams {
  threadId: string;
  model?: string | null;
  modelProvider?: string | null;
  serviceTier?: string | null;
  cwd?: string | null;
  excludeTurns?: boolean | null;
  initialTurnsPage?: Omit<ThreadTurnsListParams, "threadId"> | null;
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
  initialTurnsPage?: ThreadTurnsListResponse | null;
  approvalPolicy?: AskForApproval;
  approvalsReviewer?: ApprovalsReviewer;
  reasoningEffort?: LocalReasoningEffort | "none" | "minimal" | null;
  instructionSources?: string[];
}

export interface ThreadArchiveParams {
  threadId: string;
}

export const ThreadArchiveParamsSchema = z
  .object({
    threadId: z.string().min(1)
  })
  .strict();

export type ThreadArchiveResponse = Record<string, never>;

export const ThreadArchiveResponseSchema = z.object({}).strict();

export interface ThreadUnarchiveParams {
  threadId: string;
}

export const ThreadUnarchiveParamsSchema = ThreadArchiveParamsSchema;

export type ThreadUnarchiveResponse = Record<string, never>;

export const ThreadUnarchiveResponseSchema = z.object({}).strict();

export type ThreadSortKey = "created_at" | "updated_at";
export type SortDirection = "asc" | "desc";

export const ThreadSortKeySchema = z.enum(["created_at", "updated_at"]);
export const SortDirectionSchema = z.enum(["asc", "desc"]);

export type ThreadSourceKind =
  | "cli"
  | "vscode"
  | "exec"
  | "appServer"
  | "mcp"
  | "custom"
  | "subAgent"
  | "unknown";

export const ThreadSourceKindSchema = z.enum([
  "cli",
  "vscode",
  "exec",
  "appServer",
  "mcp",
  "custom",
  "subAgent",
  "unknown"
]);

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

export const ThreadListParamsSchema = z
  .object({
    cursor: z.string().nullable().optional(),
    limit: z.number().int().positive().nullable().optional(),
    sortKey: ThreadSortKeySchema.nullable().optional(),
    sortDirection: SortDirectionSchema.nullable().optional(),
    modelProviders: z.array(z.string().min(1)).nullable().optional(),
    sourceKinds: z.array(ThreadSourceKindSchema).nullable().optional(),
    archived: z.boolean().nullable().optional(),
    cwd: z
      .union([z.string(), z.array(z.string())])
      .nullable()
      .optional(),
    useStateDbOnly: z.boolean().optional(),
    searchTerm: z.string().nullable().optional()
  })
  .strict();

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

export const CodexThreadItemType = {
  UserMessage: "userMessage",
  HookPrompt: "hookPrompt",
  AgentMessage: "agentMessage",
  Plan: "plan",
  Reasoning: "reasoning",
  CommandExecution: "commandExecution",
  FileChange: "fileChange",
  McpToolCall: "mcpToolCall",
  DynamicToolCall: "dynamicToolCall",
  CollabAgentToolCall: "collabAgentToolCall",
  WebSearch: "webSearch",
  ImageView: "imageView",
  ImageGeneration: "imageGeneration",
  EnteredReviewMode: "enteredReviewMode",
  ExitedReviewMode: "exitedReviewMode",
  ContextCompaction: "contextCompaction"
} as const;

export type KnownCodexThreadItemType =
  (typeof CodexThreadItemType)[keyof typeof CodexThreadItemType];

export type CodexThreadItemType =
  | KnownCodexThreadItemType
  | (string & {});

export type CodexThreadTurnItemsView = "notLoaded" | "summary" | "full";
export type CodexThreadTurnStatus =
  | "completed"
  | "interrupted"
  | "failed"
  | "inProgress";

export interface CodexThreadTurn {
  id: string;
  items: CodexThreadItem[];
  params?: unknown;
  itemsView: CodexThreadTurnItemsView;
  status: CodexThreadTurnStatus;
  error: unknown | null;
  startedAt: number | null;
  completedAt: number | null;
  durationMs: number | null;
  [key: string]: unknown;
}

export type CodexThreadItem = {
  id: string;
  type: CodexThreadItemType;
  clientId?: string | null;
  content?: unknown;
  text?: string;
  phase?: string | null;
  memoryCitation?: unknown;
  summary?: string[];
  fragments?: unknown[];
  command?: string;
  cwd?: string;
  processId?: string | null;
  source?: unknown;
  status?: unknown;
  commandActions?: unknown[];
  aggregatedOutput?: string | null;
  exitCode?: number | null;
  durationMs?: number | null;
  changes?: unknown[];
  server?: string;
  namespace?: string | null;
  tool?: unknown;
  arguments?: unknown;
  result?: unknown;
  error?: unknown;
  contentItems?: unknown[] | null;
  success?: boolean | null;
  query?: string;
  action?: unknown;
  path?: string;
  review?: string;
  prompt?: string | null;
  model?: string | null;
  reasoningEffort?: string | null;
  receiverThreadIds?: string[];
  senderThreadId?: string;
  agentsStates?: Record<string, unknown>;
  [key: string]: unknown;
};

export const CodexThreadItemSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  clientId: z.string().nullable().optional(),
  content: z.unknown().optional(),
  text: z.string().optional(),
  phase: z.string().nullable().optional(),
  memoryCitation: z.unknown().optional(),
  summary: z.array(z.string()).optional(),
  fragments: z.array(z.unknown()).optional(),
  command: z.string().optional(),
  cwd: z.string().optional(),
  processId: z.string().nullable().optional(),
  source: z.unknown().optional(),
  status: z.unknown().optional(),
  commandActions: z.array(z.unknown()).optional(),
  aggregatedOutput: z.string().nullable().optional(),
  exitCode: z.number().nullable().optional(),
  durationMs: z.number().nullable().optional(),
  changes: z.array(z.unknown()).optional(),
  server: z.string().optional(),
  namespace: z.string().nullable().optional(),
  tool: z.unknown().optional(),
  arguments: z.unknown().optional(),
  result: z.unknown().optional(),
  error: z.unknown().optional(),
  contentItems: z.array(z.unknown()).nullable().optional(),
  success: z.boolean().nullable().optional(),
  query: z.string().optional(),
  action: z.unknown().optional(),
  path: z.string().optional(),
  review: z.string().optional(),
  prompt: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  reasoningEffort: z.string().nullable().optional(),
  receiverThreadIds: z.array(z.string()).optional(),
  senderThreadId: z.string().optional(),
  agentsStates: z.record(z.string(), z.unknown()).optional()
}).passthrough();

export const CodexThreadTurnItemsViewSchema = z.enum([
  "notLoaded",
  "summary",
  "full"
]);

export const CodexThreadTurnStatusSchema = z.enum([
  "completed",
  "interrupted",
  "failed",
  "inProgress"
]);

export const CodexThreadTurnSchema = z.object({
  id: z.string().min(1),
  items: z.array(CodexThreadItemSchema),
  params: z.unknown().optional(),
  itemsView: CodexThreadTurnItemsViewSchema,
  status: CodexThreadTurnStatusSchema,
  error: z.unknown().nullable(),
  startedAt: z.number().nullable(),
  completedAt: z.number().nullable(),
  durationMs: z.number().nullable()
}).passthrough();

export type CodexThreadItemRenderKind =
  | "user"
  | "assistant"
  | "process"
  | "metadata";

const PROCESS_THREAD_ITEM_TYPES = new Set<string>([
  CodexThreadItemType.HookPrompt,
  CodexThreadItemType.Plan,
  CodexThreadItemType.Reasoning,
  CodexThreadItemType.CommandExecution,
  CodexThreadItemType.FileChange,
  CodexThreadItemType.McpToolCall,
  CodexThreadItemType.DynamicToolCall,
  CodexThreadItemType.CollabAgentToolCall,
  CodexThreadItemType.WebSearch,
  CodexThreadItemType.ImageView,
  CodexThreadItemType.ImageGeneration,
  CodexThreadItemType.EnteredReviewMode,
  CodexThreadItemType.ExitedReviewMode,
  CodexThreadItemType.ContextCompaction
]);

export function codexThreadItemRenderKind(
  item: Pick<CodexThreadItem, "type"> | null | undefined
): CodexThreadItemRenderKind {
  if (!item) {
    return "metadata";
  }
  if (item.type === CodexThreadItemType.UserMessage) {
    return "user";
  }
  if (item.type === CodexThreadItemType.AgentMessage) {
    return "assistant";
  }
  if (PROCESS_THREAD_ITEM_TYPES.has(item.type)) {
    return "process";
  }
  return "metadata";
}

export function isCodexProcessThreadItem(
  item: Pick<CodexThreadItem, "type"> | null | undefined
): boolean {
  return codexThreadItemRenderKind(item) === "process";
}

export function codexThreadTurnHasProcessItems(
  turn: Pick<CodexThreadTurn, "items"> | null | undefined
): boolean {
  return Boolean(turn?.items.some(isCodexProcessThreadItem));
}

export const CodexThreadSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().optional(),
  preview: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  status: z.unknown().optional(),
  cwd: z.string(),
  cliVersion: z.string().optional(),
  source: z.unknown().optional(),
  title: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  path: z.string().nullable().optional(),
  turns: z.array(CodexThreadTurnSchema).optional()
}).passthrough();

export interface ThreadListResponse {
  data: CodexThread[];
  nextCursor: string | null;
  backwardsCursor: string | null;
}

export const ThreadListResponseSchema = z.object({
  data: z.array(CodexThreadSchema),
  nextCursor: z.string().nullable(),
  backwardsCursor: z.string().nullable()
});

export interface ThreadLoadedListResponse {
  data: CodexThread[];
}

export const ThreadLoadedListParamsSchema = z.object({}).strict();

export const ThreadLoadedListResponseSchema = z.object({
  data: z.array(CodexThreadSchema)
});

export interface ThreadReadParams {
  threadId: string;
  includeTurns?: boolean;
}

export const ThreadReadParamsSchema = z
  .object({
    threadId: z.string().min(1),
    includeTurns: z.boolean().optional()
  })
  .strict();

export interface ThreadReadResponse {
  thread: CodexThread;
}

export const ThreadReadResponseSchema = z.object({
  thread: CodexThreadSchema
});

export type ThreadTurnItemsView = "summary" | "full";

export const ThreadTurnItemsViewSchema = z.enum(["summary", "full"]);

export interface ThreadTurnsListParams {
  threadId: string;
  cursor?: string | null;
  limit?: number | null;
  sortDirection?: SortDirection | null;
  itemsView?: ThreadTurnItemsView | null;
}

export const ThreadTurnsListParamsSchema = z
  .object({
    threadId: z.string().min(1),
    cursor: z.string().nullable().optional(),
    limit: z.number().int().positive().nullable().optional(),
    sortDirection: SortDirectionSchema.nullable().optional(),
    itemsView: ThreadTurnItemsViewSchema.nullable().optional()
  })
  .strict();

export const ThreadTurnsPageParamsSchema = ThreadTurnsListParamsSchema.omit({
  threadId: true
});

export interface ThreadTurnsListResponse {
  data: CodexThreadTurn[];
  nextCursor: string | null;
  backwardsCursor: string | null;
}

export const ThreadTurnsListResponseSchema = z.object({
  data: z.array(CodexThreadTurnSchema),
  nextCursor: z.string().nullable(),
  backwardsCursor: z.string().nullable()
});

export const ThreadResumeResponseSchema = ThreadStartResponseSchema.extend({
  model: z.string().optional(),
  modelProvider: z.string().optional(),
  serviceTier: z.string().nullable().optional(),
  cwd: z.string().optional(),
  initialTurnsPage: ThreadTurnsListResponseSchema.nullable().optional(),
  approvalPolicy: AskForApprovalSchema.optional(),
  approvalsReviewer: ApprovalsReviewerSchema.optional(),
  reasoningEffort: z
    .union([LocalReasoningEffortSchema, z.enum(["none", "minimal"])])
    .nullable()
    .optional(),
  instructionSources: z.array(z.string()).optional()
});

export const ThreadResumeParamsSchema = z
  .object({
    threadId: z.string().min(1),
    model: z.string().nullable().optional(),
    modelProvider: z.string().nullable().optional(),
    serviceTier: z.string().nullable().optional(),
    cwd: z.string().nullable().optional(),
    excludeTurns: z.boolean().nullable().optional(),
    initialTurnsPage: ThreadTurnsPageParamsSchema.nullable().optional(),
    approvalPolicy: AskForApprovalSchema.nullable().optional(),
    approvalsReviewer: ApprovalsReviewerSchema.nullable().optional(),
    sandbox: SandboxModeSchema.nullable().optional(),
    config: JsonObjectSchema.nullable().optional(),
    baseInstructions: z.string().nullable().optional(),
    developerInstructions: z.string().nullable().optional(),
    personality: JsonObjectSchema.nullable().optional()
  })
  .strict();

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

export const UserInputSchema = z.union([
  z
    .object({
      type: z.literal("text"),
      text: z.string(),
      text_elements: z.array(z.unknown())
    })
    .strict(),
  z
    .object({
      type: z.literal("image"),
      detail: z.enum(["auto", "low", "high"]).optional(),
      url: z.string().min(1)
    })
    .strict(),
  z
    .object({
      type: z.literal("localImage"),
      detail: z.enum(["auto", "low", "high"]).optional(),
      path: z.string().min(1)
    })
    .strict()
]);

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
  serviceTier?: string | null;
}

export const TurnStartParamsSchema = z
  .object({
    threadId: z.string().min(1),
    input: z.array(UserInputSchema).min(1),
    cwd: z.string().nullable().optional(),
    runtimeWorkspaceRoots: z.array(z.string()).nullable().optional(),
    approvalPolicy: AskForApprovalSchema.nullable().optional(),
    approvalsReviewer: ApprovalsReviewerSchema.nullable().optional(),
    model: z.string().nullable().optional(),
    serviceTier: z.string().nullable().optional()
  })
  .strict();

export interface Turn {
  id: string;
  status?: string;
  [key: string]: unknown;
}

export const TurnSchema = z
  .object({
    id: z.string().min(1),
    status: z.string().optional()
  })
  .passthrough();

export interface TurnStartResponse {
  turn: Turn;
}

export const TurnStartResponseSchema = z.object({
  turn: TurnSchema
});

export interface TurnSteerParams {
  threadId: string;
  expectedTurnId: string;
  input: UserInput[];
}

export const TurnSteerParamsSchema = z
  .object({
    threadId: z.string().min(1),
    expectedTurnId: z.string().min(1),
    input: z.array(UserInputSchema).min(1)
  })
  .strict();

export interface TurnInterruptParams {
  threadId: string;
  turnId: string;
}

export const TurnInterruptParamsSchema = z
  .object({
    threadId: z.string().min(1),
    turnId: z.string().min(1)
  })
  .strict();

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

const AppServerApprovalRequestParamsBaseSchema = z
  .object({
    requestId: z.string().min(1).optional(),
    threadId: z.string().min(1).optional(),
    turnId: z.string().min(1).optional()
  })
  .passthrough();

export const CommandExecutionRequestApprovalParamsSchema =
  AppServerApprovalRequestParamsBaseSchema.extend({
    command: z.unknown().optional()
  }).passthrough();

export const FileChangeRequestApprovalParamsSchema =
  AppServerApprovalRequestParamsBaseSchema.extend({
    path: z.unknown().optional(),
    changes: z.unknown().optional()
  }).passthrough();

export const LegacyExecCommandApprovalParamsSchema =
  AppServerApprovalRequestParamsBaseSchema.extend({
    command: z.unknown().optional()
  }).passthrough();

export const LegacyApplyPatchApprovalParamsSchema =
  AppServerApprovalRequestParamsBaseSchema.extend({
    patch: z.unknown().optional()
  }).passthrough();

export const ApprovalRequestParamsSchema = z.union([
  CommandExecutionRequestApprovalParamsSchema,
  FileChangeRequestApprovalParamsSchema,
  LegacyExecCommandApprovalParamsSchema,
  LegacyApplyPatchApprovalParamsSchema
]);

export interface CommandExecutionRequestApprovalResponse {
  decision: CommandExecutionApprovalDecision;
}

export const CommandExecutionApprovalDecisionSchema = z.union([
  z.enum(["accept", "acceptForSession", "decline", "cancel"]),
  JsonObjectSchema
]);

export const CommandExecutionRequestApprovalResponseSchema = z
  .object({
    decision: CommandExecutionApprovalDecisionSchema
  })
  .strict();

export interface FileChangeRequestApprovalResponse {
  decision: FileChangeApprovalDecision;
}

export const FileChangeApprovalDecisionSchema = z.enum([
  "accept",
  "acceptForSession",
  "decline",
  "cancel"
]);

export const FileChangeRequestApprovalResponseSchema = z
  .object({
    decision: FileChangeApprovalDecisionSchema
  })
  .strict();

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

export const LegacyReviewDecisionSchema = z.union([
  z.enum(["approved", "approved_for_session", "denied", "timed_out", "abort"]),
  JsonObjectSchema
]);

export const LegacyApprovalResponseSchema = z
  .object({
    decision: LegacyReviewDecisionSchema
  })
  .strict();

export type ApprovalResponse =
  | CommandExecutionRequestApprovalResponse
  | FileChangeRequestApprovalResponse
  | LegacyApprovalResponse;

export const ApprovalResponseSchema = z.union([
  CommandExecutionRequestApprovalResponseSchema,
  FileChangeRequestApprovalResponseSchema,
  LegacyApprovalResponseSchema
]);

export const AppServerNotificationSchema = z
  .object({
    method: z.string().min(1),
    params: z.unknown().optional()
  })
  .passthrough();

export type AppServerNotification = z.infer<typeof AppServerNotificationSchema>;

const NotificationThreadSchema = z
  .object({
    id: z.string().min(1).optional(),
    status: z.unknown().optional()
  })
  .passthrough();

const NotificationGoalSchema = z
  .object({
    threadId: z.string().min(1).optional(),
    objective: z.string().optional(),
    status: z.string().optional(),
    tokenBudget: z.number().int().positive().nullable().optional(),
    tokensUsed: z.number().nonnegative().optional(),
    timeUsedSeconds: z.number().nonnegative().optional(),
    createdAt: z.number().optional(),
    updatedAt: z.number().optional()
  })
  .passthrough();

const NotificationIdFieldsSchema = z
  .object({
    threadId: z.string().min(1).optional(),
    turnId: z.string().min(1).optional()
  })
  .passthrough();

const RequiredTurnScopedNotificationSchema = z
  .object({
    threadId: z.string().min(1),
    turnId: z.string().min(1)
  })
  .passthrough();

export const ThreadStatusChangedNotificationParamsSchema =
  NotificationIdFieldsSchema.extend({
    status: z.unknown().optional(),
    thread: NotificationThreadSchema.optional()
  }).passthrough();

export const ThreadGoalUpdatedNotificationParamsSchema =
  NotificationIdFieldsSchema.extend({
    goal: NotificationGoalSchema
  }).passthrough();

export const ThreadGoalClearedNotificationParamsSchema =
  NotificationIdFieldsSchema.extend({
    goal: NotificationGoalSchema.nullable().optional()
  }).passthrough();

export const TurnNotificationParamsSchema = z.object({
  threadId: z.string().min(1),
  turn: CodexThreadTurnSchema
}).passthrough();

export const TextDeltaNotificationParamsSchema =
  RequiredTurnScopedNotificationSchema.extend({
    itemId: z.string().min(1),
    delta: z.string()
  }).passthrough();

export const CommandExecOutputDeltaNotificationParamsSchema =
  z.object({
    processId: z.string().min(1),
    stream: z.string().min(1),
    deltaBase64: z.string(),
    capReached: z.boolean()
  }).passthrough();

export const ProcessOutputDeltaNotificationParamsSchema =
  z.object({
    processHandle: z.string().min(1),
    stream: z.string().min(1),
    deltaBase64: z.string(),
    capReached: z.boolean()
  }).passthrough();

export const ProcessExitedNotificationParamsSchema = z.object({
  processHandle: z.string().min(1),
  exitCode: z.number(),
  stdout: z.string(),
  stdoutCapReached: z.boolean(),
  stderr: z.string(),
  stderrCapReached: z.boolean()
}).passthrough();

export const ItemLifecycleNotificationParamsSchema =
  RequiredTurnScopedNotificationSchema.extend({
    item: CodexThreadItemSchema
  }).passthrough();

export const ItemStartedNotificationParamsSchema =
  ItemLifecycleNotificationParamsSchema.extend({
    startedAtMs: z.number()
  }).passthrough();

export const ItemCompletedNotificationParamsSchema =
  ItemLifecycleNotificationParamsSchema.extend({
    completedAtMs: z.number()
  }).passthrough();

export const ReasoningSummaryTextDeltaNotificationParamsSchema =
  TextDeltaNotificationParamsSchema.extend({
    summaryIndex: z.number().int().nonnegative()
  }).passthrough();

export const ReasoningSummaryPartAddedNotificationParamsSchema =
  RequiredTurnScopedNotificationSchema.extend({
    itemId: z.string().min(1),
    summaryIndex: z.number().int().nonnegative()
  }).passthrough();

export const ReasoningTextDeltaNotificationParamsSchema =
  TextDeltaNotificationParamsSchema.extend({
    contentIndex: z.number().int().nonnegative()
  }).passthrough();

export const McpToolCallProgressNotificationParamsSchema =
  RequiredTurnScopedNotificationSchema.extend({
    itemId: z.string().min(1),
    message: z.string()
  }).passthrough();

export const DiffUpdatedNotificationParamsSchema =
  RequiredTurnScopedNotificationSchema.extend({
    diff: z.string()
  }).passthrough();

export const PlanNotificationParamsSchema =
  RequiredTurnScopedNotificationSchema.extend({
    delta: z.string().optional(),
    itemId: z.string().min(1).optional(),
    explanation: z.string().nullable().optional(),
    plan: z.unknown().optional()
  }).passthrough();

const KnownNotificationParamsSchemas = {
  [CodexNotificationMethod.ThreadStatusChanged]:
    ThreadStatusChangedNotificationParamsSchema,
  [CodexNotificationMethod.ThreadGoalUpdated]:
    ThreadGoalUpdatedNotificationParamsSchema,
  [CodexNotificationMethod.ThreadGoalCleared]:
    ThreadGoalClearedNotificationParamsSchema,
  [CodexNotificationMethod.TurnStarted]: TurnNotificationParamsSchema,
  [CodexNotificationMethod.TurnCompleted]: TurnNotificationParamsSchema,
  [CodexNotificationMethod.ItemStarted]: ItemStartedNotificationParamsSchema,
  [CodexNotificationMethod.ItemCompleted]: ItemCompletedNotificationParamsSchema,
  [CodexNotificationMethod.RawResponseItemCompleted]:
    RequiredTurnScopedNotificationSchema,
  [CodexNotificationMethod.AgentMessageDelta]:
    TextDeltaNotificationParamsSchema,
  [CodexNotificationMethod.CommandExecutionOutputDelta]:
    TextDeltaNotificationParamsSchema,
  [CodexNotificationMethod.FileChangeOutputDelta]:
    TextDeltaNotificationParamsSchema,
  [CodexNotificationMethod.CommandExecOutputDelta]:
    CommandExecOutputDeltaNotificationParamsSchema,
  [CodexNotificationMethod.ProcessOutputDelta]:
    ProcessOutputDeltaNotificationParamsSchema,
  [CodexNotificationMethod.ProcessExited]:
    ProcessExitedNotificationParamsSchema,
  [CodexNotificationMethod.TurnDiffUpdated]: DiffUpdatedNotificationParamsSchema,
  [CodexNotificationMethod.TurnPlanUpdated]: PlanNotificationParamsSchema,
  [CodexNotificationMethod.PlanDelta]: PlanNotificationParamsSchema,
  [CodexNotificationMethod.ReasoningSummaryTextDelta]:
    ReasoningSummaryTextDeltaNotificationParamsSchema,
  [CodexNotificationMethod.ReasoningSummaryPartAdded]:
    ReasoningSummaryPartAddedNotificationParamsSchema,
  [CodexNotificationMethod.ReasoningTextDelta]:
    ReasoningTextDeltaNotificationParamsSchema,
  [CodexNotificationMethod.McpToolCallProgress]:
    McpToolCallProgressNotificationParamsSchema,
  [CodexNotificationMethod.TerminalInteraction]:
    RequiredTurnScopedNotificationSchema,
  [CodexNotificationMethod.FileChangePatchUpdated]:
    RequiredTurnScopedNotificationSchema
} as const;

export function appServerNotificationParamsSchemaForMethod(
  method: string
): z.ZodType<unknown> | undefined {
  return KnownNotificationParamsSchemas[
    method as keyof typeof KnownNotificationParamsSchemas
  ];
}

export function parseAppServerNotification(
  notification: unknown
): AppServerNotification | undefined {
  const parsed = AppServerNotificationSchema.safeParse(notification);
  if (!parsed.success) {
    return undefined;
  }

  const paramsSchema = appServerNotificationParamsSchemaForMethod(
    parsed.data.method
  );
  if (!paramsSchema || parsed.data.params === undefined) {
    return parsed.data;
  }

  const parsedParams = paramsSchema.safeParse(parsed.data.params);
  if (!parsedParams.success) {
    return undefined;
  }

  return {
    ...parsed.data,
    params: parsedParams.data
  };
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
  ThreadStatusChanged: "thread.status.changed",
  GoalUpdated: "goal.updated",
  GoalCleared: "goal.cleared",
  TurnStarted: "turn.started",
  TurnCompleted: "turn.completed",
  TurnSteerAccepted: "turn.steer.accepted",
  TurnInterruptRequested: "turn.interrupt.requested",
  ApprovalRequested: "approval.requested",
  ApprovalResolved: "approval.resolved",
  CodexNotification: "codex.notification",
  AppServerItemStarted: "app-server.item.started",
  AppServerItemCompleted: "app-server.item.completed",
  AppServerReasoningDelta: "app-server.reasoning.delta",
  AppServerMcpProgress: "app-server.mcp.progress",
  AppServerProcessOutput: "app-server.process.output",
  AppServerProcessExited: "app-server.process.exited",
  CodexError: "codex.error",
  ChatUser: "chat.user",
  ChatAssistantDelta: "chat.assistant.delta",
  CommandOutputDelta: "command.output.delta",
  DiffUpdated: "diff.updated",
  PlanUpdated: "plan.updated"
} as const;

export type LocalEventType =
  (typeof LocalEventType)[keyof typeof LocalEventType];

const LocalEventTypeValues = Object.values(LocalEventType) as [
  LocalEventType,
  ...LocalEventType[]
];

export const LocalEventSchema = z.object({
  id: z.string().min(1),
  seq: z.number().int().nonnegative(),
  type: z.enum(LocalEventTypeValues),
  ts: z.number(),
  sessionId: z.string().min(1).optional(),
  threadId: z.string().min(1).optional(),
  turnId: z.string().min(1).optional(),
  payload: z.unknown().optional()
});

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

export const LocalSessionStatusSchema = z.enum([
  "idle",
  "running",
  "waiting_approval",
  "completed",
  "failed",
  "interrupted",
  "error"
]);

export interface LocalSessionSummary {
  sessionId: string;
  threadId?: string;
  currentTurnId?: string;
  activeTurnId?: string;
  queuedMessages: LocalQueuedMessage[];
  status: LocalSessionStatus;
  cwd: string;
  title?: string | null;
  model?: string | null;
  providerProfileId?: string | null;
  provider?: LocalProviderSummary | null;
  serviceTier?: string | null;
  reasoningEffort?: LocalReasoningEffort | null;
  permissionMode: LocalPermissionMode;
  approvalPolicy: AskForApproval | null;
  approvalsReviewer: ApprovalsReviewer | null;
  sandbox: SandboxMode | null;
  goal?: ThreadGoal | null;
  createdAt: number;
  updatedAt: number;
}

export interface LocalQueuedMessage {
  clientMessageId: string;
  createdAt: number;
  order: number;
  serviceTier?: string | null;
  text: string;
  updatedAt: number;
}

export const LocalQueuedMessageSchema = z.object({
  clientMessageId: z.string().min(1),
  createdAt: z.number(),
  order: z.number().int().positive(),
  serviceTier: z.string().nullable().optional(),
  text: z.string(),
  updatedAt: z.number()
});

export const LocalSessionSummarySchema = z.object({
  sessionId: z.string().min(1),
  threadId: z.string().min(1).optional(),
  currentTurnId: z.string().min(1).optional(),
  activeTurnId: z.string().min(1).optional(),
  queuedMessages: z.array(LocalQueuedMessageSchema).default([]),
  status: LocalSessionStatusSchema,
  cwd: z.string().min(1),
  title: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  providerProfileId: z.string().nullable().optional(),
  provider: LocalProviderSummarySchema.nullable().optional(),
  serviceTier: z.string().nullable().optional(),
  reasoningEffort: LocalReasoningEffortSchema.nullable().optional(),
  permissionMode: LocalPermissionModeSchema,
  approvalPolicy: AskForApprovalSchema.nullable(),
  approvalsReviewer: ApprovalsReviewerSchema.nullable(),
  sandbox: SandboxModeSchema.nullable(),
  goal: ThreadGoalSchema.nullable().optional(),
  createdAt: z.number(),
  updatedAt: z.number()
});

export const LocalSessionsResponseSchema = z.object({
  sessions: z.array(LocalSessionSummarySchema)
});

export interface LocalSessionsResponse {
  sessions: LocalSessionSummary[];
}

export const LocalCreateSessionResponseSchema = z.object({
  session: LocalSessionSummarySchema
});

export interface LocalCreateSessionResponse {
  session: LocalSessionSummary;
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
  providerProfileId: z.string().min(1).nullable().optional(),
  provider: LocalProviderConfigSchema.nullable().optional(),
  serviceTier: z.string().min(1).nullable().optional(),
  permissionMode: LocalPermissionModeSchema.default("request-approval"),
  approvalPolicy: AskForApprovalSchema.nullable().optional(),
  reasoningEffort: LocalReasoningEffortSchema.nullable().optional(),
  approvalsReviewer: ApprovalsReviewerSchema.nullable().optional(),
  sandbox: SandboxModeSchema.nullable().optional(),
  tokenBudget: z.number().int().positive().nullable().optional(),
  initialGoal: z.string().nullable().optional(),
  initialMessage: z.string().nullable().optional(),
  clientMessageId: z.string().min(1).optional()
});

export type LocalStartSessionInput = z.infer<typeof LocalStartSessionSchema>;

export const LocalResumeSessionSchema = z.object({
  id: z.string().min(1),
  cwd: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  model: z.string().min(1).nullable().optional(),
  providerProfileId: z.string().min(1).nullable().optional(),
  provider: LocalProviderConfigSchema.nullable().optional(),
  serviceTier: z.string().min(1).nullable().optional(),
  permissionMode: LocalPermissionModeSchema.default("request-approval"),
  approvalPolicy: AskForApprovalSchema.nullable().optional(),
  reasoningEffort: LocalReasoningEffortSchema.nullable().optional(),
  approvalsReviewer: ApprovalsReviewerSchema.nullable().optional(),
  sandbox: SandboxModeSchema.nullable().optional()
});

export type LocalResumeSessionInput = z.infer<typeof LocalResumeSessionSchema>;

export const LocalMessageSubmitModeSchema = z.enum(["queue", "steer"]);

export type LocalMessageSubmitMode = z.infer<typeof LocalMessageSubmitModeSchema>;

export const LocalSendMessageSchema = z.object({
  text: z.string().min(1),
  clientMessageId: z.string().min(1).optional(),
  serviceTier: z.string().min(1).nullable().optional(),
  submitMode: LocalMessageSubmitModeSchema.optional()
});

export type LocalSendMessageInput = z.infer<typeof LocalSendMessageSchema>;

export const LocalSendMessageResponseSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("turn-start"),
    turnId: z.string().min(1)
  }),
  z.object({
    mode: z.literal("steer"),
    turnId: z.string().min(1)
  }),
  z.object({
    mode: z.literal("queued"),
    queuePosition: z.number().int().positive()
  })
]);

export type LocalSendMessageResponse = z.infer<typeof LocalSendMessageResponseSchema>;

export const LocalQueueActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("clear")
  }),
  z.object({
    action: z.literal("delete"),
    clientMessageId: z.string().min(1)
  }),
  z.object({
    action: z.literal("edit"),
    clientMessageId: z.string().min(1),
    text: z.string().min(1)
  }),
  z.object({
    action: z.literal("reorder"),
    clientMessageIds: z.array(z.string().min(1))
  }),
  z.object({
    action: z.literal("steer"),
    clientMessageId: z.string().min(1)
  })
]);

export type LocalQueueActionInput = z.infer<typeof LocalQueueActionSchema>;

export const LocalQueueActionResponseSchema = z.object({
  session: LocalSessionSummarySchema
});

export interface LocalQueueActionResponse {
  session: LocalSessionSummary;
}

export const LocalInterruptResponseSchema = z.object({
  turnId: z.string().min(1)
});

export interface LocalInterruptResponse {
  turnId: string;
}

export const LocalEventReplayResponseSchema = z.object({
  events: z.array(LocalEventSchema)
});

export interface LocalEventReplayResponse {
  events: LocalEvent[];
}

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
  loaded?: boolean;
  threadStatus?: string | null;
}

export const LocalCodexHistoryEntrySchema = z.object({
  id: z.string().min(1),
  cwd: z.string().min(1),
  cwdExists: z.boolean().optional(),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  source: z.string(),
  loaded: z.boolean().optional(),
  threadStatus: z.string().nullable().optional()
});

export type LocalCodexHistoryMessageRole =
  | "user"
  | "assistant"
  | "command"
  | "system"
  | "diff";

export const LocalCodexHistoryMessageRoleSchema = z.enum([
  "user",
  "assistant",
  "command",
  "system",
  "diff"
]);

export interface LocalCodexHistoryMessage {
  id: string;
  role: LocalCodexHistoryMessageRole;
  text: string;
  ts: string;
}

export const LocalCodexHistoryMessageSchema = z.object({
  id: z.string().min(1),
  role: LocalCodexHistoryMessageRoleSchema,
  text: z.string(),
  ts: z.string()
});

export interface LocalCodexHistoryResponse {
  root: string;
  entries: LocalCodexHistoryEntry[];
}

export const LocalCodexHistoryResponseSchema = z.object({
  root: z.string(),
  entries: z.array(LocalCodexHistoryEntrySchema)
});

export interface LocalLoadedThreadsResponse {
  threadIds: string[];
}

export const LocalLoadedThreadsResponseSchema = z.object({
  threadIds: z.array(z.string().min(1))
});

export interface LocalCodexHistoryDetailResponse {
  entry: LocalCodexHistoryEntry;
  messages: LocalCodexHistoryMessage[];
  turns: CodexThreadTurn[];
}

export const LocalCodexHistoryDetailResponseSchema = z.object({
  entry: LocalCodexHistoryEntrySchema,
  messages: z.array(LocalCodexHistoryMessageSchema),
  turns: z.array(CodexThreadTurnSchema).default([])
});

export interface LocalCodexHistoryPageResponse {
  entry: LocalCodexHistoryEntry;
  messages: LocalCodexHistoryMessage[];
  turns: CodexThreadTurn[];
  nextCursor: string | null;
  backwardsCursor: string | null;
}

export const LocalCodexHistoryPageResponseSchema = z.object({
  entry: LocalCodexHistoryEntrySchema,
  messages: z.array(LocalCodexHistoryMessageSchema),
  turns: z.array(CodexThreadTurnSchema).default([]),
  nextCursor: z.string().nullable(),
  backwardsCursor: z.string().nullable()
});

export type LocalCodexHistoryArchiveResponse = Record<string, never>;

export const LocalCodexHistoryArchiveResponseSchema = z.object({}).strict();

export interface LocalResumeSessionResponse {
  session: LocalSessionSummary;
  history: LocalCodexHistoryPageResponse;
}

export const LocalResumeSessionResponseSchema = z.object({
  session: LocalSessionSummarySchema,
  history: LocalCodexHistoryPageResponseSchema
});

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

export const LocalHealthResponseSchema = z.object({
  ok: z.boolean(),
  version: z.string(),
  pid: z.number().int().nonnegative(),
  uptimeSeconds: z.number().nonnegative(),
  host: z.string(),
  port: z.number().int().nonnegative(),
  device: z
    .object({
      defaultName: z.string(),
      hostname: z.string(),
      platform: z.string()
    })
    .optional(),
  codex: z
    .object({
      available: z.boolean(),
      version: z.string().optional()
    })
    .optional()
});

export const ThreadSidebarPrefsPayloadSchema = z.object({
  pinned: z.array(z.string().min(1))
});

export const ProjectSidebarPrefsPayloadSchema = z.object({
  hidden: z.array(z.string().min(1)),
  pinned: z.array(z.string().min(1)),
  renamed: z.record(z.string(), z.string().min(1))
});

export const SidebarPrefsResponseSchema = z.object({
  project: ProjectSidebarPrefsPayloadSchema,
  thread: ThreadSidebarPrefsPayloadSchema
});

export type SidebarPrefsResponse = z.infer<typeof SidebarPrefsResponseSchema>;

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
  agentRunId: string;
  codexVersion?: string | null;
  startedAt: number;
}

export const MachineHelloPayloadSchema = z.object({
  deviceId: z.string().min(1),
  deviceName: z.string().min(1),
  hostname: z.string().min(1),
  platform: z.string().min(1),
  arch: z.string().min(1),
  agentVersion: z.string().min(1),
  agentRunId: z.string().min(1),
  codexVersion: z.string().nullable().optional(),
  startedAt: z.number()
}).strict();

export interface MachineHelloAck {
  ok: true;
  serverTime: number;
  heartbeatIntervalMs: number;
}

export const MachineHelloAckSchema = z.object({
  ok: z.literal(true),
  serverTime: z.number(),
  heartbeatIntervalMs: z.number().int().positive()
}).strict();

export interface RelayErrorAck {
  ok: false;
  error: string;
}

export const RelayErrorAckSchema = z.object({
  ok: z.literal(false),
  error: z.string().min(1)
}).strict();

export interface MachineHeartbeatPayload {
  deviceId: string;
  at: number;
  activeSessions: number;
}

export const MachineHeartbeatPayloadSchema = z.object({
  deviceId: z.string().min(1),
  at: z.number(),
  activeSessions: z.number().int().nonnegative()
}).strict();

export interface DevicePresence {
  deviceId: string;
  online: boolean;
  lastSeenAt: number;
  socketId?: string;
  activeSessions?: number;
}

export const DevicePresenceSchema = z.object({
  deviceId: z.string().min(1),
  online: z.boolean(),
  lastSeenAt: z.number(),
  socketId: z.string().min(1).optional(),
  activeSessions: z.number().int().nonnegative().optional()
}).strict();

export interface RelayDeviceRecord extends DevicePresence {
  deviceName: string;
  hostname: string;
  platform: string;
  arch: string;
  agentVersion: string;
  agentRunId: string;
  codexVersion?: string | null;
  startedAt: number;
}

export const RelayDeviceRecordSchema = DevicePresenceSchema.extend({
  deviceName: z.string().min(1),
  hostname: z.string().min(1),
  platform: z.string().min(1),
  arch: z.string().min(1),
  agentVersion: z.string().min(1),
  agentRunId: z.string().min(1),
  codexVersion: z.string().nullable().optional(),
  startedAt: z.number()
}).strict();

export interface RelayDevicesResponse {
  devices: RelayDeviceRecord[];
}

export const RelayDevicesResponseSchema = z.object({
  devices: z.array(RelayDeviceRecordSchema)
}).strict();

export interface RelaySessionResponse {
  ok: true;
  sessionToken: string;
}

export const RelaySessionResponseSchema = z.object({
  ok: z.literal(true),
  sessionToken: z.string().min(1)
}).strict();

export const RelayMethod = {
  AgentHealth: "agent.health",
  ProviderCatalog: "providers.catalog",
  SessionsList: "sessions.list",
  SessionsCreate: "sessions.create",
  SessionsMessage: "sessions.message",
  SessionsQueueAction: "sessions.queue.action",
  SessionsGoalGet: "sessions.goal.get",
  SessionsGoalSet: "sessions.goal.set",
  SessionsGoalClear: "sessions.goal.clear",
  TurnInterrupt: "turn.interrupt",
  ApprovalDecision: "approval.decision",
  DirectoriesList: "directories.list",
  CodexHistoryList: "codexHistory.list",
  CodexHistoryLoaded: "codexHistory.loaded",
  CodexHistoryDetail: "codexHistory.detail",
  CodexHistoryTurns: "codexHistory.turns",
  CodexHistoryArchive: "codexHistory.archive",
  CodexHistoryResume: "codexHistory.resume"
} as const;

export type RelayMethod = (typeof RelayMethod)[keyof typeof RelayMethod];

const RelayMethodValues = Object.values(RelayMethod) as [
  RelayMethod,
  ...RelayMethod[]
];

export const RelayMethodSchema = z.enum(RelayMethodValues);

export interface RelayRpcRequest {
  requestId: string;
  method: RelayMethod;
  params?: unknown;
  deadlineMs?: number;
}

export const RelayRpcRequestSchema = z.object({
  requestId: z.string().min(1),
  method: RelayMethodSchema,
  params: z.unknown().optional(),
  deadlineMs: z.number().int().positive().optional()
}).strict();

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

export const RelayRpcResponseSchema = z.union([
  z.object({
    ok: z.literal(true),
    result: z.unknown().optional()
  }).strict(),
  z.object({
    ok: z.literal(false),
    error: z.object({
      message: z.string().min(1),
      code: z.string().min(1).optional(),
      data: z.unknown().optional()
    }).strict()
  }).strict()
]);

export interface MachineEventPayload {
  deviceId: string;
  agentRunId: string;
  event: LocalEvent;
}

export interface DeviceEventPayload {
  deviceId: string;
  event: LocalEvent;
}

export const DeviceEventPayloadSchema = z.object({
  deviceId: z.string().min(1),
  event: LocalEventSchema
});

export const PairingRequestPayloadSchema = z.object({
  deviceId: z.string().min(1),
  deviceToken: z.string().min(1),
  deviceName: z.string().min(1),
  hostname: z.string().min(1),
  platform: z.string().min(1),
  arch: z.string().min(1),
  agentVersion: z.string().min(1),
  codexVersion: z.string().nullable().optional(),
  relayUrl: z.string().nullable().optional()
});

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

export const PairingCreateResponseSchema = z.object({
  requestId: z.string().min(1),
  pollToken: z.string().min(1),
  code: z.string().min(1),
  codeDigits: z.string().min(1),
  expiresAt: z.number(),
  approveUrl: z.string().nullable().optional()
});

const PairingStatusSchema = z.enum(["pending", "approved", "rejected", "expired"]);

export const PairingRequestViewSchema = z.object({
  requestId: z.string().min(1),
  codeDigits: z.string().min(1),
  deviceId: z.string().min(1),
  deviceName: z.string().min(1),
  hostname: z.string().min(1),
  platform: z.string().min(1),
  arch: z.string().min(1),
  agentVersion: z.string().min(1),
  codexVersion: z.string().nullable().optional(),
  relayUrl: z.string().nullable().optional(),
  shortFingerprint: z.string().min(1),
  createdAt: z.number(),
  expiresAt: z.number(),
  status: PairingStatusSchema
});

export const PairingPollResponseSchema = z.object({
  ok: z.boolean(),
  status: PairingStatusSchema,
  deviceId: z.string().min(1),
  expiresAt: z.number()
});

export const PairingApproveResponseSchema = z.object({
  ok: z.literal(true),
  deviceId: z.string().min(1),
  sessionToken: z.string().min(1)
}).strict();

export interface PairingCreateResponse {
  requestId: string;
  pollToken: string;
  code: string;
  codeDigits: string;
  expiresAt: number;
  approveUrl?: string | null;
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
