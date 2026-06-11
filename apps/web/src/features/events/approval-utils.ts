import { CodexServerRequestMethod } from "@codexnext/protocol";
import type { PendingApprovalView } from "../../lib/types";
import { isRecord, readString } from "../../lib/format/text";

export interface ApprovalSummary {
  availableDecisions: string[];
  command: string | null;
  cwd: string | null;
  filePath: string | null;
  grantRoot: string | null;
  host: string | null;
  protocol: string | null;
  reason: string | null;
  title: string;
  typeLabel: string;
}

export function summarizeApproval(approval: PendingApprovalView): ApprovalSummary {
  const params = isRecord(approval.params) ? approval.params : null;
  const command = params ? readString(params, "command") ?? readString(params, "cmd") : null;
  const cwd = params ? readString(params, "cwd") ?? readString(params, "workdir") : null;
  const filePath = params
    ? readString(params, "path") ??
      readString(params, "filePath") ??
      readString(params, "targetPath")
    : null;
  const grantRoot = params
    ? readString(params, "grantRoot") ?? readString(params, "workspaceRoot")
    : null;
  const reason = params ? readString(params, "reason") : null;
  const networkContext = params && isRecord(params.networkApprovalContext)
    ? params.networkApprovalContext
    : null;
  const host = networkContext ? readString(networkContext, "host") : null;
  const protocol = networkContext ? readString(networkContext, "protocol") : null;
  const availableDecisions =
    params && Array.isArray(params.availableDecisions)
      ? params.availableDecisions.filter(
          (item): item is string => typeof item === "string" && item.length > 0
        )
      : ["accept", "acceptForSession", "decline", "cancel"];

  return {
    availableDecisions,
    command,
    cwd,
    filePath,
    grantRoot,
    host,
    protocol,
    reason,
    title:
      command ??
      filePath ??
      host ??
      (approval.method === CodexServerRequestMethod.ToolRequestUserInput
        ? "Codex needs user input"
        : "Codex requests approval"),
    typeLabel: approvalTypeLabel(approval.method)
  };
}

export function approvalTypeLabel(method: string): string {
  if (
    method === CodexServerRequestMethod.CommandExecutionRequestApproval ||
    method === CodexServerRequestMethod.LegacyExecCommandApproval
  ) {
    return "Run command";
  }
  if (
    method === CodexServerRequestMethod.FileChangeRequestApproval ||
    method === CodexServerRequestMethod.LegacyApplyPatchApproval
  ) {
    return "Apply file changes";
  }
  if (method === CodexServerRequestMethod.PermissionsRequestApproval) {
    return "Network access";
  }
  if (
    method === CodexServerRequestMethod.ToolRequestUserInput ||
    method === CodexServerRequestMethod.McpElicitationRequest
  ) {
    return "Tool user input";
  }
  return "Codex request";
}
