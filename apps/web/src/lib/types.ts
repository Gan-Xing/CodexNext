import type {
  AgentConnection,
  DeviceIdentityFile,
  DevicePresence,
  DeviceEventPayload,
  LocalApprovalDecision,
  LocalCodexHistoryDetailResponse,
  LocalCodexHistoryEntry,
  LocalCodexHistoryMessage,
  LocalCodexHistoryPageResponse,
  LocalCodexHistoryResponse,
  LocalLoadedThreadsResponse,
  LocalDirectoryListResponse,
  LocalEvent,
  LocalHealthResponse,
  LocalPermissionMode,
  LocalReasoningEffort,
  PairingApproveResponse,
  PairingCreateResponse,
  PairingPollResponse,
  PairingRequestPayload,
  PairingRequestView,
  RelayDeviceRecord,
  RelayDevicesResponse,
  RelaySessionResponse,
  RelayMethod,
  RelayRpcRequest,
  RelayRpcResponse,
  LocalResumeSessionResponse,
  LocalSendMessageInput,
  LocalStartSessionInput,
  LocalSessionSummary
} from "@codexnext/protocol";

export type {
  AgentConnection,
  DeviceIdentityFile,
  DevicePresence,
  DeviceEventPayload,
  LocalApprovalDecision,
  LocalCodexHistoryDetailResponse,
  LocalCodexHistoryEntry,
  LocalCodexHistoryMessage,
  LocalCodexHistoryPageResponse,
  LocalCodexHistoryResponse,
  LocalLoadedThreadsResponse,
  LocalDirectoryListResponse,
  LocalEvent,
  LocalHealthResponse,
  LocalPermissionMode,
  LocalReasoningEffort,
  PairingApproveResponse,
  PairingCreateResponse,
  PairingPollResponse,
  PairingRequestPayload,
  PairingRequestView,
  RelayDeviceRecord,
  RelayDevicesResponse,
  RelaySessionResponse,
  RelayMethod,
  RelayRpcRequest,
  RelayRpcResponse,
  LocalResumeSessionResponse,
  LocalSendMessageInput,
  LocalStartSessionInput,
  LocalSessionSummary
};

export type ChatItemRole =
  | "user"
  | "assistant"
  | "command"
  | "system"
  | "diff"
  | "plan";

export type ChatItemStatus =
  | "sending"
  | "sent"
  | "failed"
  | "streaming"
  | "complete";

export interface ChatItem {
  id: string;
  role: ChatItemRole;
  text: string;
  sessionId?: string | undefined;
  turnId?: string | undefined;
  clientMessageId?: string | undefined;
  status?: ChatItemStatus | undefined;
  createdAt?: number | undefined;
  error?: string | undefined;
  meta?: Record<string, unknown> | undefined;
}

export interface PendingApprovalView {
  approvalId: string;
  sessionId: string;
  threadId?: string | undefined;
  turnId?: string | undefined;
  method: string;
  params: unknown;
  createdAt: number;
  expiresAt: number;
}
