import { createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { availableRelayPermissionOptions } from "../features/console/console-utils";
import { LiveComposer } from "./chat/LiveComposer";
import { SessionSetupSheet } from "./sheets/SessionSetupSheet";

const allPermissionOptions = [
  {
    description: "Ask before risky operations",
    icon: "shield" as const,
    label: "请求批准",
    mode: "request-approval" as const
  },
  {
    description: "Approve safe operations automatically",
    icon: "shield" as const,
    label: "替我审批",
    mode: "auto-approve" as const
  },
  {
    description: "Full access",
    icon: "shieldAlert" as const,
    label: "完全访问权限",
    mode: "full-access" as const
  },
  {
    description: "Use config.toml permissions",
    icon: "settings" as const,
    label: "自定义 config.toml",
    mode: "custom-config" as const
  }
];

const modelOptions = [
  { label: "GPT-5", shortLabel: "GPT-5", value: "gpt-5" }
];

const reasoningOptions = [
  { label: "Medium", value: "medium" as const }
];

const noop = () => {};

describe("rendered permission filtering", () => {
  it("omits full access from the session setup sheet when options are filtered", () => {
    const permissionOptions = availableRelayPermissionOptions(
      allPermissionOptions,
      {
        relayEnabled: true,
        relayFullAccessEnabled: false
      }
    );
    const markup = renderToStaticMarkup(
      createElement(SessionSetupSheet, {
        connected: true,
        cwd: "/repo",
        deviceName: "MacBook",
        directoryError: null,
        directoryList: null,
        directoryLoading: false,
        initialGoal: "",
        initialTokenBudget: "",
        model: "gpt-5",
        modelOptions,
        permissionMode: "request-approval",
        permissionOptions,
        reasoningEffort: "medium",
        reasoningOptions,
        streamStatus: "idle",
        onClose: noop,
        onInitialGoalChange: noop,
        onInitialTokenBudgetChange: noop,
        onLoadDirectories: noop,
        onOpenDevice: noop,
        onSelectCwd: noop,
        onSelectModel: noop,
        onSelectPermission: noop,
        onSelectReasoning: noop
      })
    );

    expect(markup).toContain("请求批准");
    expect(markup).toContain("自定义 config.toml");
    expect(markup).not.toContain("完全访问权限");
  });

  it("omits full access from the live composer permission menu when options are filtered", () => {
    const permissionOptions = availableRelayPermissionOptions(
      allPermissionOptions,
      {
        relayEnabled: true,
        relayFullAccessEnabled: false
      }
    );
    const markup = renderToStaticMarkup(
      createElement(LiveComposer, {
        activeMenu: "permission",
        activeTurn: false,
        attachments: [],
        draft: "",
        fileInputRef: createRef<HTMLInputElement>(),
        goalMode: false,
        hasGoal: false,
        modelOptions,
        permissionMode: "request-approval",
        permissionOptions,
        planMode: false,
        queuedMessages: [],
        reasoningEffort: "medium",
        reasoningOptions,
        selectedModel: modelOptions[0]!,
        selectedPermission: permissionOptions[0]!,
        selectedReasoning: reasoningOptions[0]!,
        onActivateGoalMode: noop,
        onAttachFiles: noop,
        onClearGoal: noop,
        onCloseMenu: noop,
        onDismissGoalMode: noop,
        onDraftChange: noop,
        onInterrupt: noop,
        onOpenMenu: noop,
        onQueuedMessageDelete: noop,
        onQueuedMessageEdit: noop,
        onQueuedMessageReorder: noop,
        onQueuedMessageSteer: noop,
        onQueuedMessagesClear: noop,
        onRemoveAttachment: noop,
        onSelectModel: noop,
        onSelectPermission: noop,
        onSelectReasoning: noop,
        onSubmit: noop,
        onSubmitGuide: noop,
        onTogglePlanMode: noop
      })
    );

    expect(markup).toContain("请求批准");
    expect(markup).toContain("自定义 config.toml");
    expect(markup).not.toContain("完全访问权限");
  });
});
