import type {
  AppServerNotification,
  ApprovalResponse,
  InitializeParams,
  InitializeResponse,
  ThreadGoalClearParams,
  ThreadGoalClearResponse,
  ThreadGoalGetParams,
  ThreadGoalGetResponse,
  ThreadGoalSetParams,
  ThreadGoalSetResponse,
  ThreadArchiveParams,
  ThreadArchiveResponse,
  ThreadLoadedListResponse,
  ThreadListParams,
  ThreadListResponse,
  ThreadReadParams,
  ThreadReadResponse,
  ThreadTurnsListParams,
  ThreadTurnsListResponse,
  ThreadResumeParams,
  ThreadResumeResponse,
  ThreadStartParams,
  ThreadStartResponse,
  ThreadUnarchiveParams,
  ThreadUnarchiveResponse,
  TurnInterruptParams,
  TurnStartParams,
  TurnStartResponse,
  TurnSteerParams
} from "@codexnext/protocol";
import {
  CodexClientMethod,
  CodexServerRequestMethod,
  CommandExecutionRequestApprovalParamsSchema,
  CommandExecutionRequestApprovalResponseSchema,
  FileChangeRequestApprovalParamsSchema,
  FileChangeRequestApprovalResponseSchema,
  InitializeParamsSchema,
  LegacyApplyPatchApprovalParamsSchema,
  LegacyExecCommandApprovalParamsSchema,
  LegacyApprovalResponseSchema,
  ThreadArchiveParamsSchema,
  ThreadArchiveResponseSchema,
  ThreadGoalClearParamsSchema,
  ThreadGoalClearResponseSchema,
  ThreadGoalGetParamsSchema,
  ThreadGoalGetResponseSchema,
  ThreadGoalSetParamsSchema,
  ThreadGoalSetResponseSchema,
  ThreadLoadedListParamsSchema,
  ThreadLoadedListResponseSchema,
  ThreadListParamsSchema,
  ThreadListResponseSchema,
  ThreadReadParamsSchema,
  ThreadReadResponseSchema,
  ThreadResumeParamsSchema,
  ThreadResumeResponseSchema,
  ThreadStartParamsSchema,
  ThreadStartResponseSchema,
  ThreadTurnsListParamsSchema,
  ThreadTurnsListResponseSchema,
  ThreadUnarchiveParamsSchema,
  ThreadUnarchiveResponseSchema,
  TurnInterruptParamsSchema,
  TurnStartResponseSchema,
  TurnStartParamsSchema,
  TurnSteerParamsSchema,
  parseAppServerNotification
} from "@codexnext/protocol";
import { JsonRpcClient, type JsonRpcClientOptions } from "./json-rpc.js";
import {
  StdioCodexTransport,
  type StdioCodexTransportOptions
} from "./stdio-transport.js";

export interface ApprovalRequest {
  method: string;
  params: unknown;
  receivedAt: Date;
}

export type ApprovalRequestHandler = (
  request: ApprovalRequest
) => ApprovalResponse | undefined | Promise<ApprovalResponse | undefined>;

export interface CodexAppServerClientOptions extends JsonRpcClientOptions {
  onApprovalRequest?: ApprovalRequestHandler;
}

export class CodexAppServerClient {
  private approvalRequestHandler: ApprovalRequestHandler | undefined;

  public constructor(
    private readonly rpc: JsonRpcClient,
    options: CodexAppServerClientOptions = {}
  ) {
    this.approvalRequestHandler = options.onApprovalRequest;
    this.registerDefaultApprovalHandlers();
  }

  public static connectStdio(
    transportOptions: StdioCodexTransportOptions = {},
    clientOptions: CodexAppServerClientOptions = {}
  ): CodexAppServerClient {
    const transport = new StdioCodexTransport(transportOptions);
    transport.start();
    return new CodexAppServerClient(
      new JsonRpcClient(transport, clientOptions),
      clientOptions
    );
  }

  public setApprovalRequestHandler(handler: ApprovalRequestHandler): void {
    this.approvalRequestHandler = handler;
  }

  public onNotification(
    listener: (notification: AppServerNotification) => void
  ): () => void {
    return this.rpc.onNotification((notification) => {
      const parsed = parseAppServerNotification(notification);
      if (parsed) {
        listener(parsed);
      }
    });
  }

  public onNotificationMethod(
    method: string,
    listener: (params: unknown, notification: AppServerNotification) => void
  ): () => void {
    return this.rpc.onNotification(method, (_params, notification) => {
      const parsed = parseAppServerNotification(notification);
      if (parsed) {
        listener(parsed.params, parsed);
      }
    });
  }

  public async initialize(
    params?: Partial<InitializeParams>
  ): Promise<InitializeResponse> {
    const merged: InitializeParams = {
      clientInfo: {
        name: "codexnext_agent",
        title: "CodexNext Agent",
        version: "0.1.0",
        ...params?.clientInfo
      },
      capabilities: {
        experimentalApi: true,
        requestAttestation: false,
        ...params?.capabilities
      }
    };

    const validParams = parseAppServerRequestParams(
      InitializeParamsSchema,
      merged,
      CodexClientMethod.Initialize
    );

    return this.rpc.request<InitializeResponse>(
      CodexClientMethod.Initialize,
      validParams
    );
  }

  public initialized(): Promise<void> {
    return this.rpc.notify(CodexClientMethod.Initialized, {});
  }

  public async threadStart(
    params: ThreadStartParams = {}
  ): Promise<ThreadStartResponse> {
    const validParams = parseAppServerRequestParams(
      ThreadStartParamsSchema,
      params,
      CodexClientMethod.ThreadStart
    );
    return parseAppServerResponse(
      ThreadStartResponseSchema,
      this.rpc.request(CodexClientMethod.ThreadStart, validParams),
      CodexClientMethod.ThreadStart
    );
  }

  public async threadResume(
    params: ThreadResumeParams
  ): Promise<ThreadResumeResponse> {
    const validParams = parseAppServerRequestParams(
      ThreadResumeParamsSchema,
      params,
      CodexClientMethod.ThreadResume
    );
    return parseAppServerResponse(
      ThreadResumeResponseSchema,
      this.rpc.request(CodexClientMethod.ThreadResume, validParams),
      CodexClientMethod.ThreadResume
    );
  }

  public async threadArchive(
    params: ThreadArchiveParams
  ): Promise<ThreadArchiveResponse> {
    const validParams = parseAppServerRequestParams(
      ThreadArchiveParamsSchema,
      params,
      CodexClientMethod.ThreadArchive
    );
    return parseAppServerResponse(
      ThreadArchiveResponseSchema,
      this.rpc.request(CodexClientMethod.ThreadArchive, validParams),
      CodexClientMethod.ThreadArchive
    );
  }

  public async threadUnarchive(
    params: ThreadUnarchiveParams
  ): Promise<ThreadUnarchiveResponse> {
    const validParams = parseAppServerRequestParams(
      ThreadUnarchiveParamsSchema,
      params,
      CodexClientMethod.ThreadUnarchive
    );
    return parseAppServerResponse(
      ThreadUnarchiveResponseSchema,
      this.rpc.request(CodexClientMethod.ThreadUnarchive, validParams),
      CodexClientMethod.ThreadUnarchive
    );
  }

  public async threadList(
    params: ThreadListParams = {}
  ): Promise<ThreadListResponse> {
    const validParams = parseAppServerRequestParams(
      ThreadListParamsSchema,
      params,
      CodexClientMethod.ThreadList
    );
    return parseAppServerResponse(
      ThreadListResponseSchema,
      this.rpc.request(CodexClientMethod.ThreadList, validParams),
      CodexClientMethod.ThreadList
    );
  }

  public async threadLoadedList(): Promise<ThreadLoadedListResponse> {
    const validParams = parseAppServerRequestParams(
      ThreadLoadedListParamsSchema,
      {},
      CodexClientMethod.ThreadLoadedList
    );
    return parseAppServerResponse(
      ThreadLoadedListResponseSchema,
      this.rpc.request(CodexClientMethod.ThreadLoadedList, validParams),
      CodexClientMethod.ThreadLoadedList
    );
  }

  public async threadRead(params: ThreadReadParams): Promise<ThreadReadResponse> {
    const validParams = parseAppServerRequestParams(
      ThreadReadParamsSchema,
      params,
      CodexClientMethod.ThreadRead
    );
    return parseAppServerResponse(
      ThreadReadResponseSchema,
      this.rpc.request(CodexClientMethod.ThreadRead, validParams),
      CodexClientMethod.ThreadRead
    );
  }

  public async threadTurnsList(
    params: ThreadTurnsListParams
  ): Promise<ThreadTurnsListResponse> {
    const validParams = parseAppServerRequestParams(
      ThreadTurnsListParamsSchema,
      params,
      CodexClientMethod.ThreadTurnsList
    );
    return parseAppServerResponse(
      ThreadTurnsListResponseSchema,
      this.rpc.request(CodexClientMethod.ThreadTurnsList, validParams),
      CodexClientMethod.ThreadTurnsList
    );
  }

  public async setGoal(
    params: ThreadGoalSetParams
  ): Promise<ThreadGoalSetResponse> {
    const validParams = parseAppServerRequestParams(
      ThreadGoalSetParamsSchema,
      params,
      CodexClientMethod.ThreadGoalSet
    );
    return parseAppServerResponse(
      ThreadGoalSetResponseSchema,
      this.rpc.request(
        CodexClientMethod.ThreadGoalSet,
        validParams
      ),
      CodexClientMethod.ThreadGoalSet
    );
  }

  public async getGoal(
    params: ThreadGoalGetParams
  ): Promise<ThreadGoalGetResponse> {
    const validParams = parseAppServerRequestParams(
      ThreadGoalGetParamsSchema,
      params,
      CodexClientMethod.ThreadGoalGet
    );
    return parseAppServerResponse(
      ThreadGoalGetResponseSchema,
      this.rpc.request(
        CodexClientMethod.ThreadGoalGet,
        validParams
      ),
      CodexClientMethod.ThreadGoalGet
    );
  }

  public async clearGoal(
    params: ThreadGoalClearParams
  ): Promise<ThreadGoalClearResponse> {
    const validParams = parseAppServerRequestParams(
      ThreadGoalClearParamsSchema,
      params,
      CodexClientMethod.ThreadGoalClear
    );
    return parseAppServerResponse(
      ThreadGoalClearResponseSchema,
      this.rpc.request(
        CodexClientMethod.ThreadGoalClear,
        validParams
      ),
      CodexClientMethod.ThreadGoalClear
    );
  }

  public async turnStart(params: TurnStartParams): Promise<TurnStartResponse> {
    const validParams = parseAppServerRequestParams(
      TurnStartParamsSchema,
      params,
      CodexClientMethod.TurnStart
    );
    return parseAppServerResponse(
      TurnStartResponseSchema,
      this.rpc.request(
        CodexClientMethod.TurnStart,
        validParams
      ),
      CodexClientMethod.TurnStart
    );
  }

  public async turnSteer(params: TurnSteerParams): Promise<unknown> {
    const validParams = parseAppServerRequestParams(
      TurnSteerParamsSchema,
      params,
      CodexClientMethod.TurnSteer
    );
    return this.rpc.request(CodexClientMethod.TurnSteer, validParams);
  }

  public async turnInterrupt(params: TurnInterruptParams): Promise<unknown> {
    const validParams = parseAppServerRequestParams(
      TurnInterruptParamsSchema,
      params,
      CodexClientMethod.TurnInterrupt
    );
    return this.rpc.request(CodexClientMethod.TurnInterrupt, validParams);
  }

  public close(): Promise<void> {
    return this.rpc.close();
  }

  private registerDefaultApprovalHandlers(): void {
    const methods = [
      CodexServerRequestMethod.CommandExecutionRequestApproval,
      CodexServerRequestMethod.FileChangeRequestApproval,
      CodexServerRequestMethod.LegacyExecCommandApproval,
      CodexServerRequestMethod.LegacyApplyPatchApproval
    ];

    for (const method of methods) {
      this.rpc.registerRequestHandler(method, async (params) => {
        const validParams = parseApprovalRequestParams(method, params);
        if (validParams === undefined) {
          return defaultDeclineApprovalResponse(method);
        }

        try {
          const callbackResult = await this.approvalRequestHandler?.({
            method,
            params: validParams,
            receivedAt: new Date()
          });
          return validatedApprovalResponse(method, callbackResult);
        } catch {
          return defaultDeclineApprovalResponse(method);
        }
      });
    }
  }
}

function parseApprovalRequestParams(
  method: string,
  params: unknown
): unknown | undefined {
  const schema = approvalRequestParamsSchemaForMethod(method);
  const parsed = schema.safeParse(params);
  if (!parsed.success) {
    return undefined;
  }
  return parsed.data;
}

function approvalRequestParamsSchemaForMethod(method: string): AppServerSchema {
  if (method === CodexServerRequestMethod.CommandExecutionRequestApproval) {
    return CommandExecutionRequestApprovalParamsSchema;
  }
  if (method === CodexServerRequestMethod.FileChangeRequestApproval) {
    return FileChangeRequestApprovalParamsSchema;
  }
  if (method === CodexServerRequestMethod.LegacyExecCommandApproval) {
    return LegacyExecCommandApprovalParamsSchema;
  }
  return LegacyApplyPatchApprovalParamsSchema;
}

function validatedApprovalResponse(
  method: string,
  response: ApprovalResponse | undefined
): ApprovalResponse {
  if (response === undefined) {
    return defaultDeclineApprovalResponse(method);
  }

  const schema = approvalResponseSchemaForMethod(method);
  const parsed = schema.safeParse(response);
  if (!parsed.success) {
    return defaultDeclineApprovalResponse(method);
  }
  return parsed.data as ApprovalResponse;
}

function approvalResponseSchemaForMethod(method: string): AppServerSchema {
  if (method === CodexServerRequestMethod.CommandExecutionRequestApproval) {
    return CommandExecutionRequestApprovalResponseSchema;
  }
  if (method === CodexServerRequestMethod.FileChangeRequestApproval) {
    return FileChangeRequestApprovalResponseSchema;
  }
  return LegacyApprovalResponseSchema;
}

function defaultDeclineApprovalResponse(method: string): ApprovalResponse {
  if (method === CodexServerRequestMethod.LegacyExecCommandApproval) {
    return { decision: "denied" };
  }
  if (method === CodexServerRequestMethod.LegacyApplyPatchApproval) {
    return { decision: "denied" };
  }
  return { decision: "decline" };
}

interface AppServerSchema {
  safeParse(value: unknown): { success: true; data: unknown } | { success: false };
}

function parseAppServerRequestParams<T>(
  schema: AppServerSchema,
  params: unknown,
  method: string
): T {
  const parsed = schema.safeParse(params);
  if (!parsed.success) {
    throw new Error(`Invalid app-server request params: ${method}`);
  }
  return parsed.data as T;
}

async function parseAppServerResponse<T>(
  schema: AppServerSchema,
  response: Promise<unknown>,
  method: string
): Promise<T> {
  const payload = await response;
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new Error(`Invalid app-server response: ${method}`);
  }
  return parsed.data as T;
}
