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
  ThreadListParams,
  ThreadListResponse,
  ThreadReadParams,
  ThreadReadResponse,
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
  CodexServerRequestMethod
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
    return this.rpc.onNotification(listener);
  }

  public onNotificationMethod(
    method: string,
    listener: (params: unknown, notification: AppServerNotification) => void
  ): () => void {
    return this.rpc.onNotification(method, listener);
  }

  public initialize(params?: Partial<InitializeParams>): Promise<InitializeResponse> {
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

    return this.rpc.request<InitializeResponse>(
      CodexClientMethod.Initialize,
      merged
    );
  }

  public initialized(): Promise<void> {
    return this.rpc.notify(CodexClientMethod.Initialized, {});
  }

  public threadStart(
    params: ThreadStartParams = {}
  ): Promise<ThreadStartResponse> {
    return this.rpc.request<ThreadStartResponse>(
      CodexClientMethod.ThreadStart,
      params
    );
  }

  public threadResume(params: ThreadResumeParams): Promise<ThreadResumeResponse> {
    return this.rpc.request<ThreadResumeResponse>(
      CodexClientMethod.ThreadResume,
      params
    );
  }

  public threadUnarchive(
    params: ThreadUnarchiveParams
  ): Promise<ThreadUnarchiveResponse> {
    return this.rpc.request<ThreadUnarchiveResponse>(
      CodexClientMethod.ThreadUnarchive,
      params
    );
  }

  public threadList(params: ThreadListParams = {}): Promise<ThreadListResponse> {
    return this.rpc.request<ThreadListResponse>(
      CodexClientMethod.ThreadList,
      params
    );
  }

  public threadRead(params: ThreadReadParams): Promise<ThreadReadResponse> {
    return this.rpc.request<ThreadReadResponse>(
      CodexClientMethod.ThreadRead,
      params
    );
  }

  public setGoal(
    params: ThreadGoalSetParams
  ): Promise<ThreadGoalSetResponse> {
    return this.rpc.request<ThreadGoalSetResponse>(
      CodexClientMethod.ThreadGoalSet,
      params
    );
  }

  public getGoal(
    params: ThreadGoalGetParams
  ): Promise<ThreadGoalGetResponse> {
    return this.rpc.request<ThreadGoalGetResponse>(
      CodexClientMethod.ThreadGoalGet,
      params
    );
  }

  public clearGoal(
    params: ThreadGoalClearParams
  ): Promise<ThreadGoalClearResponse> {
    return this.rpc.request<ThreadGoalClearResponse>(
      CodexClientMethod.ThreadGoalClear,
      params
    );
  }

  public turnStart(params: TurnStartParams): Promise<TurnStartResponse> {
    return this.rpc.request<TurnStartResponse>(
      CodexClientMethod.TurnStart,
      params
    );
  }

  public turnSteer(params: TurnSteerParams): Promise<unknown> {
    return this.rpc.request(CodexClientMethod.TurnSteer, params);
  }

  public turnInterrupt(params: TurnInterruptParams): Promise<unknown> {
    return this.rpc.request(CodexClientMethod.TurnInterrupt, params);
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
        const callbackResult = await this.approvalRequestHandler?.({
          method,
          params,
          receivedAt: new Date()
        });
        return callbackResult ?? defaultDeclineApprovalResponse(method);
      });
    }
  }
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
