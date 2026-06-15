import type { CodexIconName } from "../../components/DesignLab";
import type { ChatItem, LocalEvent, PendingApprovalView } from "../../lib/types";
import { isRecord } from "../../lib/format/text";
import type { TurnGroup } from "../chat/chat-state";

export interface SummaryOutputItem {
  detail?: string;
  key: string;
  title: string;
}

export interface SummaryTaskItem {
  detail?: string;
  key: string;
  title: string;
}

export interface SummarySourceItem {
  icon: CodexIconName;
  key: string;
  label: string;
}

export interface SummaryPanelData {
  approvals: PendingApprovalView[];
  outputs: SummaryOutputItem[];
  sources: SummarySourceItem[];
  tasks: SummaryTaskItem[];
}

const VISIBLE_ROWS = 6;
const MAX_INPUTS = 18;
const MAX_TASKS = 12;
const LOCAL_FILE_LINK_RE =
  /\[([^\]]+)\]\((?:<([^>]+)>|([^)\s]+))(?:\s+"[^"]*")?\)/g;
const LOCAL_PATH_RE =
  /(^|[\s(])((?:\/|\.\/|\.\.\/)[^\s)<>\]]+\.(?:md|mdx|txt|tsx?|jsx?|json|ya?ml|toml|ini|css|scss|html|sh|zsh|bash|py|go|rs|java|swift|kt|rb|php|sql))(?:\:\d+)?/gim;
const DIFF_FILE_RE = /^(?:\+\+\+|---)\s+(?:[ab]\/)?(.+)$/gm;
const URL_RE = /\bhttps?:\/\/[^\s<>"')]+/gi;
const KNOWN_SOURCE_RULES: Array<{
  icon: CodexIconName;
  key: string;
  label: string;
  pattern: RegExp;
}> = [
  { key: "web-search", label: "网络搜索", icon: "search", pattern: /\bweb ?search\b|\bsearch_query\b|\bimage_query\b|\bimage search\b/i },
  { key: "context7", label: "Context7", icon: "plug", pattern: /\bcontext7\b/i },
  { key: "figma", label: "Figma", icon: "plug", pattern: /\bfigma\b|figma\.com/i },
  { key: "browser-mcp", label: "Browser MCP", icon: "browserUse", pattern: /\bbrowser(?:-use)?\b|browser mcp|in-app browser|control-in-app-browser/i },
  { key: "playwright", label: "Playwright", icon: "browserUse", pattern: /\bplaywright\b/i },
  { key: "chrome-devtools", label: "Chrome DevTools", icon: "browserUse", pattern: /\bchrome-devtools\b|\bdevtools\b/i },
  { key: "github", label: "GitHub", icon: "github", pattern: /\bgithub\b|github\.com/i },
  { key: "gmail", label: "Gmail", icon: "gmail", pattern: /\bgmail\b|mail\.google\.com/i },
  { key: "google-drive", label: "Google Drive", icon: "googleDrive", pattern: /\bgoogle drive\b|docs\.google\.com|drive\.google\.com|sheets\.google\.com|slides\.google\.com/i },
  { key: "notion", label: "Notion", icon: "notion", pattern: /\bnotion\b|notion\.so/i }
];

export function summaryVisibleRows(): number {
  return VISIBLE_ROWS;
}

export function buildSummaryPanelData(input: {
  chatItems: ChatItem[];
  events: LocalEvent[];
  pendingApprovals: PendingApprovalView[];
}): SummaryPanelData {
  return {
    approvals: input.pendingApprovals,
    outputs: collectOutputItems(input.chatItems),
    tasks: collectTaskItems(input.chatItems, input.events, input.pendingApprovals),
    sources: collectSourceItems(input.chatItems, input.events)
  };
}

export function chatItemsFromTurnGroups(turnGroups: TurnGroup[]): ChatItem[] {
  const items: ChatItem[] = [];
  for (const group of turnGroups) {
    for (const item of group.items) {
      if (item.chatItem) {
        items.push(item.chatItem);
      }
    }
  }
  return items;
}

function collectOutputItems(chatItems: ChatItem[]): SummaryOutputItem[] {
  const seen = new Set<string>();
  const items: SummaryOutputItem[] = [];

  for (const item of [...chatItems].reverse()) {
    if (item.role === "user") {
      continue;
    }
    for (const reference of extractOutputReferences(item)) {
      if (seen.has(reference.key)) {
        continue;
      }
      seen.add(reference.key);
      items.push(reference);
      if (items.length >= MAX_INPUTS) {
        return items;
      }
    }
  }

  return items;
}

function extractOutputReferences(item: ChatItem): SummaryOutputItem[] {
  const references: SummaryOutputItem[] = [];
  const text = item.text;

  for (const match of text.matchAll(LOCAL_FILE_LINK_RE)) {
    const title = match[1]?.trim();
    const href = (match[2] ?? match[3] ?? "").trim();
    const normalized = normalizeLocalPath(href);
    if (!title || !normalized) {
      continue;
    }
    references.push({
      key: normalized,
      title,
      ...(normalized !== title ? { detail: normalized } : {})
    });
  }

  for (const match of text.matchAll(LOCAL_PATH_RE)) {
    const raw = match[2]?.trim();
    if (!raw) {
      continue;
    }
    const normalized = normalizeLocalPath(raw);
    if (!normalized) {
      continue;
    }
    references.push({
      key: normalized,
      title: basename(normalized),
      detail: normalized
    });
  }

  if (item.role === "diff") {
    for (const match of text.matchAll(DIFF_FILE_RE)) {
      const filePath = match[1]?.trim();
      if (!filePath || filePath === "/dev/null") {
        continue;
      }
      references.push({
        key: `diff:${filePath}`,
        title: basename(filePath),
        detail: filePath
      });
    }
  }

  return references;
}

function collectTaskItems(
  chatItems: ChatItem[],
  events: LocalEvent[],
  pendingApprovals: PendingApprovalView[]
): SummaryTaskItem[] {
  const seen = new Set<string>();
  const tasks: SummaryTaskItem[] = [];

  for (const approval of [...pendingApprovals].reverse()) {
    const command = readApprovalCommand(approval);
    if (!command) {
      continue;
    }
    const normalized = normalizeCommand(command);
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    tasks.push({
      key: `approval:${approval.approvalId}`,
      title: command,
      detail: "等待批准"
    });
  }

  for (const event of [...events].reverse()) {
    for (const command of extractCommandsFromValue(event.payload)) {
      const normalized = normalizeCommand(command);
      if (seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      const detail = taskDetail(event);
      tasks.push({
        key: `${event.id}:${normalized}`,
        title: command,
        ...(detail ? { detail } : {})
      });
      if (tasks.length >= MAX_TASKS) {
        return tasks;
      }
    }
  }

  for (const item of [...chatItems].reverse()) {
    if (item.role !== "command") {
      continue;
    }
    for (const command of extractCommandsFromText(item.text)) {
      const normalized = normalizeCommand(command);
      if (seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      tasks.push({
        key: `${item.id}:${normalized}`,
        title: command
      });
      if (tasks.length >= MAX_TASKS) {
        return tasks;
      }
    }
  }

  return tasks;
}

function collectSourceItems(
  chatItems: ChatItem[],
  events: LocalEvent[]
): SummarySourceItem[] {
  const haystacks = [
    ...chatItems.map((item) => item.text),
    ...events.map((event) => safeJson(event.payload))
  ];
  const joined = haystacks.join("\n");
  const sources = new Map<string, SummarySourceItem>();

  for (const rule of KNOWN_SOURCE_RULES) {
    if (rule.pattern.test(joined)) {
      sources.set(rule.key, {
        key: rule.key,
        label: rule.label,
        icon: rule.icon
      });
    }
  }

  for (const url of joined.match(URL_RE) ?? []) {
    const mapped = mapUrlToSource(url);
    if (!mapped || sources.has(mapped.key)) {
      continue;
    }
    sources.set(mapped.key, mapped);
  }

  return [...sources.values()];
}

function readApprovalCommand(approval: PendingApprovalView): string | null {
  if (!approval.method.includes("commandExecution")) {
    return null;
  }
  if (!isRecord(approval.params) || typeof approval.params.command !== "string") {
    return null;
  }
  return approval.params.command.trim();
}

function extractCommandsFromValue(value: unknown): string[] {
  const commands: string[] = [];
  const queue: unknown[] = [value];
  const seen = new Set<unknown>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (current == null || seen.has(current)) {
      continue;
    }
    seen.add(current);

    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }

    if (!isRecord(current)) {
      continue;
    }

    for (const [key, nested] of Object.entries(current)) {
      if (typeof nested === "string") {
        if (key === "command") {
          commands.push(nested.trim());
          continue;
        }
        if (key === "summary" && looksLikeCommand(nested)) {
          commands.push(nested.trim());
          continue;
        }
      }

      if (Array.isArray(nested) && key === "summary") {
        for (const entry of nested) {
          if (typeof entry === "string" && looksLikeCommand(entry)) {
            commands.push(entry.trim());
          }
        }
      }

      if (nested && typeof nested === "object") {
        queue.push(nested);
      }
    }
  }

  return commands.filter((command) => command.length > 0);
}

function extractCommandsFromText(text: string): string[] {
  const commands: string[] = [];
  const lines = text.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const normalized = normalizeCommand(trimmed);
    if (looksLikeCommand(normalized)) {
      commands.push(normalized);
    }
  }

  return commands;
}

function taskDetail(event: LocalEvent): string | undefined {
  switch (event.type) {
    case "approval.requested":
      return "等待批准";
    case "turn.completed":
      return "已完成";
    case "codex.notification":
      return "执行中";
    default:
      return undefined;
  }
}

function normalizeLocalPath(value: string): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.replace(/^<|>$/g, "").trim();
  const [pathPart] = trimmed.split(":");
  if (!pathPart) {
    return null;
  }
  if (
    pathPart.startsWith("/") ||
    pathPart.startsWith("./") ||
    pathPart.startsWith("../")
  ) {
    return pathPart;
  }
  return null;
}

function basename(value: string): string {
  const segments = value.split("/");
  return segments.at(-1) ?? value;
}

function normalizeCommand(value: string): string {
  return value.replace(/^\$\s*/, "").replace(/\s+/g, " ").trim();
}

function looksLikeCommand(value: string): boolean {
  const candidate = normalizeCommand(value);
  return /^(pnpm|npm|yarn|bun|node|tsx|npx|git|rg|sed|ls|cat|find|open|curl|cd|next|python|pytest|uv|pip|playwright|cargo|go|swift|xcodebuild)\b/i.test(
    candidate
  );
}

function mapUrlToSource(url: string): SummarySourceItem | null {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === "figma.com" || host.endsWith(".figma.com")) {
      return { key: "figma", label: "Figma", icon: "plug" };
    }
    if (host === "github.com" || host.endsWith(".github.com")) {
      return { key: "github", label: "GitHub", icon: "github" };
    }
    if (
      host === "docs.google.com" ||
      host === "drive.google.com" ||
      host === "sheets.google.com" ||
      host === "slides.google.com"
    ) {
      return { key: "google-drive", label: "Google Drive", icon: "googleDrive" };
    }
    if (host === "mail.google.com") {
      return { key: "gmail", label: "Gmail", icon: "gmail" };
    }
    if (host === "notion.so" || host.endsWith(".notion.so")) {
      return { key: "notion", label: "Notion", icon: "notion" };
    }
    if (host === "linear.app" || host.endsWith(".linear.app")) {
      return { key: "linear", label: "Linear", icon: "plug" };
    }
    return null;
  } catch {
    return null;
  }
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}
