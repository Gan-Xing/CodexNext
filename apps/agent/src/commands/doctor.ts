import { spawn } from "node:child_process";
import dns from "node:dns";
import { stat } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import {
  LocalHealthResponseSchema,
  LocalProviderCatalogResponseSchema,
  RelayDevicesResponseSchema,
  RelaySessionResponseSchema,
  type LocalHealthResponse,
  type LocalProviderCatalogResponse,
  type RelayDeviceRecord
} from "@codexnext/protocol";
import { printLine } from "../output.js";

const MIN_NODE_MAJOR = 24;
const FETCH_PROBE_TIMEOUT_MS = 6_000;

interface CommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  error?: Error;
}

interface DoctorCheck {
  name: string;
  status: "ok" | "warn" | "fail";
  detail: string;
  fix?: string | undefined;
}

export interface DoctorOptions {
  deviceId?: string;
  expectClosed?: string[];
  requireAgent?: boolean;
  requireProvider?: boolean;
  requireSameOrigin?: boolean;
  relay?: string;
  web?: string;
}

export async function runDoctor(options: DoctorOptions = {}): Promise<void> {
  dns.setDefaultResultOrder("ipv4first");

  const checks: DoctorCheck[] = [];

  checks.push(checkNodeVersion());

  const pnpm = await runCommand("pnpm", ["--version"]);
  checks.push({
    name: "pnpm",
    status: pnpm.ok ? "ok" : "fail",
    detail: pnpm.ok
      ? `pnpm ${pnpm.stdout.trim()}`
      : "pnpm was not found on PATH.",
    fix: pnpm.ok
      ? undefined
      : "Enable Corepack and install pnpm: corepack enable && corepack prepare pnpm@latest --activate"
  });

  const codex = await runCommand("codex", ["--version"]);
  checks.push({
    name: "codex",
    status: codex.ok ? "ok" : "fail",
    detail: codex.ok
      ? `codex --version: ${codex.stdout.trim()}`
      : "codex was not found on PATH.",
    fix: codex.ok
      ? undefined
      : "Install the Codex CLI, then make sure `codex` is available on PATH. Restart this terminal or Codex app if PATH was updated."
  });

  checks.push(await checkDeviceIdentity());
  const webOrigin = options.web ?? process.env.CODEXNEXT_PUBLIC_ORIGIN ?? "";
  checks.push(...checkDeploymentEnv({ publicOrigin: webOrigin || undefined }));

  if (webOrigin) {
    checks.push(await checkWebOriginHealth(webOrigin));
    checks.push(await checkRelaySessionBootstrap(webOrigin));
    checks.push(await checkSocketRoute(webOrigin));
  }

  const relayUrl =
    options.relay ??
    process.env.CODEXNEXT_RELAY_URL ??
    (options.requireSameOrigin ? webOrigin : "");
  if (webOrigin || relayUrl || options.requireSameOrigin) {
    checks.push(checkOriginAlignment(webOrigin, relayUrl, Boolean(options.requireSameOrigin)));
  }
  if (relayUrl) {
    checks.push(await checkRelayHealth(relayUrl));
  } else {
    checks.push({
      name: "relay health",
      status: "warn",
      detail: "No relay URL was supplied. Pass --relay <url> or set CODEXNEXT_RELAY_URL to probe control health."
    });
  }

  const ownerToken = process.env.CODEXNEXT_OWNER_TOKEN ?? "";
  if (
    relayUrl &&
    (ownerToken || options.requireAgent || options.requireProvider || options.deviceId)
  ) {
    checks.push(
      ...(await checkRelayRuntimeDiagnostics({
        deviceId: options.deviceId,
        ownerToken,
        relayUrl,
        requireAgent: Boolean(options.requireAgent),
        requireProvider: Boolean(options.requireProvider)
      }))
    );
  }

  for (const endpoint of options.expectClosed ?? []) {
    checks.push(await checkExpectedClosedEndpoint(endpoint));
  }

  printLine("CodexNext doctor");
  printLine("");

  for (const check of checks) {
    printLine(`[${check.status}] ${check.name}: ${check.detail}`);
    if (check.status !== "ok" && check.fix) {
      printLine(`      fix: ${check.fix}`);
    }
  }

  const failed = checks.filter((check) => check.status === "fail");
  if (failed.length > 0) {
    printLine("");
    throw new Error(
      `Doctor found ${failed.length} problem${failed.length === 1 ? "" : "s"}.`
    );
  }
}

function checkNodeVersion(): DoctorCheck {
  const nodeVersion = process.versions.node;
  const major = Number(nodeVersion.split(".")[0]);
  const ok = Number.isFinite(major) && major >= MIN_NODE_MAJOR;

  return {
    name: "node",
    status: ok ? "ok" : "fail",
    detail: `Node ${nodeVersion}`,
    fix: ok
      ? undefined
      : `Install Node >= ${MIN_NODE_MAJOR}. Recommended: use fnm, nvm, Volta, or the official Node installer.`
  };
}

async function checkDeviceIdentity(): Promise<DoctorCheck> {
  const filePath = path.join(os.homedir(), ".codexnext", "device.json");
  try {
    const info = await stat(filePath);
    const mode = info.mode & 0o777;
    const strict = (mode & 0o077) === 0;
    return {
      name: "device identity",
      status: strict ? "ok" : "warn",
      detail: strict
        ? "Device identity file exists with restricted permissions."
        : `Device identity file exists but permissions are ${mode.toString(8)}.`,
      fix: strict
        ? undefined
        : "Run: chmod 600 ~/.codexnext/device.json"
    };
  } catch {
    return {
      name: "device identity",
      status: "warn",
      detail: "No device identity file found yet.",
      fix: "Run `codexnext pair --relay <url>` on this machine before starting the long-running relay agent."
    };
  }
}

function checkDeploymentEnv(input: { publicOrigin?: string | undefined } = {}): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  const production = process.env.CODEXNEXT_PRODUCTION === "1" || process.env.NODE_ENV === "production";

  checks.push({
    name: "owner token env",
    status:
      process.env.CODEXNEXT_OWNER_TOKEN && process.env.CODEXNEXT_OWNER_TOKEN.length < 32
        ? "warn"
        : "ok",
    detail: process.env.CODEXNEXT_OWNER_TOKEN
      ? process.env.CODEXNEXT_OWNER_TOKEN.length < 32
        ? "CODEXNEXT_OWNER_TOKEN is set but looks short for production."
        : "CODEXNEXT_OWNER_TOKEN is set."
      : "CODEXNEXT_OWNER_TOKEN is not set in this process; this is fine for agent-only diagnostics."
  });

  const webEnvSet = [
    "CODEXNEXT_WEB_AUTH_PASSWORD_HASH",
    "CODEXNEXT_WEB_SESSION_SECRET",
    "CODEXNEXT_PUBLIC_ORIGIN"
  ].filter((key) => Boolean(process.env[key]));
  checks.push({
    name: "web login env",
    status: webEnvSet.length === 0 || webEnvSet.length === 3 ? "ok" : "warn",
    detail:
      webEnvSet.length === 3
        ? "Web login env is present."
        : webEnvSet.length === 0
          ? "Web login env is not set in this process; this is fine for agent-only diagnostics."
          : "Web login env is partially configured.",
    fix:
      webEnvSet.length === 0 || webEnvSet.length === 3
        ? undefined
        : "Set CODEXNEXT_WEB_AUTH_PASSWORD_HASH, CODEXNEXT_WEB_SESSION_SECRET, and CODEXNEXT_PUBLIC_ORIGIN together."
  });

  checks.push(checkPublicOrigin(input.publicOrigin));

  checks.push({
    name: "production origins",
    status:
      production && !process.env.CODEXNEXT_ALLOWED_ORIGINS
        ? "warn"
        : "ok",
    detail:
      production && !process.env.CODEXNEXT_ALLOWED_ORIGINS
        ? "Production mode is active but CODEXNEXT_ALLOWED_ORIGINS is not set in this process."
        : "Production origin configuration does not show an obvious missing allowlist.",
    fix:
      production && !process.env.CODEXNEXT_ALLOWED_ORIGINS
        ? "Set CODEXNEXT_ALLOWED_ORIGINS to the exact Web origin when running control in production."
        : undefined
  });

  checks.push({
    name: "direct mode env",
    status: process.env.CODEXNEXT_ENABLE_DEV_DIRECT === "1" ? "warn" : "ok",
    detail:
      process.env.CODEXNEXT_ENABLE_DEV_DIRECT === "1"
        ? "Hidden dev-only direct mode is enabled in this process."
        : "Hidden dev-only direct mode is not enabled.",
    fix:
      process.env.CODEXNEXT_ENABLE_DEV_DIRECT === "1"
        ? "Unset CODEXNEXT_ENABLE_DEV_DIRECT outside local troubleshooting."
        : undefined
  });

  return checks;
}

function checkPublicOrigin(raw = process.env.CODEXNEXT_PUBLIC_ORIGIN): DoctorCheck {
  if (!raw) {
    return {
      name: "public origin",
      status: "ok",
      detail: "CODEXNEXT_PUBLIC_ORIGIN is not set in this process."
    };
  }
  try {
    const url = new URL(raw);
    const local =
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "::1";
    const safe = url.protocol === "https:" || local;
    return {
      name: "public origin",
      status: safe ? "ok" : "warn",
      detail: safe
        ? `Public origin is ${safeUrlLabel(raw)}.`
        : `Public origin is ${safeUrlLabel(raw)} and is not HTTPS.`,
      fix: safe
        ? undefined
        : "Use HTTPS behind a reverse proxy for public production Web access."
    };
  } catch {
    return {
      name: "public origin",
      status: "warn",
      detail: "CODEXNEXT_PUBLIC_ORIGIN is not a valid URL.",
      fix: "Set CODEXNEXT_PUBLIC_ORIGIN to the exact Web origin, for example https://codexnext.example."
    };
  }
}

function checkOriginAlignment(
  webOrigin: string,
  relayUrl: string,
  required: boolean
): DoctorCheck {
  if (!webOrigin || !relayUrl) {
    return {
      name: "web/relay origin",
      status: required ? "fail" : "warn",
      detail: required
        ? "Same-origin deployment was required, but Web origin or relay URL is missing."
        : "Web origin or relay URL is missing, so same-origin deployment could not be checked.",
      fix: required
        ? "Pass both --web and --relay, or set CODEXNEXT_PUBLIC_ORIGIN and CODEXNEXT_RELAY_URL."
        : undefined
    };
  }
  const web = safeOriginLabel(webOrigin);
  const relay = safeOriginLabel(relayUrl);
  if (!web || !relay) {
    return {
      name: "web/relay origin",
      status: required ? "fail" : "warn",
      detail: "Web origin or relay URL is not a valid URL.",
      fix: "Use absolute HTTP(S) URLs, for example https://codexnext.example."
    };
  }
  const same = web === relay;
  return {
    name: "web/relay origin",
    status: same ? "ok" : required ? "fail" : "warn",
    detail: same
      ? `Web and relay use the same public origin: ${web}.`
      : `Web origin ${web} and relay origin ${relay} are different.`,
    fix:
      same || !required
        ? undefined
        : "Point Web and relay checks at the same HTTPS origin, or remove --require-same-origin for split-host deployments."
  };
}

async function checkWebOriginHealth(webOrigin: string): Promise<DoctorCheck> {
  try {
    const response = await fetchWithRetry(new URL("/api/auth/status", webOrigin), {
      redirect: "manual"
    });
    if (!response.ok) {
      return {
        name: "web origin",
        status: "fail",
        detail: `Web ${safeUrlLabel(webOrigin)} returned HTTP ${response.status} for /api/auth/status.`,
        fix: "Verify the Web service, reverse proxy routing, and CODEXNEXT_PUBLIC_ORIGIN."
      };
    }
    const payload = (await response.json().catch(() => null)) as unknown;
    if (!isWebAuthStatusPayload(payload)) {
      return {
        name: "web origin",
        status: "fail",
        detail: `Web ${safeUrlLabel(webOrigin)} returned an invalid auth status payload.`,
        fix: "Check that the URL points to CodexNext Web, not the relay control service or a login proxy."
      };
    }
    return {
      name: "web origin",
      status: "ok",
      detail: `Web ${safeUrlLabel(webOrigin)} is reachable; loginRequired=${payload.loginRequired}.`
    };
  } catch (error) {
    return {
      name: "web origin",
      status: "fail",
      detail: `Web ${safeUrlLabel(webOrigin)} is unreachable: ${formatError(error)}`,
      fix: "Verify DNS, TLS, reverse proxy routing, and that the Web service is running."
    };
  }
}

async function checkRelaySessionBootstrap(webOrigin: string): Promise<DoctorCheck> {
  try {
    const response = await fetch(new URL("/api/relay/session", webOrigin), {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_PROBE_TIMEOUT_MS)
    });
    if (response.status === 401 || response.status === 403) {
      return {
        name: "web relay session route",
        status: "ok",
        detail: `Web relay bootstrap route is present and protected with HTTP ${response.status}.`
      };
    }
    if (response.status === 204) {
      return {
        name: "web relay session route",
        status: "warn",
        detail: "Web relay bootstrap route is present, but this Web process reports no configured relay.",
        fix: "Set CODEXNEXT_RELAY_URL and CODEXNEXT_OWNER_TOKEN for the Web service."
      };
    }
    if (!response.ok) {
      return {
        name: "web relay session route",
        status: "fail",
        detail: `Web relay bootstrap route returned HTTP ${response.status}.`,
        fix: "Verify /api/relay/session is routed to CodexNext Web and not blocked by the proxy."
      };
    }
    const payload = (await response.json().catch(() => null)) as unknown;
    if (!isSafeRelaySessionBootstrapPayload(payload)) {
      return {
        name: "web relay session route",
        status: "fail",
        detail: "Web relay bootstrap route returned an invalid or sensitive payload.",
        fix: "Ensure it only returns relayUrl and sessionToken to authenticated Web clients."
      };
    }
    return {
      name: "web relay session route",
      status: "ok",
      detail: "Web relay bootstrap route is reachable and does not expose owner/device credentials."
    };
  } catch (error) {
    return {
      name: "web relay session route",
      status: "fail",
      detail: `Web relay bootstrap route is unreachable: ${formatError(error)}`,
      fix: "Verify the Web service and reverse proxy route for /api/relay/session."
    };
  }
}

async function checkSocketRoute(webOrigin: string): Promise<DoctorCheck> {
  const socketUrl = new URL("/socket.io/codexnext/", webOrigin);
  socketUrl.searchParams.set("EIO", "4");
  socketUrl.searchParams.set("transport", "polling");
  try {
    const response = await fetchWithRetry(socketUrl, {
      redirect: "manual"
    });
    if (response.status === 200 || response.status === 400 || response.status === 401) {
      return {
        name: "relay socket route",
        status: "ok",
        detail: `Socket.IO route is reachable at ${safeUrlLabel(webOrigin)}/socket.io/codexnext.`
      };
    }
    return {
      name: "relay socket route",
      status: "fail",
      detail: `Socket.IO route returned HTTP ${response.status}.`,
      fix: "Route /socket.io/codexnext to the control service before Web login/proxy middleware handles it."
    };
  } catch (error) {
    return {
      name: "relay socket route",
      status: "fail",
      detail: `Socket.IO route is unreachable: ${formatError(error)}`,
      fix: "Verify reverse proxy routing for /socket.io/codexnext and that control is running."
    };
  }
}

async function checkRelayHealth(relayUrl: string): Promise<DoctorCheck> {
  try {
    const response = await fetchWithRetry(new URL("/api/control/health", relayUrl));
    if (!response.ok) {
      return {
        name: "relay health",
        status: "fail",
        detail: `Relay ${safeUrlLabel(relayUrl)} returned HTTP ${response.status}.`,
        fix: "Start the control service and verify the relay URL points to the control port."
      };
    }
    const payload = (await response.json().catch(() => null)) as unknown;
    if (!isSafeHealthPayload(payload)) {
      return {
        name: "relay health",
        status: "fail",
        detail: `Relay ${safeUrlLabel(relayUrl)} returned an invalid health payload.`,
        fix: "Check that the URL points to CodexNext control, not Web or an agent."
      };
    }
    return {
      name: "relay health",
      status: "ok",
      detail: `Relay ${safeUrlLabel(relayUrl)} is healthy.`
    };
  } catch (error) {
    return {
      name: "relay health",
      status: "fail",
      detail: `Relay ${safeUrlLabel(relayUrl)} is unreachable: ${formatError(error)}`,
      fix: "Verify networking, reverse proxy, firewall, and that /api/control/health is reachable on the control service."
    };
  }
}

interface RelayRuntimeDiagnosticsInput {
  deviceId?: string | undefined;
  ownerToken: string;
  relayUrl: string;
  requireAgent: boolean;
  requireProvider: boolean;
}

async function checkRelayRuntimeDiagnostics(
  input: RelayRuntimeDiagnosticsInput
): Promise<DoctorCheck[]> {
  const required = input.requireAgent || input.requireProvider || Boolean(input.deviceId);
  if (!input.ownerToken) {
    return [
      {
        name: "relay runtime",
        status: required ? "fail" : "warn",
        detail: "Agent and Provider checks were requested but CODEXNEXT_OWNER_TOKEN is not set.",
        fix: "Run doctor from a trusted ops shell with CODEXNEXT_OWNER_TOKEN set; do not pass raw tokens in URLs."
      }
    ];
  }

  const session = await issueRelayDoctorSession(input.relayUrl, input.ownerToken);
  if (!session.ok) {
    return [
      {
        name: "relay runtime",
        status: required ? "fail" : "warn",
        detail: session.detail,
        fix: "Verify CODEXNEXT_OWNER_TOKEN and that /api/auth/session reaches the control service."
      }
    ];
  }

  const devices = await fetchRelayDevices(input.relayUrl, session.sessionToken);
  if (!devices.ok) {
    return [
      {
        name: "relay devices",
        status: required ? "fail" : "warn",
        detail: devices.detail,
        fix: "Verify relay user-session authorization and /api/devices routing."
      }
    ];
  }

  const selected = selectDoctorDevice(devices.devices, input.deviceId);
  const deviceSummary = summarizeDoctorDevices(devices.devices);
  if (!selected.device) {
    return [
      {
        name: "relay devices",
        status: required ? "fail" : "warn",
        detail: selected.detail ?? `No usable online agent device found. ${deviceSummary}`,
        fix: "Start a paired codexnext agent, or pass --device-id for the expected device."
      }
    ];
  }

  const checks: DoctorCheck[] = [
    {
      name: "relay devices",
      status: "ok",
      detail: `Selected ${safeDeviceLabel(selected.device)}. ${deviceSummary}`
    }
  ];

  const health = await fetchDeviceHealth(
    input.relayUrl,
    session.sessionToken,
    selected.device.deviceId
  );
  if (!health.ok) {
    checks.push({
      name: "agent health",
      status: input.requireAgent || input.requireProvider ? "fail" : "warn",
      detail: health.detail,
      fix: "Verify the selected agent is online and relay RPC can reach it."
    });
    return checks;
  }

  checks.push(checkAgentHealthPayload(health.health, input.requireAgent, selected.device));
  checks.push(checkProviderRuntimeStatus(health.health, input.requireProvider));

  const catalog = await fetchProviderCatalog(
    input.relayUrl,
    session.sessionToken,
    selected.device.deviceId
  );
  if (!catalog.ok) {
    checks.push({
      name: "provider catalog",
      status: input.requireProvider ? "fail" : "warn",
      detail: catalog.detail,
      fix: "Verify CodexProvider is installed and reachable from the selected agent."
    });
    return checks;
  }

  checks.push(checkProviderCatalogPayload(catalog.catalog, input.requireProvider));
  return checks;
}

async function checkExpectedClosedEndpoint(endpoint: string): Promise<DoctorCheck> {
  const parsed = parseExpectedClosedEndpoint(endpoint);
  if (!parsed) {
    return {
      name: "closed public port",
      status: "fail",
      detail: `Invalid endpoint: ${endpoint}`,
      fix: "Use host:port or an absolute URL, for example 203.0.113.10:3002."
    };
  }
  const result = await probeTcpEndpoint(parsed, 2_000);
  if (result === "open") {
    return {
      name: "closed public port",
      status: "fail",
      detail: `${parsed.label} accepted a direct TCP connection.`,
      fix: "Bind the service to a private interface or block the public port at the firewall; expose it only through the HTTPS tunnel/proxy."
    };
  }
  return {
    name: "closed public port",
    status: "ok",
    detail:
      result === "timeout"
        ? `${parsed.label} did not accept a direct TCP connection before timeout.`
        : `${parsed.label} is not directly reachable.`
  };
}

async function issueRelayDoctorSession(
  relayUrl: string,
  ownerToken: string
): Promise<{ ok: true; sessionToken: string } | { ok: false; detail: string }> {
  try {
    const response = await fetch(new URL("/api/auth/session", relayUrl), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ownerToken}`
      },
      signal: AbortSignal.timeout(FETCH_PROBE_TIMEOUT_MS)
    });
    if (!response.ok) {
      return {
        ok: false,
        detail: `Relay session bootstrap returned HTTP ${response.status}.`
      };
    }
    const payload = await response.json().catch(() => null);
    const parsed = RelaySessionResponseSchema.safeParse(payload);
    if (!parsed.success) {
      return {
        ok: false,
        detail: "Relay session bootstrap returned an invalid payload."
      };
    }
    return { ok: true, sessionToken: parsed.data.sessionToken };
  } catch (error) {
    return {
      ok: false,
      detail: `Relay session bootstrap failed: ${formatError(error)}`
    };
  }
}

async function fetchRelayDevices(
  relayUrl: string,
  sessionToken: string
): Promise<{ ok: true; devices: RelayDeviceRecord[] } | { ok: false; detail: string }> {
  try {
    const response = await fetchWithRetry(new URL("/api/devices", relayUrl), {
      headers: authorizationHeaders(sessionToken)
    });
    if (!response.ok) {
      return {
        ok: false,
        detail: `/api/devices returned HTTP ${response.status}.`
      };
    }
    const payload = await response.json().catch(() => null);
    const parsed = RelayDevicesResponseSchema.safeParse(payload);
    if (!parsed.success) {
      return {
        ok: false,
        detail: "/api/devices returned an invalid payload."
      };
    }
    return { ok: true, devices: parsed.data.devices as RelayDeviceRecord[] };
  } catch (error) {
    return {
      ok: false,
      detail: `/api/devices failed: ${formatError(error)}`
    };
  }
}

async function fetchDeviceHealth(
  relayUrl: string,
  sessionToken: string,
  deviceId: string
): Promise<{ ok: true; health: LocalHealthResponse } | { ok: false; detail: string }> {
  try {
    const response = await fetchWithRetry(
      new URL(`/api/relay/devices/${encodeURIComponent(deviceId)}/health`, relayUrl),
      {
        headers: authorizationHeaders(sessionToken)
      }
    );
    if (!response.ok) {
      return {
        ok: false,
        detail: `Agent health returned HTTP ${response.status}.`
      };
    }
    const payload = await response.json().catch(() => null);
    const parsed = LocalHealthResponseSchema.safeParse(payload);
    if (!parsed.success) {
      return {
        ok: false,
        detail: "Agent health returned an invalid payload."
      };
    }
    return { ok: true, health: parsed.data as LocalHealthResponse };
  } catch (error) {
    return {
      ok: false,
      detail: `Agent health failed: ${formatError(error)}`
    };
  }
}

async function fetchProviderCatalog(
  relayUrl: string,
  sessionToken: string,
  deviceId: string
): Promise<
  { ok: true; catalog: LocalProviderCatalogResponse } | { ok: false; detail: string }
> {
  try {
    const response = await fetchWithRetry(
      new URL(`/api/relay/devices/${encodeURIComponent(deviceId)}/providers`, relayUrl),
      {
        headers: authorizationHeaders(sessionToken)
      }
    );
    if (!response.ok) {
      return {
        ok: false,
        detail: `Provider catalog returned HTTP ${response.status}.`
      };
    }
    const payload = await response.json().catch(() => null);
    const parsed = LocalProviderCatalogResponseSchema.safeParse(payload);
    if (!parsed.success) {
      return {
        ok: false,
        detail: "Provider catalog returned an invalid payload."
      };
    }
    return { ok: true, catalog: parsed.data as LocalProviderCatalogResponse };
  } catch (error) {
    return {
      ok: false,
      detail: `Provider catalog failed: ${formatError(error)}`
    };
  }
}

function checkAgentHealthPayload(
  health: LocalHealthResponse,
  required: boolean,
  device: RelayDeviceRecord
): DoctorCheck {
  if (!health.ok) {
    return {
      name: "agent health",
      status: required ? "fail" : "warn",
      detail: `Agent ${safeDeviceLabel(device)} returned ok=false.`,
      fix: "Restart the selected agent and verify relay RPC health."
    };
  }
  if (health.codex?.available === false) {
    return {
      name: "agent health",
      status: required ? "fail" : "warn",
      detail: `Agent ${safeDeviceLabel(device)} is reachable, but Codex CLI is unavailable.`,
      fix: "Install Codex CLI on the selected agent and verify its PATH."
    };
  }
  const codexDetail = health.codex?.version
    ? `Codex ${health.codex.version}`
    : health.codex?.available
      ? "Codex available"
      : "Codex status unknown";
  return {
    name: "agent health",
    status: "ok",
    detail: `Agent ${safeDeviceLabel(device)} is healthy; ${codexDetail}.`
  };
}

function checkProviderRuntimeStatus(
  health: LocalHealthResponse,
  required: boolean
): DoctorCheck {
  const status = health.codexProvider;
  if (!status) {
    return {
      name: "provider runtime",
      status: required ? "fail" : "warn",
      detail: "Agent health did not include CodexProvider runtime status.",
      fix: "Update the selected agent and verify it reports codexProvider in health."
    };
  }
  if (!status.available) {
    return {
      name: "provider runtime",
      status: required ? "fail" : "warn",
      detail: status.error
        ? `CodexProvider runtime is unavailable: ${status.error}`
        : "CodexProvider runtime is unavailable.",
      fix: "Install or repair the codex-provider package on the selected agent."
    };
  }
  return {
    name: "provider runtime",
    status: "ok",
    detail: "CodexProvider runtime is available on the selected agent."
  };
}

function checkProviderCatalogPayload(
  catalog: LocalProviderCatalogResponse,
  required: boolean
): DoctorCheck {
  if (!catalog.available) {
    return {
      name: "provider catalog",
      status: required ? "fail" : "warn",
      detail: catalog.error
        ? `Provider catalog is unavailable: ${catalog.error}`
        : "Provider catalog is unavailable.",
      fix: "Install or repair the codex-provider package on the selected agent."
    };
  }
  if (catalog.providers.length === 0) {
    return {
      name: "provider catalog",
      status: required ? "fail" : "warn",
      detail: "Provider catalog is available but contains no providers.",
      fix: "Verify CodexProvider presets and provider catalog configuration."
    };
  }
  const configuredCount = catalog.providers.filter((provider) => provider.apiKeyConfigured).length;
  const modelCount = catalog.providers.reduce(
    (total, provider) => total + provider.models.length,
    0
  );
  return {
    name: "provider catalog",
    status: "ok",
    detail: `${catalog.providers.length} providers, ${modelCount} models, ${configuredCount} providers with configured API keys.`
  };
}

function selectDoctorDevice(
  devices: RelayDeviceRecord[],
  requestedDeviceId?: string
): { device: RelayDeviceRecord | null; detail?: string } {
  if (requestedDeviceId) {
    const device = devices.find((item) => item.deviceId === requestedDeviceId) ?? null;
    if (!device) {
      return {
        device: null,
        detail: `Requested device ${requestedDeviceId} was not found. ${summarizeDoctorDevices(devices)}`
      };
    }
    if (!device.online) {
      return {
        device: null,
        detail: `Requested device ${safeDeviceLabel(device)} is offline.`
      };
    }
    return { device };
  }
  return {
    device: devices.find((device) => device.online) ?? null
  };
}

function summarizeDoctorDevices(devices: RelayDeviceRecord[]): string {
  const online = devices.filter((device) => device.online).length;
  return `${online}/${devices.length} devices online.`;
}

function safeDeviceLabel(device: RelayDeviceRecord): string {
  return `${device.deviceName} (${device.deviceId})`;
}

function authorizationHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`
  };
}

function isSafeHealthPayload(value: unknown): value is { ok: true } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (record.ok !== true) {
    return false;
  }
  return Object.keys(record).every(
    (key) => !/(token|secret|password|prompt|assistant|command|output|content)/i.test(key)
  );
}

function isWebAuthStatusPayload(
  value: unknown
): value is { authenticated: boolean; loginRequired: boolean } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.authenticated === "boolean" &&
    typeof record.loginRequired === "boolean" &&
    Object.keys(record).every(
      (key) => !/(token|secret|password|prompt|assistant|command|output|content)/i.test(key)
    )
  );
}

function isSafeRelaySessionBootstrapPayload(value: unknown): value is {
  relayUrl: string;
  sessionToken: string;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.relayUrl === "string" &&
    typeof record.sessionToken === "string" &&
    Object.keys(record).every(
      (key) => !/(owner|device|secret|password|prompt|assistant|command|output|content)/i.test(key)
    )
  );
}

function safeUrlLabel(raw: string): string {
  try {
    const url = new URL(raw);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "<invalid-url>";
  }
}

function safeOriginLabel(raw: string): string | null {
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function fetchWithRetry(
  input: URL,
  init: Omit<NonNullable<Parameters<typeof fetch>[1]>, "signal"> = {}
): Promise<Response> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await fetch(input, {
        ...init,
        signal: AbortSignal.timeout(FETCH_PROBE_TIMEOUT_MS)
      });
    } catch (error) {
      lastError = error;
      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
  }
  throw lastError;
}

interface TcpEndpoint {
  host: string;
  label: string;
  port: number;
}

function parseExpectedClosedEndpoint(value: string): TcpEndpoint | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const raw = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `tcp://${trimmed}`;
  try {
    const url = new URL(raw);
    const port = Number(
      url.port ||
        (url.protocol === "https:" ? "443" : url.protocol === "http:" ? "80" : "")
    );
    if (!Number.isSafeInteger(port) || port <= 0 || port > 65535) {
      return null;
    }
    const host = url.hostname.replace(/^\[(.*)\]$/, "$1");
    if (!host) {
      return null;
    }
    const labelHost = host.includes(":") ? `[${host}]` : host;
    return {
      host,
      label: `${labelHost}:${port}`,
      port
    };
  } catch {
    return null;
  }
}

function probeTcpEndpoint(
  endpoint: TcpEndpoint,
  timeoutMs: number
): Promise<"open" | "closed" | "timeout"> {
  return new Promise((resolve) => {
    const socket = net.connect({
      host: endpoint.host,
      port: endpoint.port
    });
    let settled = false;
    const finish = (result: "open" | "closed" | "timeout") => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish("open"));
    socket.once("timeout", () => finish("timeout"));
    socket.once("error", () => finish("closed"));
  });
}

function runCommand(command: string, args: string[]): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      resolve({ ok: false, stdout, stderr, error });
    });

    child.on("close", (code) => {
      resolve({ ok: code === 0, stdout, stderr });
    });
  });
}

export const __doctorTestInternals = {
  isSafeRelaySessionBootstrapPayload,
  isSafeHealthPayload,
  isWebAuthStatusPayload,
  parseExpectedClosedEndpoint,
  safeOriginLabel,
  safeUrlLabel,
  selectDoctorDevice,
  summarizeDoctorDevices
};
