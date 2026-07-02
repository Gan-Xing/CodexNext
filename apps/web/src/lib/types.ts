import type {
  DeviceIdentityFile,
  DevicePresence,
  DeviceEventPayload,
  LocalApprovalDecision,
  LocalCodexHistoryArchiveResponse,
  LocalCreateSessionResponse,
  LocalCodexHistoryDetailResponse,
  LocalCodexHistoryEntry,
  LocalCodexHistoryMessage,
  LocalCodexHistoryPageResponse,
  LocalCodexHistoryResponse,
  LocalLoadedThreadsResponse,
  LocalQueueActionInput,
  LocalQueueActionResponse,
  LocalQueuedMessage,
  LocalDirectoryListResponse,
  LocalEvent,
  LocalHealthResponse,
  LocalInterruptResponse,
  LocalPermissionMode,
  LocalProviderConfig,
  LocalProviderCatalogResponse,
  LocalProviderPreset,
  LocalProviderSummary,
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
  LocalSendMessageResponse,
  LocalSendMessageInput,
  LocalStartSessionInput,
  LocalUpdateSessionRuntimeInput,
  LocalUpdateSessionRuntimeResponse,
  LocalSessionsResponse,
  LocalSessionSummary
} from "@codexnext/protocol";

export interface AgentConnection {
  mode: "relay";
  relayUrl: string;
  sessionToken: string;
  deviceId: string;
}

export type {
  DeviceIdentityFile,
  DevicePresence,
  DeviceEventPayload,
  LocalApprovalDecision,
  LocalCodexHistoryArchiveResponse,
  LocalCreateSessionResponse,
  LocalCodexHistoryDetailResponse,
  LocalCodexHistoryEntry,
  LocalCodexHistoryMessage,
  LocalCodexHistoryPageResponse,
  LocalCodexHistoryResponse,
  LocalLoadedThreadsResponse,
  LocalQueueActionInput,
  LocalQueueActionResponse,
  LocalQueuedMessage,
  LocalDirectoryListResponse,
  LocalEvent,
  LocalHealthResponse,
  LocalInterruptResponse,
  LocalPermissionMode,
  LocalProviderConfig,
  LocalProviderCatalogResponse,
  LocalProviderPreset,
  LocalProviderSummary,
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
  LocalSendMessageResponse,
  LocalSendMessageInput,
  LocalStartSessionInput,
  LocalUpdateSessionRuntimeInput,
  LocalUpdateSessionRuntimeResponse,
  LocalSessionsResponse,
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
  | "pending"
  | "queued"
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

export interface ThreadSidebarPrefsPayload {
  pinned: string[];
}

export interface ProjectSidebarPrefsPayload {
  hidden: string[];
  pinned: string[];
  renamed: Record<string, string>;
}

export interface SidebarPrefsResponse {
  project: ProjectSidebarPrefsPayload;
  thread: ThreadSidebarPrefsPayload;
}
