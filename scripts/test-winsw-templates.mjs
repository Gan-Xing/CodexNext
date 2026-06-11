import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const winswDir = path.join(rootDir, "ops", "winsw");

const templates = [
  {
    file: "codexnext-control.xml.template",
    id: "codexnext-control",
    requiredEnv: [
      "CODEXNEXT_ROOT",
      "CODEXNEXT_OWNER_TOKEN",
      "CODEXNEXT_CONTROL_HOST",
      "CODEXNEXT_CONTROL_PORT",
      "CODEXNEXT_PRODUCTION",
      "CODEXNEXT_PUBLIC_WEB_ORIGIN",
      "CODEXNEXT_ALLOWED_ORIGINS",
      "CODEXNEXT_ALLOW_MACHINE_OWNER_TOKEN",
      "CODEXNEXT_DISABLE_RELAY_FULL_ACCESS",
      "CODEXNEXT_HEARTBEAT_INTERVAL_MS",
      "CODEXNEXT_STALE_DEVICE_TIMEOUT_MS",
      "CODEXNEXT_RPC_TIMEOUT_MS"
    ],
    requiredSnippets: [
      "--filter @codexnext/control",
      "--owner-token",
      "--allow-origin",
      "CODEXNEXT_ALLOWED_ORIGINS"
    ]
  },
  {
    file: "codexnext-web.xml.template",
    id: "codexnext-web",
    requiredEnv: [
      "CODEXNEXT_ROOT",
      "CODEXNEXT_RELAY_URL",
      "CODEXNEXT_OWNER_TOKEN",
      "CODEXNEXT_PUBLIC_ORIGIN",
      "CODEXNEXT_WEB_HOST",
      "CODEXNEXT_WEB_PORT",
      "CODEXNEXT_WEB_AUTH_PASSWORD_HASH",
      "CODEXNEXT_WEB_SESSION_SECRET",
      "CODEXNEXT_DISABLE_RELAY_FULL_ACCESS",
      "CODEXNEXT_ALLOW_URL_TOKEN"
    ],
    requiredSnippets: [
      "--filter @codexnext/web",
      "NEXT_PUBLIC_CODEXNEXT_RELAY_URL",
      "next start"
    ]
  },
  {
    file: "codexnext-agent.xml.template",
    id: "codexnext-agent",
    requiredEnv: [
      "CODEXNEXT_ROOT",
      "CODEXNEXT_RELAY_URL",
      "CODEXNEXT_DEVICE_NAME",
      "CODEXNEXT_CODEX_BIN",
      "CODEXNEXT_APPROVAL_TIMEOUT_MS"
    ],
    requiredSnippets: [
      "--filter @codexnext/agent",
      "connect",
      "--relay",
      "--approval-timeout-ms",
      "--codex-bin"
    ]
  }
];

const xmlEntityPattern = /&(?!amp;|lt;|gt;|quot;|apos;)/;
const placeholderEnvNames = new Set([
  "CODEXNEXT_OWNER_TOKEN",
  "CODEXNEXT_WEB_AUTH_PASSWORD_HASH",
  "CODEXNEXT_WEB_SESSION_SECRET"
]);

for (const template of templates) {
  const fullPath = path.join(winswDir, template.file);
  const text = readFileSync(fullPath, "utf8");
  assertIncludes(text, "<service>", template.file);
  assertIncludes(text, "</service>", template.file);
  assertIncludes(text, `<id>${template.id}</id>`, template.file);
  assertIncludes(text, "<name>CodexNext", template.file);
  assertIncludes(text, "<description>", template.file);
  assertIncludes(text, "WindowsPowerShell", template.file);
  assertIncludes(text, "<workingdirectory>%CODEXNEXT_ROOT%</workingdirectory>", template.file);
  assertIncludes(text, '<onfailure action="restart" delay="5 sec" />', template.file);
  assertIncludes(text, "<logpath>%BASE%\\logs</logpath>", template.file);
  assertIncludes(text, '<log mode="roll-by-size">', template.file);

  if (xmlEntityPattern.test(text)) {
    throw new Error(`${template.file}: contains an unescaped XML entity`);
  }

  const env = parseEnv(text);
  for (const name of template.requiredEnv) {
    if (!env.has(name)) {
      throw new Error(`${template.file}: missing env ${name}`);
    }
  }

  for (const [name, value] of env.entries()) {
    if (placeholderEnvNames.has(name) && !value.startsWith("replace-with-")) {
      throw new Error(`${template.file}: secret-like env ${name} must use a placeholder`);
    }
  }

  for (const snippet of template.requiredSnippets) {
    assertIncludes(text, snippet, template.file);
  }
}

console.log(`Validated ${templates.length} WinSW templates.`);

function parseEnv(text) {
  const env = new Map();
  const pattern = /<env\s+name="([^"]+)"\s+value="([^"]*)"\s*\/>/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    env.set(match[1], match[2]);
  }
  return env;
}

function assertIncludes(text, snippet, file) {
  if (!text.includes(snippet)) {
    throw new Error(`${file}: missing ${snippet}`);
  }
}
