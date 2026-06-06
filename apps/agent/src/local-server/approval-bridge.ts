import { randomUUID } from "node:crypto";
import type {
  ApprovalResponse,
  LocalApprovalDecision
} from "@codexnext/protocol";
import {
  CodexServerRequestMethod,
  LocalEventType,
  isRecord
} from "@codexnext/protocol";
import type { EventStore } from "./event-store.js";

export interface PendingApproval {
  approvalId: string;
  sessionId: string;
  threadId?: string;
  turnId?: string;
  method: string;
  params: unknown;
  createdAt: number;
  expiresAt: number;
}

interface InternalPendingApproval extends PendingApproval {
  timer: NodeJS.Timeout;
  resolve: (response: ApprovalResponse) => void;
}

export interface ApprovalBridgeOptions {
  timeoutMs: number;
  eventStore: EventStore;
}

export class ApprovalBridge {
  private readonly pending = new Map<string, InternalPendingApproval>();

  public constructor(private readonly options: ApprovalBridgeOptions) {}

  public requestApproval(input: {
    sessionId: string;
    method: string;
    params: unknown;
  }): Promise<ApprovalResponse> {
    const approvalId = randomUUID();
    const now = Date.now();
    const ids = extractThreadAndTurn(input.params);

    return new Promise<ApprovalResponse>((resolve) => {
      const pending: InternalPendingApproval = {
        approvalId,
        sessionId: input.sessionId,
        ...(ids.threadId ? { threadId: ids.threadId } : {}),
        ...(ids.turnId ? { turnId: ids.turnId } : {}),
        method: input.method,
        params: input.params,
        createdAt: now,
        expiresAt: now + this.options.timeoutMs,
        resolve,
        timer: setTimeout(() => {
          this.resolveDecision(approvalId, "decline", "timeout");
        }, this.options.timeoutMs)
      };

      this.pending.set(approvalId, pending);
      this.options.eventStore.append({
        type: LocalEventType.ApprovalRequested,
        sessionId: input.sessionId,
        threadId: pending.threadId,
        turnId: pending.turnId,
        payload: publicApproval(pending)
      });
    });
  }

  public listPending(): PendingApproval[] {
    return [...this.pending.values()].map(publicApproval);
  }

  public resolveDecision(
    approvalId: string,
    decision: LocalApprovalDecision,
    reason = "user"
  ): ApprovalResponse {
    const pending = this.pending.get(approvalId);
    if (!pending) {
      throw new Error(`No pending approval for id ${approvalId}`);
    }

    clearTimeout(pending.timer);
    this.pending.delete(approvalId);

    const response = mapDecision(pending.method, decision);
    pending.resolve(response);
    this.options.eventStore.append({
      type: LocalEventType.ApprovalResolved,
      sessionId: pending.sessionId,
      threadId: pending.threadId,
      turnId: pending.turnId,
      payload: {
        approvalId,
        method: pending.method,
        decision,
        reason,
        response
      }
    });
    return response;
  }
}

function publicApproval(pending: PendingApproval): PendingApproval {
  return {
    approvalId: pending.approvalId,
    sessionId: pending.sessionId,
    ...(pending.threadId ? { threadId: pending.threadId } : {}),
    ...(pending.turnId ? { turnId: pending.turnId } : {}),
    method: pending.method,
    params: pending.params,
    createdAt: pending.createdAt,
    expiresAt: pending.expiresAt
  };
}

function mapDecision(
  method: string,
  decision: LocalApprovalDecision
): ApprovalResponse {
  if (
    method === CodexServerRequestMethod.LegacyExecCommandApproval ||
    method === CodexServerRequestMethod.LegacyApplyPatchApproval
  ) {
    if (decision === "accept") {
      return { decision: "approved" };
    }
    if (decision === "acceptForSession") {
      return { decision: "approved_for_session" };
    }
    if (decision === "cancel") {
      return { decision: "abort" };
    }
    return { decision: "denied" };
  }

  return { decision };
}

function extractThreadAndTurn(params: unknown): {
  threadId?: string;
  turnId?: string;
} {
  if (!isRecord(params)) {
    return {};
  }
  const threadId = typeof params.threadId === "string" ? params.threadId : undefined;
  const turnId = typeof params.turnId === "string" ? params.turnId : undefined;
  return {
    ...(threadId ? { threadId } : {}),
    ...(turnId ? { turnId } : {})
  };
}

