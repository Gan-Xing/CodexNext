#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import {
  accessSync,
  chmodSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const sessionCookieName = "codexnext_web_session";
const relaySessionCookieName = "codexnext_relay_session";
const defaultPublicPortHost = "144.217.243.161";
const directPublicPortPattern = /(?:144\.217\.243\.161|:3002\b|:3922\b)/u;
const repoRoot = process.cwd();

const args = parseArgs(process.argv.slice(2));
const envFile = args.env ?? process.env.CODEXNEXT_WEB_ENV_FILE ?? "/etc/codexnext/web.env";
if (existsSync(envFile)) {
  loadEnvironmentFile(envFile);
}

const webOrigin = normalizeOrigin(
  args.web ??
    process.env.CODEXNEXT_PUBLIC_ORIGIN ??
    process.env.CODEXNEXT_RELAY_URL ??
    "https://codexnext.byganxing.com"
);
const timeoutMs = Number(args.timeout ?? 45_000);
const browserPath = args.browser ?? process.env.CODEXNEXT_E2E_BROWSER ?? findBrowser();
const sessionSecret = process.env.CODEXNEXT_WEB_SESSION_SECRET;
let cachedRelaySessionCookieValue = null;

if (!sessionSecret) {
  fail("CODEXNEXT_WEB_SESSION_SECRET is required for authenticated browser smoke.");
}
if (!browserPath) {
  fail("No Chromium/Chrome executable found. Set CODEXNEXT_E2E_BROWSER or --browser.");
}

const browser = await chromium.launch({
  executablePath: browserPath,
  headless: args.headed !== "1",
  args: ["--no-sandbox", "--disable-dev-shm-usage"]
});

try {
  await runDesktopSmoke();
  await runMobileSmoke();
  await runMultiTabStorageSmoke();
  if (args["temp-agent"]) {
    await runTemporaryAgentMultiDeviceSmoke();
  }
  if (args["restart-web-service"]) {
    await runWebRestartSmoke(args["restart-web-service"]);
  }
  if (args["restart-agent-service"]) {
    await runAgentRestartSmoke(args["restart-agent-service"]);
  }
  logOk("web e2e smoke", `Browser checks passed for ${webOrigin}`);
} finally {
  await browser.close();
}

async function runDesktopSmoke() {
  const context = await createAuthedContext({
    viewport: { width: 1440, height: 920 }
  });
  const page = await context.newPage();
  const assertNetwork = collectNetworkUrls(page);
  await waitForControlOnlineDevice();
  await page.goto(webOrigin, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  await waitForConsoleShell(page);
  await waitForConnectedDevice(page);
  await verifySessionSelectionSurvivesReload(page);
  await verifySlashFast(page);
  await verifyProviderModelMenu(page);
  await verifySessionSetupProviderPicker(page);
  await verifyNoPublicPortLeak(page);
  assertNetwork();
  await rememberRelaySessionCookie(context);
  await context.close();
  logOk("desktop", "console shell, slash menu, Provider model UI, and same-origin network passed");
}

async function runMobileSmoke() {
  const context = await createAuthedContext({
    isMobile: true,
    viewport: { width: 390, height: 844 },
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
  });
  const page = await context.newPage();
  const assertNetwork = collectNetworkUrls(page);
  await page.goto(webOrigin, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  await waitForConsoleShell(page);
  if (!(await page.locator('textarea[name="composer_message"]').isVisible())) {
    await clickFirstVisible(page, 'button[aria-label="新建对话"]');
  }
  await page.locator('textarea[name="composer_message"]').waitFor({
    state: "visible",
    timeout: timeoutMs
  });
  await assertNoVisibleHorizontalOverflow(page);
  await verifyNoPublicPortLeak(page);
  assertNetwork();
  await rememberRelaySessionCookie(context);
  await context.close();
  logOk("mobile", "mobile viewport rendered composer without visible horizontal overflow");
}

async function runMultiTabStorageSmoke() {
  const context = await createAuthedContext({
    viewport: { width: 1280, height: 820 }
  });
  const pageA = await context.newPage();
  const pageB = await context.newPage();
  const assertNetworkA = collectNetworkUrls(pageA);
  const assertNetworkB = collectNetworkUrls(pageB);

  await pageA.goto(`${webOrigin}/api/auth/status`, {
    waitUntil: "domcontentloaded",
    timeout: timeoutMs
  });
  await pageB.goto(webOrigin, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  await waitForConsoleShell(pageB);
  await pageB
    .waitForFunction(
      () => Boolean(window.localStorage.getItem("codexnext.savedDevices.v1")),
      undefined,
      { timeout: Math.min(timeoutMs, 10_000) }
    )
    .catch(() => undefined);
  await pageB.waitForTimeout(1_000);

  const fakeDevice = {
    codexVersion: "e2e-storage-smoke",
    deviceId: "device_e2e_storage_smoke",
    hostname: "e2e-storage.local",
    id: "device_e2e_storage_smoke",
    lastConnectedAt: Date.now(),
    mode: "relay",
    name: "E2E Storage Device",
    online: false,
    relayUrl: webOrigin
  };
  await pageA.evaluate((device) => {
    window.localStorage.setItem("codexnext.savedDevices.v1", JSON.stringify([device]));
  }, fakeDevice);

  await pageB.getByRole("button", { name: "选择设备" }).click();
  await pageB.getByText("E2E Storage Device").first().waitFor({ timeout: timeoutMs });
  await verifyNoPublicPortLeak(pageB);
  assertNetworkA();
  assertNetworkB();
  await rememberRelaySessionCookie(context);
  await context.close();
  logOk("multi-tab", "saved device storage event converged into the second tab UI");
}

async function runTemporaryAgentMultiDeviceSmoke() {
  const agent = await startTemporaryPairedAgent();
  try {
    await waitForRelayDevice(agent.deviceId, { online: true });
    const context = await createAuthedContext({
      viewport: { width: 1360, height: 860 }
    });
    const page = await context.newPage();
    const assertNetwork = collectNetworkUrls(page);
    await page.goto(webOrigin, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await waitForConsoleShell(page);
    await waitForConnectedDevice(page);
    await waitForBrowserSavedDevice(page, agent.deviceId, agent.deviceName, true);
    await selectSavedDeviceInBrowser(page, agent.deviceName);
    await waitForSelectedDeviceName(page, agent.deviceName);
    await verifyNoPublicPortLeak(page);
    assertNetwork();
    await rememberRelaySessionCookie(context);
    await context.close();
    logOk("multi-device", `temporary paired agent ${agent.deviceName} connected and was selectable`);
  } finally {
    await stopTemporaryAgent(agent);
  }
}

async function runWebRestartSmoke(serviceName) {
  const context = await createAuthedContext({
    viewport: { width: 1360, height: 860 }
  });
  const page = await context.newPage();
  const assertNetwork = collectNetworkUrls(page);
  await page.goto(webOrigin, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  await waitForConsoleShell(page);
  const selectedThreadTitle = await selectFirstThread(page);
  restartSystemdService(serviceName);
  await waitForHttpOk(webOrigin);
  await waitForControlOnlineDevice();
  await page.goto(webOrigin, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  await waitForConsoleShell(page);
  await waitForConnectedDevice(page);
  await waitForMainThreadTitle(page, selectedThreadTitle);
  await verifyNoPublicPortLeak(page);
  assertNetwork();
  await rememberRelaySessionCookie(context);
  await context.close();
  logOk("web restart", `${serviceName} restarted and browser session recovered`);
}

async function runAgentRestartSmoke(serviceName) {
  const context = await createAuthedContext({
    viewport: { width: 1360, height: 860 }
  });
  const page = await context.newPage();
  const assertNetwork = collectNetworkUrls(page);
  await page.goto(webOrigin, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  await waitForConsoleShell(page);
  await waitForConnectedDevice(page);
  const selectedThreadTitle = await selectFirstThread(page);
  restartSystemdService(serviceName);
  await waitForSystemdActive(serviceName);
  await waitForControlOnlineDevice();
  await page.goto(webOrigin, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  await waitForConsoleShell(page);
  await waitForConnectedDevice(page);
  await waitForMainThreadTitle(page, selectedThreadTitle);
  await verifyProviderModelMenu(page);
  await verifyNoPublicPortLeak(page);
  assertNetwork();
  await rememberRelaySessionCookie(context);
  await context.close();
  logOk("agent restart", `${serviceName} restarted and Provider/model UI recovered`);
}

async function createAuthedContext(options) {
  const origin = new URL(webOrigin);
  const context = await browser.newContext({
    ignoreHTTPSErrors: false,
    locale: "zh-CN",
    ...options
  });
  const cookies = [
    {
      domain: origin.hostname,
      expires: Math.floor(Date.now() / 1000) + 8 * 60 * 60,
      httpOnly: true,
      name: sessionCookieName,
      path: "/",
      sameSite: "Lax",
      secure: origin.protocol === "https:",
      value: issueWebSessionCookieValue()
    }
  ];
  if (cachedRelaySessionCookieValue) {
    cookies.push({
      domain: origin.hostname,
      expires: Math.floor(Date.now() / 1000) + 60 * 60,
      httpOnly: true,
      name: relaySessionCookieName,
      path: "/",
      sameSite: "Lax",
      secure: origin.protocol === "https:",
      value: cachedRelaySessionCookieValue
    });
  }
  await context.addCookies(cookies);
  return context;
}

async function rememberRelaySessionCookie(context) {
  const cookies = await context.cookies(webOrigin);
  const relayCookie = cookies.find((cookie) => cookie.name === relaySessionCookieName);
  if (relayCookie?.value) {
    cachedRelaySessionCookieValue = relayCookie.value;
  }
}

async function waitForConsoleShell(page) {
  await page.waitForSelector(".cn-app-frame", { timeout: timeoutMs });
  await page.locator('textarea[name="composer_message"]').waitFor({
    state: "attached",
    timeout: timeoutMs
  });
  const bodyText = await page.locator("body").innerText({ timeout: timeoutMs });
  assert(bodyText.includes("CodexNext"), "console shell did not render CodexNext branding");
  assert(!bodyText.includes("登录控制台"), "authenticated context was redirected to login");
}

async function clickFirstVisible(page, selector) {
  const clicked = await page.evaluate((candidateSelector) => {
    for (const element of document.querySelectorAll(candidateSelector)) {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      if (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        element instanceof HTMLElement
      ) {
        element.click();
        return true;
      }
    }
    return false;
  }, selector);
  assert(clicked, `No visible element matched ${selector}`);
}

async function waitForConnectedDevice(page) {
  try {
    await page.waitForFunction(
      () => {
        const text = document.body.innerText;
        return (
          text.includes("设备已连接") ||
          /已同步\s+\d+\s+个项目/u.test(text) ||
          Boolean(document.querySelector(".cn-live-dot:not(.offline)"))
        );
      },
      undefined,
      { timeout: timeoutMs }
    );
  } catch (error) {
    const snapshot = await readPageDebugSnapshot(page);
    fail(
      `Timed out waiting for a connected device in the browser. ${formatDebugSnapshot(snapshot)}`
    );
  }
}

async function verifySlashFast(page) {
  const composer = page.locator('textarea[name="composer_message"]');
  await composer.fill("/");
  await page.locator(".cn-popover.slash").waitFor({ timeout: timeoutMs });
  const slashText = await page.locator(".cn-popover.slash").innerText();
  assert(slashText.includes("/fast"), "slash menu did not expose /fast");
  assert(slashText.includes("快速模式"), "slash menu did not label /fast as 快速模式");
}

async function verifySessionSelectionSurvivesReload(page) {
  const threadTitle = await selectFirstThread(page);

  await page.reload({ waitUntil: "domcontentloaded", timeout: timeoutMs });
  await waitForConsoleShell(page);
  await waitForConnectedDevice(page);
  await waitForMainThreadTitle(page, threadTitle);
}

async function selectFirstThread(page) {
  const threadButton = page.locator(".cn-thread-row .cn-thread-main").first();
  await threadButton.waitFor({ state: "visible", timeout: timeoutMs });
  const threadTitle = (await threadButton.locator(".cn-thread-title").innerText()).trim();
  assert(threadTitle.length > 0, "first thread row did not expose a selectable title");

  await threadButton.click();
  await page.locator(".cn-main.thread .cn-main-header h1").waitFor({
    state: "visible",
    timeout: timeoutMs
  });
  await waitForMainThreadTitle(page, threadTitle);
  return threadTitle;
}

async function waitForBrowserSavedDevice(page, deviceId, deviceName, online) {
  await page.waitForFunction(
    ({ expectedDeviceId, expectedDeviceName, expectedOnline }) => {
      const raw = window.localStorage.getItem("codexnext.savedDevices.v1");
      const devices = raw ? JSON.parse(raw) : [];
      return Array.isArray(devices) && devices.some((device) => (
        device?.deviceId === expectedDeviceId &&
        device?.name === expectedDeviceName &&
        device?.online === expectedOnline
      ));
    },
    { expectedDeviceId: deviceId, expectedDeviceName: deviceName, expectedOnline: online },
    { timeout: timeoutMs }
  );
}

async function selectSavedDeviceInBrowser(page, deviceName) {
  await page.getByRole("button", { name: "选择设备" }).click();
  const deviceCard = page.locator(".cn-saved-device-card", { hasText: deviceName });
  await deviceCard.locator(".cn-saved-device-main").click();
  await page.locator(".cn-device-editor .cn-primary-button").click();
}

async function waitForSelectedDeviceName(page, deviceName) {
  await page.waitForFunction(
    (expectedName) =>
      document.querySelector(".cn-device-summary strong")?.textContent?.trim() === expectedName,
    deviceName,
    { timeout: timeoutMs }
  );
}

async function waitForMainThreadTitle(page, expectedTitle) {
  await page.waitForFunction(
    (title) => document.querySelector(".cn-main.thread .cn-main-header h1")?.textContent?.trim() === title,
    expectedTitle,
    { timeout: timeoutMs }
  );
}

async function verifyProviderModelMenu(page) {
  await page.locator(".cn-composer-pill-model").click();
  await page.locator(".cn-popover.model").waitFor({ timeout: timeoutMs });
  await page.waitForFunction(
    () => {
      const menu = document.querySelector(".cn-popover.model");
      const text = menu?.textContent ?? "";
      return text.includes("模型") && text.includes("推理") && text.includes("OpenRouter");
    },
    undefined,
    { timeout: timeoutMs }
  );
  const menuText = await page.locator(".cn-popover.model").innerText();
  assert(menuText.includes("DeepSeek"), "Provider model menu did not include DeepSeek provider options");
  await page.locator(".cn-popover.model .cn-model-search-input").waitFor({ timeout: timeoutMs });
}

async function verifySessionSetupProviderPicker(page) {
  const setupButton = page
    .getByRole("button", { name: "选择文件夹" })
    .or(page.getByRole("button", { name: "调整设置" }));
  const setupVisible = await setupButton.first().isVisible({ timeout: 2_000 }).catch(() => false);
  if (!setupVisible) {
    await clickFirstVisible(page, 'button[aria-label="新建对话"]');
  }
  await setupButton.first().click();
  const providerSelect = page.locator('select[name="session_provider"]');
  await providerSelect.waitFor({ timeout: timeoutMs });
  await page.waitForFunction(
    () => {
      const select = document.querySelector('select[name="session_provider"]');
      return select instanceof HTMLSelectElement && !select.disabled && select.options.length >= 3;
    },
    undefined,
    { timeout: timeoutMs }
  );
  const providerOptions = await providerSelect.locator("option").allTextContents();
  assert(providerOptions.some((label) => label.includes("OpenRouter")), "Provider picker missing OpenRouter");
  assert(providerOptions.some((label) => label.includes("DeepSeek")), "Provider picker missing DeepSeek");
}

async function verifyNoPublicPortLeak(page) {
  const snapshot = await page.evaluate(() => {
    const storage = {};
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key) {
        storage[key] = window.localStorage.getItem(key);
      }
    }
    return {
      html: document.documentElement.outerHTML,
      localStorage: storage,
      text: document.body.innerText
    };
  });
  const haystack = JSON.stringify(snapshot);
  assert(
    !haystack.includes(defaultPublicPortHost),
    "browser state leaked the public host IP instead of the same-origin domain"
  );
}

async function assertNoVisibleHorizontalOverflow(page) {
  const result = await page.evaluate(() => {
    const offenders = [];
    const viewportWidth = window.innerWidth;
    for (const element of document.querySelectorAll("body *")) {
      const style = window.getComputedStyle(element);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.position === "fixed"
      ) {
        continue;
      }
      const rect = element.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) {
        continue;
      }
      if (rect.left < -4 || rect.right > viewportWidth + 4) {
        offenders.push({
          className: element.className?.toString() ?? "",
          tag: element.tagName.toLowerCase(),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width)
        });
      }
      if (offenders.length >= 8) {
        break;
      }
    }
    return {
      clientWidth: document.documentElement.clientWidth,
      offenders,
      scrollWidth: document.documentElement.scrollWidth,
      viewportWidth
    };
  });
  assert(
    result.scrollWidth <= result.clientWidth + 4,
    `mobile document has horizontal overflow: ${JSON.stringify(result)}`
  );
  assert(
    result.offenders.length === 0,
    `mobile visible elements overflow viewport: ${JSON.stringify(result.offenders)}`
  );
}

function collectNetworkUrls(page) {
  const urls = [];
  page.on("request", (request) => {
    urls.push(request.url());
  });
  page.on("websocket", (socket) => {
    urls.push(socket.url());
  });
  return () => {
    const disallowed = urls.filter((url) => !isAllowedBrowserUrl(url));
    assert(
      disallowed.length === 0,
      `browser made non same-origin or public-port requests: ${JSON.stringify(disallowed.slice(0, 8))}`
    );
  };
}

function isAllowedBrowserUrl(rawUrl) {
  if (
    rawUrl.startsWith("about:") ||
    rawUrl.startsWith("blob:") ||
    rawUrl.startsWith("data:") ||
    rawUrl.startsWith("chrome:")
  ) {
    return true;
  }
  if (directPublicPortPattern.test(rawUrl)) {
    return false;
  }
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)) {
    return true;
  }
  const normalizedProtocol = url.protocol === "ws:" ? "http:" : url.protocol === "wss:" ? "https:" : url.protocol;
  return `${normalizedProtocol}//${url.host}` === webOrigin;
}

async function waitForHttpOk(url) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.status >= 200 && response.status < 500) {
        return;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(750);
  }
  fail(`Timed out waiting for ${url} after service restart: ${lastError}`);
}

async function waitForControlOnlineDevice() {
  const url = `${webOrigin}/api/control/health`;
  const deadline = Date.now() + timeoutMs;
  let lastDetail = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { redirect: "manual" });
      const payload = await response.json().catch(() => null);
      const onlineDevices = Number(payload?.onlineDevices ?? 0);
      if (response.ok && payload?.ok === true && onlineDevices > 0) {
        return;
      }
      lastDetail = `HTTP ${response.status} ${JSON.stringify(payload)?.slice(0, 240)}`;
    } catch (error) {
      lastDetail = error instanceof Error ? error.message : String(error);
    }
    await sleep(750);
  }
  fail(`Timed out waiting for an online control device at ${url}: ${lastDetail}`);
}

async function waitForRelayDevice(deviceId, options) {
  const bootstrap = await requestRelaySessionBootstrap();
  const deadline = Date.now() + timeoutMs;
  let lastDetail = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(new URL("/api/devices", bootstrap.relayUrl), {
        headers: authorizationHeaders(bootstrap.sessionToken)
      });
      const payload = await response.json().catch(() => null);
      const devices = Array.isArray(payload?.devices) ? payload.devices : [];
      const device = devices.find((item) => item?.deviceId === deviceId);
      if (device && Boolean(device.online) === options.online) {
        return device;
      }
      lastDetail = `HTTP ${response.status} ${JSON.stringify(payload)?.slice(0, 240)}`;
    } catch (error) {
      lastDetail = error instanceof Error ? error.message : String(error);
    }
    await sleep(750);
  }
  fail(`Timed out waiting for relay device ${deviceId} online=${options.online}: ${lastDetail}`);
}

async function waitForSystemdActive(serviceName) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = spawnSync("systemctl", ["is-active", "--quiet", serviceName], {
      encoding: "utf8"
    });
    if (result.status === 0) {
      return;
    }
    await sleep(750);
  }
  fail(`Timed out waiting for ${serviceName} to become active.`);
}

async function readPageDebugSnapshot(page) {
  try {
    return await page.evaluate(() => {
      const storage = {};
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const key = window.localStorage.key(index);
        if (key) {
          storage[key] = window.localStorage.getItem(key);
        }
      }
      return {
        text: document.body.innerText.slice(0, 1200),
        storage
      };
    });
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function formatDebugSnapshot(snapshot) {
  return JSON.stringify(snapshot, (_, value) => {
    if (typeof value === "string" && value.length > 500) {
      return `${value.slice(0, 500)}...`;
    }
    return value;
  });
}

async function startTemporaryPairedAgent() {
  const deviceName = args["temp-agent-name"] ?? `CodexNext E2E ${Date.now()}`;
  const relayForAgent =
    args["temp-agent-relay"] ??
    process.env.CODEXNEXT_CONTROL_URL ??
    process.env.CODEXNEXT_RELAY_URL ??
    webOrigin;
  const tempHome = mkdtempSync(join(tmpdir(), "codexnext-e2e-agent-"));
  const identity = {
    version: 1,
    deviceId: randomUUID(),
    deviceName,
    deviceToken: randomBytes(24).toString("base64url"),
    createdAt: Date.now(),
    relayUrl: normalizeOrigin(relayForAgent)
  };
  const identityDirectory = join(tempHome, ".codexnext");
  mkdirSync(identityDirectory, { mode: 0o700, recursive: true });
  writeFileSync(join(identityDirectory, "device.json"), `${JSON.stringify(identity, null, 2)}\n`, {
    mode: 0o600
  });
  chmodSync(join(identityDirectory, "device.json"), 0o600);

  const bootstrap = await requestRelaySessionBootstrap();
  const pairing = await createPairingRequest(bootstrap.relayUrl, identity);
  await approvePairingRequest(bootstrap.relayUrl, bootstrap.sessionToken, pairing.codeDigits);

  const child = spawnTemporaryAgentProcess({
    deviceName,
    relayUrl: relayForAgent,
    tempHome
  });
  const handle = {
    child,
    deviceId: identity.deviceId,
    deviceName,
    tempHome
  };
  await waitForTemporaryAgentReady(handle);
  return handle;
}

function spawnTemporaryAgentProcess(input) {
  const agentEnvFile =
    args["agent-env"] ?? process.env.CODEXNEXT_AGENT_ENV_FILE ?? "/etc/codexnext/agent.env";
  const agentEnv = existsSync(agentEnvFile) ? readEnvironmentFile(agentEnvFile) : {};
  const codexBin =
    args["codex-bin"] ??
    agentEnv.CODEXNEXT_CODEX_BIN ??
    process.env.CODEXNEXT_CODEX_BIN ??
    "codex";
  const child = spawn(
    "pnpm",
    [
      "--filter",
      "@codexnext/agent",
      "dev",
      "--",
      "connect",
      "--relay",
      input.relayUrl,
      "--approval-timeout-ms",
      "300000",
      "--codex-bin",
      codexBin,
      "--device-name",
      input.deviceName
    ],
    {
      cwd: repoRoot,
      detached: true,
      env: {
        ...process.env,
        ...agentEnv,
        HOME: input.tempHome
      },
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
  child.stdout?.on("data", (chunk) => {
    const text = chunk.toString();
    if (args["temp-agent-log"]) {
      process.stdout.write(`[temp-agent] ${text}`);
    }
  });
  child.stderr?.on("data", (chunk) => {
    const text = chunk.toString();
    if (args["temp-agent-log"]) {
      process.stderr.write(`[temp-agent] ${text}`);
    }
  });
  return child;
}

async function waitForTemporaryAgentReady(handle) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (handle.child.exitCode !== null) {
      fail(`Temporary agent exited before connecting with code ${handle.child.exitCode}.`);
    }
    try {
      await waitForRelayDevice(handle.deviceId, { online: true });
      return;
    } catch {
      await sleep(750);
    }
  }
  fail(`Timed out waiting for temporary agent ${handle.deviceName} to connect.`);
}

async function stopTemporaryAgent(handle) {
  if (handle.child.exitCode === null) {
    killChildProcessTree(handle.child, "SIGTERM");
    const exited = await waitForChildExit(handle.child, 5_000);
    if (!exited && handle.child.exitCode === null) {
      killChildProcessTree(handle.child, "SIGKILL");
      await waitForChildExit(handle.child, 2_000);
    }
  }
  await revokeRelayDevice(handle.deviceId).catch((error) => {
    console.warn(
      `[warn] Failed to revoke temporary relay device ${handle.deviceId}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  });
  rmSync(handle.tempHome, { force: true, recursive: true });
}

function killChildProcessTree(child, signal) {
  if (child.pid) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // Fall back to killing the direct child below.
    }
  }
  child.kill(signal);
}

function waitForChildExit(child, timeout) {
  if (child.exitCode !== null) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.off("exit", onExit);
      resolve(false);
    }, timeout);
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once("exit", onExit);
  });
}

async function requestRelaySessionBootstrap() {
  const cookieValue = issueWebSessionCookieValue();
  const cookie = [
    `${sessionCookieName}=${cookieValue}`,
    cachedRelaySessionCookieValue
      ? `${relaySessionCookieName}=${cachedRelaySessionCookieValue}`
      : null
  ]
    .filter(Boolean)
    .join("; ");
  const response = await fetch(new URL("/api/relay/session", webOrigin), {
    method: "POST",
    headers: { Cookie: cookie }
  });
  if (!response.ok) {
    fail(`Failed to bootstrap relay session for E2E API calls: HTTP ${response.status} ${await response.text()}`);
  }
  const payload = await response.json();
  if (!payload?.relayUrl || !payload?.sessionToken) {
    fail("Relay session bootstrap returned an invalid payload.");
  }
  cachedRelaySessionCookieValue = payload.sessionToken;
  return {
    relayUrl: normalizeOrigin(payload.relayUrl),
    sessionToken: payload.sessionToken
  };
}

async function createPairingRequest(relayUrl, identity) {
  const response = await fetch(new URL("/api/pairings/device", relayUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      deviceId: identity.deviceId,
      deviceToken: identity.deviceToken,
      deviceName: identity.deviceName,
      hostname: "codexnext-e2e.local",
      platform: process.platform,
      arch: process.arch,
      agentVersion: "0.1.0",
      codexVersion: null,
      relayUrl: identity.relayUrl
    })
  });
  if (!response.ok) {
    fail(`Failed to create temporary pairing request: HTTP ${response.status} ${await response.text()}`);
  }
  const payload = await response.json();
  if (!payload?.codeDigits) {
    fail("Temporary pairing request returned an invalid payload.");
  }
  return payload;
}

async function approvePairingRequest(relayUrl, sessionToken, codeDigits) {
  const response = await fetch(
    new URL(`/api/pairings/requests/${encodeURIComponent(codeDigits)}/approve`, relayUrl),
    {
      method: "POST",
      headers: authorizationHeaders(sessionToken)
    }
  );
  if (!response.ok) {
    fail(`Failed to approve temporary pairing request: HTTP ${response.status} ${await response.text()}`);
  }
}

async function revokeRelayDevice(deviceId) {
  const bootstrap = await requestRelaySessionBootstrap();
  const response = await fetch(
    new URL(`/api/devices/${encodeURIComponent(deviceId)}`, bootstrap.relayUrl),
    {
      method: "DELETE",
      headers: authorizationHeaders(bootstrap.sessionToken)
    }
  );
  if (!response.ok && response.status !== 404) {
    throw new Error(`HTTP ${response.status} ${await response.text()}`);
  }
}

function restartSystemdService(serviceName) {
  if (!serviceName || /[^A-Za-z0-9@_.:-]/u.test(serviceName)) {
    fail(`Unsafe systemd service name: ${serviceName}`);
  }
  if (typeof process.getuid === "function" && process.getuid() !== 0) {
    fail(`Restarting ${serviceName} requires running smoke-web-e2e as root or via sudo.`);
  }
  const result = spawnSync("systemctl", ["restart", serviceName], {
    encoding: "utf8"
  });
  if (result.status !== 0) {
    fail(
      `Failed to restart ${serviceName}: ${(result.stderr || result.stdout || "unknown error").trim()}`
    );
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function issueWebSessionCookieValue(now = Date.now()) {
  const payload = {
    exp: Math.floor(now / 1000) + 8 * 60 * 60,
    iat: Math.floor(now / 1000),
    nonce: randomBytes(18).toString("base64url"),
    sub: "codexnext-web"
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", sessionSecret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function findBrowser() {
  const candidates = [
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/opt/google/chrome/google-chrome",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium"
  ];
  for (const candidate of candidates) {
    if (isExecutable(candidate)) {
      return candidate;
    }
  }
  const shellResult = spawnSync("sh", [
    "-lc",
    "command -v google-chrome-stable || command -v google-chrome || command -v chromium-browser || command -v chromium"
  ], {
    encoding: "utf8"
  });
  const resolved = shellResult.stdout.trim().split(/\n/u)[0];
  return resolved && isExecutable(resolved) ? resolved : null;
}

function isExecutable(path) {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function loadEnvironmentFile(path) {
  for (const [key, value] of Object.entries(readEnvironmentFile(path))) {
    process.env[key] = value;
  }
}

function readEnvironmentFile(path) {
  const env = {};
  for (const originalLine of readFileSync(path, "utf8").split(/\r?\n/u)) {
    let line = originalLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    if (line.startsWith("export ")) {
      line = line.slice("export ".length).trimStart();
    }
    const equalsIndex = line.indexOf("=");
    if (equalsIndex <= 0) {
      continue;
    }
    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key)) {
      continue;
    }
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function normalizeOrigin(value) {
  const url = new URL(value);
  return url.origin;
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--") {
      continue;
    }
    if (!item.startsWith("--")) {
      fail(`Unexpected argument: ${item}`);
    }
    const [key, inlineValue] = item.slice(2).split("=", 2);
    if (["headed", "temp-agent", "temp-agent-log"].includes(key)) {
      parsed[key] = inlineValue ?? "1";
      continue;
    }
    const value = inlineValue ?? argv[index + 1];
    if (!value || value.startsWith("--")) {
      fail(`Missing value for --${key}`);
    }
    parsed[key] = value;
    if (inlineValue === undefined) {
      index += 1;
    }
  }
  return parsed;
}

function assert(condition, message) {
  if (!condition) {
    fail(message);
  }
}

function authorizationHeaders(token) {
  return {
    Authorization: `Bearer ${token}`
  };
}

function fail(message) {
  console.error(`[fail] ${message}`);
  process.exit(1);
}

function logOk(name, detail) {
  console.log(`[ok] ${name}: ${detail}`);
}
