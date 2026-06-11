import { describe, expect, it } from "vitest";
import { approvalTypeLabel, summarizeApproval } from "./approval-utils";

describe("summarizeApproval", () => {
  it("extracts command and cwd summaries", () => {
    const summary = summarizeApproval({
      approvalId: "approval_1",
      sessionId: "session_1",
      method: "item/commandExecution/requestApproval",
      params: {
        command: "pnpm test",
        cwd: "/repo",
        reason: "verify the change"
      },
      createdAt: 1,
      expiresAt: 2
    });

    expect(summary).toMatchObject({
      typeLabel: "Run command",
      title: "pnpm test",
      command: "pnpm test",
      cwd: "/repo",
      reason: "verify the change"
    });
  });

  it("extracts network context and file change context", () => {
    const summary = summarizeApproval({
      approvalId: "approval_2",
      sessionId: "session_1",
      method: "item/permissions/requestApproval",
      params: {
        path: "/repo/app.ts",
        grantRoot: "/repo",
        networkApprovalContext: {
          host: "api.openai.com",
          protocol: "https"
        }
      },
      createdAt: 1,
      expiresAt: 2
    });

    expect(summary).toMatchObject({
      typeLabel: "Network access",
      filePath: "/repo/app.ts",
      grantRoot: "/repo",
      host: "api.openai.com",
      protocol: "https"
    });
  });

  it("uses a neutral label for unknown approval methods", () => {
    expect(approvalTypeLabel("vendor/custom/requestApproval")).toBe("Codex request");
  });
});
