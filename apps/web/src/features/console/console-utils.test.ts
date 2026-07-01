import { describe, expect, it } from "vitest";
import {
  availableRelayPermissionOptions,
  buildProviderSessionRequest,
  classifyRelaySessionError,
  coerceRelayPermissionMode,
  formatMissingHistoryFolderMessage,
  formatMissingHistoryFolderShortMessage,
  formatConsoleConnectionError,
  formatConsoleError,
  formatRelaySessionError,
  mergeDevicePresenceResults,
  resolveComposerResumeBlock,
  seedSavedDevicePresence,
  sessionActiveModelLabel,
  shortModelLabel,
  validateProviderSessionRequest
} from "./console-utils";
import type {
  LocalProviderCatalogResponse,
  LocalSessionSummary
} from "../../lib/types";

const options = [
  { label: "request", mode: "request-approval" as const },
  { label: "auto", mode: "auto-approve" as const },
  { label: "full", mode: "full-access" as const },
  { label: "custom", mode: "custom-config" as const }
];

describe("console permission helpers", () => {
  it("hides full access only when relay is enabled and relay full access is disabled", () => {
    expect(
      availableRelayPermissionOptions(options, {
        relayEnabled: true,
        relayFullAccessEnabled: false
      }).map((option) => option.mode)
    ).toEqual(["request-approval", "auto-approve", "custom-config"]);

    expect(
      availableRelayPermissionOptions(options, {
        relayEnabled: false,
        relayFullAccessEnabled: false
      }).map((option) => option.mode)
    ).toContain("full-access");

    expect(
      availableRelayPermissionOptions(options, {
        relayEnabled: true,
        relayFullAccessEnabled: true
      }).map((option) => option.mode)
    ).toContain("full-access");
  });

  it("coerces a selected mode when the available options no longer contain it", () => {
    const filtered = availableRelayPermissionOptions(options, {
      relayEnabled: true,
      relayFullAccessEnabled: false
    });
    expect(coerceRelayPermissionMode("full-access", filtered)).toBe(
      "request-approval"
    );
    expect(coerceRelayPermissionMode("auto-approve", filtered)).toBe(
      "auto-approve"
    );
  });
});

describe("relay session error classification", () => {
  it("classifies clear HTTP and socket session expiry errors", () => {
    expect(classifyRelaySessionError(new Error("401 Unauthorized"))).toBe(
      "expired"
    );
    expect(classifyRelaySessionError({ data: { status: 410 } })).toBe(
      "expired"
    );
    const socketError = new Error("connect_error") as Error & {
      data?: { status: number };
    };
    socketError.data = { status: 401 };
    expect(classifyRelaySessionError(socketError)).toBe("expired");
    expect(classifyRelaySessionError(new Error("session revoked"))).toBe(
      "expired"
    );
  });

  it("formats expired relay sessions without leaking the raw transport message", () => {
    expect(formatRelaySessionError(new Error("Unauthorized token abc123"))).toBe(
      "登录会话已过期，请重新登录后再试。"
    );
    expect(formatRelaySessionError(new Error("socket hang up"))).toBeNull();
    expect(formatRelaySessionError({ data: { status: 500 } })).toBeNull();
    expect(formatRelaySessionError(new Error("not authorized for device"))).toBeNull();
  });

  it("formats controller-facing errors with relay expiry override", () => {
    expect(formatConsoleError(new Error("Unauthorized token abc123"))).toBe(
      "登录会话已过期，请重新登录后再试。"
    );
    expect(formatConsoleError(new Error("socket hang up"))).toBe(
      "socket hang up"
    );
    expect(formatConsoleError(new Error("cwd does not exist: /missing/repo"))).toBe(
      "无法继续这个对话，因为这个文件夹不存在：/missing/repo"
    );
  });

  it("formats controller connection errors with relay expiry override", () => {
    expect(
      formatConsoleConnectionError(
        new Error("Unauthorized token abc123"),
        "https://relay.example"
      )
    ).toBe("登录会话已过期，请重新登录后再试。");
    expect(
      formatConsoleConnectionError(
        new Error("socket hang up"),
        "https://relay.example"
      )
    ).toBe("socket hang up");
  });
});

describe("composer resume guards", () => {
  it("only blocks composer sends for missing history folders", () => {
    expect(resolveComposerResumeBlock("missing", "/missing/repo")).toBe(
      "无法继续这个对话，因为这个文件夹不存在：/missing/repo"
    );
    expect(resolveComposerResumeBlock("failed")).toBeNull();
    expect(resolveComposerResumeBlock("resuming")).toBeNull();
    expect(resolveComposerResumeBlock("history")).toBeNull();
    expect(resolveComposerResumeBlock(null)).toBeNull();
  });

  it("formats missing history folder messages without internal project jargon", () => {
    expect(formatMissingHistoryFolderMessage("/missing/repo")).toBe(
      "无法继续这个对话，因为这个文件夹不存在：/missing/repo"
    );
    expect(formatMissingHistoryFolderShortMessage("/missing/repo")).toBe(
      "文件夹不存在：/missing/repo"
    );
  });
});

describe("device presence helpers", () => {
  it("seeds saved devices as checking while preserving existing presence", () => {
    expect(
      seedSavedDevicePresence(
        {
          device_1: {
            checkedAt: 1,
            codexVersion: "codex 0.1.0",
            status: "online"
          },
          removed: {
            checkedAt: 1,
            status: "offline"
          }
        },
        [
          { id: "device_1", codexVersion: "codex 0.1.0" },
          { id: "device_2", codexVersion: null }
        ],
        10
      )
    ).toEqual({
      device_1: {
        checkedAt: 1,
        codexVersion: "codex 0.1.0",
        status: "online"
      },
      device_2: {
        checkedAt: 10,
        codexVersion: null,
        status: "checking"
      }
    });
  });

  it("merges presence results only for saved devices", () => {
    expect(
      mergeDevicePresenceResults(
        {
          device_1: {
            checkedAt: 1,
            status: "checking"
          },
          device_removed: {
            checkedAt: 1,
            status: "offline"
          }
        },
        new Set(["device_1", "device_2"]),
        [
          {
            id: "device_2",
            presence: {
              checkedAt: 2,
              codexVersion: "codex 0.2.0",
              status: "online"
            }
          },
          {
            id: "device_removed",
            presence: {
              checkedAt: 2,
              status: "online"
            }
          }
        ]
      )
    ).toEqual({
      device_1: {
        checkedAt: 1,
        status: "checking"
      },
      device_2: {
        checkedAt: 2,
        codexVersion: "codex 0.2.0",
        status: "online"
      }
    });
  });
});

describe("provider session helpers", () => {
  it("does not build a Provider request for the Codex default option", () => {
    expect(
      buildProviderSessionRequest({
        apiKey: "ignored",
        apiKeyEnv: "IGNORED",
        baseUrl: "https://example.invalid",
        label: "Ignored",
        model: "ignored-model",
        option: {
          preset: null,
          value: ""
        }
      })
    ).toBeNull();
  });

  it("trims Provider request fields and omits blank values", () => {
    expect(
      buildProviderSessionRequest({
        apiKey: "  sk-test  ",
        apiKeyEnv: "  ",
        baseUrl: "  https://openrouter.ai/api/v1  ",
        label: "  OpenRouter  ",
        model: "  deepseek/deepseek-chat-v3-0324  ",
        option: {
          preset: "openrouter",
          value: "openrouter"
        }
      })
    ).toEqual({
      providerProfileId: "openrouter",
      provider: {
        apiKey: "sk-test",
        baseUrl: "https://openrouter.ai/api/v1",
        model: "deepseek/deepseek-chat-v3-0324",
        preset: "openrouter",
        providerLabel: "OpenRouter"
      }
    });
  });

  it("blocks Provider sessions until the selected device catalog is ready", () => {
    const request = buildProviderSessionRequest({
      apiKey: "",
      apiKeyEnv: "OPENROUTER_API_KEY",
      baseUrl: "",
      label: "",
      model: "deepseek/deepseek-chat-v3-0324",
      option: {
        preset: "openrouter",
        value: "openrouter"
      }
    });

    expect(
      validateProviderSessionRequest({
        catalog: null,
        loading: true,
        request,
        status: null
      })
    ).toBe("正在读取当前设备的 Provider 能力，请稍后再试。");
    expect(
      validateProviderSessionRequest({
        catalog: null,
        loading: false,
        request,
        status: {
          available: false,
          error: "Cannot find package"
        }
      })
    ).toBe("当前设备未启用 CodexProvider：Cannot find package");
    expect(
      validateProviderSessionRequest({
        catalog: {
          available: false,
          error: "provider runtime missing",
          providers: []
        },
        loading: false,
        request,
        status: null
      })
    ).toBe("当前设备未启用 CodexProvider：provider runtime missing");
  });

  it("rejects a Provider selected from another device catalog", () => {
    const request = buildProviderSessionRequest({
      apiKey: "",
      apiKeyEnv: "DEEPSEEK_API_KEY",
      baseUrl: "",
      label: "",
      model: "deepseek-chat",
      option: {
        preset: "deepseek",
        value: "deepseek"
      }
    });

    expect(
      validateProviderSessionRequest({
        catalog: providerCatalog({
          preset: "openrouter",
          apiKeyConfigured: true
        }),
        loading: false,
        request,
        status: {
          available: true,
          error: null
        }
      })
    ).toBe("当前设备不支持这个 Provider，请重新选择。");
  });

  it("requires configured keys or an inline key for catalog Providers", () => {
    const request = buildProviderSessionRequest({
      apiKey: "",
      apiKeyEnv: "OPENROUTER_API_KEY",
      baseUrl: "",
      label: "",
      model: "deepseek/deepseek-chat-v3-0324",
      option: {
        preset: "openrouter",
        value: "openrouter"
      }
    });

    expect(
      validateProviderSessionRequest({
        catalog: providerCatalog({
          preset: "openrouter",
          apiKeyConfigured: false
        }),
        loading: false,
        request,
        status: null
      })
    ).toBe("当前设备没有配置 OPENROUTER_API_KEY，请在设备环境变量中设置，或直接填写 API Key。");

    expect(
      validateProviderSessionRequest({
        catalog: providerCatalog({
          preset: "openrouter",
          apiKeyConfigured: true
        }),
        loading: false,
        request,
        status: null
      })
    ).toBeNull();
  });

  it("validates custom Provider fields", () => {
    const request = buildProviderSessionRequest({
      apiKey: "",
      apiKeyEnv: "",
      baseUrl: "https://provider.example/v1",
      label: "Custom",
      model: "",
      option: {
        preset: "custom",
        value: "custom"
      }
    });

    expect(
      validateProviderSessionRequest({
        catalog: providerCatalog({
          preset: "openrouter",
          apiKeyConfigured: true
        }),
        loading: false,
        request,
        status: null
      })
    ).toBe("请填写自定义 Provider 的模型");
  });

  it("formats Provider model labels from the selected device catalog", () => {
    expect(shortModelLabel("DeepSeek V3.1", "fallback")).toBe("DS V3.1");
    expect(shortModelLabel(" ", "deepseek-chat")).toBe("deepseek-chat");

    expect(
      sessionActiveModelLabel(
        sessionSummary({
          providerProfileId: "openrouter",
          provider: {
            providerLabel: "OpenRouter",
            model: "deepseek/deepseek-chat-v3-0324"
          },
          model: "deepseek/deepseek-chat-v3-0324"
        }),
        providerCatalog({
          preset: "openrouter",
          apiKeyConfigured: true
        })
      )
    ).toBe("OpenRouter · DeepSeek Chat V3");
  });
});

function providerCatalog(input: {
  apiKeyConfigured: boolean;
  preset: "openrouter" | "deepseek";
}): LocalProviderCatalogResponse {
  const isOpenRouter = input.preset === "openrouter";
  return {
    available: true,
    error: null,
    providers: [
      {
        apiKeyConfigured: input.apiKeyConfigured,
        apiKeyEnv: isOpenRouter ? "OPENROUTER_API_KEY" : "DEEPSEEK_API_KEY",
        baseUrl: isOpenRouter
          ? "https://openrouter.ai/api/v1"
          : "https://api.deepseek.com",
        defaultModel: isOpenRouter
          ? "deepseek/deepseek-chat-v3-0324"
          : "deepseek-chat",
        label: isOpenRouter ? "OpenRouter" : "DeepSeek",
        models: [
          {
            id: isOpenRouter ? "deepseek/deepseek-chat-v3-0324" : "deepseek-chat",
            label: isOpenRouter ? "DeepSeek Chat V3" : "DeepSeek Chat",
            supportedReasoningEfforts: []
          }
        ],
        preset: input.preset,
        providerLabel: isOpenRouter ? "OpenRouter" : "DeepSeek",
        providerName: isOpenRouter ? "openrouter" : "deepseek"
      }
    ]
  };
}

function sessionSummary(
  overrides: Partial<LocalSessionSummary>
): LocalSessionSummary {
  return {
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    createdAt: 1,
    cwd: "/repo",
    goal: null,
    model: "gpt-5.5",
    permissionMode: "request-approval",
    provider: null,
    providerProfileId: null,
    queuedMessages: [],
    reasoningEffort: "high",
    sandbox: "workspace-write",
    serviceTier: null,
    sessionId: "session_1",
    status: "idle",
    updatedAt: 2,
    ...overrides
  };
}
