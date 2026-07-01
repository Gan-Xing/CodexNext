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

const providerOptions = [
  { label: "Codex 默认", preset: null, value: "" }
];

const providerOptionsWithCustom = [
  { label: "Codex 默认", preset: null, value: "" },
  { label: "OpenRouter", preset: "openrouter" as const, value: "openrouter" },
  { label: "自定义", preset: "custom" as const, value: "custom" }
];

const noop = () => {};

type SessionSetupSheetProps = Parameters<typeof SessionSetupSheet>[0];

function renderSessionSetupSheet(
  overrides: Partial<SessionSetupSheetProps> = {}
): string {
  const props: SessionSetupSheetProps = {
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
    permissionOptions: allPermissionOptions,
    providerApiKey: "",
    providerApiKeyEnv: "",
    providerAvailable: false,
    providerBaseUrl: "",
    providerCatalogLoading: false,
    providerLabel: "",
    providerModel: "",
    providerModelOptions: [],
    providerOptions,
    providerProfileId: "",
    providerStatusMessage: null,
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
    onSelectProviderProfile: noop,
    onProviderApiKeyChange: noop,
    onProviderApiKeyEnvChange: noop,
    onProviderBaseUrlChange: noop,
    onProviderLabelChange: noop,
    onProviderModelChange: noop,
    onSelectReasoning: noop
  };
  return renderToStaticMarkup(
    createElement(SessionSetupSheet, {
      ...props,
      ...overrides
    })
  );
}

type LiveComposerProps = Parameters<typeof LiveComposer>[0];

function renderLiveComposer(overrides: Partial<LiveComposerProps> = {}): string {
  const props: LiveComposerProps = {
    activeMenu: null,
    activeTurn: false,
    attachments: [],
    draft: "",
    fileInputRef: createRef<HTMLInputElement>(),
    goalMode: false,
    hasGoal: false,
    activeModelLabel: "GPT-5",
    modelOptions,
    permissionMode: "request-approval",
    permissionOptions: allPermissionOptions,
    planMode: false,
    providerModelOptions: [],
    providerOptions,
    providerProfileId: "",
    queuedMessages: [],
    reasoningEffort: "medium",
    reasoningOptions,
    selectedModel: modelOptions[0]!,
    selectedPermission: allPermissionOptions[0]!,
    selectedProviderModel: null,
    selectedReasoning: reasoningOptions[0]!,
    serviceTier: null,
    onActivateGoalMode: noop,
    onAttachFiles: noop,
    onClearGoal: noop,
    onClearServiceTier: noop,
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
    onSelectProviderModel: noop,
    onSelectProviderProfile: noop,
    onSelectReasoning: noop,
    onRunSlashCommand: noop,
    onSubmit: noop,
    onSubmitGuide: noop,
    onTogglePlanMode: noop,
    ...overrides
  };

  return renderToStaticMarkup(createElement(LiveComposer, props));
}

describe("rendered permission filtering", () => {
  it("omits full access from the session setup sheet when options are filtered", () => {
    const permissionOptions = availableRelayPermissionOptions(
      allPermissionOptions,
      {
        relayEnabled: true,
        relayFullAccessEnabled: false
      }
    );
    const markup = renderSessionSetupSheet({ permissionOptions });

    expect(markup).toContain("请求批准");
    expect(markup).toContain("自定义 config.toml");
    expect(markup).not.toContain("完全访问权限");
  });

  it("disables provider selection when the current device has no Provider runtime", () => {
    const markup = renderSessionSetupSheet({
      providerAvailable: false,
      providerStatusMessage: "当前设备未启用 CodexProvider：missing codex-provider"
    });

    expect(markup).toContain("当前设备未启用 CodexProvider");
    expect(markup).toContain('name="session_provider" disabled=""');
  });

  it("keeps custom provider selection visible when the current device supports Provider runtime", () => {
    const markup = renderSessionSetupSheet({
      providerAvailable: true,
      providerOptions: providerOptionsWithCustom
    });

    expect(markup).toContain("OpenRouter");
    expect(markup).toContain("自定义");
    expect(markup).not.toContain('name="session_provider" disabled=""');
  });

  it("renders a searchable Provider model picker in the session setup sheet", () => {
    const providerModelOptions = Array.from({ length: 48 }, (_, index) => ({
      label: `DeepSeek V${index + 1}`,
      value: `deepseek/model-${index + 1}`
    }));
    const markup = renderSessionSetupSheet({
      providerAvailable: true,
      providerModel: providerModelOptions[0]!.value,
      providerModelOptions,
      providerOptions: providerOptionsWithCustom,
      providerProfileId: "openrouter"
    });

    expect(markup).toContain('aria-label="搜索 Provider 模型"');
    expect(markup).toContain("48/48");
    expect(markup).toContain("deepseek/model-48");
    expect(markup).not.toContain('name="session_provider_model"');
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
        activeModelLabel: "GPT-5",
        modelOptions,
        permissionMode: "request-approval",
        permissionOptions,
        planMode: false,
        providerModelOptions: [],
        providerOptions,
        providerProfileId: "",
        queuedMessages: [],
        reasoningEffort: "medium",
        reasoningOptions,
        selectedModel: modelOptions[0]!,
        selectedPermission: permissionOptions[0]!,
        selectedProviderModel: null,
        selectedReasoning: reasoningOptions[0]!,
        serviceTier: null,
        onActivateGoalMode: noop,
        onAttachFiles: noop,
        onClearGoal: noop,
        onClearServiceTier: noop,
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
        onSelectProviderModel: noop,
        onSelectProviderProfile: noop,
        onSelectReasoning: noop,
        onRunSlashCommand: noop,
        onSubmit: noop,
        onSubmitGuide: noop,
        onTogglePlanMode: noop
      })
    );

    expect(markup).toContain("请求批准");
    expect(markup).toContain("自定义 config.toml");
    expect(markup).not.toContain("完全访问权限");
  });

  it("renders the Provider model menu with search and counts for long catalogs", () => {
    const providerModelOptions = Array.from({ length: 64 }, (_, index) => ({
      label: `DeepSeek V${index + 1}`,
      shortLabel: `DS V${index + 1}`,
      value: `deepseek/model-${index + 1}`
    }));
    const markup = renderToStaticMarkup(
      createElement(LiveComposer, {
        activeMenu: "model",
        activeTurn: false,
        attachments: [],
        draft: "",
        fileInputRef: createRef<HTMLInputElement>(),
        goalMode: false,
        hasGoal: false,
        activeModelLabel: "OpenRouter · DeepSeek V1",
        modelOptions,
        permissionMode: "request-approval",
        permissionOptions: allPermissionOptions,
        planMode: false,
        providerModelOptions,
        providerOptions: providerOptionsWithCustom,
        providerProfileId: "openrouter",
        queuedMessages: [],
        reasoningEffort: "medium",
        reasoningOptions,
        selectedModel: modelOptions[0]!,
        selectedPermission: allPermissionOptions[0]!,
        selectedProviderModel: providerModelOptions[0]!,
        selectedReasoning: reasoningOptions[0]!,
        serviceTier: null,
        onActivateGoalMode: noop,
        onAttachFiles: noop,
        onClearGoal: noop,
        onClearServiceTier: noop,
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
        onSelectProviderModel: noop,
        onSelectProviderProfile: noop,
        onSelectReasoning: noop,
        onRunSlashCommand: noop,
        onSubmit: noop,
        onSubmitGuide: noop,
        onTogglePlanMode: noop
      })
    );

    expect(markup).toContain('aria-label="搜索模型"');
    expect(markup).toContain("64/64");
    expect(markup).toContain("OpenRouter");
    expect(markup).toContain("自定义");
    expect(markup).toContain("deepseek/model-64");
  });

  it("wraps long composer pill labels so mobile toolbars can truncate them", () => {
    const selectedProviderModel = {
      label: "DeepSeek V4 Pro Ultra Long Context Preview",
      shortLabel: "DeepSeek V4 Pro",
      value: "deepseek/deepseek-v4-pro-ultra-long-context-preview"
    };
    const markup = renderLiveComposer({
      activeTurn: true,
      activeModelLabel: "OpenRouter · DeepSeek V4 Pro Ultra Long Context Preview",
      draft: "继续沿着当前目标推进",
      goalMode: false,
      hasGoal: true,
      providerModelOptions: [selectedProviderModel],
      providerOptions: providerOptionsWithCustom,
      providerProfileId: "openrouter",
      selectedProviderModel,
      serviceTier: "priority"
    });

    expect(markup).toContain('class="cn-composer-pill cn-composer-pill-model"');
    expect(markup).toContain(
      'title="OpenRouter · DeepSeek V4 Pro Ultra Long Context Preview · Medium"'
    );
    expect(markup).toContain(
      '<span class="cn-composer-pill-label">OpenRouter · DeepSeek V4 Pro Ultra Long Context Preview · Medium</span>'
    );
    expect(markup).toContain('<span class="cn-composer-pill-label">请求批准</span>');
    expect(markup).toContain('<span class="cn-composer-pill-label">引导对话</span>');
    expect(markup).toContain("Fast");
  });
});
