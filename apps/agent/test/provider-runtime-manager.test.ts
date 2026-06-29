import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderRuntimeManager } from "../src/local-server/provider-runtime-manager.js";

describe("ProviderRuntimeManager", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns null when no provider is requested", async () => {
    const manager = new ProviderRuntimeManager({
      loadCore: async () => fakeCore()
    });

    await expect(manager.resolveForSession({ model: "gpt-5.5" })).resolves.toBeNull();
  });

  it("starts and reuses a CodexProvider runtime for OpenRouter", async () => {
    const core = fakeCore();
    const manager = new ProviderRuntimeManager({
      env: { OPENROUTER_API_KEY: "upstream-secret" },
      loadCore: async () => core
    });

    const first = await manager.resolveForSession({
      model: "gpt-5.5",
      providerProfileId: "openrouter",
      provider: {
        preset: "openrouter",
        model: "deepseek/deepseek-chat"
      }
    });
    const second = await manager.resolveForSession({
      model: "gpt-5.5",
      providerProfileId: "openrouter",
      provider: {
        preset: "openrouter",
        model: "deepseek/deepseek-chat"
      }
    });

    expect(first).toEqual(second);
    expect(core.instances).toHaveLength(1);
    expect(core.instances[0]?.options).toMatchObject({
      apiKey: "upstream-secret",
      upstreamBaseUrl: "https://openrouter.ai/api/v1",
      defaultModel: "deepseek/deepseek-chat",
      providerLabel: "openrouter",
      profileMode: "mixed",
      toolStrategy: "codex-local-first"
    });
    expect(core.instances[0]?.options.experimentalBearerToken).not.toBe("upstream-secret");
    expect(first?.codexCliArgs.join(" ")).not.toContain("upstream-secret");
    expect(first?.provider).not.toHaveProperty("apiKey");
    expect(first?.provider.providerLabel).toBe("openrouter");
    expect(first?.model).toBe("deepseek/deepseek-chat");
    expect(core.instances[0]?.options.adapterOptions).toMatchObject({
      providerKind: "openrouter"
    });
  });

  it("lists provider catalog from CodexProvider without secrets", async () => {
    const core = fakeCore();
    const manager = new ProviderRuntimeManager({
      env: { OPENROUTER_API_KEY: "upstream-secret" },
      loadCore: async () => core
    });

    const catalog = await manager.providerCatalog();
    const openrouter = catalog.providers.find((provider) => provider.preset === "openrouter");

    expect(catalog.available).toBe(true);
    expect(openrouter).toMatchObject({
      label: "OpenRouter",
      providerLabel: "openrouter",
      apiKeyEnv: "OPENROUTER_API_KEY",
      apiKeyConfigured: true,
      defaultModel: "deepseek/deepseek-v4-pro"
    });
    expect(openrouter?.models.some((model) => model.id === "anthropic/claude-sonnet-4.5")).toBe(true);
    expect(core.catalogInputs[0]).toMatchObject({ apiKey: "upstream-secret" });
    expect(JSON.stringify(catalog)).not.toContain("upstream-secret");
  });

  it("reports unavailable catalog when CodexProvider core cannot load", async () => {
    const manager = new ProviderRuntimeManager({
      loadCore: async () => {
        throw new Error("missing @codex-provider/core");
      }
    });

    const catalog = await manager.providerCatalog();
    const status = await manager.status();

    expect(catalog).toEqual({
      available: false,
      error: "missing @codex-provider/core",
      providers: []
    });
    expect(status).toEqual({
      available: false,
      error: "missing @codex-provider/core"
    });
  });

  it("caps forwarded provider tools before upstream fetch", async () => {
    const core = fakeCore();
    const manager = new ProviderRuntimeManager({
      env: { OPENROUTER_API_KEY: "upstream-secret" },
      loadCore: async () => core
    });
    await manager.resolveForSession({
      providerProfileId: "openrouter",
      provider: {
        preset: "openrouter",
        model: "openai/gpt-4o-mini"
      }
    });
    const fetchImpl = readFetchImpl(core.instances[0]?.options);
    const seen: Array<{
      body: { tools?: unknown[]; tool_choice?: unknown };
      hasContentLength: boolean;
    }> = [];
    vi.stubGlobal("fetch", async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      seen.push({
        body: JSON.parse(String(init?.body ?? "{}")),
        hasContentLength: headers.has("content-length")
      });
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
        status: 200
      });
    });

    await fetchImpl("https://openrouter.ai/api/v1/chat/completions", {
      body: JSON.stringify({
        model: "openai/gpt-4o-mini",
        tools: Array.from({ length: 130 }, (_value, index) => ({
          type: "function",
          function: {
            name: `tool_${index}`,
            parameters: { type: "object" }
          }
        })),
        tool_choice: {
          type: "function",
          function: { name: "tool_129" }
        }
      }),
      headers: {
        "content-length": "999",
        "content-type": "application/json"
      },
      method: "POST"
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]?.body.tools).toHaveLength(128);
    expect(seen[0]?.body.tools?.at(0)).toMatchObject({
      function: { name: "tool_0" }
    });
    expect(seen[0]?.body.tools?.at(127)).toMatchObject({
      function: { name: "tool_127" }
    });
    expect(seen[0]?.body.tool_choice).toBeUndefined();
    expect(seen[0]?.hasContentLength).toBe(false);
  });

  it("supports custom OpenAI-compatible API configuration", async () => {
    const core = fakeCore();
    const manager = new ProviderRuntimeManager({
      loadCore: async () => core
    });

    const state = await manager.resolveForSession({
      providerProfileId: "custom",
      provider: {
        preset: "custom",
        providerLabel: "my-api",
        baseUrl: "https://api.example.com/v1",
        apiKey: "custom-secret",
        model: "vendor/model"
      }
    });

    expect(core.instances[0]?.options).toMatchObject({
      apiKey: "custom-secret",
      upstreamBaseUrl: "https://api.example.com/v1",
      defaultModel: "vendor/model",
      providerLabel: "my-api"
    });
    expect(state?.providerProfileId).toBe("custom");
    expect(state?.provider.providerLabel).toBe("my-api");
    expect(state?.provider.model).toBe("vendor/model");
  });
});

function fakeCore() {
  const instances: FakeRuntime[] = [];
  const catalogInputs: Record<string, unknown>[] = [];
  class FakeRuntime {
    public constructor(public readonly options: Record<string, unknown>) {
      instances.push(this);
    }

    public async start() {
      return {
        codexCliArgs: [
          "-c",
          `model=${JSON.stringify(this.options.defaultModel)}`,
          "-c",
          `model_provider=${JSON.stringify(this.options.providerLabel)}`,
          "-c",
          "model_providers.openrouter.experimental_bearer_token=\"codexnext-provider-adapter\""
        ],
        profile: {
          providerLabel: String(this.options.providerLabel),
          providerName: String(this.options.providerName ?? "Provider"),
          upstreamBaseUrl: String(this.options.upstreamBaseUrl),
          mode: "mixed" as const,
          toolStrategy: "codex-local-first"
        }
      };
    }

    public async stop() {
      return undefined;
    }
  }
  return {
    instances,
    catalogInputs,
    CodexProviderRuntime: FakeRuntime,
    resolveCodexProviderProviderPresetCatalog: async (id: string, input: Record<string, unknown> = {}) => {
      catalogInputs.push(input);
      const preset = fakeResolvedPreset(id, input);
      return id === "openrouter"
        ? {
            ...preset,
            models: [
              ...(preset.models as Record<string, unknown>[]),
              {
                id: "anthropic/claude-sonnet-4.5",
                displayName: "Claude Sonnet 4.5",
                isDefault: false,
                supportedReasoningEfforts: [],
                defaultReasoningEffort: null
              }
            ]
          }
        : preset;
    },
    resolveCodexProviderProviderPreset: (id: string, input: Record<string, unknown> = {}) => {
      return fakeResolvedPreset(id, input);
    }
  };
}

function fakeResolvedPreset(id: string, input: Record<string, unknown> = {}) {
  const labelById: Record<string, string> = {
    openrouter: "OpenRouter",
    deepseek: "DeepSeek",
    "dashscope-qwen": "Qwen",
    siliconflow: "SiliconFlow",
    minimax: "MiniMax",
    "moonshot-kimi": "Kimi"
  };
  const providerLabel = id === "dashscope-qwen" ? "dashscope_qwen" : id === "moonshot-kimi" ? "kimi" : id;
  const defaultModel = String(input.defaultModel ?? (id === "openrouter" ? "deepseek/deepseek-v4-pro" : `${id}/default`));
  return {
    id,
    displayName: labelById[id] ?? id,
    providerLabel,
    providerName: `${labelById[id] ?? id} CodexProvider Adapter`,
    baseUrl: String(input.upstreamBaseUrl ?? (id === "openrouter" ? "https://openrouter.ai/api/v1" : `https://${id}.example/v1`)),
    defaultModel,
    env: {
      apiKeyEnv: id === "openrouter" ? "OPENROUTER_API_KEY" : `${id.toUpperCase()}_API_KEY`,
      alternativeApiKeyEnv: null
    },
    models: [{
      id: defaultModel,
      displayName: defaultModel.includes("deepseek-v4-pro") ? "DeepSeek V4 Pro" : defaultModel,
      isDefault: true,
      supportedReasoningEfforts: ["high", "xhigh"],
      defaultReasoningEffort: null
    }],
    adapterOptions: {
      models: [{ id: defaultModel }],
      providerCapabilities: { supportsTools: true },
      providerKind: id,
      providerName: labelById[id] ?? id,
      ownedBy: id,
      upstreamChatCompletionsPath: "/chat/completions"
    }
  };
}

function readFetchImpl(options: Record<string, unknown> | undefined): typeof fetch {
  const adapterOptions = options?.adapterOptions as Record<string, unknown> | undefined;
  const fetchImpl = adapterOptions?.fetchImpl;
  if (typeof fetchImpl !== "function") {
    throw new Error("Expected provider adapter fetchImpl.");
  }
  return fetchImpl as typeof fetch;
}
