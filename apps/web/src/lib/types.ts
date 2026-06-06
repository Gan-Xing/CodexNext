import type {
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
  LocalSessionSummary
} from "@codexnext/protocol";

export type {
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
  LocalSessionSummary
};

export interface ChatItem {
  id: string;
  role: "user" | "assistant" | "command" | "system" | "diff";
  text: string;
  sessionId?: string | undefined;
  turnId?: string | undefined;
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
