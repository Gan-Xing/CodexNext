import type {
  LocalApprovalDecision,
  LocalCodexHistoryDetailResponse,
  LocalCodexHistoryEntry,
  LocalCodexHistoryMessage,
  LocalCodexHistoryResponse,
  LocalDirectoryListResponse,
  LocalEvent,
  LocalHealthResponse,
  LocalPermissionMode,
  LocalReasoningEffort,
  LocalResumeSessionResponse,
  LocalSendMessageInput,
  LocalStartSessionInput,
  LocalSessionSummary
} from "@codexnext/protocol";

export type {
  LocalApprovalDecision,
  LocalCodexHistoryDetailResponse,
  LocalCodexHistoryEntry,
  LocalCodexHistoryMessage,
  LocalCodexHistoryResponse,
  LocalDirectoryListResponse,
  LocalEvent,
  LocalHealthResponse,
  LocalPermissionMode,
  LocalReasoningEffort,
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
