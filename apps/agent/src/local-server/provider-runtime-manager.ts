import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type {
  LocalProviderCatalogEntry,
  LocalProviderCatalogModel,
  LocalProviderCatalogResponse,
  LocalProviderConfig,
  LocalProviderPreset,
  LocalProviderRuntimeStatus,
  LocalProviderSummary
} from "@codexnext/protocol";
import { devTrace } from "../dev-trace.js";

const ADAPTER_BEARER_TOKEN = "codexnext-provider-adapter";
const OPENAI_COMPATIBLE_TOOL_LIMIT = 128;

const PROVIDER_PRESET_IDS: Array<Exclude<LocalProviderPreset, "custom">> = [
  "openrouter",
  "deepseek",
  "dashscope-qwen",
  "siliconflow",
  "minimax",
  "moonshot-kimi"
];

export interface ProviderRuntimeSessionInput {
  model?: string | null | undefined;
  provider?: LocalProviderConfig | null | undefined;
  providerProfileId?: string | null | undefined;
}

export interface ProviderRuntimeSessionState {
  codexCliArgs: string[];
  model: string;
  modelProvider: string;
  provider: LocalProviderSummary;
  providerProfileId: string;
}

export interface ProviderRuntimeManagerOptions {
  env?: NodeJS.ProcessEnv | undefined;
  loadCore?: (() => Promise<CodexProviderCoreModule>) | undefined;
}

interface CodexProviderCoreModule {
  CodexProviderRuntime: new (options: Record<string, unknown>) => CodexProviderRuntimeLike;
  resolveCodexProviderProviderPresetCatalog?: (
    id: string,
    input?: Record<string, unknown>
  ) => Promise<CodexProviderResolvedPresetLike>;
  resolveCodexProviderProviderPreset?: (
    id: string,
    input?: Record<string, unknown>
  ) => CodexProviderResolvedPresetLike;
  [key: string]: unknown;
}

interface CodexProviderResolvedPresetLike {
  id?: string;
  displayName?: string;
  providerLabel?: string;
  providerName?: string;
  baseUrl?: string;
  defaultModel?: string;
  env?: {
    apiKeyEnv?: string;
    alternativeApiKeyEnv?: string | null;
  };
  models?: Array<Record<string, unknown>>;
  adapterOptions?: Record<string, unknown>;
}

interface CodexProviderRuntimeLike {
  start(): Promise<CodexProviderRuntimeStateLike>;
  stop(): Promise<void>;
}

interface CodexProviderRuntimeStateLike {
  codexCliArgs: string[];
  profile?: {
    providerLabel?: string;
    providerName?: string;
    upstreamBaseUrl?: string;
    mode?: "official" | "mixed" | "pure-api";
    toolStrategy?: string;
  };
}

interface ResolvedProviderConfig {
  apiKey: string;
  baseUrl: string;
  maxForwardedTools: number;
  model: string;
  preset: LocalProviderPreset;
  providerAdapterOptions: Record<string, unknown>;
  providerLabel: string;
  providerName: string;
  providerProfileId: string;
}

interface CachedRuntime {
  runtime: CodexProviderRuntimeLike;
  state: ProviderRuntimeSessionState;
}

export class ProviderRuntimeManager {
  private readonly env: NodeJS.ProcessEnv;
  private readonly loadCoreFn: () => Promise<CodexProviderCoreModule>;
  private readonly runtimes = new Map<string, Promise<CachedRuntime>>();

  public constructor(options: ProviderRuntimeManagerOptions = {}) {
    this.env = options.env ?? process.env;
    this.loadCoreFn = options.loadCore ?? loadCodexProviderCore;
  }

  public async resolveForSession(
    input: ProviderRuntimeSessionInput
  ): Promise<ProviderRuntimeSessionState | null> {
    if (!hasProviderInput(input)) {
      return null;
    }

    const core = await this.loadCoreFn();
    const config = resolveProviderConfig(core, input, this.env);
    const cacheKey = providerCacheKey(config);
    const cached = await this.getOrStartRuntime(cacheKey, core, config);
    return cached.state;
  }

  public async providerCatalog(): Promise<LocalProviderCatalogResponse> {
    try {
      const core = await this.loadCoreFn();
      const providers = await Promise.all(
        PROVIDER_PRESET_IDS.map(async (preset) =>
          providerCatalogEntry(
            preset,
            await resolveCorePresetCatalog(core, preset, this.env),
            this.env
          )
        )
      );
      return {
        available: true,
        providers
      };
    } catch (error) {
      return {
        available: false,
        error: formatProviderRuntimeError(error),
        providers: []
      };
    }
  }

  public async status(): Promise<LocalProviderRuntimeStatus> {
    try {
      await this.loadCoreFn();
      return { available: true };
    } catch (error) {
      return {
        available: false,
        error: formatProviderRuntimeError(error)
      };
    }
  }

  public async closeAll(): Promise<void> {
    const cached = await Promise.allSettled([...this.runtimes.values()]);
    this.runtimes.clear();
    await Promise.all(
      cached.flatMap((result) =>
        result.status === "fulfilled" ? [result.value.runtime.stop()] : []
      )
    );
  }

  private async getOrStartRuntime(
    cacheKey: string,
    core: CodexProviderCoreModule,
    config: ResolvedProviderConfig
  ): Promise<CachedRuntime> {
    const existing = this.runtimes.get(cacheKey);
    if (existing) {
      return existing;
    }

    const created = startProviderRuntime(core, config).catch((error) => {
      this.runtimes.delete(cacheKey);
      throw error;
    });
    this.runtimes.set(cacheKey, created);
    return created;
  }
}

async function startProviderRuntime(
  core: CodexProviderCoreModule,
  config: ResolvedProviderConfig
): Promise<CachedRuntime> {
  const runtime = new core.CodexProviderRuntime({
    apiKey: config.apiKey,
    upstreamBaseUrl: config.baseUrl,
    defaultModel: config.model,
    providerLabel: config.providerLabel,
    providerName: config.providerName,
    profileMode: "mixed",
    toolStrategy: "codex-local-first",
    experimentalBearerToken: ADAPTER_BEARER_TOKEN,
    adapterHost: "127.0.0.1",
    adapterPort: 0,
    adapterOptions: buildAdapterOptions(config)
  });
  const runtimeState = await runtime.start();
  const providerLabel = normalizeString(runtimeState.profile?.providerLabel) || config.providerLabel;
  const state: ProviderRuntimeSessionState = {
    codexCliArgs: [...runtimeState.codexCliArgs],
    model: config.model,
    modelProvider: providerLabel,
    providerProfileId: config.providerProfileId,
    provider: {
      preset: config.preset,
      providerLabel,
      providerName: normalizeString(runtimeState.profile?.providerName) || config.providerName,
      baseUrl: normalizeString(runtimeState.profile?.upstreamBaseUrl) || config.baseUrl,
      model: config.model,
      profileMode: runtimeState.profile?.mode ?? "mixed",
      toolStrategy: runtimeState.profile?.toolStrategy ?? "codex-local-first"
    }
  };
  return { runtime, state };
}

function resolveProviderConfig(
  core: CodexProviderCoreModule,
  input: ProviderRuntimeSessionInput,
  env: NodeJS.ProcessEnv
): ResolvedProviderConfig {
  const requestedProfileId = normalizeString(input.providerProfileId);
  const provider = input.provider ?? null;
  const preset = resolvePreset(provider?.preset, requestedProfileId);
  if (preset === "custom") {
    return resolveCustomProvider(input, env, requestedProfileId || "custom");
  }
  return resolvePresetProvider(core, input, env, preset, requestedProfileId || preset);
}

function resolvePresetProvider(
  core: CodexProviderCoreModule,
  input: ProviderRuntimeSessionInput,
  env: NodeJS.ProcessEnv,
  preset: Exclude<LocalProviderPreset, "custom">,
  providerProfileId: string
): ResolvedProviderConfig {
  const provider = input.provider ?? {};
  const resolved = resolveCorePreset(core, preset, {
    ...(provider.providerLabel ? { providerLabel: provider.providerLabel } : {}),
    ...(provider.providerName ? { providerName: provider.providerName } : {}),
    ...(provider.baseUrl ? { upstreamBaseUrl: provider.baseUrl } : {}),
    ...(provider.model ? { defaultModel: provider.model } : {}),
    ...(provider.apiKeyEnv ? { apiKeyEnv: provider.apiKeyEnv } : {})
  });
  const envNames = [
    normalizeString(provider.apiKeyEnv),
    normalizeString(resolved.env?.apiKeyEnv),
    normalizeString(resolved.env?.alternativeApiKeyEnv)
  ].filter((value): value is string => Boolean(value));
  const providerLabel = normalizeProviderLabel(provider.providerLabel ?? resolved.providerLabel);
  const apiKey = resolveApiKey(provider.apiKey, envNames, env, providerLabel);
  return {
    apiKey,
    baseUrl: normalizeString(provider.baseUrl) || requiredString(resolved.baseUrl, `${preset} provider base_url`),
    maxForwardedTools: OPENAI_COMPATIBLE_TOOL_LIMIT,
    model: normalizeString(provider.model) || requiredString(resolved.defaultModel, `${preset} provider model`),
    preset,
    providerAdapterOptions: resolved.adapterOptions ?? {},
    providerLabel,
    providerName:
      normalizeString(provider.providerName) ||
      normalizeString(resolved.providerName) ||
      `${normalizeString(resolved.displayName) || preset} CodexProvider Adapter`,
    providerProfileId
  };
}

function resolveCustomProvider(
  input: ProviderRuntimeSessionInput,
  env: NodeJS.ProcessEnv,
  providerProfileId: string
): ResolvedProviderConfig {
  const provider = input.provider ?? {};
  const providerLabel = normalizeProviderLabel(provider.providerLabel ?? providerProfileId);
  const apiKeyEnv = normalizeString(provider.apiKeyEnv) || "CODEX_PROVIDER_API_KEY";
  return {
    apiKey: resolveApiKey(provider.apiKey, [apiKeyEnv], env, providerLabel),
    baseUrl: requiredString(provider.baseUrl, "custom provider base_url"),
    maxForwardedTools: OPENAI_COMPATIBLE_TOOL_LIMIT,
    model: requiredString(provider.model, "custom provider model"),
    preset: "custom",
    providerAdapterOptions: {},
    providerLabel,
    providerName: normalizeString(provider.providerName) || "Custom CodexProvider Adapter",
    providerProfileId
  };
}

function buildAdapterOptions(config: ResolvedProviderConfig): Record<string, unknown> {
  return {
    ...config.providerAdapterOptions,
    fetchImpl: createToolBudgetFetch(config.maxForwardedTools, config.providerLabel)
  };
}

function resolveCorePreset(
  core: CodexProviderCoreModule,
  preset: Exclude<LocalProviderPreset, "custom">,
  input: Record<string, unknown> = {}
): CodexProviderResolvedPresetLike {
  if (typeof core.resolveCodexProviderProviderPreset !== "function") {
    throw new Error("CodexProvider does not expose provider preset metadata. Rebuild CodexProvider.");
  }
  return core.resolveCodexProviderProviderPreset(preset, input);
}

async function resolveCorePresetCatalog(
  core: CodexProviderCoreModule,
  preset: Exclude<LocalProviderPreset, "custom">,
  env: NodeJS.ProcessEnv
): Promise<CodexProviderResolvedPresetLike> {
  const resolved = resolveCorePreset(core, preset);
  if (typeof core.resolveCodexProviderProviderPresetCatalog !== "function") {
    return resolved;
  }
  const apiKey = firstEnvValue([
    normalizeString(resolved.env?.apiKeyEnv),
    normalizeString(resolved.env?.alternativeApiKeyEnv)
  ], env);
  return core.resolveCodexProviderProviderPresetCatalog(preset, {
    ...(apiKey ? { apiKey } : {})
  });
}

function providerCatalogEntry(
  preset: Exclude<LocalProviderPreset, "custom">,
  resolved: CodexProviderResolvedPresetLike,
  env: NodeJS.ProcessEnv
): LocalProviderCatalogEntry {
  const apiKeyEnv = requiredString(resolved.env?.apiKeyEnv, `${preset} apiKeyEnv`);
  return {
    preset,
    label: requiredString(resolved.displayName, `${preset} displayName`),
    providerLabel: normalizeProviderLabel(resolved.providerLabel),
    ...(normalizeString(resolved.providerName)
      ? { providerName: normalizeString(resolved.providerName) }
      : {}),
    baseUrl: requiredString(resolved.baseUrl, `${preset} baseUrl`),
    apiKeyEnv,
    apiKeyConfigured: Boolean(
      firstEnvValue([
        apiKeyEnv,
        normalizeString(resolved.env?.alternativeApiKeyEnv)
      ], env)
    ),
    defaultModel: requiredString(resolved.defaultModel, `${preset} defaultModel`),
    models: normalizeCatalogModels(resolved.models, normalizeString(resolved.defaultModel))
  };
}

function normalizeCatalogModels(
  models: Array<Record<string, unknown>> | undefined,
  defaultModel: string
): LocalProviderCatalogModel[] {
  const entries = Array.isArray(models) ? models : [];
  return entries.flatMap((model) => {
    const id = normalizeString(model.id) || normalizeString(model.model);
    if (!id) {
      return [];
    }
    const efforts = Array.isArray(model.supportedReasoningEfforts)
      ? model.supportedReasoningEfforts.map(normalizeString).filter(Boolean)
      : [];
    return [{
      id,
      label:
        normalizeString(model.displayName) ||
        normalizeString(model.display_name) ||
        id,
      isDefault: id === defaultModel || model.isDefault === true,
      supportedReasoningEfforts: efforts,
      defaultReasoningEffort: normalizeString(model.defaultReasoningEffort) || null
    }];
  });
}

function createToolBudgetFetch(limit: number, providerLabel: string): typeof fetch {
  return async (input, init) => {
    const nextInit = budgetToolsInRequestInit(init, limit, providerLabel);
    return fetch(input, nextInit);
  };
}

function budgetToolsInRequestInit(
  init: RequestInit | undefined,
  limit: number,
  providerLabel: string
): RequestInit | undefined {
  if (!init || limit < 1 || typeof init.body !== "string") {
    return init;
  }

  let body: unknown;
  try {
    body = JSON.parse(init.body);
  } catch {
    return init;
  }
  if (!isRecord(body) || !Array.isArray(body.tools) || body.tools.length <= limit) {
    return init;
  }

  const originalCount = body.tools.length;
  const retainedTools = body.tools.slice(0, limit);
  const retainedToolNames = new Set(retainedTools.map(readChatToolName).filter(Boolean));
  body.tools = retainedTools;
  budgetToolChoice(body, retainedToolNames);
  devTrace("provider.tools.truncated", {
    providerLabel,
    originalCount,
    forwardedCount: retainedTools.length
  });

  const headers = new Headers(init.headers);
  headers.delete("content-length");
  return {
    ...init,
    headers,
    body: JSON.stringify(body)
  };
}

function budgetToolChoice(body: Record<string, unknown>, retainedToolNames: Set<string>): void {
  const toolChoice = body.tool_choice;
  if (!isRecord(toolChoice)) {
    return;
  }
  if (toolChoice.type === "function") {
    const name = readFunctionName(toolChoice.function);
    if (name && !retainedToolNames.has(name)) {
      delete body.tool_choice;
    }
    return;
  }
  if (toolChoice.type !== "allowed_tools" || !Array.isArray(toolChoice.tools)) {
    return;
  }
  const retainedAllowedTools = toolChoice.tools.filter((tool) => {
    const name = readChatToolName(tool);
    return name ? retainedToolNames.has(name) : false;
  });
  if (retainedAllowedTools.length === 0) {
    delete body.tool_choice;
    return;
  }
  toolChoice.tools = retainedAllowedTools;
}

function readChatToolName(tool: unknown): string {
  if (!isRecord(tool)) {
    return "";
  }
  return normalizeString(readFunctionName(tool.function) || tool.name);
}

function readFunctionName(value: unknown): string {
  return isRecord(value) ? normalizeString(value.name) : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolvePreset(
  providerPreset: LocalProviderPreset | null | undefined,
  providerProfileId: string
): LocalProviderPreset {
  if (providerPreset) {
    return providerPreset;
  }
  if (isProviderPreset(providerProfileId)) {
    return providerProfileId;
  }
  return "custom";
}

function isProviderPreset(value: string): value is LocalProviderPreset {
  return (
    value === "openrouter" ||
    value === "deepseek" ||
    value === "dashscope-qwen" ||
    value === "siliconflow" ||
    value === "minimax" ||
    value === "moonshot-kimi" ||
    value === "custom"
  );
}

function hasProviderInput(input: ProviderRuntimeSessionInput): boolean {
  return Boolean(normalizeString(input.providerProfileId) || input.provider);
}

function resolveApiKey(
  inputApiKey: string | null | undefined,
  envNames: string[],
  env: NodeJS.ProcessEnv,
  providerLabel: string
): string {
  const direct = normalizeString(inputApiKey);
  if (direct) {
    return direct;
  }
  for (const envName of envNames) {
    const value = normalizeString(env[envName]);
    if (value) {
      return value;
    }
  }
  const hint = envNames.length > 0 ? ` Set ${envNames.join(" or ")}.` : "";
  throw new Error(`Provider ${providerLabel} requires an API key.${hint}`);
}

function firstEnvValue(names: string[], env: NodeJS.ProcessEnv): string {
  for (const name of names) {
    const value = normalizeString(env[name]);
    if (value) {
      return value;
    }
  }
  return "";
}

function providerCacheKey(config: ResolvedProviderConfig): string {
  return [
    config.providerProfileId,
    config.preset,
    config.providerLabel,
    config.baseUrl,
    config.model,
    hashSecret(config.apiKey)
  ].join("\n");
}

function hashSecret(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function normalizeProviderLabel(value: string | null | undefined): string {
  const normalized = normalizeString(value)
    .replace(/[^A-Za-z0-9_-]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
  if (!normalized) {
    return "custom";
  }
  return /^\d/u.test(normalized) ? `provider_${normalized}` : normalized;
}

function requiredString(value: unknown, label: string): string {
  const normalized = normalizeString(value);
  if (!normalized) {
    throw new Error(`Missing ${label}.`);
  }
  return normalized;
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function formatProviderRuntimeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function loadCodexProviderCore(): Promise<CodexProviderCoreModule> {
  const candidates = codexProviderModuleCandidates();
  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      const loaded = await import(candidate);
      if (typeof loaded.CodexProviderRuntime === "function") {
        return loaded as CodexProviderCoreModule;
      }
      lastError = new Error(`Module ${candidate} does not export CodexProviderRuntime.`);
    } catch (error) {
      lastError = error;
    }
  }
  const suffix = lastError instanceof Error ? ` Last error: ${lastError.message}` : "";
  throw new Error(
    `CodexProvider is not available. Install @codex-provider/core, build the local CodexProvider repo, or set CODEXNEXT_CODEX_PROVIDER_MODULE.${suffix}`
  );
}

function codexProviderModuleCandidates(): string[] {
  const candidates = [
    normalizeString(process.env.CODEXNEXT_CODEX_PROVIDER_MODULE),
    "@codex-provider/core",
    ...discoveredCodexProviderModules(process.cwd()),
    ...discoveredCodexProviderModules(path.dirname(fileURLToPath(import.meta.url)))
  ];
  return [...new Set(candidates.filter(Boolean))];
}

function fileUrlIfExists(filePath: string): string {
  return existsSync(filePath) ? pathToFileURL(filePath).href : "";
}

function discoveredCodexProviderModules(startPath: string): string[] {
  const candidates: string[] = [];
  for (const ancestor of ancestorPaths(startPath)) {
    for (const checkoutName of ["CodexProvider", "codex-provider"]) {
      candidates.push(fileUrlIfExists(path.join(ancestor, "..", checkoutName, "dist", "index.js")));
      candidates.push(fileUrlIfExists(path.join(ancestor, checkoutName, "dist", "index.js")));
    }
  }
  return candidates.filter(Boolean);
}

function ancestorPaths(startPath: string): string[] {
  const ancestors: string[] = [];
  let current = path.resolve(startPath);
  while (true) {
    ancestors.push(current);
    const parent = path.dirname(current);
    if (parent === current) {
      return ancestors;
    }
    current = parent;
  }
}
